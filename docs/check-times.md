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
