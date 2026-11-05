# The landing's CLI demo

A simulated `flint` in the browser (D-026). It opens from **Try the CLI** on the home page
(`src/components/CliDemo.astro`). Nothing here talks to a network or runs anything.

| Path | Holds |
|---|---|
| `lib/cli.ts` | The `flint` commands: flags, messages, JSON, exit codes, copied from `src/drivers/cli/` |
| `lib/vault.ts` | The vault rules and messages of `src/application/` and `src/domain/vault.cf` |
| `lib/args.ts`, `lib/errors.ts`, `lib/format.ts` | Flag parsing, error codes and table output, as in the CLI |
| `lib/remote.ts` | The fake Linux every host opens after `flint connect` |
| `lib/session.ts` | One terminal: prompts, remote shells, Tab completion, the tour. No DOM |
| `data/seed-vault.json` | The demo vaults (`Demo`, unlocked; `Work`, locked) |
| `data/remote-fs.json` | The read-only files of the fake Linux |
| `data/tour.json` | The guided tour's steps |

## When the CLI changes

CLAUDE.md rule 5: any change to a CLI command, flag, output or error updates the demo in
the same commit.

1. Add or change the command in `lib/cli.ts` (and `COMMANDS`), with the CLI's exact text.
2. Add seed data if the command needs some, and a tour step if it is worth showing.
3. Add a case to `test/demo.test.ts`, then run `npm test` and `npm run build && npm run test:e2e`.

`npm test` fails on its own when the CLI's usage text, flags, error codes or the CLI
reference gain something the demo lacks.
