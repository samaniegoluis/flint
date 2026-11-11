# Linux build check for Flint: Debian trixie, cfire pinned to the commit Flint is
# built against, and the native libraries from apt (D-015). vim is for gui-e2e's
# full-screen editor step.
#
#   scripts/linux-check.sh
#   FLINT_E2E_VIM=1 scripts/linux-check.sh   # also runs the vim step, which fails on Linux (ROADMAP)
# FreeRDP's sample server for the RDP tests (milestone 30, D-072): Debian ships no
# sample server, so it is built here from FreeRDP's own tag, statically linked against
# its libraries, and only the binary is copied into the image.
FROM debian:trixie AS rdp-sample
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        git ca-certificates cmake ninja-build gcc g++ pkg-config libssl-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 3.15.0 https://github.com/FreeRDP/FreeRDP /src/freerdp
RUN cmake -S /src/freerdp -B /build -G Ninja -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
        -DWITH_SERVER=ON -DWITH_SAMPLE=ON -DWITH_CLIENT=OFF -DWITH_SHADOW=OFF -DWITH_PROXY=OFF \
        -DWITH_X11=OFF -DWITH_WAYLAND=OFF -DWITH_FFMPEG=OFF -DWITH_SWSCALE=OFF -DWITH_DSP_FFMPEG=OFF \
        -DWITH_CUPS=OFF -DWITH_PULSE=OFF -DWITH_ALSA=OFF -DWITH_OSS=OFF -DWITH_FUSE=OFF -DWITH_KRB5=OFF \
        -DWITH_PCSC=OFF -DWITH_SMARTCARD_INSPECT=OFF -DCHANNEL_URBDRC=OFF -DWITH_JSON_DISABLED=ON \
        -DWITH_CJSON_REQUIRED=OFF -DWITH_MANPAGES=OFF -DWITH_SDL_IMAGE_DIALOGS=OFF -DWITH_CLIENT_SDL=OFF \
        -DWITH_WINPR_TOOLS=OFF -DWITH_FAAD2=OFF -DWITH_FAAC=OFF -DWITH_SOXR=OFF -DWITH_OPUS=OFF \
        -DWITH_LAME=OFF -DWITH_OPENH264=OFF -DWITH_LIBSYSTEMD=OFF -DWITH_UNICODE_BUILTIN=ON -DWITH_ICU=OFF \
        -DWITH_SWSCALE=OFF -DWITH_WEBVIEW=OFF -DWITH_AAD=OFF -DWITH_CAIRO=OFF -DWITH_JPEG=OFF \
    && cmake --build /build --target sfreerdp-server \
    && install -D -m 755 /build/server/Sample/sfreerdp-server /out/sfreerdp-server

FROM debian:trixie

ARG CFIRE_COMMIT=c5b1d4bd09f7b1b07a3f855a095389f5cd3df332

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git curl ca-certificates pkg-config \
        libssh-dev libsodium-dev libsqlcipher-dev libsimdjson-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev \
        freerdp3-dev \
        openssh-server openssh-client xvfb xauth \
        gnome-keyring dbus python3 perl sudo openssl \
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

COPY --from=rdp-sample /out/sfreerdp-server /usr/local/bin/sfreerdp-server

RUN useradd --create-home --shell /bin/bash flint
# A password for the password and keyboard-interactive auth checks (linux-check.sh
# starts root sshds that accept it). Test-only: the image is never published.
RUN echo 'flint:flint-e2e-login-pw' | chpasswd
# `exec --sudo` (milestone 13) runs the real sudo here: the e2e user may use it, with
# its password (serve-e2e, FLINT_E2E_SUDO=1). Test-only, like the password above.
RUN echo 'flint ALL=(ALL) ALL' > /etc/sudoers.d/flint && chmod 440 /etc/sudoers.d/flint
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
