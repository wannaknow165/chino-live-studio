# 👶 HIGH-QUALITY baby: Kling v2.6 Motion Control (RunPod public endpoint, pay per clip, nothing left running).
# The image = HIS head already baked on the baby body (his real face, crying) on a flat green screen;
# the video = a crying-baby motion reference. Kling moves the image like the reference → his face really cries and moves.
# usage: py -3.13 kling_motion.py <baked overlay id OR image.jpg> <motion.mp4> <out id> [--dry]   (prints one JSON line)
import sys, os, json, base64, time, subprocess, urllib.request
import numpy as np
from PIL import Image
import imageio_ffmpeg
src, motion, out_id = sys.argv[1], sys.argv[2], sys.argv[3]
DRY = '--dry' in sys.argv
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '..'))
FF = imageio_ffmpeg.get_ffmpeg_exe()
KEY = json.load(open(os.path.join(ROOT, 'data', 'settings.json'), encoding='utf-8')).get('runpodKey', '')
SLUG = 'kling-v2-6-std-motion-control'

def still_from_overlay(oid, t=0.5):   # one frame of a transparent overlay → centred on a 720x1280 pure-green canvas
    meta = json.load(open(os.path.join(ROOT, 'media', 'overlays', oid + '.json'))); W, H = meta['w'], meta['h']
    raw = subprocess.run([FF, '-v', 'error', '-c:v', 'libvpx-vp9', '-ss', str(t), '-i', os.path.join(ROOT, 'media', 'overlays', oid + '.webm'), '-vf', 'format=rgba', '-frames:v', '1', '-f', 'rawvideo', '-'], capture_output=True).stdout
    fr = np.frombuffer(raw[:W * H * 4], np.uint8).reshape(H, W, 4)
    ys, xs = np.nonzero(fr[:, :, 3] > 40); fr = fr[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    im = Image.fromarray(fr.copy(), 'RGBA'); k = min(660 / im.width, 1000 / im.height); im = im.resize((int(im.width * k), int(im.height * k)), Image.LANCZOS)
    cv = Image.new('RGBA', (720, 1280), (0, 255, 0, 255)); cv.alpha_composite(im, ((720 - im.width) // 2, 1240 - im.height))
    out = os.path.join(ROOT, 'media', 'rejected', out_id + '_kling_in.jpg'); cv.convert('RGB').save(out, quality=93); return out

img = src if os.path.exists(src) else still_from_overlay(src)
def data_url(p, mime): return f'data:{mime};base64,' + base64.b64encode(open(p, 'rb').read()).decode()
if DRY: print(json.dumps({'image': img, 'dry': True})); sys.exit(0)
if not KEY: print(json.dumps({'error': 'no runpodKey'})); sys.exit(1)
inp = {'image': data_url(img, 'image/jpeg'), 'video': data_url(motion, 'video/mp4'), 'character_orientation': 'video',
       'prompt': 'The baby sitting on the green screen cries hard like the reference: face crumples, mouth wide open wailing, tears, kicking legs and waving arms. Keep the exact same face, head, cap and glasses of the character in the image. Static camera, flat pure green background stays unchanged.',
       'negative_prompt': 'different face, face change, baby face, extra people, background objects, text, watermark, camera movement', 'keep_original_sound': False}
req = urllib.request.Request(f'https://api.runpod.ai/v2/{SLUG}/runsync', data=json.dumps({'input': inp}).encode(), headers={'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
try: r = json.load(urllib.request.urlopen(req, timeout=600))
except urllib.error.HTTPError as e: print(json.dumps({'error': f'HTTP {e.code}: ' + e.read().decode('utf-8', 'replace')[:400]})); sys.exit(1)
while r.get('status') in ('IN_QUEUE', 'IN_PROGRESS'):
    time.sleep(5); r = json.load(urllib.request.urlopen(urllib.request.Request(f'https://api.runpod.ai/v2/{SLUG}/status/{r["id"]}', headers={'Authorization': 'Bearer ' + KEY}), timeout=120))
if r.get('status') != 'COMPLETED': print(json.dumps({'error': f'runpod {r.get("status")}: ' + str(r.get('error') or r.get('output'))[:400]})); sys.exit(1)
url = (r.get('output') or {}).get('result'); cost = float((r.get('output') or {}).get('cost', 0) or 0)
if not url: print(json.dumps({'error': 'no video url: ' + json.dumps(r)[:300]})); sys.exit(1)
os.makedirs(os.path.join(ROOT, 'data', 'ovsrc'), exist_ok=True); dst = os.path.join(ROOT, 'data', 'ovsrc', out_id + '.mp4')
open(dst, 'wb').write(urllib.request.urlopen(url, timeout=300).read())
print(json.dumps({'still': img, 'video': dst, 'cost': cost, 'url': url}), flush=True)
