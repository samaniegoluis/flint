# Source this before running cfire on Flint:  . scripts/env.sh
#
# Puts the native shims' pkg-config folder for this OS on PKG_CONFIG_PATH. cfire
# cannot link an Apple framework or select per-platform sources (CF-031), so the
# keychain and process adapters reach their headers and link flags through
# pkg-config (src/adapters/pkgconfig/<os>/flint-native.pc).
_flint_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
case "$(uname -s)" in
  Darwin) _flint_os=darwin ;;
  *)      _flint_os=linux ;;
esac
export PKG_CONFIG_PATH="$_flint_root/src/adapters/pkgconfig/$_flint_os${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
unset _flint_root _flint_os
