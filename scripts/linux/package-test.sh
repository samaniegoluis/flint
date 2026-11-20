#!/usr/bin/env bash
# Installs, runs and removes Flint's Linux packages in clean containers (milestone 49):
# the .deb on Ubuntu 24.04 and Debian 13, the .rpm on Fedora 43, each with nothing but
# what the package manager pulls in from the package's own dependencies.
#
#   scripts/linux/package-test.sh                 # the packages of scripts/version.sh in dist/
#   scripts/linux/package-test.sh <package>...    # these files
#   FLINT_PACKAGE_BASES="debian:trixie" scripts/linux/package-test.sh dist/flint_*.deb
#
# In each container: the install, the files where they belong (/usr/bin/flint → the CLI
# in /usr/lib/flint, install-kind, the .desktop file valid, the icon, the polkit
# policy), every library found, `flint --version`, the app's window up under Xvfb with
# the WM_CLASS the .desktop file names, then the removal leaving none of it. Exit 1
# when a check fails.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
version="$(scripts/version.sh)"
pkgs=("$@")
if [[ ${#pkgs[@]} -eq 0 ]]; then
  pkgs=("dist/flint_${version}_amd64.deb" "dist/flint-${version}.x86_64.rpm")
fi

# The check inside the container: $1 = deb|rpm, the package at /pkg/<name>.
inside='
set -uo pipefail
fmt="$1" pkg="$2" want="$3"
fails=0
ok()   { echo "  ok   $*"; }
bad()  { echo "  FAIL $*"; fails=$((fails + 1)); }
check() { local what="$1"; shift; if "$@" >/tmp/check.out 2>&1; then ok "$what"; else bad "$what"; sed "s/^/       /" /tmp/check.out | tail -20; fi; }
. /etc/os-release
echo "== $PRETTY_NAME: $(basename "$pkg")"
if [[ "$fmt" == deb ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  check "installed with its dependencies" apt-get install -y -qq "$pkg"
  # The tools of the checks, after the install so they pull in nothing it needed.
  apt-get install -y -qq --no-install-recommends desktop-file-utils xvfb xauth x11-utils xdotool procps >/dev/null 2>&1
else
  check "installed with its dependencies" dnf -y -q install "$pkg"
  dnf -y -q install desktop-file-utils xorg-x11-server-Xvfb xorg-x11-xauth xprop xdotool procps-ng which >/dev/null 2>&1
fi
check "/usr/bin/flint is the CLI in /usr/lib/flint" test "$(readlink -f /usr/bin/flint)" = /usr/lib/flint/flint
check "the app, its page, CHANGELOG.md and the licence" test -x /usr/lib/flint/Flint -a -f /usr/lib/flint/ui/index.html -a -f /usr/lib/flint/CHANGELOG.md -a -f /usr/lib/flint/licenses/Flint-LICENSE
check "install-kind is package:$fmt" test "$(cat /usr/lib/flint/install-kind)" = "package:$fmt"
check "the .desktop file is valid" desktop-file-validate /usr/share/applications/dev.flint.app.desktop
check "the icon" test -s /usr/share/icons/hicolor/256x256/apps/dev.flint.app.png
check "the polkit policy" grep -q "dev.flint.approve" /usr/share/polkit-1/actions/dev.flint.policy
check "every library of the app and the CLI found" bash -c "! ldd /usr/lib/flint/Flint /usr/lib/flint/flint | grep -q \"not found\""
check "flint --version is $want" bash -c "flint --version | grep -qF \"$want\""
json_ok() { flint --version --json | grep -qF "\"flint\":\"$want\""; }
check "flint --version --json names $want" json_ok
# The app: a person of its own, a display, and its window by the class the .desktop
# file names (StartupWMClass), so the desktop puts the window under the icon.
useradd -m tester >/dev/null 2>&1
cat > /tmp/app.sh <<"EOF"
export HOME=/home/tester XDG_RUNTIME_DIR=/tmp/xdg-tester
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"
/usr/lib/flint/Flint >/tmp/app.log 2>&1 &
app=$!
wid=""
for _ in $(seq 1 60); do
  wid=$(xdotool search --onlyvisible --name "Flint" 2>/dev/null | head -1)
  [ -n "$wid" ] && break
  kill -0 $app 2>/dev/null || break
  sleep 0.5
done
if [ -z "$wid" ]; then echo "no window"; tail -20 /tmp/app.log; kill $app 2>/dev/null; exit 1; fi
class=$(xprop -id "$wid" WM_CLASS)
echo "$class"
sleep 2
kill -0 $app || { echo "the app quit"; tail -20 /tmp/app.log; exit 1; }
kill $app; wait $app 2>/dev/null
want_class=$(sed -n "s/^StartupWMClass=//p" /usr/share/applications/dev.flint.app.desktop)
echo "$class" | grep -q "\"$want_class\"" || { echo "WM_CLASS is not $want_class"; exit 1; }
EOF
chown tester /tmp/app.sh
check "the app opens its window under Xvfb, WM_CLASS as the .desktop file says" su tester -c "xvfb-run -a sh /tmp/app.sh"
if [[ "$fmt" == deb ]]; then
  check "removed" apt-get purge -y -qq flint
else
  check "removed" dnf -y -q remove flint
fi
check "nothing left in /usr/lib/flint, /usr/bin, applications, icons, polkit" bash -c "test ! -e /usr/lib/flint -a ! -e /usr/bin/flint -a ! -e /usr/share/applications/dev.flint.app.desktop -a ! -e /usr/share/icons/hicolor/256x256/apps/dev.flint.app.png -a ! -e /usr/share/polkit-1/actions/dev.flint.policy"
echo "== $PRETTY_NAME: $fails failed"
exit $((fails > 0))
'

total=0
for p in "${pkgs[@]}"; do
  [[ -f "$p" ]] || { echo "package-test: no $p (scripts/package.sh linux)" >&2; exit 1; }
  case "$p" in
    *.deb) fmt=deb; bases="${FLINT_PACKAGE_BASES:-ubuntu:24.04 debian:trixie}" ;;
    *.rpm) fmt=rpm; bases="${FLINT_PACKAGE_BASES:-fedora:43}" ;;
    *) echo "package-test: $p is neither a .deb nor an .rpm" >&2; exit 1 ;;
  esac
  abs="$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
  for base in $bases; do
    if ! docker run --rm --platform linux/amd64 -v "$abs:/pkg/$(basename "$p"):ro" "$base" \
        bash -c "$inside" _ "$fmt" "/pkg/$(basename "$p")" "$version"; then
      total=$((total + 1))
    fi
  done
done
if [[ $total -gt 0 ]]; then
  echo "package-test: $total container(s) failed" >&2
  exit 1
fi
echo "package-test: pass"
