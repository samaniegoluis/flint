// View (milestone 56, design 26b1): what one grant ran, live, newest first. Each row
// is a command's time, host, the remote command cut to one line, its duration and how
// it ended (running…, exit N, or refused with sudo's reason, struck through); a row
// opens to the exact command and Copy. It keeps filling while open. The notice itself
// never shows a command (D-127 (1)); this modal does, to the person at the screen,
// as the activity log already does.

import { leftText } from '../lib/grantNotices';
import { useCallback, useEffect, useState } from 'react';
import { api, on } from '../api/backend';
import type { ActivityEntry, GrantView } from '../api/types';
import { resultView, rowCommand } from '../lib/activityResult';
import { Icon } from '../ui/Icon';
import { Modal } from '../ui/Modal';
import { useApp } from '../state/app';
import { fmtDate, t } from '../i18n';

function hhmmss(secs: number): string {
  return fmtDate(secs * 1000, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function hhmm(ms: number): string {
  return fmtDate(ms, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "1 hour, approved 13:40 · 38 min left", from the grant as Settings → Access lists it. */
export function grantSpan(g: GrantView, skew: number, now: number): string {
  const at = hhmm(g.created_ms + skew);
  if (!g.expires_ms) return t('grant_activity_modal.span_until_locked', { at });
  const mins = Math.round((g.expires_ms - g.created_ms) / 60000);
  const len = mins === 60 ? t('grant_activity_modal.one_hour') : mins === 240 ? t('grant_activity_modal.four_hours') : t('grant_activity_modal.n_min', { min: mins });
  // A root period lasts minutes: its time left to the second, as its notice shows it.
  if (g.root) return t('grant_activity_modal.span_left', { len, at, left: leftText(g.expires_ms + skew - now) });
  const left = Math.max(0, Math.round((g.expires_ms + skew - now) / 60000));
  return t('grant_activity_modal.span_min_left', { len, at, min: left });
}

function actionsText(g: GrantView): string {
  if (g.root) return t('grant_activity_modal.root');
  return [g.read && t('grant_activity_modal.read'), g.exec && t('grant_activity_modal.run'), g.write && t('grant_activity_modal.change')].filter(Boolean).join(', ');
}

function Row({ e, now }: { e: ActivityEntry; now: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const r = resultView(e, now, e.at * 1000);
  const copy = () => { navigator.clipboard?.writeText(e.command).then(() => setCopied(true)).catch(() => {}); };
  return (
    <div className={open ? 'acc open' : 'acc'} data-grant-row={e.id} data-grant-row-state={e.state}>
      <button type="button" className="acc-h" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Icon name="chev" size="sm" className="acc-chev" />
        <span className="mono faint">{hhmmss(e.at)}</span>
        {e.host && <span className="chip mono">{e.host}</span>}
        <span className={r.refused ? 'mono trunc grow acc-refused' : 'mono trunc grow'}>{rowCommand(e.command)}</span>
        <span className={r.refused ? 'acc-meta warn-t' : 'acc-meta'}>{r.meta}</span>
        {r.badge && <span className={`badge ${r.tone}`} data-grant-row-result>{e.state === 'running' && <span className="mini-spin" aria-hidden="true" />}{r.badge}</span>}
      </button>
      {open && (
        <div className="acc-b">
          <pre className="cmd-block" style={{ maxHeight: 120, margin: 0 }} data-grant-row-command>{e.command}</pre>
          <div className="row" style={{ gap: 'var(--sp-3)' }}>
            <span className="hint grow">{[r.badge, r.meta].filter(Boolean).join(' · ')}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
              <Icon name={copied ? 'check' : 'clip'} size="sm" className={copied ? 'ok-t' : undefined} />{copied ? t('grant_activity_modal.copied') : t('common.copy')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GrantActivityModal({ grant, program, view, skew, onStop, onLog, onClose }: {
  grant: string;
  program: string;
  /** The grant as Settings → Access lists it; null once it has ended. */
  view: GrantView | null;
  skew: number;
  onStop: () => void;
  onLog: () => void;
  onClose: () => void;
}) {
  const { fail } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => {
    api.grantActivity(grant).then((p) => setEntries(p.entries)).catch((e) => fail(e));
  }, [grant, fail]);
  useEffect(() => {
    load();
    const mine = (e: { grant: string }) => { if (e.grant === grant) load(); };
    const offs = [on('activity:added', mine), on('activity:finished', mine)];
    return () => offs.forEach((off) => off());
  }, [grant, load]);
  const running = entries.some((e) => e.state === 'running');
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const title = t('grant_activity_modal.title', { program });
  return (
    <Modal label={title} onClose={onClose} width={760} top={50} layer={2} className="grant-activity">
      <div data-grant-activity={grant} className="col" style={{ minHeight: 0 }}>
        <div className="modal-h">
          <Icon name="agent" className="faint" />
          <div className="col grow" style={{ gap: 2 }}>
            <h2>{title}</h2>
            {view && (
              <span className="hint">{actionsText(view)}{view.hosts.length > 0 && <> · {view.hosts.map((h, i) => <span key={h}>{i > 0 && ', '}<span className="mono">{h}</span></span>)}</>}
                {view.all && t('grant_activity_modal.the_whole_vault')} · {grantSpan(view, skew, now)}</span>
            )}
            {!view && <span className="hint">{t('grant_activity_modal.this_grant_has_ended')}</span>}
          </div>
          <span className="live" role="status" data-grant-activity-count={entries.length}>
            {view && <span className="live-dot" aria-hidden="true" />}{view ? t('grant_activity_modal.live') : ''}{entries.length}{' '}{t('grant_activity_modal.command')}{entries.length === 1 ? '' : 's'}
          </span>
          <button type="button" className="icon-btn" aria-label={t('grant_activity_modal.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-1)', paddingTop: 'var(--sp-3)', minHeight: 0, overflow: 'auto', maxHeight: 460 }}>
          {entries.length > 1 && <div className="hint" style={{ alignSelf: 'center' }}>{t('grant_activity_modal.newest_first')}</div>}
          {entries.map((e) => <Row key={e.id} e={e} now={now} />)}
        </div>
        <div className="modal-f">
          <button type="button" className="link" style={{ fontSize: 'var(--fs-sm)' }} data-grant-activity-log onClick={onLog}>{t('grant_activity_modal.full_log_in_settings_access')}</button>
          <span className="grow" />
          {view && <button type="button" className="btn btn-danger-ghost" data-grant-activity-stop onClick={onStop}>{t('grant_activity_modal.stop_grant')}</button>}
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>{t('common.close')}<span className="kbd-in">esc</span></button>
        </div>
      </div>
    </Modal>
  );
}
