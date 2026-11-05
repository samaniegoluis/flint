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
check "text show says the password is set" '[[ "$out" == *"password    set"* ]]'
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
expect 0 "the master password on stdin unlocks" "$MASTER"$'\n' -- --json vault unlock --master-stdin
if [[ "$cached" == "True" ]]; then
  expect 0 "after unlock the keychain opens it without a password" "" -- host list
fi

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

echo "== keychain turned off"
off="$tmp/off.flint"
FLINT_KEYCHAIN=off expect 0 "create with the keychain off" "$MASTER"$'\n' -- --json vault create "$off" --master-stdin
check "nothing cached with the keychain off" '[[ "$(echo "$out" | json_get "d[\"cached\"]")" == "False" ]]'
FLINT_KEYCHAIN=off expect 5 "keychain off and no password: locked" "" -- --vault "$off" host list
FLINT_KEYCHAIN=off expect 0 "keychain off with --master-stdin works" "$MASTER"$'\n' -- --vault "$off" host list --master-stdin

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
for needle in "127.0.0.1" "localhost" "$test_key_body" "inner" "SQLite format 3"; do
  check "ssh.flint has no clear-text '${needle:0:24}'" '! grep -aqF -- "$needle" "$sv"'
done
check "no journal or WAL file is left next to the vault" '! ls "$tmp"/*.flint-* >/dev/null 2>&1'

echo
echo "cli-e2e: $((checks - failures))/$checks checks passed"
[[ "$failures" == 0 ]]
