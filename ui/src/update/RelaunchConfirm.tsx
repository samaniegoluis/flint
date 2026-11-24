// Relaunch with work open (milestone 53, design 24d1, D-111): what closes, and that
// nothing is applied until the person says so. With nothing open, Relaunch goes
// straight through and this never shows.

import { useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export function RelaunchConfirm({ version, closes, onRelaunch, onCancel }: { version: string; closes: string; onRelaunch: () => void; onCancel: () => void }) {
  useEffect(() => {
    const enter = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onRelaunch(); }
    };
    window.addEventListener('keydown', enter, true);
    return () => window.removeEventListener('keydown', enter, true);
  }, [onRelaunch]);
  return (
    <Modal label={t('relaunch_confirm.relaunch_to_update')} onClose={onCancel} width={420} top={250} className="relaunch">
      <div className="modal-h"><h2 className="grow">{t('relaunch_confirm.relaunch_to_update')}</h2></div>
      <div className="modal-b" data-relaunch-confirm style={{ gap: 'var(--sp-3)', fontSize: 'var(--fs-sm)', lineHeight: 1.5 }}>
        <span>{closes}</span>
        <span className="hint">{tr('relaunch_confirm.flint_version_opens_right_after', { version })}</span>
      </div>
      <div className="modal-f">
        <span className="grow" />
        <button className="btn btn-ghost" onClick={onCancel}>{t('common.cancel')}<span className="kbd">esc</span></button>
        <button className="btn btn-primary" data-autofocus data-relaunch-go onClick={onRelaunch}>{t('relaunch_confirm.relaunch')}<span className="kbd-in">↵</span></button>
      </div>
    </Modal>
  );
}
