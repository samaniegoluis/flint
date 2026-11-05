# Linux build check for Flint: Debian trixie, cfire pinned to the commit Flint is
# built against, and the native libraries from apt (D-015).
#
#   scripts/linux-check.sh
FROM debian:trixie

ARG CFIRE_COMMIT=396381402699f8957bd9a304cb1092e3243be3bf

RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        clang make git ca-certificates pkg-config \
        libssh-dev libsodium-dev libsqlcipher-dev libsimdjson-dev libsecret-1-dev \
        libwebkit2gtk-4.1-dev libgtk-3-dev \
        openssh-server openssh-client xvfb xauth \
        gnome-keyring dbus python3 perl \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/gsandoval/cfire /opt/cfire-src \
    && cd /opt/cfire-src && git checkout "$CFIRE_COMMIT" \
    && make install PREFIX=/usr/local CXX=clang++ -j4 \
    && rm -rf /opt/cfire-src

# cfire builds its prelude PCH without -pthread, but webkitgtk's pkg-config flags add
# -pthread, and clang refuses the mismatch (CF-030). CFIRE_CXX is documented but not
# read, so a clang++ earlier on PATH drops -pthread; glibc >= 2.34 has threads in libc.
RUN printf '#!/bin/sh\nfor a do shift; [ "$a" = "-pthread" ] || set -- "$@" "$a"; done\nexec /usr/bin/clang++ "$@"\n' > /usr/local/bin/clang++ \
    && chmod 755 /usr/local/bin/clang++

RUN useradd --create-home --shell /bin/bash flint
USER flint
WORKDIR /home/flint
