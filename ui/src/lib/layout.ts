// Split pane layouts (milestone 20, design 18*). A tab holds one to four panes in one
// of four arrangements, drawn as a CSS grid: `cols` and `rows` are the grid's track
// sizes (fractions), one entry per track. Dragging a divider moves the space between
// the two tracks beside it.

export type Layout = 'cols' | 'rows' | 'grid' | 'large';
export type SplitDir = 'right' | 'down';

export const MAX_PANES = 4;
/** The smallest share of the space a track keeps while a divider is dragged. */
export const MIN_TRACK = 0.15;

export const LAYOUTS: Layout[] = ['cols', 'rows', 'grid', 'large'];

export const LAYOUT_TITLES: Record<Layout, string> = {
  cols: 'Side by side',
  rows: 'Stacked',
  grid: 'Grid 2 × 2',
  large: 'One large + two small',
};

/**
 * The layout once a split leaves `count` panes: two panes follow the direction
 * (right: side by side, down: stacked), three are one large + two small, four a grid.
 */
export function layoutForSplit(count: number, dir: SplitDir): Layout {
  if (count <= 2) return dir === 'right' ? 'cols' : 'rows';
  return count === 3 ? 'large' : 'grid';
}

/** The layout once a pane closes and `count` remain: two panes in a grid or a large
 * layout would leave a hole, so they go side by side. */
export function layoutAfterClose(count: number, was: Layout): Layout {
  if (count <= 2 && (was === 'grid' || was === 'large')) return 'cols';
  return was;
}

/** How many column and row tracks `n` panes take in `layout`. */
export function trackCounts(layout: Layout, n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  switch (layout) {
    case 'cols': return { cols: n, rows: 1 };
    case 'rows': return { cols: 1, rows: n };
    case 'grid': return { cols: 2, rows: n === 2 ? 1 : 2 };
    case 'large': return { cols: 2, rows: n - 1 };
  }
}

/** The tracks a layout starts with: equal, except the large pane, which takes more. */
export function defaultTracks(layout: Layout, n: number): { cols: number[]; rows: number[] } {
  const c = trackCounts(layout, n);
  const cols = Array(c.cols).fill(1);
  if (layout === 'large' && n > 1) cols[0] = 1.7;
  return { cols, rows: Array(c.rows).fill(1) };
}

/** Where pane `i` of `n` sits (CSS grid-column / grid-row, 1-based). */
export function placement(layout: Layout, n: number, i: number): { gridColumn: string; gridRow: string } {
  if (n <= 1) return { gridColumn: '1', gridRow: '1' };
  switch (layout) {
    case 'cols': return { gridColumn: String(i + 1), gridRow: '1' };
    case 'rows': return { gridColumn: '1', gridRow: String(i + 1) };
    case 'grid':
      // Three panes in a grid: the third takes the whole bottom row.
      if (n === 3 && i === 2) return { gridColumn: '1 / span 2', gridRow: '2' };
      return { gridColumn: String((i % 2) + 1), gridRow: String(Math.floor(i / 2) + 1) };
    case 'large':
      if (i === 0) return { gridColumn: '1', gridRow: `1 / span ${n - 1}` };
      return { gridColumn: '2', gridRow: String(i) };
  }
}

/** A divider between track `i` and `i + 1` of one axis. `span` says where it is drawn
 * along the other axis (for `large`, the row dividers only cross the right column). */
export interface Divider {
  axis: 'cols' | 'rows';
  index: number;
  /** Start and end of the divider along the other axis, as fractions of it (0-1). */
  from: number;
  to: number;
}

export function dividers(layout: Layout, n: number, cols: number[], rows: number[]): Divider[] {
  const out: Divider[] = [];
  // Three panes in a grid: the third spans the bottom row, so the column divider
  // stops at the top row's edge.
  const colTo = layout === 'grid' && n === 3 ? edges(rows)[1] : 1;
  for (let i = 0; i + 1 < cols.length; i++) out.push({ axis: 'cols', index: i, from: 0, to: colTo });
  // One large + small: the row dividers cross only the right column.
  const rowFrom = layout === 'large' ? edges(cols)[1] : 0;
  for (let i = 0; i + 1 < rows.length; i++) out.push({ axis: 'rows', index: i, from: rowFrom, to: 1 });
  return out;
}

/** Edges of the tracks as fractions of the whole (0 … 1), `tracks.length + 1` values. */
export function edges(tracks: number[]): number[] {
  const total = tracks.reduce((a, b) => a + b, 0) || 1;
  const out = [0];
  let acc = 0;
  for (const t of tracks) { acc += t; out.push(acc / total); }
  return out;
}

/**
 * Moves the divider after track `i` to `at` (a fraction of the whole axis, 0-1),
 * keeping both tracks beside it at least MIN_TRACK of the whole. Other tracks keep
 * their size. Returns tracks that sum to 1.
 */
export function moveDivider(tracks: number[], i: number, at: number): number[] {
  const total = tracks.reduce((a, b) => a + b, 0) || 1;
  const norm = tracks.map((t) => t / total);
  if (i < 0 || i + 1 >= norm.length) return norm;
  const e = edges(norm);
  const lo = e[i] + MIN_TRACK;
  const hi = e[i + 2] - MIN_TRACK;
  if (lo > hi) return norm;
  const x = Math.min(hi, Math.max(lo, at));
  const out = [...norm];
  out[i] = x - e[i];
  out[i + 1] = e[i + 2] - x;
  return out;
}

/** CSS grid-template for a list of tracks. */
export function template(tracks: number[]): string {
  return tracks.map((t) => `minmax(0, ${+t.toFixed(4)}fr)`).join(' ');
}
