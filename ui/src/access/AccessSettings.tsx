// Settings → Access (milestone 12): the grants the owner gave `flint` callers, live
// until they expire, the vault locks or the app quits; each can be ended now.
// Milestone 12b adds the vault's tokens (revoke only: `flint token create` makes
// them, approved in the window) and the activity log: what callers were allowed to
// run or refused, newest first. Reads are not logged.

import { useCallback, useEffect, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { ActivityEntry, GrantView, TokenView } from '../api/types';
import type { Confirm } from '../pages/KeysPage';
import { useApp } from '../state/app';
import { presenceLabel, useAccessState } from './ApprovalDialog';
import { Icon } from '../ui/Icon';

type Scoped = { all: boolean; groups: string[]; hosts: string[]; read: boolean; exec: boolean; write: boolean };

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

function expiresText(g: GrantView, now: number, skew: number): string {
  if (g.expires_ms === 0) return 'until the vault locks';
  const min = Math.max(0, Math.round((g.expires_ms + skew - now) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min left` : `${min} min left`;
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

function ActivitySection() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [more, setMore] = useState(false);
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
      <div className="section-h"><h2>Activity</h2><span className="grow" /><span className="hint">Reads aren't logged</span></div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-3)', maxWidth: 680, lineHeight: 1.55 }}>
        What programs ran or changed through Flint, and what was refused. Commands run as root are tinted and always shown in full.
      </p>
      {entries.length === 0 ? (
        <div className="panel muted" data-no-activity style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>Nothing yet.</div>
      ) : (
        <div className="col" role="table" aria-label="Activity">
          <div className="act-row head" role="row"><span>When</span><span>Caller</span><span>Command</span><span>Result</span></div>
          {entries.map((e) => (
            <div key={e.id} role="row" className={e.action === 'sudo' ? 'act-row sudo' : 'act-row'} data-activity-entry={e.outcome} data-activity-via={e.via}>
              <span className="when" title={new Date(e.at * 1000).toLocaleString()}>{shortWhen(e.at)}</span>
              <span className="caller row" style={{ gap: 6, alignItems: 'flex-start' }} title={e.caller}>
                <Icon name="agent" size="xs" />
                <span className="col" style={{ minWidth: 0 }}>
                  <span className="trunc">{callerName(e.caller)}</span>
                  <span className="faint trunc" style={{ fontSize: 'var(--fs-xs)' }}>{VIA[e.via]}{e.token ? ` ${e.token}` : ''}</span>
                </span>
              </span>
              <span className="cmd">
                {e.action === 'sudo' && <span className="root-badge" data-activity-sudo>root</span>}
                {e.command}
              </span>
              <span><span className={`badge ${OUTCOME[e.outcome].tone}`}>{e.outcome === 'allowed' && <Icon name="check" />}{OUTCOME[e.outcome].text}</span></span>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ paddingTop: 'var(--sp-3)', gap: 'var(--sp-3)' }}>
        <span className="hint grow">Allowed reads (list, show) are not recorded. Command output and sudo passwords never are. Kept in the vault, the newest 10,000.</span>
        {more && <button className="btn btn-ghost btn-sm" data-activity-more onClick={loadMore}>Load more</button>}
      </div>
    </section>
  );
}

export function AccessSettings({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { fail } = useApp();
  const { state, setState, skew } = useAccessState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(t); }, []);
  const revoke = (id: string) => api.accessRevoke(id).then(setState).catch((e) => fail(toFlintError(e)));
  const grants = state?.grants ?? [];
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>Access</h1>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', maxWidth: 680, lineHeight: 1.55 }}>
        Programs reach this vault through the <span className="mono">flint</span> CLI. Before Flint runs anything for a program, you approve it in
        the approval window. A grant covers the program that started <span className="mono">flint</span> (Claude Code, a terminal app, tmux), is
        limited to some hosts and actions, ends when it expires or the vault locks, and is confirmed with {presenceLabel(state?.presence ?? 'password')}.
      </p>
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
          <thead><tr><th>Program</th><th>Hosts</th><th>Actions</th><th>Time left</th><th>Anchor</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} data-grant={g.id}>
                <td className="primary" title={g.label}><div className="row" style={{ gap: 'var(--sp-2)' }}><Icon name="agent" />{callerName(g.label)}</div></td>
                <td><ScopeChips s={g} /></td>
                <td><ActionBadges s={g} /></td>
                <td>{expiresText(g, now, skew)}</td>
                <td className="mono">pid {g.anchor_pid}</td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-secondary btn-sm" onClick={() => revoke(g.id)}>Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <TokensSection onConfirm={onConfirm} />
      <ActivitySection />
    </>
  );
}
