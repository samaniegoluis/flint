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
  - `open`: still reproduces.
- An entry answered by a cfire build carries an **At `<commit>`** line under its heading.
- Each entry gives: what Flint needed, a minimal repro or source pointer, the workaround and
  where it lives, and what an ideal API would look like.

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

### CF-001 · missing · `open`: Windows backend for `ext:webui` (WebView2)
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

### CF-003 · improvement · `not adopted`: high-throughput / binary event channel
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

### CF-004 · missing · `answered, untested`: OS file drag & drop into the webview
- **At `466751b`:** `files:dropped` event added. Flint has no drop target yet (SFTP upload is on its roadmap).
- **Needed:** SFTP upload by dropping files from Finder or the file manager (roadmap `next`).
- **Source:** no drop handler in `webui.hpp`. The page cannot get real paths for dropped
  files.
- **Ideal:** an event such as `files:dropped` with absolute paths and the drop coordinates.

### CF-005 · missing · `not adopted`: SSH client module
- **At `466751b`:** `ext:net/ssh` covers dial, fingerprint, key/password/agent auth, PTY, exec, SFTP and forwarding, but not what Flint relies on: `SSH_OPTIONS_FD` (a session over another session's channel, for jump hosts), a host key algorithm preference, keyboard-interactive auth, `userauth_list`, private key inspection, an exec's exit status and signal. Known hosts go to `~/.ssh/known_hosts`, where Flint keeps them in its vault. `CFIRE_HEADLESS_TEST=1` swaps in a mock server (CF-071). Flint keeps its libssh adapter.
- **Needed:** the core of Flint: PTY, exec, SFTP, agent, port forwarding, known_hosts.
- **Confirmed (M01):** cfire has no SSH support.
- **Workaround:** `src/adapters/ssh/libssh.cf` over the system libssh
  (`import cpp "libssh/libssh.h" @pkg("libssh")`): dial with timeout, host-key
  fingerprint, key-by-content auth, PTY shell, read with timeout, resize. No
  `build.CMake` needed; `@pkg` resolves it through pkg-config (D-012).
- **Ideal:** `ext:net/ssh`, so a 15-line SSH client is possible in cfire.

### CF-006 · missing · `not adopted`: vetted crypto: Argon2id, XChaCha20-Poly1305
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
- **Ideal:** `ext:crypto/sodium` (or a libsodium-backed `core:crypto/*`).

### CF-007 · missing · `not adopted`: encrypted SQLite in `ext:db/sqlite`
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

### CF-010 · missing · `open`: Windows support in the core runtime
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

### CF-011 · improvement · `partly resolved`: `cfire --version` does not identify the build
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
- **Ideal:** one C++ namespace per package, and stdlib method calls that never route to
  user methods. This matters a lot for a hexagonal layout, where two adapters naturally
  both have `open`, `close` and `new`.

### CF-018 · improvement · `partly resolved`: the `cfire test` fd-leak canary has no opt-out
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

### CF-020 · bug · `resolved ✓`: identifiers that are C++ keywords break the build
- **At `466751b`:** C++ keywords are renamed in the generated code.
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
  parser is plain cfire in `src/drivers/cli/args.cf`.
- **Ideal:** `os.args() -> []str`, `eprintln`, `os.exit(code)`, and subcommand plus
  positional support in `core:cli`.

### CF-025 · bug · `resolved ✓`: comma-separated struct fields, as documented, do not parse
- **At `466751b`:** comma-separated fields parse.
- **Repro:** `type U struct { id: i64, name: str }` (the form in `cfire doc --llm`) →
  `expected 'IDENT', got ','`. The multi-line form with trailing commas fails the same way.
- **Workaround:** one field per line, no commas.
- **Ideal:** accept commas, or fix the reference sheet.

### CF-026 · missing · `partly resolved`: concurrency primitives beyond `async.scope` and channels
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

### CF-031 · missing · `partly resolved`: no way to link a framework, pick per-platform sources, or write top-level C++
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

### CF-043 · missing · `partly resolved`: no socketpair, poll or threads for a byte-stream bridge
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

### CF-045 · missing · `not adopted`: no way to list installed fonts
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

### CF-050 · improvement · `answered, untested`: the headless WebView runner throttles timers
- **At `466751b`:** `inactiveSchedulingPolicy` is set and App Nap is held off. Flint's e2e runner already waits on `MessageChannel` posts and was left as is.
- **Repro:** in `run_webview_test`, a page that waits with `setTimeout(…, 50)` in a
  loop slows to about one wake-up every several seconds after a while, because the
  window is never shown and WebKit throttles a hidden page's timers (and never runs
  `requestAnimationFrame`). A UI test that polls the DOM then looks hung.
- **Workaround:** `scripts/gui-e2e.js` waits on `MessageChannel` posts, which are not
  throttled.
- **Ideal:** `run_webview_test` sets `WKPreferences.inactiveSchedulingPolicy = .none`
  (macOS 14+) so the page runs as if visible.

### CF-051 · missing · `partly resolved`: a webui app on macOS has no menu bar
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

### CF-054 · bug · `open`: `fs.write_all` is documented as atomic but is not; `fs.rename` is undocumented
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

### CF-057 · bug · `open`: `ext:json` ignores the `default:"…"` struct tag
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

### CF-058 · bug · `open`: `cfire build <target>` builds every target
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

### CF-059 · bug · `open`: `s.find(x)` on a `str` compiles to `std::string::find` and returns `npos`
- **At `466751b`:** not in the 466751b batch. Still prints `found at 18446744073709551615`. The checker now treats `str.find` as optional (CF-063), but the runtime still returns `npos`.
- **Repro:** `s := "abc"; i := s.find(";"); if i < 0 { … } else { println("found at {i}") }`
  prints `found at 18446744073709551615` (cfire 0.9.4). `find` is not in the `str`
  method set the docs list (`str.index_of` is, returning `-1`), but the call passes
  through to C++ unchecked, and `i < 0` on the unsigned result is silently always
  false. Found writing the OSC 52 parser (milestone 08): a missing `;` read as found.
- **Workaround:** `str.index_of(s, x)` and `s.contains(x)` (`src/application/terminal.cf`).
- **Ideal:** an unknown method on `str` is a compile error, or `find` returns `i64`
  with `-1` like `index_of`. A comparison of an unsigned value with `< 0` warns.

### CF-060 · bug · `open`: a `str` slice passes to no `str` parameter, and cannot be interpolated
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

### CF-062 · bug · `confirmed`: `[]byte` changed C++ type with no diagnostic from cfire
- **Repro (466751b):** `msg: []byte = [7, 7]` and `buf[i] = u8(x)` passed `cfire check` and
  built at `3963814`; now clang fails (`no matching constructor for initialization of
  'std::vector<std::byte>'`, `assigning to 'std::byte' from incompatible type
  'std::uint8_t'`). `cfire check` still passes, so the break shows only in clang.
- **Context:** the change itself is the fix for CF-021/CF-055 and is welcome. Flint migrated
  ~40 sites: `byte(n)` literals, `[]byte("text")`, `str(bytes)`, and `cfire::c_arg(v.data())`
  to hand a `[]byte` to a C API taking `unsigned char*`.
- **Ideal:** `cfire check` reports an integer literal or a `u8` stored into `[]byte` with a
  fix-it (`byte(...)`), and the changelog says `[]byte` now lowers to `std::byte`.

### CF-063 · bug · `confirmed`: the checker takes `os.getenv` for an optional (false `NULL-DEREF`)
- **Repro (466751b):** `override := os.getenv("X")` then `if override.len() > 0 { … }` →
  `member access on potentially null pointer 'override' without '!= none' guard
  (cfire/NULL-DEREF)`. `os.getenv` returns `str` (`runtime/core/os.hpp`), but
  `expr_returns_optional_sema` (`src/sema.hpp`) lists `getenv` by name as optional. The
  same list marks `str.find` optional, while it still returns `npos` at run time (CF-059).
- **Workaround:** annotate the binding: `override: str = os.getenv("X")` (5 files).
- **Ideal:** derive optionality from the declared signature, not from a list of names.

### CF-064 · bug · `confirmed`: `os.getpid()` no longer compiles
- **Repro (466751b):** `"{os.getpid()}"` → clang `no member named 'getpid' in namespace
  'cfire::os'`. At `3963814` the call passed through to `::getpid()`. `core:os` never
  documented it, but nothing in cfire rejects it either.
- **Workaround:** a random tag (`hex.encode(rand.bytes(4))`) for unique test names.
- **Ideal:** `os.getpid() -> i64`, or a cfire diagnostic for an unknown `os.` member.

### CF-065 · bug · `confirmed`: a struct field named `stdout` is renamed, but not inside `cpp {}`
- **Repro (466751b):** `type ExecChunk struct { stdout: str }`, then
  `cpp { read(chunk.stdout); }` → clang `no member named '__stdoutp' in 'ExecChunk'`.
  The CF-038 fix emits the field as `stdout_cf_`; the text of a `cpp {}` block is left as
  written, so it names a field that no longer exists.
- **Workaround:** the block fills locals and the struct is built in cfire
  (`link_channel_read` in `src/adapters/ssh/link.cf`).
- **Ideal:** rename identifiers inside `cpp {}` too, or report the mismatch in `cfire check`.

### CF-066 · bug · `confirmed`: every struct gets JSON code, including ones that hold a `webui.App`
- **Repro (466751b):** `type Sink struct { app: webui.App }` in a program that imports
  `ext:webui` → clang `the supplied type is not formattable` from the generated
  `stringify_struct<Sink>`. The CF-049 fix registers all structs for JSON, even those that
  are never serialised and hold non-serialisable types.
- **Workaround:** tag the field `` `json:"-"` `` (`src/adapters/uievents/`).
- **Ideal:** generate JSON code only for structs that reach `json.*` or an RPC, or skip
  fields whose type has no JSON form.

### CF-067 · bug · `confirmed`: `xs.push([a, b])` no longer compiles
- **Repro (466751b):** `mut rows: [][]str = []` then `rows.push(["a", "b"])` → clang
  `no matching function for call to 'vec_push'`. `push` now lowers to the template
  `cfire::vec_push(vec, U&& val)`, which cannot deduce a braced list.
- **Workaround:** `row: []str = ["a", "b"]; rows.push(row)` (`src/drivers/cli/output.cf`).
- **Ideal:** lower the literal with the element type (`std::vector<std::string>{…}`), as
  the CF-040 fix does for `or []`.

### CF-068 · bug · `confirmed`: errors in one file of a package are reported against the test file
- **Repro (466751b):** a compile error at `src/adapters/ssh/link.cf:188` while running
  `cfire test src/drivers/cli` is printed as `src/drivers/cli/import_test.cf:188:68`. The
  line is right, the file is the test file being run. Found throughout the migration.
- **Ideal:** keep each source file's name in the `#line` directives of the merged unit.

### CF-069 · bug · `confirmed`: **`sqlite.open_encrypted` writes a plaintext database**
- **Repro (466751b):** `sqlite.open_encrypted("/tmp/x.db", "pw")`, create a table, insert
  `"TOP-SECRET-PAYLOAD"` → succeeds; the file starts with `SQLite format 3` and the value is
  readable with `grep`. `ext:db/sqlite` links the system `sqlite3`, which ignores
  `PRAGMA key` silently. The response to CF-007 says the build detects SQLCipher and sets
  `-DSQLITE_HAS_CODEC`; that code is not in `src/buildsys.hpp`.
- **Ideal:** link SQLCipher whenever `open_encrypted` is used, and fail (at build time, or
  at open with `PRAGMA cipher_version` empty) when it is not available. Never fall back to
  plaintext.
- **Flint:** unaffected (its own SQLCipher adapter, CF-007).

### CF-070 · bug · `confirmed`: `ext:crypto/sodium` falls back to other algorithms without libsodium
- **Source (466751b):** `runtime/core/sodium.hpp`. Without `CFIRE_SODIUM_NATIVE`,
  `sodium.argon2id` returns PBKDF2-SHA256 of a modified salt (not Argon2id, not
  memory-hard, a different output), and `xchacha20poly1305_*` use a hand-written
  ChaCha20/Poly1305. The caller cannot tell which one ran.
- **Why it matters:** a vault sealed on a machine without libsodium cannot be opened on
  one with it, and is weaker than its code says.
- **Ideal:** no fallback: a build error when libsodium is missing.
- **Flint:** unaffected (its own libsodium adapter, CF-006; Principle 4 forbids
  hand-rolled cryptography).

### CF-071 · bug · `confirmed`: `ext:keychain` does not persist on Linux and leaks the secret
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

### CF-072 · bug · `confirmed`: reinstalling over an existing binary on macOS kills it; the installer cannot pin a build
- **Repro:** `cp new/cfire ~/.local/bin/cfire` over the existing file (what `install.sh`
  does), then `cfire --version` → killed with SIGKILL (exit 137). macOS caches the code
  signature per file; `rm` before `cp` (a new file) works.
- **Also:** `install.sh` builds a GitHub tarball (no `.git`), so the CF-011 SHA is `dev`;
  and `CFIRE_VERSION` only takes a branch (`refs/heads/…`), so a commit or tag cannot be
  installed.
- **Ideal:** install to a temp name and `mv` it into place; accept a commit or tag; pass
  the SHA to `make` (`GIT_SHA=…`); publish tagged releases.

### CF-073 · bug · `confirmed`: webui's built-in macOS menu takes ⌘W from the page, with no opt-out
- **Repro (466751b):** `App.run()` now always sets `NSApp.mainMenu` (the CF-051 fix), with
  Window → Close Window on ⌘W and Quit on a handler of its own. An app whose page uses ⌘W
  (Flint closes a terminal tab with it) gets the window closed instead. A menu the app
  set before `run()`, as Flint did for CF-051, is replaced.
- **Workaround:** Flint queues its own menu on the main queue before `run()`, so it is set
  after webui's and replaces it (`install_app_menu` in
  `src/adapters/uievents/native/flint_gui.hpp`).
- **Ideal:** a way to turn the built-in menu off, or to declare which shortcuts the page
  owns; Quit through the same close path as the window's close button.

### CF-074 · bug · `confirmed`: `cfire ide claude` writes LSP files Claude Code never loads
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

### CF-075 · bug · `open`: the runtime's system simdjson does not compile on Ubuntu 24.04 with clang 19
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

### CF-076 · bug · `open`: a failed clang AST ingestion prints the whole AST as JSON
- **At `2d8613d`:** when ingesting an `import cpp` header fails, the error message is
  followed by the AST dump: 11.7 million lines for `flint_ssh.hpp`, so the one useful line
  (`error: use of undeclared identifier 'ssh_channel_get_exit_state'`) is lost unless the
  log is searched for `error:`.
- **Repro:** a header that calls a function the installed library lacks (Flint against
  libssh 0.10), then `cfire build`.
- **Ideal:** print clang's diagnostics only; keep the dump behind a verbose flag.

### CF-077 · gap · `open`: `ext:webui` file dialogs are macOS-only and silently return "" on Linux
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
