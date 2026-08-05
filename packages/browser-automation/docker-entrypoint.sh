#!/bin/sh
set -e

# `docker restart`/`restart: unless-stopped` reuse this container's writable
# layer, so a lock Xvfb left behind from a previous crash survives into the
# next boot: Xvfb refuses to bind ":99" ("Server is already active for
# display 99"), Chromium then has no display to launch against, and every
# browser task fails until someone recreates the container from scratch.
# Nothing else can legitimately hold display 99 at container start, so this
# is always safe to clear.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99

# One persistent virtual display shared by Chromium and the VNC bridge, so noVNC
# shows the real running session during manual Cloudflare recovery.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
x11vnc -display :99 -forever -shared -localhost -rfbport 5900 -nopw -quiet &
websockify --web=/usr/share/novnc 6080 localhost:5900 &

export DISPLAY=:99
exec node dist/index.cjs
