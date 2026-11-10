# Find the opponent in one frame of his live: his HEAD (YuNet) and his BODY (rembg human segmentation).
# Writes  <out>_boxed.jpg  (the frame with the boxes we found — shown in the desk)
#         <out>_head.png   (his real head, cut clean, RGBA — gets pasted on the generated character)
#         <out>_green.jpg  (his whole body cut out and standing on a green screen, 720x1280 — what the generator receives)
# Prints one JSON line: {"w","h","face":[x,y,w,h]|null,"body":[x,y,w,h]|null,"head":bool,"green":bool}
# usage: py -3.13 opp_detect.py <frame.jpg> <out base>  [--side right|left]
import sys, os, json, shutil, tempfile
# ---- fast path: tools/opp_worker.py keeps OpenCV + rembg + the models loaded → ~1s per frame instead of ~8s ----
if os.environ.get('ARIEL_OD_WORKER') != '1' and '--no-worker' not in sys.argv:
    import socket
    try:
        _s = socket.create_connection(('127.0.0.1', 7791), timeout=1.0); _s.settimeout(90)
        _s.sendall((json.dumps({'argv': sys.argv[1:], 'cwd': os.getcwd()}) + '\n').encode('utf-8')); _b = b''
        while not _b.endswith(b'\n'):
            _c = _s.recv(65536)
            if not _c: break
            _b += _c
        _s.close(); _r = json.loads(_b.decode('utf-8'))
        sys.stdout.write(_r.get('out') or ''); sys.stdout.flush()
        if _r.get('err'): sys.stderr.write(_r['err'])
        sys.exit(int(_r.get('code') or 0))
    except SystemExit: raise
    except Exception:   # no worker yet → start one in the background for the next frames, and do this frame ourselves
        try:
            import subprocess
            subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'opp_worker.py')], creationflags=0x00000008 | 0x00000200,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, close_fds=True)
        except Exception: pass
import numpy as np, cv2
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
SIDE = sys.argv[sys.argv.index('--side') + 1] if '--side' in sys.argv else ''
HERE = os.path.dirname(os.path.abspath(__file__))
def imread_u(path):   # OpenCV can't open non-ASCII paths (the project folder has one)
    try: return cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)
    except Exception: return None
def imwrite_u(path, im, params=None):
    ok, buf = cv2.imencode(os.path.splitext(path)[1], im, params or []); buf.tofile(path); return ok
img = imread_u(src)
if img is None: print(json.dumps({'error': 'bad frame'})); sys.exit(1)
full = img
def ascii_copy(src, name):   # OpenCV can't open a path with non-ASCII chars → a copy in %TEMP%. Never rewritten while another run reads it (that race broke a capture: "model_proto.has_graph()")
    dst = os.path.join(tempfile.gettempdir(), name)
    try:
        if os.path.exists(dst) and os.path.getsize(dst) == os.path.getsize(src): return dst
    except OSError: pass
    mine = dst + '.%d' % os.getpid(); shutil.copyfile(src, mine)
    try: os.replace(mine, dst); return dst
    except OSError:
        import atexit; atexit.register(lambda: os.path.exists(mine) and os.remove(mine)); return mine
mp = os.path.join(HERE, 'yunet.onnx')
tmpm = ascii_copy(mp, 'yunet_ariel.onnx') if os.path.exists(mp) else os.path.join(tempfile.gettempdir(), 'yunet_ariel.onnx')
FRONTAL, TILT = 0.0, 1.0
PICK = int(sys.argv[sys.argv.index('--pick') + 1]) if '--pick' in sys.argv else -1
REF = sys.argv[sys.argv.index('--ref') + 1] if '--ref' in sys.argv else ''
ALL, SIMS, MATCH = [], [], -1
SF = None
def sface():
    global SF
    if SF is None:
        sp = os.path.join(HERE, 'sface.onnx')
        if not os.path.exists(sp): return None
        import builtins   # kept loaded inside opp_worker.py
        SF = getattr(builtins, '_ariel_sface', None)
        if SF is None: SF = cv2.FaceRecognizerSF.create(ascii_copy(sp, 'sface_ariel.onnx'), ''); builtins._ariel_sface = SF
    return SF
def embed(im, row):   # SFace embedding of one YuNet detection row (aligned crop)
    r = sface(); return None if r is None else r.feature(r.alignCrop(im, row))
def ref_embedding(path):
    im = imread_u(path)
    if im is None: return None
    h, w = im.shape[:2]; det = cv2.FaceDetectorYN.create(tmpm, '', (w, h), 0.5); _, d = det.detect(im)
    if d is None or not len(d): return None
    return embed(im, max(d, key=lambda q: q[2] * q[3]))
def find_face(im):
    global FRONTAL, TILT, ALL
    if not os.path.exists(mp): return None
    h, w = im.shape[:2]; det = cv2.FaceDetectorYN.create(tmpm, '', (w, h), 0.55); _, d = det.detect(im)
    if d is None or not len(d): return None
    d = [q for q in d if q[2] * q[3] > (w * h) * 0.002]            # ignore tiny background faces
    if not d: return None
    # a stable order the operator can point at: by panel — left→right, then top→bottom
    d = sorted(d, key=lambda q: (int((q[0] + q[2] / 2) // (w / 2)), int((q[1] + q[3] / 2) // (h / 3))))
    ALL = [[int(q[0]), int(q[1]), int(q[2]), int(q[3])] for q in d]
    global SIMS, MATCH
    if REF and os.path.exists(REF) and sface() is not None:
        re_ = ref_embedding(REF)
        if re_ is not None:
            SIMS = []
            for q in d:
                e = embed(im, q); SIMS.append(round(float(sface().match(re_, e, cv2.FaceRecognizerSF_FR_COSINE)), 3) if e is not None else 0.0)
            if SIMS and max(SIMS) >= 0.30: MATCH = int(np.argmax(SIMS))      # SFace cosine ≥ 0.363 is "same person"; 0.30 leaves room for a webcam frame vs a profile picture
    if 0 <= PICK < len(d): r = d[PICK]
    elif MATCH >= 0: r = d[MATCH]
    else: r = max(d, key=lambda q: q[2] * q[3])
    # how straight does he look at the camera? landmarks: right eye, left eye, nose tip (x,y pairs from index 4)
    ex1, ey1, ex2, ey2, nx, ny = [float(v) for v in r[4:10]]; ed = max(1.0, ((ex1 - ex2) ** 2 + (ey1 - ey2) ** 2) ** 0.5)
    FRONTAL = max(0.0, 1.0 - abs(nx - (ex1 + ex2) / 2) / (ed * 0.6)); TILT = abs(ey1 - ey2) / ed
    return [int(r[0]), int(r[1]), int(r[2]), int(r[3])]
def battle_layout(im):   # TikTok battle: two panels side by side in a middle band, flat black bars above and below
    g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY); h = g.shape[0]; top, bot, mid = g[:int(h * 0.2)], g[int(h * 0.8):], g[int(h * 0.35):int(h * 0.65)]
    return float(top.mean()) < 25 and float(bot.mean()) < 25 and float(top.std()) < 15 and float(bot.std()) < 15 and float(mid.mean()) > 35
BATTLE = battle_layout(full)
# in HIS room's battle picture he is always the LEFT panel; the right one is whoever he is fighting.
# (2026-11-09: talgabay98 was fighting ronbiton11, only Ron's face was found → Ron got saved as Tal and Tal's clips showed Ron)
if BATTLE and SIDE not in ('right', 'left'): SIDE = 'left'
face = None
if SIDE in ('right', 'left'):        # a two-person live: the one we want is one half of the composite…
    H0, W0 = full.shape[:2]; half = full[:, W0 // 2:] if SIDE == 'right' else full[:, :W0 // 2]
    face = find_face(half)
    if face: img = half
    elif not BATTLE: face = find_face(full)      # …unless the layout changed and he is alone on the whole frame (never in a battle: the other half is someone else)
else: face = find_face(full)
H, W = img.shape[:2]
rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

# ---- his PANEL in a multi-guest grid: the body must not leak into the neighbour's window ----
PANEL = (0, 0, W, H)
if face and len(ALL) > 1:
    fx, fy, fw, fh = face; cx = fx + fw / 2
    others = [f for f in ALL if f != face]
    left_side = cx < W / 2
    if any((f[0] + f[2] / 2 >= W / 2) != (not left_side) for f in others) or True:
        x0p, x1p = (0, W // 2) if left_side and any(f[0] + f[2] / 2 >= W / 2 for f in others) else ((W // 2, W) if (not left_side) and any(f[0] + f[2] / 2 < W / 2 for f in others) else (0, W))
    below = [f for f in others if f[1] > fy + fh * 0.8 and abs(f[0] + f[2] / 2 - cx) < W * 0.3]
    above = [f for f in others if f[1] + f[3] < fy and abs(f[0] + f[2] / 2 - cx) < W * 0.3]
    y1p = min([int((fy + fh + f[1]) / 2) for f in below], default=H); y1p = max(y1p, int(fy + fh * 0.98))     # the grid line sits between his chin and the neighbour's head
    y0p = max([f[1] + f[3] + int(f[3] * 0.35) for f in above], default=0); y0p = min(y0p, int(fy - fh * 0.5))
    PANEL = (x0p, y0p, x1p, y1p)
# ---- body ----
person = None
try:
    from rembg import remove, new_session
    import builtins   # inside opp_worker.py the model stays loaded between frames
    _sess = getattr(builtins, '_ariel_u2net', None)
    if _sess is None: _sess = new_session('u2net_human_seg'); builtins._ariel_u2net = _sess
    m = np.array(remove(Image.fromarray(rgb), session=_sess, only_mask=True, post_process_mask=True))
    binm = (m > 110).astype(np.uint8)
    nlab, lab, stats, cent = cv2.connectedComponentsWithStats(binm)
    if nlab > 1:
        if face:   # the component under his face
            fx, fy, fw, fh = face; probe = lab[min(H - 1, int(fy + fh * 1.3)), min(W - 1, int(fx + fw / 2))]
            k = probe if probe > 0 else 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        else: k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = (lab == k)
        if face:   # also keep any blob that touches the face box (hair, hat)
            fx, fy, fw, fh = face
            for j in range(1, nlab):
                x, y, w, h, a = stats[j]
                if x < fx + fw and x + w > fx and y < fy + fh and y + h > fy: keep |= (lab == j)
        soft = m.astype(np.float32) / 255.; soft[~keep] = 0
        soft[:PANEL[1], :] = 0; soft[PANEL[3]:, :] = 0; soft[:, :PANEL[0]] = 0; soft[:, PANEL[2]:] = 0   # stay inside his window
        if face:   # a streamer sits: keep only what belongs to HIM — around and below the face, not the sofa / the room
            fx, fy, fw, fh = face; lim = np.zeros_like(soft)
            x0, x1 = max(0, int(fx - fw * 1.7)), min(W, int(fx + fw * 2.7)); y0, y1 = max(0, int(fy - fh * 0.7)), min(H, int(fy + fh * 3.4))
            lim[y0:y1, x0:x1] = 1; soft = soft * lim
            # drop pixels far darker than his face that only touch the body from below (a dark couch / a black panel)
            col = rgb.astype(np.int16); fv = int(np.median(cv2.cvtColor(rgb[fy:fy + fh, fx:fx + fw], cv2.COLOR_RGB2HSV)[:, :, 2]))
            dark = (cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)[:, :, 2] < 28)
            side = np.abs(np.arange(W)[None, :] - (fx + fw / 2)) > fw * 2.0   # his torso stays whole (a black shirt was eaten into holes); only the sides can be a dark couch
            soft[dark & (np.arange(H)[:, None] > fy + fh * 2.2) & side] = 0
        person = soft
except Exception as e:
    print('rembg failed:', e, file=sys.stderr)

body = None
if person is not None:
    ys, xs = np.nonzero(person > 0.4)
    if len(xs) > 200: body = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min()), int(ys.max() - ys.min())]
if body is None and face:   # no segmentation — guess the body from the head
    fx, fy, fw, fh = face; bw = int(fw * 3.2); bx = max(PANEL[0], int(fx + fw / 2 - bw / 2)); by = max(PANEL[1], fy - int(fh * 0.4)); body = [bx, by, min(PANEL[2] - bx, bw), PANEL[3] - by]

# ---- the frame with boxes ----
boxed = img.copy()
if body: cv2.rectangle(boxed, (body[0], body[1]), (body[0] + body[2], body[1] + body[3]), (80, 220, 80), 3)
if len(ALL) > 1 and face: cv2.rectangle(boxed, (PANEL[0] + 2, PANEL[1] + 2), (PANEL[2] - 3, PANEL[3] - 3), (255, 200, 40), 2)
for k, f in enumerate(ALL):   # every face gets a number so the operator can pick the right person
    sel = face is not None and f == face
    cv2.rectangle(boxed, (f[0], f[1]), (f[0] + f[2], f[1] + f[3]), (40, 220, 255) if sel else (200, 200, 200), 4 if sel else 2)
    cv2.circle(boxed, (f[0] + 22, f[1] + 22), 22, (40, 220, 255) if sel else (90, 90, 90), -1); cv2.putText(boxed, str(k + 1), (f[0] + 10, f[1] + 34), cv2.FONT_HERSHEY_SIMPLEX, 1.1, (0, 0, 0) if sel else (255, 255, 255), 3)
imwrite_u(out + '_boxed.jpg', boxed, [cv2.IMWRITE_JPEG_QUALITY, 86])

# ---- the real head, cut clean ----
head_ok = False
if face:
    fx, fy, fw, fh = face; s = int(max(fw, fh) * 1.5); cx, cy = fx + fw / 2, fy + fh / 2 - 0.08 * s
    x0, y0 = int(cx - s / 2), int(cy - s / 2)
    crop = np.zeros((s, s, 4), np.uint8)
    sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(W, x0 + s), min(H, y0 + s)
    crop[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0, :3] = rgb[sy0:sy1, sx0:sx1]
    ell = np.zeros((s, s), np.uint8); cv2.ellipse(ell, (s // 2, s // 2), (int(s * 0.44), int(s * 0.5)), 0, 0, 360, 255, -1)
    ell = cv2.GaussianBlur(ell, (0, 0), s * 0.03)
    a = ell.astype(np.float32) / 255.
    if person is not None:
        pm = np.zeros((s, s), np.float32); pm[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = person[sy0:sy1, sx0:sx1]
        pm = cv2.GaussianBlur(pm, (0, 0), 1.2); a = a * np.clip(pm * 1.4, 0, 1)
    chin = int((fy + fh + fh * 0.03) - y0); ramp = np.ones((s, 1), np.float32)
    if 0 < chin < s: ramp[chin:, 0] = np.clip(1 - (np.arange(s - chin) / max(1, fh * 0.07)), 0, 1)
    a = a * ramp
    crop[:, :, 3] = (a * 255).astype(np.uint8)
    Image.fromarray(crop, 'RGBA').resize((512, 512), Image.LANCZOS).save(out + '_head.png'); head_ok = True

# ---- his whole body on a green screen (what the generator gets) ----
green_ok = False
GW, GH = 720, 1280
if body:
    bx, by, bw, bh = body; pad = int(bh * 0.04)
    x0, y0, x1, y1 = max(0, bx - pad), max(0, by - pad), min(W, bx + bw + pad), min(H, by + bh + pad)
    if len(ALL) > 1: y1 = min(y1, PANEL[3] - 4)
    cut = rgb[y0:y1, x0:x1].astype(np.float32)
    if person is not None: a = cv2.GaussianBlur(person[y0:y1, x0:x1], (0, 0), 1.0)[:, :, None]
    else: a = np.ones((y1 - y0, x1 - x0, 1), np.float32)
    ch, cw = cut.shape[:2]; k = min(GH * 0.86 / ch, GW * 0.9 / cw)
    nw, nh = max(2, int(cw * k)), max(2, int(ch * k))
    cut = cv2.resize(cut, (nw, nh), interpolation=cv2.INTER_AREA); a = cv2.resize(a, (nw, nh), interpolation=cv2.INTER_AREA)[:, :, None]
    canvas = np.zeros((GH, GW, 3), np.float32); canvas[:] = (0, 255, 0)
    ox, oy = (GW - nw) // 2, int(GH * 0.93) - nh
    canvas[oy:oy + nh, ox:ox + nw] = cut * a + canvas[oy:oy + nh, ox:ox + nw] * (1 - a)
    imwrite_u(out + '_green.jpg', cv2.cvtColor(canvas.astype(np.uint8), cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 92]); green_ok = True
print(json.dumps({'w': W, 'h': H, 'face': face, 'body': body, 'head': head_ok, 'green': green_ok, 'frontal': round(FRONTAL, 2), 'tilt': round(TILT, 2), 'faces': ALL, 'pick': PICK, 'sims': SIMS, 'match': MATCH, 'verified': bool(MATCH >= 0 and (PICK < 0 or PICK == MATCH))}), flush=True)
