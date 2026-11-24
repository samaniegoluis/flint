// A folder's list, shared by the Files view's two panes (milestones 17 and 19): the
// `..` row, the entries, keyboard moves, the context menu key, and dragging a row
// to the other pane (design 14d3a). Each pane passes what its actions do.

import { useEffect, useLayoutEffect, type RefObject } from 'react';
import type { FileEntry } from '../api/types';
import { Icon } from '../ui/Icon';
import { humanSize, humanTime } from './paths';
import { files, type FolderState } from './store';
import { editPath } from './PathField';
import { fmtDate, t } from '../i18n';

/** The row being dragged between panes: set on dragstart, cleared on dragend. */
export interface PaneDrag {
  key: string;
  entry: FileEntry;
}
let current: PaneDrag | null = null;
export const paneDrag = () => current;
export const setPaneDrag = (d: PaneDrag | null) => { current = d; };

const isMod = (e: React.KeyboardEvent, os: 'mac' | 'linux' | 'windows') => (os === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey);

interface Props {
  fkey: string;
  folder: FolderState | undefined;
  os: 'mac' | 'linux' | 'windows';
  listRef: RefObject<HTMLDivElement>;
  /** The folder row a drag from the other pane would drop into. */
  dropPath: string | null;
  onOpenFile: (e: FileEntry) => void;
  onMenu: (x: number, y: number, entry: FileEntry | null) => void;
  onRename: (e: FileEntry) => void;
  onRemove: (e: FileEntry) => void;
  onDownload?: (e: FileEntry) => void;
  /** ⌘→ (Ctrl+Shift+→): copy the selection to the other pane; ⌘← from the second pane. */
  onCopyOther?: (e: FileEntry) => void;
  copyKey?: 'ArrowRight' | 'ArrowLeft';
  /** Rows can be dragged to the other pane. */
  draggable: boolean;
}

export function FileList({ fkey, folder, os, listRef, dropPath, onOpenFile, onMenu, onRename, onRemove, onDownload, onCopyOther, copyKey = 'ArrowRight', draggable }: Props) {
  const path = folder?.path ?? '';
  const entries = folder?.entries ?? [];
  const selected = folder?.selected ?? null;
  const sel = entries.find((e) => e.path === selected) ?? null;

  // Each folder keeps its scroll position: restored when its list comes back.
  useLayoutEffect(() => {
    if (listRef.current && folder && !folder.loading) listRef.current.scrollTop = folder.scroll;
  }, [fkey, folder?.path, folder?.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.frow.sel')?.scrollIntoView({ block: 'nearest' });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (e: FileEntry) => {
    if (e.kind === 'dir' || e.kind === 'link') files.go(fkey, e.path);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    const i = sel ? entries.indexOf(sel) : -1;
    if (ev.key === 'ArrowUp' && isMod(ev, os)) { ev.preventDefault(); files.up(fkey); return; }
    // Go to folder: the path bar becomes a field (⇧⌘G, Ctrl+Shift+G); `/` and `~` start a path in it.
    if (ev.code === 'KeyG' && ev.shiftKey && !ev.altKey && (os === 'mac' ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey)) { ev.preventDefault(); editPath(fkey); return; }
    if ((ev.key === '/' || ev.key === '~') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); editPath(fkey, ev.key); return; }
    if (ev.key === 'ArrowDown' && isMod(ev, os)) { ev.preventDefault(); if (sel && onDownload) onDownload(sel); return; }
    // A held key repeats: one press, one copy.
    if (ev.key === copyKey && isMod(ev, os)) { ev.preventDefault(); if (sel && onCopyOther && !ev.repeat) onCopyOther(sel); return; }
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && (isMod(ev, os) || ev.key === 'Delete')) { ev.preventDefault(); if (sel) onRemove(sel); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); const n = entries[Math.min(entries.length - 1, i + 1)]; if (n) files.select(fkey, n.path); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i <= 0) files.select(fkey, null); else files.select(fkey, entries[i - 1].path); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!sel) files.up(fkey);
      else if (sel.kind === 'dir' || sel.kind === 'link') open(sel);
      else onRename(sel);
      return;
    }
    if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault();
      const row = listRef.current?.querySelector<HTMLElement>('.frow.sel') ?? listRef.current;
      const r = row?.getBoundingClientRect();
      onMenu((r?.left ?? 0) + 24, r?.bottom ?? 0, sel);
    }
  };

  return (
    <div className="col grow" role="grid" aria-label={t('file_list.folder_contents')} aria-busy={folder?.loading} style={{ minHeight: 0 }}>
      <div className="frow head" role="row"><span role="columnheader">{t('file_list.name')}</span><span className="num" role="columnheader">{t('file_list.size')}</span><span className="num" role="columnheader">{t('file_list.modified')}</span></div>
      <div ref={listRef} className="col grow files-list" tabIndex={0} data-files-list style={{ minHeight: 0, overflowY: 'auto' }}
        onScroll={(e) => files.setScroll(fkey, e.currentTarget.scrollTop)}
        onKeyDown={onKey}
        onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); e.stopPropagation(); onMenu(e.clientX, e.clientY, null); } }}>
        {folder?.error ? (
          <div className="empty" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }} data-files-error>
            <span className="danger-t" style={{ fontSize: 'var(--fs-sm)' }}>{folder.error.message}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => files.refresh(fkey)}>{t('file_list.try_again')}</button>
          </div>
        ) : (
          <>
            {path && path !== '/' && (
              <div className="frow" role="row" data-files-parent onDoubleClick={() => files.up(fkey)} onClick={() => files.select(fkey, null)}>
                <span className="fname"><Icon name="up" size="sm" />..</span><span /><span />
              </div>
            )}
            {entries.map((e) => (
              <div key={e.path} role="row" aria-selected={e.path === selected}
                className={'frow' + (e.path === selected ? ' sel' : '') + (dropPath === e.path ? ' drop' : '')}
                data-file={e.name} data-kind={e.kind} data-path={e.path}
                draggable={draggable}
                onDragStart={(ev) => {
                  if (!draggable) return;
                  setPaneDrag({ key: fkey, entry: e });
                  files.select(fkey, e.path);
                  ev.dataTransfer.effectAllowed = 'copy';
                  ev.dataTransfer.setData('text/plain', e.name);
                }}
                onDragEnd={() => setPaneDrag(null)}
                onClick={() => files.select(fkey, e.path)}
                onDoubleClick={() => (e.kind === 'dir' || e.kind === 'link' ? open(e) : onOpenFile(e))}
                onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); files.select(fkey, e.path); onMenu(ev.clientX, ev.clientY, e); }}
                title={e.kind === 'link' ? t('file_list.name_a_link', { name: e.name }) : e.name}>
                <span className="fname"><Icon name={e.kind === 'dir' ? 'folder' : e.kind === 'link' ? 'link' : 'file'} size="sm" className={e.kind === 'dir' ? 'dir' : ''} /><span className="trunc">{e.name}</span></span>
                <span className="num">{e.kind === 'dir' ? '—' : humanSize(e.size)}</span>
                <span className="num" title={fmtDate(e.mtime * 1000, { dateStyle: 'medium', timeStyle: 'short' })}>{humanTime(e.mtime)}</span>
              </div>
            ))}
            {!folder?.loading && entries.length === 0 && <div className="hint" style={{ padding: 'var(--sp-3)' }} data-files-folder-empty>{t('file_list.this_folder_is_empty')}</div>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Where a drag from the other pane over this list would land: the folder row under
 * the pointer, or the folder the pane shows.
 */
export function dropFolderAt(target: EventTarget | null, shown: string): { path: string; row: string | null } {
  const row = (target as HTMLElement | null)?.closest?.<HTMLElement>('.frow[data-kind="dir"]');
  const p = row?.dataset.path;
  return p ? { path: p, row: p } : { path: shown, row: null };
}

/** "scripts/" for a folder path, "/" for the root. */
export function folderLabel(path: string): string {
  if (!path || path === '/') return '/';
  return path.slice(path.lastIndexOf('/') + 1) + '/';
}
