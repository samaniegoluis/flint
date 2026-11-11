import { describe, expect, it } from 'vitest';
import { mb, overLimit, pasteChoice } from './paste';

// A DataTransfer as the paste event hands it, built from plain parts.
function dt(text: string | null, files: File[]) {
  const types = [...(text !== null ? ['text/plain'] : []), ...(files.length ? ['Files'] : [])];
  return {
    types,
    getData: (t: string) => (t === 'text/plain' && text !== null ? text : ''),
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })) as unknown as DataTransferItemList,
    files: files as unknown as FileList,
  };
}

const png = new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
const pdf = new File(['%PDF'], 'report.pdf', { type: 'application/pdf' });

describe('pasteChoice', () => {
  it('pastes an image that comes alone', () => {
    expect(pasteChoice(dt(null, [png]))).toEqual({ kind: 'image', file: png });
  });
  it('pastes the text when the clipboard has text and an image', () => {
    expect(pasteChoice(dt('A1\tB1', [png]))).toEqual({ kind: 'text' });
  });
  it('treats empty text as no text', () => {
    expect(pasteChoice(dt('', [png])).kind).toBe('image');
  });
  it('leaves plain text and other files to the terminal (files are milestone 26)', () => {
    expect(pasteChoice(dt('ls -la', [])).kind).toBe('text');
    expect(pasteChoice(dt(null, [pdf])).kind).toBe('text');
    expect(pasteChoice(null).kind).toBe('text');
  });
});

describe('the paste limit', () => {
  it('lets a file at the limit through and names the way around it above', () => {
    expect(overLimit({ name: 'a.png', size: 20 * 1048576 }, 20)).toBeNull();
    const msg = overLimit({ name: 'shot.png', size: 25 * 1048576 }, 20);
    expect(msg).toContain('shot.png is 25 MB');
    expect(msg).toContain('20 MB paste limit');
    expect(msg).toContain('Files');
    expect(overLimit({ name: '', size: 30 * 1048576 }, 10)).toContain('The image is 30 MB');
  });
  it('reads sizes as megabytes', () => {
    expect(mb(1572864)).toBe('1.5 MB');
    expect(mb(52428800)).toBe('50 MB');
  });
});
