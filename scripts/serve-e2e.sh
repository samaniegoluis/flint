#!/usr/bin/env bash
# End-to-end run of the CLI as a client of the running app (milestones 11a and 11b,
# D-038, D-041, D-042).
#
#   scripts/serve-e2e.sh
#
# The app runs headless (scripts/serve-e2e.js) and unlocks a vault through its real
# unlock screen. Then `flint`, with no keychain (FLINT_KEYCHAIN=off), no master
# password and no terminal, works on that vault through the app's socket. Checks:
# the socket is owner-only; served output and exit codes match the CLI's own,
# byte for byte; relative paths resolve in the caller's folder; `exec`, `connect`
# and `host test` run in the app against the throwaway sshd of scripts/test.sh, with
# prompts, a PTY and resizes relayed; several clients at once; another vault is
# refused; `vault lock` locks the window and a locked vault makes the window ask,
# naming the command; with Flint closed, `flint` starts it on its unlock screen;
# no secret value leaves the app; the window shows the CLI's changes; and the
# socket file is gone once the app quits.
#
# Linux: the real GTK window opens under xvfb-run.
set -o pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  FLINT_TEST_CMD="$root/scripts/serve-e2e.sh" exec "$root/scripts/test.sh"
fi
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
# Only the launch check below lets `flint` start the app (D-042).
export FLINT_APP=off
# Caller approval (milestone 12): the page approves with the master password, and a
# request nobody answers is refused after 8 s instead of two minutes.
export FLINT_PRESENCE=password
export FLINT_APPROVAL_WAIT_MS=8000
app_pid=""
cleanup() {
  if [[ -n "$app_pid" ]]; then kill "$app_pid" 2>/dev/null; wait "$app_pid" 2>/dev/null; fi
  # FLINT_E2E_KEEP=<dir> keeps the app's log and the commands' output for a look.
  if [[ -n "${FLINT_E2E_KEEP:-}" ]]; then cp "$tmp/app.log" "$all_out" "$FLINT_E2E_KEEP/" 2>/dev/null; fi
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
  printf '%s' "$MASTER"$'\n'"$input" | FLINT_CONFIG_DIR="$tmp/cfg-local" no_tty "$flint" --master-stdin "$@" >"$tmp/lout" 2>"$tmp/lerr"
  lstatus=$?
  lout="$(cat "$tmp/lout")"; lerr="$(cat "$tmp/lerr")"
}

echo "== set up, with the CLI on its own"
expect 0 "create the vault" "$MASTER"$'\n' -- vault create "$vault" --name "Served" --master-stdin
expect 0 "add a host before the app starts" "$MASTER"$'\n' -- host add local-web --hostname 10.0.0.5 --user deploy --master-stdin
expect 0 "create another vault" "$MASTER"$'\n' -- vault create "$other" --name "Other" --master-stdin
expect 0 "make the first vault current again" "" -- vault use "$vault"
expect 5 "without the app, no master password and no terminal: locked" "" -- host list
check "it says Flint could not be started" '[[ "$err" == *"could not be started"* ]]'
P="$FLINT_TEST_SSH_PORT"
expect 0 "add the test key" "$MASTER"$'\n' -- key add tkey --file "$FLINT_TEST_SSH_KEY" --master-stdin
expect 0 "add an SSH host" "$MASTER"$'\n' -- host add local --hostname 127.0.0.1 --port "$P" --user "$USER" --key tkey --master-stdin
expect 0 "add a host behind it" "$MASTER"$'\n' -- host add tty --hostname localhost --port "$P" --user "$USER" --key tkey --jump local --master-stdin

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
check "the first command, which asked for the unlock, was allowed with it" 'grep -q "allowed flint, started by .* at unlock" "$tmp/app.log"'

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
check "status counts come from the app's vault" '[[ "$(echo "$out" | json_get "d[\"hosts\"]")" == "4" && "$(echo "$out" | json_get "d[\"keys\"]")" == "2" ]]'
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

echo "== sessions run in the app: exec, host test, connect (D-042)"
expect 11 "an unknown host key with nobody to ask fails with host_key" "" -- --json exec local -- echo hi
check "the host_key error is JSON with the fingerprint" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "host_key" && "$err" == *"SHA256:"* ]]'
expect 0 "exec with --accept-new-host-key" "" -- exec local --accept-new-host-key -- echo served-exec-ok
check "exec streams stdout" '[[ "$out" == "served-exec-ok" ]]'
expect 3 "exec exits with the remote status" "" -- exec local -- 'echo to-err >&2; exit 3'
check "and streams stderr" '[[ "$err" == "to-err" ]]'
expect 4 "exec --json captures both streams and the status" "" -- --json exec local -- 'echo out-line; echo err-line >&2; exit 4'
check "exec --json stdout, stderr and exit_code" '[[ "$(echo "$out" | json_get "d[\"stdout\"].strip() + \"/\" + d[\"stderr\"].strip() + \"/\" + str(d[\"exit_code\"])")" == "out-line/err-line/4" ]]'
expect 255 "a signal exits 255" "" -- exec local -- 'kill -TERM $$'
expect 14 "exec past --exec-timeout fails with timeout" "" -- exec local --exec-timeout 1 -- sleep 5
expect 3 "exec on a missing host is not_found" "" -- exec nope -- id
expect 0 "host test" "" -- host test local
check "host test says it logged in" '[[ "$out" == *"logged in"* ]]'
for cmd in "exec local -- echo same" "exec local -- exit 7" "--json exec nope -- id" "host test nope"; do
  # shellcheck disable=SC2086
  printf '' | no_tty "$flint" $cmd >"$tmp/sout" 2>"$tmp/serr"; sstatus=$?
  # shellcheck disable=SC2086
  local_run "" -- $cmd
  checks=$((checks + 1))
  if [[ "$sstatus" == "$lstatus" ]] && cmp -s "$tmp/sout" "$tmp/lout" && cmp -s "$tmp/serr" "$tmp/lerr"; then
    echo "ok    same stdout, stderr and exit: flint $cmd"
  else
    failures=$((failures + 1))
    echo "FAIL  served and local differ: flint $cmd (exit $sstatus vs $lstatus)"
    diff "$tmp/sout" "$tmp/lout" | head -5; diff "$tmp/serr" "$tmp/lerr" | head -5
  fi
done

printf '' | no_tty "$flint" exec local -- sleep 4 >/dev/null 2>&1 &
long_pid=$!
sleep 1
t0=$(python3 -c 'import time; print(time.time())')
expect 0 "another command while an exec runs" "" -- host list
t1=$(python3 -c 'import time; print(time.time())')
check "it is answered at once, not after the exec (several clients)" 'python3 -c "import sys; sys.exit(0 if $t1 - $t0 < 2.5 else 1)"'
wait "$long_pid"
check "and the exec still ends well" '[[ $? == 0 ]]'

cat > "$tmp/connect_tty.py" <<'PY'
import fcntl, json, os, pty, select, struct, sys, termios, time
flint, args = sys.argv[1], sys.argv[2:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(flint, [flint] + args)
def setsize(rows, cols):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
setsize(24, 80)
buf = b""
def pump(until, secs=20):
    global buf
    end = time.time() + secs
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try:
                d = os.read(fd, 4096)
            except OSError:
                return False
            if not d:
                return False
            buf += d
            if until and until in buf[-4096:]:
                return True
    return False
prompted = asked_master = ready = False
deadline = time.time() + 40
while time.time() < deadline and not ready:
    pump(None, 0.5)
    if b"Master password" in buf:
        asked_master = True
        break
    if b"(yes/no)?" in buf and not prompted:
        prompted = True
        os.write(fd, b"yes\n")
    elif prompted:
        os.write(fd, b"echo READY$((40+2))\n")
        ready = pump(b"READY42", 2)
os.write(fd, b"stty size\n"); size1 = pump(b"24 80")
setsize(40, 100); time.sleep(0.5)
os.write(fd, b"stty size; exit 6\n"); size2 = pump(b"40 100")
pump(None, 10)
_, status = os.waitpid(pid, 0)
print(json.dumps({"prompted": prompted, "asked_master": asked_master, "size1": size1, "size2": size2,
                  "code": os.waitstatus_to_exitcode(status), "out": buf.decode(errors="replace")}))
PY
checks=$((checks + 1))
pty_out="$(python3 -I "$tmp/connect_tty.py" "$flint" connect tty 2>&1)"
echo "$pty_out" >> "$all_out"
if echo "$pty_out" | python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null; then echo "ok    connect through the app ran on a pty"; else failures=$((failures + 1)); echo "FAIL  connect on a pty: $pty_out"; fi
check "connect never asked for the master password: the app holds the vault" '[[ "$(echo "$pty_out" | json_get "d[\"asked_master\"]")" == "False" ]]'
check "the app relayed the host key question to this terminal" '[[ "$(echo "$pty_out" | json_get "d[\"prompted\"]")" == "True" ]]'
check "the remote PTY started at the terminal's size (24x80)" '[[ "$(echo "$pty_out" | json_get "d[\"size1\"]")" == "True" ]]'
check "a local resize reached the remote PTY (40x100)" '[[ "$(echo "$pty_out" | json_get "d[\"size2\"]")" == "True" ]]'
check "connect exits with the remote shell status" '[[ "$(echo "$pty_out" | json_get "d[\"code\"]")" == "6" ]]'
expect 0 "the key trusted on that terminal was recorded in the app's vault" "" -- --json known-host list
check "localhost is a known host" '[[ "$out" == *"[localhost]:$P"* ]]'

echo "== caller approval (milestone 12, Principle 12)"
# Under perl, which stays as the parent, each run is a new caller: no grant covers it.
new_caller() {  # <stdin> -- <flint args...>  ($out, $err, $status)
  local input="$1"; shift 2
  printf '%s' "$input" | no_tty perl -e 'exit(system(@ARGV) >> 8)' "$flint" "$@" >"$tmp/out" 2>"$tmp/err"
  status=$?
  out="$(cat "$tmp/out")"; err="$(cat "$tmp/err")"
  { echo "\$ (new caller) flint $*"; echo "$out"; echo "$err"; } >> "$all_out"
}
new_caller "" -- host show deny-me
check "a request the owner denies fails with denied (15)" '[[ $status == 15 && "$err" == *"denied"* ]]'
check "the window names the caller after the program that started flint" 'grep -q "asking the owner to approve flint, started by perl" "$tmp/app.log"'
new_caller "" -- --json host show deny-me
check "denied is a JSON error with --json" '[[ $status == 15 && "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "denied" ]]'
t0=$(python3 -c 'import time; print(time.time())')
new_caller "" -- host show timeout-me
t1=$(python3 -c 'import time; print(time.time())')
check "a request nobody answers fails with approval_timeout (16)" '[[ $status == 16 && "$err" == *"nobody answered"* ]]'
check "after the wait, not before" 'python3 -c "import sys; sys.exit(0 if 7 < $t1 - $t0 < 20 else 1)"'
check "the client said it was waiting" '[[ "$err" == *"Waiting for approval in Flint"* ]]'
new_caller "" -- exec local -- echo deny-me
check "a denied exec runs nothing and says why" '[[ $status == 15 && "$out" != *deny-me* && "$err" == *"denied"* ]]'
check "a session told the client it was waiting" '[[ "$err" == *"Waiting for approval in Flint"* ]]'

# One caller, several commands: a grant scoped to one host is reused for it, and
# does not reach another host.
cat > "$tmp/scope.pl" <<'PL'
my ($flint, @runs) = @ARGV;
my @codes;
for my $r (@runs) { push @codes, system($flint, split(/ /, $r)) >> 8; }
print join(",", @codes), "\n";
PL
asked_scope_before=$(grep -c "asking the owner to approve" "$tmp/app.log")
scope_out="$(printf '' | no_tty perl "$tmp/scope.pl" "$flint" "exec local -- echo scope-me" "exec local -- echo again" "host list" "exec tty -- echo deny-me" 2>"$tmp/scope.err")"
echo "$scope_out" >> "$all_out"
asked_scope_after=$(grep -c "asking the owner to approve" "$tmp/app.log")
check "a grant for one host runs there, again without asking, and reads" '[[ "$scope_out" == *"0,0,0,"* ]]'
check "another host is outside it and asks again (denied here)" '[[ "$scope_out" == *",15" ]]'
check "two approvals for four commands" '[[ $((asked_scope_after - asked_scope_before)) == 2 ]]'
expect 0 "the grants in force while the vault stays unlocked" "" -- --json vault status

echo "== tokens (milestone 12b, D-046)"
asked_tok_before=$(grep -c "asking the owner to approve" "$tmp/app.log")
new_caller "" -- token create --name nightly --allow exec,read --hosts local
tok="$out"
check "token create, allowed in the window, prints only the token on stdout" '[[ $status == 0 && "$tok" =~ ^flint_[0-9a-f]{16}_[0-9a-f]{64}$ ]]'
check "and says on stderr it is shown this once" '[[ "$err" == *"shows it this once"* ]]'
# One caller twice: a grant never covers token create, so each one asks.
twice_out="$(printf '' | no_tty perl "$tmp/scope.pl" "$flint" "token create --name twice-a --allow read" "token create --name twice-b --allow read" 2>"$tmp/twice.err")"
asked_tok_after=$(grep -c "asking the owner to approve" "$tmp/app.log")
check "a caller that created a token is asked again for the next one" '[[ "$twice_out" == *"0,0"* && $((asked_tok_after - asked_tok_before)) == 3 ]]'
new_caller "" -- token create --name deny-me-token --allow read
check "a token the owner denies is not created (denied, 15)" '[[ $status == 15 && "$out" != flint_* ]]'
new_caller "" -- token create --name bad --allow exec --hosts ghost
check "a token for a host the vault lacks never reaches the window" '[[ $status == 3 && "$(grep -c "asking the owner to approve" "$tmp/app.log")" == $((asked_tok_after + 1)) ]]'
asked_use_before=$(grep -c "asking the owner to approve" "$tmp/app.log")
FLINT_TOKEN="$tok" new_caller "" -- exec local -- echo via-token
check "FLINT_TOKEN runs an exec in its scope, with no window" '[[ $status == 0 && "$out" == *via-token* ]]'
FLINT_TOKEN="$tok" new_caller "" -- host list
check "and reads" '[[ $status == 0 && "$out" == *local-web* ]]'
FLINT_TOKEN="$tok" new_caller "" -- exec tty -- echo outside
check "a host outside the token is refused at once (denied)" '[[ $status == 15 && "$out" != *outside* && "$err" == *"does not allow"* ]]'
FLINT_TOKEN="$tok" new_caller "" -- host add tok-host --hostname 10.0.0.9
check "a change the token does not allow is refused" '[[ $status == 15 ]]'
FLINT_TOKEN="$tok" new_caller "" -- token create --name minted --allow read
check "a token cannot create a token" '[[ $status == 15 && "$err" == *"cannot create tokens"* ]]'
FLINT_TOKEN="flint_not-a-token" new_caller "" -- host list
check "a malformed token is refused without echoing it" '[[ $status == 15 && "$err" != *not-a-token* ]]'
FLINT_TOKEN="${tok%?}0" new_caller "" -- host list
[[ "${tok: -1}" == 0 ]] && FLINT_TOKEN="${tok%?}1" new_caller "" -- host list
check "a token with a changed secret is refused" '[[ $status == 15 ]]'
check "none of that asked the owner" '[[ "$(grep -c "asking the owner to approve" "$tmp/app.log")" == $asked_use_before ]]'
expect 0 "token list" "" -- --json token list
check "it lists the token by name, with no secret and no hash" '[[ "$out" == *nightly* && "$out" != *"${tok#flint_*_}"* && "$out" != *\"hash\"* ]]'
expect 0 "token revoke by name" "" -- token revoke nightly
FLINT_TOKEN="$tok" new_caller "" -- exec local -- echo after-revoke
check "a revoked token is refused" '[[ $status == 15 && "$out" != *after-revoke* && "$err" == *revoked* ]]'
local_run "" -- --json token list
check "the CLI on its own lists tokens too, from the vault" '[[ $lstatus == 0 && "$lout" == *revoked* ]]'
local_run "" -- token create --name local --allow read
check "but creates none: that needs Flint (locked)" '[[ $lstatus == 5 && "$lerr" == *"runs in Flint"* ]]'

# `exec --sudo` (milestone 13, D-039, D-047): the real sudo in the Linux image
# (FLINT_E2E_SUDO=1, the e2e user is a sudoer with that password), a stand-in on
# macOS (scripts/test.sh). Either way the password is flint-e2e-login-pw, and the
# page types it in the window when the argv names typed-pw or save-pw.
if [[ -n "${FLINT_FAKE_SUDO_DIR:-}" || -n "${FLINT_E2E_SUDO:-}" ]]; then
  echo "== exec --sudo (milestone 13)"
  SUDO_PW="flint-e2e-login-pw"
  root_check='if [ "$(id -u)" = 0 ] || [ -n "$FAKE_SUDO_ROOT" ]; then echo as-root; fi'
  asked_sudo_before=$(grep -c "asking the owner to approve" "$tmp/app.log")
  new_caller "" -- exec local --sudo -- sh -c "$root_check" typed-pw
  check "exec --sudo runs as root with the password typed in the window" '[[ $status == 0 && "$out" == as-root ]]'
  check "the caller sees neither sudo's prompt nor the password" '[[ "$err$out" != *flint-sudo* && "$err$out" != *"$SUDO_PW"* ]]'
  new_caller "" -- exec local --sudo -- true deny-me
  check "a sudo command the owner denies fails with denied (15)" '[[ $status == 15 ]]'
  new_caller "" -- exec local --sudo -- true wrong-pw
  check "a wrong sudo password fails with sudo_password (18)" '[[ $status == 18 && "$err" == *"refused the password"* ]]'
  new_caller "" -- --json exec local --sudo -- sh -c "$root_check" save-pw
  check "--json captures a sudo command's output" '[[ $status == 0 && "$(echo "$out" | json_get "d[\"stdout\"]")" == as-root* ]]'
  local_run "" -- --json host show local
  check "the window saved the sudo password for the host, as asked" '[[ "$(echo "$lout" | json_get "d[\"has_sudo_password\"]")" == "True" && "$lout" != *"$SUDO_PW"* ]]'
  sudo_out="$(printf '' | no_tty perl "$tmp/scope.pl" "$flint" "host list" "exec local --sudo -- echo first" "exec local --sudo -- echo second" 2>"$tmp/sudo.err")"
  echo "$sudo_out" >> "$all_out"
  asked_sudo_after=$(grep -c "asking the owner to approve" "$tmp/app.log")
  check "no grant covers sudo: each command is asked for, with the saved password" '[[ "$sudo_out" == *"0,0,0"* && $((asked_sudo_after - asked_sudo_before)) == 7 ]]'
  FLINT_TOKEN="$tok" new_caller "" -- exec local --sudo -- id
  check "a token never runs sudo" '[[ $status == 15 && "$err" == *"cannot run commands as root"* ]]'
  new_caller "" -- exec nope --sudo -- id
  check "sudo on a host the vault lacks never reaches the window" '[[ $status == 3 && "$(grep -c "asking the owner to approve" "$tmp/app.log")" == $asked_sudo_after ]]'
  if [[ -n "${FLINT_FAKE_SUDO_DIR:-}" ]]; then
    touch "$FLINT_FAKE_SUDO_DIR/not-a-sudoer"
    new_caller "" -- exec local --sudo -- id
    check "a login user who may not sudo fails with not_sudoer (17)" '[[ $status == 17 && "$err" == *"may not use sudo"* ]]'
    rm -f "$FLINT_FAKE_SUDO_DIR/not-a-sudoer"
  fi
  check "no sudo password in the app log" '! grep -q "$SUDO_PW" "$tmp/app.log"'
else
  echo "skip  exec --sudo (no sudo to run against: macOS stand-in or FLINT_E2E_SUDO=1)"
fi

echo "== another vault"
expect 5 "another vault than the app's: locked, with no terminal" "" -- --vault "$other" host list
check "it names the vault Flint has open" '[[ "$err" == *"Flint has vault"* ]]'
expect 0 "and opens with its master password" "$MASTER"$'\n' -- --vault "$other" host list --master-stdin
expect 0 "make the served vault current again" "" -- vault use "$vault"
expect 0 "vault unlock: Flint already holds it" "" -- vault unlock
check "it says so" '[[ "$out" == *"in Flint"* ]]'

echo "== a second launch of Flint shows the running one and exits (milestone 14)"
second_start=$(date +%s)
second_status=0
env -u FLINT_GUI_E2E timeout 20 "${app[@]}" >"$tmp/second.log" 2>&1 || second_status=$?
second_took=$(( $(date +%s) - second_start ))
check "the second launch exits at once, with status 0" '[[ $second_status == 0 && $second_took -lt 10 ]]'
check "it says Flint is already running" 'grep -q "already running" "$tmp/second.log"'
check "the running app is still serving" '[[ -S "$sock" ]]'
expect 0 "and the CLI is still served" "" -- --json vault status

echo "== a rename, then the stop host"
expect 0 "vault rename" "" -- vault rename "Served Renamed"
check "the recent list has the new name" 'grep -q "Served Renamed" "$FLINT_CONFIG_DIR/vaults.json"'
echo "== lock from the CLI, then a command asks the window to unlock"
expect 0 "vault lock locks the window" "" -- vault lock
expect 0 "vault status: locked" "" -- --json vault status
check "status says locked" '[[ "$(echo "$out" | json_get "d[\"unlocked\"]")" == "False" ]]'
expect 5 "a command on the locked vault, with no terminal: locked" "" -- host list
check "it says Flint is asking for the master password" '[[ "$err" == *"Flint is asking"* ]]'
expect 0 "vault unlock waits for the window" "" -- vault unlock
expect 0 "and the CLI is served again" "" -- --json vault status
check "status says unlocked" '[[ "$(echo "$out" | json_get "d[\"unlocked\"]")" == "True" ]]'
check "unlocking with Allow ticked allowed the command that asked" 'grep -q "allowed flint, started by .* (1h) at unlock" "$tmp/app.log"'
asked_after_unlock=$(grep -c "asking the owner to approve" "$tmp/app.log")

# Linux, on a private session bus only (scripts/linux/inside.sh): never on a
# desktop's real bus, where every program would hear the screensaver turn on.
if [[ "${FLINT_TEST_PRIVATE_DBUS:-}" == 1 ]]; then
  echo "== a screensaver turning on locks the vault (D-Bus)"
  dbus-send --session --type=signal /org/gnome/ScreenSaver org.gnome.ScreenSaver.ActiveChanged boolean:true
  # The app's log, not `vault status`: the page unlocks again as soon as it sees the
  # lock screen, so a status poll can miss a lock that did happen.
  for _ in $(seq 1 150); do
    grep -q "vault locked (screen)" "$tmp/app.log" && break
    sleep 0.1
  done
  check "ActiveChanged(true) of org.gnome.ScreenSaver locks the vault" 'grep -q "vault locked (screen)" "$tmp/app.log"'
  for _ in $(seq 1 200); do
    st="$(printf '' | no_tty "$flint" --json vault status 2>/dev/null | json_get 'd["unlocked"]')"
    [[ "$st" == "True" ]] && break
    sleep 0.1
  done
  check "the window unlocks it again" '[[ "$st" == "True" ]]'
fi

expect 0 "add the stop host" "" -- host add e2e-stop --hostname 10.0.0.9
check "the lock ended the whole-vault grant: a write asks again" '[[ $(grep -c "asking the owner to approve" "$tmp/app.log") -gt $asked_after_unlock ]]'

for _ in $(seq 1 300); do kill -0 "$app_pid" 2>/dev/null || break; sleep 0.1; done
wait "$app_pid"; app_pid=""
sed 's/^/app: /' "$tmp/app.log" | grep -E "ok |FAILED|checks passed|e2e:|page text|locks on|vault locked" || true
check "the window checks passed" 'grep -q "^e2e: pass" "$tmp/app.log"'
check "a click beside the approval window does not deny it" 'grep -q "ok   a click beside the approval window" "$tmp/app.log" && ! grep -q "FAIL a click beside" "$tmp/app.log"'
check "the approval countdown shows the time left" 'grep -q "ok   the countdown shows the time left" "$tmp/app.log" && ! grep -q "FAIL the countdown" "$tmp/app.log"'
check "the socket file is removed when the app quits" '[[ ! -e "$sock" ]]'
expect 5 "with the app gone, the CLI is on its own again: locked" "" -- host list

echo "== with Flint closed, flint starts it on its unlock screen (D-042)"
E2E_MASTER="$MASTER" python3 -I - "$root/scripts/serve-e2e-launch.js" "$tmp/launch.js" <<'PY'
import os, sys
src = open(sys.argv[1]).read().replace("@@MASTER@@", os.environ["E2E_MASTER"])
open(sys.argv[2], "w").write(src)
PY
if [[ "$(uname -s)" == Darwin ]]; then real_app="$root/build/gui/Flint.app/Contents/MacOS/Flint"; else real_app="$root/scripts/linux/xvfb-flint.sh"; fi
# What `flint` starts: the app, its output kept for this report.
launch_app="$tmp/launch-app.sh"
printf '#!/usr/bin/env bash\nexec "%s" >"%s" 2>&1\n' "$real_app" "$tmp/launched.log" > "$launch_app"
chmod +x "$launch_app"
FLINT_APP="$launch_app" FLINT_GUI_E2E="$tmp/launch.js" expect 5 "a command with Flint closed starts it and fails with locked" "" -- host list
check "it says Flint is asking" '[[ "$err" == *"Flint is asking"* ]]'
check "Flint is running and serving" '[[ -S "$sock" ]]'
expect 0 "vault unlock waits until the window unlocks" "" -- vault unlock
expect 0 "the command now runs in the app it started" "" -- host list
check "it lists the hosts" '[[ "$out" == *e2e-stop* ]]'
expect 0 "add the second stop host" "" -- host add e2e-stop-2 --hostname 10.0.0.10
for _ in $(seq 1 300); do [[ -S "$sock" ]] || break; sleep 0.1; done
check "the launched app quit when done" '[[ ! -S "$sock" ]]'
for _ in $(seq 1 100); do grep -q "^e2e:" "$tmp/launched.log" 2>/dev/null && break; sleep 0.1; done
sed 's/^/launched app: /' "$tmp/launched.log" 2>/dev/null | grep -E "ok |FAILED|e2e:" || true
check "the launched app's checks passed" 'grep -q "^e2e: pass" "$tmp/launched.log"'

echo "== no secret left the app (Principle 6)"
check "no password in any output" '! grep -q -e "$HOST_PW" -e "$CRED_PW" "$all_out"'
check "no private key in any output" '! grep -q "PRIVATE KEY" "$all_out"'
check "no password in the app log" '! grep -q -e "$HOST_PW" -e "$CRED_PW" "$tmp/app.log"'
check "no token in the app log" '! grep -q "${tok#flint_*_}" "$tmp/app.log"'

echo
echo "serve-e2e: $((checks - failures))/$checks checks passed"
[[ "$failures" == 0 ]]
