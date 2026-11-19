# Registers the FlintDesktop scheduled task on the Windows test VM, once (owner,
# 2026-11-19). It runs windows\vm\desktop-run.cmd as the signed-in user, only while that
# user is logged on (Interactive: no stored password), not elevated, so a job sees the
# desktop session that automatic logon keeps on the console. No trigger: windows/desktop.sh
# starts it on demand. The console it runs in is headless, so no window takes the focus.
#
#   flint exec Windows11-Flint-SSH -- "& C:\flint-work\flint\windows\vm\desktop-setup.ps1"
$run = 'C:\flint-work\flint\windows\vm\desktop-run.cmd'
$a = New-ScheduledTaskAction -Execute "$env:windir\System32\conhost.exe" -Argument "--headless cmd.exe /c $run"
$p = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName FlintDesktop -Action $a -Principal $p -Settings $s -Force | Select-Object TaskName, State
