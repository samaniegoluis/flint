# FreeRDP on the Windows build

Notes for the owner's Windows branch (milestones 28 and 30, D-070, D-071, D-072). This
repo cannot build or run Windows; everything here is to be checked there.

**When:** at the close of milestone 30, on the real RDP tab (owner, 2026-11-11). v8 does
not close without it: the owner uses RDP mostly from Windows. Not deferred to cfire's own
Windows support, which has no date.

## What the RDP adapter needs

| Need | macOS / Linux here | Windows |
|---|---|---|
| FreeRDP 3 core and client channels: `freerdp-client3`, `freerdp3`, `winpr3` (headers, import libs, DLLs) | Homebrew `freerdp`, Debian/Ubuntu `freerdp3-dev` **As built on the Windows branch (2026-11-11):** FreeRDP's own CMake build, 3.33.1, cross-compiled with llvm-mingw by `windows/bin/freerdp.sh` as **static** libraries (client library and built-in channels, no ffmpeg, SDL, servers, USB or JSON), on the sysroot's OpenSSL. The app links it in whole and ships **no FreeRDP or OpenSSL DLLs**. Not vcpkg `x64-windows` (MSVC ABI; the port builds with llvm-mingw) and not MSYS2's package (its `libfreerdp3.dll` imports ffmpeg: 128 packages, 1.3 GB) |
| libsodium (already linked by Flint) | as today | as today |
| `pkg-config` names `freerdp-client3 freerdp3 winpr3 libsodium` (through `src/adapters/pkgconfig/<os>/flint-rdp.pc`, CF-031) | present; macOS adds `-framework Carbon` (the keyboard layout) `windows/flint-rdp.pc` (branch): the three FreeRDP `.pc` files from the static install plus OpenSSL, zlib, libsodium and the Windows libraries winpr and FreeRDP call (`uuid ws2_32 secur32 credui ncrypt crypt32 bcrypt rpcrt4 dbghelp shlwapi shell32 ole32 user32 gdi32 winmm winspool advapi32 ntdll userenv iphlpapi mfplat mfuuid strmiids`) |

## Windows in the shim

`src/adapters/rdp/native/flint_rdp.hpp`:

- **Sockets** (the frame channel of D-071 and the refused-port probe) go through a small
  layer at the top of the file: Winsock 2 under `_WIN32` (`WSAStartup` once,
  `closesocket`, `WSAPoll`, `ioctlsocket`, a `DWORD` receive timeout), BSD sockets
  elsewhere. `<winsock2.h>` is included before winpr, which includes `<windows.h>`.
  **Written for Windows but never compiled there:** the first build on the branch is its
  test.
- **First Windows build (branch, 2026-11-11).** The Winsock layer compiled as written.
  What the build needed, all under `_WIN32` in the shim:
  - `<wtsapi32.h>` before winpr: `winpr/wtsapi.h` declares its own WTS types unless
    Windows' header came first, and the app's session-lock shim includes Windows' one.
    winpr then expects that header to hold the `WTSLISTENER*` types, as MSVC's does;
    mingw's has not got them, so the shim declares them (winpr only uses them as
    pointers).
  - `NIIF_NONE`..`NIIF_LARGE_ICON` set aside (`push_macro`) while FreeRDP's headers are
    read: `rail.h` names enumerators after macros of `<shellapi.h>`, which the app's
    whole `<windows.h>` brings in (FreeRDP itself builds with `WIN32_LEAN_AND_MEAN`).
  - `FREERDP_EXPORTS`/`WINPR_EXPORTS` defined around the headers: FreeRDP's API macros
    have no static mode and say `dllimport` otherwise. Side effect: `Flint.exe`'s export
    table lists ~1050 FreeRDP functions (harmless).
  - **The refused-port probe** sets `SIO_TCP_INITIAL_RTO` to no SYN retransmission.
    Windows answers an RST by sending the SYN again, so a closed port, even on loopback,
    took 2.0-2.4 s to fail (measured), past the probe's 2 s, and Remote Desktop off read
    as a network error. With it the first RST ends the connect, as on macOS and Linux.
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
