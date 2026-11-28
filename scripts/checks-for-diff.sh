#!/usr/bin/env bash
# Prints the checks a diff needs (milestone 85, D-161; CLAUDE.md rule 11): reads
# `git diff <base>...HEAD` plus the working tree's changes and names, per system, the
# suites, builds, e2e runs and site checks the changed lines can reach, each with the
# file that asked for it. The logic is scripts/checks-for-diff.mjs; docs/checks.md says
# how it decides.
#
#   scripts/checks-for-diff.sh                 # against main (its merge base)
#   scripts/checks-for-diff.sh v0.39.0         # against another base
#   scripts/checks-for-diff.sh A --head B      # a committed range only: A...B, no working tree
#   scripts/checks-for-diff.sh --json          # the same as JSON
#   scripts/checks-for-diff.sh --why           # every reason, not the first three
#   scripts/checks-for-diff.sh --self-test     # fixed diffs in a scratch repository
#
# Exit status: 0 printed, 1 a self-test case failed, 2 a usage or git error.
set -euo pipefail
command -v node >/dev/null || { echo "checks-for-diff: needs node" >&2; exit 2; }
exec node "$(cd "$(dirname "$0")" && pwd)/checks-for-diff.mjs" "$@"
