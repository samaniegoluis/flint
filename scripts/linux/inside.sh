#!/usr/bin/env bash
# The unprivileged part of scripts/linux-check.sh, run as `flint` inside the
# container: build, tests, CLI end-to-end and the desktop app under Xvfb.
#
# FLINT_LINUX_STEPS picks the steps after the build (comma-separated: tests, cli, gui,
# serve; default all). FLINT_LINUX_SUITES narrows `tests` to some suites (space-separated
# paths, default src).
set -euo pipefail
steps=",${FLINT_LINUX_STEPS:-tests,cli,gui,serve},"
want() { [[ "$steps" == *",$1,"* ]]; }
cd "$HOME"
mkdir -p work
tar -C /src --exclude=./site/node_modules --exclude=./ui/node_modules --exclude=./.git --exclude="*/build" --exclude="*/.cfire" -cf - . | tar -C work -xf -
cd work
. scripts/env.sh
echo "== cfire $(cfire --version)"
echo "== build flint"
cfire build
./build/flint --version
./build/flint --version --json
echo "== libcrypto linked (expect one):"
ldd ./build/flint | grep -E "crypto|ssh|sodium|sqlcipher" || true
echo "== build the desktop app (page from ui/dist, built on the host)"
scripts/build-gui.sh
ldd ./build/gui/Flint | grep -E "crypto|ssh|sodium|sqlcipher|webkit" || true
# A Secret Service for the keychain adapter: gnome-keyring on a private D-Bus session.
with_keyring() {
  dbus-run-session -- bash -c "printf flint-test | gnome-keyring-daemon --unlock --components=secrets >/dev/null && $1"
}
# The bus is private, so the D-Bus screen-lock test may send signals on it.
if want tests; then
echo "== tests (keychain: gnome-keyring)"
with_keyring "PATH=\$PATH:/usr/sbin scripts/test.sh ${FLINT_LINUX_SUITES:-src}"
fi
# The CLI never reads the keychain (D-042): one run, with a keyring present to show
# it is not used.
if want cli; then
echo "== cli e2e"
with_keyring "scripts/cli-e2e.sh" | tee /tmp/e2e.log
grep -q "keychain cache: False" /tmp/e2e.log
fi
# The desktop app's end-to-end run opens the real GTK window under Xvfb
# (scripts/gui-e2e.sh).
if want gui; then
echo "== desktop app end-to-end under Xvfb"
PATH="$PATH:/usr/sbin" scripts/gui-e2e.sh | tee /tmp/gui-e2e.log
grep -q "^e2e: pass" /tmp/gui-e2e.log
fi
# The CLI as a client of the running app, the app under Xvfb (scripts/serve-e2e.sh).
# On a private session bus, so a screensaver signal can be sent to the app safely.
if want serve; then
echo "== CLI through the running app under Xvfb (screensaver signals on a private bus)"
dbus-run-session -- env FLINT_TEST_PRIVATE_DBUS=1 scripts/serve-e2e.sh | tee /tmp/serve-e2e.log
line="$(grep "^serve-e2e: " /tmp/serve-e2e.log | tail -1)"
[[ "$line" =~ ^serve-e2e:\ ([0-9]+)/([0-9]+)\ checks\ passed && "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]]
fi
echo "== steps run: ${FLINT_LINUX_STEPS:-all}"
