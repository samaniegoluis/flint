#!/usr/bin/env bash
# Headless end-to-end run of the desktop app on macOS: builds it, then drives the
# real UI (scripts/gui-e2e.js) in a hidden WKWebView against the throwaway sshds of
# scripts/test.sh: create a vault, add a key and hosts, trust a host key, type in
# the terminal, reconnect, a jump host, a changed host key behind a TCP forwarder,
# the palette, settings, lock and unlock.
#
#   scripts/gui-e2e.sh
#
# Linux: cfire's headless WebView runner is a no-op there (CF-029), so the real GTK
# window opens under xvfb-run instead.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  FLINT_TEST_CMD="$root/scripts/gui-e2e.sh" exec "$root/scripts/test.sh"
fi
cd "$root"

"$root/scripts/build-gui.sh" >/dev/null
if [[ "$(uname -s)" == Darwin ]]; then
  app=(build/gui/Flint.app/Contents/MacOS/Flint)
else
  app=(timeout 300 xvfb-run -a build/gui/Flint)
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-gui-e2e.XXXXXX")"
fwd_pid=""
cleanup() { if [[ -n "$fwd_pid" ]]; then kill "$fwd_pid" 2>/dev/null; wait "$fwd_pid" 2>/dev/null || true; fi; rm -rf "$tmp"; }
trap cleanup EXIT

# A TCP forwarder whose first connection reaches sshd 1 and every later one sshd 2:
# one address, two host keys.
port3="${FLINT_TEST_SSH_PORT3:-2224}"
cat > "$tmp/fwd.py" <<'PY'
import socket, sys, threading
listen, first, later = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", listen)); srv.listen(8)
def pipe(a, b):
    try:
        while True:
            d = a.recv(65536)
            if not d: break
            b.sendall(d)
    except OSError: pass
    for s in (a, b):
        try: s.shutdown(socket.SHUT_RDWR)
        except OSError: pass
n = 0
while True:
    c, _ = srv.accept()
    u = socket.create_connection(("127.0.0.1", first if n == 0 else later))
    n += 1
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
PY
python3 -I "$tmp/fwd.py" "$port3" "$FLINT_TEST_SSH_PORT" "$FLINT_TEST_SSH_PORT2" & fwd_pid=$!
sleep 0.5

E2E_VAULT="$tmp/e2e.flint" E2E_PORT3="$port3" python3 -I - "$root/scripts/gui-e2e.js" "$tmp/e2e.js" <<'PY'
import os, sys
src = open(sys.argv[1]).read()
key = open(os.environ["FLINT_TEST_SSH_KEY"]).read().replace("\\", "\\\\").replace("`", "\\`")
values = {"VAULT": os.environ["E2E_VAULT"], "PORT": os.environ["FLINT_TEST_SSH_PORT"],
          "PORT2": os.environ["FLINT_TEST_SSH_PORT2"], "PORT3": os.environ["E2E_PORT3"],
          "USER": os.environ["USER"], "KEY": key}
for k, v in values.items():
    src = src.replace("@@" + k + "@@", v)
open(sys.argv[2], "w").write(src)
PY

status=0
FLINT_CONFIG_DIR="$tmp/config" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$tmp/e2e.js" \
  "${app[@]}" 2>&1 | tee "$tmp/run.log" || status=$?
if ! grep -q '^e2e: pass' "$tmp/run.log"; then
  echo "gui-e2e: FAILED" >&2
  exit 1
fi
# Principle 5: nothing from inside the vault is readable in the file.
for marker in local pwhost e2e-key gui-host-pw-marker 127.0.0.1 "SQLite format 3"; do
  if grep -aq -- "$marker" "$tmp/e2e.flint"; then
    echo "gui-e2e: the vault file contains '$marker' in clear" >&2
    exit 1
  fi
done
echo "gui-e2e: the vault file holds no clear-text host data"
# D-030: the layout state holds ids only, never a name from inside the vault.
ui_state="$tmp/config/ui-state.json"
[[ -f "$ui_state" ]] || { echo "gui-e2e: no ui-state.json was written" >&2; exit 1; }
for marker in e2e-grp local pwhost "E2E Renamed"; do
  if grep -aq -- "$marker" "$ui_state"; then
    echo "gui-e2e: ui-state.json contains '$marker'" >&2
    exit 1
  fi
done
grep -q '"E2E Renamed"' "$tmp/config/vaults.json" || { echo "gui-e2e: the rename did not reach vaults.json" >&2; exit 1; }
echo "gui-e2e: ui-state.json holds ids only; vaults.json has the new name"
exit "$status"
