import sys, os, json, subprocess, numpy as np, cv2
from PIL import Image
from rembg import remove, new_session
src, name = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'media', 'overlays'); os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(HERE, '..', 'data', 'ovtmp')
W, H = 960, 540
sess = new_session('u2net_human_seg')
import imageio_ffmpeg
FF = imageio_ffmpeg.get_ffmpeg_exe()
p = subprocess.Popen([FF,'-v','error','-c:v','libvpx-vp9','-i',src,'-vf',f'scale={W}:{H},format=rgb24','-f','rawvideo','-'], stdout=subprocess.PIPE)
frames, masks = [], []
prev = None
import tempfile, shutil
_m = os.path.join(tempfile.gettempdir(), 'yunet_ariel.onnx'); shutil.copyfile(os.path.join(HERE, 'yunet.onnx'), _m)   # OpenCV can't open non-ASCII paths
det = cv2.FaceDetectorYN.create(_m, '', (W, H), 0.6)
faces = []
while True:
    buf = p.stdout.read(W*H*3)
    if len(buf) < W*H*3: break
    f = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
    m = np.array(remove(Image.fromarray(f), session=sess, only_mask=True, post_process_mask=False), np.float32) / 255.
    m[int(H*0.88):, int(W*0.82):] = 0          # KlingAI watermark corner
    if prev is not None: m = 0.65*m + 0.35*prev
    prev = m
    frames.append(f); masks.append(m)
    _, d = det.detect(cv2.cvtColor(f, cv2.COLOR_RGB2BGR))
    faces.append(max(d[:, :4].tolist(), key=lambda r: r[2]*r[3]) if d is not None and len(d) else None)
    if len(frames) % 40 == 0: print(name, len(frames), flush=True)
n = len(frames)
# crop box = union of mask
ys, xs = np.nonzero(np.max(np.stack(masks), 0) > 0.4)
x0, x1 = max(0, xs.min()-12), min(W, xs.max()+12); y0, y1 = max(0, ys.min()-12), min(H, ys.max()+12)
cw, ch = (x1-x0)//2*2, (y1-y0)//2*2
# face track: fill gaps + smooth
idx = [i for i, r in enumerate(faces) if r]
tr = []
for i in range(n):
    if faces[i]: r = faces[i]
    else:
        a = max([j for j in idx if j < i], default=None); b = min([j for j in idx if j > i], default=None)
        r = faces[a] if b is None else faces[b] if a is None else [faces[a][k] + (faces[b][k]-faces[a][k])*(i-a)/(b-a) for k in range(4)]
    tr.append([r[0]+r[2]/2, r[1]+r[3]/2, max(r[2], r[3])])
tr = np.array(tr, np.float32)
for k in range(1, n): tr[k] = 0.6*tr[k] + 0.4*tr[k-1]
track = [[round(float((cx-x0)/cw),4), round(float((cy-y0)/ch),4), round(float(s/cw),4)] for cx, cy, s in tr]
os.makedirs(f'{TMP}/{name}', exist_ok=True)
for i, (f, m) in enumerate(zip(frames, masks)):
    a = (np.clip(m, 0, 1)*255).astype(np.uint8)
    rgba = np.dstack([f, a])[y0:y0+ch, x0:x0+cw]
    Image.fromarray(rgba, 'RGBA').save(f'{TMP}/{name}/{i:04d}.png')
subprocess.run([FF,'-v','error','-y','-framerate','24','-i',f'{TMP}/{name}/%04d.png','-c:v','libvpx-vp9','-pix_fmt','yuva420p','-b:v','2500k','-auto-alt-ref','0','-row-mt','1',f'{OUT}/{name}.webm'], check=True)
json.dump({'fps': 24, 'w': cw, 'h': ch, 'frames': track, 'faces_found': len(idx), 'n': n}, open(f'{OUT}/{name}.json', 'w'))
print('DONE', name, cw, ch, 'faces', len(idx), '/', n, flush=True)
