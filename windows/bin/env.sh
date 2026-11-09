# source windows/bin/env.sh — cross-compile cfire programs for Windows from WSL2.
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export CFIRE_CXX="$_d/xcxx"
export PATH="$HOME/.local/bin:$PATH"
# Point pkg-config at the Windows sysroot, never the host's .pc files.
export PKG_CONFIG_SYSROOT_DIR="${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}"
export PKG_CONFIG_LIBDIR="$PKG_CONFIG_SYSROOT_DIR/clang64/lib/pkgconfig"
unset _d
