#!/usr/bin/env bash
# Milestone 50's check of *Add flint to PATH* on the real user Path, in two desktop jobs
# (windows/desktop.sh), since only a program started after the change sees it:
#
#   windows/vm/path-check.sh add <unpacked Flint folder>   # saves Path, adds its bin
#   windows/vm/path-check.sh look                          # a new process: which flint?
#   windows/vm/path-check.sh restore                       # the saved Path back
#
# The add goes through the app's own adapter (src/adapters/clilink, opt-in test). The
# saved value is the registry's as written (REG_EXPAND_SZ), restored with reg.exe.
set -euo pipefail
cd "$(dirname "$0")/../.."
saved=/c/flint-work/tmp/path-check.saved
case "${1:-}" in
  add)
    [[ -f "$saved" ]] || MSYS2_ARG_CONV_EXCL='*' reg query 'HKCU\Environment' /v Path \
      | sed -n 's/^ *Path *REG_[A-Z_]* *//p' | tr -d '\r' > "$saved"
    echo "saved Path: $(cat "$saved")"
    . windows/bin/env.sh
    FLINT_TEST_REAL_PATH_BIN="$(cygpath -m "$2/bin")" cfire test --release src/adapters/clilink 2>&1 \
      | grep -E "real Path|^--- FAIL|left:" ;;
  look)
    # Started by the Task Scheduler, this job's environment is the registry's now.
    powershell -NoProfile -Command '$c = Get-Command flint -ErrorAction SilentlyContinue; if ($c) { "flint is " + $c.Source; & $c.Source --version | Select-Object -First 1 } else { "flint not found" }; ($env:Path -split ";")[0..2] -join " | "' ;;
  restore)
    [[ -f "$saved" ]] || { echo "nothing saved"; exit 1; }
    MSYS2_ARG_CONV_EXCL='*' reg add 'HKCU\Environment' /v Path /t REG_EXPAND_SZ /d "$(cat "$saved")" /f >/dev/null
    rm -f "$saved"
    echo "restored Path: $(MSYS2_ARG_CONV_EXCL='*' reg query 'HKCU\Environment' /v Path | sed -n 's/^ *Path *REG_[A-Z_]* *//p' | tr -d '\r')" ;;
  *) echo "usage: path-check.sh add <Flint folder> | look | restore" >&2; exit 2 ;;
esac
