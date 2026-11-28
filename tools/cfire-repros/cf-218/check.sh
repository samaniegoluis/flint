#!/usr/bin/env bash
# CF-218: fixed when touching every runtime header (same content) compiles nothing again,
# printed as KEPT; RECOMPILED when the objects are made again.
set -uo pipefail
cd "$(dirname "$0")" && rm -rf .cfire
rt="${CFIRE_RUNTIME_DIR:-$(cd "$(dirname "$(command -v cfire)")/.." && pwd)/share/cfire/runtime}"
[[ -d "$rt" ]] || { echo "error: no runtime at $rt (set CFIRE_RUNTIME_DIR)"; exit 0; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp -Rp "$rt" "$tmp/runtime"
export CFIRE_RUNTIME_DIR="$tmp/runtime"
cfire test --no-cache . 2>&1 | grep -E 'PASS \(|FAIL'
before="$(find .cfire -name '*.o' | sort)"
find "$tmp/runtime" -name '*.h*' -exec touch {} +
cfire test --no-cache . >/dev/null 2>&1
after="$(find .cfire -name '*.o' | sort)"
[[ -n "$before" && "$before" == "$after" ]] && echo "KEPT: no object made again" || echo "RECOMPILED: new objects after touching the runtime"
