# source windows/rdp-servers.sh — RDP test servers as Windows programs on Windows'
# loopback, for test-suites.sh and gui-e2e.sh (scripts/test.sh's twin on macOS/Linux).
#
#   rdp_servers_start <folder in WSL>   # exports FLINT_RDP_SAMPLE_PORT, FLINT_RDP_CLIP_PORT,
#                                       # FLINT_RDP_CLIP_CONTROL and adds them to WSLENV
#   rdp_server_sample <folder> <port> <name>   # one more sample server, its own certificate
#   rdp_servers_stop
#
# FreeRDP's sample server (sfreerdp-server.exe, bin/freerdp.sh) ends every session unless
# a test_icon.* sits in its working folder; Flint's own server (rdp-testserver.sh) adds
# the clipboard, the keys received and a drop (milestone 31). The folder must be on the
# Windows side (a certificate path is given to a Windows program). Nothing listens beyond
# 127.0.0.1.
_rdp_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_rdp_fr="${WIN_SYSROOT:-$HOME/.local/opt/win-sysroot}"

rdp_server_sample() {  # <folder> <port> <name>
  local d="$1" crt key
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$d/$3.key" -out "$d/$3.crt" -days 2 -subj "/CN=flint-test${3#rdp}" 2>/dev/null
  crt="$(wslpath -w "$d/$3.crt")"; key="$(wslpath -w "$d/$3.key")"
  (cd "$d" && exec ./sfreerdp-server.exe --cert="$crt" --key="$key" --port="$2" >"$d/$3.log" 2>&1) &
}

rdp_servers_start() {  # <folder>
  local d="$1" clip crt key
  clip="$("$_rdp_here/rdp-testserver.sh")" || return 1
  cp "$clip" "$_rdp_fr/freerdp/bin/sfreerdp-server.exe" "$d/"
  cp "$_rdp_fr/.src/FreeRDP-"*"/server/Sample/test_icon."* "$d/"
  rdp_server_sample "$d" 33891 rdp
  crt="$(wslpath -w "$d/rdp.crt")"; key="$(wslpath -w "$d/rdp.key")"
  (cd "$d" && exec ./flint-rdp-testserver.exe --port=33893 --control=33894 --cert="$crt" --key="$key" >"$d/rdp-clip.log" 2>&1) &
  # Its ready line can take seconds to come through interop's pipe.
  for _ in $(seq 1 300); do grep -q '^listening' "$d/rdp-clip.log" 2>/dev/null && break; sleep 0.1; done
  grep -q '^listening' "$d/rdp-clip.log" || { echo "rdp-servers: flint-rdp-testserver did not start" >&2; cat "$d/rdp-clip.log" >&2; return 1; }
  export FLINT_RDP_SAMPLE_PORT=33891 FLINT_RDP_CLIP_PORT=33893 FLINT_RDP_CLIP_CONTROL=33894
  export WSLENV="${WSLENV:+$WSLENV:}FLINT_RDP_SAMPLE_PORT:FLINT_RDP_CLIP_PORT:FLINT_RDP_CLIP_CONTROL"
}

rdp_servers_stop() {
  taskkill.exe /F /IM sfreerdp-server.exe >/dev/null 2>&1
  taskkill.exe /F /IM flint-rdp-testserver.exe >/dev/null 2>&1
  return 0
}
