#!/usr/bin/env bash
# Headless end-to-end run of the desktop app on macOS: builds it, then drives the
# real UI (scripts/gui-e2e.js) in a hidden WKWebView against the throwaway sshds of
# scripts/test.sh: create a vault, add a key and hosts, trust a host key, type in
# the terminal, reconnect, a jump host, a changed host key behind a TCP forwarder,
# the palette, settings, lock and unlock.
#
#   scripts/gui-e2e.sh
#
# Linux: the real GTK window opens under xvfb-run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  FLINT_TEST_CMD="$root/scripts/gui-e2e.sh" exec "$root/scripts/test.sh"
fi
cd "$root"

"$root/scripts/build-gui.sh" >/dev/null
# The vim step runs in a run of its own, after the main one, so a freeze in it (macOS,
# ROADMAP "gui-e2e on macOS sometimes ends with an empty e2e: line") fails that run by
# name while the main run still reports. It fails under Xvfb on Linux (ROADMAP, "gui-e2e's
# vim step"), so there it runs only when FLINT_E2E_VIM=1 asks for it.
#   FLINT_E2E_ONLY=vim scripts/gui-e2e.sh   runs only the vim run, to repeat it in seconds
# Exit status: 0 both passed, 1 the main run failed, 3 only the vim run failed.
if [[ "$(uname -s)" == Darwin ]]; then
  app=(build/gui/Flint.app/Contents/MacOS/Flint)
  run_vim=1
else
  app=(timeout 300 xvfb-run -a build/gui/Flint)
  run_vim="${FLINT_E2E_VIM:-0}"
fi
only="${FLINT_E2E_ONLY:-}"
[[ -z "$only" || "$only" == vim ]] || { echo "gui-e2e: FLINT_E2E_ONLY takes only 'vim'" >&2; exit 2; }
[[ "$only" != vim ]] || run_vim=1

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

# The Tether vault for the import step, written by Tether's own code.
cp "$root/src/adapters/vault/testdata/tether-v5.tether" "$tmp/old.tether"
mkdir -p /tmp/flint-tether-fixture && cp "$root/src/adapters/vault/testdata/tether-legacy-ed25519" /tmp/flint-tether-fixture/id_legacy

# Writes the page script for one run: $1 vault file, $2 '1' for the vim run, $3 output.
make_script() {
  E2E_VAULT="$1" E2E_PORT3="$port3" E2E_TETHER="$tmp/old.tether" E2E_VIM="$2" python3 -I - "$root/scripts/gui-e2e.js" "$3" <<'PY'
import os, sys
src = open(sys.argv[1]).read()
key = open(os.environ["FLINT_TEST_SSH_KEY"]).read().replace("\\", "\\\\").replace("`", "\\`")
values = {"VAULT": os.environ["E2E_VAULT"], "PORT": os.environ["FLINT_TEST_SSH_PORT"],
          "PORT2": os.environ["FLINT_TEST_SSH_PORT2"], "PORT3": os.environ["E2E_PORT3"],
          "USER": os.environ["USER"], "KEY": key, "TETHER": os.environ["E2E_TETHER"],
          "VIM": os.environ["E2E_VIM"]}
for k, v in values.items():
    src = src.replace("@@" + k + "@@", v)
open(sys.argv[2], "w").write(src)
PY
}

# Runs the app once on a page script: $1 the run's name, $2 its script, $3 its config
# folder, $4 its log, $5 its cap in ms on macOS (empty: the app's 240 s). Fails when the
# page did not report a pass. A run killed before it printed a verdict (Linux's timeout)
# is named with the last line the page logged.
run_app() {
  local st=0
  FLINT_CONFIG_DIR="$3" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$2" FLINT_GUI_E2E_TIMEOUT_MS="${5:-}" \
    "${app[@]}" 2>&1 | tee "$4" || st=$?
  if ! grep -q '^e2e: ' "$4"; then
    echo "e2e: fail: killed with no verdict (exit $st); last page line: $(grep '\[page\]' "$4" | tail -1 | sed 's/^.*\[page\] //')"
  fi
  if ! grep -q '^e2e: pass' "$4"; then
    echo "gui-e2e ($1): FAILED" >&2
    return 1
  fi
}

failed=()
if [[ "$only" != vim ]]; then
  make_script "$tmp/e2e.flint" 0 "$tmp/e2e.js"
  run_app main "$tmp/e2e.js" "$tmp/config" "$tmp/run.log" || failed+=(main)
fi
if [[ "$run_vim" == 1 ]]; then
  make_script "$tmp/vim.flint" 1 "$tmp/vim.js"
  # It passes in under 30 s; a freeze then costs a minute, not four.
  run_app vim "$tmp/vim.js" "$tmp/config-vim" "$tmp/vim.log" 60000 || failed+=(vim)
else
  echo "gui-e2e: skip the vim run (it fails under Xvfb; FLINT_E2E_VIM=1 runs it)"
fi
# Exit 1: the main run failed. Exit 3: only the vim run did, so a report can tell the
# known vim freeze (ROADMAP) from a new failure. Either way the run is not a pass.
if [[ " ${failed[*]} " == *" main "* ]]; then
  echo "gui-e2e: FAILED: ${failed[*]}" >&2
  exit 1
fi
if [[ "$only" == vim ]]; then
  [[ ${#failed[@]} -eq 0 ]] || { echo "gui-e2e: FAILED: vim" >&2; exit 3; }
  echo "gui-e2e: the vim run passed"
  exit 0
fi
# Principle 5: nothing from inside the vault is readable in the file.
for marker in local pwhost e2e-key gui-host-pw-marker 127.0.0.1 codebox.lan "Code Box" pw-codebox "SQLite format 3"; do
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
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "gui-e2e: the main run passed; FAILED: vim" >&2
  exit 3
fi
echo "gui-e2e: pass"
