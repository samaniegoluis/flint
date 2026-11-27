#!/usr/bin/env bash
# A temporary keychain holding the Developer ID certificate (milestone 79, D-158 (2)):
#
#   scripts/macos/keychain.sh create    # prints FLINT_MACOS_KEYCHAIN=<path>
#   scripts/macos/keychain.sh delete <path>
#
# `create` reads APPLE_DEVELOPER_ID_P12_BASE64 (the .p12, base64) and
# APPLE_DEVELOPER_ID_P12_PASSWORD from the environment only: the release workflow's
# `release` environment, or `sec with … --` on the owner's Mac (Infisical /flint). It
# never prints them and writes the .p12 only to a private temporary folder it removes.
# The keychain gets a random password, stays unlocked for two hours, and lets codesign
# use the key with no dialog. It joins the user's keychain search list, ahead of the
# others: codesign finds no identity in a keychain outside that list, even when named
# with --keychain (the release run of v0.38.0); scripts/macos/sign.sh names it through
# FLINT_MACOS_KEYCHAIN. `delete` takes it off the list and removes it. The login
# keychain itself is never changed.
set -euo pipefail

cmd="${1:-}"
case "$cmd" in
  create)
    [[ -n "${APPLE_DEVELOPER_ID_P12_BASE64:-}" && -n "${APPLE_DEVELOPER_ID_P12_PASSWORD:-}" ]] \
      || { echo "keychain: APPLE_DEVELOPER_ID_P12_BASE64 and APPLE_DEVELOPER_ID_P12_PASSWORD must be set" >&2; exit 1; }
    work="$(mktemp -d "${TMPDIR:-/tmp}/flint-keychain.XXXXXX")"
    chmod 700 "$work"
    trap 'rm -rf "$work"' EXIT
    kc="${FLINT_MACOS_KEYCHAIN_DIR:-${TMPDIR:-/tmp}}"
    kc="${kc%/}/flint-signing-$$-$RANDOM.keychain-db"
    pass="$(openssl rand -hex 24)"
    (umask 077; printf '%s' "$APPLE_DEVELOPER_ID_P12_BASE64" | base64 -D > "$work/id.p12")
    security create-keychain -p "$pass" "$kc"
    security set-keychain-settings -lut 7200 "$kc"
    security unlock-keychain -p "$pass" "$kc"
    security import "$work/id.p12" -k "$kc" -P "$APPLE_DEVELOPER_ID_P12_PASSWORD" -T /usr/bin/codesign -f pkcs12 >/dev/null
    security set-key-partition-list -S apple-tool:,apple: -s -k "$pass" "$kc" >/dev/null
    others=()
    while IFS= read -r k; do
      k="$(sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/' <<<"$k")"
      [[ -z "$k" || "$k" == *flint-signing-*.keychain-db ]] || others+=("$k")
    done < <(security list-keychains -d user)
    security list-keychains -d user -s "$kc" ${others[@]+"${others[@]}"}
    n="$(security find-identity -v -p codesigning "$kc" | grep -c 'Developer ID Application' || true)"
    if [[ "$n" -lt 1 ]]; then
      security delete-keychain "$kc" || true
      echo "keychain: the .p12 holds no Developer ID Application identity" >&2
      exit 1
    fi
    echo "keychain: $kc ($n Developer ID Application identity)" >&2
    echo "FLINT_MACOS_KEYCHAIN=$kc"
    ;;
  delete)
    kc="${2:-}"
    [[ -n "$kc" ]] || { echo "usage: scripts/macos/keychain.sh delete <path>" >&2; exit 1; }
    [[ "$kc" == *flint-signing-*.keychain-db ]] || { echo "keychain: $kc is not one this script made" >&2; exit 1; }
    rest=()
    while IFS= read -r k; do
      k="$(sed -E 's/^[[:space:]]*"(.*)"[[:space:]]*$/\1/' <<<"$k")"
      [[ -z "$k" || "$(basename "$k")" == "$(basename "$kc")" ]] || rest+=("$k")
    done < <(security list-keychains -d user)
    security list-keychains -d user -s ${rest[@]+"${rest[@]}"}
    [[ ! -f "$kc" ]] || security delete-keychain "$kc"
    echo "keychain: removed $kc" >&2
    ;;
  *) echo "usage: scripts/macos/keychain.sh create | delete <path>" >&2; exit 1 ;;
esac
