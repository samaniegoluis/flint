// Settings → Notifications (milestone 63, designs 27a*, D-134 (2)/(4), D-136): the
// approval wait, moved here from Access, and phone alerts through ntfy. An alert carries
// one of two fixed texts and never answers anything (Principle 19); this section is
// where the person sees exactly what would leave the machine.
import { useEffect, useMemo, useState } from 'react';
import { api, on, toFlintError } from '../api/backend';
import type { AlertStatus } from '../api/types';
import { useApp } from '../state/app';
import { Icon } from '../ui/Icon';
import { plainText } from '../ui/plainText';
import { qrCode } from '../lib/qr';
import { alertStatusLine, ntfyQrUrl, ntfyServerProblem, ntfyTopicUrl } from '../lib/alerts';
import { t } from '../i18n';
import { tr } from '../i18n/react';

/** Settings → Notifications → Approval wait (milestone 61), in minutes. */
const APPROVAL_WAITS = [2, 5, 10, 30];
/** With alerts on, a shorter wait gets the 27a2 suggestion. */
const ALERT_WAIT_MIN = 5;

export function NotificationsSettings() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>{t('notifications_settings.notifications')}</h1>
      <ApprovalWait />
      <PhoneAlerts />
    </>
  );
}

function ApprovalWait() {
  const { settings, saveSettings, fail } = useApp();
  return (
    <>
      <div className="section-h" style={{ paddingTop: 'var(--sp-4)' }}><h2>{t('notifications_settings.approval_wait')}</h2></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-3)', alignItems: 'flex-start' }} data-approval-wait-panel>
        <div className="seg" role="radiogroup" aria-label={t('notifications_settings.approval_wait')} data-approval-wait>
          {APPROVAL_WAITS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={settings.approval_wait === m} aria-pressed={settings.approval_wait === m}
              data-approval-wait-min={m} onClick={() => saveSettings({ ...settings, approval_wait: m }).catch((e) => fail(toFlintError(e)))}>{tr('notifications_settings.m_min', { m })}</button>
          ))}
        </div>
        <span className="hint" style={{ lineHeight: 1.5, maxWidth: 620 }}>{tr('notifications_settings.how_long_waits', { timeout: <span className="mono">approval_timeout</span>, locked: <span className="mono">locked</span> })}</span>
        {settings.approval_wait >= 30 && (
          <div className="callout warn" style={{ fontSize: 'var(--fs-xs)' }} data-approval-wait-note>
            <Icon name="alert" size="sm" className="warn-t" />
            <span>{tr('notifications_settings.the_program_must_be_able', { span: <span className="mono">flint exec</span> })}</span>
          </div>
        )}
      </div>
    </>
  );
}

// i18n-ignore: the core sends these English texts to the phone (Principle 19)
const ALERT_TEXTS = [
  { text: 'An agent is waiting for your approval', high: false },
  { text: 'Flint is locked and an agent is waiting', high: true },
];

function PhoneAlerts() {
  const { settings, saveSettings, fail } = useApp();
  const on_ = settings.ntfy_on;
  const toggle = () => saveSettings({ ...settings, ntfy_on: !on_ }).catch((e) => fail(toFlintError(e)));
  return (
    <>
      <div className="section-h"><h2>{t('notifications_settings.phone_alerts_ntfy')}</h2></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-3)' }} data-phone-alerts>
        <label className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', alignItems: 'flex-start', cursor: 'pointer' }}>
          <button type="button" className="toggle" role="switch" aria-checked={on_} aria-label={t('notifications_settings.phone_alerts')} data-setting="ntfy_on" onClick={toggle} />
          <span className="col" style={{ gap: 2 }}>
            <span className="strong">{t('notifications_settings.alert_my_phone_when_an')}</span>
            <span className="hint">{on_ ? t('notifications_settings.on_your_phone_is_told') : t('notifications_settings.off_nothing_is_sent')}</span>
          </span>
        </label>
        {on_ ? <AlertsSetup /> : (
          <p className="nt-off-what" data-alerts-off>{t('notifications_settings.if_you_turn_this_on')}</p>
        )}
      </div>
    </>
  );
}

function AlertsSetup() {
  const { settings, saveSettings, fail } = useApp();
  const [server, setServer] = useState(settings.ntfy_server);
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmTopic, setConfirmTopic] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setServer(settings.ntfy_server); }, [settings.ntfy_server]);
  useEffect(() => {
    api.alertsStatus().then(setStatus).catch(() => {});
    return on<AlertStatus>('alerts:status', (s) => { setStatus(s); setSending(false); });
  }, []);
  const problem = ntfyServerProblem(server);
  const saved = settings.ntfy_server;
  const phone = settings.ntfy_phone === 'android' ? 'android' : 'iphone';
  const url = ntfyQrUrl(phone, saved, settings.ntfy_topic);
  const qr = useMemo(() => (url && !ntfyServerProblem(saved) ? qrCode(url) : null), [url, saved]);
  const saveServer = () => {
    if (problem || server === saved) return;
    saveSettings({ ...settings, ntfy_server: server }).catch((e) => fail(toFlintError(e)));
  };
  const sendTest = () => {
    setSending(true);
    api.alertsTest().catch((e) => { setSending(false); fail(toFlintError(e)); });
  };
  const newTopic = async () => {
    setConfirmTopic(false);
    // The core keeps the topic it made whatever the page sends: saving adopts it here.
    try { const fresh = await api.alertsNewTopic(); await saveSettings({ ...settings, ntfy_topic: fresh.ntfy_topic }); } catch (e) { fail(toFlintError(e)); }
  };
  const copyTopic = () => {
    navigator.clipboard?.writeText(settings.ntfy_topic).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  const line = alertStatusLine(status);
  return (
    <>
      {settings.approval_wait < ALERT_WAIT_MIN && (
        <div className="callout info" style={{ alignItems: 'center' }} data-alerts-wait-tip>
          <Icon name="clock" size="sm" className="info-t" />
          <span className="grow">{tr('notifications_settings.with_alerts_a_wait_of', { ALERT_WAIT_MIN, approval_wait: settings.approval_wait })}</span>
          <button type="button" className="btn btn-secondary btn-sm" data-alerts-use-wait onClick={() => saveSettings({ ...settings, approval_wait: ALERT_WAIT_MIN }).catch((e) => fail(toFlintError(e)))}>{tr('notifications_settings.use_alert_wait_min_min', { ALERT_WAIT_MIN })}</button>
        </div>
      )}
      <div className="nt-div" />
      <div className="nt-grid">
        <span className="nt-k">{t('notifications_settings.server')}</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className={'input' + (problem ? ' err' : '')} style={{ width: 340, maxWidth: '100%', height: 30 }}>
              <input {...plainText} className="mono" style={{ fontSize: 'var(--fs-sm)' }} value={server} aria-label={t('notifications_settings.ntfy_server')} aria-invalid={!!problem} data-ntfy-server
                onChange={(e) => setServer(e.target.value.trim())} onBlur={saveServer} onKeyDown={(e) => { if (e.key === 'Enter') saveServer(); }} />
            </div>
            {problem ? <span className="hint err" role="alert" data-ntfy-server-error>{problem}</span>
              : server.startsWith('http://') ? (
                <span className="hint warn-t row" style={{ gap: 6, alignItems: 'flex-start' }} data-ntfy-http>
                  <Icon name="alert" size="sm" /><span>{t('notifications_settings.over_http_the_topic_travels')}</span>
                </span>
              ) : <span className="hint">{t('notifications_settings.ntfy_sh_or_the_address')}</span>}
          </div>
        </div>
        <span className="nt-k">{t('notifications_settings.topic')}</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <span className="nt-topic mono" data-ntfy-topic>{settings.ntfy_topic}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyTopic}><Icon name={copied ? 'check' : 'clip'} size="sm" />{copied ? t('notifications_settings.copied') : t('common.copy')}</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={confirmTopic} data-ntfy-new-topic onClick={() => setConfirmTopic(true)}><Icon name="reconnect" size="sm" />{t('notifications_settings.new_topic')}</button>
            </div>
            {confirmTopic ? (
              <div className="callout warn nt-confirm" role="alertdialog" aria-label={t('notifications_settings.new_topic')} data-ntfy-new-topic-confirm>
                <Icon name="alert" size="sm" className="warn-t" />
                <span className="grow">{t('notifications_settings.your_phone_stops_getting_alerts')}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmTopic(false)}>{t('common.cancel')}</button>
                <button type="button" className="btn btn-primary btn-sm" data-ntfy-new-topic-go onClick={newTopic}>{t('notifications_settings.new_topic')}</button>
              </div>
            ) : <span className="hint">{t('notifications_settings.random_and_belongs_to_this')}</span>}
          </div>
        </div>
        <span className="nt-k">{t('notifications_settings.subscribe_on_your_phone')}</span>
        <div style={{ minWidth: 0 }}>
          <div className="seg" role="radiogroup" aria-label={t('notifications_settings.your_phone')} style={{ marginBottom: 'var(--sp-3)' }} data-ntfy-phone>
            {(['iphone', 'android'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={phone === p} aria-pressed={phone === p} data-phone={p}
                onClick={() => { if (phone !== p) saveSettings({ ...settings, ntfy_phone: p }).catch((e) => fail(toFlintError(e))); }}>
                {p === 'iphone' ? t('notifications_settings.iphone') : t('notifications_settings.android')}
              </button>
            ))}
          </div>
          <div className="row nt-sub" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
            {qr ? (
              <div className="nt-qr" data-theme="light" data-ntfy-qr>
                <svg className="nt-qr-code" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} width={132} height={132} shapeRendering="crispEdges" role="img" aria-label={t('notifications_settings.qr_code_for_url', { url })}>
                  <path fill="currentColor" d={qr.path} />
                </svg>
              </div>
            ) : (
              <div className="nt-qr nt-qr-empty" aria-label={t('notifications_settings.no_code_until_the_server')}><span className="hint" style={{ textAlign: 'center' }}>{t('notifications_settings.fix_the_server_address_to')}</span></div>
            )}
            <div className="col" style={{ gap: 'var(--sp-2)', minWidth: 0 }}>
              <span className="mono nt-url" data-ntfy-url>{qr ? ntfyTopicUrl(saved, settings.ntfy_topic).replace(/^https?:\/\//, '') : '—'}</span>
              {phone === 'android' ? (
                <ol className="nt-steps" data-ntfy-steps="android">
                  <li>{tr('notifications_settings.install_strong_from_google_play', { strong: <strong>ntfy</strong> })}</li>
                  <li>{t('notifications_settings.scan_the_code_with_the')}</li>
                </ol>
              ) : (
                <ol className="nt-steps" data-ntfy-steps="iphone">
                  <li>{tr('notifications_settings.install_strong_from_the_app', { strong: <strong>ntfy</strong> })}</li>
                  <li>{tr('notifications_settings.in_ntfy_tap_strong_and', { strong: <strong>+</strong> })}</li>
                </ol>
              )}
            </div>
          </div>
        </div>
        <span className="nt-k">{t('notifications_settings.what_your_phone_shows')}</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 'var(--sp-2)' }}>
            <div className="nt-prev" data-ntfy-preview>
              {ALERT_TEXTS.map((a) => (
                <div key={a.text} className="nt-notif">
                  <span className="nt-app" aria-hidden="true"><Icon name="bell" size="sm" /></span>
                  <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span className="row nt-meta"><span>ntfy</span><span className="faint">{t('notifications_settings.now')}</span><span className="grow" />
                      {a.high && <span className="badge warn nt-pri"><Icon name="alert" />{t('notifications_settings.high_priority')}</span>}</span>
                    <span className="strong">Flint</span>
                    <span className="nt-text">{a.text}</span>
                  </span>
                </div>
              ))}
            </div>
            <span className="hint">{t('notifications_settings.that_s_all_an_alert')}</span>
          </div>
        </div>
        <span className="nt-k" />
        <div style={{ minWidth: 0 }}>
          <div className="row nt-test" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={sending} data-ntfy-test onClick={sendTest}>{!sending && <Icon name="bell" size="sm" />}{t('notifications_settings.send_test')}</button>
            {sending ? (
              <span className="hint row" style={{ gap: 6 }} data-ntfy-status="sending"><span className="mini-spin" aria-hidden="true" />{t('notifications_settings.sending_test_from_flint')}</span>
            ) : line.tone === '' ? (
              <span className="hint" data-ntfy-status="none">{line.text}</span>
            ) : line.tone === 'ok' ? (
              <span className="row nt-status ok-t" role="status" data-ntfy-status="ok"><Icon name="check" size="sm" />{line.text}</span>
            ) : (
              <span className="col" style={{ gap: 2 }} role="status" data-ntfy-status="error">
                <span className="row nt-status danger-t"><Icon name="alert" size="sm" />{line.text}</span>
                <span className="hint">{t('notifications_settings.approvals_are_unaffected_the_window')}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
