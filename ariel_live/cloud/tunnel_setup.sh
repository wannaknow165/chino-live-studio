#!/bin/bash
# her phone's HTTPS link — run ONLY after Shahak approves exposing /phone publicly (the server guards everything else)
set -e
if [ ! -x /usr/local/bin/cloudflared ]; then
  curl -fsSL -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  dpkg -i /tmp/cloudflared.deb
  [ -x /usr/local/bin/cloudflared ] || ln -sf "$(command -v cloudflared)" /usr/local/bin/cloudflared
fi
cp /opt/ariel-effects/app/cloud/ariel-tunnel.service /etc/systemd/system/
systemctl daemon-reload; systemctl enable ariel-tunnel >/dev/null; systemctl restart ariel-tunnel
sleep 8; grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' /opt/ariel-effects/tunnel.log | tail -1
