#!/bin/bash
# Run a bash script on the Windows test VM, in MSYS2 CLANG64, over `flint exec` (the
# Mac is the base; the VM only pulls). The script is sent base64-encoded into
# C:\flint-work\tmp, so no quoting crosses PowerShell.
#
#   windows/remote.sh <script.sh>                # e.g. one that sources windows/bin/env.sh
#   FLINT_VM_HOST=other windows/remote.sh x.sh   # another Flint host
#   windows/remote.sh --put <local> <repo path>  # copy one file into C:\flint-work\flint
#
# flint exec stops a command after 600 s unless told otherwise: FLINT_VM_TIMEOUT (default
# 7200). Long runs: write their log on the VM and read it with a second, short script.
set -euo pipefail
host="${FLINT_VM_HOST:-Windows11-Flint-SSH}"
if [[ "${1:-}" == --put ]]; then
  src=$2; rel=$3
  win="C:\\flint-work\\flint\\${rel//\//\\}"
  b64=$(base64 < "$src" | tr -d '\n'); first=1
  # Chunks of 20 000 characters: Windows caps a command line at 32 767.
  while [[ -n "$b64" || $first == 1 ]]; do
    chunk=${b64:0:20000}; b64=${b64:20000}
    if [[ $first == 1 ]]; then mode=Create; first=0; else mode=Append; fi
    flint exec "$host" -- "\$p='$win'; New-Item -ItemType Directory -Force (Split-Path \$p) | Out-Null; \$b=[Convert]::FromBase64String('$chunk'); \$f=[IO.File]::Open(\$p,[IO.FileMode]::$mode); \$f.Write(\$b,0,\$b.Length); \$f.Close()" >/dev/null
  done
  exit 0
fi
src=$1; name=$(basename "$src")
b64=$(base64 < "$src" | tr -d '\n')
exec flint exec "$host" --exec-timeout "${FLINT_VM_TIMEOUT:-7200}" -- "New-Item -ItemType Directory -Force C:\\flint-work\\tmp | Out-Null; [IO.File]::WriteAllBytes('C:\\flint-work\\tmp\\$name', [Convert]::FromBase64String('$b64')); \$env:MSYSTEM='CLANG64'; \$env:CHERE_INVOKING='1'; C:\\msys64\\usr\\bin\\bash.exe -l /c/flint-work/tmp/$name; exit \$LASTEXITCODE"
