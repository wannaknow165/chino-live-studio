# ARIEL virtual camera: captures the stage window (even when covered) and sends it to "OBS Virtual Camera".
# Keeps running: if the stage window closes, it waits for it / reopens it.
import ctypes, time, os, sys, subprocess, argparse, json, numpy as np, cv2, pyvirtualcam
from ctypes import wintypes
from windows_capture import WindowsCapture, Frame, InternalCaptureControl
W, H = 1080, 1920
HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = r'C:\Program Files\Google\Chrome\Application\chrome.exe'
PROFILE = os.path.join(HERE, '..', 'data', 'chrome_stage')
parser=argparse.ArgumentParser()
parser.add_argument('--title',default='ARIEL STAGE')
parser.add_argument('--url',default='http://localhost:7777/stage?vcam=1')
parser.add_argument('--profile',default=PROFILE)
parser.add_argument('--require-frame-border',action='store_true')
parser.add_argument('--status-file')
args=parser.parse_args()
PROFILE=args.profile
u32 = ctypes.windll.user32

def find_title(prefix=args.title):
    found = []
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def cb(h, l):
        n = u32.GetWindowTextLengthW(h)
        if n and u32.IsWindowVisible(h):
            b = ctypes.create_unicode_buffer(n + 1); u32.GetWindowTextW(h, b, n + 1)
            if b.value.startswith(prefix): found.append(b.value)
        return True
    u32.EnumWindows(cb, 0)
    return found[0] if found else None

def open_stage():
    subprocess.Popen([CHROME, '--user-data-dir=' + PROFILE, '--app='+args.url, '--window-size=560,1010',
                      '--autoplay-policy=no-user-gesture-required', '--disable-features=CalculateNativeWinOcclusion',
                      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--no-first-run'])

def find_box(f):
    b, g, r = f[:, :, 0].astype(np.int16), f[:, :, 1].astype(np.int16), f[:, :, 2].astype(np.int16)
    m = (r > 220) & (b > 220) & (g < 60)
    ys, xs = np.nonzero(m)
    if len(xs) < 50: return None
    return xs.min() + 6, ys.min() + 6, xs.max() - 5, ys.max() - 5

st = {'f': None, 'closed': True, 'box': None, 'boxT': 0, 'frameAt': 0}
sent_frames = 0
def report(state):
    if not args.status_file: return
    target = args.status_file
    try:
        with open(target + '.tmp', 'w', encoding='utf-8') as out:
            json.dump({'pid': os.getpid(), 'state': state, 'updatedAt': int(time.time()*1000), 'frames': sent_frames, 'width': W, 'height': H, 'fps': 30, 'device': 'OBS Virtual Camera'}, out)
        os.replace(target + '.tmp', target)
    except OSError: pass
def start_capture():
    t0 = time.time(); opened = False
    while True:
        title = find_title()
        if title: break
        if not opened and time.time() - t0 > 1.5: open_stage(); opened = True; print('opening stage window', flush=True)
        time.sleep(1)
    time.sleep(1.5)   # let the page load
    title = find_title()
    st.update(f=None, closed=False, box=None, frameAt=0)
    cap = WindowsCapture(cursor_capture=False, draw_border=False, window_name=title)
    @cap.event
    def on_frame_arrived(frame: Frame, ctl: InternalCaptureControl):
        st['f'] = frame.frame_buffer
        st['frameAt'] = time.monotonic()
    @cap.event
    def on_closed():
        st['closed'] = True
    cap.start_free_threaded()
    print('capturing:', title, flush=True)

with pyvirtualcam.Camera(width=W, height=H, fps=30, backend='obs') as cam:
    print('virtual camera:', cam.device, flush=True)
    black = np.zeros((H, W, 3), np.uint8)
    last_report = 0
    while True:
        if st['closed']:
            cam.send(black)
            report('waiting_for_window')
            try: start_capture()
            except Exception as e: print('capture error:', e, flush=True); time.sleep(2)
            continue
        f = st['f']
        ready = False
        if f is not None and time.monotonic() - st['frameAt'] < 2:
            f = np.array(f, copy=True)
            if args.require_frame_border or st['box'] is None or time.time() - st['boxT'] > 2:
                bx = find_box(f)
                st['box'] = bx
                st['boxT'] = time.time()
            if st['box']:
                x0, y0, x1, y1 = st['box']; crop = f[y0:y1, x0:x1, :3]
            elif not args.require_frame_border:
                h, w = f.shape[:2]; tw = min(w, int(h * 9 / 16)); x0 = (w - tw) // 2; crop = f[:, x0:x0 + tw, :3]
            else:
                crop = None
            ready = crop is not None and crop.size > 0
            cam.send(cv2.cvtColor(cv2.resize(crop, (W, H), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB) if ready else black)
            if ready: sent_frames += 1
        else:
            cam.send(black)
        if time.monotonic() - last_report > 1:
            report('streaming' if ready else 'waiting_for_frame')
            last_report = time.monotonic()
        cam.sleep_until_next_frame()
