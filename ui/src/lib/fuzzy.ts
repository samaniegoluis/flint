// A small fuzzy matcher for the command palette: every query character must appear
// in order. Contiguous runs and matches at word starts score higher. Returns the
// matched character positions for highlighting.

export interface FuzzyMatch {
  score: number;
  positions: number[];
}

const isBoundary = (text: string, i: number) => i === 0 || /[\s\-_/.@]/.test(text[i - 1]);

export function fuzzy(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return { score: 0, positions: [] };
  const t = text.toLowerCase();
  // A plain substring wins outright, earlier is better.
  const at = t.indexOf(q);
  if (at >= 0) {
    return { score: 1000 - at + (isBoundary(text, at) ? 50 : 0), positions: [...Array(q.length).keys()].map((k) => at + k) };
  }
  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    score += found === prev + 1 ? 10 : 1;
    if (isBoundary(text, found)) score += 5;
    positions.push(found);
    prev = found;
    ti = found + 1;
  }
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
