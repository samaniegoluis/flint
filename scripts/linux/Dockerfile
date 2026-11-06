# Linux build check for Flint: Debian trixie, cfire pinned to the commit Flint is
# built against, and the native libraries from apt (D-015). vim is for gui-e2e's
# full-screen editor step.
#
#   scripts/linux-check.sh
#   FLINT_E2E_VIM=1 scripts/linux-check.sh   # also runs the vim step, which fails on Linux (ROADMAP)
FROM debian:trixie

ARG CFIRE_COMMIT=2d8613ddb2c9c249b60046d6211e6335d138d866

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git ca-certificates pkg-config \
        libssh-dev libsodium-dev libsqlcipher-dev libargon2-dev libsimdjson-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev \
        openssh-server openssh-client xvfb xauth \
        gnome-keyring dbus python3 perl \
        vim \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/gsandoval/cfire /opt/cfire-src \
    && cd /opt/cfire-src && git checkout "$CFIRE_COMMIT" \
    && make install PREFIX=/usr/local CXX=clang++ -j4 \
    && rm -rf /opt/cfire-src

RUN useradd --create-home --shell /bin/bash flint
# A password for the password and keyboard-interactive auth checks (linux-check.sh
# starts root sshds that accept it). Test-only: the image is never published.
RUN echo 'flint:flint-e2e-login-pw' | chpasswd
USER flint
WORKDIR /home/flint
