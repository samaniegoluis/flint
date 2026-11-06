#!/usr/bin/env bash
# Regenerates the Tether vault the import tests read
# (src/adapters/vault/testdata/tether-v5.tether) with Tether's own code: the
# generator is overlaid into Tether's module, so nothing in that repository changes.
#
#   scripts/make-tether-fixture.sh [path to the Tether repository]
#
# The legacy host's key file lives at a fixed path the tests create
# (/tmp/flint-tether-fixture/id_legacy), as Tether stores key paths absolute.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tether="${1:-$HOME/Personal/Proyectos/go/tether}"
data="$root/src/adapters/vault/testdata"
mkdir -p "$data"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-tether-fixture.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

# The stored key (passphrase "kp-fixture") and the legacy key file (no passphrase).
[[ -f "$data/tether-stored-ed25519" ]] || ssh-keygen -q -t ed25519 -N kp-fixture -C fixture-stored -f "$data/tether-stored-ed25519"
[[ -f "$data/tether-legacy-ed25519" ]] || ssh-keygen -q -t ed25519 -N '' -C fixture-legacy -f "$data/tether-legacy-ed25519"
rm -f "$data"/*.pub

cat > "$tmp/overlay.json" <<JSON
{"Replace": {"$tether/cmd/flintfixture/main.go": "$root/scripts/tether-fixture/main.go"}}
JSON
rm -f "$data/tether-v5.tether"
(cd "$tether" && go run -overlay "$tmp/overlay.json" ./cmd/flintfixture \
  "$data/tether-v5.tether" "$data/tether-stored-ed25519" kp-fixture /tmp/flint-tether-fixture/id_legacy)
sqlite3 "$data/tether-v5.tether" 'PRAGMA user_version;'
