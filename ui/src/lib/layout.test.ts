import { describe, expect, it } from 'vitest';
import { defaultTracks, dividers, edges, layoutAfterClose, layoutForSplit, moveDivider, MIN_TRACK, placement, template, trackCounts } from './layout';

describe('layout', () => {
  it('picks the layout a split leaves', () => {
    expect(layoutForSplit(2, 'right')).toBe('cols');
    expect(layoutForSplit(2, 'down')).toBe('rows');
    expect(layoutForSplit(3, 'right')).toBe('large');
    expect(layoutForSplit(3, 'down')).toBe('large');
    expect(layoutForSplit(4, 'down')).toBe('grid');
  });

  it('leaves no hole when a pane closes', () => {
    expect(layoutAfterClose(2, 'grid')).toBe('cols');
    expect(layoutAfterClose(2, 'large')).toBe('cols');
    expect(layoutAfterClose(2, 'rows')).toBe('rows');
    expect(layoutAfterClose(3, 'grid')).toBe('grid');
  });

  it('counts tracks per layout', () => {
    expect(trackCounts('cols', 3)).toEqual({ cols: 3, rows: 1 });
    expect(trackCounts('rows', 4)).toEqual({ cols: 1, rows: 4 });
    expect(trackCounts('grid', 3)).toEqual({ cols: 2, rows: 2 });
    expect(trackCounts('grid', 2)).toEqual({ cols: 2, rows: 1 });
    expect(trackCounts('large', 4)).toEqual({ cols: 2, rows: 3 });
    expect(trackCounts('grid', 1)).toEqual({ cols: 1, rows: 1 });
  });

  it('starts equal, the large pane wider', () => {
    expect(defaultTracks('cols', 2)).toEqual({ cols: [1, 1], rows: [1] });
    expect(defaultTracks('large', 3)).toEqual({ cols: [1.7, 1], rows: [1, 1] });
  });

  it('places every pane in its cell', () => {
    expect(placement('cols', 2, 1)).toEqual({ gridColumn: '2', gridRow: '1' });
    expect(placement('rows', 3, 2)).toEqual({ gridColumn: '1', gridRow: '3' });
    expect(placement('grid', 4, 3)).toEqual({ gridColumn: '2', gridRow: '2' });
    expect(placement('grid', 3, 2)).toEqual({ gridColumn: '1 / span 2', gridRow: '2' });
    expect(placement('large', 3, 0)).toEqual({ gridColumn: '1', gridRow: '1 / span 2' });
    expect(placement('large', 4, 3)).toEqual({ gridColumn: '2', gridRow: '3' });
    expect(placement('cols', 1, 0)).toEqual({ gridColumn: '1', gridRow: '1' });
  });

  it('draws a divider between each pair of tracks', () => {
    expect(dividers('cols', 3, [1, 1, 1], [1])).toEqual([
      { axis: 'cols', index: 0, from: 0, to: 1 }, { axis: 'cols', index: 1, from: 0, to: 1 },
    ]);
    const large = dividers('large', 3, [3, 1], [1, 1]);
    expect(large).toHaveLength(2);
    expect(large[1]).toEqual({ axis: 'rows', index: 0, from: 0.75, to: 1 });
    expect(dividers('grid', 3, [1, 1], [1, 1])[0]).toEqual({ axis: 'cols', index: 0, from: 0, to: 0.5 });
  });

  it('moves a divider within bounds', () => {
    expect(edges([1, 1, 2])).toEqual([0, 0.25, 0.5, 1]);
    const t = moveDivider([1, 1], 0, 0.7);
    expect(t[0]).toBeCloseTo(0.7);
    expect(t[1]).toBeCloseTo(0.3);
    const clamped = moveDivider([1, 1], 0, 0.99);
    expect(clamped[1]).toBeCloseTo(MIN_TRACK);
    // The third track keeps its size.
    const three = moveDivider([1, 1, 2], 0, 0.3);
    expect(three[2]).toBeCloseTo(0.5);
    expect(three[0]).toBeCloseTo(0.3);
    expect(three[1]).toBeCloseTo(0.2);
    // Clamped against the far edge of the next track, not the whole axis.
    expect(moveDivider([1, 1, 2], 1, 0.3)[1]).toBeCloseTo(MIN_TRACK);
    expect(moveDivider([1, 1], 3, 0.5)).toEqual([0.5, 0.5]);
  });

  it('writes the grid template', () => {
    expect(template([1.7, 1])).toBe('minmax(0, 1.7fr) minmax(0, 1fr)');
  });
});
