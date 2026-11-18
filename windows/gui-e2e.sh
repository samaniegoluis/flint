#!/usr/bin/env bash
# scripts/gui-e2e.js, the end-to-end run of the desktop app through its real UI, on
# Windows from WSL (windows-port branch). The app opens a real WebView2 window on the
# Windows desktop and quits when the script is done.
#
#   windows/gui-e2e.sh              # uses build/windows/Flint (windows/build-gui.sh)
#
# Same servers as scripts/gui-e2e.sh: two throwaway sshd and a forwarder whose first
# connection reaches sshd 1 and every later one sshd 2. Here they listen on WSL's
# 127.0.0.2 (this WSL's 127.0.0.1 is broken, see the port guide), and ssh-relay.ps1
# listens on Windows' own 127.0.0.2 with the same ports, so `127.0.0.2:<port>` names
# the same server from the app and from a jump host. The script itself is unchanged
# except for substitutions made on the fly: 127.0.0.1 → 127.0.0.2, the jump host's
# `localhost` → 127.0.0.3, the local side of the download (the sshd is not this
# machine) and Windows paths.
# The page script runs as the same short runs as scripts/gui-e2e.sh (terminal, vault,
# tunnels, paste, rdp, vim), each a launch of the app on a fresh vault and config folder.
# The rdp run talks to RDP test servers that are Windows programs on Windows' 127.0.0.1
# (rdp-servers.sh: FreeRDP's sample server twice, Flint's own server) and a forwarder
# (tcp-switch.ps1) for the changed certificate; its script keeps 127.0.0.1. Its clipboard
# checks write to this machine's clipboard, as on macOS and Linux.
# vim is off by default, as on Linux, though it passes here since main's f994cb8.
#   FLINT_E2E_ONLY=tunnels windows/gui-e2e.sh   runs only the named runs (comma-separated)
#   FLINT_E2E_VIM=1 windows/gui-e2e.sh          adds the vim run
# The tunnels run listens on Windows' 127.0.0.1 (a tunnel always does): its "through"
# host dials 127.0.0.1:<tunnel port>, the destination stays 127.0.0.2 inside WSL, and a
# fourth relay holds Windows' 127.0.0.1:<port 1> for the "port in use" check.
# Exit status: 0 all passed, 1 a run other than vim failed, 3 only the vim run failed.
# Run outside any sandbox (it listens on sockets).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
app_dir="$root/build/windows/Flint"
[[ -f "$app_dir/flint-app.exe" ]] || { echo "gui-e2e: build it first: windows/build-gui.sh" >&2; exit 1; }
runs=(terminal vault tunnels paste rdp webgl fullscreen vim)
# multimon (milestone 38) needs two monitors: FLINT_E2E_MULTIMON=1 on a desk with two, or
# FLINT_E2E_ONLY=multimon. rdpbench (milestone 34) is scripts/rdp-bench.sh's, not run here.
known=("${runs[@]}" multimon)
if [[ "${FLINT_E2E_MULTIMON:-}" == 1 ]]; then runs+=(multimon); fi
run_vim="${FLINT_E2E_VIM:-0}"
only="${FLINT_E2E_ONLY:-}"
if [[ -n "$only" ]]; then
  IFS=, read -r -a picked <<<"$only"
  for r in "${picked[@]}"; do
    [[ " ${known[*]} " == *" $r "* ]] || { echo "gui-e2e: FLINT_E2E_ONLY takes ${known[*]}, not '$r'" >&2; exit 2; }
  done
  runs=("${picked[@]}")
  run_vim=1
fi

P1="${FLINT_WIN_E2E_PORT:-2232}"; P2=$((P1 + 1)); P3=$((P1 + 2))
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-win-e2e.XXXXXX")"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-e2e"
W="$(wslpath -m "$WIN_TMP")"   # C:/Users/…/flint-e2e: forward slashes, safe in a JS string
fwd_pid=""
cleanup() {
  for f in "$tmp"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; done
  [[ -n "$fwd_pid" ]] && kill "$fwd_pid" 2>/dev/null || true
  powershell.exe -NoProfile -c "foreach (\$p in $P1,$P2,$P3) { Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort \$p -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue } }; Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $P1 -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
  if [[ -n "${RPORT_FWD:-}" ]]; then
    rdp_servers_stop
    powershell.exe -NoProfile -c "Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $RPORT_FWD -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
  fi
  rm -rf "$tmp"
}
trap cleanup EXIT

ssh-keygen -q -t ed25519 -N '' -f "$tmp/host_ed25519"
ssh-keygen -q -t ecdsa -b 256 -N '' -f "$tmp/host_ecdsa"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host2_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/user_ed25519"
cp "$tmp/user_ed25519.pub" "$tmp/authorized_keys"; chmod 600 "$tmp/authorized_keys"
write_config() {  # <name> <port> <host key>...
  cat > "$tmp/$1_config" <<CFG
Port $2
ListenAddress 127.0.0.2
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
CFG
}
write_config sshd "$P1" "$tmp/host_ed25519" "$tmp/host_ecdsa"
write_config sshd2 "$P2" "$tmp/host2_ed25519"
# The jump host step names its second hop `localhost`, which this WSL resolves to the
# broken 127.0.0.1 only: it gets 127.0.0.3, reached from the jump host alone.
echo "ListenAddress 127.0.0.3" >> "$tmp/sshd2_config"
for name in sshd sshd2; do
  setsid /usr/sbin/sshd -f "$tmp/${name}_config" -E "$tmp/$name.log"
  for _ in $(seq 1 50); do [[ -s "$tmp/$name.pid" ]] && break; sleep 0.1; done
  [[ -s "$tmp/$name.pid" ]] || { echo "gui-e2e: $name did not start" >&2; cat "$tmp/$name.log" >&2; exit 1; }
done

cat > "$tmp/fwd.py" <<'PY'
import socket, sys, threading
listen, first, later = int(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.2", listen)); srv.listen(8)
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
    u = socket.create_connection(("127.0.0.2", first if n == 0 else later))
    n += 1
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
PY
python3 -I "$tmp/fwd.py" "$P3" "$P1" "$P2" & fwd_pid=$!

relay="$(wslpath -w "$here/ssh-relay.ps1")"
for p in "$P1" "$P2" "$P3"; do
  setsid nohup powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$relay" -ListenHost 127.0.0.2 \
    -Port "$p" -TargetHost 127.0.0.2 -Target "$p" -Distro "$WSL_DISTRO_NAME" > "$tmp/relay$p.log" 2>&1 &
done
# The tunnels run's "port in use": something else on Windows' 127.0.0.1:<port 1>.
setsid nohup powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$relay" -ListenHost 127.0.0.1 \
  -Port "$P1" -TargetHost 127.0.0.2 -Target "$P1" -Distro "$WSL_DISTRO_NAME" > "$tmp/relay-busy.log" 2>&1 &
for p in "$P1" "$P2" "$P3" -busy; do
  for _ in $(seq 1 100); do grep -q '^relay:' "$tmp/relay$p.log" 2>/dev/null && break; sleep 0.1; done
  grep -q '^relay:' "$tmp/relay$p.log" || { echo "gui-e2e: relay $p did not start" >&2; cat "$tmp/relay$p.log" >&2; exit 1; }
done
# A free port on Windows' 127.0.0.1 for the tunnel.
TPORT="$(powershell.exe -NoProfile -c '$l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $l.LocalEndpoint.Port; $l.Stop()' | tr -d '\r')"
[[ "$TPORT" =~ ^[0-9]+$ ]] || { echo "gui-e2e: no free port on Windows for the tunnel" >&2; exit 1; }

# The app and the files it needs, on the Windows side (WebView2 dislikes \\wsl$ paths).
rm -rf "$WIN_TMP"; mkdir -p "$WIN_TMP/downloads"
cp -R "$app_dir" "$WIN_TMP/app"

# The rdp run's servers: the sample server and Flint's own (rdp-servers.sh), a second
# sample server with its own certificate, and a forwarder whose first two connections
# (the certificate prompt, then the trusted connect) reach the first and every later
# one the second.
RPORT=0; RPORT_FWD=""; CPORT=0; CCTL=0
if [[ " ${runs[*]} " =~ \ (rdp|webgl|fullscreen|multimon)\  ]]; then
  source "$here/rdp-servers.sh"
  mkdir -p "$WIN_TMP/rdp"
  rdp_servers_start "$WIN_TMP/rdp"
  rdp_server_sample "$WIN_TMP/rdp" 33895 rdp2
  RPORT="$FLINT_RDP_SAMPLE_PORT"; CPORT="$FLINT_RDP_CLIP_PORT"; CCTL="$FLINT_RDP_CLIP_CONTROL"; RPORT_FWD=33896
  setsid nohup powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/tcp-switch.ps1")" \
    -Port "$RPORT_FWD" -First "$RPORT" -Later 33895 -Firsts 2 -Peek > "$tmp/switch.log" 2>&1 &
  for _ in $(seq 1 100); do grep -q '^switch:' "$tmp/switch.log" 2>/dev/null && break; sleep 0.1; done
  grep -q '^switch:' "$tmp/switch.log" || { echo "gui-e2e: tcp-switch did not start" >&2; cat "$tmp/switch.log" >&2; exit 1; }
fi

# Writes the page script for one run: $1 the run's name; vault, script and config folder
# are named after it in $WIN_TMP.
make_script() {
  E2E_VERSION="$("$root/scripts/version.sh")" E2E_KEY="$tmp/user_ed25519" E2E_W="$W" P1="$P1" P2="$P2" P3="$P3" TPORT="$TPORT" E2E_RUN="$1" \
    E2E_RPORT="$RPORT" E2E_RPORT_FWD="${RPORT_FWD:-0}" E2E_CPORT="$CPORT" E2E_CCTL="$CCTL" \
    python3 -I - "$root/scripts/gui-e2e.js" "$WIN_TMP/$1.js" <<'PY'
import os, sys
src = open(sys.argv[1]).read()
key = open(os.environ["E2E_KEY"]).read().replace("\\", "\\\\").replace("`", "\\`")
w = os.environ["E2E_W"]
run = os.environ["E2E_RUN"]
values = {"VAULT": w + "/" + run + ".flint", "PORT": os.environ["P1"], "PORT2": os.environ["P2"],
          "PORT3": os.environ["P3"], "TPORT": os.environ["TPORT"], "USER": os.environ["USER"],
          "KEY": key, "RUN": run, "RPORT": os.environ["E2E_RPORT"], "RPORT_FWD": os.environ["E2E_RPORT_FWD"],
          "CPORT": os.environ["E2E_CPORT"], "CCTL": os.environ["E2E_CCTL"], "VERSION": os.environ["E2E_VERSION"],
          "COVER": os.environ.get("FLINT_E2E_WEBGL_COVER", "0"), "NATIVEFS": "0",
          # The benchmark's real host (milestone 34) is scripts/rdp-bench.sh's: empty here.
          "BHOST": "", "BUSER": "", "BPW": "", "BMODES": "", "BMONS": ""}
for k, v in values.items():
    src = src.replace("@@" + k + "@@", v)
if run in ("rdp", "webgl", "fullscreen", "multimon"):
    # The RDP servers are Windows programs on Windows' 127.0.0.1: no SSH substitutions.
    open(sys.argv[2], "w").write(src)
    sys.exit(0)
src = src.replace("127.0.0.1", "127.0.0.2")
src = src.replace("fill('#hh', 'localhost')", "fill('#hh', '127.0.0.3')").replace("`[localhost]:${PORT2}`", "`[127.0.0.3]:${PORT2}`")
# A tunnel listens on Windows' 127.0.0.1: the host through it dials there, and the
# editor shows that side as 127.0.0.1.
for old, new in [("await fill('#hh', '127.0.0.2');\n      await fill('#hp', TPORT);", "await fill('#hh', '127.0.0.1');\n      await fill('#hp', TPORT);"),
                 ("`127.0.0.2:${TPORT}→127.0.0.2:${PORT2}`", "`127.0.0.1:${TPORT}→127.0.0.2:${PORT2}`")]:
    assert old in src, old
    src = src.replace(old, new)
# The download's local side: on macOS and Linux the sshd is this machine.
# Focus events fire only in a focused window, and Windows does not give the foreground
# to a window started from WSL: the focus-trap check is logged, not failed, then.
c = "await check(editorOpen().contains(document.activeElement), 'a dialog takes the focus back from the terminal behind it');"
assert c in src
src = src.replace(c, "if (document.hasFocus()) { " + c + " } else { await log('skip focus trap: the window does not have the system focus (document.hasFocus() is false)'); }")
assert "local: dir + '/made/" in src
src = src.replace("local: dir + '/made/", "local: '" + w + "/downloads/")
open(sys.argv[2], "w").write(src)
PY
}

# Runs the app once: $1 the run's name, $2 its log, $3 its cap in seconds. The app's own
# cap applies on macOS only, so here `timeout` is the cap; a run killed before its
# verdict is named with the last line the page logged, as scripts/gui-e2e.sh does.
run_app() {
  local st=0
  mkdir -p "$WIN_TMP/config-$1"
  (cd "$WIN_TMP/app" && FLINT_CONFIG_DIR="$W/config-$1" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$W/$1.js" \
    WSLENV=FLINT_CONFIG_DIR:FLINT_KEYCHAIN:FLINT_GUI_E2E \
    timeout "$3" ./flint-app.exe 2>&1 | tr -d '\r' | tee "$2") || st=$?
  if ! grep -q '^e2e: ' "$2"; then
    echo "e2e: fail: killed with no verdict after $3 s (exit $st); last page line: $(grep '\[page\]' "$2" | tail -1 | sed 's/^.*\[page\] //')"
  fi
  if ! grep -q '^e2e: pass' "$2"; then
    echo "gui-e2e ($1): FAILED" >&2
    return 1
  fi
}

failed=()
for r in "${runs[@]}"; do
  if [[ "$r" == vim && "$run_vim" != 1 ]]; then
    echo "gui-e2e: skip the vim run (FLINT_E2E_VIM=1 runs it)"
    continue
  fi
  make_script "$r"
  cap=600
  [[ "$r" != vim ]] || cap=90
  run_app "$r" "$tmp/$r.log" "$cap" || failed+=("$r")
done
for r in "${runs[@]}"; do
  [[ -f "$tmp/$r.log" ]] || continue
  n="$(grep -o '[0-9]* checks passed' "$tmp/$r.log" | tail -1 || true)"
  echo "gui-e2e: $r: ${n:-no verdict}"
done
# Exit 1: a run other than vim failed. Exit 3: only vim did (as scripts/gui-e2e.sh).
for r in "${failed[@]:-}"; do
  if [[ -n "$r" && "$r" != vim ]]; then
    echo "gui-e2e: FAILED: ${failed[*]}" >&2
    exit 1
  fi
done
# Principle 5: nothing from inside the vault is readable in any run's file.
for f in "$WIN_TMP"/*.flint; do
  [[ -f "$f" ]] || continue
  for marker in local pwhost e2e-key gui-host-pw-marker 127.0.0.2 codebox.lan "Code Box" pw-codebox through rdp-sample rdp-pw-marker "SQLite format 3"; do
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
# D-030: the layout state holds ids only. The vault run makes groups and renames the vault.
if [[ -f "$tmp/vault.log" ]]; then
  ui_state="$WIN_TMP/config-vault/ui-state.json"
  [[ -f "$ui_state" ]] || { echo "gui-e2e: no ui-state.json was written" >&2; exit 1; }
  for marker in e2e-grp local pwhost "E2E Renamed"; do
    if grep -aq -- "$marker" "$ui_state"; then echo "gui-e2e: ui-state.json contains '$marker'" >&2; exit 1; fi
  done
  grep -q '"E2E Renamed"' "$WIN_TMP/config-vault/vaults.json" || { echo "gui-e2e: the rename did not reach vaults.json" >&2; exit 1; }
  echo "gui-e2e: ui-state.json holds ids only; vaults.json has the new name"
fi
# The terminal run's download landed on Windows, and the cancelled one left nothing.
if [[ -f "$tmp/terminal.log" ]]; then
  [[ "$(cat "$WIN_TMP/downloads/b-copy.txt")" == hello ]] || { echo "gui-e2e: the download did not land on Windows" >&2; exit 1; }
  if command ls -a "$WIN_TMP/downloads" | grep -q -e flint-part -e big-copy; then
    echo "gui-e2e: the cancelled download left a file on Windows" >&2; exit 1
  fi
  echo "gui-e2e: the download landed on Windows; the cancelled one left nothing"
fi
if [[ ${#failed[@]} -gt 0 ]]; then
  echo "gui-e2e: FAILED: vim" >&2
  exit 3
fi
echo "gui-e2e: pass"
