#!/usr/bin/env bash
# Milestone 28's RDP spike: runs the measurement in each frame transport mode against
# the test Windows host and prints the results with the process's CPU use.
#
#   scripts/rdp-spike.sh                # both modes, measured
#   scripts/rdp-spike.sh events|channel # one mode
#   FLINT_RDP_SPIKE_AUTO=0 scripts/rdp-spike.sh channel   # interactive, no measurement
#
# Needs FLINT_RDP_TEST_HOST, _USER and _PASSWORD (Infisical, /ai-agents): run it as
#   sec with FLINT_RDP_TEST_HOST FLINT_RDP_TEST_USER FLINT_RDP_TEST_PASSWORD -- scripts/rdp-spike.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
. scripts/env.sh
modes=("${@:-events channel}")
[[ $# -eq 0 ]] && modes=(events channel)
case "$(uname -s)" in
  Darwin) bin="build/rdpspike/flint-rdp-spike.app/Contents/MacOS/flint-rdp-spike" ;;
  *)      bin="build/rdpspike/flint-rdp-spike" ;;
esac
[[ -x "$bin" ]] || bin="build/rdpspike/flint-rdp-spike"
export FLINT_RDP_SPIKE_PAGE="$root/src/drivers/rdpspike/page"
export FLINT_RDP_SPIKE_AUTO="${FLINT_RDP_SPIKE_AUTO:-1}"
export WLOG_LEVEL="${WLOG_LEVEL:-OFF}"
for mode in "${modes[@]}"; do
  out="$(mktemp "${TMPDIR:-/tmp}/rdp-spike.XXXXXX")"
  FLINT_RDP_SPIKE_MODE="$mode" "$bin" >"$out" 2>&1 &
  pid=$!
  samples=()
  # CPU of the app and of WebKit's content processes once a second.
  while kill -0 "$pid" 2>/dev/null; do
    cpu="$(ps -o %cpu= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    web="$(ps -A -o %cpu=,comm= | awk '/WebContent|WebKitWebProces/ {s+=$1} END {print s+0}')"
    [[ -n "$cpu" ]] && samples+=("$cpu $web")
    sleep 1
  done
  wait "$pid" || true
  printf '%s\n' "${samples[@]}" | awk -v m="$mode" 'NF==2 && $1>0 {a+=$1; w+=$2; n++; if ($1>pa) pa=$1; if ($2>pw) pw=$2} END {printf "CPU %s: app avg %.0f%% peak %.0f%% · webcontent avg %.0f%% peak %.0f%% (%d samples)\n", m, a/n, pa, w/n, pw, n}'
  grep '^RESULT' "$out" || { echo "no result for $mode:"; tail -20 "$out"; }
  rm -f "$out"
done
