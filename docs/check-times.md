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

### Zorin, cold (2026-11-28, 320a835f, cfire 0.12.7)

Linux x86_64, 4 cores. Total 8099.4 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 129.6 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 154.6 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 135.9 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 136.4 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 163.5 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 142.6 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 169.7 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 195.9 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 135.1 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 151.3 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 229.0 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 339.2 | pass | 19 | 56 | 48 |
| suite | `src/adapters/vault` | 205.0 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 170.4 | pass | 10 | 50 | 38 |
| suite | `src/application` | 1194.3 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 2.4 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 528.4 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 522.0 | pass | 4 | 115 | 100 |
| suite | `src/drivers/clicmd` | 551.2 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 179.1 | pass | 16 | 53 | 39 |
| build | `cfire build` | 1605.8 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 55.4 | pass |  |  |  |
| e2e | `cli-e2e` | 227.4 | pass |  |  |  |
| e2e | `serve-e2e` | 202.1 | pass |  |  |  |
| e2e | `server-e2e` | 15.2 | pass |  |  |  |
| e2e | `sync-e2e` | 311.5 | pass |  |  |  |
| e2e | `gui-e2e terminal` | 33.0 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 13.9 | pass |  |  |  |
| e2e | `gui-e2e vault` | 32.8 | fail |  |  |  |
| e2e | `gui-e2e tunnels` | 10.9 | pass |  |  |  |
| e2e | `gui-e2e paste` | 28.8 | fail |  |  |  |
| e2e | `gui-e2e rdp` | 0.6 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 22.8 | fail |  |  |  |
| e2e | `gui-e2e fullscreen` | 38.8 | fail |  |  |  |
| e2e | `gui-e2e vim` | 8.9 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 4.8 | pass |  |  |  |
| e2e | `gui-e2e update` | 7.6 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 43.1 | pass |  |  |  |
| suites | **all 20** | 5435.6 | | 837 | 1194 | 922 |

### Zorin, warm (2026-11-28, 320a835f, cfire 0.12.7)

Linux x86_64, 4 cores. Total 1276.8 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 2.9 | pass | 6 | 47 | 34 |
| suite | `src/adapters/config` | 3.2 | pass | 8 | 53 | 39 |
| suite | `src/adapters/crypto` | 3.4 | pass | 15 | 47 | 34 |
| suite | `src/adapters/fonts` | 2.7 | pass | 4 | 47 | 34 |
| suite | `src/adapters/ipc` | 3.2 | pass | 12 | 52 | 37 |
| suite | `src/adapters/keychain` | 3.0 | pass | 6 | 47 | 34 |
| suite | `src/adapters/process` | 3.4 | pass | 20 | 47 | 39 |
| suite | `src/adapters/rdp` | 14.3 | pass | 33 | 47 | 34 |
| suite | `src/adapters/rootupdate` | 2.8 | pass | 7 | 47 | 34 |
| suite | `src/adapters/serverfs` | 3.3 | pass | 17 | 48 | 35 |
| suite | `src/adapters/ssh` | 17.4 | pass | 48 | 47 | 46 |
| suite | `src/adapters/uievents` | 46.2 | pass | 19 | 56 | 48 |
| suite | `src/adapters/vault` | 10.1 | pass | 58 | 47 | 44 |
| suite | `src/adapters/vaultremote` | 6.5 | pass | 10 | 50 | 38 |
| suite | `src/application` | 9.4 | pass | 271 | 132 | 75 |
| suite | `src/application/vaultserver` | 2.9 | pass | 22 | 51 | 34 |
| suite | `src/domain` | 3.8 | pass | 229 | 47 | 44 |
| suite | `src/drivers/cli` | 7.0 | pass | 4 | 115 | 200 |
| suite | `src/drivers/clicmd` | 7.1 | pass | 32 | 114 | 100 |
| suite | `src/drivers/vault-server` | 11.8 | pass | 16 | 53 | 39 |
| build | `cfire build` | 52.6 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 57.8 | pass |  |  |  |
| e2e | `cli-e2e` | 235.1 | pass |  |  |  |
| e2e | `serve-e2e` | 202.3 | pass |  |  |  |
| e2e | `server-e2e` | 15.3 | pass |  |  |  |
| e2e | `sync-e2e` | 305.6 | pass |  |  |  |
| e2e | `gui-e2e terminal` | 32.9 | fail |  |  |  |
| e2e | `gui-e2e broadcast` | 13.9 | pass |  |  |  |
| e2e | `gui-e2e vault` | 31.5 | fail |  |  |  |
| e2e | `gui-e2e tunnels` | 10.8 | pass |  |  |  |
| e2e | `gui-e2e paste` | 28.8 | fail |  |  |  |
| e2e | `gui-e2e rdp` | 0.5 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 22.8 | fail |  |  |  |
| e2e | `gui-e2e fullscreen` | 38.8 | fail |  |  |  |
| e2e | `gui-e2e vim` | 8.8 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 4.8 | pass |  |  |  |
| e2e | `gui-e2e update` | 7.3 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 42.5 | pass |  |  |  |
| suites | **all 20** | 164.4 | | 837 | 1194 | 1022 |

On Zorin (Xvfb, no desktop session) `gui-e2e terminal`, `vault`, `paste`, `webgl` and
`fullscreen` fail on the box's clipboard and GPU, as in every run there (ROADMAP §7), and
`gui-e2e rdp` skips itself (no `sfreerdp-server` on the box), so its 0.6 s is a skip.
`terminal` passed cold and failed warm: the same environment's failure (read, not rerun).

### Windows VM, cold (2026-11-28, 320a835, cfire 0.12.7)

MINGW64_NT-10.0-22621 x86_64, 6 cores. Total 5888.9 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 61.8 | pass | 6 | 47 | 0 |
| suite | `src/adapters/config` | 79.5 | pass | 8 | 53 | 0 |
| suite | `src/adapters/crypto` | 84.9 | pass | 15 | 47 | 0 |
| suite | `src/adapters/fonts` | 67.4 | pass | 4 | 47 | 0 |
| suite | `src/adapters/ipc` | 100.4 | pass | 12 | 52 | 0 |
| suite | `src/adapters/keychain` | 73.1 | pass | 6 | 47 | 0 |
| suite | `src/adapters/process` | 105.3 | pass | 20 | 47 | 0 |
| suite | `src/adapters/rdp` | 148.4 | pass | 33 | 47 | 0 |
| suite | `src/adapters/rootupdate` | 87.2 | fail | 7 | 47 | 0 |
| suite | `src/adapters/serverfs` | 67.4 | pass | 17 | 48 | 0 |
| suite | `src/adapters/ssh` | 204.5 | pass | 48 | 47 | 0 |
| suite | `src/adapters/uievents` | 319.0 | pass | 19 | 56 | 0 |
| suite | `src/adapters/vault` | 138.6 | pass | 58 | 47 | 0 |
| suite | `src/adapters/vaultremote` | 109.8 | pass | 10 | 50 | 0 |
| suite | `src/application` | 327.4 | pass | 271 | 132 | 0 |
| suite | `src/application/vaultserver` | 56.1 | pass | 22 | 51 | 0 |
| suite | `src/domain` | 194.8 | pass | 229 | 47 | 0 |
| suite | `src/drivers/cli` | 333.8 | pass | 4 | 115 | 0 |
| suite | `src/drivers/clicmd` | 323.3 | pass | 32 | 114 | 0 |
| suite | `src/drivers/vault-server` | 78.8 | pass | 16 | 53 | 0 |
| build | `cfire build` | 989.8 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 26.4 | pass |  |  |  |
| e2e | `cli-e2e` | 327.3 | fail |  |  |  |
| e2e | `serve-e2e` | 910.5 | pass |  |  |  |
| e2e | `server-e2e` | 39.2 | pass |  |  |  |
| e2e | `sync-e2e` | 290.6 | pass |  |  |  |
| e2e | `gui-e2e terminal` | 52.1 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 20.6 | pass |  |  |  |
| e2e | `gui-e2e vault` | 36.5 | fail |  |  |  |
| e2e | `gui-e2e tunnels` | 15.3 | pass |  |  |  |
| e2e | `gui-e2e paste` | 13.6 | pass |  |  |  |
| e2e | `gui-e2e rdp` | 43.2 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 23.1 | pass |  |  |  |
| e2e | `gui-e2e fullscreen` | 17.1 | pass |  |  |  |
| e2e | `gui-e2e vim` | 11.5 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 8.0 | pass |  |  |  |
| e2e | `gui-e2e update` | 12.6 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 79.9 | pass |  |  |  |
| suites | **all 20** | 2961.5 | | 837 | 1194 | 0 |

### Windows VM, warm (2026-11-28, 320a835, cfire 0.12.7)

MINGW64_NT-10.0-22621 x86_64, 6 cores. Total 3414.6 s, of it 502.5 s the gui-e2e runs that failed at their start (below), so ~2912 s without them.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| suite | `src/adapters/clilink` | 82.3 | pass | 6 | 47 | 0 |
| suite | `src/adapters/config` | 52.6 | pass | 8 | 53 | 0 |
| suite | `src/adapters/crypto` | 56.4 | pass | 15 | 47 | 0 |
| suite | `src/adapters/fonts` | 49.3 | pass | 4 | 47 | 0 |
| suite | `src/adapters/ipc` | 52.4 | pass | 12 | 52 | 0 |
| suite | `src/adapters/keychain` | 56.7 | pass | 6 | 47 | 0 |
| suite | `src/adapters/process` | 91.3 | pass | 20 | 47 | 0 |
| suite | `src/adapters/rdp` | 141.7 | pass | 33 | 47 | 0 |
| suite | `src/adapters/rootupdate` | 88.5 | fail | 7 | 47 | 0 |
| suite | `src/adapters/serverfs` | 84.3 | pass | 17 | 48 | 0 |
| suite | `src/adapters/ssh` | 144.1 | pass | 48 | 47 | 0 |
| suite | `src/adapters/uievents` | 90.9 | pass | 19 | 56 | 0 |
| suite | `src/adapters/vault` | 119.4 | pass | 58 | 47 | 0 |
| suite | `src/adapters/vaultremote` | 94.0 | pass | 10 | 50 | 0 |
| suite | `src/application` | 327.1 | pass | 271 | 132 | 0 |
| suite | `src/application/vaultserver` | 54.9 | pass | 22 | 51 | 0 |
| suite | `src/domain` | 154.9 | pass | 229 | 47 | 0 |
| suite | `src/drivers/cli` | 91.9 | pass | 4 | 115 | 0 |
| suite | `src/drivers/clicmd` | 106.5 | pass | 32 | 114 | 0 |
| suite | `src/drivers/vault-server` | 72.1 | pass | 16 | 53 | 0 |
| build | `cfire build` | 25.6 | pass |  |  |  |
| build | `scripts/build-gui.sh` | 26.7 | pass |  |  |  |
| e2e | `cli-e2e` | 306.5 | fail |  |  |  |
| e2e | `serve-e2e` | 246.9 | pass |  |  |  |
| e2e | `server-e2e` | 30.2 | pass |  |  |  |
| e2e | `sync-e2e` | 255.0 | pass |  |  |  |
| suites | **all 20** | 2011.3 | | 837 | 1194 | 0 |

### Windows VM, gui-e2e (warm) (2026-11-28, a7a7105, cfire 0.12.7)

MINGW64_NT-10.0-22621 x86_64, 6 cores. Total 439.6 s.

| Kind | Check | Seconds | Result | Own tests | `[auto]` | Objects |
|---|---|--:|---|--:|--:|--:|
| e2e | `gui-e2e terminal` | 54.5 | pass |  |  |  |
| e2e | `gui-e2e broadcast` | 20.1 | pass |  |  |  |
| e2e | `gui-e2e vault` | 36.4 | fail |  |  |  |
| e2e | `gui-e2e tunnels` | 12.7 | pass |  |  |  |
| e2e | `gui-e2e paste` | 12.4 | pass |  |  |  |
| e2e | `gui-e2e rdp` | 40.5 | pass |  |  |  |
| e2e | `gui-e2e webgl` | 20.9 | pass |  |  |  |
| e2e | `gui-e2e fullscreen` | 14.7 | pass |  |  |  |
| e2e | `gui-e2e vim` | 10.3 | pass |  |  |  |
| e2e | `gui-e2e clilink` | 6.9 | pass |  |  |  |
| e2e | `gui-e2e update` | 11.0 | pass |  |  |  |
| e2e | `gui-e2e selfupdate` | 65.5 | pass |  |  |  |

On the VM (Windows 11 in MSYS2 CLANG64, the desktop session, cfire's `--no-shard` shim,
CF-207) the suites keep no objects, so *Objects* is 0. **Its warm suite rows are each a whole
compile** (CF-221: `--no-cache` turns off the binary cache, and `--no-shard` with
`--release` keeps nothing else): what a suite a change reaches costs there, not an unchanged
one. `src/adapters/rootupdate` fails 3 tests off Linux (ROADMAP §7). `cli-e2e` fails 3 of
525 checks on Windows (the agent guide's comparison, a symbolic link the desktop session may
not make; ROADMAP §7). `gui-e2e vault` fails at *browser keys* (ROADMAP §7). In the first
warm pass every gui-e2e run failed at its start: a Windows Firewall prompt for a test binary
listening on 0.0.0.0 (`serverfs`) stayed on top and took the windows' focus; that case no
longer runs on Windows (`a7a7105`), and the gui-e2e table is the run after it.

## The release's Linux packages

The workflow's Linux job, timed on GitHub's 4-core `ubuntu-24.04` runners. From milestone
83 each format is its own job (`linux-deb`, `linux-rpm`) and keeps cfire's build in
`actions/cache` between runs; `run=linux-packages` builds and tests the run's own commit and
releases nothing. *Wall* is the slower of the two jobs.

| Run | What | `linux-deb` | `linux-rpm` | Wall |
|---|---|--:|--:|--:|
| [46079226194](https://github.com/samaniegoluis/flint/actions/runs/46079226194) | v0.39.0, one job: both formats in a row, no cache (its Package step 51m44s) | | | 54m17s |
| [46088076878](https://github.com/samaniegoluis/flint/actions/runs/46088076878) | the two jobs in parallel, no cache yet | 31m30s | 18m18s | ~31 min |
| [46097077185](https://github.com/samaniegoluis/flint/actions/runs/46097077185) | a cold cache (the first run with CF-218 worked around) | 18m48s | 15m28s | ~19 min |
| [46108668891](https://github.com/samaniegoluis/flint/actions/runs/46108668891) | warm, the first with CF-220 worked around: deb compiled 19 of 284 units (9 inputs changed); rpm's cache came from before the fix, so it compiled 283 with no input changed (CF-220 itself) | 5m44s | 19m28s | ~19 min |
| [46108677037](https://github.com/samaniegoluis/flint/actions/runs/46108677037) | warm, nothing changed: every unit reused in both (`compiled:` empty, 0 inputs changed) | 3m16s | 3m09s | ~3.5 min |

Warm, a job's Package step is 1.5-2 min and the install, run and removal in clean
containers about 1 min; the rest is the image and the cache's restore and save. Between
the cold and the warm runs, three cfire bugs each made one job compile everything again
with the code unchanged, found from the job's own `package: compiled / reused / inputs
changed` lines: CF-218 (the runtime's and headers' mtimes), CF-219 (a prune deleting a
live object) and CF-220 (a package's header in the folder's listing order). Each has a
workaround in `scripts/package.sh` until cfire fixes it (milestone 86 re-runs their
repros).

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
- **`--no-cache` costs a build, not only the cached pass** (CF-221, found at 83's close):
  it also turns off cfire's binary cache. On the Mac, Docker and Zorin the per-unit objects
  are kept anyway, so a warm row pays only the link. On Windows (`--no-shard`, `--release`)
  nothing else is kept, so the VM's warm suite rows are each a whole compile: what a suite
  that a change reaches costs there, not what an unchanged one does (`scripts/test.sh`
  passes no `--no-cache`, so an unchanged suite is a cached pass). 84 times a run without
  its cached pass by removing the test cache's entry, and measures the VM's warm rows again.
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
