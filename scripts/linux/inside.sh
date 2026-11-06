#!/usr/bin/env bash
# The unprivileged part of scripts/linux-check.sh, run as `flint` inside the
# container: build, tests, CLI end-to-end and the desktop app under Xvfb.
set -euo pipefail
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
echo "== tests (keychain: gnome-keyring; screensaver signals on the private bus)"
with_keyring "PATH=\$PATH:/usr/sbin FLINT_TEST_PRIVATE_DBUS=1 scripts/test.sh src"
# The CLI never reads the keychain (D-042): one run, with a keyring present to show
# it is not used.
echo "== cli e2e"
with_keyring "scripts/cli-e2e.sh" | tee /tmp/e2e.log
grep -q "keychain cache: False" /tmp/e2e.log
# The desktop app's end-to-end run opens the real GTK window under Xvfb
# (scripts/gui-e2e.sh).
echo "== desktop app end-to-end under Xvfb"
PATH="$PATH:/usr/sbin" scripts/gui-e2e.sh | tee /tmp/gui-e2e.log
grep -q "^e2e: pass" /tmp/gui-e2e.log
# The CLI as a client of the running app, the app under Xvfb (scripts/serve-e2e.sh).
echo "== CLI through the running app under Xvfb"
scripts/serve-e2e.sh | tee /tmp/serve-e2e.log
grep -q "^serve-e2e: .* checks passed" /tmp/serve-e2e.log
