// The caller approval window (milestone 12, Principle 12): a `flint` command asks to
// use the vault and the owner allows it, scoped and for a while, or denies it. The
// core waits for the answer (two minutes at most) and the CLI says it is waiting.
// Allow asks for presence first: Touch ID or the Mac's password, polkit, or the
// master password where the OS has neither.
//
// `flint token create` (milestone 12b) shows the token instead: its name, what it
// allows, where and for how long, as the command asked. The owner allows or denies
// that one request; it never becomes a grant.
//
// `flint exec --sudo` (milestone 13) shows the host, the login user and the exact
// argv, one argument per chip. Allowed once, for that command; when Flint has no
// password to type for sudo there, the window takes one, and may keep it for the host.
//
// `flint cp` (milestone 16) is a grant request like `exec` (D-051), and says what it
// copies: the direction, the host, and the paths here and there.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { AccessAction, AccessState, Approval, Catalog, CopyAsk, GrantDuration, PresenceMethod, RootPeriod, TunnelAsk } from '../api/types';
import { Modal } from '../ui/Modal';
import { Key } from '../ui/Kbd';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { CommandModal, MoreRow, moreText } from './CommandModal';
import { colorStyle } from '../lib/colors';
import { plainText } from '../ui/plainText';
import { fmtNumber, t } from '../i18n';
import { tr } from '../i18n/react';

type ScopeKind = 'host' | 'group' | 'all';

/** Root periods (milestone 57, 25e4): offered only with *Allow sudo for a while* on. */
export const ROOT_PERIODS: { value: RootPeriod; label: string; min: number }[] = [
  { value: '', label: 'approval_dialog.period.each', min: 0 },
  { value: '2m', label: 'approval_dialog.period.2m', min: 2 },
  { value: '5m', label: 'approval_dialog.period.5m', min: 5 },
  { value: '15m', label: 'approval_dialog.period.15m', min: 15 },
];

/** 25e5's warning, shown every time a period is picked (D-117 (2)). */
export function rootPeriodWarning(label: string, host: string, min: number): string {
  return t('approval_dialog.root_period_warning', { caller: label.replace(/^.*?, started by /, ''), host, min });
}

const DURATIONS: { value: GrantDuration; label: string }[] = [
  { value: '15m', label: 'approval_dialog.duration.15m' },
  { value: '1h', label: 'approval_dialog.duration.1h' },
  { value: '4h', label: 'approval_dialog.duration.4h' },
  { value: 'lock', label: 'approval_dialog.duration.lock' },
];

const TTL_LABELS: Record<string, string> = {
  '15m': 'approval_dialog.ttl.15m', '1h': 'approval_dialog.ttl.1h', '4h': 'approval_dialog.ttl.4h', '1d': 'approval_dialog.ttl.1d',
  '7d': 'approval_dialog.ttl.7d', '30d': 'approval_dialog.ttl.30d', '90d': 'approval_dialog.ttl.90d',
};

const ACTIONS: { value: AccessAction; label: string; hint: string }[] = [
  { value: 'read', label: 'approval_dialog.action.read', hint: 'approval_dialog.action.read_hint' },
  { value: 'exec', label: 'approval_dialog.action.exec', hint: 'approval_dialog.action.exec_hint' },
  { value: 'write', label: 'approval_dialog.action.write', hint: 'approval_dialog.action.write_hint' },
];

export function presenceLabel(m: PresenceMethod): string {
  if (m === 'touchid') return 'Touch ID';
  if (m === 'device') return t('approval_dialog.presence.device');
  if (m === 'polkit') return t('approval_dialog.presence.polkit');
  return t('approval_dialog.presence.password');
}

/** The core's times (deadlines, expiries) are on its own clock: this offset turns
 * them into Date.now() time. Taken when a state arrives. */
export function clockSkew(s: AccessState): number {
  return Date.now() - s.now_ms;
}

/** Keeps the access state in step with the core's events. */
export function useAccessState(active: boolean) {
  const [state, setStateRaw] = useState<AccessState | null>(null);
  const [skew, setSkew] = useState(0);
  const setState = useCallback((s: AccessState) => { setSkew(clockSkew(s)); setStateRaw(s); }, []);
  const refresh = useCallback(() => { api.accessState().then(setState).catch(() => {}); }, [setState]);
  useEffect(() => {
    if (!active) { setStateRaw(null); return; }
    refresh();
    const offs = [on('access:request', refresh), on('access:resolved', refresh), on('access:changed', refresh)];
    // Expired grants leave the list without an event.
    const t = window.setInterval(refresh, 15000);
    return () => { offs.forEach((off) => off()); window.clearInterval(t); };
  }, [active, refresh]);
  return { state, setState, refresh, skew };
}

export function findHost(catalog: Catalog, alias: string) {
  return catalog.hosts.find((h) => h.alias.toLowerCase() === alias.toLowerCase());
}

function groupOf(catalog: Catalog, host: string): string {
  return findHost(catalog, host)?.group ?? '';
}

function hostKnown(catalog: Catalog, host: string): boolean {
  return !!host && !!findHost(catalog, host);
}

function hostsIn(catalog: Catalog, groups: string[]): number {
  return catalog.hosts.filter((h) => groups.some((g) => h.group === g || h.group.startsWith(g + '/'))).length;
}


/** "flint, started by Claude Code": the program in mono, the caller in the info tone. */
export function CallerLabel({ label }: { label: string }) {
  const m = /^(.*?), started by (.*)$/.exec(label);
  if (!m) return <>{label}</>;
  return <>{tr('approval_dialog.span_started_by_span2', { span: <span className="mono">{m[1]}</span>, span2: <span className="info-t">{m[2]}</span> })}</>;
}

/** What kind of request an approval is, for the queue strip. */
/** A path that wraps only after a `/` (design 16f*): never cut mid-name or truncated. */
function SlashPath({ path, data }: { path: string; data: string }) {
  const parts = path.split('/');
  return (
    <span className="cp-path" {...{ [data]: true }}>
      {parts.map((p, i) => <Fragment key={i}>{p}{i < parts.length - 1 && <>/<wbr /></>}</Fragment>)}
    </span>
  );
}

/**
 * Where a copy lands, as far as the window can tell before connecting: a destination
 * ending in `/` is a folder, so the source goes in it under its own name (D-054).
 */
export function copyTarget(dst: string, src: string): string {
  if (!dst.endsWith('/')) return dst;
  const name = src.replace(/\/+$/, '').split('/').pop() ?? '';
  return name && name !== '.' && name !== '..' ? `${dst}${name}${src.endsWith('/') ? '/' : ''}` : dst;
}

/** A host's colour square and alias, for the ends of a copy between two hosts. */
function HostEnd({ catalog, alias }: { catalog: Catalog; alias: string }) {
  const c = colorStyle(findHost(catalog, alias)?.color ?? '');
  return <span className="cp-end"><span className={'fsw ' + c.className} style={c.style} /><span className="mono">{alias}</span></span>;
}

/** The alias, and the host's name on the network when it says something more. */
function HostWho({ catalog, alias }: { catalog: Catalog; alias: string }) {
  const h = findHost(catalog, alias);
  return <span className="who"><span className="mono strong">{alias}</span>{h?.hostname && h.hostname !== alias && <span className="faint">{h.hostname}</span>}</span>;
}

const ARROW = <svg className="cp-arrow" viewBox="0 0 28 14" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M2 7h23M19 2l6 5-6 5" /></svg>;

/**
 * A copy from one host to another (milestone 18, design 16g1-16g2): FROM → via Flint →
 * TO, each end with its host and path, the -r and --force flags as chips, and --force's
 * warning about the destination host.
 */
function RelayBlock({ copy, catalog }: { copy: CopyAsk; catalog: Catalog }) {
  const to = copy.to_host ?? '';
  const dst = copyTarget(copy.to_path ?? '', copy.remote);
  const row = { gridTemplateColumns: '40px 118px minmax(0, 1fr)' };
  return (
    <div className="cp" data-copy-ask data-direction="relay" data-copy-host={copy.host} data-copy-to-host={to} aria-label={t('approval_dialog.copy_between_servers_from_host', { host: copy.host, to })}>
      <div className="cp-dir">
        <span className="grow row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
          <HostEnd catalog={catalog} alias={copy.host} />{ARROW}<span className="hint" style={{ whiteSpace: 'nowrap' }}>{t('approval_dialog.via_flint')}</span>{ARROW}<HostEnd catalog={catalog} alias={to} />
        </span>
        <span className="badge info">{t('approval_dialog.server_to_server')}</span>
      </div>
      <div className="cp-row" style={row}><span className="role" style={{ paddingTop: 3 }}>{t('approval_dialog.from')}</span><HostWho catalog={catalog} alias={copy.host} /><SlashPath path={copy.remote} data="data-copy-from" /></div>
      <div className="cp-row" style={row}><span className="role" style={{ paddingTop: 3 }}>{t('approval_dialog.to')}</span><HostWho catalog={catalog} alias={to} /><SlashPath path={dst} data="data-copy-to" /></div>
      {(copy.recursive || copy.force) && (
        <div className="cp-notes" style={{ flexDirection: 'row', gap: 'var(--sp-2)' }}>
          {copy.recursive && <span className="chip" style={{ fontFamily: 'var(--font-ui)' }} data-copy-recursive><Icon name="folder" size="xs" />{t('approval_dialog.folder_r')}</span>}
          {copy.force && <span className="badge warn"><Icon name="alert" />{t('approval_dialog.overwrite_force')}</span>}
        </div>
      )}
      {copy.force && (
        <div className="cp-force" role="note" data-copy-force><Icon name="alert" size="sm" className="warn-t" />
          <span>{tr('approval_dialog.force_note', { strong: <strong>{t('approval_dialog.replaces_files_that_are_already')}</strong>, flag: <span className="mono">--force</span>, where: <span className="mono">{to}</span> })}</span>
        </div>
      )}
    </div>
  );
}

/**
 * What a relay copy's host chip says about the caller's grants (design 16g3): "" when
 * neither end is reached yet (16g1 shows no tags), else whether this end already is and
 * for how long, or that the new grant adds it. `left` is in seconds, -1 = until locked.
 */
export function relayTag(allowed: boolean, left: number, otherAllowed: boolean): string {
  if (!allowed) return otherAllowed ? t('approval_dialog.relay.new') : '';
  if (left < 0) return t('approval_dialog.relay.until_locked');
  const min = Math.ceil(left / 60);
  if (min < 60) return t('approval_dialog.relay.min_left', { min });
  return min % 60 ? t('approval_dialog.relay.h_min_left', { h: Math.floor(min / 60), min: min % 60 }) : t('approval_dialog.relay.h_left', { h: Math.floor(min / 60) });
}

/** `flint cp`'s transfer block (design 16f1-16f3): direction, both paths, -r and --force. */
function CopyBlock({ copy, catalog }: { copy: CopyAsk; catalog: Catalog }) {
  if (copy.direction === 'relay') return <RelayBlock copy={copy} catalog={catalog} />;
  const up = copy.direction === 'upload';
  const here = <><Icon name="monitor" />{t('approval_dialog.this_computer')}</>;
  const host = <><Icon name="hosts" /><span className="mono">{copy.host}</span></>;
  const src = up ? copy.local : copy.remote;
  const dst = copyTarget(up ? copy.remote : copy.local, src);
  return (
    <div className="cp" data-copy-ask data-direction={copy.direction} data-copy-host={copy.host} aria-label={up ? t('approval_dialog.upload_copy_direction_and_paths') : t('approval_dialog.download_copy_direction_and_paths')}>
      <div className="cp-dir">
        <span className="grow row" style={{ gap: 'var(--sp-2)' }}>
          <span className="cp-end">{up ? here : host}</span>
          <svg className="cp-arrow" viewBox="0 0 28 14" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M2 7h23M19 2l6 5-6 5" /></svg>
          <span className="cp-end">{up ? host : here}</span>
        </span>
        <span className="badge info">{up ? t('approval_dialog.upload') : t('approval_dialog.download')}</span>
      </div>
      <div className="cp-row"><span className="who"><span className="role">{t('approval_dialog.from')}</span>{up ? t('approval_dialog.this_computer') : <span className="mono">{copy.host}</span>}</span><SlashPath path={src} data="data-copy-from" /></div>
      <div className="cp-row"><span className="who"><span className="role">{t('approval_dialog.to')}</span>{up ? <span className="mono">{copy.host}</span> : t('approval_dialog.this_computer')}</span><SlashPath path={dst} data="data-copy-to" /></div>
      {copy.recursive && (
        <div className="cp-notes"><span className="cp-note" data-copy-recursive><Icon name="folder" className="info-t" />{tr('approval_dialog.a_folder_with_everything_in', { span: <span className="mono faint">-r</span> })}</span></div>
      )}
      {copy.force && (
        <div className="cp-force" role="note" data-copy-force><Icon name="alert" size="sm" className="warn-t" />
          <span>{tr('approval_dialog.force_note', { strong: <strong>{t('approval_dialog.replaces_files_that_are_already')}</strong>, flag: <span className="mono">--force</span>, where: up ? <span className="mono">{copy.host}</span> : t('approval_dialog.this_computer_lower') })}</span>
        </div>
      )}
    </div>
  );
}

/**
 * `flint tunnel up|down`'s block (design 16h1, milestone 23): the host it goes through,
 * then this computer's 127.0.0.1 port → the destination as that host sees it. When the
 * port is already taken (16h2) it says so, and by which program when Flint may see it,
 * and the window offers no Allow.
 */
function TunnelBlock({ tunnel, catalog, os }: { tunnel: TunnelAsk; catalog: Catalog; os: string }) {
  const up = tunnel.verb === 'up';
  const listen = `127.0.0.1:${tunnel.local_port}`;
  const h = findHost(catalog, tunnel.host);
  const c = colorStyle(h?.color ?? '');
  const here = os === 'mac' ? t('approval_dialog.this_mac') : t('approval_dialog.this_computer_lower');
  const taken = up && !!tunnel.port_in_use;
  const where = h ? `${h.user ? h.user + '@' : ''}${h.hostname}${h.jump ? ' · via ' + h.jump : ''}` : '';
  return (
    <div className="tn" data-tunnel-ask data-verb={tunnel.verb} data-tunnel-host={tunnel.host} data-tunnel-local={listen} data-tunnel-dest={tunnel.destination} data-port-in-use={taken || undefined}
      aria-label={t(up ? 'approval_dialog.open_tunnel_aria' : 'approval_dialog.stop_tunnel_aria', { name: tunnel.name, listen, destination: tunnel.destination, host: tunnel.host })}>
      <div className="cp-dir">
        <span className="grow row" style={{ gap: 'var(--sp-2)', minWidth: 0 }}>
          <span className="cp-end"><span className={'sp-dot ' + c.className} style={c.style} /><span className="mono">{tunnel.host}</span></span>
          {where && <span className="faint mono trunc" style={{ fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-regular)' }}>{where}</span>}
        </span>
        <span className="badge info"><Icon name="tunnel" />{up ? t('approval_dialog.tunnel') : t('approval_dialog.stop_tunnel')} <span className="mono" data-tunnel-name>{tunnel.name}</span></span>
      </div>
      <div className="tn-ends">
        <div className="tn-end"><span className="where"><Icon name="monitor" />{t('approval_dialog.on_host', { host: here })}{taken && <> · <span className="danger-t">{t('approval_dialog.in_use')}</span></>}</span><span className="addr" style={taken ? { color: 'var(--warning)' } : undefined}>{listen}</span></div>
        {ARROW}
        <div className="tn-end"><span className="where"><Icon name="hosts" />{t('approval_dialog.on_host', { host: tunnel.host })}</span><span className="addr">{tunnel.destination}</span></div>
      </div>
      {up && (
        <div className="cp-notes">
          <span className="cp-note"><Icon name="shield" className="info-t" />{tr('approval_dialog.only_here_can_connect_span', { here, span: <span className="mono">127.0.0.1</span> })}</span>
          <span className="cp-note"><Icon name="tunnel" className="info-t" />{t('approval_dialog.runs_in_its_own_session')}</span>
        </div>
      )}
      {taken && (
        <div className="cp-force" role="alert" data-tunnel-port-in-use style={{ background: 'var(--danger-subtle)', borderTopColor: 'var(--danger-border)' }}>
          <Icon name="alert" size="sm" className="danger-t" />
          {tunnel.port_owner
            ? <span>{tr('approval_dialog.port_in_use_by', { strong: <span className="strong">{t('approval_dialog.port_in_use_on', { port: tunnel.local_port, here })}</span>, owner: <span className="mono" data-port-owner>{tunnel.port_owner}</span>, pid: tunnel.port_owner_pid, cmd: <span className="mono">flint tunnel edit {tunnel.host}:{tunnel.name} --local …</span> })}</span>
            : <span>{tr('approval_dialog.port_in_use', { strong: <span className="strong">{t('approval_dialog.port_in_use_on', { port: tunnel.local_port, here })}.</span>, cmd: <span className="mono">flint tunnel edit {tunnel.host}:{tunnel.name} --local …</span> })}</span>}
        </div>
      )}
    </div>
  );
}

function kindOf(ap: Approval): 'sudo' | 'token' | 'copy' | 'tunnel' | 'grant' {
  return ap.sudo?.host ? 'sudo' : ap.token?.name ? 'token' : ap.copy?.direction ? 'copy' : ap.tunnel?.verb ? 'tunnel' : 'grant';
}

const KIND_LABEL = {
  sudo: 'approval_dialog.kind.sudo', token: 'approval_dialog.kind.token', copy: 'approval_dialog.kind.copy', tunnel: 'approval_dialog.kind.tunnel', grant: 'approval_dialog.kind.grant',
};

export function ApprovalDialog({ ap, queue, presence, periods: periodsOn, catalog, skew, onDone }: {
  ap: Approval;
  /** Milestone 57: *Allow sudo for a while* is on, so a root request offers periods. */
  periods: boolean;
  /** Every request waiting, this one first. */
  queue: Approval[];
  presence: PresenceMethod;
  catalog: Catalog;
  /** Date.now() minus the core's clock, which is not the wall clock. */
  skew: number;
  onDone: (s: AccessState | null) => void;
}) {
  const { os, settings } = useApp();
  const host = ap.need.host;
  // A copy between two hosts runs on both (milestone 18, design 16g): "these two hosts"
  // means both, and "their groups" both groups, offered when each host is in one.
  const host2 = ap.need.host2 && ap.need.host2.toLowerCase() !== host.toLowerCase() ? ap.need.host2 : '';
  const hostsKnown = hostKnown(catalog, host) && (!host2 || hostKnown(catalog, host2));
  const groups = useMemo(() => {
    const g1 = groupOf(catalog, host);
    if (!host2) return g1 ? [g1] : [];
    const g2 = groupOf(catalog, host2);
    return !g1 || !g2 ? [] : g1 === g2 ? [g1] : [g1, g2];
  }, [catalog, host, host2]);
  const initialScope: ScopeKind = ap.need.action === 'write' || !hostsKnown ? 'all' : 'host';
  const [scope, setScope] = useState<ScopeKind>(initialScope);
  const [actions, setActions] = useState<Record<AccessAction, boolean>>({
    read: true, exec: ap.need.action === 'exec', write: ap.need.action === 'write',
  });
  const [duration, setDuration] = useState<GrantDuration>('1h');
  // 26c1: this grant's notice, starting from Settings' default; never changes the default.
  const [notify, setNotify] = useState(settings.notify_grants);
  const [password, setPassword] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
  // 25e4: each command (the default) or a root period on this one host.
  const [period, setPeriod] = useState<RootPeriod>('');
  const [saveSudo, setSaveSudo] = useState(false);
  const [error, setError] = useState('');
  const [wrongPassword, setWrongPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  // Allow is waiting on presence (Touch ID, polkit), not a Deny on its way.
  const [confirming, setConfirming] = useState(false);
  const [showCommand, setShowCommand] = useState(false);
  const [now, setNow] = useState(Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  const left = Math.max(0, Math.round((ap.deadline_ms + skew - now) / 1000));
  const total = Math.max(1, Math.round((ap.deadline_ms - ap.created_ms) / 1000));
  const chain = useMemo(() => ap.chain.map((p) => ({
    pid: p.pid,
    name: (p.argv0.split('/').pop() || p.exe.split('/').pop() || '?').replace(/^-/, ''),
  })).reverse(), [ap.chain]);

  const kind = kindOf(ap);
  const token = kind === 'token' ? ap.token : null;
  const sudo = kind === 'sudo' ? ap.sudo : null;
  const sudoHost = sudo ? findHost(catalog, sudo.host) : undefined;
  const askSudo = !!sudo && !sudo.has_password;
  const copy = kind === 'copy' && ap.copy ? ap.copy : null;
  const tunnel = kind === 'tunnel' && ap.tunnel ? ap.tunnel : null;
  // Design 16g3: which of the two hosts the caller's grant already reaches, and which
  // the new grant adds. A grant that ends while the window waits counts as gone.
  const relayEnds = useMemo(() => {
    if (!copy || copy.direction !== 'relay' || !host2) return [];
    const end = (alias: string, allowed?: boolean, until?: number) => {
      if (!allowed) return { alias, allowed: false, left: 0 };
      if (!until) return { alias, allowed: true, left: -1 };
      const left = Math.round((until + skew - now) / 1000);
      return { alias, allowed: left > 0, left };
    };
    const a = end(host, copy.host_allowed, copy.host_allowed_until);
    const b = end(host2, copy.to_allowed, copy.to_allowed_until);
    return [a, b].map((e, i) => ({ ...e, tag: relayTag(e.allowed, e.left, (i === 0 ? b : a).allowed) }));
  }, [copy, host, host2, skew, now]);

  // The window opens over whatever had the focus: a click, a key in a terminal, or
  // nothing (another app in front). When the window comes back to the front with the
  // focus nowhere, it goes to the field or button it started on.
  useEffect(() => {
    const refocus = () => {
      const el = formRef.current;
      if (!el || (document.activeElement && document.activeElement !== document.body)) return;
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    };
    window.addEventListener('focus', refocus);
    return () => window.removeEventListener('focus', refocus);
  }, []);

  const answer = async (allow: boolean) => {
    setBusy(true);
    setConfirming(allow);
    setError('');
    setWrongPassword(false);
    try {
      const s = await api.accessAnswer({
        id: ap.id, allow, duration, password: allow ? password : '',
        sudo_password: allow ? sudoPassword : '', save_sudo_password: allow && saveSudo && !!sudoPassword,
        notify: allow && notify,
        period: allow && sudo && periodsOn ? period : '',
        scope: scope === 'all' ? { all: true, groups: [], hosts: [] }
          : scope === 'group' ? { all: false, groups, hosts: [] }
          : { all: false, groups: [], hosts: host2 ? [host, host2] : [host] },
        read: actions.read, exec: actions.exec, write: actions.write && scope === 'all',
      });
      setPassword('');
      setSudoPassword('');
      onDone(s);
    } catch (err) {
      const e = toFlintError(err);
      if (e.code === 'not_found') { onDone(null); return; }
      if (e.code === 'wrong_password') { setWrongPassword(true); setError(t('approval_dialog.wrong_master_password')); }
      else setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  };
  const covers = token !== null || sudo !== null || ((actions[ap.need.action as AccessAction]) && (ap.need.action !== 'write' || scope === 'all'));
  const needKey = ACTIONS.find((a) => a.value === ap.need.action)?.label;
  const needLabel = needKey ? t(needKey) : ap.need.action;
  // A tunnel whose port is taken cannot open: nothing to allow (design 16h2).
  const portTaken = !!tunnel && tunnel.verb === 'up' && !!tunnel.port_in_use;
  const canAllow = !busy && !portTaken && !(presence === 'password' && !password);
  // ⌘↵ (Ctrl+↵ on Linux) allows from anywhere in the window; a plain ↵ in a field
  // submits the form, and on Deny presses Deny.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (os === 'mac' ? e.metaKey : e.ctrlKey)) {
      e.preventDefault();
      if (canAllow) answer(true);
    }
  };
  // Deny has the focus unless a password is asked for: then the first field has it.
  const focusOn: 'sudo' | 'master' | 'deny' = askSudo ? 'sudo' : presence === 'password' ? 'master' : 'deny';
  const allowKey = os === 'mac' ? '⌘↵' : 'Ctrl+↵';
  // The presence check this system would offer (Windows Hello is not wired yet).
  const noPresence = os === 'windows' ? t('approval_dialog.no_windows_hello') : t('approval_dialog.no_touch_id_or_polkit');
  const next = queue[1];
  const argCount = sudo?.argv.length ?? 0;
  const more = ap.command ? moreText(ap.request, ap.command.text) : '';
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const periods = !!sudo && periodsOn;
  const periodMin = periods ? ROOT_PERIODS.find((p) => p.value === period)?.min ?? 0 : 0;

  return (
    <Modal label={sudo ? t('approval_dialog.run_a_command_as_root') : t('approval_dialog.allow_access_to_the_vault')} onClose={() => { if (!busy) answer(false); }} width={580} top={46}
      className={sudo ? 'approval root' : 'approval'} scrimCloses={false}>
      <form ref={formRef} data-approval={ap.id} data-kind={kind} onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); if (canAllow) answer(true); }}>
        <div className="modal-h" style={{ alignItems: 'flex-start', paddingBottom: 'var(--sp-3)' }}>
          <span className={sudo ? 'prompt-ic danger' : 'prompt-ic info'}><Icon name={sudo ? 'shield' : 'agent'} /></span>
          <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
            <h2 style={{ lineHeight: 'var(--lh-tight)' }}>
              {(() => {
                const caller = <CallerLabel label={ap.label} />;
                if (sudo) return tr('approval_dialog.heading.sudo', { caller, root: <span className="danger-t">root</span>, host: <span className="mono">{sudo.host}</span> });
                if (token) return tr('approval_dialog.heading.token', { caller });
                if (copy && copy.direction === 'relay') return tr('approval_dialog.heading.relay', { caller });
                if (copy) return tr(copy.direction === 'upload' ? 'approval_dialog.heading.upload' : 'approval_dialog.heading.download', { caller, host: <span className="mono">{copy.host}</span> });
                if (tunnel) return tr(tunnel.verb === 'up' ? 'approval_dialog.heading.tunnel_up' : 'approval_dialog.heading.tunnel_down', { caller, host: <span className="mono">{tunnel.host}</span> });
                return tr('approval_dialog.heading.grant', { caller });
              })()}
            </h2>
            <span className="chain" title={ap.chain.map((p) => `${p.pid} ${p.exe}`).join('\n')}>
              {chain.map((p, i) => (
                <span key={p.pid} className="row" style={{ gap: 2 }}>
                  {i > 0 && <Icon name="chain" />}
                  <span className={p.pid === ap.anchor_pid ? 'node caller' : 'node'}>{p.name}</span>
                </span>
              ))}
              <span style={{ marginLeft: 'var(--sp-2)' }}>pid {ap.chain[0]?.pid ?? '?'}</span>
            </span>
          </div>
          {queue.length > 1 && <span className="queue" data-approval-queue aria-label={t('approval_dialog.queue_waiting_aria', { count: queue.length })}>{tr('approval_dialog.queue_waiting', { first: <b>1</b>, count: queue.length })}</span>}
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)', paddingTop: 'var(--sp-4)' }}>
          {sudo ? (
            <>
              {periodMin === 0 && <div className="callout danger" style={{ alignItems: 'center' }} data-sudo-once><Icon name="alert" /><span>{tr('approval_dialog.strong_nothing_else_is_allowed', { strong: <strong>{t('approval_dialog.runs_as_root_once')}</strong> })}</span></div>}
              <dl className="kv" data-sudo-ask style={{ margin: 0, gridTemplateColumns: '72px minmax(0, 1fr)' }}>
                <dt>{t('approval_dialog.where')}</dt>
                <dd>
                  <span className="mono strong" data-sudo-host>{sudo.host}</span>
                  {sudoHost && <span className="faint"> · {[sudoHost.label, sudoHost.hostname].filter((x) => x && x !== sudo.host).join(' · ')}</span>}
                </dd>
                <dt>{t('approval_dialog.as')}</dt><dd><span className="mono">{sudo.user}</span> <span className="faint">→</span> <span className="mono danger-t strong">root</span> <span className="faint">{t('approval_dialog.sudo')}</span></dd>
              </dl>
              <div className="col" style={{ gap: 6 }}>
                <div className="row">
                  <span className="label grow">{t('approval_dialog.command')}</span>
                  <span className="hint">{tr('approval_dialog.arguments_added_by_flint', { count: argCount, n: fmtNumber(argCount), sudo: <span className="danger-t">sudo --</span> })}</span>
                </div>
                <div className={argCount > 8 ? 'argv scroll' : 'argv'} role="list" aria-label={t('approval_dialog.arguments')} data-sudo-argv>
                  <span className="arg added" role="listitem" title={t('approval_dialog.added_by_flint_sudo_s')}>sudo</span>
                  <span className="arg added" role="listitem" title={t('approval_dialog.added_by_flint_what_follows')}>--</span>
                  {sudo.argv.map((a, i) => <span key={i} className={a.includes('\n') ? 'arg script' : 'arg'} role="listitem" data-arg={i}>{a}</span>)}
                </div>
              </div>
              {periods && (
                <>
                  <div className="row" style={{ gap: 'var(--sp-3)' }}>
                    <span className="label" style={{ width: 72 }}>{t('approval_dialog.allow_for')}</span>
                    <div className="seg" role="radiogroup" aria-label={t('approval_dialog.allow_for')} data-root-periods>
                      {ROOT_PERIODS.map((p) => <button type="button" role="radio" key={p.value || 'each'} data-root-period={p.value || 'each'} aria-checked={period === p.value} aria-pressed={period === p.value} onClick={() => setPeriod(p.value)}>{t(p.label)}</button>)}
                    </div>
                  </div>
                  {periodMin > 0 && (
                    <>
                      <div className="callout danger" role="alert" style={{ fontSize: 'var(--fs-sm)' }} data-root-warning><Icon name="alert" size="sm" /><span><strong>{rootPeriodWarning(ap.label, sudo.host, periodMin)}</strong></span></div>
                      <label className="opt notify-opt is-disabled"><input type="checkbox" checked disabled data-root-notify />
                        <span className="opt-t"><span className="opt-l row" style={{ gap: 6 }}><Icon name="bell" size="sm" />{t('approval_dialog.notify_me_of_each_command')}</span><span className="hint">{t('approval_dialog.always_on_for_root')}</span></span>
                      </label>
                    </>
                  )}
                </>
              )}
              {sudo.has_password ? (
                <div className="row" style={{ gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                  <Icon name="key" /><span className="grow">{tr('approval_dialog.flint_types_the_sudo_password', { span: <span className="mono">{sudo.host}</span> })}</span>
                </div>
              ) : (
                <div className="field">
                  <label className="flabel" htmlFor="approval-sudo-pw">{tr('approval_dialog.sudo_password_for_span_on', { span: <span className="mono strong">{sudo.user}</span>, span2: <span className="mono strong">{sudo.host}</span> })}</label>
                  <div className="input"><input {...plainText} id="approval-sudo-pw" type="password" className="pw" autoComplete="off" value={sudoPassword}
                    onChange={(e) => setSudoPassword(e.target.value)} data-sudo-password {...(focusOn === 'sudo' ? { 'data-autofocus': true } : {})} /></div>
                  <label className="opt"><input type="checkbox" checked={saveSudo} onChange={(e) => setSaveSudo(e.target.checked)} data-sudo-save />
                    <span className="opt-t"><span className="opt-l">{tr('approval_dialog.save_it_for_host', { host: sudo.host })}</span><span className="hint">{periodMin > 0 && !saveSudo
                      ? t('approval_dialog.not_saved_flint_keeps_it', { periodMin }) : t('approval_dialog.kept_in_the_vault_flint')}</span></span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="col" style={{ gap: 6 }}>
                {copy?.direction === 'relay'
                  ? <div className="row"><span className="label grow">{t('approval_dialog.request')}</span><span className="hint row" style={{ gap: 4 }} data-copy-relay><Icon name="shield-ok" size="xs" className="info-t" />{t('approval_dialog.bytes_pass_through_flint_no')}</span></div>
                  : <span className="label">{t('approval_dialog.request')}</span>}
                <div className={more ? 'fp req-summary' : 'fp'} data-approval-request style={{ padding: '6px var(--sp-3)', wordBreak: 'break-all' }}
                  title={more ? t('approval_dialog.summary_open_the_full_command') : undefined}>{ap.request}</div>
                {more && <MoreRow more={more} data="approval" onShow={() => setShowCommand(true)} />}
              </div>
              {copy && <CopyBlock copy={copy} catalog={catalog} />}
              {tunnel && <TunnelBlock tunnel={tunnel} catalog={catalog} os={os} />}
              {token ? (
                <>
                  <dl className="kv" data-token-ask style={{ margin: 0, gridTemplateColumns: '88px minmax(0, 1fr)' }}>
                    <dt>{t('approval_dialog.name')}</dt><dd className="mono" data-token-name>{token.name}</dd>
                    <dt>{t('approval_dialog.allows')}</dt><dd>{token.allows.split(',').map((a) => { const k = ACTIONS.find((x) => x.value === a)?.label; return k ? t(k) : a; }).join(', ')}</dd>
                    <dt>{t('approval_dialog.reaches')}</dt><dd>{token.reaches}</dd>
                    <dt>{t('approval_dialog.expires')}</dt><dd>{t('approval_dialog.expires_in', { ttl: TTL_LABELS[token.ttl] ? t(TTL_LABELS[token.ttl]) : token.ttl })}</dd>
                  </dl>
                  <div className="callout warn"><Icon name="alert" /><span>{t('approval_dialog.whoever_holds_the_token_can')}</span></div>
                </>
              ) : (
                <>
                  <div className="choice-row">
                    <span className="flabel">{t('approval_dialog.hosts')}</span>
                    <div className="opt-list" role="radiogroup" aria-label={t('approval_dialog.hosts')}>
                      {hostsKnown && (
                        <label className="opt"><input type="radio" name="approval-scope" data-scope-host checked={scope === 'host'} onChange={() => setScope('host')} />
                          {host2
                            ? <span className="opt-t"><span className="opt-l" data-scope-hosts>{t('approval_dialog.these_two_hosts')}</span>
                              <span className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
                                {relayEnds.map((e) => (
                                  <Fragment key={e.alias}>
                                    <span className="chip" data-scope-chip={e.alias} data-allowed={e.allowed ? 'yes' : 'no'}>{e.alias}</span>
                                    {e.tag && <span className={e.allowed ? 'badge ok' : 'badge accent'}>{e.tag}</span>}
                                  </Fragment>
                                ))}
                              </span></span>
                            : <span className="opt-t"><span className="opt-l">{tr('approval_dialog.this_host_span', { span: <span className="mono muted">{host}</span> })}</span></span>}</label>
                      )}
                      {groups.length > 0 && (
                        <label className="opt"><input type="radio" name="approval-scope" data-scope-group checked={scope === 'group'} onChange={() => setScope('group')} />
                          <span className="opt-t"><span className="opt-l">{host2 ? (groups.length > 1 ? t('approval_dialog.their_groups') : t('approval_dialog.their_group')) : t('approval_dialog.its_group')} <span className="path muted" title={groups.join(', ')}>{groups.join(', ')}</span></span><span className="hint">{t('approval_dialog.n_hosts', { count: hostsIn(catalog, groups) })}</span></span></label>
                      )}
                      <label className="opt"><input type="radio" name="approval-scope" data-scope-all checked={scope === 'all'} onChange={() => setScope('all')} />
                        <span className="opt-t"><span className="opt-l">{t('approval_dialog.whole_vault')}</span><span className="hint">{t('approval_dialog.n_hosts', { count: catalog.hosts.length })}</span></span></label>
                    </div>
                  </div>
                  <div className="choice-row">
                    <span className="flabel">{t('approval_dialog.actions')}</span>
                    <div className="opt-list">
                      {ACTIONS.map((a) => {
                        const off = a.value === 'write' && scope !== 'all';
                        return (
                          <label key={a.value} className={off ? 'opt is-disabled' : 'opt'}>
                            <input type="checkbox" data-action={a.value} checked={actions[a.value]} disabled={off}
                              onChange={(e) => setActions({ ...actions, [a.value]: e.target.checked })} />
                            <span className="opt-t">
                              <span className="opt-l">{tunnel && a.value === 'exec' ? t('approval_dialog.run_commands_and_open_tunnels') : t(a.label)}{ap.need.action === a.value && <span className="need">{t('approval_dialog.needed')}</span>}</span>
                              <span className="hint">{off ? t('approval_dialog.needs_whole_vault') : tunnel && a.value === 'exec'
                                ? <>{tr('approval_dialog.a_tunnel_needs_this_host', { span: <span className="strong" style={{ color: 'var(--text-primary)' }}>{tr('approval_dialog.the_program_could_also_run', { host: tunnel.host })}</span> })}</>
                                : t(a.hint)}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="choice-row">
                    <span className="flabel">{t('approval_dialog.duration')}</span>
                    <div className="seg" role="radiogroup" aria-label={t('approval_dialog.duration')}>
                      {DURATIONS.map((d) => <button type="button" role="radio" key={d.value} data-duration={d.value} aria-checked={duration === d.value} aria-pressed={duration === d.value} onClick={() => setDuration(d.value)}>{t(d.label)}</button>)}
                    </div>
                  </div>
                  <label className="opt notify-opt"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} data-grant-notify />
                    <span className="opt-t">
                      <span className="opt-l row" style={{ gap: 6 }}><Icon name="bell" size="sm" />{t('approval_dialog.notify_me_of_each_command')}</span>
                      <span className="hint">{t('approval_dialog.a_notice_names_the_program')}</span>
                    </span>
                  </label>
                  {!covers && (
                    <div className="callout warn" role="status"><Icon name="alert" />
                      <span>{tr(ap.need.action === 'write' ? 'approval_dialog.not_covered_write' : 'approval_dialog.not_covered', { cmd: <span className="mono strong">{ap.request.split(' ').slice(0, 2).join(' ')}</span>, need: <span className="strong">{needLabel}</span> })}</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {presence === 'password' && (
            <div className={sudo ? 'field' : 'choice-row'}>
              <label className="flabel" htmlFor="approval-pw">{sudo ? (periodMin > 0 ? t('approval_dialog.master_password_confirms_root_for', { periodMin }) : t('approval_dialog.master_password_confirms_this_one')) : t('approval_dialog.confirm')}</label>
              <div className="field">
                <div className={wrongPassword ? 'input err' : 'input'}>
                  <input {...plainText} id="approval-pw" type="password" className="pw" autoComplete="off" value={password} aria-invalid={wrongPassword || undefined}
                    onChange={(e) => { setPassword(e.target.value); setWrongPassword(false); }} {...(focusOn === 'master' ? { 'data-autofocus': true } : {})} />
                </div>
                {!wrongPassword && <span className="hint">{sudo ? t('approval_dialog.nopresence_here_this_is_the', { noPresence }) : t('approval_dialog.master_password_for_this_vault', { noPresence })}</span>}
                {wrongPassword && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
              </div>
            </div>
          )}
          {error && !wrongPassword && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          <div className="countdown" role="timer" aria-live="off" style={{ width: 190 }}>
            <span className="hint" data-approval-countdown>{tr('approval_dialog.denied_automatically_in_span', { span: <span className="mono strong">{clock}</span> })}</span>
            <div className="progress"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
          </div>
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-approval-deny data-default-focus disabled={busy} onClick={() => answer(false)}
            {...(focusOn === 'deny' ? { 'data-autofocus': true } : {})}>{t('approval_dialog.deny')}<Key>esc</Key></button>
          <button type="submit" className={confirming ? 'btn btn-primary is-active' : 'btn btn-primary'} data-approval-allow disabled={!canAllow} aria-disabled={busy || undefined}
            title={portTaken && tunnel ? t('approval_dialog.the_tunnel_can_t_open', { local_port: tunnel.local_port }) : undefined}>
            {confirming && presence !== 'password'
              ? <>{presence === 'touchid' && <Icon name="fingerprint" />}{t('approval_dialog.confirm_with', { presence: presenceLabel(presence) })}</>
              : <>{sudo ? (periodMin > 0 ? t('approval_dialog.allow_root_for_periodmin_min', { periodMin }) : t('approval_dialog.run_as_root')) : t('approval_dialog.allow')}<span className="kbd-in">{allowKey}</span></>}
          </button>
        </div>
        {next && (
          <div className="row approval-next" data-approval-next>
            <span className="label">{t('approval_dialog.next')}</span>
            <Icon name={kindOf(next) === 'sudo' ? 'shield' : 'agent'} />
            <span className="grow trunc">{t(KIND_LABEL[kindOf(next)])} · {next.label.replace(/^.*?, started by /, '')} · <span className="mono">{next.request}</span></span>
            <span className="hint">{t('approval_dialog.opens_after_this_one')}</span>
          </div>
        )}
      </form>
      {showCommand && <CommandModal title={t('approval_dialog.full_command')} command={ap.command.text} cut={ap.command.cut} onClose={() => setShowCommand(false)}
        footer={<><span className="waiting-tag" data-command-waiting><Icon name="clock" size="xs" />{tr('approval_dialog.approval_still_waiting_clock', { clock })}</span><span className="hint">{t('approval_dialog.esc_returns_to_it')}</span></>} />}
    </Modal>
  );
}
