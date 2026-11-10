// Paste an image into the terminal (milestone 25, D-066). On a paste whose clipboard
// holds an image and no text, the image is staged on this machine (as a drop, CF-004),
// written on the pane's host by the core over the pane's own session, and its path is
// pasted into the pane instead: a program there (Claude Code, a shell) reads it.
// A clipboard that carries text too pastes the text, as before.

import { api, toFlintError } from '../api/backend';
import { STAGE_CHUNK, bytesToB64 } from '../files/store';

export type PasteChoice = { kind: 'text' } | { kind: 'image'; file: File };

/** What a paste should do with `dt`: text whenever there is any, else the first image. */
export function pasteChoice(dt: Pick<DataTransfer, 'types' | 'getData' | 'items' | 'files'> | null): PasteChoice {
  if (!dt) return { kind: 'text' };
  const types = [...(dt.types ?? [])];
  if (types.includes('text/plain') && dt.getData('text/plain') !== '') return { kind: 'text' };
  for (const item of [...(dt.items ?? [])]) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return { kind: 'image', file: f };
    }
  }
  for (const f of [...(dt.files ?? [])]) if (f.type.startsWith('image/')) return { kind: 'image', file: f };
  return { kind: 'text' };
}

/** Megabytes as the paste limit names them. */
export function mb(bytes: number): string {
  const v = bytes / 1048576;
  return v >= 10 ? `${Math.round(v)} MB` : `${v.toFixed(1)} MB`;
}

/** Refused before any upload when `file` is over `limitMb`; the core checks again. */
export function overLimit(file: { name: string; size: number }, limitMb: number): string | null {
  if (file.size <= limitMb * 1048576) return null;
  return `${file.name || 'The image'} is ${mb(file.size)}, over the ${limitMb} MB paste limit. Use Files to upload it`;
}

let seq = 0;

/** Stages `file`, has the core write it on `session`'s host, and returns the text to
 *  paste: the path, escaped for a shell, and a space after it as a terminal leaves
 *  after a dropped file. Throws a FlintError with the reason. */
export async function uploadPaste(session: string, file: File): Promise<string> {
  const drop = `p-${Date.now().toString(36)}-${++seq}`;
  const rel = 'clip';
  try {
    if (file.size === 0) await api.filesStage(drop, rel, '');
    for (let off = 0; off < file.size; off += STAGE_CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + STAGE_CHUNK).arrayBuffer());
      await api.filesStage(drop, rel, bytesToB64(buf));
    }
    const r = await api.terminalPaste({ session, drop, rel, name: file.name, kind: file.type });
    return r.text + ' ';
  } catch (err) {
    api.filesStageDiscard(drop).catch(() => {});
    throw toFlintError(err);
  }
}
