#!/usr/bin/env bash
# Signs a Flint.app with a Developer ID (milestone 79, D-158 (1)):
#
#   FLINT_MACOS_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" \
#     scripts/macos/sign.sh dist/stage/Flint.app
#
# scripts/package.sh macos calls it when FLINT_MACOS_SIGN_IDENTITY is set. The identity is
# named exactly, never the first one the keychain has: the Mac may hold another team's
# certificates. The Team ID it must carry is the identity's own, in its last parentheses,
# unless FLINT_MACOS_TEAM_ID says otherwise; after signing, `codesign -dv` must read that
# Team ID on the app and the CLI, or the script fails.
#
# FLINT_MACOS_KEYCHAIN (optional): the keychain to find the identity in (the temporary one
# scripts/macos/keychain.sh makes); the default search list otherwise.
#
# Inside out, never `--deep` to sign: the CLI in Contents/Helpers first (its own
# identifier), then the app with the entitlements in packaging/macos/flint.entitlements.
# Both under the hardened runtime with a secure timestamp (notarization asks for both).
# Reads no secret (Principle 16): an identity's name is not one.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"

app="${1:-}"
[[ -n "$app" && -d "$app/Contents" ]] || { echo "usage: scripts/macos/sign.sh <Flint.app>" >&2; exit 1; }
identity="${FLINT_MACOS_SIGN_IDENTITY:-}"
[[ -n "$identity" ]] || { echo "sign: FLINT_MACOS_SIGN_IDENTITY is not set" >&2; exit 1; }
team="${FLINT_MACOS_TEAM_ID:-}"
if [[ -z "$team" ]]; then
  team="$(sed -nE 's/.*\(([A-Z0-9]{10})\)[[:space:]]*$/\1/p' <<<"$identity")"
fi
[[ "$team" =~ ^[A-Z0-9]{10}$ ]] \
  || { echo "sign: no Team ID: name the identity with it in parentheses, or set FLINT_MACOS_TEAM_ID" >&2; exit 1; }

entitlements="$root/packaging/macos/flint.entitlements"
bundle_id="$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app/Contents/Info.plist")"
cli="$app/Contents/Helpers/flint"

kc=()
[[ -z "${FLINT_MACOS_KEYCHAIN:-}" ]] || kc=(--keychain "$FLINT_MACOS_KEYCHAIN")

sign() {
  codesign --force --timestamp --options runtime ${kc[@]+"${kc[@]}"} -s "$identity" "$@" && return 0
  # Say what codesign could see (names only, no secret), so a failure explains itself.
  echo "sign: the code-signing identities codesign can see:" >&2
  security find-identity -v -p codesigning ${FLINT_MACOS_KEYCHAIN:+"$FLINT_MACOS_KEYCHAIN"} >&2 || true
  security list-keychains -d user >&2 || true
  return 1
}

echo "sign: $identity"
[[ ! -f "$cli" ]] || sign --identifier "$bundle_id.cli" "$cli"
sign --entitlements "$entitlements" "$app"

codesign --verify --deep --strict --verbose=2 "$app"

fail=0
check() {
  local what="$1" info
  info="$(codesign -dv --verbose=4 "$what" 2>&1)"
  local got
  got="$(sed -n 's/^TeamIdentifier=//p' <<<"$info")"
  if [[ "$got" != "$team" ]]; then
    echo "sign: $(basename "$what") carries Team ID ${got:-none}, not $team" >&2
    fail=1
  fi
  grep -q '^Authority=Developer ID Application: ' <<<"$info" \
    || { echo "sign: $(basename "$what") is not signed by a Developer ID Application certificate" >&2; fail=1; }
  grep -qE '^CodeDirectory .*flags=0x[0-9a-f]*\(.*runtime' <<<"$info" \
    || { echo "sign: $(basename "$what") is not under the hardened runtime" >&2; fail=1; }
  grep -q '^Timestamp=' <<<"$info" \
    || { echo "sign: $(basename "$what") has no secure timestamp" >&2; fail=1; }
}
check "$app"
[[ ! -f "$cli" ]] || check "$cli"
[[ $fail -eq 0 ]] || exit 1
echo "sign: $app signed for team $team"
