// The QR code of Settings → Notifications (milestone 63): the topic's address, drawn by
// the page as one SVG path (qrcode-generator, pinned, MIT, no network). Error correction
// M: the code is shown on a screen, never printed and scuffed.
import qrcode from 'qrcode-generator';

export interface QrCode {
  /** Modules per side, the quiet zone excluded. */
  size: number;
  /** One `M x y h1 v1 h-1 z` per dark module, in module units. */
  path: string;
}

export function qrCode(text: string): QrCode {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const parts: string[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (qr.isDark(y, x)) parts.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return { size, path: parts.join('') };
}
