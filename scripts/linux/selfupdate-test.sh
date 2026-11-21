#!/usr/bin/env bash
# The Linux self-update's root side in clean containers (milestone 54, D-124, Principle
# 17): flint-update-root run as root for a user of its own, as pkexec would run it, on
# Ubuntu 24.04 and Debian 13 (.deb) and Fedora 43 (.rpm).
#
#   scripts/linux/selfupdate-test.sh            # builds two test packages, then tests
#   FLINT_SELFUPDATE_KEEP=1 …                   # keeps dist/selfupdate/ (the packages,
#                                               # the key, the manifests) for Zorin
#
# Two test packages per format (scripts/package.sh linux --test-feed: a local feed and a
# throwaway key compiled in, never released), 0.90.0 and 0.90.1, and manifests for them
# signed with that key. In each container: 0.90.0 installed; then, each from a fresh
# staging folder in the user's ~/.cache/flint/update:
#   - nothing staged (exit 5), no PKEXEC_UID (exit 2), an argument (exit 2);
#   - a package whose bytes are not the manifest's (exit 3, nothing installed);
#   - a manifest changed after it was signed, or signed by another key (exit 3);
#   - a manifest naming the installed version (exit 3: never a reinstall or downgrade);
#   - a staged package that is a link to another file, a staging folder that is a link
#     (exit 3);
#   - the good one: exit 0, Flint 0.90.1 installed through the package manager (dpkg or
#     rpm says so), and the package manager says it came from a file (what the app asks
#     at launch to offer the self-update).
# Exit 1 when a check fails.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
OLD=0.90.0 NEW=0.90.1
FEED_PORT=8123
FEED="http://127.0.0.1:$FEED_PORT/manifest.json"
work="$root/dist/selfupdate"
rm -rf "$work"
mkdir -p "$work/key"

# The throwaway key: a test package's own, not a secret (Principle 16).
pub="$(scripts/sign-manifest.sh keygen "$work/key" 2>/dev/null)"
[[ "$pub" =~ ^[0-9a-f]{64}$ ]] || { echo "selfupdate-test: no key" >&2; exit 1; }

formats="${FLINT_SELFUPDATE_FORMATS:-deb rpm}"
for v in "$OLD" "$NEW"; do
  FLINT_VERSION="$v" FLINT_BUILD_TEST_FEED="$FEED" FLINT_BUILD_TEST_KEY="$pub" \
    scripts/package.sh linux $formats --test-feed
done

# A signed manifest naming `version`'s package of `format` (name and bytes of `file`).
manifest() {
  local version="$1" key="$2" file="$3" out="$4"
  python3 -I - "$version" "$key" "$file" "$out" "$FEED_PORT" <<'PY'
import hashlib, json, os, sys
version, key, path, out, port = sys.argv[1:6]
name = os.path.basename(path)
body = open(path, "rb").read()
m = {
    "version": version, "date": "2026-11-21", "summary": "A test release.",
    "page": f"https://github.com/samaniegoluis/flint/releases/tag/v{version}",
    "assets": [{"key": key, "name": name, "url": f"http://127.0.0.1:{port}/{name}",
                "size": len(body), "sha256": hashlib.sha256(body).hexdigest()}],
}
open(out, "w").write(json.dumps(m))
PY
  FLINT_UPDATE_PUBLIC_KEY_HEX="$pub" FLINT_UPDATE_SIGNING_KEY="$(cat "$work/key/flint-update-signing.key")" \
    scripts/sign-manifest.sh sign "$out" >/dev/null
}

# The check inside a container: the old package at /w/old.<fmt>, the new one at
# /w/new.<fmt>, its manifest (and the variants) in /w.
inside='
set -uo pipefail
fmt="$1" old="$2" new="$3"
fails=0
ok()  { echo "  ok   $*"; }
bad() { echo "  FAIL $*"; fails=$((fails + 1)); }
. /etc/os-release
echo "== $PRETTY_NAME: $fmt self-update"
if [[ "$fmt" == deb ]]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq >/dev/null
  apt-get install -y -qq /w/old.deb >/dev/null 2>&1 || { echo "  FAIL installing $old"; exit 1; }
else
  dnf -y -q install /w/old.rpm >/dev/null 2>&1 || { echo "  FAIL installing $old"; exit 1; }
fi
flint --version | grep -qF "$old" && ok "Flint $old installed" || bad "Flint $old installed"
grep -q "dev.flint.update" /usr/share/polkit-1/actions/dev.flint.policy && ok "the polkit action dev.flint.update" || bad "the polkit action"
grep -q "/usr/lib/flint/flint-update-root" /usr/share/polkit-1/actions/dev.flint.policy && ok "  its exec.path is the helper" || bad "the exec.path"
test -x /usr/lib/flint/flint-update-root -a -f /usr/lib/flint/TEST-FEED && ok "the helper and the TEST-FEED mark" || bad "the helper and the mark"
command -v pkexec >/dev/null && ok "pkexec came with the package" || bad "pkexec came with the package"
useradd -m tester >/dev/null 2>&1
uid=$(id -u tester)
stage=/home/tester/.cache/flint/update
helper() { PKEXEC_UID="$uid" /usr/lib/flint/flint-update-root "$@" >/tmp/out.json 2>/tmp/err.txt; echo $?; }
fresh() {
  rm -rf "$stage"
  su tester -c "mkdir -p $stage"
  su tester -c "cp /w/$1 $stage/manifest.json && cp /w/$1.sig $stage/manifest.json.sig && cp /w/${2:-new}.$fmt $stage/package.$fmt"
}
expect() {
  local what="$1" want="$2" got="$3"
  if [[ "$got" == "$want" ]]; then ok "$what (exit $got)"; else bad "$what: exit $got, wanted $want"; sed "s/^/       /" /tmp/out.json /tmp/err.txt | tail -4; fi
}
still_old() { flint --version | grep -qF "$old" || bad "  $1: Flint is no longer $old"; }

rm -rf "$stage"
expect "nothing staged" 5 "$(helper)"
expect "no PKEXEC_UID" 2 "$(/usr/lib/flint/flint-update-root >/tmp/out.json 2>&1; echo $?)"
expect "an argument" 2 "$(helper /tmp/evil)"

fresh manifest.json bad
expect "a package that is not the release'"'"'s" 3 "$(helper)"; still_old badsha
grep -q "SHA-256\|size" /tmp/out.json && ok "  says why" || bad "  says why"

fresh changed.json
expect "a manifest changed after it was signed" 3 "$(helper)"; still_old changed
fresh otherkey.json
expect "a manifest signed by another key" 3 "$(helper)"; still_old otherkey
fresh same.json
expect "a manifest of the installed version" 3 "$(helper)"; still_old same

fresh manifest.json
su tester -c "rm $stage/package.$fmt && ln -s /w/new.$fmt $stage/package.$fmt"
expect "a staged package that is a link" 3 "$(helper)"; still_old pkglink
rm -rf "$stage"; su tester -c "mkdir -p /home/tester/elsewhere /home/tester/.cache/flint && cp /w/manifest.json /w/manifest.json.sig /home/tester/elsewhere/ && cp /w/new.$fmt /home/tester/elsewhere/package.$fmt && ln -s /home/tester/elsewhere $stage"
expect "a staging folder that is a link" 3 "$(helper)"; still_old dirlink
rm -f "$stage"

fresh manifest.json
expect "the good update" 0 "$(helper)"
flint --version | grep -qF "$new" && ok "  Flint $new now" || bad "  Flint $new now"
if [[ "$fmt" == deb ]]; then
  dpkg-query -W -f="\${Version}" flint | grep -qF "$new" && ok "  dpkg says $new" || bad "  dpkg says $new"
  apt-cache policy flint > /tmp/src.txt
  if grep -q "\*\*\* $new" /tmp/src.txt && ! grep -vE "dpkg/status|^\S|Version table|\*\*\*" /tmp/src.txt | grep -q .; then ok "  apt-cache policy: from a file"; else bad "  apt-cache policy: from a file"; cat /tmp/src.txt; fi
else
  rpm -q --qf "%{VERSION}" flint | grep -qF "$new" && ok "  rpm says $new" || bad "  rpm says $new"
  dnf -C -q info --installed flint > /tmp/src.txt 2>&1
  grep -E "^From repo" /tmp/src.txt | grep -q "@commandline" && ok "  dnf info: from a file (@commandline)" || { bad "  dnf info: from a file"; cat /tmp/src.txt; }
fi
test ! -e /var/tmp/flint-update-* 2>/dev/null; ls -d /var/tmp/flint-update-* >/dev/null 2>&1 && bad "  root left its folder" || ok "  root removed its folder"
echo "== $PRETTY_NAME: $fails failed"
exit $((fails > 0))
'

# Another key, for the manifest signed by someone else.
mkdir -p "$work/other"
other="$(scripts/sign-manifest.sh keygen "$work/other" 2>/dev/null)"

total=0
for f in $formats; do
  if [[ "$f" == deb ]]; then
    oldp="dist/flint-testfeed_${OLD}_amd64.deb" newp="dist/flint-testfeed_${NEW}_amd64.deb" key=linux-x86_64-deb
    bases="${FLINT_SELFUPDATE_DEB_BASES:-ubuntu:24.04 debian:trixie}"
  else
    oldp="dist/flint-testfeed-${OLD}.x86_64.rpm" newp="dist/flint-testfeed-${NEW}.x86_64.rpm" key=linux-x86_64-rpm
    bases="${FLINT_SELFUPDATE_RPM_BASES:-fedora:43}"
  fi
  w="$work/$f"
  mkdir -p "$w"
  cp "$oldp" "$w/old.$f"
  cp "$newp" "$w/new.$f"
  # A package with one byte changed: not the release's.
  cp "$newp" "$w/bad.$f"; printf 'x' >> "$w/bad.$f"
  manifest "$NEW" "$key" "$newp" "$w/manifest.json"
  manifest "$OLD" "$key" "$oldp" "$w/same.json"
  cp "$w/manifest.json" "$w/changed.json"; cp "$w/manifest.json.sig" "$w/changed.json.sig"
  sed -i.bak 's/A test release/A changed release/' "$w/changed.json" && rm -f "$w/changed.json.bak"
  cp "$w/manifest.json" "$w/otherkey.json"
  FLINT_UPDATE_PUBLIC_KEY_HEX="$other" FLINT_UPDATE_SIGNING_KEY="$(cat "$work/other/flint-update-signing.key")" \
    scripts/sign-manifest.sh sign "$w/otherkey.json" >/dev/null
  for b in $bases; do
    docker run --rm --platform linux/amd64 -v "$w:/w:ro" "$b" bash -c "$inside" _ "$f" "$OLD" "$NEW" || total=$((total + 1))
  done
done
rm -rf "$work/key/flint-update-signing.key" "$work/other"
[[ -n "${FLINT_SELFUPDATE_KEEP:-}" ]] || rm -rf "$work"
echo "selfupdate-test: $total base(s) failed"
exit $((total > 0))
