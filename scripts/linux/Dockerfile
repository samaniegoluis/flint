# Linux build check for Flint: Debian trixie, cfire pinned to the release Flint is
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
    && install -D -m 755 /build/server/Sample/sfreerdp-server /out/sfreerdp-server \
    && install -D -m 644 -t /out/share/sfreerdp-server /src/freerdp/server/Sample/test_icon.*

FROM debian:trixie

# cfire's published Linux archive (docs/cfire-migration.md, step 4), checked against the
# release's SHA256SUMS.txt and unpacked in install.sh's layout (bin/cfire,
# share/cfire/runtime) without its installer. TARGETARCH picks the archive: arm64 on an
# Apple silicon Mac's Docker, amd64 elsewhere.
ARG CFIRE_VERSION=0.12.2
ARG CFIRE_SHA256_ARM64=ce992d12fe688fbfcb9bc9fcf7c195a99315d200c3fe9be10b185e6cc61b35ca
ARG CFIRE_SHA256_AMD64=6fe582d6bf6a21a429b9212c28b8d01bf1a69bed9ee9216fa7afd6e7c1db7ffd
ARG TARGETARCH

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git curl ca-certificates pkg-config \
        libssh-dev libcurl4-openssl-dev libsodium-dev libsqlcipher-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev \
        freerdp3-dev \
        openssh-server openssh-client xvfb xauth \
        xserver-xorg-core xserver-xorg-video-dummy x11-xserver-utils \
        gnome-keyring dbus python3 perl sudo openssl \
        vim gdb \
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

COPY --from=rdp-sample /out/sfreerdp-server /usr/local/bin/sfreerdp-server
# 3.15's sample server ends every session in PostConnect when it finds no test_icon.* in
# its working folder (3.33 does not); scripts/test.sh copies it there.
COPY --from=rdp-sample /out/share/sfreerdp-server /usr/local/share/sfreerdp-server

RUN useradd --create-home --shell /bin/bash flint
# A password for the password and keyboard-interactive auth checks (linux-check.sh
# starts root sshds that accept it). Test-only: the image is never published.
RUN echo 'flint:flint-e2e-login-pw' | chpasswd
# `exec --sudo` (milestone 13) runs the real sudo here: the e2e user may use it, with
# its password (serve-e2e, FLINT_E2E_SUDO=1). Test-only, like the password above.
RUN echo 'flint ALL=(ALL) ALL' > /etc/sudoers.d/flint && chmod 440 /etc/sudoers.d/flint
USER flint
WORKDIR /home/flint

# iptables for the RDP adapter's quiet-network test (milestone 31): it drops the test
# server's packets, as a network that goes away, when the container has NET_ADMIN
# (FLINT_RDP_BLACKHOLE=1 scripts/linux-check.sh). rsync copies the tree into the cache
# volume (below). zip and unzip for the self-update (milestone 53: the package's zip and
# the adapter that unpacks it). Last, so the layers above stay cached.
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends iptables rsync zip unzip \
    && rm -rf /var/lib/apt/lists/*
USER flint
# The mount point of linux-check.sh's cache volume, owned by `flint` so a new volume
# starts with that owner: the working tree with its .cfire/ and build/ folders, and
# cfire's user cache (CFIRE_CACHE_DIR).
RUN mkdir -p /home/flint/cache
