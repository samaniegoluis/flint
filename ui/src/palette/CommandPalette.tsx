// The command palette (⌘K; ⌘P and ⌘T limit it to hosts). Hosts first, then actions,
// then vaults. ↵ opens (with ⌘P a host with an open tab switches to it; with ⌘T,
// "New session", it always opens a new tab), ⌘↵ opens a host in a new tab, ⇧⌘↵ in a
// new pane of the active tab (design 18e), ⌘I edits it, Tab moves between result
// groups. While searching, the best hosts are also offered as "Open <host> in a new
// pane" actions, and every tunnel as "Start tunnel <name> on <host>" or "Stop …", with
// "Connect to <host> with tunnels" and "Manage tunnels of <host>…" (design 20e).

import { useMemo, useRef, useState } from 'react';
import { useApp, vaultInitial, vaultMarkClass, shortPath } from '../state/app';
import { folderDisplay, highlight, hostFields, search, type SearchMatch } from '../lib/search';
import { actionTitle, chordLabel, type Action } from '../lib/keymap';
import { colorStyle } from '../lib/colors';
import { HostTypeIcon, Icon, type IconName } from '../ui/Icon';
import { Key } from '../ui/Kbd';
import { Modal } from '../ui/Modal';
import { useSessions } from '../sessions/store';
import { useMonitors } from '../sessions/monitors';
import { MAX_PANES } from '../lib/layout';
import { tunnels, useTunnels } from '../tunnels/store';
import { useSyncMaybe } from '../sync/SyncProvider';
import { useUpdate } from '../update/UpdateProvider';
import { updatePaletteHint } from '../lib/update';
import { plainText } from '../ui/plainText';
import { t, textInEveryLanguage } from '../i18n';
import { tr } from '../i18n/react';

type Group = 'all' | 'hosts' | 'actions' | 'vaults';

interface Item {
  /** Tunnel rows show under All and Actions, with a header of their own. */
  group: Exclude<Group, 'all'> | 'tunnels';
  key: string;
  score: number;
  render: () => React.ReactNode;
  /** `tab`: ⌘↵, a new tab. `pane`: ⇧⌘↵, a new pane of the active tab. */
  run: (mode: 'open' | 'tab' | 'pane') => void;
  /** Hosts only: ⇧⌘↵ applies. */
  host?: boolean;
  edit?: () => void;
  /** Shown greyed with this reason, and does nothing (design 21d2). */
  disabled?: string;
}

// The language and the theme from the palette (D-144), live as the Settings rows.
// Each language by its own name, as the Language row shows it (D-141).
const LANGUAGE_NAME = { en: 'English', es: 'Español' } as const;
const THEME_LABEL = { dark: 'settings_page.dark', light: 'settings_page.light', system: 'settings_page.match_system' } as const;
// Words that find these rows in either language, so someone in the wrong one finds the
// way back; each row adds its value's name in every language (claro, light).
const LANGUAGE_WORDS = 'language idioma lenguaje'; // i18n-ignore
const THEME_WORDS = 'theme tema appearance apariencia'; // i18n-ignore

// What an RDP tab cannot do (design 21d2): files, tunnels and panes are SSH's.
const SSH_ONLY_ACTIONS: Action[] = ['viewFiles', 'viewTunnels', 'splitRight', 'splitDown', 'focusNextPane', 'layout1', 'layout2', 'layout3', 'layout4', 'duplicate', 'broadcastAll'];

const PALETTE_ACTIONS: { action: Action; icon: IconName }[] = [
  { action: 'newHost', icon: 'plus' },
  { action: 'newSshHost', icon: 'plus' },
  { action: 'newRdpHost', icon: 'plus' },
  { action: 'reconnect', icon: 'reconnect' },
  { action: 'duplicate', icon: 'dup' },
  { action: 'splitRight', icon: 'split' },
  { action: 'splitDown', icon: 'split' },
  { action: 'focusNextPane', icon: 'split' },
  { action: 'broadcastAll', icon: 'broadcast' },
  { action: 'stopBroadcast', icon: 'broadcast' },
  { action: 'layout1', icon: 'split' },
  { action: 'layout2', icon: 'split' },
  { action: 'layout3', icon: 'split' },
  { action: 'layout4', icon: 'split' },
  { action: 'closeTab', icon: 'x' },
  { action: 'fullscreen', icon: 'expand' },
  { action: 'fullscreenAll', icon: 'monitors' },
  { action: 'viewHosts', icon: 'hosts' },
  { action: 'viewTunnels', icon: 'tunnel' },
  { action: 'viewKeys', icon: 'key' },
  { action: 'viewCredentials', icon: 'cred' },
  { action: 'settings', icon: 'settings' },
  { action: 'toggleSidebar', icon: 'sidebar' },
  { action: 'collapseAll', icon: 'folder' },
  { action: 'expandAll', icon: 'folder' },
  { action: 'switchVault', icon: 'updown' },
  { action: 'openVault', icon: 'folder' },
  { action: 'createVault', icon: 'plus' },
  { action: 'connectRemote', icon: 'server' },
  { action: 'syncNow', icon: 'cloud' },
  { action: 'connectServer', icon: 'server' },
  { action: 'disconnectServer', icon: 'cloud-off' },
  { action: 'showLastMerge', icon: 'cloud' },
  { action: 'checkUpdates', icon: 'download' },
  { action: 'whatsNew', icon: 'sparkle' },
  { action: 'aboutFlint', icon: 'info' },
  { action: 'lock', icon: 'lock' },
  { action: 'quit', icon: 'x' },
];

const SYNC_ACTIONS: Action[] = ['syncNow', 'connectServer', 'disconnectServer', 'showLastMerge'];

function syncShows(a: Action, sync: ReturnType<typeof useSyncMaybe>): boolean {
  if (!SYNC_ACTIONS.includes(a)) return true;
  if (!sync) return false;
  if (a === 'connectServer') return !sync.status;
  if (a === 'showLastMerge') return !!sync.lastMerge;
  return !!sync.status;
}

function Hl({ text, positions }: { text: string; positions: number[] }) {
  return <>{highlight(text, positions).map((r, i) => (r.match ? <span key={i} className="match">{r.text}</span> : <span key={i}>{r.text}</span>))}</>;
}

/**
 * Where a host row says it is (its folder, or its hostname with no folder), with the
 * words that matched there highlighted, and then each match in a field the row does
 * not show: `· tag: db`, `· host: db1.lan`, `· label: Billing` (milestone 62).
 */
function HostWhere({ h, m }: { h: { label: string; hostname: string; tags: string[]; group: string }; m: SearchMatch | null }) {
  const pos = m?.positions ?? {};
  const where = h.group ? folderDisplay(h.group, pos.group) : { text: h.hostname, positions: pos.hostname ?? [] };
  const extra: { kind: string; text: string; positions: number[] }[] = [];
  if (pos.label) extra.push({ kind: 'label', text: h.label, positions: pos.label });
  if (h.group && pos.hostname) extra.push({ kind: 'host', text: h.hostname, positions: pos.hostname });
  h.tags.forEach((t, i) => { const p = pos['tag:' + i]; if (p) extra.push({ kind: 'tag', text: t, positions: p }); });
  return (
    <>
      <Hl text={where.text} positions={where.positions} />
      {extra.map((e) => <span key={e.kind + e.text} data-match-field={e.kind}> · {e.kind}: <Hl text={e.text} positions={e.positions} /></span>)}
    </>
  );
}

export function CommandPalette({ hostsOnly, newSession = false, pickToEdit = false, onClose, onConnect, onConnectWithTunnels, onManageTunnels, onSplit, onEdit, onAction }: {
  hostsOnly: boolean;
  newSession?: boolean;
  /** Picks a host to add a tunnel to (the Tunnels view's empty state): ↵ opens its editor. */
  pickToEdit?: boolean;
  /** Opens a tab on the host and starts every one of its tunnels. */
  onConnectWithTunnels: (alias: string) => void;
  /** The host editor, at its Tunnels section. */
  onManageTunnels: (alias: string) => void;
  onClose: () => void;
  onConnect: (alias: string, newTab: boolean, noCommand?: boolean) => void;
  /** Opens a host in a new pane of the active tab. */
  onSplit: (alias: string, noCommand?: boolean) => void;
  onEdit: (alias: string) => void;
  onAction: (a: Action) => void;
}) {
  const { catalog, recents, vault, os, switchTo, fail, settings, saveSettings } = useApp();
  const sync = useSyncMaybe();
  const update = useUpdate();
  const { tabs, panes, active } = useSessions();
  const tun = useTunnels();
  const activeTab = tabs.find((t) => t.id === active);
  // A new pane goes into the active tab, while it has room; a remote desktop's tab
  // takes none.
  const rdpTab = panes.find((p) => p.id === activeTab?.focus)?.kind === 'rdp';
  // Milestone 38: why "Full screen on all monitors" is greyed here, if it is (22f1c).
  const monitorsView = useMonitors().view;
  const monitorsReason = monitorsView ? monitorsView.reason : t('command_palette.only_one_monitor');
  const canSplit = !!activeTab && activeTab.panes.length < MAX_PANES && !rdpTab;
  // Milestone 73: Broadcast to all panes while it is off, Stop broadcast while it is on.
  const broadcastOn = (activeTab?.broadcast.length ?? 0) > 0;
  const upPanes = activeTab ? panes.filter((p) => p.tab === activeTab.id && p.kind === 'ssh' && p.status === 'ready').length : 0;
  const paneNo = activeTab ? activeTab.panes.indexOf(activeTab.focus) + 1 : 0;
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<Group>(hostsOnly ? 'hosts' : 'all');
  const [hot, setHot] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const h of catalog.hosts) {
      const rdp = h.type === 'rdp';
      // Adding a tunnel needs an SSH host.
      if (pickToEdit && rdp) continue;
      // Every word whole in the alias, label, hostname, a tag or the folder (milestone 62).
      const m = search(q, hostFields(h));
      if (!m) continue;
      const aliasAt = m.positions.alias ?? [];
      const tabIdx = tabs.findIndex((t) => panes.some((p) => p.tab === t.id && p.alias === h.alias && p.status !== 'ended'));
      const c = colorStyle(h.color);
      out.push({
        group: 'hosts', key: 'h:' + h.alias, score: m.score + 2000,
        render: () => (
          <>
            <span className={'hmark ' + c.className} style={c.style} />
            <HostTypeIcon type={h.type} size="md" />
            <span className="mono" style={{ width: 160, flex: 'none' }}><Hl text={h.alias} positions={aliasAt} /></span>
            <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}><HostWhere h={h} m={q ? m : null} />{tabIdx >= 0 ? t('command_palette.open_in_tab_p', { p: tabIdx + 1 }) : ''}</span>
            <span className="hint">{newSession ? t('command_palette.new_tab') : tabIdx >= 0 ? t('command_palette.switch_to_tab') : t('common.connect')}</span>
          </>
        ),
        run: (mode) => (pickToEdit ? onManageTunnels(h.alias) : mode === 'pane' && canSplit && !rdp ? onSplit(h.alias) : onConnect(h.alias, mode === 'tab' || newSession)),
        edit: () => onEdit(h.alias),
        host: !rdp,
      });
      // A host with an initial command can be opened without it once, like
      // `flint connect --no-command`: a way in when that program is broken. Offered
      // only while searching, so an empty palette does not list every host twice.
      if (h.command && q) {
        out.push({
          group: 'hosts', key: 'hn:' + h.alias, score: m.score + 1999,
          render: () => (
            <>
              <span className={'hmark ' + c.className} style={c.style} />
              <span className="mono" style={{ width: 160, flex: 'none' }}><Hl text={h.alias} positions={aliasAt} /></span>
              <span className="grow faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{tr('command_palette.without_command', { command: <span className="mono">{h.command}</span> })}</span>
              <span className="hint">{t('command_palette.connect_without_command')}</span>
            </>
          ),
          run: (mode) => (mode === 'pane' && canSplit ? onSplit(h.alias, true) : onConnect(h.alias, true, true)),
          edit: () => onEdit(h.alias),
          host: true,
        });
      }
    }
    if (!hostsOnly && q) {
      // Tunnels, while searching (design 20e): by tunnel name, host or port, and by the
      // row's own words, so "stop web" finds "Stop tunnel web on <host>".
      const hostsWith = new Map<string, number>();
      for (const v of tun.list) {
        const up = v.state === 'listening';
        const m = search(q, [
          { name: 'name', text: v.name, primary: true },
          { name: 'host', text: v.host },
          { name: 'port', text: String(v.local_port) },
          { name: 'action', text: t('command_palette.p_tunnel_on', { p: up ? 'stop' : 'start' }) },
        ]);
        if (!m) continue;
        const byAction = !!m.positions.action;
        hostsWith.set(v.host, Math.max(hostsWith.get(v.host) ?? 0, m.score));
        const conns = v.connections === 0 ? t('command_palette.no_connections') : t('command_palette.n_connections', { count: v.connections });
        out.push({
          // Asked for by its action ("start web"): above the host's Connect with tunnels.
          group: 'tunnels', key: 't:' + v.host + ':' + v.name, score: m.score + (byAction ? 1900 : 1800),
          render: () => (
            <>
              <Icon name="tunnel" size="sm" />
              <span className="grow trunc">{tr(up ? 'command_palette.stop_tunnel' : 'command_palette.start_tunnel', { name: <span className="strong">{v.name}</span>, host: <span className="mono">{v.host}</span> })}</span>
              <span className="hint mono">{up ? conns : `127.0.0.1:${v.local_port}`}</span>
            </>
          ),
          run: () => { if (up) void tunnels.stop(v.host, v.name); else tunnels.startTunnels(v.host, [v.name]); },
        });
      }
      for (const [host, score] of hostsWith) {
        const names = tun.list.filter((v) => v.host === host && v.state !== 'listening').map((v) => v.name);
        if (names.length > 0) {
          out.push({
            group: 'tunnels', key: 'tc:' + host, score: score + 1850,
            render: () => (
              <>
                <Icon name="term" size="sm" />
                <span className="grow trunc">{tr('command_palette.connect_to_span_with_tunnels', { span: <span className="mono">{host}</span> })}</span>
                <span className="hint trunc">{tr('command_palette.opens_a_tab_starts_p', { p: names.join(', ') })}</span>
              </>
            ),
            run: () => onConnectWithTunnels(host),
          });
        }
        out.push({
          group: 'tunnels', key: 'tm:' + host, score: score + 1700,
          render: () => (<><Icon name="edit" size="sm" /><span className="grow trunc">{tr('command_palette.manage_tunnels_of_span', { span: <span className="mono">{host}</span> })}</span></>),
          run: () => onManageTunnels(host),
        });
      }
    }
    if (!hostsOnly && canSplit && q) {
      // The best three hosts, as "Open <host> in a new pane" (design 18e).
      const best = catalog.hosts
        .filter((h) => h.type !== 'rdp')
        .map((h) => ({ h, m: search(q, hostFields(h)) }))
        .filter((x) => x.m)
        .sort((a, b) => b.m!.score - a.m!.score)
        .slice(0, 3);
      best.forEach(({ h, m }, i) => {
        out.push({
          group: 'actions', key: 'np:' + h.alias, score: m!.score + 1500,
          render: () => (
            <>
              <Icon name="split" size="sm" />
              <span className="grow trunc">{tr('command_palette.open_span_in_a_new', { span: <span className="mono"><Hl text={h.alias} positions={m!.positions.alias ?? []} /></span> })}</span>
              {i === 0 && <span className="hint">{t('command_palette.splits_pane_of', { pane: paneNo, n: activeTab!.panes.length + 1, max: MAX_PANES })}</span>}
            </>
          ),
          run: () => onSplit(h.alias),
        });
      });
    }
    if (!hostsOnly) {
      for (const a of PALETTE_ACTIONS) {
        // The sync's commands follow the vault's server (milestone 44).
        if (!syncShows(a.action, sync)) continue;
        if ((a.action === 'broadcastAll' && broadcastOn) || (a.action === 'stopBroadcast' && !broadcastOn)) continue;
        const title = actionTitle(a.action);
        const m = search(q, [{ name: 'title', text: title, primary: true }]);
        if (!m) continue;
        out.push({
          group: 'actions', key: 'a:' + a.action, score: m.score + 1000,
          render: () => (<><Icon name={a.icon} size="sm" /><span className="grow"><Hl text={title} positions={m.positions.title ?? []} /></span>{a.action === 'newSshHost' && <HostTypeIcon type="ssh" size="md" />}{a.action === 'newRdpHost' && <HostTypeIcon type="rdp" size="md" />}{a.action === 'checkUpdates' && update.status && <span className="hint" data-palette-update>{updatePaletteHint(update.status, update.now)}</span>}{a.action === 'whatsNew' && update.status?.current && <span className="hint">{update.status.current}</span>}{a.action === 'aboutFlint' && update.status?.current && <span className="hint">v{update.status.current}</span>}{chordLabel(a.action, os) && <span className="kbd">{chordLabel(a.action, os)}</span>}</>),
          run: () => onAction(a.action),
          disabled: rdpTab && SSH_ONLY_ACTIONS.includes(a.action) ? t('command_palette.ssh_hosts_only') : a.action === 'broadcastAll' && upPanes < 2 ? t('command_palette.broadcast_needs_two') : !rdpTab && (a.action === 'fullscreen' || a.action === 'fullscreenAll') ? t('command_palette.rdp_tabs_only') : a.action === 'fullscreenAll' && monitorsReason ? monitorsReason : undefined,
        });
      }
      // Only while searching: the empty list keeps to the actions (D-144).
      if (q.trim()) {
        const choices = [
          ...(['system', 'en', 'es'] as const).map((l) => ({
            key: 'lang:' + l, words: [LANGUAGE_WORDS, ...(l === 'system' ? textInEveryLanguage('settings_page.language.system') : [])].join(' '), current: settings.language === l,
            title: t('command_palette.language_item', { name: l === 'system' ? t('settings_page.language.system') : LANGUAGE_NAME[l] }),
            apply: () => saveSettings({ ...settings, language: l }),
          })),
          ...(['dark', 'light', 'system'] as const).map((th) => ({
            key: 'theme:' + th, words: [THEME_WORDS, ...textInEveryLanguage(THEME_LABEL[th])].join(' '), current: settings.theme === th,
            title: t('command_palette.theme_item', { name: t(THEME_LABEL[th]) }),
            apply: () => saveSettings({ ...settings, theme: th }),
          })),
        ];
        for (const c of choices) {
          const m = search(q, [{ name: 'title', text: c.title, primary: true }, { name: 'words', text: c.words }]);
          if (!m) continue;
          out.push({
            group: 'actions', key: c.key, score: m.score + 1000,
            render: () => (<><Icon name="settings" size="sm" /><span className="grow" data-palette-setting={c.key}><Hl text={c.title} positions={m.positions.title ?? []} /></span>{c.current && <span className="hint">{t('command_palette.current_setting')}</span>}</>),
            run: () => { void c.apply(); },
          });
        }
      }
      for (const r of recents) {
        if (r.path === vault?.path) continue;
        const m = search(q, [{ name: 'name', text: r.name, primary: true }]);
        if (!m) continue;
        out.push({
          group: 'vaults', key: 'v:' + r.path, score: m.score,
          render: () => (
            <>
              <span className={'vault-mark ' + vaultMarkClass(r.path)} style={{ width: 18, height: 18, fontSize: 'var(--fs-2xs)' }}>{vaultInitial(r.name)}</span>
              <span className="grow trunc"><Hl text={r.name} positions={m.positions.name ?? []} /> <span className="mono faint" style={{ fontSize: 'var(--fs-xs)' }}>{shortPath(r.path)}</span></span>
              <span className="hint">{t('command_palette.switch_vault')}</span>
            </>
          ),
          run: () => switchTo(r).catch(fail),
        });
      }
    }
    return out;
  }, [catalog.hosts, tabs, panes, tun.list, canSplit, rdpTab, broadcastOn, upPanes, monitorsReason, paneNo, activeTab, q, hostsOnly, newSession, pickToEdit, os, recents, vault, onConnect, onConnectWithTunnels, onManageTunnels, onSplit, onEdit, onAction, switchTo, fail, sync, update, settings, saveSettings]);

  const counts = { hosts: 0, actions: 0, vaults: 0 };
  for (const it of items) counts[it.group === 'tunnels' ? 'actions' : it.group]++;
  // Hosts stay first, so ↵ on a host's name still connects (20e draws Tunnels first).
  const order: Item['group'][] = ['hosts', 'tunnels', 'actions', 'vaults'];
  const shown = items
    .filter((it) => group === 'all' || it.group === group || (group === 'actions' && it.group === 'tunnels'))
    .sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || b.score - a.score)
    .slice(0, 60);
  const current = shown[Math.min(hot, shown.length - 1)];

  const finish = (fn: () => void) => { onClose(); fn(); };
  const onKey = (e: React.KeyboardEvent) => {
    const mod = os === 'mac' ? e.metaKey : e.ctrlKey;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHot(Math.min(shown.length - 1, hot + 1)); scrollHot(hot + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHot(Math.max(0, hot - 1)); scrollHot(hot - 1); }
    else if (e.key === 'Enter' && current) { e.preventDefault(); if (current.disabled) return; finish(() => current.run(mod && e.shiftKey ? 'pane' : mod ? 'tab' : 'open')); }
    else if (e.key === 'Tab' && !hostsOnly) {
      e.preventDefault();
      const groups: Group[] = ['all', 'hosts', 'actions', 'vaults'];
      setGroup(groups[(groups.indexOf(group) + (e.shiftKey ? 3 : 1)) % 4]);
      setHot(0);
    } else if ((e.key === 'i' || e.key === 'I') && mod && current?.edit) { e.preventDefault(); finish(current.edit); }
  };
  const scrollHot = (i: number) => {
    requestAnimationFrame(() => list.current?.querySelectorAll('[role="option"]')[Math.max(0, i)]?.scrollIntoView({ block: 'nearest' }));
  };

  let lastGroup = '';
  return (
    <Modal label={t('command_palette.command_palette')} onClose={onClose} width={640} top={84} className="palette">
      <div onKeyDown={onKey} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
        <label className="row" style={{ height: 52, padding: '0 var(--sp-4)', gap: 'var(--sp-3)', borderBottom: '1px solid var(--border-subtle)' }}>
          <Icon name="search" className="faint" />
          <input {...plainText} aria-label={pickToEdit ? t('command_palette.add_a_tunnel_to') : newSession ? t('command_palette.new_session_on') : hostsOnly ? t('command_palette.go_to_host') : t('command_palette.search_hosts_actions_and_vaults')} placeholder={pickToEdit ? t('command_palette.add_a_tunnel_to_2') : newSession ? t('command_palette.new_session_on_2') : hostsOnly ? t('command_palette.go_to_host_2') : t('command_palette.hosts_actions_vaults')}
            value={q} onChange={(e) => { setQ(e.target.value); setHot(0); }} className="grow" data-autofocus autoFocus autoComplete="off"
            role="combobox" aria-expanded="true" aria-controls="palette-results" aria-activedescendant={current ? 'pi-' + current.key : undefined}
            style={{ background: 'none', border: 0, outline: 'none', fontSize: 'var(--fs-lg)', color: 'var(--text-primary)' }} />
          <Key>esc</Key>
        </label>
        {!hostsOnly && (
          <div className="row" role="tablist" aria-label={t('command_palette.result_groups')} style={{ gap: 'var(--sp-1)', padding: 'var(--sp-2) var(--sp-3)', borderBottom: '1px solid var(--border-subtle)' }}>
            {(['all', 'hosts', 'actions', 'vaults'] as Group[]).map((g) => (
              <button key={g} className={'btn btn-sm ' + (group === g ? 'btn-secondary' : 'btn-ghost')} role="tab" aria-selected={group === g} tabIndex={-1} onClick={() => { setGroup(g); setHot(0); }}>
                {t(`command_palette.group.${g}`)} <span className="faint">{g === 'all' ? items.length : counts[g]}</span>
              </button>
            ))}
            <span className="grow" /><span className="hint row" style={{ gap: 6 }}><Key>tab</Key>{t('command_palette.next_group')}</span>
          </div>
        )}
        <div ref={list} id="palette-results" className="col scroll" role="listbox" aria-label={t('command_palette.results')} style={{ padding: 'var(--sp-1) var(--sp-2) var(--sp-2)', gap: 1, maxHeight: 420 }}>
          {shown.length === 0 && <span className="faint" style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>{catalog.hosts.length === 0 && hostsOnly ? t('command_palette.this_vault_has_no_hosts') : t('command_palette.no_results')}</span>}
          {shown.map((it, i) => {
            const header = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <div key={it.key} style={{ display: 'contents' }}>
                {header && <div className="menu-label"><span className="label">{t(`command_palette.group.${it.group}`)}</span></div>}
                <button id={'pi-' + it.key} className={'mi' + (it === current ? ' hot' : '') + (it.disabled ? ' is-disabled' : '')} role="option" aria-selected={it === current} aria-disabled={!!it.disabled} tabIndex={-1}
                  title={it.disabled} data-palette-disabled={it.disabled ? '' : undefined}
                  style={{ minHeight: 38 }} onMouseMove={() => setHot(i)} onClick={(e) => { if (it.disabled) return; const m = os === 'mac' ? e.metaKey : e.ctrlKey; finish(() => it.run(m && e.shiftKey ? 'pane' : m ? 'tab' : 'open')); }}>
                  {it.render()}
                  {it.disabled && it === current && <span className="hint">{it.disabled}</span>}
                  {it === current && <Key>↵</Key>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="row faint" data-palette-hints style={{ height: 36, padding: '0 var(--sp-4)', gap: 'var(--sp-4)', borderTop: '1px solid var(--border-subtle)', background: 'var(--surface-raised)', fontSize: 'var(--fs-xs)', flex: 'none' }}>
          <span className="row" style={{ gap: 6 }}><Key>↑↓</Key>{t('command_palette.move')}</span>
          <span className="row" style={{ gap: 6 }}><Key>↵</Key>{newSession ? t('command_palette.open_in_new_tab') : t('command_palette.open')}</span>
          {/* ⌘↵ and ⌘I only act on a host, so they are offered only while one is hot. */}
          {current?.group === 'hosts' && <>
            {!newSession && <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⌘↵' : 'Ctrl+↵'}</Key>{t('command_palette.open_in_new_tab')}</span>}
            {canSplit && current.host && <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⇧⌘↵' : 'Ctrl+Shift+↵'}</Key>{t('command_palette.open_in_a_new_pane')}</span>}
            <span className="row" style={{ gap: 6 }}><Key>{os === 'mac' ? '⌘I' : 'Ctrl+I'}</Key>{t('command_palette.edit_host')}</span>
          </>}
        </div>
      </div>
    </Modal>
  );
}
