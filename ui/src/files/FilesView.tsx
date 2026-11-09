// The Files view (design screens 14a-d, milestones 17 and 19): a sidebar that
// follows the active tab and browses its host over the tab's own session (D-053).
// Path bar with `..` (⌘↑), a breadcrumb and Go to the terminal's folder (OSC 7);
// Upload and New folder; the list; a context menu; the transfer queue docked at the
// bottom; and the whole sidebar as a drop target for files dragged in from the OS.
//
// Copy to another server… (14d1) opens a second pane on another host, floating
// beside the view over the terminal (D-059). While two-pane mode is on, the button
// is a chip that shows the pane again; the queue stays here, in the first pane.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, toFlintError } from '../api/backend';
import type { FileEntry } from '../api/types';
import { useSessions, type Tab } from '../sessions/store';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { Kbd } from '../ui/Kbd';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import type { TextAsk } from '../ui/Dialogs';
import type { Confirm } from '../pages/KeysPage';
import { crumbs, humanSize, validName } from './paths';
import { files, useFiles, type DroppedFile, type Transfer } from './store';
import { livePair, pairs, paneKey, usePairs } from './pair';
import { dropFolderAt, FileList, folderLabel, paneDrag, setPaneDrag } from './FileList';
import { OtherPane, ServerPicker } from './OtherPane';

interface Props {
  tab: Tab | undefined;
  resizer: ReactNode;
  onReconnect: (tabId: string) => void;
  onGoToHost: () => void;
  onConfirm: (c: Confirm) => void;
  onAsk: (a: TextAsk) => void;
  onEditHost: (alias: string) => void;
}

export function FilesView({ tab, resizer, onReconnect, onGoToHost, onConfirm, onAsk, onEditHost }: Props) {
  const { os, notify, fail } = useApp();
  const { folders, transfers } = useFiles();
  const { tabs } = useSessions();
  const allPairs = usePairs();
  const ready = tab?.status === 'ready';
  const folder = tab ? folders[tab.id] : undefined;
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [dragging, setDragging] = useState(0);
  const [picking, setPicking] = useState(false);
  const [drop, setDrop] = useState<{ x: number; y: number; path: string; row: string | null } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stored = tab ? allPairs[tab.id] : undefined;
  const pair = stored ? livePair(stored, tabs) : undefined;

  useEffect(() => {
    files.start();
    pairs.start();
    files.onError = (msg) => notify(msg, 'error');
  }, [notify]);

  // The view opens on the terminal's folder when the shell has reported one (OSC 7),
  // only as it opens: never following each `cd` while it is open (D-056).
  useEffect(() => {
    if (!tab || !ready) return;
    const f = files.folder(tab.id);
    if (!f || f.session !== tab.session) files.ensure(tab.id, tab.session, tab.cwd);
    else if (tab.cwd && tab.cwd !== f.path) files.go(tab.id, tab.cwd);
  }, [tab?.id, tab?.session, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const mine = tab ? transfers.filter((t) => t.tabId === tab.id) : [];
  const copying = mine.filter((t) => t.direction === 'relay' && (t.state === 'running' || t.state === 'queued')).length;

  const pairButton = tab && ready && (pair ? (
    <button className={'btn btn-sm ' + (pair.hidden ? 'btn-secondary' : 'btn-ghost')} data-files-pair-chip aria-pressed={!pair.hidden}
      title={pair.hidden ? `Show the ${pair.alias} pane` : `Hide the ${pair.alias} pane (Esc)`}
      onClick={() => pairs.setHidden(tab.id, !pair.hidden)}>
      <span aria-hidden="true">⇄</span><span className="mono trunc" style={{ maxWidth: 120 }}>{pair.alias}</span>{copying > 0 && <span className="faint">· {copying} copying</span>}
    </button>
  ) : (
    <button className="btn btn-secondary btn-sm" data-files-pick aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking((p) => !p)}
      title="Copy to another server: a second file pane, host to host through Flint">
      <Icon name="arrow-r" size="sm" />Copy to another server…
    </button>
  ));

  const title = (
    <div className="side-title">
      <span className="strong grow trunc" style={{ fontSize: 'var(--fs-sm)' }}>Files{tab && <> · <span className="mono" data-files-host>{tab.alias}</span></>}</span>
      {pairButton}
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
  const synced = !!tab.cwd && tab.cwd === path;
  const other = pair && pair.status === 'ready' ? pair : undefined;
  const otherFolder = other ? folders[paneKey(tabId)] : undefined;

  const copyToOther = (e: FileEntry) => {
    if (!other || !otherFolder?.path) return;
    files.relay(tabId, { session: tab.session, alias: tab.alias }, e, { key: paneKey(tabId), session: other.session, alias: other.alias, folder: otherFolder.path });
    if (other.hidden) pairs.setHidden(tabId, false);
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
    const items: MenuItem[] = [];
    if (other) items.push({ label: `Copy to ${other.alias}`, icon: 'arrow-r', hint: os === 'mac' ? '⌘→' : 'Ctrl+Shift+→', run: () => copyToOther(e) });
    return [
      ...items,
      { label: 'Download…', icon: 'download', hint: os === 'mac' ? '⌘↓' : 'Ctrl+Shift+↓', run: () => download(e) },
      { label: 'Rename', icon: 'edit', hint: e.kind === 'dir' ? undefined : '↵', run: () => rename(e) },
      { label: 'Copy path', icon: 'clip', run: () => copyPath(e.path) },
      { label: 'New folder…', icon: 'folder', run: newFolder },
      { label: 'Delete…', icon: 'trash', danger: true, sep: true, hint: os === 'mac' ? '⌘⌫' : 'Ctrl+Shift+⌫', run: () => remove(e) },
    ];
  };

  // Files dragged in from the OS (design 14b): the whole sidebar is the target. A
  // row dragged from the second pane copies into this host instead (14d3a).
  const hasFiles = (e: React.DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const fromOther = () => { const d = paneDrag(); return d && d.key !== tabId && other ? d : null; };
  const inFloat = (e: React.SyntheticEvent) => !!(e.target as HTMLElement).closest?.('.fpane-float');
  const onDrop = async (e: React.DragEvent) => {
    if (inFloat(e)) return;
    const d = fromOther();
    if (d && other) {
      e.preventDefault();
      const at = dropFolderAt(e.target, path);
      setDrop(null);
      setPaneDrag(null);
      files.relay(tabId, { session: other.session, alias: other.alias }, d.entry, { key: tabId, session: tab.session, alias: tab.alias, folder: at.path });
      return;
    }
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
      onDragEnter={(e) => { if (inFloat(e)) return; if (hasFiles(e) && !paneDrag()) { e.preventDefault(); setDragging((n) => n + 1); } }}
      onDragOver={(e) => {
        if (inFloat(e)) return;
        if (fromOther()) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setDrop({ x: e.clientX, y: e.clientY, ...dropFolderAt(e.target, path) });
          return;
        }
        if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
      }}
      onDragLeave={(e) => {
        if (inFloat(e)) return;
        if (fromOther() && !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDrop(null);
        if (hasFiles(e) && !paneDrag()) setDragging((n) => Math.max(0, n - 1));
      }}
      onDrop={onDrop}>
      {title}
      {picking && !pair && <ServerPicker current={tab.alias} onClose={() => setPicking(false)} onPick={(alias) => { setPicking(false); pairs.open(tabId, alias, tabs); }} />}
      <div className={'col grow' + (drop ? ' fpane target' : '')} style={{ minHeight: 0, borderRight: 0 }}>
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
        <FileList fkey={tabId} folder={folder} os={os} listRef={listRef} dropPath={drop?.row ?? null}
          onOpenFile={download} onMenu={(x, y, entry) => setMenu({ x, y, entry })} onRename={rename} onRemove={remove}
          onDownload={download} onCopyOther={other ? copyToOther : undefined} copyKey="ArrowRight" draggable={!!other} />
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
      {drop && (
        <div className="drag-ghost" style={{ position: 'fixed', left: drop.x + 14, top: drop.y + 10 }} data-files-drag-label>
          <span className="tooltip"><Icon name="arrow-r" size="sm" />Copy to {tab.alias} · {folderLabel(drop.path)}</span>
        </div>
      )}
      {resizer}
      {pair && !pair.hidden && (
        <OtherPane tabId={tabId} session={tab.session} alias={tab.alias} pair={pair} onConfirm={onConfirm} onAsk={onAsk} onEditHost={onEditHost} />
      )}
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
  const conflicts = transfers.filter((t) => t.state === 'conflict').length;
  const relay = transfers.some((t) => t.direction === 'relay');
  return (
    <div className="col" data-files-queue style={{ flex: 'none', borderTop: '1px solid var(--border-default)', background: 'var(--surface-raised)', maxHeight: '40%', minHeight: 0 }}>
      <div className="row" style={{ height: 32, padding: '0 var(--sp-2) 0 var(--sp-3)', flex: 'none' }}>
        <span className="label grow">Transfers · {transfers.length}</span>
        {relay && <span className="hint" style={{ marginRight: 'var(--sp-2)' }}>bytes pass through Flint</span>}
        <button className="btn btn-ghost btn-sm" data-files-clear disabled={doneCount === 0} onClick={() => files.clearDone(tabId)}>Clear done</button>
      </div>
      <div className="col" style={{ overflowY: 'auto', paddingBottom: 'var(--sp-1)' }}>
        {transfers.map((t) => <TransferRow key={t.id} t={t} others={conflicts - 1} />)}
      </div>
    </div>
  );
}

const VERBS = { upload: ['upload', 'Uploaded'], download: ['download', 'Downloaded'], relay: ['copy', 'Copied'] } as const;

function TransferRow({ t, others }: { t: Transfer; others: number }) {
  const [verb, doneVerb] = VERBS[t.direction];
  const pct = t.total > 0 ? Math.min(100, Math.round((t.bytes / t.total) * 100)) : 0;
  const size = t.total > 0 ? `${humanSize(t.bytes)}/${humanSize(t.total)}` : humanSize(t.bytes);
  const [all, setAll] = useState(false);
  let icon = <Icon name={t.direction === 'upload' ? 'upload' : t.direction === 'download' ? 'download' : 'arrow-r'} size="sm" className="accent-t" />;
  let status: ReactNode = <span className="mono faint" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{size}</span>;
  let action: ReactNode = <button className="icon-btn" aria-label={`Cancel ${verb}`} title={`Cancel ${verb}`} data-transfer-cancel onClick={() => files.cancel(t.id)}><Icon name="x" size="xs" /></button>;
  if (t.state === 'queued') {
    icon = <Icon name="clock" size="sm" className="faint" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Queued</span>;
    action = <button className="icon-btn" aria-label="Remove from queue" title="Remove from queue" data-transfer-cancel onClick={() => files.cancel(t.id)}><Icon name="x" size="xs" /></button>;
  } else if (t.state === 'done') {
    icon = <Icon name="check" size="sm" className="ok-t" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{doneVerb} · {t.recursive ? `${t.filesDone} file${t.filesDone === 1 ? '' : 's'} · ` : ''}{humanSize(t.bytes)}</span>;
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
  }
  const active = t.state === 'running' || t.state === 'staging';
  const where = t.direction === 'upload' ? `${t.local} → ${t.alias}:${t.remote}` : t.direction === 'download' ? `${t.alias}:${t.remote} → ${t.local}` : `${t.alias}:${t.remote} → ${t.toAlias}:${t.local}`;
  // 14d4: a name clash asks in a strip, and may answer the other clashes too.
  if (t.state === 'conflict') {
    const target = t.direction === 'upload' ? t.alias : t.direction === 'relay' ? t.toAlias : 'this computer';
    const replace = () => (all ? files.resolveAll(t.tabId, true) : files.retry(t.id, true));
    const skip = () => (all ? files.resolveAll(t.tabId, false) : files.cancel(t.id));
    return (
      <div className="conflict" role="alert" data-transfer={t.name} data-state={t.state} data-direction={t.direction} title={where}>
        <div className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
          <Icon name="alert" size="sm" className="warn-t" />
          <span className="grow" style={{ overflowWrap: 'anywhere' }}><span className="mono strong">{t.name}</span> already exists on <span className="mono">{target}</span>{t.folder ? <> in {folderLabel(t.folder)}</> : null}</span>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {others > 0 && (
            <label className="opt"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-transfer-all />
              <span className="opt-t"><span className="opt-l" style={{ fontSize: 'var(--fs-xs)' }}>Do this for the other {others} conflict{others === 1 ? '' : 's'}</span></span></label>
          )}
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" data-transfer-skip onClick={skip}>Skip</button>
          <button className="btn btn-secondary btn-sm" data-transfer-replace onClick={replace}>Replace</button>
        </div>
      </div>
    );
  }
  return (
    <div className="xfer" data-transfer={t.name} data-state={t.state} data-direction={t.direction}>
      <div className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
        {icon}<span className="mono grow trunc" title={where}>{t.name}</span>{status}{action}
      </div>
      {t.direction === 'relay' && (
        <span className="chain" style={{ paddingLeft: 22 }} data-transfer-route title={where}><span className="node">{t.alias}</span><Icon name="chain" size="xs" /><span className="node caller">{t.toAlias}</span></span>
      )}
      {active && <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: t.total > 0 ? pct + '%' : '30%' }} className={t.total > 0 ? '' : 'indeterminate'} /></div>}
      {active && <span className="hint mono">{t.recursive && t.file ? `${t.filesDone} done · ` : ''}{rateLine(t)}</span>}
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
