# Flint on Windows: port guide

What Flint itself needed to build and run on Windows, worked out on the isolated
`windows-port` branch (WSL2, 2026-11-09). **This branch is not merged.** When cfire ships
real Windows support, Flint's `main` (by then on a newer cfire) gets the same changes again,
using this guide as the checklist, and the cfire side is checked against
[`cfire-windows.md`](cfire-windows.md).

| Two files, two readers | |
|---|---|
| [`cfire-windows.md`](cfire-windows.md) + `cfire-windows/patches/` | For cfire's author: what cfire lacked on Windows, with patches |
| This file | For us: what Flint had to change, and the lessons |

## Where things are

| What | Where |
|---|---|
| Flint worktree | `~/Personal/Proyectos/cfire/flint-windows`, branch `windows-port` (local only) |
| cfire clone | `~/Personal/Proyectos/cfire/cfire-windows` |
| cfire for the patches (read by the author) | branch `windows-fixes` = `c5b1d4b` (HEAD on 2026-11-09) + patches |
| cfire Flint builds against | branch `windows-fixes-flint` = `24a43f6` + `5c06d4a` + the same patches, installed in `~/.local/opt/cfire-flint` |
| Toolchain | llvm-mingw in `~/.local/opt/llvm-mingw-*`, MSYS2 CLANG64 libraries + WebView2 SDK in `~/.local/opt/win-sysroot` (`windows/bin/sysroot.sh`) |
| Environment | `source windows/bin/env-flint.sh` (Flint) or `windows/bin/env.sh` (cfire probes on HEAD) |
| Build the CLI | `cfire build --target x86_64-w64-mingw32` in the worktree → `build/flint.exe` |
| Checks | `windows/run-probes.sh` (cfire), `windows/cli-smoke.sh` (Flint CLI) |

**Why two cfire branches.** cfire after `24a43f6` renamed modules (`ext:json` → `core:json`,
`b3909cc`) and, in `c5b1d4b`, rejects `.has_value()` on a `T!` (`cfire/UNHANDLED-RESULT`,
hundreds of hits in Flint's tests). Moving Flint to that cfire is `main`'s job, not the
port's, so the port builds on the last commit before the renames.

## What Flint changed

Every native change sits behind `#if defined(_WIN32)`; macOS and Linux keep their code
paths (the socket code moved into shared helpers with the same behaviour).

| Area | File | Windows side |
|---|---|---|
| Link flags | `src/adapters/pkgconfig/windows/flint-native.pc` (new) | `Requires: libssh libcrypto zlib` (static libssh needs OpenSSL listed: MSYS2's `libssh.pc` has no `Libs.private`), `-ladvapi32 -lcrypt32 -lws2_32 -liphlpapi -lbcrypt` |
| Sockets | `ipc/native/flint_sock.hpp` (new) | `closesocket`, `WSAPoll`, `WSAGetLastError`, `ioctlsocket(FIONBIO)`, `WSAStartup` once, and a **socketpair over loopback TCP** (Windows has none) |
| IPC (CLI ↔ app) | `ipc/native/flint_ipc.hpp` | **AF_UNIX** (Windows 10 1803+), not a named pipe: same code shape. Peer pid from `SIO_AF_UNIX_GETPEERPID`; "same uid" = same **token user SID** (`own_uid()` is 0, a peer is 0 or 1). Mode 0600 = a **protected DACL with one ACE for the owner** (`SetFileSecurityW`); AF_UNIX checks write access on connect. A stale socket file is recognised by its reparse tag `IO_REPARSE_TAG_AF_UNIX` before deleting it |
| Caller info | `ipc/native/flint_peer.hpp` | ppid from a Toolhelp snapshot, start time from `GetProcessTimes`, path from `QueryFullProcessImageNameW`; argv[0] = the image path (reading it really needs the PEB) |
| Keychain | `keychain/native/flint_keychain.hpp` | **Credential Manager**: generic credential, target `Flint/<vault id>`, `CRED_PERSIST_LOCAL_MACHINE` |
| Local files | `process/native/flint_fs.hpp` | Wide APIs from UTF-8; `_wopen` with **`_O_BINARY`** (else `\n` → `\r\n`); rename with `MoveFileExW(REPLACE_EXISTING)` (CRT rename refuses an existing target); synthesised modes 0755/0644/0444; `mode` ignored by `make_dirs` |
| Terminal | `process/native/flint_process.hpp` | `CONIN$`/`CONOUT$` for prompts (echo off via console mode); raw mode = console modes + `ENABLE_VIRTUAL_TERMINAL_INPUT/PROCESSING` + UTF-8 code pages, restored at exit and by `SetConsoleCtrlHandler`; **no SIGWINCH**: `read_input` compares the window size each call; input drops non-text console events so a read never blocks on them; pipes via `PeekNamedPipe` |
| SSH | `ssh/native/flint_ssh.hpp`, `ssh/libssh.cf` | Dialling and the jump-host tunnel on `flint_sock`; `NUL` instead of `/dev/null` for known_hosts |
| Config folder | `adapters/config/recents.cf` | `%APPDATA%/Flint` |
| Paths | `domain/files.cf`, `application/session.cf`, `drivers/clicmd/commands.cf`, `adapters/process/process.cf` | `is_absolute_path()` accepts `C:/…`; the CLI turns `\` into `/` at the boundary (`local_slashes`, `current_dir`), so Flint keeps one form of local path. Remote paths stay POSIX |

## Verified on Windows (so far)

- `flint --version`, `--help`: libssh 0.12.2/OpenSSL, libsodium 1.0.22, SQLCipher 4.19.0.
- `windows/cli-smoke.sh`: vault create (SQLCipher file written), group add, host add/list/show,
  `vault status --json`, `vault list`, a wrong master password refused (exit 6), `--vault`
  with a backslash path.

## Not done yet

| Item | Note |
|---|---|
| SSH against a real server | `host test`, `exec`, `connect` (raw console), `cp` (SFTP), jump host. Plan: a throwaway `sshd` in WSL on `127.0.0.1:2222` (WSL is in mirrored networking mode, so Windows reaches it) |
| Linux regression run | The shared socket code changed; run `scripts/test.sh` on Linux in the worktree |
| `flint serve` / app handoff | `drivers/clicmd/serve.cf:672` starts the app with `sh -c … setsid`: needs a Windows way (`CreateProcess` detached) |
| Keychain dialog check | A person confirms an entry appears in Credential Manager |
| GUI (part 6) | `uievents/native/flint_presence.hpp` and `flint_sysevents.hpp` use GIO; clipboard, dialogs and gui shims compile but have no Windows side yet; `WebView2Loader.dll` must ship next to `Flint.exe` |
| Packaging | GitHub Actions: build on `windows-latest` (MSYS2 CLANG64) or cross-compile on Ubuntu with llvm-mingw as here; an installer (Inno Setup, WiX or MSIX) carrying `WebView2Loader.dll`; code signing. Only once cfire's Windows support is upstream |

## Lessons

- **Cross-compile from WSL2 and run through interop.** A `.exe` built in WSL runs on the
  real Windows from the same shell. That turned "compiles" into "runs" for everything here.
- **`apt install` can break WSL interop**: a package registering a binfmt (llvm's) restarts
  `systemd-binfmt`, which drops `WSLInterop` (`exec format error`). The fix is persistent:
  `/usr/lib/binfmt.d/WSLInterop.conf` with `:WSLInterop:M::MZ::/init:PF`.
- **Link static.** llvm-mingw's libc++ is a DLL; without it the `.exe` exits 53
  (`STATUS_DLL_NOT_FOUND`) with no message. Static libraries need `LIBSSH_STATIC` and
  `SODIUM_STATIC` defined, and `pkg-config --static`.
- **Keep one form of local path** (`/`) and convert at the edge, instead of teaching every
  caller about `\` and drive letters.
- **AF_UNIX on Windows is good enough** for a same-user local socket and keeps the POSIX
  shape. The ROADMAP's named pipe remains the alternative if AF_UNIX falls short (e.g. very
  old Windows 10).
- **Windows sockets are not fds.** Any `::close`/`::read`/`::write` on a socket is a bug
  there; route socket I/O through one helper.
- **Text mode bites twice:** CRT files (`_O_BINARY`) and stdout (`println` writes `\r\n`,
  cfire W-05).
