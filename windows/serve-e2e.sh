#!/usr/bin/env bash
# The CLI as a client of the running app on Windows (windows-port branch): a subset of
# scripts/serve-e2e.sh, run from WSL against build/windows/Flint (windows/build-gui.sh).
#
#   windows/serve-e2e.sh
#
# 1. The CLI on its own: a vault, a key, hosts; with the app off, no master password
#    and no console, a command fails with `locked`.
# 2. The app (windows/serve-page.js unlocks it and allows every caller with the master
#    password): commands are served over the AF_UNIX socket with no master password,
#    with the same stdout, stderr and exit code as the CLI on its own; exec and cp run
#    in the app against a throwaway sshd; a denied caller is refused; the window sees
#    the CLI's changes; the socket goes when the app quits.
# 3. With Flint closed, `flint` starts flint-app.exe beside it (CreateProcessW,
#    detached) on its unlock screen naming the command (scripts/serve-e2e-launch.js
#    unlocks it), `vault unlock` waits for it, and the CLI then works through it.
#
# The sshd listens on WSL's 127.0.0.2 and ssh-relay.ps1 on Windows' 127.0.0.2 (see
# windows/gui-e2e.sh). Run outside any sandbox.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
[[ -f "$root/build/windows/Flint/flint-app.exe" ]] || { echo "serve-e2e: build it first: windows/build-gui.sh" >&2; exit 1; }

P="${FLINT_WIN_SERVE_PORT:-2242}"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-win-serve.XXXXXX")"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-serve"
W="$(wslpath -w "$WIN_TMP")"
app_pid=""
stop_app() { powershell.exe -NoProfile -c "Get-Process flint-app -ErrorAction SilentlyContinue | ? { \$_.Path -like '$W\\*' } | Stop-Process -Force" >/dev/null 2>&1 || true; }
cleanup() {
  [[ -n "$app_pid" ]] && kill "$app_pid" 2>/dev/null
  stop_app
  [[ -f "$tmp/sshd.pid" ]] && kill "$(cat "$tmp/sshd.pid")" 2>/dev/null
  powershell.exe -NoProfile -c "Get-NetTCPConnection -LocalAddress 127.0.0.2 -LocalPort $P -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1 || true
  cp "$tmp/app.log" "$tmp/sshd.log" "$WIN_TMP/" 2>/dev/null  # kept for a look
  rm -rf "$tmp"
}
trap cleanup EXIT

# ---- the sshd and its relay
ssh-keygen -q -t ed25519 -N '' -f "$tmp/host_ed25519"
ssh-keygen -q -t ed25519 -N '' -f "$tmp/user_ed25519"
cp "$tmp/user_ed25519.pub" "$tmp/authorized_keys"; chmod 600 "$tmp/authorized_keys"
cat > "$tmp/sshd_config" <<CFG
Port $P
ListenAddress 127.0.0.2
HostKey $tmp/host_ed25519
AuthorizedKeysFile $tmp/authorized_keys
PidFile $tmp/sshd.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitTTY yes
Subsystem sftp internal-sftp
CFG
# An sshd left by an interrupted run would answer on the port with other keys.
pkill -f "sshd -f ${TMPDIR:-/tmp}/flint-win-serve\\." 2>/dev/null; sleep 0.3
setsid /usr/sbin/sshd -f "$tmp/sshd_config" -E "$tmp/sshd.log"
for _ in $(seq 1 50); do [[ -s "$tmp/sshd.pid" ]] && break; sleep 0.1; done
[[ -s "$tmp/sshd.pid" ]] || { echo "serve-e2e: sshd did not start" >&2; cat "$tmp/sshd.log" >&2; exit 1; }
setsid nohup powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/ssh-relay.ps1")" -ListenHost 127.0.0.2 \
  -Port "$P" -TargetHost 127.0.0.2 -Target "$P" -Distro "$WSL_DISTRO_NAME" > "$tmp/relay.log" 2>&1 &
for _ in $(seq 1 300); do grep -q '^relay:' "$tmp/relay.log" 2>/dev/null && break; sleep 0.1; done
grep -q '^relay:' "$tmp/relay.log" || { echo "serve-e2e: the relay did not start" >&2; cat "$tmp/relay.log" >&2; exit 1; }

# ---- the app folder and the run's files, on the Windows side
stop_app
rm -rf "$WIN_TMP"; mkdir -p "$WIN_TMP"
cp -R "$root/build/windows/Flint" "$WIN_TMP/app"
cp "$tmp/user_ed25519" "$WIN_TMP/id_test"
cd "$WIN_TMP"
flint="$WIN_TMP/app/flint.exe"
export FLINT_CONFIG_DIR="$W\\cfg" FLINT_KEYCHAIN=off FLINT_PRESENCE=password FLINT_APPROVAL_WAIT_MS=8000 FLINT_APP=off
export WSLENV="FLINT_CONFIG_DIR:FLINT_KEYCHAIN:FLINT_PRESENCE:FLINT_APPROVAL_WAIT_MS:FLINT_APP:FLINT_GUI_E2E"
MASTER="serve-e2e-master-password"
HOST_PW="served-host-pw-marker"
vault="$W\\served.flint"
failures=0; checks=0

# expect <exit code> <description> <stdin text> -- <flint args...>  ($out, $err)
expect() {
  local want="$1" desc="$2" input="$3"; shift 4
  checks=$((checks + 1))
  printf '%s' "$input" | "$flint" "$@" >"$tmp/out" 2>"$tmp/err"
  local got=$?
  out="$(tr -d '\r' < "$tmp/out")"; err="$(tr -d '\r' < "$tmp/err")"
  if [[ "$got" != "$want" ]]; then
    failures=$((failures + 1)); echo "FAIL  $desc: exit $got, want $want"; echo "      stdout: $out"; echo "      stderr: $err"
  else
    echo "ok    $desc"
  fi
}
check() {
  checks=$((checks + 1))
  if eval "$2"; then echo "ok    $1"; else failures=$((failures + 1)); echo "FAIL  $1"; fi
}
json_get() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1], {"d": d}))' "$1"; }
sock_exists() { [[ -e "$WIN_TMP/cfg/flint.sock" ]]; }

echo "== the CLI on its own"
expect 0 "create the vault" "$MASTER"$'\n'"$MASTER"$'\n' -- vault create "$vault" --name "Served Renamed" --master-stdin
expect 0 "add a host before the app starts" "$MASTER"$'\n' -- host add local-web --hostname 10.0.0.5 --user deploy --master-stdin
expect 0 "add the test key" "$MASTER"$'\n' -- key add tkey --file "$W\\id_test" --master-stdin
expect 0 "add an SSH host" "$MASTER"$'\n' -- host add local --hostname 127.0.0.2 --port "$P" --user "$USER" --key tkey --master-stdin
expect 5 "with the app off, no master password and no console: locked" "" -- host list
check "it says Flint could not be started" '[[ "$err" == *"could not be started"* ]]'

echo "== the app serves the vault"
MASTER="$MASTER" python3 -I -c 'import os,sys; open(sys.argv[2],"w").write(open(sys.argv[1]).read().replace("@@MASTER@@", os.environ["MASTER"]))' \
  "$here/serve-page.js" "$WIN_TMP/serve-page.js"
FLINT_GUI_E2E="$W\\serve-page.js" "$WIN_TMP/app/flint-app.exe" > "$tmp/app.log" 2>&1 &
app_pid=$!
# The CLI waits until the page has unlocked: a command that reaches the locked app
# re-renders the unlock screen (naming the command) while the page is typing the master
# password, and the page then submits an empty field.
for _ in $(seq 1 600); do
  grep -q "the window unlocks" "$tmp/app.log" 2>/dev/null && break
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 0.1
done
check "the page unlocked the vault in the window" 'grep -q "the window unlocks" "$tmp/app.log"'
if ! grep -q "the window unlocks" "$tmp/app.log"; then
  # Everything after this needs the unlocked app: stop here, with what the page saw.
  echo "serve-e2e: the page did not unlock; the app said:" >&2; tail -20 "$tmp/app.log" >&2
  exit 1
fi
for _ in $(seq 1 300); do
  printf '' | "$flint" host list >/dev/null 2>&1 && break
  sleep 0.2
done
check "the app serves the socket" 'sock_exists'
check "the first command was allowed in the window" 'grep -q "ok   allowed: " "$tmp/app.log"'
expect 0 "host list, served: no master password, no keychain" "" -- host list
check "it lists the hosts" '[[ "$out" == *local-web* && "$out" == *local* ]]'
expect 0 "host add with a password on stdin" "$HOST_PW"$'\n' -- --json host add served-web --hostname 10.0.0.6 --user root --password-stdin
check "the reply says it has a password, not which" '[[ "$(echo "$out" | json_get "d[\"has_password\"]")" == "True" ]]'
expect 3 "a missing host is not_found, as in the CLI" "" -- --json host show nope
check "the error is JSON on stderr" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "not_found" ]]'

echo "== the same output as the CLI on its own"
mkdir -p "$WIN_TMP/cfg-local"
for cmd in "host list" "--json host list" "host show served-web" "--json host show served-web" "--json known-host list" "--json host show nope"; do
  # shellcheck disable=SC2086
  printf '' | "$flint" $cmd >"$tmp/sout" 2>"$tmp/serr"; sstatus=$?
  cp "$WIN_TMP/cfg/vaults.json" "$WIN_TMP/cfg-local/vaults.json"
  # shellcheck disable=SC2086
  printf '%s\n' "$MASTER" | FLINT_CONFIG_DIR="$W\\cfg-local" "$flint" --master-stdin $cmd >"$tmp/lout" 2>"$tmp/lerr"; lstatus=$?
  checks=$((checks + 1))
  if [[ "$sstatus" == "$lstatus" ]] && cmp -s "$tmp/sout" "$tmp/lout" && cmp -s "$tmp/serr" "$tmp/lerr"; then
    echo "ok    same stdout, stderr and exit: flint $cmd"
  else
    failures=$((failures + 1)); echo "FAIL  served and local differ: flint $cmd (exit $sstatus vs $lstatus)"
    diff "$tmp/sout" "$tmp/lout" | head -5; diff "$tmp/serr" "$tmp/lerr" | head -5
  fi
done

echo "== sessions run in the app"
expect 11 "an unknown host key with nobody to ask fails with host_key" "" -- --json exec local -- echo hi
expect 0 "exec with --accept-new-host-key" "" -- exec local --accept-new-host-key -- echo served-exec-ok
check "exec streams stdout" '[[ "$out" == "served-exec-ok" ]]'
expect 3 "exec exits with the remote status and streams stderr" "" -- exec local -- 'echo to-err >&2; exit 3'
check "stderr came back" '[[ "$err" == "to-err" ]]'
expect 4 "exec --json captures both streams and the status" "" -- --json exec local -- 'echo out-line; echo err-line >&2; exit 4'
check "exec --json stdout, stderr and exit_code" '[[ "$(echo "$out" | json_get "d[\"stdout\"].strip() + \"/\" + d[\"stderr\"].strip() + \"/\" + str(d[\"exit_code\"])")" == "out-line/err-line/4" ]]'
head -c 300000 /dev/urandom > "$WIN_TMP/blob.bin"
expect 0 "cp up through the app" "" -- cp "$W\\blob.bin" "local:$tmp/blob-up.bin"
check "the upload is byte for byte" 'cmp -s "$WIN_TMP/blob.bin" "$tmp/blob-up.bin"'
expect 0 "cp down through the app" "" -- cp "local:$tmp/blob-up.bin" "$W\\blob-down.bin"
check "the download is byte for byte" 'cmp -s "$WIN_TMP/blob.bin" "$WIN_TMP/blob-down.bin"'
# A new caller (flint ← cscript): the grant above covers "flint, started by wsl" only.
cp "$here/new-caller.js" "$WIN_TMP/new-caller.js"
checks=$((checks + 1))
cscript.exe //nologo //E:jscript "$W\\new-caller.js" "$W\\app\\flint.exe" exec local -- echo deny-me >"$tmp/out" 2>"$tmp/err"; got=$?
out="$(tr -d '\r' < "$tmp/out")"; err="$(tr -d '\r' < "$tmp/err")"
if [[ $got == 15 ]]; then echo "ok    a new caller the owner denies is refused"; else failures=$((failures + 1)); echo "FAIL  a new caller the owner denies is refused: exit $got, want 15"; echo "      stdout: $out"; echo "      stderr: $err"; fi
check "it runs nothing and says why" '[[ "$out" != *deny-me* && "$err" == *"denied"* ]]'
check "the window names the new caller" 'grep -q "started by cscript" "$tmp/app.log"'
grep -q "denied: .*deny-me" "$tmp/app.log" && echo "ok    the window denied it" || { failures=$((failures + 1)); echo "FAIL  the window did not deny deny-me"; }

echo "== a second launch shows the running Flint and exits"
timeout 60 timeout 60 "$WIN_TMP/app/flint-app.exe" > "$tmp/second.log" 2>&1
check "the second launch exits at once, saying so" 'grep -q "already running" "$tmp/second.log"'

echo "== the stop host: the app quits"
expect 0 "add the stop host" "" -- host add e2e-stop --hostname 10.0.0.9
wait "$app_pid"; app_pid=""
check "the app's own checks passed" 'grep -q "^e2e: pass" "$tmp/app.log"'
check "the socket is gone once the app quit" '! sock_exists'
check "no password the CLI sent reached the app log" '! grep -q "$HOST_PW" "$tmp/app.log"'

echo "== with Flint closed, flint starts it on its unlock screen"
MASTER="$MASTER" python3 -I -c 'import os,sys; open(sys.argv[2],"w").write(open(sys.argv[1]).read().replace("@@MASTER@@", os.environ["MASTER"]))' \
  "$root/scripts/serve-e2e-launch.js" "$WIN_TMP/launch.js"
FLINT_APP= FLINT_GUI_E2E="$W\\launch.js" expect 5 "a command with Flint closed starts it and fails with locked" "" -- host list
check "it says Flint is asking" '[[ "$err" == *"Flint is asking"* ]]'
check "Flint is running and serving" 'sock_exists'
check "the app it started is flint-app.exe beside flint.exe" 'powershell.exe -NoProfile -c "Get-Process flint-app | % Path" | tr -d "\r" | grep -qi "flint-serve\\\\app\\\\flint-app.exe"'
FLINT_APP= expect 0 "vault unlock waits until the window unlocks" "" -- vault unlock
expect 0 "the command now runs in the app it started" "" -- host list
check "it lists the hosts" '[[ "$out" == *e2e-stop* ]]'
expect 0 "add the second stop host" "" -- host add e2e-stop-2 --hostname 10.0.0.10
for _ in $(seq 1 300); do sock_exists || break; sleep 0.1; done
check "the launched app quit when done (its page passed)" '! sock_exists'

echo
echo "serve-e2e (Windows): $((checks - failures))/$checks checks passed"
[[ $failures == 0 ]]
