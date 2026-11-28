#!/usr/bin/env bash
# CF-215: fixed when the two suites share core's object (one compile), printed as SHARED.
cd "$(dirname "$0")" && rm -rf a/.cfire b/.cfire .cfire
cfire test --no-cache . 2>&1 | grep -E 'PASS \(|FAIL'
n=$(find . -path '*/.cfire/obj/*' -name '*u_core__core*.o' | wc -l | tr -d ' ')
[[ $n == 1 ]] && echo "SHARED: core compiled once" || echo "COPIES: core compiled $n times"
