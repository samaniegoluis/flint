// The Files view's second pane (milestone 19, design 14d, D-059): the server picker
// (14d1) and the pane itself (14d2-14d5), which floats beside the Files view over
// the terminal and never resizes it. Hiding it (Esc, a click in the terminal, its
// collapse button) keeps two-pane mode, its session and its transfers; One pane
// ends the mode.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileEntry } from '../api/types';
import { useApp } from '../state/app';
import { buildTree } from '../lib/tree';
import { colorStyle } from '../lib/colors';
import { Icon } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import type { TextAsk } from '../ui/Dialogs';
import type { Confirm } from '../pages/KeysPage';
import { validName } from './paths';
import { files, useFiles } from './store';
import { pairs, paneKey, type Pair } from './pair';
import { dropFolderAt, FileList, folderLabel, paneDrag, setPaneDrag } from './FileList';

// ---- 14d1: the server picker -----------------------------------------------------------

export function ServerPicker({ current, onPick, onClose }: { current: string; onPick: (alias: string) => void; onClose: () => void }) {
  const { catalog } = useApp();
  const [filter, setFilter] = useState('');
  const [hot, setHot] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => buildTree(catalog.groups, catalog.hosts, new Set(), filter), [catalog, filter]);
  const pickable = rows.filter((r) => r.kind === 'host' && r.alias !== current);
  const hotAlias = pickable[Math.min(hot, pickable.length - 1)]?.kind === 'host' ? (pickable[Math.min(hot, pickable.length - 1)] as { alias: string }).alias : '';

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-files-pick]')) onClose(); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);
  useEffect(() => { setHot(0); }, [filter]);

  return (
    <div ref={ref} className="menu" role="dialog" aria-label="Copy to another server" data-files-picker
      style={{ position: 'absolute', left: 'var(--sp-3)', right: 'var(--sp-3)', top: 40, maxWidth: 320, maxHeight: 'calc(100% - 60px)', zIndex: 20 }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); setHot((h) => Math.min(pickable.length - 1, h + 1)); }
        if (e.key === 'ArrowUp') { e.preventDefault(); setHot((h) => Math.max(0, h - 1)); }
        if (e.key === 'Enter' && hotAlias) { e.preventDefault(); onPick(hotAlias); }
      }}>
      <div className="menu-label"><span className="label">Copy to another server</span></div>
      <label className="search" style={{ margin: '0 var(--sp-1) var(--sp-1)' }}>
        <Icon name="search" size="sm" />
        <input aria-label="Filter hosts" placeholder="Filter hosts" value={filter} autoFocus onChange={(e) => setFilter(e.target.value)} data-files-picker-filter />
      </label>
      <div className="col" style={{ overflowY: 'auto', minHeight: 0, gap: 1 }}>
        {rows.map((r) => {
          const pad = 8 + r.depth * 16;
          if (r.kind === 'group') {
            return <div key={r.key} className="picker-row" style={{ paddingLeft: pad, color: 'var(--text-secondary)' }}><Icon name="chev" size="sm" /><span className="grow trunc">{r.name}</span></div>;
          }
          const c = colorStyle(r.host.color);
          if (r.alias === current) {
            return (
              <button key={r.key} className="picker-row off" style={{ paddingLeft: pad + 16 }} aria-disabled="true" tabIndex={-1}>
                <span className={'hmark ' + c.className} style={c.style} /><span className="mono grow trunc">{r.alias}</span><span className="hint">this tab</span>
              </button>
            );
          }
          const isHot = r.alias === hotAlias;
          return (
            <button key={r.key} className={'picker-row' + (isHot ? ' hot' : '')} style={{ paddingLeft: pad + 16 }} data-files-pick-host={r.alias}
              onMouseEnter={() => setHot(pickable.findIndex((p) => p.key === r.key))} onClick={() => onPick(r.alias)}>
              <span className={'hmark ' + c.className} style={c.style} /><span className="mono grow trunc">{r.alias}</span>{isHot && <span className="kbd">↵</span>}
            </button>
          );
        })}
        {pickable.length === 0 && <span className="hint" style={{ padding: 'var(--sp-2)' }}>{filter ? 'No host matches.' : 'This vault has no other host.'}</span>}
      </div>
      <div className="menu-sep" />
      <span className="hint" style={{ padding: 'var(--sp-1) var(--sp-2) var(--sp-2)' }}>Opens a second file pane. Flint logs in without a terminal when the host has no open tab.</span>
    </div>
  );
}

// ---- 14d2-14d5: the second pane ---------------------------------------------------------

interface PaneProps {
  /** The first pane's tab: its session, host and id. */
  tabId: string;
  session: string;
  alias: string;
  pair: Pair;
  onConfirm: (c: Confirm) => void;
  onAsk: (a: TextAsk) => void;
  onEditHost: (alias: string) => void;
}

export function OtherPane({ tabId, session, alias, pair, onConfirm, onAsk, onEditHost }: PaneProps) {
  const { os, catalog, notify } = useApp();
  const { folders } = useFiles();
  const key = paneKey(tabId);
  const folder = folders[key];
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: FileEntry | null } | null>(null);
  const [drop, setDrop] = useState<{ x: number; y: number; path: string; row: string | null } | null>(null);
  const host = catalog.hosts.find((h) => h.alias === pair.alias);
  const color = colorStyle(host?.color ?? '');
  const ready = pair.status === 'ready';
  const path = folder?.path ?? '';
  const mod = os === 'mac' ? '⌘' : 'Ctrl+Shift+';

  useEffect(() => {
    if (ready) files.ensure(key, pair.session);
  }, [key, pair.session, ready]);

  // A click in the terminal hides the pane; the mode, its session and transfers stay.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.('.main') && !ref.current?.contains(t)) pairs.setHidden(tabId, true);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [tabId]);

  // Opening: focus the pane, so Esc and the arrows reach it.
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? listRef.current;
    el?.focus();
  }, [pair.status, pair.prompt?.prompt]);

  const copyBack = (e: FileEntry) => {
    const dest = files.folder(tabId);
    if (!dest?.path) return;
    files.relay(tabId, { session: pair.session, alias: pair.alias }, e, { key: tabId, session, alias, folder: dest.path });
  };
  const rename = (e: FileEntry) => onAsk({
    title: `Rename ${e.name}`, label: 'New name', value: e.name, action: 'Rename',
    run: async (v) => {
      if (!validName(v)) throw new Error('A name cannot be empty, ".", ".." or contain "/".');
      if (v === e.name) return;
      await files.rename(key, e, v);
    },
  });
  const newFolder = () => onAsk({
    title: 'New folder', label: 'Name', value: '', action: 'Create folder', hint: `In ${pair.alias}:${path}`,
    run: async (v) => {
      if (!validName(v)) throw new Error('A name cannot be empty, ".", ".." or contain "/".');
      await files.mkdir(key, v);
    },
  });
  const remove = (e: FileEntry) => onConfirm({
    title: `Delete ${e.name}?`,
    body: e.kind === 'dir'
      ? `The folder ${e.path} and everything in it are deleted on ${pair.alias}. This cannot be undone.`
      : `${e.path} is deleted on ${pair.alias}. This cannot be undone.`,
    action: e.kind === 'dir' ? 'Delete folder' : 'Delete file',
    run: async () => { await files.remove(key, e); notify(`Deleted ${e.name}`); },
  });
  const menuItems = (e: FileEntry | null): MenuItem[] => {
    if (!e) return [{ label: 'New folder…', icon: 'folder', run: newFolder }];
    return [
      { label: `Copy to ${alias}`, icon: 'arrow-r', hint: mod + '←', run: () => copyBack(e) },
      { label: 'Rename', icon: 'edit', hint: e.kind === 'dir' ? undefined : '↵', run: () => rename(e) },
      { label: 'New folder…', icon: 'folder', run: newFolder },
      { label: 'Delete…', icon: 'trash', danger: true, sep: true, hint: os === 'mac' ? '⌘⌫' : 'Ctrl+Shift+⌫', run: () => remove(e) },
    ];
  };

  // A row dragged from the first pane (14d3a): the pane and the folder under the
  // pointer light up, and a label says where the copy goes.
  const fromOther = () => { const d = paneDrag(); return d && d.key !== key ? d : null; };
  const onDragOver = (e: React.DragEvent) => {
    if (!fromOther() || !ready || !path) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    const at = dropFolderAt(e.target, path);
    setDrop({ x: e.clientX, y: e.clientY, ...at });
  };
  const onDrop = (e: React.DragEvent) => {
    const d = fromOther();
    if (!d || !ready || !path) return;
    e.preventDefault();
    e.stopPropagation();
    const at = dropFolderAt(e.target, path);
    setDrop(null);
    setPaneDrag(null);
    files.relay(tabId, { session, alias }, d.entry, { key, session: pair.session, alias: pair.alias, folder: at.path });
  };

  const hide = () => pairs.setHidden(tabId, true);
  const roleHint = pair.own ? 'no tab · Flint-only session' : 'its tab’s session';
  const st = pair.status === 'ready' ? 'st-on' : pair.status === 'ended' ? 'st-fail' : 'st-wait';

  return (
    <section ref={ref} className={'fpane fpane-float' + (drop ? ' target' : '')} aria-label={`${pair.alias} files`} data-files-pane="2"
      data-files-path={path} data-files-session={pair.session} data-pair-status={pair.status}
      onKeyDown={(e) => { if (e.key === 'Escape' && !menu) { e.preventDefault(); e.stopPropagation(); hide(); } }}
      onDragEnter={(e) => { if (fromOther()) e.stopPropagation(); }}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setDrop(null); }}
      onDrop={onDrop}
      onContextMenu={(e) => e.stopPropagation()}>
      <div className="fpane-h">
        <div className="row" style={{ gap: 6 }}>
          <span className={'sp-dot ' + color.className} style={color.style} />
          <span className="mono strong trunc" data-files-pane-host>{pair.alias}</span>
          <span className="role-tag other">Other server</span>
          <span className="hint trunc grow" style={{ minWidth: 0 }}>{roleHint}</span>
          <span className={'st ' + st} role="img" aria-label={pair.status} />
          <button className="icon-btn" aria-label="Hide this pane (Esc). Copies carry on" title="Hide this pane (Esc). Copies carry on" data-files-pane-hide onClick={hide}><Icon name="chev-r" size="sm" className="flip-x" /></button>
          <button className="btn btn-ghost btn-sm" data-files-one-pane title="Back to one pane: ends this pane's session" onClick={() => pairs.close(tabId)}><Icon name="sidebar" size="sm" />One pane</button>
        </div>
        <div className="row" style={{ gap: 2 }}>
          <button className="icon-btn" aria-label="Up one folder" disabled={!ready || !path || path === '/'} onClick={() => files.up(key)}><Icon name="up" size="sm" /></button>
          <nav className="crumbs grow" aria-label="Path" data-files-pane-crumbs>
            {ready && path ? <PaneCrumbs path={path} onGo={(p) => files.go(key, p)} /> : <span className="cur-c">…</span>}
          </nav>
          <button className="icon-btn" aria-label="Refresh" disabled={!ready} onClick={() => files.refresh(key)}><Icon name="reconnect" size="sm" /></button>
        </div>
      </div>
      {ready ? (
        <FileList fkey={key} folder={folder} os={os} listRef={listRef} dropPath={drop?.row ?? null}
          onOpenFile={() => {}} onMenu={(x, y, entry) => setMenu({ x, y, entry })} onRename={rename} onRemove={remove}
          onCopyOther={copyBack} copyKey="ArrowLeft" draggable />
      ) : (
        <div className="col grow" style={{ minHeight: 0, alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)', background: 'var(--surface-sunken)' }}>
          <PaneState tabId={tabId} pair={pair} onEditHost={onEditHost} />
        </div>
      )}
      {drop && (
        <div className="drag-ghost" style={{ position: 'fixed', left: drop.x + 14, top: drop.y + 10 }} data-files-drag-label>
          <span className="tooltip"><Icon name="arrow-r" size="sm" />Copy to {pair.alias} · {folderLabel(drop.path)}</span>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.entry)} onClose={() => { setMenu(null); listRef.current?.focus(); }} />}
    </section>
  );
}

function PaneCrumbs({ path, onGo }: { path: string; onGo: (p: string) => void }) {
  // The last three folders, as in the design's narrow panes; the parent climbs further.
  const parts = path.split('/').filter(Boolean);
  const shown = parts.slice(-3);
  const base = parts.length - shown.length;
  return (
    <>
      {base > 0 && <><button onClick={() => onGo('/' + parts.slice(0, base).join('/'))} title={'/' + parts.slice(0, base).join('/')}>…</button><span>/</span></>}
      {parts.length === 0 && <span className="cur-c">/</span>}
      {shown.map((name, i) => {
        const p = '/' + parts.slice(0, base + i + 1).join('/');
        const last = i === shown.length - 1;
        return (
          <span key={p} className={last ? 'crumb crumb-last' : 'crumb'}>
            {i > 0 && <span>/</span>}
            {last ? <span className="cur-c" title={path}>{name}</span> : <button onClick={() => onGo(p)} title={p}>{name}</button>}
          </span>
        );
      })}
    </>
  );
}

// 14d5a-d: logging in without a terminal, inside the pane.
function PaneState({ tabId, pair, onEditHost }: { tabId: string; pair: Pair; onEditHost: (alias: string) => void }) {
  const { catalog } = useApp();
  const host = catalog.hosts.find((h) => h.alias === pair.alias);
  const [pw, setPw] = useState('');
  if (pair.status === 'connecting') {
    return (
      <div className="col" style={{ gap: 'var(--sp-3)', width: 280 }} role="status" aria-live="polite" data-files-pane-connecting>
        <div className="row" style={{ gap: 'var(--sp-3)' }}>
          <span className="spinner" aria-hidden="true" />
          <div className="col" style={{ minWidth: 0 }}>
            <span className="strong">Connecting to <span className="mono">{pair.alias}</span></span>
            <span className="hint mono trunc">{host ? `${host.user ? host.user + '@' : ''}${host.hostname}` : pair.alias}{host?.jump ? ` · via ${host.jump}` : ''} · no terminal</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} data-autofocus onClick={() => pairs.close(tabId)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pairs.close(tabId); } }}>Cancel<Key>esc</Key></button>
      </div>
    );
  }
  if (pair.status === 'prompt' && pair.prompt?.kind === 'password') {
    const p = pair.prompt;
    return (
      <form className="card prompt" style={{ width: 320, padding: 'var(--sp-4)', gap: 'var(--sp-3)' }} aria-label={`Password for ${p.user}@${p.alias}`} data-files-pane-password
        onSubmit={(e) => { e.preventDefault(); pairs.answer(tabId, true, pw); setPw(''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pairs.answer(tabId, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic accent"><Icon name="lock" /></span>
          <div className="col grow" style={{ gap: 2 }}><h2 className="prompt-t" style={{ fontSize: 'var(--fs-md)' }}>Password for <span className="mono">{p.user}@{p.alias}</span></h2>
            <span className="hint">No saved login was accepted.</span></div></div>
        <div className="input"><input type="password" className="pw" aria-label="Password" value={pw} onChange={(e) => setPw(e.target.value)} data-autofocus autoComplete="off" /></div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pairs.answer(tabId, false, '')}>Cancel</button>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!pw}>Connect<span className="kbd-in">↵</span></button>
        </div>
      </form>
    );
  }
  if (pair.status === 'prompt' && pair.prompt?.kind === 'host_key') {
    const k = pair.prompt.host_key;
    return (
      <form className="card prompt" style={{ width: 330, padding: 'var(--sp-4)', gap: 'var(--sp-3)' }} aria-label={`Verify ${k.alias}`} data-files-pane-hostkey
        onSubmit={(e) => { e.preventDefault(); pairs.answer(tabId, true, ''); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pairs.answer(tabId, false, ''); } }}>
        <div className="prompt-h"><span className="prompt-ic warn"><Icon name="shield" /></span>
          <div className="col grow" style={{ gap: 2 }}><h2 className="prompt-t" style={{ fontSize: 'var(--fs-md)' }}>Verify <span className="mono">{k.alias}</span></h2>
            <span className="hint">First connection. Compare the fingerprint.</span></div></div>
        <div className="fp" style={{ fontSize: 'var(--fs-xs)' }}>{k.key_type} · {k.fingerprint}</div>
        <div className="row" style={{ gap: 'var(--sp-2)' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => pairs.answer(tabId, false, '')}>Cancel</button>
          <span className="grow" />
          <button type="submit" className="btn btn-primary btn-sm" data-autofocus>Trust<span className="kbd-in">↵</span></button>
        </div>
      </form>
    );
  }
  const end = pair.end;
  const auth = end?.code === 'auth';
  const changed = end?.code === 'host_key' && !!pair.changedKey;
  return (
    <div className="card prompt" role="alert" style={{ width: 320, padding: 'var(--sp-4)', gap: 'var(--sp-3)' }} data-files-pane-ended={end?.code || 'closed'}>
      <div className="prompt-h"><span className={'prompt-ic danger'}><Icon name={auth ? 'lock' : changed ? 'shield' : 'wifi-off'} /></span>
        <div className="col grow" style={{ gap: 2 }}><h2 className="prompt-t" style={{ fontSize: 'var(--fs-md)' }}>{auth ? 'Authentication failed' : changed ? 'The host key has changed' : `Not connected to ${pair.alias}`}</h2>
          <span className="hint">{changed ? 'Nothing was sent. Open a tab on this host to review the key.' : auth ? <><span className="mono">{pair.alias}</span> refused the login.</> : 'The pane has no session.'}</span></div></div>
      {end?.message && <span className="mono hint" style={{ overflowWrap: 'anywhere' }}>{end.message}</span>}
      <div className="row" style={{ gap: 'var(--sp-2)' }}>
        {auth && <button className="btn btn-ghost btn-sm" onClick={() => onEditHost(pair.alias)}>Edit host</button>}
        <span className="grow" />
        <button className="btn btn-ghost btn-sm" onClick={() => pairs.close(tabId)}>Close pane</button>
        {!changed && <button className="btn btn-primary btn-sm" data-autofocus data-files-pane-retry onClick={() => pairs.retry(tabId)}>Retry</button>}
      </div>
    </div>
  );
}
