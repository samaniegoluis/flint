// Paste an image into the terminal (milestone 25, D-066). On a paste whose clipboard
// holds an image and no text, the image is staged on this machine (as a drop, CF-004),
// written on the pane's host by the core over the pane's own session, and its path is
// pasted into the pane instead: a program there (Claude Code, a shell) reads it.
// A clipboard that carries text too pastes the text, as before.

import { api, toFlintError } from '../api/backend';
import { STAGE_CHUNK, bytesToB64 } from '../files/store';

// `native`: the paste event carried neither text nor an image, as WebKitGTK's does on
// Linux (an empty event, or empty text in xterm's textarea); the core reads the
// clipboard itself (`readClipboard`).
export type PasteChoice = { kind: 'text' } | { kind: 'image'; file: File } | { kind: 'native' };

/** What a paste should do with `dt`: text whenever there is any, else the first image,
 *  else the core reads the clipboard (`native`). */
export function pasteChoice(dt: Pick<DataTransfer, 'types' | 'getData' | 'items' | 'files'> | null): PasteChoice {
  if (!dt) return { kind: 'native' };
  const types = [...(dt.types ?? [])];
  if (types.includes('text/plain') && dt.getData('text/plain') !== '') return { kind: 'text' };
  for (const item of [...(dt.items ?? [])]) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return { kind: 'image', file: f };
    }
  }
  for (const f of [...(dt.files ?? [])]) if (f.type.startsWith('image/')) return { kind: 'image', file: f };
  // Another kind of file (a PDF): left to the terminal, which pastes its name if any
  // (files are milestone 26). Nothing usable at all: the core reads the clipboard.
  if ((dt.files?.length ?? 0) > 0) return { kind: 'text' };
  return { kind: 'native' };
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
  const drop = newDrop();
  try {
    if (file.size === 0) await api.filesStage(drop, CLIP, '');
    for (let off = 0; off < file.size; off += STAGE_CHUNK) {
      const buf = new Uint8Array(await file.slice(off, off + STAGE_CHUNK).arrayBuffer());
      await api.filesStage(drop, CLIP, bytesToB64(buf));
    }
  } catch (err) {
    api.filesStageDiscard(drop).catch(() => {});
    throw toFlintError(err);
  }
  return pasteStaged(session, { drop, name: file.name, mime: file.type });
}

const CLIP = 'clip';
const newDrop = () => `p-${Date.now().toString(36)}-${++seq}`;

/** An image the core staged from the clipboard, waiting to be written on a host. */
export type StagedImage = { drop: string; name: string; mime: string };

export type ClipboardRead = { kind: 'text'; text: string } | { kind: 'image'; image: StagedImage; size: number } | { kind: 'none' };

/** The core reads the clipboard (the paste event came empty, WebKitGTK): its text, or
 *  an image it stages for `pasteStaged`. Throws a FlintError with the reason. */
export async function readClipboard(): Promise<ClipboardRead> {
  const drop = newDrop();
  try {
    const r = await api.terminalClipboardRead(drop, CLIP);
    if (r.kind === 'text') return { kind: 'text', text: r.text };
    if (r.kind === 'image') return { kind: 'image', image: { drop, name: '', mime: r.mime }, size: r.size };
    return { kind: 'none' };
  } catch (err) {
    api.filesStageDiscard(drop).catch(() => {});
    throw toFlintError(err);
  }
}

/** Drops a staged image that will not be pasted (over the limit, no session). */
export function discardStaged(image: StagedImage) {
  api.filesStageDiscard(image.drop).catch(() => {});
}

/** Has the core write a staged image on `session`'s host and returns the text to
 *  paste (see `uploadPaste`). The core discards the staged file either way. */
export async function pasteStaged(session: string, image: StagedImage): Promise<string> {
  try {
    const r = await api.terminalPaste({ session, drop: image.drop, rel: CLIP, name: image.name, kind: image.mime });
    return r.text + ' ';
  } catch (err) {
    throw toFlintError(err);
  }
}
