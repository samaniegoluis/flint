#!/usr/bin/env bash
# Notarizes and staples a signed macOS package (milestone 79, D-158 (4)):
#
#   scripts/macos/notarize.sh dist/Flint-<version>-macos-arm64.zip
#
# Reads APPLE_NOTARY_KEY_ID, APPLE_NOTARY_ISSUER_ID and APPLE_NOTARY_KEY_P8 (the App Store
# Connect API key's .p8, as text) from the environment only: the release workflow's
# `release` environment, or `sec with … --` on the owner's Mac (Infisical /flint). The
# key is written to a private temporary file (notarytool takes a path, not a pipe) and
# removed on exit; no value is printed.
#
# Submits the zip and waits (at most 30 minutes) for Apple's verdict; on anything but
# Accepted it prints Apple's log and fails. Then staples the ticket to Flint.app and
# zips it again in place with ditto, so the package opens offline with no warning;
# prints the new SHA-256, as scripts/package.sh does.
set -euo pipefail

zip="${1:-}"
[[ -n "$zip" && -f "$zip" ]] || { echo "usage: scripts/macos/notarize.sh <Flint-…-macos-arm64.zip>" >&2; exit 1; }
for v in APPLE_NOTARY_KEY_ID APPLE_NOTARY_ISSUER_ID APPLE_NOTARY_KEY_P8; do
  [[ -n "${!v:-}" ]] || { echo "notarize: $v is not set" >&2; exit 1; }
done
zip="$(cd "$(dirname "$zip")" && pwd)/$(basename "$zip")"

work="$(mktemp -d "${TMPDIR:-/tmp}/flint-notarize.XXXXXX")"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT
key="$work/AuthKey_$APPLE_NOTARY_KEY_ID.p8"
(umask 077; printf '%s\n' "$APPLE_NOTARY_KEY_P8" > "$key")
auth=(--key "$key" --key-id "$APPLE_NOTARY_KEY_ID" --issuer "$APPLE_NOTARY_ISSUER_ID")

# Only a Developer ID signature is worth sending (an ad-hoc package is refused anyway).
ditto -x -k "$zip" "$work/x"
app="$work/x/Flint.app"
[[ -d "$app" ]] || { echo "notarize: $zip does not hold Flint.app" >&2; exit 1; }
info="$(codesign -dv "$app" 2>&1 || true)"
grep -q '^TeamIdentifier=[A-Z0-9]\{10\}$' <<<"$info" \
  || { echo "notarize: $zip is not signed with a Developer ID (scripts/macos/sign.sh)" >&2; exit 1; }

echo "notarize: submitting $(basename "$zip")"
out="$(xcrun notarytool submit "$zip" "${auth[@]}" --wait --timeout 30m --output-format json)" || true
id="$(plutil -extract id raw -o - - <<<"$out" 2>/dev/null || true)"
status="$(plutil -extract status raw -o - - <<<"$out" 2>/dev/null || true)"
echo "notarize: submission ${id:-?}: ${status:-no answer}"
if [[ "$status" != Accepted ]]; then
  [[ -z "$id" ]] || xcrun notarytool log "$id" "${auth[@]}" >&2 || true
  [[ -n "$id" ]] || echo "$out" >&2
  exit 1
fi

xcrun stapler staple "$app"
xcrun stapler validate "$app"
rm -f "$zip"
ditto -c -k --keepParent "$app" "$zip"
sum=$(shasum -a 256 "$zip" | awk '{print $1}')
echo "notarize: $zip"
echo "notarize: sha256 $sum"
