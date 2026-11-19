cd /c/flint-work/flint && . windows/bin/env.sh || exit 2
# scripts/test.sh on the VM, its log in $TMPDIR/test-all.log (or test-<name>.log with
# FLINT_VM_LOG=<name>). Suites as arguments (src/adapters/serverfs), every suite without.
# One run at a time: a second one would truncate the first's log and find its sshd's port.
log=$TMPDIR/test-${FLINT_VM_LOG:-all}.log
lock=$TMPDIR/test-all.lock
if ! mkdir "$lock" 2>/dev/null; then
  echo "test-all: a run is in progress ($(cat "$lock/info" 2>/dev/null)); not starting another" >&2
  exit 3
fi
echo "pid $$ since $(date +%T): ${*:-all}" > "$lock/info"
trap 'rm -rf "$lock"' EXIT
start=$(date +%s)
scripts/test.sh "$@" > "$log" 2>&1; rc=$?
echo "rc=$rc in $(( $(date +%s) - start )) s, log $log"
grep -E '^(PASS|FAIL) \(|^--- FAIL|error building|test.sh:|release-test' "$log" | head -60
exit $rc
