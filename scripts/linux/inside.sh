#!/usr/bin/env bash
# The unprivileged part of scripts/linux-check.sh, run as `flint` inside the
# container: build, tests, CLI end-to-end and the desktop app under Xvfb.
#
# FLINT_LINUX_STEPS picks the steps after the build (comma-separated: tests, cli, gui,
# serve, server, sync; default all; `repros` runs tools/cfire-repros/run.sh, only when named;
# `times` alone runs scripts/check-times.sh cold and warm instead of the build). FLINT_LINUX_SUITES narrows `tests` to some suites (space-separated
# paths, default src). FLINT_LINUX_REPEAT="<run> <N>" makes the `gui` step run one
# gui-e2e run N times with scripts/repeat.sh instead (CLAUDE.md rule 9).
set -euo pipefail
steps=",${FLINT_LINUX_STEPS:-tests,cli,gui,serve,server,sync},"
want() { [[ "$steps" == *",$1,"* ]]; }
# The working tree lives in linux-check.sh's cache volume (~/cache), with cfire's user
# cache beside it, so a run compiles only what changed since the last one. rsync
# mirrors /src into it, keeping each file's mtime (cfire compares an object's mtime
# with its source's), deleting what /src no longer has, and leaving the .cfire/ and
# build/ folders, which /src never sends. Exit 24 (a file vanished while copied: the
# editor writing into the tree) is not an error.
cache="$HOME/cache"
mkdir -p "$cache/work" "$cache/cfire"
export CFIRE_CACHE_DIR="$cache/cfire"
rc=0
rsync -a --delete --exclude=/site/node_modules --exclude=/ui/node_modules --exclude=/.git \
  --exclude=build/ --exclude=.cfire/ /src/ "$cache/work/" || rc=$?
[[ $rc == 0 || $rc == 24 ]] || { echo "inside.sh: rsync failed ($rc)" >&2; exit "$rc"; }
echo "== cache volume: $(du -sh "$cache" | cut -f1) ($(find "$cache/work" -type d -name .cfire | wc -l) .cfire folders)"
cd "$cache/work"
. scripts/env.sh
echo "== cfire $(cfire --version)"
# The cfire repros (milestone 78): before the build, and alone they skip it.
if want repros; then
echo "== cfire repros"
tools/cfire-repros/run.sh
[[ "$steps" == ",repros," ]] && exit 0
fi
# Check times (milestone 83, D-161): scripts/check-times.sh cold then warm, when named
# alone (FLINT_LINUX_STEPS=times); it builds what it times. The sections are printed and
# kept in the volume (~/cache/work/build/check-times).
if [[ "$steps" == ",times," ]]; then
echo "== check times, cold then warm"
dbus-run-session -- bash -c "printf flint-test | gnome-keyring-daemon --unlock --components=secrets >/dev/null && export PATH=\$PATH:/usr/sbin FLINT_TEST_PRIVATE_DBUS=1 && scripts/check-times.sh --cold --label docker; scripts/check-times.sh --label docker"
exit 0
fi
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
# A failure's whole log (with the app's stacks, FLINT_E2E_STACK) is kept in the volume:
#   docker run --rm -v flint-linux-cache:/c --entrypoint ls flint-linux-check /c/keep/repeat
rm -rf "$cache/keep/repeat" && mkdir -p "$cache/keep/repeat"
PATH="$PATH:/usr/sbin" FLINT_E2E_STACK=1 FLINT_REPEAT_KEEP="$cache/keep/repeat" scripts/repeat.sh $FLINT_LINUX_REPEAT
elif want gui; then
echo "== desktop app end-to-end under Xvfb"
PATH="$PATH:/usr/sbin" scripts/gui-e2e.sh | tee /tmp/gui-e2e.log
grep -q "^gui-e2e: pass" /tmp/gui-e2e.log
fi
# The CLI as a client of the running app, the app under Xvfb (scripts/serve-e2e.sh).
# On a private session bus, so a screensaver signal can be sent to the app safely.
if want serve; then
echo "== CLI through the running app under Xvfb (screensaver signals on a private bus)"
# The app's log and the commands' output stay in the cache volume for a look after the
# run (~/cache/keep/serve; scripts/linux-check.sh says how to read them).
# memory.log: the container's memory every 2 s, to tell an OOM kill (ROADMAP §5).
rm -rf "$cache/keep/serve" && mkdir -p "$cache/keep/serve"
(while sleep 2; do echo "$(date +%T) $(free -m | awk '/^Mem/{print "used", $3, "free", $4, "avail", $7}')"; done) > "$cache/keep/serve/memory.log" &
mem_pid=$!
dbus-run-session -- env FLINT_TEST_PRIVATE_DBUS=1 FLINT_E2E_KEEP="$cache/keep/serve" scripts/serve-e2e.sh | tee /tmp/serve-e2e.log
kill "$mem_pid" 2>/dev/null || true
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
