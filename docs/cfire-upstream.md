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

### CF-002 · bug · `suspected`: `App.emit()` retains every payload forever
- **Needed:** a terminal emits thousands of events per minute for hours.
- **Source:** `runtime/core/webui.hpp`, `emit()` (~line 817). Every payload is pushed into
  `state_->emitted_history[event]` with no bound, and `set_state()` does the same. This is
  useful for `emitted_events_count` in tests, but it is unbounded memory growth in a running
  app.
- **Ideal:** record history only in test mode, or keep a bounded ring buffer.

### CF-003 · improvement · `suspected`: high-throughput / binary event channel
- **Needed:** terminal output is raw bytes at high rates.
- **Source:** `emit()` JSON-stringifies the payload and calls `eval_js(...)` once per event.
  Bytes must be base64 or escaped strings, and each event is a separate JS evaluation.
- **Ideal:** a binary streaming channel to the page (custom scheme, `postMessage` with
  `ArrayBuffer`, or a local websocket), plus optional batching.

### CF-004 · missing · `suspected`: OS file drag & drop into the webview
- **Needed:** SFTP upload by dropping files from Finder or the file manager (roadmap `next`).
- **Source:** no drop handler in `webui.hpp`. The page cannot get real paths for dropped
  files.
- **Ideal:** an event such as `files:dropped` with absolute paths and the drop coordinates.

### CF-005 · missing · `suspected`: SSH client module
- **Needed:** the core of Flint: PTY, exec, SFTP, agent, port forwarding, known_hosts.
- **Workaround (planned):** `adapters/ssh/` over libssh or libssh2 via `import cpp` plus
  `build.CMake`.
- **Ideal:** `ext:net/ssh`, so a 15-line SSH client is possible in cfire.

### CF-006 · missing · `suspected`: vetted crypto: Argon2id, XChaCha20-Poly1305
- **Needed:** master-password key derivation and secret AEAD.
- **Source:** `core:crypto/aes` is a header-only AES-GCM implementation. Its constant-time
  properties are unaudited, and there is no password KDF.
- **Workaround (planned):** `adapters/crypto/` over libsodium.
- **Ideal:** `ext:crypto/sodium` (or a libsodium-backed `core:crypto/*`).

### CF-007 · missing · `suspected`: encrypted SQLite in `ext:db/sqlite`
- **Needed:** the vault file must be encrypted in full.
- **Source:** `ext:db/sqlite` links the system `sqlite3`.
- **Workaround (planned):** build SQLite3MultipleCiphers or SQLCipher as a vendored
  dependency.
- **Ideal:** `sqlite.open(path, key: bytes)` backed by a cipher build.

### CF-008 · missing · `suspected`: OS keychain module
- **Needed:** cache the derived vault key per machine (macOS Keychain, Linux Secret Service,
  later Windows Credential Manager).
- **Workaround (planned):** `adapters/keychain/` over Security.framework and libsecret.
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
