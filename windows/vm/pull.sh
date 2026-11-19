set -e
# The VM's clone onto the pushed branch: main unless FLINT_VM_BRANCH names another.
BRANCH=${FLINT_VM_BRANCH:-main}
cd /c/flint-work/flint
# Tags too: scripts/version.sh names the build after the last one (git describe).
git fetch -q --tags origin "$BRANCH"
# Files copied in with remote.sh --put: dropped, so the branch's own versions check out.
# Ignored ones (build/, every .cfire/ cache) stay.
git checkout -q -- . && git clean -fdq
git checkout -q -B "$BRANCH" "origin/$BRANCH"
git status --short | head; git log --oneline -1
