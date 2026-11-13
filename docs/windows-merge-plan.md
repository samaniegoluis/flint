# Merge main (milestones 32-42) into windows-port-2: working plan

**Disposable.** Lives only on `windows-port-2`; deleted in stage 4 once its results are in
`docs/windows-port-guide.md` and `docs/build-log.md`. Update the checkboxes and the
**Log** at the end of every step, and commit with the step, so a fresh session can resume
from this file alone.

## Context

- `windows-port-2` last took main at `9ab8a04` (2026-11-11, milestone 31). main is at
  `6e9cdf0` (2026-11-13, v0.9.0, milestone 42): **103 commits, milestones 32-42**.
- Goal (owner, 2026-11-13): all of main in this branch, running well on Windows, pushed
  today. The repo goes public today; cfire's author then uses this branch as the base for
  making cfire fit Flint on Windows. The owner adds two large changes to main today; they
  are merged here afterwards, the same way.
- cfire is unchanged: both sides on `c5b1d4b` + patches 0001-0009
  (`~/Personal/Proyectos/cfire/cfire-windows`, branch `windows-fixes`).
- Trial merge (`git merge-tree`): **one conflict**, `src/adapters/process/native/flint_fs.hpp`.
  Auto-merged but to be read by hand: `src/adapters/rdp/native/flint_rdp.hpp` (+909 on main
  over the branch's `_WIN32` fixes), `scripts/gui-e2e.js` (+814),
  `src/application/session.cf`, `src/drivers/gui/rpc.cf`, `src/drivers/clicmd/*.cf`.

## Rules for this work

- **Merge, never rebase or rewrite**: the branch is shared.
- Tag every claim `[ran]` (run on Windows) or `[compiled]`.
- A timeout on every app launch; never two cfire builds of the same package at once.
- Stop at the first failed step and read its log before rerunning (CLAUDE.md rule 9).
- Something stuck stays degraded and documented, not hidden; push at the end of each stage.
- Windows findings in cfire go to `docs/cfire-windows.md` (W-18+, "after the handoff").

## Stage 1: merge, build, suites → push

- [x] `git merge main` in `~/Personal/Proyectos/cfire/flint-windows`
- [x] Resolve `flint_fs.hpp`: main's `chmod_path`, `sync_dir`, `real_path` go inside the
      POSIX block; Windows versions inside `_WIN32`:
  - `chmod_path`: no-op returning `OK` (the profile's ACLs protect the file)
  - `sync_dir`: no-op returning `OK`; `rename_path` gains `MOVEFILE_WRITE_THROUGH`
  - `real_path`: `CreateFileW` (`FILE_FLAG_BACKUP_SEMANTICS`) +
    `GetFinalPathNameByHandleW`; strip `\\?\`, turn `\\?\UNC\` into `\\`; the path as
    given when it does not exist
  - `mode_t` in the signatures: check that it exists under llvm-mingw, else `int`
- [x] Read the auto-merged `flint_rdp.hpp` for the branch's `_WIN32` fixes (`sock_init`,
      `winpr/shell.h`, keepalive/`TCP_MAXRT`) still in place
- [x] Merge commit
- [x] `windows/build-gui.sh`: `flint.exe` + `Flint.exe` compile (`flint_window.hpp` and
      `flint_monitors.hpp` `_WIN32` code was never compiled: fix to compile, or stub
      monitors per D-089 if it takes long)
- [x] `build.cf`'s `FlintVaultServer`: confirm Windows builds skip it (no Windows build;
      it runs in Docker)
- [x] `windows/test-suites.sh`: add the new packages, leave out `serverfs`,
      `application/vaultserver`, `drivers/vault-server` (POSIX sockets); all green
- [x] Commit + push

## Stage 2: the vault on Windows (milestones 39-41) → push

- [x] **Re-key (M40), `src/adapters/vault/rekey.cf`:** close the connection, rename the copy
      over the vault, reopen; when the rename fails, reopen the old file. Same for the
      activity file (`activity_rekey_commit`). Close ROADMAP §4 "Windows: a vault re-key
      renames over the open file"
- [ ] `vault passwd` from the CLI, and Settings → Vault → Change master password in the app,
      with the app holding the vault [ran]
- [ ] Activity file (M39): `<config>/activity/<vault id>.db` created; migration 009 on a
      vault from before [ran]
- [ ] `real_path` (M41): `vault merge` / `vault passwd` refused while the app holds the vault,
      through a symbolic link too (needs Developer Mode or admin) and a different letter case
- [ ] Same-path compare: case-insensitive on Windows?
- [ ] `vault merge` with a conflict copy [ran]
- [ ] `windows/cli-smoke.sh`: `--version`, `vault passwd`, `vault merge` cases; green
- [ ] `windows/serve-e2e.sh` green
- [ ] Commit + push

## Stage 3: RDP and the desktop (milestones 32-38) → push

- [ ] M32: Settings → About shows the version and the libraries (FreeRDP) [ran]
- [ ] M34/35: RDPGFX progressive; H.264 likely absent (FreeRDP built without ffmpeg):
      Automatic must fall back cleanly; Stats overlay; WebGL renderer in WebView2 [ran]
- [ ] M36: TLS/NLA against the owner's Windows 11; Standard RDP Security refused; frame
      channel `Host`/CORS (`https://app.localhost` passes as `*.localhost`) [ran]
- [ ] M37: full screen from the toolbar, tab menu, palette; chord Ctrl+Alt+Enter vs AltGr [ran]
- [ ] M38: two monitors, `flint_monitors.hpp` `_WIN32` (HWND + WebView2 per extra monitor).
      Needs the owner's monitors. If stuck: "not supported on this system yet" (D-089)
- [ ] `windows/rdp-servers.sh` with the changed test server; `windows/gui-e2e.sh` with the new
      runs (fullscreen, monitors, webgl, passwd); green
- [ ] Commit + push

## Stage 4: close → push

- [ ] `docs/build-log.md`: a Windows note on milestones 32-42 (what is [ran], what is not)
- [ ] `docs/windows-port-guide.md`: "Resume here" and "Verified on Windows" updated
- [ ] Bundles refreshed in `D:\Respaldos\flint-windows`; reinstall `D:\Programas\Flint` (ask)
- [ ] Delete this file; commit + push

## Open questions for the owner

- Multi-monitor (M38) in this round, or degraded and left for later?
- Windows-safe pieces (`flint_fs.hpp` `_WIN32`, the re-key's close-rename-reopen) to main
  later, so the branch diverges less? (After the owner's two changes today.)
- Before the repo goes public: `docs/cfire-windows/patches/` holds diffs of cfire's code;
  fine while cfire is private? A secrets scan of the history?

## Log

- 2026-11-13: plan written; trial merge shows one conflict.
- 2026-11-13, stage 1: merged (`55892f2`); `flint_fs.hpp` resolved (`chmod_path`, `sync_dir`
  no-ops; `rename_path` write-through; `real_path` by `GetFinalPathNameByHandleW`).
  Build fixes: `far` is a `windows.h` macro (test variable renamed);
  `flint_monitors.hpp`'s Windows half rewritten on cfire's own WebView2 helpers (W-17,
  no WRL `Callback` with mingw; `GetDpiForMonitor`/`SetProcessDpiAwarenessContext` at run
  time). `flint.exe --version` [ran]: 0.9.0. `build-gui.sh` builds only `flint` and
  `FlintGui`, so the vault server is never built here.
- Suites [ran]: 12 suites green after: the re-key closes, renames (retried ~1 s) and
  reopens on Windows (vault and activity file; a rename that still fails leaves the old
  vault whole and locked, `ERR_LOCKED`: the store holds no old key); POSIX mode asserts
  skipped on Windows; the symlink test uses `flint_fs::make_symlink` and **skips without
  Developer Mode** (off on this machine): `real_path` through a link is not yet [ran].
