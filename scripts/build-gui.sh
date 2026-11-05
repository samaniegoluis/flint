#!/usr/bin/env bash
# Builds the Flint desktop app: the page (ui/, React + Vite), then the executable,
# then puts the page where the executable looks for it.
#
#   scripts/build-gui.sh          # → build/gui/Flint.app on macOS, build/gui/Flint + build/gui/ui on Linux
#
# The app lives in build/gui, not build/: macOS file systems ignore case, so
# build/Flint and the CLI's build/flint would be the same file.
#
# On macOS the page goes into Flint.app/Contents/Resources/ui and the bundle is
# signed again ad hoc, because adding files invalidates cfire's signature.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
. "$root/scripts/env.sh"

# Without Node (the Linux check container), a page built beforehand is used as is:
# it is the same HTML, CSS and JS on every platform.
if command -v npm >/dev/null; then
  if [[ ! -d ui/node_modules ]]; then
    (cd ui && npm ci --no-audit --no-fund)
  fi
  (cd ui && npm run build)
elif [[ -f ui/dist/index.html ]]; then
  echo "build-gui: no npm; using the page already in ui/dist"
else
  echo "build-gui: needs npm to build ui/, or a built ui/dist" >&2
  exit 1
fi

cfire build FlintGui

case "$(uname -s)" in
  Darwin)
    res="build/gui/Flint.app/Contents/Resources"
    rm -rf "$res/ui"
    mkdir -p "$res"
    cp -R ui/dist "$res/ui"
    # cfire writes a fixed Info.plist with no icon (CF-052): add it before signing.
    # CFIRE-UPSTREAM: CF-052
    cp assets/app-icon/Flint.icns "$res/Flint.icns"
    plutil -replace CFBundleIconFile -string Flint build/gui/Flint.app/Contents/Info.plist
    codesign --force --deep -s - build/gui/Flint.app >/dev/null 2>&1 || echo "build-gui: ad-hoc signing failed" >&2
    echo "build-gui: build/gui/Flint.app"
    ;;
  *)
    rm -rf build/gui/ui
    cp -R ui/dist build/gui/ui
    echo "build-gui: build/gui/Flint (page in build/gui/ui)"
    ;;
esac
