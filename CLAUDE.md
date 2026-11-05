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
| Plan the next version after the MVP ships | `lean-spec` (next-spec mode, drawn from `ROADMAP.md`) |

There are no phase files, `progress.md`, `active-context.md` or `manual-tests.md`. State
is `docs/build-log.md` plus `git log`.

## Read first

| File | What it holds |
|---|---|
| [`docs/spec.md`](docs/spec.md) | The MVP: scope, stack, architecture, **Principles**, milestones |
| [`ROADMAP.md`](ROADMAP.md) | Everything beyond the MVP. The backlog |
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
6. **Nothing lives only in chat.** A new feature idea goes into `ROADMAP.md`. A decision that
   is expensive to reverse goes into `docs/decisions.md`.
7. **Stay in scope.** Work outside the current milestone goes into the roadmap, not into the
   diff.

## Language

Code, comments, docs, commits: English. UI copy: English unless decided otherwise.
