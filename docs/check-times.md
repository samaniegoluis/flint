# Check times

How long Flint's checks take, per system, measured by `scripts/check-times.sh`
(milestone 83, D-161). Every change to the checks (milestones 84 and 85, a cfire upgrade)
is measured warm against these numbers, on what it touches, and adds a section below.

- **Cold:** the workspace's `.cfire/` folders and `build/` removed first, as a fresh
  checkout has them (cfire's user cache kept). **Warm:** the run right after, nothing
  changed.
- **Suite:** `cfire test --release --no-cache --json <folder>`, against the servers
  `scripts/test.sh` starts. *Own tests* include doc-tests; `[auto]` are cfire's generated
  json round-trips. *Objects* are the `.o` files the suite leaves in its `.cfire/obj`.
- **Build:** `cfire build` (every binary) and `scripts/build-gui.sh` (the page and the app).
- **e2e:** each script alone; gui-e2e one run at a time (`FLINT_E2E_ONLY`).

```sh
scripts/check-times.sh --cold --label mac     # then without --cold for the warm pass
```

The script prints a section and keeps it in `build/check-times/<label>-<cold|warm>.md`;
it is pasted here by hand.

## Baseline (cfire `v0.12.7`, 2026-11-27)

How to read it: `cfire test <folder>` walks sub-folders, so `src/application`'s row
includes `application/vaultserver`'s suite (and its tests), which then runs warm in its own
row. `drivers/cli` and `drivers/vault-server` compile again warm because the branch moved
between the two passes: their `version.cf` (the version from git) changed. A gui-e2e
section follows.

### Mac, cold (2026-11-28, 45861984, cfire 0.12.7)

Darwin arm64, 11 cores. Total 1858.9 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 32.4 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 35.0 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 32.3 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 32.7 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 38.6 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 33.3 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 40.0 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 58.3 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 31.8 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 35.2 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 63.8 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 55.5 | pass | 19 | 56 | 0 |
| suite | `src/adapters/vault` | 49.1 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 42.7 | pass | 10 | 50 | 38 |
| suite | `src/application` | 287.9 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 1.0 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 130.0 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 122.0 | pass | 4 | 115 | 100 |
| suite | `src/drivers/clicmd` | 124.4 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 46.9 | pass | 16 | 53 | 39 |
| build | `cfire build` | 242.0 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 8.0 | pass |  |  |  |
| e2e | `cli-e2e` | 102.0 | pass |  |  |  |
| e2e | `serve-e2e` | 97.5 | pass |  |  |  |
| e2e | `server-e2e` | 15.1 | pass |  |  |  |
| e2e | `sync-e2e` | 100.9 | pass |  |  |  |
| suites | **all 20** | 1292.9 | | 837 | 1194 | 874 |

### Mac, warm (2026-11-28, 45861984, cfire 0.12.7)

Darwin arm64, 11 cores. Total 432.1 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 1.1 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 1.1 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 1.3 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 1.1 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 1.3 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 1.1 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 1.3 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 11.4 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 1.2 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 1.6 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 10.9 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 22.9 | pass | 19 | 56 | 0 |
| suite | `src/adapters/vault` | 1.7 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 4.4 | pass | 10 | 50 | 38 |
| suite | `src/application` | 2.8 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 1.1 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 1.2 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 28.0 | pass | 4 | 115 | 202 |
| suite | `src/drivers/clicmd` | 1.8 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 9.1 | pass | 16 | 53 | 77 |
| build | `cfire build` | 4.0 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 7.4 | pass |  |  |  |
| e2e | `cli-e2e` | 101.5 | pass |  |  |  |
| e2e | `serve-e2e` | 96.5 | pass |  |  |  |
| e2e | `server-e2e` | 15.1 | pass |  |  |  |
| e2e | `sync-e2e` | 100.6 | pass |  |  |  |
| suites | **all 20** | 106.4 | | 837 | 1194 | 1014 |

### Mac, gui-e2e (warm) (2026-11-28, 35cde907, cfire 0.12.7)

Darwin arm64, 11 cores. Total 262.9 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| e2e | `gui-e2e terminal` | 26.8 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 13.1 | pass |  |  |  |
| e2e | `gui-e2e vault` | 39.0 | pass |  |  |  |
| e2e | `gui-e2e tunnels` | 9.5 | pass |  |  |  |
| e2e | `gui-e2e paste` | 8.9 | pass |  |  |  |
| e2e | `gui-e2e rdp` | 27.7 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 17.1 | pass |  |  |  |
| e2e | `gui-e2e fullscreen` | 11.1 | pass |  |  |  |
| e2e | `gui-e2e vim` | 7.0 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 3.5 | pass |  |  |  |
| e2e | `gui-e2e update` | 7.5 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 41.3 | pass |  |  |  |

### Docker (OrbStack), cold (2026-11-28, cbed95cf, cfire 0.12.7)

Linux aarch64, 11 cores. Total 3214.0 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 50.3 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 54.5 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 49.3 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 46.8 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 58.5 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 50.8 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 55.4 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 82.5 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 47.2 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 52.3 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 86.1 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 133.2 | pass | 19 | 56 | 48 |
| suite | `src/adapters/vault` | 73.4 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 61.1 | pass | 10 | 50 | 38 |
| suite | `src/application` | 440.2 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 0.9 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 184.0 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 178.6 | pass | 4 | 115 | 100 |
| suite | `src/drivers/clicmd` | 180.9 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 65.6 | pass | 16 | 53 | 39 |
| build | `cfire build` | 623.1 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 14.6 | pass |  |  |  |
| e2e | `cli-e2e` | 127.2 | pass |  |  |  |
| e2e | `serve-e2e` | 118.0 | pass |  |  |  |
| e2e | `server-e2e` | 13.3 | pass |  |  |  |
| e2e | `sync-e2e` | 195.1 | pass |  |  |  |
| e2e | `gui-e2e terminal` | 25.3 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 11.0 | pass |  |  |  |
| e2e | `gui-e2e vault` | 36.9 | pass |  |  |  |
| e2e | `gui-e2e tunnels` | 8.8 | pass |  |  |  |
| e2e | `gui-e2e paste` | 6.8 | pass |  |  |  |
| e2e | `gui-e2e rdp` | 25.0 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 16.8 | pass |  |  |  |
| e2e | `gui-e2e fullscreen` | 10.7 | pass |  |  |  |
| e2e | `gui-e2e vim` | 5.0 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 3.0 | pass |  |  |  |
| e2e | `gui-e2e update` | 7.0 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 0.6 | pass |  |  |  |
| suites | **all 20** | 1951.6 | | 837 | 1194 | 922 |

### Docker (OrbStack), warm (2026-11-28, cbed95cf, cfire 0.12.7)

Linux aarch64, 11 cores. Total 731.3 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 0.9 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 1.0 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 1.3 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 1.0 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 1.2 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 1.0 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 1.2 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 16.7 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 1.0 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 1.2 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 9.8 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 15.1 | pass | 19 | 56 | 48 |
| suite | `src/adapters/vault` | 4.0 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 4.3 | pass | 10 | 50 | 38 |
| suite | `src/application` | 3.1 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 0.9 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 1.3 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 2.3 | pass | 4 | 115 | 200 |
| suite | `src/drivers/clicmd` | 2.3 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 9.0 | pass | 16 | 53 | 39 |
| build | `cfire build` | 16.0 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 14.2 | pass |  |  |  |
| e2e | `cli-e2e` | 126.3 | pass |  |  |  |
| e2e | `serve-e2e` | 117.3 | pass |  |  |  |
| e2e | `server-e2e` | 13.3 | pass |  |  |  |
| e2e | `sync-e2e` | 195.0 | pass |  |  |  |
| e2e | `gui-e2e terminal` | 24.4 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 11.0 | pass |  |  |  |
| e2e | `gui-e2e vault` | 36.9 | pass |  |  |  |
| e2e | `gui-e2e tunnels` | 8.8 | pass |  |  |  |
| e2e | `gui-e2e paste` | 6.8 | pass |  |  |  |
| e2e | `gui-e2e rdp` | 25.0 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 16.8 | pass |  |  |  |
| e2e | `gui-e2e fullscreen` | 10.8 | pass |  |  |  |
| e2e | `gui-e2e vim` | 5.0 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 3.0 | pass |  |  |  |
| e2e | `gui-e2e update` | 7.0 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 0.6 | pass |  |  |  |
| suites | **all 20** | 78.6 | | 837 | 1194 | 1022 |

In the container `gui-e2e selfupdate` skips itself (no package for Linux on arm64; cli-e2e
runs the update's apply step), so its 0.6 s is a skip.

## The release's Linux packages

## Notes for milestones 84 and 85

Found while building 83 (2026-11-27), to start from:

- **cfire's object cache is by content, not by time** (`src/buildsys.hpp` at `v0.12.7`:
  each unit's object is named by a SHA-256 of the compiler, flags, runtime, headers, the
  unit's C++ and the unit's own path). A fresh checkout's new mtimes do not rebuild
  anything; a different folder does (the path is hashed), so a cache only helps at the same
  path (Docker's `/cache/work`, a fixed folder per branch on Zorin and the VM).
- **Why domain is compiled ~20 times** (CF-215): the object folder is the suite's own
  `.cfire/obj`, and the generated C++ embeds source paths relative to the suite
  (`src/adapters/fonts/./../../domain/access.cf`). Between the fonts and keychain suites,
  all 32 shared units are byte-identical once those paths are normalised.
- **A suite already compiles in parallel:** its shards go to `hardware_concurrency()`
  workers. What runs on one core is the rest (parsing, Sema, code generation, the link, the
  tests). Suites in parallel (84) mostly gain those phases; N suites × all cores
  oversubscribes, so `-j` should be small and measured. **On Windows** the
  `--no-shard` shim (CF-207) compiles each suite as one unit on one core: there `-j`
  gains the most.
- **Suites that share something and stay serial at first** (84): `ssh` (the test sshds,
  sleeps), `rdp` (FreeRDP's sample server, sleeps), `vaultremote` (the one test vault
  server and its data folder), `drivers/vault-server` (real listeners and deadlines),
  `keychain` (the OS keychain), `uievents` (sleeps). The others found no shared port, fixed
  folder or real clock in their tests (the `/tmp/…` and `127.0.0.1:…` strings in
  `ipc`, `domain` and `application` are data, not listeners); each still has to pass
  in parallel before it leaves the serial list.
- **The release build** compiles the app (18 min), the CLI (7 min) and the update helper
  (3 min) one after another in each format's container on a 4-core runner (the v0.39.0
  run); the image itself takes about a minute, so it is not cached.
- **What each package imports** (85's `checks-for-diff.sh` starts here; relative imports in
  `src/`, 2026-11-27). `domain` and `drivers/version` import nothing; `ports` ← domain;
  every adapter ← domain, and most ← ports too (crypto ← ports only); `application` and
  `application/vaultserver` ← domain, ports. Drivers:
  `drivers/cli` ← crypto, process, ssh, vault, application, clicmd, version;
  `drivers/clicmd` ← config, crypto, ipc, keychain, process, ssh, vault, vaultremote,
  application, ports; `drivers/gui` ← every adapter but rootupdate and serverfs, application,
  clicmd, version; `drivers/update-root` ← crypto, rootupdate, application, version;
  `drivers/vault-server` ← crypto, serverfs, application/vaultserver, ports, version. So a
  change in one adapter reaches its suite, the drivers that import it and their e2e runs;
  a change in `domain` or `ports` reaches everything.
