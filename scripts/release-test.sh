#!/usr/bin/env bash
# Tests scripts/release.sh and cliff.toml on a throwaway repository (milestone 32): the
# version bump, what the changelog keeps and leaves out, the summary, the tag, and the
# refusals. Run by scripts/test.sh; needs git-cliff.
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
command -v git-cliff >/dev/null || { echo "release-test: skip (no git-cliff; brew install git-cliff)"; exit 0; }

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
mkdir -p "$repo/scripts"
cp "$root/scripts/release.sh" "$repo/scripts/"
cp "$root/cliff.toml" "$repo/"
cd "$repo"
git init -q -b main
git config user.name "Release Test"; git config user.email "release-test@example.invalid"
git config tag.gpgSign false; git config commit.gpgSign false

checks=0; failures=0
check() {
  checks=$((checks + 1))
  if eval "$2"; then echo "ok    $1"; else failures=$((failures + 1)); echo "FAIL  $1"; fi
}
commit() { echo "$RANDOM" >> f; git add -A; git commit -q -m "$1"; }
release() { out="$(scripts/release.sh "$@" 2>&1)"; rc=$?; }

git add -A; git commit -q -m "chore: start"
commit "feat(vault): open a vault"
commit "fix(ssh): reconnect after sleep"
commit "docs: the guide"
commit "test: more checks"
commit "a commit that is not conventional"
git tag demo-2026-01-01

release
check "the first release is 0.1.0" '[[ $rc == 0 && "$out" == *"→ v0.1.0"* ]]'
check "the dry run shows the section" '[[ "$out" == *"### Added"* && "$out" == *"Open a vault"* ]]'
check "a dry run tags nothing" '[[ -z "$(git tag -l "v*")" ]]'
release --apply
check "--apply needs a summary" '[[ $rc == 2 ]]'
echo dirt > dirty; release --apply --summary "x"
check "a dirty tree is refused" '[[ $rc == 1 && "$out" == *"working tree has changes"* ]]'
rm dirty

release --apply --summary "The first one: vaults and SSH."
check "--apply tags v0.1.0" '[[ $rc == 0 && "$(git tag -l "v*")" == "v0.1.0" ]]'
check "the tag carries the summary" '[[ "$(git tag -l --format="%(contents)" v0.1.0)" == *"The first one: vaults and SSH."* ]]'
check "the release commit is the tagged one" '[[ "$(git rev-parse v0.1.0^{commit})" == "$(git rev-parse HEAD)" && "$(git log -1 --format=%s)" == "chore(release): v0.1.0" ]]'
cl="$(cat CHANGELOG.md)"
check "the changelog has the version and the summary" '[[ "$cl" == *"## 0.1.0 — "* && "$cl" == *"The first one: vaults and SSH."* ]]'
check "features and fixes are listed, with their scope" '[[ "$cl" == *"**vault:** Open a vault"* && "$cl" == *"### Fixed"* && "$cl" == *"**ssh:** Reconnect after sleep"* ]]'
check "the changelog is in the release commit" '[[ -z "$(git status --porcelain)" ]]'
check "docs, tests, chores and other commits are left out" '[[ "$cl" != *"The guide"* && "$cl" != *"More checks"* && "$cl" != *"not conventional"* && "$cl" != *"Start"* ]]'

release
check "nothing new is nothing to release" '[[ $rc == 1 && "$out" == *"nothing to release"* ]]'
commit "docs: only docs"
release
check "docs alone are nothing to release" '[[ $rc == 1 ]]'
commit "feat(site): a releases page"
commit "fix(docs): a broken link"
release
check "the site and the docs alone are nothing to release (D-078)" '[[ $rc == 1 && "$out" == *"nothing to release"* ]]'

commit "fix(gui): a fix"
commit "fix(gui): another fix"
release --apply --summary "Two fixes."
check "only fixes bump the patch: 0.1.1" '[[ $rc == 0 && "$(git describe --tags --match "v*")" == "v0.1.1" ]]'

commit "fix: one more"
commit "feat(rdp): a desktop"
release --apply --summary "A desktop."
check "a feature bumps the minor: 0.2.0" '[[ $rc == 0 && "$(git describe --tags --match "v*")" == "v0.2.0" ]]'
cl="$(cat CHANGELOG.md)"
check "newest first, earlier summaries kept" '[[ "$cl" == *"## 0.2.0"*"A desktop."*"## 0.1.1"*"Two fixes."*"## 0.1.0"*"The first one"* ]]'
check "the site and the docs are not listed (D-078)" '[[ "$cl" != *"releases page"* && "$cl" != *"broken link"* ]]'
check "a release lists only its own commits" '[[ "$(sed -n "/## 0.2.0/,/## 0.1.1/p" CHANGELOG.md)" == *"One more"* && "$(sed -n "/## 0.2.0/,/## 0.1.1/p" CHANGELOG.md)" != *"Another fix"* ]]'

commit "docs: polish"
release --version 1.0.0
check "a version by hand still needs a feature or a fix" '[[ $rc == 1 && "$out" == *"nothing to release"* ]]'
commit "fix: the last rough edge"
release --apply --version 1.0.0 --summary "Stable."
check "a version given by hand: 1.0.0" '[[ $rc == 0 && "$(git describe --tags --match "v*")" == "v1.0.0" ]]'
commit "fix: after one"
release --apply --version 1.0.0 --summary "Again."
check "an existing version is refused" '[[ $rc == 1 && "$out" == *"already exists"* ]]'
release --version 1.0
check "a malformed version is refused" '[[ $rc == 2 ]]'

echo "release-test: $((checks - failures))/$checks"
[[ $failures == 0 ]]
