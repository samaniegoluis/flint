#!/usr/bin/env bash
# Installs the cfire release Flint is pinned to (D-154) from its release archive, checked
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

CFIRE_VERSION=v0.12.7
# From the release's SHA256SUMS.txt.
sum_for() {
  case "$1" in
    macos-arm64)    echo 7003f681da1ca5e52cc4b4106b7ef966d052fe3cfa81f1d131682fe7383d57a3 ;;
    linux-x86_64)   echo 7e2711ee16b4c6333a3e8635d0ebcd8709b14ac7f1fd9b113f4ef6a46392d0d7 ;;
    windows-x86_64) echo b3fe5afe58be37e4c4f5d5dc274ae7d2b2276d514c8e54431cfd006ac0d3aea5 ;;
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
cp -Rp "$tmp/$name/runtime" "$prefix/share/cfire/runtime"
# A new file, not one written over: macOS kills a signed binary copied over the old one
# (its code-signature cache still holds the old pages).
rm -f "$prefix/bin/$exe"
cp "$tmp/$name/$exe" "$prefix/bin/$exe"
chmod 755 "$prefix/bin/$exe"
"$prefix/bin/$exe" --version >&2
echo "$prefix/bin"
