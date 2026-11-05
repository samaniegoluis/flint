#!/usr/bin/env bash
# Builds the Flint desktop app: the page (ui/, React + Vite), then the executable,
# then puts the page where the executable looks for it.
#
#   scripts/build-gui.sh          # → build/Flint.app on macOS, build/Flint + build/ui on Linux
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
    res="build/Flint.app/Contents/Resources"
    rm -rf "$res/ui"
    mkdir -p "$res"
    cp -R ui/dist "$res/ui"
    codesign --force --deep -s - build/Flint.app >/dev/null 2>&1 || echo "build-gui: ad-hoc signing failed" >&2
    echo "build-gui: build/Flint.app"
    ;;
  *)
    rm -rf build/ui
    cp -R ui/dist build/ui
    echo "build-gui: build/Flint (page in build/ui)"
    ;;
esac
