#!/usr/bin/env bash
# CF-221: fixed when a second `cfire test --no-cache` reuses the binary it linked the first
# time (REUSED); RELINKED when the binary is made again. Watched through the user cache's
# files: a fresh CFIRE_CACHE_DIR, and any file written by the second run.
set -uo pipefail
cd "$(dirname "$0")" && rm -rf .cfire
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export CFIRE_CACHE_DIR="$tmp/cache"
cfire test --release --no-cache . 2>&1 | grep -E 'PASS \(|FAIL'
touch "$tmp/mark"; sleep 1
cfire test --release --no-cache . >/dev/null 2>&1
n=$( { find "$tmp/cache" .cfire -type f -newer "$tmp/mark" 2>/dev/null | grep -vE '/test/|\.json$|\.log$'; } | wc -l | tr -d ' ')
[[ $n == 0 ]] && echo "REUSED: no binary made again" || echo "RELINKED: $n build files written by the second run"
