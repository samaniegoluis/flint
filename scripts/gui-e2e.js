// Headless end-to-end run of the desktop app, driven through its real UI.
// scripts/gui-e2e.sh fills in the @@…@@ values and runs the app with FLINT_GUI_E2E;
// the app loads this file once the page has started (ui/src/App.tsx).
(async () => {
  const VAULT = '@@VAULT@@';
  const PORT = '@@PORT@@';
  const PORT2 = '@@PORT2@@';
  const PORT3 = '@@PORT3@@';
  // A free port on 127.0.0.1 for the tunnels step (milestone 23).
  const TPORT = '@@TPORT@@';
  const USER = '@@USER@@';
  const KEY = `@@KEY@@`;
  // gui-e2e.sh runs the app once per run, each on a fresh vault and config folder:
  // every run creates the vault and connects to `local`, then does only its own steps.
  // A failure names its run, and one run can be repeated alone (scripts/repeat.sh).
  //   terminal  the shell, files, a jump host, tabs, copy between servers, split panes,
  //             a changed host key
  //   vault     test connection, initial command, palette, settings, known hosts,
  //             sidebar and groups, rename, lock, the tray
  //   tunnels   tunnels in the app (milestone 23)
  //   paste     an image pasted into the terminal lands on the server (milestone 25)
  //   vim       vim in the terminal
  const RUN = '@@RUN@@';
  const RUNS = ['terminal', 'vault', 'tunnels', 'paste', 'vim'];
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
  // The active tab's focused pane (milestone 20: a tab holds up to four).
  const activeRegion = () => qa('.pane > div').find((d) => d.style.display !== 'none');
  const activePane = () => { const r = activeRegion(); return r?.querySelector('.spane.focus') ?? r?.querySelector('.spane') ?? r; };
  const activeTerm = () => {
    const tab = q('.tab.on');
    const region = activePane();
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
    const ta = await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea');
    ta.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', data);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    await sleep(50);
  }
  async function enter() {
    // A paste of "\r" is turned into Enter by xterm's bracketed-paste-free path.
    const t = activeTerm();
    const ta = activePane().querySelector('textarea');
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
    if (!RUNS.includes(RUN)) throw new Error(`unknown run "${RUN}"`);
    await log('run: ' + RUN);
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

    if (RUN === 'vim') {
      await setStep('vim');
      // A full-screen editor queries the terminal at start (DECRQM, XTGETTCAP, DA2…).
      // A reply that throws inside xterm.js stops its write queue: the editor still
      // gets every key but the screen never changes again (vite.config.ts, target).
      const key = (k, code, keyCode) => {
        const ta = activePane().querySelector('textarea');
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
      // Keys sent while vim is still quitting are lost: the tty changes mode under them
      // (seen on Windows, 2026-11-09: the cat never ran). Wait, as a person would, for
      // vim to leave the alternate screen and the shell's prompt to settle.
      await waitFor(() => activeTerm().buffer.active.type === 'normal', 'vim to quit');
      for (let screen = '', t0 = Date.now(); termText() !== screen && Date.now() - t0 < 10000; ) {
        screen = termText();
        await sleep(300);
      }
      await runInTerminal('cat /tmp/flint-e2e-vim.txt; echo vim-$((6*7))', 'vim-42');
      await check(/^hello$/m.test(termText()), 'keys typed in vim reach it (insert, Esc, :wq)' + (/^hello$/m.test(termText()) ? '' : ' — terminal: ' + termText().split('\n').filter((l) => l.trim()).slice(-6).join(' | ')));
    }

    if (RUN === 'terminal') {
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
        const ta = activePane().querySelector('textarea');
        t.input("it'", true); // what xterm sends for the committed composition
        ta.dispatchEvent(new CompositionEvent('compositionend', { data: "'", bubbles: true }));
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: "'s", code: 'KeyS', keyCode: 222, bubbles: true, cancelable: true }));
        await sleep(100);
        t.input('\r', true);
      }
      await waitFor(() => termText().includes('head-done-42'), 'head to finish');
      await runInTerminal('echo "[$(cat /tmp/flint-e2e-dead.txt)]-$((6*7))"', ']-42');
      await check(termText().includes("[it's]"), "a dead ' flushed with s types it's, not it''s");

      await setStep('windows clipboard keys');
      // Windows (windows-port): Shift+Insert and Ctrl+V paste, Ctrl+Insert copies, and
      // Ctrl+C copies while text is selected (lib/clipboardKeys.ts). None of them may
      // reach the remote as a key: Shift+Insert used to arrive as ESC[2;2~ and the shell
      // printed "2~". A synthetic key cannot make the webview paste, so this checks that
      // the remote gets only what is typed after them, and that Ctrl+C over a selection
      // does not interrupt.
      if ((await window.backend.app_info({})).os === 'windows') {
        await runInTerminal('stty -echo; head -n 1 > /tmp/flint-e2e-keys.txt; stty echo; echo keys-done-$((6*7))', '');
        await sleep(300);
        const t = activeTerm();
        const ta = qa('.pane > div').find((d) => d.style.display !== 'none').querySelector('textarea');
        const press = (code, key, mods) => ta.dispatchEvent(new KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...mods }));
        press('Insert', 'Insert', { shiftKey: true });
        press('KeyV', 'v', { ctrlKey: true });
        press('Insert', 'Insert', { ctrlKey: true });
        t.selectAll();
        press('KeyC', 'c', { ctrlKey: true });
        const cleared = !t.hasSelection();
        await sleep(100);
        t.input('typed-after\r', true);
        await waitFor(() => termText().includes('keys-done-42'), 'head to finish');
        await runInTerminal('echo "[$(cat /tmp/flint-e2e-keys.txt)]-keys$((6*7))"', ']-keys42');
        const got = ([...termText().matchAll(/\[([^\]\n]*)\]-keys42/g)].pop() || ['', '?'])[1];
        await check(got === 'typed-after', 'Shift+Insert, Ctrl+V, Ctrl+Insert and Ctrl+C over a selection send nothing to the remote' + (got === 'typed-after' ? '' : ` — the remote read [${JSON.stringify(got)}]`));
        await check(cleared, 'Ctrl+C over a selection copies and clears it, so the next Ctrl+C interrupts');
      } else {
        await log('skip windows clipboard keys: not Windows');
      }

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
        // A narrow window (under 1040 px) lays the sidebar over the terminal: it must be
        // drawn whole there, the top-most thing at its centre (milestone 21).
        const overTerminal = (sel) => {
          const el = q(sel);
          const r = el?.getBoundingClientRect();
          if (!r || r.height < 300) return false;
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return el.contains(at) && getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
        };
        // The headless window cannot be resized (CF-111), so the page is told it is 900 px
        // wide: the shell lays the sidebar out by window.innerWidth.
        const width = Object.getOwnPropertyDescriptor(window, 'innerWidth');
        const setWidth = (w) => {
          if (w) Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => w });
          else if (width) Object.defineProperty(window, 'innerWidth', width);
          else delete window.innerWidth;
          window.dispatchEvent(new Event('resize'));
        };
        setWidth(900);
        await waitFor(() => document.querySelector('.app')?.dataset.narrow === 'true', 'the narrow layout', 10000);
        await click('.rail-btn', 'Files');
        await waitFor(() => overTerminal('.sidebar[data-for="files"]'), 'the Files view drawn over the terminal in a narrow window', 10000);
        await check(true, 'in a narrow window the Files view is drawn whole, over the terminal');
        await click('.rail-btn', 'Hosts');
        await waitFor(() => overTerminal('.sidebar[data-for="hosts"]'), 'the Hosts view drawn over the terminal in a narrow window', 10000);
        await check(true, 'in a narrow window the Hosts view is drawn whole, over the terminal');
        setWidth(0);
        await waitFor(() => document.querySelector('.app')?.dataset.narrow === 'false', 'the wide layout again', 10000);
        await runInTerminal(`rm -rf ${dir}; cd; echo files-clean-$((6*7))`, 'files-clean-42');
        if (document.querySelector('.app')?.dataset.view !== 'hosts' || !q('.sidebar[data-for="hosts"]')) await click('.rail-btn', 'Hosts');
        await waitFor(() => document.querySelector('.app')?.dataset.view === 'hosts' && q('.sidebar[data-for="hosts"]'), 'back to the Hosts view');
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

      await setStep('split panes');
      {
        const mac = (await window.backend.app_info({})).os === 'mac';
        // App chords where the terminal has the focus: ⌘ is Ctrl+Shift on Linux, ⇧⌘ is
        // Ctrl+Alt+Shift and ⌥⌘ is Ctrl+Alt.
        const send = (code, layer = '') => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', {
          key: '', code, bubbles: true, cancelable: true,
          ...(mac ? { metaKey: true, shiftKey: layer === 'shift', altKey: layer === 'alt' }
            : { ctrlKey: true, shiftKey: layer !== 'alt', altKey: layer !== '' }),
        }));
        const panes = () => qa('.spane', activeRegion());
        const grid = () => activeRegion()?.querySelector('.splits');
        const sessionCount = () => Number((q('.statusbar')?.textContent.match(/(\d+) sessions?/) ?? [0, 0])[1]);
        const paneTerm = (el) => window.__flintE2E.terms[el.querySelector('[data-tab]').getAttribute('data-tab')];
        const termOf = (el) => { const b = paneTerm(el).buffer.active; const out = []; for (let i = 0; i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? ''); return out.join('\n'); };
        await click('.tab', 'local');
        await waitFor(() => toolbarIs('ready'), 'the local tab');
        const tabsBefore = qa('.tab').length;
        const sessionsBefore = sessionCount();
        (await waitFor(() => activePane()?.querySelector('textarea'), 'terminal')).focus();
        send('KeyD', 'alt');
        await waitFor(() => qa('.tab').length === tabsBefore + 1 && toolbarIs('ready'), 'a duplicated tab', 30000);
        await check(q('.tab.on')?.textContent.includes('local'), 'Duplicate moved to ⌥⌘D (Ctrl+Alt+D) and opens a new tab of the host');
        await check(q('[data-split-button]') && !q('[data-split-button]').getAttribute('aria-disabled'), "the toolbar's Split button is on");

        activePane().querySelector('textarea').focus();
        send('KeyD');
        await waitFor(() => panes().length === 2, 'a second pane');
        await check(grid().classList.contains('multi') && grid().style.gridTemplateColumns.split('fr').length - 1 === 2 && qa('.tab').length === tabsBefore + 1,
          '⌘D (Ctrl+Shift+D) splits the tab right, in the same tab');
        await check(panes()[1].classList.contains('focus') && q('[data-pane-badge]')?.textContent === 'pane 2 of 2' && /2/.test(q('.tab.on .tab-split')?.textContent ?? ''),
          'the new pane has the focus, the toolbar says "pane 2 of 2" and the tab shows two panes');
        await waitFor(() => toolbarIs('ready'), 'the second pane connected', 30000);
        await runInTerminal('echo pane-two-$$-$((6*7))', 'pane-two-');
        const pid = await waitFor(() => (termText().match(/pane-two-(\d+)-42/) ?? [])[1], "pane two's shell pid");
        await check(!termOf(panes()[0]).includes('pane-two-'), 'each pane is its own session with its own scrollback');
        await check(getComputedStyle(panes()[0].querySelector('[data-tab]')).opacity === '0.6' && getComputedStyle(panes()[1].querySelector('[data-tab]')).opacity === '1',
          "the other pane's output is dimmed to 60 %");
        await check(sessionCount() === sessionsBefore + 2, 'the status bar counts each pane as a session');

        send('KeyD', 'shift');
        await waitFor(() => panes().length === 3, 'a third pane');
        await check(panes()[0].style.gridRow.includes('span 2'), '⇧⌘D with three panes makes one large + two small');
        await waitFor(() => toolbarIs('ready'), 'the third pane connected', 30000);

        // The palette's ⇧⌘↵ opens a host in a new pane (18e).
        send('KeyK');
        await fill('.palette input', 'inner');
        await waitFor(() => q('[data-palette-hints]')?.textContent.includes('new pane'), 'the new pane hint');
        await check(byText('[role="option"]', 'in a new pane'), 'the palette offers "Open inner in a new pane"');
        q('.palette input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, metaKey: mac, ctrlKey: !mac, shiftKey: true }));
        await waitFor(() => panes().length === 4, 'a fourth pane');
        await check(grid().style.gridTemplateRows.split('fr').length - 1 === 2 && panes()[3].textContent.includes('inner'), "⇧⌘↵ in the palette opens the host in a new pane; four make a grid");
        await waitFor(() => toolbarIs('ready'), 'inner connected in its pane', 30000);
        activePane().querySelector('textarea').focus();
        send('KeyD');
        await sleep(200);
        await check(panes().length === 4 && hasText('A tab holds up to 4 panes'), 'a fifth pane is refused with a note');

        send('Digit1', 'alt');
        await waitFor(() => grid().style.gridTemplateColumns.split('fr').length - 1 === 4, 'side by side');
        await check(true, '⌥⌘1 (Ctrl+Alt+1) lays the four panes side by side');
        send('Digit3', 'alt');
        await waitFor(() => grid().style.gridTemplateRows.split('fr').length - 1 === 2, 'the grid again');
        await check(true, '⌥⌘3 (Ctrl+Alt+3) puts them back in a grid');

        send('BracketLeft');
        await waitFor(() => panes()[2].classList.contains('focus'), 'focus on pane 3');
        send('BracketRight');
        send('BracketRight');
        await waitFor(() => panes()[0].classList.contains('focus'), 'focus wraps to pane 1');
        await check(q('[data-pane-badge]')?.textContent === 'pane 1 of 4', '⌘[ and ⌘] move the focus between panes, wrapping around');
        panes()[3].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => panes()[3].classList.contains('focus'), 'a click focuses pane 4');
        await check(q('.toolbar .mono.strong')?.textContent === 'inner', 'a click focuses a pane, and the toolbar follows it');

        await click('[data-toolbar-files]');
        await waitFor(() => q('[data-files-host]')?.textContent === 'inner', 'Files on inner');
        await check(q('[data-files-pane-no]')?.textContent === '4', "the Files view follows the focused pane and carries its number (18g)");
        panes()[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => q('[data-files-host]')?.textContent === 'local' && q('[data-files-pane-no]')?.textContent === '2', 'Files follows to pane 2');
        await check(true, 'focusing another pane moves the Files view to it');
        await click('[data-toolbar-files]');
        await click('.rail-btn', 'Hosts');

        const div = q('.sp-div.cols', activeRegion());
        const before = grid().style.gridTemplateColumns;
        div.focus();
        div.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        await waitFor(() => grid().style.gridTemplateColumns !== before, 'the columns resized');
        await check(/0\.55fr/.test(grid().style.gridTemplateColumns), 'a divider resizes the panes beside it');
        div.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => grid().style.gridTemplateColumns === before, 'evened out');
        await check(true, 'a double-click on a divider evens the panes out');

        // Close pane 2 with its ×: only its session hangs up.
        panes()[1].querySelector('.sp-x').click();
        await waitFor(() => panes().length === 3, 'three panes');
        await check(sessionCount() === sessionsBefore + 3, 'closing a pane hangs up its session');
        panes()[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await waitFor(() => panes()[0].classList.contains('focus'), 'pane 1 focused');
        // A process that has exited but is not reaped yet still answers kill -0: look at its state.
        await runInTerminal(`for i in $(seq 1 30); do s=$(ps -o stat= -p ${pid} 2>/dev/null); case "$s" in ''|Z*) break;; esac; sleep 0.5; done; s=$(ps -o stat= -p ${pid} 2>/dev/null); case "$s" in ''|Z*) echo pane-gone-$((40+2));; *) echo pane-still-$((40+1)) "[$s]"; ps -o pid,ppid,stat,args -p ${pid};; esac`, 'pane-');
        await waitFor(() => /pane-(still-41|gone-42)/.test(termText()), 'the check on the closed pane', 25000);
        await check(termText().includes('pane-gone-42'), "the closed pane's shell ended on the host; the other panes keep working" + (termText().includes('pane-gone-42') ? '' : ' — terminal: ' + termText().split('\n').filter((l) => l.trim()).slice(-4).join(' | ')));
        send('KeyW');
        await waitFor(() => panes().length === 2, 'two panes');
        await check(sessionCount() === sessionsBefore + 2, '⌘W closes the focused pane');
        await click('.tab.on .tx');
        await waitFor(() => qa('.tab').length === tabsBefore, 'the split tab closed');
        await check(sessionCount() === sessionsBefore, "closing the tab hangs up every pane's session");
        await click('.tab', 'local');
        await waitFor(() => toolbarIs('ready'), 'back on the local tab');
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
    }

    if (RUN === 'paste') {
      // A paste event as ⌘V hands it: an image file, with or without text beside it.
      const pasteData = async (text, files) => {
        const ta = await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea');
        ta.focus();
        const dt = new DataTransfer();
        if (text !== null) dt.setData('text/plain', text);
        for (const f of files) dt.items.add(f);
        ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(50);
      };
      // A real 1×1 PNG.
      const pngBytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const png = new File([pngBytes], 'Screen Shot e2e.png', { type: 'image/png' });
      const pathRe = /(\/\S*\/\.cache\/flint\/paste\/p-[a-z0-9-]+\/Screen-Shot-e2e\.png)/;
      // The buffer with wrapped rows joined: a long path spans two rows.
      const fullText = () => {
        const b = activeTerm()?.buffer.active;
        if (!b) return '';
        let out = '';
        for (let i = 0; i < b.length; i++) {
          const line = b.getLine(i);
          if (!line) continue;
          out += (i > 0 && !line.isWrapped ? '\n' : '') + line.translateToString(true);
        }
        return out;
      };
      const pathCount = () => (fullText().match(new RegExp(pathRe.source, 'g')) || []).length;

      await setStep('paste: an image');
      // /bin/ls: the login shell may alias ls (eza on the owner's Mac).
      await type('/bin/ls -ln ');
      await pasteData(null, [png]);
      await waitFor(() => hasText('Pasting image to local'), 'the upload notice');
      await check(true, 'pasting an image shows "Pasting image to local…"');
      const pasted = await waitFor(() => fullText().match(pathRe), 'the pasted path in the prompt', 20000);
      const path = pasted[1];
      await check(true, `the image's path on the server is pasted into the prompt (${path})`);
      await type('; echo ls-$((6*7))');
      await enter();
      await waitFor(() => termText().includes('ls-42'), 'the ls of the pasted file');
      // macOS's ls marks extended attributes with '@' after the mode.
      await check(new RegExp(`-rw-------@? +1 +\\d+ +\\d+ +${pngBytes.length} `).test(fullText()), `the file is on the server, mode 0600, ${pngBytes.length} bytes`);
      const folder = path.replace(/\/[^/]+$/, '');
      await runInTerminal(`/bin/ls -ld ${folder} ~/.cache/flint/paste ~/.cache/flint | cut -c1-10 | sort | uniq -c; echo modes-$((6*7))`, 'modes-42');
      await check(/3 drwx------/.test(termText()), 'its folder, the paste folder and ~/.cache/flint are 0700');
      await runInTerminal(`od -An -tx1 -N8 ${path} | tr -s ' '; echo head-$((6*7))`, 'head-42');
      await check(termText().includes(' 89 50 4e 47 0d 0a 1a 0a'), 'the bytes on the server are the pasted image');

      await setStep('paste: an empty paste event reads the clipboard');
      // WebKitGTK hands the page a paste event with nothing in it: the core reads the
      // system clipboard (the run's private board on macOS) and stages the image itself.
      await window.backend.e2e_clipboard_png({ name: btoa(String.fromCharCode(...pngBytes)) });
      const nativeRe = /(\/\S*\/\.cache\/flint\/paste\/p-[a-z0-9-]+\/paste\.png)/;
      await type('/bin/ls -ln ');
      await pasteData(null, []);
      const nativePasted = await waitFor(() => fullText().match(nativeRe), 'the path of the image the core read', 20000);
      await check(true, `an empty paste event pastes the clipboard's image, read by the core (${nativePasted[1]})`);
      await type('; echo native-$((6*7))');
      await enter();
      await waitFor(() => termText().includes('native-42'), 'the ls of the image the core read');
      await check(new RegExp(`-rw-------@? +1 +\\d+ +\\d+ +${pngBytes.length} `).test(fullText().split('native-42')[0].slice(-400)), `it is on the server, mode 0600, ${pngBytes.length} bytes`);
      const nativeFolder = nativePasted[1].replace(/\/[^/]+$/, '');

      await setStep('paste: text wins');
      const before = pathCount();
      await pasteData('echo text-wins-$((6*7))', [png]);
      await enter();
      await waitFor(() => termText().includes('text-wins-42'), 'the pasted text to run');
      await sleep(500);
      await check(pathCount() === before && !hasText('Paste to local failed'), 'a clipboard with text and an image pastes the text, and uploads nothing');

      await setStep('paste: over the limit');
      const big = new File([new Uint8Array(20 * 1048576 + 1)], 'big.png', { type: 'image/png' });
      await pasteData(null, [big]);
      await waitFor(() => hasText('over the 20 MB paste limit'), 'the limit toast');
      await check(hasText('Use Files to upload it'), 'an image over the limit is refused, pointing to Files');

      await setStep('paste: the limit is a setting');
      const saved = await window.backend.settings_get({});
      await check(saved.paste_limit_mb === 20, 'the paste limit defaults to 20 MB');
      await runInTerminal(`rm -rf ${folder} ${nativeFolder}; echo cleaned-$((6*7))`, 'cleaned-42');
    }

    if (RUN === 'tunnels') {
      await setStep('tunnels');
      // Milestone 23 (design 06c, 20): a tunnel saved in the host editor, started from
      // the Tunnels view, used by a second host whose address is the tunnel's port, then
      // the toolbar menu, the palette, a port in use and removing it.
      const tunView = () => q('[data-tunnels-view]');
      const tunState = (name) => q(`[data-tunnel="${name}"]`)?.dataset.state ?? '';
      const tunText = (name) => q(`[data-tunnel="${name}"] [data-tunnel-state]`)?.textContent ?? '';
      await click('.rail-btn', 'Hosts');
      await click('.tab', 'local');
      await waitFor(() => toolbarIs('ready'), 'the local tab');
      await click('[data-toolbar-tunnels]');
      await waitFor(() => q('[data-tunnels-menu]'), 'the toolbar Tunnels menu');
      await check(hasText('No tunnels on this host yet.'), 'the toolbar menu of a host with no tunnels says so');
      await click('[data-tunnels-menu] .mi', 'Add a tunnel…');
      await waitFor(() => q('[data-host-tunnels]'), 'the host editor at its Tunnels section');
      await check(hasText('No tunnels. A tunnel lets an app'), "the editor's Tunnels section has an empty state");
      await click('[data-add-tunnel]');
      await fill('#tun-name', 'fwd');
      await fill('#tun-local', TPORT);
      await fill('[data-tunnel-dialog] input[aria-label="Destination host"]', '127.0.0.1');
      await fill('[data-tunnel-dialog] input[aria-label="Destination port"]', PORT2);
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-host-tunnel="fwd"]'), 'the saved tunnel in the editor');
      await check(q('[data-host-tunnel="fwd"] .mp')?.textContent === `127.0.0.1:${TPORT}→127.0.0.1:${PORT2}`, 'the editor lists the tunnel as 127.0.0.1:port → destination');
      await click('[data-add-tunnel]');
      await fill('#tun-name', 'FWD');
      await fill('#tun-local', PORT);
      await waitFor(() => q('[data-shared-port]') || true, 'a moment');
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-tunnel-dialog] .ferr[role="alert"]'), 'the name error');
      await check(/already has a tunnel named FWD/.test(q('[data-tunnel-dialog] .ferr').textContent), 'a name used on the host is refused inline, whatever its case');
      await fill('#tun-name', 'busy');
      await click('[data-tunnel-dialog] button[type="submit"]');
      await waitFor(() => q('[data-host-tunnel="busy"]'), 'the second tunnel');
      await click('.modal button', 'Cancel');
      await waitFor(() => !q('[data-host-tunnels]'), 'the editor to close');

      await click('.rail-btn', 'Tunnels');
      await waitFor(() => tunView() && q('[data-tunnel="fwd"]'), 'the Tunnels view');
      await check(q('[data-tunnel-host="local"]') && tunText('fwd') === 'stopped', 'the Tunnels view lists the host\'s tunnels, stopped');
      await click('[data-tunnel-switch="fwd"]');
      await waitFor(() => tunState('fwd') === 'ok', 'fwd listening', 30000);
      await check(tunText('fwd') === 'listening · no connections', 'the switch starts the tunnel on its own session: "listening · no connections"');
      await waitFor(() => q('[data-tunnels-badge]')?.textContent === '1' && q('[data-tunnels-status]') && q('.tab [data-tun-mark="local"]'), 'the marks');
      await check(true, 'the rail badge, the status bar and the tab mark show 1 tunnel up');
      await click('[data-tunnel-switch="busy"]');
      await waitFor(() => tunState('busy') === 'warn', 'busy refused', 30000);
      await check(/^port \d+ in use · by another program$/.test(tunText('busy')), 'a port in use shows as such: ' + tunText('busy'));

      // A host whose address is the tunnel: its shell proves bytes go through.
      await click('.rail-btn', 'Hosts');
      await click('.side-head .icon-btn[aria-label^="New host"]');
      await fill('#ha', 'through');
      await fill('#hh', '127.0.0.1');
      await fill('#hp', TPORT);
      await click('.seg button', 'Key');
      await pick('SSH key', 'e2e-key');
      await fill('#hu', USER);
      await click('.modal button[type="submit"]', 'Add host');
      await waitFor(() => byText('.tree .ti', 'through'), 'through in the tree');
      byText('.tree .ti', 'through').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await waitFor(() => hasText('before connecting'), 'the host key prompt through the tunnel');
      await click('button[type="submit"]', 'Trust and connect');
      await waitFor(() => toolbarIs('ready'), 'the session through the tunnel', 30000);
      await runInTerminal('echo through-tunnel-ok', 'through-tunnel-ok');
      await check(true, 'a session to 127.0.0.1:<tunnel port> reaches the destination through the tunnel');
      await click('.rail-btn', 'Tunnels');
      await waitFor(() => tunText('fwd') === 'listening · 1 connection', 'one connection', 10000);
      await check(true, 'the Tunnels view counts the live connection');
      await click('.tab.on .tx');
      await waitFor(() => tunText('fwd') === 'listening · no connections', 'the connection to close', 10000);
      await check(true, 'closing that tab closes its connection; the tunnel stays up');

      // The toolbar menu stops it; the palette starts it again.
      await click('.tab', 'local');
      await waitFor(() => toolbarIs('ready'), 'the local tab');
      await check(q('[data-toolbar-tunnels] .tcount')?.textContent === '1', 'the toolbar Tunnels button counts the tunnels up');
      await click('[data-toolbar-tunnels]');
      await click('[data-tunnels-menu-item="fwd"]');
      await waitFor(() => tunState('fwd') === 'idle' && !q('[data-tunnels-badge]'), 'fwd stopped from the menu', 10000);
      await check(q('[data-tunnels-menu-item="fwd"]')?.getAttribute('aria-checked') === 'false', 'the toolbar menu stops a tunnel, and its check clears');
      await click('[data-toolbar-tunnels]');
      await waitFor(() => !q('[data-tunnels-menu]'), 'the menu to close');
      await click('.palette-btn');
      // By the row's own words too ("start fwd"), not only the tunnel's name.
      await fill('[aria-label="Command palette"] input', 'start fwd');
      await waitFor(() => byText('[role="option"]', 'Start tunnel fwd on local'), 'the palette action');
      await check(q('[role="option"].hot')?.textContent.includes('Start tunnel fwd on local'), '"start fwd" puts "Start tunnel fwd on local" first, above Connect with tunnels');
      {
        const input = q('[aria-label="Command palette"] input');
        await check(input.spellcheck === false && input.getAttribute('autocorrect') === 'off', 'the palette field has no spelling correction');
      }
      await click('[role="option"]', 'Start tunnel fwd on local');
      await waitFor(() => tunState('fwd') === 'ok', 'fwd from the palette', 30000);
      await check(true, 'the palette starts a tunnel: "Start tunnel fwd on local"');
      await click('.palette-btn');
      await fill('[aria-label="Command palette"] input', 'stop fwd');
      await waitFor(() => byText('[role="option"]', 'Stop tunnel fwd on local'), 'the stop action');
      await check(true, 'a running tunnel is offered as "Stop tunnel fwd on local", found by "stop fwd"');
      q('[aria-label="Command palette"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
      await waitFor(() => !q('[aria-label="Command palette"]'), 'the palette to close');

      // Removing a running tunnel stops it; the view shows its empty state at the end.
      await click('[data-toolbar-tunnels]');
      await click('[data-tunnels-menu] .mi', 'Manage tunnels…');
      await waitFor(() => q('[data-host-tunnel="fwd"]'), 'the editor');
      await click('[data-host-tunnel="fwd"] button[aria-label="Remove tunnel fwd"]');
      await click('[data-host-tunnel="busy"] button[aria-label="Remove tunnel busy"]');
      await waitFor(() => !q('[data-host-tunnel]'), 'both removed');
      await click('.modal button', 'Cancel');
      // The Tunnels view is still open beside the tab (a click on its rail item would hide it).
      await waitFor(() => q('[data-tunnels-empty]') && !q('[data-tunnels-badge]'), 'the empty Tunnels view', 10000);
      await check(true, 'removing a running tunnel stops it; the Tunnels view shows its empty state');
      const after = await window.backend.tunnels_list({});
      await check(Array.isArray(after) && after.length === 0, 'no tunnel is left saved');
      await click('.rail-btn', 'Hosts');
      byText('.tree .ti', 'through').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 }));
      await click('.menu .mi', 'Delete host');
      await click('.modal button', 'Delete host');
      await waitFor(() => !byText('.tree .ti', 'through'), 'through deleted');
    }

    if (RUN === 'vault') {
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
        (await waitFor(() => activePane()?.querySelector('textarea'), 'terminal textarea')).focus();
        cmd('i', 'KeyI');
        await escClosesEditor('from the terminal');
        // In the real app the terminal took the focus back from the editor, and xterm
        // swallowed Esc (owner walkthrough).
        cmd('i', 'KeyI');
        await waitFor(editorOpen, 'the host editor again');
        const ta = activePane().querySelector('textarea');
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
      await check(hasText('3 hosts · 1 key · 0 credentials · '), `the vault page counts the open vault (${(text().match(/\d+ hosts?[^\n]*format v\d/) ?? ['none'])[0]})`);
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

      {
        const r = q('.titlebar .tb-title').getBoundingClientRect();
        await check(Math.abs(r.left + r.width / 2 - window.innerWidth / 2) <= 1, 'the title is centred on the window');
      }
      await click('.rail-btn', 'Settings');
      await click('.nav-i', 'Vault');
      await waitFor(() => byText('button', 'Rename…'), 'the vault settings');
      await check(!hasText('Import from Tether'), 'Settings → Vault offers no Tether import (milestone 24)');

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
    }

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
