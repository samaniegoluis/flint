// The Files view (design screens 14a-d, milestones 17 and 19): a sidebar that
// follows the active tab's focused pane and browses its host over that pane's own
// session (D-053).
// Path bar with `..` (⌘↑), a breadcrumb that turns into a field to type or paste a
// path (⇧⌘G, PathField) and Go to the terminal's folder (OSC 7);
// Upload and New folder; the list; a context menu; the transfer queue docked at the
// bottom; and the whole sidebar as a drop target for files dragged in from the OS.
//
// Copy to another server… (14d1) opens a second pane on another host, floating
// beside the view over the terminal (D-059). While two-pane mode is on, the button
// is a chip that shows the pane again; the queue stays here, in the first pane.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, toFlintError } from '../api/backend';
import type { FileEntry } from '../api/types';
import { useSessions, type Pane } from '../sessions/store';
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
import { PathField } from './PathField';
import { fmtNumber, t } from '../i18n';
import { tr } from '../i18n/react';

interface Props {
  tab: Pane | undefined;
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
  const { panes: tabs, tabs: layouts } = useSessions();
  // In a split tab the header carries the focused pane's number (design 18g).
  const owner = tab ? layouts.find((t) => t.id === tab.tab) : undefined;
  const paneNo = owner && owner.panes.length > 1 ? owner.panes.indexOf(tab!.id) + 1 : 0;
  const allPairs = usePairs();
  const ready = tab?.status === 'ready' && tab.kind !== 'rdp';
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

  const pairButton = tab && ready && tab.kind !== 'rdp' && (pair ? (
    <button className={'btn btn-sm ' + (pair.hidden ? 'btn-secondary' : 'btn-ghost')} data-files-pair-chip aria-pressed={!pair.hidden}
      title={pair.hidden ? t('files_view.show_the_alias_pane', { alias: pair.alias }) : t('files_view.hide_the_alias_pane_esc', { alias: pair.alias })}
      onClick={() => pairs.setHidden(tab.id, !pair.hidden)}>
      <span aria-hidden="true">⇄</span><span className="mono trunc" style={{ maxWidth: 120 }}>{pair.alias}</span>{copying > 0 && <span className="faint">{tr('files_view.copying_copying', { copying })}</span>}
    </button>
  ) : (
    <button className="btn btn-secondary btn-sm" data-files-pick aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking((p) => !p)}
      title={t('files_view.copy_to_another_server_a')}>
      <Icon name="arrow-r" size="sm" />{t('files_view.copy_to_another_server')}
    </button>
  ));

  const title = (
    <div className="side-title">
      <span className="strong grow trunc" style={{ fontSize: 'var(--fs-sm)' }}>{t('files_view.files')}{tab && <> · {paneNo > 0 && <><span className="sp-num files-pane-no" data-files-pane-no title={t('files_view.pane_paneno', { paneNo })}>{paneNo}</span> </>}<span className="mono" data-files-host>{tab.alias}</span></>}</span>
      {pairButton}
      {ready && <button className="icon-btn" aria-label={t('files_view.refresh')} title={t('files_view.refresh')} data-files-refresh onClick={() => tab && files.refresh(tab.id)}><Icon name="reconnect" size="sm" /></button>}
    </div>
  );

  // A remote desktop has no files to browse (spec v8: SSH hosts only).
  if (tab?.kind === 'rdp') {
    return (
      <aside className="sidebar" data-for="files" aria-label={t('files_view.files')} data-files-empty data-files-rdp>
        {title}
        <div className="empty grow" style={{ justifyContent: 'center', padding: 'var(--sp-6)' }}>
          <span className="empty-ic"><Icon name="files" size="xl" /></span>
          <span className="strong">{t('files_view.files_is_for_ssh_hosts')}</span>
          <span style={{ fontSize: 'var(--fs-sm)' }}>{tr('files_view.span_is_a_remote_desktop', { span: <span className="mono">{tab.alias}</span> })}</span>
        </div>
      </aside>
    );
  }

  if (!tab || !ready) {
    return (
      <aside className="sidebar" data-for="files" aria-label={t('files_view.files')} data-files-empty>
        {title}
        <div className="empty grow" style={{ justifyContent: 'center', padding: 'var(--sp-6)' }}>
          <span className="empty-ic"><Icon name="files" size="xl" /></span>
          {tab?.status === 'connecting' || tab?.status === 'prompt'
            ? <><span className="strong">{tr('files_view.connecting_to_alias', { alias: tab.alias })}</span><span style={{ fontSize: 'var(--fs-sm)' }}>{t('files_view.files_opens_on_the_session')}</span></>
            : <>
              <span className="strong">{t('files_view.open_a_session_to_browse')}</span>
              <span style={{ fontSize: 'var(--fs-sm)' }}>{tab ? <>{tr('files_view.span_is_disconnected', { span: <span className="mono">{tab.alias}</span> })}</> : null}{t('files_view.files_follows_the_active_tab')}</span>
            </>}
          <div className="col" style={{ gap: 'var(--sp-2)', width: '100%', paddingTop: 'var(--sp-2)' }}>
            {tab && tab.status === 'ended' && (
              <button className="btn btn-primary" data-files-reconnect onClick={() => onReconnect(tab.id)}><Icon name="reconnect" size="sm" />{tr('files_view.reconnect_alias', { alias: tab.alias })}<Kbd action="reconnect" inline /></button>
            )}
            <button className="btn btn-ghost" onClick={onGoToHost}>{t('files_view.go_to_host')}<Kbd action="gotoHost" /></button>
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
    title: t('files_view.rename_name', { name: e.name }), label: t('files_view.new_name'), value: e.name, action: t('common.rename'),
    run: async (v) => {
      if (!validName(v)) throw new Error(t('files.invalid_name'));
      if (v === e.name) return;
      await files.rename(tabId, e, v);
    },
  });
  const newFolder = () => onAsk({
    title: t('files_view.new_folder'), label: t('files_view.name'), value: '', action: t('files_view.create_folder'), hint: t('files_view.in_path', { path }),
    run: async (v) => {
      if (!validName(v)) throw new Error(t('files.invalid_name'));
      await files.mkdir(tabId, v);
    },
  });
  const remove = (e: FileEntry) => onConfirm({
    title: t('files_view.delete_name', { name: e.name }),
    body: e.kind === 'dir'
      ? t('files_view.the_folder_path_and_everything', { path: e.path, alias: tab.alias })
      : t('files_view.path_is_deleted_on_alias', { path: e.path, alias: tab.alias }),
    action: e.kind === 'dir' ? t('files_view.delete_folder') : t('files_view.delete_file'),
    run: async () => { await files.remove(tabId, e); notify(t('files_view.deleted_name', { name: e.name })); },
  });
  const download = async (e: FileEntry) => {
    try {
      const { path: local } = await api.dialogSave(t('files_view.download_title', { name: e.name }), e.name);
      if (local) files.download(tabId, tab.session, tab.alias, e, local);
    } catch (err) { fail(err); }
  };
  const upload = async () => {
    try {
      const { path: local } = await api.dialogOpen(t('files_view.upload_title', { alias: tab.alias, path }));
      if (local) files.upload(tabId, tab.session, tab.alias, [local], path);
    } catch (err) { fail(err); }
  };
  const copyPath = (p: string) => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(p)));
    api.terminalClipboard('c;' + b64).then(() => notify({ text: t('files_view.copied_the_path'), key: 'copied:path' })).catch(fail);
  };

  const menuItems = (e: FileEntry | null): MenuItem[] => {
    if (!e) return [{ label: t('files_view.new_folder_2'), icon: 'folder', run: newFolder }, { label: t('files_view.upload'), icon: 'upload', run: upload }];
    const items: MenuItem[] = [];
    if (other) items.push({ label: t('files_view.copy_to_alias', { alias: other.alias }), icon: 'arrow-r', hint: os === 'mac' ? '⌘→' : t('files_view.ctrl_shift'), run: () => copyToOther(e) });
    return [
      ...items,
      { label: t('files_view.download'), icon: 'download', hint: os === 'mac' ? '⌘↓' : t('files_view.ctrl_shift_2'), run: () => download(e) },
      { label: t('common.rename'), icon: 'edit', hint: e.kind === 'dir' ? undefined : '↵', run: () => rename(e) },
      { label: t('files_view.copy_path'), icon: 'clip', run: () => copyPath(e.path) },
      { label: t('files_view.new_folder_2'), icon: 'folder', run: newFolder },
      { label: t('files_view.delete'), icon: 'trash', danger: true, sep: true, hint: os === 'mac' ? '⌘⌫' : t('files_view.ctrl_shift_3'), run: () => remove(e) },
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
    <aside className="sidebar" data-for="files" aria-label={t('files_view.files_alias', { alias: tab.alias })} data-files-path={path} data-files-session={tab.session}
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
          <button className="icon-btn" aria-label={t('files_view.up_one_folder_p', { p: os === 'mac' ? '⌘↑' : 'Ctrl+Shift+↑' })} title={t('files_view.up_one_folder_p', { p: os === 'mac' ? '⌘↑' : 'Ctrl+Shift+↑' })}
            data-files-up disabled={!path || path === '/'} onClick={() => files.up(tabId)}><Icon name="up" size="sm" /></button>
          <PathField fkey={tabId} path={path} os={os} onError={(m) => notify(m, 'error')} onDone={() => listRef.current?.focus()}>
            <Crumbs path={path} onGo={(p) => files.go(tabId, p)} />
          </PathField>
          <button className={'icon-btn' + (tab.cwd ? '' : ' is-disabled')} data-files-goto-cwd aria-disabled={!tab.cwd}
            aria-label={tab.cwd ? t('files_view.go_to_the_terminal_s', { cwd: tab.cwd }) : t('files_view.go_to_the_terminal_s_2')}
            title={tab.cwd ? t('files_view.go_to_the_terminal_s', { cwd: tab.cwd }) : t('files_view.the_shell_does_not_report')}
            onClick={() => { if (tab.cwd) files.go(tabId, tab.cwd); }}>
            <Icon name="target" size="sm" className={synced ? 'accent-t' : tab.cwd ? '' : 'faint'} />
          </button>
        </div>
        <div className="row" style={{ flex: 'none', padding: 'var(--sp-2) var(--sp-3)', gap: 'var(--sp-2)' }}>
          <button className="btn btn-secondary btn-sm" data-files-upload onClick={upload}><Icon name="upload" size="sm" />{t('files_view.upload_2')}</button>
          <button className="btn btn-ghost btn-sm" data-files-mkdir onClick={newFolder}><Icon name="folder" size="sm" />{t('files_view.new_folder')}</button>
          <span className="grow" />
          <span className="hint" data-files-count>{folder?.loading && entries.length === 0 ? t('files_view.loading') : synced ? t('files_view.synced_with_terminal') : t('files_view.n_items', { count: entries.length, n: fmtNumber(entries.length) })}</span>
        </div>
        <FileList fkey={tabId} folder={folder} os={os} listRef={listRef} dropPath={drop?.row ?? null}
          onOpenFile={download} onMenu={(x, y, entry) => setMenu({ x, y, entry })} onRename={rename} onRemove={remove}
          onDownload={download} onCopyOther={other ? copyToOther : undefined} copyKey="ArrowRight" draggable={!!other} />
      </div>
      {mine.length > 0 && <TransferQueue transfers={mine} tabId={tabId} />}
      {dragging > 0 && (
        <div className="dropzone" aria-live="polite" data-files-dropzone>
          <span className="prompt-ic accent" style={{ width: 44, height: 44 }}><Icon name="upload" size="lg" /></span>
          <span className="strong">{t('files_view.drop_to_upload')}</span>
          <span className="mono accent-t" style={{ fontSize: 'var(--fs-xs)' }}>→ {tab.alias}:{path}</span>
          <span className="hint">{t('files_view.existing_files_ask_before_they')}</span>
        </div>
      )}
      {drop && (
        <div className="drag-ghost" style={{ position: 'fixed', left: drop.x + 14, top: drop.y + 10 }} data-files-drag-label>
          <span className="tooltip"><Icon name="arrow-r" size="sm" />{tr('files_view.copy_to_alias_folderlabel', { alias: tab.alias, folderLabel: folderLabel(drop.path) })}</span>
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

function rateLine(x: Transfer): string {
  if (x.state === 'staging') return t('files_view.reading_dropped');
  if (x.rate <= 0) return x.state === 'running' ? t('files_view.starting') : '';
  const left = x.total > 0 ? Math.max(0, (x.total - x.bytes) / x.rate) : -1;
  const rate = humanSize(Math.round(x.rate));
  if (left < 0) return t('files_view.rate', { rate });
  return left < 60 ? t('files_view.rate_s_left', { rate, s: Math.ceil(left) }) : t('files_view.rate_min_left', { rate, min: Math.ceil(left / 60) });
}

function TransferQueue({ transfers, tabId }: { transfers: Transfer[]; tabId: string }) {
  const doneCount = transfers.filter((t) => t.state === 'done' || t.state === 'cancelled').length;
  const conflicts = transfers.filter((t) => t.state === 'conflict').length;
  const relay = transfers.some((t) => t.direction === 'relay');
  return (
    <div className="col" data-files-queue style={{ flex: 'none', borderTop: '1px solid var(--border-default)', background: 'var(--surface-raised)', maxHeight: '40%', minHeight: 0 }}>
      <div className="row" style={{ height: 32, padding: '0 var(--sp-2) 0 var(--sp-3)', flex: 'none' }}>
        <span className="label grow">{tr('files_view.transfers_length', { length: transfers.length })}</span>
        {relay && <span className="hint" style={{ marginRight: 'var(--sp-2)' }}>{t('files_view.bytes_pass_through_flint')}</span>}
        <button className="btn btn-ghost btn-sm" data-files-clear disabled={doneCount === 0} onClick={() => files.clearDone(tabId)}>{t('files_view.clear_done')}</button>
      </div>
      <div className="col" style={{ overflowY: 'auto', paddingBottom: 'var(--sp-1)' }}>
        {transfers.map((t) => <TransferRow key={t.id} t={t} others={conflicts - 1} />)}
      </div>
    </div>
  );
}

/** Each direction's Cancel label and the word a finished transfer shows: catalog keys. */
const VERBS = {
  upload: ['files_view.cancel_upload', 'files_view.uploaded'], download: ['files_view.cancel_download', 'files_view.downloaded'], relay: ['files_view.cancel_copy', 'files_view.copied'],
} as const;

function TransferRow({ t: transferItem, others }: { t: Transfer; others: number }) {
  const [cancelKey, doneKey] = VERBS[transferItem.direction];
  const pct = transferItem.total > 0 ? Math.min(100, Math.round((transferItem.bytes / transferItem.total) * 100)) : 0;
  const size = transferItem.total > 0 ? `${humanSize(transferItem.bytes)}/${humanSize(transferItem.total)}` : humanSize(transferItem.bytes);
  const [all, setAll] = useState(false);
  let icon = <Icon name={transferItem.direction === 'upload' ? 'upload' : transferItem.direction === 'download' ? 'download' : 'arrow-r'} size="sm" className="accent-t" />;
  let status: ReactNode = <span className="mono faint" style={{ fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>{size}</span>;
  let action: ReactNode = <button className="icon-btn" aria-label={t(cancelKey)} title={t(cancelKey)} data-transfer-cancel onClick={() => files.cancel(transferItem.id)}><Icon name="x" size="xs" /></button>;
  if (transferItem.state === 'queued') {
    icon = <Icon name="clock" size="sm" className="faint" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{t('files_view.queued')}</span>;
    action = <button className="icon-btn" aria-label={t('files_view.remove_from_queue')} title={t('files_view.remove_from_queue')} data-transfer-cancel onClick={() => files.cancel(transferItem.id)}><Icon name="x" size="xs" /></button>;
  } else if (transferItem.state === 'done') {
    icon = <Icon name="check" size="sm" className="ok-t" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{transferItem.recursive
      ? t('files_view.done_files', { done: t(doneKey), count: transferItem.filesDone, size: humanSize(transferItem.bytes) })
      : t('files_view.done_size', { done: t(doneKey), size: humanSize(transferItem.bytes) })}</span>;
    action = null;
  } else if (transferItem.state === 'cancelled') {
    icon = <Icon name="x" size="sm" className="faint" />;
    status = <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{transferItem.skipped ? t('files_view.skipped') : t('files_view.cancelled')}</span>;
    action = <button className="icon-btn" aria-label={t('files_view.dismiss')} title={t('files_view.dismiss')} onClick={() => files.dismiss(transferItem.id)}><Icon name="x" size="xs" /></button>;
  } else if (transferItem.state === 'failed') {
    icon = <Icon name="alert" size="sm" className="danger-t" />;
    status = <span className="danger-t trunc" style={{ fontSize: 'var(--fs-xs)', maxWidth: 140 }} title={transferItem.error?.message}>{failureLabel(transferItem)}</span>;
    action = <>
      {transferItem.local && <button className="btn btn-ghost btn-sm" data-transfer-retry onClick={() => files.retry(transferItem.id)}>{t('common.retry')}</button>}
      <button className="icon-btn" aria-label={t('files_view.dismiss')} title={t('files_view.dismiss')} onClick={() => files.dismiss(transferItem.id)}><Icon name="x" size="xs" /></button>
    </>;
  }
  const active = transferItem.state === 'running' || transferItem.state === 'staging';
  const where = transferItem.direction === 'upload' ? `${transferItem.local} → ${transferItem.alias}:${transferItem.remote}` : transferItem.direction === 'download' ? `${transferItem.alias}:${transferItem.remote} → ${transferItem.local}` : `${transferItem.alias}:${transferItem.remote} → ${transferItem.toAlias}:${transferItem.local}`;
  // 14d4: a name clash asks in a strip, and may answer the other clashes too.
  if (transferItem.state === 'conflict') {
    const target = transferItem.direction === 'upload' ? transferItem.alias : transferItem.direction === 'relay' ? transferItem.toAlias : t('files_view.this_computer');
    const replace = () => (all ? files.resolveAll(transferItem.tabId, true) : files.retry(transferItem.id, true));
    const skip = () => (all ? files.resolveAll(transferItem.tabId, false) : files.skip(transferItem.id));
    return (
      <div className="conflict" role="alert" data-transfer={transferItem.name} data-state={transferItem.state} data-direction={transferItem.direction} title={where}>
        <div className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
          <Icon name="alert" size="sm" className="warn-t" />
          <span className="grow" style={{ overflowWrap: 'anywhere' }}>{tr(transferItem.folder ? 'files_view.exists_on_in' : 'files_view.exists_on', { name: <span className="mono strong">{transferItem.name}</span>, target: <span className="mono">{target}</span>, folder: transferItem.folder ? folderLabel(transferItem.folder) : '' })}</span>
        </div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          {others > 0 && (
            <label className="opt"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} data-transfer-all />
              <span className="opt-t"><span className="opt-l" style={{ fontSize: 'var(--fs-xs)' }}>{t('files_view.do_this_for_others', { count: others })}</span></span></label>
          )}
          <span className="grow" />
          <button className="btn btn-ghost btn-sm" data-transfer-skip onClick={skip}>{t('files_view.skip')}</button>
          <button className="btn btn-secondary btn-sm" data-transfer-replace onClick={replace}>{t('files_view.replace')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="xfer" data-transfer={transferItem.name} data-state={transferItem.state} data-direction={transferItem.direction}>
      <div className="row" style={{ fontSize: 'var(--fs-sm)', gap: 'var(--sp-2)' }}>
        {icon}<span className="mono grow trunc" title={where}>{transferItem.name}</span>{status}{action}
      </div>
      {transferItem.direction === 'relay' && (
        <span className="chain" style={{ paddingLeft: 22 }} data-transfer-route title={where}><span className="node">{transferItem.alias}</span><Icon name="chain" size="xs" /><span className="node caller">{transferItem.toAlias}</span></span>
      )}
      {active && <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: transferItem.total > 0 ? pct + '%' : '30%' }} className={transferItem.total > 0 ? '' : 'indeterminate'} /></div>}
      {active && <span className="hint mono">{transferItem.recursive && transferItem.file ? t('files_view.n_done', { n: transferItem.filesDone }) : ''}{rateLine(transferItem)}</span>}
    </div>
  );
}

function failureLabel(x: Transfer): string {
  switch (x.error?.code) {
    case 'permission_denied': return t('files_view.fail.permission_denied');
    case 'not_found': return t('files_view.fail.not_found');
    case 'not_a_directory': return t('files_view.fail.not_a_folder');
    case 'network': return t('files_view.fail.connection_lost');
    case 'exists': return t('files_view.fail.already_there');
    default: return x.error?.message ?? t('files_view.fail.failed');
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
