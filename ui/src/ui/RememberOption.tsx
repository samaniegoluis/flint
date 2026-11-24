// "Remember on this computer" (D-048), on the unlock and create screens: off by
// default, with what it costs said in place (docs/vault-access-model.md).

import type { Os } from '../lib/keymap';
import { t } from '../i18n';
import { tr } from '../i18n/react';

export function RememberOption({ checked, onChange, os, disabled = false }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  os: Os;
  disabled?: boolean;
}) {
  const keychain = os === 'mac' ? t('remember_option.macos_keychain') : t('remember_option.the_keyring');
  return (
    <label className={'opt' + (disabled ? ' is-disabled' : '')} data-remember>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="opt-t">
        <span className="opt-l" style={{ maxWidth: 'none' }}>{t('remember_option.remember_on_this_computer')}</span>
        <span className="hint" style={{ lineHeight: 1.5 }}>{tr('remember_option.the_vault_key_goes_into', { keychain, span: <span className="mono">flint</span> })}</span>
      </span>
    </label>
  );
}
