# Prepare a "head-swap" overlay clip: track EVERY face in the video (so the operator can pick whose head gets replaced),
# optionally cut the people out of the background (rembg), and write a WebM (VP9 + alpha) plus a JSON with the face tracks.
# usage: py -3.13 overlay_proc.py <src video> <name> [--keep]      (--keep = full frame, no background removal)
import sys, os, json, subprocess, tempfile, shutil, re
import numpy as np, cv2
from PIL import Image
src, name = sys.argv[1], sys.argv[2]
KEEP = '--keep' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'media', 'overlays'); os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(HERE, '..', 'data', 'ovtmp')
FPS = 24
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()

# probe size → keep aspect, cap at 960 on the long side
pr = subprocess.run([FF, '-hide_banner', '-i', src], capture_output=True, text=True)
m = re.search(r'Video:.*?(\d{2,5})x(\d{2,5})', pr.stderr)
sw, sh = (int(m.group(1)), int(m.group(2))) if m else (960, 540)
scale = min(1.0, (1280 if KEEP else 960) / max(sw, sh)); W, H = int(sw * scale) // 2 * 2, int(sh * scale) // 2 * 2   # a full-frame scene (keep) covers the whole live picture → keep its 720x1280

dec = [FF, '-v', 'error']
if src.lower().endswith('.webm'): dec += ['-c:v', 'libvpx-vp9']          # keep alpha of VP9 sources
dec += ['-i', src, '-vf', f'fps={FPS},scale={W}:{H},format=rgba', '-f', 'rawvideo', '-']
p = subprocess.Popen(dec, stdout=subprocess.PIPE)

sess = None
GREEN = False
_m = os.path.join(tempfile.gettempdir(), 'yunet_ariel.onnx')
det = None
if os.path.exists(os.path.join(HERE, 'yunet.onnx')):
    _src = os.path.join(HERE, 'yunet.onnx')   # OpenCV can't open non-ASCII paths → a copy in %TEMP%, never rewritten while another run reads it
    if not (os.path.exists(_m) and os.path.getsize(_m) == os.path.getsize(_src)):
        _mine = _m + '.%d' % os.getpid(); shutil.copyfile(_src, _mine)
        try: os.replace(_mine, _m)
        except OSError: _m = _mine
    det = cv2.FaceDetectorYN.create(_m, '', (W, H), 0.6)
def is_green(f):
    b = np.concatenate([f[:8].reshape(-1, 3), f[-8:].reshape(-1, 3), f[:, :8].reshape(-1, 3), f[:, -8:].reshape(-1, 3)]).astype(int)
    g = (b[:, 1] > 90) & (b[:, 1] > b[:, 0] + 40) & (b[:, 1] > b[:, 2] + 40)
    return g.mean() > 0.5
def green_mask(f):
    hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV)
    m = cv2.inRange(hsv, (35, 70, 60), (90, 255, 255))            # the green screen
    m |= cv2.inRange(hsv, (38, 40, 30), (88, 255, 255))           # darker / duller greens at the edges and in the generator's gradient
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.dilate(m, np.ones((3, 3), np.uint8))                  # eat the 1px green fringe around the body
    alpha = 255 - m
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0).astype(np.float32) / 255.
    return alpha
def despill(f):
    f = f.astype(np.int16); g = f[:, :, 1]; lim = (f[:, :, 0] + f[:, :, 2]) // 2
    f[:, :, 1] = np.minimum(g, np.maximum(lim + 6, np.maximum(f[:, :, 0], f[:, :, 2]) - 4)); return np.clip(f, 0, 255).astype(np.uint8)

frames, masks, dets = [], [], []
prev = None
while True:
    buf = p.stdout.read(W * H * 4)
    if len(buf) < W * H * 4: break
    f4 = np.frombuffer(buf, np.uint8).reshape(H, W, 4)
    f = f4[:, :, :3].copy()
    if len(frames) == 0 and not KEEP: GREEN = is_green(f); print('green screen:', GREEN, flush=True)
    if KEEP:
        m = f4[:, :, 3].astype(np.float32) / 255.      # a transparent source keeps its own alpha; an opaque one is fully visible
    elif GREEN:
        m = green_mask(f); f = despill(f)
        if '--wm' in sys.argv: m[int(H * 0.90):, int(W * 0.78):] = 0   # Kling's watermark corner — only on request: on the OpenRouter clips it cut a square hole out of the opponent's shirt
    else:
        if sess is None:
            from rembg import remove, new_session
            sess = new_session('u2net_human_seg')
        m = np.array(remove(Image.fromarray(f), session=sess, only_mask=True, post_process_mask=False), np.float32) / 255.
        if prev is not None: m = 0.65 * m + 0.35 * prev
        prev = m
    frames.append(f); masks.append(m)
    d = None
    if det is not None: _, d = det.detect(cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
    dets.append([r[:4].tolist() for r in d] if d is not None and len(d) else [])
    if len(frames) % 40 == 0: print(name, len(frames), flush=True)
n = len(frames)
if n == 0: print('ERROR no frames', flush=True); sys.exit(1)

# ---- multi-face tracking: match each detection to the nearest live track ----
tracks = []   # {pts: {frame_index: [cx, cy, s]}, last: idx}
for i, ds in enumerate(dets):
    used = set()
    for r in ds:
        cx, cy, s = r[0] + r[2] / 2, r[1] + r[3] / 2, max(r[2], r[3])
        best, bd = None, 1e9
        for ti, t in enumerate(tracks):
            if ti in used or i - t['last'] > FPS * 1.5: continue
            lx, ly, ls = t['pts'][t['last']]
            d = ((cx - lx) ** 2 + (cy - ly) ** 2) ** 0.5
            if d < max(ls, s) * 0.9 and d < bd: best, bd = ti, d
        if best is None: tracks.append({'pts': {i: [cx, cy, s]}, 'last': i}); used.add(len(tracks) - 1)
        else: tracks[best]['pts'][i] = [cx, cy, s]; tracks[best]['last'] = i; used.add(best)
tracks = [t for t in tracks if len(t['pts']) >= max(6, n * 0.12)]
tracks.sort(key=lambda t: -np.mean([q[2] for q in t['pts'].values()]) * len(t['pts']))
tracks = tracks[:4]

# crop box: cut-out → union of the mask; keep → full frame
if KEEP: x0, y0, x1, y1 = 0, 0, W, H
else:
    ys, xs = np.nonzero(np.max(np.stack(masks), 0) > 0.4)
    if len(xs) == 0: x0, y0, x1, y1 = 0, 0, W, H
    else: x0, x1 = int(max(0, xs.min() - 12)), int(min(W, xs.max() + 12)); y0, y1 = int(max(0, ys.min() - 12)), int(min(H, ys.max() + 12))
cw, ch = int((x1 - x0) // 2 * 2), int((y1 - y0) // 2 * 2)

def fill_smooth(pts):
    idx = sorted(pts.keys()); tr = []
    for i in range(n):
        if i in pts: r = pts[i]
        else:
            a = max([j for j in idx if j < i], default=None); b = min([j for j in idx if j > i], default=None)
            r = pts[a] if b is None else pts[b] if a is None else [pts[a][k] + (pts[b][k] - pts[a][k]) * (i - a) / (b - a) for k in range(3)]
        tr.append(r)
    tr = np.array(tr, np.float32)
    for k in range(1, n): tr[k] = 0.6 * tr[k] + 0.4 * tr[k - 1]
    return [[round(float((cx - x0) / cw), 4), round(float((cy - y0) / ch), 4), round(float(s / cw), 4)] for cx, cy, s in tr]

ANCHOR = 'face'
if not tracks:
    # HEADLESS body (made for a live head): track the NECK — the top of the body silhouette — and put the head on it
    ANCHOR = 'neck'; pts = {}
    for i, (f, m) in enumerate(zip(frames, masks)):
        body = m > 0.5; ys, xs = np.nonzero(body)
        if len(xs) < 50: continue
        y0, y1 = ys.min(), ys.max()
        # the neck hole = the darkest blob inside the upper part of the body
        hsv = cv2.cvtColor(f, cv2.COLOR_RGB2HSV); dark = (hsv[:, :, 2] < 135) & body
        dark[int(y0 + (y1 - y0) * 0.45):, :] = False
        dark = cv2.morphologyEx(dark.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        nlab, lab, stats, cent = cv2.connectedComponentsWithStats(dark)
        if nlab < 2: continue
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA])); x, y, w, h, a = stats[k]
        if a < 40: continue
        pts[i] = [float(cent[k][0]), float(y + h * 0.35), float(w) * 2.4]      # head ≈ 2.4 neck-widths wide, centered on the hole
    # median filter against the odd wrong blob
    if pts:
        ks = sorted(pts); arr = np.array([pts[k] for k in ks])
        for c in range(3):
            v = arr[:, c].copy()
            for j in range(len(v)): lo, hi = max(0, j - 2), min(len(v), j + 3); arr[j, c] = np.median(v[lo:hi])
        pts = {k: arr[j].tolist() for j, k in enumerate(ks)}
        tracks = [{'pts': pts, 'last': max(pts)}]
    print('neck track points:', len(pts), flush=True)
out_tracks, faces = [], []
for k, t in enumerate(tracks):
    out_tracks.append(fill_smooth(t['pts']))
    # thumbnail of this person's face (the frame where the face is biggest)
    fi = max(t['pts'], key=lambda i: t['pts'][i][2]); cx, cy, s = t['pts'][fi]; s = s * 1.6
    x, y = int(max(0, cx - s / 2)), int(max(0, cy - s / 2)); crop = frames[fi][y:int(y + s), x:int(x + s)]
    if crop.size: Image.fromarray(crop).resize((160, 160)).save(f'{OUT}/{name}_face{k}.jpg', quality=88)
    faces.append({'thumb': f'/media/overlays/{name}_face{k}.jpg', 'frames_seen': len(t['pts']), 'x': round(float(np.mean([q[0] for q in t['pts'].values()]) / W), 3), 'anchor': ANCHOR})

# frames go straight into the encoder (no PNG per frame), VP9 at a faster preset: the cut went from ~40s to a few seconds (Shahak: "it shouldn't take long")
enc = subprocess.Popen([FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{cw}x{ch}', '-framerate', str(FPS), '-i', '-', '-i', src,
                        '-map', '0:v:0', '-map', '1:a:0?', '-c:a', 'libopus', '-b:a', '64k', '-shortest',
                        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '3000k', '-auto-alt-ref', '0', '-row-mt', '1', '-threads', '8',
                        '-deadline', 'good', '-cpu-used', '4', f'{OUT}/{name}.webm'], stdin=subprocess.PIPE)
for f, m in zip(frames, masks):
    a = (np.clip(m, 0, 1) * 255).astype(np.uint8)
    enc.stdin.write(np.ascontiguousarray(np.dstack([f, a])[y0:y0 + ch, x0:x0 + cw]).tobytes())
enc.stdin.close()
if enc.wait() != 0: print('ERROR encode failed', flush=True); sys.exit(1)
json.dump({'fps': FPS, 'w': cw, 'h': ch, 'full': KEEP, 'anchor': ANCHOR, 'green': bool(GREEN), 'frames': out_tracks[0] if out_tracks else [], 'tracks': out_tracks, 'faces': faces, 'faces_found': len(out_tracks), 'n': n},
          open(f'{OUT}/{name}.json', 'w'))
try:   # a per-player CLIP (boxer + opponent) shows WHOLE and centred on the 9:16 stage — before, the dwarf boxer was cut off at the left edge
    sys.path.insert(0, HERE); import clip_fit, io as _io
    _op = os.path.join(HERE, '..', 'data', 'overlays.json'); _nm = json.loads(_io.open(_op, encoding='utf-8').read())
    if clip_fit.fit_one(_nm, name): _io.open(_op, 'w', encoding='utf-8').write(json.dumps(_nm, ensure_ascii=False, indent=2))
except Exception as e: print('fit:', e, flush=True)
print('DONE', name, cw, ch, 'people', len(out_tracks), 'frames', n, flush=True)
