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
# src/adapters/rdp is left out too: milestone 28's RDP spike needs libfreerdp, which has
# no Windows build here (main checks RDP on Windows at milestone 30).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
source "$here/bin/env.sh"
suites=("$@")
if [[ ${#suites[@]} == 0 ]]; then
  mapfile -t suites < <(cd "$root" && find src -name '*_test.cf' -not -path '*/.cfire/*' | xargs -n1 dirname | sort -u | grep -v -e '^src/adapters/ssh$' -e '^src/adapters/rdp$')
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
