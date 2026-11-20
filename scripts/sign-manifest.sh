#!/usr/bin/env bash
# The update manifest (milestone 52, spec v13, Principle 15): the file Flint checks at
# launch and every hour, and its Ed25519 signature. The release workflow's draft step
# calls `manifest` and `sign`; a person runs them the same way, from a checkout.
#
#   scripts/sign-manifest.sh keygen <dir>         a new key pair: the secret into
#                                                 <dir>/flint-update-signing.key (0600,
#                                                 one line of Base64, the 32-byte seed),
#                                                 the public key printed in hex for
#                                                 UPDATE_PUBLIC_KEY_HEX (src/domain/update.cf)
#   scripts/sign-manifest.sh manifest <tag> <dir> <dir>/manifest.json for the packages in
#                                                 <dir>: version, date, summary, the
#                                                 release page, and per package its URL,
#                                                 size and SHA-256
#   scripts/sign-manifest.sh sign <file>          <file>.sig, Base64 of the detached
#                                                 signature of <file>'s bytes, then
#                                                 checked against the committed public key
#   scripts/sign-manifest.sh verify <file>        checks <file>.sig against the committed
#                                                 public key
#
# `sign` reads the secret from FLINT_UPDATE_SIGNING_KEY only (the workflow's `release`
# environment, the owner's Infisical folder /flint); it is never written to a file, a
# log or a package, and nothing here prints it. Needs OpenSSL 3 or later (OPENSSL names
# one; macOS's LibreSSL has no raw Ed25519): Homebrew's openssl@3 is found on its own.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

REPO_URL="https://github.com/samaniegoluis/flint"
# DER prefixes of an Ed25519 key: PKCS#8 private (then the 32-byte seed) and SPKI public.
PRIV_PREFIX="302e020100300506032b657004220420"
PUB_PREFIX="302a300506032b6570032100"

die() { echo "sign-manifest: $*" >&2; exit 1; }
sha256() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{print $1}'; }
fsize() { wc -c < "$1" | tr -d ' '; }
hex_to_bin() { xxd -r -p; }
b64() { openssl_bin base64 -A; }
unb64() { openssl_bin base64 -d -A; }

openssl_bin() {
  local o="${OPENSSL:-}"
  if [[ -z "$o" ]]; then
    for c in openssl /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
      if command -v "$c" >/dev/null 2>&1 && "$c" version 2>/dev/null | grep -Eq '^OpenSSL ([3-9]|[1-9][0-9])\.'; then o="$c"; break; fi
    done
  fi
  [[ -n "$o" ]] || die "needs OpenSSL 3 or later (brew install openssl@3, or OPENSSL=/path/to/openssl)"
  "$o" "$@"
}

# FLINT_UPDATE_PUBLIC_KEY_HEX replaces the committed key, for this script's own tests
# (scripts/release-test.sh) with a throwaway pair; the app never reads it.
public_key_hex() {
  if [[ -n "${FLINT_UPDATE_PUBLIC_KEY_HEX:-}" ]]; then echo "$FLINT_UPDATE_PUBLIC_KEY_HEX"; return; fi
  sed -nE 's/^UPDATE_PUBLIC_KEY_HEX: str = "([0-9a-f]{64})"$/\1/p' src/domain/update.cf
}

# A temporary folder only this user can read, removed on exit.
tmpdir() {
  local d
  d="$(mktemp -d)"
  chmod 700 "$d"
  echo "$d"
}

cmd="${1:-}"
case "$cmd" in
  keygen)
    dir="${2:-}"
    [[ -d "$dir" ]] || die "usage: sign-manifest.sh keygen <dir>"
    out="$dir/flint-update-signing.key"
    [[ ! -e "$out" ]] || die "$out already exists; a key is never overwritten"
    t="$(tmpdir)"; trap 'rm -rf "$t"' EXIT
    openssl_bin genpkey -algorithm ed25519 -outform DER -out "$t/k.der" 2>/dev/null
    # The seed is the last 32 bytes of the PKCS#8 form.
    (umask 077; tail -c 32 "$t/k.der" | b64 > "$out"; echo >> "$out")
    openssl_bin pkey -inform DER -in "$t/k.der" -pubout -outform DER 2>/dev/null | tail -c 32 | xxd -p -c 64
    echo "sign-manifest: the secret is in $out: put it in Infisical (/flint, FLINT_UPDATE_SIGNING_KEY) and in the" >&2
    echo "sign-manifest: repository's 'release' environment, then delete the file. The line above is the public key." >&2
    ;;
  manifest)
    tag="${2:-}"; dir="${3:-}"
    [[ "$tag" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || die "the manifest is for a release tag vX.Y.Z, not '$tag' (a pre-release is never offered)"
    [[ -d "$dir" ]] || die "usage: sign-manifest.sh manifest <tag> <dir>"
    version="${tag#v}"
    date="$(sed -nE "s/^## ${version//./\\.} — ([0-9]{4}-[0-9]{2}-[0-9]{2})$/\1/p" CHANGELOG.md | head -1)"
    [[ -n "$date" ]] || die "CHANGELOG.md has no section for $version (scripts/release.sh writes it)"
    # The summary: the section's first paragraph.
    summary="$(awk -v v="$version" '
      /^## / { if (on) exit; on = ($2 == v); next }
      on && /^### / { exit }
      on && NF { buf = buf (buf ? " " : "") $0; seen = 1; next }
      on && seen { exit }
      END { print buf }' CHANGELOG.md)"
    assets=""
    while IFS= read -r f; do
      n="$(basename "$f")"
      key=""
      case "$n" in
        Flint-*-macos-arm64.zip) key="macos-arm64" ;;
        Flint-*-windows-x86_64.zip) key="windows-x86_64" ;;
        flint_*_amd64.deb) key="linux-x86_64-deb" ;;
        flint-*.x86_64.rpm) key="linux-x86_64-rpm" ;;
        *) continue ;;
      esac
      [[ "$n" == *"$version"* ]] || die "$n is not a package of $version"
      a="$(jq -cn --arg key "$key" --arg name "$n" --arg url "$REPO_URL/releases/download/$tag/$n" \
            --argjson size "$(fsize "$f")" --arg sha "$(sha256 "$f")" \
            '{key: $key, name: $name, url: $url, size: $size, sha256: $sha}')"
      assets="${assets:+$assets,}$a"
    done < <(find "$dir" -maxdepth 1 -type f | sort)
    [[ -n "$assets" ]] || die "$dir holds no package"
    jq -n --arg version "$version" --arg date "$date" --arg summary "$summary" \
          --arg page "$REPO_URL/releases/tag/$tag" --argjson assets "[$assets]" \
          '{version: $version, date: $date, summary: $summary, page: $page, assets: $assets}' > "$dir/manifest.json"
    echo "sign-manifest: $dir/manifest.json for $version ($(jq '.assets | length' "$dir/manifest.json") packages)"
    ;;
  sign|verify)
    file="${2:-}"
    [[ -f "$file" ]] || die "usage: sign-manifest.sh $cmd <file>"
    pub="$(public_key_hex)"
    [[ -n "$pub" && "$pub" != "$(printf '0%.0s' {1..64})" ]] || die "src/domain/update.cf has no public key yet (UPDATE_PUBLIC_KEY_HEX)"
    t="$(tmpdir)"; trap 'rm -rf "$t"' EXIT
    printf '%s%s' "$PUB_PREFIX" "$pub" | hex_to_bin > "$t/pub.der"
    if [[ "$cmd" == sign ]]; then
      [[ -n "${FLINT_UPDATE_SIGNING_KEY:-}" ]] || die "FLINT_UPDATE_SIGNING_KEY is not set (the release environment, or: sec with FLINT_UPDATE_SIGNING_KEY -- …)"
      { printf '%s' "$PRIV_PREFIX" | hex_to_bin; printf '%s' "$FLINT_UPDATE_SIGNING_KEY" | tr -d ' \n\r' | unb64; } > "$t/k.der"
      [[ "$(fsize "$t/k.der")" == 48 ]] || die "FLINT_UPDATE_SIGNING_KEY is not a Base64 32-byte Ed25519 seed"
      openssl_bin pkeyutl -sign -rawin -inkey "$t/k.der" -keyform DER -in "$file" -out "$t/sig" 2>/dev/null \
        || die "signing failed"
      rm -f "$t/k.der"
      b64 < "$t/sig" > "$file.sig"
      echo >> "$file.sig"
    fi
    [[ -f "$file.sig" ]] || die "no $file.sig"
    tr -d '\n' < "$file.sig" | unb64 > "$t/sig.bin"
    openssl_bin pkeyutl -verify -rawin -pubin -inkey "$t/pub.der" -keyform DER -in "$file" -sigfile "$t/sig.bin" >/dev/null 2>&1 \
      || die "$file.sig does not verify against the committed public key (a key that is not FLINT_UPDATE_SIGNING_KEY's pair?)"
    echo "sign-manifest: $file.sig verifies against $pub"
    ;;
  *) die "usage: sign-manifest.sh keygen <dir> | manifest <tag> <dir> | sign <file> | verify <file>" ;;
esac
