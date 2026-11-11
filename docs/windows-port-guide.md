# Flint on Windows: port guide

What Flint itself needed to build and run on Windows, worked out on an isolated branch
(WSL2, 2026-11-09). **The branch is not merged and not pushed.** Since `main` moved to
cfire `c5b1d4b` (D-060), the branch is `main` plus the Windows port and nothing else:
`windows-port-2` = `origin/main` (`83557b0`) with `windows-port` merged in. When cfire ships
real Windows support, that diff is the port; this guide is its checklist and the cfire side
is checked against [`cfire-windows.md`](cfire-windows.md). Keep the branch close to `main`
by merging `main` into it now and then.

| Two files, two readers | |
|---|---|
| [`cfire-windows.md`](cfire-windows.md) + `cfire-windows/patches/` | For cfire's author: what cfire lacked on Windows, with patches |
| This file | For us: what Flint had to change, and the lessons |

## Resume here

State on 2026-11-09 (branch `windows-port-2`, `git log` for the latest commit):

- **Done:** the CLI and the desktop app build and run on Windows 11 on top of `main`
  (`83557b0`, cfire `c5b1d4b`) with cfire patches 0001-0009. Every automated check is
  green (Verified, below). Installed in `D:\Programas\Flint`. The handoff for cfire's
  author is `D:\Respaldos\flint-windows\cfire-windows-2026-11-09.zip` (already given,
  or to give). Backups: git bundles in `D:\Respaldos\flint-windows`.
- **Merged `main` again (2026-11-09):** milestone 20 (split panes, `b912435`), no conflicts,
  UI only. On Windows the Linux ⌥⌘ layer (Ctrl+Alt) swallowed AltGr characters; fixed in
  nothing (What Flint changed, "AltGr and shortcuts"). gui-e2e 178 pass. Owner, in the
  installed app: splitting, dragging dividers and the glyphs after a split look right;
  the Ctrl+Alt layouts work on the Spanish layout; on US-International Ctrl+Alt types ¡
  (expected).
- **Merged `main` again (2026-11-09):** milestone 21 (v5 debts, `6f82186`) and spec v6,
  no conflicts, same cfire `c5b1d4b`. `windows/gui-e2e.sh` now runs the vim step in a run
  of its own, as `scripts/gui-e2e.sh` does (`FLINT_E2E_VIM=1`, `FLINT_E2E_ONLY=vim`; exit 3
  when only vim fails). gui-e2e **180 pass**, the narrow-window checks included; serve-e2e
  51/51. Milestone 24 removes the Tether import: then `windows/gui-e2e.sh` drops the
  `.tether` fixture and the key in `C:\tmp`.
- **Merged `main` again (2026-11-11):** milestones 22-25b and 27-29 (tunnels, the Tether
  importer removed, paste an image, test freezes, the RDP spike and RDP hosts), up to
  `6e34383`; same cfire `c5b1d4b` + 0001-0009. Windows work in the merge:
  - **Tunnels** (`ssh/native/flint_tunnel.hpp`, POSIX only on `main`): sockets through
    `flint_sock`, a loopback socket pair as the worker's wake pipe (WSAPoll waits on
    sockets only), no `SO_REUSEADDR` on a listener (on Windows it lets another socket
    share a bound port), the port's holder from `GetExtendedTcpTable` looked up at run
    time with its rows declared locally (`iphlpapi.h` pulls in `ocidl.h`, which clashes
    with patch 0004's COM declarations in the app; mingw's `tcpmib.h` lacks the
    `*_OWNER_PID` rows).
  - **Paste an image** (`uievents/native/flint_clipboard.hpp`): `read_paste` and
    `copy_png` on the registered `PNG` clipboard format; a bitmap alone (`CF_DIB`) is not
    converted, so it pastes nothing.
  - **Builds:** `windows/build-gui.sh` builds `flint` and `FlintGui` only (the RDP spike
    needs libfreerdp; `cfire build Flint` picks the CLI, whose build.cf variable is
    `Flint`). `windows/test-suites.sh` leaves out `src/adapters/rdp` and copies no vault
    testdata (gone with Tether).
  - **Checks:** `windows/gui-e2e.sh` runs main's five runs; the tunnels run dials the
    tunnel on Windows' `127.0.0.1` and a fourth relay holds `127.0.0.1:<port 1>` for the
    "port in use" check. `windows/cli-smoke.sh` gains the tunnel commands.
  - **Two shared test fixes went to `main`:** the paste tests built 10 MiB a byte at a
    time (quadratic, about an hour; `0be0551`), and the paste steps typed while an async
    prompt redrew, so the `ls` lost the pasted path (`6e34383`).
  - Owner checks to do in the installed app: a tunnel used by a Windows program; a
    screenshot (Win+Shift+S) pasted into an SSH session with Ctrl+V.
- **Owner checks done:** Win+L with the app unlocked locks the vault: after signing back
  in to Windows, Flint asks for the master password. On the owner's own vault in the
  installed app: unlocking with "Remember on this computer" stores a Generic, local-machine
  credential `Flint/vault-<id>` (`cmdkey /list:Flint/*`); Ctrl+Insert copies a terminal
  selection; a file dragged from Explorer into the Files view uploads; saving a key opens
  the Windows dialog and writes the file; `flint.exe connect local` in Windows Terminal
  (pwsh) asks for a grant naming the chain `explorer › WindowsTerminal › pwsh › flint`,
  is allowed with the master password (no presence check on Windows), and opens an
  interactive shell (all 2026-11-09). The grant's hint named Touch ID and polkit; it now
  says "No Windows Hello" on Windows.
  Sleep with the app unlocked locks it too: after waking, Flint asks for the master
  password (2026-11-09).
- **Focus after Alt+Tab (2026-11-09):** the owner saw that after Alt+Tab back to Flint the
  terminal gets no keys (no paste) until clicked. Cause and fix in cfire: W-16, patch 0009
  (`WM_SETFOCUS` → WebView2 `MoveFocus`). gui-e2e still 180 pass. **Found after the
  handoff:** the zip cfire's author has (0001-0008, W-01..W-15) does not include it, and it
  was not sent; check it in the next phase, with the rest.
- **The vim step is a test race, not a Windows failure (2026-11-09):** on Windows vim gets
  every key and `:wq` saves and quits; the next command, sent while vim is still quitting,
  is lost as the tty changes mode. Waiting for vim to leave the alternate screen and the
  prompt to settle makes the vim run pass 3 of 3. The fix is in `scripts/gui-e2e.js`
  (shared), so it went to `main` (`f994cb8`) and came here by merge.
  Owner, in the installed app: after Alt+Tab away and back, the terminal takes keys and
  Ctrl+V pastes without a click (2026-11-09).
- **Owner checks still open:** none.

**Next phase: when cfire ships Windows support upstream.**

1. Read cfire's changes since `c5b1d4b` and, for each W-NN in
   [`cfire-windows.md`](cfire-windows.md), decide: covered upstream (drop the patch),
   covered differently (adapt Flint), or still missing (keep the patch, rebase it).
2. Build that cfire in `~/Personal/Proyectos/cfire/cfire-windows` (a new branch from
   upstream plus only the patches still needed), install it in `~/.local`
   (`bin/cfire`, `share/cfire`; `make install` fails, CF-086), check
   `cfire --version`.
3. Bring `windows-port-2` up to `main` (merge `origin/main`). If `main` pins the new
   cfire, there is still one cfire for both.
4. Rebuild and re-run, in this order: `windows/run-probes.sh` (cfire),
   `windows/build-gui.sh`, `windows/test-suites.sh`, `windows/cli-smoke.sh`,
   `windows/gui-e2e.sh`, `windows/serve-e2e.sh`; then the Linux regression
   (Verified explains how). Fix what breaks; drop Flint workarounds that cfire now
   makes unnecessary (W-04 static linking, W-09 `EventToken.h`, W-10 the WebView2 SDK
   and `WebView2Loader.dll`, W-13 the `.ico` beside the `.icns`).
5. Update this guide and `cfire-windows.md`, refresh the bundles, reinstall in
   `D:\Programas\Flint`, and ask the owner for the person checks above.

Rules that still hold: the branch stays local (no push, no merge into `main`); one
commit per step; test servers start outside the Bash sandbox; never two cfire builds of
the same package at once.

## Where things are

| What | Where |
|---|---|
| Flint worktree | `~/Personal/Proyectos/cfire/flint-windows`, branch `windows-port-2` (local only). `windows-port` is the history before the merge, kept for reference |
| cfire clone | `~/Personal/Proyectos/cfire/cfire-windows` |
| cfire (patches and Flint) | branch `windows-fixes` = `c5b1d4b` (the commit `main` pins) + patches 0001-0009, installed by hand in `~/.local` (`bin/cfire`, `share/cfire`) |
| Toolchain | llvm-mingw in `~/.local/opt/llvm-mingw-*`, MSYS2 CLANG64 libraries + WebView2 SDK in `~/.local/opt/win-sysroot` (`windows/bin/sysroot.sh`) |
| Environment | `source windows/bin/env.sh` (Flint and the cfire probes) |
| Build the CLI | `cfire build --target x86_64-w64-mingw32` in the worktree → `build/flint.exe` |
| Checks | `windows/run-probes.sh` (cfire), `windows/test-suites.sh` (Flint's suites on Windows), `windows/cli-smoke.sh` (CLI, vault + SSH + `cp`), `windows/gui-e2e.sh`, `windows/serve-e2e.sh` |
| SSH for checks by hand | `windows/ssh-lab.sh start\|stop`: two throwaway sshd in WSL + `windows/ssh-relay.ps1` + a vault in `%TEMP%\flint-lab` |

**One cfire since the merge.** Until `main` moved to `c5b1d4b`, Flint could not build on
the cfire the patches sit on (module renames in `b3909cc`, `cfire/UNHANDLED-RESULT` in
`c5b1d4b`), so the port used a second branch, `windows-fixes-flint` (`24a43f6` + the same
patches) and `windows/bin/env-flint.sh`. Both are gone on `windows-port-2`; the old branch
and `~/.local/opt/cfire-flint` remain only for `windows-port`.

**The merge (2026-11-09).** Three conflicts: `flint_ssh.hpp` (main's tunnel pump now waits
on the outer session's socket too, milestone 18; on `flint_sock` with a new `poll_two`),
`commands.cf` (imports), `files_commands.cf` (`flint cp` between two hosts with the
drive-letter rule, also in `cp_second_alias`). The port's code needed nothing for the new
cfire: it never stored a `T!`.

## What Flint changed

Every native change sits behind `#if defined(_WIN32)`; macOS and Linux keep their code
paths (the socket code moved into shared helpers with the same behaviour).

| Area | File | Windows side |
|---|---|---|
| Link flags | `src/adapters/pkgconfig/windows/flint-native.pc` (new) | `Requires: libssh libcrypto zlib` (static libssh needs OpenSSL listed: MSYS2's `libssh.pc` has no `Libs.private`), `-ladvapi32 -lcrypt32 -lws2_32 -liphlpapi -lbcrypt` |
| Sockets | `ipc/native/flint_sock.hpp` (new) | `closesocket`, `WSAPoll` (`poll_one`, `poll_two`), `WSAGetLastError`, `ioctlsocket(FIONBIO)`, `WSAStartup` once, and a **socketpair over loopback TCP** (Windows has none) |
| IPC (CLI ↔ app) | `ipc/native/flint_ipc.hpp` | **AF_UNIX** (Windows 10 1803+), not a named pipe: same code shape. Peer pid from `SIO_AF_UNIX_GETPEERPID`; "same uid" = same **token user SID** (`own_uid()` is 0, a peer is 0 or 1). Mode 0600 = a **protected DACL with one ACE for the owner** (`SetFileSecurityW`); AF_UNIX checks write access on connect. A stale socket file is recognised by its reparse tag `IO_REPARSE_TAG_AF_UNIX` before deleting it |
| Caller info | `ipc/native/flint_peer.hpp` | ppid from a Toolhelp snapshot, start time from `GetProcessTimes`, path from `QueryFullProcessImageNameW`; argv[0] = the image path (reading it really needs the PEB) |
| Keychain | `keychain/native/flint_keychain.hpp` | **Credential Manager**: generic credential, target `Flint/<vault id>`, `CRED_PERSIST_LOCAL_MACHINE` |
| Local files | `process/native/flint_fs.hpp` | Wide APIs from UTF-8; `_wopen` with **`_O_BINARY`** (else `\n` → `\r\n`); rename with `MoveFileExW(REPLACE_EXISTING)` (CRT rename refuses an existing target); synthesised modes 0755/0644/0444; `mode` ignored by `make_dirs` |
| Terminal | `process/native/flint_process.hpp` | `CONIN$`/`CONOUT$` for prompts (echo off via console mode), **only when the console has a window** (`GetConsoleWindow()`): a process started with `CREATE_NO_WINDOW` (WSL interop from a pipe, a service, a scheduled task) still opens `CONIN$`, and a prompt there waits forever; raw mode = console modes + `ENABLE_VIRTUAL_TERMINAL_INPUT/PROCESSING` + UTF-8 code pages, restored at exit and by `SetConsoleCtrlHandler`; **no SIGWINCH**: `read_input` compares the window size each call; input drops non-text console events so a read never blocks on them; pipes via `PeekNamedPipe` |
| SSH | `ssh/native/flint_ssh.hpp`, `ssh/libssh.cf` | Dialling and the jump-host tunnel on `flint_sock`; `NUL` instead of `/dev/null` for known_hosts |
| Config folder | `adapters/config/recents.cf` | `%APPDATA%/Flint` |
| Paths | `domain/files.cf`, `application/session.cf`, `drivers/clicmd/commands.cf`, `adapters/process/process.cf`, `drivers/gui/rpc.cf` | `is_absolute_path()` accepts `C:/…`; `\` becomes `/` at each edge (`local_slashes` in `adapters/process`, `current_dir`): the CLI's arguments **and what the GUI's file dialogs return** (without the second, creating or opening a vault in the app failed with "vault path must be absolute"). Flint keeps one form of local path, and the app shows `C:/Users/…`. Remote paths stay POSIX |
| `flint cp` | `drivers/clicmd/files_commands.cf`, `domain/files.cf` | `C:\…` / `C:/…` is a local path, not host `C` (`is_drive_path`, checked only on Windows: on POSIX `c:/x` is still host `c`); the local side goes through `local_slashes` |
| GUI: screen lock, sleep, window to front | `uievents/native/flint_sysevents.hpp` | A thread of its own with a hidden top-level window (never shown): `WTSRegisterSessionNotification` → `WTS_SESSION_LOCK` is "screen", `WM_POWERBROADCAST`/`PBT_APMSUSPEND` (plus `RegisterSuspendResumeNotification`, Modern Standby) is "sleep". Independent of webui's loop. `bring_to_front`: webui's window (class `CfireWebUIWindowClass`) restored and `SetForegroundWindow`, `FlashWindowEx` when Windows refuses |
| GUI: presence check | `uievents/native/flint_presence.hpp` | **Degraded:** none on Windows; the window asks for the master password (the existing fallback). Windows Hello is the candidate |
| GUI: clipboard | `uievents/native/flint_clipboard.hpp` | `CF_UNICODETEXT`; a secret also carries `ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory=0`, `CanUploadToCloudClipboard=0`; `GetClipboardSequenceNumber` is the change count; owner = a message-only window on the calling (UI) thread, which also runs the clear `SetTimer` |
| GUI: terminal copy and paste | `ui/src/lib/clipboardKeys.ts` (new, tested), `sessions/TerminalView.tsx`, Settings, `site/` | As Windows Terminal (owner's choice): Ctrl+Shift+C, Ctrl+Insert and Ctrl+C over a selection copy (the selection clears, so the next Ctrl+C interrupts); Ctrl+Shift+V, Ctrl+V and Shift+Insert paste through the webview's own paste event (no clipboard permission). Before, Shift+Insert reached the remote as `ESC[2;2~` and the shell printed `2~`. `Os` gains `'windows'`; Settings names Windows Credential Manager instead of the Secret Service |
| GUI: AltGr and shortcuts | `site/` (shortcuts page) | Nothing in code. WebView2 reports AltGr as `AltGraph` with `ctrlKey`/`altKey` false (probed in Edge, ESP INTL, 2026-11-09), so AltGr characters never hit a shortcut. But on a layout with AltGr characters on the digits (US-International) Windows turns a pressed Ctrl+Alt into AltGr: the Ctrl+Alt layer (⌥⌘: Duplicate, layouts 1-4) cannot be reached there, as in Windows Terminal; the palette and the Split menu can. A first fix in `keymap.ts` assumed AltGr arrived as Ctrl+Alt and was reverted |
| GUI: file dialogs | `uievents/native/flint_dialog.hpp` | Nothing: `native()` stays false and the driver uses cfire's Windows dialogs (`GetOpenFileNameW`), as on macOS |
| GUI: monospaced fonts | `fonts/native/flint_fonts.hpp` | `EnumFontFamiliesExW`, `FIXED_PITCH`, no `@` vertical faces (the POSIX branch would `popen("fc-list")` through `cmd.exe`) |
| GUI link flags | `pkgconfig/windows/flint-native-gui.pc` (new), `flint-native.pc` | `-luser32 -lwtsapi32`; `-lgdi32 -luser32` for fonts |
| Caller chain | `ipc/native/flint_peer.hpp`, `domain/access.cf` | `exe` with `/`, `argv0` = image name without `.exe`: without it `C:\…\flint.exe` never matched `flint` in `TRANSPARENT_EXES` and every command was its own caller (asked again each time). `cmd`, `powershell` are transparent; `WindowsTerminal` reads "Windows Terminal". From WSL the anchor is `wsl` |
| App icon | `assets/app-icon/Flint.ico` (new) | From `flint-256.png` (256…16); embedded by cfire W-13 |
| Windows build and install | `windows/build-gui.sh` (new) | `build/windows/Flint/`: `flint.exe`, `flint-app.exe`, `WebView2Loader.dll`, `ui/`; `--install DIR` copies it and adds `Flint.lnk` |
| Checks | `windows/gui-e2e.sh`, `windows/serve-e2e.sh` + `serve-page.js` + `new-caller.js` (new), `ssh-relay.ps1 -ListenHost` | The UI e2e and a subset of serve-e2e, on Windows from WSL. `new-caller.js` runs `flint.exe` under `cscript` (`//E:jscript`: the `.js` association may be gone) so the app sees a caller it has not approved, the stand-in for the perl wrapper on Linux |
| RDP tab (milestone 30) | `windows/bin/freerdp.sh` (new), `pkgconfig/windows/flint-rdp.pc` (new), `rdp/native/flint_rdp.hpp`, `windows/bin/env.sh` | FreeRDP 3.33.1 cross-built **static** with llvm-mingw into `$WIN_SYSROOT/freerdp` (no ffmpeg/SDL/servers/USB/JSON; `-D__STDC_NO_THREADS__`, `USE_UNWIND=OFF`; the two channel helper archives a static install leaves out are copied, `-ldl` dropped from its `.pc`). The app links it in whole: no FreeRDP or OpenSSL DLLs, the CLI has none of it. The shim's Windows fixes are in [`rdp-windows.md`](rdp-windows.md) ("First Windows build"): `wtsapi32.h` first plus the `WTSLISTENER*` types mingw lacks, `NIIF_*` macros set aside, `FREERDP_EXPORTS`/`WINPR_EXPORTS` for a static link, and no SYN retransmission in the refused-port probe |
| App start (`serve`) | `drivers/clicmd/serve.cf`, `adapters/process` | `spawn_detached`: `CreateProcessW` with `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`, no inherited handles, `CREATE_BREAKAWAY_FROM_JOB` when the job allows it; replaces `sh -c … setsid`. The app is `gui\Flint.exe` (build tree) or `flint-app.exe` (install): **`Flint.exe` next to `flint.exe` is the same file** on a case-insensitive file system |

## Verified on Windows (so far)

Every line here **ran** on Windows 11 (build 26200) through WSL interop, unless it says
otherwise.

### On `windows-port-2` (main + the port, cfire `c5b1d4b` + patches), 2026-11-09

| Check | Result |
|---|---|
| `windows/build-gui.sh` | CLI, app and page build (milestones 20-29 merged; 22-25 needed the Windows work above) |
| After milestones 22-29 (2026-11-11) | `test-suites.sh` **10 suites, 1239 tests**; `cli-smoke.sh` **60/60** (11 tunnel checks new); `gui-e2e.sh` **275 checks in five runs**: terminal 89, vault 113, tunnels 33, paste 24 (the core reading the real Windows clipboard included), vim 16; `serve-e2e.sh` **51/51** |
| `windows/test-suites.sh` | **10 suites, 1071 tests pass** on Windows: config 89, crypto 89, fonts 81, ipc 93, keychain 83, process 89, uievents 95, vault 114, application 193, clicmd 145. `ssh` not run (needs sshd on `127.0.0.1` from Windows). First run: ipc, vault and clicmd failed only because "/tmp" from a WSL folder is the WSL share; process had two POSIX-only asserts |
| `windows/cli-smoke.sh` | 49/49 |
| `windows/gui-e2e.sh` | **180 pass** after merging milestone 21 (+2: the Files and Hosts views drawn whole over the terminal in a narrow window, on WebView2). The vim run on its own (`FLINT_E2E_ONLY=vim`) fails as before, now by name: `timed out waiting for "vim-42"`, exit 3. **178 pass** after merging milestone 20 (the 25-check split-panes step included). Before that, **155 pass**: 138 + main's milestones 18-19 (two panes, copy between servers, a host key asked inside the pane, Skip) + 2 for the Windows copy and paste keys (none reaches the remote; Ctrl+C over a selection clears it). Skipped as before: vim, the focus trap. A real paste from the Windows clipboard into an SSH session: owner, with Shift+Insert, Ctrl+Shift+V and Ctrl+V, and Ctrl+C over a selection copies without interrupting the remote while Ctrl+C with none still interrupts (2026-11-09). Ctrl+Insert not checked by a person |
| `windows/serve-e2e.sh` | **51/51**, twice 49/49 before the new check: `flint cp` between two hosts through the app (milestone 18) |
| `windows/run-probes.sh` | green |
| Linux regression | Not re-run after milestone 21: main brought only GUI and gui-e2e changes, which this WSL cannot build (no GTK), and the port's Linux-testable code did not change. Before: the port's copy and `origin/main`'s, side by side, same cfire, `127.0.0.1` → `127.0.0.2` in the copies only: **the same results**. Suites: keychain (no Secret Service in WSL) and uievents (no GTK) fail on both, the rest pass; the port's fonts test first failed to compile on Linux (a `{names}` slice in a message, fine on libc++, not on GCC 13's libstdc++; fixed, and noted for cfire). `cli-e2e`: **338/346 on both**, the same 8 `localhost` checks. `cli-e2e` now builds the GUI target too (`cfire build`), which this WSL cannot (no GTK): the copies used `cfire build flint` |

### Before the merge (`windows-port`, cfire `24a43f6` + patches)

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
  Re-run after the dialog path fix: 138 pass again, once `scripts/gui-e2e.js` waits up
  to 5 s for the lock screen to go after an unlock. Two runs in a row had failed "the lock
  screen is gone": the tree showed a moment before the lock screen left. A timing fix in
  the shared script, worth carrying to `main`.
- **CLI ↔ app** (2026-11-09): `windows/serve-e2e.sh`, **49/49** in about 40 s, four runs
  after the harness fixes below: three green, one with a single failure (next line). It
  covers the CLI on its own (`locked` with the app off), the app serving over AF_UNIX
  with one approval for "flint, started by wsl", the same stdout, stderr and exit code
  served and local, `exec` and `cp` (300 KB both ways, byte for byte) run in the app
  against a throwaway sshd, a **new caller denied** ("flint, started by cscript"), a second
  launch showing the running app, the socket gone after quit, and, with the app closed,
  the CLI starting `flint-app.exe` beside it, `vault unlock` waiting for the window, and
  the CLI then working through it.
  - **Intermittent, 1 run in 4:** in the last phase (the app the CLI started),
    `host add e2e-stop-2` was asked again and nobody answered (`approval_timeout`, 16).
    The started app's page log is not captured (it is detached), so the cause is open.
  - **Harness fixes that got it there** (none in Flint itself): the CLI waits until the
    page has unlocked before polling; the page checks the master password field kept its
    text before clicking Unlock, and retries (the unlock screen rendered again just after
    it appeared and came back empty; a person never sees that); the script stops at once
    if the page did not unlock, and logs the page's text; an sshd left by an interrupted
    run is killed first (it held the port with other keys: every `exec` failed with
    `auth`); the relay gets 30 s to start; the second launch has a `timeout`.
- **Create and open a vault from the app** (2026-11-09, owner): with the dialog paths
  converted, both work in the installed app (`D:\Programas\Flint`).
- **cfire probes** (2026-11-09, `windows-fixes` with 0007 and 0008): `windows/run-probes.sh`
  green: hello, platform files, core 9/9, stdlib suite 14/14, webui offscreen 4/4, the
  webui window. In the first of two runs the offscreen step stopped the script with no
  output (`set -e` on an empty `grep`); alone and in the second run it passed.

## Not done yet

| Item | Note |
|---|---|
| Interactive `connect` | Needs a person at Windows Terminal: `windows/ssh-lab.sh start`, then the command in the part 5 report. Raw console, resize without SIGWINCH, Ctrl+C, UTF-8 typing, the console restored on exit |
| Host key prompt in a real terminal | The `GetConsoleWindow()` rule says Windows Terminal (ConPTY) has a window handle; checked only that the hidden interop console has none |
| Credential Manager by a person | The CLI only deletes entries (D-038: `vault lock`, `vault forget`); the app writes them when "remember" is on. Checked with the adapter's test; a person looks once the GUI runs (part 6): `cmdkey /list:Flint/*`, or Control Panel → Credential Manager → Windows Credentials → Generic Credentials, target `Flint/<vault id>` |
| GUI person checks (part 6) | Win+L and sleep with the app unlocked, a real dialog (save a key), a drag from Explorer into the Files view, `cmdkey /list:Flint/*` with "Remember on this computer". The icons are done (Explorer, title bar, taskbar, tray: owner, 2026-11-09) |
| `serve-e2e` last phase | Intermittent `approval_timeout` on `host add e2e-stop-2` (1 run in 4, see Verified); capture the started app's log to find out why |
| Windows Hello, `set_dark_mode` at run time | Ideas below |
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
- **A path that exists can still read as missing.** A listening AF_UNIX socket's file is a
  reparse point that `std::filesystem::exists` cannot follow (error 1920), so cfire's
  `fs.exists` said false and the CLI thought the app was not running (cfire W-14). On
  Windows, ask about the file itself (`symlink_status`, what `lstat` is on POSIX) before
  calling a path missing.
- **A window started from WSL never gets the foreground.** Windows gives focus only to the
  process the user last touched; an `.exe` started from a WSL shell is not it. The window
  shows, but `focus`/`blur` never fire and `document.hasFocus()` stays false. Checks that
  need focus (the dialog focus trap) log themselves as skipped; a person checks them.
- **Windows and WSL each have their own `127.0.0.2`.** In mirrored mode `127.0.0.1` is
  shared (and broken here), but `127.0.0.2` is two addresses. A relay listening on
  Windows' `127.0.0.2:P` that forwards to WSL's `127.0.0.2:P` makes one `host:port`
  that the Windows app and the Linux sshd both agree on (`ssh-relay.ps1 -ListenHost`).
- **Normalise the caller chain where it is read.** The native code returned `exe` with
  `\` and `argv0` as the full image path, so `C:\…\flint.exe` never matched `flint` in
  `TRANSPARENT_EXES` and every command became its own caller, asked again each time.
  `exe` with `/` and `argv0` = the image name without `.exe` fixed it, before any rule
  in `domain/access.cf` saw them.
- **`.png` icons need `CreateIconFromResourceEx`.** `LoadImageW(IMAGE_ICON,
  LR_LOADFROMFILE)` reads `.ico` only and fails silently on a PNG; PNG bytes are valid
  icon resource data for `CreateIconFromResourceEx` (Vista+), sized with
  `GetSystemMetrics` (cfire W-12). The `.exe`'s own icon is a resource, so it needs
  windres at build time (W-13).
- **Windows reuses pids, and a parent pid can be stale.** Toolhelp keeps a process's
  `th32ParentProcessID` after the parent exits, and Windows hands pids out again quickly.
  `ipc_caller` walks `ppid` with no check that the parent was created **before** the
  child, so a chain can step into an unrelated process that took the parent's old pid,
  and the window names the wrong program. The definitive port should stop the walk when
  a parent's creation time is later than its child's (the times are already read with
  `GetProcessTimes`); POSIX does not need it (a dead parent's children are reparented).
- **Edges are every place a path comes in, not only the command line.** The CLI turned
  `\` into `/`, but the GUI's file dialogs returned `C:\…` and both creating and opening
  a vault failed ("vault path must be absolute"). List the inputs: arguments, dialogs,
  drops, environment variables, config files.
- **A test page must check what it typed.** A React screen can render again right after
  it appears and drop a field's value; the page then submits an empty form and waits
  forever. Read the value back before submitting, retry, and make the harness stop at
  the first failed step with the page's text in the log, instead of running forty
  commands that can only fail (each costs seconds; a hang costs the whole timeout).
- **A Windows test binary started from a WSL folder sees "/tmp" on the WSL share.** A
  rooted path without a drive is relative to the current drive, and from WSL that is
  `\\wsl.localhost\<distro>`: SQLite cannot lock files there ("database is locked") and a
  socket file cannot get an ACL. Run Windows tests from a folder under `%TEMP%`
  (`windows/test-suites.sh`), where "/tmp" is `C:\tmp`.
- **Kill what an interrupted run left before starting.** An sshd from a stopped run kept
  the port with other keys, and the next run's `exec`s all failed with `auth`, which
  looked like a Flint bug. Also: `Stop-Process` returns before the `.exe` is released;
  wait for the exit before copying over it.

## Ideas for the definitive port on `main`

Not done here; worth doing when `main` redoes the port on a cfire with Windows support.

| Idea | Why |
|---|---|
| **Clipboard through `navigator.clipboard`** for plain copies, the native code only for secrets | WebView2 grants the async clipboard API to the app's origin; one code path on all three platforms. Secrets still need the native write, for the "no history, no cloud" formats and the clear timer |
| **File dialogs in ext:webui on `IFileDialog`** (cfire W-15) | No `MAX_PATH` buffer, the modern dialog, folder pickers (`FOS_PICKFOLDERS`); Flint's own `flint_dialog` stays empty on Windows |
| **Presence with Windows Hello** (`UserConsentVerifier`, WinRT) | Today the window asks for the master password instead (the degraded fallback). Hello is the Windows equivalent of Touch ID / polkit for "the owner is here" |
| **The CLI from WSL delegating to `flint.exe`** | As 1Password's `op.exe`: one vault, one app, one approval ("flint, started by wsl"), no Linux build to keep in step. A `flint` shim in WSL's `PATH` that calls the Windows binary, with arguments' paths translated (`wslpath -w`) |
| **An icon per platform in `build.cf`** | Today W-13 looks for the `.ico` beside the `.icns`; an explicit `Icon` per target (or a list) is clearer, and the same `.rc` can carry a `VERSIONINFO` |
| **WebView2's data folder name** | WebView2 keeps its profile in `%LOCALAPPDATA%\flint-app` (the `.exe` name). Name it `Flint` (or `Flint\WebView2`) through the environment options, so uninstalling and support know where it is |
| **A tray glyph for the light taskbar** | The tray PNG is drawn for a dark bar; on Windows' light theme it is hard to see. Pick the glyph from `SystemUsesLightTheme` (and on change, `WM_SETTINGCHANGE`) |
| **`set_dark_mode` at run time** | cfire reads the flag once when the window is made, on every backend; on Windows `DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)` can be called again, so the title bar follows the page's theme without a restart |
