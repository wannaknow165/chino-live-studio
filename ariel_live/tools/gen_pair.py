# The Turkish boxer vs. the opponent: build ONE start image (both of them on a green screen) and let RunPod (wan i2v)
# generate the video from it — the opponent's real face is animated, not pasted.
# usage: py -3.13 gen_pair.py <boxer overlay id> <opponent green.jpg> <out id> [seconds=5] [--dry]  (prints JSON)
import sys, os, json, base64, time, subprocess, io, urllib.request
import numpy as np, cv2
from PIL import Image
import imageio_ffmpeg
boxer_id, opp_green, out_id = sys.argv[1], sys.argv[2], sys.argv[3]
DUR = int(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4].isdigit() else 5
DRY = '--dry' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..'))
FF = imageio_ffmpeg.get_ffmpeg_exe()
settings = json.load(open(os.path.join(ROOT, 'data', 'settings.json'), encoding='utf-8'))
KEY = settings.get('runpodKey', '')

def key_green(rgb):
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV); m = cv2.inRange(hsv, (35, 70, 60), (90, 255, 255))
    a = 255 - cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); a = cv2.GaussianBlur(a, (3, 3), 0)
    f = rgb.astype(np.int16); g = f[:, :, 1]; lim = np.maximum(f[:, :, 0], f[:, :, 2]); f[:, :, 1] = np.minimum(g, lim + 10)
    return np.dstack([np.clip(f, 0, 255).astype(np.uint8), a])
def trim(rgba):
    ys, xs = np.nonzero(rgba[:, :, 3] > 40); return rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]

# the boxer: frame ~1s of his transparent WebM
meta = json.load(open(os.path.join(ROOT, 'media', 'overlays', boxer_id + '.json')))
W, H = meta['w'], meta['h']
raw = subprocess.run([FF, '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', '1', '-i', os.path.join(ROOT, 'media', 'overlays', boxer_id + '.webm'), '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-'], capture_output=True).stdout
boxer = trim(np.frombuffer(raw[:W * H * 4], np.uint8).reshape(H, W, 4).copy())
def runpod(slug, inp):
    req = urllib.request.Request(f'https://api.runpod.ai/v2/{slug}/runsync', data=json.dumps({'input': inp}).encode(), headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=600))
    while r.get('status') in ('IN_QUEUE', 'IN_PROGRESS'):
        time.sleep(4); r = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.runpod.ai/v2/{slug}/status/{r["id"]}', headers={'Authorization': 'Bearer ' + KEY}), timeout=120))
    if r.get('status') != 'COMPLETED': raise RuntimeError(f'runpod {r.get("status")}: {str(r.get("error") or r.get("output"))[:300]}')
    return r
cost = 0.0
# the opponent: his cut-out on green → a FULL-BODY version of the same person (head to toe, same face), so the character stands whole
opp_rgb = np.array(Image.open(opp_green).convert('RGB'))
if not DRY and KEY and '--full' in sys.argv:    # optional: a full-body (legs) version — the default is the opponent exactly as he is seen in his live
    b64 = 'data:image/jpeg;base64,' + base64.b64encode(open(opp_green, 'rb').read()).decode()
    ed = runpod('qwen-image-edit', {'prompt': 'Show this exact same person as a complete full-body standing figure from head to toe, facing the camera: identical face, identical hairstyle, identical skin tone and identical clothing, with matching trousers and shoes added below, natural relaxed standing pose, arms at the sides, photorealistic, the whole body fully inside the frame, on a perfectly flat evenly lit pure bright green chroma-key background (#00FF00), nothing else, no text', 'image': b64, 'negative_prompt': 'cropped, cut off, half body, different face, cartoon, text, watermark, extra people, shadow on background', 'output_format': 'png', 'seed': -1})
    url = ed['output'].get('result'); cost += float(ed['output'].get('cost', 0) or 0)
    full = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).convert('RGB')
    full.save(os.path.join(ROOT, 'media', 'rejected', out_id + '_full.jpg'), quality=92)
    opp_rgb = np.array(full)
    # his REAL head (cut from the live frame) goes back on the generated full body, so the face in the video is really his
    if '--head' in sys.argv:
        head_png = sys.argv[sys.argv.index('--head') + 1]
        import tempfile, shutil
        mp = os.path.join(HERE, 'yunet.onnx'); tmpm = os.path.join(tempfile.gettempdir(), 'yunet_ariel.onnx')
        if os.path.exists(mp) and os.path.exists(head_png):
            shutil.copyfile(mp, tmpm); h, w = opp_rgb.shape[:2]
            det = cv2.FaceDetectorYN.create(tmpm, '', (w, h), 0.5); _, d = det.detect(cv2.cvtColor(opp_rgb, cv2.COLOR_RGB2BGR))
            if d is not None and len(d):
                r = max(d, key=lambda q: q[2] * q[3]); fx, fy, fw, fh = r[:4]; S = int(max(fw, fh) * 1.5 * 1.08)
                cx, cy = fx + fw / 2, fy + fh / 2 - 0.08 * S
                hd = np.array(Image.open(head_png).convert('RGBA').resize((S, S), Image.LANCZOS)).astype(np.float32)
                x0, y0 = int(cx - S / 2), int(cy - S / 2); sx0, sy0, sx1, sy1 = max(0, x0), max(0, y0), min(w, x0 + S), min(h, y0 + S)
                if sx1 > sx0 and sy1 > sy0:
                    hp = hd[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0]; a = hp[:, :, 3:4] / 255.
                    base = opp_rgb.astype(np.float32); base[sy0:sy1, sx0:sx1] = hp[:, :, :3] * a + base[sy0:sy1, sx0:sx1] * (1 - a); opp_rgb = np.clip(base, 0, 255).astype(np.uint8)
                    Image.fromarray(opp_rgb).save(os.path.join(ROOT, 'media', 'rejected', out_id + '_full.jpg'), quality=92)
    if '--fullonly' in sys.argv: print(json.dumps({'full': os.path.join(ROOT, 'media', 'rejected', out_id + '_full.jpg'), 'cost': round(cost, 3)})); sys.exit(0)
opp = trim(key_green(opp_rgb))
BABY = boxer_id == 'ov_baby'
if BABY:
    # his head sits on the baby's neck: the track in ov_baby.json gives the neck hole (normalized to the clip's crop)
    tr = (meta.get('tracks') or [meta.get('frames', [])])[0]; i = min(len(tr) - 1, 24); ncx, ncy, ns = tr[i]
    body = np.frombuffer(raw[:W * H * 4], np.uint8).reshape(H, W, 4).copy()      # the baby frame, untrimmed (track coords are in it)
    hp = sys.argv[sys.argv.index('--head') + 1] if '--head' in sys.argv else ''
    if hp and os.path.exists(hp):
        S = int(ns * W * 1.35); cx = int(ncx * W); cy = int(ncy * H - S * 0.40)
        hd = np.array(Image.open(hp).convert('RGBA').resize((S, S), Image.LANCZOS)).astype(np.float32)
        pad = S; canvasB = np.zeros((H + pad, W + 2 * pad, 4), np.float32); canvasB[pad:pad + H, pad:pad + W] = body
        x0, y0 = cx + pad - S // 2, cy + pad - S // 2; dst = canvasB[y0:y0 + S, x0:x0 + S]; a = hd[:, :, 3:4] / 255.
        dst[:, :, :3] = hd[:, :, :3] * a + dst[:, :, :3] * (1 - a); dst[:, :, 3:4] = np.maximum(dst[:, :, 3:4], hd[:, :, 3:4]); canvasB[y0:y0 + S, x0:x0 + S] = dst
        body = np.clip(canvasB, 0, 255).astype(np.uint8)
    opp = trim(body)

GW, GH = 720, 1280
canvas = Image.new('RGBA', (GW, GH), (0, 255, 0, 255))
def put(rgba, height, cx, bottom):
    im = Image.fromarray(rgba, 'RGBA'); k = height / im.height; im = im.resize((max(2, int(im.width * k)), int(height)), Image.LANCZOS)
    canvas.alpha_composite(im, (int(cx - im.width / 2), int(bottom - im.height)))
# the 3 punch sets: where the boxer stands and what he does
SETS = {
  'boxer1': dict(h=600, cx=240, bottom=1272, motion='furiously throws fast, hard boxing punches straight into the face of the person on the right, one after another'),
  'boxer2': dict(h=600, cx=240, bottom=1272, motion='bounces on his feet warming up, shadow-boxing, then suddenly turns and unloads a flurry of hard punches into the face of the person on the right'),
  'boxer3': dict(h=620, cx=250, bottom=1280, motion='winds up slowly, then throws one gigantic slow-motion uppercut straight into the face of the person on the right, then keeps hammering'),
}
ST = SETS.get(boxer_id, SETS['boxer1'])
if BABY: put(opp, 820, 360, 1250)                                                 # the baby with his head, alone, centred
elif '--full' in sys.argv: put(opp, 980, 470, 1225); put(boxer, 620, 225, 1225)   # full body: both on the same floor
else: put(opp, 760, 470, 1280); put(boxer, ST['h'], ST['cx'], ST['bottom'])    # the real captured part, big, standing on the bottom edge; boxer in front, fist at face height
still = os.path.join(ROOT, 'media', 'rejected', out_id + '_start.jpg')
canvas.convert('RGB').save(still, quality=92)

prompt = ("A chubby baby in a white diaper sits on the floor on a flat, evenly lit, pure green chroma-key background and cries hard: the face crumples, "
          "eyes squeeze shut, mouth wide open wailing, big tears stream down, the baby kicks its legs and waves its little arms, then sobs; the baby keeps exactly the same face, hair and head; "
          "static camera, the baby stays fully inside the frame, the green background stays flat and unchanged, no other objects, no text.") if BABY else ("Two people on a flat, evenly lit, pure green chroma-key background. The short stocky man in the black tracksuit on the left "
          + ST['motion'] + ". "
          "With every punch the person's head snaps back violently, they scream in pain, their face crumples and they start crying with big tears, "
          "cartoon-exaggerated comedy; the short man keeps punching with full energy and finishes with a huge uppercut that sends the person's head flying back. "
          "The camera never moves, never zooms and never cuts: one wide static shot from start to end, both stay fully inside the frame the whole time, the person on the right keeps their exact face, hair and clothes, "
          "the green background stays flat and unchanged, no other objects, no text.")
if DRY: print(json.dumps({'still': still, 'dry': True})); sys.exit(0)
ORM = next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--or=')), '')
if ORM:   # OpenRouter video (one key — HeyGen / Veo / Grok …) instead of RunPod. Shahak: "short and cheap", "8-9 cents, 4-5 seconds, no more"
    def or_run(model):
        if 'grok' in model: secs, res = 4, '480p'       # 2¢/s + 1¢ image = 9¢, ~20-30s
        elif 'veo' in model: secs, res = 4, '720p'      # 3¢/s = 12¢, ~55s
        elif 'heygen' in model: secs, res = 5, '768p'   # 9¢ but zooms into the face on punches
        else: secs, res = 5, '720p'
        cmd = [sys.executable, '-u', os.path.join(HERE, 'or_video.py'), still, out_id, model, str(secs), res, '--aspect=9:16', '--prompt=' + prompt] + (['--audio'] if 'heygen' in model else [])
        pr = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
        lines = [l for l in (pr.stdout or '').splitlines() if l.strip().startswith('{')]
        return json.loads(lines[-1]) if lines else {'error': (pr.stderr or 'no output')[-300:]}
    used = ORM; j = or_run(ORM)
    if j.get('error') and 'veo' not in ORM:   # the cheap engine refused / failed → Veo Lite, proven on punches, so he still gets his clip
        print('[gen_pair] ' + ORM + ' failed: ' + str(j['error'])[:200] + ' → veo', file=sys.stderr, flush=True)
        j2 = or_run('google/veo-3.1-lite')
        if not j2.get('error'): j, used = j2, 'google/veo-3.1-lite'
    if j.get('error'): print(json.dumps({'error': 'OpenRouter: ' + str(j['error'])[:300]})); sys.exit(0)
    print(json.dumps({'still': still, 'video': j['video'], 'cost': round(cost + float(j.get('cost') or 0), 3), 'url': '', 'engine': used, 'full': os.path.exists(os.path.join(ROOT, 'media', 'rejected', out_id + '_full.jpg'))}), flush=True)
    sys.exit(0)
if not KEY: print(json.dumps({'error': 'no runpodKey'})); sys.exit(1)

b64 = 'data:image/jpeg;base64,' + base64.b64encode(open(still, 'rb').read()).decode()
inp = {'prompt': prompt, 'image': b64, 'num_inference_steps': 30, 'guidance': 5, 'size': '720*1280', 'duration': DUR, 'seed': -1,
       'negative_prompt': 'text, watermark, logo, extra people, furniture, background objects, blurry, camera movement'}
try: r = runpod('wan-2-2-i2v-720', inp)
except RuntimeError as e:
    if 'size' in str(e).lower(): inp.pop('size'); r = runpod('wan-2-2-i2v-720', inp)
    else: raise
url = r['output'].get('result'); cost += float(r['output'].get('cost', 0) or 0)
os.makedirs(os.path.join(ROOT, 'data', 'ovsrc'), exist_ok=True)
dst = os.path.join(ROOT, 'data', 'ovsrc', out_id + '.mp4')
open(dst, 'wb').write(urllib.request.urlopen(url, timeout=300).read())
print(json.dumps({'still': still, 'video': dst, 'cost': round(cost, 3), 'url': url, 'full': os.path.exists(os.path.join(ROOT, 'media', 'rejected', out_id + '_full.jpg'))}), flush=True)
