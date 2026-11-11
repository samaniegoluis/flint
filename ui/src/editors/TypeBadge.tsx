// The host editor's fixed type badge (design 21b1): the type cannot change once the
// host is added.

import type { HostType } from '../api/types';
import { Icon } from '../ui/Icon';

const FIXED = 'The type is fixed. To change it, remove the host and add it again.';

export function TypeBadge({ type }: { type: HostType }) {
  return (
    <span className="type-badge" data-type-badge={type} title={FIXED} aria-label={`${type === 'rdp' ? 'Remote desktop (RDP)' : 'SSH'} host. ${FIXED}`}>
      <Icon name={type} />{type === 'rdp' ? 'Remote desktop · RDP' : 'SSH'}<Icon name="lock" className="lock" />
    </span>
  );
}
