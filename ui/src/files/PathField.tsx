// The path bar's breadcrumb, which turns into a text field to type or paste a path:
// a click on the current folder or on the bar's empty part, the Go to folder chord
// (⇧⌘G, Ctrl+Shift+G) or `/` and `~` typed in the list. ↵ goes there, Esc or leaving
// the field brings the breadcrumb back. A path that cannot be opened keeps the field
// open, so it can be corrected.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { toFlintError } from '../api/backend';
import { files } from './store';

const editors = new Map<string, (seed?: string) => void>();

/** Opens the path field of the pane `fkey` shows; `seed` replaces the path in it. */
export function editPath(fkey: string, seed?: string) {
  editors.get(fkey)?.(seed);
}

/** The chord's label for a tooltip. */
export const goToFolderKeys = (os: string) => (os === 'mac' ? '⇧⌘G' : 'Ctrl+Shift+G');

interface Props {
  fkey: string;
  path: string;
  os: string;
  /** The second pane (design 14d): its own `data-` names for the e2e. */
  pane?: boolean;
  /** Off while the folder cannot be browsed (the second pane logging in). */
  disabled?: boolean;
  onError: (message: string) => void;
  /** The field closed: the focus goes back to the list. */
  onDone: () => void;
  children: ReactNode;
}

export function PathField({ fkey, path, os, pane, disabled, onError, onDone, children }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const seeded = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (disabled) return;
    const open = (seed?: string) => { seeded.current = seed !== undefined; setBad(false); setDraft(seed ?? path); };
    editors.set(fkey, open);
    return () => { if (editors.get(fkey) === open) editors.delete(fkey); };
  }, [fkey, path, disabled]);

  // The whole path selected, so typing or pasting replaces it; a seed keeps the caret after it.
  useEffect(() => {
    if (!editing || !input.current) return;
    input.current.focus();
    if (!seeded.current) input.current.select();
  }, [editing]);

  const close = (refocus: boolean) => { setDraft(null); setBad(false); if (refocus) onDone(); };
  const submit = async () => {
    if (draft === null || busy) return;
    setBusy(true);
    try {
      await files.goTyped(fkey, draft);
      close(true);
    } catch (err) {
      setBad(true);
      onError(toFlintError(err).message);
      requestAnimationFrame(() => input.current?.select());
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    const name = pane ? { 'data-files-pane-path-input': '' } : { 'data-files-path-input': '' };
    return (
      <input ref={input} className={'crumbs-input grow' + (bad ? ' is-bad' : '')} {...name} aria-label="Go to folder" aria-invalid={bad || undefined}
        value={draft} readOnly={busy} spellCheck={false} autoCapitalize="off" autoCorrect="off" autoComplete="off" placeholder="/path, ~ or a folder here"
        onChange={(e) => { setDraft(e.target.value); setBad(false); }}
        onBlur={() => { if (!busy) close(false); }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          else if (e.key === 'Escape') { e.preventDefault(); close(true); }
        }} />
    );
  }
  const name = pane ? { 'data-files-pane-crumbs': '' } : { 'data-files-crumbs': '' };
  // The folders above stay buttons; the current one and the empty part open the field.
  const onClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (disabled || t.closest('button')) return;
    seeded.current = false;
    setDraft(path);
  };
  return (
    <nav className={'crumbs grow' + (disabled ? '' : ' can-edit')} aria-label="Path" {...name} onClick={onClick}
      title={disabled ? undefined : `Click to type or paste a path (${goToFolderKeys(os)})`}>
      {children}
    </nav>
  );
}
