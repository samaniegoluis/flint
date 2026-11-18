#!/usr/bin/env bash
# A throwaway SSH lab for checking the Windows flint CLI by hand (interactive
# `connect` needs a person at a real Windows terminal).
#
#   windows/ssh-lab.sh start   # sshd x2 in WSL + relay + a vault in %TEMP%\flint-lab
#   windows/ssh-lab.sh stop
#
# Same setup as cli-smoke.sh: two sshd on 127.0.0.2:2222/2223 with their own keys and
# config in a temp dir, and ssh-relay.ps1 carrying Windows' 127.0.0.1:2322 to the
# first. The vault (master password `master-pass-1`) has the user key `tkey`, host
# `local` (host key already trusted) and host `inner` behind `local` (not trusted
# yet, so it asks). Never touches the system sshd or ~/.ssh. Run outside any sandbox.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
state="${XDG_RUNTIME_DIR:-/tmp}/flint-ssh-lab"
RELAY_PORT="${FLINT_WIN_RELAY_PORT:-2322}"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-lab"

stop() {
  for f in "$state"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; done
  powershell.exe -NoProfile -c "Get-NetTCPConnection -LocalPort $RELAY_PORT -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1 || true
  rm -rf "$state"
}

case "${1:-}" in
  stop) stop; echo "ssh lab stopped"; exit 0 ;;
  start) ;;
  *) echo "usage: $0 start|stop" >&2; exit 2 ;;
esac

stop
mkdir -p "$state"
ssh-keygen -q -t ed25519 -N '' -f "$state/host_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$state/host2_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$state/user_ed25519"
cp "$state/user_ed25519.pub" "$state/authorized_keys"; chmod 600 "$state/authorized_keys"
for n in 1 2; do
  hk="$state/host_ed25519"; [ $n = 2 ] && hk="$state/host2_ed25519"
  cat > "$state/sshd$n.conf" <<CFG
Port $((2221 + n))
ListenAddress 127.0.0.2
HostKey $hk
AuthorizedKeysFile $state/authorized_keys
PidFile $state/sshd$n.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitTTY yes
Subsystem sftp internal-sftp
AllowTcpForwarding yes
CFG
  setsid /usr/sbin/sshd -f "$state/sshd$n.conf" -E "$state/sshd$n.log"
  for _ in $(seq 1 50); do [[ -s "$state/sshd$n.pid" ]] && break; sleep 0.1; done
done
setsid nohup powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/ssh-relay.ps1")" \
  -Port "$RELAY_PORT" -TargetHost 127.0.0.2 -Target 2222 -Distro "$WSL_DISTRO_NAME" > "$state/relay.log" 2>&1 &
for _ in $(seq 1 100); do grep -q '^relay:' "$state/relay.log" 2>/dev/null && break; sleep 0.1; done
grep -q '^relay:' "$state/relay.log" || { echo "relay did not start"; cat "$state/relay.log"; exit 1; }

rm -rf "$WIN_TMP"; mkdir -p "$WIN_TMP/cfg"
cp "$here/../build/flint.exe" "$state/user_ed25519" "$WIN_TMP/"
cd "$WIN_TMP"
W="$(wslpath -w "$WIN_TMP")"
export FLINT_CONFIG_DIR="$W\\cfg" WSLENV=FLINT_CONFIG_DIR
M='master-pass-1'
run() { printf '%s\n' "$M" | ./flint.exe --master-stdin "$@" >/dev/null; }
printf '%s\n%s\n' "$M" "$M" | ./flint.exe --master-stdin vault create "$W\\lab.flint" --name lab >/dev/null
run key add tkey --file "$W\\user_ed25519"
run host add local --hostname 127.0.0.1 --port "$RELAY_PORT" --user "$USER" --key tkey
run host add inner --hostname 127.0.0.2 --port 2223 --user "$USER" --key tkey --jump local
run host test local --accept-new-host-key
echo "ssh lab up: relay 127.0.0.1:$RELAY_PORT, vault $W\\lab.flint (master password $M)"
echo "stop it with: windows/ssh-lab.sh stop"
