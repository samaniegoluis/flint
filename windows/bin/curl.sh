#!/bin/sh
# Cross-build libcurl for Windows into the sysroot (milestone 43's remote vault client,
# src/adapters/vaultremote), as a static library, so flint.exe and the app link it in
# whole and ship no curl DLL (bin/xcxx links -static).
#
# Why not MSYS2's mingw-w64-clang-x86_64-curl: it pulls nghttp2, nghttp3, ngtcp2,
# libssh2, libpsl, libidn2, brotli, zstd and OpenSSL, for protocols and encodings the
# client never uses. Built here: HTTP and HTTPS only, TLS through **Schannel**, Windows'
# own TLS, which checks the server against the Windows certificate store (what the
# system trusts, a company root included), so no CA bundle ships with Flint. No HTTP/2,
# no compression, no IDN, no proxies auto-detected beyond curl's environment variables.
#
# Needs: llvm-mingw in ~/.local/opt and the cmake and ninja freerdp.sh fetches (run it
# first). Pinned versions: bump them here, never "latest" at fetch time.
set -eu
CURL_VERSION=8.17.0
# Bumped when the build options change, so a sysroot built with the old ones rebuilds.
CURL_STAMP="$CURL_VERSION schannel"
CMAKE_VERSION=3.31.6
NINJA_VERSION=1.12.1

OPT="$HOME/.local/opt"
SYSROOT="${WIN_SYSROOT:-$OPT/win-sysroot}"
PREFIX="$SYSROOT/curl"
L=$(ls -d "$OPT"/llvm-mingw-* | tail -1)
CMAKE="$OPT/cmake-$CMAKE_VERSION-linux-x86_64/bin/cmake"
NINJA="$OPT/ninja-$NINJA_VERSION/ninja"

if [ "$(cat "$PREFIX/VERSION" 2>/dev/null)" = "$CURL_STAMP" ]; then
  echo "curl ready: $PREFIX ($CURL_VERSION)"
  exit 0
fi
if [ ! -x "$CMAKE" ] || [ ! -x "$NINJA" ]; then
  echo "cmake $CMAKE_VERSION and ninja $NINJA_VERSION missing: run windows/bin/freerdp.sh first" >&2
  exit 1
fi

fetch() { curl -fsSL --retry 5 --connect-timeout 30 --max-time 600 "$1" -o "$2"; }
SRC="$SYSROOT/.src/curl-$CURL_VERSION"
if [ ! -d "$SRC" ]; then
  mkdir -p "$SYSROOT/.src"
  fetch "https://curl.se/download/curl-$CURL_VERSION.tar.xz" "$SYSROOT/.src/curl-$CURL_VERSION.tar.xz"
  tar -xJf "$SYSROOT/.src/curl-$CURL_VERSION.tar.xz" -C "$SYSROOT/.src"
fi

BUILD="$SYSROOT/.build/curl-$CURL_VERSION"
rm -rf "$BUILD"
mkdir -p "$BUILD"
cat > "$BUILD/toolchain.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER "$L/bin/x86_64-w64-mingw32-clang")
set(CMAKE_RC_COMPILER "$L/bin/x86_64-w64-mingw32-windres")
set(CMAKE_FIND_ROOT_PATH "$PREFIX")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF

"$CMAKE" -S "$SRC" -B "$BUILD" -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
  -DCMAKE_TOOLCHAIN_FILE="$BUILD/toolchain.cmake" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_STATIC_LIBS=ON -DBUILD_CURL_EXE=OFF \
  -DBUILD_TESTING=OFF -DBUILD_EXAMPLES=OFF -DBUILD_LIBCURL_DOCS=OFF -DBUILD_MISC_DOCS=OFF \
  -DENABLE_CURL_MANUAL=OFF -DCURL_DISABLE_INSTALL=OFF \
  -DHTTP_ONLY=ON -DCURL_USE_SCHANNEL=ON -DCURL_USE_OPENSSL=OFF -DCURL_WINDOWS_SSPI=ON \
  -DCURL_USE_LIBPSL=OFF -DCURL_USE_LIBSSH2=OFF -DCURL_USE_LIBSSH=OFF -DUSE_LIBIDN2=OFF \
  -DUSE_WIN32_IDN=OFF -DUSE_NGHTTP2=OFF -DCURL_ZLIB=OFF -DCURL_BROTLI=OFF -DCURL_ZSTD=OFF \
  -DENABLE_UNICODE=ON
"$NINJA" -C "$BUILD" install
echo "$CURL_STAMP" > "$PREFIX/VERSION"
echo "curl ready: $PREFIX ($CURL_VERSION)"
