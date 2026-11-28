#!/usr/bin/env bash
# Times Flint's checks (milestone 83, D-161): every cfire test suite, a build of every
# binary, and every end-to-end run, so a change to the checks is compared with numbers.
# Prints a Markdown section for docs/check-times.md and keeps it in build/check-times/.
#
#   scripts/check-times.sh                      # warm: every suite, the build, every e2e run
#   scripts/check-times.sh --cold               # cold: the workspace's caches removed first
#   scripts/check-times.sh --only suites        # suites | build | e2e | gui (comma-separated)
#   scripts/check-times.sh --label docker       # the system's name in the section (default: uname)
#   scripts/check-times.sh --no-gui             # e2e without gui-e2e (its window takes the Mac's screen)
#   scripts/check-times.sh src/domain src/adapters/ssh   # these suites only
#
# Cold removes every .cfire/ folder of the workspace (each suite's objects and test
# cache, the root's header cache) and build/, as a fresh checkout has them; cfire's user
# cache (CFIRE_CACHE_DIR, ~/.cache) is kept unless --cold-user. Warm is the run after.
# Each suite runs as `cfire test --release --no-cache --json <suite>` (test.sh's flags,
# its test-result cache bypassed so the run is timed, not a cached pass), against the
# servers scripts/test.sh starts (each row also in build/check-times/<label>-<mode>.rows as it
# ends, kept if the run is stopped). Tests are counted from the JSON: own, and cfire's
# generated `[auto]` json round-trips. A failure is a row with its result, not a stop.
# gui-e2e runs each run alone (FLINT_E2E_ONLY), after one build of the app.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cold=0 cold_user=0 no_gui=0 only="suites,build,e2e,gui" label="" suites=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cold) cold=1; shift ;;
    --cold-user) cold=1; cold_user=1; shift ;;
    --only) only="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --no-gui) no_gui=1; shift ;;  # the same as leaving gui out of --only
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    -*) echo "check-times: unknown flag $1" >&2; exit 2 ;;
    *) suites+=("${1%/}"); shift ;;
  esac
done
want() { [[ ",$only," == *",$1,"* ]]; }

# Seconds with a tenth: GNU date (Linux, MSYS2) has %N, the Mac's has not (perl there).
now() {
  local t
  t="$(date +%s.%N 2>/dev/null || true)"
  case "$t" in *N*|'') perl -MTime::HiRes=time -e 'printf "%.1f", time' ;; *) printf '%s' "${t:0:14}" ;; esac
}
since() { awk -v a="$1" -v b="$(now)" 'BEGIN { printf "%.1f", b - a }'; }

# The servers of scripts/test.sh, once for the whole timing: re-run inside it.
if [[ -z "${FLINT_TEST_SSH_PORT:-}" ]]; then
  args=()
  [[ $cold == 1 ]] && args+=(--cold)
  [[ $cold_user == 1 ]] && args+=(--cold-user)
  [[ $no_gui == 1 ]] && args+=(--no-gui)
  args+=(--only "$only")
  [[ -n "$label" ]] && args+=(--label "$label")
  quoted="$(printf '%q ' "$root/scripts/check-times.sh" ${args[@]+"${args[@]}"} ${suites[@]+"${suites[@]}"})"
  FLINT_TEST_CMD="$quoted" exec "$root/scripts/test.sh"
fi
cd "$root"

[[ -n "$label" ]] || label="$(uname -s | tr '[:upper:]' '[:lower:]')"
mode=warm
[[ $cold == 1 ]] && mode=cold
outdir="$root/build/check-times"
work="$(mktemp -d "${TMPDIR:-/tmp}/flint-times.XXXXXX")"
trap 'rm -rf "$work"' EXIT

if [[ ${#suites[@]} -eq 0 ]]; then
  # The suites cfire test finds in src: each folder with a *_test.cf file or a test
  # block (scripts/test.sh runs them all as `cfire test --release src`).
  while IFS= read -r d; do suites+=("$d"); done < <(
    { find src -name '*_test.cf' -not -path '*/.cfire/*'
      grep -rl --include='*.cf' --exclude-dir=.cfire '^test "' src; } \
      | xargs -n1 dirname | sort -u)
fi

if [[ $cold == 1 ]]; then
  echo "check-times: cold: removing the workspace's .cfire/ folders and build/" >&2
  find "$root" -name .cfire -type d -prune -not -path '*/node_modules/*' -exec rm -rf {} +
  rm -rf "$root/build/flint" "$root/build/gui" "$root/build/flint-vault-server" "$root/build/flint-update-root"
  if [[ $cold_user == 1 && -n "${CFIRE_CACHE_DIR:-}" ]]; then rm -rf "$CFIRE_CACHE_DIR"; mkdir -p "$CFIRE_CACHE_DIR"; fi
fi

# The rows are written as each check ends, so a run stopped halfway keeps what it timed.
mkdir -p "$outdir"
rows="$outdir/$label-$mode.rows"
: >"$rows"
total_start="$(now)"

if want suites; then
  for s in "${suites[@]}"; do
    echo "check-times: suite $s" >&2
    t0="$(now)"
    st=pass
    cfire test --release --no-cache --json "$s" >"$work/out.json" 2>"$work/err.txt" || st=fail
    secs="$(since "$t0")"
    # `|| true`: grep finds no test in a suite that did not build, and pipefail would end the run.
    all="$( (grep -o '"name": "[^"]*"' "$work/out.json" || true) | wc -l | tr -d ' ')"
    auto="$( (grep -o '"name": "\[auto\][^"]*"' "$work/out.json" || true) | wc -l | tr -d ' ')"
    if [[ "$all" == 0 ]] && grep -q 'compilation failed\|error:' "$work/err.txt"; then st="did not build"; fi
    # A suite that failed keeps its output beside the rows, to be read.
    if [[ "$st" != pass ]]; then
      cp "$work/err.txt" "$outdir/$label-$mode-$(echo "$s" | tr / _).err"
      cp "$work/out.json" "$outdir/$label-$mode-$(echo "$s" | tr / _).json"
    fi
    objs="$( (find "$s/.cfire/obj" -name '*.o' 2>/dev/null || true) | wc -l | tr -d ' ')"
    printf 'suite\t%s\t%s\t%s\t%s\t%s\t%s\n' "$s" "$secs" "$st" "$((all - auto))" "$auto" "$objs" >>"$rows"
  done
fi

if want build; then
  echo "check-times: cfire build (every binary)" >&2
  t0="$(now)"; st=pass
  cfire build >"$work/build.txt" 2>&1 || st=fail
  printf 'build\tcfire build\t%s\t%s\t\t\t\n' "$(since "$t0")" "$st" >>"$rows"
  t0="$(now)"; st=pass
  scripts/build-gui.sh >"$work/build-gui.txt" 2>&1 || st=fail
  printf 'build\tscripts/build-gui.sh\t%s\t%s\t\t\t\n' "$(since "$t0")" "$st" >>"$rows"
fi

if want e2e; then
  for e in cli-e2e serve-e2e server-e2e sync-e2e; do
    echo "check-times: $e" >&2
    t0="$(now)"; st=pass
    "scripts/$e.sh" >"$work/$e.txt" 2>&1 || { st=fail; cp "$work/$e.txt" "$outdir/$label-$mode-$e.log"; }
    printf 'e2e\t%s\t%s\t%s\t\t\t\n' "$e" "$(since "$t0")" "$st" >>"$rows"
  done
  :
fi
if want gui; then
  [[ $no_gui == 1 ]] && gui_skip=1 || gui_skip=0
  # gui-e2e's runs, from its own list (`runs=(...)` and the `known` extras it skips).
  if [[ $gui_skip == 0 ]]; then
  # Built here every time, not only when missing: an app older than HEAD carries an older
  # version than the one the vault, update and selfupdate runs read from git.
  scripts/build-gui.sh >/dev/null
  gui_runs="$(FLINT_E2E_ONLY=__list__ FLINT_E2E_NOBUILD=1 scripts/gui-e2e.sh 2>&1 | sed -n 's/.*FLINT_E2E_ONLY takes \(.*\), not.*/\1/p' | tr ' ' '\n' | grep -v -e '^multimon$' -e '^rdpbench$' || true)"
  for r in $gui_runs; do
    echo "check-times: gui-e2e $r" >&2
    t0="$(now)"; st=pass
    FLINT_E2E_ONLY="$r" FLINT_E2E_NOBUILD=1 scripts/gui-e2e.sh >"$work/gui-$r.txt" 2>&1 || { st=fail; cp "$work/gui-$r.txt" "$outdir/$label-$mode-gui-$r.log"; }
    printf 'e2e\tgui-e2e %s\t%s\t%s\t\t\t\n' "$r" "$(since "$t0")" "$st" >>"$rows"
  done
  fi
fi

total="$(since "$total_start")"
section="$outdir/$label-$mode.md"
{
  echo "### $label, $mode ($(date -u +%Y-%m-%d), $(git rev-parse --short HEAD), $(cfire --version 2>&1 | head -1 | awk '{print $1, $2}'))"
  echo
  echo "$(uname -sm), $(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc) cores. Total $total s."
  echo
  echo "| Kind | Check | Seconds | Result | Own tests | \`[auto]\` | Objects |"
  echo "|---|---|--:|---|--:|--:|--:|"
  while IFS=$'\t' read -r kind name secs st own auto objs; do
    echo "| $kind | \`$name\` | $secs | $st | $own | $auto | $objs |"
  done <"$rows"
  if want suites; then
    awk -F'\t' '$1=="suite"{s+=$3; o+=$5; a+=$6; b+=$7} END{printf "| suites | **all %d** | %.1f | | %d | %d | %d |\n", NR, s, o, a, b}' \
      <(grep '^suite' "$rows")
  fi
} >"$section"
cat "$section"
echo "check-times: kept in $section" >&2
