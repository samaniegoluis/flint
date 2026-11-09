#!/usr/bin/env bash
# Cross-compile the Windows probes from WSL2 and run them on Windows through WSL interop.
# Needs: cfire on PATH, llvm-mingw in ~/.local/opt, the sysroot (bin/sysroot.sh).
# CFIRE_SRC: the cfire checkout whose stdlib suite to run (default: ../../cfire-windows).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/bin/env.sh"
T=x86_64-w64-mingw32
CFIRE_SRC="${CFIRE_SRC:-$here/../../cfire-windows}"
cd "$here/probes"

echo "== hello";            (cd hello && cfire build --target $T -o hello.exe main.cf >/dev/null && ./hello.exe)
echo "== platform files";   (cd platform_files && cfire build --target $T -o p.exe main.cf >/dev/null && ./p.exe)
echo "== core";             (cd argv_echo && cfire build --target $T -o ../core/argv_echo.exe main.cf >/dev/null)
(cd core && ARGV_ECHO=argv_echo.exe WSLENV=ARGV_ECHO cfire test --target $T core_test.cf | grep -E '^--- |\((.*)tests')
echo "== cfire stdlib suite"
(cd "$CFIRE_SRC" && cfire test --target $T tests/stdlib_suite_test.cf | grep -E '^--- FAIL|\((.*)tests')
echo "== webui (build only; run windows/probes/webui/webui_probe.exe by hand to see the window)"
(cd webui && cfire build --target $T -o webui_probe.exe main.cf >/dev/null && echo "built webui_probe.exe")
