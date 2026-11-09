#!/usr/bin/env bash
# Runs the Windows build of the flint CLI on Windows (WSL interop) against a throwaway
# config folder and vault in %TEMP%\flint-win. Never touches a real Flint config.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-win"
rm -rf "$WIN_TMP" && mkdir -p "$WIN_TMP/cfg" "$WIN_TMP/vaults"
cp "$here/../build/flint.exe" "$WIN_TMP/"
cd "$WIN_TMP"
W="$(wslpath -w "$WIN_TMP")"
export FLINT_CONFIG_DIR="$W\\cfg" WSLENV=FLINT_CONFIG_DIR
pass=0; fail=0
step() {  # step <expected exit> <stdin> <args...>
  local want=$1 input=$2; shift 2
  local out; out=$(printf '%b' "$input" | ./flint.exe "$@" 2>&1); local got=$?
  if [ "$got" = "$want" ]; then pass=$((pass+1)); echo "ok   [$got] flint $*"; else fail=$((fail+1)); echo "FAIL [$got, want $want] flint $*"; fi
  printf '%s\n' "$out" | sed 's/^/       /' | head -12
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
echo "--- files"; ls -la cfg vaults
echo "passed $pass, failed $fail"
[ "$fail" = 0 ]
