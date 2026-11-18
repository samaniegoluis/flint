# FreeRDP on the Windows build

Notes for the owner's Windows branch (milestones 28, 30 and 31, D-070 to D-075). This
repo cannot build or run Windows; everything here is to be checked there.

**When:** at the close of milestone 30, on the real RDP tab (owner, 2026-11-11). v8 does
not close without it: the owner uses RDP mostly from Windows. Not deferred to cfire's own
Windows support, which has no date.

## What the RDP adapter needs

| Need | macOS / Linux here | Windows |
|---|---|---|
| FreeRDP 3 core and client channels: `freerdp-client3`, `freerdp3`, `winpr3` (headers, import libs, DLLs) | Homebrew `freerdp`, Debian/Ubuntu `freerdp3-dev` **As built on the Windows branch (2026-11-11):** FreeRDP's own CMake build, 3.33.1, cross-compiled with llvm-mingw by `windows/bin/freerdp.sh` as **static** libraries (client library and built-in channels, no ffmpeg, SDL, USB or JSON), on the sysroot's OpenSSL. Since milestone 31 it also builds the server library, its channels and the sample server (`sfreerdp-server.exe`), for the tests only: nothing of it is linked into Flint. The app links it in whole and ships **no FreeRDP or OpenSSL DLLs**. Not vcpkg `x64-windows` (MSVC ABI; the port builds with llvm-mingw) and not MSYS2's package (its `libfreerdp3.dll` imports ffmpeg: 128 packages, 1.3 GB) |
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
- **Milestone 31 merge (branch, 2026-11-11).** Clipboard (`cliprdr`) and reconnect:
  - **Winsock before FreeRDP resolves.** `open()` now calls the shim's `sock_init()`
    first. FreeRDP never calls `WSAStartup`; the app got away with it because something
    else had (the frame channel of an earlier tab, libssh), but the adapter's tests,
    the first to connect to a server on Windows, failed every name, `127.0.0.1`
    included, as `ERRCONNECT_DNS_NAME_NOT_FOUND`. A first RDP tab opened before any SSH
    session would have failed the same way.
  - **`winpr/shell.h` skipped.** FreeRDP's clipboard headers include it, and on Windows
    it brings `<shlobj.h>` and `<userenv.h>`, so `<ocidl.h>`, which cfire's WebView2
    backend has already read inside its own namespace (cfire W-17): the app stopped
    compiling. The shim defines `WINPR_SHELL_H` and declares `FILEDESCRIPTORW`, the
    only name those headers use (as a pointer).
  - **A quiet network on Windows.** FreeRDP sets only `SO_KEEPALIVE` there, whose
    Windows timing is two hours idle, and has no `TCP_USER_TIMEOUT`. The `TCPConnect`
    hook milestone 31 added for macOS sets, under `_WIN32`, `TCP_KEEPIDLE` 5 s,
    `TCP_KEEPINTVL` 2 s, `TCP_KEEPCNT` 3 and `TCP_MAXRT` 9 s from the same settings as
    Linux. Compiled and in every RDP connection of the checks; the drop itself is not
    measured on Windows (no iptables: the owner's check, below).
  - The clipboard code (`ConvertUtf8NToWCharAlloc`, CRLF) and the core's 250 ms
    clipboard watch (`GetClipboardSequenceNumber`, already on the branch) needed nothing.
  - **Test servers on Windows, a first:** Flint's own (`windows/rdp-testserver.sh`
    builds `flint-rdp-testserver.exe`: Winsock in its control port, `<cstdlib>`, and
    `WIN32_LEAN_AND_MEAN` plus the static-link macros) and FreeRDP's sample server,
    started by `windows/rdp-servers.sh` for `test-suites.sh` and `gui-e2e.sh`. In the
    adapter's tests the control port is reached with `curl.exe` on Windows (`bash`
    there is WSL's, which cannot reach Windows' `127.0.0.1`).
- **The keyboard layout** comes from `freerdp_keyboard_init(0)` on Windows, which reads the
  layout in use. Keys are sent by scancode, so the remote reads them with that layout.
- **The `byte` rename** around FreeRDP's headers (CF-119) applies the same on Windows.
- The FreeRDP event loop (`freerdp_get_event_handles`, `WaitForMultipleObjects`) is winpr's
  portable API and is native on Windows.

## What to check on Windows

**Automated on the branch (2026-11-11, after merging milestone 31):** the adapter's tests
(111, against both test servers) and gui-e2e's rdp run (59 checks: the certificate
prompt and a changed certificate, the desktop at the tab's size, keys and pointer, the
clipboard both ways, *Connection lost* and Reconnect, the Windows key sent as it is; the Mac presets are macOS only) pass on
Windows against the loopback test servers. **Owner, 2026-11-11:** item 2 (his hosts
connect, the tab is very smooth). What follows is what only a person on a real host
can check.

1. `cfire build` links `Flint.exe` against FreeRDP; `flint.exe` does not.
2. Add an RDP host, open it: the certificate prompt, then the desktop in the tab, WebView2
   reading frames from `http://127.0.0.1:<port>`. WebView2 allows a page on `app://` to
   fetch loopback with the CORS header the channel sends; confirm it.
3. Typing in your layout (Spanish or Latin American), `AltGr` characters, dead keys; the
   mouse and the wheel; the desktop following the window's size.
4. `flint connect <host>` from a terminal opens the tab.
5. **Clipboard (milestone 31), both ways, with your real host:** copy text in Windows
   (inside the tab), paste it in Notepad on this machine; copy text here, click into the
   tab, paste it in the remote's Notepad. Accents, ñ, emoji and several lines (CRLF
   kept on the remote, LF here). Copy here again while the tab has the focus and paste
   remote: the new text, not the old. Lock Flint with the tab open: a paste in the
   remote gets nothing.
6. **Connection lost (milestone 31):** with the tab open, cut the network (Wi-Fi off,
   or the VPN): *Connection lost* with the last frame greyed after about 10-20 s;
   Reconnect (Ctrl+Shift+R) once the network is back, Close tab (Ctrl+Shift+W).
7. Compare, by eye, with `mstsc` on the same host. This is functional only: whether the
   RDP ActiveX engine is ever needed (D-070) waits for the performance work proposed after
   milestone 31 (ROADMAP §9), so it is not decided on the slowest version.
