#!/usr/bin/env bash
# Builds and tests Flint on Linux inside Docker (see scripts/linux/Dockerfile).
# Copies the working tree into the container, so nothing is written back.
# scripts/linux/root.sh starts the password sshds, then scripts/linux/inside.sh runs
# the build and every check as the unprivileged `flint` user.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
image="flint-linux-check"

# The container has no Node: the page is built here and copied in with the tree.
(cd "$root/ui" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build)
docker build -t "$image" -f "$root/scripts/linux/Dockerfile" "$root/scripts/linux"
docker run --rm --user root -e FLINT_E2E_VIM -v "$root:/src:ro" "$image" bash /src/scripts/linux/root.sh
