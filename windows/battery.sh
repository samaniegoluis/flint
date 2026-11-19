#!/usr/bin/env bash
# Flint's checks on the Windows test VM, natively in MSYS2 CLANG64, in one command: a
# line per step, a summary and an exit code (0 only when every step run passed).
# Started from the Mac, which only sends it (the VM's clone is on the pushed branch:
# windows/remote.sh windows/vm/pull.sh first):
#
#   windows/remote.sh windows/battery.sh
#
# On the VM, with FLINT_WIN_STEPS=<comma-separated steps> to run some only:
#   probes   windows/run-probes.sh (cfire's own behaviour, the W-NN probes)
#   build    cfire build: flint.exe, gui\Flint.exe, flint-vault-server.exe
#   tests    scripts/test.sh, every suite
#   cli      scripts/cli-e2e.sh
#   server   scripts/server-e2e.sh
#   sync     scripts/sync-e2e.sh: needs Credential Manager, which an SSH key logon
#            does not get, so it runs from the desktop session; left out by default
#
# gui-e2e and serve-e2e wait for the VM's desktop session (autologon). Each step's log
# is in $TMPDIR/battery/<step>.log. One run at a time (the test sshd's ports): the
# lock is test-all.sh's.
repo="${FLINT_WIN_REPO:-/c/flint-work/flint}"
cd "$repo" && . windows/bin/env.sh || exit 2
steps=",${FLINT_WIN_STEPS:-probes,build,tests,cli,server},"
logs="$TMPDIR/battery"
mkdir -p "$logs"
lock="$TMPDIR/test-all.lock"
if ! mkdir "$lock" 2>/dev/null; then
  echo "battery: a run is in progress ($(cat "$lock/info" 2>/dev/null)); not starting another" >&2
  exit 3
fi
echo "pid $$ since $(date +%T): battery ${steps//,/ }" > "$lock/info"
trap 'rm -rf "$lock"' EXIT

summary=()
failed=0
# step <name> <command...>: runs it with its log, then <name>_result reads the log.
step() {
  local name=$1; shift
  [[ "$steps" == *",$name,"* ]] || return 0
  local log="$logs/$name.log" start=$SECONDS rc
  echo "== $name"
  "$@" >"$log" 2>&1; rc=$?
  local result; result="$("${name}_result" "$log")"
  [[ $rc == 0 ]] || failed=1
  summary+=("$(printf '%-7s %-4s %5s s  %s' "$name" "$([[ $rc == 0 ]] && echo ok || echo FAIL)" $((SECONDS - start)) "$result")")
  echo "${summary[-1]}"
}
probes_result() { grep -E '^probes:|^W-1[0-9]:|^FAIL' "$1" | tr '\n' ' '; }
build_result()  { grep -cE '✓ Built' "$1" | sed 's/$/ targets built/'; grep -m3 -E 'error:' "$1" | tr '\n' ' '; }
tests_result()  {
  echo "$(grep -cE '^PASS \(' "$1") suites passed, $(grep -cE '^FAIL \(' "$1") failed, $(grep -cE '^--- SKIP|^SKIP:' "$1") skips"
  grep -E '^--- FAIL' "$1" | cut -c1-140 | head -5
}
cli_result()    { grep -E '^cli-e2e:' "$1"; grep -cE '^skip ' "$1" | sed 's/$/ skipped/'; grep -E '^FAIL' "$1" | head -5; }
server_result() { grep -E '^server-e2e:' "$1"; grep -E '^FAIL' "$1" | head -5; }
sync_result()   { grep -E '^sync-e2e:' "$1"; grep -E '^FAIL' "$1" | head -5; }

echo "battery on $(git log --oneline -1), cfire $(cfire --version 2>&1 | head -1)"
step probes bash windows/run-probes.sh
step build  cfire build
step tests  scripts/test.sh
step cli    scripts/cli-e2e.sh
step server scripts/server-e2e.sh
step sync   scripts/sync-e2e.sh

echo
echo "== summary (logs in $(cygpath -w "$logs"))"
printf '%s\n' "${summary[@]}"
echo "waiting for the desktop session: gui-e2e, serve-e2e$([[ "$steps" == *",sync,"* ]] || echo ", sync-e2e")"
[[ $failed == 0 ]] && echo "battery: every step passed" || echo "battery: FAILED"
exit $failed
