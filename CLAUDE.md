# CLAUDE.md

Flint is an open-source SSH client (GUI + CLI over one encrypted vault) written in
[cfire](https://github.com/gsandoval/cfire), a Go-flavoured language that lowers to C++23.
It is the rewrite of the author's Go/Wails client Tether
(`~/Personal/Proyectos/go/tether`), which is the reference for existing behaviour.

**This project uses the Lean flow (`lean-spec`, `lean-build`).**

## Workflow

| To… | Use |
|---|---|
| Build the next milestone | `lean-build` (no argument = the first milestone in `docs/spec.md` not in `docs/build-log.md`) |
| Build it and chain into the next when nothing needs the owner | `lean-build --continue` |
| Check or fix the spec | `lean-spec` (check mode) |
| Plan the next version once the current spec ships | `lean-spec` (next-spec mode, drawn from `ROADMAP.md`) |

There are no phase files, `progress.md`, `active-context.md` or `manual-tests.md`. State
is `docs/build-log.md` plus `git log`.

## Read first

| File | What it holds |
|---|---|
| [`docs/spec.md`](docs/spec.md) | The current spec (v9, Versions and a faster desktop): scope, stack, architecture, **Principles**, milestones. Earlier: [`spec-v1.md`](docs/spec-v1.md) (MVP), [`spec-v2.md`](docs/spec-v2.md), [`spec-v3.md`](docs/spec-v3.md) (Flint holds the vault), [`spec-v4.md`](docs/spec-v4.md) (Files), [`spec-v5.md`](docs/spec-v5.md) (Between servers), [`spec-v6.md`](docs/spec-v6.md) (Tunnels), [`spec-v7.md`](docs/spec-v7.md) (Paste into the terminal), [`spec-v8.md`](docs/spec-v8.md) (Embedded RDP) |
| [`ROADMAP.md`](ROADMAP.md) | Everything beyond the current spec. The backlog |
| [`docs/build-log.md`](docs/build-log.md) | One line per finished milestone. The only state |
| [`docs/decisions.md`](docs/decisions.md) | One-line decision log |
| [`docs/cfire-upstream.md`](docs/cfire-upstream.md) | Gaps in cfire, handed to its author |
| [`docs/design-prompt.md`](docs/design-prompt.md) | Brief used to generate the UI in Claude Design |

## Rules

1. **Principles in `docs/spec.md` are hard rules.** Those marked `(owner review)` stop
   `lean-build` for the owner whenever a diff touches them.
2. **Build with `lean-build`, one whole milestone at a time:** one plan approval, then
   build, verify, report.
3. **Verify, don't delegate.** Use `cfire test` blocks, the webui headless runner, CLI
   end-to-end runs and the docs build (`site/`). Ask the owner only for what a person must
   do: a real OS keychain dialog, macOS signing, a visual judgement call.
4. **cfire gaps go to `docs/cfire-upstream.md` immediately.** Add an entry with a repro the
   moment cfire is missing something, is wrong, or forces native C++. Put the shim in
   `adapters/`, tag it `// CFIRE-UPSTREAM: CF-NNN`, and keep the core in pure cfire. These
   are project-specific capture entries for `lean-build`.
5. **Docs ship with the code.** Any user-visible change (CLI command, flag, screen,
   behaviour) updates `site/` (Astro + Starlight) in the same commit. A rework updates or
   deletes the pages it made stale.
   **The landing's CLI demo ships with the CLI too:** any change to a CLI command, flag,
   output or error updates the demo (`site/src/demo/`) in the same commit: the command, its
   data and its tour step (D-026).
6. **The landing grows with the product** (`site/src/content/docs/index.mdx`, D-027). When
   a change adds something a visitor would care about (a surface, a headline feature, a
   screen worth showing, a security or scripting property), update the landing in the
   same commit if its place is clear: an existing section it belongs to, a "What's next"
   item that shipped and must leave the list. If it is not clear (a new section, replacing
   something, whether it earns a place at all), ask the owner at plan time. A change to a
   screen in the landing's app screenshots re-runs `npm run shots:gui` in `site/`.
7. **Nothing lives only in chat.** A new feature idea goes into `ROADMAP.md`. A decision that
   is expensive to reverse goes into `docs/decisions.md`.
8. **Stay in scope.** Work outside the current milestone goes into the roadmap, not into the
   diff.
9. **Isolate an unexplained failure before the second attempt.** A test that fails or
   freezes with no known cause is never chased by rerunning a whole suite. Run it alone
   (`FLINT_E2E_ONLY=<step>` for the e2e suites, a name filter for `cfire test`) in a loop
   of N runs that prints the rate (`scripts/repeat.sh <run> <N>`; on macOS the runs use the real window, D-068), and
   iterate there. A fix counts when that loop shows 0 failures in N runs; then the step
   goes back into its run and the full suite runs once to confirm. The measured rate goes
   into the failure's ROADMAP entry (owner, 2026-11-10).
10. **A release at each milestone's close** (D-077). After `docs: close milestone NN`, run
    `scripts/release.sh` (a dry run: the next version and its changelog section), write a
    short summary of the version for a person, and run it again with `--apply --summary`.
    It commits `CHANGELOG.md` and tags `vX.Y.Z`; it never pushes, so the tag goes up with
    the branch (`git push origin main vX.Y.Z`) and the merge stays a fast-forward. A
    milestone with no `feat` or `fix` makes no release.

## Language

Code, comments, docs, commits: English. UI copy: English unless decided otherwise.
