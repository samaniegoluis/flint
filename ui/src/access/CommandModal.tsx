// The whole command a caller ran or asks to run (milestone 15, D-049), one modal for
// the approval window, the unlock screen and the activity log. Viewing it needs no
// presence check: presence protects allowing, not reading. Esc, Close or a click
// outside close it; the focus goes back where it was.

import { useState, type ReactNode } from 'react';
import { Modal } from '../ui/Modal';
import { Icon } from '../ui/Icon';

/** "+1,240 more characters" past a summary of `summary`, or '' when nothing was cut. */
export function moreText(summary: string, whole: string): string {
  if (!summary.endsWith('...') || whole.length <= summary.length) return '';
  const n = whole.length - (summary.length - 3);
  return `+${n.toLocaleString()} more character${n === 1 ? '' : 's'}`;
}

/** "Cut at 16 KB: 3,100 more bytes were not kept." */
function cutText(cut: number): string {
  return `Cut at 16 KB: ${cut.toLocaleString()} more byte${cut === 1 ? '' : 's'} not kept.`;
}

export function CommandModal({ title, command, cut, details, onClose }: {
  title: string;
  command: string;
  cut: number;
  /** Rows above the command (the activity entry's time, caller, outcome…). */
  details?: ReactNode;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(command).then(() => setCopied(true)).catch(() => {});
  };
  return (
    <Modal label={title} onClose={onClose} width={640} top={56} className="command-modal">
      <div data-command-modal>
        <div className="modal-h">
          <span className="prompt-ic info"><Icon name="term" /></span>
          <h2 className="grow">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="modal-b" style={{ gap: 'var(--sp-3)' }}>
          {details}
          <pre className="fp command-full" data-command-full tabIndex={0}
            style={{ margin: 0, padding: 'var(--sp-3)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 360, overflow: 'auto', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
            {command}
          </pre>
          <span className="hint" data-command-size>
            {command.length.toLocaleString()} character{command.length === 1 ? '' : 's'}{cut > 0 ? ` · ${cutText(cut)}` : ''}
          </span>
        </div>
        <div className="modal-f">
          <span className="grow" />
          <button type="button" className="btn btn-secondary" data-command-copy onClick={copy}>
            <Icon name={copied ? 'check' : 'clip'} />{copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}
