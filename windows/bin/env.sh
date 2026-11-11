# source windows/bin/env.sh — cross-compile cfire programs for Windows from WSL2.
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export CFIRE_CXX="$_d/xcxx"
# The resource compiler for the app icon (cfire W-13): llvm-mingw's, not on PATH.
export CFIRE_WINDRES="$(command ls -d "$HOME"/.local/opt/llvm-mingw-* | tail -1)/bin/x86_64-w64-mingw32-windres"
export PATH="$_d/pc:$HOME/.local/bin:$PATH"
# Point pkg-config at the Windows sysroot and Flint's Windows shims, never the host's.
unset PKG_CONFIG_SYSROOT_DIR
_s="${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}"
# The sysroot's MSYS2 packages, and FreeRDP built static by freerdp.sh (the app only).
export PKG_CONFIG_LIBDIR="$_s/clang64/lib/pkgconfig:$_s/freerdp/lib/pkgconfig"
export PKG_CONFIG_PATH="$(cd "$_d/../.." && pwd)/src/adapters/pkgconfig/windows"
unset _d _s
