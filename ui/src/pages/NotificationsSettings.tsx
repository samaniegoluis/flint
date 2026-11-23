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

/** Settings → Notifications → Approval wait (milestone 61), in minutes. */
const APPROVAL_WAITS = [2, 5, 10, 30];
/** With alerts on, a shorter wait gets the 27a2 suggestion. */
const ALERT_WAIT_MIN = 5;

export function NotificationsSettings() {
  return (
    <>
      <h1 style={{ fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)' }}>Notifications</h1>
      <ApprovalWait />
      <PhoneAlerts />
    </>
  );
}

function ApprovalWait() {
  const { settings, saveSettings, fail } = useApp();
  return (
    <>
      <div className="section-h" style={{ paddingTop: 'var(--sp-4)' }}><h2>Approval wait</h2></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-3)', alignItems: 'flex-start' }} data-approval-wait-panel>
        <div className="seg" role="radiogroup" aria-label="Approval wait" data-approval-wait>
          {APPROVAL_WAITS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={settings.approval_wait === m} aria-pressed={settings.approval_wait === m}
              data-approval-wait-min={m} onClick={() => saveSettings({ ...settings, approval_wait: m }).catch((e) => fail(toFlintError(e)))}>{m} min</button>
          ))}
        </div>
        <span className="hint" style={{ lineHeight: 1.5, maxWidth: 620 }}>How long a program waits for your answer in an approval window, and for you to unlock the vault when it finds it locked. Then it gets <span className="mono">approval_timeout</span> or <span className="mono">locked</span>.</span>
        {settings.approval_wait >= 30 && (
          <div className="callout warn" style={{ fontSize: 'var(--fs-xs)' }} data-approval-wait-note>
            <Icon name="alert" size="sm" className="warn-t" />
            <span>The program must be able to wait 30 minutes for an answer. An agent can run <span className="mono">flint exec</span> in the background so its own timeout doesn't cut it off first.</span>
          </div>
        )}
      </div>
    </>
  );
}

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
      <div className="section-h"><h2>Phone alerts (ntfy)</h2></div>
      <div className="panel col" style={{ padding: 'var(--sp-4)', gap: 'var(--sp-3)' }} data-phone-alerts>
        <label className="row" style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', alignItems: 'flex-start', cursor: 'pointer' }}>
          <button type="button" className="toggle" role="switch" aria-checked={on_} aria-label="Phone alerts" data-setting="ntfy_on" onClick={toggle} />
          <span className="col" style={{ gap: 2 }}>
            <span className="strong">Alert my phone when an agent is waiting</span>
            <span className="hint">{on_ ? 'On: your phone is told when an agent is waiting.' : 'Off: nothing is sent.'}</span>
          </span>
        </label>
        {on_ ? <AlertsSetup /> : (
          <p className="nt-off-what" data-alerts-off>If you turn this on, an alert only ever says “An agent is waiting for your approval” or “Flint is locked and an agent is waiting”: no host, user, command, program, vault or count. It can't approve anything; you still answer at this computer.</p>
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
          <span className="grow">With alerts, a wait of {ALERT_WAIT_MIN} min or more gives you time to see the alert and come back. It's {settings.approval_wait} min now.</span>
          <button type="button" className="btn btn-secondary btn-sm" data-alerts-use-wait onClick={() => saveSettings({ ...settings, approval_wait: ALERT_WAIT_MIN }).catch((e) => fail(toFlintError(e)))}>Use {ALERT_WAIT_MIN} min</button>
        </div>
      )}
      <div className="nt-div" />
      <div className="nt-grid">
        <span className="nt-k">Server</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className={'input' + (problem ? ' err' : '')} style={{ width: 340, maxWidth: '100%', height: 30 }}>
              <input {...plainText} className="mono" style={{ fontSize: 'var(--fs-sm)' }} value={server} aria-label="ntfy server" aria-invalid={!!problem} data-ntfy-server
                onChange={(e) => setServer(e.target.value.trim())} onBlur={saveServer} onKeyDown={(e) => { if (e.key === 'Enter') saveServer(); }} />
            </div>
            {problem ? <span className="hint err" role="alert" data-ntfy-server-error>{problem}</span>
              : server.startsWith('http://') ? (
                <span className="hint warn-t row" style={{ gap: 6, alignItems: 'flex-start' }} data-ntfy-http>
                  <Icon name="alert" size="sm" /><span>Over http:// the topic travels unencrypted. Anyone who reads it could send alerts to your phone, but never read yours.</span>
                </span>
              ) : <span className="hint">ntfy.sh, or the address of your own ntfy server.</span>}
          </div>
        </div>
        <span className="nt-k">Topic</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <span className="nt-topic mono" data-ntfy-topic>{settings.ntfy_topic}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={copyTopic}><Icon name={copied ? 'check' : 'clip'} size="sm" />{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={confirmTopic} data-ntfy-new-topic onClick={() => setConfirmTopic(true)}><Icon name="reconnect" size="sm" />New topic</button>
            </div>
            {confirmTopic ? (
              <div className="callout warn nt-confirm" role="alertdialog" aria-label="New topic" data-ntfy-new-topic-confirm>
                <Icon name="alert" size="sm" className="warn-t" />
                <span className="grow">Your phone stops getting alerts until you subscribe to the new topic.</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmTopic(false)}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" data-ntfy-new-topic-go onClick={newTopic}>New topic</button>
              </div>
            ) : <span className="hint">Random, and belongs to this computer. It isn't synced with the vault.</span>}
          </div>
        </div>
        <span className="nt-k">Subscribe on your phone</span>
        <div style={{ minWidth: 0 }}>
          <div className="seg" role="radiogroup" aria-label="Your phone" style={{ marginBottom: 'var(--sp-3)' }} data-ntfy-phone>
            {(['iphone', 'android'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={phone === p} aria-pressed={phone === p} data-phone={p}
                onClick={() => { if (phone !== p) saveSettings({ ...settings, ntfy_phone: p }).catch((e) => fail(toFlintError(e))); }}>
                {p === 'iphone' ? 'iPhone' : 'Android'}
              </button>
            ))}
          </div>
          <div className="row nt-sub" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
            {qr ? (
              <div className="nt-qr" data-theme="light" data-ntfy-qr>
                <svg className="nt-qr-code" viewBox={`-2 -2 ${qr.size + 4} ${qr.size + 4}`} width={132} height={132} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${url}`}>
                  <path fill="currentColor" d={qr.path} />
                </svg>
              </div>
            ) : (
              <div className="nt-qr nt-qr-empty" aria-label="No code until the server address is valid"><span className="hint" style={{ textAlign: 'center' }}>Fix the server address to get the code</span></div>
            )}
            <div className="col" style={{ gap: 'var(--sp-2)', minWidth: 0 }}>
              <span className="mono nt-url" data-ntfy-url>{qr ? ntfyTopicUrl(saved, settings.ntfy_topic).replace(/^https?:\/\//, '') : '—'}</span>
              {phone === 'android' ? (
                <ol className="nt-steps" data-ntfy-steps="android">
                  <li>Install <strong>ntfy</strong> from Google Play or F-Droid.</li>
                  <li>Scan the code with the camera: ntfy opens and subscribes to the topic.</li>
                </ol>
              ) : (
                <ol className="nt-steps" data-ntfy-steps="iphone">
                  <li>Install <strong>ntfy</strong> from the App Store.</li>
                  <li>In ntfy, tap <strong>+</strong> and subscribe to the topic above. The code opens the topic's web page, which shows alerts too while it is open.</li>
                </ol>
              )}
            </div>
          </div>
        </div>
        <span className="nt-k">What your phone shows</span>
        <div style={{ minWidth: 0 }}>
          <div className="col" style={{ gap: 'var(--sp-2)' }}>
            <div className="nt-prev" data-ntfy-preview>
              {ALERT_TEXTS.map((a) => (
                <div key={a.text} className="nt-notif">
                  <span className="nt-app" aria-hidden="true"><Icon name="bell" size="sm" /></span>
                  <span className="col grow" style={{ gap: 1, minWidth: 0 }}>
                    <span className="row nt-meta"><span>ntfy</span><span className="faint">· now</span><span className="grow" />
                      {a.high && <span className="badge warn nt-pri"><Icon name="alert" />High priority</span>}</span>
                    <span className="strong">Flint</span>
                    <span className="nt-text">{a.text}</span>
                  </span>
                </div>
              ))}
            </div>
            <span className="hint">That's all an alert ever says. It never approves, denies or unlocks anything: you still answer at this computer.</span>
          </div>
        </div>
        <span className="nt-k" />
        <div style={{ minWidth: 0 }}>
          <div className="row nt-test" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
            <button type="button" className="btn btn-secondary btn-sm" disabled={sending} data-ntfy-test onClick={sendTest}>{!sending && <Icon name="bell" size="sm" />}Send test</button>
            {sending ? (
              <span className="hint row" style={{ gap: 6 }} data-ntfy-status="sending"><span className="mini-spin" aria-hidden="true" />Sending “Test from Flint”…</span>
            ) : line.tone === '' ? (
              <span className="hint" data-ntfy-status="none">{line.text}</span>
            ) : line.tone === 'ok' ? (
              <span className="row nt-status ok-t" role="status" data-ntfy-status="ok"><Icon name="check" size="sm" />{line.text}</span>
            ) : (
              <span className="col" style={{ gap: 2 }} role="status" data-ntfy-status="error">
                <span className="row nt-status danger-t"><Icon name="alert" size="sm" />{line.text}</span>
                <span className="hint">Approvals are unaffected: the window opened and waited as usual.</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
