# Sourced by windows/bin/env.sh, setup.sh and freerdp.sh (POSIX sh): where a Windows build
# keeps its tools, temp files and caches, in FLINT_WIN_HOME.
#   C:\flint-work                    on the Windows test VM (docs/cfire-migration.md),
#                                    which has C:\flint-work\opt
#   %LOCALAPPDATA%\flint-build       anywhere else
# FLINT_WIN_OPT (tools: cfire, FreeRDP, the WebView2 loader, Node) defaults to its opt\.
if [ -z "${FLINT_WIN_HOME:-}" ]; then
  if [ -d /c/flint-work/opt ]; then
    FLINT_WIN_HOME=/c/flint-work
  else
    FLINT_WIN_HOME="$(cygpath -u "$LOCALAPPDATA")/flint-build"
  fi
fi
export FLINT_WIN_HOME
export FLINT_WIN_OPT="${FLINT_WIN_OPT:-$FLINT_WIN_HOME/opt}"
