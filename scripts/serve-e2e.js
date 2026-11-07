// The app's half of scripts/serve-e2e.sh: unlock the vault through the real unlock
// screen, then wait while the `flint` CLI works on it over the socket, and check
// that the window shows what the CLI changed without being reloaded. The shell adds
// a host named `e2e-stop` last; the page then reports and quits.
(async () => {
  const MASTER = '@@MASTER@@';
  const log = (m) => window.backend.e2e_log({ name: String(m) });
  // Hidden pages have throttled timers (CF-050); MessageChannel posts are not.
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
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
  const q = (sel) => document.querySelector(sel);

  // The owner, for this run (milestone 12): answers every approval the CLI raises.
  // Requests naming "deny-me" are denied, "timeout-me" left unanswered, "scope-me"
  // allowed as the window proposes (that host, read and run, 1 hour); the rest are
  // allowed for the whole vault and every action until the vault locks. Allow takes
  // the master password: the run sets FLINT_PRESENCE=password.
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  (async () => {
    for (;;) {
      await sleep(50);
      const form = document.querySelector('[data-approval]');
      if (!form || form.dataset.e2eSeen) continue;
      form.dataset.e2eSeen = '1';
      const req = form.querySelector('[data-approval-request]')?.textContent ?? '';
      if (req.includes('timeout-me')) { log('ok   left unanswered: ' + req); continue; }
      if (req.includes('deny-me')) { form.querySelector('[data-approval-deny]').click(); log('ok   denied: ' + req); continue; }
      if (!req.includes('scope-me')) {
        form.querySelector('[data-scope-all]').click();
        await sleep(30);
        for (const a of ['read', 'exec', 'write']) {
          const box = form.querySelector(`[data-action="${a}"]`);
          if (!box.checked) { box.click(); await sleep(10); }
        }
        form.querySelector('[data-duration="lock"]').click();
      }
      await sleep(30);
      setValue(form.querySelector('#approval-pw'), MASTER);
      await sleep(30);
      form.querySelector('[data-approval-allow]').click();
      log('ok   allowed: ' + req);
    }
  })();
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const byText = (sel, t) => qa(sel).find((el) => el.textContent.includes(t));
  let passed = 0;
  function check(cond, what) {
    if (!cond) throw new Error('check failed: ' + what);
    passed++;
    return log('ok   ' + what);
  }
  let step = 'unlock';
  try {
    await waitFor(() => q('#pw'), 'the unlock screen');
    const pw = q('#pw');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
    pw.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(30);
    byText('button[type="submit"]', 'Unlock').click();
    await waitFor(() => byText('.tree .ti', 'local-web'), 'the unlocked tree', 30000);
    await check(true, 'the window unlocks the vault the CLI will use');
    await log('ready');

    step = 'served changes';
    await waitFor(() => byText('.tree .ti', 'served-web'), 'the host the CLI added', 90000);
    await check(true, 'a host added by the CLI shows in the tree without a reload');
    await waitFor(() => q('.vault-name')?.textContent === 'Served Renamed', 'the name the CLI gave the vault', 30000);
    await check(true, 'a rename by the CLI shows in the window');

    step = 'locked by the CLI';
    await waitFor(() => q('.lock-screen [data-lock-reason="cli"]'), 'the lock screen after `flint vault lock`', 90000);
    await check(true, '`flint vault lock` locks the window');
    const banner = await waitFor(() => q('[data-unlock-request]'), 'the unlock request of a command', 90000);
    // `flint vault unlock` may ask again before this page looks, naming itself.
    await check(/flint (host list|vault unlock)/.test(banner.textContent), 'a command on the locked vault makes the window ask, naming it');
    {
      const pw = q('#pw');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
      pw.dispatchEvent(new Event('input', { bubbles: true }));
      await sleep(30);
      byText('button[type="submit"]', 'Unlock').click();
    }
    await waitFor(() => !q('.lock-screen') && byText('.tree .ti', 'local-web'), 'the unlocked tree again', 30000);
    await check(!q('[data-unlock-request]'), 'unlocking answers the request');

    step = 'stop';
    // A screen lock sent on D-Bus (Linux check) locks the window here: unlock again.
    let relocks = 0;
    await waitFor(() => {
      const lock = q('.lock-screen [data-lock-reason]');
      if (lock && !q('#pw')?.disabled) {
        relocks++;
        log('ok   the window locked (' + lock.getAttribute('data-lock-reason') + '); unlocking again');
        const pw = q('#pw');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(pw, MASTER);
        pw.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => byText('button[type="submit"]', 'Unlock')?.click(), 30);
        return null;
      }
      return byText('.tree .ti', 'e2e-stop');
    }, 'the stop host', 90000);
    await check(!hasText('served-host-pw-marker'), 'no password the CLI sent reaches the page');

    await log(`${passed} checks passed`);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await log('page text: ' + text().slice(0, 600).replace(/\n+/g, ' | '));
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
