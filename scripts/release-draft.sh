#!/usr/bin/env bash
# The release workflow's steps that are not building (milestone 51, D-107, D-113). The
# workflow calls these and holds no logic of its own; a person runs them the same way,
# from a checkout, to redo any step by hand:
#
#   scripts/release-draft.sh guard <tag>         exit 1 unless <tag> is a release tag
#                                                (vX.Y.Z or vX.Y.Z-rc.N) whose commit is on
#                                                origin/main (D-107 (2))
#   scripts/release-draft.sh notes <tag>         the release's notes on stdout: the
#                                                version's section of CHANGELOG.md, or the
#                                                tag's message for a pre-release not in it
#   scripts/release-draft.sh draft <tag> <dir>   SHA256SUMS for every file in <dir>, then a
#                                                draft release on GitHub with them all (a
#                                                pre-release for -rc tags); a draft that
#                                                already exists gets the files replaced.
#                                                A release (not an -rc) also gets the
#                                                signed update manifest, manifest.json and
#                                                manifest.json.sig (milestone 52,
#                                                scripts/sign-manifest.sh), when
#                                                FLINT_UPDATE_SIGNING_KEY is set; without
#                                                it the release is never offered as an update
#
# `draft` needs the GitHub CLI (`gh`) signed in, or GH_TOKEN (the workflow's own token);
# it never publishes: the owner looks at the draft and publishes it. GH (default `gh`)
# names another program, for the tests. FLINT_RELEASE_MAIN (default origin/main) names
# the branch the guard checks against.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

die() { echo "release-draft: $*" >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
cmd="${1:-}"; tag="${2:-}"
[[ -n "$cmd" && -n "$tag" ]] || die "usage: release-draft.sh guard|notes <tag> | draft <tag> <dir>"
[[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)(-rc\.[0-9]+)?$ ]] || die "'$tag' is not vX.Y.Z or vX.Y.Z-rc.N"
version="${tag#v}"
base="${BASH_REMATCH[1]}"
pre="${BASH_REMATCH[2]}"

notes() {
  local section
  # The lines under "## <version> — <date>" up to the next version's heading.
  section="$(awk -v v="$version" '
    /^## / { if (on) exit; on = ($2 == v) ; next }
    on { print }' CHANGELOG.md)"
  if [[ -n "${section//[[:space:]]/}" ]]; then
    printf '%s\n' "$section" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
  elif [[ -n "$pre" ]]; then
    echo "A pre-release of Flint $base, to try the release packages; not for daily use."
    local msg
    msg="$(git tag -l --format='%(contents)' "$tag")"
    [[ -n "${msg//[[:space:]]/}" ]] && printf '\n%s\n' "$msg"
  else
    die "CHANGELOG.md has no section for $version (scripts/release.sh writes it)"
  fi
  cat <<'EOF'

---

The packages are not code-signed yet: the first launch needs one extra step, described in
[Install](https://github.com/samaniegoluis/flint/blob/main/site/src/content/docs/start/install.md). Check a download against `SHA256SUMS`.
EOF
}

case "$cmd" in
  guard)
    main="${FLINT_RELEASE_MAIN:-origin/main}"
    commit="$(git rev-parse -q --verify "refs/tags/$tag^{commit}")" || die "no tag $tag in this checkout"
    git rev-parse -q --verify "$main" >/dev/null || die "no $main in this checkout (fetch it first)"
    git merge-base --is-ancestor "$commit" "$main" \
      || die "$tag ($(git rev-parse --short "$commit")) is not on $main: releases are built from main only"
    echo "release-draft: $tag ($(git rev-parse --short "$commit")) is on $main"
    ;;
  notes)
    notes
    ;;
  draft)
    dir="${3:-}"
    [[ -d "$dir" ]] || die "draft needs the folder of packages"
    gh="${GH:-gh}"
    files=()
    rm -f "$dir/manifest.json" "$dir/manifest.json.sig"
    while IFS= read -r f; do files+=("$f"); done < <(find "$dir" -maxdepth 1 -type f ! -name SHA256SUMS | sort)
    [[ ${#files[@]} -gt 0 ]] || die "$dir holds no packages"
    # A test package (milestone 54, package.sh linux --test-feed) has a local feed and
    # its key compiled in: never a release (Principle 17).
    for f in "${files[@]}"; do
      [[ "$(basename "$f")" != *testfeed* ]] || die "$(basename "$f") is a test package (--test-feed): never released"
    done
    (cd "$dir" && for f in "${files[@]}"; do
       n="$(basename "$f")"
       printf '%s  %s\n' "$(sha256 "$n")" "$n"
     done) > "$dir/SHA256SUMS"
    # The update manifest (milestone 52): what Flint checks at launch and every hour,
    # reached at releases/latest/download/, so only once the owner publishes the draft.
    if [[ -z "$pre" && -n "${FLINT_UPDATE_SIGNING_KEY:-}" ]]; then
      scripts/sign-manifest.sh manifest "$tag" "$dir"
      scripts/sign-manifest.sh sign "$dir/manifest.json"
      files+=("$dir/manifest.json" "$dir/manifest.json.sig")
    elif [[ -z "$pre" ]]; then
      echo "release-draft: WARNING: FLINT_UPDATE_SIGNING_KEY is not set: no update manifest, so Flint will not offer $tag as an update" >&2
    fi
    notes_file="$(mktemp)"
    trap 'rm -f "$notes_file"' EXIT
    notes > "$notes_file"
    if "$gh" release view "$tag" --json isDraft -q .isDraft >/dev/null 2>&1; then
      [[ "$("$gh" release view "$tag" --json isDraft -q .isDraft)" == true ]] \
        || die "$tag is already published; a published release is never changed from here"
      "$gh" release upload "$tag" --clobber "${files[@]}" "$dir/SHA256SUMS"
      "$gh" release edit "$tag" --notes-file "$notes_file"
      echo "release-draft: draft $tag updated"
    else
      flags=(--draft --verify-tag --title "Flint $version" --notes-file "$notes_file")
      [[ -n "$pre" ]] && flags+=(--prerelease)
      "$gh" release create "$tag" "${flags[@]}" "${files[@]}" "$dir/SHA256SUMS"
      echo "release-draft: draft $tag created"
    fi
    cat "$dir/SHA256SUMS"
    ;;
  *) die "unknown step '$cmd' (guard, notes, draft)" ;;
esac
