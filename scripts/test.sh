#!/usr/bin/env bash
# Runs every cfire test suite in src/ against a throwaway sshd on 127.0.0.1.
#
#   scripts/test.sh            # all suites
#   scripts/test.sh src/adapters/ssh
#
# The sshd uses its own host key, user key and config in a temp dir, listens only on
# loopback, accepts only that user key, and is killed on exit. No root, no changes
# to the system sshd or ~/.ssh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${1:-src}"
port="${FLINT_TEST_SSH_PORT:-2222}"
sshd_bin="$(command -v sshd || echo /usr/sbin/sshd)"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-sshd.XXXXXX")"
cleanup() {
  if [[ -f "$tmp/sshd.pid" ]]; then kill "$(cat "$tmp/sshd.pid")" 2>/dev/null || true; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N '' -f "$tmp/host_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/user_ed25519"
cp "$tmp/user_ed25519.pub" "$tmp/authorized_keys"
chmod 600 "$tmp/authorized_keys"
cat > "$tmp/sshd_config" <<CFG
Port $port
ListenAddress 127.0.0.1
HostKey $tmp/host_ed25519
AuthorizedKeysFile $tmp/authorized_keys
PidFile $tmp/sshd.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitTTY yes
CFG

"$sshd_bin" -f "$tmp/sshd_config" -E "$tmp/sshd.log"
for _ in $(seq 1 50); do [[ -s "$tmp/sshd.pid" ]] && break; sleep 0.1; done
[[ -s "$tmp/sshd.pid" ]] || { echo "test.sh: sshd did not start" >&2; cat "$tmp/sshd.log" >&2; exit 1; }

export FLINT_TEST_SSH_PORT="$port"
export FLINT_TEST_SSH_KEY="$tmp/user_ed25519"
export USER="${USER:-$(id -un)}"

cd "$root"
cfire test "$target"
