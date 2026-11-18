# flint-vault-server's image (milestone 42, D-092, D-097): the server built from this
# repo with cfire pinned to the release Flint is built against, then copied alone into a
# slim Debian with libsodium, run as an unprivileged user over a volume at /data.
#
#   scripts/server-image.sh            # builds it (context: the repo root)
#   scripts/server-image.sh --push     # builds for amd64 and arm64 and pushes to GHCR
FROM debian:trixie AS build

# cfire's published Linux archive, as scripts/linux/Dockerfile installs it (migration
# step 4): checked against the release's SHA256SUMS.txt, unpacked in install.sh's layout
# without its installer. TARGETARCH picks it, so `--push` builds both platforms.
ARG CFIRE_VERSION=0.12.2
ARG CFIRE_SHA256_ARM64=ce992d12fe688fbfcb9bc9fcf7c195a99315d200c3fe9be10b185e6cc61b35ca
ARG CFIRE_SHA256_AMD64=6fe582d6bf6a21a429b9212c28b8d01bf1a69bed9ee9216fa7afd6e7c1db7ffd
ARG TARGETARCH

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang curl ca-certificates pkg-config libsodium-dev \
    && rm -rf /var/lib/apt/lists/*

RUN case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
        arm64) arch=arm64;  sum="$CFIRE_SHA256_ARM64" ;; \
        amd64) arch=x86_64; sum="$CFIRE_SHA256_AMD64" ;; \
        *) echo "no cfire archive for ${TARGETARCH:-?}" >&2; exit 1 ;; \
    esac \
    && name="cfire-v${CFIRE_VERSION}-linux-${arch}" \
    && mkdir /tmp/cfire && cd /tmp/cfire \
    && curl -fsSLO "https://github.com/gsandoval/cfire/releases/download/v${CFIRE_VERSION}/${name}.tar.gz" \
    && echo "${sum}  ${name}.tar.gz" | sha256sum -c - \
    && tar xzf "${name}.tar.gz" \
    && install -D -m 755 "${name}/cfire" /usr/local/bin/cfire \
    && mkdir -p /usr/local/share/cfire \
    && cp -R "${name}/runtime" /usr/local/share/cfire/runtime \
    && cd / && rm -rf /tmp/cfire \
    && cfire --version

# CFIRE-UPSTREAM: CF-087 (simdjson's single header in ~/.local, as scripts/linux/Dockerfile)
ARG SIMDJSON_VERSION=4.6.6
RUN mkdir -p /root/.local/include /root/.local/lib /tmp/sj && cd /tmp/sj \
    && curl -fsSLO "https://raw.githubusercontent.com/simdjson/simdjson/v${SIMDJSON_VERSION}/singleheader/simdjson.h" \
    && curl -fsSLO "https://raw.githubusercontent.com/simdjson/simdjson/v${SIMDJSON_VERSION}/singleheader/simdjson.cpp" \
    && clang++ -O2 -std=c++17 -c simdjson.cpp -o simdjson.o \
    && ar rcs /root/.local/lib/libsimdjson.a simdjson.o \
    && cp simdjson.h /root/.local/include/ \
    && rm -rf /tmp/sj
ENV CPLUS_INCLUDE_PATH=/root/.local/include LIBRARY_PATH=/root/.local/lib

WORKDIR /flint
COPY build.cf ./
COPY scripts/version.sh scripts/
COPY src src
# No .git in the context: the version comes from scripts/server-image.sh.
ARG FLINT_VERSION=0.0.0-dev
# The native shim's pkg-config folder (what scripts/env.sh sets on a workstation).
ENV FLINT_VERSION=$FLINT_VERSION PKG_CONFIG_PATH=/flint/src/adapters/pkgconfig/linux
RUN cfire build flint-vault-server \
    && install -D -m 755 build/flint-vault-server /out/flint-vault-server

FROM debian:trixie-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        libsodium23 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /data --shell /usr/sbin/nologin flint \
    && mkdir -p /data && chown flint:flint /data && chmod 700 /data
COPY --from=build /out/flint-vault-server /usr/local/bin/flint-vault-server
USER flint
ENV FLINT_VAULT_DATA=/data FLINT_VAULT_LISTEN=0.0.0.0:8787
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/flint-vault-server"]
CMD ["serve"]
