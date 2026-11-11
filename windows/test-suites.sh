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
# src/adapters/rdp runs on FreeRDP built by bin/freerdp.sh. Its tests against FreeRDP's
# sample server (FLINT_RDP_SAMPLE_PORT) and a real Windows host (FLINT_RDP_TEST_HOST)
# return early without them and print PASS: count them as skipped. Neither is set here
# (no sample server for Windows; the real host is the owner's check).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
"$here/bin/freerdp.sh" >/dev/null
source "$here/bin/env.sh"
suites=("$@")
if [[ ${#suites[@]} == 0 ]]; then
  mapfile -t suites < <(cd "$root" && find src -name '*_test.cf' -not -path '*/.cfire/*' | xargs -n1 dirname | sort -u | grep -v -e '^src/adapters/ssh$')
fi
WT="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/flint-tests"
rm -rf "$WT"; mkdir -p "$WT"
cd "$WT"
failed=0
for s in "${suites[@]}"; do
  out="$(timeout 600 cfire test --target x86_64-w64-mingw32 "$root/$s" 2>&1)"
  summary="$(grep -E '^(PASS|FAIL) \(' <<<"$out" | tail -1)"
  [[ -n "$summary" ]] || summary="FAIL (no summary: $(tail -1 <<<"$out"))"
  echo "$s: $summary"
  if [[ "$summary" != PASS* ]]; then failed=1; grep '^--- FAIL' <<<"$out" | cut -c1-240; fi
done
exit $failed
