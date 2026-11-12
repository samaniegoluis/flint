#!/usr/bin/env bash
# The root part of scripts/linux-check.sh, run first inside the container. It starts
# two loopback sshds that log the `flint` user in with its password: one with password
# auth (no PAM) and one with keyboard-interactive only (PAM). macOS cannot run these
# without root, so password logins are checked here. Then it hands over to
# inside.sh as `flint`.
set -euo pipefail
d=/tmp/pwsshd
mkdir -p /run/sshd "$d"
ssh-keygen -q -t ed25519 -N "" -f "$d/host"
common="ListenAddress 127.0.0.1
HostKey $d/host
PubkeyAuthentication no
AllowUsers flint"
printf "Port 2230\n%s\nPasswordAuthentication yes\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile %s/a.pid\n" "$common" "$d" > "$d/a.conf"
printf "Port 2231\n%s\nPasswordAuthentication no\nKbdInteractiveAuthentication yes\nUsePAM yes\nPidFile %s/b.pid\n" "$common" "$d" > "$d/b.conf"
/usr/sbin/sshd -f "$d/a.conf" -E "$d/a.log"
/usr/sbin/sshd -f "$d/b.conf" -E "$d/b.log"
# Milestone 38: an X display with two monitors for gui-e2e's multimon run, a portrait
# 1080x1920 on the left and a landscape 2560x1440 to its right, 235 px lower (the
# owner's pair). Xvfb's one screen cannot be split, so Xorg's dummy driver, which needs
# root to start. Left out when the image lacks it.
mm_display=""
if command -v Xorg >/dev/null && [[ -f /usr/lib/xorg/modules/drivers/dummy_drv.so ]]; then
  Xorg :78 -noreset -nolisten tcp -config /src/scripts/linux/xorg-two-monitors.conf -logfile /tmp/xorg-two.log >/dev/null 2>&1 &
  for _ in $(seq 1 50); do [[ -S /tmp/.X11-unix/X78 ]] && break; sleep 0.1; done
  chmod 777 /tmp/.X11-unix/X78 || true
  export DISPLAY=:78
  xrandr --newmode P 173.00 1080 1168 1288 1496 1920 1923 1933 1943 -hsync +vsync 2>/dev/null || true
  xrandr --newmode L 312.25 2560 2752 3024 3488 1440 1443 1448 1493 -hsync +vsync 2>/dev/null || true
  if xrandr --addmode DUMMY0 P && xrandr --addmode DUMMY1 L \
    && xrandr --fb 3640x1920 --output DUMMY0 --mode P --pos 0x0 --output DUMMY1 --mode L --pos 1080x235 --primary; then
    mm_display=:78
  fi
  unset DISPLAY
fi
exec runuser -u flint -- env HOME=/home/flint FLINT_E2E_MULTIMON_DISPLAY="$mm_display" FLINT_E2E_ONLY="${FLINT_E2E_ONLY:-}" FLINT_E2E_VIM="${FLINT_E2E_VIM:-}" \
  FLINT_RDP_BLACKHOLE="${FLINT_RDP_BLACKHOLE:-}" FLINT_RDP_TEST_HOST="${FLINT_RDP_TEST_HOST:-}" FLINT_RDP_TEST_USER="${FLINT_RDP_TEST_USER:-}" FLINT_RDP_TEST_PASSWORD="${FLINT_RDP_TEST_PASSWORD:-}" \
  FLINT_TEST_PW_PORT=2230 FLINT_TEST_KBD_PORT=2231 FLINT_TEST_LOGIN_PW=flint-e2e-login-pw FLINT_E2E_SUDO=1 \
  bash /src/scripts/linux/inside.sh
