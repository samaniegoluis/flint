import { describe, expect, it } from 'vitest';
import type { HostView } from '../api/types';
import { buildTree } from './tree';

const host = (alias: string, group = '', extra: Partial<HostView> = {}): HostView => ({
  alias, label: '', hostname: alias + '.lan', port: 22, user: '', group, tags: [], color: '', notes: '',
  jump: '', credential: '', key: '', has_password: false, ...extra,
});

const groups = [
  { path: 'prod', name: 'prod', hosts: 0, subgroups: 1 },
  { path: 'prod/api', name: 'api', hosts: 2, subgroups: 0 },
  { path: 'lab', name: 'lab', hosts: 1, subgroups: 0 },
];
const hosts = [host('api-2', 'prod/api'), host('api-1', 'prod/api'), host('nas', 'lab', { tags: ['storage'] }), host('loose')];

describe('buildTree', () => {
  it('nests groups, counts hosts and sorts by name', () => {
    const rows = buildTree(groups, hosts, new Set(), '');
    expect(rows.map((r) => (r.kind === 'group' ? `${r.depth}:${r.name}(${r.count})` : `${r.depth}:${r.alias}`))).toEqual([
      '0:lab(1)', '1:nas', '0:prod(2)', '1:api(2)', '2:api-1', '2:api-2', '0:loose',
    ]);
  });

  it('hides the children of a collapsed group', () => {
    const rows = buildTree(groups, hosts, new Set(['prod']), '');
    expect(rows.map((r) => r.key)).toEqual(['g:lab', 'h:nas', 'g:prod', 'h:loose']);
  });

  it('filters hosts by alias, hostname or tag and keeps their groups open', () => {
    const rows = buildTree(groups, hosts, new Set(['prod', 'lab']), 'stor');
    expect(rows.map((r) => r.key)).toEqual(['g:lab', 'h:nas']);
    expect(buildTree(groups, hosts, new Set(['prod']), 'api-1').map((r) => r.key)).toEqual(['g:prod', 'g:prod/api', 'h:api-1']);
  });
});
