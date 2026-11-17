#!/usr/bin/env bash
# scripts/sync-e2e.sh on Windows (milestones 43-44): the Windows flint.exe and
# flint-app.exe against the Linux flint-vault-server in WSL (vault-server.sh, behind a
# relay on Windows' loopback), two config folders as two machines, the app's sync loop
# and the app connecting on its own. The tokens go to Windows Credential Manager, read by
# the CLI and the app alike, and `vault disconnect` removes them at the end.
#
#   cfire build --target x86_64-w64-mingw32 && windows/build-gui.sh && windows/sync-e2e.sh
#
# It does not keep a copy of scripts/sync-e2e.sh: it rewrites main's at run time, as
# gui-e2e.sh does with gui-e2e.js, so a new check on main runs here too. Each rewrite is
# asserted, so a change on main that moves one fails loudly instead of running the Linux
# form. What changes:
# - Everything runs under %TEMP%\flint-sync (vault and config paths must be Windows
#   paths for flint.exe; given as C:/… through `wp`); the env vars cross with WSLENV.
# - No builds: flint.exe and the app come from build/ (cross-built beforehand).
# - The server is vault-server.sh's (port 34787, not a free port: see vault-server.sh);
#   stopping it for the offline part stops its relay too.
# - `no_tty` is `timeout 120`: a Windows process started from WSL has no console window,
#   so flint.exe never prompts on CONIN$ (the port guide, "Terminal").
# - The two checks of a vault file's 0600 mode are skipped: Windows has no POSIX modes;
#   the file takes its folder's ACL (the port guide, "Local files").
# - The app is flint-app.exe from a copy of build/windows/Flint, under `timeout 200`.
# Run outside any sandbox (it listens on sockets).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
for f in "$root/build/flint.exe" "$root/build/windows/Flint/flint-app.exe"; do
  [[ -f "$f" ]] || { echo "sync-e2e: build first ($f missing): cfire build --target x86_64-w64-mingw32, windows/build-gui.sh" >&2; exit 1; }
done
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-sync"
rm -rf "$WIN_TMP" && mkdir -p "$WIN_TMP/bin" "$WIN_TMP/run"
cp "$root/build/flint.exe" "$WIN_TMP/bin/"
cp -R "$root/build/windows/Flint" "$WIN_TMP/app"
script="$(mktemp "${TMPDIR:-/tmp}/flint-sync-win.XXXXXX.sh")"
trap 'rm -f "$script"' EXIT
# SYNC_E2E_SCRIPT=<file> keeps the rewritten script for a look.

python3 -I - "$root/scripts/sync-e2e.sh" "$script" <<'PY'
import re, sys
src = open(sys.argv[1]).read()

def sub(old, new, count=1):
    global src
    n = src.count(old)
    assert n == count, f"sync-e2e.sh changed: {old!r} found {n} times, want {count}"
    src = src.replace(old, new)

sub('''root="$(cd "$(dirname "$0")/.." && pwd)"''', '''root="$SYNC_WIN_ROOT"''')
sub('''. "$root/scripts/env.sh"
cfire build flint >/dev/null || { echo "sync-e2e: build failed" >&2; exit 1; }
cfire build flint-vault-server >/dev/null || { echo "sync-e2e: server build failed" >&2; exit 1; }
flint="$root/build/flint"
server="$root/build/flint-vault-server"
''', '''flint="$SYNC_WIN_TMP/bin/flint.exe"
source "$root/windows/vault-server.sh"
# A path under %TEMP% as flint.exe takes it (C:/…); anything else unchanged.
wp() { if [[ "$1" == /mnt/* ]]; then wslpath -m "$1"; else printf '%s' "$1"; fi; }
''')
sub('''tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-sync-e2e.XXXXXX")"
export FLINT_APP=off
''', '''tmp="$SYNC_WIN_TMP/run"
export FLINT_APP=off
export WSLENV="FLINT_CONFIG_DIR:FLINT_KEYCHAIN:FLINT_APP:FLINT_SYNC_DIAG:FLINT_GUI_E2E"
# Every flint.exe here must get its own config folder: one that does not would work in
# the person's real one (%APPDATA%\\Flint). Checked once through cmd.exe before any run.
seen="$(cd "$tmp" && FLINT_CONFIG_DIR="$(wp "$tmp/probe")" FLINT_APP=off cmd.exe /c 'echo %FLINT_CONFIG_DIR%^|%FLINT_APP%' 2>/dev/null | tr -d '\\r')"
[[ "$seen" == "$(wp "$tmp/probe")|off" ]] || { echo "sync-e2e: the env does not reach Windows (got '$seen'): stopping before touching any config" >&2; exit 1; }
''')
sub('''port="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"''',
    '''port=34787''')
# The server: vault-server.sh's, with one token and one data folder across restarts.
m = re.search(r'start_server\(\) \{\n.*?\n\}\nstop_server\(\) \{[^\n]*\}\n', src, re.S)
assert m, "sync-e2e.sh changed: start_server/stop_server not found"
src = src[:m.start()] + '''start_server() { VAULT_SERVER_TOKEN="$TOKEN" vault_server_start "$tmp" "$port" >/dev/null || { echo "sync-e2e: the server did not start" >&2; exit 1; }; }
stop_server() { vault_server_stop; }
''' + src[m.end():]
src = src.replace('"$tmp/server.log"', '"$tmp/vault-server.log"')
sub('''no_tty() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' "$@"; }''',
    '''no_tty() {
  local a=("$1") x
  shift
  for x in "$@"; do a+=("$(wp "$x")"); done
  FLINT_CONFIG_DIR="$(wp "${FLINT_CONFIG_DIR:-}")" timeout 120 "${a[@]}"
}
# The app, from its copy under %TEMP%; the kill of `timeout` does not reach Windows. Its
# output unbuffered (sed -u, not tr): the script waits on a line the page logs mid-run.
win_app() {
  (cd "$SYNC_WIN_TMP/app" && FLINT_CONFIG_DIR="$(wp "$FLINT_CONFIG_DIR")" FLINT_GUI_E2E="$(wp "$FLINT_GUI_E2E")" \\
    timeout 200 ./flint-app.exe 2>&1 | sed -u 's/\\r$//')
}''')
sub('''  FLINT_CONFIG_DIR="$tmp/a" "$flint" --vault "$VA" vault disconnect''',
    '''  powershell.exe -NoProfile -c "Get-Process flint-app -EA SilentlyContinue | ? { \\$_.Path -like '*\\\\flint-sync\\\\app\\\\*' } | Stop-Process -Force" >/dev/null 2>&1
  FLINT_CONFIG_DIR="$tmp/a" no_tty "$flint" --vault "$VA" vault disconnect''')
sub('''  FLINT_CONFIG_DIR="$tmp/b" "$flint" --vault "$VB" vault disconnect''',
    '''  FLINT_CONFIG_DIR="$tmp/b" no_tty "$flint" --vault "$VB" vault disconnect''')
sub('''  out="$(cat "$tmp/out")"; err="$(cat "$tmp/err")"''',
    '''  out="$(tr -d '\\r' < "$tmp/out")"; err="$(tr -d '\\r' < "$tmp/err")"''')
sub('''! grep -q "$VA" "$tmp/a/remotes.json"''', '''! grep -q "$(wp "$VA")" "$tmp/a/remotes.json"''')
src, n = re.subn(r'check "([^"]*) is 0600" [^\n]*',
                 r'echo "skip  \1 is 0600 (Windows: no POSIX modes; the file takes the ACL of its folder)"', src)
assert n == 2, f"sync-e2e.sh changed: {n} 0600 checks, want 2"
sub('''"$root/scripts/build-gui.sh" >/dev/null || { echo "sync-e2e: app build failed" >&2; exit 1; }''', ':', 2)
src, n = re.subn(r'if \[\[ "\$\(uname -s\)" == Darwin \]\]; then app=\([^)]*\); else app=\([^)]*\); fi', 'app=(win_app)', src)
assert n == 2, f"sync-e2e.sh changed: {n} app launch lines, want 2"
sub('''short="$(mktemp -d /tmp/fl-sync.XXXXXX)"''', '''short="$tmp/app-a"; mkdir -p "$short"''')
sub('''short_c="$(mktemp -d /tmp/fl-sync.XXXXXX)"''', '''short_c="$tmp/app-c"; mkdir -p "$short_c"''')
sub(''''input[aria-label="Local copy path"]', '$VC')''', ''''input[aria-label="Local copy path"]', '$(wp "$VC")')''')
open(sys.argv[2], "w").write(src)
PY
[[ $? == 0 ]] || exit 1
[[ -n "${SYNC_E2E_SCRIPT:-}" ]] && cp "$script" "$SYNC_E2E_SCRIPT"
SYNC_WIN_TMP="$WIN_TMP" SYNC_WIN_ROOT="$root" bash "$script"
