# Bake a REAL head (RGBA png, e.g. the opponent's) onto an existing overlay character → a new transparent WebM.
# The head follows the character's face track (or the neck of a headless body) in every frame.
# usage: py -3.13 head_bake.py <src overlay id> <head.png> <out id> [head scale=1.25] [hebrew label]
import sys, os, json, subprocess, shutil
import numpy as np, cv2
from PIL import Image
import imageio_ffmpeg
ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]   # optional flags: --trim (cut where the track goes wild, e.g. the baby tumbling), --neck-y=0.40 (head height over a neck)
src_id, head_png, out_id = ARGS[0], ARGS[1], ARGS[2]
K = float(ARGS[3]) if len(ARGS) > 3 else 1.25
LABEL = ARGS[4] if len(ARGS) > 4 else ''
TRIM = '--trim' in sys.argv
NECK_Y = float(next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--neck-y=')), 0.40))
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, '..')
OUT = os.path.join(ROOT, 'media', 'overlays'); TMP = os.path.join(ROOT, 'data', 'ovtmp', out_id)
FF = imageio_ffmpeg.get_ffmpeg_exe()
meta = json.load(open(os.path.join(OUT, src_id + '.json')))
W, H, FPS = meta['w'], meta['h'], meta.get('fps', 24)
names_f = os.path.join(ROOT, 'data', 'overlays.json'); names = json.load(open(names_f, encoding='utf-8')) if os.path.exists(names_f) else {}
nm = names.get(src_id, {}); nm = nm if isinstance(nm, dict) else {'he': nm}
k = int(nm.get('face', 0)); tracks = meta.get('tracks') or [meta.get('frames', [])]
track = tracks[k] if k < len(tracks) else tracks[0]
anchor = meta.get('anchor', 'face')
if not track: print('ERROR no track in', src_id, flush=True); sys.exit(1)

# decode the source WebM with its alpha
p = subprocess.Popen([FF, '-v', 'error', '-c:v', 'libvpx-vp9', '-i', os.path.join(OUT, src_id + '.webm'), '-vf', 'format=rgba', '-f', 'rawvideo', '-'], stdout=subprocess.PIPE)
frames = []
while True:
    b = p.stdout.read(W * H * 4)
    if len(b) < W * H * 4: break
    frames.append(np.frombuffer(b, np.uint8).reshape(H, W, 4).copy())
n = len(frames)
if not n: print('ERROR no frames', flush=True); sys.exit(1)
if TRIM and len(track) > 10:   # keep only the part where the body is where it should be (the head would fly off otherwise)
    ss = sorted(t[2] for t in track); ms = ss[len(ss) // 2]; cys = sorted(t[1] for t in track); mcy = cys[len(cys) // 2]
    cut = min(n, len(track))
    for i in range(cut):
        if track[i][2] < 0.6 * ms or abs(track[i][1] - mcy) > 0.06: cut = i; break
    cut = max(cut, min(n, int(FPS * 2)))
    frames = frames[:cut]; n = len(frames); track = track[:n]

head = np.array(Image.open(head_png).convert('RGBA'))
# head size per frame (in source pixels) and the canvas padding so a head above the body is not cut
def geo(i):
    cx, cy, s = track[min(i, len(track) - 1)]; cx, cy, s = cx * W, cy * H, s * W
    if anchor == 'neck': S = s * K; yc = cy - S * NECK_Y
    else: S = s * 1.5 * K; yc = cy - 0.08 * S
    return cx, yc, S
Smax = max(geo(i)[2] for i in range(n))
PAD = int(Smax * 0.75) // 2 * 2
NW, NH = W + 2 * PAD, H + PAD
shutil.rmtree(TMP, ignore_errors=True); os.makedirs(TMP, exist_ok=True)
for i, f in enumerate(frames):
    canvas = np.zeros((NH, NW, 4), np.uint8); canvas[PAD:PAD + H, PAD:PAD + W] = f
    cx, yc, S = geo(i); S = int(S)
    if S >= 8:
        h = cv2.resize(head, (S, S), interpolation=cv2.INTER_AREA)
        x0, y0 = int(cx + PAD - S / 2), int(yc + PAD - S / 2)
        sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(NW, x0 + S), min(NH, y0 + S)
        if sx1 > sx0 and sy1 > sy0:
            hp = h[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0].astype(np.float32)
            dst = canvas[sy0:sy1, sx0:sx1].astype(np.float32)
            ha = hp[:, :, 3:4] / 255.; da = dst[:, :, 3:4] / 255.
            oa = ha + da * (1 - ha)
            rgb = (hp[:, :, :3] * ha + dst[:, :, :3] * da * (1 - ha)) / np.maximum(oa, 1e-4)
            dst[:, :, :3] = rgb; dst[:, :, 3:4] = oa * 255
            canvas[sy0:sy1, sx0:sx1] = np.clip(dst, 0, 255).astype(np.uint8)
    Image.fromarray(canvas, 'RGBA').save(f'{TMP}/{i:04d}.png')
    if i % 40 == 0: print(out_id, i, flush=True)
subprocess.run([FF, '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{TMP}/%04d.png', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '3000k', '-auto-alt-ref', '0', '-row-mt', '1', os.path.join(OUT, out_id + '.webm')], check=True)
shutil.rmtree(TMP, ignore_errors=True)
# the new clip is a finished character: no live head, no face picking
def shift(t): return [[round((cx * W + PAD) / NW, 4), round((cy * H + PAD) / NH, 4), round(s * W / NW, 4)] for cx, cy, s in t]
meta2 = dict(meta); meta2.update({'w': NW, 'h': NH, 'n': n, 'frames': shift(track), 'tracks': [shift(track)], 'faces': [], 'faces_found': 0, 'anchor': 'face', 'baked': True, 'from': src_id})
json.dump(meta2, open(os.path.join(OUT, out_id + '.json'), 'w'))
Image.fromarray(head).resize((160, 160)).save(os.path.join(OUT, out_id + '_face0.jpg'), quality=88) if head.shape[2] == 3 else Image.fromarray(head).convert('RGB').resize((160, 160)).save(os.path.join(OUT, out_id + '_face0.jpg'), quality=88)
if '--no-names' not in sys.argv:   # the server registers the clip itself (it knows whose set it is)
    names[out_id] = {'he': (LABEL or (nm.get('he', src_id) + ' · פנים אמיתיות')), 'kind': 'clip', 'pos': nm.get('pos', 'center'), 'size': nm.get('size', 0.6), 'bottom': nm.get('bottom', 0.22), 'from': src_id}
    json.dump(names, open(names_f, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('DONE', out_id, NW, NH, 'frames', n, flush=True)
