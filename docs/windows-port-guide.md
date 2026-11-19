# Flint on Windows: port guide

How Flint builds, runs, is checked and is packaged on Windows, on **stock cfire `v0.12.2`**:
cfire's Windows release, natively in MSYS2 CLANG64, with none of the patches the first
port needed. Worked out in step 6 of the cfire move ([`cfire-migration.md`](cfire-migration.md),
2026-11-18 and 19) on the dedicated Windows test VM.

| Three files, three readers | |
|---|---|
| This file | For us: how to build, check and package Flint on Windows; what Flint changed for it; the lessons |
| [`cfire-windows.md`](cfire-windows.md) | For cfire's author: each gap (W-NN), and in *On stock cfire v0.12.2* whether cfire covers it now |
| [`rdp-windows.md`](rdp-windows.md) | The RDP adapter's Windows build |

The first port (2026-11-09 to 17, branch `windows-port-2`) cross-compiled from WSL2 with
llvm-mingw on a patched cfire (`c5b1d4b` + patches 0001-0009). That branch, its patches
and this file's earlier version (`git show windows-port-2:docs/windows-port-guide.md`)
are the record of it; none of its WSL bridge is used any more.

## Set up a Windows machine

Windows 10 1803 or later (AF_UNIX sockets); checked on Windows 11 22H2.

1. **MSYS2** in `C:\msys64`, and its **CLANG64** shell for everything below.
2. **`windows/bin/setup.sh`**: everything else Flint needs, beside MSYS2. Each piece is
   checked first and fetched only when missing or of another version, so a second run
   installs nothing:
   - pacman: `mingw-w64-clang-x86_64-{libsodium,libssh,sqlcipher,curl-winssl,cmake,ninja}`
     and the tools the checks use (`unzip`, `diffutils`, `vim`);
   - cfire's Windows release zip (SHA-256 from the release's `SHA256SUMS.txt`);
   - `WebView2Loader.dll` (NuGet, Microsoft's signature) and Node (to build `ui/`);
   - FreeRDP 3 built static by `windows/bin/freerdp.sh`, so the app ships no FreeRDP or
     OpenSSL DLLs.
3. **`. windows/bin/env.sh`** in every shell: cfire and the tools on `PATH`, Flint's
   Windows pkg-config files, and every temp file and cache under `FLINT_WIN_HOME`
   (`windows/bin/home.sh`: `C:\flint-work` on the test VM, `%LOCALAPPDATA%\flint-build`
   elsewhere). Nothing goes to `C:\tmp`.

**From PowerShell alone:** `windows\build.ps1` (`-Install` to install it too) does the
same from a fresh clone: MSYS2 if missing, `setup.sh`, then `package.sh`. Installing
MSYS2 itself is not checked yet (ROADMAP §7).

## Build, package, install

| To… | Run (CLANG64, after `env.sh`) | Gives |
|---|---|---|
| Build the CLI | `cfire build flint` | `build/flint.exe` |
| Build the app | `scripts/build-gui.sh` | `build/gui/Flint.exe` and `build/gui/ui/` |
| Build all three binaries | `cfire build` | adds `flint-vault-server.exe` (Windows only for the checks) |
| Make the portable zip | `windows/package.sh` | `dist/flint-<version>-windows-x86_64.zip` and its SHA-256 |
| Install it for this user | the zip's `install.ps1` (`-Uninstall` to remove) | `%LOCALAPPDATA%\Programs\Flint`, a Start menu entry, `flint` on the user's `PATH` |

The zip holds one folder: `flint.exe`, `flint-app.exe` (the app: `Flint.exe` beside
`flint.exe` would be the same file on a case-insensitive disk), `ui\`,
`WebView2Loader.dll`, `install.ps1` and `LICENSE`. Every `.exe` links statically and
imports only Windows' own DLLs; `package.sh` refuses to pack one that does not. So the
unpacked folder runs anywhere, with no MSYS2: the owner ran it that way on a second
Windows machine (2026-11-19). `-Uninstall` removes the folder, the Start menu entry and
the `PATH` entry; the vault and `%APPDATA%\Flint` stay.

## Check

On the test VM, every check is one of `main`'s own scripts, run natively in MSYS2's
bash and driven from the Mac (the VM's clone only pulls the pushed branch):

| From the Mac | Does |
|---|---|
| `windows/remote.sh <script>` | Sends a bash script and runs it in CLANG64 over `flint exec` (one approval; `--put <file> <path>` copies one file into the clone) |
| `windows/remote.sh windows/vm/pull.sh` | The clone to the pushed branch |
| `windows/remote.sh windows/battery.sh` | The cfire probes (`windows/run-probes.sh`, one per W-NN), the build, `scripts/test.sh`, cli-e2e and server-e2e: a line per step, a summary, an exit code |
| `windows/desktop.sh <script>` | Runs a script **in the logged-on desktop session** (the `FlintDesktop` scheduled task, `windows/vm/desktop-setup.ps1`) and waits for it: what an SSH logon cannot do, a WebView2 window and Credential Manager. For gui-e2e, serve-e2e, sync-e2e and the keychain suite |

Long runs write their log on the VM (`$TMPDIR`, under `C:\flint-work\tmp`) and are read
with a second, short script. `windows/vm/test-all.sh` and `windows/vm/e2e.sh` run one
suite set or one e2e under the battery's lock. Watch desktop runs through Proxmox's
console (noVNC), never RDP: it would take the session away. `windows/front.py` brings
the app's window to the front before a gui-e2e run that needs focus (W-16).

**What does not run on Windows, by decision:** POSIX file modes (NTFS ACLs, and MSYS2
mounts `C:` `noacl`), the SSH agent (libssh speaks AF_UNIX only; Windows' agent is a
named pipe), a clean SIGTERM stop of `flint-vault-server` (all in ROADMAP §7).

## What Flint changed

Every native change sits behind `#if defined(_WIN32)`; macOS and Linux keep their code
paths. Shims for what cfire still lacks are tagged `// CFIRE-UPSTREAM:`.

| Area | File | Windows side |
|---|---|---|
| Link flags | `src/adapters/pkgconfig/windows/*.pc` | `flint-native.pc`: `Requires: libssh libcrypto zlib` (MSYS2's static libssh lists no `Libs.private`), `-ladvapi32 -lcrypt32 -lws2_32 -liphlpapi -lbcrypt`; `flint-native-gui.pc`, `flint-rdp.pc`, `flint-remote.pc`, `flint-server-native.pc` for the app, RDP, libcurl and the server |
| Sockets | `ipc/native/flint_sock.hpp` | `closesocket`, `WSAPoll` (`poll_one`, `poll_two`), `WSAGetLastError`, `ioctlsocket(FIONBIO)`, `WSAStartup` once, and a socketpair over loopback TCP (Windows has none) |
| IPC (CLI ↔ app) | `ipc/native/flint_ipc.hpp` | **AF_UNIX**, not a named pipe: the same code shape. Peer pid from `SIO_AF_UNIX_GETPEERPID`; "same uid" = the same token user SID. Mode 0600 = a protected DACL with one ACE for the owner. A stale socket file is recognised by its reparse tag `IO_REPARSE_TAG_AF_UNIX` |
| Caller chain | `ipc/native/flint_peer.hpp`, `domain/access.cf` | ppid from a Toolhelp snapshot, start time from `GetProcessTimes`, path from `QueryFullProcessImageNameW`; `exe` with `/`, `argv0` = the image name without `.exe` (else `C:\…\flint.exe` never matched `flint` in `TRANSPARENT_EXES`). `cmd`, `powershell`, `pwsh` are transparent; `WindowsTerminal` reads "Windows Terminal" |
| Keychain | `keychain/native/flint_keychain.hpp` | Credential Manager: a generic credential, target `Flint/<vault id>`, `CRED_PERSIST_LOCAL_MACHINE`; the remote vault's token as account `remote-token:<vault id>` |
| Local files | `process/native/flint_fs.hpp` | Wide APIs from UTF-8; `_wopen` with `_O_BINARY`; rename with `MoveFileExW(REPLACE_EXISTING)`; synthesised modes 0755/0644/0444 |
| Terminal | `process/native/flint_process.hpp` | `CONIN$`/`CONOUT$` for prompts, **only when the console has a window** (`GetConsoleWindow()`); raw mode = console modes + VT input/processing + UTF-8 code pages, restored at exit and by `SetConsoleCtrlHandler`; no SIGWINCH, so `read_input` compares the window size each call |
| SSH | `ssh/native/flint_ssh.hpp`, `ssh/libssh.cf` | Dialling and the jump-host tunnel on `flint_sock`; `NUL` for an empty known_hosts |
| Config folder | `adapters/config/recents.cf` | `%APPDATA%/Flint` |
| Paths | `domain/files.cf`, `adapters/process/process.cf`, `drivers/clicmd/commands.cf`, `drivers/gui/rpc.cf` | One form of local path, `/`: `\` becomes `/` at every edge (`local_slashes`, `current_dir`, the file dialogs' results); `is_absolute_path()` accepts `C:/…`. Remote paths stay POSIX |
| `flint cp` | `drivers/clicmd/files_commands.cf`, `domain/files.cf` | `C:\…` / `C:/…` is a local path, not host `C` (`is_drive_path`, on Windows only) |
| App start (`serve`) | `drivers/clicmd/serve.cf`, `adapters/process` | `spawn_detached`: `CreateProcessW` with `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP`, no inherited handles; the app is `gui\Flint.exe` (build tree) or `flint-app.exe` (install) |
| GUI: lock, sleep, front | `uievents/native/flint_sysevents.hpp` | A hidden window on its own thread: `WTS_SESSION_LOCK` is "screen", `PBT_APMSUSPEND` (and Modern Standby) is "sleep"; `bring_to_front` restores webui's window, `FlashWindowEx` when Windows refuses |
| GUI: presence | `uievents/native/flint_presence.hpp` | None yet: the window asks for the master password. Windows Hello is the candidate |
| GUI: clipboard | `uievents/native/flint_clipboard.hpp` | `CF_UNICODETEXT`; a secret also carries the no-history, no-cloud formats; the clear timer on a message-only window |
| GUI: copy and paste keys | `ui/src/lib/clipboardKeys.ts` | As Windows Terminal: Ctrl+Shift+C, Ctrl+Insert, Ctrl+C over a selection; Ctrl+Shift+V, Ctrl+V, Shift+Insert |
| GUI: password fields | `ui/` CSS | `::-ms-reveal` hidden: Edge's own eye beside Flint's |
| GUI: fonts | `fonts/native/flint_fonts.hpp` | `EnumFontFamiliesExW`, `FIXED_PITCH`, no `@` vertical faces |
| RDP tab | `windows/bin/freerdp.sh`, `rdp/native/flint_rdp.hpp` | FreeRDP 3.33.1 static, linked into the app only; the shim's Windows fixes in [`rdp-windows.md`](rdp-windows.md) |
| Remote vault client | `pkgconfig/windows/flint-remote.pc` | libcurl over Schannel (the Windows certificate store), from MSYS2's `curl-winssl` |
| Packaging | `windows/package.sh`, `install.ps1`, `build.ps1`, `bin/setup.sh` | Above |

What cfire covers on `v0.12.2` and what is still open (W-10 the WebView2 loader, W-16
focus after Alt+Tab, W-07 Windows CI) is in [`cfire-windows.md`](cfire-windows.md).

## Lessons

- **Native beats the bridge.** WSL interop turned "compiles" into "runs" for the first
  port, at the cost of a relay for every socket and path (`wslpath`, `WSLENV`, loopback
  relays, `%TEMP%` copies). MSYS2 CLANG64 on the machine itself runs `main`'s own scripts
  unchanged but for a few `case "$(uname -s)"` lines.
- **Link static, and check it.** A missing DLL fails with no message (exit 53).
  `package.sh` reads every `.exe`'s imports and stops on any DLL that is not Windows' own
  (the UCRT API sets `api-ms-win-crt-*` and `WINSPOOL.DRV` are).
- **Keep one form of local path** (`/`) and convert at every edge: arguments, file
  dialogs, drops, environment variables, config files.
- **AF_UNIX on Windows is good enough** for a same-user local socket, but a listening
  socket's file is a reparse point: ask about the file itself before calling it missing.
- **Windows sockets are not fds.** Route all socket I/O through one helper.
- **Text mode bites:** CRT files need `_O_BINARY`.
- **A Windows console is not a person.** A process with a console but no window (a
  scheduled task, `CREATE_NO_WINDOW`) still opens `CONIN$`, and a prompt there blocks
  forever. Ask `GetConsoleWindow()` first, as POSIX asks whether `/dev/tty` opens. Tests
  use the same rule to run `flint` with no terminal: serve-e2e restarts itself once in
  a console with no window.
- **Windows has no exec, so a wrapper stays a parent.** Every process between a test and
  `flint` is in the caller chain Flint reads; a wrapper per command is a new caller per
  command, and no grant covers it. Under MSYS2 even a program that forks (perl's
  `system()`) leaves a copy of itself as `flint`'s parent (ROADMAP §7).
- **Python's `subprocess` on Windows inherits no handles unless given them**, and a
  scheduled task's process has no stdin handle at all: pass `stdin=DEVNULL`.
- **Windows reuses pids, and a parent pid can be stale.** Toolhelp keeps a dead parent's
  pid, which Windows hands out again; a caller walk should stop when a parent was
  created after its child.
- **A window started from the background never gets the foreground.** Windows gives
  focus to the process the user last touched; gui-e2e's runs click the title bar first
  (`windows/front.py`), and W-16 is open upstream.
- **`Flint.exe` and `flint.exe` are one file** on a case-insensitive disk.
- **`C:\x` looks like `host:path`.** Anything that splits on `:` needs a drive-letter rule.
- **Windows will not replace a running `.exe`.** Run test servers from a copy, and kill
  what an interrupted run left (its `flint`, its `bash`) before the next one.

## Ideas

| Idea | Why |
|---|---|
| **Presence with Windows Hello** (`UserConsentVerifier`) | Today the window asks for the master password, the degraded fallback |
| **Clipboard through `navigator.clipboard`** for plain copies | One code path on all three systems; secrets keep the native write |
| **A failed re-key rename reopens the old vault** | On Windows the re-key closes the vault before the rename, and a failed rename leaves it locked |
| **WebView2's data folder named `Flint`** | It is `%LOCALAPPDATA%\flint-app` (the `.exe` name) today |
| **A tray glyph for the light taskbar**, **`set_dark_mode` at run time** | Follow Windows' theme without a restart |
| **The CLI from WSL delegating to `flint.exe`** | As 1Password's `op.exe`: one vault, one app, one approval |
| An installer (Inno Setup), the WebView2 runtime check, signing | ROADMAP §7, *Releases* |
