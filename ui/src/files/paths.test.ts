import { describe, expect, it } from 'vitest';
import { baseName, crumbs, humanSize, humanTime, joinPath, parentPath, parseOsc7, sortEntries, validName } from './paths';
import type { FileEntry } from '../api/types';

describe('parseOsc7', () => {
  it('reads the folder of a file URL', () => {
    expect(parseOsc7('file://codebox/home/luis/srv/api')).toBe('/home/luis/srv/api');
    expect(parseOsc7('file:///tmp')).toBe('/tmp');
  });
  it('decodes percent escapes', () => {
    expect(parseOsc7('file://h/home/me/My%20Files')).toBe('/home/me/My Files');
  });
  it('refuses what is not a file URL with an absolute path', () => {
    expect(parseOsc7('http://h/x')).toBeNull();
    expect(parseOsc7('file://host')).toBeNull();
    expect(parseOsc7('file://h/%E0%A4%A')).toBeNull();
    expect(parseOsc7('file://h/a%00b')).toBeNull();
  });
});

describe('paths', () => {
  it('joins, climbs and names', () => {
    expect(joinPath('/srv', 'a')).toBe('/srv/a');
    expect(joinPath('/', 'a')).toBe('/a');
    expect(parentPath('/srv/api')).toBe('/srv');
    expect(parentPath('/srv')).toBe('/');
    expect(parentPath('/')).toBe('/');
    expect(baseName('/srv/api/')).toBe('api');
  });
  it('splits a path into a breadcrumb', () => {
    expect(crumbs('/home/luis')).toEqual([{ name: '/', path: '/' }, { name: 'home', path: '/home' }, { name: 'luis', path: '/home/luis' }]);
    expect(crumbs('/')).toEqual([{ name: '/', path: '/' }]);
  });
  it('accepts only names a file can have', () => {
    expect(validName('notes.txt')).toBe(true);
    expect(validName('')).toBe(false);
    expect(validName('a/b')).toBe(false);
    expect(validName('..')).toBe(false);
  });
});

describe('the list', () => {
  const e = (name: string, kind: FileEntry['kind']): FileEntry => ({ name, path: '/' + name, kind, size: 0, mtime: 0, mode: 0 });
  it('puts folders first, then names in natural order', () => {
    expect(sortEntries([e('b.txt', 'file'), e('src', 'dir'), e('a10', 'file'), e('a9', 'file'), e('dist', 'dir')]).map((x) => x.name))
      .toEqual(['dist', 'src', 'a9', 'a10', 'b.txt']);
  });
  it('prints sizes as the CLI does', () => {
    expect(humanSize(412)).toBe('412 B');
    expect(humanSize(2150)).toBe('2.1 KB');
    expect(humanSize(48.2 * 1024 * 1024)).toBe('48 MB');
    expect(humanSize(5.5 * 1024 * 1024)).toBe('5.5 MB');
  });
  it('prints times relative to now', () => {
    const now = new Date(2026, 10, 8, 22, 0).getTime();
    const at = (d: Date) => d.getTime() / 1000;
    expect(humanTime(at(new Date(2026, 10, 8, 21, 59, 30)), now)).toBe('just now');
    expect(humanTime(at(new Date(2026, 10, 8, 21, 30)), now)).toBe('30 min ago');
    expect(humanTime(at(new Date(2026, 10, 8, 20, 0)), now)).toBe('2 h ago');
    expect(humanTime(at(new Date(2026, 10, 8, 9, 5)), now)).toBe('09:05');
    expect(humanTime(at(new Date(2026, 9, 12)), now)).toBe('12 Oct');
    expect(humanTime(at(new Date(2024, 9, 12)), now)).toBe('12 Oct 2024');
  });
});
