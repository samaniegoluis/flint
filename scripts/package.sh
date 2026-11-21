#!/usr/bin/env bash
# Builds Flint's release packages for one system into dist/ (spec v13, D-111, D-112):
#
#   scripts/package.sh macos      # → dist/Flint-<version>-macos-arm64.zip
#   scripts/package.sh windows    # → dist/Flint-<version>-windows-x86_64.zip (windows/package.sh, MSYS2 CLANG64)
#   scripts/package.sh linux      # → dist/flint_<version>_amd64.deb, dist/flint-<version>.x86_64.rpm
#   scripts/package.sh linux deb  # one of the two
#   FLINT_BUILD_TEST_FEED=http://127.0.0.1:8123/manifest.json FLINT_BUILD_TEST_KEY=<hex> \
#     scripts/package.sh linux deb --test-feed   # → dist/flint-testfeed_<version>_amd64.deb
#
# --test-feed (milestone 54, D-124 (5)): a package for containers and Zorin only, with a
# local feed and its key compiled in (scripts/version.sh), so the self-update can be
# tried end to end between two local packages (FLINT_VERSION sets each one's version).
# Its name says testfeed, it holds /usr/lib/flint/TEST-FEED, and release-draft.sh
# refuses it.
#
# The same script runs on a person's machine and in the release workflow, which calls
# it and nothing else (Principle 16). It reads no secret and signs nothing but ad hoc;
# prints each package's path and SHA-256. Exit 1 when a step fails.
#
# Linux (D-120): each format is built in its own image (scripts/linux/package.Dockerfile:
# Ubuntu 24.04 for the .deb, Fedora 43 for the .rpm, x86_64) against the system's
# libraries, and depends on them by name; scripts/linux/package-inside.sh does the
# build and runs nfpm. Needs Docker (or an engine that speaks its API) and npm on the
# host, which builds the page. /usr/lib/flint/ holds the app, the CLI (/usr/bin/flint
# links to it), the page, install-kind ("package:deb" or "package:rpm": the package
# manager updates it) and CHANGELOG.md; the .desktop file, the icon and the polkit
# policy go where the desktop and polkit look for them.
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
#   Resources/CHANGELOG.md What's new after an update (milestone 52)
#   Resources/licenses     LICENSE and each bundled library's licence
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

system="${1:-}"
case "$system" in
  macos) ;;
  windows) exec windows/package.sh ;;
  linux) ;;
  *) echo "usage: scripts/package.sh macos|linux|windows" >&2; exit 1 ;;
esac

if [[ "$system" == linux ]]; then
  formats="" test_feed=0
  for a in "${@:2}"; do
    if [[ "$a" == --test-feed ]]; then test_feed=1; else formats="$formats $a"; fi
  done
  formats="${formats:-deb rpm}"
  if [[ $test_feed == 1 ]]; then
    [[ -n "${FLINT_BUILD_TEST_FEED:-}" && -n "${FLINT_BUILD_TEST_KEY:-}" ]] \
      || { echo "package: --test-feed needs FLINT_BUILD_TEST_FEED and FLINT_BUILD_TEST_KEY" >&2; exit 1; }
  else
    # A release build never carries a test feed, even one left in the environment.
    unset FLINT_BUILD_TEST_FEED FLINT_BUILD_TEST_KEY
  fi
  for f in $formats; do
    [[ "$f" == deb || "$f" == rpm ]] || { echo "usage: scripts/package.sh linux [deb|rpm] [--test-feed]" >&2; exit 1; }
  done
  command -v docker >/dev/null || { echo "package: the Linux packages are built with docker" >&2; exit 1; }
  version="$(scripts/version.sh)"
  echo "package: Flint $version"
  # The page: the build images have no Node, and it is the same on every system.
  (cd ui && { [[ -d node_modules ]] || npm ci --no-audit --no-fund; } && npm run build)
  mkdir -p dist
  for f in $formats; do
    image="flint-package-$f"
    # --load: a buildx builder on the docker-container driver keeps the image in its
    # cache otherwise, and the run below would not find it.
    docker build --load --platform linux/amd64 --target "$f" -t "$image" \
      -f scripts/linux/package.Dockerfile scripts/linux
    # The tree is copied into a cache volume of its own (with cfire's cache), so a
    # second build compiles only what changed and the checkout never gets Linux's
    # .cfire/ or build/ folders; the version comes from the host's git.
    docker run --rm --platform linux/amd64 -e FLINT_VERSION="$version" \
      -e FLINT_BUILD_TEST_FEED="${FLINT_BUILD_TEST_FEED:-}" -e FLINT_BUILD_TEST_KEY="${FLINT_BUILD_TEST_KEY:-}" \
      -e OWNER="$(id -u):$(id -g)" \
      -v "$root:/src:ro" -v "flint-package-$f-cache:/cache" -v "$root/dist:/out" \
      "$image" bash -c '
        set -euo pipefail
        mkdir -p /cache/work /cache/cfire
        rc=0
        rsync -a --delete --exclude=/site/node_modules --exclude=/ui/node_modules \
          --exclude=/.git --exclude=/dist --exclude=build/ --exclude=.cfire/ /src/ /cache/work/ || rc=$?
        [[ $rc == 0 || $rc == 24 ]] || exit "$rc"
        export CFIRE_CACHE_DIR=/cache/cfire
        mkdir -p /tmp/out
        /cache/work/scripts/linux/package-inside.sh '"$f"' /cache/work /tmp/out
        for p in /tmp/out/*; do install -m 644 "$p" /out/; chown "$OWNER" "/out/$(basename "$p")"; done'
  done
  for f in $formats; do
    name=flint
    [[ $test_feed == 1 ]] && name=flint-testfeed
    if [[ "$f" == deb ]]; then file="dist/${name}_${version}_amd64.deb"; else file="dist/${name}-${version}.x86_64.rpm"; fi
    sum=$( (command -v sha256sum >/dev/null && sha256sum "$file" || shasum -a 256 "$file") | awk '{print $1}')
    echo "package: $root/$file"
    echo "package: sha256 $sum"
  done
  exit 0
fi

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
# does not and fails later on a missing header, with no word of the package (CF-166).
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
cp CHANGELOG.md "$app/Contents/Resources/CHANGELOG.md"
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
