#!/usr/bin/env bash
# Builds Flint for Windows and packs it as a portable zip, natively in MSYS2 CLANG64
# (windows/bin/env.sh sets it up); scripts/package.sh windows runs this (spec v13,
# milestone 50, D-121):
#
#   windows/package.sh                  # → dist/Flint-<version>-windows-x86_64.zip
#
# The zip holds one folder, Flint\, with no version in its name, so a folder put on the
# PATH or pinned keeps working when an update replaces it:
#   Flint.exe             the desktop app
#   bin\flint.exe         the CLI, alone in its folder: the app offers to put bin\ on the
#                         user's PATH (Settings → About → Command line), which then names
#                         no DLL of Flint's. Flint.exe and flint.exe cannot share a folder
#                         on a disk that ignores case; `flint` starts ..\Flint.exe.
#   ui\                   the app's page
#   WebView2Loader.dll    Microsoft's WebView2 loader: cfire finds no installed WebView2
#                         runtime without it (D-104, W-10)
#   install-kind          "portable": the app may update itself in place (milestone 53)
#   CHANGELOG.md          What's new after an update (milestone 52)
#   licenses\             Flint's LICENSE and each bundled library's licence
#   install.ps1           copies the folder to %LOCALAPPDATA%\Programs\Flint, adds a Start
#                         menu shortcut and puts bin\ on the user's PATH (until v14's
#                         installer)
# Every .exe links statically and imports only system DLLs, so the folder runs where it
# is unpacked. Prints the zip's path and SHA-256. Exit 1 when a step fails.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
case "$(uname -s)" in MINGW*|MSYS*) ;; *) echo "package: run it in MSYS2 CLANG64 on Windows" >&2; exit 1 ;; esac
[[ -n "${FLINT_CFIRE:-}" ]] || . windows/bin/env.sh

version="$(scripts/version.sh)"
name="Flint-$version-windows-x86_64"
work="$root/dist/windows"
stage="$work/Flint"
echo "package: Flint $version"

# A build from source is never a package (milestone 52): build-gui.sh leaves no
# install-kind in build/gui, so it is written here only.
scripts/build-gui.sh >/dev/null
cfire build flint >/dev/null
[[ -f "${FLINT_WV2:-}/WebView2Loader.dll" ]] || { echo "package: no WebView2Loader.dll in FLINT_WV2 (${FLINT_WV2:-unset})" >&2; exit 1; }

rm -rf "$work" "$root/dist/$name.zip"
mkdir -p "$stage/bin" "$stage/licenses"
cp build/gui/Flint.exe "$stage/Flint.exe"
cp build/flint.exe "$stage/bin/flint.exe"
cp -R build/gui/ui "$stage/ui"
cp "$FLINT_WV2/WebView2Loader.dll" "$stage/"
cp windows/install.ps1 "$stage/"
printf 'portable\n' > "$stage/install-kind"
cp CHANGELOG.md "$stage/CHANGELOG.md"

# Third-party notices: every library linked into the two .exe files, and Microsoft's
# loader beside them. MSYS2 keeps each package's licence in share/licenses/<package>;
# FreeRDP's comes from its source tree (windows/bin/freerdp.sh); the loader's from its
# NuGet package (windows/bin/setup.sh).
cp LICENSE "$stage/licenses/Flint-LICENSE"
mingw="${MINGW_PREFIX:-/clang64}"
for pkg in libsodium libssh sqlcipher curl openssl zlib libpsl libidn2 libunistring brotli zstd nghttp2 nghttp3 ngtcp2 libssh2 winpthreads; do
  d="$mingw/share/licenses/$pkg"
  [[ -d "$d" ]] || continue
  for f in "$d"/*; do
    [[ -f "$f" ]] && cp "$f" "$stage/licenses/$pkg-$(basename "$f")"
  done
done
# MSYS2's libssh package carries no licence file: windows/licenses/ keeps libssh's own
# COPYING (LGPL 2.1, the same text in every release).
cp windows/licenses/libssh-COPYING "$stage/licenses/libssh-COPYING"
for need in libsodium libssh sqlcipher curl openssl zlib; do
  compgen -G "$stage/licenses/$need-*" >/dev/null || { echo "package: no licence for $need in $mingw/share/licenses" >&2; exit 1; }
done
rdp_license="$(ls -d "${FLINT_WIN_OPT:-}"/.src/FreeRDP-*/LICENSE 2>/dev/null | tail -1 || true)"
[[ -f "$rdp_license" ]] || { echo "package: no FreeRDP LICENSE under ${FLINT_WIN_OPT:-}/.src (windows/bin/freerdp.sh)" >&2; exit 1; }
cp "$rdp_license" "$stage/licenses/FreeRDP-LICENSE"
[[ -f "$FLINT_WV2/LICENSE.txt" ]] || { echo "package: no LICENSE.txt beside WebView2Loader.dll (windows/bin/setup.sh)" >&2; exit 1; }
cp "$FLINT_WV2/LICENSE.txt" "$stage/licenses/WebView2Loader-LICENSE.txt"

# Only system DLLs: a missing one would fail on a machine without MSYS2.
for exe in "$stage/Flint.exe" "$stage/bin/flint.exe"; do
  bad="$(objdump -p "$exe" | sed -n 's/^\s*DLL Name: //p' | grep -viE '^(api-ms-win-[a-z0-9-]+|kernel32|user32|gdi32|advapi32|shell32|ole32|oleaut32|comdlg32|comctl32|ws2_32|crypt32|secur32|bcrypt|ncrypt|iphlpapi|dnsapi|ntdll|shlwapi|userenv|version|winmm|winhttp|wldap32|normaliz|dwmapi|uxtheme|imm32|shcore|setupapi|rpcrt4|netapi32|dbghelp|psapi|winspool|cfgmgr32|mpr|credui|wtsapi32|powrprof|hid|msimg32|usp10|dxgi|d3d11|d3d9|opengl32|gdiplus|windowscodecs|propsys|oleacc|wininet|urlmon|mswsock|ucrtbase|msvcrt)\.(dll|drv)$' || true)"
  [[ -z "$bad" ]] || { echo "package: $(basename "$exe") needs DLLs that are not Windows': $bad" >&2; exit 1; }
done

# Python's zipfile: MSYS2 ships no zip by default, and the archive needs no extras. The
# self-update unpacks it with Windows' own tar (adapters/process/update.cf).
(cd "$work" && python3 -I -c '
import os, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk("Flint"):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(d, f)
            z.write(p, p.replace(os.sep, "/"))
' "$root/dist/$name.zip")
rm -rf "$work"
echo "package: $(cygpath -w "$root/dist/$name.zip")"
echo "package: sha256 $(sha256sum "$root/dist/$name.zip" | cut -d' ' -f1)"
