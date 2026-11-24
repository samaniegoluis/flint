// The host editor's fixed type badge (design 21b1): the type cannot change once the
// host is added.

import type { HostType } from '../api/types';
import { Icon } from '../ui/Icon';
import { t } from '../i18n';


export function TypeBadge({ type }: { type: HostType }) {
  return (
    <span className="type-badge" data-type-badge={type} title={t('type_badge.fixed')} aria-label={type === 'rdp' ? t('type_badge.rdp_host_fixed') : t('type_badge.ssh_host_fixed')}>
      <Icon name={type} />{type === 'rdp' ? t('type_badge.remote_desktop_rdp') : 'SSH'}<Icon name="lock" className="lock" />
    </span>
  );
}
