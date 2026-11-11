# FreeRDP on the Windows build

Notes for the owner's Windows branch (milestones 28 and 30, D-070, D-071, D-072). This
repo cannot build or run Windows; everything here is to be checked there.

**When:** at the close of milestone 30, on the real RDP tab (owner, 2026-11-11). v8 does
not close without it: the owner uses RDP mostly from Windows. Not deferred to cfire's own
Windows support, which has no date.

## What the RDP adapter needs

| Need | macOS / Linux here | Windows |
|---|---|---|
| FreeRDP 3 core and client channels: `freerdp-client3`, `freerdp3`, `winpr3` (headers, import libs, DLLs) | Homebrew `freerdp`, Debian/Ubuntu `freerdp3-dev` | vcpkg `freerdp` (3.x, triplet `x64-windows`), or FreeRDP's own CMake build with its client library and channels (`drdynvc`, `disp`) built in, no SDL/X11 client. Ship `freerdp-client3.dll`, `freerdp3.dll`, `winpr3.dll` and their OpenSSL DLLs beside `Flint.exe` |
| libsodium (already linked by Flint) | as today | as today |
| `pkg-config` names `freerdp-client3 freerdp3 winpr3 libsodium` (through `src/adapters/pkgconfig/<os>/flint-rdp.pc`, CF-031) | present; macOS adds `-framework Carbon` (the keyboard layout) | vcpkg installs `.pc` files under `installed/x64-windows/lib/pkgconfig`; add a `windows/flint-rdp.pc` beside the other two, linking `ws2_32` |

## Windows in the shim

`src/adapters/rdp/native/flint_rdp.hpp`:

- **Sockets** (the frame channel of D-071 and the refused-port probe) go through a small
  layer at the top of the file: Winsock 2 under `_WIN32` (`WSAStartup` once,
  `closesocket`, `WSAPoll`, `ioctlsocket`, a `DWORD` receive timeout), BSD sockets
  elsewhere. `<winsock2.h>` is included before winpr, which includes `<windows.h>`.
  **Written for Windows but never compiled there:** the first build on the branch is its
  test.
- **The keyboard layout** comes from `freerdp_keyboard_init(0)` on Windows, which reads the
  layout in use. Keys are sent by scancode, so the remote reads them with that layout.
- **The `byte` rename** around FreeRDP's headers (CF-119) applies the same on Windows.
- The FreeRDP event loop (`freerdp_get_event_handles`, `WaitForMultipleObjects`) is winpr's
  portable API and is native on Windows.

## What to check on Windows

1. `cfire build` links `Flint.exe` against FreeRDP; `flint.exe` does not.
2. Add an RDP host, open it: the certificate prompt, then the desktop in the tab, WebView2
   reading frames from `http://127.0.0.1:<port>`. WebView2 allows a page on `app://` to
   fetch loopback with the CORS header the channel sends; confirm it.
3. Typing in your layout (Spanish or Latin American), `AltGr` characters, dead keys; the
   mouse and the wheel; the desktop following the window's size.
4. `flint connect <host>` from a terminal opens the tab.
5. Compare, by eye, with `mstsc` on the same host. This is functional only: whether the
   RDP ActiveX engine is ever needed (D-070) waits for the performance work proposed after
   milestone 31 (ROADMAP §9), so it is not decided on the slowest version.
