#!/usr/bin/env bash
# Builds Flint's release packages for one system into dist/ (spec v13, D-111, D-112):
#
#   scripts/package.sh macos      # → dist/Flint-<version>-macos-arm64.zip
#   FLINT_MACOS_SIGN_IDENTITY="Developer ID Application: … (TEAMID)" scripts/package.sh macos
#                                 # the same, signed with a Developer ID (then scripts/macos/notarize.sh)
#   scripts/package.sh windows    # → dist/Flint-<version>-windows-x86_64.zip (windows/package.sh, MSYS2 CLANG64)
#   scripts/package.sh linux      # → dist/flint_<version>_amd64.deb, dist/flint-<version>.x86_64.rpm
#   scripts/package.sh linux deb  # one of the two
#   FLINT_PACKAGE_CACHE=~/.cache/flint-package scripts/package.sh linux deb
#                                 # its build cache in <folder>/deb, not a named volume
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
# it and nothing else (Principle 16). It reads no secret: macOS is signed with the
# Developer ID FLINT_MACOS_SIGN_IDENTITY names (a name, found in the keychain), ad hoc
# without it (milestone 79, D-158); prints each package's path and SHA-256. Exit 1 when
# a step fails.
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
    # The tree is copied into a cache of its own (with cfire's cache), so a second
    # build compiles only what changed and the checkout never gets Linux's .cfire/ or
    # build/ folders; the version comes from the host's git. The cache is a named
    # volume, or with FLINT_PACKAGE_CACHE a folder per format under it, which the
    # release workflow keeps between runs (milestone 83, D-161).
    cache="flint-package-$f-cache" chown_cache=0
    if [[ -n "${FLINT_PACKAGE_CACHE:-}" ]]; then
      FLINT_PACKAGE_CACHE="${FLINT_PACKAGE_CACHE/#\~/$HOME}"
      mkdir -p "$FLINT_PACKAGE_CACHE/$f"
      cache="$(cd "$FLINT_PACKAGE_CACHE/$f" && pwd)"
      echo "package: $f's build cache in $cache ($(du -sh "$cache" | cut -f1))"
      chown_cache=1
    fi
    docker run --rm --platform linux/amd64 -e FLINT_VERSION="$version" \
      -e FLINT_BUILD_TEST_FEED="${FLINT_BUILD_TEST_FEED:-}" -e FLINT_BUILD_TEST_KEY="${FLINT_BUILD_TEST_KEY:-}" \
      -e OWNER="$(id -u):$(id -g)" -e CHOWN_CACHE="$chown_cache" \
      -v "$root:/src:ro" -v "$cache:/cache" -v "$root/dist:/out" \
      "$image" bash -c '
        set -euo pipefail
        mkdir -p /cache/work /cache/cfire
        rc=0
        # By content (-c), keeping no times (no -t): a file the same as the cached copy keeps
        # the cached copy'"'"'s mtime, and only a changed one gets a new one. cfire fingerprints
        # local C++ headers by mtime (CF-218), and a fresh checkout dates every file now.
        rsync -rlpcD --delete --exclude=/site/node_modules --exclude=/ui/node_modules \
          --exclude=/.git --exclude=/dist --exclude=build/ --exclude=.cfire/ /src/ /cache/work/ || rc=$?
        [[ $rc == 0 || $rc == 24 ]] || exit "$rc"
        # Each source folder listed in name order: cfire reads an imported package'"'"'s files
        # in the order the folder lists them and generates its header in that order
        # (CF-220), and on Linux that order is the order the entries were made, which a
        # restored cache and rsync change from run to run. Moved into a new folder in name
        # order, deepest first; mv keeps every file'"'"'s mtime (CF-218).
        find /cache/work/src -name .cfire -prune -o -type d -print | LC_ALL=C sort -r | while IFS= read -r d; do
          t="$d.sorting"; mkdir "$t"
          ls -A "$d" | LC_ALL=C sort | while IFS= read -r e; do mv "$d/$e" "$t/"; done
          rmdir "$d"; mv "$t" "$d"
        done
        export CFIRE_CACHE_DIR=/cache/cfire
        mkdir -p /tmp/out
        # What the cache held and what the build compiled again, per folder: an object is
        # named by a hash of its inputs, so a new file is a unit compiled (milestone 83).
        objs() { find /cache/work -path "*/.cfire/obj/*.o" "$@" | sed "s#/\.cfire/obj/.*##; s#^/cache/work/##" | sort | uniq -c | tr "\n" " "; }
        echo "package: cache before: $(objs) ($(du -sh /cache | cut -f1))"
        echo "package: $(clang --version | head -1); cfire runtime $(ls -d "$(dirname "$(command -v cfire)")"/../share/cfire* 2>/dev/null | head -1)"
        # One object per unit, the newest, before and after the build: cfire prunes a unit'"'"'s
        # old objects by a name prefix that also matches longer units (domain/update'"'"'s
        # matches update_apply'"'"'s), and with more than three it deleted an object the link
        # still needed (CF-219). The exact unit is the name less its 16-hex hash.
        prune_objs() {
          find /cache/work -path "*/.cfire/obj/*.o" -printf "%T@ %p\n" | sort -rn \
            | awk "{ k = \$2; sub(/_[0-9a-f]{16}\\.o\$/, \"\", k); if (seen[k]++) print \$2 }" | xargs -r rm -f
        }
        prune_objs
        touch /tmp/build-start
        /cache/work/scripts/linux/package-inside.sh '"$f"' /cache/work /tmp/out
        prune_objs
        echo "package: compiled: $(objs -newer /tmp/build-start)"
        echo "package: reused: $(objs ! -newer /tmp/build-start)"
        # What cfire hashes into every object, kept in the cache and compared with the run
        # before: the compiler, the runtime and the local headers (by mtime, CF-218), and
        # every generated C++ file (milestone 83: why a kept cache still compiled all).
        mkdir -p /cache/diag
        cc="$(readlink -f "$(command -v clang++)")"
        { echo "compiler $cc $(stat -c "%Y %s" "$cc")"
          echo "runtime $(find /usr/local/share/cfire/runtime -name "*.h*" -printf "%P %T@ %s\n" | sort | sha256sum | cut -c1-16)"
          find /cache/work/src -name "*.hpp" -printf "header %P %T@ %s\n" | sort
          # The system: its packages (a newer -devel brings headers with new mtimes) and
          # the -I folders pkg-config gives, whose headers cfire also fingerprints.
          if command -v rpm >/dev/null; then rpm -qa --qf "pkg %{NAME} %{VERSION}-%{RELEASE}\n"; else dpkg-query -W -f "pkg \${Package} \${Version}\n"; fi | sort
          (cd /cache/work && . scripts/env.sh && pkg-config --cflags $(grep -E "^\s*PkgConfig:" build.cf | grep -oE "\"[^\"]+\"" | tr -d "\"" | sort -u)) | tr " " "\n" | sed -n "s/^-I/cflags -I/p" | sort -u
          find /cache/work/src -path "*/.cfire/gen/*" -type f -exec sha256sum {} + | awk "{print \"gen\", \$2, substr(\$1,1,16)}" | sort
        } > /cache/diag/now.txt || true
        if [[ -f /cache/diag/before.txt ]]; then
          echo "package: inputs changed since the cached run: $(diff /cache/diag/before.txt /cache/diag/now.txt | grep -c "^>") lines"
          diff /cache/diag/before.txt /cache/diag/now.txt | grep "^[<>] \(compiler\|runtime\|header\|pkg\|cflags\)" | head -30 | sed "s/^/package:   /" || true
          diff /cache/diag/before.txt /cache/diag/now.txt | grep "^> gen" | awk "{print \$3}" | sed "s#/\.cfire/gen/.*##" | sort | uniq -c | sed "s/^/package:   gen changed /" || true
          diff /cache/diag/before.txt /cache/diag/now.txt | grep "^> gen" | head -8 | sed "s/^/package:   /" || true
        fi
        mv /cache/diag/now.txt /cache/diag/before.txt
        for p in /tmp/out/*; do install -m 644 "$p" /out/; chown "$OWNER" "/out/$(basename "$p")"; done
        # A folder of the host'"'"'s: its owner can read and keep it (actions/cache).
        if [[ $CHOWN_CACHE == 1 ]]; then chown -R "$OWNER" /cache; fi'
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

# 5. Signed (milestone 79, D-158): with a Developer ID when FLINT_MACOS_SIGN_IDENTITY
# names one (scripts/macos/sign.sh: hardened runtime, timestamp, the Team ID checked),
# ad hoc otherwise (Apple silicon runs nothing unsigned), which a person building their
# own copy gets. Then zipped with ditto so the bundle's links and attributes survive.
# Notarizing is scripts/macos/notarize.sh, run on the zip after this.
if [[ -n "${FLINT_MACOS_SIGN_IDENTITY:-}" ]]; then
  scripts/macos/sign.sh "$app"
else
  echo "package: signed ad hoc (FLINT_MACOS_SIGN_IDENTITY is not set): Gatekeeper will not open a download of it"
  codesign --force --deep -s - "$app"
  codesign --verify --deep --strict "$app"
fi
mkdir -p dist
zip="$root/dist/$name.zip"
rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
rm -rf "$stage"
sum=$(shasum -a 256 "$zip" | awk '{print $1}')
echo "package: $zip"
echo "package: sha256 $sum"
