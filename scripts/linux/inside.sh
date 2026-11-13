#!/usr/bin/env bash
# The unprivileged part of scripts/linux-check.sh, run as `flint` inside the
# container: build, tests, CLI end-to-end and the desktop app under Xvfb.
#
# FLINT_LINUX_STEPS picks the steps after the build (comma-separated: tests, cli, gui,
# serve, server; default all). FLINT_LINUX_SUITES narrows `tests` to some suites (space-separated
# paths, default src). FLINT_LINUX_REPEAT="<run> <N>" makes the `gui` step run one
# gui-e2e run N times with scripts/repeat.sh instead (CLAUDE.md rule 9).
set -euo pipefail
steps=",${FLINT_LINUX_STEPS:-tests,cli,gui,serve,server,sync},"
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
echo "== flint-vault-server links libsodium alone (milestone 42)"
ldd ./build/flint-vault-server
! ldd ./build/flint-vault-server | grep -q -E "ssh|sqlcipher|freerdp|webkit|secret"
echo "== FreeRDP: only the desktop app links it (expect none in flint)"
! ldd ./build/flint | grep -q freerdp
ldd ./build/gui/Flint | grep -E "freerdp|winpr" || true
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
if want gui && [[ -n "${FLINT_LINUX_REPEAT:-}" ]]; then
echo "== one desktop run repeated under Xvfb: $FLINT_LINUX_REPEAT"
# shellcheck disable=SC2086
PATH="$PATH:/usr/sbin" scripts/repeat.sh $FLINT_LINUX_REPEAT
elif want gui; then
echo "== desktop app end-to-end under Xvfb"
PATH="$PATH:/usr/sbin" scripts/gui-e2e.sh | tee /tmp/gui-e2e.log
grep -q "^gui-e2e: pass" /tmp/gui-e2e.log
fi
# The CLI as a client of the running app, the app under Xvfb (scripts/serve-e2e.sh).
# On a private session bus, so a screensaver signal can be sent to the app safely.
if want serve; then
echo "== CLI through the running app under Xvfb (screensaver signals on a private bus)"
dbus-run-session -- env FLINT_TEST_PRIVATE_DBUS=1 scripts/serve-e2e.sh | tee /tmp/serve-e2e.log
line="$(grep "^serve-e2e: " /tmp/serve-e2e.log | tail -1)"
[[ "$line" =~ ^serve-e2e:\ ([0-9]+)/([0-9]+)\ checks\ passed && "${BASH_REMATCH[1]}" == "${BASH_REMATCH[2]}" ]]
fi
# The remote vault server, the real binary on loopback (scripts/server-e2e.sh).
if want server; then
echo "== vault server end-to-end"
FLINT_SERVER_BIN=./build/flint-vault-server scripts/server-e2e.sh | tee /tmp/server-e2e.log
grep -q "^server-e2e: [0-9]* passed, 0 failed" /tmp/server-e2e.log
fi
# The remote vault from the CLI and the app's sync loop (milestone 43): the server on
# loopback, two config folders as two machines, tokens in gnome-keyring, the app
# under Xvfb.
if want sync; then
echo "== remote vault sync end-to-end"
with_keyring "scripts/sync-e2e.sh" | tee /tmp/sync-e2e.log
grep -q "^sync-e2e: [0-9]* passed, 0 failed" /tmp/sync-e2e.log
fi
echo "== steps run: ${FLINT_LINUX_STEPS:-all}"
