# source windows/bin/env.sh — Flint on the Windows test VM, natively in MSYS2 CLANG64.
#
# Puts cfire's Windows release first on PATH, Flint's Windows pkg-config files and the
# static FreeRDP (windows/bin/freerdp.sh) on pkg-config's path, and keeps everything a
# run writes under C:\flint-work: the temp folder and cfire's caches.
#
#   FLINT_WIN_OPT  where cfire and FreeRDP live   (default /c/flint-work/opt)
#   FLINT_CFIRE    cfire's folder (cfire.exe + runtime\)  (default $FLINT_WIN_OPT/cfire-0.12.2)
if [ "${MSYSTEM:-}" != CLANG64 ]; then
  echo "windows/bin/env.sh: run it in MSYS2 CLANG64 (MSYSTEM=${MSYSTEM:-unset})" >&2
  return 2 2>/dev/null || exit 2
fi
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_root="$(cd "$_d/../.." && pwd)"
export FLINT_WIN_OPT="${FLINT_WIN_OPT:-/c/flint-work/opt}"
export FLINT_CFIRE="${FLINT_CFIRE:-$FLINT_WIN_OPT/cfire-0.12.2}"
export PATH="$FLINT_CFIRE:$PATH"
export CFIRE_RUNTIME_DIR="$(cygpath -m "$FLINT_CFIRE/runtime")"
export CFIRE_CACHE_DIR="$(cygpath -m /c/flint-work/cache/cfire)"
export TMPDIR=/c/flint-work/tmp
export TMP="$(cygpath -w "$TMPDIR")" TEMP="$(cygpath -w "$TMPDIR")"
mkdir -p "$TMPDIR" /c/flint-work/cache/cfire
# Flint's own .pc files (scripts/env.sh picks the windows folder under MSYS2), then
# FreeRDP's. CLANG64's system .pc folder stays pkg-config's default.
. "$_root/scripts/env.sh"
export PKG_CONFIG_PATH="$PKG_CONFIG_PATH:$FLINT_WIN_OPT/freerdp/lib/pkgconfig"
unset _d _root
