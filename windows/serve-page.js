// The page of the running Flint in windows/serve-e2e.sh (a Windows subset of
// scripts/serve-e2e.js): unlocks the vault through the unlock screen, allows every
// caller the CLI raises (whole vault, every action, until the vault locks, with the
// master password: the run sets FLINT_PRESENCE=password), waits for the CLI to add the
// host `e2e-stop`, then quits.
(async () => {
  const MASTER = '@@MASTER@@';
  const log = (m) => window.backend.e2e_log({ name: String(m) });
  const sleep = (ms) => new Promise((resolve) => {
    const end = performance.now() + ms;
    const ch = new MessageChannel();
    ch.port1.onmessage = () => { if (performance.now() >= end) resolve(); else ch.port2.postMessage(0); };
    ch.port2.postMessage(0);
  });
  async function waitFor(fn, what, ms = 30000) {
    const start = Date.now();
    for (;;) {
      let v;
      try { v = fn(); } catch { v = null; }
      if (v) return v;
      if (Date.now() - start > ms) throw new Error('timed out waiting for ' + what);
      await sleep(50);
    }
  }
  const q = (sel) => document.querySelector(sel);
  const qa = (sel) => [...document.querySelectorAll(sel)];
  const byText = (sel, t) => qa(sel).find((el) => el.textContent.includes(t));
  const setValue = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  (async () => {
    for (;;) {
      await sleep(50);
      const form = q('[data-approval]');
      if (!form || form.dataset.e2eSeen) continue;
      form.dataset.e2eSeen = '1';
      const req = form.querySelector('[data-approval-request]')?.textContent ?? '';
      if (req.includes('deny-me')) { form.querySelector('[data-approval-deny]').click(); log('ok   denied: ' + req); continue; }
      form.querySelector('[data-scope-all]').click();
      await sleep(30);
      for (const a of ['read', 'exec', 'write']) {
        const box = form.querySelector(`[data-action="${a}"]`);
        if (!box.checked) { box.click(); await sleep(10); }
      }
      form.querySelector('[data-duration="lock"]').click();
      await sleep(30);
      setValue(form.querySelector('#approval-pw'), MASTER);
      await sleep(30);
      form.querySelector('[data-approval-allow]').click();
      log('ok   allowed: ' + req);
    }
  })();
  let step = 'unlock';
  try {
    setValue(await waitFor(() => q('#pw'), 'the unlock screen'), MASTER);
    await sleep(30);
    byText('button[type="submit"]', 'Unlock').click();
    await waitFor(() => byText('.tree .ti', 'local-web'), 'the unlocked tree');
    await log('ok   the window unlocks the vault the CLI will use');
    step = 'served changes';
    await waitFor(() => byText('.tree .ti', 'served-web'), 'the host the CLI added', 90000);
    await log('ok   a host added by the CLI shows in the tree without a reload');
    step = 'stop';
    await waitFor(() => byText('.tree .ti', 'e2e-stop'), 'the stop host', 180000);
    await window.backend.e2e_report({ ok: true, detail: '' });
  } catch (e) {
    await log('FAILED at ' + step + ': ' + e.message);
    await window.backend.e2e_report({ ok: false, detail: step + ': ' + e.message });
  }
  window.runtime.Quit();
})();
