#!/bin/sh
# Build FreeRDP 3 natively on Windows, in MSYS2 CLANG64, as static libraries (the RDP
# adapter, milestones 30-31), so the desktop app links it in whole and ships no FreeRDP
# or OpenSSL DLLs: cfire 0.12 links every Windows target -static (W-04).
#
# Why not MSYS2's mingw-w64-clang-x86_64-freerdp: it ships DLLs, and its libfreerdp3.dll
# imports ffmpeg, whose package closure is 128 packages and 1.3 GB, for video codecs
# Flint does not use. Built here: the core, the client library and its built-in channels
# (drdynvc, disp, cliprdr), on CLANG64's OpenSSL and zlib; and the server library with
# its channels and the sample server, for tests only: Flint's own test server
# (native/testserver) and FreeRDP's sfreerdp-server. Neither is linked into Flint. Left
# out: ffmpeg/swscale, SDL and the native Windows client, the shadow server, the proxy
# and the native Windows server, USB redirection, JSON (Azure AD sign-in), manpages.
# H.264 can come from Media Foundation, which ships with Windows.
#
# Needs: MSYS2 CLANG64 with mingw-w64-clang-x86_64-{cmake,ninja,openssl,zlib}.
# Installs into $FLINT_WIN_OPT/freerdp (windows/bin/home.sh). Pinned version: bump
# it here, never "latest" at fetch time.
set -eu
FREERDP_VERSION=3.33.1
# Bumped when the build options change, so an install built with the old ones rebuilds.
FREERDP_STAMP="$FREERDP_VERSION server native"

. "$(dirname "$0")/home.sh"
OPT="$FLINT_WIN_OPT"
PREFIX="$OPT/freerdp"

if [ "$(cat "$PREFIX/VERSION" 2>/dev/null)" = "$FREERDP_STAMP" ]; then
  echo "freerdp ready: $PREFIX ($FREERDP_VERSION)"
  exit 0
fi
case "${MSYSTEM:-}" in
  CLANG64) ;;
  *) echo "freerdp.sh: run it in MSYS2 CLANG64 (MSYSTEM=${MSYSTEM:-unset})" >&2; exit 2 ;;
esac

fetch() { curl -fsSL --retry 5 --connect-timeout 30 --max-time 600 "$1" -o "$2"; }
SRC="$OPT/.src/FreeRDP-$FREERDP_VERSION"
if [ ! -d "$SRC" ]; then
  mkdir -p "$OPT/.src"
  fetch "https://github.com/FreeRDP/FreeRDP/archive/refs/tags/$FREERDP_VERSION.tar.gz" "$OPT/.src/freerdp-$FREERDP_VERSION.tar.gz"
  tar -xzf "$OPT/.src/freerdp-$FREERDP_VERSION.tar.gz" -C "$OPT/.src"
fi

# -D__STDC_NO_THREADS__: winpr/platform.h includes C11 <threads.h> for its TLS macro;
# the flag takes winpr's own _WIN32 branch (__thread). USE_UNWIND=OFF: with unwind.h
# present winpr picks its POSIX backtrace (dlfcn.h); off, its Windows one (DbgHelp).
BUILD="$OPT/.build/freerdp-$FREERDP_VERSION"
mkdir -p "$BUILD"
cmake -S "$SRC" -B "$BUILD" -G Ninja \
  -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_C_FLAGS="-D__STDC_NO_THREADS__" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
  -DOPENSSL_ROOT_DIR=/clang64 -DOPENSSL_USE_STATIC_LIBS=ON \
  -DWITH_CLIENT=ON -DWITH_CLIENT_COMMON=ON -DWITH_CHANNELS=ON -DWITH_CLIENT_CHANNELS=ON \
  -DWITH_CLIENT_SDL=OFF -DWITH_CLIENT_WINDOWS=OFF -DWITH_CLIENT_INTERFACE=OFF \
  -DWITH_SERVER=ON -DWITH_SERVER_CHANNELS=ON -DWITH_SAMPLE=ON -DWITH_PROXY=OFF -DWITH_SHADOW=OFF -DWITH_PLATFORM_SERVER=OFF \
  -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF -DWITH_VIDEO_FFMPEG=OFF \
  -DWITH_CAIRO=OFF -DWITH_JPEG=OFF -DWITH_OPENH264=OFF -DWITH_MEDIA_FOUNDATION=ON \
  -DCHANNEL_URBDRC=OFF -DWITH_JSON_DISABLED=ON -DWITH_AAD=OFF -DWITH_URIPARSER=OFF \
  -DWITH_WINPR_TOOLS=OFF -DWITH_MANPAGES=OFF -DWITH_CCACHE=OFF -DWITH_CLANG_FORMAT=OFF \
  -DWITH_PKCS11=OFF -DWITH_KRB5=OFF -DWITH_FUSE=OFF -DWITH_RDTK=OFF \
  -DUSE_UNWIND=OFF
ninja -C "$BUILD" install
# A static install leaves out two channel helper archives that libfreerdp-client3.a needs
# (its own .pc names them in Libs.private). That .pc also names -ldl, which mingw has not.
cp "$BUILD/channels/rdpsnd/common/librdpsnd-common.a" "$BUILD/channels/remdesk/common/libremdesk-common.a" "$PREFIX/lib/"
sed -i 's/ -ldl//' "$PREFIX/lib/pkgconfig/freerdp-client3.pc"
echo "$FREERDP_STAMP" > "$PREFIX/VERSION"
echo "freerdp ready: $PREFIX ($FREERDP_VERSION)"
