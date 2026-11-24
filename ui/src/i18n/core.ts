// The core's messages in the page's language (milestone 69, D-084, Principle 21).
// A message from the core is {code, id, params, message}: the page shows
// `core.<id>` from its catalog with the params in place, and the core's English
// `message` when the language has no entry or the core names no id.
//
// Events carry `id` and `params`; a rejected RPC carries only "code: text", so its id
// is found again by matching the text against the templates the core sends in
// `app_info` (`src/domain/messages.cf`, the same matcher as `core_message_of`).

import { find, interpolate, language } from './index';

export interface CoreMessageDef {
  id: string;
  code: string;
  /** English text; `{name}` is a param, passed in the order each name first appears. */
  text: string;
}

export interface CoreMessage {
  code: string;
  message: string;
  id?: string;
  params?: string[];
}

let defs: CoreMessageDef[] = [];

/** The core's templates, from `app_info` at start. */
export function setCoreMessages(list: CoreMessageDef[] | undefined): void {
  defs = list ?? [];
}

interface Template { lits: string[]; names: string[] }

function parseTemplate(text: string): Template {
  const lits: string[] = [];
  const names: string[] = [];
  let start = 0;
  let pos = 0;
  while (pos < text.length) {
    const open = text.indexOf('{', pos);
    if (open < 0) break;
    const close = text.indexOf('}', open);
    if (close < 0) break;
    lits.push(text.slice(start, open));
    names.push(text.slice(open + 1, close));
    start = pos = close + 1;
  }
  lits.push(text.slice(start));
  return { lits, names };
}

/** A template's param names, each once, in the order they first appear. */
export function paramOrder(text: string): string[] {
  return [...new Set(parseTemplate(text).names)];
}

function matchFrom(text: string, t: Template, k: number, pos: number, out: string[]): boolean {
  const n = t.names.length;
  if (k === n) return pos === text.length;
  const next = t.lits[k + 1];
  if (k + 1 === n) {
    if (text.length < pos + next.length || !text.endsWith(next)) return false;
    out.push(text.slice(pos, text.length - next.length));
    return true;
  }
  if (next.length === 0) return false;
  let from = pos;
  for (;;) {
    const at = text.indexOf(next, from);
    if (at < 0) return false;
    out.push(text.slice(pos, at));
    if (matchFrom(text, t, k + 1, at + next.length, out)) return true;
    out.pop();
    from = at + 1;
  }
}

/** The params of `text` under `template` (in paramOrder), or null when it does not match. */
export function matchTemplate(template: string, text: string): string[] | null {
  const t = parseTemplate(template);
  if (!text.startsWith(t.lits[0])) return null;
  const values: string[] = [];
  if (!matchFrom(text, t, 0, t.lits[0].length, values)) return null;
  const out: string[] = [];
  for (const name of new Set(t.names)) {
    const seen = t.names.flatMap((n, i) => (n === name ? [values[i]] : []));
    if (seen.some((v) => v !== seen[0])) return null;
    out.push(seen[0]);
  }
  return out;
}

/** The id and params the core gives `message` under `code`, or null. */
export function matchCoreMessage(code: string, message: string): { id: string; params: string[] } | null {
  for (const d of defs) {
    if (d.code !== code) continue;
    const params = matchTemplate(d.text, message);
    if (params) return { id: d.id, params };
  }
  return null;
}

/** A core message in the page's language: `core.<id>` with its params, or `message`. */
export function coreText(m: CoreMessage): string {
  let id = m.id ?? '';
  let params = m.params ?? [];
  if (!id) {
    const found = matchCoreMessage(m.code, m.message);
    if (!found) return m.message;
    ({ id, params } = found);
  }
  // English is the core's own text: the catalog's English entry only mirrors it.
  if (language() === 'en') return m.message;
  const def = defs.find((d) => d.id === id);
  const text = find(`core.${id}`);
  if (!def || text === undefined) return m.message;
  const names = paramOrder(def.text);
  return interpolate(text, Object.fromEntries(names.map((n, i) => [n, params[i] ?? ''])));
}
