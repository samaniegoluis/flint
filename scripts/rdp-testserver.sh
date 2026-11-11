#!/usr/bin/env bash
# Builds Flint's own RDP test server (milestone 31) into build/flint-rdp-testserver:
# the clipboard both ways, the keys a tab sends and a dropped connection, which
# FreeRDP's sample server cannot show (it has no clipboard channel). Needs FreeRDP 3's
# server library (`freerdp-server3` in pkg-config: Homebrew's freerdp, Debian's
# freerdp3-dev). Prints the binary's path; exits 1 when the library is missing.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/src/adapters/rdp/native/testserver/flint_rdp_testserver.cpp"
out="$root/build/flint-rdp-testserver"
pkg-config --exists freerdp-server3 freerdp3 winpr3 || exit 1
mkdir -p "$root/build"
if [[ ! -x "$out" || "$src" -nt "$out" ]]; then
  # shellcheck disable=SC2046
  c++ -std=c++17 -O1 -w "$src" $(pkg-config --cflags --libs freerdp-server3 freerdp3 winpr3) -lpthread -o "$out" 2>&1 | grep -v "built for newer version" >&2 || true
fi
[[ -x "$out" ]] || exit 1
echo "$out"
