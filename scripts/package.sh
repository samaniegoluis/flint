#!/usr/bin/env bash
# Builds Flint's release packages for one system into dist/ (spec v13, D-111, D-112):
#
#   scripts/package.sh macos      # → dist/Flint-<version>-macos-arm64.zip
#   scripts/package.sh windows    # → windows/package.sh (MSYS2 CLANG64 on Windows)
#   scripts/package.sh linux      # milestone 49
#
# The same script runs on a person's machine and in the release workflow, which calls
# it and nothing else (Principle 16). It reads no secret and signs nothing but ad hoc;
# prints each package's path and SHA-256. Exit 1 when a step fails.
#
# macOS: the libraries come from scripts/deps-macos.sh (static, built from pinned
# sources at macOS 13.3), so the app and the CLI link nothing outside macOS itself.
# Flint.app/Contents/
#   MacOS/Flint            the app
#   Helpers/flint          the CLI (not beside the app: the volume ignores case, so
#                          MacOS/flint would be MacOS/Flint); the app offers to link it
#                          onto the PATH (Settings → About → Command line)
#   Resources/ui           the page
#   Resources/install-kind "portable": the app may update itself in place (milestone 53)
#   Resources/licenses     LICENSE and each bundled library's licence
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

system="${1:-}"
case "$system" in
  macos) ;;
  windows) exec windows/package.sh ;;
  linux) echo "package: Linux packages come in milestone 49" >&2; exit 1 ;;
  *) echo "usage: scripts/package.sh macos|linux|windows" >&2; exit 1 ;;
esac

[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] \
  || { echo "package: the macOS package is built on an arm64 Mac" >&2; exit 1; }

MACOS_MIN=13.3
version="$(scripts/version.sh)"
short="$(echo "$version" | sed -E 's/^([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
name="Flint-$version-macos-arm64"
echo "package: Flint $version"

# 1. The libraries.
scripts/deps-macos.sh
deps="$root/build/deps/macos-arm64"

# 2. The app and the CLI, linked against them only: pkg-config sees the prefix (and
# Flint's own .pc files), never Homebrew; cfire's probe cache is the package's own
# (CF-170).
. scripts/env.sh
export PKG_CONFIG_LIBDIR="$deps/lib/pkgconfig"
export CFIRE_CACHE_DIR="$root/build/deps/cfire-cache"
# Every package build.cf asks for must resolve here: cfire drops the flags of one that
# does not and fails later on a missing header, with no word of the package.
pc="$(command -v pkg-config || true)"
[[ -n "$pc" ]] || { echo "package: needs pkg-config" >&2; exit 1; }
echo "package: $pc $(pkg-config --version)"
pc_fail=0
for p in $(grep -E '^\s*PkgConfig:' build.cf | grep -oE '"[^"]+"' | tr -d '"' | sort -u); do
  if ! out="$(pkg-config --cflags --libs "$p" 2>&1)"; then
    echo "package: pkg-config cannot resolve $p:" >&2
    echo "$out" | sed 's/^/  /' >&2
    pc_fail=1
  fi
done
if [[ $pc_fail -ne 0 ]]; then
  echo "package: the .pc files in $PKG_CONFIG_LIBDIR:" >&2
  ls "$PKG_CONFIG_LIBDIR" | sed 's/^/  /' >&2
  exit 1
fi
flags="--portable --macos-min $MACOS_MIN"
FLINT_CFIRE_BUILD_FLAGS="$flags" scripts/build-gui.sh
# shellcheck disable=SC2086
cfire build $flags Flint

# 3. The bundle.
stage="$root/dist/stage"
app="$stage/Flint.app"
rm -rf "$stage"
mkdir -p "$stage"
cp -R build/gui/Flint.app "$app"
mkdir -p "$app/Contents/Helpers" "$app/Contents/Resources/licenses"
cp build/flint "$app/Contents/Helpers/flint"
chmod 755 "$app/Contents/Helpers/flint"
printf 'portable\n' > "$app/Contents/Resources/install-kind"
cp LICENSE "$app/Contents/Resources/licenses/Flint-LICENSE"
for lib in "$deps"/share/licenses/*; do
  for f in "$lib"/*; do
    cp "$f" "$app/Contents/Resources/licenses/$(basename "$lib")-$(basename "$f")"
  done
done
plist="$app/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $short" "$plist"
/usr/libexec/PlistBuddy -c "Delete :CFBundleVersion" "$plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $short" "$plist"
/usr/libexec/PlistBuddy -c "Set :LSMinimumSystemVersion $MACOS_MIN" "$plist"

# 4. Nothing may point outside macOS, and nothing may ask for a newer one.
fail=0
for bin in "$app/Contents/MacOS/Flint" "$app/Contents/Helpers/flint"; do
  bad=$(otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -vE '^(/System/Library/|/usr/lib/)' || true)
  if [[ -n "$bad" ]]; then
    echo "package: $(basename "$bin") links outside macOS:" >&2
    echo "$bad" | sed 's/^/  /' >&2
    fail=1
  fi
  minos=$(vtool -show-build "$bin" | awk '/minos/ {print $2}')
  if [[ "$minos" != "$MACOS_MIN" ]]; then
    echo "package: $(basename "$bin") needs macOS $minos, not $MACOS_MIN" >&2
    fail=1
  fi
done
[[ $fail -eq 0 ]] || exit 1

# 5. Signed ad hoc (Apple silicon runs nothing unsigned; Developer ID is v14), then zipped
# with ditto so the bundle's links and attributes survive.
codesign --force --deep -s - "$app"
codesign --verify --deep --strict "$app"
mkdir -p dist
zip="$root/dist/$name.zip"
rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
rm -rf "$stage"
sum=$(shasum -a 256 "$zip" | awk '{print $1}')
echo "package: $zip"
echo "package: sha256 $sum"
