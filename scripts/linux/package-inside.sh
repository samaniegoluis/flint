#!/usr/bin/env bash
# The part of `scripts/package.sh linux` that runs inside a package build image
# (scripts/linux/package.Dockerfile), or by hand on Ubuntu 24.04 / Fedora 43 with the
# image's packages installed:
#
#   scripts/linux/package-inside.sh deb|rpm <tree> <out>
#
# Builds the app and the CLI from <tree> (the page already in ui/dist), stages
# /usr/lib/flint and the desktop files, works out the package names of the libraries
# the binaries link on this base, and writes the package into <out> with nfpm.
set -euo pipefail
format="${1:-}" tree="${2:-}" out="${3:-}"
[[ "$format" == deb || "$format" == rpm ]] && [[ -d "$tree" && -n "$out" ]] \
  || { echo "usage: package-inside.sh deb|rpm <tree> <out>" >&2; exit 1; }
cd "$tree"
[[ -f ui/dist/index.html ]] || { echo "package: no ui/dist (built on the host)" >&2; exit 1; }

version="$(scripts/version.sh)"
. scripts/env.sh
echo "package: Flint $version, $format, $(. /etc/os-release && echo "$PRETTY_NAME"), cfire $(cfire --version)"
pc_fail=0
for p in $(grep -E '^\s*PkgConfig:' build.cf | grep -oE '"[^"]+"' | tr -d '"' | sort -u); do
  pkg-config --exists "$p" || { echo "package: pkg-config cannot resolve $p" >&2; pc_fail=1; }
done
[[ $pc_fail -eq 0 ]] || exit 1
scripts/build-gui.sh
cfire build Flint

# 1. The files.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
lib="$stage/lib"
mkdir -p "$lib/licenses"
install -m 755 build/gui/Flint "$lib/Flint"
install -m 755 build/flint "$lib/flint"
cp -R build/gui/ui "$lib/ui"
# How this copy updates (milestone 52): the package manager, and which one.
printf 'package:%s\n' "$format" > "$lib/install-kind"
cp CHANGELOG.md "$lib/CHANGELOG.md"
cp LICENSE "$lib/licenses/Flint-LICENSE"
cp packaging/linux/dev.flint.app.desktop "$stage/"
cp assets/app-icon/flint-256.png "$stage/dev.flint.app.png"
cp packaging/linux/dev.flint.policy "$stage/"
chmod -R u=rwX,go=rX "$stage"

# 2. The dependencies: the package of each library the two binaries ask for by name
# (DT_NEEDED, not what those pull in), as this base names it.
needed() { readelf -d "$1" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p'; }
owner_of() {
  local soname="$1" path
  path="$(ldconfig -p | awk -v s="$soname" '$1 == s && /x86-64/ {print $NF; exit}')"
  [[ -n "$path" ]] || { echo "package: no $soname on this system" >&2; return 1; }
  if [[ "$format" == deb ]]; then
    # usrmerge: dpkg knows a library by the path its package shipped, /lib or /usr/lib.
    dpkg -S "$path" 2>/dev/null || dpkg -S "$(realpath "$path")" 2>/dev/null \
      || dpkg -S "${path#/usr}" 2>/dev/null || dpkg -S "/usr$path" 2>/dev/null
  else
    rpm -qf --qf '%{NAME}:\n' "$path"
  fi | head -1 | cut -d: -f1
}
deps=()
for soname in $( (needed "$lib/Flint"; needed "$lib/flint") | sort -u); do
  pkg="$(owner_of "$soname")" || exit 1
  [[ -n "$pkg" ]] || { echo "package: no package owns $soname" >&2; exit 1; }
  deps+=("$pkg")
done
mapfile -t deps < <(printf '%s\n' "${deps[@]}" | sort -u)
echo "package: depends on ${deps[*]}"

# 3. The package.
config="$stage/nfpm.yaml"
# nfpm expands variables in some fields only (not `contents`): the two are put in here.
sed -e "s|\${FLINT_STAGE}|$stage|g" -e "s|\${FLINT_VERSION}|$version|g" packaging/linux/nfpm.yaml > "$config"
{
  echo "depends:"
  for d in "${deps[@]}"; do echo "  - $d"; done
} >> "$config"
mkdir -p "$out"
if [[ "$format" == deb ]]; then
  file="$out/flint_${version}_amd64.deb"
else
  file="$out/flint-${version}.x86_64.rpm"
fi
rm -f "$file"
nfpm package --config "$config" --packager "$format" --target "$file"
echo "package: $file"
