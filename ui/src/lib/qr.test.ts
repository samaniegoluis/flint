import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { qrCode } from './qr';

const url = 'https://ntfy.sh/flint-abcdefghijklmnopqrstuvwx';

describe('qrCode', () => {
  it('draws every dark module of the code, and only those', () => {
    const c = qrCode(url);
    const ref = qrcode(0, 'M');
    ref.addData(url, 'Byte');
    ref.make();
    expect(c.size).toBe(ref.getModuleCount());
    let dark = 0;
    for (let y = 0; y < c.size; y++) for (let x = 0; x < c.size; x++) if (ref.isDark(y, x)) dark++;
    expect(c.path.split('z').filter(Boolean)).toHaveLength(dark);
  });

  it('has its three finder patterns', () => {
    const c = qrCode(url);
    const n = c.size;
    for (const [x, y] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
      expect(c.path).toContain(`M${x} ${y}h1v1h-1z`);
      expect(c.path).toContain(`M${x + 3} ${y + 3}h1v1h-1z`);
    }
  });

  it('is the same code for the same text', () => {
    expect(qrCode(url).path).toBe(qrCode(url).path);
    expect(qrCode(url + 'x').path).not.toBe(qrCode(url).path);
  });
});
