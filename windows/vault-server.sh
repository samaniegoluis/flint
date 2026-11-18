# source windows/vault-server.sh — a flint-vault-server for checks run on Windows
# (milestones 43-44: the remote vault adapter's suite, sync on Windows), scripts/test.sh's
# twin on macOS and Linux.
#
#   vault_server_start <folder in WSL> [port]   # exports FLINT_TEST_VAULT_URL,
#                                               # FLINT_TEST_VAULT_TOKEN, FLINT_TEST_VAULT_DATA
#                                               # and adds the first two to WSLENV
#   vault_server_stop
#
# VAULT_SERVER_TOKEN keeps a token across a stop and a start (sync-e2e.sh takes the
# server down and up again); the data folder and the log ($d/vault-server.log, appended)
# carry over too.
#
# The server has no Windows build (its shim is POSIX sockets, milestone 42; it runs in
# Docker), so it is the Linux binary, built here, listening in WSL on 127.0.0.2, with
# ssh-relay.ps1 carrying Windows' 127.0.0.1:<port> to it (why 127.0.0.2 and a relay: see
# ssh-relay.ps1), on <port> + 1: with WSL's mirrored networking a Linux listener holds its
# port on Windows too, so the relay cannot take the same one. Windows programs then see a
# server on loopback, as the CLI requires for plain http. The default port is 34787, not
# scripts/test.sh's 38787: mirrored networking reserves Linux's ephemeral port range
# (/proc/sys/net/ipv4/ip_local_port_range, 36429-40525 here) on Windows, where binding a
# port in it fails with "Only one usage of each socket address". Nothing listens beyond loopback on either side.
_vs_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_vs_root="$(cd "$_vs_here/.." && pwd)"
_vs_pid=""
_vs_relay=""
_vs_inner=""

vault_server_start() {  # <folder> [port]
  local d="$1" port="${2:-34787}" token inner
  inner=$((port + 1))
  # The Linux build: the host's pkg-config, not the Windows sysroot env.sh points at.
  (cd "$_vs_root" && unset PKG_CONFIG_LIBDIR CFIRE_CXX && PKG_CONFIG_PATH= && source scripts/env.sh >/dev/null \
    && cfire build flint-vault-server >"$d/vault-server-build.log" 2>&1) \
    || { echo "vault-server: build failed ($d/vault-server-build.log)" >&2; return 1; }
  token="${VAULT_SERVER_TOKEN:-$(head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n')}"
  mkdir -p "$d/vault-data"
  FLINT_VAULT_TOKEN="$token" FLINT_VAULT_DATA="$d/vault-data" FLINT_VAULT_LISTEN="127.0.0.2:$inner" \
    "$_vs_root/build/flint-vault-server" >>"$d/vault-server.log" 2>&1 &
  _vs_pid=$!
  for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.2/$inner") 2>/dev/null && break; sleep 0.1; done
  # Removed first: the background job truncates its log only once it runs, so a restart
  # would otherwise read the previous relay's ready line and go on before this one listens.
  rm -f "$d/vault-relay.log"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "$_vs_here/ssh-relay.ps1")" \
    -Port "$port" -TargetHost 127.0.0.2 -Target "$inner" -Distro "$WSL_DISTRO_NAME" >"$d/vault-relay.log" 2>&1 &
  _vs_relay=$!
  _vs_inner=$inner
  # The relay's ready line takes 10-15 s to come through interop's pipe (PowerShell
  # compiling the relay); under load more: wait up to 60 s and say how long it took.
  local t0=$SECONDS
  for _ in $(seq 1 600); do grep -q '^relay:' "$d/vault-relay.log" 2>/dev/null && break; sleep 0.1; done
  grep -q '^relay:' "$d/vault-relay.log" || { echo "vault-server: the relay did not start in $((SECONDS - t0)) s; its log:" >&2; cat "$d/vault-relay.log" >&2; return 1; }
  echo "diag: the vault relay started in $((SECONDS - t0)) s" >&2
  export FLINT_TEST_VAULT_URL="http://127.0.0.1:$port" FLINT_TEST_VAULT_TOKEN="$token" FLINT_TEST_VAULT_DATA="$d/vault-data"
  export WSLENV="${WSLENV:+$WSLENV:}FLINT_TEST_VAULT_URL:FLINT_TEST_VAULT_TOKEN"
}

vault_server_stop() {
  [ -n "$_vs_pid$_vs_relay" ] || return 0
  [ -n "$_vs_pid" ] && kill "$_vs_pid" 2>/dev/null
  [ -n "$_vs_relay" ] && kill "$_vs_relay" 2>/dev/null
  # Interop does not pass the kill on to the PowerShell relay: stop it by its command line.
  powershell.exe -NoProfile -c "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { \$_.CommandLine -like '*ssh-relay.ps1*-TargetHost 127.0.0.2 -Target $_vs_inner*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" >/dev/null 2>&1
  _vs_pid=""; _vs_relay=""
  return 0
}
