#!/usr/bin/env bash
# Tests scripts/release.sh and cliff.toml on a throwaway repository (milestone 32): the
# version bump, what the changelog keeps and leaves out, the summary, the tag, and the
# refusals; and scripts/release-draft.sh (milestone 51): the guard, the notes, SHA256SUMS
# and the draft against a stand-in for gh. Run by scripts/test.sh; needs git-cliff.
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

# scripts/release-draft.sh (milestone 51): the workflow's guard, notes and draft.
cp "$root/scripts/release-draft.sh" scripts/
export FLINT_RELEASE_MAIN=main
draft() { out="$(scripts/release-draft.sh "$@" 2>&1)"; rc=$?; }

draft guard v1.0.0
check "a tag on main passes the guard" '[[ $rc == 0 && "$out" == *"is on main"* ]]'
git checkout -q -b side
commit "fix: on a side branch"
git tag -a v1.0.1 -m "side"
draft guard v1.0.1
check "a tag off main is refused" '[[ $rc == 1 && "$out" == *"not on main"* ]]'
git checkout -q main
cp "$root/scripts/release-draft.sh" scripts/   # the side commit took it along
draft guard v9.9.9
check "a missing tag is refused" '[[ $rc == 1 && "$out" == *"no tag"* ]]'
draft guard v1.0
check "a malformed tag is refused" '[[ $rc == 1 && "$out" == *"not vX.Y.Z"* ]]'
draft guard demo-2026-01-01
check "a tag that is not a release is refused" '[[ $rc == 1 ]]'

draft notes v0.2.0
check "the notes are the version's section" '[[ $rc == 0 && "$out" == *"A desktop."* && "$out" == *"One more"* && "$out" != *"## 0.2.0"* && "$out" != *"Two fixes."* ]]'
check "the notes say the packages are unsigned" '[[ "$out" == *"not code-signed"* && "$out" == *"SHA256SUMS"* ]]'
git tag -a v1.1.0-rc.1 -m "Trying the packages."
draft notes v1.1.0-rc.1
check "a pre-release not in the changelog gets its tag's message" '[[ $rc == 0 && "$out" == *"pre-release of Flint 1.1.0"* && "$out" == *"Trying the packages."* ]]'
draft notes v1.2.0
check "a release not in the changelog is refused" '[[ $rc == 1 && "$out" == *"no section for 1.2.0"* ]]'

# A stand-in for gh: logs its arguments; FAKE_GH_DRAFT says whether the release exists
# (true: a draft, false: published, unset: none); `release download` copies the files
# of FAKE_GH_ASSETS into its --dir.
cat > fake-gh <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
if [[ "$1 $2" == "release view" ]]; then
  [[ -n "${FAKE_GH_DRAFT:-}" ]] || exit 1
  echo "$FAKE_GH_DRAFT"
fi
if [[ "$1 $2" == "release download" ]]; then
  dir=""; while [[ $# -gt 0 ]]; do [[ "$1" == --dir ]] && dir="$2"; shift; done
  cp "$FAKE_GH_ASSETS"/* "$dir"/
fi
exit 0
EOF
chmod +x fake-gh
export GH="$PWD/fake-gh" FAKE_GH_LOG="$PWD/gh.log"
mkdir -p pkgs; printf 'mac' > pkgs/Flint-1.1.0-rc.1-macos-arm64.zip; printf 'deb' > pkgs/flint_1.1.0_amd64.deb
: > gh.log; unset FAKE_GH_DRAFT
draft draft v1.1.0-rc.1 pkgs
log="$(cat gh.log)"
check "draft writes SHA256SUMS for every package" '[[ $rc == 0 && "$(wc -l < pkgs/SHA256SUMS | tr -d " ")" == 2 && "$(cat pkgs/SHA256SUMS)" == *"  Flint-1.1.0-rc.1-macos-arm64.zip"* ]]'
check "SHA256SUMS checks" '(cd pkgs && shasum -a 256 -c SHA256SUMS >/dev/null)'
check "a new release is a draft, a pre-release for -rc, with every file" '[[ "$log" == *"release create v1.1.0-rc.1 --draft --verify-tag"*"--prerelease"*"SHA256SUMS"* && "$log" == *"macos-arm64.zip"* && "$log" == *"amd64.deb"* ]]'
: > gh.log
draft draft v1.0.0 pkgs
check "a release tag is not a pre-release" '[[ $rc == 0 && "$(cat gh.log)" == *"release create v1.0.0 --draft"* && "$(cat gh.log)" != *"--prerelease"* ]]'
: > gh.log; export FAKE_GH_DRAFT=true
draft draft v1.1.0-rc.1 pkgs
check "an existing draft gets its files replaced" '[[ $rc == 0 && "$(cat gh.log)" == *"release upload v1.1.0-rc.1 --clobber"* && "$(cat gh.log)" != *"release create"* ]]'
: > gh.log; export FAKE_GH_DRAFT=false
draft draft v1.1.0-rc.1 pkgs
check "a published release is never changed" '[[ $rc == 1 && "$out" == *"already published"* && "$(cat gh.log)" != *"upload"* ]]'
unset FAKE_GH_DRAFT

# The update manifest (milestone 52): a release gets manifest.json and its signature
# when the key is set, an -rc never, and no key means a warning and no manifest. A
# throwaway key pair, its public half in FLINT_UPDATE_PUBLIC_KEY_HEX.
cp "$root/scripts/sign-manifest.sh" scripts/
mkdir -p keys rel; printf 'mac' > rel/Flint-1.0.0-macos-arm64.zip; printf 'deb' > rel/flint_1.0.0_amd64.deb
printf 'win' > rel/Flint-1.0.0-windows-x86_64.zip
export FLINT_UPDATE_PUBLIC_KEY_HEX="$(scripts/sign-manifest.sh keygen keys 2>/dev/null)"
: > gh.log
FLINT_UPDATE_SIGNING_KEY="$(cat keys/flint-update-signing.key)" draft draft v1.0.0 rel
check "a release gets a signed manifest" '[[ $rc == 0 && -f rel/manifest.json && -f rel/manifest.json.sig && "$(cat gh.log)" == *"manifest.json.sig"* ]]'
check "the manifest names the version and each package" '[[ "$(jq -r .version rel/manifest.json)" == 1.0.0 && "$(jq -r ".assets | map(.key) | join(\",\")" rel/manifest.json)" == "linux-x86_64-deb,macos-arm64,windows-x86_64" && "$(jq -r .page rel/manifest.json)" == *"/releases/tag/v1.0.0" ]]'
check "the manifest is not in SHA256SUMS" '[[ "$(cat rel/SHA256SUMS)" != *manifest* ]]'
scripts/sign-manifest.sh verify rel/manifest.json >/dev/null 2>&1
check "its signature verifies" '[[ $? == 0 ]]'
printf ' ' >> rel/manifest.json
scripts/sign-manifest.sh verify rel/manifest.json >/dev/null 2>&1 && changed=0 || changed=1
check "a changed manifest does not verify" '[[ $changed == 1 ]]'
: > gh.log
draft draft v1.0.0 rel
check "no key: a warning and no manifest" '[[ $rc == 0 && "$out" == *"no update manifest"* && ! -f rel/manifest.json && "$(cat gh.log)" != *manifest* ]]'
: > gh.log
FLINT_UPDATE_SIGNING_KEY="$(cat keys/flint-update-signing.key)" draft draft v1.1.0-rc.1 pkgs
check "a pre-release never gets a manifest" '[[ $rc == 0 && ! -f pkgs/manifest.json && "$(cat gh.log)" != *manifest* ]]'

# publish (D-147): the draft as it is on GitHub is checked, then published; any failure
# leaves it a draft.
FLINT_UPDATE_SIGNING_KEY="$(cat keys/flint-update-signing.key)" draft draft v1.0.0 rel
export FAKE_GH_ASSETS="$PWD/rel" FAKE_GH_DRAFT=true
: > gh.log
draft publish v1.0.0
check "a checked release is published as Latest" '[[ $rc == 0 && "$out" == *"checked and published"* && "$(cat gh.log)" == *"release edit v1.0.0 --draft=false --latest"* ]]'
cp -R rel bad; export FAKE_GH_ASSETS="$PWD/bad"
printf 'x' >> bad/flint_1.0.0_amd64.deb
: > gh.log
draft publish v1.0.0
check "a package that does not match SHA256SUMS is left a draft" '[[ $rc == 1 && "$out" == *"does not match SHA256SUMS"* && "$(cat gh.log)" != *"release edit"* ]]'
rm -rf bad; cp -R rel bad
printf ' ' >> bad/manifest.json
: > gh.log
draft publish v1.0.0
check "a manifest whose signature fails is left a draft" '[[ $rc == 1 && "$out" == *"does not verify"* && "$(cat gh.log)" != *"release edit"* ]]'
rm -rf bad; cp -R rel bad; rm bad/manifest.json bad/manifest.json.sig
: > gh.log
draft publish v1.0.0
check "a release with no signed manifest is left a draft" '[[ $rc == 1 && "$out" == *"no signed manifest"* && "$(cat gh.log)" != *"release edit"* ]]'
rm -rf bad; cp -R rel bad; printf 'extra' > bad/extra.txt
draft publish v1.0.0
check "a file not in SHA256SUMS is left a draft" '[[ $rc == 1 && "$out" == *"do not match"* ]]'
rm -rf bad
export FAKE_GH_ASSETS="$PWD/pkgs"
: > gh.log
draft publish v1.1.0-rc.1
check "a pre-release is published as a pre-release, never Latest, with no manifest" '[[ $rc == 0 && "$(cat gh.log)" == *"release edit v1.1.0-rc.1 --draft=false"* && "$(cat gh.log)" != *"--latest"* ]]'
export FAKE_GH_DRAFT=false
: > gh.log
draft publish v1.0.0
check "a published release is left as it is" '[[ $rc == 0 && "$out" == *"already published"* && "$(cat gh.log)" != *"release edit"* ]]'
unset FAKE_GH_DRAFT
draft publish v1.0.0
check "publish with no release is refused" '[[ $rc == 1 && "$out" == *"run draft first"* ]]'
unset FAKE_GH_ASSETS FLINT_UPDATE_PUBLIC_KEY_HEX

mkdir -p testpkgs
echo deb > testpkgs/flint-testfeed_1.0.0_amd64.deb
: > gh.log
draft draft v1.0.0 testpkgs
check "a test package (--test-feed) is refused" '[[ $rc == 1 && "$out" == *"test package"* && "$(cat gh.log)" != *create* ]]'

mkdir -p empty
draft draft v1.0.0 empty
check "a folder with no packages is refused" '[[ $rc == 1 && "$out" == *"no packages"* ]]'

echo "release-test: $((checks - failures))/$checks"
[[ $failures == 0 ]]
