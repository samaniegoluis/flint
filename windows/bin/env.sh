# source windows/bin/env.sh — cross-compile cfire programs for Windows from WSL2.
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export CFIRE_CXX="$_d/xcxx"
# The resource compiler for the app icon (cfire W-13): llvm-mingw's, not on PATH.
export CFIRE_WINDRES="$(command ls -d "$HOME"/.local/opt/llvm-mingw-* | tail -1)/bin/x86_64-w64-mingw32-windres"
export PATH="$_d/pc:$HOME/.local/bin:$PATH"
# Point pkg-config at the Windows sysroot and Flint's Windows shims, never the host's.
unset PKG_CONFIG_SYSROOT_DIR
export PKG_CONFIG_LIBDIR="${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}/clang64/lib/pkgconfig"
export PKG_CONFIG_PATH="$(cd "$_d/../.." && pwd)/src/adapters/pkgconfig/windows"
unset _d
