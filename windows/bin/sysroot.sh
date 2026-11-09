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
echo "sysroot ready: $SYSROOT/clang64"
