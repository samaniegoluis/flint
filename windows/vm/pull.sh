set -e
cd /c/flint-work/flint
git fetch -q origin cfire-0.12-windows
# Files copied in with remote.sh --put: dropped, so the branch's own versions check out.
# Ignored ones (build/, every .cfire/ cache) stay.
git checkout -q -- . && git clean -fdq
git checkout -q -B cfire-0.12-windows origin/cfire-0.12-windows
git status --short | head; git log --oneline -1
