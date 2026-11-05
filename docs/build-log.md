# Build log

One line per finished milestone, appended by `lean-build`. This is the project's only
state file: the next milestone to build is the first one in `docs/spec.md` not listed here.
The Model column (`opus`, `opusplan`, …) lets the owner compare models across milestones.

| Date | Milestone | Model | Duration | Owner stops | Commits | Notes |
|---|---|---|---|---|---|---|
| 2026-11-05 | 01 Scaffold + risk spike | opus | ~40 min | 1 (P4/P5 review at close) | 5 | libssh + libsodium + SQLCipher linked on macOS and Linux (one libcrypto each); SSH PTY → xterm.js proven headless on macOS and under Xvfb on Linux; 19 new cfire gaps (CF-012..CF-030), CF-017 (no package namespaces) is the one that shapes the code |
