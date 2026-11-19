#!/usr/bin/env bash
# End-to-end run of the remote vault from the CLI (milestones 43-45): the real
# flint-vault-server on loopback and two config folders standing for two machines.
# Both connect, both go offline (the server stopped) and edit, both come back and
# end with every change; an alias taken on both is renamed; a master password
# changed on one is taken by the other; a second vault goes to the same server beside
# the first, with a label, and B downloads it by a prefix of its id (milestone 45);
# the token never shows anywhere.
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
  FLINT_CONFIG_DIR="$tmp/b" FLINT_KEYCHAIN_SERVICE="$(kc_service b)" "$flint" --vault "$VB" vault disconnect >/dev/null 2>&1
  stop_server
  # FLINT_E2E_KEEP=<dir> keeps the app's and the server's logs for a look.
  if [[ -n "${FLINT_E2E_KEEP:-}" ]]; then cp "$tmp/app.log" "$tmp/server.log" "$all_out" "$FLINT_E2E_KEEP/" 2>/dev/null; fi
  rm -rf "$tmp"
}
trap cleanup EXIT

# On Windows (MSYS2) the terminal is the console, which setsid does not take away: the
# command starts with none at all (DETACHED_PROCESS), through the native python.
case "$(uname -s)" in
  MINGW*|MSYS*) no_tty() { python3 -c 'import subprocess, sys; sys.exit(subprocess.call(sys.argv[1:], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr, creationflags=0x8))' "$@"; } ;;
  *) no_tty() { perl -e 'use POSIX qw(setsid); setsid(); exec @ARGV or die "exec: $!"' "$@"; } ;;
esac

# The app to start: the bundle on macOS, Xvfb on Linux, the desktop session on Windows
# (MSYS2: windows/desktop.sh runs this script there).
app_cmd() {
  case "$(uname -s)" in
    Darwin) app=(build/gui/Flint.app/Contents/MacOS/Flint) ;;
    MINGW*|MSYS*) app=(timeout 200 build/gui/Flint.exe) ;;
    *) app=(timeout 200 xvfb-run -a build/gui/Flint) ;;
  esac
}
# The app's config folder holds its socket, whose path must stay short (sun_path): /tmp,
# not macOS's long TMPDIR; on Windows the run's own temp folder (never C:\tmp).
case "$(uname -s)" in MINGW*|MSYS*) short_tmp="$TMPDIR" ;; *) short_tmp=/tmp ;; esac
# Windows has no POSIX modes (a file takes its folder's ACL; owner, 2026-11-18: skipped
# there, as in the suites and server-e2e).
check_0600() {
  case "$(uname -s)" in
    MINGW*|MSYS*) echo "skip  $1 (no POSIX modes on Windows)" ;;
    *) check "$1" "[[ \"\$(file_mode \"$2\")\" == \"600\" ]]" ;;
  esac
}

# Each machine's keychain service. On one Mac every "machine" shares the user's keychain,
# and macOS asks a person before one binary reads an item another saved (D-099): B
# and the app C both hold Lab, so B keeps its tokens under a service of its own, as a
# machine of its own would.
kc_service() { if [[ "$1" == b ]]; then echo "Flint e2e B"; else echo "Flint"; fi; }

# on <machine a|b> <exit code> <description> <stdin text> -- <flint args...>
on() {
  local m="$1" want="$2" desc="$3" input="$4"; shift 5
  checks=$((checks + 1))
  printf '%s' "$input" | FLINT_CONFIG_DIR="$tmp/$m" FLINT_KEYCHAIN_SERVICE="$(kc_service "$m")" no_tty "$flint" "$@" >"$tmp/out" 2>"$tmp/err"
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
check_0600 "B's file is 0600" "$VB"
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
v_before="$(grep -c -E 'PUT /v1/vaults/[0-9a-f]+ 200' "$tmp/server.log")"
on a 0 "A again: in step" "$PW"$'\n' -- --vault "$VA" vault sync --master-stdin
on b 0 "B again: in step" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
check "no empty versions" '[[ "$(grep -c -E "PUT /v1/vaults/[0-9a-f]+ 200" "$tmp/server.log")" == "$v_before" ]]'
check "in-step checks download nothing (304)" '[[ "$(grep -c -E "GET /v1/vaults/[0-9a-f]+ 304" "$tmp/server.log")" -ge 2 ]]'
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

echo "== a second vault on the same server (milestone 45)"
W_PW="copper-meadow-signal-tundra-58"
VAW="$tmp/va/Work.flint"
VBW="$tmp/vb/Work.flint"
waliases() { printf '%s\n' "$W_PW" | FLINT_CONFIG_DIR="$tmp/$1" no_tty "$flint" --json --vault "$2" host list --master-stdin | python3 -c 'import json,sys; print(" ".join(sorted(h["alias"] for h in json.load(sys.stdin))))'; }
on a 0 "create a second vault" "$W_PW"$'\n' -- vault create "$VAW" --master-stdin
on a 0 "add a host to it" "$W_PW"$'\n' -- --vault "$VAW" host add work-db --hostname 10.1.0.5 --master-stdin
on a 7 "a label with a control character is refused" "$W_PW"$'\n'"$TOKEN"$'\n' -- --vault "$VAW" vault connect "$url" --label $'a\tb' --master-stdin --token-stdin
on a 0 "connect it beside the first, with a label" "$W_PW"$'\n'"$TOKEN"$'\n' -- --vault "$VAW" vault connect "$url" --label "Work" --master-stdin --token-stdin
check "uploaded as its own version 1, listed as Work" '[[ "$out" == *"uploaded it (version 1)"* && "$out" == *"lists it as '"'"'Work'"'"'"* ]]'
on b 0 "the server's list, before any password" "$TOKEN"$'\n' -- --json vault connect "$url" --list --token-stdin
check "two vaults, Lab unlabelled and Work labelled" '[[ "$(echo "$out" | json_get "sorted((v[\"label\"] or \"-\") for v in d[\"vaults\"])")" == "['"'"'-'"'"', '"'"'Work'"'"']" ]]'
work_id="$(echo "$out" | json_get "[v[\"id\"] for v in d[\"vaults\"] if v[\"label\"] == \"Work\"][0]")"
lab_id="$(echo "$out" | json_get "[v[\"id\"] for v in d[\"vaults\"] if not v[\"label\"]][0]")"
on b 0 "the list as a table" "$TOKEN"$'\n' -- vault connect "$url" --list --token-stdin
check "the table has the label and the id" '[[ "$out" == *"LABEL"* && "$out" == *"$work_id"*"Work"* ]]'
on b 2 "a download without --id is refused when there are several" "$W_PW"$'\n'"$TOKEN"$'\n' -- vault connect "$url" --to "$VBW" --master-stdin --token-stdin
check "it points to --list and --id" '[[ "$err" == *"--list"* && "$err" == *"--id"* ]]'
check "nothing was written" '[[ ! -f "$VBW" ]]'
on b 3 "an id the server does not keep" "$W_PW"$'\n'"$TOKEN"$'\n' -- vault connect "$url" --to "$VBW" --id 0000ffff --master-stdin --token-stdin
on b 0 "download Work by a prefix of its id" "$W_PW"$'\n'"$TOKEN"$'\n' -- --json vault connect "$url" --to "$VBW" --id "${work_id:0:6}" --master-stdin --token-stdin
check "B has Work's host, and Lab is untouched" '[[ "$(waliases b "$VBW")" == "work-db" && "$(aliases b "$VB")" == *mail* ]]'
lab_puts="$(grep -c -E "PUT /v1/vaults/[0-9a-f]+ 200" "$tmp/server.log")"
on b 0 "B edits Work" "$W_PW"$'\n' -- --vault "$VBW" host add work-api --hostname 10.1.0.6 --master-stdin
on a 0 "A syncs Work" "$W_PW"$'\n' -- --vault "$VAW" vault sync --master-stdin
check "A's Work has B's change" '[[ "$(waliases a "$VAW")" == "work-api work-db" ]]'
on a 0 "A syncs Lab: in step" "$PW"$'\n' -- --vault "$VA" vault sync --master-stdin
check "Lab was not touched by Work's sync" '[[ "$out" == *"in step"* ]]'
check "one upload, Work's" '[[ "$(grep -c -E "PUT /v1/vaults/$work_id 200" "$tmp/server.log")" == "2" && "$(grep -c -E "PUT /v1/vaults/[0-9a-f]+ 200" "$tmp/server.log")" == "$((lab_puts + 1))" ]]'
check "the old single-vault path asks to update" '[[ "$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$url/v1/vault")" == "410" ]]'
check "the label is not in the server's log" '! grep -q "Work" "$tmp/server.log"'
on a 0 "A disconnects Work" "" -- --vault "$VAW" vault disconnect
on b 0 "B disconnects Work" "" -- --vault "$VBW" vault disconnect

echo "== the app keeps a connected vault in step (its sync loop)"
# On macOS the token the CLI saved is behind a system dialog when Flint.app reads it
# (D-099: unsigned builds), so the app's part runs there only with
# FLINT_SYNC_E2E_APP=1 and a person to answer it; on Linux always.
app_default=1
[[ "$(uname -s)" == Darwin ]] && app_default=0
if [[ "${FLINT_SYNC_E2E_APP:-$app_default}" == 1 ]]; then
  "$root/scripts/build-gui.sh" >/dev/null || { echo "sync-e2e: app build failed" >&2; exit 1; }
  app_cmd
  # The page unlocks A's vault, then listens until the CLI adds `stop-app`, and
  # reports every vault:sync it heard. Its socket needs a short path (sun_path).
  short="$(mktemp -d "$short_tmp/fl-sync.XXXXXX")"
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
    await window.backend.e2e_log({ name: 'diag: +' + (Date.now() - t0p) + ' ms unlock screen: ' + document.body.textContent.replace(/\s+/g, ' ').slice(0, 160) });
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(q('#pw'), '$NEW_PW');
    q('#pw').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(50);
    q('button[type="submit"]').click();
    for (;;) {
      try {
        await window.backend.catalog({});
        await window.backend.e2e_log({ name: 'diag: +' + (Date.now() - t0p) + ' ms unlocked' });
        break;
      } catch (e) {
        if (Date.now() - t0 > 30000) {
          await window.backend.e2e_log({ name: 'diag: +' + (Date.now() - t0p) + ' ms still locked; page: ' + document.body.textContent.replace(/\s+/g, ' ').slice(0, 300) });
          throw new Error('not unlocked: ' + e);
        }
      }
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
    // The catalog shows B's host once the merge is saved, a moment before the loop's
    // vault:sync event for that sync arrives: wait for the event too.
    const merged = Date.now();
    while (!seen.includes('merged') && Date.now() - merged < 10000) await sleep(100);
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
    printf '%s\n' "$PW" | FLINT_CONFIG_DIR="$tmp/b" FLINT_KEYCHAIN_SERVICE="$(kc_service b)" no_tty "$flint" --vault "$VB" vault sync --master-stdin >/dev/null 2>&1
    [[ "$(aliases b "$VB")" == *app-made* ]] && { got_it=1; break; }
  done
  check "the app uploaded its change within seconds" '[[ -n "$got_it" ]]'
  echo "diag: +$(( $(date +%s) - app_t0 )) s since the app started: B adds from-b"
  on b 0 "B adds a host" "$PW"$'\n' -- --vault "$VB" host add from-b --hostname 10.0.4.4 --master-stdin
  echo "diag: +$(( $(date +%s) - app_t0 )) s: B's add returned ($(grep -c -E 'PUT /v1/vaults/[0-9a-f]+ 200' "$tmp/server.log") uploads so far)"
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

echo "== replace the token"
on b 12 "a token the server refuses" "wrong-token-wrong-token-wrong-token-2"$'\n' -- --vault "$VB" vault token --token-stdin
on b 0 "B still syncs with the old one" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
on b 0 "a token the server takes" "$TOKEN"$'\n' -- --json --vault "$VB" vault token --token-stdin
check "--json names the server, not the token" '[[ "$(echo "$out" | json_get "d[\"url\"]")" == "$url" ]] && [[ "$out" != *"$TOKEN"* ]]'
on b 0 "B syncs with the new one" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
on a 3 "a vault not connected has no token to replace" "$TOKEN"$'\n' -- --vault "$tmp/va/Weak.flint" vault token --token-stdin

echo "== disconnect"
on b 0 "disconnect" "" -- --json --vault "$VB" vault disconnect
on b 3 "a disconnected vault does not sync" "$PW"$'\n' -- --vault "$VB" vault sync --master-stdin
on b 0 "status: local again" "" -- --vault "$VB" vault status
check "remote none" '[[ "$out" == *"remote"*"none (a local vault"* ]]'
check "the file stays" '[[ -f "$VB" ]]'

echo "== the app connects on its own (milestone 44: Welcome, Settings, the status bar)"
# A third machine, C, with an empty config folder: the app downloads the vault through
# Connect to a remote vault, syncs B's change from the status bar, replaces its token,
# disconnects and connects again from Settings, driving the page as a person would.
# The token is saved by the app itself, so macOS asks nothing (D-099): it runs on both.
on a 0 "A disconnects, so the app's keychain item is its own" "" -- --vault "$VA" vault disconnect
on b 0 "B connects again" "$PW"$'\n'"$TOKEN"$'\n' -- --vault "$VB" vault connect "$url" --master-stdin --token-stdin
"$root/scripts/build-gui.sh" >/dev/null || { echo "sync-e2e: app build failed" >&2; exit 1; }
app_cmd
short_c="$(mktemp -d "$short_tmp/fl-sync.XXXXXX")"
VC="$tmp/vc/Lab.flint"
mkdir -p "$tmp/vc"
cat > "$tmp/app-c.js" <<JS
(async () => {
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  const log = (name) => window.backend.e2e_log({ name });
  const q = (sel) => document.querySelector(sel);
  const waitFor = async (fn, what, ms = 20000) => {
    const t0 = Date.now();
    for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out: ' + what); await sleep(100); }
  };
  const type = (sel, value) => {
    const el = q(sel); if (!el) throw new Error('no ' + sel);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const click = (sel) => { const el = q(sel); if (!el) throw new Error('no ' + sel); el.click(); };
  const byText = (root, text) => [...(root || document).querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));
  const submit = async (form) => { await sleep(50); const b = q(form + ' button[type="submit"]'); await waitFor(() => !b.disabled, 'submit enabled in ' + form); b.click(); };
  const has = async (alias) => JSON.stringify(await window.backend.catalog({})).includes('"' + alias + '"');
  try {
    await waitFor(() => q('[data-connect-remote]'), 'Welcome');
    click('[data-connect-remote]');
    await waitFor(() => q('#sa'), 'Connect to a remote vault');
    type('#sa', 'http://vault.example.com'); type('#st', '$TOKEN');
    await submit('form[aria-label="Connect to a remote vault"]');
    await waitFor(() => q('#sa-e') && q('#sa-e').textContent.includes('https'), 'plain http refused under the address');
    type('#sa', '$url'); type('#st', 'wrong-token-wrong-token-wrong-token-3');
    await submit('form[aria-label="Connect to a remote vault"]');
    await waitFor(() => q('#st-e'), 'a wrong token refused under the token');
    type('#st', '$TOKEN');
    await submit('form[aria-label="Connect to a remote vault"]');
    await waitFor(() => q('[data-connect-step="vault"]'), 'the vault found');
    // The server keeps Lab and Work (milestone 45): a list to choose from, Work by its label.
    await waitFor(() => q('[data-server-vaults="2"]'), 'the list of the two vaults');
    if (!q('[data-server-vault="$work_id"]').textContent.includes('Work')) throw new Error('Work is not shown by its label');
    if (!q('[data-server-vault="$lab_id"]').textContent.includes('No label')) throw new Error('Lab is not shown as unlabelled');
    type('#vp', 'not-the-password-at-all-17'); type('input[aria-label="Local copy path"]', '$VC');
    await sleep(100);
    if (!q('form[aria-label="Connect to a remote vault"] button[type="submit"]').disabled) throw new Error('Download is enabled before a vault is chosen');
    q('[data-server-vault="$lab_id"] input').click();
    await log('chose Lab from the list of two');
    await submit('form[aria-label="Connect to a remote vault"]');
    await waitFor(() => document.body.textContent.includes('does not open with that master password'), 'a wrong master password refused');
    type('#vp', '$PW');
    await submit('form[aria-label="Connect to a remote vault"]');
    await waitFor(() => q('.statusbar'), 'the main window', 60000);
    if (!(await has('mail'))) throw new Error('the downloaded vault lacks mail');
    await waitFor(() => q('[data-sync-item]'), 'the sync item in the status bar');
    await log('downloaded; status bar says ' + q('[data-sync-item]').dataset.syncItem);
    // Another machine's change, synced from the status bar's popover.
    await window.backend.e2e_log({ name: 'ready-for-b' });
    const t0 = Date.now();
    while (!(await has('to-c'))) {
      if (Date.now() - t0 > 60000) throw new Error('no to-c after 60 s');
      if (q('[data-sync-item="in_step"]')) {
        if (!q('[data-pop-sync-now]')) click('[data-sync-item]');
        const b = await waitFor(() => q('[data-pop-sync-now]:not([disabled])'), 'the popover');
        b.click();
      }
      await sleep(1000);
    }
    await waitFor(() => q('[data-toast-action]'), 'the merge toast');
    click('[data-toast-action]');
    await waitFor(() => q('[data-merge-details]') && q('[data-merge-details]').textContent.includes('to-c'), 'the merge details');
    await log('merge details: ' + q('[data-merge-details]').textContent.replace(/\s+/g, ' ').slice(0, 120));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(300);
    if (q('[data-merge-details]')) byText(q('.modal'), 'Close').click();
    // Settings → Vault → Server.
    click('[data-item="settings"]');
    await waitFor(() => byText(document, 'Vault'), 'Settings');
    byText(document, 'Vault').click();
    await waitFor(() => q('[data-server="on"]'), 'Server, connected');
    click('[data-replace-token]');
    await waitFor(() => q('#rtk'), 'Replace token');
    type('#rtk', 'wrong-token-wrong-token-wrong-token-4');
    await submit('form[aria-label="Replace token"]');
    await waitFor(() => q('#rtk-e'), 'a refused token kept the old one');
    type('#rtk', '$TOKEN');
    await submit('form[aria-label="Replace token"]');
    await waitFor(() => !q('#rtk'), 'token replaced');
    click('[data-disconnect-server]');
    await waitFor(() => byText(q('.modal'), 'Disconnect'), 'the disconnect confirm');
    byText(q('.modal'), 'Disconnect').click();
    await waitFor(() => q('[data-server="off"]'), 'Server, not connected');
    if (q('[data-sync-item]')) throw new Error('the status bar still shows a sync item');
    click('[data-connect-server]');
    await waitFor(() => q('#csa'), 'Connect to a server');
    type('#csa', '$url'); type('#cst', '$TOKEN'); type('#csl', 'Lab at home'); type('#cmp', '$PW');
    await submit('form[aria-label="Connect to a server"]');
    await waitFor(() => q('[data-connect-outcome]'), 'connected again', 30000);
    await log('connect outcome: ' + q('[data-connect-outcome]').dataset.connectOutcome);
    // Leave no keychain item behind.
    await window.backend.vault_remote_disconnect({});
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    const m = q('.modal');
    if (m) await log('diag: open modal: ' + m.textContent.replace(/\s+/g, ' ').slice(0, 300));
    await window.backend.e2e_report({ ok: false, detail: String(e && e.message || e) });
  }
  window.runtime.Quit();
})();
JS
FLINT_CONFIG_DIR="$short_c" FLINT_GUI_E2E="$tmp/app-c.js" "${app[@]}" >"$tmp/app-c.log" 2>&1 &
app_pid=$!
for _ in $(seq 1 90); do grep -q "ready-for-b" "$tmp/app-c.log" && break; sleep 1; done
on b 0 "B adds a host for C" "$PW"$'\n' -- --vault "$VB" host add to-c --hostname 10.0.5.5 --master-stdin
wait "$app_pid"; app_pid=""
check "the app downloaded, synced, replaced the token, disconnected and connected again" 'grep -q "^e2e: pass" "$tmp/app-c.log"'
check "it reconnected by merging with the server's copy" 'grep -q "connect outcome: merged" "$tmp/app-c.log"'
check "it chose Lab from the server's list of two" 'grep -q "chose Lab from the list of two" "$tmp/app-c.log"'
check "the label it gave is in the server's list" '[[ "$(printf "%s\n" "$TOKEN" | FLINT_CONFIG_DIR="$tmp/b" no_tty "$flint" --json vault connect "$url" --list --token-stdin | json_get "[v[\"label\"] for v in d[\"vaults\"] if v[\"id\"] == \"$lab_id\"][0]")" == "Lab at home" ]]'
check "the token is not in the app's log" '! grep -q "$TOKEN" "$tmp/app-c.log"'
check_0600 "C's file is 0600" "$VC"
grep -q "^e2e: pass" "$tmp/app-c.log" || { echo "---- app log"; grep -v '^\s*$' "$tmp/app-c.log" | tail -30; echo "---- server log"; tail -15 "$tmp/server.log"; }
rm -rf "$short_c"
on b 0 "B disconnects again" "" -- --vault "$VB" vault disconnect

echo "== the token never shows"
check "not in any output" '! grep -q "$TOKEN" "$all_out"'
check "not in either config folder" '! grep -rq "$TOKEN" "$tmp/a" "$tmp/b"'
check "not in the server log" '! grep -q "$TOKEN" "$tmp/server.log"'
check "no host name in remotes.json" '! grep -q -e web -e 10.0.0 "$tmp/a/remotes.json"'

echo
echo "sync-e2e: $((checks - failures)) passed, $failures failed"
[[ "$failures" == 0 ]]
