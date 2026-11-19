# cfire on Windows: what we ran, what broke, what we changed

A reference for cfire's author, who has no Windows machine. Flint ran cfire on a real
Windows 11 from WSL2, fixed what it could in a **local** copy of cfire, and wrote down
each problem with the patch that fixed it. **Nothing here is an issue or a PR.** The
patches show *what* changed and *why*; rewrite them in cfire's own patterns.

Sibling of [`cfire-upstream.md`](cfire-upstream.md), which tracks every other gap
(CF-NNN). This file is Windows only, and lives on Flint's Windows branches
(`windows-port-2`, frozen at `d191abd`; `cfire-0.12-windows` since 2026-11-18).

**Since 2026-11-18 Flint runs on stock cfire `v0.12.2`**, natively on the Windows test
VM, with none of patches 0001-0009: [On stock cfire v0.12.2](#on-stock-cfire-v0122)
below says, for each entry, whether cfire covers it now. The patches stay on
`windows-port-2`; the entries below them are the record of the port on `c5b1d4b`.

| | |
|---|---|
| cfire base | `c5b1d4b` (v0.10.0, 2026-11-09) |
| Local cfire | `~/Personal/Proyectos/cfire/cfire-windows`, branch `windows-fixes`, never pushed |
| Patches | `docs/cfire-windows/patches/` on `windows-port-2` (`git format-patch c5b1d4b..windows-fixes`) |
| Windows | Windows 11 build 26200, x64, WebView2 Evergreen runtime 156 |
| Toolchain | llvm-mingw 20261104 (clang 23.1.5, ucrt, libc++), MSYS2 CLANG64 libraries |
| Probes | [`windows/`](../windows/): `run-probes.sh` rebuilds and reruns everything below |

## Summary

| ID | What | Status | Patch |
|---|---|---|---|
| [W-01](#w-01) | `cfire build --target x86_64-w64-mingw32` uses the host's clang and headers; `import cpp` ignored `CFIRE_CXX` | worked around; `import cpp` **fixed** | 0005 |
| [W-02](#w-02) | `cfire test` / `cfire run` look for the binary without `.exe` | **fixed** | 0001 |
| [W-03](#w-03) | `os.cwd()` returns a path, not `str`: does not compile on Windows | **fixed** | 0002 |
| [W-04](#w-04) | `.exe` needs `libc++.dll` and `libunwind.dll`; fails silently without them | worked around | none |
| [W-05](#w-05) | `println` writes `\r\n` on Windows | question | none |
| [W-06](#w-06) | `ext:webui`: no WebView2 in the window | **fixed** | 0004 |
| [W-07](#w-07) | cfire's Windows CI never got past its first build step | open | none |
| [W-08](#w-08) | `*_unix.cf` is compiled for Windows too | **fixed** | 0003 |
| [W-09](#w-09) | `WebView2.h` includes `EventToken.h`; mingw ships `eventtoken.h` | worked around | none |
| [W-10](#w-10) | cfire does not know where the WebView2 SDK is, nor ship `WebView2Loader.dll` | worked around | none |
| [W-11](#w-11) | `os.args()` is in the ANSI code page, not UTF-8 | **fixed** | 0006 |
| [W-12](#w-12) | `set_tray` / `set_icon` take `.ico` only on Windows; a `.png` is silently ignored | **fixed** | 0007 |
| [W-13](#w-13) | A Windows `.exe` has no icon: the build file's `Icon` is never embedded | **fixed** | 0007 |
| [W-14](#w-14) | `fs.exists` is false for an AF_UNIX socket file on Windows | **fixed** | 0008 |
| [W-15](#w-15) | The Windows file dialogs cut paths at `MAX_PATH` | open | none |
| [W-16](#w-16) | After Alt+Tab back, the WebView2 does not get the keyboard focus (**after the handoff, not sent**) | **fixed** | 0009 |
| [W-17](#w-17) | `<WebView2.h>` is included inside `namespace cfire::webui::detail`: a global `<ocidl.h>` or `<shlobj.h>` later declares nothing (**after the handoff, not sent**) | worked around in Flint | none |

**Works on Windows** (ran, not just compiled), with W-01, W-04, W-09 and W-10 worked
around and patches 0001–0006 applied:

| Check | Result | Confirms |
|---|---|---|
| Hello world | prints | CF-010.a, CF-010.b |
| cfire's own `tests/stdlib_suite_test.cf` | 14/14 pass | what cfire's Windows CI was meant to show (W-07) |
| TCP listen, connect, write, read on loopback | pass | CF-010.c (Winsock) |
| `net.socketpair()` both ways | pass | CF-010.g |
| `os.command` with spaces, quotes, trailing `\`, `&`, `\|` and an empty argument | arrive intact | CF-010.d (argument quoting) |
| `os.args()` of a child given `año-ñ ✓.txt` | arrives as UTF-8 | W-11 |
| `os.command` child writing 300 KB to stdout **and** stderr | no deadlock | CF-010.e (pipe draining) |
| `os.exec_output`, `os.pipe`, `getenv`/`setenv` with UTF-8, `getpid` | pass | |
| `fs` write, read, remove under a UTF-8 path (`probe-ñ-✓/archivo-ü.txt`) | pass | CF-010.a |
| `_windows.cf` / `_unix.cf` file selection | picks the right file | W-08 |
| `webui.App` window: page from `set_html`, a `bind` call answered, an `emit` received, `runtime.Quit()` | works, Edge WebView2 157 | W-06, CF-001.a–e |
| `app.run_webview_test` from `cfire test` (offscreen): success, timeout, rejected call | 3/3 pass | CF-001.g |

## On stock cfire v0.12.2

Step 6 of `docs/cfire-migration.md` (2026-11-18): cfire's Windows release
(`cfire-v0.12.2-windows-x86_64.zip`, SHA-256 from the release's `SHA256SUMS.txt`) on the
Windows test VM (Windows 11 Pro 22H2, build 22621, WebView2 157), in MSYS2 CLANG64
(clang 23.1.5), natively: no WSL, no cross-compiling, no patches. Each entry is
**covered** (Flint's workaround goes), **covered differently** (Flint adapts) or
**open** (a report with a repro; the port keeps a Flint-side shim or waits).

| ID | On `v0.12.2` | Evidence | Flint |
|---|---|---|---|
| W-01 | **covered differently**: cfire's supported Windows path is native MSYS2 CLANG64 (Q55), not cross-compiling, and the release ships `cfire.exe` for it | [ran] `cfire doctor` 10 passed, `cfire build flint` → `flint.exe` | `windows/bin/env.sh` sets up CLANG64 instead of a cross toolchain; `xcxx`, `sysroot.sh`, the `pkg-config --static` wrapper and `curl.sh` go (libsodium, libssh, SQLCipher, libcurl over Schannel from pacman; FreeRDP built natively, `freerdp.sh`) |
| W-04 | **covered**: every Windows target links `-static` (with `ws2_32`, `advapi32`, `shell32`); `flint.exe` imports only system DLLs (UCRT, Winsock, Crypt32, Secur32, …) | [ran] `run-probes.sh` hello; `objdump -p build/flint.exe` | the static link flags went with W-01. **One gap left:** cfire asks pkg-config without `--static`, and MSYS2's `libssh.pc` and `libsodium.pc` do not define `LIBSSH_STATIC`/`SODIUM_STATIC` even with it, so their headers declare `dllimport` and the link fails (`undefined symbol: __declspec(dllimport) ssh_free`). cfire defines `LIBSSH_STATIC` only for its own `ext:net/ssh`; Flint's `pkgconfig/windows/flint-native.pc` defines both |
| W-02 | **covered**: `cfire test` and `cfire build -o x.exe` find and run the `.exe` | [ran] every `cfire test` in `run-probes.sh` and the suites | nothing to remove (patch 0001 only) |
| W-03 | **covered**: `os.cwd()` is a `str` on Windows | [ran] probe `os: env, cwd, pid` (`here: str = os.cwd()` builds) | nothing to remove (patch 0002 only) |
| W-05 | **covered**: stdin, stdout and stderr are in binary mode, `println` writes `\n` | [ran] probe: a child printing 3000 lines of 100 bytes gives exactly 300 000 bytes on each stream | the probe no longer normalises `\r\n` |
| W-08 | **covered**: `*_unix.cf` is left out on Windows | [ran] probe `platform_files` prints `platform: windows` | nothing to remove (patch 0003 only) |
| W-11 | **covered**: `os.args()` is UTF-8 from the UTF-16 command line | [ran] probe: a child given `año-ñ ✓.txt` prints it back intact | nothing to remove (patch 0006 only) |
| W-07 | **covered**: the `windows` job of cfire's CI passes (MSYS2 CLANG64), and green `main` CI publishes the Windows archives | [read] CI run on `f8304b1`, the parent of `v0.12.2` (`5be0987`, the version bump; its green CI made the release): `linux`, `windows`, `test`, `fuzz-smoke` success; the release carries `cfire-v0.12.2-windows-x86_64.zip` | nothing in Flint |
| W-17 | **open, in another form**: `windows_webview2.hpp` still includes `<WebView2.h>` (when the SDK is there) and `<eventtoken.h>` inside `namespace cfire::webui::detail`; without the SDK it declares its own interfaces there, and only the ones its window uses | [compiled] the app builds with no SDK; Flint's two-monitor shim stopped at `ICoreWebView2_3` and `wv2_load_loader` (patch 0004's names) | `flint_monitors.hpp` declares `ICoreWebView2_2`/`_3` itself on cfire's `ICoreWebView2` and creates its environment with cfire's `wv2_create_environment`; the tunnels' and RDP shims' workarounds stay. A public way to open a second web view (or the declarations in a header of their own, at global scope) would remove it |
| W-09 | **covered**: no `EventToken.h` problem: cfire includes `<eventtoken.h>` when there is one and declares the token otherwise, and a native build has no case-sensitive file system anyway | [compiled] `Flint.exe` builds in CLANG64 with no WebView2 SDK | the `EventToken.h` shim went with `sysroot.sh` (W-01) |
| W-06 | **covered**, with W-10's loader: a window from `ext:webui` shows its page, a bound call answers, an event arrives, `runtime.Quit()` closes it; `run_webview_test` offscreen passes | [ran] `FLINT_PROBE_WEBUI=1 windows/run-probes.sh` in the desktop session (`windows/desktop.sh`, 2026-11-19): webui offscreen 5/5, the window's page called `greet` and saw the event (Edge WebView2 157) | nothing to remove (patch 0004 only) |
| W-10 | **open, a new report**: the fallback that should make `WebView2Loader.dll` unnecessary never finds the installed runtime: it reads a value `EBWebView` the EdgeUpdate key does not have (the key holds `location` and `pv`), so without the loader every webui window stays black with "the WebView2 Runtime is not installed" | [ran] probe `webui` in the desktop session (2026-11-19): black window and that message with WebView2 157 installed; the key read with PowerShell; the same probe green with the loader on `PATH` | the app ships `WebView2Loader.dll` beside `flint-app.exe` (Microsoft's documented loader, redistributable, from the `Microsoft.Web.WebView2` NuGet package, 1.0.4314.35, Microsoft signature checked); on the VM it is on `PATH` (`windows/bin/env.sh`). Report: [W-10 on v0.12.2](#w-10-on-v0122) |
| W-12 | **covered**: `win32_load_icon_file` takes a `.png` (by its signature, through `CreateIconFromResourceEx`) or an `.ico`, at the system's sizes, for the window and the tray | [ran] owner, 2026-11-19, in the desktop session: Flint's icon in the tray, its menu on a right click. The light Linux glyph (`ui/tray.png`) was barely visible on a light taskbar: Windows now gets the app icon in colour (`ui/public/tray-color.png`, D-104) | nothing to remove (patch 0007 only) |
| W-13 | **covered**: `cfire build` embeds the `.ico` beside `build.cf`'s `Icon` with windres | [compiled] `Flint.exe` has a 42 KB `.rsrc`; [ran] owner, 2026-11-19: the glyph in the title bar and the taskbar | nothing to remove: `Flint.ico` beside `Flint.icns` is what cfire looks for |
| W-14 | **covered**: `fs.exists` asks `symlink_status` when `exists` fails, so a listening AF_UNIX socket's file (a reparse point) is seen | [ran] probe `unix_socket` (`run-probes.sh`): a socket bound and listening under `%TEMP%`, `fs.exists` true; the CLI ↔ app handoff itself waits for serve-e2e | nothing to remove (patch 0008 only) |
| W-15 | **covered** (the symptom): the open and save dialogs give `GetOpenFileNameW`/`GetSaveFileNameW` a buffer of 32 768 characters, so a long path no longer reads as "cancelled". Still the old dialogs, not `IFileOpenDialog` (no folder picker) | [ran] owner, 2026-11-19: a vault saved and opened through the dialogs under a folder whose path passes 260 characters, the whole path back in Flint. Found on the way: the path came back as `C:/flint-work\tmp\...` (Flint's `local_slashes` used 0.12's first-match `.replace`, CF-151; fixed, `6cc8178`) | nothing in Flint: it calls `open_file_dialog`/`save_file_dialog` as on the other systems (`src/drivers/gui/rpc.cf`) |
| W-16 | **open**: the WndProc still has no `WM_SETFOCUS`, and `ICoreWebView2Controller::MoveFocus` is declared but never called, so after Alt+Tab back the page gets no keys until it is clicked | [ran] owner, 2026-11-19, probe `webui_focus` in the desktop session: after Alt+Tab back the window is active, `document.hasFocus()` false, no key arrives until a click | a shim (owner, D-104): `adapters/uievents/native/flint_focus.hpp` hands the focus to the WebView2 host child when Flint's window comes to the front; report [W-16 on v0.12.2](#w-16-on-v0122) |
| W-18 | **open**: a cfire name that `<windows.h>` defines as a macro (`far`, `near`, `small`) still loses its name in C++ | [ran] probe `win_macros` (`run-probes.sh`): `far := 1` with `import cpp "windows.h"` fails with `expected unqualified-id`, as at `c5b1d4b` | the test variable stays `apart` (`src/domain/monitors_test.cf`); the probe says when it can go. Report: the repro and the suggested fix of the W-18 section below |

## How to read each entry

- **Evidence** says how it was established: **[ran]** a binary ran on Windows,
  **[compiled]** the compiler or linker showed it, **[read]** found in the source only.
- **Suggested fix** is what we would do in cfire. **Patch** is what we did to keep going,
  the smallest change that works, not necessarily the right design.

---

## W-01

**`cfire build --target x86_64-w64-mingw32` uses the host's clang and headers** ·
[compiled] · worked around · the same as CF-010.k, still true at `c5b1d4b`

- **Symptom:** from Linux, `cfire build --target x86_64-w64-mingw32 main.cf` fails at the
  first include: `cfire_prelude.hpp:6:10: fatal error: 'algorithm' file not found`. cfire
  runs the host's `clang++ --target=…`, which has no Windows libc++ or Windows headers.
- **What works:** `CFIRE_CXX` already exists (`buildsys.hpp:736`). Pointed at llvm-mingw's
  `x86_64-w64-mingw32-clang++`, the same command builds a real PE32+ `.exe`. Native
  libraries (zstd, simdjson, sqlite, sodium, openssl) come from MSYS2 CLANG64 packages
  unpacked into a sysroot, the same family cfire's own CI installs. Our wrapper is
  [`windows/bin/xcxx`](../windows/bin/xcxx), and the sysroot comes from
  [`windows/bin/sysroot.sh`](../windows/bin/sysroot.sh).
- **Suggested fix:** for a `*-w64-mingw32` target, look for `<triple>-clang++` on `PATH`
  before falling back to `clang++ --target`, and document `CFIRE_CXX`. `cfire doctor` has
  a "Cross-Platform Targets" section that lists wasm but not Windows: a line there that
  finds llvm-mingw (or says how to get it) would make this discoverable.
- **Patch:** none for the compiler choice. A wrapper outside cfire was enough.
- **Then `import cpp` failed** · [compiled] · fixed ·
  [patch 0005](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0005-fix-build-read-import-cpp-headers-with-CFIRE_CXX-lik.patch).
  With `CFIRE_CXX` set, the build itself used llvm-mingw, but every `import cpp` stopped
  first: `clang AST ingestion failed for sodium.h: 'stdlib.h' file not found`.
  `inspect_header()` (`clang_bridge.hpp`) runs a fixed `clang++` over the header with the
  build's cflags, which carry `--target=<triple>`, so the host clang looked for Windows
  headers it does not have. The patch uses `CFIRE_CXX` there too, falling back to
  `clang++`. Suggested fix: one place that resolves the compiler
  (`resolve_cxx_compiler` in `buildsys.hpp`), used by both.

## W-02

**`cfire test` and `cfire run` look for the binary without `.exe`** · [ran] · fixed ·
[patch 0001](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0001-fix-build-name-the-test-run-binary-.exe-for-a-Window.patch)

- **Symptom:** cross-compiling, `cfire test --target x86_64-w64-mingw32 file.cf` builds,
  then fails with `sh: 1: /tmp/cfire-test-31267: not found` (exit 127). The file on disk
  is `/tmp/cfire-test-31267.exe`.
- **Cause:** `main.cpp` (two places: the suite loop and `run`/`test` of one file) picks the
  temp name's `.exe` with `#if defined(_WIN32)`, the **host**. The mingw linker appends
  `.exe` for a Windows **target** whatever the host is.
- **Patch:** a `build::is_windows_target(triple)` helper next to `is_ios_target` in
  `package_loader.hpp` (Windows/mingw triple, or no triple on a Windows host). Both temp
  names use it.
- **Why it matters beyond cross-compiling:** with it, `cfire test --target …` runs the
  test binary on Windows straight from WSL2. That is how every [ran] result in this file
  was produced.
- **Also:** `cfire build --target x86_64-w64-mingw32` prints
  `✓ Built Native Binary: …/build/flint` although the file is `build/flint.exe`.
  Cosmetic, same cause.
- **Suggested fix:** the same idea. The triple checks (`find("windows") || find("win32")
  || find("mingw")`) are repeated in `buildsys.hpp:82`, `:957`, `:632`, `:387` and
  `package_loader.hpp:31`; one helper could replace them all.

## W-03

**`os.cwd()` returns `std::filesystem::path`, not `str`** · [compiled] · fixed ·
[patch 0002](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0002-fix-os-os.cwd-returns-UTF-8-str-as-documented-on-eve.patch)

- **Symptom:** `here: str = os.cwd()` fails on Windows with
  `no viable conversion from 'std::filesystem::path' to 'str'`. On Linux it compiles.
  (`os.cwd().len()` fails everywhere: `no member '.len' in 'std::filesystem::path'`.)
- **Cause:** `core/os.hpp:83` returns the path itself. The docs and the sema catalog
  (`catalog_types.hpp:378`) say `fn cwd() -> str`. On POSIX, `path` converts to
  `std::string` implicitly, so it went unnoticed; on Windows `path::string_type` is
  `std::wstring`.
- **Patch:** return `current_path().u8string()` as `std::string`. Same family as CF-010.a
  (`c_str(path)` on Windows).
- **Suggested fix:** the same, and a check that no other `core:*` function documented as
  `-> str` returns a `path`. We found only this one (`grep -- "-> std::filesystem::path"
  runtime/`: the others are internal).

## W-04

**The `.exe` needs `libc++.dll` and `libunwind.dll`, and fails silently without them** ·
[ran] · worked around

- **Symptom:** the hello world exits with code 53 and prints nothing. 53 is the low byte
  of `0xC0000135`, `STATUS_DLL_NOT_FOUND`. `llvm-objdump -p` lists `libc++.dll` and
  `libunwind.dll`, which do not ship with Windows. Copying both next to the `.exe` fixes
  it.
- **Workaround:** our wrapper links with `-static`. The `.exe` then depends only on
  `KERNEL32.dll` and the UCRT `api-ms-win-crt-*` DLLs, which every Windows 10/11 has.
- **Suggested fix:** for a mingw target, link the C++ runtime statically by default
  (`-static`, or at least `-static-libstdc++ -static-libgcc` on GCC-style toolchains), or
  copy the DLLs next to the output. A user double-clicking the `.exe` sees nothing at all
  today: no window, no message.
- **Patch:** none yet. It belongs in `buildsys.hpp`, next to `-lws2_32 -ladvapi32`.

## W-05

**`println` writes `\r\n` on Windows** · [ran] · question for the author

- **What we saw:** a child printing 3000 lines of 99 bytes gave 303 000 bytes of stdout,
  not 300 000. The CRT's stdout is in text mode, so each `\n` becomes `\r\n`.
- **Why it is a question, not a bug:** both are defensible. Go writes `\n` on every OS;
  the C runtime writes `\r\n`. It matters for programs whose output is parsed (a `--json`
  flag, a pipe into another tool, a byte count in a test). Whatever cfire picks, saying
  it in the docs would help.
- **Patch:** none. Our probe normalises `\r\n` before counting.

## W-06

**`ext:webui`: no WebView2 in the window** · [ran] · fixed ·
[patch 0004](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0004-feat-webui-a-real-WebView2-in-the-Windows-window-CF-.patch) ·
CF-001.a–e and .g

- **Symptom (before):** a `webui.App` opened an empty Win32 window and printed
  `webui: WebView2 SDK header (<WebView2.h>) was not present at compile time…`. With the
  header present it would still have been empty: `runtime/` had no `ICoreWebView2` code.
- **Patch:** a `Wv2Host` in `windows_webview2.hpp`, built on the same contract as the Linux
  backend, so `bridge.hpp` and `webui.hpp` are untouched:

  | Linux (WebKitGTK) | Windows (patch) |
  |---|---|
  | `webkit_user_script_new(kPreloadBridgeJs, …START)` | `AddScriptToExecuteOnDocumentCreated(kPreloadBridgeJs)` |
  | `script-message-received::external` → `handle_ipc_message` | `WebMessageReceived` → `TryGetWebMessageAsString` → `handle_ipc_message` |
  | `app://` scheme → `resolve_asset` | `https://app.localhost/*` filter → `WebResourceRequested` → `resolve_asset` → `CreateWebResourceResponse` |
  | `platform_eval` → `g_idle_add` | `platform_eval` → `PostMessageW(kWmCfireEval)` → `ExecuteScript` on the UI thread |
  | `run_linux_webview_test` | the same `run_win32_webview2(…, offscreen=true)`, now with a WebView in it |

- **Design choices the author may want to revisit:**
  - **Origin `https://app.localhost`, not `app://localhost`.** WebView2 only serves a custom
    scheme when the environment is created with `ICoreWebView2EnvironmentOptions4` scheme
    registrations, which means implementing the options COM object as well. A virtual host
    answered in `WebResourceRequested` never touches the network, is a secure context, and
    is what Tauri does (`http://tauri.localhost`). Pages that use relative URLs do not
    notice; a page that hard-codes `app://localhost/` would.
  - **`WebView2Loader.dll` loaded at run time** (`LoadLibraryW` + `GetProcAddress`), so a
    missing DLL prints a message instead of Windows refusing to start the process.
    Alternatives: link `WebView2LoaderStatic.lib` (an MSVC library: may work with MSVC
    builds, untested with mingw), or a built-in loader that finds the installed runtime in
    the registry, as webview/webview does (no DLL to ship, but it calls an undocumented
    entry point).
  - **User data in `%LOCALAPPDATA%\<exe name>\WebView2`.** WebView2's default is a folder
    next to the `.exe`, which fails for a program installed in `Program Files`.
  - **COM callbacks from lambdas** (`Wv2Handler<I>`, signature taken from `I::Invoke`):
    WRL's `Callback<>` is MSVC-only. **IIDs are parsed at compile time** from the uuid
    strings in `WebView2.h`, because the SDK defines them only in `WebView2Guid.lib` (MSVC)
    and mingw has no `__uuidof` for these interfaces.
  - **Scripts sent before the first page load are queued** and run on the first
    `NavigationCompleted`. WebKitGTK runs them against whatever is loaded; queuing seemed
    the less surprising behaviour.
  - **Page background:** WebView2's default (white), as on WKWebView and WebKitGTK, and
    transparent only with `set_transparent(true)`. A first version painted it dark when
    `dark_mode` was on (the default) to avoid a white flash while loading: unstyled pages
    came out black-on-dark, so it was dropped. `dark_mode` stays the window chrome only.
  - Also: per-monitor DPI awareness (looked up at run time, Windows 10 1703+), and a clear
    message when the WebView2 Runtime is missing (`HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)`,
    CF-001.e). `-lshlwapi` is added to the Windows GUI link flags for `SHCreateMemStream`.
- **Verified:** [`windows/probes/webui/main.cf`](../windows/probes/webui/main.cf) in a real
  window (page, bound call, event, `Quit`; owner's visual check 2026-11-09: page renders,
  text sharp, dark title bar, white page), and
  [`webui_test.cf`](../windows/probes/webui/webui_test.cf) offscreen through `cfire test`:
  a page that quits (true), one that never does (false after the timeout), and a bound call
  that returns an error (the promise rejects with its message).
- **Not done:** CF-001.i, j (menus, the clipboard owner; icons from `.png` are W-12) and screenshots
  (`platform_screenshot`, which `CapturePreview` would give), `platform_fullscreen` and
  `platform_center` (no Windows hook yet), drag-and-drop of files from Explorer.

## W-07

**cfire's Windows CI has never passed its first build step** · [read] (CI logs) · open

- **Symptom:** the `windows` job of `.github/workflows/ci.yml` fails on every commit from
  `466751b` to `c5b1d4b`, at "Build cfire.exe on Windows":
  `git: command not found` → `Process completed with exit code 127`.
- **Cause:** the step runs `GIT_SHA=$(git rev-parse --short=7 HEAD)` inside the MSYS2
  shell, and the `msys2/setup-msys2` step does not install `git`. Nothing after it
  (`doctor`, `fmt --check`, the stdlib suite) has ever run on Windows.
- **Suggested fix:** add `git` to the `install:` list of `msys2/setup-msys2`, or compute
  the SHA in a step with the default shell and pass it in an env var. We have not
  changed the workflow: we cannot run it.
- **Good news for when it runs:** the suite it runs passes 14/14 on Windows (see
  Summary), so it should go green once the build step works, apart from anything
  `cfire.exe` itself does differently from our cross-compiled build.

## W-08

**`*_unix.cf` is compiled for Windows too** · [ran] · fixed ·
[patch 0003](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0003-fix-build-honour-the-documented-_unix.cf-suffix-so-i.patch)

- **Symptom:** a package with `name_unix.cf` and `name_windows.cf` (the same function in
  each) builds on Linux, and fails for Windows with
  `redefinition of 'cfire_pkg_plat__name'`.
- **Cause:** `cfire doc --llm` lists `*_unix.cf` among the OS-conditional files, but
  `package_loader.hpp` only handles `_darwin`/`_macos`, `_ios`, `_linux` and `_windows`.
  An unknown suffix means "always compile".
- **Patch:** `_unix` = every target except Windows and wasm. The probe
  ([`windows/probes/platform_files/`](../windows/probes/platform_files/)) prints
  `platform: unix` on Linux and `platform: windows` on Windows.
- **Also seen:** the docs list `*_wasm.cf` too, and it is not handled either (not
  Windows-related, not changed). `_windows.cf` *is* handled, but the docs do not list it.

## W-09

**`WebView2.h` includes `EventToken.h`; mingw-w64 ships `eventtoken.h`** · [compiled] ·
worked around

- **Symptom:** cross-compiling from Linux, `fatal error: 'EventToken.h' file not found`.
  On Windows the filesystem ignores case, so this only bites a cross build.
- **Workaround:** a one-line `EventToken.h` that includes `<eventtoken.h>`, in an include
  directory of its own ([`windows/bin/sysroot.sh`](../windows/bin/sysroot.sh)).
- **Suggested fix:** if cfire ever documents cross-compiling for Windows, ship the same
  shim with the runtime (or in whatever fetches the SDK, W-10).

## W-10

**cfire does not know where the WebView2 SDK is, nor ship `WebView2Loader.dll`** · [ran] ·
worked around

- **Symptom:** with patch 0004, an `ext:webui` build needs `<WebView2.h>` on the include
  path, and the `.exe` needs `WebView2Loader.dll` next to it (else it prints
  `webui: WebView2Loader.dll was not found next to the executable…`). `cfire test` runs its
  binary from the temp folder, so the DLL has to be there too.
- **Workaround:** our wrapper adds the SDK's `include/`, and `run-probes.sh` copies the DLL
  next to each `.exe` and into `/tmp`.
- **Suggested fix:** a `cfire setup --webview2` that fetches the pinned
  `Microsoft.Web.WebView2` NuGet package (like `cfire setup --wasm`), a `cfire doctor` line
  for it, and `cfire build`/`cfire test` copying `WebView2Loader.dll` next to the binary
  they produce for an `ext:webui` target. Or the built-in loader from W-06, which removes
  the DLL altogether.

### W-10 on v0.12.2

**Without `WebView2Loader.dll`, no webui window finds the installed WebView2 runtime** ·
[ran] · open · a new report

- **Symptom:** on Windows 11 with the WebView2 Runtime installed (157.0.4341.60,
  system-wide), any `ext:webui` app built in CLANG64 with no `WebView2Loader.dll` beside
  it or on `PATH` opens a black window and prints `webui: CreateCoreWebView2EnvironmentWithOptions
  failed: the WebView2 Runtime is not installed`. `run_webview_test` fails its two tests
  that need a page.
- **Cause:** `wv2_find_installed_client_dll()` (`runtime/core/webui/windows_webview2.hpp`)
  opens `SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
  (found) and reads a value named `EBWebView`, which the key does not have. Its values are
  `name`, `pv` (`157.0.4341.60`), `location` (`C:\Program Files (x86)\Microsoft\EdgeWebView\Application`)
  and `SilentUninstall`; the DLL is at `<location>\<pv>\EBWebView\x64\EmbeddedBrowserWebView.dll`.
  The empty result becomes `ERROR_FILE_NOT_FOUND`, reported as "not installed".
- **Repro:** [`windows/probes/webui/main.cf`](../windows/probes/webui/main.cf), built with
  `cfire build -o webui_probe.exe main.cf` and run on the desktop with no
  `WebView2Loader.dll` on `PATH`.
- **Suggested fix:** build the path from `location` and `pv` (both `REG_SZ`), checking
  `HKLM` (both views) then `HKCU` (a per-user runtime install), and say "not found at
  <path>" rather than "not installed" when the key exists. Since the fallback calls an
  undocumented entry point (`CreateWebViewEnvironmentWithOptionsInternal`), shipping or
  linking Microsoft's loader may be the safer default.
- **Flint:** ships `WebView2Loader.dll` beside `flint-app.exe`, which cfire tries first.

## W-11

**`os.args()` is in the ANSI code page, not UTF-8** · [ran] · fixed ·
[patch 0006](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0006-fix-os-os.args-is-UTF-8-on-Windows-from-the-UTF-16-c.patch)

- **Symptom:** Flint's `flint cp "C:\…\año-ñ ✓.txt" web:/tmp/` failed with
  `C:/…/a�o-� ?.txt: no such file or folder`. The same name downloaded *to* Windows had
  the same fault on the remote side: the argument was already wrong before any file API
  saw it. ASCII names worked.
- **Cause:** the generated `main(int argc, char** argv)` (`codegen.hpp`) hands `argv` to
  `set_process_args` (`cfire_prelude.hpp`). On Windows the CRT fills `argv` from the
  command line in the **ANSI code page** (1252 here): `ñ` becomes the single byte
  `0xF1`, invalid as UTF-8, and `✓`, which 1252 cannot hold, becomes `?` for good. Every
  other `str` in cfire is UTF-8, and the file APIs (CF-010.a) convert from UTF-8, so the
  bytes no longer name the file.
- **Patch:** on Windows, `set_process_args` ignores `argv` and reads
  `CommandLineToArgvW(GetCommandLineW())`, converting each argument with
  `WideCharToMultiByte(CP_UTF8)`. Windows targets link `-lshell32` for it
  (`buildsys.hpp`, next to `-lws2_32`).
- **Verified:** a new probe in
  [`windows/probes/core/core_test.cf`](../windows/probes/core/core_test.cf) runs a child
  with `año-ñ ✓.txt` and reads back `[año-ñ ✓.txt]` (it prints its `os.args()`); Flint's
  `cp` with that name both ways passes in `windows/cli-smoke.sh`.
- **Suggested fix:** the same, or a `wmain` in the generated code on Windows (needs
  `-municode` with mingw). Worth a line in the docs: `os.args()` is UTF-8 on every OS.
  Not checked: the iOS entry point and any place that reads `argv` other than
  `set_process_args`.


## W-12

**`set_tray` and `set_icon` take `.ico` only on Windows; a `.png` is silently ignored** ·
[ran] · fixed ·
[patch 0007](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0007-feat-webui-app-and-tray-icons-on-Windows-PNG-files-a.patch)

- **Symptom:** Flint passes `ui/tray.png` to `app.set_tray` (as on macOS and Linux). On
  Windows the notification area showed the generic application icon, with no message.
- **Cause:** `windows_webview2.hpp` loads both files with
  `LoadImageW(…, IMAGE_ICON, LR_LOADFROMFILE)`, which reads `.ico` files only. The other
  backends take a `.png`.
- **Patch:** `win32_load_icon_file(path, cx, cy)`: a file that starts with the PNG
  signature goes through `CreateIconFromResourceEx` (PNG icon data, Windows Vista+), sized
  with `GetSystemMetrics` (`SM_CXSMICON` for the tray and the small window icon, `SM_CXICON`
  for the big one); anything else still goes through `LoadImageW`.
- **Verified:** Flint's app runs with the patch and has a tray (`windows/gui-e2e.sh`, the
  tray close step).
  A person checked it on Windows 11 (2026-11-09): the tray shows Flint's own glyph.
- **Suggested fix:** the same; `.ico` keeps working.

## W-13

**A Windows `.exe` has no icon: the build file's `Icon` is never embedded** · [ran] ·
fixed · [patch 0007](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0007-feat-webui-app-and-tray-icons-on-Windows-PNG-files-a.patch)

- **Symptom:** `Icon: "assets/app-icon/Flint.icns"` in `build.cf` gives the macOS bundle
  its icon. The Windows `.exe` shows the generic icon in Explorer, the taskbar and Alt+Tab.
- **Cause:** for a non-Apple target, `Icon` only becomes `-DCFIRE_APP_ICON_PATH="<absolute
  path on the build machine>"`, which webui then tries to load at run time on the user's
  machine (it is not there, and it is an `.icns`). A Windows icon lives in the `.exe`'s
  resources, which need a resource compiler.
- **Patch:** for a Windows GUI target, `cfire build` looks for the `.ico` beside `Icon`
  (same name, `.ico` extension), writes a one-line `.rc` (`1 ICON "<path>"`), compiles it
  with windres and links the object. windres is `$CFIRE_WINDRES`, else
  `<triple>-windres` next to `$CFIRE_CXX` (llvm-mingw ships it there), else
  `<triple>-windres`, `llvm-windres` or `windres` on `PATH`; with none, a warning and no
  icon. The webui window class loads icon resource 1 (`wc.hIcon`, `wc.hIconSm`), so the
  title bar and the taskbar use it too.
- **Verified:** `llvm-objdump -h` shows a `.rsrc` section in `Flint.exe`. A person checked
  the icon on Windows 11 (2026-11-09) in Explorer, the title bar and the taskbar.
- **Suggested fix:** the same idea. An `Icon` per platform in `build.cf` (or a list) would
  be more explicit than "the `.ico` beside it". A version resource (`VERSIONINFO`, product
  name, version) is the natural next line in the same `.rc`.

## W-14

**`fs.exists` is false for an AF_UNIX socket file on Windows** · [ran] · fixed ·
[patch 0008](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0008-fix-fs-fs.exists-sees-an-AF_UNIX-socket-file-on-Wind.patch)

- **Symptom:** with Flint's app running and listening on `%APPDATA%\Flint\flint.sock`
  (an AF_UNIX socket, Windows 10 1803+), the CLI said the app was not running. The CLI
  checks `fs.exists(socket)` before it dials.
- **Cause:** a listening AF_UNIX socket's file is a reparse point
  (`IO_REPARSE_TAG_AF_UNIX`). `std::filesystem::exists` follows reparse points and fails on
  this one with `ERROR_CANT_ACCESS_FILE` (1920, "The file cannot be accessed by the
  system"); cfire's `fs.exists` swallows the error and returns false.
  `std::filesystem::symlink_status` on the same file succeeds (type "regular").
  Probe: `exists=0 ec=1920`, `symlink_status exists=1` on the live socket.
- **Patch:** on Windows, when `exists()` fails with an error, `fs.exists` asks
  `symlink_status` about the file itself (what `lstat` does on POSIX). POSIX is unchanged.
- **Verified:** the CLI ↔ app handoff in Flint's `windows/serve-e2e.sh`.
- **Suggested fix:** the same, and the same thought for `fs.stat`/`is_file`-style helpers
  if cfire grows them: a path that exists but cannot be followed should not read as
  missing.

## W-15

**The Windows file dialogs cut paths at `MAX_PATH`** · [read] · open

- `win32_open_file_dialog` / `win32_save_file_dialog` give `GetOpenFileNameW` a
  `wchar_t[MAX_PATH]` buffer: a path longer than 259 characters fails the dialog (it
  returns false with `FNERR_BUFFERTOOSMALL`), which reads as "cancelled". Rare, but long
  paths are common under `OneDrive\…`.
- **Suggested fix:** `IFileOpenDialog` / `IFileSaveDialog` (COM, Vista+): no buffer, the
  modern dialog, folder pickers for free (`FOS_PICKFOLDERS`), and the same owner window.
  Flint uses these dialogs as they are (import from Tether, save a key, the Files view's
  downloads); they work.

---

## W-16

**After Alt+Tab back, the WebView2 does not get the keyboard focus** · [ran] · **fixed** ·
[patch 0009](https://github.com/samaniegoluis/flint/blob/windows-port-2/docs/cfire-windows/patches/0009-fix-webui-the-WebView2-takes-the-keyboard-focus-back.patch)

> **Found after the handoff.** cfire's author already has the 2026-11-09 package (W-01 to
> W-15, patches 0001-0008) and is working from it; W-16 and patch 0009 are not in it and
> were not sent. Noted here only: check it when cfire ships Windows support (the port
> guide's "Next phase").

- **Symptom (owner, in Flint):** switch to another window and back with Alt+Tab: the
  app is active, but the terminal that had the focus gets no keys (a paste does nothing)
  until it is clicked.
- **Cause:** the WndProc of patch 0004 handles no `WM_SETFOCUS`. On activation Windows
  gives the focus to the host window, and WebView2 does not take it by itself: the host
  must call `ICoreWebView2Controller::MoveFocus` (WebView2's documented pattern).
- **Patch:** `WM_SETFOCUS` → `MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)`,
  which keeps the page's own focused element (`NEXT`/`PREVIOUS` would move it to a tab
  stop). Flint's gui-e2e still passes (180) with it. Checked by a person (a window
  started from WSL never gets the foreground): after Alt+Tab away and back, the terminal
  takes keys and Ctrl+V pastes without a click (2026-11-09).

### W-16 on v0.12.2

**After Alt+Tab back, a webui window's page gets no keys until it is clicked** ·
[read] · open · a new report (not in the 2026-11-09 package)

- **Symptom (at `c5b1d4b` with patch 0004, owner, 2026-11-09):** in Flint, switch to
  another window and back with Alt+Tab: the window is active, but the terminal that
  had the focus gets no keys (a paste does nothing) until it is clicked.
- **Cause, still in `v0.12.2`:** on activation Windows gives the focus to the top-level
  window, and WebView2 does not take it back by itself: the host calls
  `ICoreWebView2Controller::MoveFocus` on `WM_SETFOCUS` (WebView2's documented
  pattern). `cfire_win32_wndproc` has no `WM_SETFOCUS` case, and `MoveFocus` appears
  only in the interface's declaration.
- **Repro:** [`windows/probes/webui_focus/main.cf`](../windows/probes/webui_focus/main.cf),
  built with `cfire build -o focus.exe main.cf` in CLANG64 and run on the desktop:
  type into the box ("keys: N" grows), Alt+Tab to another window and back, type
  again: N stays until the box is clicked.
- **Suggested fix:** patch 0009's: `case WM_SETFOCUS:` →
  `controller->MoveFocus(COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC)`, which keeps the
  page's own focused element (`NEXT`/`PREVIOUS` would move it to a tab stop).
- **In Flint:** nothing yet. A shim would subclass the top-level window
  (`SetWindowSubclass`) and call `MoveFocus` on the controller, reaching into
  `cfire::webui::detail` as the two-monitor shim does (W-17); or the port waits for
  cfire.

---

## W-17

**`<WebView2.h>` is included inside a namespace, so later Windows headers declare
nothing** · [compiled] · worked around in Flint · no patch

> **Found after the handoff** (2026-11-11, merging Flint's milestone 31). Not in the
> 2026-11-09 package and not sent. Noted here only: check it when cfire ships Windows
> support.

- **Symptom:** Flint's desktop app stops compiling once a native header of its own
  includes a Windows header that reaches `<ocidl.h>`: `<userenv.h>`, `<shlobj.h>`,
  `<iphlpapi.h>`. The errors name the cfire copies: `unknown type name
  'IConnectionPoint'; did you mean 'cfire::webui::detail::IConnectionPoint'?`, then
  `SHCOLSTATEF`, `LPCITEMIDLIST`, `TASKOWNERID`. The same header compiles in a test
  binary that does not import `ext:webui`.
- **Cause:** `runtime/core/webui/windows_webview2.hpp` (patch 0004) includes
  `<WebView2.h>` and `<shlwapi.h>` at line ~300, inside `namespace cfire::webui::detail`
  (opened at line 7). Everything they pull in (`objidl.h`, `ocidl.h`, `propsys.h`,
  `shobjidl.h`…) is declared in that namespace, and their include guards are set, so a
  later global include of the same headers is empty and the global names never exist.
- **Repro:** a `cpp` import in a webui app whose header has `#include <shlobj.h>` and
  uses `LPITEMIDLIST` (or `IConnectionPoint*`) at global scope.
- **Fix to make in cfire:** include the Windows SDK headers (`<windows.h>`,
  `<WebView2.h>`, `<shlwapi.h>`) at global scope at the top of the file, before opening
  the namespace.
- **In Flint (adapters only):** the tunnels code declares the `GetExtendedTcpTable` rows
  itself instead of including `<iphlpapi.h>` (milestone 23 merge), and the RDP shim
  skips `winpr/shell.h` and declares `FILEDESCRIPTORW` (milestone 31 merge;
  [`rdp-windows.md`](rdp-windows.md)). Both go once cfire includes them globally.
  The two-monitor shim (milestone 38 merge) takes the WebView2 types and the handler
  template from `cfire::webui::detail` (`wv2_handler`, `wv2_iid`, `wv2_load_loader`):
  with the headers global, it would include `<WebView2.h>` itself.

---

## W-18

**A cfire identifier that a Windows header defines as a macro vanishes** · [compiled] ·
worked around in Flint · no patch

> **Found after the handoff** (2026-11-13, merging Flint's milestones 32-42). Not sent.
> Noted here only: check it when cfire ships Windows support.

- **Symptom:** `far: []RdpMonitor = [...]` in a test of `src/domain/monitors.cf` fails to
  compile for `x86_64-w64-mingw32` only: `error: expected unqualified-id`, then the
  next use of `far` finds no variable.
- **Cause:** cfire emits the name as written, and `<windows.h>` (`minwindef.h`) has
  `#define far` (and `near`; `rpcndr.h` has `small` and `hyper`; `objbase.h` has
  `interface`), so the declaration loses its name. Any translation unit that ends up
  including `windows.h` (here through cfire's own webui and Flint's shims) is exposed.
- **Repro:** `fn main() { far := 1; println("{far}") }` in a package with a `cpp`
  import that includes `<windows.h>`, built with `--target x86_64-w64-mingw32`.
- **Fix to make in cfire:** mangle identifiers that collide with known Windows macros
  (as with C++ keywords), or `#undef` them after including the Windows headers.
- **In Flint:** the variable is called `apart`.

---

## Upstream at `f611aa2` (0.11.0, 2026-11-10): read, not adopted

> **After the handoff, not sent.** Read on 2026-11-11 from `git diff c5b1d4b f611aa2`,
> nothing built or run: Flint stays on `c5b1d4b` + 0001-0009 (the owner: the new cfire
> breaks Flint; `main`'s `docs/cfire-upstream.md` has its own check at `d182f32`). Every
> line below is **[read]**; each is checked by running in the port guide's next phase.

| ID | Upstream | Where |
|---|---|---|
| W-01 | `import cpp` reads `CFIRE_CXX` | `src/clang_bridge.hpp`, `src/build/pch.hpp` |
| W-02 | test and run binaries get `.exe` for a Windows triple | `src/main.cpp` |
| W-03 | `os.cwd()` returns `std::string` | `runtime/core/os.hpp` |
| W-04 | Windows targets link `-static` (and `ws2_32`, `advapi32`, `shell32`) | `src/buildsys.hpp` |
| W-05 | stdin/stdout/stderr set to `_O_BINARY`: `println` writes `\n` | `runtime/cfire_prelude.hpp` |
| W-06, W-09, W-10 | its own WebView2 backend: COM declarations when `<WebView2.h>` is missing, `eventtoken.h` when present; no SDK needed. Without `WebView2Loader.dll` it loads the installed runtime's `EmbeddedBrowserWebView.dll` and calls `CreateWebViewEnvironmentWithOptionsInternal`, **an undocumented entry point** a runtime update may change | `runtime/core/webui/windows_webview2.hpp` |
| W-07 | a `windows-latest` CI job on MSYS2 CLANG64 (green or not: not checked) | `.github/workflows/ci.yml` |
| W-08 | `*_unix.cf` skipped on Windows | `src/build/package_loader.hpp` |
| W-11 | `os.args()` from `CommandLineToArgvW`, UTF-8 | `runtime/cfire_prelude.hpp` |
| W-12, W-13 | PNG or `.ico` window and tray icons; the build file's icon embedded with `windres` | `windows_webview2.hpp`, `src/build/windows_resources.hpp` |
| W-14 | `fs.exists` sees a reparse point it cannot follow (AF_UNIX) | `runtime/core/fs.hpp` |
| W-15 | dialog buffers of 32768 characters (`GetOpenFileNameW` still, not `IFileOpenDialog`) | `windows_webview2.hpp` |
| **W-16** | **open:** `MoveFocus` is declared but never called, and the WndProc has no `WM_SETFOCUS` | `windows_webview2.hpp` |

The port's own Flint workarounds that would go: W-04's static flags, W-09's
`EventToken.h`, W-10's SDK and `WebView2Loader.dll`, W-13's `.ico` (the port guide,
"Next phase"). To weigh then: whether Flint ships `WebView2Loader.dll` anyway rather than
rely on the undocumented fallback.

---

## Seen along the way, not Windows-specific

Not in this file's scope. They go to `cfire-upstream.md` on Flint's `main` when that
file is next updated.

- `make install` still fails (CF-086): `chmod: cannot access …/.cfire.tmp.26780`.
- `make build` runs `git config core.hooksPath .githooks` (`Makefile:24`), which turns
  cfire's hooks back on in a clone that had turned them off. The pre-commit hook rebuilds
  cfire and can stage regenerated docs into an unrelated commit.
- `cfire build --help` prints `failed to open file: --help`.
- Two `cfire` processes building the same package at once can break each other:
  `clang_bridge.hpp:473` writes the header it inspects to
  `/tmp/cfire_clang_ast_<hash of the key>`, the same path for both, and one removes it
  while the other reads it (`clang++: error: no such file or directory:
  '/tmp/cfire_clang_ast_…/tu.cpp'`). Seen running two copies of Flint's suites in
  parallel. A per-process suffix (or `mkdtemp`) would avoid it.
- `set_dark_mode` after the window is open changes nothing on any backend: the flag is
  read once when the window is made (`macos_ios.hpp:538`, `windows_webview2.hpp`). Flint
  calls it when the page's theme changes (`window_theme`), so a light page keeps a dark
  title bar until the next launch. A `platform_set_dark_mode` hook (on Windows,
  `DwmSetWindowAttribute(DWMWA_USE_IMMERSIVE_DARK_MODE)` again) would fix it.
- Interpolating a slice, `"listed: {names}"` with `names: []str`, compiles where the C++
  library formats ranges (llvm-mingw's libc++) and fails on Linux with GCC 13's libstdc++
  (Ubuntu 24.04): `std::formatter<[]str, char>` is not specialised (`<format>:3672`, a
  `static_assert`), reported at the `.cf` line as a consteval `basic_format_string` error.
  The same file built and passed for Windows. cfire could reject it at check time, or
  format slices itself (`[a, b]`) instead of leaning on C++23 range formatting.
- `app.emit("ping", "pong")` with a string literal does not compile
  (`json::stringify<char[5]>` has no viable overload); a `str` variable works. Seen on
  the Windows target; not yet tried on macOS or Linux.
- **`cfire build <name>` matches a build.cf variable before an executable's name**
  (`src/main.cpp`, `has_var_name_match`), without saying so: in Flint `var Flint =
  build.Executable("flint")` makes `cfire build Flint` build the CLI, not the app named
  `Flint` (`var FlintGui`). Seen 2026-11-11, after the handoff. [ran]

## How to reproduce

```sh
# once
~/Personal/Proyectos/cfire/flint-windows/windows/bin/sysroot.sh   # MSYS2 CLANG64 libraries
# llvm-mingw: unpack the ucrt-ubuntu-x86_64 release into ~/.local/opt/
# cfire: build cfire-windows (make build CXX=clang++) and install by hand (CF-086)

# every time: hello, platform files, core, cfire's stdlib suite, webui offscreen and in a window
~/Personal/Proyectos/cfire/flint-windows/windows/run-probes.sh
```

WSL2 runs a Windows `.exe` directly (binfmt `WSLInterop`). If it stops working after an
`apt install` (`exec format error`), re-register it:
`echo ':WSLInterop:M::MZ::/init:PF' | sudo tee /usr/lib/binfmt.d/WSLInterop.conf && sudo systemctl restart systemd-binfmt`.
Running from the WSL filesystem, `cmd.exe` warns `UNC paths are not supported`; that is
the `\\wsl.localhost\…` working directory, not cfire.
