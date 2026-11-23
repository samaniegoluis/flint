// The command palette's search (milestone 62): the query splits on spaces and every
// word must appear whole, as typed, in one of an item's fields. Case and accents are
// ignored both ways (`produccion` finds `Producción`, `Producción` finds
// `produccion`); word order does not matter; each word may come from a different
// field; what is typed together is matched together (`stg-db` is one word). Letters
// scattered across a name or across fields never match, and initials are not
// searched (`cdbx` finds nothing): a result is always a word the person can see
// highlighted, or one the row names (`tag: db`).

/** One field of an item. `primary` marks the name the row leads with (a host's alias). */
export interface Field {
  name: string;
  text: string;
  primary?: boolean;
}

export interface SearchMatch {
  score: number;
  /** Matched character positions in each field's original text, by field name. */
  positions: Record<string, number[]>;
}

// Per word, the best place it was found (summed over the words).
const AT_PRIMARY_START = 400;
const AT_PRIMARY_SEGMENT = 300;
const IN_PRIMARY = 200;
const IN_OTHER = 100;

const isSegmentStart = (text: string, i: number) => i > 0 && /[-_.]/.test(text[i - 1]);

/** The query's words: split on whitespace, case and accents folded. */
export function queryWords(query: string): string[] {
  return query.split(/\s+/).filter(Boolean).map((w) => fold(w).text);
}

/**
 * `text` lower-cased with its accents removed, and for each character of the result
 * the index of the character of `text` it came from, so a match maps back for
 * highlighting.
 */
export function fold(text: string): { text: string; from: number[] } {
  let out = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const f = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of f) { out += ch; from.push(i); }
  }
  return { text: out, from };
}

/**
 * Matches `query` against an item's fields. Null when a word is in none of them; an
 * empty query matches everything with score 0.
 */
export function search(query: string, fields: Field[]): SearchMatch | null {
  const words = queryWords(query);
  if (words.length === 0) return { score: 0, positions: {} };
  const folded = fields.map((f) => ({ field: f, ...fold(f.text) }));
  let score = 0;
  const positions: Record<string, number[]> = {};
  for (const w of words) {
    let best: { score: number; field: string; chars: number[] } | null = null;
    for (const f of folded) {
      // Every occurrence, so the alias's start beats a later one in the same field.
      for (let at = f.text.indexOf(w); at >= 0; at = f.text.indexOf(w, at + 1)) {
        const s = f.field.primary
          ? at === 0 ? AT_PRIMARY_START : isSegmentStart(f.text, at) ? AT_PRIMARY_SEGMENT : IN_PRIMARY
          : IN_OTHER;
        // Earlier is better, by a little: never enough to cross a tier.
        const total = s - Math.min(at, 50);
        if (!best || total > best.score) {
          const chars = new Set<number>();
          for (let k = at; k < at + w.length; k++) chars.add(f.from[k]);
          best = { score: total, field: f.field.name, chars: [...chars] };
        }
      }
    }
    if (!best) return null;
    score += best.score;
    const into = (positions[best.field] ??= []);
    for (const c of best.chars) if (!into.includes(c)) into.push(c);
  }
  for (const k of Object.keys(positions)) positions[k].sort((a, b) => a - b);
  return { score, positions };
}

// Splits `text` into plain and matched runs for rendering.
export function highlight(text: string, positions: number[]): { text: string; match: boolean }[] {
  const set = new Set(positions);
  const out: { text: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    const last = out[out.length - 1];
    if (last && last.match === m) last.text += text[i];
    else out.push({ text: text[i], match: m });
  }
  return out;
}

/** A host's fields, in the order the row cares about them. */
export interface HostFields {
  alias: string;
  label: string;
  hostname: string;
  tags: string[];
  group: string;
}

export function hostFields(h: HostFields): Field[] {
  return [
    { name: 'alias', text: h.alias, primary: true },
    { name: 'label', text: h.label },
    { name: 'hostname', text: h.hostname },
    ...h.tags.map((t, i) => ({ name: 'tag:' + i, text: t })),
    { name: 'group', text: h.group },
  ];
}

/**
 * A folder path as the row shows it (`a / b`) and the positions of a match in the
 * stored path (`a/b`) moved to it.
 */
export function folderDisplay(group: string, positions: number[] = []): { text: string; positions: number[] } {
  const shift: number[] = [];
  let slashes = 0;
  for (let i = 0; i < group.length; i++) {
    shift.push(i + 2 * slashes);
    if (group[i] === '/') slashes++;
  }
  return { text: group.split('/').join(' / '), positions: positions.map((p) => shift[p] + (group[p] === '/' ? 1 : 0)) };
}
