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
  - `confirmed`: hit while building Flint, with a repro.
  - `reported`: handed to the cfire author.
  - `fixed in cfire`: the fix exists upstream.
  - `integrated`: Flint uses the fix and the shim is deleted.
- Each entry gives: what Flint needed, a minimal repro or source pointer, the workaround and
  where it lives, and what an ideal API would look like.

The first entries below came from reading cfire at commit `feat(webui): add ext:webui …`
(2026-11-04). They are `suspected` until milestone 01 confirms or discards them.

---

### CF-001 · missing · `suspected`: Windows backend for `ext:webui` (WebView2)
- **Needed:** Flint (and Tether before it) targets Windows.
- **Source:** `runtime/core/webui.hpp` has WKWebView (macOS/iOS) and WebKitGTK (Linux)
  backends only.
- **Workaround:** none. Windows is out of the MVP.
- **Ideal:** a WebView2 backend with the same `webui.App` API.

### CF-002 · bug · `confirmed`: `App.emit()` retains every payload forever
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

### CF-003 · improvement · `confirmed`: high-throughput / binary event channel
- **Needed:** terminal output is raw bytes at high rates.
- **Source:** `emit()` JSON-stringifies the payload and calls `eval_js(...)` once per event.
  Bytes must be base64 or escaped strings, and each event is a separate JS evaluation.
- **Confirmed (M01):** the PTY spike (`spike/pty-webui`) has to base64-encode each chunk
  (`src/adapters/uievents/webui_sink.cf`), because PTY output is not guaranteed to be
  valid UTF-8 inside a JSON string. Each chunk is one `evaluateJavaScript` call.
  Throughput has not been measured yet.
- **Ideal:** a binary streaming channel to the page (custom scheme, `postMessage` with
  `ArrayBuffer`, or a local websocket), plus optional batching.

### CF-004 · missing · `suspected`: OS file drag & drop into the webview
- **Needed:** SFTP upload by dropping files from Finder or the file manager (roadmap `next`).
- **Source:** no drop handler in `webui.hpp`. The page cannot get real paths for dropped
  files.
- **Ideal:** an event such as `files:dropped` with absolute paths and the drop coordinates.

### CF-005 · missing · `confirmed`: SSH client module
- **Needed:** the core of Flint: PTY, exec, SFTP, agent, port forwarding, known_hosts.
- **Confirmed (M01):** cfire has no SSH support.
- **Workaround:** `src/adapters/ssh/libssh.cf` over the system libssh
  (`import cpp "libssh/libssh.h" @pkg("libssh")`): dial with timeout, host-key
  fingerprint, key-by-content auth, PTY shell, read with timeout, resize. No
  `build.CMake` needed; `@pkg` resolves it through pkg-config (D-012).
- **Ideal:** `ext:net/ssh`, so a 15-line SSH client is possible in cfire.

### CF-006 · missing · `confirmed`: vetted crypto: Argon2id, XChaCha20-Poly1305
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

### CF-007 · missing · `confirmed`: encrypted SQLite in `ext:db/sqlite`
- **Needed:** the vault file must be encrypted in full.
- **Source:** `ext:db/sqlite` links the system `sqlite3`.
- **Confirmed (M01):** no key parameter or cipher build in `ext:db/sqlite`.
- **Workaround:** `src/adapters/vault/sqlcipher.cf` over the system SQLCipher
  (`import cpp "sqlite3.h" @pkg("sqlcipher")`), keyed with a raw 32-byte key (D-013,
  D-014). Flint does not import `ext:db/sqlite` anywhere, so the two `sqlite3` builds never
  meet in one binary. Untried: what happens if they did.
- **Ideal:** `sqlite.open(path, key: bytes)` backed by a cipher build.

### CF-008 · missing · `confirmed`: OS keychain module
- **Needed:** cache the derived vault key per machine (macOS Keychain, Linux Secret Service,
  later Windows Credential Manager).
- **Workaround (M02):** `src/adapters/keychain/` over Security.framework (macOS) and
  libsecret (Linux), in one native header (`native/flint_keychain.hpp`) because cfire
  cannot select per-platform sources or link a framework (CF-031).
- **Ideal:** `ext:keychain` with `set`, `get` and `delete(service, account)`.

### CF-009 · missing · `confirmed`: repository licence
- **Needed:** Flint is to be released as open source on top of cfire and its runtime headers.
- **Source:** the GitHub API reports no licence for `gsandoval/cfire`.
- **Ideal:** an OSI licence (MIT or Apache-2.0) covering the compiler and `runtime/`.

### CF-010 · missing · `suspected`: Windows support in the core runtime
- **Source:** `core:os/exec` uses `posix_spawnp`, `core:os/signal` uses POSIX signals,
  `runtime/core/sqlite.hpp` has `#if !defined(_WIN32)`, and the guide documents Windows only
  via WSL2.
- **Ideal:** native Windows (MSVC or clang-cl) builds of `core:*`.

### CF-011 · improvement · `confirmed`: `cfire --version` does not identify the build
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

### CF-012 · bug · `confirmed`: `cfire new` templates write a `build.cf` that `cfire build` rejects
- **Repro:** `cfire new --template webui app && cd app && cfire build` →
  `error: no executables declared in …/build.cf`. Every template does the same.
- **Source:** the templates in `src/main.cpp` emit `app := Executable{ name: …, entry: … }`,
  but `parse_build_cf` (`src/buildsys.hpp`) only recognises
  `var X = build.Executable("name", { Entry: … })` after `import "core:build"`.
- **Workaround:** Flint's `build.cf` uses the `build.Executable` form from `docs/GUIDE.md`.
- **Ideal:** templates emit the form the parser accepts, and a `cfire test` covers
  `cfire new` + `cfire build` for every template.

### CF-013 · bug · `confirmed`: the `as` cast is documented but does not parse
- **Repro:** `package main` / `fn main() { x := 3; y := x as u8; println("{}", y) }` →
  `unexpected token 'as' in expression`. `docs/GUIDE.md` (Chapter 4) and `cfire doc --llm`
  both document `expr as T`. In the parser, `KwAs` is only used for import aliases.
- **Workaround:** function-style conversion, `u8(x)`, which works.
- **Ideal:** implement `as`, or document `T(x)` as the conversion syntax.

### CF-014 · bug · `confirmed`: top-level `const` is documented but does not parse
- **Repro:** `package main` / `const K: i64 = 3` / `fn main() { println("{}", K) }` →
  `unexpected identifier 'const' at top-level`. Documented in GUIDE Chapter 4.
- **Workaround:** `var K: i64 = 3`. These globals are mutable.
- **Ideal:** `const` lowered to `constexpr`, as documented.

### CF-015 · bug · `confirmed`: the `panic()` builtin lowers to an undeclared identifier
- **Repro:** `fn f(x: i64) -> i64 { if x < 0 { panic("neg") } return x }` plus a `main`
  that calls it → clang `use of undeclared identifier 'panic'`.
- **Workaround:** return an error instead. That also blocks `or err { panic(…) }`, which
  `cfire/NON-DIVERGING-OR-BLOCK` suggests.
- **Ideal:** lower `panic` to the prelude's panic routine.

### CF-016 · bug · `confirmed`: a sibling or test file that fails to parse is dropped silently
- **Repro:** a package dir with `a.cf` (`package p` / `const K: i64 = 1` / `fn f() -> i64 { return K }`)
  and `a_test.cf` (`package p` / `test "t" { assert_eq(f(), 1) }`). `cfire test dir` reports
  `use of undeclared identifier 'f'` from clang, not the parse error in `a.cf`. If the
  parse error is in the test file itself, `cfire test dir` prints
  `✓ No test suites found` and exits 0.
- **Source:** `src/buildsys.hpp` (`if (item.is_auto_sibling) continue;`) and the directory
  walk in the `test` command (`if (!ast) continue;`).
- **Ideal:** report every parse error, and fail `cfire test` when any `.cf` file in the
  target cannot be parsed.

### CF-017 · bug · `confirmed`: packages are not namespaced in the generated C++
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

### CF-018 · improvement · `confirmed`: the `cfire test` fd-leak canary has no opt-out
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

### CF-019 · bug · `confirmed`: raw foreign pointers: `none` and parameters lower wrongly
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

### CF-020 · bug · `confirmed`: identifiers that are C++ keywords break the build
- **Repro:** `fn main() { short := 3; println("{}", short) }` → clang
  `expected unqualified-id`. The same happens for `short`, `long`, `class`, `template`,
  and so on.
- **Ideal:** mangle C++ reserved words in emitted identifiers, or reject them in `cfire check`.

### CF-021 · improvement · `confirmed`: `fs.read_all` infers `std::vector<std::byte>`, not `[]byte`
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

### CF-022 · missing · `confirmed`: no string-to-integer parsing in the stdlib
- **Needed:** reading a port from an environment variable.
- **Source:** nothing in `core:str` or `cfire doc --llm`. `cfire::detail::parse_int<T>`
  exists in the prelude but is not exposed.
- **Workaround:** `std::atoi` in a `cpp {}` block (`src/adapters/ssh/libssh_test.cf`).
- **Ideal:** `str.parse_i64(s) -> i64!`, and the same for the other numeric types.

### CF-023 · bug · `confirmed`: `Error.message()` does not convert to `str`
- **Repro:** `fn take(s: str) -> i64 { return i64(s.len()) }`, then
  `_ := f() or err { println("{}", take(err.message())); return }` → clang
  `no matching function for call to 'take'` (`message()` is a `std::string_view`).
- **Workaround:** interpolate: `"{err.message()}"` (`src/application/terminal.cf`).
- **Ideal:** `message()` returns `str`, or `std::string_view` converts implicitly to a
  `str` parameter.

### CF-024 · missing · `confirmed`: CLI building blocks: argv, positional args, stderr
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

### CF-025 · bug · `confirmed`: comma-separated struct fields, as documented, do not parse
- **Repro:** `type U struct { id: i64, name: str }` (the form in `cfire doc --llm`) →
  `expected 'IDENT', got ','`. The multi-line form with trailing commas fails the same way.
- **Workaround:** one field per line, no commas.
- **Ideal:** accept commas, or fix the reference sheet.

### CF-026 · missing · `confirmed`: concurrency primitives beyond `async.scope` and channels
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

### CF-027 · bug · `confirmed`: a `bind` closure cannot return both `error(…)` and a value
- **Repro:** `app.bind[Req]("x") |req| { if req.n < 0 { return error("neg") } return "ok" }`
  → clang `'auto' in return type deduced as 'std::string' here but deduced as
  'unexpected<cfire::Error>' in earlier return statement`. `try` inside the closure fails
  the same way. Example `17-webui-studio` uses this pattern too.
- **Workaround:** handlers return a `{ ok, detail }` struct (the M01 spike). Since M04 the
  GUI binds with `bind_raw` and each closure is a single `return rpc_x(…)` call to a
  named function returning `str!` (`src/drivers/gui/rpc.cf`); `bind_raw` lambdas hit the
  same deduction error as soon as they mix `try` with a value.
- **Ideal:** infer `T!` for closures that return `error(…)`, so the JS promise rejects.

### CF-028 · bug · `confirmed`: a placeholder `/index.html` shadows `serve_dir`
- **Repro:** the `webui` template (`app.serve_dir("./ui")` with a real `ui/index.html`)
  shows "cfire WebUI Ready" instead of the page.
  `app.resolve_asset_content("/index.html")` returns the 215-byte placeholder.
- **Source:** the `AppState()` constructor puts a default `/index.html` into
  `embedded_assets`, and `resolve_asset` checks `embedded_assets` before `serve_dirs`.
- **Workaround:** read the page and `set_html()` it; other assets still come from
  `serve_dir` (`src/drivers/gui/main.cf`).
- **Ideal:** fall back to the placeholder only when no served directory has the file.

### CF-029 · bug · `confirmed`: `run_webview_test` is a no-op that returns `true` on Linux
- **Source:** `runtime/core/webui.hpp`, `run_webview_test`: the body is
  `#if defined(__APPLE__) …`, and every other platform runs `return true;`. A headless
  WebView test therefore passes on Linux without loading the page.
- **Workaround:** on Linux the GUI end-to-end run (`scripts/gui-e2e.sh`) opens the real
  GTK window with `app.run()` under `xvfb-run` and checks for `e2e: pass`
  (`scripts/linux/inside.sh`).
- **Ideal:** a WebKitGTK implementation (it can run under `xvfb-run`), or fail with "not
  supported on this platform" instead of passing.

### CF-030 · bug · `confirmed`: Linux webui builds fail on a PCH `-pthread` mismatch; `CFIRE_CXX` is ignored
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

### CF-031 · missing · `confirmed`: no way to link a framework, pick per-platform sources, or write top-level C++
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

### CF-032 · bug · `confirmed`: `[][]T!` binds `!` to the element type
- **Repro:** `fn rows() -> [][]Cell! { mut r: [][]Cell = []; return r }` → clang
  `no viable conversion from 'vector<vector<Cell>>' to
  'vector<vector<std::expected<Cell, cfire::Error>>>'`.
- **Workaround:** wrap the matrix in a struct (`SqlRows` in
  `src/adapters/vault/sqlcipher.cf`). `[]T!` works.
- **Ideal:** `!` applies to the whole return type, as with `[]T!`; `([][]T)!` as an
  explicit form.

### CF-033 · bug · `confirmed`: structs are emitted in declaration order, not dependency order
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

### CF-034 · bug · `confirmed`: a string literal inside an interpolation breaks the string
- **Repro:** `msg := "{f("x")}"` → `call to 'f' expects 1 argument(s), got 6`;
  `dir := "/tmp/" + "{os.getenv("USER")}"` → clang `use of undeclared identifier 'USER'`.
- **Workaround:** bind the inner call to a local first.
- **Ideal:** lex `{…}` as a nested expression, quotes included (as Swift, Kotlin and
  Python 3.12 do), or reject it in `cfire check` with a clear message.

### CF-035 · bug · `confirmed`: `match` arms that yield a string literal and a `str` do not compile
- **Repro:** `return match v { E::Text(s) => s, E::Int(n) => "{n}", _ => "" }` → clang
  `std::visit requires the visitor to have a single return type` (`const char*` vs
  `std::string`).
- **Workaround:** assign to a `mut` local inside block arms.
- **Ideal:** give every arm the match's declared or inferred type (`str`).

### CF-036 · bug · `confirmed`: `if x != none` does not narrow an optional
- **Repro:** `f := find(items, 2)` (`-> Item?`), then `if f != none { println("{f.id}") }`
  → clang `no member named 'id' in 'std::optional<Item>'`.
- **Workaround:** `f.value()` inside the branch, or `find(...) or fallback`.
- **Ideal:** flow-narrow `T?` to `T` after a `!= none` check, as the null-safety rules for
  pointers already do.

### CF-037 · bug · `confirmed`: a `str?` field breaks `json.stringify`
- **Repro:** ``type Item struct { note: str? `json:"note"` }``, then
  `json.stringify(Item{ note: none })` → clang `no viable conversion from
  'const std::optional<std::string>' to 'std::string_view'`.
- **Workaround:** Flint's JSON views use `str` with `""` for "none".
- **Ideal:** optional fields serialise as `null` (or are omitted) and parse back.

### CF-038 · improvement · `confirmed`: `os.ExecResult` fields are undocumented, and `.stdout` hits a libc macro
- **Repro:** `r := try os.command("ssh-keygen", [...])`, then `r.stdout` → clang
  `no member named '__stdoutp' in 'cfire::os::ExecResult'` on macOS (`stdout` is a macro).
  The real fields are `exit_code`, `stdout_str` and `stderr_str`, which `cfire doc --llm`
  does not list.
- **Ideal:** document the fields; mangle identifiers that collide with C macros.

### CF-039 · bug · `confirmed`: `cfire fmt` mis-indents everything after a multi-line raw string in a struct literal
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

### CF-040 · bug · `confirmed`: `x or []` does not compile with libstdc++
- **Repro (Debian trixie, clang 19, libstdc++ 14):** `fn f() -> []byte! { … }`, then
  `b := f() or []` → lowers to `f().value_or({})` → `no matching member function for call
  to 'value_or'` (`couldn't infer template argument '_Up'`). libc++ (macOS) accepts it, so
  the code builds on one platform only.
- **Workaround:** `r := f()` then `if r.has_value() { … r.value() … }`
  (`src/application/session.cf`).
- **Ideal:** lower the fallback with the expected's value type:
  `value_or(std::vector<std::uint8_t>{})`.

### CF-041 · bug · `confirmed`: `os.command` does not link on Linux
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

### CF-042 · missing · `confirmed`: no terminal raw mode, window size or signal handlers
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

### CF-043 · missing · `confirmed`: no socketpair, poll or threads for a byte-stream bridge
- **Repro:** a jump host is a libssh channel that must look like a socket to the next
  libssh session (`SSH_OPTIONS_FD`). That takes a `socketpair`, a thread that `poll`s one
  end and copies bytes to and from the channel under the session's mutex, and a join on
  shutdown. cfire has no socketpair, no poll over raw fds, and its threads cannot be
  stored in a struct and joined later (see CF-026 for the mutex half).
- **Workaround:** `flint_ssh::open_tunnel` / `close_tunnel` in
  `src/adapters/ssh/native/flint_ssh.hpp`, owned by `SshLink.tunnels`.
- **Ideal:** `net.socketpair()`, `os.poll([]Fd, timeout_ms)`, and a joinable
  `Thread` value type.

### CF-044 · bug · `confirmed`: `assert_eq` against a slice literal does not compile
- **Repro:** in a test, `mut xs: []str = []`, `xs.push("a")`, `assert_eq(xs, ["a"])`.
  The literal lowers to a bare braced list (`{"a"}`), which cannot deduce the template
  parameter of `cfire::assert_binop_at`: `no matching function for call to
  'assert_binop_at'` (cfire 0.9.4).
- **Workaround:** compare the length and then each element
  (`src/application/connect_test.cf`, the host key preference checks).
- **Ideal:** lower a slice literal in `assert_eq`/`assert_ne` to the type of the other
  operand.

### CF-045 · missing · `confirmed`: no way to list installed fonts
- **Needed:** Settings → Terminal lists every installed monospaced font. A webview
  cannot enumerate fonts (WKWebView and WebKitGTK have no Local Font Access API).
- **Workaround:** `src/adapters/fonts/native/flint_fonts.hpp`: CoreText on macOS
  (families with `kCTFontTraitMonoSpace`), `fc-list :spacing=mono family` on Linux.
  CoreText is linked through `flint-native.pc` (CF-031).
- **Ideal:** `ext:webui` (or an `os:fonts` module) returning font families with a
  monospace flag.

### CF-046 · improvement · `confirmed`: webui RPC handlers run on the UI thread
- **Repro:** a `bind` handler that takes one second (Argon2id at 256 MiB, an SSH dial)
  freezes the window for that second: `handle_ipc_message` calls the handler inline
  from the WKWebView message callback.
- **Workaround:** the GUI driver spawns long work on an `async.scope` worker and
  answers through events (`src/drivers/gui/`). This works: `scope.spawn` from a
  handler and `app.emit` from the worker are both safe. Session workers then need
  their own mailbox for keystrokes and prompt answers (CF-026).
- **Ideal:** document the threading model, and offer `bind_async` that runs the
  handler on a pool and resolves the JS promise when it returns.

### CF-047 · bug · `confirmed`: `x or <value>` does not compile when `x` is `void!`
- **Repro:** `fn f() -> void! { }` then `_ := f() or false`. The lowering calls
  `value_or(false)` on `std::expected<void, cfire::Error>`, which has no `value_or`
  (cfire 0.9.4).
- **Workaround:** `r := f()` then branch on `r.has_value()`.
- **Ideal:** reject it with a cfire diagnostic, or lower `void! or _` to "ignore the
  error".

### CF-048 · bug · `confirmed`: `x = f() or err { … }` ignores the `or` block
- **Repro:** `mut content := ""` then `content = fs.read_text(path) or err { return
  error("…") }`. The assignment lowers to `content = cfire::fs::read_text(path);` with
  no unwrap and no error branch, and clang rejects assigning a
  `std::expected<std::string, cfire::Error>` to a `std::string` (cfire 0.9.4). The
  declaration form `text := … or err { … }` works.
- **Workaround:** bind to a new name, then assign (`rpc_key_add` in
  `src/drivers/gui/rpc.cf`).
- **Ideal:** lower `or` the same way in assignments and declarations.

### CF-049 · bug · `confirmed`: `ext:json` skips struct fields without a `json` tag
- **Repro:** `type P struct { alias: str }`, then `json.parse[P]("{\"alias\":\"web\"}")`
  gives `alias == ""`, and `json.stringify(P{ alias: "x" })` gives `{}` (cfire 0.9.4).
  No error either way, so a request decodes to zero values silently.
- **Workaround:** tag every field that crosses JSON (`HostPatch`, `CredPatch` in
  `src/application`, for the GUI's RPC requests).
- **Ideal:** default to the field name when there is no tag, as Go does, or reject the
  type at compile time.

### CF-050 · improvement · `confirmed`: the headless WebView runner throttles timers
- **Repro:** in `run_webview_test`, a page that waits with `setTimeout(…, 50)` in a
  loop slows to about one wake-up every several seconds after a while, because the
  window is never shown and WebKit throttles a hidden page's timers (and never runs
  `requestAnimationFrame`). A UI test that polls the DOM then looks hung.
- **Workaround:** `scripts/gui-e2e.js` waits on `MessageChannel` posts, which are not
  throttled.
- **Ideal:** `run_webview_test` sets `WKPreferences.inactiveSchedulingPolicy = .none`
  (macOS 14+) so the page runs as if visible.

### CF-051 · missing · `confirmed`: a webui app on macOS has no menu bar
- **Repro:** run any `ext:webui` app on macOS and press ⌘Q: nothing happens. ⌘C, ⌘V,
  ⌘X, ⌘A and ⌘Z do nothing in the page's text fields either. `App.run()` creates the
  `NSApplication` and the window but never sets `NSApp.mainMenu`, and AppKit delivers
  those keys to a `WKWebView` only through menu items (`terminate:`/`copy:`/`paste:`…).
- **Workaround:** `src/adapters/uievents/native/flint_gui.hpp` (`install_app_menu`)
  sets the standard app / Edit / Window menus before `app.run()`; Quit sends
  `performClose:` so webui's normal close path still runs.
- **Ideal:** webui installs the standard menus itself (app name from `new_app`), and
  takes an optional menu description so an app can add its own items and shortcuts.

### CF-052 · missing · `confirmed`: no app icon (or bundle id) for a GUI executable
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

### CF-053 · missing · `confirmed`: no clipboard API in `ext:webui` (or anywhere in cfire)
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

### CF-054 · bug · `confirmed`: `fs.write_all` is documented as atomic but is not; `fs.rename` is undocumented
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

### CF-055 · bug · `confirmed`: `str.bytes()` and `[]byte` are different C++ types
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

### CF-056 · bug · `confirmed`: a parse error in one file of a package is reported as C++ errors in the others
- **Repro:** name a local `out` (a reserved word: the `out` parameter intent) in one
  file of a package, then `cfire test <dir>`. The file is silently left out, and the
  output is clang's `unknown type name 'FakeCrypto'` / `use of undeclared identifier
  'SALT_LEN'` in the *other* files. The real message (`expected 'IDENT', got 'out'`)
  appears only from `cfire check <file>` (or `cfire_check` over MCP), buried among
  the cascade. Hit three times in milestone 07.
- **Workaround:** run `cfire check` on the edited file when a package fails this way.
- **Ideal:** stop at the parse error and print it first; and a message that says `out`
  is reserved (`'out' is a parameter intent and cannot name a variable`).

### CF-057 · bug · `confirmed`: `ext:json` ignores the `default:"…"` struct tag
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

### CF-058 · bug · `confirmed`: `cfire build <target>` builds every target
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

### CF-059 · bug · `confirmed`: `s.find(x)` on a `str` compiles to `std::string::find` and returns `npos`
- **Repro:** `s := "abc"; i := s.find(";"); if i < 0 { … } else { println("found at {i}") }`
  prints `found at 18446744073709551615` (cfire 0.9.4). `find` is not in the `str`
  method set the docs list (`str.index_of` is, returning `-1`), but the call passes
  through to C++ unchecked, and `i < 0` on the unsigned result is silently always
  false. Found writing the OSC 52 parser (milestone 08): a missing `;` read as found.
- **Workaround:** `str.index_of(s, x)` and `s.contains(x)` (`src/application/terminal.cf`).
- **Ideal:** an unknown method on `str` is a compile error, or `find` returns `i64`
  with `-1` like `index_of`. A comparison of an unsigned value with `< 0` warns.

### CF-060 · bug · `confirmed`: a `str` slice passes to no `str` parameter, and cannot be interpolated
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

### CF-061 · bug · `confirmed`: `x := f() or []` builds with libc++ but not libstdc++
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
