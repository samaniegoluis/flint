cd /c/flint-work/flint && . windows/bin/env.sh || exit 2
# One of main's e2e scripts on the VM, from a script sent with windows/remote.sh:
#   cd /c/flint-work/flint && FLINT_VM_E2E=cli bash windows/vm/e2e.sh   # or server, sync
# The log is $TMPDIR/e2e-<name>.log, read with a second, short script. One run at a
# time, as test-all.sh (they share the test sshd's ports).
name=${FLINT_VM_E2E:?FLINT_VM_E2E=cli|server|sync}
log=$TMPDIR/e2e-$name.log
lock=$TMPDIR/test-all.lock
if ! mkdir "$lock" 2>/dev/null; then
  echo "e2e: a run is in progress ($(cat "$lock/info" 2>/dev/null)); not starting another" >&2
  exit 3
fi
echo "pid $$ since $(date +%T): e2e $name" > "$lock/info"
trap 'rm -rf "$lock"' EXIT
start=$(date +%s)
scripts/$name-e2e.sh > "$log" 2>&1; rc=$?
echo "rc=$rc in $(( $(date +%s) - start )) s, log $log"
echo "ok: $(grep -cE '^ok ' "$log")"
grep -E '^FAIL|failed|passed|checks' "$log" | head -60
exit $rc
