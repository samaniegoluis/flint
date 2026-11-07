# Linux build check for Flint: Debian trixie, cfire pinned to the commit Flint is
# built against, and the native libraries from apt (D-015). vim is for gui-e2e's
# full-screen editor step.
#
#   scripts/linux-check.sh
#   FLINT_E2E_VIM=1 scripts/linux-check.sh   # also runs the vim step, which fails on Linux (ROADMAP)
FROM debian:trixie

ARG CFIRE_COMMIT=43431f25fdd3a110dc3a02390d847e061b77a593

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git curl ca-certificates pkg-config \
        libssh-dev libsodium-dev libsqlcipher-dev libargon2-dev libsimdjson-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev \
        openssh-server openssh-client xvfb xauth \
        gnome-keyring dbus python3 perl \
        vim \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/gsandoval/cfire /opt/cfire-src \
    && cd /opt/cfire-src && git checkout "$CFIRE_COMMIT" \
    && make build CXX=clang++ -j4 \
    # CFIRE-UPSTREAM: CF-086 — `make install` names its temp file with `$$` on three
    # recipe lines, each its own shell, so chmod misses the file cp wrote. Install by hand.
    && install -D -m 755 cfire /usr/local/bin/cfire \
    && mkdir -p /usr/local/share/cfire/runtime /usr/local/share/cfire/pkg \
    && cp -R runtime/* /usr/local/share/cfire/runtime/ \
    && cp -R pkg/* /usr/local/share/cfire/pkg/ \
    && rm -rf /opt/cfire-src

RUN useradd --create-home --shell /bin/bash flint
# A password for the password and keyboard-interactive auth checks (linux-check.sh
# starts root sshds that accept it). Test-only: the image is never published.
RUN echo 'flint:flint-e2e-login-pw' | chpasswd
USER flint
WORKDIR /home/flint

# CFIRE-UPSTREAM: CF-087 — cfire's simdjson check refuses every 1.x-3.x with clang >= 19,
# trixie's 3.12.3 included (which builds), unless ~/.local/include/simdjson.h exists.
# simdjson 4.6.6's single-header release in ~/.local, as on the Zorin box (CF-075).
ARG SIMDJSON_VERSION=4.6.6
RUN mkdir -p .local/include .local/lib /tmp/sj && cd /tmp/sj \
    && curl -fsSLO "https://raw.githubusercontent.com/simdjson/simdjson/v${SIMDJSON_VERSION}/singleheader/simdjson.h" \
    && curl -fsSLO "https://raw.githubusercontent.com/simdjson/simdjson/v${SIMDJSON_VERSION}/singleheader/simdjson.cpp" \
    && clang++ -O2 -std=c++17 -c simdjson.cpp -o simdjson.o \
    && ar rcs /home/flint/.local/lib/libsimdjson.a simdjson.o \
    && cp simdjson.h /home/flint/.local/include/ \
    && rm -rf /tmp/sj
ENV CPLUS_INCLUDE_PATH=/home/flint/.local/include LIBRARY_PATH=/home/flint/.local/lib
