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
    # A program the person starts comes from Explorer, which heard the app's
    # WM_SETTINGCHANGE; this job's own shell is MSYS2's, whose login drops Windows'
    # Path. So Explorer runs a .cmd that writes where `flint` resolves.
    out=/c/flint-work/tmp/path-check.look; rm -f "$out"
    printf '@echo off\r\nwhere flint > "%s" 2>&1\r\nflint --version >> "%s" 2>&1\r\n' \
      "$(cygpath -w "$out")" "$(cygpath -w "$out")" > /c/flint-work/tmp/path-check.cmd
    explorer.exe "$(cygpath -w /c/flint-work/tmp/path-check.cmd)" || true
    for _ in $(seq 1 30); do [[ -s "$out" ]] && grep -q "flint\|Could not" "$out" && break; sleep 1; done
    sleep 2
    tr -d '\r' < "$out" ;;
  restore)
    [[ -f "$saved" ]] || { echo "nothing saved"; exit 1; }
    MSYS2_ARG_CONV_EXCL='*' reg add 'HKCU\Environment' /v Path /t REG_EXPAND_SZ /d "$(cat "$saved")" /f >/dev/null
    rm -f "$saved"
    echo "restored Path: $(MSYS2_ARG_CONV_EXCL='*' reg query 'HKCU\Environment' /v Path | sed -n 's/^ *Path *REG_[A-Z_]* *//p' | tr -d '\r')" ;;
  *) echo "usage: path-check.sh add <Flint folder> | look | restore" >&2; exit 2 ;;
esac
