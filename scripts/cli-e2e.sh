#!/usr/bin/env bash
# End-to-end run of the `flint` CLI against throwaway vaults.
#
#   scripts/cli-e2e.sh            # builds, then runs every check
#
# Checks exit codes, --json output, the keychain cache, and that no secret value
# (passwords, private key, passphrase) and no host metadata ever appears in CLI
# output or in the vault file (Principles 5, 6 and 7).
#
# It uses its own config folder and temp vaults, and removes its keychain entries
# with `vault lock` at the end. FLINT_KEYCHAIN=off is exercised as well.
#
# The SSH checks need the throwaway sshds and agent of scripts/test.sh, so the
# script re-runs itself under it when they are not there.
set -o pipefail  # no -u: macOS bash 3.2 treats an empty array as unset

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  FLINT_TEST_CMD="$root/scripts/cli-e2e.sh" exec "$root/scripts/test.sh"
fi
cd "$root"
. "$root/scripts/env.sh"
cfire build >/dev/null || { echo "cli-e2e: build failed" >&2; exit 1; }
flint="$root/build/flint"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-e2e.XXXXXX")"
export FLINT_CONFIG_DIR="$tmp/config"
# A locked vault with no terminal would start the desktop app (D-042): not here.
export FLINT_APP=off
all_out="$tmp/all-output"
: > "$all_out"
failures=0
checks=0

MASTER="correct horse battery staple"
HOST_PW="e2e-host-password-91f3"
CRED_PW="e2e-cred-password-77ab"
PASSPHRASE="e2e-key-passphrase-5c2d"

cleanup() {
  [[ -n "${fwd_pid:-}" ]] && kill "$fwd_pid" 2>/dev/null
  for v in "$tmp"/*.flint; do
    [[ -f "$v" ]] && "$flint" --vault "$v" vault lock >/dev/null 2>&1
  done
  rm -rf "$tmp"
}
trap cleanup EXIT

# Runs with no controlling terminal, so Flint can never prompt (and never hang).
no_tty() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' "$@"; }

# expect <exit code> <description> <stdin text> -- <flint args...>
# Leaves the command's stdout in $out and stderr in $err.
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

# check <description> <shell condition>
check() {
  checks=$((checks + 1))
  if eval "$2"; then echo "ok    $1"; else failures=$((failures + 1)); echo "FAIL  $1"; fi
}

json_get() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1], {"d": d}))' "$1"; }
is_json() { python3 -c 'import json,sys; json.loads(sys.stdin.read())' 2>/dev/null; }

echo "== vault lifecycle"
vault="$tmp/home.flint"
expect 0 "vault create" "$MASTER"$'\n' -- --json vault create "$vault" --name "Home Lab" --master-stdin
check "create prints JSON" '[[ "$(echo "$out" | json_get "d[\"name\"]")" == "Home Lab" ]]'
cached="$(echo "$out" | json_get 'd["cached"]')"
echo "      keychain cache: $cached"
# Without a cached key every command needs the master password on stdin.
if [[ "$cached" == "True" ]]; then M=(); MI=""; else M=(--master-stdin); MI="$MASTER"$'\n'; fi

check "salt is the first 16 bytes, rest is not SQLite" '! head -c 64 "$vault" | grep -aq "SQLite format 3"'
expect 4 "create refuses an existing file" "$MASTER"$'\n' -- vault create "$vault" --master-stdin
expect 7 "create refuses a short master password" "short"$'\n' -- vault create "$tmp/short.flint" --master-stdin
expect 0 "vault list" "" -- --json vault list
check "vault list marks the current vault" '[[ "$(echo "$out" | json_get "d[0][\"current\"]")" == "True" ]]'
expect 0 "vault status" "" -- --json vault status
check "status shows lock state" '[[ "$(echo "$out" | json_get "d[\"cached\"]")" == "$cached" ]]'

echo "== groups and hosts"
expect 0 "group add" "$MI" -- group add "e2e-group-marker/proxmox" "${M[@]}"
expect 4 "group add twice is a conflict" "$MI" -- group add "E2E-GROUP-MARKER/Proxmox" "${M[@]}"
expect 0 "host add bastion" "$MI" -- --json host add bastion --hostname bastion.e2e-hostname-marker.example --user e2e-user-marker --tag edge "${M[@]}"
expect 0 "host add with a password on stdin" "$MI$HOST_PW"$'\n' -- --json host add web-01 --hostname 10.20.30.40 --port 2222 --user root --label "e2e-label-marker" --group e2e-group-marker/web --tag prod --tag web --color "#ff8800" --notes "e2e-notes-marker" --jump bastion --password-stdin "${M[@]}"
check "host add reports has_password, not the password" '[[ "$(echo "$out" | json_get "d[\"has_password\"]")" == "True" ]]'
expect 0 "host list --json" "$MI" -- --json host list "${M[@]}"
check "host list is a JSON array of 2" '[[ "$(echo "$out" | json_get "len(d)")" == "2" ]]'
expect 0 "host list --tag" "$MI" -- --json host list --tag PROD "${M[@]}"
check "tag filter is case-insensitive" '[[ "$(echo "$out" | json_get "len(d)")" == "1" ]]'
expect 0 "host list --group" "$MI" -- --json host list --group e2e-group-marker "${M[@]}"
check "group filter includes subgroups" '[[ "$(echo "$out" | json_get "len(d)")" == "1" ]]'
expect 0 "host show (text)" "$MI" -- host show web-01 "${M[@]}"
check "text show says the password is set" '[[ "$out" == *"password       set"* ]]'
check "text show says sudo uses the login password" '[[ "$out" == *"sudo password  the login password"* ]]'
expect 4 "duplicate alias is a conflict" "$MI" -- host add WEB-01 --hostname x "${M[@]}"
expect 7 "bad port is invalid" "$MI" -- host add bad --hostname x --port 99999 "${M[@]}"
expect 2 "missing hostname is a usage error" "$MI" -- host add nohost "${M[@]}"
expect 2 "unknown flag is a usage error" "" -- host list --bogus
expect 3 "unknown host is not_found" "$MI" -- --json host show nope "${M[@]}"
check "JSON error on stderr with a code" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "not_found" ]]'
check "nothing on stdout for an error" '[[ -z "$out" ]]'
expect 7 "a jump loop is refused" "$MI" -- host edit bastion --jump web-01 "${M[@]}"
expect 0 "host edit" "$MI" -- --json host edit web-01 --port 22 --no-password --tag only "${M[@]}"
check "edit cleared the password" '[[ "$(echo "$out" | json_get "d[\"has_password\"]")" == "False" ]]'
check "edit replaced the tags and port" '[[ "$(echo "$out" | json_get "\",\".join(d[\"tags\"]) + \"/\" + str(d[\"port\"])")" == "only/22" ]]'
expect 4 "removing a jump host in use is refused" "$MI" -- host rm bastion "${M[@]}"
expect 4 "removing a non-empty group is refused" "$MI" -- group rm e2e-group-marker "${M[@]}"
expect 0 "group list" "$MI" -- --json group list "${M[@]}"
check "group list has 3 groups" '[[ "$(echo "$out" | json_get "len(d)")" == "3" ]]'

echo "== keys and credentials"
ssh-keygen -q -t ed25519 -N "$PASSPHRASE" -C e2e -f "$tmp/id_e2e"
key_body="$(sed -n 2p "$tmp/id_e2e")"
expect 7 "an encrypted key without its passphrase is refused" "$MI" -- key add laptop --file "$tmp/id_e2e" "${M[@]}"
expect 0 "key add from a file with the passphrase on stdin" "$MI$PASSPHRASE"$'\n' -- --json key add laptop --file "$tmp/id_e2e" --passphrase-stdin "${M[@]}"
check "key fingerprint matches ssh-keygen" '[[ "$(ssh-keygen -l -E sha256 -f "$tmp/id_e2e.pub")" == *"$(echo "$out" | json_get "d[\"fingerprint\"]")"* ]]'
ssh-keygen -q -t ed25519 -N "" -C e2e2 -f "$tmp/id_plain"
expect 0 "key add from stdin" "$MI$(cat "$tmp/id_plain")" -- --json key add deploy --key-stdin "${M[@]}"
expect 4 "duplicate key name is a conflict" "$MI" -- key add Deploy --file "$tmp/id_plain" "${M[@]}"
expect 7 "a public key is refused" "$MI" -- key add pub --file "$tmp/id_plain.pub" "${M[@]}"
expect 0 "cred add with a password and a key" "$MI$CRED_PW"$'\n' -- --json cred add domain --user 'CORP\e2e-cred-user' --key deploy --password-stdin "${M[@]}"
check "cred shows has_password" '[[ "$(echo "$out" | json_get "d[\"has_password\"]")" == "True" ]]'
expect 0 "host uses the credential and key" "$MI" -- host edit web-01 --cred domain --key laptop "${M[@]}"
expect 4 "removing a key in use is refused" "$MI" -- key rm laptop "${M[@]}"
expect 4 "removing a credential in use is refused" "$MI" -- cred rm domain "${M[@]}"
expect 0 "key list" "$MI" -- --json key list "${M[@]}"
expect 0 "cred list (text)" "$MI" -- cred list "${M[@]}"
expect 0 "key rename" "$MI" -- key rename deploy deploy-2 "${M[@]}"
expect 0 "cred follows the renamed key" "$MI" -- --json cred show domain "${M[@]}"
check "cred key is deploy-2" '[[ "$(echo "$out" | json_get "d[\"key\"]")" == "deploy-2" ]]'

echo "== lock, unlock, wrong password"
expect 0 "vault lock" "" -- vault lock
expect 5 "a locked vault with no terminal fails with locked" "" -- host list
expect 6 "a wrong master password fails with wrong_password" "wrong password here"$'\n' -- host list --master-stdin
expect 0 "the master password on stdin opens it for one command" "$MASTER"$'\n' -- --json host list --master-stdin
expect 5 "and nothing is cached: the next command is locked again" "" -- host list
check "the CLI never caches the key (D-042)" '[[ "$cached" == "False" ]]'
expect 2 "vault unlock takes no master password: Flint asks for it" "$MASTER"$'\n' -- vault unlock --master-stdin
expect 5 "vault unlock with Flint not running: locked" "" -- vault unlock
check "it says to open Flint" '[[ "$err" == *"open Flint"* ]]'

echo "== several vaults"
work="$tmp/work.flint"
expect 0 "second vault" "$MASTER"$'\n' -- vault create "$work" --master-stdin
expect 0 "the new vault is current" "$MI" -- --json host list "${M[@]}"
check "the work vault is empty" '[[ "$(echo "$out" | json_get "len(d)")" == "0" ]]'
expect 0 "--vault by name reaches the other vault" "$MI" -- --json --vault "home lab" host list "${M[@]}"
check "home vault still has 2 hosts" '[[ "$(echo "$out" | json_get "len(d)")" == "2" ]]'
expect 0 "vault use" "" -- vault use "Home Lab"
expect 0 "vault list" "" -- --json vault list
check "home is current again" '[[ "$(echo "$out" | json_get "d[0][\"name\"]")" == "Home Lab" ]]'
expect 3 "unknown vault name" "" -- --vault nope vault status
expect 0 "vault forget" "" -- vault forget work
check "the forgotten vault file still exists" '[[ -f "$work" ]]'
expect 0 "vault open adds it back" "$MASTER"$'\n' -- --json vault open "$work" --master-stdin
check "opened vault reports its name" '[[ "$(echo "$out" | json_get "d[\"name\"]")" == "work" ]]'

echo "== vault rename and a moved vault"
expect 0 "vault rename" "$MI" -- --json vault rename "Work Two" "${M[@]}"
check "rename reports the new name" '[[ "$(echo "$out" | json_get "d[\"name\"]")" == "Work Two" ]]'
expect 0 "vault rename (text)" "$MI" -- vault rename "Work Three" "${M[@]}"
check "text rename names old and new" '[[ "$out" == "Renamed vault '"'"'Work Two'"'"' to '"'"'Work Three'"'"'." ]]'
expect 4 "rename to another recent vault's name is a conflict" "$MI" -- vault rename "home lab" "${M[@]}"
expect 7 "rename to an empty name is invalid" "$MI" -- vault rename "" "${M[@]}"
expect 2 "rename needs exactly one name" "" -- vault rename
expect 0 "vault list after rename" "" -- --json vault list
check "the recent entry has the new name and an id" '[[ "$(echo "$out" | json_get "d[0][\"name\"]")" == "Work Three" && "$(python3 -c "import json;print(len(json.load(open(\"$FLINT_CONFIG_DIR/vaults.json\"))[\"vaults\"][0][\"id\"]))")" == "32" ]]'
check "the vault list keeps no stale entries" '[[ "$(echo "$out" | json_get "len(d)")" == "2" ]]'
moved="$tmp/moved/work.flint"
mkdir -p "$tmp/moved" && mv "$work" "$moved"
expect 0 "opening a moved vault" "$MI" -- --json vault open "$moved" "${M[@]}"
check "the moved vault keeps its name" '[[ "$(echo "$out" | json_get "d[\"name\"]")" == "Work Three" ]]'
expect 0 "vault list after the move" "" -- --json vault list
check "the moved vault replaced its stale entry" '[[ "$(echo "$out" | json_get "len(d)")" == "2" && "$(echo "$out" | json_get "d[0][\"path\"]")" == "$moved" && "$(echo "$out" | json_get "all(v[\"exists\"] for v in d)")" == "True" ]]'
mv "$moved" "$work"
expect 0 "the vault is back where it was" "$MI" -- vault open "$work" "${M[@]}"
expect 0 "and renamed back" "$MI" -- vault rename work "${M[@]}"

echo "== keychain turned off"
off="$tmp/off.flint"
FLINT_KEYCHAIN=off expect 0 "create with the keychain off" "$MASTER"$'\n' -- --json vault create "$off" --master-stdin
check "nothing cached with the keychain off" '[[ "$(echo "$out" | json_get "d[\"cached\"]")" == "False" ]]'
FLINT_KEYCHAIN=off expect 5 "keychain off and no password: locked" "" -- --vault "$off" host list
FLINT_KEYCHAIN=off expect 0 "keychain off with --master-stdin works" "$MASTER"$'\n' -- --vault "$off" host list --master-stdin

echo "== no import"
expect 2 "the Tether importer is gone (milestone 24)" "" -- import tether "$tmp/old.tether"
check "it is an unknown command" '[[ "$err" == *"unknown command '"'"'import'"'"'"* ]]'

echo "== ssh: exec, jump hosts, known hosts"
P="$FLINT_TEST_SSH_PORT"; P2="$FLINT_TEST_SSH_PORT2"; P3=$((P2 + 1))
sv="$tmp/ssh.flint"
test_key_body="$(sed -n 2p "$FLINT_TEST_SSH_KEY")"
expect 0 "ssh vault" "$MASTER"$'\n' -- vault create "$sv" --master-stdin
if [[ "$cached" == "True" ]]; then SM=(); SMI=""; else SM=(--master-stdin); SMI="$MASTER"$'\n'; fi
expect 0 "key add (test key)" "$SMI" -- key add tkey --file "$FLINT_TEST_SSH_KEY" "${SM[@]}"
expect 0 "host add local" "$SMI" -- host add local --hostname 127.0.0.1 --port "$P" --user "$USER" --key tkey "${SM[@]}"
expect 0 "host add inner behind local" "$SMI" -- host add inner --hostname 127.0.0.1 --port "$P2" --user "$USER" --key tkey --jump local "${SM[@]}"
expect 11 "an unknown host key with no terminal fails with host_key" "$SMI" -- --json exec local "${SM[@]}" -- echo hi
check "the host_key error is JSON with its code" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "host_key" ]]'
check "the host_key error shows the fingerprint" '[[ "$err" == *"SHA256:"* ]]'
expect 0 "exec with --accept-new-host-key" "$SMI" -- exec local --accept-new-host-key "${SM[@]}" -- echo e2e-exec-ok
check "exec streams stdout" '[[ "$out" == "e2e-exec-ok" ]]'
expect 3 "exec exits with the remote status" "$SMI" -- exec local "${SM[@]}" -- exit 3
expect 4 "exec --json captures both streams and the status" "$SMI" -- --json exec local "${SM[@]}" -- 'echo out-line; echo err-line >&2; exit 4'
check "exec --json stdout" '[[ "$(echo "$out" | json_get "d[\"stdout\"]")" == "out-line" ]]'
check "exec --json stderr" '[[ "$(echo "$out" | json_get "d[\"stderr\"]")" == "err-line" ]]'
check "exec --json exit_code" '[[ "$(echo "$out" | json_get "d[\"exit_code\"]")" == "4" ]]'
expect 0 "flags after -- go to the remote command" "$SMI" -- exec local "${SM[@]}" -- echo --json -x
check "the remote saw --json" '[[ "$out" == "--json -x" ]]'
expect 0 "exec through a jump host" "$SMI" -- --json exec inner --accept-new-host-key "${SM[@]}" -- echo via-jump
check "the jump host output arrived" '[[ "$(echo "$out" | json_get "d[\"stdout\"]")" == "via-jump" ]]'
expect 255 "a signal exits 255" "$SMI" -- exec local "${SM[@]}" -- 'kill -TERM $$'
expect 14 "exec past --exec-timeout fails with timeout" "$SMI" -- exec local --exec-timeout 1 "${SM[@]}" -- sleep 5
expect 0 "known-host list" "$SMI" -- --json known-host list "${SM[@]}"
check "both hosts are known" '[[ "$(echo "$out" | json_get "len(d)")" == "2" ]]'
check "known hosts name their host" '[[ "$(echo "$out" | json_get "d[0][\"host\"]")" == "local" ]]'

echo "== ssh: auth and network failures"
expect 0 "host add with no key" "$SMI" -- host add bare --hostname 127.0.0.1 --port "$P" --user "$USER" "${SM[@]}"
expect 0 "the agent authenticates a host with no key" "$SMI" -- exec bare --accept-new-host-key "${SM[@]}" -- true
SSH_AUTH_SOCK= expect 12 "no key and no agent fails with auth" "$SMI" -- --json exec bare "${SM[@]}" -- true
check "the auth error names what was tried" '[[ "$err" == *"SSH agent"* ]]'
expect 0 "host add on a closed port" "$SMI" -- host add dead --hostname 127.0.0.1 --port 1 --user "$USER" "${SM[@]}"
expect 13 "a closed port fails with network" "$SMI" -- exec dead --timeout 3 "${SM[@]}" -- true
expect 0 "host add with no user" "$SMI" -- host add nouser --hostname 127.0.0.1 --port "$P" "${SM[@]}"
expect 7 "a host with no user is invalid" "$SMI" -- exec nouser "${SM[@]}" -- true
expect 2 "exec without -- is a usage error" "$SMI" -- exec local "${SM[@]}"
expect 2 "connect without an alias is a usage error" "" -- connect
expect 7 "a bad --timeout is invalid" "$SMI" -- exec local --timeout 0 "${SM[@]}" -- true
expect 3 "exec on an unknown alias is not_found" "$SMI" -- exec nope "${SM[@]}" -- true

echo "== ssh: host test"
expect 0 "host test on a known host" "$SMI" -- host test local "${SM[@]}"
check "host test says the connection works" '[[ "$out" == "Connection to '"'"'local'"'"' works: $USER@127.0.0.1:$P, host key verified, logged in ("*" ms)." ]]'
expect 0 "host test --json through a jump host" "$SMI" -- --json host test inner "${SM[@]}"
check "host test --json counts both hops" '[[ "$(echo "$out" | json_get "d[\"hops\"]")" == "2" ]]'
check "host test --json names the host" '[[ "$(echo "$out" | json_get "d[\"host\"]")" == "inner" ]]'
SSH_AUTH_SOCK= expect 12 "host test with no usable method fails with auth" "$SMI" -- --json host test bare "${SM[@]}"
check "host test reports auth as JSON" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "auth" ]]'
expect 13 "host test on a closed port fails with network" "$SMI" -- host test dead --timeout 3 "${SM[@]}"
expect 3 "host test on an unknown alias is not_found" "$SMI" -- host test nope "${SM[@]}"
expect 2 "host test takes no remote command" "$SMI" -- host test local "${SM[@]}" -- true

echo "== ssh: a hostname with several addresses"
# The test sshd listens on 127.0.0.1 only. `localhost` resolves to ::1 first on Debian
# (and 127.0.0.1 first on macOS): Flint tries each address in turn, as ssh does.
expect 0 "host add by name" "$SMI" -- host add byname --hostname localhost --port "$P" --user "$USER" --key tkey "${SM[@]}"
expect 0 "exec on a name that resolves to IPv6 and IPv4" "$SMI" -- exec byname --accept-new-host-key "${SM[@]}" -- echo by-name-ok
check "the command ran over the IPv4 address" '[[ "$out" == "by-name-ok" ]]'
expect 0 "host add with a name that does not resolve" "$SMI" -- host add nowhere --hostname no-such-host.invalid --user "$USER" "${SM[@]}"
expect 13 "exec on a name that does not resolve" "$SMI" -- exec nowhere --timeout 3 "${SM[@]}" -- true
check "the error says the name did not resolve" '[[ "$err" == *"cannot resolve no-such-host.invalid"* ]]'
# The interactive connect below expects localhost's key to be new.
expect 0 "known-host rm by name" "$SMI" -- known-host rm byname "${SM[@]}"
expect 0 "host rm by name" "$SMI" -- host rm byname "${SM[@]}"
expect 0 "host rm nowhere" "$SMI" -- host rm nowhere "${SM[@]}"

echo "== ssh: initial command"
expect 0 "host edit --command --no-keep-shell" "$SMI" -- --json host edit local --command 'echo cmd-$((40+2))' --no-keep-shell "${SM[@]}"
check "--json shows the command" '[[ "$(echo "$out" | json_get "d[\"command\"]")" == '"'"'echo cmd-$((40+2))'"'"' ]]'
check "--json shows keep_shell off" '[[ "$(echo "$out" | json_get "d[\"keep_shell\"]")" == "False" ]]'
expect 0 "host show (text) shows the command" "$SMI" -- host show local "${SM[@]}"
check "text show says the command ends the session" '[[ "$out" == *"command        echo cmd-\$((40+2)) (ends the session)"* ]]'
expect 0 "exec ignores the initial command" "$SMI" -- exec local "${SM[@]}" -- echo just-exec
check "exec ran only its own command" '[[ "$out" == "just-exec" ]]'
expect 2 "--keep-shell and --no-keep-shell together are a usage error" "$SMI" -- host edit local --keep-shell --no-keep-shell "${SM[@]}"
expect 7 "a multi-line command is invalid" "$SMI" -- host edit local --command $'a\nb' "${SM[@]}"

echo "== sudo, with the CLI on its own"
expect 0 "host edit --sudo-password-stdin" "$SMI"$'sudo-e2e-marker\n' -- --json host edit local --sudo-password-stdin "${SM[@]}"
check "--json says the host has a sudo password, never its value" '[[ "$(echo "$out" | json_get "d[\"has_sudo_password\"]")" == "True" && "$out" != *sudo-e2e-marker* ]]'
expect 0 "host show (text) with a sudo password" "$SMI" -- host show local "${SM[@]}"
check "text show says the sudo password is set" '[[ "$out" == *"sudo password  set"* && "$out" != *sudo-e2e-marker* ]]'
expect 5 "exec --sudo needs Flint" "$SMI" -- exec local --sudo "${SM[@]}" -- id -u
check "it says to open Flint and runs nothing" '[[ "$err" == *"runs only through Flint"* && -z "$out" ]]'
expect 0 "host edit --no-sudo-password" "$SMI" -- --json host edit local --no-sudo-password "${SM[@]}"
check "the sudo password is gone" '[[ "$(echo "$out" | json_get "d[\"has_sudo_password\"]")" == "False" ]]'
cat > "$tmp/cmd_tty.py" <<'PY'
# Waits for <wait_for> (if any), then types <typed> (if any) until <until> shows up:
# input typed ahead is flushed when Flint enters raw mode, so it is resent.
import json, os, pty, select, sys, time
flint, wait_for, typed, until = sys.argv[1], sys.argv[2].encode(), sys.argv[3].encode(), sys.argv[4].encode()
args = sys.argv[5:]
pid, fd = pty.fork()
if pid == 0:
    os.execv(flint, [flint] + args)
buf = b""; end = time.time() + 40; last_typed = 0.0; answered = False
master = os.environ.get("FLINT_E2E_MASTER", "").encode()
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            d = os.read(fd, 4096)
        except OSError:
            break
        if not d:
            break
        buf += d
    if b"Master password" in buf and not answered:
        answered = True
        os.write(fd, master + b"\n")
    if typed and wait_for in buf and until not in buf and time.time() - last_typed > 1.5:
        os.write(fd, typed + b"\n"); last_typed = time.time()
_, status = os.waitpid(pid, 0)
print(json.dumps({"saw": wait_for in buf and until in buf, "code": os.waitstatus_to_exitcode(status), "out": buf.decode(errors="replace")}))
PY
run_tty() {  # <description> <wait for> <typed line> <until> <flint args...>
  local desc="$1"; shift
  checks=$((checks + 1))
  tty_out="$(FLINT_E2E_MASTER="$MASTER" python3 -I "$tmp/cmd_tty.py" "$flint" "$@" 2>&1)"
  echo "$tty_out" >> "$all_out"
  if echo "$tty_out" | is_json && [[ "$(echo "$tty_out" | json_get "d[\"saw\"]")" == "True" ]]; then echo "ok    $desc"; else failures=$((failures + 1)); echo "FAIL  $desc: $tty_out"; fi
}
run_tty "connect runs the initial command on the PTY" "cmd-42" "" "" --vault "$sv" connect local
check "the session ended with the command (status 0)" '[[ "$(echo "$tty_out" | json_get "d[\"code\"]")" == "0" ]]'
expect 0 "host edit --keep-shell" "$SMI" -- host edit local --keep-shell "${SM[@]}"
run_tty "with keep-shell the command runs first" "cmd-42" "echo after-\$((6*7)); exit 9" "after-42" --vault "$sv" connect local
check "a login shell followed the command" '[[ "$(echo "$tty_out" | json_get "d[\"out\"]")" == *"after-42"* ]]'
check "connect exits with that shell's status" '[[ "$(echo "$tty_out" | json_get "d[\"code\"]")" == "9" ]]'
run_tty "connect --no-command starts a plain shell" "" "echo plain-\$((6*7)); exit 4" "plain-42" --vault "$sv" connect local --no-command
check "--no-command skipped the initial command" '[[ "$(echo "$tty_out" | json_get "d[\"out\"]")" != *"cmd-42"* ]]'
check "--no-command ran the typed line" '[[ "$(echo "$tty_out" | json_get "d[\"out\"]")" == *"plain-42"* && "$(echo "$tty_out" | json_get "d[\"code\"]")" == "4" ]]'
expect 0 "host edit --command \"\" clears it" "$SMI" -- --json host edit local --command "" "${SM[@]}"
check "the command is gone" '[[ "$(echo "$out" | json_get "d[\"command\"]")" == "" ]]'

echo "== ssh: a changed host key is refused"
# A TCP forwarder on P3 that reaches whichever sshd $tmp/fwd_target names, so
# one address can present two different host keys.
cat > "$tmp/fwd.py" <<'PY'
import socket, sys, threading
listen, target_file = int(sys.argv[1]), sys.argv[2]
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
while True:
    c, _ = srv.accept()
    u = socket.create_connection(("127.0.0.1", int(open(target_file).read())))
    threading.Thread(target=pipe, args=(c, u), daemon=True).start()
    threading.Thread(target=pipe, args=(u, c), daemon=True).start()
PY
echo "$P" > "$tmp/fwd_target"
python3 -I "$tmp/fwd.py" "$P3" "$tmp/fwd_target" & fwd_pid=$!
sleep 0.5
expect 0 "host add behind the forwarder" "$SMI" -- host add moved --hostname 127.0.0.1 --port "$P3" --user "$USER" --key tkey "${SM[@]}"
expect 0 "first contact records the key" "$SMI" -- exec moved --accept-new-host-key "${SM[@]}" -- true
echo "$P2" > "$tmp/fwd_target"
expect 11 "a changed key is refused, even with --accept-new-host-key" "$SMI" -- exec moved --accept-new-host-key "${SM[@]}" -- echo must-not-run
check "the command did not run" '[[ "$out" != *"must-not-run"* ]]'
check "the error says CHANGED" '[[ "$err" == *"CHANGED"* ]]'
expect 11 "host test refuses a changed key too" "$SMI" -- host test moved "${SM[@]}"
expect 0 "known-host rm forgets it" "$SMI" -- known-host rm moved "${SM[@]}"
expect 3 "known-host rm again is not_found" "$SMI" -- known-host rm moved "${SM[@]}"
expect 0 "after rm the new key is accepted" "$SMI" -- exec moved --accept-new-host-key "${SM[@]}" -- true
kill "$fwd_pid" 2>/dev/null; wait "$fwd_pid" 2>/dev/null; fwd_pid=""

echo "== ssh: interactive connect on a pseudo-terminal"
expect 0 "host add for connect" "$SMI" -- host add tty --hostname localhost --port "$P" --user "$USER" --key tkey --jump local "${SM[@]}"
cat > "$tmp/connect_tty.py" <<'PY'
import fcntl, json, os, pty, select, struct, sys, termios, time
flint, master, args = sys.argv[1], sys.argv[2], sys.argv[3:]
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
# Answer the host key and master password prompts, then wait for the shell:
# typed-ahead input is flushed when Flint enters raw mode, so the marker command
# is resent until its output shows up.
prompted = answered_master = ready = False
deadline = time.time() + 40
while time.time() < deadline and not ready:
    pump(None, 0.5)
    if b"(yes/no)?" in buf and not prompted:
        prompted = True
        os.write(fd, b"yes\n")
    elif b"Master password" in buf and not answered_master:
        answered_master = True
        os.write(fd, master.encode() + b"\n")
    elif prompted:
        os.write(fd, b"echo READY$((40+2))\n")
        ready = pump(b"READY42", 2)
os.write(fd, b"stty size\n"); size1 = pump(b"24 80")
setsize(40, 100); time.sleep(0.5)
os.write(fd, b"stty size; exit 6\n"); size2 = pump(b"40 100")
pump(None, 10)
_, status = os.waitpid(pid, 0)
print(json.dumps({"prompted": prompted, "size1": size1, "size2": size2,
                  "code": os.waitstatus_to_exitcode(status), "out": buf.decode(errors="replace")}))
PY
checks=$((checks + 1))
pty_out="$(python3 -I "$tmp/connect_tty.py" "$flint" "$MASTER" --vault "$sv" connect tty 2>&1)"
echo "$pty_out" >> "$all_out"
if echo "$pty_out" | is_json; then echo "ok    connect ran on a pty"; else failures=$((failures + 1)); echo "FAIL  connect on a pty: $pty_out"; fi
check "connect asked to trust the new host key" '[[ "$(echo "$pty_out" | json_get "d[\"prompted\"]")" == "True" ]]'
check "the remote PTY started at 24x80" '[[ "$(echo "$pty_out" | json_get "d[\"size1\"]")" == "True" ]]'
check "a local resize reached the remote PTY (40x100)" '[[ "$(echo "$pty_out" | json_get "d[\"size2\"]")" == "True" ]]'
check "connect exits with the remote shell status" '[[ "$(echo "$pty_out" | json_get "d[\"code\"]")" == "6" ]]'
expect 0 "the confirmed key was recorded" "$SMI" -- --json known-host list "${SM[@]}"
check "localhost is now a known host" '[[ "$out" == *"[localhost]:$P"* ]]'

if [[ -n "${FLINT_TEST_PW_PORT:-}" ]]; then
  echo "== ssh: password and keyboard-interactive logins (root sshds, Linux check)"
  LOGIN_PW="$FLINT_TEST_LOGIN_PW"
  expect 0 "host add with a password" "$SMI$LOGIN_PW"$'\n' -- host add pw --hostname 127.0.0.1 --port "$FLINT_TEST_PW_PORT" --user flint --password-stdin "${SM[@]}"
  expect 0 "password auth from the vault" "$SMI" -- exec pw --accept-new-host-key "${SM[@]}" -- echo pw-ok
  check "the password login ran the command" '[[ "$out" == "pw-ok" ]]'
  expect 0 "credential with the password" "$SMI$LOGIN_PW"$'\n' -- cred add login --user flint --password-stdin "${SM[@]}"
  expect 0 "host add with the credential, kbd-interactive only" "$SMI" -- host add kbd --hostname 127.0.0.1 --port "$FLINT_TEST_KBD_PORT" --cred login "${SM[@]}"
  expect 0 "keyboard-interactive auth with the credential password" "$SMI" -- exec kbd --accept-new-host-key "${SM[@]}" -- echo kbd-ok
  check "the kbd-interactive login ran the command" '[[ "$out" == "kbd-ok" ]]'
  expect 0 "host edit to a wrong password" "${SMI}wrong-password"$'\n' -- host edit pw --password-stdin "${SM[@]}"
  SSH_AUTH_SOCK= expect 12 "a wrong stored password fails with auth" "$SMI" -- exec pw "${SM[@]}" -- true
  check "the auth error names the host password, not its value" '[[ "$err" == *"host password"* && "$err" != *"wrong-password"* ]]'
fi

echo "== files: flint cp (milestone 16)"
cpd="$tmp/cp"; rem="$cpd/remote"; loc="$cpd/local"
mkdir -p "$rem" "$loc/site/css"
printf 'port=8080\n' > "$loc/app.conf"
head -c 1048577 /dev/urandom > "$loc/blob.bin"
printf '<h1>hi</h1>\n' > "$loc/site/index.html"
printf 'body{}\n' > "$loc/site/css/a.css"
expect 0 "cp uploads a file into a folder" "$SMI" -- cp "$loc/app.conf" "local:$rem/" "${SM[@]}"
check "the host has the file" 'cmp -s "$loc/app.conf" "$rem/app.conf"'
check "the summary names the target" '[[ "$out" == "Copied 1 file (10 B) to local:$rem/app.conf in "* ]]'
expect 0 "cp --json uploads a 1 MB binary file" "$SMI" -- --json cp "$loc/blob.bin" "local:$rem/blob.bin" "${SM[@]}"
check "the binary file arrived byte for byte" 'cmp -s "$loc/blob.bin" "$rem/blob.bin"'
check "--json reports direction, target and bytes" '[[ "$(echo "$out" | json_get "d[\"direction\"], d[\"files\"][0][\"target\"], d[\"bytes\"]")" == "('"'"'upload'"'"', '"'"'$rem/blob.bin'"'"', 1048577)" ]]'
check "no progress on a stderr that is not a terminal" '[[ -z "$err" ]]'
expect 20 "an existing file is refused with exists" "$SMI" -- --json cp "$loc/app.conf" "local:$rem/" "${SM[@]}"
check "as a JSON error with its code" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "exists" ]]'
printf 'port=9090\n' > "$loc/app.conf"
expect 0 "--force replaces it" "$SMI" -- cp --force "$loc/app.conf" "local:$rem/" "${SM[@]}"
check "the host has the new content" 'cmp -s "$loc/app.conf" "$rem/app.conf"'
expect 7 "a folder without -r is invalid" "$SMI" -- cp "$loc/site" "local:$rem/" "${SM[@]}"
expect 0 "cp -r uploads a folder" "$SMI" -- --json cp -r "$loc/site" "local:$rem/" "${SM[@]}"
check "the tree arrived" 'diff -r "$loc/site" "$rem/site" >/dev/null'
check "--json counts 2 files and 2 folders" '[[ "$(echo "$out" | json_get "len(d[\"files\"]), d[\"folders\"]")" == "(2, 2)" ]]'
expect 0 "cp downloads a file to a new name" "$SMI" -- cp "local:$rem/blob.bin" "$loc/back.bin" "${SM[@]}"
check "the download is byte for byte" 'cmp -s "$loc/blob.bin" "$loc/back.bin"'
mkdir -p "$loc/dl"
expect 0 "cp -r downloads a folder into a local folder" "$SMI" -- cp -r "local:$rem/site" "$loc/dl" "${SM[@]}"
check "the tree came back" 'diff -r "$loc/site" "$loc/dl/site" >/dev/null'
pushd "$loc/dl" >/dev/null
expect 0 "a relative local path is the current folder's" "$SMI" -- cp "local:$rem/app.conf" . "${SM[@]}"
popd >/dev/null
check "it landed in the current folder" 'cmp -s "$rem/app.conf" "$loc/dl/app.conf"'
expect 0 "cp through a jump host" "$SMI" -- cp "$loc/app.conf" "inner:$rem/via-jump.conf" "${SM[@]}"
check "the jump copy arrived" 'cmp -s "$loc/app.conf" "$rem/via-jump.conf"'
expect 3 "a missing remote file is not_found" "$SMI" -- cp "local:$rem/nope" "$loc/" "${SM[@]}"
expect 3 "a missing local file is not_found" "$SMI" -- cp "$loc/nope" "local:$rem/" "${SM[@]}"
expect 3 "a missing remote folder is not_found" "$SMI" -- cp "$loc/app.conf" "local:$rem/no/such/" "${SM[@]}"
expect 21 "a file as the folder is not_a_directory" "$SMI" -- cp "$loc/app.conf" "local:$rem/app.conf/x" "${SM[@]}"
mkdir -p "$rem/locked"; chmod 000 "$rem/locked"
expect 19 "a folder the user cannot write is permission_denied" "$SMI" -- cp "$loc/app.conf" "local:$rem/locked/" "${SM[@]}"
chmod 755 "$rem/locked"
expect 2 "no host is a usage error" "$SMI" -- cp "$loc/a" "$loc/b" "${SM[@]}"
expect 2 "cp with one path is a usage error" "$SMI" -- cp "$loc/a" "${SM[@]}"
expect 3 "an unknown alias is not_found" "$SMI" -- cp "$loc/app.conf" "nohost:/tmp/" "${SM[@]}"
echo "== files: flint cp between two hosts (milestone 18)"
# `local` and `inner` (reached through `local` as a jump host) are two sshds on this
# machine, so both see the same folders: the copy still goes host → flint → host.
mkdir -p "$rem/to"
expect 0 "cp copies a file from one host to another" "$SMI" -- cp "local:$rem/blob.bin" "inner:$rem/to/" "${SM[@]}"
check "it arrived byte for byte" 'cmp -s "$loc/blob.bin" "$rem/to/blob.bin"'
check "the summary names both hosts" '[[ "$out" == "Copied 1 file (1.0 MB) from local:$rem/blob.bin to inner:$rem/to/blob.bin in "* ]]'
expect 0 "--json reports both hosts" "$SMI" -- --json cp --force "local:$rem/app.conf" "inner:$rem/to/app.conf" "${SM[@]}"
check "--json has direction relay, host and to_host" '[[ "$(echo "$out" | json_get "d[\"direction\"], d[\"host\"], d[\"to_host\"], d[\"bytes\"]")" == "('"'"'relay'"'"', '"'"'local'"'"', '"'"'inner'"'"', 10)" ]]'
expect 20 "an existing file on the destination host is refused" "$SMI" -- --json cp "local:$rem/app.conf" "inner:$rem/to/" "${SM[@]}"
check "the error names the destination host" '[[ "$err" == *"on inner already exists"* ]]'
expect 7 "a folder between hosts needs -r" "$SMI" -- cp "local:$rem/site" "inner:$rem/to/" "${SM[@]}"
check "the error names the source host" '[[ "$err" == *"on local is a folder"* ]]'
expect 0 "cp -r copies a folder between hosts" "$SMI" -- cp -r "inner:$rem/site" "local:$rem/to/" "${SM[@]}"
check "the tree arrived" 'diff -r "$loc/site" "$rem/to/site" >/dev/null'
expect 3 "a missing file on the source host is not_found" "$SMI" -- cp "local:$rem/nope" "inner:$rem/to/" "${SM[@]}"
expect 3 "an unknown source alias is not_found" "$SMI" -- cp "nohost:/a" "inner:$rem/to/" "${SM[@]}"
expect 3 "an unknown destination alias is not_found" "$SMI" -- cp "local:$rem/app.conf" "nohost:/tmp/" "${SM[@]}"
printf 'half a fi' > "$rem/to/.stale.conf.flint-part"
cp "$loc/app.conf" "$rem/stale.conf"
expect 0 "a part file a cut copy left is replaced" "$SMI" -- cp "local:$rem/stale.conf" "inner:$rem/to/" "${SM[@]}"
check "the copy is whole and the part file is gone" 'cmp -s "$rem/stale.conf" "$rem/to/stale.conf" && [[ ! -e "$rem/to/.stale.conf.flint-part" ]]'
check "no partial file is left anywhere" '[[ -z "$(find "$cpd" -name "*.flint-part")" ]]'

echo "== tokens, with the CLI on its own (milestone 12b)"
expect 0 "token list on a vault with none" "$SMI" -- token list "${SM[@]}"
check "it says there are none" '[[ "$out" == "No tokens."* ]]'
expect 0 "token list --json" "$SMI" -- --json token list "${SM[@]}"
check "an empty JSON list" '[[ "$out" == "[]" ]]'
expect 5 "token create needs Flint: locked" "$SMI" -- token create --name nightly --allow exec --hosts local "${SM[@]}"
check "it says to open Flint" '[[ "$err" == *"runs in Flint"* ]]'
expect 2 "token create without --allow is a usage error" "$SMI" -- token create --name nightly "${SM[@]}"
expect 2 "an unknown --allow action is a usage error" "$SMI" -- --json token create --name n --allow sudo "${SM[@]}"
check "as a JSON error" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "usage" ]]'
expect 3 "token revoke of an unknown token: not_found" "$SMI" -- token revoke nightly "${SM[@]}"
expect 2 "an unknown token verb" "$SMI" -- token frob "${SM[@]}"

echo "== tunnels, with the CLI on its own (milestone 22)"
expect 0 "tunnel ls on a vault with none" "$SMI" -- tunnel ls "${SM[@]}"
check "it says there are none" '[[ "$out" == "No tunnels."* ]]'
expect 0 "tunnel add with the default destination" "$SMI" -- tunnel add local pg --local 15432 "${SM[@]}"
check "it names both ends" '[[ "$out" == "Added tunnel '"'"'local:pg'"'"': 127.0.0.1:15432 to localhost:15432 as local sees it." ]]'
expect 0 "tunnel add --to host:port --open-on-connect" "$SMI" -- --json tunnel add local e2e-tunnel-marker --local 16379 --to e2e-dest-marker.internal:6379 --open-on-connect "${SM[@]}"
check "--json has the destination and open_on_connect" '[[ "$(echo "$out" | json_get "d[\"destination\"], d[\"open_on_connect\"], d[\"local_port\"]")" == "('"'"'e2e-dest-marker.internal:6379'"'"', True, 16379)" ]]'
expect 4 "a second tunnel of the same name, any case: conflict" "$SMI" -- tunnel add local PG --local 1 "${SM[@]}"
expect 0 "another host may reuse the name" "$SMI" -- tunnel add inner pg --local 25432 --to 5432 "${SM[@]}"
expect 7 "a port out of range is invalid" "$SMI" -- tunnel add local big --local 70000 "${SM[@]}"
expect 7 "a name with a colon is invalid" "$SMI" -- tunnel add local a:b --local 1 "${SM[@]}"
expect 7 "an IPv6 destination without brackets is invalid" "$SMI" -- tunnel add local v6 --local 1 --to fd00::5:443 "${SM[@]}"
expect 2 "tunnel add without --local is a usage error" "$SMI" -- tunnel add local nolocal "${SM[@]}"
expect 3 "a tunnel on an unknown host: not_found" "$SMI" -- tunnel add nohost x --local 1 "${SM[@]}"
expect 0 "tunnel edit renames and moves the local port" "$SMI" -- --json tunnel edit local:PG --name postgres --local 15433 "${SM[@]}"
check "the destination stays" '[[ "$(echo "$out" | json_get "d[\"name\"], d[\"local_port\"], d[\"destination\"]")" == "('"'"'postgres'"'"', 15433, '"'"'localhost:15432'"'"')" ]]'
expect 2 "a tunnel is named host:name" "$SMI" -- tunnel edit local --local 1 "${SM[@]}"
expect 0 "tunnel ls lists every host's tunnels" "$SMI" -- tunnel ls "${SM[@]}"
check "the table has its columns and a row per tunnel" '[[ "$out" == "TUNNEL"*"LOCAL"*"DESTINATION"*"ON CONNECT"*"STATE"* && "$(echo "$out" | wc -l | tr -d " ")" == "4" ]]'
expect 0 "tunnel ls <host> --json" "$SMI" -- --json tunnel ls local "${SM[@]}"
check "two on local, state unknown without Flint" '[[ "$(echo "$out" | json_get "[(t[\"name\"], t[\"state\"]) for t in d]")" == "[('"'"'e2e-tunnel-marker'"'"', '"'"''"'"'), ('"'"'postgres'"'"', '"'"''"'"')]" ]]'
expect 5 "tunnel up needs Flint: locked" "$SMI" -- tunnel up local:postgres "${SM[@]}"
check "it says to open Flint" '[[ "$err" == *"runs only through Flint"* ]]'
expect 5 "tunnel down needs Flint too" "$SMI" -- --json tunnel down local:postgres "${SM[@]}"
check "as a JSON error with its code" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "locked" ]]'
expect 5 "tunnel status needs Flint too" "" -- tunnel status
expect 2 "tunnel up without host:name is a usage error" "$SMI" -- tunnel up local "${SM[@]}"
expect 2 "an unknown tunnel verb" "$SMI" -- tunnel frob "${SM[@]}"
expect 0 "tunnel rm" "$SMI" -- --json tunnel rm local:postgres "${SM[@]}"
check "--json names what was removed" '[[ "$(echo "$out" | json_get "d[\"removed\"], d[\"name\"]")" == "('"'"'tunnel'"'"', '"'"'local:postgres'"'"')" ]]'
expect 3 "tunnel rm of an unknown tunnel: not_found" "$SMI" -- tunnel rm local:postgres "${SM[@]}"
expect 0 "a host removed takes its tunnels" "$SMI" -- host add gone --hostname 127.0.0.9 "${SM[@]}"
expect 0 "a tunnel on it" "$SMI" -- tunnel add gone t --local 1999 "${SM[@]}"
expect 0 "host rm" "$SMI" -- host rm gone "${SM[@]}"
expect 0 "tunnel ls --json" "$SMI" -- --json tunnel ls "${SM[@]}"
check "its tunnel went with it" '[[ "$(echo "$out" | json_get "sorted(t[\"host\"] + \":\" + t[\"name\"] for t in d)")" == "['"'"'inner:pg'"'"', '"'"'local:e2e-tunnel-marker'"'"']" ]]'

echo "== rdp hosts (milestone 29)"
expect 0 "host add --type rdp with a password on stdin" "$SMI$HOST_PW"$'\n' -- --json host add win --type rdp --hostname e2e-rdp-marker.example --user admin --domain E2E-DOMAIN-MARKER --password-stdin "${SM[@]}"
check "an RDP host gets port 3389, its type and domain" '[[ "$(echo "$out" | json_get "d[\"type\"], d[\"port\"], d[\"domain\"], d[\"has_password\"]")" == "('"'"'rdp'"'"', 3389, '"'"'E2E-DOMAIN-MARKER'"'"', True)" ]]'
expect 0 "host show of an RDP host (text)" "$SMI" -- host show win "${SM[@]}"
check "it shows the type and domain, no SSH-only fields" '[[ "$out" == *"type        rdp"* && "$out" == *"domain      E2E-DOMAIN-MARKER"* && "$out" != *"jump"* && "$out" != *"sudo"* ]]'
expect 0 "host list (text)" "$SMI" -- host list "${SM[@]}"
check "the list has a TYPE column and the RDP target" '[[ "$out" == "ALIAS"*"TYPE"*"TARGET"* && "$out" == *"rdp"*"E2E-DOMAIN-MARKER\\admin@e2e-rdp-marker.example"* && "$out" == *"local"*"ssh"* ]]'
expect 0 "host list --json" "$SMI" -- --json host list "${SM[@]}"
check "every host has a type" '[[ "$(echo "$out" | json_get "sorted(set(h[\"type\"] for h in d))")" == "['"'"'rdp'"'"', '"'"'ssh'"'"']" ]]'
expect 0 "an RDP host on another port keeps it" "$SMI" -- --json host add win2 --type rdp --hostname 10.9.9.9 --port 3390 "${SM[@]}"
check "port 3390" '[[ "$(echo "$out" | json_get "d[\"port\"]")" == "3390" ]]'
expect 7 "an unknown type is invalid" "$SMI" -- host add vnc1 --type vnc --hostname x "${SM[@]}"
expect 7 "an RDP host takes no SSH key" "$SMI" -- host add k --type rdp --hostname x --key any "${SM[@]}"
expect 7 "an RDP host takes no initial command" "$SMI" -- host add c --type rdp --hostname x --command htop "${SM[@]}"
expect 7 "an RDP host takes no jump host" "$SMI" -- host edit win --jump local "${SM[@]}"
expect 7 "a domain on an SSH host is invalid" "$SMI" -- host edit local --domain CORP "${SM[@]}"
expect 7 "a host's type cannot change" "$SMI" -- host edit win --type ssh "${SM[@]}"
check "it says to remove and add it again" '[[ "$err" == *"cannot change"* ]]'
expect 0 "repeating the type on edit is fine" "$SMI" -- host edit win --type rdp --label "Windows box" "${SM[@]}"
expect 23 "an RDP host as a jump host: wrong_host_type" "$SMI" -- --json host edit inner --jump win "${SM[@]}"
check "as a JSON error with its code" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "wrong_host_type" ]]'
expect 23 "flint exec refuses an RDP host" "$SMI" -- exec win "${SM[@]}" -- true
check "it says why" '[[ "$err" == *"'"'"'win'"'"' is an RDP host; flint exec needs an SSH host"* ]]'
expect 23 "flint cp refuses an RDP host" "$SMI" -- cp "$loc/app.conf" "win:/tmp/" "${SM[@]}"
expect 23 "flint cp between hosts refuses an RDP end" "$SMI" -- cp "local:$rem/app.conf" "win:/tmp/" "${SM[@]}"
expect 23 "a tunnel on an RDP host is refused" "$SMI" -- tunnel add win rdp-t --local 13389 "${SM[@]}"
expect 23 "host test refuses an RDP host" "$SMI" -- host test win "${SM[@]}"
expect 0 "host rm of an RDP host" "$SMI" -- host rm win2 "${SM[@]}"

echo "== every --json output parses"
expect 0 "version --json" "" -- --version --json
check "version is JSON" 'echo "$out" | is_json'

echo "== nothing secret or identifying leaks"
for secret in "$MASTER" "$HOST_PW" "$CRED_PW" "$PASSPHRASE" "$key_body" "$test_key_body" "PRIVATE KEY" ${FLINT_TEST_LOGIN_PW:+"$FLINT_TEST_LOGIN_PW"}; do
  check "CLI output never shows '${secret:0:24}…'" '! grep -aqF -- "$secret" "$all_out"'
done
for f in "$vault" "$work" "$off"; do
  for needle in "$HOST_PW" "$CRED_PW" "$PASSPHRASE" "$key_body" "e2e-hostname-marker" "e2e-user-marker" "e2e-label-marker" "e2e-notes-marker" "e2e-group-marker" "e2e-cred-user" "10.20.30.40" "web-01" "Home Lab" "SQLite format 3" "CREATE TABLE"; do
    check "$(basename "$f") has no clear-text '${needle:0:24}'" '! grep -aqF -- "$needle" "$f"'
  done
done
for needle in "127.0.0.1" "localhost" "$test_key_body" "inner" "e2e-tunnel-marker" "e2e-dest-marker" "e2e-rdp-marker" "E2E-DOMAIN-MARKER" "SQLite format 3"; do
  check "ssh.flint has no clear-text '${needle:0:24}'" '! grep -aqF -- "$needle" "$sv"'
done
check "no journal or WAL file is left next to the vault" '! ls "$tmp"/*.flint-* >/dev/null 2>&1'

echo
echo "cli-e2e: $((checks - failures))/$checks checks passed"
[[ "$failures" == 0 ]]
