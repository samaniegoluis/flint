# FreeRDP on the Windows build

Notes for the owner's Windows branch (milestone 28, D-070, D-071). This repo cannot build
or run Windows; everything here is to be checked there.

**When:** at the close of milestone 30, not before (owner, 2026-11-11). The spike's frame
channel uses POSIX sockets and would need the Winsock port twice; milestone 30 makes it an
`#ifdef _WIN32` pair, and the check then runs on the real RDP tab. v8 does not close
without it: the owner uses RDP mostly from Windows. Not deferred to cfire's own Windows
support, which has no date.

## What the RDP adapter needs

| Need | macOS / Linux here | Windows |
|---|---|---|
| FreeRDP 3 core: `freerdp3`, `winpr3` (headers, import libs, DLLs) | Homebrew `freerdp`, Debian/Ubuntu `freerdp3-dev` | vcpkg `freerdp` (3.x, triplet `x64-windows`), or FreeRDP's own CMake build with `-DWITH_CLIENT=OFF -DWITH_SERVER=OFF` and no SDL/X11 client. Ship `freerdp3.dll`, `winpr3.dll` and their OpenSSL DLLs beside `Flint.exe` |
| libsodium (already linked by Flint) | as today | as today |
| `pkg-config` names `freerdp3 winpr3 libsodium` (through `src/adapters/pkgconfig/<os>/flint-rdp.pc`, CF-031) | present | vcpkg installs `.pc` files under `installed/x64-windows/lib/pkgconfig`; add a `windows/flint-rdp.pc` beside the other two |

## What in the shim is POSIX-only

`src/adapters/rdp/native/flint_rdp.hpp`:

- **The frame channel** (`frame_server_start`, `serve`, `serve_conn`, the transport chosen
  in D-071) uses BSD sockets: `<arpa/inet.h>`, `<netinet/*.h>`, `<sys/socket.h>`,
  `<unistd.h>`, `close`, `ssize_t`, `SO_RCVTIMEO` with a `timeval`. On Windows: include
  `<winsock2.h>` and `<ws2tcpip.h>`, call `WSAStartup` once, use `SOCKET`/`INVALID_SOCKET`,
  `closesocket`, `int` lengths, and a `DWORD` milliseconds value for `SO_RCVTIMEO`. The
  logic is unchanged. Milestone 30 makes these an `#ifdef _WIN32` pair when it moves the
  shim behind the `RemoteDesktop` port.
- **The `byte` rename** around FreeRDP's headers (CF-119) applies the same on Windows.
- The FreeRDP event loop (`freerdp_get_event_handles`, `WaitForMultipleObjects`) is winpr's
  portable API and is native on Windows.

## What to check on Windows

1. `cfire build` links `flint-rdp-spike.exe` against FreeRDP; `flint.exe` does not.
2. `scripts/rdp-spike.sh channel` (or running the spike with `FLINT_RDP_SPIKE_MODE=channel`)
   shows the remote desktop in the window, WebView2 reading frames from
   `http://127.0.0.1:<port>`. WebView2 allows a page on `app://` to fetch loopback with
   the CORS header the channel sends; confirm it.
3. Compare, by eye, with `mstsc` on the same host: this is what decides whether the RDP
   ActiveX engine is ever needed (D-070).
