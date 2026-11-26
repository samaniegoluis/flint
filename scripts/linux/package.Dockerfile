# The build images of Flint's Linux packages (milestone 49, D-120), one per format:
#
#   docker build --platform linux/amd64 --target deb -t flint-package-deb -f scripts/linux/package.Dockerfile scripts/linux
#   docker build --platform linux/amd64 --target rpm -t flint-package-rpm -f scripts/linux/package.Dockerfile scripts/linux
#
# scripts/package.sh linux builds and runs them; nothing else uses them. Each is the
# oldest supported release of its family with FreeRDP 3 and WebKitGTK 4.1 in its own
# repositories, so the package links the system's libraries and depends on them by
# name: Ubuntu 24.04 for the .deb (it runs on 24.04 and later and on Debian 13),
# Fedora 43 for the .rpm. Ubuntu 22.04 and Debian 12 have no FreeRDP 3 (D-120).
#
# cfire comes from its release archive and nfpm from its own, each checked against a
# SHA-256 kept here (Principle 16: no secret, nothing unpinned).
ARG CFIRE_VERSION=0.12.7
ARG CFIRE_SHA256=7e2711ee16b4c6333a3e8635d0ebcd8709b14ac7f1fd9b113f4ef6a46392d0d7
ARG NFPM_VERSION=2.49.0
ARG NFPM_SHA256=2afaa5ffb5e3493402e31e7c67a5a1fb42133e3f66fc315ca0051934125561c7

FROM ubuntu:24.04 AS deb
ARG CFIRE_VERSION CFIRE_SHA256 NFPM_VERSION NFPM_SHA256
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git curl ca-certificates pkg-config rsync file \
        libssh-dev libcurl4-openssl-dev libsodium-dev libsqlcipher-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev freerdp3-dev \
    && rm -rf /var/lib/apt/lists/*
COPY package-tools.sh /usr/local/lib/flint/package-tools.sh
RUN bash /usr/local/lib/flint/package-tools.sh "$CFIRE_VERSION" "$CFIRE_SHA256" "$NFPM_VERSION" "$NFPM_SHA256"

FROM fedora:43 AS rpm
ARG CFIRE_VERSION CFIRE_SHA256 NFPM_VERSION NFPM_SHA256
RUN dnf -y install --setopt=install_weak_deps=False \
        clang make git curl ca-certificates pkgconf-pkg-config rsync file findutils \
        libssh-devel libcurl-devel libsodium-devel sqlcipher-devel libsecret-devel \
        webkit2gtk4.1-devel gtk3-devel freerdp-devel \
    && dnf clean all
COPY package-tools.sh /usr/local/lib/flint/package-tools.sh
RUN bash /usr/local/lib/flint/package-tools.sh "$CFIRE_VERSION" "$CFIRE_SHA256" "$NFPM_VERSION" "$NFPM_SHA256"
