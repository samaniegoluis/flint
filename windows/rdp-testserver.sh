#!/usr/bin/env bash
# Builds Flint's own RDP test server (milestone 31) for Windows into
# build/flint-rdp-testserver.exe, on the static FreeRDP from bin/freerdp.sh (built with
# its server library for this). Test code, never shipped. Prints the .exe's path.
# The Windows twin of scripts/rdp-testserver.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
"$here/bin/freerdp.sh" >/dev/null
source "$here/bin/env.sh"
src="$root/src/adapters/rdp/native/testserver/flint_rdp_testserver.cpp"
out="$root/build/flint-rdp-testserver.exe"
mkdir -p "$root/build"
if [[ ! -f "$out" || "$src" -nt "$out" ]]; then
  # WIN32_LEAN_AND_MEAN, as FreeRDP builds: the whole <windows.h> brings shellapi.h,
  # whose NIIF_* macros clash with rail.h (the app shim sets them aside instead).
  # FREERDP_EXPORTS/WINPR_EXPORTS: FreeRDP's API macros have no static mode and say
  # dllimport otherwise (as in the shim). The Windows libraries are flint-rdp.pc's.
  # shellcheck disable=SC2046
  "$CFIRE_CXX" -std=c++17 -O1 -w -D__STDC_NO_THREADS__ -DWIN32_LEAN_AND_MEAN \
    -DFREERDP_EXPORTS -DWINPR_EXPORTS "$src" \
    $(pkg-config --cflags --libs freerdp-server3 freerdp3 winpr3 libssl libcrypto zlib) \
    $(sed -n 's/^Libs: //p' "$root/src/adapters/pkgconfig/windows/flint-rdp.pc") -o "$out" >&2
fi
echo "$out"
