#!/usr/bin/env bash
# Builds and tests Flint on Linux inside Docker (see scripts/linux/Dockerfile).
# Copies the working tree into the container, so nothing is written back.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
image="flint-linux-check"

docker build -t "$image" -f "$root/scripts/linux/Dockerfile" "$root/scripts/linux"
docker run --rm -v "$root:/src:ro" "$image" bash -euo pipefail -c '
  mkdir -p work
  tar -C /src --exclude=./site/node_modules --exclude=./.git --exclude="*/build" --exclude="*/.cfire" -cf - . | tar -C work -xf -
  cd work
  echo "== cfire $(cfire --version)"
  echo "== build flint"
  cfire build
  ./build/flint --version
  ./build/flint --version --json
  echo "== libcrypto linked (expect one):"
  ldd ./build/flint | grep -E "crypto|ssh|sodium|sqlcipher" || true
  echo "== build spike"
  (cd spike/pty-webui && cfire build)
  echo "== tests"
  PATH="$PATH:/usr/sbin" scripts/test.sh src
  # cfire run_webview_test is a no-op on Linux (CF-029), so the spike is checked by
  # running the real GTK window under Xvfb in self-test mode.
  echo "== spike under Xvfb"
  PATH="$PATH:/usr/sbin" FLINT_TEST_CMD="cd spike/pty-webui && FLINT_SPIKE_SELFTEST=1 timeout 60 xvfb-run -a ./build/flint-pty-spike" \
    scripts/test.sh | tee /tmp/spike.log
  grep -q "selftest: pass" /tmp/spike.log
'
