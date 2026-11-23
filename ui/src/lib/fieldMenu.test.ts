import { describe, expect, it } from 'vitest';
import { fieldItems, takesFieldMenu, type FieldState } from './fieldMenu';

const state = (o: Partial<FieldState> = {}): FieldState => ({ password: false, readOnly: false, hasSelection: false, empty: false, ...o });
const enabled = (f: FieldState) => fieldItems(f, 'linux').filter((i) => i.enabled).map((i) => i.action);

describe('fieldItems', () => {
  it('offers Cut and Copy only with a selection', () => {
    expect(enabled(state())).toEqual(['paste', 'selectAll']);
    expect(enabled(state({ hasSelection: true }))).toEqual(['cut', 'copy', 'paste', 'selectAll']);
  });
  it('never copies out of a password field', () => {
    expect(enabled(state({ password: true, hasSelection: true }))).toEqual(['paste', 'selectAll']);
  });
  it('a read-only field copies but takes nothing', () => {
    expect(enabled(state({ readOnly: true, hasSelection: true }))).toEqual(['copy', 'selectAll']);
  });
  it('an empty field has nothing to select', () => {
    expect(enabled(state({ empty: true }))).toEqual(['paste']);
  });
  it('names the keys of each system', () => {
    expect(fieldItems(state(), 'mac')[2].hint).toBe('⌘V');
    expect(fieldItems(state(), 'windows')[2].hint).toBe('Ctrl+V');
    expect(fieldItems(state(), 'mac').map((i) => i.label)).toEqual(['Cut', 'Copy', 'Paste', 'Select all']);
  });
});

describe('takesFieldMenu', () => {
  it('takes text inputs and textareas, not buttons, checkboxes, disabled fields or the terminal', () => {
    for (const type of ['text', 'search', 'password', 'email', 'url', 'tel']) expect(takesFieldMenu('INPUT', type, false, false)).toBe(true);
    expect(takesFieldMenu('TEXTAREA', '', false, false)).toBe(true);
    expect(takesFieldMenu('INPUT', 'checkbox', false, false)).toBe(false);
    expect(takesFieldMenu('INPUT', 'number', false, false)).toBe(false);
    expect(takesFieldMenu('INPUT', 'text', true, false)).toBe(false);
    expect(takesFieldMenu('BUTTON', '', false, false)).toBe(false);
    expect(takesFieldMenu('TEXTAREA', '', false, true)).toBe(false);
  });
});
