cd /c/flint-work/flint && . windows/bin/env.sh || exit 2
start=$(date +%s)
cfire build > $TMPDIR/build-all.log 2>&1; rc=$?
echo "rc=$rc in $(( $(date +%s) - start )) s"
grep -E 'error:|warning: .*(icon|windres|WebView)|undefined symbol|✓ Built' $TMPDIR/build-all.log | head -40
ls -la build/*.exe build/gui/*.exe 2>/dev/null
