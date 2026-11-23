// What every text field spreads (milestone 62): no spelling correction, no
// autocorrect, no automatic capitals. Flint's fields hold aliases, hostnames, paths,
// commands, tags and searches, and macOS rewriting `codbox` into `codebox` (or a
// search into a word it knows) is never what was typed. Only prose (a host's notes)
// keeps correction, and says so with `data-prose`. `ui/src/ui/plainText.test.ts`
// checks every field. Milestone 64: and no autofill (WebView2 stores what a field
// offers it, outside the vault); a password field may still name itself
// `current-password` or `new-password` after the spread.
export const plainText = { spellCheck: false, autoCorrect: 'off', autoCapitalize: 'off', autoComplete: 'off' } as const;
