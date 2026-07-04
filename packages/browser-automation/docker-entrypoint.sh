#!/bin/sh
set -e

# One persistent virtual display shared by Chromium and the VNC bridge, so noVNC
# shows the real running session during manual Cloudflare recovery.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -nopw -quiet &
websockify --web=/usr/share/novnc 6080 localhost:5900 &

export DISPLAY=:99
exec node dist/index.cjs
