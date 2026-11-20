#!/usr/bin/env bash
# Installs cfire and nfpm into a package build image (scripts/linux/package.Dockerfile),
# each from its release archive, checked against the SHA-256 the Dockerfile passes:
#
#   package-tools.sh <cfire version> <cfire sha256> <nfpm version> <nfpm sha256>
#
# cfire in install.sh's layout (bin/cfire, share/cfire/runtime), as scripts/linux/Dockerfile.
set -euo pipefail
cfire_version="$1" cfire_sum="$2" nfpm_version="$3" nfpm_sum="$4"
tmp="$(mktemp -d)"
cd "$tmp"

name="cfire-v${cfire_version}-linux-x86_64"
curl -fsSLO "https://github.com/gsandoval/cfire/releases/download/v${cfire_version}/${name}.tar.gz"
echo "${cfire_sum}  ${name}.tar.gz" | sha256sum -c -
tar xzf "${name}.tar.gz"
install -D -m 755 "${name}/cfire" /usr/local/bin/cfire
mkdir -p /usr/local/share/cfire
cp -R "${name}/runtime" /usr/local/share/cfire/runtime
cfire --version

nfpm="nfpm_${nfpm_version}_Linux_x86_64.tar.gz"
curl -fsSLO "https://github.com/goreleaser/nfpm/releases/download/v${nfpm_version}/${nfpm}"
echo "${nfpm_sum}  ${nfpm}" | sha256sum -c -
tar xzf "$nfpm" nfpm
install -m 755 nfpm /usr/local/bin/nfpm
nfpm --version

cd /
rm -rf "$tmp"
