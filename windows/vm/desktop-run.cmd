@echo off
rem The FlintDesktop task's action (windows/vm/desktop-setup.ps1): runs
rem C:\flint-work\tmp\desktop-job.sh in MSYS2 CLANG64 inside the logged-on desktop session,
rem where WebView2 windows open and Credential Manager works. windows/desktop.sh on the
rem Mac writes the job, starts the task and waits for desktop-job.rc.
set MSYSTEM=CLANG64
set CHERE_INVOKING=1
cd /d C:\flint-work\tmp
C:\msys64\usr\bin\bash.exe -l /c/flint-work/tmp/desktop-job.sh > C:\flint-work\tmp\desktop-job.log 2>&1
echo %ERRORLEVEL%> C:\flint-work\tmp\desktop-job.rc.tmp
move /y C:\flint-work\tmp\desktop-job.rc.tmp C:\flint-work\tmp\desktop-job.rc > nul
