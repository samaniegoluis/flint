#!/usr/bin/env bash
# Runs every cfire test suite in src/ against a throwaway sshd on 127.0.0.1.
#
#   scripts/test.sh            # every suite in src/
#   scripts/test.sh src/adapters/ssh
#
# The sshd uses its own host key, user key and config in a temp dir, listens only on
# loopback, accepts only that user key, and is killed on exit. No root, no changes
# to the system sshd or ~/.ssh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -gt 0 ]]; then targets=("$@"); else targets=(src); fi
port="${FLINT_TEST_SSH_PORT:-2222}"
port2="${FLINT_TEST_SSH_PORT2:-2223}"
sshd_bin="$(command -v sshd || echo /usr/sbin/sshd)"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-sshd.XXXXXX")"
cleanup() {
  for f in "$tmp"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null; done
  [[ -n "${SSH_AGENT_PID:-}" ]] && kill "$SSH_AGENT_PID" 2>/dev/null
  rm -rf "$tmp"
}
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N '' -f "$tmp/host_ed25519"
# A second host key type on the first server, for the host key preference test.
ssh-keygen -q -t ecdsa -b 256 -N '' -f "$tmp/host_ecdsa"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/user_ed25519"
cp "$tmp/user_ed25519.pub" "$tmp/authorized_keys"
chmod 600 "$tmp/authorized_keys"
# Two servers: the second has its own host key and stands in for a host reached
# through the first as a jump host.
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host2_ed25519"
write_config() {  # <name> <port> <host key> [<more host keys>...]
  cat > "$tmp/$1_config" <<CFG
Port $2
ListenAddress 127.0.0.1
$(for k in "${@:3}"; do echo "HostKey $k"; done)
AuthorizedKeysFile $tmp/authorized_keys
PidFile $tmp/$1.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitTTY yes
AllowTcpForwarding yes
CFG
}
write_config sshd "$port" "$tmp/host_ed25519" "$tmp/host_ecdsa"
write_config sshd2 "$port2" "$tmp/host2_ed25519"

for name in sshd sshd2; do
  "$sshd_bin" -f "$tmp/${name}_config" -E "$tmp/$name.log"
  for _ in $(seq 1 50); do [[ -s "$tmp/$name.pid" ]] && break; sleep 0.1; done
  [[ -s "$tmp/$name.pid" ]] || { echo "test.sh: $name did not start" >&2; cat "$tmp/$name.log" >&2; exit 1; }
done

# A throwaway agent holding the user key, for the agent auth tests.
eval "$(ssh-agent -s -a "$tmp/agent.sock")" >/dev/null
ssh-add -q "$tmp/user_ed25519" 2>/dev/null
export FLINT_TEST_AGENT=1

export FLINT_TEST_SSH_PORT="$port"
export FLINT_TEST_SSH_PORT2="$port2"
export FLINT_TEST_SSH_KEY="$tmp/user_ed25519"
export USER="${USER:-$(id -un)}"

cd "$root"
. "$root/scripts/env.sh"
# FLINT_TEST_CMD runs one command against the sshd instead of the cfire suites.
if [[ -n "${FLINT_TEST_CMD:-}" ]]; then
  bash -c "$FLINT_TEST_CMD"
  exit $?
fi
status=0
for t in "${targets[@]}"; do
  cfire test "$t" || status=1
done
exit "$status"
