#!/usr/bin/env bash
# End-to-end run of the desktop app: builds it, then drives the real UI
# (scripts/gui-e2e.js) in the app's window against the throwaway sshds of
# scripts/test.sh: create a vault, add a key and hosts, trust a host key, type in
# the terminal, reconnect, a jump host, a changed host key behind a TCP forwarder,
# the palette, settings, lock and unlock, tunnels, and an RDP tab against FreeRDP's
# sample server (milestone 30). It runs as several short runs (below).
#
#   scripts/gui-e2e.sh
#
# macOS: the real window opens on screen, and the run types and clicks in it; leave it
# alone until it ends (covered, or on another Space, it is hidden again). Linux: the real
# GTK window opens under xvfb-run.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  FLINT_TEST_CMD="$root/scripts/gui-e2e.sh" exec "$root/scripts/test.sh"
fi
cd "$root"

# FLINT_E2E_NOBUILD=1 uses the app already built (scripts/repeat.sh builds it once).
if [[ "${FLINT_E2E_NOBUILD:-0}" != 1 ]]; then
  "$root/scripts/build-gui.sh" >/dev/null
fi
# The page script (scripts/gui-e2e.js) is split into short runs, each a launch of the app
# on a fresh vault and config folder: terminal, vault, tunnels, paste, then vim, so a
# failure names its run and one run can be repeated alone. vim fails under Xvfb on Linux
# (ROADMAP, "gui-e2e's vim step"), so there it runs only when FLINT_E2E_VIM=1.
#   FLINT_E2E_ONLY=tunnels scripts/gui-e2e.sh    runs only the named runs (comma-separated)
#   FLINT_E2E_WEBGL_COVER=1 FLINT_E2E_ONLY=webgl  a person hides the window (⌘H) for the
#                                                 webgl run's loss, as the window asks
#   FLINT_E2E_NATIVE_FS=1 FLINT_E2E_ONLY=fullscreen  macOS: the fullscreen run asks for the
#                                                system's real full screen (a Space)
#   FLINT_E2E_MAIN_MS=60000 scripts/gui-e2e.sh   caps each run but vim (default: 240 s)
#   FLINT_E2E_VISIBLE=0 scripts/gui-e2e.sh       macOS: cfire's offscreen WebView instead of
#                                                the window. WebKit suspends that page about
#                                                a second after nothing happens in it, so a
#                                                wait that times out there never reports
#                                                (milestone 27, D-068)
#   scripts/repeat.sh vim 10                     one run N times, with its failure rate
# Exit status: 0 all passed, 1 a run failed.
runs=(terminal vault tunnels paste rdp webgl fullscreen vim)
# multimon (milestone 38) needs two monitors: on Linux an X display with two (the check's
# container makes one, FLINT_E2E_MULTIMON_DISPLAY), on macOS a person's own screens with
# FLINT_E2E_MULTIMON=1 (its windows take a Space on each).
# rdpbench (milestone 34) is scripts/rdp-bench.sh's: a real Windows host, named only.
known=("${runs[@]}" multimon rdpbench)
if [[ -n "${FLINT_E2E_MULTIMON_DISPLAY:-}" || "${FLINT_E2E_MULTIMON:-}" == 1 ]]; then runs+=(multimon); fi
if [[ "$(uname -s)" == Darwin ]]; then
  app=(build/gui/Flint.app/Contents/MacOS/Flint)
  run_vim=1
else
  app=(timeout 300 xvfb-run -a build/gui/Flint)
  run_vim="${FLINT_E2E_VIM:-0}"
fi
only="${FLINT_E2E_ONLY:-}"
visible="${FLINT_E2E_VISIBLE:-1}"
if [[ -n "$only" ]]; then
  IFS=, read -r -a picked <<<"$only"
  for r in "${picked[@]}"; do
    [[ " ${known[*]} " == *" $r "* ]] || { echo "gui-e2e: FLINT_E2E_ONLY takes ${known[*]}, not '$r'" >&2; exit 2; }
  done
  runs=("${picked[@]}")
  run_vim=1
fi
# The rdp run needs FreeRDP's sample server, which scripts/test.sh starts where FreeRDP
# ships one.
run_rdp=1
[[ -n "${FLINT_RDP_SAMPLE_PORT:-}" ]] || run_rdp=0

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-gui-e2e.XXXXXX")"
fwd_pid=""
rdp2_pid=""
rfwd_pid=""
cleanup() {
  for p in "$fwd_pid" "$rdp2_pid" "$rfwd_pid"; do
    if [[ -n "$p" ]]; then kill "$p" 2>/dev/null; wait "$p" 2>/dev/null || true; fi
  done
  rm -rf "$tmp"
}
trap cleanup EXIT

# A TCP forwarder whose first connection reaches sshd 1 and every later one sshd 2:
# one address, two host keys.
port3="${FLINT_TEST_SSH_PORT3:-2224}"
cat > "$tmp/fwd.py" <<'PY'
import socket, sys, threading
listen, first, later = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
# How many connections go to `first` before the rest go to `later`.
firsts = int(sys.argv[4]) if len(sys.argv) > 4 else 1
# "peek": count only connections whose client speaks first (RDP), so a probe that opens
# and closes a connection without sending anything (milestone 35's round-trip dial)
# neither reaches a server nor moves the count.
peek = len(sys.argv) > 5 and sys.argv[5] == "peek"
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
lock = threading.Lock()
def serve(c):
    global n
    if peek:
        try:
            if not c.recv(1, socket.MSG_PEEK):
                c.close(); return
        except OSError:
            c.close(); return
    with lock:
        target = first if n < firsts else later
        n += 1
    u = socket.create_connection(("127.0.0.1", target))
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
while True:
    c, _ = srv.accept()
    if peek:
        threading.Thread(target=serve, args=(c,), daemon=True).start()
    else:
        serve(c)
PY
# A free port for the tunnels step (milestone 23).
tport="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
python3 -I "$tmp/fwd.py" "$port3" "$FLINT_TEST_SSH_PORT" "$FLINT_TEST_SSH_PORT2" & fwd_pid=$!
# The rdp run: a second sample server with its own certificate, and a forwarder whose
# first two connections (the certificate prompt, then the trusted connect) reach the
# first server and every later one the second: one address, a changed certificate.
rport="${FLINT_RDP_SAMPLE_PORT:-0}"
rport_fwd=0
if [[ "$run_rdp" == 1 ]]; then
  free_port() { python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }
  rport2="$(free_port)"
  rport_fwd="$(free_port)"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/rdp2.key" -out "$tmp/rdp2.crt" -days 2 -subj "/CN=flint-test-2" 2>/dev/null
  (cd "$tmp" && WLOG_LEVEL=OFF exec sfreerdp-server --cert="$tmp/rdp2.crt" --key="$tmp/rdp2.key" --port="$rport2" >"$tmp/rdp2.log" 2>&1) & rdp2_pid=$!
  python3 -I "$tmp/fwd.py" "$rport_fwd" "$rport" "$rport2" 2 peek & rfwd_pid=$!
fi
sleep 0.5

# Writes the page script for one run: $1 vault file, $2 the run's name, $3 output.
make_script() {
  E2E_VERSION="$("$root/scripts/version.sh")" E2E_VAULT="$1" E2E_PORT3="$port3" E2E_TPORT="$tport" E2E_RPORT="$rport" E2E_RPORT_FWD="$rport_fwd" E2E_RUN="$2" python3 -I - "$root/scripts/gui-e2e.js" "$3" <<'PY'
import os, sys
src = open(sys.argv[1]).read()
key = open(os.environ["FLINT_TEST_SSH_KEY"]).read().replace("\\", "\\\\").replace("`", "\\`")
values = {"VAULT": os.environ["E2E_VAULT"], "PORT": os.environ["FLINT_TEST_SSH_PORT"],
          "PORT2": os.environ["FLINT_TEST_SSH_PORT2"], "PORT3": os.environ["E2E_PORT3"], "TPORT": os.environ["E2E_TPORT"],
          "RPORT": os.environ["E2E_RPORT"], "RPORT_FWD": os.environ["E2E_RPORT_FWD"],
          "CPORT": os.environ.get("FLINT_RDP_CLIP_PORT", "0"), "CCTL": os.environ.get("FLINT_RDP_CLIP_CONTROL", "0"),
          "VERSION": os.environ["E2E_VERSION"], "USER": os.environ["USER"], "KEY": key,
          "RUN": os.environ["E2E_RUN"], "COVER": os.environ.get("FLINT_E2E_WEBGL_COVER", "0"), "NATIVEFS": os.environ.get("FLINT_E2E_NATIVE_FS", "0")}
# The benchmark's real host, only into its own run's script (milestone 34).
bench = os.environ["E2E_RUN"] == "rdpbench"
for k, env in (("BHOST", "FLINT_RDP_TEST_HOST"), ("BUSER", "FLINT_RDP_TEST_USER"), ("BPW", "FLINT_RDP_TEST_PASSWORD")):
    values[k] = os.environ.get(env, "").replace("\\", "\\\\").replace("'", "\\'") if bench else ""
values["BMODES"] = os.environ.get("FLINT_BENCH_MODES", "compatible/2d,auto/auto") if bench else ""
values["BMONS"] = os.environ.get("FLINT_BENCH_MONITORS", "") if bench else ""
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
    FLINT_GUI_E2E_VISIBLE="$visible" \
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
for r in "${runs[@]}"; do
  if [[ "$r" == vim && "$run_vim" != 1 ]]; then
    echo "gui-e2e: skip the vim run (it fails under Xvfb; FLINT_E2E_VIM=1 runs it)"
    continue
  fi
  if [[ "$r" == rdp && "$run_rdp" != 1 ]]; then
    echo "gui-e2e: skip the rdp run (no FreeRDP sample server here)"
    continue
  fi
  if [[ "$r" == multimon && -z "${FLINT_RDP_CLIP_PORT:-}" ]]; then
    echo "gui-e2e: skip the multimon run (no Flint RDP test server here)"
    continue
  fi
  if [[ "$r" == fullscreen && -z "${FLINT_RDP_CLIP_PORT:-}" ]]; then
    echo "gui-e2e: skip the fullscreen run (no Flint RDP test server here)"
    continue
  fi
  make_script "$tmp/$r.flint" "$r" "$tmp/$r.js"
  # vim passes in under 30 s; a freeze there then costs a minute, not four.
  cap="${FLINT_E2E_MAIN_MS:-}"
  [[ "$r" != vim ]] || cap=60000
  if [[ "$r" == multimon && "$(uname -s)" != Darwin ]]; then
    if [[ -z "${FLINT_E2E_MULTIMON_DISPLAY:-}" ]]; then
      echo "gui-e2e: skip the multimon run (no X display with two monitors; the Linux check makes one)"
      continue
    fi
    echo "gui-e2e: multimon on $FLINT_E2E_MULTIMON_DISPLAY: $(DISPLAY="$FLINT_E2E_MULTIMON_DISPLAY" xrandr --listmonitors 2>&1 | tr '\n' ' ')"
    saved=("${app[@]}")
    app=(timeout 300 env DISPLAY="$FLINT_E2E_MULTIMON_DISPLAY" build/gui/Flint)
    run_app "$r" "$tmp/$r.js" "$tmp/config-$r" "$tmp/$r.log" "$cap" || failed+=("$r")
    app=("${saved[@]}")
    continue
  fi
  run_app "$r" "$tmp/$r.js" "$tmp/config-$r" "$tmp/$r.log" "$cap" || failed+=("$r")
done
summary() {
  local r n
  for r in "${runs[@]}"; do
    [[ -f "$tmp/$r.log" ]] || continue
    n="$(grep -o '[0-9]* checks passed' "$tmp/$r.log" | tail -1 || true)"
    echo "gui-e2e: $r: ${n:-no verdict}"
  done
}
summary
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "gui-e2e: FAILED: ${failed[*]}" >&2
  exit 1
fi
# Principle 5: nothing from inside the vault is readable in any run's file.
for f in "$tmp"/*.flint; do
  [[ -f "$f" ]] || continue
  for marker in local pwhost e2e-key gui-host-pw-marker 127.0.0.1 codebox.lan "Code Box" pw-codebox through rdp-sample rdp-pw-marker "lab VPN" "SQLite format 3"; do
    if grep -aq -- "$marker" "$f"; then
      echo "gui-e2e: $(basename "$f") contains '$marker' in clear" >&2
      exit 1
    fi
  done
done
echo "gui-e2e: the vault files hold no clear-text host data"
# Principle 5: FreeRDP logs server addresses, so the app keeps its log off (D-072).
if [[ -f "$tmp/rdp.log" ]] && grep -q "com.freerdp" "$tmp/rdp.log"; then
  echo "gui-e2e: the rdp run's log has FreeRDP lines (addresses in a log)" >&2
  exit 1
fi
# D-030: the layout state holds ids only, never a name from inside the vault. The vault
# run is the one that makes groups and renames the vault.
if [[ -f "$tmp/vault.log" ]]; then
  ui_state="$tmp/config-vault/ui-state.json"
  [[ -f "$ui_state" ]] || { echo "gui-e2e: no ui-state.json was written" >&2; exit 1; }
  for marker in e2e-grp local pwhost "E2E Renamed"; do
    if grep -aq -- "$marker" "$ui_state"; then
      echo "gui-e2e: ui-state.json contains '$marker'" >&2
      exit 1
    fi
  done
  grep -q '"E2E Renamed"' "$tmp/config-vault/vaults.json" || { echo "gui-e2e: the rename did not reach vaults.json" >&2; exit 1; }
  echo "gui-e2e: ui-state.json holds ids only; vaults.json has the new name"
fi
echo "gui-e2e: pass"
