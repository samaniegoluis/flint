#!/usr/bin/env bash
# End-to-end checks of flint-vault-server (milestone 42, D-097): the real binary on a
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
    docker exec "flint-server-e2e-$name-$$" flint-vault-server "$@"
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
check "another vault id is 412" "412" "$(put "$tmp/v2.bin" 'If-Match: "2"' ffeeddccbbaa99887766554433221100)"
check "a chunked upload is 411" "411" "$(status -X PUT "${auth[@]}" -H 'If-Match: "2"' -H "X-Flint-Vault-Id: $vid" -H 'Transfer-Encoding: chunked' --data-binary @"$tmp/v2.bin" "$url")"
head -c 1500000 /dev/zero >"$tmp/big.bin"
check "an upload over the cap is 413" "413" "$(put "$tmp/big.bin" 'If-Match: "2"')"

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

# A client that stalls in its headers holds the server only until the header deadline.
stall_out="$(python3 -I - "$port" "$url" "$token" <<'PY'
import socket, subprocess, sys, time
s = socket.create_connection(("127.0.0.1", int(sys.argv[1])))
s.sendall(b"GET /v1/vault HTTP/1.1\r\nHost: x\r\n")
time.sleep(0.2)
t = time.time()
r = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "30",
                    "-H", "Authorization: Bearer " + sys.argv[3], sys.argv[2]], capture_output=True)
waited = time.time() - t
s.settimeout(5)
got = s.recv(100).split(b"\r\n")[0].decode()
print("%s %s %d" % (got, r.stdout.decode(), 1 if waited < 11.5 else 0))
PY
)"
check "a stalled client gets 408 at the deadline; the next one is served" "HTTP/1.1 408 Request Timeout 200 1" "$stall_out"

# The rate limit: 120 a minute per client.
codes="$(for _ in $(seq 125); do status "${auth[@]}" "$url"; echo; done | sort | uniq -c | awk '{print $2":"$1}' | tr '\n' ' ')"
check "the 121st request in a minute is 429" "1" "$(echo "$codes" | grep -c '429:')"
check "429 says when to come back" "1" "$([[ "$(header Retry-After "${auth[@]}" "$url")" -ge 1 ]] && echo 1)"

# The log: one line per request, never the token or the file.
check "the log never holds the token" "0" "$(grep -c "$token" "$tmp/main/log" || true)"
check "the log never holds the file" "0" "$(grep -c 'MARKER-BLOB' "$tmp/main/log" || true)"
check "the log has a line per request" "1" "$([[ $(grep -c ' /v1/vault ' "$tmp/main/log") -gt 100 ]] && echo 1)"
check "stored files are owner-only" "600" "$(file_mode main versions/1.blob)"

# SIGTERM ends it cleanly.
stop_server main
check "SIGTERM stops the server with 0" "0" "$stopped"

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
check "restore says what it did" "1" "$(grep -c 'version 5 is now version 14' "$tmp/restore.out")"
check "the server serves the restored file as version 14" '"14" v5' "$(header ETag "${auth[@]}" "${xff[@]}" "$url") $(curl -s -m 5 "${auth[@]}" "${xff[@]}" "$url")"
check "restore --json names the new version" "15" "$(in_server proxy restore 6 --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
set +e
in_server proxy restore 2 >/dev/null 2>"$tmp/restore.err"; rc=$?
set -e
check "a version no longer kept cannot be restored" "1" "$([[ $rc -ne 0 ]] && grep -c 'not kept' "$tmp/restore.err")"
check "a machine that had version 13 gets 409 after the restore" "409" "$(status -X PUT "${auth[@]}" "${xff[@]}" -H 'If-Match: "13"' -H "X-Flint-Vault-Id: $vid" --data-binary @"$tmp/h.bin" "$url")"

echo
echo "server-e2e: $pass passed, $fail failed"
[[ $fail -eq 0 ]]
