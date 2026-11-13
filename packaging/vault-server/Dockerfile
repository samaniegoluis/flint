# flint-vault-server's image (milestone 42, D-092, D-097): the server built from this
# repo with cfire pinned to the commit Flint is built against, then copied alone into a
# slim Debian with libsodium, run as an unprivileged user over a volume at /data.
#
#   scripts/server-image.sh            # builds it (context: the repo root)
#   scripts/server-image.sh --push     # builds for amd64 and arm64 and pushes to GHCR
FROM debian:trixie AS build

ARG CFIRE_COMMIT=c5b1d4bd09f7b1b07a3f855a095389f5cd3df332
ARG SIMDJSON_VERSION=4.6.6

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git curl ca-certificates pkg-config libsodium-dev \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/gsandoval/cfire /opt/cfire-src \
    && cd /opt/cfire-src && git checkout "$CFIRE_COMMIT" \
    && make build CXX=clang++ -j4 \
    # CFIRE-UPSTREAM: CF-086 (install by hand, as scripts/linux/Dockerfile does)
    && install -D -m 755 cfire /usr/local/bin/cfire \
    && mkdir -p /usr/local/share/cfire/runtime /usr/local/share/cfire/pkg \
    && cp -R runtime/* /usr/local/share/cfire/runtime/ \
    && cp -R pkg/* /usr/local/share/cfire/pkg/ \
    && rm -rf /opt/cfire-src

# CFIRE-UPSTREAM: CF-087 (simdjson's single header in ~/.local, as scripts/linux/Dockerfile)
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
