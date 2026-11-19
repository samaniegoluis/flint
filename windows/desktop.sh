#!/bin/bash
# Run a bash script in the Windows test VM's desktop session: what an SSH logon cannot
# do (a WebView2 window, Credential Manager). The script goes to
# C:\flint-work\tmp\desktop-job.sh, the FlintDesktop task (windows/vm/desktop-setup.ps1)
# runs it in MSYS2 CLANG64 as the user automatic logon signed in, and this waits for it,
# then prints its output and exits with its status. One flint exec, so one approval.
#
#   windows/desktop.sh <script.sh>         # e.g. one that sources windows/bin/env.sh
#   FLINT_VM_TIMEOUT=3600 windows/desktop.sh x.sh   # how long to wait (default 7200 s)
#
# Exit status: the script's; 124 when it did not end in time; 3 when nobody is signed
# in on the console (automatic logon, or the session moved to RDP and not back:
# C:\flint-work\bin\to-console.cmd).
set -euo pipefail
host="${FLINT_VM_HOST:-Windows11-Flint-SSH}"
limit="${FLINT_VM_TIMEOUT:-7200}"
src=$1
b64=$(base64 < "$src" | tr -d '\n')
exec flint exec "$host" --exec-timeout "$((limit + 60))" -- "
\$t='C:\\flint-work\\tmp'; New-Item -ItemType Directory -Force \$t | Out-Null
if (-not (query user 2>\$null | Select-String ' console ')) { 'desktop: nobody is signed in on the console'; exit 3 }
Remove-Item \"\$t\\desktop-job.rc\",\"\$t\\desktop-job.log\" -ErrorAction SilentlyContinue
[IO.File]::WriteAllBytes(\"\$t\\desktop-job.sh\", [Convert]::FromBase64String('$b64'))
Start-ScheduledTask -TaskName FlintDesktop
\$end = (Get-Date).AddSeconds($limit)
while (-not (Test-Path \"\$t\\desktop-job.rc\")) {
  if ((Get-Date) -gt \$end) { Get-Content \"\$t\\desktop-job.log\" -ErrorAction SilentlyContinue; 'desktop: no end after $limit s'; exit 124 }
  Start-Sleep -Seconds 2
}
Get-Content \"\$t\\desktop-job.log\"
exit [int](Get-Content \"\$t\\desktop-job.rc\")
"
