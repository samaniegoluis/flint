# Builds Flint on Windows from this checkout in one command, and optionally installs it,
# until Flint has release downloads. Run it from PowerShell (no administrator rights,
# unless MSYS2 must be installed into a folder that needs them):
#
#   powershell -ExecutionPolicy Bypass -File windows\build.ps1             # the zip only
#   powershell -ExecutionPolicy Bypass -File windows\build.ps1 -Install    # and install it
#
# 1. MSYS2: used where it is (C:\msys64, or -Msys <folder>); if it is missing, MSYS2's
#    base archive (pinned, SHA-256 checked) is unpacked there and updated with pacman.
# 2. windows/bin/setup.sh in MSYS2 CLANG64: the native libraries, cfire's Windows
#    release, FreeRDP, the WebView2 loader and Node, pinned and checked, into
#    %LOCALAPPDATA%\flint-build (the first run builds FreeRDP: allow a while).
# 3. windows/package.sh: dist\Flint-<version>-windows-x86_64.zip.
# 4. With -Install: the zip unpacked to a temporary folder and its install.ps1 run
#    (%LOCALAPPDATA%\Programs\Flint, the Start menu, the user's PATH).
#
# Exit status 0, or 1 with the failing step named.
param(
    [string]$Msys = 'C:\msys64',
    [switch]$Install
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Fail([string]$msg) { Write-Host "build: $msg" -ForegroundColor Red; exit 1 }

# A checkout made with core.autocrlf=true has CRLF scripts, which bash cannot run.
if ((Get-Content -Raw (Join-Path $repo 'windows\package.sh')) -match "`r`n") {
    Fail "the scripts have Windows line endings: clone again with 'git clone -c core.autocrlf=false ...'"
}

$bash = Join-Path $Msys 'usr\bin\bash.exe'
if (-not (Test-Path $bash)) {
    Write-Host "build: MSYS2 not found in $Msys; installing it there"
    # Pinned: msys2.org publishes no checksum for "latest", only GPG signatures; this
    # archive's signature was checked against MSYS2's maintainer key when it was pinned.
    $base = 'https://repo.msys2.org/distrib/x86_64/msys2-base-x86_64-20260927.sfx.exe'
    $want = 'ad336cccfda47758b5e15cda993fbba421115cb0b126697daef1ee4dfe37209f'
    $sfx = Join-Path $env:TEMP 'msys2-base.sfx.exe'
    Invoke-WebRequest -UseBasicParsing $base -OutFile $sfx
    $got = (Get-FileHash -Algorithm SHA256 $sfx).Hash.ToLower()
    if ($want -ne $got) { Fail "the MSYS2 download does not match its SHA-256" }
    $parent = Split-Path $Msys -Parent
    & $sfx -y "-o$parent" | Out-Null
    if (-not (Test-Path $bash)) { Fail "MSYS2 did not unpack into $Msys (the archive makes a msys64 folder)" }
    Remove-Item $sfx
    # The first login sets MSYS2 up; then the core and the rest are updated, twice as
    # MSYS2 asks (the first pass may update pacman itself).
    $env:MSYSTEM = 'MSYS'
    & $bash -lc 'true' | Out-Null
    & $bash -lc 'pacman -Syuu --noconfirm' | Out-Null
    & $bash -lc 'pacman -Syuu --noconfirm' | Out-Null
}

# Each step in a CLANG64 login shell started in the checkout.
function Step([string]$name, [string]$cmd) {
    Write-Host "== $name"
    $env:MSYSTEM = 'CLANG64'
    $env:CHERE_INVOKING = '1'
    Push-Location $repo
    try { & $bash -lc $cmd } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { Fail "$name failed (exit $LASTEXITCODE)" }
}

Step 'setup' 'windows/bin/setup.sh'
Step 'package' '. windows/bin/env.sh && windows/package.sh'

$zip = Get-ChildItem (Join-Path $repo 'dist') -Filter 'Flint-*-windows-x86_64.zip' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { Fail 'no zip in dist\' }
Write-Host "build: $($zip.FullName)"

if ($Install) {
    $unpacked = Join-Path $env:TEMP ('flint-install-' + [guid]::NewGuid().ToString('N'))
    Expand-Archive -Path $zip.FullName -DestinationPath $unpacked
    $folder = Get-ChildItem $unpacked -Directory | Select-Object -First 1
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $folder.FullName 'install.ps1')
    $code = $LASTEXITCODE
    Remove-Item -Recurse -Force $unpacked
    if ($code -ne 0) { Fail "install.ps1 failed (exit $code)" }
}
