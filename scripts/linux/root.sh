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
exec runuser -u flint -- env HOME=/home/flint \
  FLINT_RDP_BLACKHOLE="${FLINT_RDP_BLACKHOLE:-}" FLINT_RDP_TEST_HOST="${FLINT_RDP_TEST_HOST:-}" FLINT_RDP_TEST_USER="${FLINT_RDP_TEST_USER:-}" FLINT_RDP_TEST_PASSWORD="${FLINT_RDP_TEST_PASSWORD:-}" \
  FLINT_TEST_PW_PORT=2230 FLINT_TEST_KBD_PORT=2231 FLINT_TEST_LOGIN_PW=flint-e2e-login-pw FLINT_E2E_SUDO=1 \
  bash /src/scripts/linux/inside.sh
