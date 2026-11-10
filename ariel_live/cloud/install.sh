#!/bin/bash
# one-box install on the Hetzner machine: /opt/ariel-effects  (run as root; package tar at /tmp/ariel_pkg.tgz)
set -e
B=/opt/ariel-effects
NODE=/opt/boostera-effects/runtime/node/bin/node
mkdir -p $B/app $B/bin $B/browsers
echo "== unpack"; tar xzf /tmp/ariel_pkg.tgz -C $B/app
cp $B/app/cloud/py $B/bin/py; chmod +x $B/bin/py $B/app/tools/*.py
mkdir -p $B/app/data $B/app/media/overlays $B/app/media/thumbs $B/app/media/rejected $B/app/media/faces $B/app/data/heads $B/app/data/avatars $B/app/data/ovsrc
echo "== python venv"
[ -x $B/venv/bin/python ] || python3 -m venv $B/venv
$B/venv/bin/pip install -q --upgrade pip
$B/venv/bin/pip install -q opencv-python-headless numpy pillow imageio-ffmpeg playwright requests onnxruntime rembg
echo "== chromium for the camera box"
PLAYWRIGHT_BROWSERS_PATH=$B/browsers $B/venv/bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=$B/browsers $B/venv/bin/playwright install-deps chromium 2>/dev/null || true
echo "== node $($NODE -v)"
echo "== service"
cp $B/app/cloud/ariel-effects.service /etc/systemd/system/ariel-effects.service
systemctl daemon-reload; systemctl enable ariel-effects >/dev/null; systemctl restart ariel-effects
sleep 2; systemctl --no-pager --lines=5 status ariel-effects | head -12
curl -s -o /dev/null -w "desk http: %{http_code}\n" http://127.0.0.1:7777/
echo "== nginx sites"; ls /etc/nginx/sites-enabled/ 2>/dev/null; grep -h server_name /etc/nginx/sites-enabled/* 2>/dev/null | sort -u
echo "done. desk: http://127.0.0.1:7777/  (tunnel: ssh -L 7777:127.0.0.1:7777)"
