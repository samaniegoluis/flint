#!/usr/bin/env bash
# Builds and tests Flint on Linux inside Docker (see scripts/linux/Dockerfile).
# Copies the working tree into the container, so nothing is written back.
# scripts/linux/root.sh starts the password sshds, then scripts/linux/inside.sh runs
# the build and every check as the unprivileged `flint` user.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
image="flint-linux-check"

docker build -t "$image" -f "$root/scripts/linux/Dockerfile" "$root/scripts/linux"
docker run --rm --user root -v "$root:/src:ro" "$image" bash /src/scripts/linux/root.sh
