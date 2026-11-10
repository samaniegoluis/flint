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
# The vim step runs in a run of its own after the main one, as in scripts/gui-e2e.sh. It
# is off by default: on Windows it fails only on a race in gui-e2e.js (the next command
# is sent while vim is still quitting; the port guide, "Resume here");
# FLINT_E2E_VIM=1 adds the vim run, FLINT_E2E_ONLY=vim runs only it. Exit status: 0 both
# passed, 1 the main run failed, 3 only the vim run failed.
# Run outside any sandbox (it listens on sockets).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
app_dir="$root/build/windows/Flint"
[[ -f "$app_dir/flint-app.exe" ]] || { echo "gui-e2e: build it first: windows/build-gui.sh" >&2; exit 1; }
run_vim="${FLINT_E2E_VIM:-0}"
only="${FLINT_E2E_ONLY:-}"
[[ -z "$only" || "$only" == vim ]] || { echo "gui-e2e: FLINT_E2E_ONLY takes only 'vim'" >&2; exit 2; }
[[ "$only" != vim ]] || run_vim=1

P1="${FLINT_WIN_E2E_PORT:-2232}"; P2=$((P1 + 1)); P3=$((P1 + 2))
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-win-e2e.XXXXXX")"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-e2e"
W="$(wslpath -m "$WIN_TMP")"   # C:/Users/…/flint-e2e: forward slashes, safe in a JS string
fwd_pid=""
cleanup() {
  for f in "$tmp"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null || true; done
  [[ -n "$fwd_pid" ]] && kill "$fwd_pid" 2>/dev/null || true
  powershell.exe -NoProfile -c "foreach (\$p in $P1,$P2,$P3) { Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort \$p -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >/dev/null 2>&1 || true
  rm -rf "$tmp" /mnt/c/tmp/flint-tether-fixture
  [[ -n "${made_c_tmp:-}" ]] && rmdir /mnt/c/tmp 2>/dev/null || true
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
for p in "$P1" "$P2" "$P3"; do
  for _ in $(seq 1 100); do grep -q '^relay:' "$tmp/relay$p.log" 2>/dev/null && break; sleep 0.1; done
  grep -q '^relay:' "$tmp/relay$p.log" || { echo "gui-e2e: relay $p did not start" >&2; cat "$tmp/relay$p.log" >&2; exit 1; }
done

# The app and the files it needs, on the Windows side (WebView2 dislikes \\wsl$ paths).
rm -rf "$WIN_TMP"; mkdir -p "$WIN_TMP/config" "$WIN_TMP/downloads"
cp -R "$app_dir" "$WIN_TMP/app"
cp "$root/src/adapters/vault/testdata/tether-v5.tether" "$WIN_TMP/old.tether"
# Tether stored the legacy key's path as /tmp/flint-tether-fixture/id_legacy; on Windows
# a path from the root names the current drive, so the key goes to C:\tmp (removed at exit).
made_c_tmp=""
[[ -d /mnt/c/tmp ]] || made_c_tmp=1
mkdir -p /mnt/c/tmp/flint-tether-fixture
cp "$root/src/adapters/vault/testdata/tether-legacy-ed25519" /mnt/c/tmp/flint-tether-fixture/id_legacy

# Writes the page script for one run: $1 vault file name, $2 '1' for the vim run, $3 the
# script's name, all in $WIN_TMP.
make_script() {
  E2E_KEY="$tmp/user_ed25519" E2E_W="$W" P1="$P1" P2="$P2" P3="$P3" E2E_VAULT="$1" E2E_VIM="$2" \
    python3 -I - "$root/scripts/gui-e2e.js" "$WIN_TMP/$3" <<'PY'
import os, sys
src = open(sys.argv[1]).read()
key = open(os.environ["E2E_KEY"]).read().replace("\\", "\\\\").replace("`", "\\`")
w = os.environ["E2E_W"]
values = {"VAULT": w + "/" + os.environ["E2E_VAULT"], "PORT": os.environ["P1"], "PORT2": os.environ["P2"],
          "PORT3": os.environ["P3"], "USER": os.environ["USER"], "KEY": key,
          "TETHER": w + "/old.tether", "VIM": os.environ["E2E_VIM"]}
for k, v in values.items():
    src = src.replace("@@" + k + "@@", v)
src = src.replace("127.0.0.1", "127.0.0.2")
src = src.replace("fill('#hh', 'localhost')", "fill('#hh', '127.0.0.3')").replace("`[localhost]:${PORT2}`", "`[127.0.0.3]:${PORT2}`")
# The download's local side: on macOS and Linux the sshd is this machine.
# Focus events fire only in a focused window, and Windows does not give the foreground
# to a window started from WSL: the focus-trap check is logged, not failed, then.
c = "await check(editorOpen().contains(document.activeElement), 'a dialog takes the focus back from the terminal behind it');"
assert c in src
src = src.replace(c, "if (document.hasFocus()) { " + c + " } else { await log('skip focus trap: the window does not have the system focus (document.hasFocus() is false)'); }")
src = src.replace("local: dir + '/made/", "local: '" + w + "/downloads/")
open(sys.argv[2], "w").write(src)
PY
}

# Runs the app once: $1 the run's name, $2 its script, $3 its config folder (all in
# $WIN_TMP), $4 its log, $5 its cap in seconds. The app's own cap applies on macOS only,
# so here `timeout` is the cap; a run killed before its verdict is named with the last
# line the page logged, as scripts/gui-e2e.sh does.
run_app() {
  local st=0
  mkdir -p "$WIN_TMP/$3"
  (cd "$WIN_TMP/app" && FLINT_CONFIG_DIR="$W/$3" FLINT_KEYCHAIN=off FLINT_GUI_E2E="$W/$2" \
    WSLENV=FLINT_CONFIG_DIR:FLINT_KEYCHAIN:FLINT_GUI_E2E \
    timeout "$5" ./flint-app.exe 2>&1 | tr -d '\r' | tee "$4") || st=$?
  if ! grep -q '^e2e: ' "$4"; then
    echo "e2e: fail: killed with no verdict after $5 s (exit $st); last page line: $(grep '\[page\]' "$4" | tail -1 | sed 's/^.*\[page\] //')"
  fi
  if ! grep -q '^e2e: pass' "$4"; then
    echo "gui-e2e ($1): FAILED" >&2
    return 1
  fi
}

failed=()
if [[ "$only" != vim ]]; then
  make_script e2e.flint 0 e2e.js
  run_app main e2e.js config "$tmp/run.log" 600 || failed+=(main)
fi
if [[ "$run_vim" == 1 ]]; then
  make_script vim.flint 1 vim.js
  run_app vim vim.js config-vim "$tmp/vim.log" 90 || failed+=(vim)
else
  echo "gui-e2e: skip the vim run (FLINT_E2E_VIM=1 runs it)"
fi
# Exit 1: the main run failed. Exit 3: only the vim run did (as scripts/gui-e2e.sh).
if [[ " ${failed[*]:-} " == *" main "* ]]; then
  echo "gui-e2e: FAILED: ${failed[*]:-}" >&2
  exit 1
fi
if [[ "$only" == vim ]]; then
  [[ ${#failed[@]} -eq 0 ]] || { echo "gui-e2e: FAILED: vim" >&2; exit 3; }
  echo "gui-e2e: the vim run passed"
  exit 0
fi
status=0
[[ ${#failed[@]} -eq 0 ]] || status=3
for marker in local pwhost e2e-key gui-host-pw-marker 127.0.0.2 codebox.lan "Code Box" pw-codebox "SQLite format 3"; do
  if grep -aq -- "$marker" "$WIN_TMP/e2e.flint"; then
    echo "gui-e2e: the vault file contains '$marker' in clear" >&2
    exit 1
  fi
done
echo "gui-e2e: the vault file holds no clear-text host data"
ui_state="$WIN_TMP/config/ui-state.json"
[[ -f "$ui_state" ]] || { echo "gui-e2e: no ui-state.json was written" >&2; exit 1; }
for marker in e2e-grp local pwhost "E2E Renamed"; do
  if grep -aq -- "$marker" "$ui_state"; then echo "gui-e2e: ui-state.json contains '$marker'" >&2; exit 1; fi
done
grep -q '"E2E Renamed"' "$WIN_TMP/config/vaults.json" || { echo "gui-e2e: the rename did not reach vaults.json" >&2; exit 1; }
echo "gui-e2e: ui-state.json holds ids only; vaults.json has the new name"
# The download landed on Windows, and the cancelled one left nothing behind.
[[ "$(cat "$WIN_TMP/downloads/b-copy.txt")" == hello ]] || { echo "gui-e2e: the download did not land on Windows" >&2; exit 1; }
if command ls -a "$WIN_TMP/downloads" | grep -q -e flint-part -e big-copy; then
  echo "gui-e2e: the cancelled download left a file on Windows" >&2; exit 1
fi
echo "gui-e2e: the download landed on Windows; the cancelled one left nothing"
exit "$status"
