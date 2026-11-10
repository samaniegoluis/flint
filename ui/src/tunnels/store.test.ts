import { describe, expect, it } from 'vitest';
import type { TunnelView } from '../api/types';
import { key, portAdvice, stateLine, switchedOn, type Start } from './store';
import { sharedPort, splitDestination } from './HostTunnels';

const t = (host: string, name: string, p: Partial<TunnelView> = {}): TunnelView => ({
  host, name, local_port: 5432, destination: 'localhost:5432', open_on_connect: false,
  state: 'stopped', listen: '', connections: 0, error: '', ...p,
});
const start = (host: string, p: Partial<Start> = {}): Start => ({ session: 's', host, names: [], all: false, status: 'connecting', prompt: null, ...p });

describe('a tunnel state line (design 20a)', () => {
  it('counts connections while it listens', () => {
    const s = { list: [], starts: {}, failed: {} };
    expect(stateLine(t('db', 'pg', { state: 'listening', connections: 0 }), s)).toEqual({ kind: 'ok', text: 'listening · no connections' });
    expect(stateLine(t('db', 'pg', { state: 'listening', connections: 1 }), s).text).toBe('listening · 1 connection');
    expect(stateLine(t('db', 'pg', { state: 'listening', connections: 2 }), s).text).toBe('listening · 2 connections');
  });

  it('says a lost connection with its reason, and nothing retries', () => {
    const v = t('redis', 'r', { state: 'connection lost', error: 'broken pipe' });
    expect(stateLine(v, { list: [v], starts: {}, failed: {} })).toEqual({ kind: 'danger', text: 'connection lost · broken pipe' });
    expect(switchedOn(v, { starts: {} })).toBe(false);
  });

  it('names who holds a port in use, or another program', () => {
    const pg = t('db', 'pg', { state: 'listening' });
    const stg = t('stg', 'pg-stg');
    const failed = { [key('stg', 'pg-stg')]: { code: 'port_in_use', message: '' } };
    expect(stateLine(stg, { list: [pg, stg], starts: {}, failed }).text).toBe('port 5432 in use · used by pg on db');
    expect(portAdvice(stg, { list: [pg, stg], failed })).toBe('Stop pg on db first, or give pg-stg another local port.');
    expect(stateLine(stg, { list: [stg], starts: {}, failed }).text).toBe('port 5432 in use · by another program');
    expect(portAdvice(t('db', 'x'), { list: [], failed })).toBe('');
  });

  it('shows a start under way for the tunnels it opens', () => {
    const pg = t('db', 'pg', { open_on_connect: true });
    const other = t('db', 'other');
    const s = { list: [pg, other], starts: { db: start('db') }, failed: {} };
    expect(stateLine(pg, s)).toEqual({ kind: 'wait', text: 'starting…' });
    expect(stateLine(other, s).text).toBe('stopped');
    expect(switchedOn(pg, s)).toBe(true);
    const all = { ...s, starts: { db: start('db', { all: true, status: 'prompt' }) } };
    expect(stateLine(other, all).text).toBe('waiting for you…');
    const named = { ...s, starts: { db: start('db', { names: ['other'] }) } };
    expect(switchedOn(pg, named)).toBe(false);
    expect(switchedOn(other, named)).toBe(true);
  });

  it('says a login that failed', () => {
    const v = t('db', 'pg');
    expect(stateLine(v, { list: [v], starts: {}, failed: { [key('db', 'pg')]: { code: 'auth', message: 'x' } } }).text).toBe('not started · login failed');
  });
});

describe('the host editor', () => {
  it('splits a destination as the core writes it', () => {
    expect(splitDestination('localhost:5432')).toEqual({ host: 'localhost', port: '5432' });
    expect(splitDestination('[fd00::5]:443')).toEqual({ host: 'fd00::5', port: '443' });
  });

  it('finds the other tunnels on the same local port, not the one being edited', () => {
    const list = [t('db', 'pg'), t('stg', 'pg-stg'), t('db', 'redis', { local_port: 6379 })];
    expect(sharedPort(list, 5432, 'db', 'PG').map((v) => v.name)).toEqual(['pg-stg']);
    expect(sharedPort(list, 5432, 'db', 'new').length).toBe(2);
  });
});
