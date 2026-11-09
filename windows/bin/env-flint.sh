# source windows/bin/env-flint.sh — like env.sh, but with the cfire Flint builds against:
# 24a43f6 (Winsock, before the module renames of b3909cc) + 5c06d4a + the windows-fixes
# patches, branch windows-fixes-flint of the local clone, installed in ~/.local/opt/cfire-flint.
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
source "$_d/env.sh"
_d="$(cd "$(dirname "${BASH_SOURCE[0]:-${(%):-%x}}")" && pwd)"
export PATH="$_d/pc:$HOME/.local/opt/cfire-flint/bin:$PATH"
export CFIRE_RUNTIME_DIR="$HOME/.local/opt/cfire-flint/share/cfire/runtime"
unset _d
