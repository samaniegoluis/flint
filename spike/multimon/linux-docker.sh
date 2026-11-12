#!/usr/bin/env bash
# Throwaway spike (milestone 38): the multi-monitor spike on Linux, inside linux-check's
# image, under Xorg's dummy driver with two RandR outputs laid out as the owner's pair:
# a portrait 1080x1920 on the left and a landscape 2560x1440 to its right, 235 px lower.
# (Xvfb cannot: its one "screen" monitor cannot be split or removed.)
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
docker run --rm --user root -v "$root/spike/multimon:/spike:ro" flint-linux-check bash -c '
  set -e
  apt-get update -qq >/dev/null 2>&1; apt-get install -y -qq xserver-xorg-core xserver-xorg-video-dummy x11-xserver-utils >/dev/null 2>&1
  Xorg :78 -noreset -config /spike/xorg-dummy.conf -logfile /tmp/xorg.log >/dev/null 2>&1 &
  sleep 3
  chmod 777 /tmp/.X11-unix/X78 || true
  mkdir -p /home/flint/mm && cp -r /spike/. /home/flint/mm && rm -rf /home/flint/mm/build /home/flint/mm/.cfire && chown -R flint /home/flint/mm
  runuser -u flint -- env HOME=/home/flint bash -c "
    set -e; cd ~/mm; export DISPLAY=:78
    xrandr --newmode P 173.00 1080 1168 1288 1496 1920 1923 1933 1943 -hsync +vsync 2>/dev/null || true
    xrandr --newmode L 312.25 2560 2752 3024 3488 1440 1443 1448 1493 -hsync +vsync 2>/dev/null || true
    xrandr --addmode DUMMY0 P; xrandr --addmode DUMMY1 L
    xrandr --fb 3640x1920 --output DUMMY0 --mode P --pos 0x0 --output DUMMY1 --mode L --pos 1080x235 --primary
    xrandr --listmonitors
    ./run.sh build 2>&1 | tail -1
    SPIKE_AUTO=0,1 timeout 70 dbus-run-session -- ./build/flint-multimon-spike 2>&1 | grep -E \"^spike:|CRITICAL\" | grep -v pong | head -80 || true
  "
'
