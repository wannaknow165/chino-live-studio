# Resident helper for opp_detect.py: loads OpenCV + rembg + the face models ONCE and keeps them in memory,
# so each frame of an opponent's live is analysed in ~1s instead of ~8s (the "lock on his face" step).
# Started automatically by opp_detect.py the first time it finds no worker; one per machine (port 7791).
# Exits by itself after 6 hours without work. Nothing here talks to the internet.
import sys, os, io, json, socket, runpy, contextlib, threading, time
HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, 'opp_detect.py')
PORT = 7791
os.environ['ARIEL_OD_WORKER'] = '1'          # opp_detect.py runs its full code here (no client hop)
srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
if hasattr(socket, 'SO_EXCLUSIVEADDRUSE'): srv.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
try: srv.bind(('127.0.0.1', PORT))
except OSError: sys.exit(0)                  # another worker already serves
srv.listen(16)
# warm up the heavy imports now, so even the first request is fast
import numpy, cv2                            # noqa: E401
from PIL import Image                        # noqa: F401
try:
    import builtins
    from rembg import new_session
    builtins._ariel_u2net = new_session('u2net_human_seg')
except Exception: pass
LOCK = threading.Lock(); last = [time.time()]
def handle(conn):
    with conn:
        conn.settimeout(30); data = b''
        while not data.endswith(b'\n'):
            ch = conn.recv(65536)
            if not ch: return
            data += ch
        req = json.loads(data.decode('utf-8')); out, err = io.StringIO(), io.StringIO(); code = 0
        with LOCK:
            old_argv, old_cwd = sys.argv, os.getcwd()
            try:
                sys.argv = [SCRIPT] + list(req.get('argv') or [])
                if req.get('cwd') and os.path.isdir(req['cwd']): os.chdir(req['cwd'])
                with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                    try: runpy.run_path(SCRIPT, run_name='__main__')
                    except SystemExit as e: code = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
            except Exception as e: err.write(repr(e)); code = 1
            finally: sys.argv = old_argv; os.chdir(old_cwd); last[0] = time.time()
        conn.settimeout(60); conn.sendall((json.dumps({'out': out.getvalue(), 'err': err.getvalue()[-3000:], 'code': code}) + '\n').encode('utf-8'))
def idle_exit():
    while True:
        time.sleep(300)
        if time.time() - last[0] > 6 * 3600: os._exit(0)
threading.Thread(target=idle_exit, daemon=True).start()
while True:
    try: c, _ = srv.accept()
    except OSError: time.sleep(0.2); continue
    threading.Thread(target=handle, args=(c,), daemon=True).start()
