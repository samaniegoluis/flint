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
