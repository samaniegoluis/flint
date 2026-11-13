#!/usr/bin/env bash
# Builds flint-vault-server's Docker image (milestone 42, D-092) from
# packaging/vault-server/Dockerfile, tagged with Flint's version and `latest`.
#
#   scripts/server-image.sh            # this machine's platform, loaded into Docker
#   scripts/server-image.sh --push     # linux/amd64 and linux/arm64, pushed to GHCR
#
# Pushing needs `docker login ghcr.io` first. GitHub Actions takes this over with CI
# (ROADMAP §7).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="${FLINT_SERVER_IMAGE:-ghcr.io/samaniegoluis/flint-vault-server}"
version="$("$root/scripts/version.sh")"
push=0
[[ "${1:-}" == "--push" ]] && push=1

args=(-f "$root/packaging/vault-server/Dockerfile" --build-arg "FLINT_VERSION=$version"
      -t "$repo:$version" -t "$repo:latest")
if [[ $push -eq 1 ]]; then
  if [[ "$version" == *-* ]]; then
    echo "server-image: $version is not a release; push only a tagged version" >&2
    exit 2
  fi
  docker buildx build --platform linux/amd64,linux/arm64 --push "${args[@]}" "$root"
else
  docker build "${args[@]}" "$root"
fi
echo "server-image: $repo:$version"
