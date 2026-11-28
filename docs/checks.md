# The checks

Every check Flint has, what each covers and costs, and how `scripts/checks-for-diff.sh`
picks the ones a diff needs (milestone 85, D-161, D-163). The times are milestone 83's
warm baseline (`docs/check-times.md`, cfire `v0.12.7`): what a run costs when the change
is small, which is the usual case.

```sh
scripts/checks-for-diff.sh            # against main: the branch's commits and the working tree
scripts/checks-for-diff.sh A --head B # a committed range only, e.g. a past milestone
scripts/checks-for-diff.sh --self-test
```

## How the script decides

- **`src/`, by declaration.** Each `.cf` file is cut into its top-level declarations
  (functions, methods, types, constants, tests). One changed when its text without
  comments changed. A reference graph over the whole tree (`pkg.name` through the file's
  imports, bare names inside a package, a method through its receiver's type, so whatever
  names the type is reached) carries the change to every declaration that can see it.
  - A package with a reached declaration runs its suite (a nested suite folds into its
    parent's, as `cfire test` walks sub-folders).
  - A reached driver file picks its e2e runs from a table in the script (`driverChecks`):
    `gui/tunnels.cf` → gui-e2e `tunnels`, `clicmd/sync_commands.cf` → `sync-e2e`, and so
    on. A driver file the table does not know runs every run of its binary. Dispatch
    files (`cli/main.cf`, `clicmd/run.cf`, `gui/main.cf`) count only when changed or
    reached from outside the drivers; otherwise every command would reach every run.
  - A test file's declarations are seen only by its own package's tests.
  - A native header reaches every declaration of the `.cf` files that import it, directly
    or through `#include`.
  - Comments and blank lines alone run nothing; a `///` doc comment runs its suite
    (doc-tests).
- **Systems.** A changed line under `#if defined(_WIN32)` (or `__APPLE__`, `__linux__`, an
  `#else`) counts for the systems it compiles on. A line in a declaration that branches on
  the system (`os_name()`, a `#if` in a `cpp` block) counts for all three. Other `.cf`
  code is portable and counts for the Mac only; a native header's unguarded line counts
  for all three. A system with nothing to run is named under *Not needed*.
- **Every other path** goes through a table (`PATHS` in the script): `docs/` and the
  README → the site build; `site/` → the site, plus the demo's or the releases' e2e when
  those change; `ui/` → vitest and tsc, and the gui-e2e run of the folder (`ui/src/tunnels`
  → `tunnels`), every run for a folder with no run of its own; an e2e script → itself;
  packaging → that package on its system; a repro → `tools/cfire-repros/run.sh` for it;
  any other script → the script itself, on its system.
- **The whole set** on all three systems: keys (`adapters/crypto`, `adapters/keychain`),
  the vault format and migrations, the socket (`adapters/ipc`, both `serve.cf`), the
  window, `build.cf`, cfire's pin (`scripts/install-cfire.sh`), `scripts/env.sh` and
  `scripts/test.sh`; on one system, its native libraries (`src/adapters/pkgconfig/<os>`),
  its test container or its cfire setup. **A path the script does not know** runs the
  whole set too: the script errs towards running more.
- **Also the whole set**, whatever the diff: at each spec's close (`lean-spec`'s next-spec
  run) and before a cfire upgrade. That is where a check the script left out shows up.

### Misses

A check the script did not ask for that then failed, or a case where it asked for
something the change could not reach. Each one becomes a case in `--self-test` (the
`CASES` list) and a line here: what changed, what was missed, what the script does now.

| Date | Change | Missed or extra | Fixed by |
|---|---|---|---|
| 2026-11-28 | Milestone 77's diff (`adc9c355...272f671e`) | Extra: `serve-e2e` and `sync-e2e` through `has_token`, a helper in `agent_guide_test.cf` named like a field in `clicmd/serve.cf` | A test file's declarations are seen only by its package's tests; case *a test file's helper reaches only its package's tests* |

### The trial (milestones 85 to 88)

Until the owner calls it settled, each milestone's build-log line names what the script
asked for and what was run, and any difference goes into *Misses* with its reason. The
self-test also checks the scanner against cfire's own parser: every top-level name that
`cfire outline --json src` reports must be one the scanner found (3040 of 3040 at
milestone 85).

### Compared with what was run

| Milestone | Range | The script asks for | What was run | Difference |
|---|---|---|---|---|
| 77 (`flint agent-guide`) | `adc9c355...272f671e` | Mac: `clicmd` suite, the build, cli-e2e, serve-e2e, sync-e2e, the site and its demo e2e, repro CF-214. Not Linux, not Windows | `clicmd` suite, the build, cli-e2e, the site with its demo e2e, CF-214 | serve-e2e and sync-e2e: `clicmd/run.cf` changed (the usage text and `run_cli`), and both drive commands through it. Kept: a change to the dispatch is a change to every command, served ones too |
| 78 (the vault server) | `v0.36.1...v0.37.0` | Mac: `serverfs` and `vault-server` suites, the build, server-e2e, sync-e2e, the server image's server-e2e, release-test, the site, every repro. Linux: the whole set (`scripts/linux/inside.sh` changed). VM: `serverfs` and `vault-server` suites, server-e2e, sync-e2e | Mac: every suite, the listener tests, server-e2e, sync-e2e, the image's server-e2e, the site. Docker: everything. VM: `serverfs`, `vault-server` and `vaultserver` suites, server-e2e, sync-e2e | The Mac's other 18 suites, which no changed line reached; on the VM, `application/vaultserver`, whose code did not change |
| 79 (macOS signing) | `4fe580af...002b347b` | The whole set on the three systems (`build.cf` changed: the bundle id), `scripts/package.sh` on each, the workflow | Mac: every suite, gui-e2e `selfupdate`, the signed package, release-test, the site. Docker: 10 of 20 suites. Not the VM | More than was run: `build.cf` is in the whole-set list by the spec's rule. Its change there was the bundle id, a string no Linux or Windows code reads; a finer rule for `build.cf` (by the executable whose entry changed) is a proposal below |

## The inventory

### `cfire test` suites

`scripts/test.sh <folders>` runs them against the throwaway sshds; *Mac*, *Docker* and
*VM* are warm seconds. On the VM a warm row is a whole compile (CF-221), what a suite a
change reaches costs there. *[auto]* are cfire's generated json round-trips.

| Suite | Covers | Own tests | [auto] | Mac | Docker | VM | Overlaps |
|---|---|--:|--:|--:|--:|--:|---|
| `src/domain` | Rules and types: hosts, vault, sync, tokens, sudo, monitors, updates, strength | 229 | 47 | 1.2 | 1.3 | 155 | Its `[auto]` 47 run again in nearly every other suite |
| `src/application` | Use cases on fakes of every port (with `vaultserver`) | 271 | 132 | 2.8 | 3.1 | 327 | — |
| `src/application/vaultserver` | The sync server's use cases | 22 | 51 | 1.1 | 0.9 | 55 | Run inside `src/application`'s row too |
| `src/adapters/clilink` | The `flint` link on PATH | 6 | 47 | 1.1 | 0.9 | 82 | — |
| `src/adapters/config` | Config and ui-state files, recents | 8 | 53 | 1.1 | 1.0 | 53 | — |
| `src/adapters/crypto` | libsodium: KDF, AEAD, token hashes | 15 | 47 | 1.3 | 1.3 | 56 | — |
| `src/adapters/fonts` | The system's monospace fonts | 4 | 47 | 1.1 | 1.0 | 49 | — |
| `src/adapters/ipc` | The socket, peers, framing | 12 | 52 | 1.3 | 1.2 | 52 | serve-e2e drives the same socket end to end |
| `src/adapters/keychain` | The OS keychain (a real entry) | 6 | 47 | 1.1 | 1.0 | 57 | — |
| `src/adapters/process` | Processes, files, the update's swap | 20 | 47 | 1.3 | 1.2 | 91 | gui-e2e `selfupdate` applies a real update |
| `src/adapters/rdp` | FreeRDP against its sample server | 33 | 47 | 11.4 | 16.7 | 142 | gui-e2e `rdp` |
| `src/adapters/rootupdate` | `flint-update-root`'s side (Linux) | 7 | 47 | 1.2 | 1.0 | 89 | `scripts/linux/selfupdate-test.sh` |
| `src/adapters/serverfs` | The sync server's store and listener | 17 | 48 | 1.6 | 1.2 | 84 | server-e2e |
| `src/adapters/ssh` | libssh against the test sshds: auth, exec, SFTP, tunnels | 48 | 47 | 10.9 | 9.8 | 144 | cli-e2e's ssh sections drive the same paths through the CLI |
| `src/adapters/uievents` | The window's native side, clipboard, dialogs, tray | 19 | 56 | 22.9 | 15.1 | 91 | gui-e2e |
| `src/adapters/vault` | SQLCipher store, migrations, activity, sync merge | 58 | 47 | 1.7 | 4.0 | 119 | cli-e2e's vault sections |
| `src/adapters/vaultremote` | The sync client over HTTP | 10 | 50 | 4.4 | 4.3 | 94 | sync-e2e |
| `src/drivers/cli` | `update-apply`'s argument rules | 4 | 115 | 28.0 | 2.3 | 92 | Its 4 tests are path rules that `domain` already owns |
| `src/drivers/clicmd` | Arguments, the command table, the agent guide, serve and tokens | 32 | 114 | 1.8 | 2.3 | 107 | cli-e2e |
| `src/drivers/vault-server` | The server's listener: deadlines, limits, a busy port | 16 | 53 | 9.1 | 9.0 | 72 | server-e2e |
| **20 suites** | | **837** | **1194** | **106** | **79** | **2011** | |

### End-to-end runs and other checks

| Check | Covers | Checks | Mac | Docker | Overlaps |
|---|---|--:|--:|--:|---|
| `scripts/cli-e2e.sh` | The CLI on throwaway vaults: 28 sections (the agent guide and the vault lifecycle to *nothing secret leaks*), the agent guide's docs | 527 | 101.5 | 126.3 | The `ssh`, `vault` and `clicmd` suites, one layer up |
| `scripts/serve-e2e.sh` | The CLI as the app's client: 19 sections, the same output byte for byte, approvals, tokens, cp and tunnels through the app | 251 | 96.5 | 117.3 | cli-e2e's commands, run a second time through the app (that is its point, Principle 7) |
| `scripts/server-e2e.sh` | `flint-vault-server` on loopback, curl and raw sockets | 84 | 15.1 | 13.3 | The `vault-server` and `serverfs` suites |
| `scripts/sync-e2e.sh` | Two machines and the server: offline edits, renames, a new password, a second vault, the app's sync loop | 115 | 100.6 | 195.0 | server-e2e (the server) and `vaultremote` |
| gui-e2e `terminal` | Vault, keys, hosts, a host key, typing, reconnect, a jump host, the palette | 108 | 26.8 | 24.4 | — |
| gui-e2e `broadcast` | Broadcast input | 24 | 13.1 | 11.0 | — |
| gui-e2e `vault` | Hosts and credentials in the editors, settings, the language, toasts, lock and unlock | 203 | 39.0 | 36.9 | The largest run |
| gui-e2e `tunnels` | Tunnels | 21 | 9.5 | 8.8 | cli-e2e's and serve-e2e's tunnel sections |
| gui-e2e `paste` | Paste into the terminal | 11 | 8.9 | 6.8 | — |
| gui-e2e `rdp` | The RDP tab against FreeRDP's sample server | 85 | 27.7 | 25.0 | The `rdp` suite |
| gui-e2e `webgl` | The terminal's WebGL context loss | 2 | 17.1 | 16.8 | — |
| gui-e2e `fullscreen` | Full screen and its bar | 30 | 11.1 | 10.8 | — |
| gui-e2e `vim` | Vim in the terminal | 2 | 7.0 | 5.0 | — |
| gui-e2e `clilink` | The CLI link from the app | 13 | 3.5 | 3.0 | — |
| gui-e2e `update` | The update screens | 39 | 7.5 | 7.0 | — |
| gui-e2e `selfupdate` | A real update applied, a bad SHA, a rollback, signed | 12 | 41.3 | skip | The `process` suite |
| `scripts/release-test.sh` | `release.sh`, `cliff.toml`, `release-draft.sh` on a scratch repository | 56 | | | — |
| `scripts/i18n-missing.sh` | The core's message ids against the page's catalogs | | | | — |
| ui `npm test`, `tsc` | The page's logic (vitest) and types | 309 | | | — |
| site `npm run build`, `npm test`, `test:e2e` | The docs site, its demo's data, the demo in a browser | 58 + 65 | | | — |

*Checks* in the gui-e2e rows are the run's `check(…)` calls; the e2e scripts count their
own. On the Mac, warm, the e2e runs are ~580 s of the ~690 s the whole set costs; the 20
suites are 106 s. So what the script saves is mostly e2e runs, Docker and the VM.

## Proposal

The owner's answer (2026-11-28), each now a ROADMAP §5 row: **1 and 2 next** (1 before 84), **3 and 4 ideas**, decided with the trial's data. No test is dropped.

1. **cli-e2e and sync-e2e in named sections**, as gui-e2e has runs: `FLINT_E2E_ONLY=ssh,files
   scripts/cli-e2e.sh` (sections exist already, `echo "== …"`), each section's time in
   the run's output, then `driverChecks` maps `clicmd/ssh_commands.cf` → `ssh`,
   `files_commands.cf` → `files`, `tunnel_commands.cf` → `tunnels`, and so on. Why: they
   are 100 s each on the Mac and 126/195 s in Docker, and a change to one command runs all
   of them. First step: the per-section times, to see where the 100 s go.
2. **`drivers/cli`'s 4 tests move to a lower layer.** They test `update-apply`'s path rules,
   which `domain` already holds (`domain.is_absolute_path`); the suite recompiles on every
   commit (its `version.cf` changes) and costs 28 s warm on the Mac and 92 s on the VM for
   4 tests. Why: the same coverage for a fraction of the time; the suite goes with them.
3. **`build.cf` by executable.** Today any change runs the whole set; a change inside one
   `build.Executable(…)` block (a bundle id, an icon) would run that binary's build and
   e2e on all three systems instead, and a change outside the blocks (the `Version` step,
   pkg-config lists) the whole set as now. Why: milestone 79's bundle id asked for the
   whole set on the VM.
4. **gui-e2e `vault` in two runs** (hosts and credentials; settings, the language, lock and unlock).
   Why: 203 checks and 39 s, the run most page changes reach; split, the script can pick
   one. Only after 1, which is the larger gain.
5. **Kept as they are:** serve-e2e running the CLI's commands again (it checks that they
   match, Principle 7); the `rdp`, `ssh`, `vault-server` and `uievents` suites' sleeps and
   real servers (84 times them in parallel and decides there); the `[auto]` round-trips
   (84: a cfire setting or a CF entry).
