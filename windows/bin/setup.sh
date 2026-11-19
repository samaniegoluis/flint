#!/usr/bin/env bash
# Everything Flint needs to build on Windows, natively in MSYS2 CLANG64, beside MSYS2
# itself: run once on a new machine, and again after a version below changes. Each
# piece is checked first and fetched only when it is missing or of another version.
#
#   windows/bin/setup.sh           # then: . windows/bin/env.sh; windows/package.sh
#
# 1. CLANG64 packages from pacman: the native libraries Flint links (libsodium, libssh,
#    SQLCipher, libcurl over Schannel), FreeRDP's build tools and python for the scripts.
# 2. cfire's Windows release, the zip from its GitHub release, SHA-256 checked.
# 3. FreeRDP, built static by windows/bin/freerdp.sh.
# 4. Microsoft's WebView2Loader.dll, from the Microsoft.Web.WebView2 NuGet package
#    (W-10: cfire finds no WebView2 runtime without it), SHA-256 checked.
# 5. Node, the official win-x64 zip, SHA-256 checked: scripts/build-gui.sh builds ui/.
#
# Everything but the pacman packages goes to $FLINT_WIN_OPT (windows/bin/home.sh:
# %LOCALAPPDATA%\flint-build\opt, or C:\flint-work\opt on the test VM), where
# windows/bin/env.sh looks. Versions are pinned here, never
# "latest" at fetch time; bump them together with env.sh's defaults.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
[[ "${MSYSTEM:-}" == CLANG64 ]] || { echo "setup: run it in MSYS2 CLANG64 (MSYSTEM=${MSYSTEM:-unset})" >&2; exit 2; }

CFIRE_VERSION=0.12.2
CFIRE_SHA256=2bbaa7adff5882ca4df05434ae8e993263a0880a4498ccde3390659e7eb62578
WV2_VERSION=1.0.4314.35
WV2_SHA256=90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4
NODE_VERSION=24.22.3
NODE_SHA256=e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f

. "$here/home.sh"
OPT="$FLINT_WIN_OPT"
mkdir -p "$OPT"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-setup.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# fetch <url> <sha256> <file>: downloads and checks it, or stops.
fetch() {
  curl -fsSL -o "$3" "$1"
  echo "$2 *$3" | sha256sum -c --quiet - || { echo "setup: $(basename "$3") does not match its SHA-256" >&2; exit 1; }
}

echo "== pacman packages"
p=mingw-w64-clang-x86_64
pacman -S --needed --noconfirm "$p-libsodium" "$p-libssh" "$p-sqlcipher" "$p-curl-winssl" \
  "$p-cmake" "$p-ninja" "$p-openssl" "$p-zlib" "$p-pkgconf" "$p-python" \
  git make diffutils unzip vim >/dev/null
echo "pacman: ready"

echo "== cfire $CFIRE_VERSION"
dest="$OPT/cfire-$CFIRE_VERSION"
if [[ -x "$dest/cfire.exe" && "$("$dest/cfire.exe" --version 2>/dev/null)" == "$CFIRE_VERSION"* ]]; then
  echo "cfire ready: $dest"
else
  zip="$tmp/cfire.zip"
  fetch "https://github.com/gsandoval/cfire/releases/download/v$CFIRE_VERSION/cfire-v$CFIRE_VERSION-windows-x86_64.zip" "$CFIRE_SHA256" "$zip"
  unzip -q "$zip" -d "$tmp/cfire"
  top="$(dirname "$(find "$tmp/cfire" -name cfire.exe | head -1)")"
  [[ -d "$top/runtime" ]] || { echo "setup: the cfire zip has no runtime\\ beside cfire.exe" >&2; exit 1; }
  rm -rf "$dest" && mv "$top" "$dest"
  echo "cfire installed: $dest ($("$dest/cfire.exe" --version | head -1))"
fi

echo "== FreeRDP"
FLINT_WIN_OPT="$OPT" sh "$here/freerdp.sh"

echo "== WebView2Loader.dll $WV2_VERSION"
dest="$OPT/webview2/$WV2_VERSION"
if [[ -f "$dest/WebView2Loader.dll" ]]; then
  echo "webview2 ready: $dest"
else
  pkg="$tmp/wv2.nupkg"
  fetch "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WV2_VERSION/microsoft.web.webview2.$WV2_VERSION.nupkg" "$WV2_SHA256" "$pkg"
  mkdir -p "$dest"
  unzip -q -o -j "$pkg" 'runtimes/win-x64/native/WebView2Loader.dll' -d "$dest"
  unzip -q -o -j "$pkg" LICENSE.txt -d "$dest" 2>/dev/null || true
  echo "webview2 installed: $dest"
fi

echo "== Node $NODE_VERSION"
dest="$OPT/node"
if [[ "$("$dest/node.exe" -v 2>/dev/null)" == "v$NODE_VERSION" ]]; then
  echo "node ready: $dest"
else
  zip="$tmp/node.zip"
  fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$NODE_SHA256" "$zip"
  unzip -q "$zip" -d "$tmp/node"
  rm -rf "$dest" && mv "$tmp/node/node-v$NODE_VERSION-win-x64" "$dest"
  echo "node installed: $dest ($("$dest/node.exe" -v))"
fi

echo "setup: done; next: . windows/bin/env.sh && windows/package.sh"
