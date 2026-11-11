#!/usr/bin/env bash
# Builds and tests Flint on Linux inside Docker (see scripts/linux/Dockerfile).
# Copies the working tree into the container, so nothing is written back.
# scripts/linux/root.sh starts the password sshds, then scripts/linux/inside.sh runs
# the build and every check as the unprivileged `flint` user.
#
#   scripts/linux-check.sh                                          # everything
#   FLINT_LINUX_STEPS=serve scripts/linux-check.sh                  # the build, then serve-e2e only
#   FLINT_LINUX_STEPS=tests FLINT_LINUX_SUITES=src/adapters/ssh scripts/linux-check.sh
#
# Steps: tests, cli, gui, serve (comma-separated). Run them all before closing a milestone.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
image="flint-linux-check"

# The container has no Node: the page is built here and copied in with the tree.
(cd "$root/ui" && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build)
docker build -t "$image" -f "$root/scripts/linux/Dockerfile" "$root/scripts/linux"
# The RDP adapter's live tests run when the test host is given (milestone 28):
#   sec with FLINT_RDP_TEST_HOST FLINT_RDP_TEST_USER FLINT_RDP_TEST_PASSWORD -- scripts/linux-check.sh
# The RDP adapter's quiet-network test drops packets with iptables (milestone 31):
#   FLINT_RDP_BLACKHOLE=1 FLINT_LINUX_STEPS=tests FLINT_LINUX_SUITES=src/adapters/rdp scripts/linux-check.sh
caps=()
[[ "${FLINT_RDP_BLACKHOLE:-}" == 1 ]] && caps=(--cap-add NET_ADMIN)
docker run --rm --user root ${caps[@]+"${caps[@]}"} -e FLINT_E2E_VIM -e FLINT_LINUX_STEPS -e FLINT_LINUX_SUITES -e FLINT_RDP_BLACKHOLE -e FLINT_RDP_TEST_HOST -e FLINT_RDP_TEST_USER -e FLINT_RDP_TEST_PASSWORD -v "$root:/src:ro" "$image" bash /src/scripts/linux/root.sh
