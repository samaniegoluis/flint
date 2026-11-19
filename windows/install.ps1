# Installs Flint for this Windows user from the folder this script sits in (the zip that
# windows/package.sh makes, unpacked). No administrator rights needed.
#
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#
# It copies flint.exe, flint-app.exe, ui\ and WebView2Loader.dll to
# %LOCALAPPDATA%\Programs\Flint, adds Flint to the Start menu and puts the folder on the
# user's PATH, so `flint` works in a new terminal and starts flint-app.exe beside it when
# it needs the app. A running Flint from that folder is quit first (its vault locks and
# its grants end), since Windows will not replace a running program. Your vaults and
# settings (%APPDATA%\Flint) are never touched, not even by -Uninstall.
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
$files = @('flint.exe', 'flint-app.exe', 'WebView2Loader.dll', 'LICENSE')

function Stop-Flint {
    $running = Get-Process -Name 'flint-app', 'flint' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($Dest, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) {
        Write-Host 'install: quitting the running Flint (its vault locks)'
        $running | Stop-Process -Force
        $running | Wait-Process -Timeout 10 -ErrorAction SilentlyContinue
    }
}

function Set-UserPath([bool]$present) {
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    $parts = @($path -split ';' | Where-Object { $_ -and ($_.TrimEnd('\') -ne $Dest.TrimEnd('\')) })
    if ($present) { $parts += $Dest }
    $new = $parts -join ';'
    if ($new -ne $path) {
        [Environment]::SetEnvironmentVariable('Path', $new, 'User')
        Write-Host ("install: {0} the user's PATH: {1}" -f ($(if ($present) { 'added to' } else { 'removed from' })), $Dest)
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

foreach ($f in $files + @('ui')) {
    if (-not (Test-Path (Join-Path $src $f))) { throw "install: $f is missing beside install.ps1 (unpack the whole zip)" }
}
Stop-Flint
New-Item -ItemType Directory -Force $Dest | Out-Null
foreach ($f in $files) { Copy-Item -Force (Join-Path $src $f) (Join-Path $Dest $f) }
$ui = Join-Path $Dest 'ui'
if (Test-Path $ui) { Remove-Item -Recurse -Force $ui }
Copy-Item -Recurse (Join-Path $src 'ui') $ui
# Files from a downloaded zip carry the internet zone mark; the installed copy is the
# user's own program now.
Get-ChildItem -Recurse -File $Dest | Unblock-File
Write-Host "install: Flint in $Dest"

if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut($shortcut)
    $lnk.TargetPath = Join-Path $Dest 'flint-app.exe'
    $lnk.WorkingDirectory = $Dest
    $lnk.Description = 'Flint: SSH and RDP over one encrypted vault'
    $lnk.Save()
    Write-Host 'install: Flint is in the Start menu'
}
if (-not $NoPath) {
    Set-UserPath $true
    Write-Host 'install: open a new terminal for `flint` to be found'
}
& (Join-Path $Dest 'flint.exe') --version
