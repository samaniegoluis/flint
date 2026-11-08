// "Remember on this computer" (D-048), on the unlock and create screens: off by
// default, with what it costs said in place (docs/vault-access-model.md).

import type { Os } from '../lib/keymap';

export function RememberOption({ checked, onChange, os, disabled = false }: {
  checked: boolean;
  onChange: (on: boolean) => void;
  os: Os;
  disabled?: boolean;
}) {
  const keychain = os === 'mac' ? 'macOS Keychain' : 'the keyring';
  return (
    <label className={'opt' + (disabled ? ' is-disabled' : '')} data-remember>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="opt-t">
        <span className="opt-l" style={{ maxWidth: 'none' }}>Remember on this computer</span>
        <span className="hint" style={{ lineHeight: 1.5 }}>
          The vault key goes into {keychain}, so Flint, the <span className="mono">flint</span> CLI and the agents you approve open this vault without the master password. Anyone using this computer while it is unlocked can open Flint too.
        </span>
      </span>
    </label>
  );
}
