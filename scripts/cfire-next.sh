#!/usr/bin/env bash
# Runs one command with the new cfire first on PATH (docs/cfire-migration.md, step 1).
# Only on the migration branch: the old cfire in ~/.local/bin stays the default.
#
#   scripts/cfire-next.sh cfire --version
#   scripts/cfire-next.sh cfire check src/domain
#   scripts/cfire-next.sh scripts/test.sh src/domain
#   CFIRE_NEXT=~/.local/opt/cfire-0.12.0 scripts/cfire-next.sh cfire doctor
#
# The new cfire lives in its own prefix (~/.local/opt/cfire-<version>) and finds its
# runtime at <prefix>/share/cfire/runtime. CFIRE_RUNTIME_DIR is pinned there too, so a
# value left over in the environment can never point it at ~/.cfire/runtime, the old
# cfire's headers. Exit status: the command's, or 2 on a usage error or a missing
# install.
set -euo pipefail

prefix="${CFIRE_NEXT:-$HOME/.local/opt/cfire-0.12.2}"
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/cfire-next.sh <command> [args...]" >&2
  exit 2
fi
if [[ ! -x "$prefix/bin/cfire" || ! -f "$prefix/share/cfire/runtime/cfire_prelude.hpp" ]]; then
  echo "cfire-next: no cfire installed at $prefix (see docs/cfire-migration.md, step 1)" >&2
  exit 2
fi

export PATH="$prefix/bin:$PATH"
export CFIRE_RUNTIME_DIR="$prefix/share/cfire/runtime"
exec "$@"
