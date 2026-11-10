# One $0.02 picture per opponent: HIS real head, crying. Used live — the moment a punch lands, his live head is swapped for it.
# usage: py -3.13 cry_face.py <head.png (RGBA, from opp_detect)> <out.png> [prompt override]
import sys, os, json, base64, time, io, urllib.request
import numpy as np, cv2
from PIL import Image
head_png, out_png = sys.argv[1], sys.argv[2]
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
KEY = json.load(open(os.path.join(ROOT, 'data', 'settings.json'), encoding='utf-8')).get('runpodKey', '')
if not KEY: print(json.dumps({'error': 'no runpodKey'})); sys.exit(1)

def runpod(slug, inp):
    req = urllib.request.Request(f'https://api.runpod.ai/v2/{slug}/runsync', data=json.dumps({'input': inp}).encode(), headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    r = json.load(urllib.request.urlopen(req, timeout=600))
    while r.get('status') in ('IN_QUEUE', 'IN_PROGRESS'):
        time.sleep(3); r = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.runpod.ai/v2/{slug}/status/{r["id"]}', headers={'Authorization': 'Bearer ' + KEY}), timeout=120))
    if r.get('status') != 'COMPLETED': raise RuntimeError(f'runpod {r.get("status")}: {str(r.get("error") or r.get("output"))[:300]}')
    return r

# the head on a flat green square (so the result comes back keyable), 768px
h = Image.open(head_png).convert('RGBA').resize((768, 768), Image.LANCZOS)
g = Image.new('RGBA', (768, 768), (0, 255, 0, 255)); g.alpha_composite(h)
buf = io.BytesIO(); g.convert('RGB').save(buf, 'JPEG', quality=94)
prompt = sys.argv[3] if len(sys.argv) > 3 else ('This exact same person, identical face, identical hairstyle, identical skin tone, same camera angle and framing, '
    'but now crying hard after being punched: eyes squeezed shut, eyebrows raised in pain, mouth wide open wailing, big tears streaming down both cheeks, '
    'red nose, cartoon-exaggerated but photorealistic. Keep the head exactly where it is, same size. Pure flat bright green chroma-key background, nothing else, no text.')
r = runpod('qwen-image-edit', {'prompt': prompt, 'image': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(),
                              'negative_prompt': 'different person, different face, smiling, text, watermark, extra people, shadow on background', 'output_format': 'png', 'seed': -1})
url = r['output'].get('result'); cost = float(r['output'].get('cost', 0) or 0)
im = np.array(Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).convert('RGB'))
# key the green back out → RGBA head
hsv = cv2.cvtColor(im, cv2.COLOR_RGB2HSV); m = cv2.inRange(hsv, (35, 60, 50), (90, 255, 255)) | cv2.inRange(hsv, (38, 40, 30), (88, 255, 255))
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)); m = cv2.dilate(m, np.ones((3, 3), np.uint8))
a = cv2.GaussianBlur(255 - m, (3, 3), 0)
f = im.astype(np.int16); lim = (f[:, :, 0] + f[:, :, 2]) // 2; f[:, :, 1] = np.minimum(f[:, :, 1], np.maximum(lim + 6, np.maximum(f[:, :, 0], f[:, :, 2]) - 4)); im = np.clip(f, 0, 255).astype(np.uint8)
# soften with the original head's silhouette so the swap matches the live head's outline
orig_a = np.array(h.split()[3].resize((im.shape[1], im.shape[0]), Image.LANCZOS)).astype(np.float32) / 255.
a = (a.astype(np.float32) / 255. * np.clip(orig_a * 1.6, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([im, a]), 'RGBA').save(out_png)
print(json.dumps({'out': out_png, 'cost': cost, 'url': url}), flush=True)
