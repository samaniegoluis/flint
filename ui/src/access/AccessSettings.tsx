// Settings → Access (milestone 12): the grants the owner gave `flint` callers, live
// until they expire, the vault locks or the app quits; each can be ended now.
// Milestone 12b adds the vault's tokens (revoke only: `flint token create` makes
// them, approved in the window) and the activity log: what callers were allowed to
// run or refused, newest first. Reads are not logged. From milestone 39 the log is
// this computer's, in a file of its own beside the vault, never synced; it can be
// backed up as it is (still encrypted).

import { useCallback, useEffect, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { ActivityEntry, GrantView, RetentionDays, TokenView } from '../api/types';
import type { Confirm } from '../pages/KeysPage';
import { useApp } from '../state/app';
import { resultView } from '../lib/activityResult';
import { CallerLabel, findHost, presenceLabel, useAccessState } from './ApprovalDialog';
import { Icon } from '../ui/Icon';
import { CommandModal, sudoArgv } from './CommandModal';

type Scoped = { all: boolean; groups: string[]; hosts: string[]; read: boolean; exec: boolean; write: boolean };


/** Settings → Access → Approval wait (milestone 61, D-134 (2)), in minutes. */
const APPROVAL_WAITS = [2, 5, 10, 30];
function ScopeChips({ s }: { s: Scoped }) {
  if (s.all) return <span className="chip">Whole vault</span>;
  const items = [...s.groups.map((p) => ({ key: 'g:' + p, text: p, title: `Group ${p}, its subgroups included` })), ...s.hosts.map((h) => ({ key: 'h:' + h, text: h, title: h }))];
  if (items.length === 0) return <span className="faint">Nothing (deleted)</span>;
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {items.map((i) => <span key={i.key} className="chip" title={i.title} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.text}</span>)}
    </div>
  );
}

function ActionBadges({ s }: { s: Scoped }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      {s.read && <span className="badge">Read</span>}
      {s.exec && <span className="badge accent">Run</span>}
      {s.write && <span className="badge warn">Change</span>}
    </div>
  );
}

/** "Claude Code" out of "flint, started by Claude Code". */
function callerName(label: string): string {
  return label.replace(/^.*?, started by /, '');
}

export function expiresText(g: GrantView, now: number, skew: number): string {
  if (g.expires_ms === 0) return 'until the vault locks';
  // A root period lasts minutes: its time left to the second (m:ss).
  if (g.root) return `${clockLeft(g.expires_ms + skew - now)} left`;
  const min = Math.max(0, Math.round((g.expires_ms + skew - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
}

/** "3:41" for 221 s, never below 0:00. */
export function clockLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "12 Nov, 14:05" in the viewer's time zone, from Unix seconds. */
export function whenText(secs: number): string {
  const d = new Date(secs * 1000);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "13:41" for today, "7 Nov" before: the activity log's When column. */
export function shortWhen(secs: number, now = new Date()): string {
  const d = new Date(secs * 1000);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "in 28 days", "in 5 h", "in 12 min", from Unix seconds. */
export function inText(secs: number, nowSecs: number): string {
  const d = Math.max(0, secs - nowSecs);
  if (d >= 2 * 86400) return `in ${Math.floor(d / 86400)} days`;
  if (d >= 3600) return `in ${Math.floor(d / 3600)} h`;
  return `in ${Math.max(1, Math.floor(d / 60))} min`;
}

function tokenUntil(t: TokenView, nowSecs: number): string {
  if (t.status === 'revoked') return `revoked ${whenText(t.revoked_at)}`;
  if (t.status === 'expired') return `expired ${whenText(t.expires_at)}`;
  return inText(t.expires_at, nowSecs);
}

const OUTCOME: Record<ActivityEntry['outcome'], { text: string; tone: string }> = {
  allowed: { text: 'Allowed', tone: 'ok' }, denied: { text: 'Denied', tone: 'danger' }, timeout: { text: 'Timed out', tone: 'danger' },
};
const VIA: Record<ActivityEntry['via'], string> = { grant: 'via a grant', token: 'via token', window: 'asked you' };
const PAGE = 200;

function TokensSection({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { notify } = useApp();
  const [tokens, setTokens] = useState<TokenView[]>([]);
  const [showEnded, setShowEnded] = useState(false);
  const refresh = useCallback(() => { api.tokensList().then((s) => setTokens(s.tokens)).catch(() => {}); }, []);
  useEffect(() => {
    refresh();
    const off = on('access:changed', refresh);
    return () => off();
  }, [refresh]);
  const revoke = (t: TokenView) => onConfirm({
    title: `Revoke the token ${t.name}?`,
    body: 'A program that uses it is refused from now on. This cannot be undone; create a new token instead.',
    action: 'Revoke token',
    run: async () => { const s = await api.tokenRevoke(t.id); setTokens(s.tokens); notify(`Revoked ${t.name}`); },
  });
  const live = tokens.filter((t) => t.status === 'active');
  const ended = tokens.filter((t) => t.status !== 'active');
  const shown = showEnded ? [...live, ...ended] : live;
  const nowSecs = Date.now() / 1000;
  return (
    <section data-tokens>
      <div className="section-h">
        <h2>Tokens</h2>{live.length > 0 && <span className="badge">{live.length}</span>}<span className="grow" />
        {ended.length > 0 && (
          <button className="btn btn-ghost btn-sm" data-tokens-ended onClick={() => setShowEnded(!showEnded)}>
            {showEnded ? 'Hide ended' : `Show ended (${ended.length})`}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-2)', maxWidth: 680, lineHeight: 1.55 }}>
        For programs Flint cannot ask: cron, launchd, a CI runner. Create one with <span className="mono">flint token create</span>;
        the program passes it in <span className="mono">FLINT_TOKEN</span>. Kept in the vault, as a hash.
      </p>
      {shown.length === 0 ? (
        <div className="panel muted" data-no-tokens style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>No tokens.</div>
      ) : (
        <table className="table compact">
          <thead><tr><th>Name</th><th>Hosts</th><th>Actions</th><th>Expires</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} data-token={t.name} data-token-status={t.status} style={{ opacity: t.status === 'active' ? 1 : 0.6 }}>
                <td className="primary mono" title={t.id}>{t.name}</td>
                <td><ScopeChips s={t} /></td>
                <td><ActionBadges s={t} /></td>
                <td title={`until ${whenText(t.expires_at)}`}>{tokenUntil(t, nowSecs)}</td>
                <td style={{ textAlign: 'right' }}>{t.status === 'active' && <button className="btn btn-secondary btn-sm" data-token-revoke onClick={() => revoke(t)}>Revoke</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const RETENTION: { days: RetentionDays; label: string }[] = [
  { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '1 year' }, { days: 0, label: 'No limit' },
];

/** "2026-11-08 07:12:41" and "UTC−6": an entry's exact local time, with seconds and offset. */
export function exactWhen(secs: number): { time: string; offset: string } {
  const d = new Date(secs * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const off = -d.getTimezoneOffset();
  const h = Math.floor(Math.abs(off) / 60), m = Math.abs(off) % 60;
  const offset = off === 0 ? 'UTC' : `UTC${off < 0 ? '−' : '+'}${h}${m ? ':' + p(m) : ''}`;
  return { time, offset };
}

function ActivityDetail({ e, onClose }: { e: ActivityEntry; onClose: () => void }) {
  const { catalog } = useApp();
  const root = e.action === 'sudo';
  const host = e.host ? findHost(catalog, e.host) : undefined;
  // The login user as the core picks it (auth_user): the host's, else its credential's.
  const user = host?.user || catalog.credentials.find((c) => c.name === host?.credential)?.user || '';
  const when = exactWhen(e.at);
  // Milestone 56: how the command ended, when the log knows (entries from before say nothing).
  const ended = resultView(e);
  const details = (
    <dl className="kv" data-activity-detail style={{ margin: 0, gridTemplateColumns: '88px minmax(0, 1fr)' }}>
      <dt>When</dt><dd data-activity-when><span className="mono">{when.time}</span> <span className="faint">{when.offset}</span></dd>
      <dt>Caller</dt><dd style={{ wordBreak: 'break-word' }}><CallerLabel label={e.caller} /></dd>
      <dt>Allowed</dt><dd>{VIA[e.via]}{e.token ? <> <span className="mono">{e.token}</span></> : ''}</dd>
      {e.host && <><dt>Host</dt><dd><span className="mono">{e.host}</span>{root
        ? <span className="faint"> · {user ? `${user} → ` : ''}root (sudo)</span>
        : host?.group ? <span className="faint"> · {host.group}</span> : null}</dd></>}
      <dt>Action</dt><dd><span className="mono">{root ? 'exec' : e.action}</span>{root && <> <span className="root-badge">root</span></>}</dd>
      <dt>Result</dt><dd><span className={`badge ${OUTCOME[e.outcome].tone}`}>{OUTCOME[e.outcome].text}</span>
        {ended.badge && <span data-activity-ended> <span className={`badge ${ended.tone}`}>{ended.badge}</span>{ended.meta && <span className="faint"> · {ended.meta}</span>}</span>}</dd>
    </dl>
  );
  return <CommandModal title="Activity entry" icon="clock" root={root} argv={root && e.cut === 0 ? sudoArgv(e.command) : null}
    command={e.command} cut={e.cut} details={details} onClose={onClose} />;
}

function RetentionChoice({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { notify, fail } = useApp();
  const [days, setDays] = useState<RetentionDays | null>(null);
  useEffect(() => { api.activityRetention().then((r) => setDays(r.days)).catch(() => {}); }, []);
  const longer = (a: RetentionDays, b: RetentionDays) => a === 0 || (b !== 0 && a >= b);
  const apply = async (d: RetentionDays) => {
    const r = await api.activityRetentionSet(d);
    setDays(r.days);
    notify(r.removed > 0 ? `Activity kept ${r.label.toLowerCase()} · ${r.removed.toLocaleString()} older entries removed` : `Activity kept ${r.label.toLowerCase()}`);
  };
  const pick = async (d: RetentionDays) => {
    if (days === null || d === days) return;
    try {
      if (longer(d, days)) { await apply(d); return; }
      const p = await api.activityRetentionPreview(d);
      if (p.remove === 0) { await apply(d); return; }
      const label = RETENTION.find((o) => o.days === d)?.label ?? `${d} days`;
      onConfirm({
        title: `Keep activity for ${label.toLowerCase()}?`,
        body: `${p.remove.toLocaleString()} ${p.remove === 1 ? 'entry is' : 'entries are'} older than ${label.toLowerCase()} and will be removed now. This cannot be undone.`,
        action: `Remove ${p.remove.toLocaleString()} ${p.remove === 1 ? 'entry' : 'entries'}`,
        run: () => apply(d),
      });
    } catch (e) { fail(toFlintError(e)); }
  };
  return (
    <div className="row" style={{ gap: 'var(--sp-3)' }}>
      <span className="flabel">Keep</span>
      <div className="seg" role="radiogroup" aria-label="Keep activity for" data-retention>
        {RETENTION.map((o) => (
          <button key={o.days} type="button" role="radio" aria-checked={days === o.days} aria-pressed={days === o.days}
            data-retention-days={o.days} disabled={days === null} onClick={() => pick(o.days)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function ActivityBackup() {
  const { notify, fail } = useApp();
  const backup = async () => {
    try {
      const { path } = await api.dialogSave('Back up activity', 'Flint activity.db');
      if (!path) return;
      await api.activityBackup(path);
      notify('Activity backed up, still encrypted');
    } catch (e) { fail(toFlintError(e)); }
  };
  return <button className="btn btn-ghost btn-sm" data-activity-backup onClick={backup}>Back up activity…</button>;
}

function ActivitySection({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<ActivityEntry | null>(null);
  const refresh = useCallback(() => {
    api.activityLog(0, PAGE).then((p) => { setEntries(p.entries); setMore(p.entries.length === PAGE); }).catch(() => {});
  }, []);
  useEffect(() => {
    refresh();
    const off = on('activity:added', refresh);
    return () => off();
  }, [refresh]);
  const loadMore = () => {
    const last = entries[entries.length - 1];
    if (!last) return;
    api.activityLog(last.id, PAGE).then((p) => { setEntries([...entries, ...p.entries]); setMore(p.entries.length === PAGE); }).catch(() => {});
  };
  return (
    <section data-activity>
      <div className="section-h"><h2>Activity</h2><span className="grow" /><RetentionChoice onConfirm={onConfirm} /></div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-3)', maxWidth: 680, lineHeight: 1.55 }}>
        What programs ran or changed through Flint, and what was refused. Commands run as root are tinted. Open an entry for the whole command.
      </p>
      {entries.length === 0 ? (
        <div className="panel muted" data-no-activity style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>Nothing yet.</div>
      ) : (
        <div className="col" role="list" aria-label="Activity">
          <div className="act-row head" aria-hidden="true"><span>When</span><span>Caller</span><span>Command</span><span>Result</span></div>
          {entries.map((e) => (
            // tabIndex: WebKit on macOS skips buttons on Tab unless keyboard navigation
            // is on in System Settings; an explicit tabindex keeps the rows reachable.
            <button key={e.id} type="button" role="listitem" aria-haspopup="dialog" tabIndex={0} aria-label={`${OUTCOME[e.outcome].text}: ${e.command.slice(0, 80)}`}
              className={e.action === 'sudo' ? 'act-row sudo' : 'act-row'} data-activity-entry={e.outcome} data-activity-via={e.via}
              onClick={() => setOpen(e)} onKeyDown={(k) => { if (k.key === 'Enter') { k.preventDefault(); setOpen(e); } }}>
              <span className="when" title={`${exactWhen(e.at).time} ${exactWhen(e.at).offset}`}>{shortWhen(e.at)}</span>
              <span className="caller row" style={{ gap: 6, alignItems: 'flex-start' }} title={e.caller}>
                <Icon name="agent" size="xs" />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="trunc">{callerName(e.caller)}</span>
                  <span className="faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{VIA[e.via]}{e.token ? ` ${e.token}` : ''}</span>
                </span>
              </span>
              <span className="cmd clamp3">
                {e.action === 'sudo' && <span className="root-badge" data-activity-sudo>root</span>}
                {e.command}
              </span>
              <span><span className={`badge ${OUTCOME[e.outcome].tone}`}>{e.outcome === 'allowed' && <Icon name="check" />}{OUTCOME[e.outcome].text}</span></span>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ paddingTop: 'var(--sp-3)', gap: 'var(--sp-3)' }}>
        <span className="hint grow" data-activity-where>Allowed reads (list, show) are not recorded. Command output and sudo passwords never are. Kept on this computer, encrypted and apart from the vault, so it never syncs; only this window changes how long.</span>
        {more && <button className="btn btn-ghost btn-sm" data-activity-more onClick={loadMore}>Load more</button>}
        <ActivityBackup />
      </div>
      {open && <ActivityDetail e={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function AccessSettings({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { fail, settings, saveSettings } = useApp();
  const { state, setState, skew } = useAccessState(true);
  const [now, setNow] = useState(Date.now());
  const grants = state?.grants ?? [];
  // A root period counts down by the second; grants alone by the half minute.
  const anyRoot = grants.some((g) => g.root);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), anyRoot ? 1000 : 30000); return () => window.clearInterval(t); }, [anyRoot]);
  const revoke = (id: string) => api.accessRevoke(id).then(setState).catch((e) => fail(toFlintError(e)));
  const bell = (g: GrantView) => api.accessNotify(g.id, !g.notify).then(setState).catch((e) => fail(toFlintError(e)));
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>Access</h1>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', maxWidth: 680, lineHeight: 1.55 }}>
        Programs reach this vault through the <span className="mono">flint</span> CLI. Before Flint runs anything for a program, you approve it in
        the approval window. A grant covers the program that started <span className="mono">flint</span> (Claude Code, a terminal app, tmux), is
        limited to some hosts and actions, ends when it expires or the vault locks, and is confirmed with {presenceLabel(state?.presence ?? 'password')}.
      </p>
      <div className="panel row" style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
        <button type="button" className="toggle" role="switch" aria-checked={settings.notify_grants} aria-label="Notify me of commands run under a grant" data-setting="notify_grants"
          onClick={() => saveSettings({ ...settings, notify_grants: !settings.notify_grants }).catch((e) => fail(toFlintError(e)))} />
        <span className="col grow" style={{ gap: 2 }}>
          <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>Notify me of commands run under a grant</span>
          <span className="hint">The default for new grants. A notice names the program and the host, never the command.</span>
        </span>
      </div>
      <div className="section-h">
        <h2>Active grants</h2>{grants.length > 0 && <span className="badge">{grants.length}</span>}<span className="grow" />
        {grants.length > 1 && <button className="btn btn-danger-ghost btn-sm" data-grants-revoke-all onClick={() => revoke('')}>Revoke all</button>}
      </div>
      {grants.length === 0 ? (
        <div className="panel empty" data-no-grants style={{ padding: 'var(--sp-6)' }}>
          <span className="empty-ic"><Icon name="shield-key" /></span>
          <span className="strong">No program may use this vault right now</span>
          <span style={{ fontSize: 'var(--fs-sm)', maxWidth: 480 }}>When a program runs <span className="mono">flint</span>, Flint comes to the front and asks you first. Grants end when they expire or the vault locks.</span>
        </div>
      ) : (
        <table className="table compact">
          <thead><tr><th>Program</th><th>Hosts</th><th>Actions</th><th>Time left</th><th>Anchor</th><th style={{ width: 40 }}><span className="sr-only">Notices</span></th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} data-grant={g.id} data-grant-root={g.root ? 'yes' : undefined}>
                <td className="primary" title={g.label}><div className="row" style={{ gap: 'var(--sp-2)' }}><Icon name={g.root ? 'shield' : 'agent'} />{callerName(g.label)}</div></td>
                <td><ScopeChips s={g} /></td>
                <td>{g.root ? <span className="badge danger">Root</span> : <ActionBadges s={g} />}</td>
                <td className={g.root ? 'mono' : undefined}>{expiresText(g, now, skew)}</td>
                <td className="mono">pid {g.anchor_pid}</td>
                <td>
                  {g.root
                    ? <span className="icon-btn bell on is-disabled" aria-disabled="true" data-grant-bell="root" title="Always on for root" aria-label="Notices always on for root"><Icon name="bell" size="sm" /></span>
                    : <button type="button" className={g.notify ? 'icon-btn bell on' : 'icon-btn bell'} aria-pressed={g.notify} data-grant-bell={g.notify ? 'on' : 'off'}
                      aria-label={g.notify ? 'Notices on — turn off' : 'Notices off — turn on'} title={g.notify ? 'Notices on' : 'Notices off'} onClick={() => bell(g)}>
                      <Icon name={g.notify ? 'bell' : 'bell-off'} size="sm" />
                    </button>}
                </td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-secondary btn-sm" onClick={() => revoke(g.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="section-h"><h2>Approval wait</h2><span className="grow" /></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }} data-approval-wait-panel>
        <div className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          <span className="flabel">Wait</span>
          <div className="seg" role="radiogroup" aria-label="How long Flint waits for you" data-approval-wait>
            {APPROVAL_WAITS.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={settings.approval_wait === m} aria-pressed={settings.approval_wait === m}
                data-approval-wait-min={m} onClick={() => saveSettings({ ...settings, approval_wait: m }).catch((e) => fail(toFlintError(e)))}>{m} min</button>
            ))}
          </div>
        </div>
        <span className="hint">How long a program waits for your answer in an approval window, and for you to unlock the vault when it finds it locked. Then it gets <span className="mono">approval_timeout</span> or <span className="mono">locked</span>.</span>
        {settings.approval_wait >= 30 && (
          <div className="callout warn" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }} data-approval-wait-note>
            <Icon name="alert" size="sm" />
            <span>The program must be able to wait that long: many agent tools stop a command sooner. An agent can run <span className="mono">flint exec</span> in the background and check on it.</span>
          </div>
        )}
      </div>
      <div className="section-h"><h2>Run as root</h2><span className="grow" /></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }} data-sudo-periods>
        <div className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          <button type="button" className="toggle" role="switch" aria-checked={settings.sudo_periods} aria-label="Allow sudo for a while" data-setting="sudo_periods"
            onClick={() => saveSettings({ ...settings, sudo_periods: !settings.sudo_periods }).catch((e) => fail(toFlintError(e)))} />
          <span className="col" style={{ gap: 2 }}>
            <span className="strong">Allow sudo for a while</span>
            <span className="hint">{settings.sudo_periods ? 'On: the root approval window also offers 2, 5 or 15 minutes.' : 'Off: every root command is approved on its own.'}</span>
          </span>
        </div>
        <div className={settings.sudo_periods ? 'callout danger' : 'callout warn'} style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
          <Icon name="alert" size="sm" />
          <span>{settings.sudo_periods
            ? 'For the time picked, the program and everything it starts can run any command as root on that host without asking you. Turning this off ends every period at once.'
            : 'When on, for the time picked in the root approval window, the program and everything it starts can run any command as root on that host without asking you.'}</span>
        </div>
      </div>
      <TokensSection onConfirm={onConfirm} />
      <ActivitySection onConfirm={onConfirm} />
    </>
  );
}
