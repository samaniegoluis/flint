#!/usr/bin/env bash
# Builds Flint for Windows from WSL (windows-port branch): the page (ui/), the CLI and
# the app, cross-compiled with llvm-mingw, laid out as one folder to copy anywhere:
#
#   build/windows/Flint/
#     flint.exe            the CLI
#     flint-app.exe        the desktop app (double-click this, or Flint.lnk)
#     WebView2Loader.dll   next to the app (cfire W-10); FreeRDP is linked into the app
#                          (bin/freerdp.sh), so no FreeRDP or OpenSSL DLLs
#     ui/                  the page, found as ui/ next to the app
#
#   windows/build-gui.sh                         # build into build/windows/Flint
#   windows/build-gui.sh --install /mnt/d/Programas/Flint
#                                                # and copy it there (an app or CLI
#                                                # running from there is stopped first)
#
# The app is flint-app.exe, not Flint.exe: next to flint.exe that would be the same
# file (Windows file names ignore case). `flint serve` looks for flint-app.exe beside
# the CLI.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
cd "$root"
install_dir=""
if [[ "${1:-}" == "--install" ]]; then
  install_dir="${2:?usage: $0 [--install DIR]}"
fi

# The page is the same HTML, CSS and JS on every OS.
if command -v npm >/dev/null; then
  if [[ ! -d ui/node_modules ]]; then (cd ui && npm ci --no-audit --no-fund); fi
  (cd ui && npm run build)
elif [[ ! -f ui/dist/index.html ]]; then
  echo "build-gui: needs npm to build ui/, or a built ui/dist" >&2
  exit 1
fi

# FreeRDP 3 for the app's RDP tab (milestone 30), built static once into the sysroot;
# a no-op once built. The CLI does not link it.
"$here/bin/freerdp.sh"
# shellcheck source=bin/env.sh
source "$here/bin/env.sh"
cfire build --target x86_64-w64-mingw32 flint
cfire build --target x86_64-w64-mingw32 FlintGui   # by its build.cf variable: "Flint" is the CLI's

out="build/windows/Flint"
rm -rf "$out"
mkdir -p "$out"
cp build/flint.exe "$out/flint.exe"
cp build/gui/Flint.exe "$out/flint-app.exe"
cp "${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}/webview2/build/native/x64/WebView2Loader.dll" "$out/"
cp -R ui/dist "$out/ui"
echo "build-gui: $out"

if [[ -n "$install_dir" ]]; then
  win_dir="$(wslpath -w "$install_dir")"
  # A running copy holds its .exe open: stop it and wait until it is gone (the app locks
  # the vault on quit).
  powershell.exe -NoProfile -c "Get-Process flint-app,flint -ErrorAction SilentlyContinue | ? { \$_.Path -like '$win_dir\\*' } | % { Stop-Process -Id \$_.Id -Force; [void]\$_.WaitForExit(10000) }" >/dev/null 2>&1 || true
  mkdir -p "$install_dir"
  rm -rf "$install_dir/ui"
  cp -R "$out/." "$install_dir/"
  # A Start-menu-style shortcut in the folder itself, named like the app.
  powershell.exe -NoProfile -c "\$s = (New-Object -ComObject WScript.Shell).CreateShortcut('$win_dir\\Flint.lnk'); \$s.TargetPath = '$win_dir\\flint-app.exe'; \$s.WorkingDirectory = '$win_dir'; \$s.Save()" >/dev/null
  echo "build-gui: installed in $win_dir (double-click Flint.lnk or flint-app.exe)"
fi
