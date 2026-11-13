#!/usr/bin/env bash
# Cuts a release of Flint (milestone 32, D-077): the next version from the commits since
# the last release tag, CHANGELOG.md written again by git-cliff, a commit and the tag.
# The docs site's Releases page reads CHANGELOG.md when the site is built (D-078).
# It never pushes.
#
#   scripts/release.sh                           dry run: the next version and the section
#                                                CHANGELOG.md would get
#   scripts/release.sh --apply --summary "…"     writes CHANGELOG.md, commits
#                                                "chore(release): vX.Y.Z", tags vX.Y.Z
#   … --version 1.0.0                            a version given by hand instead
#   … --summary-file notes.md                    the summary from a file
#
# The version: a `feat` since the last tag bumps the minor (0.1.3 → 0.2.0), only `fix`es
# the patch (0.1.3 → 0.1.4); the first release is 0.1.0. Commits scoped to the site or
# the docs (`feat(site): …`) do not count and are not listed (D-078). The summary is a few lines for
# a person, shown above the version's list; it is kept as the annotated tag's message,
# so every later run writes the same changelog again. Needs git-cliff (brew install
# git-cliff). lean-build runs this at each milestone's close (CLAUDE.md).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

apply=0
version=""
summary=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=1 ;;
    --version) version="${2:?--version needs X.Y.Z}"; shift ;;
    --summary) summary="${2:?--summary needs a text}"; shift ;;
    --summary-file) summary="$(cat "${2:?--summary-file needs a path}")"; shift ;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "release: unknown option '$1' (see --help)" >&2; exit 2 ;;
  esac
  shift
done

command -v git-cliff >/dev/null || { echo "release: needs git-cliff (brew install git-cliff)" >&2; exit 1; }

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
range="${last:+$last..}HEAD"
changes="$(git log --format=%s "$range" | grep -E '^(feat|fix|perf)(\(|!|:)' | grep -cvE '^(feat|fix|perf)\((site|docs)\)' || true)"

if [[ "$changes" == 0 ]]; then
  # git-cliff writes no section for a release with nothing in it.
  echo "release: nothing to release: no feat or fix since ${last:-the first commit}" >&2
  exit 1
fi
if [[ -n "$version" ]]; then
  version="${version#v}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release: '$version' is not X.Y.Z" >&2; exit 2; }
  if git rev-parse -q --verify "refs/tags/v$version" >/dev/null; then
    echo "release: v$version already exists" >&2; exit 1
  fi
else
  errf="$(mktemp)"
  version="$(git-cliff --bumped-version 2>"$errf")" || { cat "$errf" >&2; rm -f "$errf"; echo "release: git-cliff could not work out the next version" >&2; exit 1; }
  rm -f "$errf"
  version="${version#v}"
fi
tag="v$version"

echo "release: ${last:-no release yet} → $tag ($changes feat/fix commits)"
if [[ "$apply" == 0 ]]; then
  echo "release: dry run; the section CHANGELOG.md would get:"
  echo
  git-cliff --unreleased --tag "$tag" --strip header ${summary:+--with-tag-message "$summary"} 2>/dev/null
  echo "release: run again with --apply --summary \"…\" to write it, commit and tag"
  exit 0
fi

[[ -n "$summary" ]] || { echo "release: --apply needs --summary or --summary-file (a few lines for a person)" >&2; exit 2; }
if [[ -n "$(git status --porcelain)" ]]; then
  echo "release: the working tree has changes; commit or stash them first" >&2
  exit 1
fi

git-cliff --tag "$tag" --with-tag-message "$summary" --output CHANGELOG.md 2>/dev/null
git add CHANGELOG.md
git commit -q -m "chore(release): $tag"
git tag -a "$tag" -m "$summary"
echo "release: $tag tagged on $(git rev-parse --short HEAD); not pushed:"
echo "  git push origin HEAD && git push origin $tag"
