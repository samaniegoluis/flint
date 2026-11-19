#!/usr/bin/env bash
# Builds Flint's own RDP test server (milestone 31) into build/flint-rdp-testserver:
# the clipboard both ways, the keys a tab sends and a dropped connection, which
# FreeRDP's sample server cannot show (it has no clipboard channel). Needs FreeRDP 3's
# server library (`freerdp-server3` in pkg-config: Homebrew's freerdp, Debian's
# freerdp3-dev; on Windows, windows/bin/freerdp.sh). Prints the binary's path; exits 1
# when the library is missing.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/src/adapters/rdp/native/testserver/flint_rdp_testserver.cpp"
out="$root/build/flint-rdp-testserver"
pkg-config --exists freerdp-server3 freerdp3 winpr3 || exit 1
mkdir -p "$root/build"
case "$(uname -s)" in
  MINGW*|CLANG*|MSYS*)
    # Windows (MSYS2 CLANG64), on the static FreeRDP of windows/bin/freerdp.sh.
    # WIN32_LEAN_AND_MEAN, as FreeRDP builds: the whole <windows.h> brings shellapi.h,
    # whose NIIF_* macros clash with rail.h. FREERDP_EXPORTS/WINPR_EXPORTS: FreeRDP's API
    # macros have no static mode and say dllimport otherwise. The Windows libraries are
    # flint-rdp.pc's.
    out="$out.exe"
    if [[ ! -f "$out" || "$src" -nt "$out" ]]; then
      # shellcheck disable=SC2046
      clang++ -std=c++17 -O1 -w -static -D__STDC_NO_THREADS__ -DWIN32_LEAN_AND_MEAN \
        -DFREERDP_EXPORTS -DWINPR_EXPORTS "$src" \
        $(pkg-config --static --cflags --libs freerdp-server3 freerdp3 winpr3 libssl libcrypto zlib) \
        $(sed -n 's/^Libs: //p' "$root/src/adapters/pkgconfig/windows/flint-rdp.pc") -o "$out" >&2
    fi
    ;;
  *)
    if [[ ! -x "$out" || "$src" -nt "$out" ]]; then
      # shellcheck disable=SC2046
      c++ -std=c++17 -O1 -w "$src" $(pkg-config --cflags --libs freerdp-server3 freerdp3 winpr3) -lpthread -o "$out" 2>&1 | grep -v "built for newer version" >&2 || true
    fi
    ;;
esac
[[ -x "$out" ]] || exit 1
echo "$out"
