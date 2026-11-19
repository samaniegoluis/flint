cd /c/flint-work/flint && . windows/bin/env.sh || exit 2
start=$(date +%s)
scripts/test.sh > $TMPDIR/test-all.log 2>&1; rc=$?
echo "rc=$rc in $(( $(date +%s) - start )) s"
grep -E '^(PASS|FAIL) \(|^--- FAIL|error building|test.sh:|release-test' $TMPDIR/test-all.log | head -60
