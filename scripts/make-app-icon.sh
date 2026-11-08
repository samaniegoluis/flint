#!/usr/bin/env bash
# Renders the app icon (assets/app-icon/flint-app-icon.svg) into the files the
# builds use, which are committed so a build needs neither tool:
#
#   assets/app-icon/Flint.icns      macOS bundle icon (build.cf, Icon)
#   assets/app-icon/flint-256.png   Linux and anything else that takes a PNG
#   ui/public/tray-template.png      macOS menu bar glyph (assets/app-icon/flint-tray.svg)
#   ui/public/tray.png               Linux tray glyph, light on the dark panel
#
#   scripts/make-app-icon.sh        # needs rsvg-convert (librsvg) and macOS iconutil
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dir="$root/assets/app-icon"
svg="$dir/flint-app-icon.svg"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-icon.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

set_dir="$tmp/Flint.iconset"
mkdir -p "$set_dir"
for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$svg" -o "$set_dir/icon_${size}x${size}.png"
  rsvg-convert -w $((size * 2)) -h $((size * 2)) "$svg" -o "$set_dir/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$set_dir" -o "$dir/Flint.icns"
rsvg-convert -w 256 -h 256 "$svg" -o "$dir/flint-256.png"
tray="$dir/flint-tray.svg"
rsvg-convert -w 36 -h 36 "$tray" -o "$root/ui/public/tray-template.png"
sed 's/#000/#D8DBE0/g' "$tray" > "$tmp/tray-light.svg"
rsvg-convert -w 48 -h 48 "$tmp/tray-light.svg" -o "$root/ui/public/tray.png"
echo "make-app-icon: $dir/Flint.icns, $dir/flint-256.png, ui/public/tray-template.png, ui/public/tray.png"
