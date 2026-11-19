#!/usr/bin/env bash
# cfire's own behaviour on Windows, each probe tied to a W-NN of docs/cfire-windows.md.
# Natively in MSYS2 CLANG64 on the Windows test VM, with cfire's Windows release
# (windows/bin/env.sh). Started over SSH:
#
#   windows/run-probes.sh            # hello, platform files, core, W-14, W-18
#   FLINT_PROBE_WEBUI=1 windows/run-probes.sh   # also webui: needs the desktop session
#
# Exit status: 0 when every probe passed, 1 otherwise.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/bin/env.sh" || exit 2
out="$TMPDIR/flint-probes"
mkdir -p "$out"
cd "$here/probes"
fail=0
step() { echo "== $1"; }
bad() { echo "FAIL: $1"; fail=1; }

step "hello (W-02, W-04: an .exe that runs with no DLL beside it)"
(cd hello && cfire build -o "$out/hello.exe" main.cf >/dev/null) || bad "hello: build"
[[ "$("$out/hello.exe")" == *hello* ]] || bad "hello: output"
deps="$(objdump -p "$out/hello.exe" 2>/dev/null | sed -n 's/^\s*DLL Name: //p' | tr '\n' ' ')"
echo "imports: $deps"
[[ "$deps" != *"c++"* && "$deps" != *unwind* ]] || bad "hello links libc++/libunwind dynamically"

step "platform files (W-08: _unix.cf left out on Windows)"
(cd platform_files && cfire build -o "$out/p.exe" main.cf >/dev/null) || bad "platform files: build"
got="$("$out/p.exe")"; echo "$got"
[[ "$got" == "platform: windows" ]] || bad "platform files: $got"

step "core (W-03 cwd, W-05 binary stdout, W-11 UTF-8 args, CF-010)"
(cd argv_echo && cfire build -o "$out/argv_echo.exe" main.cf >/dev/null) || bad "argv_echo: build"
(cd core && ARGV_ECHO="$(cygpath -m "$out/argv_echo.exe")" cfire test core_test.cf 2>&1 | tee "$out/core.log" | grep -E '^--- |\((.*)tests') || true
grep -qE '^PASS \(' "$out/core.log" || bad "core: see $out/core.log"

step "AF_UNIX socket file (W-14: fs.exists sees a listening socket)"
# The test's header sits beside it; a lone test file has no build.cf for its Includes.
(cd unix_socket && CPLUS_INCLUDE_PATH="$(cygpath -m "$PWD")" cfire test unix_socket_test.cf 2>&1 | tee "$out/w14.log" | grep -E '^--- |\((.*)tests') || true
grep -qE '^PASS \(' "$out/w14.log" || bad "W-14: see $out/w14.log"

step "Windows macros as names (W-18, open on v0.12.2: far, near, small)"
# Still open: the build fails with "expected unqualified-id". A build that works means
# cfire fixed it, and Flint's workaround (`apart` in monitors_test.cf) can go.
if (cd win_macros && cfire build -o "$out/wm.exe" main.cf >"$out/w18.log" 2>&1); then
  echo "W-18: covered now; drop Flint's workaround"
else
  grep -q 'expected unqualified-id' "$out/w18.log" && echo "W-18: still open" || bad "W-18: see $out/w18.log"
fi

if [[ "${FLINT_PROBE_WEBUI:-}" == 1 ]]; then
  step "webui offscreen (W-06, W-10: no SDK, no WebView2Loader.dll)"
  (cd webui && cfire test webui_test.cf 2>&1 | tee "$out/webui.log" | grep -E '^--- |\((.*)tests') || true
  grep -qE '^PASS \(' "$out/webui.log" || bad "webui offscreen: see $out/webui.log"
  step "webui window (closes itself once the page saw the event)"
  (cd webui && cfire build -o "$out/webui_probe.exe" main.cf >/dev/null) || bad "webui: build"
  PROBE_AUTOQUIT=1 timeout 60 "$out/webui_probe.exe" || bad "webui window"
fi

[[ $fail == 0 ]] && echo "probes: all passed" || echo "probes: FAILED"
exit $fail
