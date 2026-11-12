# cfire — Upstream Requests from Flint

Everything Flint needed from [cfire](https://github.com/gsandoval/cfire) and did not find,
found broken, or had to write in native C++. It is written to be handed to the cfire author
as is.

## Conventions

- One entry per gap, with an ID of the form `CF-NNN`. IDs are never reused.
- Every native C++ workaround lives in `adapters/` and is tagged `// CFIRE-UPSTREAM: CF-NNN`.
  Run `grep -rn CFIRE-UPSTREAM` to list everything to rewrite once an entry lands.
- **Kind:** `missing` (no support), `bug` (wrong behaviour), `improvement` (works, could be
  better), `workaround` (we patched around it natively).
- **Status:**
  - `suspected`: found by reading the source, not yet hit in practice.
  - `confirmed`: hit while building Flint, with a repro. Open.
  - `resolved ✓`: fixed upstream, checked against Flint's repro, and Flint uses the fix
    (its workaround is gone) or needed nothing more.
  - `partly resolved`: part of the entry works; the **At** line says what is left.
  - `not adopted`: cfire answered with an API Flint cannot use; the **At** line says why
    and what it would need. Flint's own solution stays, so nothing is blocked.
  - `answered, untested`: cfire added it, but Flint has no use for it yet.
  - `declined upstream`: cfire chose not to do it (or the part that is left), and said why.
    A decision, not a bug: the **At** line quotes the reason. Flint's own solution stays.
  - `deferred upstream`: cfire accepted it and put it in its long-term backlog.
  - `open`: still reproduces.
- An entry answered by a cfire build carries an **At `<commit>`** line under its heading.
- From `43431f2` on, an **At** line says how it was checked: **[ran]** (a repro was run against
  that build), **[compiled]** (built or cross-compiled, not run) or **[read]** (the source was
  read, nothing was run).
- Each entry gives: what Flint needed, a minimal repro or source pointer, the workaround and
  where it lives, and what an ideal API would look like.

## Status at cfire `d182f32` (2026-11-10): checked, not adopted

cfire `d182f32` is seven commits on `c5b1d4b`: the checker split into modules over an
interned type lattice, one diagnostics pipeline for the CLI, LSP and MCP, `match` guards and
or-patterns, generic structs, `sync.Mutex[T]`, `async.Task[T]`, and the WebView2 host and toolchain
work for Windows. It still reports `0.10.0`. Its commits cite "CF-115..CF-133", which are cfire's own
backlog items, not Flint's entries of those numbers (CF-108).

**Flint does not build on it and stays on `c5b1d4b` (D-060).** Checked [ran] on a copy of
Flint at `5156a86`, with `d182f32` built from source in a scratch folder:

- Two syntax changes are now errors and are mechanical: `_ := expr` → `_ = expr`
  (`cfire/DEPRECATED-DISCARD`, about 205 places) and `cpp::Name` → `cpp.Name`
  (`cfire/DEPRECATED-SEPARATOR`, 26). Until the first is done, the parser fails on
  `_ := try f(mut x)` and cascades into about 10,000 false `UNDECLARED-IDENT` errors
  (CF-118).
- With both done, checking the two entry points still gives about 50 errors, all from cfire:
  CF-115 (48), CF-116 (7) and CF-106 (6 in the CLI).
- `cfire fix` would delete about 600 real `try`s and add imports Flint keeps out (CF-117).
  Flint still does not run it.

| Status | Entries |
|---|---|
| Fixed upstream, rechecked [ran]; Flint moves when it can build | 088 (`==` on an enum), 101 (`{x:.1f}`) |
| Unchanged, rechecked [ran] | 091, 094, 104, 110 |
| Unchanged [read] | 109 (`make install` and `install.sh` still write `runtime/VERSION`) |
| Changed, still failing [ran] | 105 (generic structs parse; codegen fails in clang) |
| Worse [ran] | 106 (now an error in `cfire check` of a package, exit 1) |
| **New** | CF-115..CF-118, below |

**Most urgent:** CF-115 and CF-116 block the build; CF-106 and CF-117 make `cfire fix`
destructive on Flint.

## Status at cfire `c5b1d4b` (2026-11-09)

cfire `c5b1d4b` (0.10.0) is six commits on `43431f2`: a stricter checker, a new I/O layer
(`fs.File` over a descriptor, `_bytes`/`_text` pairs, RAII stdio), `json`, `net`, `keychain`
and `audio` moved from `ext:` to `core:`, Winsock2 for Windows, and `ext:ai` agents. It
answers none of Flint's open entries; its commits cite "CF-086..CF-089", which are cfire's
own backlog items and not Flint's entries of those numbers (CF-108). Flint moved to it in
milestone 19b (D-060). Every open entry it could touch has an **At `c5b1d4b`** line.

**What the move took:** `ext:json` → `core:json` (one line per file); about 380 places where
a fallible result was stored, inspected with `has_value()` or passed as an argument, now an
error (`cfire/UNHANDLED-RESULT`), rewritten with `or err { … }`, `or { … }`, `try` or `defer`;
the vault header read with `read_exact` (CF-107). No workaround could be dropped.

| Status | Entries |
|---|---|
| Unchanged, rechecked [ran] | 088, 091, 094, 098, 100, 101, 104, 105 |
| Unchanged [read] | 086, 087, 089, 090, 092, 093, 095, 096, 097, 099, 102, 103 |
| Changed upstream, not used by Flint | 010 (Winsock2) |
| **New** | CF-106..CF-110, below |

**Most urgent of the new ones:**

- **CF-109:** on macOS the installer's `runtime/VERSION` shadows the standard `<version>`
  header and every build fails until the file is removed.
- **CF-107:** `File.read_bytes(n)` changed meaning with no diagnostic; code that read a
  header with it now fails at run time.
- **CF-106:** `cfire check` reports a false `REDUNDANT-TRY` on every call through a generic
  interface parameter (137 in Flint), and `cfire fix` would delete those `try`s.

## Status at cfire `43431f2` (2026-11-07)

cfire `43431f2` answers CF-001..CF-085, on top of `5c805e5` (a refactor that splits the
compiler, the LSP and the runtime into smaller headers). Its triage is in cfire's
`docs/planning/backlog.md`: each entry is done, deferred, or declined with a reason.
Flint moved to it in milestone 11c (D-044) and checked every answered entry: by running its
repro against the installed build where it could (**[ran]**), by building or
cross-compiling (**[compiled]**), or by reading the source (**[read]**). Every entry it
touched has an **At `43431f2`** line saying which.

Flint built and passed its suites on `43431f2` before any change. The workarounds it no
longer needs are gone (CF-057, 060, 063, 064, 066, 067, 078).

| Status | Entries |
|---|---|
| `resolved ✓` (newly) | 011, 057, 058, 059, 060, 062, 063, 064, 066, 067, 068, 069, 070 [read], 071, 075 [read], 076, 078, 080, 083 |
| `partly resolved` | 010, 017, 034, 042, 072, 074, 077, 082, 085: what is left is on each **At** line |
| `declined upstream` | 003, 005, 018, 026, 031, 043, 051, 054, 065, 073, 079, 084: cfire's decision, not a bug. Flint's own solution stays |
| `deferred upstream` | 001 (a real WebView2), 081 (Unix sockets); 010's networking and sysroot items |
| `not adopted` | 006, 007, 008, 053: cfire's modules now fail closed, but Flint's adapters do more |
| `answered, untested` | 004, 029, 045, 046, 050 |
| **New** | CF-086..CF-091, below; CF-092, CF-093 (milestone 12) |

**Most urgent of the new ones:**

- **CF-089:** the test runner's descriptor-leak check is now off for every package that has
  an `import cpp`, so a real leak there passes. That is every package where a C library
  opens files and sockets.
- **CF-090:** `sodium.argon2id`'s default memory cost is 4 MiB, while the reference says
  64 MiB: 16 times weaker than documented, and silent.
- **CF-087:** the new simdjson check refuses Debian's simdjson 3.12, which builds, so
  `cfire build` fails on Debian trixie with clang 19 until simdjson 4 is installed by hand.
- **CF-086:** `make install` fails on every machine.

## Status at cfire `2d8613d` (2026-11-06)

cfire `2d8613d` answered Flint's follow-up review of `466751b` (CF-027 and the review's
E1–E7). It changes the compiler, the LSP, the MCP server and the docs; the runtime headers
are byte-identical to `466751b`, so every runtime entry (and the Windows findings below)
stands as it was. Flint moved to it the same day (D-037) and re-ran its repros:

| Entry or item | At `2d8613d` |
|---|---|
| CF-027 | `resolved ✓`. The real trigger (`or err { return error(…) }` in a closure) failed at `466751b`; it builds now |
| CF-056 | `resolved ✓`, now including the message for a local named `out` |
| E1 (MCP `cfire_check` passed code clang rejects) | the MCP check now runs the C++ step (read in the diff, not re-run) |
| E2 (`cfire run` hid the exit code) | `os.exit(3)` → `cfire run` exits 3 |
| E4, E5, E6 (docs: `Channel.close` receiver, `core:build`, `exit`) | documented. The `core:build` page names `build.Link`, `build.PkgConfig`, `build.os()` and `AppName`; the build system did not change in this commit, so Flint has not relied on them |
| E7 (LSP for Claude Code) | not working: see **CF-074** |

Everything else in the table below is unchanged.

## Status at cfire `466751b` (2026-11-06)

cfire `466751b` answered CF-001..CF-053. Flint moved to it in milestone 09 and checked
every entry against its repro:

| Status | Entries |
|---|---|
| `resolved ✓` | 002, 009, 012–016, 019–025, 027, 028, 030, 032, 033, 035–041, 044, 047–049, 052, 055, 056, 061 |
| `partly resolved` | 011, 017, 018, 026, 031, 034, 042, 043, 051 |
| `not adopted` | 003, 005, 006, 007, 008, 045, 053 |
| `answered, untested` | 004, 029, 046, 050 |
| `open` | 001 and 010 (Windows, checked by cross-compiling: see the entries), 054, 057, 058, 059, 060 (not in that batch), and the new CF-062..CF-073 |

**Most urgent of the new ones:** CF-069 (`sqlite.open_encrypted` writes plaintext),
CF-070 (`ext:crypto/sodium` silently swaps algorithms) and CF-071 (`ext:keychain` on
Linux). Flint does not use these modules, but anyone who does is exposed.

## Windows at `466751b` (checked 2026-11-06)

cfire `466751b` announces Windows support (a Win32 runtime, a WebView2 backend for
`ext:webui`, Credential Manager for `ext:keychain`). Flint checked it the day it moved to
that build. **Short answer: it is not usable yet.** A hello world does not compile for
Windows, and the "WebView2" backend opens an empty Win32 window with no WebView2 in it.
Most of the Win32 code that exists is close, and the defects are small and listed with
file and line below, so this is a punch list, not a redesign.

**Still true at `2d8613d`** (the next cfire commit, 2026-11-06): it changes nothing under
`runtime/`, and the hello world below fails with the same three errors against it. File
and line references below hold for both commits.

**At `43431f2`** (2026-11-07), with the same llvm-mingw image: a hello world compiles and
links, `core/cli.hpp` compiles, and a `webui.App` links with cfire's Windows flags
(CF-001.f). `core/net.hpp` still fails, and the window still holds no WebView2: cfire
deferred the COM integration, Winsock and the sysroot. File and line references below are
from `466751b`; `5c805e5` split several of those files.

Details live in two entries, each with lettered sub-items so they can be fixed and
ticked off one by one:

- **CF-001** · `ext:webui` on Windows: items CF-001.a–j.
- **CF-010** · the core runtime and the toolchain on Windows: items CF-010.a–m.

### How it was checked

No Windows machine was involved. Everything was cross-compiled on macOS (arm64) inside
Docker with **llvm-mingw** (image `mstorsjo/llvm-mingw:latest`, clang 23.1.5, target
`x86_64-w64-mingw32`, libc++ and the mingw-w64 Windows headers), against the runtime
headers installed by cfire `0.9.5 (466751b)` in `~/.cfire/runtime`. Nothing was run: there
is no Wine in that setup. Every finding is tagged with how it was established:

- **[compiled]**: reproduced with the compiler or linker. Exact error text is quoted.
- **[read]**: found by reading the source against the Win32 documentation. Not executed.
  The behaviour described is what the documented API does, but no binary showed it.

To reproduce (the repro of each item says what goes into `t.cpp`):

```sh
docker run --rm -v "$PWD":/w -v ~/.cfire/runtime:/rt:ro mstorsjo/llvm-mingw:latest \
  sh -c 'cd /w && x86_64-w64-mingw32-clang++ -std=c++23 -I/rt t.cpp -o t.exe -mwindows -lole32 -ladvapi32'
```

`cfire emit-cpp file.cf > t.cpp` turns any `.cf` file into that input. MSVC was not tried.
The two compile errors in CF-010.a and CF-010.b are not specific to mingw: both come from
`<windows.h>` and the standard library, so MSVC hits them too.

### Results

| Check | Result |
|---|---|
| Hello world (`fn main() { println("hello") }`) | **Fails**: 3 errors in `cfire_prelude.hpp` (CF-010.a, CF-010.b) |
| Hello world with those 3 lines patched locally | Compiles and links to a 387 KB `.exe` |
| `#include` each of `core/encoding`, `fs`, `json`, `os`, `str`, `time`, `crypto`, `keychain`, `ssh`, `sqlite`, `webui` (patched prelude, `-fsyntax-only`) | Pass |
| `#include "core/cli.hpp"` | **Fails**: `'termios.h' file not found` (CF-010.c) |
| `#include "core/net.hpp"` | **Fails**: `'arpa/inet.h' file not found`, from `core/net/tcp.hpp` (CF-010.c) |
| A `webui.App` that calls `app.run()`, linked with the flags cfire uses for Windows | **Fails to link**: `undefined symbol: __declspec(dllimport) DwmSetWindowAttribute` (CF-001.f) |
| Same, adding `-ldwmapi` | Links (305 KB `.exe`); the window would hold no web content (CF-001.a) |
| `cfire build --target x86_64-w64-mingw32` on macOS | **Fails**: clang is fed the host's headers (CF-010.k) |
| Flint's generated CLI and GUI translation units | Stop at the same prelude errors, then at Flint's own native headers, which have no Windows side yet (Flint's work, not cfire's) |

### Suggested order

1. **CF-010.a, CF-010.b**: three lines in the prelude. Until they land, nothing compiles.
2. **CF-001.a–f**: a real WebView2 in the window. The JS side of the bridge already
   handles `window.chrome.webview` (`bridge.hpp:168`), so the work is the native side.
   The Linux backend is the closest model: it fits in one function of ~80 lines.
   CF-001.g (the offscreen runner) goes with it, so the backend can be tested.
3. **CF-010.d–i, CF-010.l**: process, pipe, console and signal primitives that compile
   but misbehave. CF-010.d is a security issue (argument injection).
4. **CF-010.c**: Winsock, for `core:net` and `core:cli`.
5. The rest: CF-001.h–j, CF-010.j, CF-010.k, CF-010.m. Until then, `cfire doc --llm`
   should not list WebView2 and Credential Manager as supported (it does today, under
   `ext:webui` and `ext:keychain`), because agents and users read it as a promise.

### Done when

- A hello world built from `cfire build` on Windows (or with a documented cross target)
  runs and prints.
- `cfire new demo --webui && cd demo && cfire run` on Windows shows the template's page,
  a `bind`-ed call returns a value, and an `emit` reaches the page.
- `cfire test` on a webui project runs the offscreen runner on Windows and passes for a
  correct page (CF-001.g).
- A CI job builds and runs those two on `windows-latest` (GitHub Actions has both MSVC
  and the WebView2 runtime preinstalled). Without one, Windows will regress silently,
  since no maintainer machine runs it.

The first entries below came from reading cfire at commit `feat(webui): add ext:webui …`
(2026-11-04). They are `suspected` until milestone 01 confirms or discards them.

---

### CF-001 · missing · `deferred upstream`: Windows backend for `ext:webui` (WebView2)
- **At `43431f2`:** [compiled] CF-001.f is fixed: cfire's Windows link flags now carry `-ldwmapi`, and a `webui.App` that calls `run()` links (746 KB `.exe`, llvm-mingw). CF-001.j: the Win32 clipboard owner is fixed in the source [read]. The rest (a–e: a real `ICoreWebView2` with its bridge; g: the offscreen runner; h, i: icons and menus) is **deferred by cfire** ("Full Windows `ICoreWebView2` COM Integration", P3). The window still holds no web content: without `<WebView2.h>` at compile time it prints that the SDK is missing.
- **At `466751b`:** a Win32 window, but **no WebView2 in it** (see "Windows at `466751b`"
  above for how this was checked). Paths are under `~/.cfire/runtime/core/`.
- **Needed:** Flint (and Tether before it) targets Windows.
- **Workaround:** none. Windows is out of Flint's current spec (D-007).

**What a backend has to do.** `webui/bridge.hpp` is platform-neutral, and every backend
plugs into it the same way. The Linux one (`webui/linux_gtk.hpp`, `run_linux_webkitgtk()`,
lines 63–143) is the shortest complete example. The steps and their WebView2 equivalents:

| Step | Linux (`linux_gtk.hpp`) | WebView2 equivalent | Windows at `466751b` |
|---|---|---|---|
| Create the web view in the window | `webkit_web_view_new_with_user_content_manager` (97) | `CreateCoreWebView2EnvironmentWithOptions` → `CreateCoreWebView2Controller(hwnd)` → `get_CoreWebView2` | missing |
| Serve `app://localhost/*` from `AppState::resolve_asset()` (`bridge.hpp:384`) | `register_uri_scheme("app", linux_scheme_cb)` (82, handler at 9) | `AddWebResourceRequestedFilter` + `add_WebResourceRequested` → `CreateWebResourceResponse` with an `IStream` (`SHCreateMemStream`). Or `SetVirtualHostNameToFolderMapping` for `serve_dirs`, though that skips embedded assets | missing |
| Inject `kPreloadBridgeJs` (`bridge.hpp`) at document start | `webkit_user_script_new(…INJECT_AT_DOCUMENT_START)` (85) | `AddScriptToExecuteOnDocumentCreated` | missing |
| Page → native messages into `AppState::handle_ipc_message()` (`bridge.hpp:431`) | `script-message-received::external` (94–95) | `add_WebMessageReceived` → `TryGetWebMessageAsString`. The JS side already posts through `window.chrome.webview.postMessage` (`bridge.hpp:168–169`) | missing |
| Native → page: set `platform_eval` | `g_idle_add` + `evaluate_javascript` (103) | `ExecuteScript`, marshalled to the UI thread (CF-001.c) | missing (only reset to `nullptr` at 280) |
| Load the start page | `load_uri("app://localhost/index.html")` (129) | `Navigate(L"app://localhost/index.html")` | missing |
| Resize the view with the window | GTK container | `ICoreWebView2Controller::put_Bounds` on `WM_SIZE` | `WM_SIZE` calls `ctx->on_resize`, which is never set (185) |
| Clean up | `platform_*` reset (134–140) | same, plus `Close()` the controller | partial |

**Items**

- **CF-001.a · [read] No WebView2 is created.** `webui/windows_webview2.hpp`,
  `run_win32_webview2()` (169–289) registers a window class, creates an `HWND` and runs a
  message loop. Lines 162–167 include `<WebView2.h>` when it exists and define
  `CFIRE_HAS_WEBVIEW2_HEADER`, but nothing reads that macro and nothing calls a WebView2
  API anywhere in the runtime (`grep -rn "ICoreWebView2\|CreateCoreWebView2" runtime/`
  finds nothing). Every row marked "missing" above follows from this. Effect: an app
  opens a dark empty window (`hbrBackground`, 181); `app.bind`, `app.on`, `app.emit`,
  `set_state` and `eval_js` reach nothing; `serve_dir`/embedded assets are never read.
- **CF-001.b · [read] The rest of the `platform_*` hooks.** `bridge.hpp:362–371` has 10
  hooks. Windows sets 6 (`set_title`, `set_size`, `minimize`, `maximize`, `drag`, `quit`,
  lines 226–246) and not `eval`, `fullscreen`, `center` or `screenshot`. `app.fullscreen()`
  and `app.center()` are silent no-ops. Screenshots exist on macOS only, so that one
  matches Linux; `ICoreWebView2::CapturePreview` would give it to Windows.
- **CF-001.c · [read] Threading for `platform_eval`.** `AppState::eval_js()`
  (`bridge.hpp:419`) is called from any thread (Flint emits from a reader thread for
  every terminal chunk). WebView2 objects are single-threaded apartment objects: calling
  `ExecuteScript` off the UI thread fails with `RPC_E_WRONG_THREAD`. The Windows
  `platform_eval` must queue the script and `PostMessageW` the window (a private
  `WM_APP + n`), then run it in `wndproc`; the Linux backend does the same with
  `g_idle_add` (103–106). The same goes for `platform_set_title`/`set_size`/… if they can
  be called from another thread: today they call Win32 directly, which works for
  `SetWindowTextW` across threads but blocks on the UI thread's message loop.
- **CF-001.d · [read] Creation is asynchronous.** Environment and controller creation
  complete in COM callbacks on the UI thread, while the message loop is already running.
  Scripts, `Navigate` and `eval_js` calls that arrive before the controller exists have
  to be queued and flushed in the controller-created callback. Without the runtime
  installed, `CreateCoreWebView2EnvironmentWithOptions` returns
  `HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND)`: `app.run()` should report that (the
  Evergreen runtime ships with Windows 11 and current Windows 10, but not with Server or
  older LTSC builds) instead of showing an empty window.
- **CF-001.e · [read] `app://` needs registering.** WebView2 only lets a page use a
  custom scheme as a secure origin (needed for `fetch`, `crypto.subtle`, clipboard) when it
  is registered up front with `ICoreWebView2CustomSchemeRegistration` in the environment
  options (`ICoreWebView2EnvironmentOptions4::SetCustomSchemeRegistrations`), with
  `TreatAsSecure` and an allowed origin list. The alternative most WebView2 hosts use is
  `https://app.localhost/` (or `http://…`) served through `WebResourceRequested`; then
  `bridge.hpp`'s URL handling and any test that checks `app://localhost` need to accept it.
- **CF-001.f · [compiled] It does not link with cfire's Windows flags.** cfire's binary
  carries `-mwindows -lole32 -ladvapi32` for Windows GUI builds. `DwmSetWindowAttribute`
  (`windows_webview2.hpp:212`, dark title bar) lives in `dwmapi`:
  `ld.lld: error: undefined symbol: __declspec(dllimport) DwmSetWindowAttribute`. Adding
  `-ldwmapi` links. Once the WebView2 calls exist they also need `WebView2Loader`
  (`WebView2LoaderStatic.lib` for MSVC, or ship `WebView2Loader.dll`) plus the
  `WebView2.h` header from the `Microsoft.Web.WebView2` NuGet package, which is not in
  the Windows SDK or in mingw-w64. Today's `__has_include(<WebView2.h>)` guard means a
  machine without the header builds an app without a web view and says nothing: it
  should be a build error.
- **CF-001.g · [read] The offscreen test runner always reports failure.**
  `webui.hpp:765–767`: `run_webview_test()` calls `run_win32_webview2(state_, true, …)`
  and returns `state_->quit_requested`. That flag is only set when the window closes, and
  the offscreen loop (`windows_webview2.hpp:256–270`) exits on the timeout without
  setting it, so a correct page returns `false`. macOS and Linux return whether the page
  loaded and the bridge answered; Windows should do the same (`NavigationCompleted` with
  `IsSuccess`, then one round trip through the bridge). Note also that the window is
  created at `(-2000, -2000)` but never shown (249–252): WebView2 does not paint, and may
  not finish navigation, in a window that was never shown; `ShowWindow(SW_SHOWNOACTIVATE)`
  off-screen is the usual trick.
- **CF-001.h · [read] Icons.** `set_icon` is documented as taking `.png`, `.icns` or
  `.ico` (`cfire doc --llm`, `ext:webui`). Windows loads it with
  `LoadImageW(…, IMAGE_ICON, …, LR_LOADFROMFILE)` (217), which only reads `.ico`; a
  `.png` gives no icon and no error. The `.exe`'s own icon (Explorer, taskbar pin) needs
  an `.ico` in a resource script compiled with `windres`/`rc.exe`; nothing in cfire's
  binary mentions either, so `build.Executable({ Icon: … })` (used for the macOS
  `.icns`) has no Windows counterpart. The `HICON` from `LoadImageW` is also never
  destroyed, and the background brush from `CreateSolidBrush` (181) leaks per `run()`.
- **CF-001.i · [read] Menus and keyboard.** `add_menu_item` builds the menu bar on macOS
  only (`custom_menus` is read in `macos_ios.hpp:423` and nowhere else). On Windows, as on
  Linux, the menu items and their shortcuts are ignored. WebView2 also needs
  `AcceleratorKeyPressed` handled if the host wants to see Ctrl/Alt shortcuts before the
  page does.
- **CF-001.j · [read] Clipboard writes likely always fail.** `windows_webview2.hpp:27–64`,
  `win32_clipboard_set()` calls `OpenClipboard(nullptr)` then `EmptyClipboard()` (28–29).
  The Win32 documentation for `EmptyClipboard`: if the clipboard was opened with a `NULL`
  window, it sets the clipboard owner to `NULL`, "this causes `SetClipboardData` to fail".
  So `app.clipboard_set` and `clipboard_set_secret` most likely put nothing on the
  clipboard. Fix: open it with the app's `HWND` (or a message-only window when there is
  none). When `SetClipboardData` fails the `HGLOBAL` stays the caller's and leaks (38,
  49, 58: the result is not checked). The concealed formats themselves are the right
  ones (`ExcludeClipboardContentFromMonitorProcessing`, `CanIncludeInClipboardHistory` =
  0). `win32_monospace_fonts()` (95–105) looks right; it lists GDI families, which
  include `@`-prefixed vertical variants that it already skips.

- **Repro (CF-001.a, CF-001.f):** `t.cpp` = `#include "cfire_prelude.hpp"`,
  `#include "core/webui.hpp"`, `int main(){ cfire::webui::App app; app.run(); }`. Build
  with the command above (after the CF-010.a/b prelude fix): link error. Add `-ldwmapi`:
  it links, and the source shows the window it creates holds no web view.
- **Ideal:** a WebView2 backend that satisfies the table above with the same
  `webui.App` API, failing the build when the WebView2 SDK is missing and failing
  `app.run()` with a clear error when the runtime is.

### CF-002 · bug · `resolved ✓`: `App.emit()` retains every payload forever
- **At `466751b`:** history is a ring buffer (256 entries per event, `app.set_max_history`). Flint's periodic trim and its private-member access are deleted.
- **Needed:** a terminal emits thousands of events per minute for hours.
- **Source:** `runtime/core/webui.hpp`, `emit()` (~line 817). Every payload is pushed into
  `state_->emitted_history[event]` with no bound, and `set_state()` does the same. This is
  useful for `emitted_events_count` in tests, but it is unbounded memory growth in a running
  app.
- **Confirmed (M01):** at `3963814`, `emit()` pushes every payload into
  `emitted_history`, and `eval_js()` pushes every script into `eval_history`. Neither is
  bounded. The spike streams a terminal through `emit`, so a long session grows both
  forever.
- **Workaround (M04):** the GUI clears both histories once every 512 terminal events
  (`trim_webui_history` in `src/adapters/uievents/webui_sink.cf`). `App` keeps its
  state private and has no API for it, so `native/flint_gui.hpp` reaches the member
  through the explicit-instantiation access rule. Tests that count events still work
  because they emit fewer than 512.
- **Ideal:** record history only in test mode, or keep a bounded ring buffer.

### CF-003 · improvement · `declined upstream`: high-throughput / binary event channel
- **At `43431f2`:** **cfire's decision:** `app.emit` and `app.emit_bytes` are enough; a streaming channel inside `ext:webui` is out of scope. Flint's events stay as they are.
- **At `466751b`:** `app.emit_bytes` base64-encodes the bytes and runs one `eval_js` per event, which is what Flint already does through `emit`. No throughput gain, so Flint keeps `emit`. Still wanted: a real binary path (custom scheme, `postMessage` with an `ArrayBuffer`, or a local socket) and batching.
- **Needed:** terminal output is raw bytes at high rates.
- **Source:** `emit()` JSON-stringifies the payload and calls `eval_js(...)` once per event.
  Bytes must be base64 or escaped strings, and each event is a separate JS evaluation.
- **Confirmed (M01):** the PTY spike (`spike/pty-webui`) has to base64-encode each chunk
  (`src/adapters/uievents/webui_sink.cf`), because PTY output is not guaranteed to be
  valid UTF-8 inside a JSON string. Each chunk is one `evaluateJavaScript` call.
  Throughput has not been measured yet.
- **Ideal:** a binary streaming channel to the page (custom scheme, `postMessage` with
  `ArrayBuffer`, or a local websocket), plus optional batching.

### CF-004 · missing · `answered, wrong`: OS file drag & drop into the webview
- **At `466751b`:** `files:dropped` event added. Flint has no drop target yet (SFTP upload is on its roadmap).
- **Tried at `43431f2` (milestone 17):** the event carries names, not paths. The bridge's drop listener
  (`core/webui/bridge.hpp`) sends `f.path || f.name`; `File.path` is an Electron extension that neither
  WKWebView nor WebKitGTK has, and there is no native drop handler, so a dropped `report.pdf` arrives as
  `"report.pdf"`. **Workaround:** the page reads the dropped files' bytes and stages them on this machine
  through an RPC (`files_stage`, `src/adapters/process/drop_stage.cf`, D-055); no native code. **Ideal:**
  a native drop handler (`NSDraggingDestination` / GTK `drag-data-received`) that reports absolute paths.
- **At `c5b1d4b` on a real Linux desktop (milestone 25's spike, 2026-11-10):** the
  workaround does not work there. On Zorin OS 18.1 (GNOME on Wayland, WebKitGTK 2.52.6,
  through Proxmox's noVNC console) a file dragged from Nautilus or a desktop icon reaches
  the page as `text/uri-list` (empty value) and `text/html`, with `dataTransfer.files`
  empty, in a plain WebKit2GTK 4.1 window and in Epiphany; Flint's Files view does not
  light up and ignores the drop. So on Linux the page gets neither paths nor bytes, and a
  native GTK drop handler is the only way (ROADMAP §1, "Image paste and file drops do not
  work on Linux"). The same on GNOME X11 with a real XDND drag from a GTK 3 source
  that offers only `text/uri-list` (`scripts/paste-probe-x11.sh`), so it is neither
  Wayland nor the console.
- **Needed:** SFTP upload by dropping files from Finder or the file manager (roadmap `next`).
- **Source:** no drop handler in `webui.hpp`. The page cannot get real paths for dropped
  files.
- **Ideal:** an event such as `files:dropped` with absolute paths and the drop coordinates.

### CF-005 · missing · `declined upstream`: SSH client module
- **At `43431f2`:** **cfire's decision:** `ext:net/ssh` stays a high-level module; a specialised SSH client binds libssh directly. That is what Flint does, so nothing changes.
- **At `466751b`:** `ext:net/ssh` covers dial, fingerprint, key/password/agent auth, PTY, exec, SFTP and forwarding, but not what Flint relies on: `SSH_OPTIONS_FD` (a session over another session's channel, for jump hosts), a host key algorithm preference, keyboard-interactive auth, `userauth_list`, private key inspection, an exec's exit status and signal. Known hosts go to `~/.ssh/known_hosts`, where Flint keeps them in its vault. `CFIRE_HEADLESS_TEST=1` swaps in a mock server (CF-071). Flint keeps its libssh adapter.
- **Needed:** the core of Flint: PTY, exec, SFTP, agent, port forwarding, known_hosts.
- **Confirmed (M01):** cfire has no SSH support.
- **Workaround:** `src/adapters/ssh/libssh.cf` over the system libssh
  (`import cpp "libssh/libssh.h" @pkg("libssh")`): dial with timeout, host-key
  fingerprint, key-by-content auth, PTY shell, read with timeout, resize. No
  `build.CMake` needed; `@pkg` resolves it through pkg-config (D-012).
- **Ideal:** `ext:net/ssh`, so a 15-line SSH client is possible in cfire.

### CF-006 · missing · `not adopted`: vetted crypto: Argon2id, XChaCha20-Poly1305
- **At `43431f2`:** [ran, read] libsodium is now required: without it `ext:crypto/sodium` stops at `#error` (no PBKDF2 or hand-written fallback, CF-070), and it adds `blake2b` and `derive_subkey`. Parallelism is still 1 (Tether's 4 lanes still need libargon2), and the default cost is far below what the reference says (**CF-090**). Flint keeps its adapter.
- **At `466751b`:** `ext:crypto/sodium` has Argon2id (parallelism 1), XChaCha20-Poly1305, random bytes and memzero, but no `crypto_kdf` subkeys or BLAKE2b digest, and it falls back to PBKDF2 and a hand-written cipher without libsodium (CF-070). Tether's 4-lane Argon2id still needs libargon2. Flint keeps its libsodium adapter.
- **Needed:** master-password key derivation and secret AEAD.
- **Source:** `core:crypto/aes` is a header-only AES-GCM implementation. Its constant-time
  properties are unaudited, and there is no password KDF.
- **Confirmed (M01):** nothing in cfire provides a password KDF or an XChaCha20 AEAD.
- **Workaround:** `src/adapters/crypto/sodium.cf` over the system libsodium
  (`@pkg("libsodium")`).
- **Again in M08:** importing a Tether vault needs Argon2id with 4 lanes, which
  libsodium's `crypto_pwhash` cannot compute (it fixes parallelism at 1).
  `src/adapters/vault/tether.cf` calls the reference libargon2 (`@pkg("libargon2")`,
  D-034) for that one derivation.
- **M24:** the Tether importer and libargon2 are gone (D-065); Flint needs only
  libsodium's single-lane Argon2id again, so the 4-lane gap no longer affects it.
- **Ideal:** `ext:crypto/sodium` (or a libsodium-backed `core:crypto/*`).

### CF-007 · missing · `not adopted`: encrypted SQLite in `ext:db/sqlite`
- **At `43431f2`:** [ran] With SQLCipher installed the build links it and `open_encrypted` writes an encrypted file (no `SQLite format 3` header, the inserted value is not in it). [read] Without SQLCipher, `apply_key` checks `PRAGMA cipher_version` and returns an error instead of writing plaintext (CF-069). A raw key (`x'…'`) is accepted; the cipher settings are not exposed. Flint keeps its adapter, which pins them.
- **At `466751b`:** `sqlite.open_encrypted` writes a plaintext file when SQLCipher is not linked, and it is not linked by default (CF-069). Flint keeps its SQLCipher adapter, which also pins the cipher settings and keys with a raw key and salt.
- **Needed:** the vault file must be encrypted in full.
- **Source:** `ext:db/sqlite` links the system `sqlite3`.
- **Confirmed (M01):** no key parameter or cipher build in `ext:db/sqlite`.
- **Workaround:** `src/adapters/vault/sqlcipher.cf` over the system SQLCipher
  (`import cpp "sqlite3.h" @pkg("sqlcipher")`), keyed with a raw 32-byte key (D-013,
  D-014). Flint does not import `ext:db/sqlite` anywhere, so the two `sqlite3` builds never
  meet in one binary. Untried: what happens if they did.
- **Ideal:** `sqlite.open(path, key: bytes)` backed by a cipher build.

### CF-008 · missing · `not adopted`: OS keychain module
- **At `43431f2`:** [ran, macOS] `set`, `get` and `delete_password` round-trip, a secret with quotes and `$(id)` included, and `get` after delete reports not found. [read, Linux] `secret-tool` now gets the secret on stdin with shell-quoted arguments, `lookup` reads the Secret Service, the exit status is checked, and the in-memory store exists only in `CFIRE_TEST_MODE` builds (CF-071). Secrets are still `str`, not `[]byte`. Flint keeps its adapter (libsecret's C API, byte buffers).
- **At `466751b`:** `ext:keychain` does not read the Secret Service on Linux, passes the secret through a shell, ignores errors and keeps secrets in memory (CF-071). Flint keeps its Security.framework / libsecret adapter, now on `std::byte` buffers.
- **Needed:** cache the derived vault key per machine (macOS Keychain, Linux Secret Service,
  later Windows Credential Manager).
- **Workaround (M02):** `src/adapters/keychain/` over Security.framework (macOS) and
  libsecret (Linux), in one native header (`native/flint_keychain.hpp`) because cfire
  cannot select per-platform sources or link a framework (CF-031).
- **Ideal:** `ext:keychain` with `set`, `get` and `delete(service, account)`.

### CF-009 · missing · `resolved ✓`: repository licence
- **At `466751b`:** MIT `LICENSE` at the repository root.
- **Needed:** Flint is to be released as open source on top of cfire and its runtime headers.
- **Source:** the GitHub API reports no licence for `gsandoval/cfire`.
- **Ideal:** an OSI licence (MIT or Apache-2.0) covering the compiler and `runtime/`.

### CF-010 · missing · `partly resolved`: Windows support in the core runtime
- **At `c5b1d4b`:** [read] cfire ported `core/net/tcp.hpp`, `tls.hpp` and `os.socketpair` to Winsock2 (CF-010.c-net, g) with a mock-header test and a Windows CI job. Flint builds nothing for Windows yet, so nothing was run; k (a cross sysroot) is still deferred.
- **At `43431f2`:** [compiled] CF-010.a and CF-010.b are fixed: a hello world compiles and links for Windows (403 KB `.exe`, llvm-mingw, the runtime installed by `43431f2`). CF-010.c: `core/cli.hpp` compiles now; `core/net.hpp` still fails (`'arpa/inet.h' file not found`). [read] CF-010.d, e, f, h, j, l, m are changed in the source (`CommandLineToArgvW`-style quoting, concurrent pipe draining, `PeekNamedPipe`, VT input, `CredWriteW` status, `CP_UTF8`, `_fileno`); nothing was run on Windows. **Deferred by cfire:** CF-010.c (net, Winsock), g (`socketpair`) and k (a cross-compiling sysroot).
- **At `466751b`:** `_WIN32` paths added across the runtime, but **a hello world does not
  compile for Windows** (see "Windows at `466751b`" above for how this was checked).
  Paths are under `~/.cfire/runtime/`. Items a–c stop the build; d–m compile but
  misbehave.
- **Repro (a, b):** `hello.cf` = `fn main() { println("hello") }`;
  `cfire emit-cpp hello.cf > t.cpp`; build with the command above. Output:
  ```
  cfire_prelude.hpp:943:12: error: cannot initialize return object of type 'const char *' with an rvalue of type 'const value_type *' (aka 'const wchar_t *')
  cfire_prelude.hpp:955:12: error: cannot initialize return object of type 'const char *' with an rvalue of type 'const value_type *' (aka 'const wchar_t *')
  cfire_prelude.hpp:1536:14: error: target of using declaration conflicts with declaration already in scope
  /opt/llvm-mingw/x86_64-w64-mingw32/include/rpcndr.h:93:25: note: conflicting declaration
     93 |   typedef unsigned char byte;
  ```

**Items**

- **CF-010.a · [compiled] `c_str`/`c_arg` of a path.** `cfire_prelude.hpp:942–944` and
  `954–956` return `p.c_str()` as `const char*`. On Windows `std::filesystem::path`
  stores `wchar_t`, so `c_str()` is `const wchar_t*`. A `const char*` cannot be borrowed
  from the path there: these two overloads need to return an owning holder on Windows
  (the prelude already has `CStrViewHolder`, line 917, for `string_view`), built from
  `p.u8string()` or `p.string()`. Prefer UTF-8 (`u8string`): `path::string()` converts
  through the ANSI code page and throws on characters it cannot represent, and every
  other string in cfire is UTF-8. The same UTF-8 rule applies wherever the runtime passes
  a path to a C API (`fopen` needs `_wfopen`, see CF-010.l).
- **CF-010.b · [compiled] `byte` clashes with `<windows.h>`.** `cfire_prelude.hpp:1536`
  puts `cfire::byte` (a conversion function, 1410) in the global namespace with
  `using cfire::byte;`. `rpcndr.h`, pulled in by `<windows.h>`, declares
  `typedef unsigned char byte;` there too. Every program fails, because the prelude itself
  includes `<windows.h>`. MSVC has the same typedef. Options: do not export `byte` globally
  on Windows and have the code generator emit `cfire::byte(...)`; or define
  `WIN32_LEAN_AND_MEAN` *and* stop `rpcndr.h` being reached (fragile: `objbase.h` from
  webui and `wincred.h` from keychain bring it back). The first is the robust one. To
  get past it for this check, the `using` was simply removed under `_WIN32`: enough for a
  hello world, not for code that calls `byte(x)`.
- **CF-010.c · [compiled] Modules with no Windows side.** `core/cli.hpp:9` includes
  `<termios.h>` and `unistd.h` unconditionally (so `cli.prompt_password` and friends do not
  exist on Windows), and `core/net/tcp.hpp:19` includes `<arpa/inet.h>`. Networking on
  Windows needs Winsock: `<winsock2.h>`/`<ws2tcpip.h>` before `<windows.h>`, `WSAStartup`
  once, link `ws2_32`, `SOCKET` instead of `int` (sockets are not CRT file descriptors, so
  `fd_read`/`fd_write`/`poll_fd` cannot take them), `closesocket`, `WSAPoll`.
  `grep -rn WSAStartup runtime/` finds nothing today.
- **CF-010.d · [read] `os.command` quoting.** `core/os.hpp:255–258` builds the command
  line as `"binary" "arg1" "arg2"` with no escaping. Windows programs split their command
  line with the `CommandLineToArgvW` rules, so an argument that contains `"` ends the
  quoted span early and the rest becomes new arguments, and one that ends in `\` escapes
  the closing quote. Both are argument injection when an argument comes from data (a host
  name, a file name). The standard fix is the quoting algorithm from Microsoft's
  "Everyone quotes command line arguments the wrong way" (double the backslashes that
  precede a `"`, escape the `"`, double trailing backslashes). Also: `CreateProcessA`
  (268) takes the ANSI code page, so a UTF-8 path or argument with non-ASCII characters is
  garbled; convert to UTF-16 and call `CreateProcessW`. `.bat`/`.cmd` files need
  `cmd.exe /c` and its own escaping rules; `CreateProcess` does not run them directly.
- **CF-010.e · [read] `os.command` can deadlock.** `core/os.hpp:300–301` reads the child's
  stdout until EOF and only then reads stderr. A child that writes more than the pipe
  buffer (`CreatePipe(…, 0)` takes the system default, 4 KB in practice) to stderr before closing stdout blocks
  on that write forever, and so does the parent. Read both pipes concurrently (a thread
  for stderr, or overlapped I/O on named pipes).
- **CF-010.f · [read] `os.poll_fd` on Windows.** `core/os.hpp:502–517` waits on the CRT
  descriptor's handle with `WaitForSingleObject`. Anonymous pipe handles are not
  documented as waitable objects; in practice the wait returns immediately, so
  `poll_fd` says "readable" when nothing is there and the next read blocks. A console
  input handle is waitable but is signalled by *any* input record (key-up, focus, mouse,
  resize), so the same happens on a key release. Per handle type: `PeekNamedPipe` for
  pipes, `GetNumberOfConsoleInputEvents` + `PeekConsoleInputW` for consoles (keep only
  key-down records with a character), `WSAPoll` for sockets.
- **CF-010.g · [read] `os.socketpair` is a pipe.** `core/os.hpp:519–522` returns `pipe()`
  on Windows. A pipe is one-way: writing to end 0 fails, and code that uses the pair as a
  wake-up channel in both directions (or hands one end to a child as a socket) breaks.
  Real options: a loopback TCP pair (the usual emulation), or `AF_UNIX` sockets (Windows 10
  1803+). Either way the ends are `SOCKET`s, not CRT descriptors (see CF-010.c).
- **CF-010.h · [read] Raw console mode.** `core/os.hpp:475–499` clears echo, line and
  processed input, but does not set `ENABLE_VIRTUAL_TERMINAL_INPUT`. Without it, arrow,
  Home/End and function keys produce no bytes at all through `_read`/`ReadFile`, so a
  terminal program (an SSH client, a TUI) cannot see them. The output side needs
  `ENABLE_VIRTUAL_TERMINAL_PROCESSING` on the output handle for ANSI escapes to render
  instead of printing as text; nothing in the runtime sets it (`grep -rn
  VIRTUAL_TERMINAL runtime/` is empty). There is no window-resize signal on Windows: a
  resize arrives as a `WINDOW_BUFFER_SIZE_EVENT` input record, which the byte-oriented
  read path discards.
- **CF-010.i · [read] `os.on_signal`.** `core/os.hpp:546–549` uses `std::signal`. The
  Windows CRT supports only `SIGINT`, `SIGBREAK`, `SIGTERM` (never raised by the system),
  `SIGABRT`, `SIGFPE`, `SIGILL` and `SIGSEGV`; it resets the handler to `SIG_DFL` after each
  delivery (so a second Ctrl+C kills the process); and it runs the `SIGINT` handler on a
  new thread. Closing the console window, logoff and shutdown reach a process only through
  `SetConsoleCtrlHandler`. `SIGHUP`, `SIGWINCH` and `SIGPIPE` do not exist, so cfire code
  that names them needs a documented answer on Windows.
- **CF-010.j · [read] `ext:keychain` on Windows.** `core/keychain.hpp`:
  `CredWriteA`'s result is discarded (101), so `set` reports success when the write
  fails; it fails for secrets over `CRED_MAX_CREDENTIAL_BLOB_SIZE` (2560 bytes), among
  others. `CredDeleteA` (219) likewise. The secret is also copied into the in-process
  `memory_fallback_store` (42), and `get` falls back to it (164) when Credential Manager has
  nothing, so within one process a failed write still "reads back". This is the same
  pattern as CF-071 on Linux. The `A` variants take service and account in the ANSI code
  page; `CredWriteW` with UTF-16 conversions avoids that.
- **CF-010.k · [compiled] No cross-compiling to Windows.** On macOS,
  `cfire build --target x86_64-w64-mingw32` runs clang with the host's include paths
  (Homebrew's `sodium.h` → `'stdlib.h' file not found`). There is no option for a target
  sysroot or a cross compiler, so a Windows binary has to be built on Windows. Accepting
  `CFIRE_CXX`/a `--sysroot`, or documenting the llvm-mingw image as the cross toolchain,
  would let macOS and Linux CI build Windows. Separately: cfire's binary carries
  `-mwindows`, `-subsystem=`, `mingw` and `msvc`, so it seems to drive both toolchains on
  Windows; which one is the default, how `@pkg(...)` resolves there (pkg-config is not
  standard on Windows; vcpkg or MSYS2 provide it), and how `build.Executable({ Icon })`
  maps to a resource file, were not checked.
- **CF-010.l · [read] Console text and UTF-8.** Nothing in the runtime calls
  `SetConsoleOutputCP(CP_UTF8)`/`SetConsoleCP(CP_UTF8)` (`grep -rn SetConsoleOutputCP
  runtime/` is empty). cfire strings are UTF-8, so `println("café")` prints mojibake in a
  default Windows console, and `readln` returns input in the console's code page. Either
  set both code pages at startup, or write through `WriteConsoleW` when the handle is a
  console. The same UTF-8/UTF-16 boundary applies to file APIs that take `char*` paths
  (`fopen`, `std::ifstream(const char*)`); `std::filesystem::path` built from `u8string`
  is the safe route.
- **CF-010.m · [read] `File.fd()` returns -1.** `core/fs.hpp:256–262` (`File.fd()`)
  returns `-1` on Windows instead of `_fileno(fp_)`, so code that passes a file's
  descriptor on (to `poll_fd`, `fd_read`) gets an invalid one there.

- **Source (before `466751b`):** `core:os/exec` uses `posix_spawnp`, `core:os/signal` uses POSIX signals,
  `runtime/core/sqlite.hpp` has `#if !defined(_WIN32)`, and the guide documents Windows only
  via WSL2.
- **Ideal:** native Windows (MSVC or clang-cl) builds of `core:*`.

### CF-011 · improvement · `resolved ✓`: `cfire --version` does not identify the build
- **At `43431f2`:** [ran] `CFIRE_VERSION=43431f2 sh install.sh` installed that commit and `cfire --version` prints `cfire 0.9.5 (43431f2, …)`.
- **At `466751b`:** `cfire --version` prints the commit (`cfire 0.9.5 (466751b, …)`) when built from a git checkout. The installer builds a tarball, so it prints `dev`, and it cannot install a commit or tag (CF-072).
- **Needed:** every entry here must be reproducible against an exact cfire build.
- **Repro:** `curl -fsSL https://cfire.memo.engineer/install.sh | sh` compiles whatever
  `main` points to at that moment (`CFIRE_VERSION` defaults to `main`), and
  `cfire --version` then prints only `cfire 0.9.4 (ISO C++23 systems toolchain)`. Two
  installs a day apart report the same string with different code. Observed on 2026-11-05;
  `main` was at `396381402699f8957bd9a304cb1092e3243be3bf` around the time of install.
- **Workaround:** run `git ls-remote https://github.com/gsandoval/cfire refs/heads/main`
  right before installing, then record that SHA.
- **Ideal:** embed the commit SHA and build date at compile time
  (`cfire 0.9.4 (3963814, 2026-11-05)`), print it in `cfire doctor`, and have the installer
  default to the latest tagged release rather than `main`.

---

The entries below were found while building milestone 01 against cfire `3963814`
(2026-11-05). Each repro is a whole file; run it with `cfire run <file>.cf`.

### CF-012 · bug · `resolved ✓`: `cfire new` templates write a `build.cf` that `cfire build` rejects
- **At `466751b`:** `cfire new --template webui` + `cfire build` works; both `build.cf` forms parse.
- **Repro:** `cfire new --template webui app && cd app && cfire build` →
  `error: no executables declared in …/build.cf`. Every template does the same.
- **Source:** the templates in `src/main.cpp` emit `app := Executable{ name: …, entry: … }`,
  but `parse_build_cf` (`src/buildsys.hpp`) only recognises
  `var X = build.Executable("name", { Entry: … })` after `import "core:build"`.
- **Workaround:** Flint's `build.cf` uses the `build.Executable` form from `docs/GUIDE.md`.
- **Ideal:** templates emit the form the parser accepts, and a `cfire test` covers
  `cfire new` + `cfire build` for every template.

### CF-013 · bug · `resolved ✓`: the `as` cast is documented but does not parse
- **At `466751b`:** `as` gets a clear diagnostic pointing to `T(x)`, the documented conversion.
- **Repro:** `package main` / `fn main() { x := 3; y := x as u8; println("{}", y) }` →
  `unexpected token 'as' in expression`. `docs/GUIDE.md` (Chapter 4) and `cfire doc --llm`
  both document `expr as T`. In the parser, `KwAs` is only used for import aliases.
- **Workaround:** function-style conversion, `u8(x)`, which works.
- **Ideal:** implement `as`, or document `T(x)` as the conversion syntax.

### CF-014 · bug · `resolved ✓`: top-level `const` is documented but does not parse
- **At `466751b`:** top-level `NAME: T = v` is an immutable binding. Flint's 73 `var` globals are now immutable.
- **Repro:** `package main` / `const K: i64 = 3` / `fn main() { println("{}", K) }` →
  `unexpected identifier 'const' at top-level`. Documented in GUIDE Chapter 4.
- **Workaround:** `var K: i64 = 3`. These globals are mutable.
- **Ideal:** `const` lowered to `constexpr`, as documented.

### CF-015 · bug · `resolved ✓`: the `panic()` builtin lowers to an undeclared identifier
- **At `466751b`:** `panic("…")` builds and reports file and line.
- **Repro:** `fn f(x: i64) -> i64 { if x < 0 { panic("neg") } return x }` plus a `main`
  that calls it → clang `use of undeclared identifier 'panic'`.
- **Workaround:** return an error instead. That also blocks `or err { panic(…) }`, which
  `cfire/NON-DIVERGING-OR-BLOCK` suggests.
- **Ideal:** lower `panic` to the prelude's panic routine.

### CF-016 · bug · `resolved ✓`: a sibling or test file that fails to parse is dropped silently
- **At `466751b`:** the parse error is reported first and `cfire test` fails. (A compile error in one file is still attributed to the test file, CF-068.)
- **Repro:** a package dir with `a.cf` (`package p` / `const K: i64 = 1` / `fn f() -> i64 { return K }`)
  and `a_test.cf` (`package p` / `test "t" { assert_eq(f(), 1) }`). `cfire test dir` reports
  `use of undeclared identifier 'f'` from clang, not the parse error in `a.cf`. If the
  parse error is in the test file itself, `cfire test dir` prints
  `✓ No test suites found` and exits 0.
- **Source:** `src/buildsys.hpp` (`if (item.is_auto_sibling) continue;`) and the directory
  walk in the `test` command (`if (!ast) continue;`).
- **Ideal:** report every parse error, and fail `cfire test` when any `.cf` file in the
  target cannot be parsed.

### CF-017 · bug · `partly resolved`: packages are not namespaced in the generated C++
- **At `43431f2`:** [ran] Types are mangled per package now (`cfire_pkg_p__Mode`): a `Mode` and a `helper` in both `main` and `p` build, `p.helper()` works inside an interpolation, and `p.Mode::B` lowers correctly. Still: a match arm cannot name the package: `p.Mode::A => …` fails to parse (`expected '=>', got '::'`); the bare variant (`A => …`) works.
- **At `466751b`:** functions are mangled per package and a user method no longer captures stdlib calls of the same name (Flint reads the vault header with `fs.open` again). Still open: **types** share one C++ namespace, so two packages that each declare `Mode` fail with `redefinition of 'Mode'`; and `"{p.helper()}"` (a call into an imported user package inside an interpolation) does not compile. Flint keeps its type names unique and its port method prefixes (by choice).
- **Repro:** `p/p.cf` (`package p` / `fn helper() -> i64 { return 7 }` /
  `type Mode enum { A, B }`), `m/main.cf` (`package main` / `import "../p"` /
  `fn helper() -> i64 { return 1 }` / `fn main() { println("{}", p.helper()) }`) → clang
  `redefinition of 'helper'`. And `p.Mode::B` lowers to `p.Mode::B` →
  `use of undeclared identifier 'p'`.
- **Cause:** every package is emitted into one translation unit with no C++ namespace, so
  `p.f` becomes `f`.
- **Workaround:** Flint keeps every top-level name unique across the whole program
  (`open_cipher_db`, `ssh_dial`, `new_sodium`), and refers to another package's enum
  variants unqualified (`KdfCost::Interactive`).
- **It also hits methods:** a user method `fn (mut self: SshConn) close()` lowers to a
  free function `cfire_method_close(SshConn&)`. Every other `.close()` call in the
  program then resolves to it, including `defer app.close()` on a `webui.App` and
  `ch.close()` on a `sync.Channel`, and fails with `no matching function for call to
  'cfire_method_close'`. Flint names these methods `disconnect` and `close_db`.
- **Also free functions and stdlib methods (M02):** a user method `open(key, sealed, aad)`
  captures the free function `fs.open(path)` (`call to 'open' expects 3 argument(s), got
  1`), and `SshConn.read(timeout_ms)` captures `fs.File.read(mut buf)`
  (`no matching function for call to 'cfire_method_read'`). Flint prefixes every port
  method (`vault_*`, `keychain_*`, `recents_*`), renamed `Crypto.open` to `unseal`, and
  reads the vault header with `std::ifstream` in `src/adapters/vault/store.cf`.
- **Still at `2d8613d` (M11b), free functions across packages:** `clicmd` declared
  `fn answer_prompt(prompter: TtyPrompter, payload: str)` while `uievents` already had an
  `answer_prompt` of other parameters. The CLI (which does not import `uievents`) built;
  the app failed with `no matching conversion for functional-style cast from
  'TtyPrompter' to 'std::string'` at a call site in `main.cf`. Renamed
  `answer_relayed_prompt`.
- **Ideal:** one C++ namespace per package, and stdlib method calls that never route to
  user methods. This matters a lot for a hexagonal layout, where two adapters naturally
  both have `open`, `close` and `new`.

### CF-018 · improvement · `declined upstream`: the `cfire test` fd-leak canary has no opt-out
- **At `43431f2`:** **cfire's decision:** no per-test opt-out attribute, "to keep the test grammar clean". Instead the canary is skipped for every test of a package that has an `import cpp`. That silences Flint's warm-up cases, and also every real leak in those packages: **CF-089**. Flint's warm-ups stay (harmless, and needed again if CF-089 lands).
- **At `466751b`:** the canary pre-warms SQLite's RNG for `ext:db/sqlite` and skips tests that import `ext:keychain` or reach `run_webview_test` through a helper. Flint's own libsodium and libsecret still open fds on first use, so its start-up warm-ups stay. Still wanted: a per-test opt-out.
- **Repro:** a test whose first call into libsodium runs `sodium_init()`. libsodium keeps
  the system RNG fd open for the life of the process, and the canary fails the test with
  `test leaked 1 open file descriptor(s)`.
- **Workaround:** `src/adapters/crypto/sodium.cf` initialises libsodium in a global
  (`var SODIUM_READY = init_sodium()`), before any test runs.
- **Also:** the canary is skipped only when the test body itself contains the identifier
  `run_webview_test` (`stmts_reference_ident` in `src/codegen.hpp`). A test that runs the
  WebView through a helper fails on WebKit's fds. `spike/pty-webui/spike_test.cf` adds a
  dead `if false { … run_webview_test … }` to get past it.
- **Also libsecret (M02, Linux):** glib keeps its D-Bus connection open, so the first test
  that talks to the Secret Service "leaks 5 open file descriptors".
  `src/adapters/keychain/keychain_test.cf` makes one lookup from a global initialiser on
  Linux only: on macOS, calling Security.framework from a global initialiser makes the
  test binary exit 1 with no output at all.
- **Ideal:** a per-test opt-out (`test "x" @allow_fd_growth { … }`) or a documented
  process-start hook.

### CF-019 · bug · `resolved ✓`: raw foreign pointers: `none` and parameters lower wrongly
- **At `466751b`:** `none` lowers to `nullptr` and pointer parameters pass by value. Flint's `cpp { … = nullptr; }` blocks are gone.
- **Works:** a struct field `h: *mut cpp::sqlite3`, and `cpp { sqlite3_open(p, &h); }` on
  a local `mut h: *mut cpp::sqlite3`.
- **Repro 1:** `self.h = none` lowers to an assignment from `std::nullopt` → clang
  `assigning to 'sqlite3 *' from incompatible type 'const nullopt_t'`.
- **Repro 2:** `fn msg(h: *mut cpp::sqlite3) -> str { … sqlite3_errmsg(h) … }` lowers the
  parameter to `const sqlite3*&`, so the C API rejects it (`no matching function`). `*T`
  struct fields also lower to `const T*`.
- **Workaround:** helpers that need the pointer are methods on the owning struct, and
  pointers are nulled inside `cpp { … = nullptr; }`
  (`src/adapters/vault/sqlcipher.cf`, `src/adapters/ssh/libssh.cf`).
- **Ideal:** `none` → `nullptr` for raw pointers; a `*mut T` parameter → `T*`.

### CF-020 · bug · `reopened`: identifiers that are C++ keywords break the build
- **At `466751b`:** C++ keywords are renamed in the generated code.
- **At `c5b1d4b` (milestone 28) [ran]:** `auto` is not: `auto := os.getenv("X") == "1"` checks
  cleanly in cfire and fails in clang with `cannot combine with previous 'auto' declaration
  specifier`. Flint renamed the local (`auto_run`, `src/drivers/rdpspike/main.cf`).
- **Also (milestone 29) [ran]:** a local named like a C++ namespace the generated code uses
  breaks the same way: `ssh := try add_host(…)` in `src/application/catalog_test.cf`
  checks cleanly and fails in clang with `'ssh' is not a class, namespace, or enumeration`
  on a later line that names `ssh::…`. Flint renamed the local (`sv`).
- **Repro:** `fn main() { short := 3; println("{}", short) }` → clang
  `expected unqualified-id`. The same happens for `short`, `long`, `class`, `template`,
  and so on.
- **Ideal:** mangle C++ reserved words in emitted identifiers, or reject them in `cfire check`.

### CF-021 · improvement · `resolved ✓`: `fs.read_all` infers `std::vector<std::byte>`, not `[]byte`
- **At `466751b`:** one byte type (`std::byte`) across the stdlib and user code. Flint's copy loops are gone (`[]byte(s)`, `str(b)`, `hex.decode`, `rand.bytes`). The switch itself broke code silently (CF-062).
- **Repro:** `raw := fs.read_all(p) or err { return }`, then pass `raw` to
  `fn f(b: []byte)` → clang `no matching function`. Annotating the binding
  (`raw: []byte = …`) converts it.
- **Wider than `fs` (M02):** user `[]byte` is `std::vector<std::uint8_t>`, while
  `hex.decode`, `sha256.random_bytes` and `rand.bytes` return `std::vector<std::byte>`.
  For those the annotation does *not* convert
  (`no viable conversion from 'vector<std::byte>' to 'vector<std::uint8_t>'`), and
  `a == b` between the two fails to compile. Flint's tests rebuild byte slices by hand
  (`random_key_bytes` in `src/adapters/keychain/keychain_test.cf`).
- **Ideal:** one byte type across the stdlib and user code.

### CF-022 · missing · `resolved ✓`: no string-to-integer parsing in the stdlib
- **At `466751b`:** `str.parse_i64` and friends. Flint's digit loops and `std::atoi` are gone.
- **Needed:** reading a port from an environment variable.
- **Source:** nothing in `core:str` or `cfire doc --llm`. `cfire::detail::parse_int<T>`
  exists in the prelude but is not exposed.
- **Workaround:** `std::atoi` in a `cpp {}` block (`src/adapters/ssh/libssh_test.cf`).
- **Ideal:** `str.parse_i64(s) -> i64!`, and the same for the other numeric types.

### CF-023 · bug · `resolved ✓`: `Error.message()` does not convert to `str`
- **At `466751b`:** `err.message()` is a `str`.
- **Repro:** `fn take(s: str) -> i64 { return i64(s.len()) }`, then
  `_ := f() or err { println("{}", take(err.message())); return }` → clang
  `no matching function for call to 'take'` (`message()` is a `std::string_view`).
- **Workaround:** interpolate: `"{err.message()}"` (`src/application/terminal.cf`).
- **Ideal:** `message()` returns `str`, or `std::string_view` converts implicitly to a
  `str` parameter.

### CF-024 · missing · `resolved ✓`: CLI building blocks: argv, positional args, stderr
- **At `466751b`:** `os.args`, `eprint`/`eprintln`, `os.exit`, `cli.positional`/`subcommand`, and `cli.parse` no longer throws. Flint uses `os.args`, `print`, `os.exit` and `os.is_tty`; it keeps its own stderr writer (it flushes stdout first, `eprint` does not), its own flag parser, and its `/dev/tty` prompts (`cli.prompt_password` reads stdin, so it cannot ask while stdin carries data).
- **Needed:** `flint vault|host|key|cred <verb> [args] [--json]` with diagnostics on
  stderr and stable exit codes (Principle 7).
- **Found:**
  - `cli.parse[T]()` returns `T`, not `T!` as documented.
  - It has no positional arguments or subcommands, and it ignores unknown flags.
  - It calls `std::stoi`, which throws on bad input.
  - There is no `os.args()`: `argc`/`argv` exist only as locals of `main`.
  - There is no `eprintln` or other stderr writer, and no `os.exit(code)`.
- **Workaround (M02):** `src/adapters/process/` reads argv through `_NSGetArgv` (macOS)
  or `/proc/self/cmdline` (Linux), writes stderr, exits with a code and reads passwords
  from `/dev/tty` with echo off, in `native/flint_process.hpp`. The subcommand and flag
  parser is plain cfire in `src/drivers/clicmd/args.cf`.
- **Ideal:** `os.args() -> []str`, `eprintln`, `os.exit(code)`, and subcommand plus
  positional support in `core:cli`.

### CF-025 · bug · `resolved ✓`: comma-separated struct fields, as documented, do not parse
- **At `466751b`:** comma-separated fields parse.
- **Repro:** `type U struct { id: i64, name: str }` (the form in `cfire doc --llm`) →
  `expected 'IDENT', got ','`. The multi-line form with trailing commas fails the same way.
- **Workaround:** one field per line, no commas.
- **Ideal:** accept commas, or fix the reference sheet.

### CF-026 · missing · `declined upstream`: concurrency primitives beyond `async.scope` and channels
- **At `43431f2`:** [ran] `ch.len()` compiles and returns the queued count. **cfire's decision:** no owning `sync.Mutex[T]` and no multi-channel `select`. Flint's session mailboxes and locks stay native.
- **At `466751b`:** `sync.Mutex`, `try_recv` and `recv_timeout` work, and the `with_timeout` hang is fixed. `Mutex` does not own its data and is not recursive, `ch.len()` is documented but does not compile (`no member named 'size'`), and there is no `select`. Captures in `scope.spawn` stay read-only, which is fine. Flint's session mailboxes and locks stay native for now (on its roadmap).
- **Needed:** the GUI reads a PTY on a worker thread while keystrokes arrive on the UI
  thread. libssh requires calls on one session to be serialised.
- **Found:**
  - There is no mutex type.
  - `Channel` has no `try_recv`, `len` or `select`. `recv()` returns `T?`, not `T!` as
    documented.
  - `context.with_timeout` starts one OS thread per call, and `recv_ctx` registers a
    callback on the context on every call, so neither works inside a polling loop.
  - `scope.spawn || { … }` captures by `[=]`, so every captured value is `const` inside the
    task. You have to write `mut copy := captured`.
- **Workaround:** `SshConn` holds a `shared[cpp::std::mutex]` that every method locks
  (`src/adapters/ssh/libssh.cf`). In M04 the GUI adds two more: `LockedVaultStore`
  (`src/adapters/vault/locked.cf`, a recursive mutex over the shared SQLCipher
  handle) and the session mailboxes (`src/adapters/uievents/native/flint_gui.hpp`, a
  mutex and condition variable per session for keystrokes, resizes and prompt
  answers, waited on with a timeout).
- **Ideal:** `sync.Mutex[T]` (a lock that owns its data), `try_recv`, and a `select` over
  channels and contexts.

### CF-027 · bug · `resolved ✓`: a `bind` closure cannot return both `error(…)` and a value
- **At `2d8613d`:** resolved. At `466751b` only `return error(…)` worked; the case that matters, `v := check(params) or err { return error("bad") }` inside a `bind_raw` closure, still failed with the deduction error. It now builds. Flint keeps named handlers by choice.
- **Repro:** `app.bind[Req]("x") |req| { if req.n < 0 { return error("neg") } return "ok" }`
  → clang `'auto' in return type deduced as 'std::string' here but deduced as
  'unexpected<cfire::Error>' in earlier return statement`. `try` inside the closure fails
  the same way. Example `17-webui-studio` uses this pattern too.
- **Workaround:** handlers return a `{ ok, detail }` struct (the M01 spike). Since M04 the
  GUI binds with `bind_raw` and each closure is a single `return rpc_x(…)` call to a
  named function returning `str!` (`src/drivers/gui/rpc.cf`); `bind_raw` lambdas hit the
  same deduction error as soon as they mix `try` with a value.
- **Ideal:** infer `T!` for closures that return `error(…)`, so the JS promise rejects.

### CF-028 · bug · `resolved ✓`: a placeholder `/index.html` shadows `serve_dir`
- **At `466751b`:** `serve_dir` serves `/index.html`. Flint dropped its `set_html` workaround.
- **Repro:** the `webui` template (`app.serve_dir("./ui")` with a real `ui/index.html`)
  shows "cfire WebUI Ready" instead of the page.
  `app.resolve_asset_content("/index.html")` returns the 215-byte placeholder.
- **Source:** the `AppState()` constructor puts a default `/index.html` into
  `embedded_assets`, and `resolve_asset` checks `embedded_assets` before `serve_dirs`.
- **Workaround:** read the page and `set_html()` it; other assets still come from
  `serve_dir` (`src/drivers/gui/main.cf`).
- **Ideal:** fall back to the placeholder only when no served directory has the file.

### CF-029 · bug · `answered, untested`: `run_webview_test` is a no-op that returns `true` on Linux
- **At `466751b`:** `run_webview_test` drives WebKitGTK on Linux. Flint's Linux end-to-end run keeps the real window under Xvfb, which it already trusts.
- **Source:** `runtime/core/webui.hpp`, `run_webview_test`: the body is
  `#if defined(__APPLE__) …`, and every other platform runs `return true;`. A headless
  WebView test therefore passes on Linux without loading the page.
- **Workaround:** on Linux the GUI end-to-end run (`scripts/gui-e2e.sh`) opens the real
  GTK window with `app.run()` under `xvfb-run` and checks for `e2e: pass`
  (`scripts/linux/inside.sh`).
- **Ideal:** a WebKitGTK implementation (it can run under `xvfb-run`), or fail with "not
  supported on this platform" instead of passing.

### CF-030 · bug · `resolved ✓`: Linux webui builds fail on a PCH `-pthread` mismatch; `CFIRE_CXX` is ignored
- **At `466751b`:** `CFIRE_CXX` is read and the PCH is built with `-pthread` on Linux. Flint's Linux image dropped its `clang++` wrapper.
- **Repro (Debian trixie, clang 19):** `cfire build` of any program that imports
  `ext:webui` → `error: POSIX thread support was disabled in PCH file but is currently
  enabled`.
- **Cause:** `ensure_prelude_pch` (`src/buildsys.hpp`) always compiles the prelude PCH
  without `-pthread`, and the PCH cache key covers only the runtime dir and
  sanitize/opt. `pkg-config webkit2gtk-4.1` adds `-pthread`, so the compile no longer
  matches the PCH. Every `ext:webui` program on Linux is affected, including the template.
- **Also:** `docs/GUIDE.md` documents `CFIRE_CXX` to override the compiler, but nothing
  in `src/` reads it. Commands hardcode `clang++`.
- **Workaround:** `scripts/linux/Dockerfile` puts a `clang++` wrapper first on `PATH`
  that drops `-pthread`. glibc ≥ 2.34 has threads in libc.
- **Ideal:** build the PCH with the same flags as the translation unit, or include those
  flags in the cache key; honour `CFIRE_CXX`.

---

The entries below were found while building milestone 02 against the same cfire build.

### CF-031 · missing · `declined upstream`: no way to link a framework, pick per-platform sources, or write top-level C++
- **At `43431f2`:** [ran] `cfire test` now applies the nearest `build.cf`'s `Frameworks` (a test calling CoreFoundation links with `Frameworks: ["CoreFoundation"]` and fails to link without it). **cfire's decision:** no `@framework("…")` on `import cpp` and no top-level `cpp {}`; linkage belongs in `build.cf`. Flint keeps its pkg-config files: they also carry the adapters' `-I` paths and, on Linux, `libsecret-1`.
- **At `466751b`:** `*_darwin.cf`/`*_linux.cf` files are picked by platform, and `build.cf` takes `Frameworks`/`Libraries`. Those flags apply to `cfire build` of a declared executable only, not to `cfire test` of a package, so Flint's tests still need its pkg-config files. Still wanted: `@framework("…")` on `import cpp`.
- **Needed:** the keychain adapter calls Security.framework on macOS and libsecret on
  Linux; the CLI needs `_NSGetArgv` (macOS) or `/proc/self/cmdline` (Linux).
- **Repro:** `import cpp "Security/Security.h"` and call `SecItemCopyMatching` →
  `Undefined symbols for architecture arm64` (no `-framework Security`). There is no
  `@framework(...)`, no `_darwin.cf`/`_linux.cf` file selection, no build-target query, and
  a top-level `cpp { extern "C" { … } }` fails with `unexpected top-level token`.
- **Workaround:** a project `.pc` file per OS (`src/adapters/pkgconfig/<os>/flint-native.pc`)
  carries `-framework …` or `Requires: libsecret-1` plus `-I` to the adapters' native
  headers (`src/adapters/keychain/native/`, `src/adapters/process/native/`), which branch on
  `#if defined(__APPLE__)`. `scripts/env.sh` puts the folder on `PKG_CONFIG_PATH`, so a
  plain `cfire build` without it fails.
- **Ideal:** `@framework("Security")` on `import cpp`, platform-suffixed source files
  (`keychain_darwin.cf`), and a `build.os()`/`#if os(...)`-style query.

### CF-032 · bug · `resolved ✓`: `[][]T!` binds `!` to the element type
- **At `466751b`:** `[][]T!` is fallible as a whole. Flint's `SqlRows` wrapper is gone.
- **Repro:** `fn rows() -> [][]Cell! { mut r: [][]Cell = []; return r }` → clang
  `no viable conversion from 'vector<vector<Cell>>' to
  'vector<vector<std::expected<Cell, cfire::Error>>>'`.
- **Workaround:** wrap the matrix in a struct (`SqlRows` in
  `src/adapters/vault/sqlcipher.cf`). `[]T!` works.
- **Ideal:** `!` applies to the whole return type, as with `[]T!`; `([][]T)!` as an
  explicit form.

### CF-033 · bug · `resolved ✓`: structs are emitted in declaration order, not dependency order
- **At `466751b`:** structs are emitted in dependency order, within and across packages. Flint dropped its ordering rules and mirror types where they existed only for this.
- **Repro (one file):** `type Outer struct { one: Inner }` declared before
  `type Inner struct { id: i64 }` → clang `field has incomplete type 'Inner'`. With
  `items: []Inner` the error is `arithmetic on a pointer to an incomplete type 'Inner'`.
- **Across packages:** the importing package's structs are emitted before the imported
  package's, so a field typed with another package's struct never compiles
  (`RecentFile { vaults: []RecentVault }` in `adapters/config`, `Catalog { groups:
  []Group }` in `application`).
- **Across files of one package:** the file order is not stable either. `SshLink { hops:
  []SshConn }` in `adapters/ssh/link.cf` compiled in the package's own tests and on
  macOS, but in the full `flint` build on Linux `SshLink` came before `SshConn`
  (`adapters/ssh/libssh.cf`). libc++ tolerates the incomplete `std::vector` element in a
  default member initialiser; libstdc++ does not, so the bug can hide on macOS.
- **Workaround:** declare inner structs first; declare a struct in the same file as the
  struct types it holds (`SshLink` lives in `src/adapters/ssh/libssh.cf`); keep structs that hold another package's
  types in that package (`Catalog` lives in `src/domain/vault.cf`); hold a raw handle
  instead of a struct (`SqlVaultStore` in `src/adapters/vault/store.cf`); mirror types
  locally (`RecentEntry` in `src/adapters/config/recents.cf`).
- **Ideal:** emit struct definitions in topological order of their by-value and container
  fields, across packages.

### CF-034 · bug · `partly resolved`: a string literal inside an interpolation breaks the string
- **At `c5b1d4b`:** [ran] A related shape: a plain literal holding `{` (`"{not json"`) is read as an interpolation as soon as a `}` follows anywhere on the same line (`parse("{not json") or err { x = "{err.message()}" }` → "unexpected token '}' in expression"). Workaround: the literal on its own line (`src/drivers/clicmd/serve_test.cf`). There is still no escape for a literal `{`.
- **At `43431f2`:** [ran] `"{p.helper()}"` works. Still: an escaped quote in a nested literal, `"eq={v == "a\"b"}"`, passes `cfire check` and fails in clang (`call to consteval function 'std::basic_format_string<char>…' is not a constant expression`); the lowering is `std::println("eq={v == \"a\"b\"}")`, the expression kept as text.
- **At `466751b`:** nested quotes work (`"{f("x")}"`, `"{os.getenv("HOME")}"`). A call into an imported user package inside an interpolation (`"{p.helper()}"`) still fails in clang.
- **Repro:** `msg := "{f("x")}"` → `call to 'f' expects 1 argument(s), got 6`;
  `dir := "/tmp/" + "{os.getenv("USER")}"` → clang `use of undeclared identifier 'USER'`.
- **Workaround:** bind the inner call to a local first.
- **Ideal:** lex `{…}` as a nested expression, quotes included (as Swift, Kotlin and
  Python 3.12 do), or reject it in `cfire check` with a clear message.

### CF-035 · bug · `resolved ✓`: `match` arms that yield a string literal and a `str` do not compile
- **At `466751b`:** string-literal arms lower to `std::string`.
- **Repro:** `return match v { E::Text(s) => s, E::Int(n) => "{n}", _ => "" }` → clang
  `std::visit requires the visitor to have a single return type` (`const char*` vs
  `std::string`).
- **Workaround:** assign to a `mut` local inside block arms.
- **Ideal:** give every arm the match's declared or inferred type (`str`).

### CF-036 · bug · `resolved ✓`: `if x != none` does not narrow an optional
- **At `466751b`:** `if x != none` narrows `T?`. Flint's JSON views keep `""` for none by choice: their `--json` shape is a public contract.
- **Repro:** `f := find(items, 2)` (`-> Item?`), then `if f != none { println("{f.id}") }`
  → clang `no member named 'id' in 'std::optional<Item>'`.
- **Workaround:** `f.value()` inside the branch, or `find(...) or fallback`.
- **Ideal:** flow-narrow `T?` to `T` after a `!= none` check, as the null-safety rules for
  pointers already do.

### CF-037 · bug · `resolved ✓`: a `str?` field breaks `json.stringify`
- **At `466751b`:** `T?` fields serialise as `null` and parse back.
- **Repro:** ``type Item struct { note: str? `json:"note"` }``, then
  `json.stringify(Item{ note: none })` → clang `no viable conversion from
  'const std::optional<std::string>' to 'std::string_view'`.
- **Workaround:** Flint's JSON views use `str` with `""` for "none".
- **Ideal:** optional fields serialise as `null` (or are omitted) and parse back.

### CF-038 · improvement · `resolved ✓`: `os.ExecResult` fields are undocumented, and `.stdout` hits a libc macro
- **At `466751b`:** `r.stdout`/`r.stderr` work. The renaming does not reach `cpp {}` blocks (CF-065).
- **Repro:** `r := try os.command("ssh-keygen", [...])`, then `r.stdout` → clang
  `no member named '__stdoutp' in 'cfire::os::ExecResult'` on macOS (`stdout` is a macro).
  The real fields are `exit_code`, `stdout_str` and `stderr_str`, which `cfire doc --llm`
  does not list.
- **Ideal:** document the fields; mangle identifiers that collide with C macros.

### CF-039 · bug · `resolved ✓`: `cfire fmt` mis-indents everything after a multi-line raw string in a struct literal
- **At `466751b`:** the formatter treats raw strings as opaque.
- **Repro:** `cfire fmt src/adapters/vault/migrations.cf`. The file pushes
  `Migration{ version: 1, name: "…", sql: \`…multi-line SQL…\` }` into a list. After the
  closing `` ` })``, every following line (the rest of the function and the next function)
  is indented one or two extra levels. The SQL itself is untouched and the code still
  compiles, but the layout is wrong.
  Smaller (cfire 0.9.4): no struct is needed. Two calls `list.push(\`` +
  `CREATE TABLE a (` / `    id TEXT` / `);` + `` `)`` in one function are enough; from
  the second call on, every line gains one level, so the formatter appears to count the
  `(` inside the raw string.
- **Workaround:** Flint does not run `cfire fmt` on `migrations.cf`.
- **Ideal:** the formatter treats a raw string literal as opaque when it tracks nesting.

### CF-040 · bug · `resolved ✓`: `x or []` does not compile with libstdc++
- **At `466751b`:** `or []` lowers with the value type. Flint uses it again.
- **Repro (Debian trixie, clang 19, libstdc++ 14):** `fn f() -> []byte! { … }`, then
  `b := f() or []` → lowers to `f().value_or({})` → `no matching member function for call
  to 'value_or'` (`couldn't infer template argument '_Up'`). libc++ (macOS) accepts it, so
  the code builds on one platform only.
- **Workaround:** `r := f()` then `if r.has_value() { … r.value() … }`
  (`src/application/session.cf`).
- **Ideal:** lower the fallback with the expected's value type:
  `value_or(std::vector<std::uint8_t>{})`.

### CF-041 · bug · `resolved ✓`: `os.command` does not link on Linux
- **At `466751b`:** `environ` is the global one. Flint's key tests call `os.command` again.
- **Repro (Debian trixie, clang 19):** any test that calls
  `os.command("ssh-keygen", ["-l", "-f", p])` → `undefined reference to
  'cfire::os::environ'`. It links on macOS.
- **Cause:** `runtime/core/os.hpp` (`command`, ~line 109) declares
  `extern char** environ;` at block scope inside `namespace cfire::os`, so it names
  `cfire::os::environ`, not the global `::environ` that glibc defines. macOS takes the
  `_NSGetEnviron()` branch instead.
- **Workaround:** `os.exec_output` with fixed arguments in
  `src/adapters/ssh/keys_test.cf`.
- **Ideal:** declare `extern char** environ;` at global scope, or use `::environ`
  from `<unistd.h>`.

### CF-042 · missing · `partly resolved`: no terminal raw mode, window size or signal handlers
- **At `43431f2`:** [read] `os.make_raw` registers an `atexit` hook, so `os.exit()` restores the terminal. Still: nothing restores it on SIGTERM or SIGHUP, and `on_signal` still runs a `std::function` inside the handler. Flint keeps its native raw mode.
- **At `466751b`:** `os.make_raw`, `os.term_size`, `os.on_signal` and `os.poll_fd` exist. Flint keeps its native raw mode: `RawTerminal` restores only at scope exit, not at `exit()` or on SIGTERM/SIGHUP; `on_signal` runs a `std::function` inside the signal handler (not async-signal-safe); `term_size` reports 80 columns when there is no terminal, where Flint needs "unknown".
- **Repro:** an interactive SSH client needs to put stdin in raw mode (`cfmakeraw`),
  restore it on exit or on SIGTERM/SIGHUP, read the window size (`TIOCGWINSZ`), learn
  about resizes (SIGWINCH), and poll stdin with a timeout. `core:os` and `core:cli` have
  none of these, and there is no way to install a signal handler.
- **Workaround:** `src/adapters/process/native/flint_process.hpp` (`raw_enter`,
  `raw_restore`, `window_size`, `take_winch`, `read_input`, `write_fd`), reached from
  `StdioTerminal` in `src/adapters/process/process.cf`.
- **Ideal:** a `core:term` module: `make_raw(fd) -> RawGuard` (restores on drop),
  `size(fd) -> (cols, rows)`, `on_resize(fn)`, and `os.on_signal(sig, fn)`; plus
  `poll(fds, timeout)` for byte streams.

### CF-043 · missing · `declined upstream`: no socketpair, poll or threads for a byte-stream bridge
- **At `43431f2`:** **cfire's decision:** no joinable `Thread` value; concurrency stays structured (`async.scope`). Flint's tunnel stays native.
- **At `466751b`:** `os.socketpair`, `os.poll_fd` and fd reads/writes exist. There is still no joinable thread value to own a bridge's thread, so Flint's tunnel stays native.
- **Repro:** a jump host is a libssh channel that must look like a socket to the next
  libssh session (`SSH_OPTIONS_FD`). That takes a `socketpair`, a thread that `poll`s one
  end and copies bytes to and from the channel under the session's mutex, and a join on
  shutdown. cfire has no socketpair, no poll over raw fds, and its threads cannot be
  stored in a struct and joined later (see CF-026 for the mutex half).
- **Workaround:** `flint_ssh::open_tunnel` / `close_tunnel` in
  `src/adapters/ssh/native/flint_ssh.hpp`, owned by `SshLink.tunnels`.
- **Ideal:** `net.socketpair()`, `os.poll([]Fd, timeout_ms)`, and a joinable
  `Thread` value type.

### CF-044 · bug · `resolved ✓`: `assert_eq` against a slice literal does not compile
- **At `466751b`:** `assert_eq(xs, ["a"])` works. Flint's element-by-element checks are gone.
- **Repro:** in a test, `mut xs: []str = []`, `xs.push("a")`, `assert_eq(xs, ["a"])`.
  The literal lowers to a bare braced list (`{"a"}`), which cannot deduce the template
  parameter of `cfire::assert_binop_at`: `no matching function for call to
  'assert_binop_at'` (cfire 0.9.4).
- **Workaround:** compare the length and then each element
  (`src/application/connect_test.cf`, the host key preference checks).
- **Ideal:** lower a slice literal in `assert_eq`/`assert_ne` to the type of the other
  operand.

### CF-045 · missing · `answered, untested`: no way to list installed fonts
- **At `43431f2`:** [read] On macOS `monospace_fonts()` now returns family names (`[NSFont familyName]`, deduplicated), and a free `webui.monospace_fonts()` builds a temporary `App` for it. Flint keeps its adapter, which needs no `App`.
- **At `466751b`:** `app.monospace_fonts()` returns font names on macOS (`Menlo-Regular`, `Menlo-Bold`, …), not the family names CSS takes, and needs an `App`. Flint keeps its CoreText / fontconfig adapter.
- **Needed:** Settings → Terminal lists every installed monospaced font. A webview
  cannot enumerate fonts (WKWebView and WebKitGTK have no Local Font Access API).
- **Workaround:** `src/adapters/fonts/native/flint_fonts.hpp`: CoreText on macOS
  (families with `kCTFontTraitMonoSpace`), `fc-list :spacing=mono family` on Linux.
  CoreText is linked through `flint-native.pc` (CF-031).
- **Ideal:** `ext:webui` (or an `os:fonts` module) returning font families with a
  monospace flag.

### CF-046 · improvement · `answered, untested`: webui RPC handlers run on the UI thread
- **At `466751b`:** `bind_async` added. Flint keeps its workers and events: a session streams output and prompts for its whole life, which a single promise cannot carry.
- **Repro:** a `bind` handler that takes one second (Argon2id at 256 MiB, an SSH dial)
  freezes the window for that second: `handle_ipc_message` calls the handler inline
  from the WKWebView message callback.
- **Workaround:** the GUI driver spawns long work on an `async.scope` worker and
  answers through events (`src/drivers/gui/`). This works: `scope.spawn` from a
  handler and `app.emit` from the worker are both safe. Session workers then need
  their own mailbox for keystrokes and prompt answers (CF-026).
- **Ideal:** document the threading model, and offer `bind_async` that runs the
  handler on a pool and resolves the JS promise when it returns.

### CF-047 · bug · `resolved ✓`: `x or <value>` does not compile when `x` is `void!`
- **At `466751b`:** `void! or value` builds.
- **Repro:** `fn f() -> void! { }` then `_ := f() or false`. The lowering calls
  `value_or(false)` on `std::expected<void, cfire::Error>`, which has no `value_or`
  (cfire 0.9.4).
- **Workaround:** `r := f()` then branch on `r.has_value()`.
- **Ideal:** reject it with a cfire diagnostic, or lower `void! or _` to "ignore the
  error".

### CF-048 · bug · `resolved ✓`: `x = f() or err { … }` ignores the `or` block
- **At `466751b`:** `x = f() or err { … }` runs the block. Flint assigns in place again.
- **Repro:** `mut content := ""` then `content = fs.read_text(path) or err { return
  error("…") }`. The assignment lowers to `content = cfire::fs::read_text(path);` with
  no unwrap and no error branch, and clang rejects assigning a
  `std::expected<std::string, cfire::Error>` to a `std::string` (cfire 0.9.4). The
  declaration form `text := … or err { … }` works.
- **Workaround:** bind to a new name, then assign (`rpc_key_add` in
  `src/drivers/gui/rpc.cf`).
- **Ideal:** lower `or` the same way in assignments and declarations.

### CF-049 · bug · `resolved ✓`: `ext:json` skips struct fields without a `json` tag
- **At `466751b`:** untagged fields use their field name. Generating JSON code for every struct broke one that holds a `webui.App` (CF-066). Flint keeps its tags: they fix the wire names.
- **Repro:** `type P struct { alias: str }`, then `json.parse[P]("{\"alias\":\"web\"}")`
  gives `alias == ""`, and `json.stringify(P{ alias: "x" })` gives `{}` (cfire 0.9.4).
  No error either way, so a request decodes to zero values silently.
- **Workaround:** tag every field that crosses JSON (`HostPatch`, `CredPatch` in
  `src/application`, for the GUI's RPC requests).
- **Ideal:** default to the field name when there is no tag, as Go does, or reject the
  type at compile time.

### CF-050 · improvement · `reopened`: the headless WebView runner throttles timers
- **At `c5b1d4b` (Flint milestone 27, 2026-11-10):** `inactiveSchedulingPolicy` does not hold. `run_macos_webview_test` puts a borderless window at (-2000, -2000), orders it back and pumps `CFRunLoopRunInMode` by hand, so the page reports `document.hidden === true`. Its timers run normally for about a second; then, with no RPC or DOM event to wake it, WebKit suspends the page for good. **Repro:** in a `run_webview_test` page, `const t0 = Date.now(); while (Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 50));` never ends (a 1 s loop does); the same page under `app.run()` ends at 5.08 s with no gap over 69 ms. Measured in Flint: a wait that never comes true stopped the run until its cap in 10 runs of 10 offscreen, and failed at its own 20 s in 10 of 10 in the window. **Workaround:** on macOS Flint's e2e run uses `app.run()` (the real window, on screen) with its own cap (`run_e2e_cap`, `FLINT_GUI_E2E_VISIBLE`; D-068); the offscreen runner stays behind `FLINT_E2E_VISIBLE=0`. **Ideal:** `run_webview_test` keeps the page visible to WebKit: a window on screen (ordered front, perhaps fully transparent or minimal), the app's own `[NSApp run]` loop, or an option to pick that over offscreen; and a test in cfire that waits 5 s on timers alone.
- **At `466751b`:** `inactiveSchedulingPolicy` is set and App Nap is held off. Flint's e2e runner already waits on `MessageChannel` posts and was left as is.
- **Repro:** in `run_webview_test`, a page that waits with `setTimeout(…, 50)` in a
  loop slows to about one wake-up every several seconds after a while, because the
  window is never shown and WebKit throttles a hidden page's timers (and never runs
  `requestAnimationFrame`). A UI test that polls the DOM then looks hung.
- **Workaround:** `scripts/gui-e2e.js` waits on `MessageChannel` posts, which are not
  throttled.
- **Ideal:** `run_webview_test` sets `WKPreferences.inactiveSchedulingPolicy = .none`
  (macOS 14+) so the page runs as if visible.

### CF-051 · missing · `declined upstream`: a webui app on macOS has no menu bar
- **At `43431f2`:** **cfire's decision:** the standard macOS menu stays as is, with no opt-out (see CF-073). Flint sets its own menu after webui's.
- **At `466751b`:** webui installs a standard menu, but it puts Close Window on ⌘W, which Flint's page uses to close a tab, and replaces any menu set before `run()` (CF-073). Flint now sets its own menu after webui's.
- **Repro:** run any `ext:webui` app on macOS and press ⌘Q: nothing happens. ⌘C, ⌘V,
  ⌘X, ⌘A and ⌘Z do nothing in the page's text fields either. `App.run()` creates the
  `NSApplication` and the window but never sets `NSApp.mainMenu`, and AppKit delivers
  those keys to a `WKWebView` only through menu items (`terminate:`/`copy:`/`paste:`…).
- **Workaround:** `src/adapters/uievents/native/flint_gui.hpp` (`install_app_menu`)
  sets the standard app / Edit / Window menus before `app.run()`; Quit sends
  `performClose:` so webui's normal close path still runs.
- **Ideal:** webui installs the standard menus itself (app name from `new_app`), and
  takes an optional menu description so an app can add its own items and shortcuts.

### CF-052 · missing · `resolved ✓`: no app icon (or bundle id) for a GUI executable
- **At `466751b`:** `Icon` in `build.cf` puts the icon in the bundle. Flint dropped its `plutil` patch, and a rebuild keeps the icon. `BundleId` exists too; Flint keeps the current id for now.
- **Repro:** `build.Executable("Flint", { Subsystem: "gui", … })` on macOS writes
  `Flint.app/Contents/Info.plist` with no `CFBundleIconFile` and a fixed
  `CFBundleIdentifier` (`com.cfire.Flint`); `build.Executable` takes no icon or
  identifier. The Dock and ⌘Tab show a blank icon. On Linux webui's GTK window has no
  icon either.
- **Workaround:** `scripts/build-gui.sh` copies `assets/app-icon/Flint.icns` into
  `Resources/` and sets `CFBundleIconFile` with `plutil` before signing again.
- **Ideal:** `build.Executable` takes `Icon` (an SVG or PNG it renders per platform:
  `.icns` on macOS, the GTK window icon and a `.desktop` icon on Linux, an `.ico` on
  Windows) and `BundleId`.

### CF-053 · missing · `not adopted`: no clipboard API in `ext:webui` (or anywhere in cfire)
- **Reading too (milestone 25 on Linux, 2026-11-10):** WebKitGTK hands the page's paste
  event neither text nor image, and `navigator.clipboard.read()` is refused
  (`NotAllowedError`) because cfire's webview leaves `javascript-can-access-clipboard`
  off (it returns the image when that setting is on). So the core reads it:
  `flint_clip::read_paste` (`gtk_clipboard_wait_for_targets` / `_wait_for_text` /
  `_wait_for_contents("image/png")`, or `_wait_for_image` converted to PNG; NSPasteboard's
  `public.png` on macOS), behind the `Clipboard` port's `clipboard_read`. **Ideal** gains
  `clipboard_get_image() -> (mime, bytes)?`, or a webui option to turn that WebKit setting on.
- **At `43431f2`:** [read] The secret is no longer kept in the app's state map, Linux sets `x-kde-passwordManagerHint`, and the delayed clear runs on the GTK main loop. Still on Linux: the clear (`gtk_clipboard_set_text(cb, "", 0)`) checks only webui's own copy counter, so it also erases whatever another app copied in between. Flint keeps its adapter.
- **At `466751b`:** `app.clipboard_set_secret` works on macOS, but on Linux it sets no password-manager hint, calls GTK from a background thread to clear, and clears without checking that the clipboard still holds the secret. It also keeps the secret in the app's state map. Flint keeps its adapter.
- **Repro:** a desktop app that must put text on the system clipboard from the core,
  not from the page (Flint copies a saved password without sending it to the page,
  D-029), finds no clipboard call in `ext:webui` or `core:*` (cfire 0.9.4). The page's
  `navigator.clipboard` would need the value in JavaScript, and has no way to mark it
  concealed or clear it later.
- **Workaround:** `src/adapters/uievents/native/flint_clipboard.hpp`: NSPasteboard
  through the Objective-C runtime on macOS (`org.nspasteboard.ConcealedType`, cleared
  with `dispatch_after` when `changeCount` is unchanged), GTK 3 `gtk_clipboard_set_with_data`
  on Linux (with the `x-kde-passwordManagerHint` target). Linked through a separate
  pkg-config file, `flint-native-gui`, so the CLI does not load AppKit or GTK (CF-031).
- **Ideal:** `webui.App.clipboard_set(text, { concealed: true, clear_after_ms })` and
  `clipboard_get()`, run on the UI thread, for macOS, GTK and WebView2.

### CF-054 · bug · `declined upstream`: `fs.write_all` is documented as atomic but is not; `fs.rename` is undocumented
- **At `43431f2`:** [ran] `cfire inspect core:fs` no longer calls `write_all` atomic and lists `fs.rename`. **cfire's decision:** no `fs.write_atomic`.
- **At `466751b`:** not in the 466751b batch. Still: `write_all` is not atomic and there is no `fs.write_atomic`.
- **Repro:** `cfire stdlib core:fs` (cfire 0.9.4, also `cfire_stdlib_lookup`) says
  `write_all` "writes a byte slice atomically to disk". `runtime/core/fs.hpp` lowers
  `write_all` and `write_text` to the same `write_bytes`, which truncates and writes in
  place: a crash or a full disk mid-write leaves a truncated file. `fs.rename` exists in
  `fs.hpp` (and type-checks) but is missing from the stdlib reference, so the documented
  API has no way to write a file atomically.
- **Workaround:** none native. `src/adapters/config/atomic.cf` writes `<path>.tmp` with
  `fs.write_text`, then `fs.rename`s it over the target (`ui-state.json`, D-030).
- **Ideal:** document `fs.rename`, fix the `write_all` text, and add
  `fs.write_atomic(path, data)` (temp file in the same folder, fsync, rename).

### CF-055 · bug · `resolved ✓`: `str.bytes()` and `[]byte` are different C++ types
- **At `466751b`:** `str.bytes()`, `base64.decode` and `[]byte` are one type. Flint's copies are gone.
- **Repro:** `mut data: []byte = []; for b in "abc".bytes() { data.push(b) }` passes
  `cfire check`, then clang fails: `no known conversion from 'const std::byte' to
  'unsigned char'`. `str.bytes()` lowers to `std::span<const std::byte>`, `[]byte` to
  `std::vector<std::uint8_t>`. The same split breaks `sha256.hash_bytes(data)` with a
  `[]byte` argument (`no viable conversion … to std::span<const std::byte>`).
- **Also (M08):** `base64.decode` returns `std::vector<std::byte>`, which no `[]byte`
  parameter takes; `tether_b64` in `src/domain/tether.cf` copies it with `u8(b)`.
- **Workaround:** push `u8(b)` (`vault_id` in `src/application/session.cf`); the test
  fake of `Crypto.digest` does not call `sha256` (`src/application/fakes_test.cf`).
- **Ideal:** one byte type, or an implicit view between the two, checked by cfire, not
  by clang.

### CF-056 · bug · `resolved ✓`: a parse error in one file of a package is reported as C++ errors in the others
- **At `466751b`:** the parse error comes first (see CF-016).
- **At `2d8613d`:** the message says why: `'out' is a reserved parameter-intent keyword and cannot be used as a variable name`.
- **Repro:** name a local `out` (a reserved word: the `out` parameter intent) in one
  file of a package, then `cfire test <dir>`. The file is silently left out, and the
  output is clang's `unknown type name 'FakeCrypto'` / `use of undeclared identifier
  'SALT_LEN'` in the *other* files. The real message (`expected 'IDENT', got 'out'`)
  appears only from `cfire check <file>` (or `cfire_check` over MCP), buried among
  the cascade. Hit three times in milestone 07.
- **Workaround:** run `cfire check` on the edited file when a package fails this way.
- **Ideal:** stop at the parse error and print it first; and a message that says `out`
  is reserved (`'out' is a parameter intent and cannot name a variable`).

### CF-057 · bug · `resolved ✓`: `ext:json` ignores the `default:"…"` struct tag
- **At `43431f2`:** [ran] `json.parse` fills a missing field from its `default:` tag (`y=[dflt]`). Flint's settings use it for the fields added after a release (`term_theme`, `lock_after`).
- **At `466751b`:** not in the 466751b batch. Still reproduces (`y` is `""`).
- **Repro:** `type A struct { x: str \`json:"x"\`; y: str \`json:"y" default:"dflt"\` }`,
  then `json.parse[A]("{\"x\":\"1\"}")` succeeds with `a.y == ""` (cfire 0.9.4). The
  language rules (`cfire/INVALID-STRUCT-TAG`) validate `default:` tags at compile
  time, so the tag reads as supported; it only seems to apply to `cli` parsing.
- **Workaround:** a field added to a stored file reads as its zero value in older files,
  and the application layer repairs it: `load_settings` falls back field by field
  (`term_theme`, `src/application/settings.cf`); an empty recent-vault `id` means
  "unknown" (`src/application/session.cf`).
- **Ideal:** `json.parse` fills a missing field from its `default:` tag, or the checker
  warns that `default:` has no effect outside `cli` structs.

### CF-058 · bug · `resolved ✓`: `cfire build <target>` builds every target
- **At `43431f2`:** [ran] In Flint, `cfire build Flint` builds the CLI only, `cfire build FlintGui` the app only, and `cfire build Nope` says `executable 'Nope' not found in …/build.cf`.
- **At `466751b`:** not in the 466751b batch. `cfire build Flint` still builds both targets. It no longer costs Flint the icon (CF-052).
- **Repro:** with two executables in `build.cf` (`Flint` → `build/flint`, `FlintGui` →
  `build/gui/Flint.app`), `cfire build Flint` prints both `✓ Built Native Binary` and
  `✓ Built Native App` (cfire 0.9.4). Rebuilding the app bundle rewrites its fixed
  `Info.plist`, so the icon key `scripts/build-gui.sh` adds (CF-052) is gone: the owner's
  install command (`build-gui.sh && cfire build Flint && ditto …`) installed an app with
  no icon.
- **Workaround:** build the CLI first, then `scripts/build-gui.sh` last
  (`cfire build && scripts/build-gui.sh`), so the bundle is patched after cfire writes it.
- **Ideal:** `cfire build <name>` builds only that target (and says so when the name
  matches none).

### CF-059 · bug · `resolved ✓`: `s.find(x)` on a `str` compiles to `std::string::find` and returns `npos`
- **At `43431f2`:** [ran] `s.find(";")` is a compile error: `unknown str method 'find'; use 'index_of' instead (returns i64 index or -1) (cfire/UNKNOWN-METHOD)`. **cfire's decision:** no `find` alias.
- **At `466751b`:** not in the 466751b batch. Still prints `found at 18446744073709551615`. The checker now treats `str.find` as optional (CF-063), but the runtime still returns `npos`.
- **Repro:** `s := "abc"; i := s.find(";"); if i < 0 { … } else { println("found at {i}") }`
  prints `found at 18446744073709551615` (cfire 0.9.4). `find` is not in the `str`
  method set the docs list (`str.index_of` is, returning `-1`), but the call passes
  through to C++ unchecked, and `i < 0` on the unsigned result is silently always
  false. Found writing the OSC 52 parser (milestone 08): a missing `;` read as found.
- **Workaround:** `str.index_of(s, x)` and `s.contains(x)` (`src/application/terminal.cf`).
- **Ideal:** an unknown method on `str` is a compile error, or `find` returns `i64`
  with `-1` like `index_of`. A comparison of an unsigned value with `< 0` warns.

### CF-060 · bug · `resolved ✓`: a `str` slice passes to no `str` parameter, and cannot be interpolated
- **At `43431f2`:** [ran] `println("{a[0..5]}")`, `"{addr[0..usize(colon)]}"` and `"x ({error_text_of("{e}")})"` all print what they should. Passing a slice to a `str` parameter is a cfire error with a fix-it (`change parameter type to '&str' or convert explicitly with 'str(...)'`). **cfire's decision:** the slice stays a view; no implicit copy. Flint writes `str(addr[0..usize(colon)])` (`src/domain/tether.cf`).
- **At `466751b`:** not in the 466751b batch. Both repros still fail in clang.
- **Repro (cfire 0.9.4):** `fn shout(s: str) -> str { … }` then `shout(a[0..5])` fails in
  clang (`no matching function for call to 'shout'`: the slice is a `std::string_view`,
  the parameter a `const std::string&`). `println("{a[0..5]}")` fails too
  (`basic_format_string … not a constant expression`); inside a `str` field built from
  it (`mut h := "{a[0..5]}"` assigned to a struct) the text is kept literally when the
  slice bounds hold a cast (`"{addr[0..usize(colon)]}"` came out as that literal).
  Default parameters are documented as read-only borrows, so a view reads as fine.
  An interpolation holding a call with a quoted, interpolated argument
  (`"x ({error_text_of(\"{e.message()}\")})"`) is also printed literally, braces and all.
- **Workaround:** bind the slice first, then copy it by interpolation:
  `head := addr[0..usize(colon)]; host := "{head}"` (`src/domain/tether.cf`).
- **Ideal:** a `str` slice converts to `str` where one is expected (or `str` borrows
  lower to `std::string_view`), and interpolation takes any expression.

### CF-061 · bug · `resolved ✓`: `x := f() or []` builds with libc++ but not libstdc++
- **At `466751b`:** same fix as CF-040.
- **Repro (cfire 0.9.4):** `sealed := crypto.seal(k, data, []) or []` where `seal`
  returns `[]byte!` lowers to `….value_or({})`. Apple clang with libc++ accepts it; on
  Linux (clang with libstdc++ 14) it fails: `no matching member function for call to
  'value_or'` (`couldn't infer template argument '_Up'`). `cfire check` passes on both,
  so the break only shows in the Linux run.
- **Workaround:** test `has_value()` and take `.value()` (`tseal` in
  `src/application/tether_test.cf`).
- **Ideal:** emit the default with its type (`value_or(std::vector<std::uint8_t>{})`).
---

The entries below were found moving Flint to cfire `466751b` (milestone 09, 2026-11-06).

### CF-062 · bug · `resolved ✓`: `[]byte` changed C++ type with no diagnostic from cfire
- **At `43431f2`:** [ran] `msg: []byte = [7, 7]` and `buf[0] = x` (a `u8`) are cfire errors: `cannot use integer/u8 value in '[]byte' literal without explicit 'byte(...)' conversion (cfire/TYPE-MISMATCH)`. The assignment's diagnostic points at column 1 of the line.
- **Repro (466751b):** `msg: []byte = [7, 7]` and `buf[i] = u8(x)` passed `cfire check` and
  built at `3963814`; now clang fails (`no matching constructor for initialization of
  'std::vector<std::byte>'`, `assigning to 'std::byte' from incompatible type
  'std::uint8_t'`). `cfire check` still passes, so the break shows only in clang.
- **Context:** the change itself is the fix for CF-021/CF-055 and is welcome. Flint migrated
  ~40 sites: `byte(n)` literals, `[]byte("text")`, `str(bytes)`, and `cfire::c_arg(v.data())`
  to hand a `[]byte` to a C API taking `unsigned char*`.
- **Ideal:** `cfire check` reports an integer literal or a `u8` stored into `[]byte` with a
  fix-it (`byte(...)`), and the changelog says `[]byte` now lowers to `std::byte`.

### CF-063 · bug · `resolved ✓`: the checker takes `os.getenv` for an optional (false `NULL-DEREF`)
- **At `43431f2`:** [ran] `override := os.getenv("X")` then `.len()` builds. Flint dropped its 8 type annotations.
- **Repro (466751b):** `override := os.getenv("X")` then `if override.len() > 0 { … }` →
  `member access on potentially null pointer 'override' without '!= none' guard
  (cfire/NULL-DEREF)`. `os.getenv` returns `str` (`runtime/core/os.hpp`), but
  `expr_returns_optional_sema` (`src/sema.hpp`) lists `getenv` by name as optional. The
  same list marks `str.find` optional, while it still returns `npos` at run time (CF-059).
- **Workaround:** annotate the binding: `override: str = os.getenv("X")` (5 files).
- **Ideal:** derive optionality from the declared signature, not from a list of names.

### CF-064 · bug · `resolved ✓`: `os.getpid()` no longer compiles
- **At `43431f2`:** [ran] `os.getpid()` returns the pid. Flint's tests use it for unique names again.
- **Repro (466751b):** `"{os.getpid()}"` → clang `no member named 'getpid' in namespace
  'cfire::os'`. At `3963814` the call passed through to `::getpid()`. `core:os` never
  documented it, but nothing in cfire rejects it either.
- **Workaround:** a random tag (`hex.encode(rand.bytes(4))`) for unique test names.
- **Ideal:** `os.getpid() -> i64`, or a cfire diagnostic for an unknown `os.` member.

### CF-065 · bug · `declined upstream`: a struct field named `stdout` is renamed, but not inside `cpp {}`
- **At `43431f2`:** **cfire's decision:** `cpp {}` blocks stay verbatim C++. Flint keeps filling locals in the block.
- **Repro (466751b):** `type ExecChunk struct { stdout: str }`, then
  `cpp { read(chunk.stdout); }` → clang `no member named '__stdoutp' in 'ExecChunk'`.
  The CF-038 fix emits the field as `stdout_cf_`; the text of a `cpp {}` block is left as
  written, so it names a field that no longer exists.
- **Workaround:** the block fills locals and the struct is built in cfire
  (`link_channel_read` in `src/adapters/ssh/link.cf`).
- **Ideal:** rename identifiers inside `cpp {}` too, or report the mismatch in `cfire check`.

### CF-066 · bug · `resolved ✓`: every struct gets JSON code, including ones that hold a `webui.App`
- **At `43431f2`:** [ran] A struct holding a `webui.App` builds with no tag. Flint dropped its three `json:"-"`.
- **Repro (466751b):** `type Sink struct { app: webui.App }` in a program that imports
  `ext:webui` → clang `the supplied type is not formattable` from the generated
  `stringify_struct<Sink>`. The CF-049 fix registers all structs for JSON, even those that
  are never serialised and hold non-serialisable types.
- **Workaround:** tag the field `` `json:"-"` `` (`src/adapters/uievents/`).
- **Ideal:** generate JSON code only for structs that reach `json.*` or an RPC, or skip
  fields whose type has no JSON form.

### CF-067 · bug · `resolved ✓`: `xs.push([a, b])` no longer compiles
- **At `43431f2`:** [ran] `rows.push(["a", "b"])` builds. Flint pushes row literals directly. A nested literal with no declared type is a separate gap: **CF-091**.
- **Repro (466751b):** `mut rows: [][]str = []` then `rows.push(["a", "b"])` → clang
  `no matching function for call to 'vec_push'`. `push` now lowers to the template
  `cfire::vec_push(vec, U&& val)`, which cannot deduce a braced list.
- **Workaround:** `row: []str = ["a", "b"]; rows.push(row)` (`src/drivers/clicmd/output.cf`).
- **Ideal:** lower the literal with the element type (`std::vector<std::string>{…}`), as
  the CF-040 fix does for `or []`.

### CF-068 · bug · `resolved ✓`: errors in one file of a package are reported against the test file
- **At `43431f2`:** [ran] A clang error in `a.cf` while running `cfire test` on its package is reported as `a.cf:4:16`, not against the test file.
- **Repro (466751b):** a compile error at `src/adapters/ssh/link.cf:188` while running
  `cfire test src/drivers/cli` is printed as `src/drivers/cli/import_test.cf:188:68`. The
  line is right, the file is the test file being run. Found throughout the migration.
- **Ideal:** keep each source file's name in the `#line` directives of the merged unit.

### CF-069 · bug · `resolved ✓`: **`sqlite.open_encrypted` writes a plaintext database**
- **At `43431f2`:** [ran] With SQLCipher present the file is encrypted (see CF-007). [read] Without it, `open_encrypted` returns `sqlite.open_encrypted requires SQLCipher …` instead of writing plaintext; not run, since this Mac has SQLCipher.
- **Repro (466751b):** `sqlite.open_encrypted("/tmp/x.db", "pw")`, create a table, insert
  `"TOP-SECRET-PAYLOAD"` → succeeds; the file starts with `SQLite format 3` and the value is
  readable with `grep`. `ext:db/sqlite` links the system `sqlite3`, which ignores
  `PRAGMA key` silently. The response to CF-007 says the build detects SQLCipher and sets
  `-DSQLITE_HAS_CODEC`; that code is not in `src/buildsys.hpp`.
- **Ideal:** link SQLCipher whenever `open_encrypted` is used, and fail (at build time, or
  at open with `PRAGMA cipher_version` empty) when it is not available. Never fall back to
  plaintext.
- **Flint:** unaffected (its own SQLCipher adapter, CF-007).

### CF-070 · bug · `resolved ✓`: `ext:crypto/sodium` falls back to other algorithms without libsodium
- **At `43431f2`:** [read] Without libsodium, `ext:crypto/sodium` stops at `#error "ext:crypto/sodium requires libsodium …"`; the fallback code is gone. Not run without libsodium. A new, smaller problem in the same module: **CF-090**.
- **Source (466751b):** `runtime/core/sodium.hpp`. Without `CFIRE_SODIUM_NATIVE`,
  `sodium.argon2id` returns PBKDF2-SHA256 of a modified salt (not Argon2id, not
  memory-hard, a different output), and `xchacha20poly1305_*` use a hand-written
  ChaCha20/Poly1305. The caller cannot tell which one ran.
- **Why it matters:** a vault sealed on a machine without libsodium cannot be opened on
  one with it, and is weaker than its code says.
- **Ideal:** no fallback: a build error when libsodium is missing.
- **Flint:** unaffected (its own libsodium adapter, CF-006; Principle 4 forbids
  hand-rolled cryptography).

### CF-071 · bug · `resolved ✓`: `ext:keychain` does not persist on Linux and leaks the secret
- **At `43431f2`:** [ran, macOS; read, Linux] See CF-008: errors are returned, `get` reads the Secret Service, the secret goes through stdin, and the in-memory store is compiled only into test builds.
- **Source (466751b):** `runtime/core/keychain.hpp`.
  - Linux `get` never asks the Secret Service: it reads only an in-process map, so after a
    restart every lookup is "not found".
  - Linux `set` runs `printf '%s' '<secret>' | secret-tool store …` through `std::system`:
    the secret is visible in the process list, and a `'` in it breaks the command (shell
    injection). The exit status is ignored, and nothing is stored without
    `DBUS_SESSION_BUS_ADDRESS`, still returning success.
  - macOS `set` ignores the `SecItemAdd` status, so a refused write reports success.
  - Every secret is also kept in a process-global plaintext map for the life of the process.
  - `CFIRE_HEADLESS_TEST=1` in the environment silently switches a production binary to the
    in-memory store (the same switch turns `ext:net/ssh` into its mock server).
- **Ideal:** libsecret's C API (`secret_password_store_sync`/`lookup_sync`), errors
  returned, `[]byte` secrets, no in-memory copy, and test mode chosen at build time.
- **Flint:** unaffected (its own adapter, CF-008).

### CF-072 · bug · `partly resolved`: reinstalling over an existing binary on macOS kills it; the installer cannot pin a build
- **At `43431f2`:** [ran] Reinstalling over the existing `~/.local/bin/cfire` on macOS works (temp file + `mv -f`), `CFIRE_VERSION` takes a commit, and the SHA reaches `--version`. Still: the installer copies the new runtime over `~/.cfire/runtime` without clearing it, so headers removed upstream stay behind (Flint's docs say to delete the folder first); and `make install` is broken: **CF-086**.
- **Repro:** `cp new/cfire ~/.local/bin/cfire` over the existing file (what `install.sh`
  does), then `cfire --version` → killed with SIGKILL (exit 137). macOS caches the code
  signature per file; `rm` before `cp` (a new file) works.
- **Also:** `install.sh` builds a GitHub tarball (no `.git`), so the CF-011 SHA is `dev`;
  and `CFIRE_VERSION` only takes a branch (`refs/heads/…`), so a commit or tag cannot be
  installed.
- **Ideal:** install to a temp name and `mv` it into place; accept a commit or tag; pass
  the SHA to `make` (`GIT_SHA=…`); publish tagged releases.

### CF-073 · bug · `declined upstream`: webui's built-in macOS menu takes ⌘W from the page, with no opt-out
- **At `43431f2`:** **cfire's decision:** the standard macOS menu, ⌘W included, stays with no opt-out. Flint keeps installing its own menu after `run()`.
- **Repro (466751b):** `App.run()` now always sets `NSApp.mainMenu` (the CF-051 fix), with
  Window → Close Window on ⌘W and Quit on a handler of its own. An app whose page uses ⌘W
  (Flint closes a terminal tab with it) gets the window closed instead. A menu the app
  set before `run()`, as Flint did for CF-051, is replaced.
- **Workaround:** Flint queues its own menu on the main queue before `run()`, so it is set
  after webui's and replaces it (`install_app_menu` in
  `src/adapters/uievents/native/flint_gui.hpp`).
- **Ideal:** a way to turn the built-in menu off, or to declare which shortcuts the page
  owns; Quit through the same close path as the window's close button.

### CF-074 · bug · `partly resolved`: `cfire ide claude` writes LSP files Claude Code never loads
- **At `43431f2`:** [ran] The cfire repository ships a marketplace with one LSP-only plugin (`claude plugin validate` passes, one warning: the README has no install line), and every file now says `cfire`, not an absolute path; `.mcp.json` is unchanged in shape and MCP is no longer in `plugin.json`. Still: `cfire ide claude` writes `.lsp.json`, `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` into the project, where Claude Code does not read them; it does not run or print the marketplace install commands; and `cfire ide --status` reports Claude Code `[configured]` from the environment, without checking that the plugin is installed. [ran, 2026-11-07] Installed the way the plugin is meant to be (`/plugin marketplace add gsandoval/cfire`, `/plugin install cfire@cfire`), the LSP starts in Claude Code on Flint: go-to-definition on `host_target` in `src/drivers/clicmd/output.cf:165` lands on its declaration at line 127. So the marketplace is the working path; what is left is `cfire ide claude` itself.
- **At `2d8613d`:** the commit answers the review's E7 by writing `.lsp.json` and
  `.claude-plugin/plugin.json` into the project. `cfire lsp` itself works well on Flint:
  go-to-definition across files (`src/drivers/gui/main.cf` → `rpc.cf:240`), references
  and hover (with the signature and the lowered C++). Only the Claude Code wiring is wrong.
- **Repro:** in an empty git repo, `cfire ide claude`. It reports
  `Claude Code (.mcp.json + .lsp.json + .claude-plugin/plugin.json + .claude/rules/cfire.md)`.
  Then `claude plugin list` in that folder (Claude Code 2.1.319) lists only the LSP
  plugins installed at user scope (`clangd-lsp`, `gopls-lsp`, `swift-lsp`); `cfire` is
  not among them, and no `cfire` LSP starts. `claude plugin validate .` accepts the
  manifest (one warning: no `author`), so the files are well formed; they are just never
  read.
- **Why:** Claude Code reads `.lsp.json` and `lspServers` only from a **plugin's** root,
  and a plugin loads only when it is installed from a marketplace (`/plugin marketplace
  add …`, then `/plugin install <name>@<marketplace>`) or passed with
  `claude --plugin-dir <path>` for one session. A `.claude-plugin/plugin.json` at the root
  of the project being edited is not picked up
  ([plugins reference](https://code.claude.com/docs/en/plugins-reference)).
  This is how the official LSP plugins work: `gopls-lsp@claude-plugins-official` is a
  plugin with an `lspServers` entry and nothing else.
- **Side effects of the current output:**
  - `.mcp.json` now holds the absolute path of the binary
    (`/Users/<user>/.local/bin/cfire`) where it used to hold `cfire`. The file is usually
    committed, so it breaks for every other contributor and for CI. Same in
    `.lsp.json`, `plugin.json` and the rules file (`powered by /Users/<user>/… mcp`).
  - `plugin.json` declares the `cfire` MCP server again. If the plugin were loaded, the
    session would get two `cfire` MCP servers.
  - `cfire ide --status` counts Claude Code as configured once `.mcp.json` and `.lsp.json`
    exist, and the rules file tells agents to "prefer LSP semantic lookups over raw text
    `grep`", so an agent is sent to an LSP that is not there.
- **Workaround:** none in Flint, on purpose. Flint keeps its `.mcp.json` (bare `cfire`)
  and its rules file as they are, and waits for this entry rather than patching it
  locally.
- **Ideal:** ship cfire's LSP to Claude Code the way the official LSP plugins are shipped:
  1. A marketplace in the cfire repo (`.claude-plugin/marketplace.json`) with one plugin,
     e.g. `cfire-lsp`, whose `plugin.json` has only `lspServers`:
     `{"cfire": {"command": "cfire", "args": ["lsp"], "extensionToLanguage": {".cf": "cfire"}}}`.
     The bare `cfire` resolves through `PATH`, so nothing machine-specific is written.
  2. Install it once per machine: `/plugin marketplace add gsandoval/cfire` and
     `/plugin install cfire-lsp@cfire` (or `claude plugin install … --scope user`). One
     install covers every cfire project.
  3. `cfire ide claude` runs or prints those two commands instead of writing `.lsp.json`
     and `.claude-plugin/`; for a team repo it can add the marketplace to
     `.claude/settings.json` (`extraKnownMarketplaces` + `enabledPlugins`) so collaborators
     are offered it.
  4. Keep `.mcp.json` for MCP (with a bare `cfire`), and leave MCP out of the plugin.
  5. `cfire ide --status` checks `claude plugin list` for the plugin, not files on disk.

### CF-075 · bug · `resolved ✓`: the runtime's system simdjson does not compile on Ubuntu 24.04 with clang 19
- **At `43431f2`:** [read] `cfire build` and `cfire doctor` now name the problem (`system simdjson 3.x is incompatible with Clang 19 …`) and look in `~/.local` first. The check also refuses versions that build: **CF-087**.
- **At `2d8613d`:** every `cfire build` links `-lsimdjson` and includes the system
  `simdjson.h`. Ubuntu 24.04 (and Zorin OS 18, built on it) ships simdjson **3.6.4**; with
  its `clang-19` package, any program fails in the header:
  `/usr/include/simdjson.h:6226:13: error: no member named 'print_newline' in
  'base_formatter<formatter>'` (also `print_indents`, `print_space`). Homebrew (4.6.x) and
  Debian trixie are fine.
- **Repro:** Zorin OS 18.1, `apt install libsimdjson-dev clang-19`, cfire `2d8613d` built with
  `clang++-19`; `cfire build` in Flint (or any project that uses `json`).
- **Workaround (Flint's Zorin box):** simdjson 4.6.6's single-header release built as a
  static library in `~/.local` (`clang++-19 -O2 -std=c++17 -c simdjson.cpp`, `ar rcs
  libsimdjson.a`), found through `CPLUS_INCLUDE_PATH=~/.local/include` and
  `LIBRARY_PATH=~/.local/lib`. Documented in Flint's *Build from source*.
- **Ideal:** vendor simdjson in `runtime/vendor` (it is one header and one source file),
  or state and check a minimum version with a clear error.

### CF-076 · bug · `resolved ✓`: a failed clang AST ingestion prints the whole AST as JSON
- **At `43431f2`:** [ran] A header calling an undeclared function prints clang's diagnostic only (5 lines, 653 bytes).
- **At `2d8613d`:** when ingesting an `import cpp` header fails, the error message is
  followed by the AST dump: 11.7 million lines for `flint_ssh.hpp`, so the one useful line
  (`error: use of undeclared identifier 'ssh_channel_get_exit_state'`) is lost unless the
  log is searched for `error:`.
- **Repro:** a header that calls a function the installed library lacks (Flint against
  libssh 0.10), then `cfire build`.
- **Ideal:** print clang's diagnostics only; keep the dump behind a verbose flag.

### CF-077 · gap · `partly resolved`: `ext:webui` file dialogs are macOS-only and silently return "" on Linux
- **At `43431f2`:** [read] `open_file_dialog`, `save_file_dialog` and `message_dialog` use `GtkFileChooserDialog` / `GtkMessageDialog` on Linux and Win32 dialogs on Windows. Still: the GTK dialogs have no parent window (`nullptr`), so they are not modal to the app's window and can open behind it; and every platform still returns `""` both for "cancelled" and for "no dialog here". Flint keeps its adapter, modal over the active window.
- **At `2d8613d`:** `open_file_dialog`, `save_file_dialog` and `message_dialog`
  (`runtime/core/webui.hpp`) have an `NSOpenPanel`/`NSSavePanel`/`NSAlert` body under
  `__APPLE__`; every other platform returns `""` (or nothing) without showing a window.
  The caller cannot tell "not supported" from "cancelled".
- **Repro:** on Zorin OS 18 (GTK 3, WebKitGTK 4.1), Flint's *Create a vault* → **Choose…**:
  nothing opens. Docker/Xvfb runs never hit it, since gui-e2e types the path.
- **Workaround:** `src/adapters/uievents/native/flint_dialog.hpp` runs a modal
  `GtkFileChooserDialog` over the active window on Linux; the GUI driver uses it there and
  keeps webui's panels on macOS.
- **Ideal:** GTK 3 file choosers and a `GtkMessageDialog` in webui on Linux (Windows:
  `IFileDialog`), and an error for "no dialog on this platform" instead of `""`.

### CF-078 · missing · `resolved ✓`: a struct field default cannot be a negative literal
- **At `43431f2`:** [ran] `a: i32 = -1` and `b: f64 = -2.5` are accepted as field defaults. `SshConn.sock` defaults to -1 and its `owns_sock` flag is gone.
- **At `2d8613d`:** `type C struct { a: i32 = 7 }` parses; `a: i32 = -1` fails with
  `unexpected token '-' in expression`.
- **Repro:** `cfire check` on `type C struct { a: i32 = -1 }`.
- **Workaround:** `SshConn` (`src/adapters/ssh/libssh.cf`) marks the socket it owns with
  a `bool` (zero-initialised to `false`) next to the descriptor, since a zero-initialised
  `i32` is fd 0, not "no socket".
- **Ideal:** any constant expression as a field default, `-1` included.

### CF-079 · missing · `declined upstream`: no `if` expression
- **At `43431f2`:** **cfire's decision:** `if` stays a statement; `match` is the expression form.
- **At `2d8613d`:** `x := if c { a } else { b }` fails with `unexpected token 'if' in
  expression`.
- **Repro:** `cfire check` on `fn f(c: bool) -> i32 { x := if c { 1 } else { 2 }; return x }`.
- **Workaround:** a `mut` local assigned in an `if` statement (`ssh_dial_over`).
- **Ideal:** `if` as an expression, or a ternary.

### CF-080 · bug · `resolved ✓`: the test runner's descriptor-leak check flags the system resolver
- **At `43431f2`:** [ran] A test that resolves `localhost` through `import cpp` passes. It passes because the canary no longer runs for any package with an `import cpp` (**CF-089**), not because of a warm-up.
- **At `2d8613d`:** every `test` block fails with `resource leak canary (test leaked 2
  open file descriptor(s))` when it is the first code in the process to resolve a name
  on macOS. `getaddrinfo("localhost")` opens two sockets to mDNSResponder and keeps them
  for the life of the process (a plain C++ program shows 3 → 5 descriptors after the
  first lookup, 5 after the second). They are not the test's to close.
- **Repro:** a `test` block that calls `getaddrinfo("localhost", …)` (through
  `import cpp`) and frees the result.
- **Workaround:** the SSH adapter's tests dial numeric addresses
  (`src/adapters/ssh/libssh_test.cf`); `scripts/cli-e2e.sh` dials `localhost` in a
  separate process.
- **Also GLib's D-Bus connections (M11b, Linux):** a test that subscribes to a
  screensaver signal on a private session bus passes its assertions and fails the canary
  with 4 leaked descriptors (`g_bus_get_sync` keeps the system and session connections
  and GLib's worker wakeups for the life of the process). The check moved to
  `scripts/serve-e2e.sh`, against the running app.
- **Ideal:** take the descriptor baseline after a warm-up of process-lifetime system
  handles (resolver, keychain), or let a test opt out of the check with a reason.

### CF-081 · missing · `deferred upstream`: no Unix domain socket listener and no peer credentials
- **At `43431f2`:** **Deferred by cfire** (P3): `net.listen_unix`, `net.connect_unix` and `conn.peer()`. Flint keeps `flint_ipc.hpp`.
- **At `2d8613d`:** `ext:net` offers TCP only (`listen_tcp`, `connect_tcp`); `AF_UNIX` appears
  only as a `socketpair` fallback inside sandboxes. Nothing binds or connects a path, sets
  its mode, or reports who is on the other end (`SO_PEERCRED` on Linux, `getpeereid` and
  `LOCAL_PEERPID` on macOS). `core:os` has `socketpair` and `poll_fd`, not `bind`/`accept`.
- **Repro:** `cfire_stdlib_lookup ext:net`; no `listen_unix`, no `peer_uid`.
- **Why Flint needs it:** the app serves the unlocked vault to the CLI over a socket that
  only the same user may use (D-038, Principle 11). A loopback TCP port is reachable by
  every user on the machine and tells the server nothing about the caller.
- **Workaround:** `src/adapters/ipc/native/flint_ipc.hpp` (listen with mode 0600, clear a
  stale socket, never remove a non-socket file, accept with a deadline, peer uid and pid
  from the kernel, 4-byte length-prefixed frames under a deadline, no `SIGPIPE`), wrapped
  by `src/adapters/ipc/ipc.cf`.
- **Ideal:** `net.listen_unix(path, mode = 0o600) -> UnixListener!`,
  `net.connect_unix(path, timeout_ms) -> UnixConn!`, and `conn.peer() -> Peer{uid, gid,
  pid}!` on both; a named pipe with the caller's SID on Windows under the same API.

### CF-082 · missing · `partly resolved`: no tray / menu bar icon in `ext:webui`
- **Used in milestone 14** [ran on macOS]: `set_tray`, `add_tray_item`, `set_hide_on_close`
  and `show_window` drive Flint's menu bar icon (`src/drivers/gui/window.cf`), with no
  native code; the close button sends `window:close_requested` to `app.on`. What is left:
  (1) Linux still gets a `GtkStatusIcon` (below), so Flint also shows its window when
  launched a second time; (2) tray items are fixed at start, with no way to change a title
  or disable an item (a "Lock Vault" with no vault unlocked); (3) a window hidden by the
  close button is not shown again by a Dock click (CF-097).
- **At `43431f2`:** [read] `set_tray`, `add_tray_item`, `hide_window`, `show_window` and `set_hide_on_close` exist. macOS uses `NSStatusItem`. Linux uses `GtkStatusIcon`, deprecated since GTK 3.14: it is an XEmbed tray icon, which Wayland sessions do not show and GNOME shows only with an extension (Zorin's desktop is GNOME). An AppIndicator / `StatusNotifierItem` is what Linux desktops show today. To settle at milestone 14's plan.
- **At `2d8613d`:** `ext:webui` has an app menu (`add_menu_item`) and a window icon
  (`set_icon`), but no status item: nothing like `NSStatusItem` on macOS or an
  AppIndicator / `StatusNotifierItem` on Linux, and no way to close the window while the
  app keeps running.
- **Repro:** `cfire_stdlib_lookup tray` → no match; `cfire_stdlib_lookup ext:webui` lists
  no status item or "hide window" call.
- **Why Flint needs it:** milestone 14 keeps Flint in the menu bar with the window closed
  and locked while it serves approved grants (D-038).
- **Workaround:** none yet; to be decided at milestone 14's plan (a native adapter, or a
  cfire change).
- **Ideal:** `app.tray(icon_path, tooltip)` with `tray.add_item(title, event)`,
  `app.hide_window()` / `app.show_window()`, and an option for the window's close button
  to hide instead of quit.

### CF-083 · missing · `resolved ✓`: a task cannot spawn into the scope it runs in
- **At `43431f2`:** [ran] A task that spawns into its own scope compiles and `with_scope` joins both (`sum=3`). Flint has not used it yet: the socket server's fixed acceptors (`SERVE_ACCEPTORS`) are for milestone 12's plan.
- **At `2d8613d`:** inside `async.scope(workers: N) |scope| { scope.spawn || { … } }`, a
  closure given to `scope.spawn` that calls `scope.spawn` again does not compile: the
  capture copies `cfire::async::Scope`, whose `std::vector<std::future<void>>` member has
  no copy constructor (`no matching function for call to '__construct_at'`, "in implicit
  copy constructor for 'cfire::async::Scope'").
- **Repro:** `async.scope(workers: 4) |scope| { scope.spawn || { scope.spawn || {} } }`.
- **Why Flint needs it:** the app's socket server accepts on one task and would answer
  each client on a task of its own.
- **Workaround:** the accept loop answers one client at a time on its own task
  (`src/drivers/gui/main.cf`, `serve.cf`); commands on one vault run one at a time
  anyway (the vault holder's lock), and the CLI asks every secret before it connects,
  so no client holds the loop while a person types. **From M11b** a `flint connect`
  holds its connection for hours, so the app starts several accept loops on the same
  listener (`SERVE_ACCEPTORS`), each answering one client at a time: that many clients
  at once, a fixed number of workers taken for good.
- **Ideal:** capture the scope by reference (it outlives every task it joins), or a
  `scope.handle()` that tasks can spawn through.

### CF-084 · missing · `declined upstream`: no way to hear screen lock, sleep or idle from the OS
- **At `43431f2`:** **cfire's decision:** screen lock, sleep and wake are application-specific native concerns. Flint keeps `flint_sysevents.hpp`.
- **At `2d8613d`:** neither `core:os` nor `ext:webui` reports that the screen locked, that
  the computer is going to sleep, or that the user is idle. `os.on_signal` covers POSIX
  signals only; the webview's run loop is not reachable from cfire.
- **Repro:** `cfire_stdlib_lookup ext:webui`, `core:os`: no `on_screen_lock`, `on_sleep`,
  `idle_seconds`.
- **Why Flint needs it:** the vault auto-locks on screen lock and on sleep (spec v3,
  milestone 11b, D-042).
- **Workaround:** `src/adapters/uievents/native/flint_sysevents.hpp`: on macOS the
  distributed notification `com.apple.screenIsLocked` and `IORegisterForSystemPower`
  (linked through `flint-native-gui.pc`, CF-031); on Linux logind's `Session.Lock` and
  `Manager.PrepareForSleep` and the screensavers' `ActiveChanged` over GIO. The callbacks
  only bump counters that a cfire timer reads, so no native callback calls into cfire.
  Idle time is Flint's own (page activity and socket requests), not the OS's.
- **Ideal:** `webui.App.on_system(fn(event: SystemEvent))` with `ScreenLocked`,
  `WillSleep`, `Woke`, delivered on the UI thread like other webui events.

### CF-085 · bug · `partly resolved`: `shared[T]` cannot be built or used from cfire
- **At `43431f2`:** [ran] Field reads and method calls through a `shared[T]` field (`self.link.bump()`, `t.link.n`) and on a `shared[T]` local (`s.bump()`, `s.n`) work. `shared(v)` is a cfire error with a fix-it to `make[shared[T]](v)` (**cfire's decision**: one constructor). Still: a local copied from a field loses the deref: `other := t.link` then `other.n` → clang `no member named 'n' in 'std::shared_ptr<L>'`.
- **At `2d8613d`:** `shared(L{ n: 1 })` → `use of undeclared identifier 'shared'`; a method
  call through a `shared[L]` field (`self.link.bump()`) → `no matching function for call
  to 'cfire_method_bump'` (`std::shared_ptr<L>` → `L&`); a field read (`self.link.n`) →
  `no member named 'n' in 'std::shared_ptr<L>'; did you mean to use '->'`.
- **Repro:** `type L struct { n: i64 }` / `fn (mut self: L) bump() { self.n = self.n + 1 }`
  / `type T struct { link: shared[L] }` / `fn (mut self: T) go() { self.link.bump() }`.
- **Why Flint needs it:** the socket relay's terminal, prompter and output ports would
  share one connection state (M11b).
- **Workaround:** each port holds its own copy of the state (`src/adapters/ipc/relay.cf`);
  the copies share only the descriptor, which is enough because prompts end before the
  shell starts.
- **Ideal:** a constructor (`shared(v)` or `make_shared[T](v)`) and auto-deref of a
  `shared[T]` for field access and method calls, as for `own[T]`.

---

The entries below were found moving Flint to cfire `43431f2` (milestone 11c, 2026-11-07).

### CF-086 · bug · `confirmed`: `make install` fails: its temp file name changes between recipe lines
- **At `c5b1d4b`:** [read] Unchanged: the `install` recipe still names its temp file `.cfire.tmp.$$$$` on three recipe lines, each its own shell. The Linux image still installs by hand.
- **Repro (43431f2):** `make install PREFIX=/usr/local CXX=clang++` (Debian trixie, in
  Flint's Linux image) →
  `cp cfire /usr/local/bin/.cfire.tmp.$$` then `chmod: cannot access
  '/usr/local/bin/.cfire.tmp.33': No such file or directory`,
  `make: *** [Makefile:30: install] Error 1`.
- **Cause:** the CF-072 fix names the temp file `.cfire.tmp.$$$$` on three recipe lines
  (`Makefile:29–31`). Make runs each line in its own shell, so `$$` is a different pid on
  each: `cp` writes one name and `chmod` and `mv` look for another. `install.sh` does the
  same in one shell, so it works.
- **Workaround:** Flint's image runs `make build` and installs the binary, `runtime/` and
  `pkg/` by hand (`scripts/linux/Dockerfile`).
- **Ideal:** one shell for the three commands (`cp … && chmod … && mv …` on one line, or
  `.ONESHELL`), or `install -m 755 cfire $(DESTDIR)$(PREFIX)/bin/.cfire.tmp && mv -f …`
  with a fixed name.

### CF-087 · bug · `confirmed`: the simdjson check refuses versions that build
- **At `c5b1d4b`:** [read] Unchanged in `src/build/deps.hpp`. The Linux image still builds simdjson 4.
- **Repro (43431f2):** Debian trixie (`libsimdjson-dev` 3.12.3, `clang` 19), `cfire build`
  in Flint → `error building target 'native' for executable 'flint': system simdjson 3.12.3
  is incompatible with Clang 19 (requires simdjson >= 4.0 …)`. At `2d8613d` the same image
  built and passed every Flint suite with that simdjson.
- **Cause:** the CF-075 check (`src/buildsys.hpp:659–680`) refuses every `1.x`, `2.x` and
  `3.x` when clang is 19 or newer. The breakage CF-075 reported is Ubuntu's 3.6.4
  (`no member named 'print_newline'`); 3.12 does not have it. The check is also skipped
  whenever `~/.local/include/simdjson.h` exists, whatever is on the include path.
- **Workaround:** Flint's image builds simdjson 4.6.6 into `~/.local`, as on Ubuntu
  (`scripts/linux/Dockerfile`, *Build from source*).
- **Ideal:** test the header, not the version string: compile a one-line probe that includes
  `simdjson.h` once (cached) and report its error; or vendor simdjson in `runtime/vendor`.
  If a version gate stays, put the floor where the break is (it is somewhere between 3.6
  and 3.12) and let an environment variable override it.

### CF-088 · bug · `confirmed`: `==` on an enum passes `cfire check` and fails in clang
- **At `d182f32`:** [ran] Fixed: `if w == Mode::Y` builds and runs. Flint compares no enums, so nothing to remove; the entry closes when Flint moves to a build that has it.
- **At `c5b1d4b`:** [ran] Still passes `cfire check` and fails in clang (`invalid operands to binary expression ('Mode' and 'Mode')`).
- **Repro (43431f2, also 2d8613d):** `type Mode enum { X, Y }` then
  `w := Mode::Y` / `if w == Mode::Y { … }` → `cfire check` passes; clang:
  `invalid operands to binary expression ('Mode' and 'Mode')`. Enums lower to a struct
  around a variant (`Mode{_Y{}}`) with no `operator==`. The same for an enum of another
  package (`p.Mode`).
- **Workaround:** `match`. Flint compares no enums.
- **Ideal:** generate `operator==` for enums whose variants carry no data (or all
  comparable data), or reject `==` in the checker with a hint to use `match`.

### CF-089 · bug · `confirmed`: the descriptor-leak check is off for any package with `import cpp`
- **At `c5b1d4b`:** [read] The test runner is unchanged; cfire's own "CF-089" in this build is a different item (CF-108).
- **Repro (43431f2):** three one-test packages.
  - `import cpp "fcntl.h"` and a test that calls `::open("/dev/null", O_RDONLY)` and never
    closes it → `PASS`.
  - `import cpp "netdb.h"` and a test that resolves `localhost` → `PASS` (CF-080's case).
  - No `import cpp`; a test that calls `os.socketpair()` and never closes the pair →
    `FAIL: resource leak canary (test leaked 2 open file descriptor(s))`. The check
    itself still works.
- **Cause:** the CF-018/CF-080 fix sets `check_fd_leak = !has_cpp_import && …`
  (`src/codegen/test_runner.hpp`): one `import cpp` anywhere in the package turns the check
  off for all of its tests.
- **Why it matters:** the packages with `import cpp` are the ones where a C library opens
  sockets and files (Flint's SSH, IPC, vault and keychain adapters). Those lost the check
  that would catch a socket left open, which is what it is for.
- **Workaround:** none needed to pass; Flint keeps its start-up warm-ups, so the check can be
  turned back on.
- **Ideal:** take the baseline after the process-lifetime handles exist (a warm-up the
  runner does once: resolver, libsodium, D-Bus), or compare the descriptor set by kind
  (ignore descriptors the C library opened before the test's first call); or the opt-out
  per test (CF-018) instead of per package. A blanket exemption only if a test names it.

### CF-090 · bug · `confirmed`: `sodium.argon2id` defaults to 4 MiB, and reorders its arguments by guessing
- **At `c5b1d4b`:** [read] `runtime/core/sodium.hpp` is unchanged.
- **Repro (43431f2):** `cfire inspect ext:crypto/sodium` documents
  `fn argon2id(password: str, salt: []byte, out_len: usize = 32, opslimit: u64 = 2,
  memlimit: usize = 67108864)`, a 64 MiB default. Then `sodium.argon2id("pw", salt)` returns
  the same key as `sodium.argon2id("pw", salt, 32, 2, 4194304)` (4 MiB) and a different
  one from `(…, 32, 2, 67108864)`; it takes 3 ms against 54 ms.
- **Cause:** `runtime/core/sodium.hpp`: the short overload calls the C++ function with
  `ops_limit = 2, mem_kib = 4096`. The C++ signature is
  `(password, salt, ops_limit, mem_kib, key_len)`, not the documented order. A call in the
  documented order works only because a heuristic swaps the values back
  (`if (key_len > 1024 && ops_limit >= 16 && ops_limit <= 1024) …`). Outside that window
  the values are taken in the other order: `argon2id(pw, salt, 2048, 32, 67108864)` reports
  `key_len must be between 16 and 1024 bytes` for a call whose `out_len` is 2048.
- **Why it matters:** a caller who trusts the reference derives a key 16 times cheaper to
  attack than documented, and two builds that disagree on the default derive different keys
  from the same password.
- **Flint:** unaffected (its own adapter, CF-006, with explicit costs).
- **Ideal:** one C++ signature in the documented order, named in the generated call, no
  heuristic; a default of libsodium's `crypto_pwhash_MEMLIMIT_MODERATE` (256 MiB) or
  `INTERACTIVE` (64 MiB) by name; an error, not a guess, for out-of-range values.

### CF-091 · bug · `confirmed`: a nested slice literal with no declared type passes `cfire check` and fails in clang
- **At `d182f32`:** [ran] Still fails in clang (`auto need = {{"host", "list"}, {"exec", "web"}};`).
- **At `c5b1d4b`:** [ran] Still fails in clang (`cannot deduce actual type for variable 'need' with type 'auto' from initializer list`).
- **Repro (43431f2):** `need := [["host", "list"], ["exec", "web"]]` → `cfire check` passes;
  clang: `cannot deduce actual type for variable 'need' with type 'auto' from initializer
  list` (the lowering is `auto need = {{"host", "list"}, {"exec", "web"}};`).
- **Workaround:** declare the type (`need: [][]str = …`, `src/drivers/clicmd/serve_test.cf`).
- **Ideal:** infer `[][]str` from the elements, as for a flat literal, or ask for the type in
  the checker.

### CF-092 · missing · `open`: no way to read another process's parent, start time or executable
- **At `c5b1d4b`:** [read] Nothing new in `core:os`.
- **Repro (43431f2):** `cfire inspect core:os` has `getpid`-style calls for the running
  process only; nothing returns a pid's parent, start time, executable path or argv. Flint
  needs them for the caller of its socket (milestone 12): the peer pid comes from the
  kernel (CF-081), then its chain of parents up to pid 1 names who asked ("`flint`, started
  by Claude Code") and pins a grant to that process by pid and start time.
- **Workaround:** `src/adapters/ipc/native/flint_peer.hpp`: macOS `proc_pidinfo`
  (`PROC_PIDTBSDINFO`), `proc_pidpath`, `sysctl(KERN_PROCARGS2)`; Linux `/proc/<pid>/stat`,
  `/proc/<pid>/exe`, `/proc/<pid>/cmdline`.
- **Ideal:** `os.process_info(pid) -> ProcessInfo?` with `ppid`, `start_time`, `exe` and
  `argv`, on macOS, Linux and Windows (`NtQueryInformationProcess`,
  `QueryFullProcessImageName`).

### CF-093 · missing · `open`: no presence check (Touch ID, polkit, Windows Hello)
- **At `c5b1d4b`:** [read] Nothing new.
- **Repro (43431f2):** nothing in `core:` or `ext:` asks the OS to confirm the person at the
  machine is there. Flint needs it before the owner's **Allow** in the caller approval
  window takes effect (milestone 12), so a program that clicks the window cannot approve
  itself.
- **Workaround:** `src/adapters/uievents/native/flint_presence.hpp`: macOS
  `LAContext evaluatePolicy:LAPolicyDeviceOwnerAuthentication` (Touch ID or the Mac's
  password; linked with `-framework LocalAuthentication`, CF-031); Linux polkit
  `CheckAuthorization` over GIO for an action Flint ships (`dev.flint.approve`). Where
  neither works, Flint asks for the vault's master password itself.
- **Ideal:** `ext:auth.confirm_presence(reason) -> bool!` and `ext:auth.presence_kinds()`,
  on macOS (`LAContext`), Linux (polkit) and Windows (Windows Hello,
  `UserConsentVerifier`), blocking a worker, never the main thread.

### CF-094 · bug · `confirmed`: a method call on a string literal passes `cfire check` and fails in clang
- **At `d182f32`:** [ran] Still fails in clang (`"0123456789abcdef".contains(ch)` lowers as a C string).
- **At `c5b1d4b`:** [ran] Still fails in clang (`member reference base type 'const char[17]' is not a structure or union`).
- **Repro (43431f2):** `if "0123456789abcdef".contains(ch) { … }` → `cfire check` passes;
  clang: `member reference base type 'const char[17]' is not a structure or union` (the
  literal is lowered as a C string, not a `cfire::str`).
- **Same family:** `for part in s.split(",")` on a `str` also passes `cfire check` and
  fails in clang (`no member named 'split' in 'std::string'`); only the free function
  `str.split(s, ",")` lowers.
- **Workaround:** bind the literal to a typed constant first (`digits: str = "…"`,
  `src/domain/token.cf`); call `str.split` as a function (`src/adapters/vault/store.cf`).
- **Ideal:** lower a literal that receives a method call as a `str` value, or reject it in
  the checker.

### CF-095 · missing · `open`: `core:time` has no way to format a wall-clock time
- **At `c5b1d4b`:** [read] `runtime/core/time.hpp` is unchanged.
- **Repro (43431f2):** `cfire inspect core:time` describes "RFC 3339 / ISO 8601 formatting"
  but lists only `now`, `unix`, `unix_seconds` and `parse_rfc3339`: nothing turns a `Time`
  or Unix seconds into text. Flint prints when a token expires (milestone 12b).
- **Workaround:** `utc_text` in `src/drivers/clicmd/tokens.cf` (days to a civil date by
  arithmetic, UTC only).
- **Ideal:** `t.format_rfc3339()` and a `t.format(layout)` with local time, as Go's
  `time.Time.Format`.

### CF-096 · bug · `confirmed`: a runtime left in `~/.local/share/cfire` shadows the one the installer writes
- **At `c5b1d4b`:** [read] Still open: for `~/.local/bin/cfire` the runtime search tries `<prefix>/share/cfire/runtime` (`~/.local/share/cfire`) before `~/.cfire/runtime`.
- **Repro (43431f2, Zorin OS 18):** a box that once installed cfire `2d8613d` from a checkout
  has its runtime in `~/.local/share/cfire/runtime`. Running the `43431f2` installer
  (`CFIRE_VERSION=43431f2`) writes `~/.cfire/runtime` and prints "Core compiler & runtime
  ready", but `cfire` keeps using the old FHS-prefix runtime (`cfire doctor`: "[System FHS
  Prefix]"). Flint then fails in clang with 20 errors such as `too many arguments to
  function call, expected 2, have 3` on `cfire::json::get_i32(obj, "cols", out.cols)`.
- **Workaround:** move the old prefix aside (`mv ~/.local/share/cfire
  ~/.local/share/cfire-2d8613d`) and clear `/tmp/cfire_pch_cache`; documented in
  `site/src/content/docs/start/build-from-source.md`.
- **Ideal:** the installer (or `cfire doctor`) warns when a runtime of another version sits
  earlier in the search order, or the compiler refuses a runtime whose version differs
  from its own.

### CF-097 · missing · `confirmed`: a click on the Dock icon does not bring back a window hidden by the close button
- **At `c5b1d4b`:** [read] `ext:webui` only gained the Windows test backend.
- **Repro (43431f2, macOS):** an `ext:webui` app with `set_hide_on_close(true)`: close the
  window, then click the app's icon in the Dock (or run `open -a` on it). Nothing appears:
  webui sets no `NSApplicationDelegate`, so `applicationShouldHandleReopen:hasVisibleWindows:`
  is never answered, and the hidden window stays hidden until the tray's own item shows it.
- **Workaround:** `install_app_menu` in `src/adapters/uievents/native/flint_gui.hpp` sets a
  small app delegate (only if none is set) whose reopen handler orders the windows front.
  Tagged with CF-073, the shim it lives in.
- **Related:** webui's own Quit item calls `performClose:` on the key window, which with
  hide-on-close only hides it; Flint's menu sends `stop:` instead.
- **Ideal:** with hide-on-close set, webui answers reopen by showing the window (and emits
  `window:reopened`), and its Quit item quits (`app.quit()`) whatever hide-on-close says.

### CF-098 · bug · `confirmed`: assigning a captured variable inside `scope.spawn` compiles and is lost
- **At `c5b1d4b`:** [ran] Still compiles and is lost: `seen = 5` inside `scope.spawn` leaves `seen` at 0.
- **Repro (43431f2, macOS):** `mut heard := ""` then `async.scope(workers: 2) |scope| { scope.spawn || { heard = "x" } }`;
  after the scope, `heard` is still `""`. The task gets a copy of every capture (as `src/drivers/gui/main.cf`
  notes, "captures are read-only inside the task"), but an assignment to one is accepted with no
  diagnostic, so a result written there vanishes silently.
- **Workaround:** the task sends its result on a `sync.make_channel[str]()` and the caller receives it
  (`src/adapters/ssh/sftp_test.cf`, milestone 16's spike). No native code.
- **Ideal:** reject an assignment to a captured variable inside a spawned task (a diagnostic such as
  `cfire/ASSIGN-TO-TASK-CAPTURE`), or capture `mut` locals by shared reference under the scope's join.

### CF-099 · missing · `confirmed`: `core:fs` has no stat, no exclusive create and no error kind
- **At `c5b1d4b`:** [read] `core:fs` gained `is_file`, `is_dir`, `copy_file`, `append_*` and fd-based `File` handles, but still no stat (kind, size, mtime, mode in one call), no exclusive create and no error kind.
- **Repro (43431f2):** `cfire_stdlib_lookup core:fs` lists `exists`, `list_dir` (names only), `open`
  with Read/Write/Append/ReadWrite and `remove`, but nothing returns a file's kind, size, mtime or
  mode, nothing tells a link from its target (`lstat`), `open` has no create-exclusive mode, and a
  failure is a message only, so "no such file", "permission denied" and "not a directory" cannot be
  told apart. `flint cp` needs all of these to choose a target and to report stable errors.
- **Workaround:** `src/adapters/process/native/flint_fs.hpp` (stat/lstat, opendir, `open` with
  `O_EXCL`, read/write/fsync, rename, unlink/rmdir, mkdir, errno mapped to kinds), wrapped by
  `src/adapters/process/local_fs.cf`. Milestone 16.
- **Ideal:** `fs.stat(path) -> FileInfo!` and `fs.lstat` (kind, size, mtime, mode), `OpenMode::CreateNew`,
  and an `fs.ErrorKind` (`NotFound`, `PermissionDenied`, `AlreadyExists`, `NotADirectory`,
  `IsADirectory`) on every `core:fs` error, as Rust's `std::io::ErrorKind`.

### CF-100 · missing · `confirmed`: a type parameter cannot require two interfaces
- **At `c5b1d4b`:** [ran] Still a parse error (`expected 'IDENT', got '+'`).
- **Repro (43431f2):** `fn both[T: A + B](t: T)` fails with "expected 'IDENT', got '+'", and an
  interface cannot embed another (`type AB interface { A; B }`: "expected '('"). A libssh link serves
  both `SshTransport` and `SftpTransport`; `copy_with_host` must call both on one value.
- **Workaround:** the parameter names `SshTransport` only, and the SFTP calls go through helpers that
  name `SftpTransport` (`open_sftp`, `copy_files` in `src/application/files.cf`). This compiles because
  cfire does not check a generic body's calls against its constraints, only the instantiation (C++
  concepts), so the second interface is never stated where it is used.
- **Ideal:** `T: A + B` (Rust) or interface embedding (Go), checked in the body.

### CF-101 · bug · `confirmed`: a precision spec (`{x:.1f}`) breaks interpolation
- **At `d182f32`:** [ran] Fixed: `"{value:.1f}x"` gives `1.5x`. `human_bytes` can use it once Flint moves.
- **At `c5b1d4b`:** [ran] Still fails in clang (`call to consteval function 'std::basic_format_string<char>::basic_format_string<char[15]>' is not a constant expression`).
- **Repro (43431f2, macOS):** `value := 1.5` then `return "{value:.1f} {units[u]}"` returns the literal
  text `{value:.1f} {units[u]}`, uninterpolated, with no diagnostic. In `println("a: {value:.1f}")` the same
  spec fails in clang instead ("call to consteval function std::basic_format_string … The argument
  index starts with an invalid character"). The rules sheet shows `{mask:04x}`, so format specs are
  meant to work.
- **Workaround:** `human_bytes` in `src/domain/files.cf` rounds to tenths with integer arithmetic.
  Milestone 16. No native code.
- **Ideal:** `{x:.1f}` lowers to `std::format("{:.1f}", x)`, and an interpolation cfire cannot lower is
  a compile error, never a literal.

### CF-102 · bug · `confirmed`: `none` passed for a raw pointer parameter lowers to `std::nullopt`
- **At `c5b1d4b`:** [read] Not rechecked; no change found in how arguments lower.
- **Repro (43431f2, macOS):** `fn f(p: *mut cpp::sftp_session_struct) -> i64 { ... }` called as `f(none)`
  fails in clang: "no known conversion from 'const nullopt_t' to 'sftp_session_struct *'". Assigning
  `none` to a raw pointer field (`self.sftp = none`) and comparing (`p == none`) lower correctly.
- **Workaround:** pass a pointer variable that native code has set to `nullptr` (`borrow_transfer` in
  `src/adapters/ssh/shared.cf`). Milestone 17. No new native code.
- **Ideal:** `none` in an argument position typed as a raw pointer lowers to `nullptr`, as it does in an
  assignment.

### CF-103 · bug · `confirmed`: a namespaced native function shadows a cfire function of the same name
- **At `c5b1d4b`:** [read] Not rechecked.
- **Repro (43431f2, macOS):** with `import cpp "flint_fs.hpp"` (which declares
  `flint_fs::remove_path(const std::string&, std::string&)`) anywhere in the build, a call to the cfire
  use case `remove_path[T: SftpTransport](mut sftp: T, path: str)` from another package lowers to
  `remove_path(std::string(link), std::string(req.path))`: cfire resolves the call against the
  native declaration, ignoring its namespace, and casts the arguments to its parameter types. clang
  then fails with "no matching conversion … from 'SshLink' to 'std::string'".
- **Workaround:** the use case is named `remove_remote` (`src/application/files.cf`). Milestone 17.
  No native code.
- **Ideal:** a qualified C++ name (`flint_fs::remove_path`) is only reachable qualified, and a cfire
  function is never resolved against a native one.

### CF-104 · bug · `confirmed`: a `"\0"` string literal is the empty string
- **At `d182f32`:** [ran] Still true: `nul: str = "\0"` has `len() == 0` and `"a.txt"` contains it.
- **At `c5b1d4b`:** [ran] Still true for every string: `"a.txt".contains("\0")` prints `true`.
- **Repro (43431f2, macOS):** `rel.contains("\0")` is true for every string, `"a.txt"` included: the literal
  lowers to `std::string("\0")`, built from a C string, which stops at the NUL and is empty.
- **Workaround:** `valid_drop_path` in `src/domain/files.cf` does not test for NUL. A NUL in a dropped
  file's path only shortens the path the native code sees (`c_str()`), which stays inside the drop's
  folder. Milestone 17. No native code.
- **Ideal:** string literals lower with their length (`std::string("\0", 1)` or a `""s` literal), so an
  embedded NUL survives.

### CF-105 · missing · `confirmed`: no generic struct, so a port cannot be wrapped as another
- **At `d182f32`:** [ran] `type Wrap[T: Src] struct { inner: T }` now parses, but a method on it (`fn (self: Wrap[T]) twice() -> i32`) fails in clang (5 errors around the generated `cfire_method_twice` forwarding template).
- **At `c5b1d4b`:** [ran] Still a parse error (`expected 'struct', 'enum', or 'interface' after type name`).
- **Repro (43431f2, macOS):** `type Wrap[T: Src] struct { inner: T }` fails with "expected 'struct',
  'enum', or 'interface' after type name". Milestone 18 copies from one host to another by reusing
  the copy written for this machine ↔ host: the destination host must serve `LocalFiles`, which an
  adapter struct `HostAsLocal[T: SftpTransport]` would do for any transport (and for test fakes).
- **Workaround:** `SshLink` itself carries the `local_*` methods, each the SFTP call of the same name
  (`src/adapters/ssh/sftp_far.cf`); `relay_with_hosts` names `SshTransport` only (CF-100). Tests use
  the existing `FakeLocal` as the destination host. No native code.
- **Ideal:** generic structs with constrained type parameters and methods on them (`fn (self:
  Wrap[T]) …`), as Go and Rust have.

### CF-106 · bug · `confirmed`: a false `REDUNDANT-TRY` on calls through a generic interface parameter
- **At `d182f32`:** [ran] Still reproduces, and is now an error: `cfire check` exits 1. The checker types `store.load()` by looking for a concrete struct method of that name, not through the bound: with `type Mem struct` and `fn (self: Mem) load() -> i32!` in the same package the error goes away, and with `load() -> i32` (not fallible) on `Mem` it comes back, whatever the interface says. Checking a Flint package alone (`src/application`, where no adapter is visible) gives 143 `REDUNDANT-TRY` and 30 `REDUNDANT-OR`; the CLI entry point gives 6, on ports only the GUI implements (`presence_confirm`, `mono_font_families`, `clipboard_copy_secret`). `cfire fix` deletes about 600 `try`s on Flint (CF-117).
- **Repro (c5b1d4b, macOS):** `type Store interface { save(n: i64) -> void! }` and
  `fn keep[S: Store](store: S) -> void! { try store.save(1) }` → `cfire check`: "'try' used on
  non-fallible expression; remove 'try' (cfire/REDUNDANT-TRY)". The call is fallible and the
  program builds and propagates the error correctly. The same blindness hides real misses:
  `x := store.load()` (an `i64!`) without `try` or `or` is not reported there.
- **Impact:** 137 false errors in Flint (every use case calls its ports this way), plus 3
  `REDUNDANT-OR`. `cfire check` still exits 0 and `cfire build` is not blocked, but the
  editor shows them, and `cfire fix` applies the fix-it, which deletes the `try` and drops
  the error. Flint does not run `cfire fix`.
- **Workaround:** none needed to build; the diagnostics are ignored.
- **Ideal:** resolve a method call on a value whose type is a constrained type parameter
  through the interface's signature, for both rules.

### CF-107 · bug · `confirmed`: `File.read_bytes(n)` now fails on a file longer than `n`
- **Repro (c5b1d4b, macOS):** `f := try fs.open("big.bin")` on a 100-byte file, then
  `f.read_bytes(16)` → error `fd_read_all exceeded max_bytes limit (16)`. At `43431f2` it
  returned the first 16 bytes. On a seekable file the argument is now a limit for reading the
  whole file, not a count; nothing warns about the change.
- **Impact:** Flint reads the vault's 16-byte salt this way, so every vault failed to open
  ("cannot read") while `cfire check` and the build passed.
- **Workaround:** `f.read_exact(16)` after checking `fs.file_size` (a shorter file stays
  "not a Flint vault"), `src/adapters/vault/store.cf`. No native code.
- **Ideal:** keep a call's meaning when its signature stays, or flag the old use
  (`cfire/DEPRECATED-API` already does it for `read_all` and `write_str`).

### CF-108 · improvement · `confirmed`: cfire's backlog reuses Flint's entry numbers
- **What happened:** cfire's commits `b3909cc` and `9cb6f7a` name their work "CF-086..CF-088"
  and "CF-089" (the `core:`/`ext:` split, `ai.Agent`, `ai.Client`, unified I/O), while Flint's
  CF-086..CF-089 are other entries (`make install`, the simdjson check, enum `==`, the leak
  check), all still open. Reading the commit log, they look answered.
- **Ideal:** one numbering: cfire's own items under another prefix, or a note in the commit
  when a number is not Flint's.

### CF-109 · bug · `confirmed`: on macOS the runtime's `VERSION` file breaks every build
- **At `d182f32`:** [read] Unchanged: `make install` (Makefile line 35) and `docs/install.sh` (line 191) still write `runtime/VERSION`.
- **Repro (c5b1d4b, macOS):** `CFIRE_VERSION=c5b1d4b sh install.sh` writes
  `~/.cfire/runtime/VERSION` (`0.10.0 c5b1d4b`). The runtime folder is on the include path and
  APFS ignores case, so libc++'s `#include <version>` (from `<fstream>`) reads it:
  `.cfire/runtime/version:1:1: error: expected unqualified-id`. simdjson warns about the same
  file (`non-portable path to file '<VERSION>'`).
- **Workaround:** `rm ~/.cfire/runtime/VERSION` after installing; `cfire doctor` then reads
  the version from the prelude's markers. In the build-from-source page. Linux file systems
  are case-sensitive and do not hit it.
- **Ideal:** keep the stamp out of the include path (`share/cfire/VERSION`, or a name no
  header has, such as `.cfire-version`).

### CF-110 · missing · `confirmed`: no way to keep a call's value and its error and go on
- **At `d182f32`:** [ran] Unchanged: `x := f(-1) or err { println(…); 7 }` is still `cfire/NON-DIVERGING-OR-BLOCK`.
- **What happened:** from `c5b1d4b` a fallible result cannot be stored or passed on, and a
  binding or assignment `x = f() or err { … }` must leave the block (`NON-DIVERGING-OR-BLOCK`).
  Code that keeps going after a failure and uses the value on success (a copy that records
  the error and still closes both files, a loop that logs and continues) has no direct form.
  `Error` cannot be named as a type either (`fn f(e: Error)` fails in clang: unknown type
  name 'Error'), so the error itself cannot be handed to a helper.
- **Workaround:** small helpers that take the value as a `mut` parameter and return the
  message or a `bool` (`side_stat_into` in `src/application/files.cf`,
  `open_tether_secret_into`, `settings_valid`), or that return from inside `or err`
  (`served_exit`, `relay_typed`); tests keep the message in a string
  (`f() or err { msg = "{err.message()}" }`). No native code.
- **Ideal:** a non-diverging form that yields a fallback and binds the error (`x := f() or
  err { log(err); fallback }`), or a nameable `Error` type.


### CF-111 · missing · `confirmed`: the macOS headless runner cannot resize its window
- **Repro (c5b1d4b, macOS):** in an app run with `run_webview_test`, a binding that calls
  `app.set_size(900, 600)` changes nothing: `run_macos_webview_test`
  (`core/webui/macos_ios.hpp`) sets `platform_eval`, `platform_set_title` and
  `platform_quit` but not `platform_set_size`, so `App::set_size` only stores the numbers.
  The page's `window.innerWidth` stays at the size the window was made with. In Flint's
  M21 run the page also never answered again after that call (no verdict until the 240 s
  cap); not narrowed further.
- **Workaround:** gui-e2e tells the page it is 900 px wide (`window.innerWidth` redefined
  plus a `resize` event) to check the narrow layout, and the real 900 px window is checked
  by the landing's screenshot script in Chromium (`FLINT_SHOTS_EXTRA`). No native code.
- **Ideal:** `platform_set_size` in the headless runner (`setContentSize:` on its
  off-screen window, then the WKWebView's frame), as `app.run()` has it.


### CF-112 · missing · `confirmed`: no way to wait on several sockets at once
- **What happened (c5b1d4b, milestone 22):** a tunnel's worker must wait on its listeners,
  every accepted connection and the SSH session's socket at once, then move whatever is
  ready. `ext:net` has `listen_tcp_addr`, `accept` and `read` with a timeout per call, but
  no poll over a set of descriptors, no non-blocking read or write that says "would block",
  and no way to add a foreign descriptor (libssh's `ssh_get_fd`) to the wait. One thread
  per connection would work around the poll but needs a mutex per libssh session shared
  across threads (CF-026), which cfire cannot hold in a struct either.
- **Workaround:** `src/adapters/ssh/native/flint_tunnel.hpp`: the listener (bound to
  127.0.0.1 with `bind`/`listen`), `accept`, `poll` and non-blocking reads and writes in
  C++, one worker thread per host session, called from `src/adapters/ssh/tunnels.cf`.
- **Ideal:** a `Poller` (or `net.poll(fds, timeout)`) over `TcpListener`, `TcpConn` and raw
  descriptors, with non-blocking `try_read` / `try_write` on `TcpConn`.

### CF-113 · bug · `confirmed`: a generic call's `[]T!` result is typed `[][]T!` when assigned
- **What happened (c5b1d4b, milestone 23):** in `src/drivers/gui/tunnels.cf`, assigning
  the result of a generic use case that returns `[]str!` to a declared fallible variable
  fails to build, and the message names the wrong type:
  ```cf
  fn pick[R: TunnelRunner](mut runner: R) -> []str! { return [] }
  mut picked: []str! = []
  picked = pick(mut runner)   // cfire/UNHANDLED-RESULT: returns '[][]str!'
  ```
  `run_gui_session` in `src/drivers/gui/rpc.cf` stores an `i64!` the same way
  (`mut result: i64! = 0`, then `.has_value()`) and builds; with a list from a generic
  call it does not, so the CF-110 gap has no way through here.
- **Workaround:** a small non-generic helper that returns `[]str!` with `try`, called with
  an `or err { …; return }` block that diverges.
- **Ideal:** the assignment type-checks as `[]str!`, as it does for `i64!`.

### CF-114 · missing · `confirmed`: no way to ask which process holds a port
- **What happened (milestone 23, design 16h2):** when a tunnel's local port is taken, the
  approval window names the program that holds it (`Python (pid 11121)`). cfire can bind a
  port to see that it is taken, but `core:os` has no process list and nothing that maps a
  listening socket to its process: no `libproc` on macOS, and reading `/proc/net/tcp` and
  every `/proc/<pid>/fd` link by hand needs `readlink` and directory listing of `/proc`,
  which `core:fs` does not offer for symlinks.
- **Workaround:** `flint_tunnel::port_owner` in `src/adapters/ssh/native/flint_tunnel.hpp`
  (`proc_listpids` / `proc_pidfdinfo` on macOS; `/proc/net/tcp{,6}` and `/proc/*/fd` on
  Linux), called from `tunnel_port_owner` in `src/adapters/ssh/tunnels.cf`.
- **Ideal:** `net.port_owner(port) -> (name: str, pid: i64)?`, or a process list with each
  process's sockets in `core:os`; plus `fs.readlink`.

### CF-115 · bug · `confirmed`: returning a slice from a `[]T!` function is a type mismatch
- **Repro (d182f32, macOS) [ran]:**
  ```cf
  fn many() -> []i32! {
      mut xs: []i32 = []
      xs.push(1)
      return xs   // error: return type mismatch: function 'many' expects '[]i32!', got '[]i32' (cfire/TYPE-MISMATCH)
  }
  ```
  `c5b1d4b` accepts it, builds it and runs it. Returning a plain `i32` from an `i32!`
  function, or a struct from a `P!` function, is still accepted: only slices fail.
- **Impact:** 48 places in Flint (`return found`, `return list`, `return key` in the
  keychain, crypto, config, vault and SFTP adapters and the application views). It blocks
  `cfire build` of both binaries.
- **Workaround:** none taken; Flint stays on `c5b1d4b`. `return xs` could be rewritten, but
  48 detours around a checker regression are not worth writing.
- **Ideal:** a value of type `T` is assignable to a `T!` return for every `T`, slices
  included, as before.

### CF-116 · bug · `confirmed`: `json.parse[T](…)` is typed as the bare parameter `T`
- **Repro (d182f32, macOS) [ran]:**
  ```cf
  import "core:json"
  type P struct { n: i32 `json:"n"` }
  fn parse(t: str) -> P! {
      return json.parse[P](t) or { return error("bad") }
      // error: return type mismatch: function 'parse' expects 'P!', got 'T' (cfire/TYPE-MISMATCH)
  }
  ```
  `c5b1d4b` accepts it and the program parses `{"n":3}`. The checker does not substitute the
  explicit type argument into the stdlib signature, so the result keeps the name of the
  type parameter.
- **Impact:** 7 places in Flint, also blocking the build: `src/adapters/ipc/relay.cf:243`,
  `src/drivers/clicmd/serve.cf:378` and `:621`, `src/adapters/vault/holder.cf:234`
  (`json.parse[AccessBook](text) or empty_access_book()`), and `return req` after a parse in
  `src/drivers/gui/rpc.cf:733`, `:781` and `src/drivers/gui/tunnels.cf:140`.
- **Workaround:** none taken; Flint stays on `c5b1d4b`.
- **Ideal:** `json.parse[P](…)` is typed `P!`, and an unresolved type parameter in a
  result is reported as a checker bug rather than compared as a type.

### CF-117 · bug · `confirmed`: `cfire fix` makes changes that alter behaviour or are not fixes
- **Repro (d182f32, macOS) [ran]:** `cfire fix` at the root of a clean copy of Flint
  (`5156a86`) changes 88 files (944 insertions, 806 deletions) and exits 0. Its own output
  lists 601 "Remove redundant 'try '", 187 discards, 26 separators, 17 imports and 30
  "Convert '…_*' constants to enum". The copy still does not build afterwards (CF-116).
  - **It deletes real `try`s** (CF-106): `try store.ui_state_save(cleaned)` becomes
    `store.ui_state_save(cleaned)`, so a failed write is dropped silently. About 580 net
    across the use cases.
  - **It adds imports Flint keeps out on purpose:** `ext:crypto/sodium` in
    `src/adapters/crypto/sodium.cf` (Flint calls libsodium through `import cpp "sodium.h"`),
    `core:keychain` in `src/application/session.cf` and its test (Flint has its own keychain
    adapter, D-044), and `core:net` in a clipboard test and `src/drivers/gui/main.cf`. These
    are guesses from a name, not missing imports: every one of these files checks cleanly on
    `c5b1d4b`.
  - **"Convert to enum" writes comments, not an enum:** above `PASTE_MAX_AGE` in
    `src/domain/paste.cf` it inserts `// Suggested refactoring: type Paste enum { ... }`
    three times, for constants that are sizes and ages, not a set of cases.
- **Impact:** Flint cannot use `cfire fix` even for the mechanical parts. The discard and
  separator changes it gets right are done with two `sed` lines instead.
- **Workaround:** Flint never runs `cfire fix` (D-060).
- **Ideal:** `fix` applies only fix-its marked safe (syntax spelling such as `_ =` and
  `cpp.`), and a `--rule <code>` flag picks them; a fix-it that removes error handling,
  adds a module or rewrites declarations is offered in the editor, not applied in bulk.

### CF-118 · bug · `confirmed`: a deprecated `_ :=` before `try … mut x` breaks the parse and floods the output
- **Repro (d182f32, macOS) [ran]:**
  ```cf
  fn take(n: i32, mut got: str) -> bool! { got = "x"; return n > 0 }
  fn run() -> void! {
      mut other := ""
      _ := try take(1, mut other)
  }
  ```
  gives the expected `cfire/DEPRECATED-DISCARD`, and then `expected ':=', got ')'
  (cfire/SYNTAX)` at the `mut other)`: the parser reads `mut other` as a new declaration.
  With `_ =` the file checks cleanly. Other argument shapes after `_ := try` fail the same
  way (`expected type name, got 'open'` inside a struct literal argument).
- **Impact:** on Flint, the 205 discards produce about 6,700 error lines, 10,500 of them
  `UNDECLARED-IDENT` for names of other files in the same package and of imported ones
  (`coded`, `ERR_INVALID`, …): the failed parse drops the rest of the file, and each package
  is reported again from every importer. The one real cause is hard to see in that output.
- **Workaround:** replace `_ :=` with `_ =` before checking anything else.
- **Ideal:** the parser accepts the deprecated form as a discard (so only the deprecation
  is reported) and a parse error in one file does not show up as undeclared names in its
  package.

### CF-119 · missing · `open`: no RDP client; winpr's `byte` clashes with the prelude
- **What Flint needs (milestone 28):** an RDP client session in the desktop app: connect
  with NLA, receive the desktop's frames, send keys and the mouse. cfire has no RDP, and a
  library like libfreerdp 3 works through C callbacks (`PostConnect`, `EndPaint`,
  `VerifyCertificateEx`) set on a struct, which cfire cannot write.
- **Workaround:** `src/adapters/rdp/native/flint_rdp.hpp` owns the FreeRDP instance, its
  event loop thread, the callbacks and a dirty-rectangle queue; `src/adapters/rdp/rdp.cf`
  calls it from `cpp {}` blocks. Linked through `flint-rdp.pc` (CF-031), so only the app
  links FreeRDP.
- **Second gap, repro [ran] (macOS, cfire `c5b1d4b`, FreeRDP 3.33.1):** any `.cf` file with
  `import cpp "freerdp/freerdp.h"` fails in clang with `winpr/wtypes.h:133: redefinition
  of 'byte' as different kind of symbol` against `cfire_prelude.hpp:1615: using
  cfire::byte;`. The prelude puts `byte` in the global namespace, where C libraries keep
  their own typedefs. **Workaround:** `#define byte flint_winpr_byte` around FreeRDP's
  includes in the shim.
- **Ideal:** the prelude keeps `byte` inside `cfire::` (generated code can qualify it), so
  a C header that declares a global `byte` includes cleanly.
- **Milestone 30:** the shim now also implements the RemoteDesktop port's tabs (one per
  page id, reconnects that keep the frame channel), the certificate check
  (`VerifyX509Certificate`), the Display Control channel through `libfreerdp-client3`, and
  the keyboard layout (Carbon's Text Input Sources on macOS, included before winpr, whose
  `CreateEvent` macro renames Carbon's own).
- **Milestone 31:** the clipboard channel (`cliprdr`, a static channel loaded beside
  `drdynvc`; text only, UTF-16 and CRLF converted in the shim), a `TCPConnect` hook that
  adds `TCP_RXT_CONNDROPTIME` on macOS, and a test server
  (`native/testserver/flint_rdp_testserver.cpp`, built by `scripts/rdp-testserver.sh`
  against `libfreerdp-server3`): FreeRDP's sample server has no clipboard channel, and a
  server is callbacks on C structs too. It is test code, never linked into Flint.

### CF-120 · bug · `confirmed`: `cfire test <dir>` reports "No test suites found" when a test file does not compile
- **Repro (c5b1d4b, macOS) [ran]:** in a package folder with a `_test.cf` that uses a
  reserved word as a name (`mut out := ""`), `cfire test src/adapters/rdp` prints
  `✓ No test suites found in src/adapters/rdp` and exits 0. `cfire test
  src/adapters/rdp/rdp_test.cf` shows the real error (`'out' is a reserved parameter-intent
  keyword…`). Found in milestone 30.
- **Impact:** a broken test file looks like a folder with no tests, and a suite run passes.
  `scripts/test.sh` would have reported the RDP adapter green with none of its tests run.
- **Workaround:** run a changed test file by its path once before trusting the folder run.
- **Ideal:** a test file that fails to compile fails the run with its error.

### CF-121 · missing · `confirmed`: no way to turn off the webview's form autofill (Windows)
- **Seen (owner, Windows 11, Flint's Windows branch on cfire `c5b1d4b` + its Windows patches) [ran]:**
  registering a second RDP host in the app, the user field offered the user typed in the
  first. WebView2 is Chromium, and its general autofill is on by default: values typed into
  the page's inputs are stored in the webview's profile on disk and offered back.
- **Checked in cfire's source:** `runtime/core/webui/windows_webview2.hpp:519-523` sets only
  `IsStatusBarEnabled` and `IsWebMessageEnabled` on `ICoreWebView2Settings`;
  `ICoreWebView2Settings4::put_IsGeneralAutofillEnabled` and `put_IsPasswordAutosaveEnabled`
  are never called. WKWebView and WebKitGTK have no general autofill.
- **Impact:** an app that keeps its data encrypted (Flint's vault) leaks what the user types
  into a plain profile folder (`%LOCALAPPDATA%\…\EBWebView\`).
- **Workaround:** `autocomplete="off"` on the page's inputs (Chromium may ignore it on a field
  that looks like a username).
- **Ideal:** a `webui.App` option for autofill, off by default for an app (not a browser), and
  password autosave always off.

### CF-122 · missing · `confirmed`: the web inspector and the browser's context menu are on in every build
- **Seen (owner, Windows 11) [ran]:** right-click in Flint's window shows Edge's menu with
  *Inspect*, *Reload*, *Print*, *Save as* and *Back*.
- **Checked in cfire's source:** WebView2 leaves `AreDevToolsEnabled` and
  `AreDefaultContextMenusEnabled` at their default, on (`windows_webview2.hpp:519-523`);
  macOS sets `developerExtrasEnabled` to `YES` for every app
  (`runtime/core/webui/macos_ios.hpp:244`, inside `apply_macos_unthrottled_prefs`);
  `linux_gtk.hpp` does not touch `enable-developer-extras` (off by default) nor the default
  context menu.
- **Impact:** a shipped app opens its own inspector, where the page's state can be read (in
  Flint, whatever the unlocked vault has shown); *Reload* restarts the UI under open sessions.
- **Workaround:** the page can cancel `contextmenu` outside text fields; the inspector itself
  cannot be turned off from the page.
- **Ideal:** a `webui.App` option, e.g. `devtools: bool`, off by default and applied per
  backend (`put_AreDevToolsEnabled`, `developerExtrasEnabled`, `enable-developer-extras`),
  so an app turns it on for development (an environment variable or a debug build). And a
  way to filter the default context menu (WebView2's `ContextMenuRequested`; WebKit's
  `context-menu` signal; `WKUIDelegate` on macOS) that keeps copy and paste in text fields.

### CF-123 · bug · `confirmed`: `core:build` documents `build.Step`; the manifest reads `build.Command`
- **Seen (milestone 32) [ran]:** the reference (`docs/STDLIB_REFERENCE.md:98`,
  `cfire_stdlib_lookup core:build`) offers `build.Step(name, StepConfig)` for a pre-build
  command. The manifest parser only recognises a call whose member is `Command`
  (`src/build/manifest.hpp:250`); `Step` is not matched there. `build.Command("sh", { Args:
  ["scripts/version.sh", "--write"] })` in Flint's `build.cf` runs before every `cfire build`
  and `cfire test` (checked: `FLINT_VERSION=9.9.9-probe cfire build Flint` gave
  `flint 9.9.9-probe`, the next plain build `flint 0.0.0-dev`).
- **Also undocumented:** a command with no `Outputs` runs on every build
  (`src/build/deps.hpp:597`), which is what a version stamp needs.
- **Impact:** a project following the docs gets no pre-build step, silently.
- **Workaround:** `build.Command`, as Flint does.
- **Ideal:** one name in the docs and the parser (or both accepted), and "no `Outputs` runs
  every time" stated in the reference.

### CF-124 · missing · `confirmed`: an interface method cannot declare a `mut` parameter
- **Repro (c5b1d4b, macOS) [ran]:** `type Wiper interface { wipe(mut buf: []byte) }` fails with
  `expected type name, got 'mut'`; `wipe(buf: mut []byte)` fails the same way. A free
  function or a method on a struct takes `mut` as usual. Found in milestone 36.
- **Impact:** a port cannot offer an operation that changes the caller's value. Flint's
  `Crypto` port needs one to wipe a secret in place with `sodium_memzero`: the core may not
  import the adapter (Principle 1), so the call has to go through the port.
- **Workaround:** `Crypto.wipe(buf: []byte)` and `wipe_text(text: str)` take a read-only
  borrow, and the libsodium adapter writes through it with a `const_cast` in a `cpp {}` block
  (`src/adapters/crypto/sodium.cf`, tagged `CF-124`). Defined behaviour, since the caller's
  local is never `const`, but the signature lies about what it does, and a fake of the port
  cannot do the same without native code (Flint's fake records the values instead).
- **Ideal:** `mut` (and `out`, `move`) accepted on interface method parameters, with the call
  site's `mut` checked against them as for any function.

### CF-125 · missing · `confirmed`: `ext:webui`'s full screen is a toggle that never hears the window
- **Seen (milestone 37) [read]:** `webui.App.fullscreen()` and the page's
  `WindowFullscreen()` flip `is_fullscreen` and call the platform's toggle
  (`core/webui.hpp:336`, `core/webui/bridge.hpp:492`): `-toggleFullScreen:` on macOS
  (`macos_ios.hpp:610`), `gtk_window_fullscreen`/`unfullscreen` on Linux
  (`linux_gtk.hpp:256`), nothing on Windows (`windows_webview2.hpp` sets no
  `platform_fullscreen`). There is no "enter" or "leave", no way to read the window's real
  state, and no event when it changes another way (the green button, the system's own
  ⌃⌘F, a window manager's key), so the flag drifts from the window after the first such
  change.
- **Repro:** call `app.fullscreen()`, leave full screen with the green button, call it
  again: the flag says "full screen" and the window enters it a second time instead of
  leaving, or the other way round; nothing tells the page the window left.
- **Why Flint needs it:** an RDP tab goes immersive (no chrome) exactly while the window is
  full screen, whichever way it got there (spec v10, milestone 37).
- **Workaround:** `src/adapters/uievents/native/flint_window.hpp`: macOS enters or leaves
  with `-toggleFullScreen:` only when `NSWindowStyleMaskFullScreen` differs and hears
  `NSWindowDidEnter/ExitFullScreenNotification`; Linux hears `window-state-event`; Windows
  (built on the owner's branch) switches the style to `WS_POPUP` over the monitor's rectangle
  and back. Each change reaches the page as `window:fullscreen` through `App.eval`. The shim
  also measures what macOS reveals over a full-screen window at the top edge (the menu bar
  and the title bar), which nothing in `ext:webui` exposes.
- **Ideal:** `App.set_fullscreen(on: bool)`, `App.is_fullscreen() -> bool` read from the
  window, and a `window:fullscreen` event (`{ on }`) emitted by webui on every change, on
  all three systems; for macOS, the inset the top edge reveals.

### CF-126 · missing · `confirmed`: `ext:webui` has one window per `App` and no list of screens
- **Seen (milestone 38 spike) [read, ran]:** an `App` owns exactly one native window and one
  web view (`run_macos_app`, `run_linux_webkitgtk`, `run_win32_webview2`); its `AppState`
  (the app:// files, the RPC table, the event target `platform_eval`) is private, so a second
  window cannot share the page's RPC or events, and a page's RPC reply always goes to the
  first window. Nothing reports the screens (position, size, scale, rotation, the notch's
  inset). A second `App` would start a second run loop.
- **Repro:** `spike/multimon` (`./run.sh`, `SPIKE_AUTO=1,0`): the second window had to be
  built natively (`spike/multimon/native/spike_multimon.hpp`) with its own app:// handler
  on macOS (the default WebKitWebContext's handler serves it on Linux) and its own script
  message handler; replies reach it only through that shim.
- **Why Flint needs it:** two monitors (spec v10, milestone 38): one borderless or full-screen
  window per monitor, each drawing its part of the remote desktop and sending its own mouse;
  later an RDP tab in a window of its own.
- **Workaround:** a native shim in `adapters/` (macOS `NSWindow` + `WKWebView`, Linux
  `GtkWindow` + `WebKitWebView`, Windows an `HWND` + a WebView2 controller) whose page talks
  to the process through its own message handler, relayed to the main page; the monitors read
  per OS (`NSScreen` + CoreGraphics, `GdkMonitor`, `EnumDisplayMonitors` +
  `GetDpiForMonitor`).
- **Ideal:** `App.new_window(url, opts) -> Window` sharing the app's files, RPC table and
  events (events addressed to one window or all), with `Window.set_frame`,
  `Window.set_fullscreen(on, monitor)`, borderless; and `webui.screens() -> []Screen` (frame
  and work area in points, top-left origin, scale, rotation, refresh, primary, safe-area top).

### CF-127 · missing · `suspected`: `ext:webui` on Windows declares no per-monitor DPI awareness
- **Seen (milestone 38) [read]:** neither cfire's runtime (`core/webui/windows_webview2.hpp`)
  nor the owner's Windows branch (`windows-port-2`) declares DPI awareness: no manifest
  entry and no `SetProcessDpiAwarenessContext`. A process that does not is scaled by
  Windows as a bitmap on a monitor whose scale differs from the system's, and
  `GetDpiForMonitor` reports the system's DPI for every monitor, so a layout across a 100 %
  and a 150 % monitor cannot be read right. Not run: only the owner tests Windows.
- **Repro (to confirm on Windows):** two monitors at 100 % and 150 %; a webui app's window
  on the 150 % one is blurred, and `GetDpiForMonitor` returns 96 for both.
- **Why Flint needs it:** a remote desktop across monitors (spec v10, milestone 38) reads
  each monitor's size and scale to tell Windows the layout, and opens a window on each.
- **Workaround:** `src/adapters/uievents/native/flint_monitors.hpp` calls
  `SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)` at install,
  before webui opens its window; the monitors are read in physical pixels with their own
  scale and the core lays them out in points (`domain/monitors.cf`, `logical_monitors`).
- **Ideal:** webui declares per-monitor-v2 awareness on Windows (in the manifest or before
  its first window) and handles `WM_DPICHANGED`, so its window is sharp on every monitor.

### CF-128 · bug · `confirmed`: a function of an `import cpp` header takes over a cfire call of the same name in another package
- **Seen (milestone 38) [ran, Linux]:** `src/domain/monitors.cf` defines
  `fn monitor_index(ms: []LocalMonitor, id: str) -> i64`. The `uievents` package imports
  `flint_monitors.hpp`, whose GTK branch declared `flint_monitors::monitor_index(const
  std::string&)`. Built on Linux, every call in the domain was lowered as
  `monitor_index(str(locals), id)`: cfire resolved the name against the C++ function it
  ingested for another package and cast the first argument to it, so clang failed ("no
  matching conversion for functional-style cast from '[]LocalMonitor' to 'str'"). On
  macOS the same tree built, because that branch of the header is not compiled there.
- **Repro:** a package with `fn f(xs: []T, s: str) -> i64` and calls to it; a second
  package of the same program with `import cpp "h.hpp"` where `h.hpp` declares
  `namespace n { inline int f(const std::string&); }`. Build: the first package's calls
  come out as `f(str(xs), s)`.
- **Why Flint needs it:** the domain must not depend on what an adapter's C++ header
  happens to name (Principle 1); a shim added later can break a build on one system only.
- **Workaround:** the C++ function is named `gdk_monitor_number`, a name no cfire code uses.
- **Ideal:** names from an `import cpp` header resolve only inside the package that imports
  it, and only as qualified (`n::f`) or inside `cpp { }` blocks; a cfire function of the
  same name is never cast to a C++ signature.
