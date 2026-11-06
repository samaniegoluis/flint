#!/usr/bin/env bash
# End-to-end run of the CLI as a client of the running app (milestone 11a, D-038).
#
#   scripts/serve-e2e.sh
#
# The app runs headless (scripts/serve-e2e.js) and unlocks a vault through its real
# unlock screen. Then `flint`, with no keychain (FLINT_KEYCHAIN=off), no master
# password and no terminal, works on that vault through the app's socket. Checks:
# the socket is owner-only; served output and exit codes match the CLI's own,
# byte for byte; relative paths resolve in the caller's folder; what the app does
# not serve (another vault, `host test`, `vault unlock`) runs in the CLI as before;
# no secret value leaves the app; the window shows the CLI's changes; and the socket
# file is gone once the app quits.
#
# Linux: the real GTK window opens under xvfb-run.
set -o pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
. "$root/scripts/env.sh"
cfire build >/dev/null || { echo "serve-e2e: build failed" >&2; exit 1; }
"$root/scripts/build-gui.sh" >/dev/null || { echo "serve-e2e: app build failed" >&2; exit 1; }
flint="$root/build/flint"
if [[ "$(uname -s)" == Darwin ]]; then
  app=(build/gui/Flint.app/Contents/MacOS/Flint)
else
  app=(timeout 200 xvfb-run -a build/gui/Flint)
fi

# A short folder: the socket path must fit in sun_path (104 bytes on macOS).
tmp="$(mktemp -d /tmp/fl-serve.XXXXXX)"
export FLINT_CONFIG_DIR="$tmp/cfg"
export FLINT_KEYCHAIN=off
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null; wait "$app_pid" 2>/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

MASTER="serve-e2e-master-password"
HOST_PW="served-host-pw-marker"
CRED_PW="served-cred-pw-marker"
vault="$tmp/served.flint"
other="$tmp/other.flint"
all_out="$tmp/all-output"
: > "$all_out"
failures=0
checks=0

no_tty() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' "$@"; }

# expect <exit code> <description> <stdin text> -- <flint args...>  ($out, $err)
expect() {
  local want="$1" desc="$2" input="$3"; shift 4
  checks=$((checks + 1))
  printf '%s' "$input" | no_tty "$flint" "$@" >"$tmp/out" 2>"$tmp/err"
  local got=$?
  out="$(cat "$tmp/out")"; err="$(cat "$tmp/err")"
  { echo "\$ flint $*"; echo "$out"; echo "$err"; } >> "$all_out"
  if [[ "$got" != "$want" ]]; then
    failures=$((failures + 1))
    echo "FAIL  $desc: exit $got, want $want"
    echo "      stdout: $out"
    echo "      stderr: $err"
  else
    echo "ok    $desc"
  fi
}
check() {
  checks=$((checks + 1))
  if eval "$2"; then echo "ok    $1"; else failures=$((failures + 1)); echo "FAIL  $1"; fi
}
json_get() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1], {"d": d}))' "$1"; }
file_mode() { if [[ "$(uname -s)" == Darwin ]]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }

# The same command run by the CLI on its own: a config folder with the same recent
# list and no socket, and the master password on stdin.
local_run() {  # <stdin after the master line> -- <args...>
  local input="$1"; shift 2
  mkdir -p "$tmp/cfg-local"
  cp "$FLINT_CONFIG_DIR/vaults.json" "$tmp/cfg-local/vaults.json"
  printf '%s' "$MASTER"$'\n'"$input" | FLINT_CONFIG_DIR="$tmp/cfg-local" no_tty "$flint" "$@" --master-stdin >"$tmp/lout" 2>"$tmp/lerr"
  lstatus=$?
  lout="$(cat "$tmp/lout")"; lerr="$(cat "$tmp/lerr")"
}

echo "== set up, with the CLI on its own"
expect 0 "create the vault" "$MASTER"$'\n' -- vault create "$vault" --name "Served" --master-stdin
expect 0 "add a host before the app starts" "$MASTER"$'\n' -- host add local-web --hostname 10.0.0.5 --user deploy --master-stdin
expect 0 "create another vault" "$MASTER"$'\n' -- vault create "$other" --name "Other" --master-stdin
expect 0 "make the first vault current again" "" -- vault use "$vault"
expect 5 "without the app, no master password and no terminal: locked" "" -- host list

echo "== a first launch, on a config folder that does not exist yet"
cat > "$tmp/idle.js" <<'JS'
(async () => {
  const end = performance.now() + 4000;
  await new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  await window.backend.e2e_report({ ok: true, detail: '' });
  window.runtime.Quit();
})();
JS
FLINT_CONFIG_DIR="$tmp/fresh" FLINT_GUI_E2E="$tmp/idle.js" "${app[@]}" >"$tmp/fresh.log" 2>&1 &
fresh_pid=$!
for _ in $(seq 1 100); do [[ -S "$tmp/fresh/flint.sock" ]] && break; sleep 0.1; done
check "the app creates the config folder and serves on a first launch" '[[ -S "$tmp/fresh/flint.sock" ]]'
wait "$fresh_pid"

echo "== the app"
E2E_MASTER="$MASTER" python3 -I - "$root/scripts/serve-e2e.js" "$tmp/serve-e2e.js" <<'PY'
import os, sys
src = open(sys.argv[1]).read().replace("@@MASTER@@", os.environ["E2E_MASTER"])
open(sys.argv[2], "w").write(src)
PY
FLINT_GUI_E2E="$tmp/serve-e2e.js" "${app[@]}" >"$tmp/app.log" 2>&1 &
app_pid=$!
sock="$FLINT_CONFIG_DIR/flint.sock"
for _ in $(seq 1 300); do
  printf '' | no_tty "$flint" host list >/dev/null 2>&1 && break
  sleep 0.1
done
check "the app serves the socket" '[[ -S "$sock" ]]'
check "the socket is owner-only (0600)" '[[ "$(file_mode "$sock")" == "600" ]]'

echo "== commands served by the app: no keychain, no master password, no terminal"
expect 0 "host list" "" -- host list
check "it lists the host" '[[ "$out" == *local-web* ]]'
expect 0 "group add" "" -- group add homelab/web
expect 0 "host add with a password on stdin" "$HOST_PW"$'\n' -- --json host add served-web --hostname 10.0.0.6 --user root --group homelab/web --password-stdin
check "the reply says it has a password, not which" '[[ "$(echo "$out" | json_get "d[\"has_password\"]")" == "True" ]]'
expect 0 "host edit" "" -- host edit served-web --port 2201 --tag prod
expect 0 "cred add with a password on stdin" "$CRED_PW"$'\n' -- cred add ops --user ops --password-stdin
mkdir -p "$tmp/work/keys"
ssh-keygen -q -t ed25519 -N '' -C served-e2e -f "$tmp/work/keys/id_served"
(cd "$tmp/work" && printf '' | no_tty "$flint" --json key add served-key --file keys/id_served >"$tmp/out" 2>"$tmp/err")
kstatus=$?
out="$(cat "$tmp/out")"; err="$(cat "$tmp/err")"; { echo "$out"; echo "$err"; } >> "$all_out"
check "key add --file reads a path relative to the caller's folder" '[[ $kstatus == 0 && "$(echo "$out" | json_get "d[\"name\"]")" == "served-key" ]]'
expect 0 "vault status" "" -- --json vault status
check "status counts come from the app's vault" '[[ "$(echo "$out" | json_get "d[\"hosts\"]")" == "2" && "$(echo "$out" | json_get "d[\"keys\"]")" == "1" ]]'
expect 3 "a missing host is not_found, as in the CLI" "" -- --json host show nope
check "the error is JSON on stderr" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "not_found" ]]'
expect 2 "a usage error keeps its exit code" "" -- host add
expect 4 "a conflict keeps its exit code" "" -- group add homelab/web

echo "== the same output as the CLI on its own"
for cmd in "host list" "--json host list" "host show served-web" "--json host show served-web" "group list" "--json cred list" "key show served-key" "--json known-host list" "--json host show nope" "host rm nope"; do
  # shellcheck disable=SC2086
  expect_status=0
  printf '' | no_tty "$flint" $cmd >"$tmp/sout" 2>"$tmp/serr"; sstatus=$?
  # shellcheck disable=SC2086
  local_run "" -- $cmd
  checks=$((checks + 1))
  if [[ "$sstatus" == "$lstatus" ]] && cmp -s "$tmp/sout" "$tmp/lout" && cmp -s "$tmp/serr" "$tmp/lerr"; then
    echo "ok    same stdout, stderr and exit: flint $cmd"
  else
    failures=$((failures + 1))
    echo "FAIL  served and local differ: flint $cmd (exit $sstatus vs $lstatus)"
    diff "$tmp/sout" "$tmp/lout" | head -5
    diff "$tmp/serr" "$tmp/lerr" | head -5
  fi
done

echo "== what the app does not serve runs in the CLI"
expect 5 "another vault is not the app's: locked" "" -- --vault "$other" host list
expect 0 "and opens with its master password" "$MASTER"$'\n' -- --vault "$other" host list --master-stdin
expect 0 "make the served vault current again" "" -- vault use "$vault"
expect 5 "host test opens SSH, so it stays in the CLI: locked" "" -- host test served-web
expect 5 "vault unlock stays in the CLI" "" -- vault unlock

echo "== a rename, then the stop host"
expect 0 "vault rename" "" -- vault rename "Served Renamed"
check "the recent list has the new name" 'grep -q "Served Renamed" "$FLINT_CONFIG_DIR/vaults.json"'
expect 0 "add the stop host" "" -- host add e2e-stop --hostname 10.0.0.9

for _ in $(seq 1 300); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.1; done
wait "$app_pid"; app_pid=""
sed 's/^/app: /' "$tmp/app.log" | grep -E "ok |FAILED|checks passed|e2e:|page text" || true
check "the window checks passed" 'grep -q "^e2e: pass" "$tmp/app.log"'
check "the socket file is removed when the app quits" '[[ ! -e "$sock" ]]'
expect 5 "with the app gone, the CLI is on its own again: locked" "" -- host list

echo "== no secret left the app (Principle 6)"
check "no password in any output" '! grep -q -e "$HOST_PW" -e "$CRED_PW" "$all_out"'
check "no private key in any output" '! grep -q "PRIVATE KEY" "$all_out"'
check "no password in the app log" '! grep -q -e "$HOST_PW" -e "$CRED_PW" "$tmp/app.log"'

echo
echo "serve-e2e: $((checks - failures))/$checks checks passed"
[[ "$failures" == 0 ]]
