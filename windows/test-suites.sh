#!/usr/bin/env bash
# Flint's cfire test suites, built for Windows and run there through WSL interop.
#
#   windows/test-suites.sh                    # every suite but ssh
#   windows/test-suites.sh src/adapters/vault # one
#
# The tests run from a folder under %TEMP%, not from the worktree: many write to
# "/tmp/...", which from a WSL folder resolves on the \\wsl.localhost share, where SQLite
# cannot lock a file ("database is locked") and an AF_UNIX socket cannot get its
# owner-only ACL. From %TEMP%, "/tmp" is C:\tmp on NTFS. The Tether fixtures the tests
# read by a relative path are copied beside them.
#
# src/adapters/ssh is left out: it wants sshd on 127.0.0.1:2222, which this WSL cannot
# serve to Windows (see the port guide); cli-smoke.sh and the e2e runs cover SSH.
# flint-vault-server's packages (src/adapters/serverfs, src/application/vaultserver,
# src/drivers/vault-server) are left out too: the server runs in Docker, never on
# Windows, and its shim is POSIX sockets (milestone 42).
# src/adapters/rdp runs on FreeRDP built by bin/freerdp.sh, against two servers that
# rdp-servers.sh starts as Windows programs on loopback, as scripts/test.sh does on
# macOS and Linux: FreeRDP's sample server (FLINT_RDP_SAMPLE_PORT) and Flint's own
# (FLINT_RDP_CLIP_PORT/_CONTROL). Tests against a real Windows host (FLINT_RDP_TEST_HOST,
# the owner's check) and the quiet network (FLINT_RDP_BLACKHOLE, iptables in the Linux
# image) return early and print PASS: count them as skipped.
# src/adapters/vaultremote (milestone 43) runs against the Linux flint-vault-server in
# WSL, reached through a relay on Windows' loopback (vault-server.sh).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
"$here/bin/freerdp.sh" >/dev/null
source "$here/bin/env.sh"
suites=("$@")
if [[ ${#suites[@]} == 0 ]]; then
  mapfile -t suites < <(cd "$root" && find src -name '*_test.cf' -not -path '*/.cfire/*' | xargs -n1 dirname | sort -u | grep -v -e '^src/adapters/ssh$' -e '^src/adapters/serverfs$' -e '^src/application/vaultserver$' -e '^src/drivers/vault-server$')
fi
WT="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-tests"
rm -rf "$WT"; mkdir -p "$WT"
cd "$WT"

source "$here/rdp-servers.sh"
source "$here/vault-server.sh"
# A suite killed by its timeout leaves its test .exe running on Windows (interop does
# not pass the kill on), holding the folder: stop it too.
stop_all() {
  rdp_servers_stop
  vault_server_stop
  powershell.exe -NoProfile -c "Get-Process cfire-test* -EA SilentlyContinue | Stop-Process -Force" >/dev/null 2>&1 || true
}
trap stop_all EXIT
[[ " ${suites[*]} " == *" src/adapters/rdp "* ]] && rdp_servers_start "$WT"
[[ " ${suites[*]} " == *" src/adapters/vaultremote "* ]] && { vault_server_start "$WT" || exit 1; }

failed=0
for s in "${suites[@]}"; do
  # Each suite's whole output is kept in $WT (<suite>.log) for a failure's details.
  log="$WT/${s//\//_}.log"
  timeout -k 5 "${FLINT_SUITE_TIMEOUT:-900}" cfire test --target x86_64-w64-mingw32 "$root/$s" >"$log" 2>&1
  out="$(cat "$log")"
  # A folder with packages inside (src/application holds vaultserver) runs one suite
  # each, each with its own PASS/FAIL line: every one counts, not the last.
  lines="$(grep -E '^(PASS|FAIL) \(' <<<"$out")"
  if [[ -z "$lines" ]]; then
    summary="FAIL (no summary: $(tail -1 <<<"$out"))"
  elif grep -q '^FAIL' <<<"$lines"; then
    summary="FAIL ($(tr '\n' ' ' <<<"$lines"))"
  else
    summary="PASS ($(grep -oE '[0-9]+ cfire tests' <<<"$lines" | awk '{n += $1} END {print n}') cfire tests in $(wc -l <<<"$lines") suites)"
  fi
  echo "$s: $summary"
  if [[ "$summary" != PASS* ]]; then failed=1; grep '^--- FAIL' <<<"$out" | cut -c1-240; fi
done
exit $failed
