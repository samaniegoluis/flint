#!/usr/bin/env bash
# Milestone 34's benchmark: the RDP tab against a real Windows host at 1920x1080, in
# each graphics mode, through the real app (gui-e2e's rdpbench run). For each mode it
# prints Start-menu latency, frames drawn and server updates per second under a
# whole-screen animation (Task view), bandwidth, decode time, and the CPU of the app,
# WebKit's content processes and WebKit's GPU process in each phase.
#
#   sec with FLINT_RDP_TEST_HOST FLINT_RDP_TEST_USER FLINT_RDP_TEST_PASSWORD -- scripts/rdp-bench.sh
#   FLINT_BENCH_MODES=pipeline/auto scripts/rdp-bench.sh # one mode (graphics/renderer)
#   FLINT_BENCH_MONITORS=1 …   full screen on this monitor (milestone 38's baseline)
#   FLINT_BENCH_MONITORS=2 …   full screen across two monitors: the desktop is the
#                              monitors' box, and the extra window's frames count too
#                              (needs two monitors; their windows take a Space each)
#
# Latency is from sending the Windows key (two RPCs, down and up) to the page drawing
# the first frame after it.
#
# Modes: `compatible/2d` is milestone 30's tab (bitmap updates, putImageData); `pipeline/2d`
# the graphics pipeline drawn in 2D; `pipeline/auto` the graphics pipeline drawn with WebGL
# (milestone 35: `auto/...` is Automatic, which picks by the link's round trip)
# on a real GPU. The input is harmless (the host may be someone's real session): the
# Windows key and Esc for the Start menu, Win+Tab and Esc for Task view. macOS: the
# app's window opens on screen; leave it alone until it ends.
#
# CPU is cumulative CPU time over each phase's wall time (100 % is one core). The
# content and GPU figures add the WebKit processes started after the benchmark began
# (those of other apps are left out); a WebKit app opened meanwhile would count.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
: "${FLINT_RDP_TEST_HOST:?needs FLINT_RDP_TEST_HOST, _USER and _PASSWORD (Infisical, /ai-agents)}"
export FLINT_BENCH_MODES="${FLINT_BENCH_MODES:-compatible/2d,pipeline/2d,pipeline/auto}"
out="$(mktemp -d "${TMPDIR:-/tmp}/flint-rdp-bench.XXXXXX")"
trap 'rm -rf "$out"' EXIT

# WebKit processes running before the app starts belong to other apps: left out.
others=" $(ps -A -o pid=,comm= | awk '/WebContent|WebKitWebProces|WebKit.GPU|WebKitGPUProcess/ {print $1}' | tr '\n' ' ') "
# CPU seconds of every process whose command matches $1 (ps's TIME is m:ss.cc).
cpu_of() {
  ps -A -o pid=,time=,comm= | awk -v pat="$1" -v others="$others" '$0 ~ pat && index(others, " " $1 " ") == 0 { n = split($2, t, ":"); s += (n == 3 ? t[1] * 3600 + t[2] * 60 + t[3] : t[1] * 60 + t[2]) } END { printf "%.2f", s + 0 }'
}
(
  while :; do
    printf '%s %s %s %s\n' "$(python3 -I -c 'import time; print(int(time.time()*1000))')" \
      "$(cpu_of 'Flint.app/Contents/MacOS/Flint$|build/gui/Flint$')" \
      "$(cpu_of 'WebContent|WebKitWebProces')" "$(cpu_of 'WebKit.GPU|WebKitGPUProcess')"
    sleep 0.5
  done
) >"$out/cpu.txt" &
sampler=$!

st=0
FLINT_E2E_ONLY=rdpbench FLINT_E2E_MAIN_MS="${FLINT_E2E_MAIN_MS:-420000}" scripts/gui-e2e.sh 2>&1 | tee "$out/run.log" | grep -E '^e2e:|bench:|ok   |FAIL' || st=$?
kill "$sampler" 2>/dev/null || true

python3 -I - "$out/run.log" "$out/cpu.txt" <<'PY'
import json, sys
runs = [json.loads(l.split("bench: ", 1)[1]) for l in open(sys.argv[1]) if "bench: {" in l]
cpu = [tuple(float(x) for x in l.split()) for l in open(sys.argv[2]) if len(l.split()) == 4]
def usage(a, b):
    w = [c for c in cpu if a <= c[0] <= b]
    if len(w) < 2: return "n/a"
    secs = (w[-1][0] - w[0][0]) / 1000
    app, web, gpu = ((w[-1][i] - w[0][i]) / secs * 100 for i in (1, 2, 3))
    return f"app {app:.0f} %, content {web:.0f} %, gpu {gpu:.0f} %"
for r in runs:
    a, i, l = r["animation"], r["idle"], r["latency"]
    print(f"\n== {r['mode']} · {r.get('monitors', 'window')} {r.get('size', '1920x1080')}: {r['pipeline']} {r['codec'] or ''} · drawn {r['renderer']} · h264 {r['h264']}")
    print(f"  Start menu    median {l['median']} ms, p95 {l['p95']} ms · CPU {usage(l['from'], l['to'])}")
    extra = f" + extra {a['extraFps']} fps" if a.get('extraFps') else ""
    print(f"  Task view     drawn {a['fps']} fps{extra}, server {a['updates']} updates/s, {a['kbps']} kbit/s, channel {a['channelMBps']} MB/s, decode {a['decodeMs']} ms · CPU {usage(a['from'], a['to'])}")
    print(f"  idle          drawn {i['fps']} fps, {i['kbps']} kbit/s · CPU {usage(i['from'], i['to'])}")
PY
exit "$st"
