set -e
cd /c/flint-work/flint
git fetch -q origin cfire-0.12-windows
git checkout -q -- . && git checkout -q -B cfire-0.12-windows origin/cfire-0.12-windows
git status --short | head; git log --oneline -1
