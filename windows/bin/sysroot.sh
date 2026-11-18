#!/bin/sh
# Fetch the Windows (MSYS2 CLANG64, ucrt + libc++) builds of the native libraries cfire
# and Flint link, into an isolated sysroot. Same package family cfire's Windows CI uses.
# Pinned versions: bump them here, never "latest" at fetch time.
set -eu
SYSROOT="${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}"
REPO=https://repo.msys2.org/mingw/clang64
PKGS="
zstd-1.5.7-2
simdjson-5.1.1-1
sqlite3-3.54.1-1
libsodium-1.0.22-3
openssl-3.6.5-1
libssh-0.12.2-1
sqlcipher-4.19.0-1
argon2-20190702-2
zlib-1.4-2
"
mkdir -p "$SYSROOT/.pkgs"
for p in $PKGS; do
  f="mingw-w64-clang-x86_64-$p-any.pkg.tar.zst"
  [ -f "$SYSROOT/.pkgs/$f" ] || curl -fsSL "$REPO/$f" -o "$SYSROOT/.pkgs/$f"
  tar --zstd -xf "$SYSROOT/.pkgs/$f" -C "$SYSROOT" clang64
done
# MSYS2's .pc files say prefix=/clang64. Make them absolute, so pkg-config needs no
# PKG_CONFIG_SYSROOT_DIR (which would also rewrite Flint's own -I paths).
sed -i "s#^prefix=/clang64#prefix=$SYSROOT/clang64#" "$SYSROOT"/clang64/lib/pkgconfig/*.pc

# WebView2 SDK (headers + WebView2Loader.dll) for ext:webui. Pinned like the rest.
WV2_VERSION=1.0.4314.35
WV2="$SYSROOT/webview2"
if [ "$(cat "$WV2/VERSION" 2>/dev/null)" != "$WV2_VERSION" ]; then
  mkdir -p "$WV2"
  curl -fsSL "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WV2_VERSION/microsoft.web.webview2.$WV2_VERSION.nupkg" -o "$WV2/wv2.nupkg"
  python3 -I -c 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); [z.extract(n, sys.argv[2]) for n in z.namelist() if n.startswith("build/native/")]' "$WV2/wv2.nupkg" "$WV2"
  echo "$WV2_VERSION" > "$WV2/VERSION"
fi
# WebView2.h includes "EventToken.h"; mingw-w64 ships eventtoken.h. Only a problem on a
# case-sensitive filesystem, i.e. cross-compiling from Linux (W-09).
mkdir -p "$WV2/shim"
printf '#include <eventtoken.h>\n' > "$WV2/shim/EventToken.h"
echo "sysroot ready: $SYSROOT/clang64, WebView2 SDK $WV2_VERSION"
