#!/usr/bin/env bash
# The unprivileged part of scripts/linux-check.sh, run as `flint` inside the
# container: build, tests, CLI end-to-end and the spike.
set -euo pipefail
cd "$HOME"
mkdir -p work
tar -C /src --exclude=./site/node_modules --exclude=./.git --exclude="*/build" --exclude="*/.cfire" -cf - . | tar -C work -xf -
cd work
. scripts/env.sh
echo "== cfire $(cfire --version)"
echo "== build flint"
cfire build
./build/flint --version
./build/flint --version --json
echo "== libcrypto linked (expect one):"
ldd ./build/flint | grep -E "crypto|ssh|sodium|sqlcipher" || true
echo "== build spike"
(cd spike/pty-webui && cfire build)
# A Secret Service for the keychain adapter: gnome-keyring on a private D-Bus session.
with_keyring() {
  dbus-run-session -- bash -c "printf flint-test | gnome-keyring-daemon --unlock --components=secrets >/dev/null && $1"
}
echo "== tests (keychain: gnome-keyring)"
with_keyring "PATH=\$PATH:/usr/sbin scripts/test.sh src"
echo "== cli e2e (keychain: gnome-keyring)"
with_keyring "scripts/cli-e2e.sh" | tee /tmp/e2e-keyring.log
grep -q "keychain cache: True" /tmp/e2e-keyring.log
echo "== cli e2e (no Secret Service: every command takes the master password)"
scripts/cli-e2e.sh | tee /tmp/e2e-none.log
grep -q "keychain cache: False" /tmp/e2e-none.log
# cfire run_webview_test is a no-op on Linux (CF-029), so the spike is checked by
# running the real GTK window under Xvfb in self-test mode.
echo "== spike under Xvfb"
PATH="$PATH:/usr/sbin" FLINT_TEST_CMD="cd spike/pty-webui && FLINT_SPIKE_SELFTEST=1 timeout 60 xvfb-run -a ./build/flint-pty-spike" \
  scripts/test.sh | tee /tmp/spike.log
grep -q "selftest: pass" /tmp/spike.log
