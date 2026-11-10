# Image → video through OpenRouter's video API (one key, many engines: Veo / Grok Imagine / HeyGen / Wan / Seedance…). Pay per clip, nothing left running.
# usage: py -3.13 or_video.py <first_frame.jpg|png> <out id> <model> [seconds=5] [resolution=720p] [--audio] [--aspect=9:16] [--prompt=...]
# prints ONE json line: {"video": <data/ovsrc/out.mp4>, "cost": usd, "model": ..., "secs": wall seconds} or {"error": ...}
import sys, os, json, base64, time, urllib.request, urllib.error
args = [a for a in sys.argv[1:] if not a.startswith('--')]
img, out_id, model = args[0], args[1], args[2]
dur = int(args[3]) if len(args) > 3 else 5
res = args[4] if len(args) > 4 else '720p'
opt = lambda k, d=None: next((a.split('=', 1)[1] for a in sys.argv if a.startswith('--' + k + '=')), d)
audio = '--audio' in sys.argv
aspect = opt('aspect', '9:16')
prompt = opt('prompt', 'The chubby baby sitting on the plain green background cries hard: the face crumples, mouth wide open wailing, big tears, the baby kicks its legs and waves its little arms, then sobs. '
         'Keep the exact same face, head, cap and glasses as in the image in every frame. Static camera, the flat bright green background stays unchanged, no other objects, no text.')
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
KEY = json.load(open(os.path.join(ROOT, 'data', 'settings.json'), encoding='utf-8')).get('openrouterKey', '')
if not KEY: print(json.dumps({'error': 'no openrouterKey'})); sys.exit(0)
H = {'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:7777', 'X-Title': 'Chino Live'}
def call(url, body=None, raw=False, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=H, method='POST' if body is not None else 'GET')
    with urllib.request.urlopen(req, timeout=timeout) as r: d = r.read()
    return d if raw else json.loads(d)
mime = 'image/png' if img.lower().endswith('.png') else 'image/jpeg'
body = {'model': model, 'prompt': prompt, 'duration': dur, 'resolution': res, 'aspect_ratio': aspect, 'generate_audio': audio,
        'frame_images': [{'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,' + base64.b64encode(open(img, 'rb').read()).decode()}, 'frame_type': 'first_frame'}]}
last_frame = opt('last-frame')
if last_frame:
    last_mime = 'image/png' if last_frame.lower().endswith('.png') else 'image/jpeg'
    body['frame_images'].append({'type': 'image_url', 'image_url': {'url': 'data:' + last_mime + ';base64,' + base64.b64encode(open(last_frame, 'rb').read()).decode()}, 'frame_type': 'last_frame'})
state_file = opt('job-state-file')
def persist_state(status, **fields):
    if not state_file: return
    existing = json.load(open(state_file, encoding='utf-8')) if os.path.exists(state_file) else {}
    existing.update({'state': status, 'updated': time.time(), **fields})
    with open(state_file + '.tmp', 'w', encoding='utf-8') as f: json.dump(existing, f, indent=2)
    os.replace(state_file + '.tmp', state_file)

t0 = time.time()
try: job = call('https://openrouter.ai/api/v1/videos', body)
except urllib.error.HTTPError as e: print(json.dumps({'error': f'HTTP {e.code}: ' + e.read().decode('utf-8', 'replace')[:500], 'model': model})); sys.exit(0)
jid = job.get('id'); st = job
if jid: persist_state('submitted', providerJobId=jid, model=model)
if not jid: print(json.dumps({'error': 'no job id: ' + json.dumps(job)[:300], 'model': model})); sys.exit(0)
while st.get('status') not in ('completed', 'failed', 'cancelled', 'expired'):
    if time.time() - t0 > 900: print(json.dumps({'error': 'timeout', 'model': model, 'id': jid})); sys.exit(0)
    persist_state(st.get('status', 'pending'), providerJobId=jid)
    time.sleep(6)
    try: st = call(f'https://openrouter.ai/api/v1/videos/{jid}')
    except Exception as e: st = {'status': 'pending', 'err': str(e)}
if st.get('status') != 'completed': print(json.dumps({'error': f"{st.get('status')}: {str(st.get('error'))[:400]}", 'model': model, 'id': jid})); sys.exit(0)
os.makedirs(os.path.join(ROOT, 'data', 'ovsrc'), exist_ok=True); dst = os.path.join(ROOT, 'data', 'ovsrc', out_id + '.mp4')
open(dst, 'wb').write(call(f'https://openrouter.ai/api/v1/videos/{jid}/content?index=0', raw=True, timeout=300))
cost = float(((st.get('usage') or {}).get('cost')) or 0)
persist_state('completed', providerJobId=jid, video=dst, costUSD=cost)
print(json.dumps({'video': dst, 'cost': cost, 'model': model, 'id': jid, 'secs': round(time.time() - t0)}), flush=True)
