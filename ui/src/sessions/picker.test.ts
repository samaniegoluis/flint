import { describe, expect, it } from 'vitest';
import { pickerRows } from './picker';
import type { HostView } from '../api/types';

const host = (alias: string, p: Partial<HostView> = {}): HostView => ({
  alias, type: 'ssh', domain: '', audio: '', microphone: false, label: '', hostname: alias + '.lan', port: 22, user: 'luis', group: '', tags: [], color: '',
  notes: '', jump: '', credential: '', key: '', has_password: false, has_sudo_password: false, command: '', keep_shell: false, ...p,
});
const hosts = [host('prod-api-01'), host('db-primary'), host('stg-web'), host('bastion'), host('redis'), host('win-desk', { type: 'rdp' }), host('db-replica')];

describe('the empty pane picker (milestone 72)', () => {
  it('lists the suggested host first, then recent ones, then the rest by name', () => {
    const { rows, rdp } = pickerRows(hosts, 'prod-api-01', ['stg-web', 'prod-api-01', 'win-desk'], '', 5);
    expect(rows.map((r) => [r.host.alias, r.kind])).toEqual([
      ['prod-api-01', 'same'], ['stg-web', 'recent'], ['bastion', 'host'], ['db-primary', 'host'], ['db-replica', 'host'],
    ]);
    expect(rdp).toBe('');
  });

  it('never lists a remote desktop, and caps the rows', () => {
    const { rows } = pickerRows(hosts, '', [], '', 3);
    expect(rows).toHaveLength(3);
    expect(pickerRows(hosts, '', [], '', 20).rows.some((r) => r.host.type === 'rdp')).toBe(false);
  });

  it('matches what is typed as the palette does, marking the suggested host', () => {
    const { rows } = pickerRows(hosts, 'db-primary', [], 'db', 5);
    expect(rows.map((r) => r.host.alias).sort()).toEqual(['db-primary', 'db-replica']);
    expect(rows.find((r) => r.host.alias === 'db-primary')!.kind).toBe('same');
    expect(rows[0].match).not.toBeNull();
  });

  it('says where a remote desktop opens when only one matches', () => {
    expect(pickerRows(hosts, '', [], 'win', 5)).toMatchObject({ rows: [], rdp: 'win-desk' });
    expect(pickerRows(hosts, '', [], 'zzz', 5)).toMatchObject({ rows: [], rdp: '' });
  });
});
