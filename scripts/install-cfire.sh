#!/usr/bin/env bash
# Installs the cfire release Flint is pinned to (D-105) from its release archive, checked
# against a SHA-256 kept here rather than one downloaded beside the archive (milestone 51):
#
#   scripts/install-cfire.sh [prefix]     # default ~/.local
#   → <prefix>/bin/cfire and <prefix>/share/cfire/runtime, the layout cfire's own
#     installer makes (cfire finds its runtime next to itself)
#
# The release workflow runs it on each hosted runner; a person can use it the same way
# (or cfire's installer, as Build from source says). Prints the bin folder last, for the
# caller's PATH. Needs curl and tar (unzip on Windows). Moving to a new cfire release
# changes CFIRE_VERSION and the sums below together.
set -euo pipefail

CFIRE_VERSION=v0.12.2
# From the release's SHA256SUMS.txt.
sum_for() {
  case "$1" in
    macos-arm64)    echo 8a9fdae6c9b56b0c825c6de83f916644a3aebab01dc7d3675e6fe97a8eaf3026 ;;
    linux-x86_64)   echo 6fe582d6bf6a21a429b9212c28b8d01bf1a69bed9ee9216fa7afd6e7c1db7ffd ;;
    windows-x86_64) echo 2bbaa7adff5882ca4df05434ae8e993263a0880a4498ccde3390659e7eb62578 ;;
    *) return 1 ;;
  esac
}

prefix="${1:-$HOME/.local}"
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) target=macos-arm64; ext=tar.gz ;;
  Linux-x86_64) target=linux-x86_64; ext=tar.gz ;;
  MINGW*-x86_64|MSYS*-x86_64|CLANG*-x86_64) target=windows-x86_64; ext=zip ;;
  *) echo "install-cfire: no pinned cfire for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
sum="$(sum_for "$target")"
name="cfire-$CFIRE_VERSION-$target"
url="https://github.com/gsandoval/cfire/releases/download/$CFIRE_VERSION/$name.$ext"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 --connect-timeout 20 --max-time 600 -o "$tmp/$name.$ext" "$url"
if command -v sha256sum >/dev/null; then got="$(sha256sum "$tmp/$name.$ext")"; else got="$(shasum -a 256 "$tmp/$name.$ext")"; fi
got="${got%% *}"
if [[ "$got" != "$sum" ]]; then
  echo "install-cfire: $name.$ext: SHA-256 $got, expected $sum" >&2
  exit 1
fi
if [[ "$ext" == zip ]]; then unzip -q "$tmp/$name.$ext" -d "$tmp"; else tar -xzf "$tmp/$name.$ext" -C "$tmp"; fi

exe=cfire; [[ "$target" == windows-* ]] && exe=cfire.exe
[[ -f "$tmp/$name/$exe" && -d "$tmp/$name/runtime" ]] \
  || { echo "install-cfire: $name.$ext does not hold $exe and runtime/" >&2; exit 1; }
mkdir -p "$prefix/bin" "$prefix/share/cfire"
rm -rf "$prefix/share/cfire/runtime"
cp -R "$tmp/$name/runtime" "$prefix/share/cfire/runtime"
cp "$tmp/$name/$exe" "$prefix/bin/$exe"
chmod 755 "$prefix/bin/$exe"
"$prefix/bin/$exe" --version >&2
echo "$prefix/bin"
