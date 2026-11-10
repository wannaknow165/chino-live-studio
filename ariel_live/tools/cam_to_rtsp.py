#!/usr/bin/env python3
"""
📱 cam_to_rtsp — renders the /cam page (her phone camera + every effect layer) in a headless
Chromium and pushes it as a live video stream into the cloud phone's camera (mediamtx RTSP).

    py cam_to_rtsp.py [--url http://127.0.0.1:7777/cam] [--rtsp rtsp://user:pass@127.0.0.1:8554/boostera/client001/camera]
                      [--w 720 --h 1280 --fps 24] [--creds /opt/boostera-effects/current/data/media/credentials.json]

Without --rtsp the target is built from the credentials file (clients.client001.app) + --path.
Frames come from CDP Page.screencast (JPEG) → ffmpeg (libx264 zerolatency) → RTSP publish.
Prints one JSON line per state change so the server can show "🟢 משדר לטלפון" on the desk.
"""
import argparse, asyncio, base64, json, os, shutil, signal, subprocess, sys, time

def say(**k): print(json.dumps(k, ensure_ascii=False), flush=True)

def ffmpeg_exe():
    for c in ('ffmpeg', '/usr/bin/ffmpeg'):
        if shutil.which(c): return c
    try:
        import imageio_ffmpeg; return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception: return 'ffmpeg'

def rtsp_from_creds(path_creds, client, path_name):
    c = json.load(open(path_creds))['clients'][client]
    app = c.get('app') or c
    user = app.get('user') or app.get('username') or f'{client}-app'
    pw = app.get('pass') or app.get('password') or app.get('secret') or ''
    return f'rtsp://{user}:{pw}@127.0.0.1:8554/boostera/{client}/{path_name}'

def svc(action, name):
    if not name or sys.platform.startswith('win'): return
    try: subprocess.run(['systemctl', action, name], timeout=20, capture_output=True)
    except Exception: pass

async def main(a):
    from playwright.async_api import async_playwright
    rtsp = a.rtsp or rtsp_from_creds(a.creds, a.client, a.path)
    safe = rtsp.split('@')[-1]
    ff = [ffmpeg_exe(), '-hide_banner', '-loglevel', 'warning', '-nostdin',
          '-f', 'image2pipe', '-framerate', str(a.fps), '-c:v', 'mjpeg', '-i', '-',
          '-vf', f'scale={a.w}:{a.h},format=yuv420p', '-r', str(a.fps),
          '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-g', str(a.fps * 2), '-bf', '0',
          '-b:v', a.bitrate, '-maxrate', a.bitrate, '-bufsize', a.bitrate,
          *(['-y', '-f', 'mp4', rtsp[5:]] if rtsp.startswith('file:') else ['-f', 'rtsp', '-rtsp_transport', 'tcp', rtsp])]   # file:x.mp4 = local test
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=[
            '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--disable-features=WebRtcHideLocalIpsWithMdns',
            '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars',
            f'--window-size={a.w},{a.h}'])
        ctx = await browser.new_context(viewport={'width': a.w, 'height': a.h}, device_scale_factor=1, ignore_https_errors=True)
        page = await ctx.new_page()
        await page.goto(a.url, wait_until='domcontentloaded')
        cdp = await ctx.new_cdp_session(page)
        # no need to stop Codex's placeholder: mediamtx overrides the publisher and his test source yields (Restart=no) by design
        proc = subprocess.Popen(ff, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        say(state='starting', target=safe, size=f'{a.w}x{a.h}', fps=a.fps)
        last = {'t': time.time(), 'n': 0, 'frame': None}
        stop = asyncio.Event()

        def on_frame(ev):
            try:
                last['frame'] = base64.b64decode(ev['data']); last['n'] += 1
                asyncio.get_event_loop().create_task(cdp.send('Page.screencastFrameAck', {'sessionId': ev['sessionId']}))
            except Exception: pass
        cdp.on('Page.screencastFrame', on_frame)
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': a.quality, 'maxWidth': a.w, 'maxHeight': a.h, 'everyNthFrame': 1})

        def on_sig(*_): stop.set()
        for s in (signal.SIGINT, signal.SIGTERM):
            try: asyncio.get_event_loop().add_signal_handler(s, on_sig)
            except Exception: pass

        # constant-rate writer: repeats the last frame when the page is idle (a static picture still has to stream)
        period = 1.0 / a.fps; nxt = time.time(); sent = 0; announced = False
        while not stop.is_set():
            now = time.time()
            if now < nxt: await asyncio.sleep(min(period, nxt - now)); continue
            nxt += period
            if nxt < now - 1: nxt = now
            fr = last['frame']
            if fr is None: continue
            try: proc.stdin.write(fr); sent += 1
            except (BrokenPipeError, OSError):
                err = proc.stderr.read().decode(errors='ignore')[-800:] if proc.stderr else ''
                say(state='error', error='ffmpeg exited: ' + err.strip()); break
            if not announced and sent > a.fps:
                announced = True; say(state='live', target=safe)
            if sent % (a.fps * 30) == 0: say(state='tick', frames=sent, captured=last['n'])
        try: await cdp.send('Page.stopScreencast')
        except Exception: pass
        try: proc.stdin.close()
        except Exception: pass
        try: proc.wait(timeout=6)          # let ffmpeg flush (file test needs the moov atom)
        except Exception:
            try: proc.terminate(); proc.wait(timeout=3)
            except Exception:
                try: proc.kill()
                except Exception: pass
        await browser.close()
        svc('start', a.restore)      # give the camera path back to the placeholder so the phone is never black
        say(state='stopped', frames=sent)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:7777/cam')
    ap.add_argument('--rtsp', default=os.environ.get('ARIEL_RTSP', ''))
    ap.add_argument('--creds', default='/opt/boostera-effects/current/data/media/credentials.json')
    ap.add_argument('--client', default='client001')
    ap.add_argument('--path', default='camera')
    ap.add_argument('--w', type=int, default=720); ap.add_argument('--h', type=int, default=1280)
    ap.add_argument('--fps', type=int, default=24); ap.add_argument('--quality', type=int, default=80)
    ap.add_argument('--bitrate', default='2500k')
    ap.add_argument('--restore', default='boostera-effects-source.service', help='placeholder service to start again when we stop ("" = none)')
    a = ap.parse_args()
    try: asyncio.run(main(a))
    except KeyboardInterrupt: pass
    except Exception as e: say(state='error', error=str(e)); sys.exit(1)
