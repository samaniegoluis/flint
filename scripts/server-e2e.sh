#!/usr/bin/env bash
# End-to-end checks of flint-vault-server (milestones 42 and 45, D-097, D-103): the real binary on a
# loopback port with a throwaway data folder, driven by curl and by raw sockets (a
# client that stalls, a body cut short). Builds the server first unless
# FLINT_SERVER_BIN names one. With FLINT_SERVER_IMAGE, the same checks run against that
# Docker image instead (scripts/server-image.sh builds it).
#
#   scripts/server-e2e.sh
#   FLINT_SERVER_IMAGE=ghcr.io/samaniegoluis/flint-vault-server:latest scripts/server-e2e.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$root/scripts/env.sh"
bin="${FLINT_SERVER_BIN:-$root/build/flint-vault-server}"
image="${FLINT_SERVER_IMAGE:-}"
if [[ -z "${FLINT_SERVER_BIN:-}" && -z "$image" ]]; then
  (cd "$root" && cfire build flint-vault-server >/dev/null)
fi

tmp="$(mktemp -d "${TMPDIR:-/tmp}/flint-server-e2e.XXXXXX")"
pids=()
containers=()
cleanup() {
  local st=$?
  for p in "${pids[@]+"${pids[@]}"}"; do kill "$p" 2>/dev/null || true; done
  for c in "${containers[@]+"${containers[@]}"}"; do docker rm -f "$c" >/dev/null 2>&1 || true; done
  rm -rf "$tmp"
  exit "$st"
}
trap cleanup EXIT

pass=0
fail=0
check() {  # <name> <expected> <actual>
  if [[ "$2" == "$3" ]]; then
    pass=$((pass + 1)); echo "ok   $1"
  else
    fail=$((fail + 1)); echo "FAIL $1: expected [$2], got [$3]"
  fi
}

free_port() { python3 -I -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])'; }

# run_server <env...> -- <args...>: the server binary, here or in a throwaway container.
run_server() {
  local envs=()
  while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  shift
  if [[ -n "$image" ]]; then
    local eargs=()
    for e in "${envs[@]+"${envs[@]}"}"; do
      case "$e" in -u) ;; FLINT_*) eargs+=(-e "$e") ;; esac
    done
    docker run --rm "${eargs[@]+"${eargs[@]}"}" "$image" "$@"
  else
    env "${envs[@]+"${envs[@]}"}" "$bin" "$@"
  fi
}

tokens="$(run_server -- token --json)"
token="$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["token"])' "$tokens")"
hash="$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1])["hash"])' "$tokens")"
check "token is 64 hex" "64" "${#token}"

# start <name> <env...>: starts a server, sets $port and $url.
start() {
  local name="$1"; shift
  port="$(free_port)"
  mkdir -p "$tmp/$name"
  if [[ -n "$image" ]]; then
    local eargs=()
    for e in "$@"; do eargs+=(-e "$e"); done
    local c="flint-server-e2e-$name-$$"
    docker run -d --name "$c" -p "127.0.0.1:$port:8787" "${eargs[@]}" "$image" >/dev/null
    containers+=("$c")
    # The container's log, copied into the file the checks read.
    (docker logs -f "$c" >"$tmp/$name/log" 2>&1 &)
  else
    env "$@" FLINT_VAULT_LISTEN="127.0.0.1:$port" FLINT_VAULT_DATA="$tmp/$name/data" \
      "$bin" serve >"$tmp/$name/log" 2>&1 &
    pids+=($!)
  fi
  url="http://127.0.0.1:$port/v1/vault"
  for _ in $(seq 100); do
    grep -q listening "$tmp/$name/log" 2>/dev/null && return 0
    sleep 0.1
  done
  echo "server $name did not start:"; cat "$tmp/$name/log"; exit 1
}

# in_server <name> <args...>: a server subcommand over that server's data folder.
in_server() {
  local name="$1"; shift
  if [[ -n "$image" ]]; then
    docker exec -i "flint-server-e2e-$name-$$" flint-vault-server "$@"
  else
    FLINT_VAULT_DATA="$tmp/$name/data" "$bin" "$@"
  fi
}

# file_mode <name> <path in the data folder>
file_mode() {
  if [[ -n "$image" ]]; then
    docker exec "flint-server-e2e-$1-$$" stat -c %a "/data/$2"
  else
    # GNU stat first: on Linux `stat -f` is the file system's status and succeeds.
    stat -c %a "$tmp/$1/data/$2" 2>/dev/null || stat -f %Lp "$tmp/$1/data/$2"
  fi
}

# stop_server <name>: SIGTERM; the exit status lands in $stopped (not run in a subshell,
# which could not wait for the server).
stop_server() {
  if [[ -n "$image" ]]; then
    local c="flint-server-e2e-$1-$$"
    docker stop -t 10 "$c" >/dev/null
    stopped="$(docker inspect -f '{{.State.ExitCode}}' "$c")"
  else
    kill -TERM "${pids[0]}"
    set +e; wait "${pids[0]}"; stopped=$?; set -e
    pids=("${pids[@]:1}")
  fi
}

vid="00112233445566778899aabbccddeeff"
auth=(-H "Authorization: Bearer $token")
status() { curl -s -o /dev/null -w '%{http_code}' -m 20 "$@"; }
header() {  # <name> <curl args...>: the value of one response header
  local h="$1"; shift
  curl -s -D - -o /dev/null -m 20 "$@" | tr -d '\r' | awk -v h="$(echo "$h" | tr 'A-Z' 'a-z')" -F': ' 'tolower($1)==h {print $2}'
}

# --- refused at start ---------------------------------------------------------------
set +e
run_server FLINT_VAULT_TOKEN=short -- serve >/dev/null 2>"$tmp/short.err"; rc=$?
run_server FLINT_VAULT_TOKEN="$token" FLINT_VAULT_TOKEN_HASH="$hash" -- serve >/dev/null 2>"$tmp/both.err"; rc2=$?
run_server -u FLINT_VAULT_TOKEN -u FLINT_VAULT_TOKEN_HASH -- serve >/dev/null 2>"$tmp/none.err"; rc3=$?
set -e
check "a short token is refused at start" "1" "$([[ $rc -ne 0 ]] && grep -c 'shorter than 32' "$tmp/short.err")"
check "token and hash together are refused" "1" "$([[ $rc2 -ne 0 ]] && grep -c 'not both' "$tmp/both.err")"
check "no token is refused" "1" "$([[ $rc3 -ne 0 ]] && grep -c 'FLINT_VAULT_TOKEN' "$tmp/none.err")"

# --- the protocol, with only the token's hash on the server ------------------------------
start main FLINT_VAULT_TOKEN_HASH="$hash" FLINT_VAULT_MAX_BYTES=1000000
check "GET without a token is 401" "401" "$(status "$url")"
check "401 names the Bearer scheme" "Bearer" "$(header WWW-Authenticate "$url")"
check "GET with a wrong token is 401" "401" "$(status -H 'Authorization: Bearer nope' "$url")"
check "GET on an empty server is 404" "404" "$(status "${auth[@]}" "$url")"
check "another path is 404" "404" "$(status "${auth[@]}" "http://127.0.0.1:$port/v1/other")"
check "DELETE is 405" "405" "$(status -X DELETE "${auth[@]}" "$url")"

python3 -I -c 'import sys; sys.stdout.buffer.write(bytes(range(256)) * 1200 + b"MARKER-BLOB-1")' >"$tmp/v1.bin"
put() {  # <file> <precondition header> [vault id]
  status -X PUT "${auth[@]}" -H "$2" -H "X-Flint-Vault-Id: ${3:-$vid}" \
    -H 'Content-Type: application/octet-stream' --data-binary @"$1" "$url"
}
check "PUT without If-Match is 428" "428" "$(status -X PUT "${auth[@]}" -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/v1.bin" "$url")"
check "PUT without a vault id is 400" "400" "$(status -X PUT "${auth[@]}" -H 'If-None-Match: *' --data-binary @"$tmp/v1.bin" "$url")"
check "the first upload is 200" "200" "$(put "$tmp/v1.bin" 'If-None-Match: *')"
check "it is version 1" '"1"' "$(header ETag "${auth[@]}" "$url")"
check "GET names the vault" "$vid" "$(header X-Flint-Vault-Id "${auth[@]}" "$url")"
curl -s -m 20 "${auth[@]}" -o "$tmp/got1.bin" "$url"
check "GET returns the file byte for byte" "same" "$(cmp -s "$tmp/v1.bin" "$tmp/got1.bin" && echo same || echo differs)"

printf 'second' >"$tmp/v2.bin"
check "PUT over version 1 is 200" "200" "$(put "$tmp/v2.bin" 'If-Match: "1"')"
check "a stale If-Match is 409" "409" "$(put "$tmp/v2.bin" 'If-Match: "1"')"
check "409 names the newest version" '"2"' "$(header ETag -X PUT "${auth[@]}" -H 'If-Match: "1"' -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/v2.bin" "$url")"
check "a first upload over a vault is 409" "409" "$(put "$tmp/v2.bin" 'If-None-Match: *')"
check "GET naming the newest version is 304" "304" "$(status "${auth[@]}" -H 'If-None-Match: "2"' "$url")"
check "a 304 carries no body" "0" "$(curl -s -m 20 "${auth[@]}" -H 'If-None-Match: "2"' "$url" | wc -c | tr -d ' ')"
check "GET naming an older version is the file" "second" "$(curl -s -m 20 "${auth[@]}" -H 'If-None-Match: "1"' "$url")"
check "another vault id is 412" "412" "$(put "$tmp/v2.bin" 'If-Match: "2"' ffeeddccbbaa99887766554433221100)"
head -c 1500000 /dev/zero >"$tmp/big.bin"
check "an upload over the cap is 413" "413" "$(put "$tmp/big.bin" 'If-Match: "2"')"
# Chunked bodies are decoded under the same cap since milestone 78 (CF-140).
check "a chunked upload over the cap is 413" "413" "$(status -X PUT "${auth[@]}" -H 'If-Match: "2"' -H "X-Flint-Vault-Id: $vid" -H 'Transfer-Encoding: chunked' --data-binary @"$tmp/big.bin" "$url")"
check "a PUT with no body and no length is 411" "411" "$(status -X PUT "${auth[@]}" -H 'If-Match: "2"' -H "X-Flint-Vault-Id: $vid" -H 'Content-Length:' "$url")"

# A body cut short: Content-Length 1000, ten bytes, then the client goes away.
python3 -I - "$port" "$token" "$vid" <<'PY'
import socket, sys
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
s.sendall(("PUT /v1/vault HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer %s\r\nIf-Match: \"2\"\r\n"
           "X-Flint-Vault-Id: %s\r\nContent-Length: 1000\r\n\r\n0123456789" % (sys.argv[2], sys.argv[3])).encode())
s.close()
PY
sleep 0.3
check "a body cut short stores nothing" '"2"' "$(header ETag "${auth[@]}" "$url")"

# A client that stalls in its headers gets 408 at the header deadline, and holds no one
# else meanwhile (milestone 78: the event loop waits on it, not a worker).
stall_out="$(python3 -I - "$port" "$url" "$token" <<'PY'
import socket, subprocess, sys, time
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
s.sendall(b"GET /v1/vault HTTP/1.1\r\nHost: x\r\n")
time.sleep(0.2)
t = time.time()
r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "30",
                    "-H", "Authorization: Bearer " + sys.argv[3], sys.argv[2]], capture_output=True)
waited = time.time() - t
s.settimeout(15)
got = s.recv(100).split(b"\r\n")[0].decode()
print("%s %s %d" % (" ".join(got.split(" ")[:2]), r.stdout.decode(), 1 if waited < 2 else 0))
PY
)"
check "a stalled client gets 408 at the deadline; another is served meanwhile" "HTTP/1.1 408 200 1" "$stall_out"

# The rate limit: 120 a minute per client.
codes="$(for _ in $(seq 125); do status "${auth[@]}" "$url"; echo; done | sort | uniq -c | awk '{print $2":"$1}' | tr '\n' ' ')"
check "the 121st request in a minute is 429" "1" "$(echo "$codes" | grep -c '429:')"
check "429 says when to come back" "1" "$([[ "$(header Retry-After "${auth[@]}" "$url")" -ge 1 ]] && echo 1)"

# The log: one line per request, never the token or the file.
check "the log never holds the token" "0" "$(grep -c "$token" "$tmp/main/log" || true)"
check "the log never holds the file" "0" "$(grep -c 'MARKER-BLOB' "$tmp/main/log" || true)"
check "the log has a line per request" "1" "$([[ $(grep -c ' /v1/vault ' "$tmp/main/log") -gt 100 ]] && echo 1)"
# Windows has no POSIX modes (a file takes its folder's ACL; owner, 2026-11-18: skipped
# there, as in serverfs's suite). The server ships for Linux.
case "$(uname -s)" in
  MINGW*|MSYS*) echo "skip owner-only files (no POSIX modes on Windows)" ;;
  *) check "stored files are owner-only" "600" "$(file_mode main "vaults/$vid/versions/1.blob")" ;;
esac

# SIGTERM ends it cleanly. Windows has no signals: MSYS2's kill ends a native process
# with TerminateProcess (143), so the check skips there (owner, 2026-11-18; ROADMAP §7,
# "A clean stop for flint-vault-server on Windows").
stop_server main
case "$(uname -s)" in
  MINGW*|MSYS*) echo "skip SIGTERM stops the server with 0 (no signals on Windows)" ;;
  *) check "SIGTERM stops the server with 0" "0" "$stopped" ;;
esac

# --- lockout per client, behind a trusted proxy ---------------------------------------------
start proxy FLINT_VAULT_TOKEN="$token" FLINT_VAULT_TRUST_PROXY=1
for _ in $(seq 10); do status -H 'X-Forwarded-For: 198.51.100.7, 203.0.113.9' -H 'Authorization: Bearer wrong' "$url" >/dev/null; done
check "after 10 bad tokens the client is locked out, even with the right one" "429" "$(status -H 'X-Forwarded-For: 203.0.113.9' "${auth[@]}" "$url")"
check "another client behind the same proxy is not" "404" "$(status -H 'X-Forwarded-For: 203.0.113.10' "${auth[@]}" "$url")"
check "the log names the client by its forwarded address" "1" "$(grep -c '203.0.113.9 GET /v1/vault 401 .*locked out' "$tmp/proxy/log")"

# --- the history: ten versions kept, and restore --------------------------------------------
xff=(-H 'X-Forwarded-For: 192.0.2.1')
printf 'v1' >"$tmp/h.bin"
status -X PUT "${auth[@]}" "${xff[@]}" -H 'If-None-Match: *' -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/h.bin" "$url" >/dev/null
for n in $(seq 2 13); do
  printf "v$n" >"$tmp/h.bin"
  status -X PUT "${auth[@]}" "${xff[@]}" -H "If-Match: \"$((n - 1))\"" -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/h.bin" "$url" >/dev/null
done
listed="$(in_server proxy versions --json | python3 -I -c 'import json,sys; v=json.load(sys.stdin); print(len(v), v[0]["version"], v[-1]["version"])')"
check "ten versions are kept, 13 down to 4" "10 13 4" "$listed"
check "versions prints a table" "1" "$(in_server proxy versions | grep -c "^      4 ")"
in_server proxy restore 5 >"$tmp/restore.out"
check "restore says what it did" "1" "$(grep -c 'version 5 of vault .* is now version 14' "$tmp/restore.out")"
check "the server serves the restored file as version 14" '"14" v5' "$(header ETag "${auth[@]}" "${xff[@]}" "$url") $(curl -s -m 5 "${auth[@]}" "${xff[@]}" "$url")"
check "restore --json names the new version" "15" "$(in_server proxy restore 6 --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
set +e
in_server proxy restore 2 >/dev/null 2>"$tmp/restore.err"; rc=$?
set -e
check "a version no longer kept cannot be restored" "1" "$([[ $rc -ne 0 ]] && grep -c 'not kept' "$tmp/restore.err")"
check "a machine that had version 13 gets 409 after the restore" "409" "$(status -X PUT "${auth[@]}" "${xff[@]}" -H 'If-Match: "13"' -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/h.bin" "$url")"


# --- several vaults on one server (milestone 45, D-103) ---------------------------------------
start many FLINT_VAULT_TOKEN="$token" FLINT_VAULT_MAX_VAULTS=2
base="http://127.0.0.1:$port/v1/vaults"
vid2="ffeeddccbbaa99887766554433221100"
vid3="abababababababababababababababab"
vput() {  # <id> <file> <precondition header>
  status -X PUT "${auth[@]}" -H "$3" -H "X-Flint-Vault-Id: $1" --data-binary @"$2" "$base/$1"
}
printf 'one-1' >"$tmp/m1.bin"; printf 'two-1' >"$tmp/m2.bin"; printf 'one-2' >"$tmp/m3.bin"
check "GET /v1/vaults on an empty server lists none" '{"vaults":[]}' "$(curl -s -m 20 "${auth[@]}" "$base")"
check "a vault not stored is 404" "404" "$(status "${auth[@]}" "$base/$vid")"
check "the first vault's first upload is 200" "200" "$(vput "$vid" "$tmp/m1.bin" 'If-None-Match: *')"
check "the old path serves the one vault" "one-1" "$(curl -s -m 20 "${auth[@]}" "http://127.0.0.1:$port/v1/vault")"
check "a second vault's first upload is 200" "200" "$(vput "$vid2" "$tmp/m2.bin" 'If-None-Match: *')"
check "the first vault goes on to version 2" "200" "$(vput "$vid" "$tmp/m3.bin" 'If-Match: "1"')"
check "each vault keeps its own versions" '"2" "1"' "$(header ETag "${auth[@]}" "$base/$vid") $(header ETag "${auth[@]}" "$base/$vid2")"
check "each vault serves its own file" "one-2 two-1" "$(curl -s -m 20 "${auth[@]}" "$base/$vid") $(curl -s -m 20 "${auth[@]}" "$base/$vid2")"
check "a header naming another vault than the path is 400" "400" "$(status -X PUT "${auth[@]}" -H 'If-Match: "2"' -H "X-Flint-Vault-Id: $vid2" --data-binary @"$tmp/m1.bin" "$base/$vid")"
check "a third vault over FLINT_VAULT_MAX_VAULTS is 507" "507" "$(vput "$vid3" "$tmp/m1.bin" 'If-None-Match: *')"
check "the old path asks to update once there are several" "410" "$(status "${auth[@]}" "http://127.0.0.1:$port/v1/vault")"
check "a label is set over HTTP" "200" "$(status -X PUT "${auth[@]}" --data '{"label":"Work laptop"}' "$base/$vid2/label")"
check "a label with a control character is 400" "400" "$(status -X PUT "${auth[@]}" --data '{"label":"a\u0007b"}' "$base/$vid2/label")"
listed="$(curl -s -m 20 "${auth[@]}" "$base" | python3 -I -c 'import json,sys; v=json.load(sys.stdin)["vaults"]; print(" ".join("%s:%s:%s:%s" % (x["id"][:4], x["version"], x["size"], x["label"] or "-") for x in v))')"
check "the list names each vault's id, version, size and label" "0011:2:5:- ffee:1:5:Work laptop" "$listed"
check "the list needs the token" "401" "$(status "$base")"
check "the log never holds a label" "0" "$(grep -c 'Work laptop' "$tmp/many/log" || true)"
check "vaults lists them on the server" "2" "$(in_server many vaults | grep -c -E '^(0011|ffee)')"
check "versions needs an id once there are several" "1" "$(in_server many versions 2>&1 | grep -c 'keeps 2 vaults')"
check "versions takes a prefix of the id" "2" "$(in_server many versions 0011 --json | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)))')"
in_server many label ffee "Personal" >/dev/null
check "label sets a vault's label on the server" "Personal" "$(in_server many vaults --json | python3 -I -c 'import json,sys; print([v["label"] for v in json.load(sys.stdin) if v["id"].startswith("ffee")][0])')"
in_server many restore 0011 1 >"$tmp/restore-many.out"
check "restore names the vault by prefix and touches no other" '"3" "1"' "$(header ETag "${auth[@]}" "$base/$vid") $(header ETag "${auth[@]}" "$base/$vid2")"

# --- a damaged head, a 500's cause, and delete (milestone 71) ---------------------------------
if [[ -z "$image" ]]; then
  cp "$tmp/many/data/vaults/$vid/head.json" "$tmp/head.good"
  printf '{not json' >"$tmp/many/data/vaults/$vid/head.json"
  check "a damaged head leaves its vault out of the list, not the whole list" "ffee" "$(curl -s -m 20 "${auth[@]}" "$base" | python3 -I -c 'import json,sys; print(" ".join(x["id"][:4] for x in json.load(sys.stdin)["vaults"]))')"
  check "the log names the vault skipped" "1" "$([[ $(grep -c "skipped vault $vid" "$tmp/many/log") -ge 1 ]] && echo 1)"
  check "that vault answers 500" "500" "$(status "${auth[@]}" "$base/$vid")"
  check "the 500's cause is in the log" "1" "$(grep -c "GET /v1/vaults/$vid 500 .*io: .*head.json is not a version record" "$tmp/many/log")"
  check "and not in the reply" "0" "$(curl -s -m 20 "${auth[@]}" "$base/$vid" | grep -c 'head.json' || true)"
  cp "$tmp/head.good" "$tmp/many/data/vaults/$vid/head.json"
fi
set +e
printf 'n\n' | in_server many delete ffee >/dev/null 2>"$tmp/delete-no.err"; rc=$?
set -e
check "delete asks first, and a no deletes nothing" "1 2" "$([[ $rc -ne 0 ]] && grep -c 'nothing was deleted' "$tmp/delete-no.err") $(in_server many vaults --json | python3 -I -c 'import json,sys; print(len(json.load(sys.stdin)))')"
check "the question names the vault and its label" "1" "$(grep -c "vault $vid2 ('Personal')" "$tmp/delete-no.err")"
printf 'y\n' | in_server many delete ffee >"$tmp/delete.out" 2>/dev/null
check "a yes deletes it" "1" "$(grep -c "vault $vid2 deleted" "$tmp/delete.out")"
check "the deleted vault is 404" "404" "$(status "${auth[@]}" "$base/$vid2")"
check "the other one is untouched" '"3"' "$(header ETag "${auth[@]}" "$base/$vid")"
check "with one vault left the old path serves it again" "200" "$(status "${auth[@]}" "http://127.0.0.1:$port/v1/vault")"
check "delete --yes asks nothing" "$vid" "$(in_server many delete 0011 --yes --json </dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["id"])')"
check "the server is empty" '{"vaults":[]}' "$(curl -s -m 20 "${auth[@]}" "$base")"
stop_server many

# --- a data folder from before milestone 45 moves into a folder per vault --------------------
if [[ -z "$image" ]]; then
  mkdir -p "$tmp/legacy/data/versions"
  for n in 1 2; do
    printf "old-$n" >"$tmp/legacy/data/versions/$n.blob"
    printf '{"version":%d,"vault_id":"%s","size":5,"stored_at":%d000}' "$n" "$vid" "$n" >"$tmp/legacy/data/versions/$n.json"
  done
  cp "$tmp/legacy/data/versions/2.json" "$tmp/legacy/data/head.json"
  start legacy FLINT_VAULT_TOKEN="$token"
  check "the server says it moved the vault" "1" "$(grep -c "moved the vault $vid" "$tmp/legacy/log")"
  check "the moved vault is served at its id, as version 2" '"2" old-2' "$(header ETag "${auth[@]}" "http://127.0.0.1:$port/v1/vaults/$vid") $(curl -s -m 20 "${auth[@]}" "http://127.0.0.1:$port/v1/vaults/$vid")"
  check "and at the old path" "old-2" "$(curl -s -m 20 "${auth[@]}" "http://127.0.0.1:$port/v1/vault")"
  check "nothing is left at the top of the data folder" "vaults" "$(ls "$tmp/legacy/data")"
  stop_server legacy
fi

echo
echo "server-e2e: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
