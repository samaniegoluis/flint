#!/usr/bin/env bash
# Builds the native libraries a released Flint.app links, from pinned sources, as static
# archives for macOS arm64 at the app's minimum macOS (D-112):
#
#   scripts/deps-macos.sh            # → build/deps/macos-arm64/{lib,include,lib/pkgconfig}
#
# OpenSSL, libsodium, libssh, SQLCipher and a reduced FreeRDP 3 (no FFmpeg, X11, SDL, USB,
# FIDO, audio or device redirection, which Flint turns off anyway: Homebrew's FreeRDP pulls in ~40 libraries built for the newest macOS, FFmpeg
# among them under the GPL). zlib, libcurl and the frameworks come from macOS itself.
# Each source's SHA-256 is checked; a library already built at its pinned version is kept.
# scripts/package.sh macos puts the prefix first on PKG_CONFIG_PATH, so `cfire build
# --portable` links these archives instead of Homebrew's dylibs. Development builds keep
# using Homebrew.
#
# FLINT_DEPS_PREFIX moves the prefix; FLINT_DEPS_JOBS sets make's parallelism.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
[[ "$(uname -s)" == Darwin ]] || { echo "deps-macos: run it on macOS" >&2; exit 1; }
[[ "$(uname -m)" == arm64 ]] || { echo "deps-macos: arm64 only (D-111)" >&2; exit 1; }

MACOS_MIN=13.3   # cfire's floor and Flint.app's LSMinimumSystemVersion
prefix="${FLINT_DEPS_PREFIX:-$root/build/deps/macos-arm64}"
src="$root/build/deps/src"
jobs="${FLINT_DEPS_JOBS:-$(sysctl -n hw.ncpu)}"
mkdir -p "$prefix" "$src"

# name version url sha256
PINS=(
  "openssl 4.1.0 https://github.com/openssl/openssl/releases/download/openssl-4.1.0/openssl-4.1.0.tar.gz 50c17baf54cb008f6ce42d50deb4b28050a1aad711636cabd4b241c7e90cc2fd"
  "libsodium 1.0.22 https://download.libsodium.org/libsodium/releases/libsodium-1.0.22.tar.gz adbdd8f16149e81ac6078a03aca6fc03b592b89ef7b5ed83841c086191be3349"
  "libssh 0.12.2 https://www.libssh.org/files/0.12/libssh-0.12.2.tar.xz 49560f677d96e3706a904ac2de1116e25f3680937d51e5c92198fcba4a1c1e9f"
  "sqlcipher 4.20.0 https://github.com/sqlcipher/sqlcipher/archive/refs/tags/v4.20.0.tar.gz 38705f51b61ac0636a5fd064f9a77fafabc7227b2aa2513f1b14c8bb1102affc"
  "freerdp 3.33.1 https://github.com/FreeRDP/FreeRDP/archive/refs/tags/3.33.1.tar.gz 6b6da1e7217f924b033da6896e70eb4c4a447c3900d03c0d10179062f0a7d495"
)

export MACOSX_DEPLOYMENT_TARGET="$MACOS_MIN"
export CFLAGS="-O2 -mmacosx-version-min=$MACOS_MIN"
export CXXFLAGS="$CFLAGS"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"   # never Homebrew's .pc files
cmake_common=(
  -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_INSTALL_PREFIX="$prefix"
  -DCMAKE_PREFIX_PATH="$prefix"
  -DCMAKE_FIND_ROOT_PATH="$prefix"
  -DCMAKE_FIND_FRAMEWORK=LAST
  -DCMAKE_OSX_ARCHITECTURES=arm64
  -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOS_MIN"
  -DCMAKE_IGNORE_PREFIX_PATH="/opt/homebrew;/usr/local"
  -DBUILD_SHARED_LIBS=OFF
)

# Downloads and unpacks one pinned source; prints its folder.
fetch() {
  local name=$1 ver=$2 url=$3 sum=$4
  local file="$src/$(basename "$url")"
  if [[ ! -f "$file" ]] || ! echo "$sum  $file" | shasum -a 256 -c - >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$file.part" "$url"
    echo "$sum  $file.part" | shasum -a 256 -c - >/dev/null \
      || { echo "deps-macos: $name $ver: SHA-256 mismatch" >&2; rm -f "$file.part"; exit 1; }
    mv "$file.part" "$file"
  fi
  local dir="$src/$name-$ver"
  rm -rf "$dir"; mkdir -p "$dir"
  tar -xf "$file" -C "$dir" --strip-components 1
  echo "$dir"
}

stamp() { echo "$prefix/.built-$1-$2"; }

build_openssl() {
  local d; d=$(fetch "$@")
  (cd "$d" && ./Configure darwin64-arm64-cc no-shared no-tests no-docs no-apps \
      --prefix="$prefix" --libdir=lib "-mmacosx-version-min=$MACOS_MIN" >/dev/null \
    && make -j"$jobs" >/dev/null && make install_sw >/dev/null)
  # Its legacy provider is a loadable module; libssh and FreeRDP need none of it.
  rm -rf "$prefix/lib/ossl-modules"
}

build_libsodium() {
  local d; d=$(fetch "$@")
  (cd "$d" && ./configure --prefix="$prefix" --disable-shared --enable-static --with-pic >/dev/null \
    && make -j"$jobs" >/dev/null && make install >/dev/null)
}

build_libssh() {
  local d; d=$(fetch "$@")
  cmake -S "$d" -B "$d/build" "${cmake_common[@]}" \
    -DWITH_EXAMPLES=OFF -DUNIT_TESTING=OFF -DCLIENT_TESTING=OFF -DWITH_GSSAPI=OFF \
    -DWITH_SYMBOL_VERSIONING=OFF -DWITH_ZLIB=ON -DOPENSSL_ROOT_DIR="$prefix" \
    -DOPENSSL_USE_STATIC_LIBS=ON >/dev/null
  cmake --build "$d/build" >/dev/null
  cmake --install "$d/build" >/dev/null
}

build_sqlcipher() {
  local d; d=$(fetch "$@")
  local defs="-DSQLITE_HAS_CODEC -DSQLITE_ENABLE_JSON1 -DSQLITE_ENABLE_FTS5 -DSQLITE_ENABLE_COLUMN_METADATA -DSQLITE_EXTRA_INIT=sqlcipher_extra_init -DSQLITE_EXTRA_SHUTDOWN=sqlcipher_extra_shutdown -DSQLCIPHER_CRYPTO_OPENSSL"
  (cd "$d" && ./configure --prefix="$prefix" --includedir="$prefix/include/sqlcipher" \
      --disable-shared --disable-tcl --with-tempstore=yes \
      CFLAGS="$CFLAGS $defs -I$prefix/include" LDFLAGS="-L$prefix/lib -lcrypto" >/dev/null \
    && make -j"$jobs" libsqlite3.a >/dev/null && make install-lib install-headers install-pc >/dev/null 2>&1 \
    || { cp libsqlite3.a "$prefix/lib/" && mkdir -p "$prefix/include/sqlcipher" "$prefix/lib/pkgconfig" \
         && cp sqlite3.h sqlite3ext.h "$prefix/include/sqlcipher/" && cp sqlite3.pc "$prefix/lib/pkgconfig/" ; })
  mv -f "$prefix/lib/libsqlite3.a" "$prefix/lib/libsqlcipher.a"
  rm -f "$prefix/lib/libsqlite3."*dylib
  mv -f "$prefix/lib/pkgconfig/sqlite3.pc" "$prefix/lib/pkgconfig/sqlcipher.pc"
  sed -i '' -e 's/-lsqlite3/-lsqlcipher/' -e 's/^Name: .*/Name: SQLCipher/' \
    -e "s|^Requires.private:.*|Requires.private: libcrypto|" "$prefix/lib/pkgconfig/sqlcipher.pc"
  grep -q '^Requires.private' "$prefix/lib/pkgconfig/sqlcipher.pc" \
    || echo "Requires.private: libcrypto" >> "$prefix/lib/pkgconfig/sqlcipher.pc"
}

build_freerdp() {
  local d; d=$(fetch "$@")
  # USE_VERSION_FROM_GIT_TAG=OFF: the source sits inside Flint's checkout, and FreeRDP
  # takes an exact git tag there as its own version, so a build of a tagged Flint
  # (v0.15.1) made "freerdp0.pc" instead of "freerdp3.pc" (milestone 51).
  cmake -S "$d" -B "$d/build" "${cmake_common[@]}" -DUSE_VERSION_FROM_GIT_TAG=OFF \
    -DWITH_CLIENT=OFF -DWITH_CLIENT_COMMON=ON -DWITH_CLIENT_CHANNELS=ON -DWITH_CLIENT_SDL=OFF \
    -DWITH_CLIENT_MAC=OFF -DWITH_SERVER=OFF -DWITH_SAMPLE=OFF -DWITH_PROXY=OFF -DWITH_SHADOW=OFF \
    -DWITH_PLATFORM_SERVER=OFF -DWITH_MANPAGES=OFF -DWITH_WEBVIEW=OFF -DWITH_X11=OFF \
    -DWITH_WAYLAND=OFF -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF \
    -DWITH_VIDEO_FFMPEG=OFF -DWITH_JPEG=OFF -DWITH_OPUS=OFF -DWITH_FAAD2=OFF -DWITH_FAAC=OFF \
    -DWITH_SOXR=OFF -DWITH_LAME=OFF -DWITH_CUPS=OFF -DWITH_PCSC=OFF -DWITH_FUSE=OFF \
    -DWITH_KRB5=OFF -DWITH_PULSE=OFF -DWITH_OSS=OFF -DWITH_ALSA=OFF -DWITH_AAD=OFF \
    -DWITH_CJSON_REQUIRED=OFF -DWITH_JSONC_REQUIRED=OFF -DWITH_URIPARSER=OFF \
    -DCHANNEL_URBDRC=OFF -DCHANNEL_RDPEWA=OFF -DCHANNEL_AUDIN=OFF -DCHANNEL_RDPSND=OFF \
    -DCHANNEL_RDPECAM=OFF -DCHANNEL_TSMF=OFF -DCHANNEL_RDPDR=OFF -DCHANNEL_SMARTCARD=OFF \
    -DCHANNEL_PRINTER=OFF -DCHANNEL_DRIVE=OFF -DCHANNEL_SERIAL=OFF -DCHANNEL_PARALLEL=OFF -DWITH_FIDO2=OFF -DWITH_LIBSYSTEMD=OFF \
    -DWITH_TIMEZONE_ICU=OFF -DWITH_INTERNAL_MD4=ON -DWITH_INTERNAL_RC4=ON \
    -DWITH_OPENH264=OFF -DWITH_SIMD=ON -DBUILD_TESTING=OFF -DWITH_BINARY_VERSIONING=ON \
    -DOPENSSL_ROOT_DIR="$prefix" -DOPENSSL_USE_STATIC_LIBS=ON >/dev/null
  cmake --build "$d/build" >/dev/null
  cmake --install "$d/build" >/dev/null
  [[ -f "$prefix/lib/pkgconfig/freerdp3.pc" && -f "$prefix/lib/pkgconfig/winpr3.pc" ]] \
    || { echo "deps-macos: FreeRDP installed no freerdp3.pc/winpr3.pc (its version came out wrong)" >&2; exit 1; }
}

for pin in "${PINS[@]}"; do
  read -r name ver url sum <<<"$pin"
  if [[ -f "$(stamp "$name" "$ver")" ]]; then
    echo "deps-macos: $name $ver (built)"
    continue
  fi
  echo "deps-macos: $name $ver"
  rm -f "$prefix"/.built-"$name"-*
  # cfire's probe cache would keep the old link line (CF-170).
  rm -rf "$root/build/deps/cfire-cache"
  "build_$name" "$name" "$ver" "$url" "$sum"
  # Its licence travels with the app (Contents/Resources/licenses).
  mkdir -p "$prefix/share/licenses/$name"
  find "$src/$name-$ver" -maxdepth 1 \( -iname 'LICENSE*' -o -iname 'COPYING*' -o -iname 'NOTICE*' \) \
    -exec cp {} "$prefix/share/licenses/$name/" \;
  touch "$(stamp "$name" "$ver")"
done

# Nothing here may be a dylib: the app must link these archives, never a stray shared copy.
leftover=$(find "$prefix/lib" -name '*.dylib' | head -5)
[[ -z "$leftover" ]] || { echo "deps-macos: shared libraries left in the prefix: $leftover" >&2; exit 1; }

# pkg-config files for what macOS itself provides (zlib, libcurl), so the prefix alone
# answers every lookup (PKG_CONFIG_LIBDIR points here, never at Homebrew), and libssh's
# static link names what it needs (its own .pc leaves Requires.private empty).
pc="$prefix/lib/pkgconfig"
printf 'Name: zlib\nDescription: zlib from macOS\nVersion: 1.2\nLibs: -lz\nCflags:\n' > "$pc/zlib.pc"
printf 'Name: libcurl\nDescription: libcurl from macOS\nVersion: 8\nLibs: -lcurl\nCflags:\n' > "$pc/libcurl.pc"
sed -i '' 's/^Requires.private:.*/Requires.private: libcrypto zlib/' "$pc/libssh.pc"
echo "deps-macos: $prefix"
