#!/usr/bin/env bash
# Runs one gui-e2e run N times and prints its failure rate: the tool CLAUDE.md rule 9
# relies on (an unexplained failure is isolated and measured before a second attempt).
#
#   scripts/repeat.sh <run> <N>                  e.g. scripts/repeat.sh vim 10
#   FLINT_E2E_VISIBLE=0 scripts/repeat.sh vim 10 macOS: in cfire's offscreen WebView
#
# <run> is one of gui-e2e's runs (terminal, vault, tunnels, paste, vim). The app is
# built once and the test sshds started once; each repetition is a fresh launch on its
# own vault. Every failure is listed with the last line its page logged. Exit status: 0
# when no repetition failed, 1 otherwise, 2 on a usage error.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
if [[ $# -ne 2 || ! "$2" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: scripts/repeat.sh <run> <N>" >&2
  exit 2
fi
run="$1" n="$2"
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  "$root/scripts/build-gui.sh" >/dev/null
  FLINT_TEST_CMD="$(printf '%q ' "$root/scripts/repeat.sh" "$run" "$n")" exec "$root/scripts/test.sh"
fi

out="$(mktemp -d "${TMPDIR:-/tmp}/flint-repeat.XXXXXX")"
trap 'rm -rf "$out"' EXIT
mode=visible
[[ "${FLINT_E2E_VISIBLE:-1}" == 1 ]] || mode=offscreen
[[ "$(uname -s)" == Darwin ]] || mode=xvfb
fails=0
total_s=0
for i in $(seq 1 "$n"); do
  t0=$(date +%s)
  st=0
  FLINT_E2E_ONLY="$run" FLINT_E2E_NOBUILD=1 "$root/scripts/gui-e2e.sh" >"$out/$i.log" 2>&1 || st=$?
  dt=$(( $(date +%s) - t0 ))
  total_s=$(( total_s + dt ))
  if [[ $st -eq 2 ]]; then
    cat "$out/$i.log" >&2
    exit 2
  fi
  if [[ $st -eq 0 ]]; then
    echo "repeat: $run $i/$n: pass (${dt} s)"
  else
    fails=$(( fails + 1 ))
    verdict="$(grep '^e2e: ' "$out/$i.log" | tail -1 | cut -c1-240)"
    echo "repeat: $run $i/$n: FAIL (${dt} s) ${verdict:-no e2e line}"
  fi
done
echo "repeat: $run ($mode): $fails/$n failed ($(( fails * 100 / n )) %), $(( total_s / n )) s a run on average"
[[ $fails -eq 0 ]]
