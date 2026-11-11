#!/bin/sh
# Cross-build FreeRDP 3 for Windows into the sysroot (milestone 30's RDP adapter), as
# static libraries, so the desktop app links it in whole and ships no FreeRDP or OpenSSL
# DLLs (windows/build-gui.sh links everything -static, bin/xcxx).
#
# Why not MSYS2's mingw-w64-clang-x86_64-freerdp: its libfreerdp3.dll imports ffmpeg,
# whose package closure is 128 packages and 1.3 GB, for video codecs Flint does not use.
# Built here: the core, the client library and its built-in channels (drdynvc, disp,
# cliprdr for milestone 31), on the sysroot's OpenSSL and zlib (bin/sysroot.sh). Left
# out: ffmpeg/swscale, SDL and the native Windows client, servers and samples, USB
# redirection (libusb), JSON (Azure AD sign-in), manpages. H.264 (milestone 32) can come
# from Media Foundation, which ships with Windows (WITH_MEDIA_FOUNDATION).
#
# Needs: llvm-mingw in ~/.local/opt, the sysroot (bin/sysroot.sh), and cmake and ninja
# (pinned below, fetched into ~/.local/opt when missing). Pinned versions: bump them
# here, never "latest" at fetch time.
set -eu
FREERDP_VERSION=3.33.1
CMAKE_VERSION=3.31.6
NINJA_VERSION=1.12.1

OPT="$HOME/.local/opt"
SYSROOT="${WIN_SYSROOT:-$OPT/win-sysroot}"
R="$SYSROOT/clang64"
PREFIX="$SYSROOT/freerdp"
L=$(ls -d "$OPT"/llvm-mingw-* | tail -1)

if [ "$(cat "$PREFIX/VERSION" 2>/dev/null)" = "$FREERDP_VERSION" ]; then
  echo "freerdp ready: $PREFIX ($FREERDP_VERSION)"
  exit 0
fi

# Build tools. GitHub's release downloads time out now and then from WSL2: retry.
fetch() { curl -fsSL --retry 5 --connect-timeout 30 --max-time 600 "$1" -o "$2"; }
CMAKE="$OPT/cmake-$CMAKE_VERSION-linux-x86_64/bin/cmake"
if [ ! -x "$CMAKE" ]; then
  fetch "https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-linux-x86_64.tar.gz" "$OPT/cmake.tar.gz"
  tar -xzf "$OPT/cmake.tar.gz" -C "$OPT" && rm "$OPT/cmake.tar.gz"
fi
NINJA="$OPT/ninja-$NINJA_VERSION/ninja"
if [ ! -x "$NINJA" ]; then
  mkdir -p "$OPT/ninja-$NINJA_VERSION"
  fetch "https://github.com/ninja-build/ninja/releases/download/v$NINJA_VERSION/ninja-linux.zip" "$OPT/ninja.zip"
  python3 -I -c 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$OPT/ninja.zip" "$OPT/ninja-$NINJA_VERSION"
  chmod +x "$NINJA" && rm "$OPT/ninja.zip"
fi

# Source: the release tag's tarball over HTTPS (no git clone: SSH to GitHub hangs here).
SRC="$SYSROOT/.src/FreeRDP-$FREERDP_VERSION"
if [ ! -d "$SRC" ]; then
  mkdir -p "$SYSROOT/.src"
  fetch "https://github.com/FreeRDP/FreeRDP/archive/refs/tags/$FREERDP_VERSION.tar.gz" "$SYSROOT/.src/freerdp-$FREERDP_VERSION.tar.gz"
  tar -xzf "$SYSROOT/.src/freerdp-$FREERDP_VERSION.tar.gz" -C "$SYSROOT/.src"
fi

# -D__STDC_NO_THREADS__: winpr/platform.h includes C11 <threads.h> for its TLS macro,
# which llvm-mingw does not ship; the flag takes winpr's own _WIN32 branch (__thread).
# USE_UNWIND=OFF: llvm-mingw has unwind.h, so winpr picks its POSIX backtrace (dlfcn.h);
# off, it uses its Windows one (DbgHelp).
BUILD="$SYSROOT/.build/freerdp-$FREERDP_VERSION"
mkdir -p "$BUILD"
cat > "$BUILD/toolchain.cmake" <<EOF
set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER "$L/bin/x86_64-w64-mingw32-clang")
set(CMAKE_CXX_COMPILER "$L/bin/x86_64-w64-mingw32-clang++")
set(CMAKE_RC_COMPILER "$L/bin/x86_64-w64-mingw32-windres")
set(CMAKE_FIND_ROOT_PATH "$R" "$PREFIX")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
EOF

"$CMAKE" -S "$SRC" -B "$BUILD" -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" \
  -DCMAKE_TOOLCHAIN_FILE="$BUILD/toolchain.cmake" \
  -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
  -DCMAKE_C_FLAGS="-D__STDC_NO_THREADS__" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
  -DOPENSSL_ROOT_DIR="$R" -DOPENSSL_USE_STATIC_LIBS=ON \
  -DWITH_CLIENT=ON -DWITH_CLIENT_COMMON=ON -DWITH_CHANNELS=ON -DWITH_CLIENT_CHANNELS=ON \
  -DWITH_CLIENT_SDL=OFF -DWITH_CLIENT_WINDOWS=OFF -DWITH_CLIENT_INTERFACE=OFF \
  -DWITH_SERVER=OFF -DWITH_SERVER_CHANNELS=OFF -DWITH_SAMPLE=OFF -DWITH_PROXY=OFF -DWITH_SHADOW=OFF \
  -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF -DWITH_VIDEO_FFMPEG=OFF \
  -DWITH_CAIRO=OFF -DWITH_JPEG=OFF -DWITH_OPENH264=OFF -DWITH_MEDIA_FOUNDATION=ON \
  -DCHANNEL_URBDRC=OFF -DWITH_JSON_DISABLED=ON -DWITH_AAD=OFF -DWITH_URIPARSER=OFF \
  -DWITH_WINPR_TOOLS=OFF -DWITH_MANPAGES=OFF -DWITH_CCACHE=OFF -DWITH_CLANG_FORMAT=OFF \
  -DWITH_PKCS11=OFF -DWITH_KRB5=OFF -DWITH_FUSE=OFF -DWITH_RDTK=OFF \
  -DUSE_UNWIND=OFF
"$NINJA" -C "$BUILD" install
# A static install leaves out two channel helper archives that libfreerdp-client3.a needs
# (its own .pc names them in Libs.private). That .pc also names -ldl, which mingw has
# not got (bin/pc/pkg-config adds Libs.private, since the .exe links -static).
cp "$BUILD/channels/rdpsnd/common/librdpsnd-common.a" "$BUILD/channels/remdesk/common/libremdesk-common.a" "$PREFIX/lib/"
sed -i 's/ -ldl//' "$PREFIX/lib/pkgconfig/freerdp-client3.pc"
echo "$FREERDP_VERSION" > "$PREFIX/VERSION"
echo "freerdp ready: $PREFIX ($FREERDP_VERSION)"
