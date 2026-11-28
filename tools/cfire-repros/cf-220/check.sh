#!/usr/bin/env bash
# CF-220: the same workspace copied twice, its package's files made in name order and in
# reverse; fixed when both builds emit the same generated C++ (SAME). APFS lists by name,
# so on macOS both orders read the same and the entry can only be seen on Linux.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [[ "$(uname -s)" == Darwin ]]; then echo "SKIP: APFS lists by name; run on Linux"; exit 0; fi
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
for order in fwd rev; do
  d="$tmp/$order/w"; mkdir -p "$d/core"
  cp "$here/build.cf" "$here/repro_test.cf" "$d/"
  files=(alpha.cf mid.cf zulu.cf); [[ $order == rev ]] && files=(zulu.cf mid.cf alpha.cf)
  for f in "${files[@]}"; do cp "$here/core/$f" "$d/core/$f"; done
  (cd "$d" && cfire test --no-cache . 2>&1 | grep -E 'PASS \(|FAIL' | head -1)
done
norm() { find "$1" -path '*/.cfire/*' \( -name '*.hpp' -o -name '*.cpp' \) -exec cat {} + 2>/dev/null | sed "s#$1##g" | grep -E 'struct (Alpha|Mid|Zulu)' ; }
a="$(norm "$tmp/fwd/w")"; b="$(norm "$tmp/rev/w")"
[[ -z "$a" ]] && { echo "error: no generated C++ found under .cfire"; exit 0; }
[[ "$a" == "$b" ]] && echo "SAME: one order of declarations" || { echo "DIFFERS: the listing order reached the generated C++"; diff <(echo "$a") <(echo "$b") | head -6; }
