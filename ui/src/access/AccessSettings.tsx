// Settings → Access (milestone 12): the grants the owner gave `flint` callers, live
// until they expire, the vault locks or the app quits; each can be ended now.
// Milestone 12b adds the vault's tokens (revoke only: `flint token create` makes
// them, approved in the window) and the activity log: what callers were allowed to
// run or refused, newest first. Reads are not logged. From milestone 39 the log is
// this computer's, in a file of its own beside the vault, never synced; it can be
// backed up as it is (still encrypted).

import { useCallback, useEffect, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { ActivityEntry, GrantView, RetentionDays, Settings, TokenView } from '../api/types';
import type { Confirm } from '../pages/KeysPage';
import { useApp } from '../state/app';
import { resultView } from '../lib/activityResult';
import { CallerLabel, findHost, presenceLabel, useAccessState } from './ApprovalDialog';
import { Icon } from '../ui/Icon';
import { CommandModal, sudoArgv } from './CommandModal';
import { fmtDate, fmtNumber, t } from '../i18n';
import { tr } from '../i18n/react';

type Scoped = { all: boolean; groups: string[]; hosts: string[]; read: boolean; exec: boolean; write: boolean };


function ScopeChips({ s }: { s: Scoped }) {
  if (s.all) return <span className="chip">{t('access_settings.whole_vault')}</span>;
  const items = [...s.groups.map((p) => ({ key: 'g:' + p, text: p, title: t('access_settings.group_p_its_subgroups_included', { p }) })), ...s.hosts.map((h) => ({ key: 'h:' + h, text: h, title: h }))];
  if (items.length === 0) return <span className="faint">{t('access_settings.nothing_deleted')}</span>;
  return (
    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      {items.map((i) => <span key={i.key} className="chip" title={i.title} style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.text}</span>)}
    </div>
  );
}

function ActionBadges({ s }: { s: Scoped }) {
  return (
    <div className="row" style={{ gap: 4 }}>
      {s.read && <span className="badge">{t('access_settings.read')}</span>}
      {s.exec && <span className="badge accent">{t('access_settings.run')}</span>}
      {s.write && <span className="badge warn">{t('access_settings.change')}</span>}
    </div>
  );
}

/** "Claude Code" out of "flint, started by Claude Code". */
function callerName(label: string): string {
  return label.replace(/^.*?, started by /, '');
}

export function expiresText(g: GrantView, now: number, skew: number): string {
  if (g.expires_ms === 0) return t('access_settings.until_the_vault_locks');
  // A root period lasts minutes: its time left to the second (m:ss).
  if (g.root) return t('access_settings.clock_left', { clock: clockLeft(g.expires_ms + skew - now) });
  const min = Math.max(0, Math.round((g.expires_ms + skew - now) / 60000));
  return min >= 60 ? t('access_settings.h_min_left', { h: Math.floor(min / 60), min: min % 60 }) : t('access_settings.min_left', { min });
}

/** "3:41" for 221 s, never below 0:00. */
export function clockLeft(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "12 Nov, 14:05" in the viewer's time zone, from Unix seconds. */
export function whenText(secs: number): string {
  const d = new Date(secs * 1000);
  return fmtDate(d, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "13:41" for today, "7 Nov" before: the activity log's When column. */
export function shortWhen(secs: number, now = new Date()): string {
  const d = new Date(secs * 1000);
  if (d.toDateString() === now.toDateString()) return fmtDate(d, { hour: '2-digit', minute: '2-digit' });
  return fmtDate(d, { day: 'numeric', month: 'short' });
}

/** "in 28 days", "in 5 h", "in 12 min", from Unix seconds. */
export function inText(secs: number, nowSecs: number): string {
  const d = Math.max(0, secs - nowSecs);
  if (d >= 2 * 86400) return t('access_settings.in_days', { days: Math.floor(d / 86400) });
  if (d >= 3600) return t('access_settings.in_hours', { h: Math.floor(d / 3600) });
  return t('access_settings.in_min', { min: Math.max(1, Math.floor(d / 60)) });
}

function tokenUntil(tok: TokenView, nowSecs: number): string {
  if (tok.status === 'revoked') return t('access_settings.revoked_when', { when: whenText(tok.revoked_at) });
  if (tok.status === 'expired') return t('access_settings.expired_when', { when: whenText(tok.expires_at) });
  return inText(tok.expires_at, nowSecs);
}

/** Milestone 63: an approval that timed out after a phone alert went out (27d1). */
function missedAfterAlert(e: ActivityEntry): boolean {
  return e.outcome === 'timeout' && !!e.alerted;
}

const OUTCOME: Record<ActivityEntry['outcome'], { text: string; tone: string }> = {
  allowed: { text: 'access_settings.outcome.allowed', tone: 'ok' }, denied: { text: 'access_settings.outcome.denied', tone: 'danger' }, timeout: { text: 'access_settings.outcome.timeout', tone: 'danger' },
};
const VIA: Record<ActivityEntry['via'], string> = { grant: 'access_settings.via.grant', token: 'access_settings.via.token', window: 'access_settings.via.window' };
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
  const revoke = (tok: TokenView) => onConfirm({
    title: t('access_settings.revoke_the_token_name', { name: tok.name }),
    body: t('access_settings.a_program_that_uses_it'),
    action: t('access_settings.revoke_token'),
    run: async () => { const s = await api.tokenRevoke(tok.id); setTokens(s.tokens); notify(t('access_settings.revoked_name', { name: tok.name })); },
  });
  const live = tokens.filter((tok) => tok.status === 'active');
  const ended = tokens.filter((tok) => tok.status !== 'active');
  const shown = showEnded ? [...live, ...ended] : live;
  const nowSecs = Date.now() / 1000;
  return (
    <section data-tokens>
      <div className="section-h">
        <h2>{t('access_settings.tokens')}</h2>{live.length > 0 && <span className="badge">{live.length}</span>}<span className="grow" />
        {ended.length > 0 && (
          <button className="btn btn-ghost btn-sm" data-tokens-ended onClick={() => setShowEnded(!showEnded)}>
            {showEnded ? t('access_settings.hide_ended') : t('access_settings.show_ended_length', { length: ended.length })}
          </button>
        )}
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-2)', maxWidth: 680, lineHeight: 1.55 }}>
        {tr('access_settings.for_programs_flint_cannot_ask', { span: <span className="mono">flint token create</span>, span2: <span className="mono">FLINT_TOKEN</span> })}</p>
      {shown.length === 0 ? (
        <div className="panel muted" data-no-tokens style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>{t('access_settings.no_tokens')}</div>
      ) : (
        <table className="table compact">
          <thead><tr><th>{t('access_settings.name')}</th><th>{t('access_settings.hosts')}</th><th>{t('access_settings.actions')}</th><th>{t('access_settings.expires')}</th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {shown.map((tok) => (
              <tr key={tok.id} data-token={tok.name} data-token-status={tok.status} style={{ opacity: tok.status === 'active' ? 1 : 0.6 }}>
                <td className="primary mono" title={tok.id}>{tok.name}</td>
                <td><ScopeChips s={tok} /></td>
                <td><ActionBadges s={tok} /></td>
                <td title={t('access_settings.until_when', { when: whenText(tok.expires_at) })}>{tokenUntil(tok, nowSecs)}</td>
                <td style={{ textAlign: 'right' }}>{tok.status === 'active' && <button className="btn btn-secondary btn-sm" data-token-revoke onClick={() => revoke(tok)}>{t('access_settings.revoke')}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const RETENTION: { days: RetentionDays; label: string }[] = [
  { days: 30, label: 'access_settings.retention.30' }, { days: 90, label: 'access_settings.retention.90' },
  { days: 365, label: 'access_settings.retention.365' }, { days: 0, label: 'access_settings.retention.0' },
];

/** How long activity is kept, as a sentence says it ("90 days", "no limit"). */
function keptText(days: RetentionDays): string {
  return t(`access_settings.retention_kept.${days}`);
}

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
      <dt>{t('access_settings.when')}</dt><dd data-activity-when><span className="mono">{when.time}</span> <span className="faint">{when.offset}</span></dd>
      <dt>{t('access_settings.caller')}</dt><dd style={{ wordBreak: 'break-word' }}><CallerLabel label={e.caller} /></dd>
      <dt>{t('access_settings.allowed')}</dt><dd>{t(VIA[e.via])}{e.token ? <> <span className="mono">{e.token}</span></> : ''}</dd>
      {e.host && <><dt>{t('access_settings.host')}</dt><dd><span className="mono">{e.host}</span>{root
        ? <span className="faint"> · {user ? `${user} → ` : ''}{t('access_settings.root_sudo')}</span>
        : host?.group ? <span className="faint"> · {host.group}</span> : null}</dd></>}
      <dt>{t('access_settings.action')}</dt><dd><span className="mono">{root ? 'exec' : e.action}</span>{root && <> <span className="root-badge">root</span></>}</dd>
      <dt>{t('access_settings.result')}</dt><dd>{missedAfterAlert(e)
        ? <><span className="badge warn"><Icon name="bell" />{t('access_settings.missed_alerted')}</span> <span className="faint">{t('access_settings.the_program_got_approval_timeout')}</span></>
        : <span className={`badge ${OUTCOME[e.outcome].tone}`}>{t(OUTCOME[e.outcome].text)}</span>}
        {ended.badge && <span data-activity-ended> <span className={`badge ${ended.tone}`}>{ended.badge}</span>{ended.meta && <span className="faint"> · {ended.meta}</span>}</span>}</dd>
    </dl>
  );
  // Milestone 63 (27d2): the alert went out, and nobody answered in time.
  const alerted = missedAfterAlert(e) ? (
    <div className="callout info" style={{ alignItems: 'center' }} data-activity-alerted-note>
      <Icon name="bell" size="sm" className="info-t" />
      <span className="col" style={{ gap: 2 }}>
        <span>{t('access_settings.timed_out_after_an_alert')}</span>
        <span className="hint">{t('access_settings.the_alert_said_an_agent')}</span>
      </span>
    </div>
  ) : null;
  return <CommandModal title={t('access_settings.activity_entry')} icon="clock" root={root} argv={root && e.cut === 0 ? sudoArgv(e.command) : null}
    command={e.command} cut={e.cut} details={alerted ? <>{details}{alerted}</> : details} onClose={onClose} />;
}

function RetentionChoice({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { notify, fail } = useApp();
  const [days, setDays] = useState<RetentionDays | null>(null);
  useEffect(() => { api.activityRetention().then((r) => setDays(r.days)).catch(() => {}); }, []);
  const longer = (a: RetentionDays, b: RetentionDays) => a === 0 || (b !== 0 && a >= b);
  const apply = async (d: RetentionDays) => {
    const r = await api.activityRetentionSet(d);
    setDays(r.days);
    const kept = keptText(r.days);
    notify(r.removed > 0 ? t('access_settings.activity_kept_removed', { kept, count: r.removed, n: fmtNumber(r.removed) }) : t('access_settings.activity_kept', { kept }));
  };
  const pick = async (d: RetentionDays) => {
    if (days === null || d === days) return;
    try {
      if (longer(d, days)) { await apply(d); return; }
      const p = await api.activityRetentionPreview(d);
      if (p.remove === 0) { await apply(d); return; }
      const kept = keptText(d);
      onConfirm({
        title: t('access_settings.keep_activity_for', { kept }),
        body: t('access_settings.entries_older_than', { count: p.remove, n: fmtNumber(p.remove), kept }),
        action: t('access_settings.remove_entries', { count: p.remove, n: fmtNumber(p.remove) }),
        run: () => apply(d),
      });
    } catch (e) { fail(toFlintError(e)); }
  };
  return (
    <div className="row" style={{ gap: 'var(--sp-3)' }}>
      <span className="flabel">{t('access_settings.keep')}</span>
      <div className="seg" role="radiogroup" aria-label={t('access_settings.keep_activity_for')} data-retention>
        {RETENTION.map((o) => (
          <button key={o.days} type="button" role="radio" aria-checked={days === o.days} aria-pressed={days === o.days}
            data-retention-days={o.days} disabled={days === null} onClick={() => pick(o.days)}>{t(o.label)}</button>
        ))}
      </div>
    </div>
  );
}

function ActivityBackup() {
  const { notify, fail } = useApp();
  const backup = async () => {
    try {
      const { path } = await api.dialogSave(t('access_settings.back_up_activity_title'), 'Flint activity.db');
      if (!path) return;
      await api.activityBackup(path);
      notify(t('access_settings.activity_backed_up_still_encrypted'));
    } catch (e) { fail(toFlintError(e)); }
  };
  return <button className="btn btn-ghost btn-sm" data-activity-backup onClick={backup}>{t('access_settings.back_up_activity')}</button>;
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
      <div className="section-h"><h2>{t('access_settings.activity')}</h2><span className="grow" /><RetentionChoice onConfirm={onConfirm} /></div>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', paddingBottom: 'var(--sp-3)', maxWidth: 680, lineHeight: 1.55 }}>
        {t('access_settings.what_programs_ran_or_changed')}
      </p>
      {entries.length === 0 ? (
        <div className="panel muted" data-no-activity style={{ padding: 'var(--sp-4)', fontSize: 'var(--fs-sm)' }}>{t('access_settings.nothing_yet')}</div>
      ) : (
        <div className="col" role="list" aria-label={t('access_settings.activity')}>
          <div className="act-row head" aria-hidden="true"><span>{t('access_settings.when')}</span><span>{t('access_settings.caller')}</span><span>{t('access_settings.command')}</span><span>{t('access_settings.result')}</span></div>
          {entries.map((e) => (
            // tabIndex: WebKit on macOS skips buttons on Tab unless keyboard navigation
            // is on in System Settings; an explicit tabindex keeps the rows reachable.
            <button key={e.id} type="button" role="listitem" aria-haspopup="dialog" tabIndex={0} aria-label={`${t(OUTCOME[e.outcome].text)}: ${e.command.slice(0, 80)}`}
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
              <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}><span className={`badge ${OUTCOME[e.outcome].tone}`}>{e.outcome === 'allowed' && <Icon name="check" />}{t(OUTCOME[e.outcome].text)}</span>
                {missedAfterAlert(e) && <span className="badge warn" data-activity-alerted><Icon name="bell" />{t('access_settings.missed_alerted')}</span>}</span>
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ paddingTop: 'var(--sp-3)', gap: 'var(--sp-3)' }}>
        <span className="hint grow" data-activity-where>{t('access_settings.allowed_reads_list_show_are')}</span>
        {more && <button className="btn btn-ghost btn-sm" data-activity-more onClick={loadMore}>{t('access_settings.load_more')}</button>}
        <ActivityBackup />
      </div>
      {open && <ActivityDetail e={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

// What ✕ does on a desktop with no tray (milestone 65, D-138 (3)): only offered there;
// with a tray the window always hides to it.
const CLOSE_ACTIONS: { id: Settings['close_action']; label: string }[] = [
  { id: '', label: 'access_settings.close.ask' },
  { id: 'background', label: 'access_settings.close.background' },
  { id: 'quit', label: 'access_settings.close.quit' },
];

function CloseWindowRow() {
  const { fail, settings, saveSettings } = useApp();
  const a = settings.close_action;
  return (
    <div className="panel col" style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }} data-close-action-row>
      <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <span className="col grow" style={{ gap: 2 }}>
          <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>{t('access_settings.when_you_close_the_window')}</span>
          <span className="hint">{a === 'quit'
            ? t('access_settings.flint_quits_the_flint_command')
            : a === 'background'
              ? t('access_settings.flint_keeps_serving_the_flint')
              : t('access_settings.flint_asks_the_next_time')}</span>
        </span>
        <div className="seg" role="radiogroup" aria-label={t('access_settings.when_you_close_the_window')} data-close-action>
          {CLOSE_ACTIONS.map((c) => (
            <button key={c.id || 'ask'} type="button" role="radio" aria-checked={a === c.id} aria-pressed={a === c.id} data-close={c.id || 'ask'}
              onClick={() => { if (a !== c.id) saveSettings({ ...settings, close_action: c.id }).catch((e) => fail(toFlintError(e))); }}>
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>
      <span className="hint">{t('access_settings.this_desktop_shows_no_tray')}</span>
    </div>
  );
}

export function AccessSettings({ onConfirm }: { onConfirm: (c: Confirm) => void }) {
  const { fail, settings, saveSettings, info } = useApp();
  // Asked again on each visit: a panel's tray can come or go while Flint runs.
  const [tray, setTray] = useState(info?.tray ?? true);
  useEffect(() => { api.appInfo().then((i) => setTray(i.tray)).catch(() => {}); }, []);
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
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', paddingBottom: 'var(--sp-2)' }}>{t('access_settings.access')}</h1>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', maxWidth: 680, lineHeight: 1.55 }}>
        {tr('access_settings.programs_reach_this_vault_through', { span: <span className="mono">flint</span>, span2: <span className="mono">flint</span>, presenceLabel: presenceLabel(state?.presence ?? 'password') })}</p>
      <div className="panel row" style={{ padding: 'var(--sp-3) var(--sp-4)', gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
        <button type="button" className="toggle" role="switch" aria-checked={settings.notify_grants} aria-label={t('access_settings.notify_me_of_commands_run')} data-setting="notify_grants"
          onClick={() => saveSettings({ ...settings, notify_grants: !settings.notify_grants }).catch((e) => fail(toFlintError(e)))} />
        <span className="col grow" style={{ gap: 2 }}>
          <span className="strong" style={{ fontSize: 'var(--fs-sm)' }}>{t('access_settings.notify_me_of_commands_run')}</span>
          <span className="hint">{t('access_settings.the_default_for_new_grants')}</span>
        </span>
      </div>
      {!tray && <CloseWindowRow />}
      <div className="section-h">
        <h2>{t('access_settings.active_grants')}</h2>{grants.length > 0 && <span className="badge">{grants.length}</span>}<span className="grow" />
        {grants.length > 1 && <button className="btn btn-danger-ghost btn-sm" data-grants-revoke-all onClick={() => revoke('')}>{t('access_settings.revoke_all')}</button>}
      </div>
      {grants.length === 0 ? (
        <div className="panel empty" data-no-grants style={{ padding: 'var(--sp-6)' }}>
          <span className="empty-ic"><Icon name="shield-key" /></span>
          <span className="strong">{t('access_settings.no_program_may_use_this')}</span>
          <span style={{ fontSize: 'var(--fs-sm)', maxWidth: 480 }}>{tr('access_settings.when_a_program_runs_span', { span: <span className="mono">flint</span> })}</span>
        </div>
      ) : (
        <table className="table compact">
          <thead><tr><th>{t('access_settings.program')}</th><th>{t('access_settings.hosts')}</th><th>{t('access_settings.actions')}</th><th>{t('access_settings.time_left')}</th><th>{t('access_settings.anchor')}</th><th style={{ width: 40 }}><span className="sr-only">{t('access_settings.notices')}</span></th><th style={{ width: 80 }} /></tr></thead>
          <tbody>
            {grants.map((g) => (
              <tr key={g.id} data-grant={g.id} data-grant-root={g.root ? 'yes' : undefined}>
                <td className="primary" title={g.label}><div className="row" style={{ gap: 'var(--sp-2)' }}><Icon name={g.root ? 'shield' : 'agent'} />{callerName(g.label)}</div></td>
                <td><ScopeChips s={g} /></td>
                <td>{g.root ? <span className="badge danger">{t('access_settings.root')}</span> : <ActionBadges s={g} />}</td>
                <td className={g.root ? 'mono' : undefined}>{expiresText(g, now, skew)}</td>
                <td className="mono">pid {g.anchor_pid}</td>
                <td>
                  {g.root
                    ? <span className="icon-btn bell on is-disabled" aria-disabled="true" data-grant-bell="root" title={t('access_settings.always_on_for_root')} aria-label={t('access_settings.notices_always_on_for_root')}><Icon name="bell" size="sm" /></span>
                    : <button type="button" className={g.notify ? 'icon-btn bell on' : 'icon-btn bell'} aria-pressed={g.notify} data-grant-bell={g.notify ? 'on' : 'off'}
                      aria-label={g.notify ? t('access_settings.notices_on_turn_off') : t('access_settings.notices_off_turn_on')} title={g.notify ? t('access_settings.notices_on') : t('access_settings.notices_off')} onClick={() => bell(g)}>
                      <Icon name={g.notify ? 'bell' : 'bell-off'} size="sm" />
                    </button>}
                </td>
                <td style={{ textAlign: 'right' }}><button className="btn btn-secondary btn-sm" onClick={() => revoke(g.id)}>{t('access_settings.revoke')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="section-h"><h2>{t('access_settings.run_as_root')}</h2><span className="grow" /></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-2)' }} data-sudo-periods>
        <div className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)' }}>
          <button type="button" className="toggle" role="switch" aria-checked={settings.sudo_periods} aria-label={t('access_settings.allow_sudo_for_a_while')} data-setting="sudo_periods"
            onClick={() => saveSettings({ ...settings, sudo_periods: !settings.sudo_periods }).catch((e) => fail(toFlintError(e)))} />
          <span className="col" style={{ gap: 2 }}>
            <span className="strong">{t('access_settings.allow_sudo_for_a_while')}</span>
            <span className="hint">{settings.sudo_periods ? t('access_settings.on_the_root_approval_window') : t('access_settings.off_every_root_command_is')}</span>
          </span>
        </div>
        <div className={settings.sudo_periods ? 'callout danger' : 'callout warn'} style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-1)' }}>
          <Icon name="alert" size="sm" />
          <span>{settings.sudo_periods
            ? t('access_settings.for_the_time_picked_the')
            : t('access_settings.when_on_for_the_time')}</span>
        </div>
      </div>
      <TokensSection onConfirm={onConfirm} />
      <ActivitySection onConfirm={onConfirm} />
    </>
  );
}
