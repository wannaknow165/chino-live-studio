# Image generation/editing through OpenRouter (Nano Banana / Gemini image / GPT image…): text + reference images → one image.
# usage: py -3.13 or_image.py <out.png> <model> --prompt=... [--aspect=9:16] <ref1> [ref2 ...]
# refs may be png/jpg; transparent PNGs are flattened on white. prints ONE json line {"image": out, "cost": usd} or {"error": ...}
import sys, os, json, base64, io, urllib.request, urllib.error
from PIL import Image
args = [a for a in sys.argv[1:] if not a.startswith('--')]
out, model, refs = args[0], args[1], args[2:]
opt = lambda k, d=None: next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--' + k + '=')), d)
prompt = opt('prompt', ''); aspect = opt('aspect', '9:16')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
KEY = json.load(open(os.path.join(ROOT, 'data', 'settings.json'), encoding='utf-8')).get('openrouterKey', '')
if not KEY: print(json.dumps({'error': 'no openrouterKey'})); sys.exit(0)
def as_url(p):
    im = Image.open(p)
    if im.mode in ('RGBA', 'LA', 'P'): im = im.convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im); im = bg
    im = im.convert('RGB'); im.thumbnail((1280, 1280)); b = io.BytesIO(); im.save(b, 'JPEG', quality=92)
    return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()
content = [{'type': 'text', 'text': prompt}] + [{'type': 'image_url', 'image_url': {'url': as_url(r)}} for r in refs]
body = {'model': model, 'messages': [{'role': 'user', 'content': content}], 'modalities': ['image', 'text'], 'image_config': {'aspect_ratio': aspect}, 'usage': {'include': True}}
req = urllib.request.Request('https://openrouter.ai/api/v1/chat/completions', data=json.dumps(body).encode(),
      headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:7777', 'X-Title': 'Chino Live'})
try: j = json.load(urllib.request.urlopen(req, timeout=300))
except urllib.error.HTTPError as e: print(json.dumps({'error': f'HTTP {e.code}: ' + e.read().decode('utf-8', 'replace')[:500]})); sys.exit(0)
msg = ((j.get('choices') or [{}])[0].get('message') or {})
imgs = msg.get('images') or []
url = (imgs[0].get('image_url') or {}).get('url', '') if imgs else ''
if not url.startswith('data:'):
    ch = (j.get('choices') or [{}])[0]
    print(json.dumps({'error': 'no image returned (' + str(ch.get('native_finish_reason') or ch.get('finish_reason') or '?') + '): ' + str(msg.get('content') or j.get('error') or msg.get('refusal') or '')[:400]})); sys.exit(0)
open(out, 'wb').write(base64.b64decode(url.split(',', 1)[1]))
print(json.dumps({'image': out, 'cost': float((j.get('usage') or {}).get('cost') or 0), 'model': model}), flush=True)
