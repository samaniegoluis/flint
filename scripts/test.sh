#!/usr/bin/env bash
# Runs every cfire test suite in src/ against a throwaway sshd on 127.0.0.1.
#
#   scripts/test.sh            # every suite in src/, then scripts/release-test.sh
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
  # The run's own status, kept through the cleanup.
  local st=$?
  for f in "$tmp"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null; done
  # `|| true`: under set -e, the stopped server's status would end the cleanup here.
  [[ -n "${rdp_pid:-}" ]] && { kill "$rdp_pid" 2>/dev/null; wait "$rdp_pid" 2>/dev/null || true; }
  [[ -n "${clip_pid:-}" ]] && { kill "$clip_pid" 2>/dev/null; wait "$clip_pid" 2>/dev/null || true; }
  [[ -n "${vault_pid:-}" ]] && { kill "$vault_pid" 2>/dev/null; wait "$vault_pid" 2>/dev/null || true; }
  [[ -n "${SSH_AGENT_PID:-}" ]] && kill "$SSH_AGENT_PID" 2>/dev/null
  rm -rf "$tmp"
  exit "$st"
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
Subsystem sftp internal-sftp
AllowTcpForwarding yes
${sudo_env:-}
CFG
}
# `exec --sudo` (milestone 13): on macOS the sessions find a stand-in `sudo` first on
# their PATH, which behaves like sudo -S -p for the password FLINT_E2E_SUDO_PW (the
# e2e user's password in the Linux image, where the real sudo runs). It answers
# "not in the sudoers file" when the file not-a-sudoer exists next to it.
if [[ "$(uname -s)" == Darwin ]]; then
  mkdir -p "$tmp/fakebin"
  cat > "$tmp/fakebin/sudo" <<'SUDO'
#!/bin/bash
prompt="Password:"
while [[ $# -gt 0 ]]; do
  case "$1" in
    -S|-k) shift ;;
    -p) prompt="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
here="$(cd "$(dirname "$0")" && pwd)"
if [[ -f "$here/not-a-sudoer" ]]; then
  printf '%s' "$prompt" >&2
  IFS= read -r pw
  echo "$USER is not in the sudoers file.  This incident will be reported." >&2
  exit 1
fi
if [[ ! -f "$here/no-password" ]]; then
  for attempt in 1 2 3; do
    printf '%s' "$prompt" >&2
    if ! IFS= read -r pw; then echo "sudo: no password was provided" >&2; exit 1; fi
    [[ "$pw" == "flint-e2e-login-pw" ]] && break
    echo "Sorry, try again." >&2
    [[ $attempt == 3 ]] && { echo "sudo: 3 incorrect password attempts" >&2; exit 1; }
  done
fi
export FAKE_SUDO_ROOT=1
exec "$@"
SUDO
  chmod 755 "$tmp/fakebin/sudo"
  export FLINT_FAKE_SUDO_DIR="$tmp/fakebin"
  sudo_env="SetEnv PATH=$tmp/fakebin:/usr/bin:/bin:/usr/sbin:/sbin"
fi
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

# FreeRDP's sample server, for the RDP adapter's tests (milestone 30): loopback only
# by its firewall-free port, a throwaway self-signed certificate, any user. Skipped
# (the tests pass without it) where FreeRDP ships no sample server.
rdp_port="${FLINT_TEST_RDP_PORT:-33891}"
if command -v sfreerdp-server >/dev/null; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/rdp.key" -out "$tmp/rdp.crt" -days 2 -subj "/CN=flint-test" 2>/dev/null
  # FreeRDP 3.15's sample server closes every session unless a test_icon.* sits in its
  # working folder (the Linux image installs one; Homebrew's 3.33 needs none).
  icons="$(dirname "$(command -v sfreerdp-server)")/../share/sfreerdp-server"
  [[ -d "$icons" ]] && cp "$icons"/test_icon.* "$tmp"/ 2>/dev/null || true
  (cd "$tmp" && WLOG_LEVEL=OFF exec sfreerdp-server --cert="$tmp/rdp.crt" --key="$tmp/rdp.key" --port="$rdp_port" >"$tmp/rdp.log" 2>&1) &
  rdp_pid=$!
  for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$rdp_port") 2>/dev/null && break; sleep 0.1; done
  export FLINT_RDP_SAMPLE_PORT="$rdp_port"
fi

# Flint's own RDP test server (milestone 31): the clipboard, the keys sent, a drop.
# Skipped (the tests pass without it) where FreeRDP's server library is missing.
clip_port="${FLINT_TEST_RDP_CLIP_PORT:-33893}"
clip_ctl="${FLINT_TEST_RDP_CLIP_CONTROL:-33894}"
if clip_bin="$("$root/scripts/rdp-testserver.sh")"; then
  [[ -f "$tmp/rdp.crt" ]] || openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/rdp.key" -out "$tmp/rdp.crt" -days 2 -subj "/CN=flint-test" 2>/dev/null
  "$clip_bin" --port="$clip_port" --control="$clip_ctl" --cert="$tmp/rdp.crt" --key="$tmp/rdp.key" >"$tmp/rdp-clip.log" 2>&1 &
  clip_pid=$!
  for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$clip_port") 2>/dev/null && break; sleep 0.1; done
  export FLINT_RDP_CLIP_PORT="$clip_port" FLINT_RDP_CLIP_CONTROL="$clip_ctl"
fi

# flint-vault-server on loopback (milestone 43), for the remote vault adapter's tests:
# its own data folder and token, killed on exit.
vault_port="${FLINT_TEST_VAULT_PORT:-38787}"
(cd "$root" && source scripts/env.sh >/dev/null && cfire build flint-vault-server >/dev/null)
vault_token="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
mkdir -p "$tmp/vault-data"
FLINT_VAULT_TOKEN="$vault_token" FLINT_VAULT_DATA="$tmp/vault-data" FLINT_VAULT_LISTEN="127.0.0.1:$vault_port" \
  "$root/build/flint-vault-server" >"$tmp/vault-server.log" 2>&1 &
vault_pid=$!
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$vault_port") 2>/dev/null && break; sleep 0.1; done
export FLINT_TEST_VAULT_URL="http://127.0.0.1:$vault_port" FLINT_TEST_VAULT_TOKEN="$vault_token" FLINT_TEST_VAULT_DATA="$tmp/vault-data"

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
# The release script and cliff.toml (milestone 32), with the whole run only.
if [[ $# -eq 0 ]]; then
  "$root/scripts/release-test.sh" || status=1
fi
exit "$status"
