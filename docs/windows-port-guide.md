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
| Checks | `windows/run-probes.sh` (cfire), `windows/cli-smoke.sh` (Flint CLI, vault + SSH + `cp`) |
| SSH for checks by hand | `windows/ssh-lab.sh start\|stop`: two throwaway sshd in WSL + `windows/ssh-relay.ps1` + a vault in `%TEMP%\flint-lab` |

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
| Terminal | `process/native/flint_process.hpp` | `CONIN$`/`CONOUT$` for prompts (echo off via console mode), **only when the console has a window** (`GetConsoleWindow()`): a process started with `CREATE_NO_WINDOW` (WSL interop from a pipe, a service, a scheduled task) still opens `CONIN$`, and a prompt there waits forever; raw mode = console modes + `ENABLE_VIRTUAL_TERMINAL_INPUT/PROCESSING` + UTF-8 code pages, restored at exit and by `SetConsoleCtrlHandler`; **no SIGWINCH**: `read_input` compares the window size each call; input drops non-text console events so a read never blocks on them; pipes via `PeekNamedPipe` |
| SSH | `ssh/native/flint_ssh.hpp`, `ssh/libssh.cf` | Dialling and the jump-host tunnel on `flint_sock`; `NUL` instead of `/dev/null` for known_hosts |
| Config folder | `adapters/config/recents.cf` | `%APPDATA%/Flint` |
| Paths | `domain/files.cf`, `application/session.cf`, `drivers/clicmd/commands.cf`, `adapters/process/process.cf` | `is_absolute_path()` accepts `C:/…`; the CLI turns `\` into `/` at the boundary (`local_slashes`, `current_dir`), so Flint keeps one form of local path. Remote paths stay POSIX |
| `flint cp` | `drivers/clicmd/files_commands.cf`, `domain/files.cf` | `C:\…` / `C:/…` is a local path, not host `C` (`is_drive_path`, checked only on Windows: on POSIX `c:/x` is still host `c`); the local side goes through `local_slashes` |
| GUI: screen lock, sleep, window to front | `uievents/native/flint_sysevents.hpp` | A thread of its own with a hidden top-level window (never shown): `WTSRegisterSessionNotification` → `WTS_SESSION_LOCK` is "screen", `WM_POWERBROADCAST`/`PBT_APMSUSPEND` (plus `RegisterSuspendResumeNotification`, Modern Standby) is "sleep". Independent of webui's loop. `bring_to_front`: webui's window (class `CfireWebUIWindowClass`) restored and `SetForegroundWindow`, `FlashWindowEx` when Windows refuses |
| GUI: presence check | `uievents/native/flint_presence.hpp` | **Degraded:** none on Windows; the window asks for the master password (the existing fallback). Windows Hello is the candidate |
| GUI: clipboard | `uievents/native/flint_clipboard.hpp` | `CF_UNICODETEXT`; a secret also carries `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory=0`, `CanUploadToCloudClipboard=0`; `GetClipboardSequenceNumber` is the change count; owner = a message-only window on the calling (UI) thread, which also runs the clear `SetTimer` |
| GUI: file dialogs | `uievents/native/flint_dialog.hpp` | Nothing: `native()` stays false and the driver uses cfire's Windows dialogs (`GetOpenFileNameW`), as on macOS |
| GUI: monospaced fonts | `fonts/native/flint_fonts.hpp` | `EnumFontFamiliesExW`, `FIXED_PITCH`, no `@` vertical faces (the POSIX branch would `popen("fc-list")` through `cmd.exe`) |
| GUI link flags | `pkgconfig/windows/flint-native-gui.pc` (new), `flint-native.pc` | `-luser32 -lwtsapi32`; `-lgdi32 -luser32` for fonts |
| Caller chain | `ipc/native/flint_peer.hpp`, `domain/access.cf` | `exe` with `/`, `argv0` = image name without `.exe`: without it `C:\…\flint.exe` never matched `flint` in `TRANSPARENT_EXES` and every command was its own caller (asked again each time). `cmd`, `powershell` are transparent; `WindowsTerminal` reads "Windows Terminal". From WSL the anchor is `wsl` |
| App icon | `assets/app-icon/Flint.ico` (new) | From `flint-256.png` (256…16); embedded by cfire W-13 |
| Windows build and install | `windows/build-gui.sh` (new) | `build/windows/Flint/`: `flint.exe`, `flint-app.exe`, `WebView2Loader.dll`, `ui/`; `--install DIR` copies it and adds `Flint.lnk` |
| Checks | `windows/gui-e2e.sh`, `windows/serve-e2e.sh` + `serve-page.js` (new), `ssh-relay.ps1 -ListenHost` | The UI e2e and a subset of serve-e2e, on Windows from WSL |
| App start (`serve`) | `drivers/clicmd/serve.cf`, `adapters/process` | `spawn_detached`: `CreateProcessW` with `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`, no inherited handles, `CREATE_BREAKAWAY_FROM_JOB` when the job allows it; replaces `sh -c … setsid`. The app is `gui\Flint.exe` (build tree) or `flint-app.exe` (install): **`Flint.exe` next to `flint.exe` is the same file** on a case-insensitive file system |

## Verified on Windows (so far)

Every line here **ran** on Windows 11 (build 26200) through WSL interop, unless it says
otherwise.

- `flint --version`, `--help`: libssh 0.12.2/OpenSSL, libsodium 1.0.22, SQLCipher 4.19.0.
- `windows/cli-smoke.sh`, **49/49** (2026-11-09):
  - vault create (SQLCipher file written), group add, host add/list/show,
    `vault status --json`, `vault list`, a wrong master password refused (exit 6),
    `--vault` with a backslash path;
  - SSH against a throwaway sshd in WSL: `key add`, `host add`, an unknown host key with
    no terminal fails with `host_key` (exit 11, not a hang), `host test
    --accept-new-host-key`, `exec` (stdout, remote exit status, `--json` with both
    streams, `--exec-timeout` → 14), a **jump host** for `exec`, `host test` (2 hops) and
    `cp` (the loopback socketpair carries the inner session);
  - `cp` over SFTP both ways: a UTF-8 name (`año-ñ ✓.txt`), a 1 MB binary byte-exact,
    no CRLF added, `-r` folders, `--force`, `exists` (20), a relative `.` target,
    `not_found` (3) on either side, `permission_denied` (19).
- **Credential Manager**: `cfire test --target x86_64-w64-mingw32 src/adapters/keychain`,
  79/79, including the test that saves, reads, overwrites and deletes a real generic
  credential. Not checked by a person yet (the CLI never writes one, see below).
- **App start**: with a stand-in `flint-app.exe` next to `flint.exe`, `flint host list`
  on a locked vault started it detached; it was still running 20 s after `flint.exe`
  had exited (exit 5, `locked`, as expected with no real app answering).
- **Linux regression** (2026-11-09, native clang, the cfire in `~/.local/opt/cfire-flint`,
  `scripts/env.sh`): the worktree's `HEAD` and `main`'s `b15271b` side by side, with
  `127.0.0.1` → `127.0.0.2` in the copies' tests and scripts only (lesson below).
  Same results on both, so nothing here comes from the port:

  | | port (`HEAD`) | `main` (`b15271b`) | Why |
  |---|---|---|---|
  | `scripts/test.sh` suites | 11 pass, 2 fail | 11 pass, 2 fail | keychain: no Secret Service in WSL; `uievents`: no `gtk+-3.0` headers |
  | `scripts/cli-e2e.sh` | 323/331 | 323/331 | the 8 use `localhost`, which resolves to the broken `127.0.0.1` here (IPv4/IPv6 dial, `known-host rm` by name, the `connect` PTY checks) |

  Every suite counts 2 more passing tests on the port: the two new `domain` tests
  (absolute paths, drive paths), which every package's test binary pulls in.
  Not run on Linux: the GUI and `serve-e2e` (no GTK/WebKitGTK headers in this WSL), and
  the `connect` PTY checks (the `localhost` problem). `scripts/linux-check.sh` (Docker)
  would cover them; Docker is not wired into this distro.

- **GUI** (2026-11-09, part 6): `windows/gui-e2e.sh`, the whole `scripts/gui-e2e.js` in a
  real WebView2 window, **138 checks pass**: welcome, vault create, key, hosts, host key
  prompt, shell I/O, resize, OSC 52, input order, dead keys, the Files view (list, mkdir,
  rename, delete, a drop uploaded, a download to Windows, a cancel that leaves nothing),
  jump host, changed host key, test connection, reveal and copy (clipboard), palette,
  settings, known hosts, app state, rename, import from Tether, lock (manual, injected
  screen/sleep), the tray close. Two steps do not run: vim (off, the Linux failure in
  the ROADMAP; on Windows too it gets into insert mode and `:wq` never lands) and the
  dialog focus trap (logged: a window started from WSL never gets the system focus, so
  focus events do not fire). `cfire test` on Windows: `uievents` 91/91 (real clipboard,
  no skip), `fonts` 77/77 (Consolas listed), `domain` 77/77.
- **CLI ↔ app** (2026-11-09): `windows/serve-e2e.sh` reached 40/46 before the caller-chain
  fix (the 6 were the harness and the per-command approval); by hand after it, `flint
  host list` with no master password is served by the running app over AF_UNIX, asks once
  ("flint, started by wsl"), and the next command is not asked again. With the app closed
  the CLI started `flint-app.exe` beside it on the unlock screen and `vault unlock`
  waited for it.

## Not done yet

| Item | Note |
|---|---|
| Interactive `connect` | Needs a person at Windows Terminal: `windows/ssh-lab.sh start`, then the command in the part 5 report. Raw console, resize without SIGWINCH, Ctrl+C, UTF-8 typing, the console restored on exit |
| Host key prompt in a real terminal | The `GetConsoleWindow()` rule says Windows Terminal (ConPTY) has a window handle; checked only that the hidden interop console has none |
| Credential Manager by a person | The CLI only deletes entries (D-038: `vault lock`, `vault forget`); the app writes them when "remember" is on. Checked with the adapter's test; a person looks once the GUI runs (part 6): `cmdkey /list:Flint/*`, or Control Panel → Credential Manager → Windows Credentials → Generic Credentials, target `Flint/<vault id>` |
| `flint serve` / handoff with the real app | `spawn_detached` works; the IPC handoff to a real `Flint.exe` waits for the GUI (part 6) |
| GUI (part 6, in progress) | Built, installed in `D:\Programas\Flint` and checked by `windows/gui-e2e.sh` (below). Left: the person checks (Win+L and sleep, a real dialog, a drag from Explorer, `cmdkey /list:Flint/*` with Remember on, the icons), `windows/serve-e2e.sh` flaky at the first unlock (a CLI's unlock request races the page typing the password), Windows Hello, `set_dark_mode` at run time (cfire), the lessons and ideas sections |
| CLI from WSL, and installing the CLI | Owner's decision (2026-11-09): for now WSL calls the Windows `flint.exe` (an alias), which the app serves as "flint, started by wsl" (like 1Password's `op.exe`). Later, once the port is further along: an installer that puts `flint` on `PATH`, or an "Install command-line tool" in Settings that makes the link, and WSL handled the same way |
| Packaging | GitHub Actions: build on `windows-latest` (MSYS2 CLANG64) or cross-compile on Ubuntu with llvm-mingw as here; an installer (Inno Setup, WiX or MSIX) carrying `WebView2Loader.dll`, naming the app `flint-app.exe` or putting it in its own folder; code signing. Only once cfire's Windows support is upstream |

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
- **A Windows console is not a person.** A process started with no window (WSL interop
  from a pipe, a service, a scheduled task) still opens `CONIN$`; a prompt there blocks
  forever. Ask `GetConsoleWindow()` first, as POSIX asks whether `/dev/tty` opens.
- **Arguments arrive in the ANSI code page** unless the runtime reads the UTF-16 command
  line (cfire W-11). Test every path feature with a non-ASCII name, on the command line
  too, not only through the file APIs.
- **`Flint.exe` and `flint.exe` are one file** on Windows (and on a default macOS
  volume): the CLI and the app need different names or folders.
- **`C:\x` looks like `host:path`.** Anything that splits on `:` needs a drive-letter
  rule, on Windows only (scp has the same one).
- **This WSL's mirrored networking breaks `127.0.0.1` for Linux listeners**, both from
  Windows and from Linux itself (an `ip rule` sends TCP to `127.0.0.1` through
  `loopback0` to Windows, and nothing comes back). `127.0.0.2` stays inside Linux.
  The checks use a throwaway sshd on `127.0.0.2` and `windows/ssh-relay.ps1`
  (Windows `127.0.0.1:2322` → `wsl.exe nc`) instead of binding to a LAN address. A
  `wsl --shutdown` might restore it; not tried, it would end the session.
- **A relay through a child's stdin must flush.** .NET's redirected stdin is a buffered
  `FileStream`: the SSH banner came back, the client's never left.
- **A sandboxed shell has its own network namespace.** A server started from Claude
  Code's sandboxed Bash listens where nothing else can reach it; start test servers
  outside the sandbox.

