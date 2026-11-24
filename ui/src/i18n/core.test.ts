import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setLanguage } from './index';
import { coreText, matchCoreMessage, matchTemplate, setCoreMessages, type CoreMessageDef } from './core';
import en from './en.json';

// The core's templates as app_info sends them: en.json's core.* entries are the core's
// own text (scripts/i18n-missing.sh checks it), so they stand in for src/domain/messages.cf.
const CODES: Record<string, string> = {
  'ssh.dial_failed': 'network', 'ssh.auth_rejected': 'auth', 'ssh.connection_lost': 'network',
  'ssh.connection_lost_reason': 'network', 'ssh.host_key_changed': 'host_key', 'ssh.no_auth_accepted': 'auth',
  'vault.wrong_password': 'wrong_password', 'vault.not_unlocked': 'locked', 'rdp.lost': 'network', 'rdp.auth': 'auth',
};
const DEFS: CoreMessageDef[] = Object.entries(CODES).map(([id, code]) => ({ id, code, text: (en as Record<string, string>)[`core.${id}`] }));

describe('core messages', () => {
  beforeEach(() => setCoreMessages(DEFS));
  afterEach(() => { setLanguage('en'); setCoreMessages([]); });

  it('matches a template and returns its params in order', () => {
    expect(matchTemplate('connect to {host}:{port} failed: {reason}', 'connect to 10.0.0.5:22 failed: refused')).toEqual(['10.0.0.5', '22', 'refused']);
    expect(matchTemplate('connect to {host}:{port} failed: {reason}', 'connect to x failed')).toBeNull();
  });

  it('takes a name used twice once, and only when both match', () => {
    const t = DEFS.find((d) => d.id === 'ssh.host_key_changed')!.text;
    const text = t.replace(/\{alias\}/g, 'web').replace('{addr}', 'web.lan').replace('{key_type}', 'ssh-ed25519').replace('{fingerprint}', 'SHA256:x');
    expect(matchTemplate(t, text)).toEqual(['web', 'web.lan', 'ssh-ed25519', 'SHA256:x']);
    expect(matchTemplate(t, text.replace('rm web', 'rm other'))).toBeNull();
  });

  it('tells similar messages apart by their text and code', () => {
    expect(matchCoreMessage('network', 'the connection was lost')?.id).toBe('ssh.connection_lost');
    expect(matchCoreMessage('network', 'the connection was lost: eof')?.id).toBe('ssh.connection_lost_reason');
    expect(matchCoreMessage('network', 'the connection was lost (ERRCONNECT_X)')?.id).toBe('rdp.lost');
    expect(matchCoreMessage('io', 'no vault is unlocked')).toBeNull();
  });

  it('shows the core\'s own English in English', () => {
    expect(coreText({ code: 'locked', message: 'no vault is unlocked' })).toBe('no vault is unlocked');
  });

  it('renders the id in Spanish, from an event or from the text', () => {
    setLanguage('es');
    expect(coreText({ code: 'network', message: 'connect to h:22 failed: x', id: 'ssh.dial_failed', params: ['h', '22', 'x'] })).toBe('no se pudo conectar a h:22: x');
    expect(coreText({ code: 'wrong_password', message: 'the password is wrong or the file is not a Flint vault' })).toBe('la contraseña es incorrecta o el archivo no es una bóveda de Flint');
    expect(coreText({ code: 'auth', message: 'public-key authentication was rejected' })).toBe('se rechazó la autenticación public-key');
  });

  it('falls back to the core\'s message', () => {
    setLanguage('es');
    // No id in the core for this text.
    expect(coreText({ code: 'not_found', message: "host 'web'" })).toBe("host 'web'");
    // An id the page has no template for (an older page, a newer core).
    expect(coreText({ code: 'network', message: 'the jump host could not reach h:22: x', id: 'ssh.jump_dial_failed', params: ['h', '22', 'x'] })).toBe('the jump host could not reach h:22: x');
    // No templates yet (before app_info answered).
    setCoreMessages([]);
    expect(coreText({ code: 'locked', message: 'no vault is unlocked' })).toBe('no vault is unlocked');
  });
});
