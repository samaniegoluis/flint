#!/usr/bin/env bash
# The desktop app under a virtual X display: what `flint` starts when the end-to-end
# run sets FLINT_APP to this script (scripts/serve-e2e.sh, Linux check).
root="$(cd "$(dirname "$0")/../.." && pwd)"
exec timeout 200 xvfb-run -a "$root/build/gui/Flint" "$@"
