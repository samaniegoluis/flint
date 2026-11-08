#!/usr/bin/env bash
# Builds Flint from this checkout and installs it as your everyday copy: the desktop app
# and the `flint` CLI together, so both speak the same socket protocol.
#
#   scripts/install.sh
#
# macOS:  /Applications/Flint.app  and  ~/.local/bin/flint
# Linux:  ~/.local/share/flint/{Flint,ui}, ~/.local/bin/flint-app (starts it),
#         ~/.local/bin/flint, and a menu entry in ~/.local/share/applications
#
# A running Flint is quit first (its vault locks and its grants end), because the new
# build cannot serve the socket while the old one holds it. FLINT_PREFIX changes the
# CLI's folder (default ~/.local/bin).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
bin="${FLINT_PREFIX:-$HOME/.local/bin}"
rev="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
[[ -n "$(git status --porcelain 2>/dev/null)" ]] && rev="$rev (uncommitted changes)"

scripts/build-gui.sh
. scripts/env.sh
cfire build Flint

mkdir -p "$bin"

case "$(uname -s)" in
  Darwin)
    if pgrep -x Flint >/dev/null; then
      echo "install: quitting the running Flint"
      osascript -e 'quit app "Flint"' >/dev/null 2>&1 || true
      for _ in $(seq 1 50); do pgrep -x Flint >/dev/null || break; sleep 0.1; done
      pkill -x Flint 2>/dev/null || true
    fi
    rm -rf /Applications/Flint.app
    cp -R build/gui/Flint.app /Applications/Flint.app
    codesign --force --deep -s - /Applications/Flint.app >/dev/null 2>&1 \
      || echo "install: ad-hoc signing failed" >&2
    app="/Applications/Flint.app"
    ;;
  *)
    share="$HOME/.local/share/flint"
    if pgrep -x Flint >/dev/null; then
      echo "install: quitting the running Flint"
      pkill -x Flint || true
      for _ in $(seq 1 50); do pgrep -x Flint >/dev/null || break; sleep 0.1; done
    fi
    rm -rf "$share"
    mkdir -p "$share"
    cp build/gui/Flint "$share/Flint"
    cp -R build/gui/ui "$share/ui"
    cp assets/app-icon/flint-256.png "$share/flint.png"
    # The CLI looks for flint-app beside itself to start the app (serve.cf).
    printf '#!/bin/sh\nexec "%s/Flint" "$@"\n' "$share" > "$bin/flint-app"
    chmod 755 "$bin/flint-app"
    mkdir -p "$HOME/.local/share/applications"
    cat > "$HOME/.local/share/applications/flint.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Flint
Comment=SSH client over one encrypted vault
Exec=$share/Flint
Icon=$share/flint.png
Terminal=false
Categories=Network;RemoteAccess;
EOF
    app="$share/Flint"
    ;;
esac

# Replace the CLI by renaming over it, so a `flint` running now keeps its old file.
cp build/flint "$bin/flint.new"
chmod 755 "$bin/flint.new"
mv -f "$bin/flint.new" "$bin/flint"

echo "install: Flint $rev"
echo "install:   app  $app"
echo "install:   cli  $bin/flint"
case ":$PATH:" in *":$bin:"*) ;; *) echo "install: $bin is not on your PATH" >&2 ;; esac
