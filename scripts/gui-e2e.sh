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
# GTK window opens under xvfb-run. Windows: in the desktop session (windows/desktop.sh).
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
runs=(terminal vault tunnels paste rdp webgl fullscreen vim clilink update selfupdate)
# multimon (milestone 38) needs two monitors: on Linux an X display with two (the check's
# container makes one, FLINT_E2E_MULTIMON_DISPLAY), on macOS a person's own screens with
# FLINT_E2E_MULTIMON=1 (its windows take a Space on each).
# rdpbench (milestone 34) is scripts/rdp-bench.sh's: a real Windows host, named only.
known=("${runs[@]}" multimon rdpbench)
if [[ -n "${FLINT_E2E_MULTIMON_DISPLAY:-}" || "${FLINT_E2E_MULTIMON:-}" == 1 ]]; then runs+=(multimon); fi
# Windows (MSYS2): the real WebView2 window in the desktop session, which
# windows/desktop.sh runs this in; vim passes there.
case "$(uname -s)" in
  Darwin)
    app=(build/gui/Flint.app/Contents/MacOS/Flint)
    run_vim=1 ;;
  MINGW*|MSYS*)
    app=(timeout 300 build/gui/Flint.exe)
    run_vim="${FLINT_E2E_VIM:-1}" ;;
  *)
    app=(timeout 300 xvfb-run -a build/gui/Flint)
    run_vim="${FLINT_E2E_VIM:-0}" ;;
esac
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
feed_pid=""
cleanup() {
  for p in "$fwd_pid" "$rdp2_pid" "$rfwd_pid" "$feed_pid"; do
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
  # MSYS2 would turn -subj's /CN=... into a Windows path (as in scripts/test.sh).
  MSYS2_ARG_CONV_EXCL='/CN=' openssl req -x509 -newkey rsa:2048 -nodes -keyout "$tmp/rdp2.key" -out "$tmp/rdp2.crt" -days 2 -subj "/CN=flint-test-2" 2>/dev/null
  (cd "$tmp" && WLOG_LEVEL=OFF exec sfreerdp-server --cert="$tmp/rdp2.crt" --key="$tmp/rdp2.key" --port="$rport2" >"$tmp/rdp2.log" 2>&1) & rdp2_pid=$!
  python3 -I "$tmp/fwd.py" "$rport_fwd" "$rport" "$rport2" 2 peek & rfwd_pid=$!
fi
sleep 0.5

# Writes the page script for one run: $1 vault file, $2 the run's name, $3 output.
make_script() {
  E2E_VERSION="$("$root/scripts/version.sh")" E2E_VAULT="$1" E2E_PORT3="$port3" E2E_TPORT="$tport" E2E_RPORT="$rport" E2E_RPORT_FWD="$rport_fwd" E2E_RUN="$2" python3 -I - "$root/scripts/gui-e2e.js" "$3" <<'PY'
import os, sys
src = open(sys.argv[1], encoding="utf-8").read()
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
open(sys.argv[2], "w", encoding="utf-8").write(src)
PY
}

# Runs the app once on a page script: $1 the run's name, $2 its script, $3 its config
# folder, $4 its log, $5 its cap in ms on macOS (empty: the app's 240 s). Fails when the
# page did not report a pass. A run killed before it printed a verdict (Linux's timeout)
# is named with the last line the page logged.
run_app() {
  local st=0
  # Windows: the app starts behind (the run comes from a scheduled task); bring it to
  # the front, or the page gets no focus events (windows/front.py).
  case "$(uname -s)" in
    MINGW*|MSYS*) python3 -I "$root/windows/front.py" "$(cygpath -w "$root/build/gui/Flint.exe")" 60 >"$4.front" 2>&1 & ;;
  esac
  # clilink (milestone 48): a CLI inside a pretend Flint.app and a home folder of the
  # run's own, so the links go nowhere near the machine's PATH; its ~/.local/bin holds
  # a link to a copy that was moved, which the app offers to fix.
  local cli_env=()
  local cli_key="" win=""
  case "$(uname -s)" in MINGW*|MSYS*) win=1 ;; esac
  if [[ "$1" == clilink && -n "$win" ]]; then
    # Windows (milestone 50, D-121): a pretend Flint folder with its bin\flint.exe, and
    # a registry key of the run's own standing in for HKCU\Environment, whose Path
    # still names a copy that was moved; the machine's own Path is never touched.
    mkdir -p "$tmp/cli/Flint/bin"
    : > "$tmp/cli/Flint/Flint.exe"; : > "$tmp/cli/Flint/bin/flint.exe"
    cli_key="Software\\Flint-e2e\\clilink-$$"
    MSYS2_ARG_CONV_EXCL='*' reg add "HKCU\\$cli_key" /v Path /t REG_EXPAND_SZ /d 'D:\Old\Flint\bin;%USERPROFILE%\tools' /f >/dev/null
    cli_env=(FLINT_CLI="$(cygpath -m "$tmp/cli/Flint/bin/flint.exe")" FLINT_CLI_PATH_KEY="$cli_key")
  elif [[ "$1" == clilink ]]; then
    mkdir -p "$tmp/cli/Flint.app/Contents/Helpers" "$tmp/clihome/.local/bin" "$tmp/clisys"
    printf '#!/bin/sh\n' > "$tmp/cli/Flint.app/Contents/Helpers/flint"
    ln -sfn "$tmp/cli/Moved.app/Contents/Helpers/flint" "$tmp/clihome/.local/bin/flint"
    # /usr/local/bin is the machine's own: the run uses a folder of its own instead.
    cli_env=(FLINT_CLI="$tmp/cli/Flint.app/Contents/Helpers/flint" FLINT_CLI_HOME="$tmp/clihome" FLINT_CLI_SYSTEM_DIR="$tmp/clisys")
  fi
  # rdp (milestone 58): Type password's presence check is the master password, which
  # the page types; Touch ID or polkit would wait for a person.
  if [[ "$1" == rdp ]]; then
    cli_env=(FLINT_PRESENCE=password)
  fi
  # update (milestone 52): a signed manifest of a newer Flint on a feed of the run's own,
  # under a throwaway key; a build from source accepts both (D-116), a package never.
  if [[ "$1" == update ]]; then
    mkdir -p "$tmp/feed" "$tmp/feedkey"
    local pub
    pub="$("$root/scripts/sign-manifest.sh" keygen "$tmp/feedkey" 2>/dev/null)"
    local fport
    fport="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
    # The packages point at the run's own feed, which does not have them: Download
    # (milestone 53) fails there with a toast, and nothing reaches GitHub.
    python3 -I - "$tmp/feed/manifest.json" "$fport" <<'PY'
import json, sys
base = f"http://127.0.0.1:{sys.argv[2]}/"
assets = [(k, n, c) for k, n, c in (("macos-arm64", "Flint-99.0.0-macos-arm64.zip", "a"),
          ("windows-x86_64", "Flint-99.0.0-windows-x86_64.zip", "b"), ("linux-x86_64-deb", "flint_99.0.0_amd64.deb", "c"))]
json.dump({"version": "99.0.0", "date": "2026-12-01", "summary": "A newer Flint for the test.",
           "page": "https://github.com/samaniegoluis/flint/releases/tag/v99.0.0",
           "assets": [{"key": k, "name": n, "url": base + n, "size": 1000, "sha256": c * 64} for k, n, c in assets]},
          open(sys.argv[1], "w"))
PY
    FLINT_UPDATE_PUBLIC_KEY_HEX="$pub" FLINT_UPDATE_SIGNING_KEY="$(cat "$tmp/feedkey/flint-update-signing.key")" \
      "$root/scripts/sign-manifest.sh" sign "$tmp/feed/manifest.json" >/dev/null
    rm -f "$tmp/feedkey/flint-update-signing.key"
    (cd "$tmp/feed" && exec python3 -I -m http.server "$fport" --bind 127.0.0.1 >"$tmp/feed.log" 2>&1) & feed_pid=$!
    for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$fport") 2>/dev/null && break; sleep 0.1; done
    # What's new after an update: this machine last ran 0.15.0.
    mkdir -p "$3"
    cat > "$3/settings.json" <<'JSON'
{"version":1,"settings":{"theme":"system","accent":"ember","density":"default","follow_motion":true,"reopen_last_vault":true,"term_font":"","term_font_size":13,"term_line_height":100,"term_cursor":"block","term_cursor_blink":true,"term_theme":"default","lock_after":"1h","keys_cleared":false,"paste_limit_mb":20,"rdp_mac_keys":"mac","rdp_mac_custom":"","rdp_graphics":"auto","sync_interval":60,"toast_corner":"bottom-right","cli_offer_shown":false,"update_check":true,"update_toast_version":"","last_seen_version":"0.15.0"}}
JSON
    cli_env=(FLINT_UPDATE_FEED="http://127.0.0.1:$fport/manifest.json" FLINT_UPDATE_TEST_KEY="$pub" FLINT_UPDATE_TEST_KIND=portable)
  fi
  env ${cli_env[@]+"${cli_env[@]}"} FLINT_CONFIG_DIR="$3" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$2" FLINT_GUI_E2E_TIMEOUT_MS="${5:-}" \
    FLINT_GUI_E2E_VISIBLE="$visible" \
    "${app[@]}" 2>&1 | tee "$4" || st=$?
  [[ -f "$4.front" ]] && cat "$4.front"
  if [[ -n "$cli_key" ]]; then
    # What the app wrote is what Windows reads: this copy's bin first, the moved copy
    # gone, the rest kept as written.
    local val
    val="$(MSYS2_ARG_CONV_EXCL='*' reg query "HKCU\\$cli_key" /v Path 2>/dev/null | sed -n 's/^ *Path *REG_EXPAND_SZ *//p' | tr -d '\r')"
    MSYS2_ARG_CONV_EXCL='*' reg delete "HKCU\\$cli_key" /f >/dev/null 2>&1 || true
    if [[ "$val" != "$(cygpath -w "$tmp/cli/Flint/bin");%USERPROFILE%\tools" ]]; then
      echo "e2e: fail: the Path the app left is [$val]"; echo "gui-e2e ($1): FAILED" >&2; return 1
    fi
    echo "e2e: the Path the app left: $val"
  fi
  if [[ "$1" == update ]]; then
    kill "${feed_pid:-0}" 2>/dev/null || true; wait "${feed_pid:-0}" 2>/dev/null || true; feed_pid=""
    # Download downloads inside Flint (milestone 53): from the run's feed, which has no
    # package. A system with no package in the manifest (Linux on arm64 in Docker) gets
    # How to update and downloads nothing.
    if grep -q 'Flint 99.0.0 is available (download)' "$4"; then
      grep -q '"GET /Flint-99.0.0-macos-arm64.zip HTTP\|"GET /Flint-99.0.0-windows-x86_64.zip HTTP\|"GET /flint_99.0.0_amd64.deb HTTP' "$tmp/feed.log" \
        || { echo "e2e: fail: Download did not ask the feed for the package"; echo "gui-e2e ($1): FAILED" >&2; return 1; }
    fi
    # One GET of the manifest and one of its signature per check, and the package when
    # Download is chosen; nothing else (Principle 15).
    if grep -v -E '"GET /(manifest\.json(\.sig)?|Flint-99\.0\.0-(macos-arm64|windows-x86_64)\.zip|flint_99\.0\.0_amd64\.deb) HTTP' "$tmp/feed.log" | grep -q 'HTTP/'; then
      echo "e2e: fail: the feed got another request: $(grep -v -E 'GET /manifest' "$tmp/feed.log" | head -1)"; echo "gui-e2e ($1): FAILED" >&2; return 1
    fi
  fi
  if ! grep -q '^e2e: ' "$4"; then
    echo "e2e: fail: killed with no verdict (exit $st); last page line: $(grep '\[page\]' "$4" | tail -1 | sed 's/^.*\[page\] //')"
  fi
  if ! grep -q '^e2e: pass' "$4"; then
    echo "gui-e2e ($1): FAILED" >&2
    return 1
  fi
}

# selfupdate (milestone 53): the self-update end to end, three times. A copy of this
# build laid out as an installed Flint in a folder of the run's own, a package of the
# same build (marked, or broken) on a local feed under a throwaway key, and the page
# script inside the installed copy, so the app update-apply starts after the swap runs
# the package's own copy of it. apply: Download, Ready, Relaunch, the new copy runs and
# the old folder is gone; badsha: a package whose SHA-256 is not the manifest's is
# discarded and nothing changes; rollback: a package whose app quits at once is put
# back, and the old Flint says why. Only a build from source accepts the test feed and
# key (D-116).
run_selfupdate() {
  local js="$1" log="$2" win=""
  case "$(uname -s)" in MINGW*|MSYS*) win=1 ;; esac
  # Releases carry packages for macOS arm64 and Linux x86_64 only (D-111): Linux on arm64
  # (Docker on a Mac) is offered How to update, so there is nothing to download. The
  # swap itself runs there in cli-e2e's update-apply steps.
  if [[ "$(uname -s)" == Linux && "$(uname -m)" != x86_64 ]]; then
    echo "gui-e2e: skip the selfupdate run (no package for Linux $(uname -m); cli-e2e runs update-apply)"
    { echo "e2e: pass"; echo "0 checks passed (skipped: no package for Linux $(uname -m))"; } >> "$log"
    return 0
  fi
  local base="$tmp/su" pub name exe cli res xdisp="" xpid=""
  rm -rf "$base"; mkdir -p "$base/key"
  pub="$("$root/scripts/sign-manifest.sh" keygen "$base/key" 2>/dev/null)"
  if [[ "$(uname -s)" == Darwin ]]; then
    name=Flint.app; exe=Contents/MacOS/Flint; cli=Contents/Helpers/flint; res=Contents/Resources
  elif [[ -n "$win" ]]; then
    # Windows (milestone 50, D-121): Flint\Flint.exe and Flint\bin\flint.exe.
    name=Flint; exe=Flint.exe; cli=bin/flint.exe; res=.
  else
    name=Flint; exe=Flint; cli=flint; res=.
    # The relaunched app outlives the first one: a display of the run's own, not xvfb-run's.
    xdisp=":$((90 + RANDOM % 9))"
    Xvfb "$xdisp" -screen 0 1600x1000x24 >/dev/null 2>&1 & xpid=$!
    sleep 1
  fi
  local scenario st=0 fport fpid
  # FLINT_E2E_SELFUPDATE=<scenario> runs one of them (a diagnosis in seconds, rule 9).
  for scenario in ${FLINT_E2E_SELFUPDATE:-apply badsha rollback}; do
    local w="$base/$scenario" inst
    rm -rf "$w"; mkdir -p "$w/Apps" "$w/pkg" "$w/feed" "$w/t" "$w/config"
    # Each scenario creates its vault anew (the page script's VAULT is one path).
    rm -f "$tmp/selfupdate.flint"
    inst="$w/Apps/$name"
    if [[ "$(uname -s)" == Darwin ]]; then ditto build/gui/Flint.app "$inst"; else cp -R build/gui "$inst"; fi
    mkdir -p "$inst/$(dirname "$cli")"
    if [[ -n "$win" ]]; then cp build/flint.exe "$inst/$cli"; else cp build/flint "$inst/$cli"; fi
    cp "$js" "$inst/$res/e2e.js"
    if [[ "$(uname -s)" == Darwin ]]; then ditto "$inst" "$w/pkg/$name"; else cp -R "$inst" "$w/pkg/$name"; fi
    printf 'new\n' > "$w/pkg/$name/$res/e2e-new"
    if [[ "$scenario" == rollback && -n "$win" ]]; then
      # A copy of cmd.exe: with no console and nothing to read, it quits at once.
      cp "$(cygpath -u "${SYSTEMROOT:-C:\\Windows}")/System32/cmd.exe" "$w/pkg/$name/$exe"
    elif [[ "$scenario" == rollback ]]; then printf '#!/bin/sh\nexit 1\n' > "$w/pkg/$name/$exe"; chmod 755 "$w/pkg/$name/$exe"; fi
    local zipf="$w/feed/Flint-99.0.0-pkg.zip"
    if [[ "$(uname -s)" == Darwin ]]; then ditto -c -k --keepParent "$w/pkg/$name" "$zipf"
    elif [[ -n "$win" ]]; then
      # As windows/package.sh writes it (MSYS2 has no zip).
      (cd "$w/pkg" && python3 -I -c '
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(sys.argv[2]):
        for f in files:
            p = os.path.join(d, f)
            z.write(p, p.replace(os.sep, "/"))
' "$zipf" "$name")
    else (cd "$w/pkg" && zip -qry "$zipf" "$name"); fi
    local sha size key
    sha="$(python3 -I -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$zipf")"
    size="$(wc -c < "$zipf" | tr -d ' ')"
    [[ "$scenario" != badsha ]] || sha="$(printf '%064d' 7)"
    key=linux-x86_64-deb
    [[ "$(uname -s)" != Darwin ]] || key=macos-arm64
    [[ -z "$win" ]] || key=windows-x86_64
    fport="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
    python3 -I - "$w/feed/manifest.json" "$fport" "$key" "$sha" "$size" <<'PY'
import json, sys
path, port, key, sha, size = sys.argv[1:]
base = f"http://127.0.0.1:{port}/"
json.dump({"version": "99.0.0", "date": "2026-12-01", "summary": "A newer Flint for the test.",
           "page": "https://github.com/samaniegoluis/flint/releases/tag/v99.0.0",
           "assets": [{"key": key, "name": "Flint-99.0.0-pkg.zip", "url": base + "Flint-99.0.0-pkg.zip", "size": int(size), "sha256": sha}]},
          open(path, "w"))
PY
    FLINT_UPDATE_PUBLIC_KEY_HEX="$pub" FLINT_UPDATE_SIGNING_KEY="$(cat "$base/key/flint-update-signing.key")" \
      "$root/scripts/sign-manifest.sh" sign "$w/feed/manifest.json" >/dev/null
    # The package goes out slowly (a slice every 0.1 s, about 3 s in all), as from a
    # real server, so the page sees the percentage move; the log is http.server's.
    cat > "$w/slowfeed.py" <<'PY'
import functools, http.server, os, sys, time
class Slow(http.server.SimpleHTTPRequestHandler):
    def copyfile(self, src, dst):
        if not self.path.endswith(".zip"):
            return super().copyfile(src, dst)
        size = os.fstat(src.fileno()).st_size
        step = max(1, size // 30)
        while True:
            part = src.read(step)
            if not part:
                break
            dst.write(part)
            dst.flush()
            time.sleep(0.1)
port, root = int(sys.argv[1]), sys.argv[2]
http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Slow, directory=root)).serve_forever()
PY
    python3 -I "$w/slowfeed.py" "$fport" "$w/feed" >"$w/feed.log" 2>&1 & fpid=$!
    for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$fport") 2>/dev/null && break; sleep 0.1; done
    local run=("$inst/$exe")
    [[ -z "$xdisp" ]] || run=(env DISPLAY="$xdisp" timeout 300 "$inst/$exe")
    [[ -z "$win" ]] || run=(timeout 300 "$inst/$exe")
    echo "gui-e2e: selfupdate: $scenario"
    # Windows: the app starts behind; bring it to the front, as run_app does.
    [[ -z "$win" ]] || { python3 -I "$root/windows/front.py" "$(cygpath -w "$inst/$exe")" 60 >"$w/front.log" 2>&1 & }
    env FLINT_UPDATE_FEED="http://127.0.0.1:$fport/manifest.json" FLINT_UPDATE_TEST_KEY="$pub" FLINT_UPDATE_TEST_KIND=portable \
      FLINT_CONFIG_DIR="$w/config" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$inst/$res/e2e.js" FLINT_GUI_E2E_VISIBLE="$visible" \
      FLINT_UPDATE_APP_LOG="$w/app2.log" TMPDIR="$w/t" "${run[@]}" >"$w/app1.log" 2>&1 || true
    # The app update-apply starts (the new one, or the old one again) starts behind too.
    [[ -z "$win" ]] || { python3 -I "$root/windows/front.py" "$(cygpath -w "$inst/$exe")" 120 >"$w/front2.log" 2>&1 & }
    cat "$w/app1.log" >> "$log"
    grep -E "the page heard the download move|the toast's percentage moved" "$w/app1.log" | sed 's/^\[page\] /  /' || true
    local fail=""
    if [[ "$scenario" == badsha ]]; then
      grep -q 'selfupdate: discarded' "$w/app1.log" && grep -q '^e2e: pass' "$w/app1.log" || fail="the bad download was not discarded as the page saw it"
      [[ -z "$fail" && -e "$w/Apps/.flint-update" ]] && fail="the discarded download left $w/Apps/.flint-update"
      [[ -z "$fail" && -e "$inst/$res/e2e-new" ]] && fail="the installed copy changed"
    else
      grep -q 'selfupdate: relaunching' "$w/app1.log" || fail="the first app never reached Relaunch"
      # The relaunched app's verdict, in the log update-apply gave it.
      for _ in $(seq 1 600); do grep -q '^e2e: ' "$w/app2.log" 2>/dev/null && break; [[ -n "$fail" ]] && break; sleep 0.2; done
      [[ -f "$w/app2.log" ]] && cat "$w/app2.log" >> "$log"
      [[ -z "$fail" ]] && ! grep -q '^e2e: pass' "$w/app2.log" 2>/dev/null && fail="the relaunched app gave no pass"
      if [[ -z "$fail" && "$scenario" == apply ]]; then
        grep -q 'selfupdate: relaunched into the new package' "$w/app2.log" || fail="the relaunched app was not the new one"
        [[ -e "$inst/$res/e2e-new" ]] || fail="the installed folder is not the package"
      fi
      if [[ -z "$fail" && "$scenario" == rollback ]]; then
        grep -q 'selfupdate: rolled back' "$w/app2.log" || fail="the old app did not say why"
        [[ ! -e "$inst/$res/e2e-new" ]] || fail="the broken package stayed installed"
      fi
      # The old folder (or the broken one) is gone once the app that runs took over.
      for _ in $(seq 1 50); do [[ -e "$w/Apps/.flint-update" ]] || break; sleep 0.2; done
      [[ -z "$fail" && -e "$w/Apps/.flint-update" ]] && fail="$w/Apps/.flint-update was left behind: $(ls -A "$w/Apps/.flint-update" | tr '\n' ' ')"
      find "$w/t" -name update-apply.log -exec sed 's/^/update-apply: /' {} \; >> "$log"
    fi
    # Only the manifest, its signature and the package reached the feed.
    if [[ -z "$fail" ]] && grep -v -E '"GET /(manifest\.json(\.sig)?|Flint-99\.0\.0-pkg\.zip) HTTP' "$w/feed.log" | grep -q 'HTTP/'; then
      fail="the feed got another request: $(grep -v -E 'GET /(manifest|Flint-99)' "$w/feed.log" | head -1)"
    fi
    kill "$fpid" 2>/dev/null || true; wait "$fpid" 2>/dev/null || true
    if [[ -n "$fail" ]]; then
      echo "e2e: fail: selfupdate $scenario: $fail" | tee -a "$log"
      for f in app1 app2; do
        [[ -f "$w/$f.log" ]] && grep -E 'flint-gui: (Flint|download|relaunch|the last|update)|\[page\]|^e2e:' "$w/$f.log" | tail -15 | sed "s/^/  $f: /"
      done
      find "$w/t" -name update-apply.log -exec sed 's/^/  update-apply: /' {} \;
      st=1
    else
      echo "e2e: selfupdate $scenario passed" | tee -a "$log"
    fi
  done
  [[ -z "$xpid" ]] || { kill "$xpid" 2>/dev/null; wait "$xpid" 2>/dev/null || true; }
  if [[ "$st" != 0 ]]; then
    echo "gui-e2e (selfupdate): FAILED" >&2
    return 1
  fi
  echo "e2e: pass" >> "$log"
  echo "3 checks passed" >> "$log"
}

# A packaged app (FLINT_E2E_NOBUILD on a release build, or a Linux package installed and
# linked into build/gui) carries install-kind, which a build from source never does
# (build-gui.sh): it checks only Flint's own feed with Flint's key (D-116, Principle 15),
# so the update and selfupdate runs, which need a feed and a key of the run's own, cannot
# run on it. cfire test covers what such a copy is offered (src/domain/update_test.cf).
packaged=""
case "$(uname -s)" in
  Darwin) [[ -f build/gui/Flint.app/Contents/Resources/install-kind ]] && packaged="$(head -1 build/gui/Flint.app/Contents/Resources/install-kind)" ;;
  MINGW*|MSYS*) [[ -f build/gui/install-kind ]] && packaged="$(head -1 build/gui/install-kind)" ;;
  *) kind="$(dirname "$(readlink -f build/gui/Flint)")/install-kind"
     [[ -f "$kind" ]] && packaged="$(head -1 "$kind")" ;;
esac
failed=()
for r in "${runs[@]}"; do
  if [[ ( "$r" == update || "$r" == selfupdate ) && -n "$packaged" ]]; then
    echo "gui-e2e: skip the $r run (a packaged app, $packaged, checks only Flint's own feed)"
    continue
  fi
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
  if [[ "$r" == selfupdate ]]; then
    run_selfupdate "$tmp/$r.js" "$tmp/$r.log" || failed+=("$r")
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
