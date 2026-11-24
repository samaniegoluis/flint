// The whole command a caller ran or asks to run (milestone 15, D-049), one modal for
// the approval window, the unlock screen and the activity log (design 16e2, 16e3). It
// sits on a second scrim over whatever opened it. Viewing it needs no presence check:
// presence protects allowing, not reading. Esc, Close or a click outside close it;
// the focus goes back where it was.

import { useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Icon, type IconName } from '../ui/Icon';
import { fmtNumber, t } from '../i18n';
import { tr } from '../i18n/react';

/** "+1,240 more characters" past a summary of `summary`, or '' when nothing was cut. */
export function moreText(summary: string, whole: string): string {
  if (!summary.endsWith('...') || whole.length <= summary.length) return '';
  const n = whole.length - (summary.length - 3);
  return t('command_modal.more_characters', { count: n, n: fmtNumber(n) });
}

/** "Cut at 16 KB: 3,100 more bytes not kept." */
function cutText(cut: number): string {
  return t('command_modal.cut_at', { count: cut, n: fmtNumber(cut) });
}

/** The argv of a logged `flint exec <host> --sudo -- 'a' 'b'…`, or null when `command`
 *  is not one (or was cut mid-argument). Each argument is single-quoted, `'` as `'\''`. */
export function sudoArgv(command: string): string[] | null {
  const m = /^flint exec \S+ --sudo -- (.*)$/s.exec(command);
  if (!m) return null;
  const out: string[] = [];
  let rest = m[1];
  while (rest.length > 0) {
    const a = /^'((?:[^']|'\\'')*)'(?: |$)/s.exec(rest);
    if (!a) return null;
    out.push(a[1].replaceAll("'\\''", "'"));
    rest = rest.slice(a[0].length);
  }
  return out.length > 0 ? out : null;
}

/** "Show full command" under a summary (16e1a, 16e1b): how much is left, and the button. */
export function MoreRow({ more, onShow, data }: { more: string; onShow: () => void; data: string }) {
  return (
    <div className="more-row">
      <span className="hint grow" {...{ [`data-${data}-more`]: true }}>{more}</span>
      <button type="button" className="btn btn-ghost btn-sm" {...{ [`data-${data}-show-command`]: true }} onClick={onShow}>
        <Icon name="term" size="sm" />{t('command_modal.show_full_command')}
      </button>
    </div>
  );
}

export function CommandModal({ title, command, cut, details, argv, icon = 'term', root = false, footer, onClose }: {
  title: string;
  command: string;
  cut: number;
  /** Rows above the command (the activity entry's time, caller, outcome…). */
  details?: ReactNode;
  /** A sudo command's arguments, shown as chips after Flint's `sudo --` (16e3b). */
  argv?: string[] | null;
  icon?: IconName;
  /** Tinted as a command run as root. */
  root?: boolean;
  /** At the left of the footer: what Esc returns to. */
  footer?: ReactNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => {});
  };
  const chips = argv && argv.length > 0;
  return (
    <Modal label={title} onClose={onClose} width={root ? 640 : 720} top={root ? 120 : details ? 60 : 84} layer={2}
      className={root ? 'command-modal root' : 'command-modal'}>
      <div data-command-modal className="col" style={{ minHeight: 0 }}>
        <div className="modal-h">
          <Icon name={root ? 'shield' : icon} className={root ? 'danger-t' : 'faint'} />
          <h2 className="grow">{title}</h2>
          <button type="button" className="icon-btn" aria-label={t('command_modal.close_esc')} onClick={onClose}><Icon name="x" size="sm" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-3)', minHeight: 0 }}>
          {details}
          <pre className="cmd-block" data-command-full tabIndex={0} aria-label={t('command_modal.command')} style={details ? { maxHeight: 300 } : undefined}>
            {chips ? (
              <>
                <span className="arg added" title={t('command_modal.added_by_flint_sudo_s')}>sudo</span>{' '}
                <span className="arg added" title={t('command_modal.added_by_flint_what_follows')}>--</span>
                {argv.map((a, i) => <span key={i}>{' '}<span className={a.includes('\n') ? 'arg script' : 'arg'}>{a}</span></span>)}
              </>
            ) : command}
            {cut > 0 && <span className="cut">{t('command_modal.cut_here_flint_keeps_the')}</span>}
          </pre>
          <span className="hint" data-command-size>
            {cut > 0 ? <span className="warn-t">{cutText(cut)}</span>
              : chips ? tr('command_modal.arguments_added_by_flint', { count: argv.length, n: fmtNumber(argv.length), sudo: <span className="danger-t">sudo --</span> })
                : t('command_modal.n_characters', { count: command.length, n: fmtNumber(command.length) })}
          </span>
        </div>
        <div className="modal-f">
          {footer}
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-command-copy onClick={copy}>
            <Icon name={copied ? 'check' : 'clip'} size="sm" className={copied ? 'ok-t' : undefined} />{copied ? t('command_modal.copied') : t('common.copy')}
          </button>
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>{t('common.close')}<span className="kbd-in">esc</span></button>
        </div>
      </div>
    </Modal>
  );
}
