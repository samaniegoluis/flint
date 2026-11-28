#!/usr/bin/env bash
# Runs every cfire repro kept here (milestone 78) and prints one line per entry:
#   CF-NNN  fixed | open  <the line that decided it>
# Each folder is a workspace of its own (`cfire test .`); `fixed-when` holds the text
# whose presence in the output means the entry is fixed (most: "PASS ("; CF-098: the
# diagnostic that now rejects its code). Exit 0 always: the lines are the result.
#
#   tools/cfire-repros/run.sh              # every entry
#   tools/cfire-repros/run.sh cf-137 cf-208
# On Windows, run it with windows/bin/cfire-shim first on PATH (`--no-shard`, CF-207).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
dirs=("$@")
[[ ${#dirs[@]} -eq 0 ]] && dirs=(cf-*)
echo "cfire: $(cfire --version 2>&1 | head -1)  os: $(uname -s)"
for d in "${dirs[@]}"; do
  d="${d%/}"
  # A folder with its own check.sh (CF-215: what the build leaves on disk) runs that.
  if [[ -x "$d/check.sh" ]]; then out="$("$d/check.sh" 2>&1)"; else out="$(cd "$d" && cfire test . 2>&1)"; fi
  want="$(cat "$d/fixed-when")"
  id="$(echo "$d" | tr a-z A-Z)"
  if grep -qF -- "$want" <<<"$out"; then verdict=fixed; else verdict=open; fi
  why="$(grep -E -- '--- FAIL|PASS \(|FAIL \(|cfire/[A-Z-]+|error:|SHARED|COPIES|No test suites' <<<"$out" | head -1)"
  printf '%-7s %-6s %s\n' "$id" "$verdict" "${why:0:150}"
  [[ -n "${REPRO_VERBOSE:-}" ]] && echo "$out"
done
exit 0
