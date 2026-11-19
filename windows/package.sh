#!/usr/bin/env bash
# Builds Flint for Windows and packs it as a portable zip with its installer, natively in
# MSYS2 CLANG64 (windows/bin/env.sh sets it up):
#
#   windows/package.sh                  # → dist/flint-<version>-windows-x86_64.zip
#
# The zip holds one folder, flint-<version>-windows-x86_64\:
#   flint.exe             the CLI
#   flint-app.exe         the desktop app (build/gui/Flint.exe; `flint` starts it by this
#                         name when it sits beside it)
#   ui\                   the app's page
#   WebView2Loader.dll    Microsoft's WebView2 loader: cfire finds no installed WebView2
#                         runtime without it (docs/cfire-windows.md, W-10)
#   install.ps1           copies the folder to %LOCALAPPDATA%\Programs\Flint, adds a Start
#                         menu shortcut and puts flint.exe on the user's PATH
#   LICENSE
# Every .exe links statically and imports only system DLLs, so the folder also runs
# where it is unpacked. Prints the zip's path and SHA-256. Exit 1 when a step fails.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
case "$(uname -s)" in MINGW*|MSYS*) ;; *) echo "package: run it in MSYS2 CLANG64 on Windows" >&2; exit 1 ;; esac
[[ -n "${FLINT_CFIRE:-}" ]] || . windows/bin/env.sh

version="$(scripts/version.sh)"
name="flint-$version-windows-x86_64"
stage="$root/dist/$name"
echo "package: Flint $version"

scripts/build-gui.sh >/dev/null
cfire build flint >/dev/null
[[ -f "${FLINT_WV2:-}/WebView2Loader.dll" ]] || { echo "package: no WebView2Loader.dll in FLINT_WV2 (${FLINT_WV2:-unset})" >&2; exit 1; }

rm -rf "$stage" "$root/dist/$name.zip"
mkdir -p "$stage"
cp build/flint.exe "$stage/flint.exe"
cp build/gui/Flint.exe "$stage/flint-app.exe"
cp -R build/gui/ui "$stage/ui"
cp "$FLINT_WV2/WebView2Loader.dll" "$stage/"
cp windows/install.ps1 LICENSE "$stage/"

# Only system DLLs: a missing one would fail on a machine without MSYS2.
for exe in "$stage"/*.exe; do
  bad="$(objdump -p "$exe" | sed -n 's/^\s*DLL Name: //p' | grep -viE '^(api-ms-win-[a-z0-9-]+|kernel32|user32|gdi32|advapi32|shell32|ole32|oleaut32|comdlg32|comctl32|ws2_32|crypt32|secur32|bcrypt|ncrypt|iphlpapi|dnsapi|ntdll|shlwapi|userenv|version|winmm|winhttp|wldap32|normaliz|dwmapi|uxtheme|imm32|shcore|setupapi|rpcrt4|netapi32|dbghelp|psapi|winspool|cfgmgr32|mpr|credui|wtsapi32|powrprof|hid|msimg32|usp10|dxgi|d3d11|d3d9|opengl32|gdiplus|windowscodecs|propsys|oleacc|wininet|urlmon|mswsock|ucrtbase|msvcrt)\.dll$' || true)"
  [[ -z "$bad" ]] || { echo "package: $(basename "$exe") needs DLLs that are not Windows': $bad" >&2; exit 1; }
done

# Python's zipfile: MSYS2 ships no zip by default, and the archive needs no extras.
(cd "$root/dist" && python3 -I -c '
import os, sys, zipfile
name = sys.argv[1]
with zipfile.ZipFile(name + ".zip", "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(name):
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, p.replace(os.sep, "/"))
' "$name")
echo "package: $(cygpath -w "$root/dist/$name.zip")"
echo "package: sha256 $(sha256sum "$root/dist/$name.zip" | cut -d' ' -f1)"
