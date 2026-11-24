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
#   scripts/release-draft.sh publish <tag>       checks the draft as it is on GitHub, then
#                                                publishes it (D-147): every file against
#                                                SHA256SUMS, and for a release the
#                                                manifest's signature against the committed
#                                                public key and its size and SHA-256 per
#                                                package; any failure leaves it a draft. A
#                                                release becomes Latest; an -rc stays a
#                                                pre-release
#
# `draft` and `publish` need the GitHub CLI (`gh`) signed in, or GH_TOKEN (the workflow's
# own token). `draft` never publishes; `publish` publishes only what it checked. GH (default `gh`)
# names another program, for the tests. FLINT_RELEASE_MAIN (default origin/main) names
# the branch the guard checks against.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

die() { echo "release-draft: $*" >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
cmd="${1:-}"; tag="${2:-}"
[[ -n "$cmd" && -n "$tag" ]] || die "usage: release-draft.sh guard|notes|publish <tag> | draft <tag> <dir>"
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
  publish)
    gh="${GH:-gh}"
    state="$("$gh" release view "$tag" --json isDraft -q .isDraft 2>/dev/null)" || die "no release $tag on GitHub: run draft first"
    if [[ "$state" != true ]]; then
      echo "release-draft: $tag is already published"
      exit 0
    fi
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    "$gh" release download "$tag" --dir "$work" >/dev/null || die "could not download $tag's files"
    [[ -f "$work/SHA256SUMS" ]] || die "$tag has no SHA256SUMS: left a draft"
    # Every file but SHA256SUMS and the manifest is in SHA256SUMS, and every line checks.
    listed="$(awk '{print $2}' "$work/SHA256SUMS" | sort)"
    present="$(cd "$work" && find . -maxdepth 1 -type f ! -name SHA256SUMS ! -name 'manifest.json*' | sed 's|^\./||' | sort)"
    [[ -n "$listed" && "$listed" == "$present" ]] || die "$tag's files and SHA256SUMS do not match: left a draft"
    while read -r want name; do
      [[ "$(sha256 "$work/$name")" == "$want" ]] || die "$name does not match SHA256SUMS: left a draft"
    done < "$work/SHA256SUMS"
    flags=(--draft=false)
    if [[ -z "$pre" ]]; then
      # A release is what Flint updates to: its manifest must verify and name these files.
      [[ -f "$work/manifest.json" && -f "$work/manifest.json.sig" ]] || die "$tag has no signed manifest (FLINT_UPDATE_SIGNING_KEY unset?): left a draft"
      scripts/sign-manifest.sh verify "$work/manifest.json" >/dev/null || die "$tag's manifest signature does not verify: left a draft"
      [[ "$(jq -r .version "$work/manifest.json")" == "$version" ]] || die "$tag's manifest is not for $version: left a draft"
      n_assets="$(jq '.assets | length' "$work/manifest.json")"
      [[ "$n_assets" -gt 0 ]] || die "$tag's manifest names no package: left a draft"
      while IFS=$'\t' read -r name size sha; do
        [[ -f "$work/$name" ]] || die "the manifest names $name, which $tag lacks: left a draft"
        [[ "$(sha256 "$work/$name")" == "$sha" ]] || die "$name does not match the manifest: left a draft"
        [[ "$(wc -c < "$work/$name" | tr -d ' ')" == "$size" ]] || die "$name's size does not match the manifest: left a draft"
      done < <(jq -r '.assets[] | [.name, (.size|tostring), .sha256] | @tsv' "$work/manifest.json")
      flags+=(--latest)
    fi
    "$gh" release edit "$tag" "${flags[@]}" >/dev/null
    echo "release-draft: $tag checked and published"
    ;;
  *) die "unknown step '$cmd' (guard, notes, draft, publish)" ;;
esac
