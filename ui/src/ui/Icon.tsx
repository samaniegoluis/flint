// Icons come from the design's in-house sprite (docs/design/icons.svg), inlined once
// into the page so <use href="#i-…"> resolves without a network request.
import sprite from '../../../docs/design/icons.svg?raw';

let injected = false;

export function injectSprite() {
  if (injected) return;
  injected = true;
  const holder = document.createElement('div');
  holder.style.display = 'none';
  holder.setAttribute('aria-hidden', 'true');
  holder.innerHTML = sprite;
  document.body.prepend(holder);
}

export type IconName =
  | 'hosts' | 'key' | 'cred' | 'settings' | 'search' | 'plus' | 'chev' | 'chev-r' | 'updown'
  | 'check' | 'lock' | 'unlock' | 'folder' | 'x' | 'reconnect' | 'dup' | 'files' | 'split'
  | 'term' | 'eye' | 'alert' | 'shield' | 'shield-ok' | 'wifi-off' | 'trash' | 'edit' | 'file'
  | 'clip' | 'info' | 'enter' | 'sun' | 'moon' | 'monitor' | 'keyboard' | 'palette' | 'link'
  | 'cloud' | 'jump' | 'sidebar' | 'arrow-r' | 'sparkle' | 'more' | 'reveal'
  | 'fingerprint' | 'agent' | 'chain' | 'shield-key' | 'clock' | 'upload' | 'download' | 'up' | 'target' | 'tunnel'
  | 'ssh' | 'rdp' | 'expand' | 'shrink' | 'plug' | 'pin' | 'monitors';

export function Icon({ name, size, className = '', label }: { name: IconName; size?: 'xs' | 'sm' | 'lg' | 'xl'; className?: string; label?: string }) {
  const cls = ['ic', size ? 'ic-' + size : '', className].filter(Boolean).join(' ');
  return (
    <svg className={cls} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <use href={'#i-' + name} />
    </svg>
  );
}

export function Logo({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <svg className="logo" width={size} height={size} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <use href="#flint-logo" />
    </svg>
  );
}

// A host's type glyph (design 21c): a prompt for SSH, a window for RDP. Neutral, after
// the colour mark. `md` in the palette and menus, `lg` in the editor.
export function HostTypeIcon({ type, size }: { type: string; size?: 'md' | 'lg' }) {
  const t = type === 'rdp' ? 'rdp' : 'ssh';
  return (
    <svg className={['ic', 'htype', t, size].filter(Boolean).join(' ')} role="img" aria-label={t === 'rdp' ? 'RDP host' : 'SSH host'} data-htype={t}>
      <use href={'#i-' + t} />
    </svg>
  );
}
