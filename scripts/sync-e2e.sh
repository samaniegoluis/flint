#!/usr/bin/env bash
# End-to-end run of the remote vault from the CLI (milestone 43): the real
# flint-vault-server on loopback and two config folders standing for two machines.
# Both connect, both go offline (the server stopped) and edit, both come back and
# end with every change; an alias taken on both is renamed; a master password
# changed on one is taken by the other; the token never shows anywhere.
#
#   scripts/sync-e2e.sh
#
# The server tokens go to the OS keychain (service "Flint", account
# remote-token:<vault id>) and are removed by `vault disconnect` at the end.
set -o pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
. "$root/scripts/env.sh"
cfire build flint >/dev/null || { echo "sync-e2e: build failed" >&2; exit 1; }
cfire build flint-vault-server >/dev/null || { echo "sync-e2e: server build failed" >&2; exit 1; }
flint="$root/build/flint"
server="$root/build/flint-vault-server"

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-sync-e2e.XXXXXX")"
export FLINT_APP=off
mkdir -p "$tmp/a" "$tmp/b" "$tmp/data" "$tmp/va" "$tmp/vb"
all_out="$tmp/all-output"
: > "$all_out"
failures=0
checks=0
port="$(python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
url="http://127.0.0.1:$port"
TOKEN="$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PW="lantern-orbit-quiet-mosaic-97"
NEW_PW="harbour-violet-engine-cobalt-42"
VA="$tmp/va/Lab.flint"
VB="$tmp/vb/Lab.flint"
server_pid=""

start_server() {
  FLINT_VAULT_TOKEN="$TOKEN" FLINT_VAULT_DATA="$tmp/data" FLINT_VAULT_LISTEN="127.0.0.1:$port" "$server" >>"$tmp/server.log" 2>&1 &
  server_pid=$!
  for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && return; sleep 0.1; done
  echo "sync-e2e: the server did not start" >&2; cat "$tmp/server.log" >&2; exit 1
}
stop_server() { [[ -n "$server_pid" ]] && { kill "$server_pid" 2>/dev/null; wait "$server_pid" 2>/dev/null; server_pid=""; }; }

app_pid=""
cleanup() {
  [[ -n "$app_pid" ]] && { kill "$app_pid" 2>/dev/null; wait "$app_pid" 2>/dev/null; }
  FLINT_CONFIG_DIR="$tmp/a" "$flint" --vault "$VA" vault disconnect >/dev/null 2>&1
  FLINT_CONFIG_DIR="$tmp/b" "$flint" --vault "$VB" vault disconnect >/dev/null 2>&1
  stop_server
  # FLINT_E2E_KEEP=<dir> keeps the app's and the server's logs for a look.
  if [[ -n "${FLINT_E2E_KEEP:-}" ]]; then cp "$tmp/app.log" "$tmp/server.log" "$all_out" "$FLINT_E2E_KEEP/" 2>/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

no_tty() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' "$@"; }

# on <machine a|b> <exit code> <description> <stdin text> -- <flint args...>
on() {
  local m="$1" want="$2" desc="$3" input="$4"; shift 5
  checks=$((checks + 1))
  printf '%s' "$input" | FLINT_CONFIG_DIR="$tmp/$m" no_tty "$flint" "$@" >"$tmp/out" 2>"$tmp/err"
  local got=$?
  out="$(cat "$tmp/out")"; err="$(cat "$tmp/err")"
  { echo "\$ [$m] flint $*"; echo "$out"; echo "$err"; } >> "$all_out"
  if [[ "$got" != "$want" ]]; then
    failures=$((failures + 1))
    echo "FAIL  [$m] $desc: exit $got, want $want"
    echo "      stdout: $out"
    echo "      stderr: $err"
  else
    echo "ok    [$m] $desc"
  fi
}
check() {
  checks=$((checks + 1))
  if eval "$2"; then echo "ok    $1"; else failures=$((failures + 1)); echo "FAIL  $1"; fi
}
file_mode() { if [[ "$(uname -s)" == Darwin ]]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi; }
json_get() { python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); print(eval(sys.argv[1], {"d": d}))' "$1"; }
aliases() { printf '%s\n' "$PW" | FLINT_CONFIG_DIR="$tmp/$1" no_tty "$flint" --json --vault "$2" host list --master-stdin | python3 -c 'import json,sys; print(" ".join(sorted(h["alias"] for h in json.load(sys.stdin))))'; }

start_server

echo "== a vault on machine A"
on a 0 "create the vault" "$PW"$'\n' -- vault create "$VA" --master-stdin
on a 0 "add a host" "$PW"$'\n' -- --vault "$VA" host add web --hostname 10.0.0.5 --master-stdin
on a 0 "status: a local vault" "$PW"$'\n' -- --json --vault "$VA" vault status
check "not connected" '[[ "$(echo "$out" | json_get "d[\"remote\"][\"connected\"]")" == "False" ]]'

echo "== connect refuses what may not leave the machine"
printf '%s\n' "password1" | FLINT_CONFIG_DIR="$tmp/a" no_tty "$flint" vault create "$tmp/va/Weak.flint" --master-stdin >/dev/null 2>&1
on a 7 "a weak master password" "password1"$'\n'"$TOKEN"$'\n' -- --vault "$tmp/va/Weak.flint" vault connect "$url" --master-stdin --token-stdin
check "it points to vault passwd" '[[ "$err" == *"flint vault passwd"* ]]'
on a 7 "plain http beyond this machine" "$PW"$'\n'"$TOKEN"$'\n' -- --vault "$VA" vault connect http://vault.example.com --master-stdin --token-stdin
on a 6 "the wrong master password" "not-the-password-at-all-17"$'\n'"$TOKEN"$'\n' -- --vault "$VA" vault connect "$url" --master-stdin --token-stdin
on a 12 "a wrong token" "$PW"$'\n'"wrong-token-wrong-token-wrong-token-1"$'\n' -- --json --vault "$VA" vault connect "$url" --master-stdin --token-stdin
check "--json error says auth" '[[ "$(echo "$err" | json_get "d[\"error\"][\"code\"]")" == "auth" ]]'
check "nothing remembered after a refusal" '[[ ! -f "$tmp/a/remotes.json" ]] || ! grep -q "$VA" "$tmp/a/remotes.json"'
FLINT_KEYCHAIN=off on a 9 "no keychain to keep the token" "$PW"$'\n'"$TOKEN"$'\n' -- --vault "$VA" vault connect "$url" --master-stdin --token-stdin

echo "== connect, then download on machine B"
on a 0 "connect uploads the vault" "$PW"$'\n'"$TOKEN"$'\n' -- --json --vault "$VA" vault connect "$url" --master-stdin --token-stdin
check "uploaded as version 1" '[[ "$(echo "$out" | json_get "d[\"result\"] + str(d[\"version\"])")" == "uploaded1" ]]'
on a 4 "connecting again is refused" "$PW"$'\n'"$TOKEN"$'\n' -- --vault "$VA" vault connect "$url" --master-stdin --token-stdin
on b 0 "download to a new file" "$PW"$'\n'"$TOKEN"$'\n' -- --json vault connect "$url" --to "$VB" --master-stdin --token-stdin
check "downloaded version 1" '[[ "$(echo "$out" | json_get "d[\"result\"] + str(d[\"version\"])")" == "downloaded1" ]]'
check "B's file is 0600" '[[ "$(file_mode "$VB")" == "600" ]]'
on b 20 "a taken path is refused" "$PW"$'\n'"$TOKEN"$'\n' -- vault connect "$url" --to "$VB" --master-stdin --token-stdin
check "B has A's host" '[[ "$(aliases b "$VB")" == "web" ]]'
on b 0 "B in step" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
check "in step, nothing uploaded" '[[ "$out" == *"in step"* ]]'

echo "== both offline, both edit"
stop_server
on a 0 "A adds api (the sync waits)" "$PW"$'\n' -- --vault "$VA" host add api --hostname 10.0.0.7 --master-stdin
check "a warning, not a failure" '[[ "$err" == *"could not sync"* && "$err" == *"waits"* ]]'
on b 0 "B adds db" "$PW"$'\n' -- --vault "$VB" host add db --hostname 10.0.0.8 --master-stdin
on a 0 "A also adds cache" "$PW"$'\n' -- --vault "$VA" host add cache --hostname 10.0.1.1 --master-stdin
on b 0 "B also adds cache, elsewhere" "$PW"$'\n' -- --vault "$VB" host add cache --hostname 10.0.2.2 --master-stdin
on a 0 "status: changes wait" "" -- --json --vault "$VA" vault status
check "pending, with the last error" '[[ "$(echo "$out" | json_get "str(d[\"remote\"][\"pending\"]) + d[\"remote\"][\"last_error\"][:7]")" == "Truenetwork" ]]'
on b 13 "sync offline is network" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
on a 13 "a password change waits for the server" "$PW"$'\n'"$NEW_PW"$'\n' -- --vault "$VA" vault passwd --master-stdin --new-master-stdin

echo "== both back"
start_server
on a 0 "A syncs: uploads" "$PW"$'\n' -- --json --vault "$VA" vault sync --master-stdin
check "uploaded" '[[ "$(echo "$out" | json_get "d[\"result\"]")" == "uploaded" ]]'
on b 0 "B syncs: merges A's and uploads its own" "$PW"$'\n' -- --json --vault "$VB" vault sync --master-stdin
check "merged and uploaded" '[[ "$(echo "$out" | json_get "d[\"result\"] + str(d[\"uploaded\"])")" == "mergedTrue" ]]'
check "the second cache is renamed and reported" '[[ "$(echo "$out" | json_get "[n[\"change\"] for n in d[\"report\"][\"notes\"]]")" == *"renamed"* ]]'
on a 0 "A syncs: merges B's, nothing to upload" "$PW"$'\n' -- --json --vault "$VA" vault sync --master-stdin
check "merged, not uploaded" '[[ "$(echo "$out" | json_get "d[\"result\"] + str(d[\"uploaded\"])")" == "mergedFalse" ]]'
check "A has every host" '[[ "$(aliases a "$VA")" == "api cache cache-2 db web" ]]'
check "B has every host" '[[ "$(aliases b "$VB")" == "api cache cache-2 db web" ]]'
v_before="$(grep -c 'PUT /v1/vault 200' "$tmp/server.log")"
on a 0 "A again: in step" "$PW"$'\n' -- --vault "$VA" vault sync --master-stdin
on b 0 "B again: in step" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
check "no empty versions" '[[ "$(grep -c "PUT /v1/vault 200" "$tmp/server.log")" == "$v_before" ]]'
check "in-step checks download nothing (304)" '[[ "$(grep -c "GET /v1/vault 304" "$tmp/server.log")" -ge 2 ]]'
on a 0 "status: in step" "" -- --vault "$VA" vault status
check "status names the server, nothing waits" '[[ "$out" == *"$url"* && "$out" == *"waiting    nothing"* ]]'

echo "== a master password changed on B"
on b 0 "B changes it, in step with the server" "$PW"$'\n'"$NEW_PW"$'\n' -- --vault "$VB" vault passwd --master-stdin --new-master-stdin
on a 0 "A edits meanwhile" "$PW"$'\n' -- --vault "$VA" host add mail --hostname 10.0.0.9 --master-stdin
check "A's sync is told the password changed" '[[ "$err" == *"changed on another machine"* ]]'
on a 6 "A's sync without the new one" "$PW"$'\n' -- --vault "$VA" vault sync --master-stdin
on a 0 "A's sync with the new one" "$PW"$'\n'"$NEW_PW"$'\n' -- --json --vault "$VA" vault sync --master-stdin --new-master-stdin
check "re-keyed, merged and uploaded" '[[ "$(echo "$out" | json_get "str(d[\"rekeyed\"]) + str(d[\"uploaded\"])")" == "TrueTrue" ]]'
on a 6 "A's old password no longer opens it" "$PW"$'\n' -- --vault "$VA" host list --master-stdin
on b 0 "B takes A's change" "$NEW_PW"$'\n' -- --vault "$VB" vault sync --master-stdin
PW="$NEW_PW"
check "both have mail" '[[ "$(aliases a "$VA")" == "$(aliases b "$VB")" && "$(aliases b "$VB")" == *mail* ]]'

echo "== the app keeps a connected vault in step (its sync loop)"
# On macOS the token the CLI saved is behind a system dialog when Flint.app reads it
# (D-099: unsigned builds), so the app's part runs there only with
# FLINT_SYNC_E2E_APP=1 and a person to answer it; on Linux always.
app_default=1
[[ "$(uname -s)" == Darwin ]] && app_default=0
if [[ "${FLINT_SYNC_E2E_APP:-$app_default}" == 1 ]]; then
  "$root/scripts/build-gui.sh" >/dev/null || { echo "sync-e2e: app build failed" >&2; exit 1; }
  if [[ "$(uname -s)" == Darwin ]]; then app=(build/gui/Flint.app/Contents/MacOS/Flint); else app=(timeout 200 xvfb-run -a build/gui/Flint); fi
  # The page unlocks A's vault, then listens until the CLI adds `stop-app`, and
  # reports every vault:sync it heard. Its socket needs a short path (sun_path).
  short="$(mktemp -d /tmp/fl-sync.XXXXXX)"
  cp -R "$tmp/a/." "$short/"
  cat > "$tmp/app.js" <<JS
(async () => {
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  const seen = [];
  const t0p = Date.now();
  window.runtime.EventsOn('vault:sync', (e) => {
    seen.push(e.state + (e.code ? ':' + e.code : ''));
    window.backend.e2e_log({ name: 'diag: +' + (Date.now() - t0p) + ' ms vault:sync ' + e.state + ' v' + e.version });
  });
  const patch = (alias, hostname) => ({ alias, set_alias: true, label: '', set_label: false, hostname, set_hostname: true,
    port: 22, set_port: false, user: '', set_user: false, group: '', set_group: false, tags: [], set_tags: false,
    color: '', set_color: false, notes: '', set_notes: false, jump: '', set_jump: false, credential: '', set_credential: false,
    key: '', set_key: false, password: '', set_password: false, command: '', set_command: false, keep_shell: true,
    set_keep_shell: false, sudo_password: '', set_sudo_password: false, type: '', set_type: false, domain: '', set_domain: false });
  const has = async (alias) => JSON.stringify(await window.backend.catalog({})).includes('"' + alias + '"');
  try {
    // Unlocked through the window's own unlock screen, as a person would.
    const q = (sel) => document.querySelector(sel);
    const t0 = Date.now();
    while (!q('#pw')) { if (Date.now() - t0 > 30000) throw new Error('no unlock screen'); await sleep(100); }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(q('#pw'), '$NEW_PW');
    q('#pw').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    q('button[type="submit"]').click();
    for (;;) {
      try { await window.backend.catalog({}); break; } catch (e) { if (Date.now() - t0 > 30000) throw new Error('not unlocked: ' + e); }
      await sleep(100);
    }
    // A change made in the app: the loop uploads it once it settles.
    await sleep(1500);
    await window.backend.host_add(patch('app-made', '10.0.3.3'));
    await window.backend.e2e_log({ name: 'diag: +' + (Date.now() - t0p) + ' ms app-made added' });
    // Another machine's change: merged on the loop's own, by the 60 s interval.
    const start = Date.now();
    while (!(await has('from-b'))) {
      if (Date.now() - start > 100000) throw new Error('no from-b after 100 s; heard ' + seen.join(','));
      await sleep(250);
    }
    await window.backend.e2e_log({ name: 'heard ' + seen.join(',') });
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await window.backend.e2e_report({ ok: false, detail: String(e && e.message || e) });
  }
  window.runtime.Quit();
})();
JS
  FLINT_SYNC_DIAG=1 FLINT_CONFIG_DIR="$short" FLINT_GUI_E2E="$tmp/app.js" "${app[@]}" >"$tmp/app.log" 2>&1 &
  app_pid=$!
  app_t0=$(date +%s)
  got_it=""
  for _ in $(seq 1 30); do
    sleep 1
    printf '%s\n' "$PW" | FLINT_CONFIG_DIR="$tmp/b" no_tty "$flint" --vault "$VB" vault sync --master-stdin >/dev/null 2>&1
    [[ "$(aliases b "$VB")" == *app-made* ]] && { got_it=1; break; }
  done
  check "the app uploaded its change within seconds" '[[ -n "$got_it" ]]'
  echo "diag: +$(( $(date +%s) - app_t0 )) s since the app started: B adds from-b"
  on b 0 "B adds a host" "$PW"$'\n' -- --vault "$VB" host add from-b --hostname 10.0.4.4 --master-stdin
  echo "diag: +$(( $(date +%s) - app_t0 )) s: B's add returned ($(grep -c 'PUT /v1/vault 200' "$tmp/server.log") uploads so far)"
  wait "$app_pid"; app_pid=""
  check "the app merged B's change on its own (within the 60 s interval)" 'grep -q "^e2e: pass" "$tmp/app.log"'
  check "the app reported its syncs to the page" 'grep -q "heard .*uploaded" "$tmp/app.log" && grep -q "heard .*merged" "$tmp/app.log"'
  check "the token is not in the app's log" '! grep -q "$TOKEN" "$tmp/app.log"'
  grep -q "^e2e: pass" "$tmp/app.log" || { echo "---- app log"; grep -v '^\s*$' "$tmp/app.log" | grep -v 'diag: sync tick' | tail -30; echo "---- loop ticks (first 6, last 6)"; grep 'diag: sync tick' "$tmp/app.log" | head -6; grep 'diag: sync tick' "$tmp/app.log" | tail -6; grep -c 'diag: sync tick' "$tmp/app.log"; echo "---- server log"; tail -15 "$tmp/server.log"; }
  cp "$short/remotes.json" "$tmp/a/remotes.json"
  rm -rf "$short"
else
  echo "skip  the app's part (macOS: FLINT_SYNC_E2E_APP=1 with someone to answer the keychain dialog, D-099)"
fi

echo "== disconnect"
on b 0 "disconnect" "" -- --json --vault "$VB" vault disconnect
on b 3 "a disconnected vault does not sync" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
on b 0 "status: local again" "" -- --vault "$VB" vault status
check "remote none" '[[ "$out" == *"remote"*"none (a local vault"* ]]'
check "the file stays" '[[ -f "$VB" ]]'

echo "== the token never shows"
check "not in any output" '! grep -q "$TOKEN" "$all_out"'
check "not in either config folder" '! grep -rq "$TOKEN" "$tmp/a" "$tmp/b"'
check "not in the server log" '! grep -q "$TOKEN" "$tmp/server.log"'
check "no host name in remotes.json" '! grep -q -e web -e 10.0.0 "$tmp/a/remotes.json"'

echo
echo "sync-e2e: $((checks - failures)) passed, $failures failed"
[[ "$failures" == 0 ]]
