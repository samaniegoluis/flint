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
import type { AccessAction, AccessState, Approval, Catalog, CopyAsk, GrantDuration, PresenceMethod } from '../api/types';
import { Modal } from '../ui/Modal';
import { Key } from '../ui/Kbd';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { CommandModal, MoreRow, moreText } from './CommandModal';

type ScopeKind = 'host' | 'group' | 'all';

const DURATIONS: { value: GrantDuration; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'lock', label: 'Until locked' },
];

const TTL_LABELS: Record<string, string> = {
  '15m': '15 minutes', '1h': '1 hour', '4h': '4 hours', '1d': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days',
};

const ACTIONS: { value: AccessAction; label: string; hint: string }[] = [
  { value: 'read', label: 'Read', hint: 'List and show hosts, groups, keys and credentials. Never a secret' },
  { value: 'exec', label: 'Run commands', hint: 'exec, connect and host test on the hosts in scope' },
  { value: 'write', label: 'Change the vault', hint: 'Add, edit and remove anything' },
];

export function presenceLabel(m: PresenceMethod): string {
  if (m === 'touchid') return 'Touch ID';
  if (m === 'device') return 'your Mac password';
  if (m === 'polkit') return 'your login password';
  return 'the master password';
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

function hostsIn(catalog: Catalog, group: string): number {
  return catalog.hosts.filter((h) => h.group === group || h.group.startsWith(group + '/')).length;
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/** "flint, started by Claude Code": the program in mono, the caller in the info tone. */
export function CallerLabel({ label }: { label: string }) {
  const m = /^(.*?), started by (.*)$/.exec(label);
  if (!m) return <>{label}</>;
  return <><span className="mono">{m[1]}</span>, started by <span className="info-t">{m[2]}</span></>;
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

/**
 * A copy from one host to another (milestone 18; provisional until design 16g): both
 * ends are hosts, FROM → TO, and --force warns about the destination host.
 */
function RelayBlock({ copy }: { copy: CopyAsk }) {
  const to = copy.to_host ?? '';
  const end = (alias: string) => <><Icon name="hosts" /><span className="mono">{alias}</span></>;
  const dst = copyTarget(copy.to_path ?? '', copy.remote);
  return (
    <div className="cp" data-copy-ask data-direction="relay" data-copy-host={copy.host} data-copy-to-host={to} aria-label="Between two hosts: copy direction and paths">
      <div className="cp-dir">
        <span className="grow row" style={{ gap: 'var(--sp-2)' }}>
          <span className="cp-end">{end(copy.host)}</span>
          <svg className="cp-arrow" viewBox="0 0 28 14" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M2 7h23M19 2l6 5-6 5" /></svg>
          <span className="cp-end">{end(to)}</span>
        </span>
        <span className="badge info">Between hosts</span>
      </div>
      <div className="cp-row"><span className="who"><span className="role">From</span><span className="mono">{copy.host}</span></span><SlashPath path={copy.remote} data="data-copy-from" /></div>
      <div className="cp-row"><span className="who"><span className="role">To</span><span className="mono">{to}</span></span><SlashPath path={dst} data="data-copy-to" /></div>
      <div className="cp-notes"><span className="cp-note" data-copy-relay><Icon name="monitor" className="info-t" />Through this computer: no key or password goes to either host</span></div>
      {copy.recursive && (
        <div className="cp-notes"><span className="cp-note" data-copy-recursive><Icon name="folder" className="info-t" />A folder, with everything in it <span className="mono faint">-r</span></span></div>
      )}
      {copy.force && (
        <div className="cp-force" role="note" data-copy-force><Icon name="alert" size="sm" className="warn-t" />
          <span><strong>Replaces files that are already there.</strong> With <span className="mono">--force</span>, anything with the same name in the destination on <span className="mono">{to}</span> is overwritten without asking.</span>
        </div>
      )}
    </div>
  );
}

/** `flint cp`'s transfer block (design 16f1-16f3): direction, both paths, -r and --force. */
function CopyBlock({ copy }: { copy: CopyAsk }) {
  if (copy.direction === 'relay') return <RelayBlock copy={copy} />;
  const up = copy.direction === 'upload';
  const here = <><Icon name="monitor" />This computer</>;
  const host = <><Icon name="hosts" /><span className="mono">{copy.host}</span></>;
  const src = up ? copy.local : copy.remote;
  const dst = copyTarget(up ? copy.remote : copy.local, src);
  return (
    <div className="cp" data-copy-ask data-direction={copy.direction} data-copy-host={copy.host} aria-label={`${up ? 'Upload' : 'Download'}: copy direction and paths`}>
      <div className="cp-dir">
        <span className="grow row" style={{ gap: 'var(--sp-2)' }}>
          <span className="cp-end">{up ? here : host}</span>
          <svg className="cp-arrow" viewBox="0 0 28 14" aria-hidden="true" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }}><path d="M2 7h23M19 2l6 5-6 5" /></svg>
          <span className="cp-end">{up ? host : here}</span>
        </span>
        <span className="badge info">{up ? 'Upload' : 'Download'}</span>
      </div>
      <div className="cp-row"><span className="who"><span className="role">From</span>{up ? 'This computer' : <span className="mono">{copy.host}</span>}</span><SlashPath path={src} data="data-copy-from" /></div>
      <div className="cp-row"><span className="who"><span className="role">To</span>{up ? <span className="mono">{copy.host}</span> : 'This computer'}</span><SlashPath path={dst} data="data-copy-to" /></div>
      {copy.recursive && (
        <div className="cp-notes"><span className="cp-note" data-copy-recursive><Icon name="folder" className="info-t" />A folder, with everything in it <span className="mono faint">-r</span></span></div>
      )}
      {copy.force && (
        <div className="cp-force" role="note" data-copy-force><Icon name="alert" size="sm" className="warn-t" />
          <span><strong>Replaces files that are already there.</strong> With <span className="mono">--force</span>, anything with the same name in the destination on {up ? <span className="mono">{copy.host}</span> : 'this computer'} is overwritten without asking.</span>
        </div>
      )}
    </div>
  );
}

function kindOf(ap: Approval): 'sudo' | 'token' | 'copy' | 'grant' {
  return ap.sudo?.host ? 'sudo' : ap.token?.name ? 'token' : ap.copy?.direction ? 'copy' : 'grant';
}

const KIND_LABEL = { sudo: 'Run as root', token: 'Token request', copy: 'Copy files', grant: 'Grant request' };

export function ApprovalDialog({ ap, queue, presence, catalog, skew, onDone }: {
  ap: Approval;
  /** Every request waiting, this one first. */
  queue: Approval[];
  presence: PresenceMethod;
  catalog: Catalog;
  /** Date.now() minus the core's clock, which is not the wall clock. */
  skew: number;
  onDone: (s: AccessState | null) => void;
}) {
  const { os } = useApp();
  const host = ap.need.host;
  // A copy between two hosts runs on both (milestone 18): "these hosts" means both, and
  // "its group" only when they share one.
  const host2 = ap.need.host2 && ap.need.host2.toLowerCase() !== host.toLowerCase() ? ap.need.host2 : '';
  const hostsKnown = hostKnown(catalog, host) && (!host2 || hostKnown(catalog, host2));
  const group = !host2 || groupOf(catalog, host2) === groupOf(catalog, host) ? groupOf(catalog, host) : '';
  const initialScope: ScopeKind = ap.need.action === 'write' || !hostsKnown ? 'all' : 'host';
  const [scope, setScope] = useState<ScopeKind>(initialScope);
  const [actions, setActions] = useState<Record<AccessAction, boolean>>({
    read: true, exec: ap.need.action === 'exec', write: ap.need.action === 'write',
  });
  const [duration, setDuration] = useState<GrantDuration>('1h');
  const [password, setPassword] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
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
        scope: scope === 'all' ? { all: true, groups: [], hosts: [] }
          : scope === 'group' ? { all: false, groups: [group], hosts: [] }
          : { all: false, groups: [], hosts: host2 ? [host, host2] : [host] },
        read: actions.read, exec: actions.exec, write: actions.write && scope === 'all',
      });
      setPassword('');
      setSudoPassword('');
      onDone(s);
    } catch (err) {
      const e = toFlintError(err);
      if (e.code === 'not_found') { onDone(null); return; }
      if (e.code === 'wrong_password') { setWrongPassword(true); setError('That is not the master password. Nothing was allowed.'); }
      else setError(e.message);
      setBusy(false);
      setConfirming(false);
    }
  };
  const covers = token !== null || sudo !== null || ((actions[ap.need.action as AccessAction]) && (ap.need.action !== 'write' || scope === 'all'));
  const needLabel = ACTIONS.find((a) => a.value === ap.need.action)?.label ?? ap.need.action;
  const canAllow = !busy && !(presence === 'password' && !password);
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
  const next = queue[1];
  const argCount = sudo?.argv.length ?? 0;
  const more = ap.command ? moreText(ap.request, ap.command.text) : '';
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <Modal label={sudo ? 'Run a command as root' : 'Allow access to the vault'} onClose={() => { if (!busy) answer(false); }} width={580} top={46}
      className={sudo ? 'approval root' : 'approval'} scrimCloses={false}>
      <form ref={formRef} data-approval={ap.id} data-kind={kind} onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); if (canAllow) answer(true); }}>
        <div className="modal-h" style={{ alignItems: 'flex-start', paddingBottom: 'var(--sp-3)' }}>
          <span className={sudo ? 'prompt-ic danger' : 'prompt-ic info'}><Icon name={sudo ? 'shield' : 'agent'} /></span>
          <div className="col grow" style={{ gap: 6, minWidth: 0 }}>
            <h2 style={{ lineHeight: 'var(--lh-tight)' }}>
              <CallerLabel label={ap.label} />
              {sudo ? <> wants to run a command as <span className="danger-t">root</span> on <span className="mono">{sudo.host}</span></>
                : token ? ' wants to create a token'
                : copy && copy.direction === 'relay' ? <> wants to copy files from <span className="mono">{copy.host}</span> to <span className="mono">{copy.to_host}</span></>
                : copy ? <> wants to copy files {copy.direction === 'upload' ? 'to' : 'from'} <span className="mono">{copy.host}</span></>
                : ' wants to use this vault'}
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
          {queue.length > 1 && <span className="queue" data-approval-queue aria-label={`Request 1 of ${queue.length} waiting`}><b>1</b> of {queue.length} waiting</span>}
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-4)', paddingTop: 'var(--sp-4)' }}>
          {sudo ? (
            <>
              <div className="callout danger" style={{ alignItems: 'center' }}><Icon name="alert" /><span><strong>Runs as root, once.</strong> Nothing else is allowed by this.</span></div>
              <dl className="kv" data-sudo-ask style={{ margin: 0, gridTemplateColumns: '72px minmax(0, 1fr)' }}>
                <dt>Where</dt>
                <dd>
                  <span className="mono strong" data-sudo-host>{sudo.host}</span>
                  {sudoHost && <span className="faint"> · {[sudoHost.label, sudoHost.hostname].filter((x) => x && x !== sudo.host).join(' · ')}</span>}
                </dd>
                <dt>As</dt><dd><span className="mono">{sudo.user}</span> <span className="faint">→</span> <span className="mono danger-t strong">root</span> <span className="faint">(sudo)</span></dd>
              </dl>
              <div className="col" style={{ gap: 6 }}>
                <div className="row">
                  <span className="label grow">Command</span>
                  <span className="hint">{plural(argCount, 'argument')} · <span className="danger-t">sudo --</span> added by Flint</span>
                </div>
                <div className={argCount > 8 ? 'argv scroll' : 'argv'} role="list" aria-label="Arguments" data-sudo-argv>
                  <span className="arg added" role="listitem" title="Added by Flint: sudo -S -k -p <prompt> --. Flint types the password; sudo keeps no cached ticket.">sudo</span>
                  <span className="arg added" role="listitem" title="Added by Flint: what follows is the command, never an option of sudo">--</span>
                  {sudo.argv.map((a, i) => <span key={i} className={a.includes('\n') ? 'arg script' : 'arg'} role="listitem" data-arg={i}>{a}</span>)}
                </div>
              </div>
              {sudo.has_password ? (
                <div className="row" style={{ gap: 'var(--sp-2)', fontSize: 'var(--fs-sm)' }}>
                  <Icon name="key" /><span className="grow">Flint types the sudo password it holds for <span className="mono">{sudo.host}</span>, only if sudo asks. The program never sees it.</span>
                </div>
              ) : (
                <div className="field">
                  <label className="flabel" htmlFor="approval-sudo-pw">Sudo password for <span className="mono strong">{sudo.user}</span> on <span className="mono strong">{sudo.host}</span></label>
                  <div className="input"><input id="approval-sudo-pw" type="password" className="pw" autoComplete="off" value={sudoPassword}
                    onChange={(e) => setSudoPassword(e.target.value)} data-sudo-password {...(focusOn === 'sudo' ? { 'data-autofocus': true } : {})} /></div>
                  <label className="opt"><input type="checkbox" checked={saveSudo} onChange={(e) => setSaveSudo(e.target.checked)} data-sudo-save />
                    <span className="opt-t"><span className="opt-l">Save it for {sudo.host}</span><span className="hint">Kept in the vault. Flint types it only when sudo asks.</span></span>
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="col" style={{ gap: 6 }}>
                <span className="label">Request</span>
                <div className={more ? 'fp req-summary' : 'fp'} data-approval-request style={{ padding: '6px var(--sp-3)', wordBreak: 'break-all' }}
                  title={more ? 'Summary — open the full command to read all of it' : undefined}>{ap.request}</div>
                {more && <MoreRow more={more} data="approval" onShow={() => setShowCommand(true)} />}
              </div>
              {copy && <CopyBlock copy={copy} />}
              {token ? (
                <>
                  <dl className="kv" data-token-ask style={{ margin: 0, gridTemplateColumns: '88px minmax(0, 1fr)' }}>
                    <dt>Name</dt><dd className="mono" data-token-name>{token.name}</dd>
                    <dt>Allows</dt><dd>{token.allows.split(',').map((a) => ACTIONS.find((x) => x.value === a)?.label ?? a).join(', ')}</dd>
                    <dt>Reaches</dt><dd>{token.reaches}</dd>
                    <dt>Expires</dt><dd>in {TTL_LABELS[token.ttl] ?? token.ttl}</dd>
                  </dl>
                  <div className="callout warn"><Icon name="alert" /><span>Whoever holds the token can do this without asking, until it expires or you revoke it in Settings → Access.</span></div>
                </>
              ) : (
                <>
                  <div className="choice-row">
                    <span className="flabel">Hosts</span>
                    <div className="opt-list" role="radiogroup" aria-label="Hosts">
                      {hostsKnown && (
                        <label className="opt"><input type="radio" name="approval-scope" data-scope-host checked={scope === 'host'} onChange={() => setScope('host')} />
                          <span className="opt-t">{host2
                            ? <span className="opt-l" data-scope-hosts>Both hosts <span className="mono muted">{host}</span> <span className="muted">and</span> <span className="mono muted">{host2}</span></span>
                            : <span className="opt-l">This host <span className="mono muted">{host}</span></span>}</span></label>
                      )}
                      {group && (
                        <label className="opt"><input type="radio" name="approval-scope" data-scope-group checked={scope === 'group'} onChange={() => setScope('group')} />
                          <span className="opt-t"><span className="opt-l">Its group <span className="path muted" title={group}>{group}</span></span><span className="hint">{plural(hostsIn(catalog, group), 'host')}</span></span></label>
                      )}
                      <label className="opt"><input type="radio" name="approval-scope" data-scope-all checked={scope === 'all'} onChange={() => setScope('all')} />
                        <span className="opt-t"><span className="opt-l">Whole vault</span><span className="hint">{plural(catalog.hosts.length, 'host')}</span></span></label>
                    </div>
                  </div>
                  <div className="choice-row">
                    <span className="flabel">Actions</span>
                    <div className="opt-list">
                      {ACTIONS.map((a) => {
                        const off = a.value === 'write' && scope !== 'all';
                        return (
                          <label key={a.value} className={off ? 'opt is-disabled' : 'opt'}>
                            <input type="checkbox" data-action={a.value} checked={actions[a.value]} disabled={off}
                              onChange={(e) => setActions({ ...actions, [a.value]: e.target.checked })} />
                            <span className="opt-t">
                              <span className="opt-l">{a.label}{ap.need.action === a.value && <span className="need">needed</span>}</span>
                              <span className="hint">{off ? 'Needs Whole vault' : a.hint}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <div className="choice-row">
                    <span className="flabel">Duration</span>
                    <div className="seg" role="radiogroup" aria-label="Duration">
                      {DURATIONS.map((d) => <button type="button" role="radio" key={d.value} data-duration={d.value} aria-checked={duration === d.value} aria-pressed={duration === d.value} onClick={() => setDuration(d.value)}>{d.label}</button>)}
                    </div>
                  </div>
                  {!covers && (
                    <div className="callout warn" role="status"><Icon name="alert" />
                      <span>This doesn't cover the request: <span className="mono strong">{ap.request.split(' ').slice(0, 2).join(' ')}</span> needs <span className="strong">{needLabel}</span>{ap.need.action === 'write' ? ' on the whole vault' : ''}. You can still allow it, but this request will be refused.</span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {presence === 'password' && (
            <div className={sudo ? 'field' : 'choice-row'}>
              <label className="flabel" htmlFor="approval-pw">{sudo ? 'Master password: confirms this one command' : 'Confirm'}</label>
              <div className="field">
                <div className={wrongPassword ? 'input err' : 'input'}>
                  <input id="approval-pw" type="password" className="pw" autoComplete="off" value={password} aria-invalid={wrongPassword || undefined}
                    onChange={(e) => { setPassword(e.target.value); setWrongPassword(false); }} {...(focusOn === 'master' ? { 'data-autofocus': true } : {})} />
                </div>
                {!wrongPassword && <span className="hint">{sudo ? "No Touch ID or polkit agent here. This is the vault's password, not the host's sudo password." : 'Master password for this vault. No Touch ID or polkit agent is available here.'}</span>}
                {wrongPassword && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
              </div>
            </div>
          )}
          {error && !wrongPassword && <span className="hint err row" role="alert" style={{ gap: 6 }}><Icon name="alert" size="xs" />{error}</span>}
        </div>
        <div className="modal-f">
          <div className="countdown" role="timer" aria-live="off" style={{ width: 190 }}>
            <span className="hint" data-approval-countdown>Denied automatically in <span className="mono strong">{clock}</span></span>
            <div className="progress"><i style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
          </div>
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-approval-deny data-default-focus disabled={busy} onClick={() => answer(false)}
            {...(focusOn === 'deny' ? { 'data-autofocus': true } : {})}>Deny<Key>esc</Key></button>
          <button type="submit" className={confirming ? 'btn btn-primary is-active' : 'btn btn-primary'} data-approval-allow disabled={!canAllow} aria-disabled={busy || undefined}>
            {confirming && presence !== 'password'
              ? <>{presence === 'touchid' && <Icon name="fingerprint" />}Confirm with {presenceLabel(presence)}…</>
              : <>{sudo ? 'Run as root' : 'Allow'}<span className="kbd-in">{allowKey}</span></>}
          </button>
        </div>
        {next && (
          <div className="row approval-next" data-approval-next>
            <span className="label">Next</span>
            <Icon name={kindOf(next) === 'sudo' ? 'shield' : 'agent'} />
            <span className="grow trunc">{KIND_LABEL[kindOf(next)]} · {next.label.replace(/^.*?, started by /, '')} · <span className="mono">{next.request}</span></span>
            <span className="hint">opens after this one</span>
          </div>
        )}
      </form>
      {showCommand && <CommandModal title="Full command" command={ap.command.text} cut={ap.command.cut} onClose={() => setShowCommand(false)}
        footer={<><span className="waiting-tag" data-command-waiting><Icon name="clock" size="xs" />Approval still waiting · {clock}</span><span className="hint">Esc returns to it</span></>} />}
    </Modal>
  );
}
