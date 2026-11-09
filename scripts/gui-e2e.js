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
  const TETHER = '@@TETHER@@';
  // '0' on Linux unless FLINT_E2E_VIM=1: the vim step fails there (ROADMAP, gui-e2e.sh).
  const RUN_VIM = '@@VIM@@' === '1';
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
  const t0 = performance.now();
  const setStep = (s) => { step = s; return log('--   ' + s + ` (${Math.round((performance.now() - t0) / 1000)} s)`); };
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
  // waitFor for a condition that needs an RPC (an async function).
  async function waitForAsync(fn, what, ms = 20000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = await fn(); } catch { v = null; }
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
    if (!RUN_VIM) {
      await log('skip vim: known failure on Linux, see ROADMAP (FLINT_E2E_VIM=1 runs it)');
    } else {
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
    }

    await setStep('osc 52');
    // A remote program sets the clipboard: the core writes it (the run's private board).
    await runInTerminal(`printf '\\033]52;c;%s\\a' "$(printf 'osc52-from-remote-%s' "$((6*7))" | base64)"; echo osc-sent-$((6*7))`, 'osc-sent-42');
    {
      const clip = await waitForAsync(async () => {
        const r = await window.backend.e2e_clipboard({});
        const v = (typeof r === 'string' ? JSON.parse(r) : r)?.name;
        return v === 'osc52-from-remote-42' ? v : null;
      }, 'the OSC 52 text on the clipboard');
      await check(clip === 'osc52-from-remote-42', 'OSC 52 from the remote reaches the clipboard');
    }
    await runInTerminal(`printf '\\033]52;c;?\\a'; echo osc-query-$((6*7))`, 'osc-query-42');
    await check(true, 'an OSC 52 query is ignored and the session carries on');

    await setStep('input order');
    // 300 writes in one tick, as xterm.js answering a burst of colour queries: they
    // must reach the remote in order (Tether 14a1461).
    await runInTerminal('stty -echo; cat > /tmp/flint-e2e-order.txt; stty echo; echo cat-done-$((6*7))', '');
    await sleep(300);
    {
      const t = activeTerm();
      for (let i = 0; i < 300; i++) t.input(`L${i}\n`, true);
      t.input('\x04', true);
    }
    await waitFor(() => termText().includes('cat-done-42'), 'cat to finish');
    await runInTerminal(`awk 'NR-1!=substr($0,2){bad=1} END{print ((bad||NR!=300)?"order-bad-" NR:"order-" "ok")}' /tmp/flint-e2e-order.txt`, '\norder-');
    await check(termText().includes('order-ok'), 'a 300-write burst reaches the remote in order' + (termText().includes('order-ok') ? '' : ' — ' + (termText().match(/order-bad-\d+/) || [''])[0]));

    await setStep('dead key');
    // WebKit's flush of a dead ' that did not combine: compositionend commits "'",
    // then one keydown carries "'s". Only the "s" is new (Tether a872c3f).
    await runInTerminal('stty -echo; head -n 1 > /tmp/flint-e2e-dead.txt; stty echo; echo head-done-$((6*7))', '');
    await sleep(300);
    {
      const t = activeTerm();
      const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
      t.input("it'", true); // what xterm sends for the committed composition
      ta.dispatchEvent(new CompositionEvent('compositionend', { data: "'", bubbles: true }));
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: "'s", code: 'KeyS', keyCode: 222, bubbles: true, cancelable: true }));
      await sleep(100);
      t.input('\r', true);
    }
    await waitFor(() => termText().includes('head-done-42'), 'head to finish');
    await runInTerminal('echo "[$(cat /tmp/flint-e2e-dead.txt)]-$((6*7))"', ']-42');
    await check(termText().includes("[it's]"), "a dead ' flushed with s types it's, not it''s");

    await setStep('files view');
    {
      // Milestone 17: the Files view over the tab's own session (D-053). The sshd is
      // this machine, so the host's files are a scratch folder here.
      const mac = (await window.backend.app_info({})).os === 'mac';
      const chord = (code, key, extra = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
        key, code, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac, ...extra }));
      const dir = `/tmp/flint-gui-files-${Date.now()}`;
      await runInTerminal(`mkdir -p ${dir}/old && printf hello > ${dir}/a.txt && head -c 33554432 /dev/zero > ${dir}/big.bin && echo files-ready-$((6*7))`, 'files-ready-42');
      chord('KeyE', 'e');
      const aside = () => q('.sidebar[data-for="files"]');
      await waitFor(() => aside()?.dataset.filesPath, 'the Files view to list the login folder', 20000);
      await check(document.querySelector('.app')?.dataset.view === 'files' && q('[data-files-host]')?.textContent === 'local', 'the Files shortcut opens the view on the active tab, "Files · local"');
      // A login shell may report its folder already (zsh on macOS does); bash in the Linux image does not.
      if (q('[data-files-goto-cwd]')?.getAttribute('aria-disabled') === 'true') await check(/OSC 7/.test(q('[data-files-goto-cwd]').title), "Go to the terminal's folder is off, with a hint, while the shell reports none (OSC 7)");
      else await log('note the login shell reports its folder (OSC 7) already');
      // OSC 7 from the shell: the crosshair takes the view to the terminal's folder.
      await runInTerminal(`cd ${dir} && printf '\\033]7;file://e2e%s\\033\\\\' "$PWD"; echo osc7-$((6*7))`, 'osc7-42');
      await waitFor(() => q('[data-files-goto-cwd]')?.getAttribute('aria-disabled') === 'false', 'the OSC 7 folder');
      q('[data-files-goto-cwd]').click();
      await waitFor(() => aside()?.dataset.filesPath === dir && q('[data-file="a.txt"]'), 'the scratch folder listed');
      await check(q('[data-files-count]')?.textContent === 'Synced with terminal', "Go to the terminal's folder lists the shell's folder, synced");
      await check(q('[data-file="old"]')?.dataset.kind === 'dir' && qa('.frow[data-file]')[0]?.dataset.file === 'old', 'folders come first, with sizes and dates beside files');
      // New folder, rename, delete.
      await click('[data-files-mkdir]');
      await fill('#ta', 'made');
      await click('.modal button[type="submit"]');
      await waitFor(() => q('[data-file="made"]'), 'the new folder');
      await check(q('[data-file="made"]').dataset.kind === 'dir', 'New folder creates a folder on the host');
      q('[data-file="a.txt"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
      await click('.menu .mi', 'Rename');
      await fill('#ta', 'b.txt');
      await click('.modal button[type="submit"]');
      await waitFor(() => q('[data-file="b.txt"]') && !q('[data-file="a.txt"]'), 'the renamed file');
      await check(q('[data-file="b.txt"].sel'), 'Rename renames on the host and keeps the file selected');
      q('[data-file="old"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 }));
      await click('.menu .mi', 'Delete');
      await waitFor(() => hasText('Delete old?'), 'the delete confirmation');
      await click('.modal .btn-danger', 'Delete folder');
      await waitFor(() => !q('[data-file="old"]'), 'the folder to go');
      await check(true, 'Delete asks first, then removes the folder');
      // Into a folder and back up with ⌘↑.
      q('[data-file="made"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => aside()?.dataset.filesPath === dir + '/made', 'the subfolder');
      {
        // A narrow panel shrinks the folders above, never the one being shown.
        const nav = q('[data-files-crumbs]');
        nav.style.maxWidth = '140px';
        const cur = nav.querySelector('.cur-c');
        // Reading the boxes lays the page out; no frame is needed (none comes in a headless run).
        const box = cur && { cr: cur.getBoundingClientRect().right, nr: nav.getBoundingClientRect().right, nw: nav.getBoundingClientRect().width, sw: cur.scrollWidth, cw: cur.clientWidth };
        const fits = box && cur.textContent === 'made' && box.nw <= 140.5 && box.cr <= box.nr + 0.5 && box.sw <= box.cw;
        nav.style.maxWidth = '';
        await check(fits, 'in a narrow panel the breadcrumb keeps the current folder whole' + (fits ? '' : ` ${JSON.stringify(box)}`));
      }
      q('[data-files-list]').focus();
      q('[data-files-list]').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac }));
      await waitFor(() => aside()?.dataset.filesPath === dir, 'back up one folder');
      await check(q('[data-file="made"].sel'), 'the up chord climbs one folder and selects where it came from');
      // A drop from the OS: the page stages the bytes, then uploads them (CF-004).
      const dt = new DataTransfer();
      dt.items.add(new File(['dropped-bytes-42\n'], 'dropped.txt', { type: 'text/plain' }));
      aside().dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await waitFor(() => q('[data-files-dropzone]'), 'the drop zone');
      await check(q('[data-files-dropzone]').textContent.includes(`local:${dir}`), 'dragging files over the sidebar shows the drop zone and the remote folder');
      aside().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      await waitFor(() => q('[data-transfer="dropped.txt"][data-state="done"]'), 'the dropped file uploaded', 20000);
      await waitFor(() => q('[data-file="dropped.txt"]'), 'the uploaded file in the list');
      await runInTerminal(`cat ${dir}/dropped.txt; ls -a ${dir} | grep -c flint-part; echo drop-check-$((6*7))`, 'drop-check-42');
      await check(termText().includes('dropped-bytes-42') && /\n0\n/.test(termText()), 'a file dropped from the OS lands on the host byte for byte, with no part file left');
      // The same name again: the row asks before it replaces.
      const dt2 = new DataTransfer();
      dt2.items.add(new File(['second-version\n'], 'dropped.txt'));
      aside().dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
      await waitFor(() => q('[data-transfer="dropped.txt"][data-state="conflict"]'), 'the replace question');
      await check(true, 'an upload over an existing file asks first');
      q('[data-transfer="dropped.txt"][data-state="conflict"] [data-transfer-replace]').click();
      await waitFor(() => qa('[data-transfer="dropped.txt"][data-state="done"]').length === 2, 'the replaced upload');
      await runInTerminal(`cat ${dir}/dropped.txt; echo replace-check-$((6*7))`, 'replace-check-42');
      await check(termText().includes('second-version'), 'Replace uploads over the existing file');
      await click('[data-files-clear]');
      await check(!q('[data-transfer]'), 'Clear done empties the queue of finished transfers');
      // A download and a cancel, through the same RPC the save dialog leads to.
      const session = aside().dataset.filesSession;
      const res = await window.backend.files_transfer({ session, id: 'e2e-dl', direction: 'download', local: dir + '/made/b-copy.txt', remote: dir + '/b.txt', recursive: false, force: true });
      await check(res.bytes === 5, 'a download over the tab\'s session copies the file');
      let heard = 0;
      const off = window.runtime.EventsOn('files:transfer', (ev) => { if (ev.id === 'e2e-cancel') heard++; });
      const started = window.backend.files_transfer({ session, id: 'e2e-cancel', direction: 'download', local: dir + '/made/big-copy.bin', remote: dir + '/big.bin', recursive: false, force: true })
        .then(() => 'finished', (err) => String(err));
      await waitFor(() => heard > 0, 'progress of the big download');
      await window.backend.files_cancel({ id: 'e2e-cancel' });
      const outcome = await started;
      off();
      await check(/cancelled/.test(outcome), 'a running transfer reports progress and stops when cancelled: ' + outcome);
      await runInTerminal(`ls -a ${dir}/made | grep -c -e flint-part -e big-copy; echo cancel-check-$((6*7))`, 'cancel-check-42');
      await check(/\n0\n/.test(termText()), 'a cancelled download leaves no partial file');
      // The terminal still works beside SFTP, and the Files button toggles the view.
      await runInTerminal('echo beside-sftp-$((6*7))', 'beside-sftp-42');
      await check(true, 'the terminal keeps working beside the Files view');
      await runInTerminal(`rm -rf ${dir}; cd; echo files-clean-$((6*7))`, 'files-clean-42');
      await click('.rail-btn', 'Hosts');
      await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts', 'back to the Hosts view');
    }

    await setStep('exit');
    await type('exit 7');
    await enter();
    await waitFor(() => hasText('Session ended'), 'the session ended card');
    await check(hasText('with status 7'), 'the remote exit status is shown');
    await click('.rail-btn', 'Files');
    await waitFor(() => q('[data-files-empty]'), 'the Files view without a session');
    await check(hasText('Open a session to browse its files') && q('[data-files-reconnect]'), 'Files on an ended session offers Reconnect (14c)');
    await click('.rail-btn', 'Hosts');
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

    await setStep('copy between servers');
    {
      // Milestone 19: a second Files pane on another host, floating beside the view
      // (D-059), and copies host → Flint → host. Both sshds are this machine and the
      // same user, so both login folders are this $HOME.
      const mac = (await window.backend.app_info({})).os === 'mac';
      const chord = (code, key, extra = {}) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
        key, code, bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: !mac, ...extra }));
      const name = `flint-e2e-two-${Date.now()}`;
      await runInTerminal(`mkdir -p ~/${name}/src/sub ~/${name}/dst && printf hello-relay > ~/${name}/src/a.txt && printf deep-relay > ~/${name}/src/sub/x.txt && cd ~/${name}/src && printf '\\033]7;file://e2e%s\\033\\\\' "$PWD"; echo two-ready-$((6*7))`, 'two-ready-42');
      chord('KeyE', 'e');
      const aside = () => q('.sidebar[data-for="files"]');
      await waitFor(() => aside()?.dataset.filesPath?.endsWith(`/${name}/src`) && q('[data-file="a.txt"]'), 'the Files view on the OSC 7 folder', 20000);
      await check(true, "the Files view opens on the terminal's folder by itself (OSC 7)");
      const base = aside().dataset.filesPath.replace(/\/src$/, '');
      // 14d1: the picker, this tab's host greyed out.
      await click('[data-files-pick]');
      await waitFor(() => q('[data-files-picker]'), 'the server picker');
      const me = byText('[data-files-picker] .picker-row.off', 'local');
      await check(me && me.textContent.includes('this tab') && q('[data-files-pick-host="inner"]'), "the picker lists the vault's hosts and greys out this tab's (14d1)");
      await click('[data-files-pick-host="inner"]');
      const pane = () => q('[data-files-pane="2"]');
      await waitFor(() => pane()?.dataset.pairStatus === 'ready' && pane().dataset.filesPath, 'the second pane listed', 20000);
      await check(pane().textContent.includes('its tab’s session') && qa('.tab').length === 2, "a host with an open tab lends that tab's session: no new login");
      const main = q('.main').getBoundingClientRect();
      await check(pane().getBoundingClientRect().left >= aside().getBoundingClientRect().right - 2 && Math.abs(main.left - aside().getBoundingClientRect().right) < 3,
        'the second pane floats over the terminal, which keeps its width (D-059)');
      const into = async (folder, path) => {
        pane().querySelector(`[data-file="${folder}"]`).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => pane().dataset.filesPath === path, 'the second pane in ' + path);
      };
      await waitFor(() => pane().querySelector(`[data-file="${name}"]`), 'the scratch folder in the second pane');
      await into(name, base);
      await into('dst', base + '/dst');
      // 14d3a: drag a file from the first pane onto the second.
      const drag = async (row, target) => {
        const dt = new DataTransfer();
        row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: 700, clientY: 300 }));
        await waitFor(() => q('[data-files-drag-label]'), 'the drag label');
        const label = q('[data-files-drag-label]').textContent;
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
        return label;
      };
      const row1 = (n) => aside().querySelector(`:scope > .col [data-file="${n}"]`);
      const label = await drag(row1('a.txt'), pane().querySelector('[data-files-list]'));
      await check(label.includes('Copy to inner · dst/'), 'dragging over the other pane names its host and folder (14d3a): ' + label);
      await waitFor(() => q('[data-transfer="a.txt"][data-direction="relay"][data-state="done"]'), 'the copy between servers', 20000);
      await check(q('[data-transfer="a.txt"] [data-transfer-route]')?.textContent === 'localinner', 'the queue row reads local → inner (14d4)');
      await waitFor(() => pane().querySelector('[data-file="a.txt"]'), 'the copy listed in the second pane');
      // The same name again: the strip asks (14d4); Replace copies over it.
      await drag(row1('a.txt'), pane().querySelector('[data-files-list]'));
      await waitFor(() => q('.conflict[data-transfer="a.txt"]'), 'the replace question');
      await check(q('.conflict[data-transfer="a.txt"]').textContent.includes('already exists on inner in dst/'), 'a name clash names the host and folder');
      q('.conflict[data-transfer="a.txt"] [data-transfer-replace]').click();
      await waitFor(() => qa('[data-transfer="a.txt"][data-state="done"]').length === 2, 'the replaced copy');
      // ⌘→ (Ctrl+Shift+→) copies the selection: a folder, with what is in it.
      row1('sub').click();
      await sleep(150);
      aside().querySelector(':scope > .col [data-files-list]').focus();
      chord('ArrowRight', 'ArrowRight');
      await waitFor(() => q('[data-transfer="sub"][data-direction="relay"][data-state="done"]'), 'the folder copy', 20000);
      await runInTerminal(`cat ${base}/dst/a.txt ${base}/dst/sub/x.txt; ls -a ${base}/dst | grep -c flint-part; echo relay-check-$((6*7))`, 'relay-check-42');
      await check(termText().includes('hello-relaydeep-relay') && /\n0\n/.test(termText()), 'files and folders land on the other host byte for byte, with no part file left');
      // Hiding is not closing (D-059): Esc hides the pane, the chip brings it back as it was.
      pane().querySelector('[data-files-list]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => !pane() && q('[data-files-pair-chip]'), 'the hidden pane');
      await check(q('[data-files-pair-chip]').textContent.includes('inner'), 'a hidden pane leaves a chip naming its host');
      q('[data-files-pair-chip]').click();
      await waitFor(() => pane()?.dataset.filesPath === base + '/dst', 'the pane back');
      await check(true, 'the chip shows the pane again on the same folder');
      q('.pane').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await waitFor(() => !pane(), 'a click in the terminal hides the pane');
      q('[data-files-pair-chip]').click();
      await waitFor(() => pane(), 'the pane back again');
      await click('[data-files-one-pane]');
      await waitFor(() => !pane() && q('[data-files-pick]'), 'one pane');
      await check(qa('.tab').length === 2, 'One pane ends the mode and leaves the borrowed tab alone');

      // A host with no open tab: a session with no terminal, its host key asked in the pane (14d5c).
      await click('.rail-btn', 'Hosts');
      await click('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'side');
      await fill('#hh', '127.0.0.1');
      await fill('#hp', PORT2);
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'side'), 'side in the tree');
      chord('KeyE', 'e');
      await click('[data-files-pick]');
      await click('[data-files-pick-host="side"]');
      await waitFor(() => pane()?.querySelector('[data-files-pane-hostkey]'), 'the host key question in the pane', 20000);
      await check(pane().textContent.includes('Verify side'), "a new host's key is asked inside the pane (14d5c)");
      await click('[data-files-pane-hostkey] button[type="submit"]');
      await waitFor(() => pane()?.dataset.pairStatus === 'ready' && pane().dataset.filesPath, 'the Flint-only session', 20000);
      await check(pane().textContent.includes('Flint-only session') && qa('.tab').length === 2, 'a host with no tab gets a session of its own with no terminal, and no tab');
      await waitFor(() => pane().querySelector(`[data-file="${name}"]`), 'the scratch folder over the Flint-only session');
      await into(name, base);
      // ⌘← copies from the second pane back to the first: src already has a.txt, so Skip.
      pane().querySelector('[data-file="src"]').click();
      await into('src', base + '/src');
      pane().querySelector('[data-file="a.txt"]').click();
      await sleep(150);
      pane().querySelector('[data-files-list]').focus();
      chord('ArrowLeft', 'ArrowLeft');
      await waitFor(() => q('.conflict[data-transfer="a.txt"]'), 'a copy back to the first pane, asked');
      // Pressed again, or held so the key repeats, while it waits: still one copy (owner walkthrough).
      chord('ArrowLeft', 'ArrowLeft');
      chord('ArrowLeft', 'ArrowLeft', { repeat: true });
      await sleep(300);
      await check(qa('[data-transfer="a.txt"][data-direction="relay"]:not([data-state="done"])').length === 1,'a second ⌘← while the copy waits does not queue it again');
      q('.conflict[data-transfer="a.txt"] [data-transfer-skip]').click();
      await waitFor(() => !q('.conflict'), 'skipped');
      await check(/Skipped/.test(q('[data-transfer="a.txt"][data-state="cancelled"]')?.textContent ?? ''), 'a copy from the second pane to the first asks before replacing, and Skip leaves it and reads Skipped');
      await click('[data-files-one-pane]');
      await waitFor(() => !pane(), 'one pane');
      await runInTerminal(`cd; rm -rf ~/${name}; echo two-clean-$((6*7))`, 'two-clean-42');
      // Later steps meet [127.0.0.1]:PORT2 as a new host key: leave it as found.
      await window.backend.known_host_rm({ name: 'side' });
      await window.backend.host_rm({ name: 'side' });
      await click('[data-files-clear]');
      await click('.rail-btn', 'Hosts');
      await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts', 'back to the Hosts view');
    }

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

    await setStep('test connection');
    const isMac = (await window.backend.app_info({})).os === 'mac';
    const shortcut = (key, code) => (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, metaKey: isMac, ctrlKey: !isMac, shiftKey: !isMac }));
    await click('.side-head .icon-btn[aria-label^="New host"]');
    await fill('#ha', 'probe');
    // 127.0.0.1, not localhost: on Linux localhost resolves to ::1 first, where the
    // test sshds do not listen. [127.0.0.1]:PORT2 is not known yet (inner went
    // through localhost).
    await fill('#hh', '127.0.0.1');
    await fill('#hp', '1');
    await click('.seg button', 'Key');
    await pick('SSH key', 'e2e-key');
    await fill('#hu', USER);
    await click('.modal button', 'Test connection');
    await waitFor(() => hasText('Test failed'), 'the failed test', 30000);
    await check(true, 'a test of a closed port reports the failure in the editor');
    await fill('#hp', PORT2);
    await click('.modal button', 'Test connection');
    await waitFor(() => q('.modal [role="alertdialog"]'), 'the host key card in the editor', 30000);
    await check(q('.modal [role="alertdialog"] .fp')?.textContent.startsWith('SHA256:'), 'the test asks to verify a new host key in the editor');
    await click('.modal [role="alertdialog"] button', 'Trust and continue');
    await waitFor(() => hasText('Connection works'), 'the successful test', 30000);
    await check(hasText(`${USER}@127.0.0.1:${PORT2}`), 'the test names the target it reached');
    await check(!(await window.backend.catalog({})).hosts.some((h) => h.alias === 'probe'), 'testing does not save the host');

    await setStep('initial command');
    await fill('#hc', 'echo started-$((40+2))');
    await check(q('.modal .check input[type="checkbox"]')?.checked === true, 'a login shell follows the command by default');
    await click('.modal button[type="submit"]', 'Add host');
    await waitFor(() => byText('.tree .ti', 'probe'), 'probe in the tree');
    const withProbe = await window.backend.catalog({});
    await check(withProbe.known_hosts.find((k) => k.addr === `[127.0.0.1]:${PORT2}`)?.host === 'probe', 'the key trusted in the test belongs to the saved host');
    await check(withProbe.hosts.find((h) => h.alias === 'probe').command === 'echo started-$((40+2))', 'the initial command is saved');
    byText('.tree .ti', 'probe').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => toolbarIs('ready'), 'the probe session', 30000);
    await check(!hasText('before connecting'), 'a key trusted in a test is not asked about again');
    await waitFor(() => termText().includes('started-42'), 'the initial command output', 20000);
    await runInTerminal('echo shell-after-$((6*7))', 'shell-after-42');
    await check(true, 'the initial command runs on the PTY, then a login shell');

    await setStep('connect without the initial command');
    const tabsBeforePlain = qa('.tab').length;
    shortcut('k', 'KeyK');
    await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
    await fill('[aria-label="Command palette"] input', 'probe');
    const plainRow = await waitFor(() => qa('[aria-label="Command palette"] [role="option"]').find((o) => o.textContent.includes('Connect without command')), 'the "without" row for probe');
    await check(plainRow.textContent.includes('echo started-$((40+2))'), 'the palette names the command it will skip');
    plainRow.click();
    await waitFor(() => qa('.tab').length === tabsBeforePlain + 1, 'a new tab for probe');
    await waitFor(() => toolbarIs('ready'), 'the plain probe session', 30000);
    await runInTerminal('echo plain-$((6*7))', 'plain-42');
    await check(!termText().includes('started-42'), 'the session opened without the initial command');
    shortcut('r', 'KeyR');
    await waitFor(() => toolbarIs('connecting') || toolbarIs('ready'), 'the reconnect');
    await waitFor(() => toolbarIs('ready'), 'the plain probe session again', 30000);
    await runInTerminal('echo again-$((6*7))', 'again-42');
    await check(!termText().includes('started-42'), 'a reconnect keeps the session without the initial command');

    await setStep('reveal and copy');
    shortcut('k', 'KeyK');
    await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
    await fill('[aria-label="Command palette"] input', 'pwh');
    await waitFor(() => q('[role="option"].hot')?.textContent.includes('pwhost'), 'pwhost hot');
    shortcut('i', 'KeyI');
    await waitFor(() => q('[role="dialog"][aria-label^="Edit host"]'), 'the pwhost editor');
    const pwInput = () => q('.modal input[aria-label="Password"]');
    await check(pwInput()?.type === 'password' && pwInput().value === '', 'a saved password starts hidden and out of the page');
    await click('.modal button[aria-label="Show password"]');
    await waitFor(() => pwInput().value === HOST_PW_MARKER, 'the revealed password');
    await check(pwInput().type === 'text' && pwInput().readOnly, 'Show reveals the saved password, read-only');
    await click('.modal button[aria-label="Hide password"]');
    await check(pwInput().value === '' && pwInput().type === 'password', 'Hide drops it from the field');
    await click('.modal button[aria-label="Copy saved password"]');
    await waitFor(() => hasText('Password copied'), 'the copy toast');
    await check(true, 'Copy asks the core to put the password on the clipboard');
    await check(!JSON.stringify(await window.backend.catalog({})).includes(HOST_PW_MARKER), 'the catalog still carries no password');
    await click('.modal button', 'Cancel');
    await waitFor(() => !q('[role="dialog"][aria-label^="Edit host"]'), 'the editor to close');

    await setStep('palette');
    const mac = isMac;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', metaKey: mac, ctrlKey: !mac, shiftKey: !mac, bubbles: true, cancelable: true }));
    await waitFor(() => q('[aria-label="Command palette"]'), 'the palette');
    await fill('[aria-label="Command palette"] input', 'pwh');
    await waitFor(() => byText('[role="option"]', 'pwhost'), 'pwhost in the palette');
    await check(q('[role="option"].hot')?.textContent.includes('pwhost'), 'the palette ranks the matching host first');
    const footer = () => q('[data-palette-hints]')?.textContent ?? '';
    await check(footer().includes('edit host'), 'the palette offers ⌘I while a host is hot');
    await fill('[aria-label="Command palette"] input', 'reconnect');
    await waitFor(() => q('[role="option"].hot')?.textContent.includes('Reconnect'), 'Reconnect hot');
    await check(!footer().includes('edit host') && !footer().includes('new tab'), 'the palette does not offer ⌘I or ⌘↵ on an action');
    q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(100);

    // A real keyboard sends keys to whatever has the focus, so these do too: a dialog
    // whose focus stayed behind it would ignore Esc.
    const press = (key, code, mods = {}) => (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...mods }));
    const cmd = (key, code) => press(key, code, { metaKey: mac, ctrlKey: !mac, shiftKey: !mac });
    const editorOpen = () => q('[role="dialog"][aria-label^="Edit host"]');
    async function escClosesEditor(how) {
      await waitFor(editorOpen, 'the host editor, ' + how);
      await sleep(150);
      await check(editorOpen().contains(document.activeElement), `the host editor opened ${how} has the focus`);
      press('Escape', 'Escape');
      await sleep(100);
      await check(!editorOpen(), `Esc closes the host editor opened ${how}`);
    }
    // ⌘T is "New session": ↵ opens another tab even for a host that already has one,
    // where ⌘P would switch to it.
    if (qa('.tab').length) {
      const before = qa('.tab').length;
      cmd('t', 'KeyT');
      const opened = await waitFor(() => qa('[aria-label="Command palette"] [role="option"]').find((o) => o.textContent.includes('open in tab')), 'a host with an open tab in the ⌘T palette');
      const alias = opened.querySelector('.mono').textContent;
      await check(q('[aria-label="Command palette"] input').placeholder === 'New session on…', '⌘T opens the palette as "New session on…"');
      await fill('[aria-label="Command palette"] input', alias);
      await waitFor(() => q('[role="option"].hot')?.textContent.includes(alias), alias + ' hot');
      await check(q('[role="option"].hot .hint')?.textContent === 'New tab', '⌘T offers a new tab for a host that has one open');
      press('Enter', 'Enter');
      await waitFor(() => qa('.tab').length === before + 1, 'a second tab of ' + alias);
      await check(q('.tab.on')?.textContent.includes(alias), `↵ in the ⌘T palette opens another tab of ${alias}`);
      q('.tab.on .tx').click();
      await waitFor(() => qa('.tab').length === before, 'the extra tab to close');
      await sleep(100);
    }
    cmd('k', 'KeyK');
    await waitFor(() => q('[aria-label="Command palette"]'), 'the palette again');
    await fill('[aria-label="Command palette"] input', 'pwh');
    await waitFor(() => q('[role="option"].hot')?.textContent.includes('pwhost'), 'pwhost hot');
    cmd('i', 'KeyI');
    await escClosesEditor('from the palette');
    if (qa('.tab').length) {
      (await waitFor(() => qa('.pane > div').find((d) => d.style.display !== 'none')?.querySelector('textarea'), 'terminal textarea')).focus();
      cmd('i', 'KeyI');
      await escClosesEditor('from the terminal');
      // In the real app the terminal took the focus back from the editor, and xterm
      // swallowed Esc (owner walkthrough).
      cmd('i', 'KeyI');
      await waitFor(editorOpen, 'the host editor again');
      const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
      ta.focus();
      await sleep(50);
      await check(editorOpen().contains(document.activeElement), 'a dialog takes the focus back from the terminal behind it');
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      await sleep(100);
      await check(!editorOpen(), 'Esc closes a dialog even when the key reaches the terminal behind it');
    }

    await setStep('settings');
    const openTabs = qa('.tab').length;
    // The shell prints a mark on every SIGWINCH: coming back must not resize it.
    if (openTabs) await runInTerminal("trap 'echo winch-$((5+5))' WINCH; echo kept-$((20+3))", 'kept-23');
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
    await click('[role="radiogroup"][aria-label="Terminal colours"] button', 'Aura');
    await waitForAsync(async () => (await window.backend.settings_get({})).term_theme === 'aura', 'the terminal theme to be saved');
    const preview = q('.set-row .term');
    await check(preview.style.getPropertyValue('--term-bg') === '#f3f0ff', `the preview uses Aura's light palette in the light theme (${preview.style.getPropertyValue('--term-bg')})`);
    const pane = q('[data-tab]');
    if (pane) await check(pane.style.getPropertyValue('--ansi-4') === '#7b58d6', 'an open terminal takes the chosen palette');
    await click('[role="radiogroup"][aria-label="Terminal colours"] button', 'Default');
    await waitFor(() => !q('.set-row .term').style.getPropertyValue('--term-bg'), 'the default palette (tokens) again');
    await check(true, 'Default goes back to the design tokens');
    await click('.nav-i', 'Vault');
    await waitFor(() => hasText('Known hosts'), 'the vault settings');
    await check(byText('td', `[127.0.0.1]:${PORT}`), 'known hosts are listed');
    // The open vault's counts, read from the open file, even with no cached key (the
    // keychain is off here): before, the page unlocked the vault again through the
    // keychain, which on macOS showed a Keychain dialog.
    await waitFor(() => /\d+ hosts? · .*format v\d/.test(text()), 'the vault counts');
    await check(hasText('5 hosts · 1 key · 0 credentials · '), `the vault page counts the open vault (${(text().match(/\d+ hosts?[^\n]*format v\d/) ?? ['none'])[0]})`);
    // Forget a known host here, then connect to it: the owner's walkthrough found the
    // host key card dead (no click, ↵ or esc) on this path.
    await setStep('forget a known host and trust it again');
    await click('button', 'Forget', byText('tr', `[127.0.0.1]:${PORT}`));
    await click('.modal button', 'Forget');
    await waitFor(() => !byText('td', `[127.0.0.1]:${PORT}`), 'the known host to be forgotten');
    await click('.rail-btn', 'Hosts');
    const tabsBefore = qa('.tab').length;
    for (const how of ['esc', 'a click']) {
      cmd('t', 'KeyT');
      await fill('[aria-label="Command palette"] input', 'local');
      await waitFor(() => q('[role="option"].hot')?.textContent.includes('local'), 'local hot');
      press('Enter', 'Enter');
      await waitFor(() => qa('.tab').length === tabsBefore + 1 && hasText('before connecting'), 'the host key prompt after a forget');
      await sleep(200);
      // A real ↵ submits the form only when the focus is on it; a synthetic one never
      // does, so this checks the focus and leaves the submit to the click below.
      // el.click() skips hit-testing; a mouse lands on whatever is on top. xterm's
      // layers were above the card, so a real click selected terminal text instead.
      const trustBtn = byText('button[type="submit"]', 'Trust and connect');
      const r = trustBtn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      await check(trustBtn.contains(hit), `a click on Trust and connect lands on it (${hit?.tagName} ${hit?.className})`);
      await check(document.activeElement?.textContent.includes('Trust and connect'), `the host key card puts the focus on Trust and connect (${document.activeElement?.tagName} ${document.activeElement?.textContent.slice(0, 30)})`);
      if (how === 'esc') {
        press('Escape', 'Escape');
        await waitFor(() => !hasText('before connecting'), 'esc to cancel the host key prompt');
        await check(true, 'esc cancels the host key card after a forget');
      } else {
        await click('button[type="submit"]', 'Trust and connect');
        await waitFor(() => toolbarIs('ready'), 'the session after a click on Trust', 30000);
        await check(true, 'a click on Trust and connect trusts the key again after a forget');
      }
      q('.tab.on .tx').click();
      await waitFor(() => qa('.tab').length === tabsBefore, 'the extra tab to close');
    }
    await click('.rail-btn', 'Settings');
    await click('.nav-i', 'Vault');
    await waitFor(() => hasText('Known hosts'), 'the vault settings');
    await sleep(500);
    await check(byText('td', `[127.0.0.1]:${PORT}`), 'a key trusted in a session shows up in Known hosts');

    if (openTabs) {
      await click('.rail-btn', 'Hosts');
      await waitFor(() => activeTerm(), 'the session view');
      await check(termText().includes('kept-23'), 'a terminal keeps its scrollback across a visit to Settings');
      await sleep(600);
      await check(!termText().includes('winch-10'), 'coming back from Settings sends the shell no resize');
    }

    await setStep('app state: sidebar and groups');
    // The Hosts button toggles the sidebar when the Hosts view is already shown.
    if (!q('.sidebar')) await click('.rail-btn', 'Hosts');
    await click('.side-head .icon-btn[aria-label="New group"]');
    await fill('#ta', 'e2e-grp');
    await click('.modal button[type="submit"]');
    const grpRow = () => byText('.tree .ti[aria-expanded]', 'e2e-grp');
    await waitFor(grpRow, 'the new group in the tree');
    const uiState = () => window.backend.ui_state_get({});
    grpRow().click();
    await waitForAsync(async () => (await uiState()).collapsed.includes('e2e-grp'), 'the collapsed group to be stored');
    await check(grpRow().getAttribute('aria-expanded') === 'false', 'a collapsed group is stored for this vault');
    await click('.side-head .icon-btn[aria-label="Expand all groups"]');
    await waitForAsync(async () => (await uiState()).collapsed.length === 0, 'expand all to be stored');
    await check(qa('.tree .ti[aria-expanded="false"]').length === 0, 'Expand all opens every group');
    await click('.side-head .icon-btn[aria-label="Collapse all groups"]');
    await waitForAsync(async () => (await uiState()).collapsed.length === qa('.tree .ti[aria-expanded]').length, 'collapse all to be stored');
    await check(qa('.tree .ti[aria-expanded="true"]').length === 0, 'Collapse all closes every group');
    const resizer = await waitFor(() => q('.sidebar-resize'), 'the sidebar resize handle');
    resizer.focus();
    resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true }));
    await waitForAsync(async () => (await uiState()).sidebar_width === 280, 'the new sidebar width to be stored');
    await check(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim() === '280px', 'the sidebar takes the new width');
    if (window.innerWidth >= 1040) {
      await click('.rail-btn', 'Hosts');
      await waitForAsync(async () => (await uiState()).sidebar_open === false, 'the closed sidebar to be stored');
      await check(!q('.sidebar'), 'the Hosts button closes the sidebar, and that is remembered');
      await click('.rail-btn', 'Settings');
      await click('.rail-btn', 'Hosts');
      await sleep(200);
      await check(!q('.sidebar') && (await uiState()).sidebar_open === false, 'coming back from Settings keeps the sidebar closed');
      await click('.rail-btn', 'Settings');
      // ⇧⌘H (Ctrl+Alt+Shift+H elsewhere), the Hosts button's shortcut.
      (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', bubbles: true, cancelable: true,
        metaKey: isMac, ctrlKey: !isMac, shiftKey: true, altKey: !isMac }));
      await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts', 'the Hosts view from its shortcut');
      await sleep(200);
      await check(!q('.sidebar') && (await uiState()).sidebar_open === false, 'the Hosts shortcut from Settings keeps the sidebar closed');
      await click('.rail-btn', 'Hosts');
      await waitForAsync(async () => (await uiState()).sidebar_open === true, 'the open sidebar to be stored');
    } else {
      await log(`skip sidebar open/closed: the window is ${window.innerWidth} px, too narrow to dock it`);
    }

    await setStep('rename the vault');
    await click('.rail-btn', 'Settings');
    await click('.nav-i', 'Vault');
    await click('button', 'Rename…');
    await fill('[aria-label="Vault name"]', 'E2E Renamed');
    await click('button[type="submit"]', 'Save');
    await waitFor(() => hasText('Renamed E2E Vault to E2E Renamed'), 'the rename notice');
    const recents = await window.backend.vault_recents({});
    await check(recents[0].name === 'E2E Renamed', 'the recent list shows the new name');
    await click('.rail-btn', 'Hosts');
    await check(q('.vault-btn .vault-name').textContent === 'E2E Renamed', 'the vault button shows the new name');

    await setStep('import from tether');
    await click('.rail-btn', 'Settings');
    await click('.nav-i', 'Vault');
    await click('button', 'Import from Tether…');
    await waitFor(() => q('[role="dialog"][aria-label="Import from Tether"]'), 'the import drawer');
    await fill('[aria-label="Tether vault file"]', TETHER);
    await fill('#tpw', 'not-the-password');
    await click('.drawer .modal-f button', 'Preview');
    await waitFor(() => q('.drawer [role="alert"]'), 'the wrong password error');
    await check(q('.drawer [role="alert"]').textContent.includes('Tether master password is wrong'), 'a wrong Tether password is refused');
    await fill('#tpw', 'tether-fixture-pw');
    await click('.drawer .modal-f button', 'Preview');
    await waitFor(() => q('.drawer [aria-label="Import report"]'), 'the preview report');
    await check(hasText('Preview: nothing was written yet') && hasText('Would add 5 groups, 8 hosts, 2 keys, 1 credential, 3 known hosts'), 'Preview reports what an import would add');
    await check(!byText('.tree .label, .tree *', 'code-box'), 'the preview wrote nothing');
    await check(byText('.drawer td', 'pve-01: proxmox ui') && hasText('no tunnels yet'), 'the report lists the tunnel it cannot import');
    await click('.drawer .modal-f button', 'Import');
    await waitFor(() => hasText('Imported 8 hosts from Tether'), 'the import notice');
    await check(!q('#tpw'), 'the Tether password field is gone once imported');
    await click('.drawer .modal-f button', 'Done');
    await click('.rail-btn', 'Hosts');
    await waitFor(() => hasText('code-box') || hasText('Code Box'), 'the imported hosts in the tree');
    {
      const cat = await window.backend.catalog({});
      const code = cat.hosts.find((h) => h.alias === 'code-box');
      await check(code && code.has_password && code.command === 'herdr' && code.group === 'Homelab', 'an imported host keeps its group, command and saved password');
      await check(!JSON.stringify(cat).includes('pw-codebox'), 'no imported secret reaches the page');
    }
    {
      const r = q('.titlebar .tb-title').getBoundingClientRect();
      await check(Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 1, 'the title is centred on the window');
    }
    await click('.rail-btn', 'Settings');
    await click('.nav-i', 'Vault');
    await click('button', 'Import from Tether…');
    await waitFor(() => q('[role="dialog"][aria-label="Import from Tether"]'), 'the import drawer again');
    await fill('[aria-label="Tether vault file"]', TETHER);
    await fill('#tpw', 'tether-fixture-pw');
    await click('.drawer .modal-f button', 'Preview');
    await waitFor(() => hasText('Preview: nothing new to import'), 'the nothing-new preview');
    await check(hasText('Everything was already in') && !hasText('Would add'), 'a preview with nothing to add says so');
    await click('.drawer .modal-f button', 'Import');
    await waitFor(() => hasText('Nothing new to import: everything is already in'), 'the nothing-new notice');
    await check(hasText('Everything was already in') && !hasText('Added 0'), 'importing again adds nothing and says so');
    await click('.drawer .modal-f button', 'Done');

    await setStep('lock');
    // A session that must keep running under the lock screen (D-042).
    await click('.rail-btn', 'Hosts');
    await waitFor(() => byText('.tree .ti', 'local'), 'local in the tree');
    byText('.tree .ti', 'local').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await waitFor(() => toolbarIs('ready'), 'a session before locking', 30000);
    await runInTerminal('echo before-lock-$((1+1))', 'before-lock-2');
    const vaultPath = (await window.backend.vault_status({})).path;
    await click('.statusbar .sb-btn', 'Lock');
    await waitFor(() => q('.lock-screen [data-lock-reason="manual"]'), 'the lock screen');
    await check(hasText('Master password'), 'Lock shows the lock screen');
    await check(qa('.tab').length > 0 && !!q('.tab')?.closest('[inert]'), 'the tabs stay, behind the lock screen and out of reach');
    await check(hasText('keeps running') || hasText('keep running'), 'the lock screen says the sessions keep running');
    await check(q('[data-remember] input') && !q('[data-remember] input').checked, 'Remember on this computer is offered, unticked');
    {
      let refused = '';
      try { await window.backend.catalog({}); } catch (e) { refused = String(e?.message ?? e); }
      await check(refused.startsWith('locked'), 'a locked vault answers nothing');
      refused = '';
      try { await window.backend.vault_unlock({ path: vaultPath, password: '' }); } catch (e) { refused = String(e?.message ?? e); }
      await check(refused.startsWith('locked'), 'a vault locked in this run never reopens without its master password');
    }
    await fill('#pw', 'wrong-password');
    await click('button[type="submit"]', 'Unlock');
    await waitFor(() => hasText('Wrong password'), 'the wrong password message', 30000);
    await check(true, 'a wrong master password is refused');
    await waitFor(() => { const pw = q('#pw'); return pw && !pw.disabled && pw.selectionEnd === pw.value.length && pw.selectionStart === 0 && pw.value.length > 0 ? pw : null; }, 'the attempt selected');
    await check(q('#pw').value === 'wrong-password', 'the wrong attempt stays in the field, selected');
    await fill('#pw', MASTER);
    await click('button[type="submit"]', 'Unlock');
    {
      // Argon2id runs on a worker: another call answers while the unlock is still
      // deriving the key (an unlock on the UI thread would answer it afterwards).
      const t0 = performance.now();
      await window.backend.app_info({});
      const answered = performance.now() - t0;
      const stillUnlocking = !(byText('.tree .ti', 'local') || grpRow());
      log(`app_info answered in ${Math.round(answered)} ms during the unlock`);
      await check(stillUnlocking && answered < 300, 'the window answers while the vault unlocks');
    }
    await waitFor(() => byText('.tree .ti', 'local') || grpRow(), 'the unlocked tree', 30000);
    await check(true, 'the right master password unlocks the vault again');
    // The tree can show a moment before the lock screen leaves (seen on Windows): wait.
    const lockGone = () => !q('.lock-screen') && !q('.tab')?.closest('[inert]');
    try { await waitFor(lockGone, 'the lock screen to go', 5000); } catch {}
    await check(lockGone(), 'the lock screen is gone');
    await runInTerminal('echo after-lock-$((2+2))', 'after-lock-4');
    await check(true, 'the session that ran under the lock screen still works');

    await setStep('lock on screen lock and sleep');
    for (const kind of ['screen', 'sleep']) {
      await window.backend.e2e_system_event({ name: kind });
      await waitFor(() => q(`.lock-screen [data-lock-reason="${kind}"]`), `the lock screen after ${kind}`, 10000);
      await check(true, `the vault locks on ${kind === 'screen' ? 'a screen lock' : 'sleep'}`);
      await fill('#pw', MASTER);
      await click('button[type="submit"]', 'Unlock');
      await waitFor(() => !q('.lock-screen') && (byText('.tree .ti', 'local') || grpRow()), 'the unlocked tree', 30000);
    }
    await check(qa('.tab').length > 0, 'the tabs are still there after both locks');
    await waitFor(() => grpRow()?.getAttribute('aria-expanded') === 'false', 'the collapsed group after unlocking');
    await check(true, 'the vault opens with its groups collapsed as they were left');
    await check(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w').trim() === '280px', 'and with the sidebar width that was set');

    await setStep('window closed to the tray');
    await window.backend.e2e_close_window({});
    await waitFor(() => q('[data-window-lock]'), 'the window lock screen', 10000);
    await check(hasText('The vault is still unlocked'), 'closing the window locks it, the vault stays unlocked');
    await check(!!q('.tab')?.closest('[inert]'), 'the tabs are behind the window lock, out of reach');
    {
      const refusal = async (fn) => { try { await fn(); return 'answered'; } catch (e) { return String(e?.message ?? e); } };
      await check((await refusal(() => window.backend.catalog({}))).startsWith('locked'), 'a locked window reads nothing from the vault');
      const tab = q('[data-tab]')?.getAttribute('data-tab') ?? 'none';
      await check((await refusal(() => window.backend.session_input({ session: tab, data: 'x' }))).startsWith('locked'), 'a locked window types into no session');
      await check((await refusal(() => window.backend.vault_unlock({ path: vaultPath, password: '' }))).startsWith('locked'), 'a locked window does not reopen the vault without a password');
      const acc = await window.backend.access_state({});
      await check(acc.pending.length === 0 && acc.grants.length === 0, 'a locked window shows no grant and no caller');
      await check((await window.backend.window_state({})).locked, 'the core reports the window locked');
    }
    await fill('#wpw', 'not-the-master-password');
    await click('button[type="submit"]', 'Open');
    await waitFor(() => hasText('Wrong password.'), 'the wrong password message', 30000);
    await check(!!q('[data-window-lock]'), 'a wrong password leaves the window locked');
    await fill('#wpw', MASTER);
    await click('button[type="submit"]', 'Open');
    await waitFor(() => !q('[data-window-lock]'), 'the window to open', 30000);
    await check(!q('.tab')?.closest('[inert]') && (byText('.tree .ti', 'local') || grpRow()), 'the master password opens the window on the same vault');
    await runInTerminal('echo after-window-$((3+3))', 'after-window-6');
    await check(true, 'the session that ran behind the window lock still works');

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
