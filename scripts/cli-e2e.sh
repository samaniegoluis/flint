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
set -o pipefail  # no -u: macOS bash 3.2 treats an empty array as unset

root="$(cd "$(dirname "$0")/.." && pwd)"
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

echo "== every --json output parses"
expect 0 "version --json" "" -- --version --json
check "version is JSON" 'echo "$out" | is_json'

echo "== nothing secret or identifying leaks"
for secret in "$MASTER" "$HOST_PW" "$CRED_PW" "$PASSPHRASE" "$key_body" "PRIVATE KEY"; do
  check "CLI output never shows '${secret:0:24}…'" '! grep -aqF -- "$secret" "$all_out"'
done
for f in "$vault" "$work" "$off"; do
  for needle in "$HOST_PW" "$CRED_PW" "$PASSPHRASE" "$key_body" "e2e-hostname-marker" "e2e-user-marker" "e2e-label-marker" "e2e-notes-marker" "e2e-group-marker" "e2e-cred-user" "10.20.30.40" "web-01" "Home Lab" "SQLite format 3" "CREATE TABLE"; do
    check "$(basename "$f") has no clear-text '${needle:0:24}'" '! grep -aqF -- "$needle" "$f"'
  done
done
check "no journal or WAL file is left next to the vault" '! ls "$tmp"/*.flint-* >/dev/null 2>&1'

echo
echo "cli-e2e: $((checks - failures))/$checks checks passed"
[[ "$failures" == 0 ]]
