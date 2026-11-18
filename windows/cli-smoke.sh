#!/usr/bin/env bash
# Runs the Windows build of the flint CLI on Windows (WSL interop) against a throwaway
# config folder and vault in %TEMP%\flint-win. Never touches a real Flint config.
#
# The SSH part starts two throwaway sshd in WSL (own host keys, user key and config in
# a temp dir, like scripts/test.sh) and windows/ssh-relay.ps1, which carries Windows'
# 127.0.0.1:2322 to the first one. Why a relay and 127.0.0.2: see ssh-relay.ps1.
# Never touches the system sshd or ~/.ssh. Run it outside any network sandbox.
#
#   windows/cli-smoke.sh            # everything
#   SMOKE_SSH=0 windows/cli-smoke.sh  # vault part only
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-win"
rm -rf "$WIN_TMP" && mkdir -p "$WIN_TMP/cfg" "$WIN_TMP/vaults"
cp "$here/../build/flint.exe" "$WIN_TMP/"
cd "$WIN_TMP"
W="$(wslpath -w "$WIN_TMP")"
export FLINT_CONFIG_DIR="$W\\cfg" WSLENV=FLINT_CONFIG_DIR
pass=0; fail=0; out=""
step() {  # step <expected exit> <stdin> <args...>
  local want=$1 input=$2; shift 2
  out=$(printf '%b' "$input" | timeout 120 ./flint.exe "$@" 2>&1); local got=$?
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "ok   [$got] flint $*"; else fail=$((fail+1)); echo "FAIL [$got, want $want] flint $*"; fi
  printf '%s\n' "$out" | sed 's/^/       /' | head -12
}
check() {  # check <name> <bash condition>
  if eval "$2"; then pass=$((pass+1)); echo "ok   $1"; else fail=$((fail+1)); echo "FAIL $1"; fi
}
M='master-pass-1\n'
step 0 "$M$M" --master-stdin vault create "$W\\vaults\\lab.flint" --name lab
step 0 "$M" --master-stdin group add homelab/proxmox
step 0 "$M" --master-stdin host add web-01 --hostname 192.0.2.10 --user deploy --group homelab/proxmox --tag prod
step 0 "$M" --master-stdin host list
step 0 "$M" --master-stdin --json vault status
step 0 "" vault list
step 6 "wrong-pass\n" --master-stdin host list
step 0 "$M" --master-stdin --vault "$W\\vaults\\lab.flint" host show web-01
echo "== tunnels, with the CLI on its own (milestone 22; a subset of scripts/cli-e2e.sh)"
step 0 "$M" --master-stdin tunnel ls
check "no tunnels yet" '[[ "$out" == "No tunnels."* ]]'
step 0 "$M" --master-stdin tunnel add web-01 pg --local 15432
check "it names both ends" '[[ "$out" == *"127.0.0.1:15432 to localhost:15432"* ]]'
step 4 "$M" --master-stdin tunnel add web-01 PG --local 1
step 0 "$M" --master-stdin --json tunnel edit web-01:pg --name postgres --local 15433
step 0 "$M" --master-stdin --json tunnel ls web-01
check "the edit is saved" '[[ "$out" == *"postgres"*"15433"* ]]'
# Flint is not running here (no flint-app.exe beside this flint.exe): up needs it.
step 5 "$M" --master-stdin tunnel up web-01:postgres
step 0 "$M" --master-stdin tunnel rm web-01:postgres
step 3 "$M" --master-stdin tunnel rm web-01:postgres
echo "== version (milestone 32)"
step 0 "" --version
check "the first line names the build's version" '[[ "$(head -1 <<<"$out" | tr -d "\r")" == "flint $("$here/../scripts/version.sh")" ]]'

echo "== vault passwd on Windows (milestone 40; a subset of scripts/cli-e2e.sh)"
N='gravel onion tundra quartz\n'
PW="$W\\vaults\\pw.flint"; pw="$WIN_TMP/vaults/pw.flint"
step 0 "$M" --master-stdin vault create "$PW" --name PW
step 0 "${M}host-secret-1\n" --master-stdin --vault "$PW" host add pw-host --hostname 10.9.9.9 --password-stdin
salt_before="$(head -c 16 "$pw" | od -An -tx1 | tr -d ' \n')"
step 0 "$M$N" --json --vault "$PW" vault passwd --master-stdin --new-master-stdin
check "the vault has a new salt" '[[ "$(head -c 16 "$pw" | od -An -tx1 | tr -d " \n")" != "$salt_before" ]]'
check "no re-keyed copy is left beside it" '[[ ! -e "$pw.rekey" ]] && ! ls cfg/activity/*.new >/dev/null 2>&1'
step 6 "$M" --master-stdin --vault "$PW" host list
step 0 "$N" --json --master-stdin --vault "$PW" host show pw-host
check "the host keeps its password" '[[ "$out" == *"\"has_password\": true"* || "$out" == *"\"has_password\":true"* ]]'
step 6 "wrong horse battery\n$M" --vault "$PW" vault passwd --master-stdin --new-master-stdin
step 0 "${N}monkey2026\n" --vault "$PW" vault passwd --master-stdin --new-master-stdin
check "a weak password is taken with a warning" '[[ "$out" == *"too weak for a remote vault"* ]]'
step 0 "monkey2026\n$N" --vault "$PW" vault passwd --master-stdin --new-master-stdin
step 0 "$N" --master-stdin --vault "$PW" vault status

echo "== vault merge on Windows (milestone 41; a subset of scripts/cli-e2e.sh)"
MG="$W\\vaults\\mg.flint"; MGC="$W\\vaults\\mg (conflict copy).flint"
step 0 "$M" --master-stdin vault create "$MG" --name MG
step 0 "$M" --master-stdin --vault "$MG" host add shared --hostname 10.7.7.1
cp "$WIN_TMP/vaults/mg.flint" "$WIN_TMP/vaults/mg (conflict copy).flint"
step 0 "$M" --master-stdin --vault "$MG" host edit shared --port 2201
step 0 "$M" --master-stdin --vault "$MGC" host add db --hostname 10.7.7.5
step 0 "$M" --json --master-stdin --vault "$MG" vault merge "$MGC"
step 0 "$M" --json --master-stdin --vault "$MG" host list
check "both sides' changes are in" '[[ "$out" == *"2201"* && "$out" == *"\"db\""* ]]'
step 7 "$M" --master-stdin --vault "$MG" vault merge "$MG"
step 7 "$M" --master-stdin --vault "$MG" vault merge "$W\\VAULTS\\MG.FLINT"

echo "--- files"; ls -la cfg vaults

if [ "${SMOKE_SSH:-1}" = 1 ]; then
  echo "== ssh"
  RELAY_PORT="${FLINT_WIN_RELAY_PORT:-2322}"
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-win-sshd.XXXXXX")"
  relay_pid=""
  cleanup() {
    for f in "$tmp"/sshd*.pid; do [[ -f "$f" ]] && kill "$(cat "$f")" 2>/dev/null; done
    powershell.exe -NoProfile -c "Get-NetTCPConnection -LocalPort $RELAY_PORT -State Listen -ErrorAction SilentlyContinue | % { Stop-Process -Id \$_.OwningProcess -Force }" >/dev/null 2>&1
    [ -n "$relay_pid" ] && kill "$relay_pid" 2>/dev/null
    rm -rf "$tmp"
  }
  trap cleanup EXIT
  ssh-keygen -q -t ed25519 -N '' -f "$tmp/host_ed25519"
  ssh-keygen -q -t ed25519 -N '' -f "$tmp/host2_ed25519"
  ssh-keygen -q -t ed25519 -N '' -f "$tmp/user_ed25519"
  cp "$tmp/user_ed25519.pub" "$tmp/authorized_keys"; chmod 600 "$tmp/authorized_keys"
  for n in 1 2; do
    hk="$tmp/host_ed25519"; [ $n = 2 ] && hk="$tmp/host2_ed25519"
    cat > "$tmp/sshd$n.conf" <<CFG
Port $((2221 + n))
ListenAddress 127.0.0.2
HostKey $hk
AuthorizedKeysFile $tmp/authorized_keys
PidFile $tmp/sshd$n.pid
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
StrictModes no
PermitTTY yes
Subsystem sftp internal-sftp
AllowTcpForwarding yes
CFG
    /usr/sbin/sshd -f "$tmp/sshd$n.conf" -E "$tmp/sshd$n.log"
    for _ in $(seq 1 50); do [[ -s "$tmp/sshd$n.pid" ]] && break; sleep 0.1; done
    [[ -s "$tmp/sshd$n.pid" ]] || { echo "sshd$n did not start"; cat "$tmp/sshd$n.log"; exit 1; }
  done
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$here/ssh-relay.ps1")" \
    -Port "$RELAY_PORT" -TargetHost 127.0.0.2 -Target 2222 -Distro "$WSL_DISTRO_NAME" > "$tmp/relay.log" 2>&1 &
  relay_pid=$!
  relay_t0=$SECONDS
  for _ in $(seq 1 100); do grep -q '^relay:' "$tmp/relay.log" 2>/dev/null && break; sleep 0.1; done
  # diag: once it took over 10 s with nothing in its log (2026-11-13); alone it takes ~1.3 s.
  echo "diag: relay after $((SECONDS - relay_t0)) s; powershell alive: $(kill -0 "$relay_pid" 2>/dev/null && echo yes || echo no)"
  grep -q '^relay:' "$tmp/relay.log" || { echo "relay did not start"; cat "$tmp/relay.log"; powershell.exe -NoProfile -c "Get-NetTCPConnection -LocalPort $RELAY_PORT -EA SilentlyContinue | Select LocalAddress,State,OwningProcess" 2>&1 | tr -d '\r'; exit 1; }

  cp "$tmp/user_ed25519" "$WIN_TMP/user_ed25519"
  rem="$tmp/remote"; mkdir -p "$rem/locked"; chmod 555 "$rem/locked"
  loc="$WIN_TMP/loc"; mkdir -p "$loc/site/css"
  utf='año-ñ ✓.txt'
  printf 'ünïcødé contents\n' > "$loc/$utf"
  printf 'listen 80\n' > "$loc/app.conf"
  printf '<h1>hi</h1>\n' > "$loc/site/index.html"; printf 'body{}\n' > "$loc/site/css/a.css"
  head -c 1048576 /dev/urandom > "$loc/blob.bin"
  Wl="$W\\loc"
  S=--master-stdin

  step 0 "$M" $S key add tkey --file "$W\\user_ed25519"
  step 0 "$M" $S host add local --hostname 127.0.0.1 --port "$RELAY_PORT" --user "$USER" --key tkey
  step 0 "$M" $S host add inner --hostname 127.0.0.2 --port 2223 --user "$USER" --key tkey --jump local
  step 11 "$M" $S --json host test local
  check "an unknown host key with no terminal is host_key, not a hang" '[[ "$out" == *"\"code\":\"host_key\""* ]]'
  step 0 "$M" $S host test local --accept-new-host-key
  step 0 "$M" $S host test local
  check "host test says the connection works" '[[ "$out" == "Connection to '"'"'local'"'"' works: "* ]]'
  step 0 "$M" $S exec local -- echo win-exec-ok
  check "exec streams stdout" '[[ "$out" == "win-exec-ok" ]]'
  step 3 "$M" $S exec local -- exit 3
  step 4 "$M" $S --json exec local -- 'echo out-line; echo err-line >&2; exit 4'
  check "exec --json captures both streams and the status" '[[ "$out" == *"\"stdout\":\"out-line\n\""* && "$out" == *"\"stderr\":\"err-line\n\""* && "$out" == *"\"exit_code\":4"* ]]'
  step 14 "$M" $S exec local --exec-timeout 1 -- sleep 5
  step 0 "$M" $S --json exec inner --accept-new-host-key -- echo via-jump
  check "the jump host output arrived" '[[ "$out" == *"\"stdout\":\"via-jump\n\""* ]]'
  step 0 "$M" $S --json host test inner
  check "host test --json counts both hops" '[[ "$out" == *"\"hops\":2"* ]]'

  echo "== cp (SFTP)"
  step 0 "$M" $S cp "$Wl\\$utf" "local:$rem/"
  check "UTF-8 name uploaded intact" 'cmp -s "$loc/$utf" "$rem/$utf"'
  step 0 "$M" $S cp "$Wl\\app.conf" "local:$rem/"
  check "upload is byte-exact (no CRLF)" 'cmp -s "$loc/app.conf" "$rem/app.conf"'
  step 0 "$M" $S --json cp "$Wl\\blob.bin" "local:$rem/blob.bin"
  check "1 MB binary uploaded byte-exact" 'cmp -s "$loc/blob.bin" "$rem/blob.bin"'
  step 20 "$M" $S --json cp "$Wl\\app.conf" "local:$rem/"
  step 0 "$M" $S cp --force "$Wl\\app.conf" "local:$rem/"
  step 0 "$M" $S --json cp -r "$Wl\\site" "local:$rem/"
  check "folder uploaded" 'cmp -s "$loc/site/css/a.css" "$rem/site/css/a.css"'
  step 0 "$M" $S cp "local:$rem/blob.bin" "$Wl\\back.bin"
  check "1 MB binary downloaded byte-exact" 'cmp -s "$loc/blob.bin" "$loc/back.bin"'
  mkdir -p "$loc/dl"
  step 0 "$M" $S cp "local:$rem/$utf" "$Wl\\dl\\"
  check "UTF-8 name downloaded intact" 'cmp -s "$loc/$utf" "$loc/dl/$utf"'
  step 0 "$M" $S cp -r "local:$rem/site" "$Wl\\dl"
  check "folder downloaded" 'cmp -s "$loc/site/index.html" "$loc/dl/site/index.html"'
  step 0 "$M" $S cp "local:$rem/app.conf" .
  check "a relative local path is the current folder's" 'cmp -s "$loc/app.conf" "$WIN_TMP/app.conf"'
  step 0 "$M" $S cp "$Wl\\app.conf" "inner:$rem/via-jump.conf"
  check "cp through a jump host" 'cmp -s "$loc/app.conf" "$rem/via-jump.conf"'
  step 3 "$M" $S cp "local:$rem/nope" "$Wl\\"
  step 3 "$M" $S cp "$Wl\\nope" "local:$rem/"
  step 19 "$M" $S cp "$Wl\\app.conf" "local:$rem/locked/"
  chmod 755 "$rem/locked"
fi

echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
