# 🖐️ where the dancer's hand is, per frame (for Chino "grab the hand and spin her"): MediaPipe pose, runs locally in tools/pose_venv — free, no server
#   tools\pose_venv\Scripts\python.exe tools/pose_hand.py <clipId> [--out file.json]      (env FFMPEG_EXE = ffmpeg path)
# writes media/overlays/<clipId>.hand.json — same shape as grab.json: width, height, fps, frames, track [t,x,y] (0..1 of the file), detected
# + handPoint (the hand that stays raised the longest, at the moment it goes up), graspAt (seconds), both hands' tracks under "hands"
# prints one JSON line: {"ok":true,...} or {"ok":false,"why":"..."}
import sys, os, re, json, subprocess
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(HERE, 'models', 'pose_landmarker_heavy.task')


def frames(src, ff):
    info = subprocess.run([ff, '-hide_banner', '-c:v', 'libvpx-vp9', '-i', src], capture_output=True, text=True, errors='replace').stderr
    line = next((l for l in info.splitlines() if 'Video:' in l), '')
    m = re.search(r'\b(\d{2,5})x(\d{2,5})\b', line)
    W, H = int(m.group(1)), int(m.group(2))
    f = re.search(r'([\d.]+) fps', line)
    fps = float(f.group(1)) if f else 24.0
    raw = subprocess.run([ff, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], capture_output=True).stdout
    n = len(raw) // (W * H * 4)
    return np.frombuffer(raw[:n * W * H * 4], np.uint8).reshape(n, H, W, 4), W, H, fps


def fill(v):   # linear fill of gaps + 5-frame median
    v = np.asarray(v, float); idx = np.where(np.isfinite(v))[0]
    if not len(idx): return v
    v = np.interp(np.arange(len(v)), idx, v[idx]); p = np.pad(v, 2, mode='edge')
    return np.array([np.median(p[i:i + 5]) for i in range(len(v))])


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    if out in args: args.remove(out)
    if not args or not re.fullmatch(r'[\w-]+', args[0]):
        print(json.dumps({'ok': False, 'why': 'usage: pose_hand.py <clipId>'})); return
    cid = args[0]
    ff = os.environ.get('FFMPEG_EXE', 'ffmpeg')
    src = os.path.join(ROOT, 'media', 'overlays', cid + '.webm')
    if not os.path.exists(src): print(json.dumps({'ok': False, 'why': 'no clip file'})); return
    if not os.path.exists(MODEL): print(json.dumps({'ok': False, 'why': 'no pose model'})); return
    import mediapipe as mp
    from mediapipe.tasks import python as mpp
    from mediapipe.tasks.python import vision
    fr, W, H, fps = frames(src, ff)
    n = len(fr)
    opts = vision.PoseLandmarkerOptions(base_options=mpp.BaseOptions(model_asset_buffer=open(MODEL, 'rb').read()), running_mode=vision.RunningMode.VIDEO, num_poses=1,
                                        min_pose_detection_confidence=0.4, min_pose_presence_confidence=0.4, min_tracking_confidence=0.4)
    det = vision.PoseLandmarker.create_from_options(opts)
    X = np.full((n, 2), np.nan); Y = np.full((n, 2), np.nan); V = np.zeros((n, 2)); SH = np.full(n, np.nan)   # side 0 = the image's left hand, 1 = the image's right hand
    for i in range(n):
        a = fr[i].astype(np.float32); al = a[..., 3:4] / 255.0
        rgb = np.ascontiguousarray((a[..., :3] * al + 128 * (1 - al)).astype(np.uint8))
        r = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
        if not r.pose_landmarks: continue
        lm = r.pose_landmarks[0]
        SH[i] = (lm[11].y + lm[12].y) / 2
        for ids in ((15, 17, 19), (16, 18, 20)):   # wrist + pinky + index of each hand
            pts = [lm[k] for k in ids]
            x = float(np.mean([p.x for p in pts])); y = float(np.mean([p.y for p in pts])); v = float(min(p.visibility for p in pts))
            s = 0 if x < 0.5 else 1
            if v >= V[i, s]: X[i, s], Y[i, s], V[i, s] = x, y, v
    det.close()
    if not np.isfinite(X).any(): print(json.dumps({'ok': False, 'why': 'no person found'})); return
    SHf = fill(SH); xs = [fill(X[:, s]) for s in (0, 1)]; ys = [fill(Y[:, s]) for s in (0, 1)]
    best = (-1, None, None)   # longest run with the hand above the shoulders
    for s in (0, 1):
        up = np.isfinite(Y[:, s]) & (V[:, s] > 0.3) & (Y[:, s] < SHf - 0.02); i = 0
        while i < n:
            if not up[i]: i += 1; continue
            j = i
            while j < n and up[j]: j += 1
            if j - i > best[0]: best = (j - i, s, i)
            i = j
    run, side, start = best
    if side is None or run < int(0.3 * fps):
        print(json.dumps({'ok': False, 'why': 'no raised hand found'})); return
    point = {'x': round(float(xs[side][start]), 3), 'y': round(float(ys[side][start]), 3)}
    d = {'version': 1, 'file': cid + '.webm', 'width': W, 'height': H, 'fps': fps, 'frames': n,
         'point': 'dancer hand (wrist + pinky + index centre) — the hand that stays raised the longest',
         'coords': 'normalized 0..1 to the file; track = [t seconds, x, y] per frame',
         'handPoint': point, 'graspAt': round(start / fps, 3), 'raisedSeconds': round(run / fps, 3), 'handSide': 'image-left' if side == 0 else 'image-right',
         'track': [[round(i / fps, 3), round(float(xs[side][i]), 4), round(float(ys[side][i]), 4)] for i in range(n)],
         'detected': [bool(np.isfinite(X[i, side]) and V[i, side] > 0.3) for i in range(n)],
         'hands': {name: {'track': [[round(i / fps, 3), round(float(xs[k][i]), 4), round(float(ys[k][i]), 4)] for i in range(n)], 'visibility': [round(float(V[i, k]), 2) for i in range(n)]} for k, name in enumerate(('imageLeft', 'imageRight'))}}
    path = out or os.path.join(ROOT, 'media', 'overlays', cid + '.hand.json')
    with open(path + '.tmp', 'w') as f: json.dump(d, f, separators=(',', ':'))
    os.replace(path + '.tmp', path)
    print(json.dumps({'ok': True, 'handPoint': point, 'graspAt': d['graspAt'], 'raisedSeconds': d['raisedSeconds'], 'side': d['handSide'], 'frames': n, 'found': int(sum(d['detected'])), 'file': os.path.basename(path)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'ok': False, 'why': str(e)[:200]}))
