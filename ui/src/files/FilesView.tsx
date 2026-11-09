// The Files view (design screens 14a-c, milestone 17): a sidebar that follows the
// active tab and browses its host over the tab's own session (D-053). Path bar with
// `..` (⌘↑), a breadcrumb and Go to the terminal's folder (OSC 7); Upload and New
// folder; the list; a context menu; the transfer queue docked at the bottom; and the
// whole sidebar as a drop target for files dragged in from the OS.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { api, toFlintError } from '../api/backend';
import type { FileEntry } from '../api/types';
import type { Tab } from '../sessions/store';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import type { TextAsk } from '../ui/Dialogs';
import type { Confirm } from '../pages/KeysPage';
import { crumbs, humanSize, humanTime, validName } from './paths';
import { files, useFiles, type DroppedFile, type Transfer } from './store';

interface Props {
  tab: Tab | undefined;
  resizer: ReactNode;
  onReconnect: (tabId: string) => void;
  onGoToHost: () => void;
  onConfirm: (c: Confirm) => void;
  onAsk: (a: TextAsk) => void;
}

const isMod = (e: React.KeyboardEvent, os: 'mac' | 'linux') => (os === 'mac' ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey);

export function FilesView({ tab, resizer, onReconnect, onGoToHost, onConfirm, onAsk }: Props) {
  const { os, notify, fail } = useApp();
  const { folders, transfers } = useFiles();
  const ready = tab?.status === 'ready';
  const folder = tab ? folders[tab.id] : undefined;
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [dragging, setDragging] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    files.start();
    files.onError = (msg) => notify(msg, 'error');
  }, [notify]);

  useEffect(() => {
    if (tab && ready) files.ensure(tab.id, tab.session);
  }, [tab?.id, tab?.session, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each session keeps its scroll position: restored when its list comes back.
  useLayoutEffect(() => {
    if (listRef.current && folder && !folder.loading) listRef.current.scrollTop = folder.scroll;
  }, [tab?.id, folder?.path, folder?.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (
    <div className="side-title">
      <span className="strong grow trunc" style={{ fontSize: 'var(--fs-sm)' }}>Files{tab && <> · <span className="mono" data-files-host>{tab.alias}</span></>}</span>
      <span className="badge">SFTP</span>
      {ready && <button className="icon-btn" aria-label="Refresh" title="Refresh" data-files-refresh onClick={() => tab && files.refresh(tab.id)}><Icon name="reconnect" size="sm" /></button>}
    </div>
  );

  if (!tab || !ready) {
    return (
      <aside className="sidebar" data-for="files" aria-label="Files" data-files-empty>
        {title}
        <div className="empty grow" style={{ justifyContent: 'center', padding: 'var(--sp-6)' }}>
          <span className="empty-ic"><Icon name="files" size="xl" /></span>
          {tab?.status === 'connecting' || tab?.status === 'prompt'
            ? <><span className="strong">Connecting to {tab.alias}…</span><span style={{ fontSize: 'var(--fs-sm)' }}>Files opens on the session once it is connected.</span></>
            : <>
              <span className="strong">Open a session to browse its files</span>
              <span style={{ fontSize: 'var(--fs-sm)' }}>{tab ? <><span className="mono">{tab.alias}</span> is disconnected. </> : null}Files follows the active tab.</span>
            </>}
          <div className="col" style={{ gap: 'var(--sp-2)', width: '100%', paddingTop: 'var(--sp-2)' }}>
            {tab && tab.status === 'ended' && (
              <button className="btn btn-primary" data-files-reconnect onClick={() => onReconnect(tab.id)}><Icon name="reconnect" size="sm" />Reconnect {tab.alias}<Kbd action="reconnect" inline /></button>
            )}
            <button className="btn btn-ghost" onClick={onGoToHost}>Go to host…<Kbd action="gotoHost" /></button>
          </div>
        </div>
        {resizer}
      </aside>
    );
  }

  const tabId = tab.id;
  const path = folder?.path ?? '';
  const entries = folder?.entries ?? [];
  const selected = folder?.selected ?? null;
  const mine = transfers.filter((t) => t.tabId === tabId);
  const synced = !!tab.cwd && tab.cwd === path;

  const open = (e: FileEntry) => {
    if (e.kind === 'dir' || e.kind === 'link') files.go(tabId, e.path);
  };
  const rename = (e: FileEntry) => onAsk({
    title: `Rename ${e.name}`, label: 'New name', value: e.name, action: 'Rename',
    run: async (v) => {
      if (!validName(v)) throw new Error('A name cannot be empty, ".", ".." or contain "/".');
      if (v === e.name) return;
      await files.rename(tabId, e, v);
    },
  });
  const newFolder = () => onAsk({
    title: 'New folder', label: 'Name', value: '', action: 'Create folder', hint: `In ${path}`,
    run: async (v) => {
      if (!validName(v)) throw new Error('A name cannot be empty, ".", ".." or contain "/".');
      await files.mkdir(tabId, v);
    },
  });
  const remove = (e: FileEntry) => onConfirm({
    title: `Delete ${e.name}?`,
    body: e.kind === 'dir'
      ? `The folder ${e.path} and everything in it are deleted on ${tab.alias}. This cannot be undone.`
      : `${e.path} is deleted on ${tab.alias}. This cannot be undone.`,
    action: e.kind === 'dir' ? 'Delete folder' : 'Delete file',
    run: async () => { await files.remove(tabId, e); notify(`Deleted ${e.name}`); },
  });
  const download = async (e: FileEntry) => {
    try {
      const { path: local } = await api.dialogSave(`Download ${e.name}`, e.name);
      if (local) files.download(tabId, tab.session, tab.alias, e, local);
    } catch (err) { fail(err); }
  };
  const upload = async () => {
    try {
      const { path: local } = await api.dialogOpen(`Upload to ${tab.alias}:${path}`);
      if (local) files.upload(tabId, tab.session, tab.alias, [local], path);
    } catch (err) { fail(err); }
  };
  const copyPath = (p: string) => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(p)));
    api.terminalClipboard('c;' + b64).then(() => notify('Copied the path')).catch(fail);
  };

  const menuItems = (e: FileEntry | null): MenuItem[] => {
    if (!e) return [{ label: 'New folder…', icon: 'folder', run: newFolder }, { label: 'Upload…', icon: 'upload', run: upload }];
    return [
      { label: 'Download…', icon: 'download', hint: os === 'mac' ? '⌘↓' : 'Ctrl+Shift+↓', run: () => download(e) },
      { label: 'Rename', icon: 'edit', hint: e.kind === 'dir' ? undefined : '↵', run: () => rename(e) },
      { label: 'Copy path', icon: 'clip', run: () => copyPath(e.path) },
      { label: 'New folder…', icon: 'folder', run: newFolder },
      { label: 'Delete…', icon: 'trash', danger: true, sep: true, hint: os === 'mac' ? '⌘⌫' : 'Ctrl+Shift+⌫', run: () => remove(e) },
    ];
  };

  const sel = entries.find((e) => e.path === selected) ?? null;
  const onListKey = (ev: React.KeyboardEvent) => {
    const i = sel ? entries.indexOf(sel) : -1;
    if (ev.key === 'ArrowUp' && isMod(ev, os)) { ev.preventDefault(); files.up(tabId); return; }
    if (ev.key === 'ArrowDown' && isMod(ev, os)) { ev.preventDefault(); if (sel) download(sel); return; }
    if ((ev.key === 'Backspace' || ev.key === 'Delete') && (isMod(ev, os) || ev.key === 'Delete')) { ev.preventDefault(); if (sel) remove(sel); return; }
    if (ev.key === 'ArrowDown') { ev.preventDefault(); const n = entries[Math.min(entries.length - 1, i + 1)]; if (n) files.select(tabId, n.path); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); if (i <= 0) files.select(tabId, null); else files.select(tabId, entries[i - 1].path); return; }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (!sel) files.up(tabId);
      else if (sel.kind === 'dir' || sel.kind === 'link') open(sel);
      else rename(sel);
      return;
    }
    if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) {
      ev.preventDefault();
      const row = listRef.current?.querySelector<HTMLElement>('.frow.sel') ?? listRef.current;
      const r = row?.getBoundingClientRect();
      setMenu({ x: (r?.left ?? 0) + 24, y: (r?.bottom ?? 0), entry: sel });
    }
  };
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.frow.sel')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Files dragged in from the OS (design 14b): the whole sidebar is the target.
  const hasFiles = (e: React.DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const onDrop = async (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragging(0);
    try {
      const dropped = await readDrop(e.dataTransfer);
      if (dropped.length === 0) return;
      files.uploadDropped(tabId, tab.session, tab.alias, dropped, path);
    } catch (err) {
      fail(toFlintError(err));
    }
  };

  return (
    <aside className="sidebar" data-for="files" aria-label={`Files · ${tab.alias}`} data-files-path={path} data-files-session={tab.session}
      onDragEnter={(e) => { if (hasFiles(e)) { e.preventDefault(); setDragging((n) => n + 1); } }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={(e) => { if (hasFiles(e)) setDragging((n) => Math.max(0, n - 1)); }}
      onDrop={onDrop}>
      {title}
      <div className="row" style={{ height: 36, flex: 'none', padding: '0 var(--sp-2)', gap: 'var(--sp-1)', borderBottom: '1px solid var(--border-subtle)' }}>
        <button className="icon-btn" aria-label={`Up one folder (${os === 'mac' ? '⌘↑' : 'Ctrl+Shift+↑'})`} title={`Up one folder (${os === 'mac' ? '⌘↑' : 'Ctrl+Shift+↑'})`}
          data-files-up disabled={!path || path === '/'} onClick={() => files.up(tabId)}><Icon name="up" size="sm" /></button>
        <nav className="crumbs grow" aria-label="Path" data-files-crumbs>
          <Crumbs path={path} onGo={(p) => files.go(tabId, p)} />
        </nav>
        <button className={'icon-btn' + (tab.cwd ? '' : ' is-disabled')} data-files-goto-cwd aria-disabled={!tab.cwd}
          aria-label={tab.cwd ? `Go to the terminal's current folder (${tab.cwd})` : "Go to the terminal's folder: the shell does not report it (OSC 7)"}
          title={tab.cwd ? `Go to the terminal's current folder (${tab.cwd})` : "The shell does not report its folder. Turn on OSC 7 in the shell to use this: see Docs › The Files view"}
          onClick={() => { if (tab.cwd) files.go(tabId, tab.cwd); }}>
          <Icon name="target" size="sm" className={synced ? 'accent-t' : tab.cwd ? '' : 'faint'} />
        </button>
      </div>
      <div className="row" style={{ flex: 'none', padding: 'var(--sp-2) var(--sp-3)', gap: 'var(--sp-2)' }}>
        <button className="btn btn-secondary btn-sm" data-files-upload onClick={upload}><Icon name="upload" size="sm" />Upload</button>
        <button className="btn btn-ghost btn-sm" data-files-mkdir onClick={newFolder}><Icon name="folder" size="sm" />New folder</button>
        <span className="grow" />
        <span className="hint" data-files-count>{folder?.loading && entries.length === 0 ? 'Loading…' : synced ? 'Synced with terminal' : `${entries.length} item${entries.length === 1 ? '' : 's'}`}</span>
      </div>
      <div className="col grow" role="grid" aria-label="Folder contents" aria-busy={folder?.loading} style={{ minHeight: 0 }}>
        <div className="frow head" role="row"><span role="columnheader">Name</span><span className="num" role="columnheader">Size</span><span className="num" role="columnheader">Modified</span></div>
        <div ref={listRef} className="col grow files-list" tabIndex={0} data-files-list style={{ minHeight: 0, overflowY: 'auto' }}
          onScroll={(e) => files.setScroll(tabId, e.currentTarget.scrollTop)}
          onKeyDown={onListKey}
          onContextMenu={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, entry: null }); } }}>
          {folder?.error ? (
            <div className="empty" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }} data-files-error>
              <span className="danger-t" style={{ fontSize: 'var(--fs-sm)' }}>{folder.error.message}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => files.refresh(tabId)}>Try again</button>
            </div>
          ) : (
            <>
              {path && path !== '/' && (
                <div className="frow" role="row" data-files-parent onDoubleClick={() => files.up(tabId)} onClick={() => files.select(tabId, null)}>
                  <span className="fname"><Icon name="up" size="sm" />..</span><span /><span />
                </div>
              )}
              {entries.map((e) => (
                <div key={e.path} role="row" aria-selected={e.path === selected} className={'frow' + (e.path === selected ? ' sel' : '')} data-file={e.name} data-kind={e.kind}
                  onClick={() => files.select(tabId, e.path)}
                  onDoubleClick={() => (e.kind === 'dir' || e.kind === 'link' ? open(e) : download(e))}
                  onContextMenu={(ev) => { ev.preventDefault(); files.select(tabId, e.path); setMenu({ x: ev.clientX, y: ev.clientY, entry: e }); }}
                  title={e.kind === 'link' ? `${e.name} (a link)` : e.name}>
                  <span className="fname"><Icon name={e.kind === 'dir' ? 'folder' : e.kind === 'link' ? 'link' : 'file'} size="sm" className={e.kind === 'dir' ? 'dir' : ''} /><span className="trunc">{e.name}</span></span>
                  <span className="num">{e.kind === 'dir' ? '—' : humanSize(e.size)}</span>
                  <span className="num" title={new Date(e.mtime * 1000).toLocaleString()}>{humanTime(e.mtime)}</span>
                </div>
              ))}
              {!folder?.loading && entries.length === 0 && <div className="hint" style={{ padding: 'var(--sp-3)' }} data-files-folder-empty>This folder is empty.</div>}
            </>
          )}
        </div>
      </div>
      {mine.length > 0 && <TransferQueue transfers={mine} tabId={tabId} />}
      {dragging > 0 && (
        <div className="dropzone" aria-live="polite" data-files-dropzone>
          <span className="prompt-ic accent" style={{ width: 44, height: 44 }}><Icon name="upload" size="lg" /></span>
          <span className="strong">Drop to upload</span>
          <span className="mono accent-t" style={{ fontSize: 'var(--fs-xs)' }}>→ {tab.alias}:{path}</span>
          <span className="hint">Existing files ask before they're replaced</span>
        </div>
      )}
      {resizer}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => { setMenu(null); listRef.current?.focus(); }} />}
    </aside>
  );
}

function Crumbs({ path, onGo }: { path: string; onGo: (p: string) => void }) {
  const all = crumbs(path);
  // A deep path keeps the root and its last three folders; "…" climbs to the hidden part.
  // In a narrow panel the folders above shrink to an ellipsis, so the current one stays seen.
  const parts = all.length > 5 ? [all[0], { name: '…', path: all[all.length - 4].path }, ...all.slice(-3)] : all;
  return (
    <>
      {parts.map((c, i) => {
        const last = i === parts.length - 1;
        return (
          <span key={c.path + c.name} className={last ? 'crumb crumb-last' : 'crumb'}>
            {i > 1 && <span>/</span>}
            {last && i > 0 ? <span className="cur-c" title={path}>{c.name}</span> : <button onClick={() => onGo(c.path)} title={c.path}>{c.name}</button>}
          </span>
        );
      })}
    </>
  );
}

function rateLine(t: Transfer): string {
  if (t.state === 'staging') return 'Reading the dropped files…';
  if (t.rate <= 0) return t.state === 'running' ? 'Starting…' : '';
  const left = t.total > 0 ? Math.max(0, (t.total - t.bytes) / t.rate) : -1;
  const eta = left < 0 ? '' : left < 60 ? ` · ${Math.ceil(left)} s left` : ` · ${Math.ceil(left / 60)} min left`;
  return `${humanSize(Math.round(t.rate))}/s${eta}`;
}

function TransferQueue({ transfers, tabId }: { transfers: Transfer[]; tabId: string }) {
  const doneCount = transfers.filter((t) => t.state === 'done' || t.state === 'cancelled').length;
  return (
    <div className="col" data-files-queue style={{ flex: 'none', borderTop: '1px solid var(--border-default)', background: 'var(--surface-raised)', maxHeight: '40%', minHeight: 0 }}>
      <div className="row" style={{ height: 32, padding: '0 var(--sp-2) 0 var(--sp-3)', flex: 'none' }}>
        <span className="label grow">Transfers · {transfers.length}</span>
        <button className="btn btn-ghost btn-sm" data-files-clear disabled={doneCount === 0} onClick={() => files.clearDone(tabId)}>Clear done</button>
      </div>
      <div className="col" style={{ overflowY: 'auto', paddingBottom: 'var(--sp-1)' }}>
        {transfers.map((t) => <TransferRow key={t.id} t={t} />)}
      </div>
    </div>
  );
}

function TransferRow({ t }: { t: Transfer }) {
  const up = t.direction === 'upload';
  const verb = up ? 'upload' : 'download';
  const pct = t.total > 0 ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : 0;
  const size = t.total > 0 ? `${humanSize(t.bytes)}/${humanSize(t.total)}` : humanSize(t.bytes);
  let icon = <Icon name={up ? 'upload' : 'download'} size="sm" className="accent-t" />;
  let status: ReactNode = <span className="mono faint" style={{ fontSize: 'var(--fs-xs)' }}>{size}</span>;
  let action: ReactNode = <button className="icon-btn" aria-label={`Cancel ${verb}`} title={`Cancel ${verb}`} data-transfer-cancel onClick={() => files.cancel(t.id)}><Icon name="x" size="xs" /></button>;
  if (t.state === 'queued') {
    icon = <Icon name="clock" size="sm" className="faint" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Queued</span>;
    action = <button className="icon-btn" aria-label="Remove from queue" title="Remove from queue" data-transfer-cancel onClick={() => files.cancel(t.id)}><Icon name="x" size="xs" /></button>;
  } else if (t.state === 'done') {
    icon = <Icon name="check" size="sm" className="ok-t" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{up ? 'Uploaded' : 'Downloaded'} · {humanSize(t.bytes)}{t.recursive ? ` · ${t.filesDone} file${t.filesDone === 1 ? '' : 's'}` : ''}</span>;
    action = null;
  } else if (t.state === 'cancelled') {
    icon = <Icon name="x" size="sm" className="faint" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Cancelled</span>;
    action = <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => files.dismiss(t.id)}><Icon name="x" size="xs" /></button>;
  } else if (t.state === 'failed') {
    icon = <Icon name="alert" size="sm" className="danger-t" />;
    status = <span className="danger-t trunc" style={{ fontSize: 'var(--fs-xs)', maxWidth: 140 }} title={t.error?.message}>{failureLabel(t)}</span>;
    action = <>
      {t.local && <button className="btn btn-ghost btn-sm" data-transfer-retry onClick={() => files.retry(t.id)}>Retry</button>}
      <button className="icon-btn" aria-label="Dismiss" title="Dismiss" onClick={() => files.dismiss(t.id)}><Icon name="x" size="xs" /></button>
    </>;
  } else if (t.state === 'conflict') {
    icon = <Icon name="alert" size="sm" className="warn-t" />;
    status = <span className="warn-t" style={{ fontSize: 'var(--fs-xs)' }}>Already there</span>;
    action = <>
      <button className="btn btn-secondary btn-sm" data-transfer-replace onClick={() => files.retry(t.id, true)}>Replace</button>
      <button className="btn btn-ghost btn-sm" data-transfer-skip onClick={() => files.cancel(t.id)}>Skip</button>
    </>;
  }
  const active = t.state === 'running' || t.state === 'staging';
  return (
    <div className="xfer" data-transfer={t.name} data-state={t.state} data-direction={t.direction}>
      <div className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
        {icon}<span className="mono grow trunc" title={up ? `${t.local} → ${t.alias}:${t.remote}` : `${t.alias}:${t.remote} → ${t.local}`}>{t.name}</span>{status}{action}
      </div>
      {active && <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: t.total > 0 ? pct + '%' : '30%' }} className={t.total > 0 ? '' : 'indeterminate'} /></div>}
      {active && <span className="hint mono">{t.recursive && t.file ? `${t.filesDone} done · ` : ''}{rateLine(t)}</span>}
      {t.state === 'conflict' && <span className="hint" style={{ overflowWrap: 'anywhere' }}>{t.error?.message.replace(/; pass --force to replace it$/, '')}. Replace it?</span>}
    </div>
  );
}

function failureLabel(t: Transfer): string {
  switch (t.error?.code) {
    case 'permission_denied': return 'Permission denied';
    case 'not_found': return 'Not found';
    case 'not_a_directory': return 'Not a folder';
    case 'network': return 'Connection lost';
    case 'exists': return 'Already there';
    default: return t.error?.message ?? 'Failed';
  }
}

// ---- Reading a drop ------------------------------------------------------------------

interface FsEntry { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, bad: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: FsEntry[]) => void, bad: (e: unknown) => void) => void } }

/** Every file of a drop, folders walked, each with its path inside the drop. */
async function readDrop(dt: DataTransfer): Promise<DroppedFile[]> {
  const out: DroppedFile[] = [];
  const folders: FsEntry[] = [];
  const items = [...(dt.items ?? [])].filter((i) => i.kind === 'file');
  if (items.length === 0) {
    for (const f of [...dt.files]) out.push({ rel: f.name, file: f });
    return out;
  }
  // A file is read as is; only a folder needs the entries API to be walked.
  for (const item of items) {
    const entry = (item as DataTransferItem & { webkitGetAsEntry?: () => FsEntry | null }).webkitGetAsEntry?.();
    if (entry?.isDirectory) folders.push(entry);
    else {
      const f = item.getAsFile();
      if (f) out.push({ rel: f.name, file: f });
    }
  }
  const walk = async (e: FsEntry, prefix: string): Promise<void> => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isFile && e.file) {
      const f = await new Promise<File>((ok, bad) => e.file!(ok, bad));
      out.push({ rel, file: f });
    } else if (e.isDirectory && e.createReader) {
      const reader = e.createReader();
      // readEntries returns its results in batches until an empty one.
      for (;;) {
        const batch = await new Promise<FsEntry[]>((ok, bad) => reader.readEntries(ok, bad));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child, rel);
      }
    }
  };
  for (const f of folders) await walk(f, '');
  return out;
}
