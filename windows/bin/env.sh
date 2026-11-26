# source windows/bin/env.sh — Flint on the Windows test VM, natively in MSYS2 CLANG64.
#
# Puts cfire's Windows release first on PATH, Flint's Windows pkg-config files and the
# static FreeRDP (windows/bin/freerdp.sh) on pkg-config's path, and keeps everything a
# run writes under FLINT_WIN_HOME (windows/bin/home.sh: C:\flint-work on the test VM,
# %LOCALAPPDATA%\flint-build elsewhere): the temp folder and cfire's caches.
#
#   FLINT_WIN_OPT  where cfire and FreeRDP live   (default $FLINT_WIN_HOME/opt)
#   FLINT_CFIRE    cfire's folder (cfire.exe + runtime\)  (default $FLINT_WIN_OPT/cfire-0.12.7)
#   FLINT_WV2      WebView2Loader.dll's folder, from the Microsoft.Web.WebView2 NuGet package
#                  (default $FLINT_WIN_OPT/webview2/1.0.4314.35)
if [ "${MSYSTEM:-}" != CLANG64 ]; then
  echo "windows/bin/env.sh: run it in MSYS2 CLANG64 (MSYSTEM=${MSYSTEM:-unset})" >&2
  return 2 2>/dev/null || exit 2
fi
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_root="$(cd "$_d/../.." && pwd)"
. "$_d/home.sh"
export FLINT_CFIRE="${FLINT_CFIRE:-$FLINT_WIN_OPT/cfire-0.12.7}"
# FreeRDP's bin: its sample server, sfreerdp-server, for the RDP suite (scripts/test.sh).
# WebView2Loader.dll: cfire's fallback without it never finds the installed runtime (W-10),
# so every webui window needs it beside the .exe or on PATH.
export FLINT_WV2="${FLINT_WV2:-$FLINT_WIN_OPT/webview2/1.0.4314.35}"
# Node (the official win-x64 zip, in $FLINT_WIN_OPT/node): scripts/build-gui.sh builds ui/.
export PATH="$FLINT_CFIRE:$FLINT_WIN_OPT/freerdp/bin:$FLINT_WV2:$FLINT_WIN_OPT/node:$PATH"
export CFIRE_RUNTIME_DIR="$(cygpath -m "$FLINT_CFIRE/runtime")"
export CFIRE_CACHE_DIR="$(cygpath -m "$FLINT_WIN_HOME/cache/cfire")"
export TMPDIR="$FLINT_WIN_HOME/tmp"
# `ln -s` makes a real Windows symbolic link (Developer Mode allows it), not MSYS2's
# default copy: cli-e2e names a vault through a link inside its own folder.
export MSYS="${MSYS:+$MSYS }winsymlinks:nativestrict"
export TMP="$(cygpath -w "$TMPDIR")" TEMP="$(cygpath -w "$TMPDIR")"
mkdir -p "$TMPDIR" "$FLINT_WIN_HOME/cache/cfire"
# Flint's own .pc files (scripts/env.sh picks the windows folder under MSYS2), then
# FreeRDP's. CLANG64's system .pc folder stays pkg-config's default.
. "$_root/scripts/env.sh"
export PKG_CONFIG_PATH="$PKG_CONFIG_PATH:$FLINT_WIN_OPT/freerdp/lib/pkgconfig"
unset _d _root
