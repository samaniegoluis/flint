# Installs Flint for this Windows user from the folder this script sits in (the Flint\
# folder of the zip that windows/package.sh makes, unpacked). No administrator rights
# needed. Kept until v14's installer; the unpacked folder also runs where it is.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#
# It copies the folder (Flint.exe, bin\flint.exe, ui\, WebView2Loader.dll, licenses\…)
# to %LOCALAPPDATA%\Programs\Flint, adds Flint to the Start menu and puts its bin\ on
# the user's PATH, so `flint` works in a new terminal and starts ..\Flint.exe when it
# needs the app. A running Flint from that folder is quit first (its vault locks and its
# grants end), since Windows will not replace a running program. Your vaults and
# settings (%APPDATA%\Flint) are never touched, not even by -Uninstall. The installed
# copy updates itself in place (Settings → About → Updates).
#
#   -Dest <folder>   install somewhere else
#   -NoShortcut      no Start menu entry
#   -NoPath          leave the user's PATH alone
param(
    [string]$Dest = (Join-Path $env:LOCALAPPDATA 'Programs\Flint'),
    [switch]$NoShortcut,
    [switch]$NoPath,
    [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Flint.lnk'
$bin = Join-Path $Dest 'bin'
$need = @('Flint.exe', 'bin\flint.exe', 'ui', 'WebView2Loader.dll', 'install-kind')

function Stop-Flint {
    $running = Get-Process -Name 'Flint', 'flint-app' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($Dest, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) {
        Write-Host 'install: quitting the running Flint (its vault locks)'
        $running | Stop-Process -Force
        $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    }
}

# The user's PATH with bin\ (or nothing of this install's); an entry for the folder
# itself, left by an install.ps1 of 0.19 or earlier, is taken out either way.
function Set-UserPath([bool]$present) {
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    $mine = @($Dest.TrimEnd('\'), $bin.TrimEnd('\'))
    $parts = @($path -split ';' | Where-Object { $_ -and ($mine -notcontains $_.TrimEnd('\')) })
    if ($present) { $parts = @($bin) + $parts }
    $new = $parts -join ';'
    if ($new -ne $path) {
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        Write-Host ("install: {0} the user's PATH: {1}" -f ($(if ($present) { 'added to' } else { 'removed from' })), $bin)
    }
}

if ($Uninstall) {
    Stop-Flint
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest; Write-Host "install: removed $Dest" }
    if (Test-Path $shortcut) { Remove-Item -Force $shortcut; Write-Host "install: removed the Start menu entry" }
    if (-not $NoPath) { Set-UserPath $false }
    Write-Host 'install: Flint uninstalled; your vaults and settings are still where they were'
    exit 0
}

foreach ($f in $need) {
    if (-not (Test-Path (Join-Path $src $f))) { throw "install: $f is missing beside install.ps1 (unpack the whole zip)" }
}
if ((Resolve-Path $src).Path.TrimEnd('\') -ieq $Dest.TrimEnd('\')) { throw "install: run it from the unpacked zip, not from $Dest" }
Stop-Flint
# The folder is replaced whole, so nothing of an older layout stays (flint-app.exe,
# flint.exe beside it).
if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
New-Item -ItemType Directory -Force $Dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $src '*') $Dest
# Files from a downloaded zip carry the internet zone mark; the installed copy is the
# user's own program now.
Get-ChildItem -Recurse -File $Dest | Unblock-File
Write-Host "install: Flint in $Dest"

if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($shortcut)
    $lnk.TargetPath = Join-Path $Dest 'Flint.exe'
    $lnk.WorkingDirectory = $Dest
    $lnk.Description = 'Flint: SSH and RDP over one encrypted vault'
    $lnk.Save()
    Write-Host 'install: Flint is in the Start menu'
}
if (-not $NoPath) {
    Set-UserPath $true
    Write-Host 'install: open a new terminal for `flint` to be found'
}
& (Join-Path $bin 'flint.exe') --version
