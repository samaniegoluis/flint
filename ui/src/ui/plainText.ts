// What every text field spreads (milestone 62): no spelling correction, no
// autocorrect, no automatic capitals. Flint's fields hold aliases, hostnames, paths,
// commands, tags and searches, and macOS rewriting `codbox` into `codebox` (or a
// search into a word it knows) is never what was typed. Only prose (a host's notes)
// keeps correction, and says so with `data-prose`. `ui/src/ui/plainText.test.ts`
// checks every field.
export const plainText = { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off' } as const;
