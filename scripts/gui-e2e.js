// Headless end-to-end run of the desktop app, driven through its real UI.
// scripts/gui-e2e.sh fills in the @@…@@ values and runs the app with FLINT_GUI_E2E;
// the app loads this file once the page has started (ui/src/App.tsx).
(async () => {
  const VAULT = '@@VAULT@@';
  const PORT = '@@PORT@@';
  const PORT2 = '@@PORT2@@';
  const PORT3 = '@@PORT3@@';
  const USER = '@@USER@@';
  const KEY = `@@KEY@@`;
  const MASTER = 'e2e-master-password-42';
  const HOST_PW_MARKER = 'gui-host-pw-marker';

  window.__flintE2E = { terms: {} };
  const log = (m) => window.backend.e2e_log({ name: String(m) });
  // The headless window is hidden, and WebKit throttles a hidden page's timers to
  // a crawl (CF-050). MessageChannel posts are not throttled, so waits spin on them.
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  let step = 'start';
  const setStep = (s) => { step = s; return log('--   ' + s); };
  let passed = 0;

  async function waitFor(fn, what, ms = 20000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > ms) throw new Error('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  const text = () => document.body.innerText;
  const hasText = (t) => text().includes(t);
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => [...root.querySelectorAll(sel)];
  const byText = (sel, t, root = document) => qa(sel, root).find((el) => el.textContent.includes(t));
  async function click(sel, t, root) {
    const el = await waitFor(() => (t === undefined ? q(sel, root) : byText(sel, t, root)), `${sel} "${t ?? ''}"`);
    el.click();
    await sleep(60);
    return el;
  }
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  async function fill(sel, value) {
    const el = await waitFor(() => q(sel), sel);
    setValue(el, value);
    await sleep(30);
  }
  async function pick(label, option) {
    await click(`button.select[aria-label="${label}"]`);
    await click('[role="listbox"] .mi', option);
  }
  function check(cond, what) {
    if (!cond) throw new Error('check failed: ' + what);
    passed++;
    return log('ok   ' + what);
  }
  const activeTerm = () => {
    const tab = q('.tab.on');
    const region = qa('.pane > div').find((d) => d.style.display !== 'none');
    const id = region?.querySelector('[data-tab]')?.getAttribute('data-tab');
    return tab && id ? window.__flintE2E.terms[id] : null;
  };
  const termText = () => {
    const t = activeTerm();
    if (!t) return '';
    const b = t.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i)?.translateToString(true) ?? '');
    return lines.join('\n');
  };
  async function type(data) {
    const ta = await waitFor(() => qa('.pane > div').find((d) => d.style.display !== 'none')?.querySelector('textarea'), 'terminal textarea');
    ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(50);
  }
  async function enter() {
    // A paste of "\r" is turned into Enter by xterm's bracketed-paste-free path.
    const t = activeTerm();
    const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
    await sleep(50);
    return t;
  }
  async function runInTerminal(cmd, marker) {
    await type(cmd);
    await enter();
    await waitFor(() => termText().includes(marker), `"${marker}" in the terminal`, 20000);
  }
  const toolbarIs = (status) => !!q(`.toolbar .st[aria-label="${status}"]`);

  try {
    await setStep('welcome');
    await waitFor(() => hasText('Welcome to Flint'), 'the welcome screen');
    await check(true, 'a first launch shows the welcome screen');

    await setStep('create vault');
    await click('button.panel', 'Create a new vault');
    await fill('#vn', 'E2E Vault');
    await fill('input[aria-label="Vault file path"]', VAULT);
    await fill('#mp', MASTER);
    await fill('#mp2', MASTER);
    await click('button[type="submit"]', 'Create vault');
    await waitFor(() => hasText('Add your first host'), 'the empty vault page', 30000);
    await check(q('.vault-name')?.textContent === 'E2E Vault', 'the new vault opens on the empty state');

    await setStep('add key');
    await click('.rail-btn', 'Keys');
    await click('.page-h .btn-primary', 'Add key');
    await fill('#pk', KEY);
    await fill('#kn', 'e2e-key');
    await click('.drawer button[type="submit"]', 'Add key');
    await waitFor(() => byText('.table td', 'e2e-key'), 'the key row');
    await check(byText('.table td', 'SHA256:'), 'a pasted key shows its fingerprint');
    await check(!text().includes('PRIVATE KEY'), 'the private key is not shown back');

    await setStep('add host');
    await click('.rail-btn', 'Hosts');
    await click('.btn-primary', 'New host');
    await fill('#ha', 'local');
    await fill('#hh', '127.0.0.1');
    await fill('#hp', PORT);
    await click('.seg button', 'Key');
    await pick('SSH key', 'e2e-key');
    await fill('#hu', USER);
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'local'), 'the host in the tree');
    await check(true, 'a new host appears in the sidebar tree');

    await setStep('host with a saved password');
    await click('.side-head .icon-btn[aria-label^="New host"]');
    await fill('#ha', 'pwhost');
    await fill('#hh', '127.0.0.2');
    await click('.seg button', 'Password');
    await fill('input[aria-label="Password"]', HOST_PW_MARKER);
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'pwhost'), 'pwhost in the tree');
    const catalog = await window.backend.catalog({});
    await check(!JSON.stringify(catalog).includes(HOST_PW_MARKER), 'the catalog reply carries no password (Principle 6)');
    await check(catalog.hosts.find((h) => h.alias === 'pwhost').has_password, 'the host reports has_password');

    await setStep('connect: unknown host key');
    byText('.tree .ti', 'local').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => hasText('before connecting'), 'the host key prompt');
    await check(q('.fp')?.textContent.startsWith('SHA256:'), 'the prompt shows the server fingerprint');
    await check(byText('.tab', 'verify host'), 'the tab is labelled "verify host"');
    await click('button[type="submit"]', 'Trust and connect');
    await waitFor(() => toolbarIs('ready'), 'the session to be ready', 30000);
    await check(true, 'trusting the key opens the shell');

    await setStep('shell I/O');
    await runInTerminal('echo flint-gui-$((40+2))', 'flint-gui-42');
    await check(true, 'typed input reaches the shell and its output reaches xterm.js');
    const known = (await window.backend.catalog({})).known_hosts;
    await check(known.some((k) => k.addr === `[127.0.0.1]:${PORT}`), 'the trusted key is stored in the vault');

    await setStep('resize');
    const term = activeTerm();
    // The page sends its size when the tab is laid out, which can land just after
    // the shell started: ask again a few times before calling it a failure.
    let sized = false;
    for (let i = 0; i < 5 && !sized; i++) {
      await runInTerminal(`stty size; echo size-done-${i}`, `size-done-${i}`);
      sized = termText().includes(`${term.rows} ${term.cols}`);
      if (!sized) await sleep(300);
    }
    await check(sized, `the PTY has the terminal's size (${term.rows} ${term.cols})`);
    {
      const box = term.element.parentElement.getBoundingClientRect();
      const screen = term.element.querySelector('.xterm-screen').getBoundingClientRect();
      await check(screen.bottom <= box.bottom + 0.5 && screen.right <= box.right + 0.5,
        `the terminal's rows fit inside the pane (screen ${Math.round(screen.height)} px, box ${Math.round(box.height)} px)`);
    }

    await setStep('vim');
    // A full-screen editor queries the terminal at start (DECRQM, XTGETTCAP, DA2…).
    // A reply that throws inside xterm.js stops its write queue: the editor still
    // gets every key but the screen never changes again (vite.config.ts, target).
    const key = (k, code, keyCode) => {
      const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: k, code, keyCode, bubbles: true, cancelable: true }));
    };
    const keys = async (text) => {
      for (const ch of text) {
        key(ch, ch === ':' ? 'Semicolon' : 'Key' + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0));
        await sleep(30);
      }
    };
    await runInTerminal('rm -f /tmp/flint-e2e-vim.txt; vim -u DEFAULTS /tmp/flint-e2e-vim.txt', 'flint-e2e-vim.txt" [New]');
    await keys('ihello');
    await waitFor(() => termText().includes('-- INSERT --'), 'vim in insert mode');
    await check(true, 'vim redraws after its start-up queries (DECRQM)');
    key('Escape', 'Escape', 27);
    // Esc and the next key in one SSH packet read as an Alt chord: wait for vim to
    // leave insert mode first, as a person typing would.
    await waitFor(() => !termText().includes('-- INSERT --'), 'vim back in normal mode');
    await keys(':wq');
    key('Enter', 'Enter', 13);
    await runInTerminal('cat /tmp/flint-e2e-vim.txt; echo vim-$((6*7))', 'vim-42');
    await check(/^hello$/m.test(termText()), 'keys typed in vim reach it (insert, Esc, :wq)' + (/^hello$/m.test(termText()) ? '' : ' — terminal: ' + termText().split('\n').filter((l) => l.trim()).slice(-6).join(' | ')));

    await setStep('exit');
    await type('exit 7');
    await enter();
    await waitFor(() => hasText('Session ended'), 'the session ended card');
    await check(hasText('with status 7'), 'the remote exit status is shown');
    await click('.pane-dim .btn-primary', 'Reconnect');
    await waitFor(() => toolbarIs('ready'), 'the reconnected session', 30000);
    await check(!hasText('before connecting'), 'a reconnect to a known host does not ask again');
    await runInTerminal('echo again-ok', 'again-ok');
    await check(true, 'the reconnected session works');

    await setStep('jump host');
    await click('.side-head .icon-btn[aria-label^="New host"]');
    await fill('#ha', 'inner');
    await fill('#hh', 'localhost');
    await fill('#hp', PORT2);
    await click('.seg button', 'Key');
    await pick('SSH key', 'e2e-key');
    await fill('#hu', USER);
    await pick('Jump host', 'local');
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'inner'), 'inner in the tree');
    byText('.tree .ti', 'inner').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => hasText('before connecting'), 'the second hop host key prompt');
    await check(q('.kv dd')?.textContent === `[localhost]:${PORT2}`, 'only the unknown hop asks');
    await click('button[type="submit"]', 'Trust and connect');
    await waitFor(() => toolbarIs('ready'), 'the jump session', 30000);
    await runInTerminal('echo via-jump-ok', 'via-jump-ok');
    await check(qa('.tab').length === 2, 'the jump session opened in a second tab');

    await setStep('tabs');
    await click('.tab', 'local');
    await waitFor(() => termText().includes('again-ok'), 'the first tab terminal');
    await check(termText().includes('again-ok') && !termText().includes('via-jump-ok'), 'each tab keeps its own scrollback');

    await setStep('changed host key');
    await click('.side-head .icon-btn[aria-label^="New host"]');
    await fill('#ha', 'moved');
    await fill('#hh', '127.0.0.1');
    await fill('#hp', PORT3);
    await click('.seg button', 'Key');
    await pick('SSH key', 'e2e-key');
    await fill('#hu', USER);
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'moved'), 'moved in the tree');
    byText('.tree .ti', 'moved').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => hasText('before connecting'), 'the first host key prompt for moved');
    await click('button[type="submit"]', 'Trust and connect');
    await waitFor(() => toolbarIs('ready'), 'moved, first contact', 30000);
    await type('exit');
    await enter();
    await waitFor(() => hasText('Session ended'), 'moved to end');
    // The forwarder now reaches the other sshd: same address, another key.
    await click('.pane-dim .btn-primary', 'Reconnect');
    await waitFor(() => hasText('has changed'), 'the changed key card', 30000);
    await check(qa('.fp').length === 2, 'the card shows the trusted and the presented key');
    const replace = byText('.pane-dim button', 'Replace key and connect');
    await check(replace.getAttribute('aria-disabled') === 'true', 'Replace is disabled until the alias is typed');
    replace.click();
    await sleep(200);
    await check(hasText('has changed'), 'clicking the disabled Replace does nothing');
    await check(document.activeElement?.textContent.includes('Close session'), 'the safe action has the initial focus');
    await fill('.pane-dim input', 'moved');
    await click('.pane-dim button', 'Replace key and connect');
    await waitFor(() => hasText('before connecting'), 'a fresh host key prompt after replacing', 30000);
    await click('button[type="submit"]', 'Trust and connect');
    await waitFor(() => toolbarIs('ready'), 'moved, new key', 30000);
    await check(true, 'replacing the key forgets the old one and asks again');

    await setStep('palette');
    const mac = (await window.backend.app_info({})).os === 'mac';
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', metaKey: mac, ctrlKey: !mac, shiftKey: !mac, bubbles: true, cancelable: true }));
    await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
    await fill('[aria-label="Command palette"] input', 'pwh');
    await waitFor(() => byText('[role="option"]', 'pwhost'), 'pwhost in the palette');
    await check(q('[role="option"].hot')?.textContent.includes('pwhost'), 'the palette ranks the matching host first');
    q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    await setStep('settings');
    const openTabs = qa('.tab').length;
    if (openTabs) await runInTerminal('echo kept-$((20+3))', 'kept-23');
    await click('.rail-btn', 'Settings');
    await click('.swatches .sw[aria-label="moss"]');
    await waitFor(() => document.documentElement.dataset.accent === 'moss', 'the accent');
    const accentNow = () => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase();
    await click('.theme-card', 'Dark');
    await waitFor(() => document.documentElement.dataset.theme === 'dark', 'the dark theme');
    await check(accentNow() === '#7BC98F', `the accent colour follows the setting in the dark theme (${accentNow()})`);
    await click('.theme-card', 'Light');
    await waitFor(() => document.documentElement.dataset.theme === 'light', 'the light theme');
    await check(accentNow() === '#4FA068', `the accent colour follows the setting in the light theme (${accentNow()})`);
    const saved = await window.backend.settings_get({});
    await check(saved.accent === 'moss' && saved.theme === 'light', 'appearance settings are saved');
    await click('.nav-i', 'Terminal');
    await waitFor(() => hasText('installed monospaced fonts'), 'the terminal settings');
    await click('.nav-i', 'Vault');
    await waitFor(() => hasText('Known hosts'), 'the vault settings');
    await check(byText('td', `[127.0.0.1]:${PORT}`), 'known hosts are listed');
    if (openTabs) {
      await click('.rail-btn', 'Hosts');
      await waitFor(() => activeTerm(), 'the session view');
      await check(termText().includes('kept-23'), 'a terminal keeps its scrollback across a visit to Settings');
    }

    await setStep('lock');
    await click('.statusbar .sb-btn', 'Lock');
    await waitFor(() => hasText('Master password'), 'the unlock screen');
    await check(qa('.tab').length === 0, 'locking closes every session');
    await fill('#pw', 'wrong-password');
    await click('button[type="submit"]', 'Unlock');
    await waitFor(() => hasText('Wrong password'), 'the wrong password message', 30000);
    await check(true, 'a wrong master password is refused');
    await waitFor(() => { const pw = q('#pw'); return pw && !pw.disabled && pw.selectionEnd === pw.value.length && pw.selectionStart === 0 && pw.value.length > 0 ? pw : null; }, 'the attempt selected');
    await check(q('#pw').value === 'wrong-password', 'the wrong attempt stays in the field, selected');
    await fill('#pw', MASTER);
    await click('button[type="submit"]', 'Unlock');
    await waitFor(() => byText('.tree .ti', 'local'), 'the unlocked tree', 30000);
    await check(true, 'the right master password unlocks the vault again');

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
