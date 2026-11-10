# 📡 where Chino grabs a clip ("שגר לשרת"): the chicken's comb / the baby's mouth, in 0..1 of the file
#   py -3.13 tools/chino_anchor.py <clipId> comb|mouth [--out file.json]
# writes media/overlays/<clipId>.grab.json (comb) or <clipId>.feed.json (mouth): the point on the first frame
# + a per-frame track [t, x, y] (the chicken pecks and jumps inside its own clip — a fixed point slips off the paw)
# prints one JSON line: {"ok":true,"point":{"x":..,"y":..},...} or {"ok":false,"why":".."}
import sys, os, re, json, shutil, subprocess, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def frames(src):
    ff = ffmpeg()
    info = subprocess.run([ff, '-hide_banner', '-c:v', 'libvpx-vp9', '-i', src], capture_output=True, text=True, errors='replace').stderr
    line = next((l for l in info.splitlines() if 'Video:' in l), '')
    m = re.search(r'\b(\d{2,5})x(\d{2,5})\b', line)
    if not m:
        raise RuntimeError('no video size')
    W, H = int(m.group(1)), int(m.group(2))
    f = re.search(r'([\d.]+) fps', line)
    fps = float(f.group(1)) if f else 24.0
    raw = subprocess.run([ff, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], capture_output=True).stdout
    n = len(raw) // (W * H * 4)
    if not n:
        raise RuntimeError('no frames')
    return np.frombuffer(raw[:n * W * H * 4], np.uint8).reshape(n, H, W, 4), W, H, fps


def comb(fr, W, H):
    # Preserve the existing upper-figure observations. Only when that ROI has
    # no observed crest, look for real full-body red components near the last
    # observed point. Red feet cannot substitute for a crest that left frame.
    from scipy import ndimage as ndi
    rows = np.indices((H, W))[0]
    minpx = max(60, int(200 * W * H / (400 * 736)))
    pts, fallback = [], []

    def blobs(mask):
        lab, count = ndi.label(mask)
        if not count:
            return []
        idx = range(1, count + 1)
        sizes = ndi.sum(mask, lab, idx)
        tops = ndi.minimum(rows, lab, idx)
        found = []
        for c in range(count):
            if sizes[c] >= minpx:
                cy, cx = ndi.center_of_mass(mask, lab, c + 1)
                found.append((float(tops[c]), (cx / W, cy / H)))
        return found

    for frame in fr:
        a = frame.astype(np.int16)
        op = a[..., 3] > 128
        ys = np.nonzero(op.any(1))[0]
        if not len(ys):
            pts.append(None); fallback.append([]); continue
        top, bot = ys[0], ys[-1]
        r, g, b = a[..., 0], a[..., 1], a[..., 2]
        red = op & (r > 140) & (r > g + 60) & (r > b + 50)
        primary = red.copy()
        primary[int(top + (bot - top) * 0.45):, :] = False
        candidates = blobs(primary)
        if candidates:
            pts.append(min(candidates, key=lambda c: c[0])[1]); fallback.append([])
        else:
            # Saturated red separates the crest from reddish facial skin,
            # which can connect into one large blob during a forward peck.
            crest_red = op & (r > 150) & (g < 115) & (b < 125) & (r > g * 1.8) & (r > b * 1.8)
            strict = blobs(crest_red)
            pts.append(None); fallback.append((strict, blobs(red)))

    primary_points = list(pts)
    previous = None
    for i, point in enumerate(pts):
        if point is not None:
            previous = point; continue
        # For a leading miss, a nearby future PRIMARY observation may anchor
        # the search. Otherwise missing means missing; never invent a point.
        reference = previous
        if reference is None:
            reference = next((p for p in primary_points[i + 1:i + 6] if p is not None), None)
        if reference is None:
            continue
        groups = fallback[i] if fallback[i] else ([], [])
        nearby = []
        for candidates in groups:
            nearby = [c for c in candidates if ((c[1][0] - reference[0]) ** 2 + (c[1][1] - reference[1]) ** 2) ** 0.5 <= 0.18]
            if nearby:
                break
        if nearby:
            point = min(nearby, key=lambda c: (c[0], (c[1][0] - reference[0]) ** 2 + (c[1][1] - reference[1]) ** 2))[1]
            pts[i] = point; previous = point
    return pts


def mouth(fr, W, H):
    # the middle between the mouth corners (YuNet); OpenCV can't open the project's non-ASCII path → a copy in %TEMP%
    import cv2
    m = os.path.join(tempfile.gettempdir(), 'yunet_chino.onnx')
    if not os.path.exists(m):
        tmp = m + '.%d' % os.getpid()
        shutil.copy(os.path.join(HERE, 'yunet.onnx'), tmp)
        os.replace(tmp, m)
    det = cv2.FaceDetectorYN.create(m, '', (W, H), 0.5)
    pts = []
    for a in fr:
        al = a[..., 3:4].astype(np.float32) / 255.0
        rgb = (a[..., :3].astype(np.float32) * al + 128 * (1 - al)).astype(np.uint8)
        _, faces = det.detect(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        if faces is None or not len(faces):
            pts.append(None); continue
        f = max(faces, key=lambda r: r[2] * r[3])
        pts.append(((f[10] + f[12]) / 2 / W, (f[11] + f[13]) / 2 / H))
    # a wrong face for a few frames jumps far from where the mouth always is
    ok = [p for p in pts if p]
    if ok:
        my = float(np.median([p[1] for p in ok])); mx = float(np.median([p[0] for p in ok]))
        pts = [p if p and abs(p[1] - my) <= 0.1 and abs(p[0] - mx) <= 0.12 else None for p in pts]
    return pts


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    if out in args:
        args.remove(out)
    if len(args) < 2 or args[1] not in ('comb', 'mouth') or not re.fullmatch(r'[\w-]+', args[0]):
        print(json.dumps({'ok': False, 'why': 'usage: chino_anchor.py <clipId> comb|mouth'})); return
    cid, kind = args[0], args[1]
    src = os.path.join(ROOT, 'media', 'overlays', cid + '.webm')
    if not os.path.exists(src):
        print(json.dumps({'ok': False, 'why': 'no clip file'})); return
    fr, W, H, fps = frames(src)
    n = len(fr)
    pts = comb(fr, W, H) if kind == 'comb' else mouth(fr, W, H)
    good = [i for i, p in enumerate(pts) if p]
    if not good:
        print(json.dumps({'ok': False, 'why': 'no comb found' if kind == 'comb' else 'no face found'})); return
    from scipy.ndimage import median_filter
    filled = [pts[i] if pts[i] else pts[min(good, key=lambda g: abs(g - i))] for i in range(n)]
    X = median_filter(np.array([p[0] for p in filled]), 5, mode='nearest')
    Y = median_filter(np.array([p[1] for p in filled]), 5, mode='nearest')
    X = np.convolve(np.pad(X, 1, mode='edge'), np.ones(3) / 3, 'valid')
    Y = np.convolve(np.pad(Y, 1, mode='edge'), np.ones(3) / 3, 'valid')
    point = {'x': round(float(X[0]), 3), 'y': round(float(Y[0]), 3)}
    key = 'grabPoint' if kind == 'comb' else 'feedPoint'
    d = {'version': 1, 'file': cid + '.webm', 'width': W, 'height': H, 'fps': fps, 'frames': n,
         'point': 'chicken comb (red crest) centroid' if kind == 'comb' else 'baby mouth center (between the mouth corners)',
         'coords': 'normalized 0..1 to the file; track = [t seconds, x, y] per frame',
         key: point,
         'track': [[round(i / fps, 3), round(float(X[i]), 4), round(float(Y[i]), 4)] for i in range(n)],
         'detected': [bool(p) for p in pts]}
    if kind == 'comb':
        end = next((i for i in range(n) if abs(Y[i] - Y[0]) > 0.05 or abs(X[i] - X[0]) > 0.09), n)
        d['stableWindow'] = {'from': 0.0, 'to': round((end - 1) / fps, 3), 'note': 'the comb stays near the grab point; after this the chicken moves its head a lot inside the clip'}
    path = out or os.path.join(ROOT, 'media', 'overlays', cid + ('.grab.json' if kind == 'comb' else '.feed.json'))
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(d, f, separators=(',', ':'))
    os.replace(tmp, path)
    print(json.dumps({'ok': True, 'point': point, 'frames': n, 'found': len(good), 'size': [W, H], 'stable': d.get('stableWindow', {}).get('to'), 'file': os.path.basename(path)}))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(json.dumps({'ok': False, 'why': str(e)[:200]}))
