#!/usr/bin/env node
// The checks a diff needs (milestone 85, D-161, D-163). Run through
// scripts/checks-for-diff.sh; docs/checks.md says how it decides and keeps its misses.
//
// How it decides, in short:
//   - src/: each .cf file is cut into top-level declarations (fn, method, type, const,
//     test). A declaration changed when its text without comments changed. A reference
//     graph over the whole tree (`pkg.name` through a file's imports, bare names inside a
//     package, a method through its receiver's type) carries the change to every
//     declaration that can see it. A package with a reached declaration runs its suite;
//     a driver's reached files pick its e2e runs (a table below; a file it does not know
//     runs them all). Native headers reach every declaration of the .cf files that import
//     them.
//   - Systems: a changed line inside `#if defined(_WIN32)` (and the like) counts for the
//     systems it compiles on; a line in a declaration that branches on the system
//     (`os_name()`, a `#if` in a cpp block) counts for all three; other .cf code is
//     portable and counts for the Mac; a native header's unguarded line counts for all
//     three.
//   - Paths outside src/ go through a table. Keys, the vault format, the socket, the
//     window, a migration, build.cf, cfire's pin and the test harness run the whole set;
//     a path the table does not know runs the whole set too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OSES = ['mac', 'linux', 'windows'];
const OS_LABEL = { mac: 'macOS (this Mac)', linux: 'Linux (Docker: scripts/linux-check.sh)', windows: 'Windows (the VM)' };
const GUI_RUNS = ['terminal', 'broadcast', 'vault', 'tunnels', 'paste', 'rdp', 'webgl', 'fullscreen', 'vim', 'clilink', 'update', 'selfupdate'];
const E2E = ['cli', 'serve', 'server', 'sync'];

// ---- git ---------------------------------------------------------------------------

function git(root, args, input) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

// `git cat-file --batch` for many `<rev>:<path>` at once: Map spec → text (null: missing).
function catFiles(root, specs) {
  const out = new Map();
  if (specs.length === 0) return out;
  const buf = execFileSync('git', ['cat-file', '--batch'], { cwd: root, input: specs.join('\n') + '\n', maxBuffer: 1 << 28 });
  let off = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, off);
    const header = buf.subarray(off, nl).toString('utf8');
    off = nl + 1;
    if (header.endsWith(' missing') || header.endsWith(' ambiguous')) { out.set(spec, null); continue; }
    const size = Number(header.split(' ')[2]);
    out.set(spec, buf.subarray(off, off + size).toString('utf8'));
    off += size + 1;
  }
  return out;
}

// The tree the graph is built on: the working tree (head null) or a revision.
function treeFiles(root, head) {
  if (head) return git(root, ['ls-tree', '-r', '--name-only', head]).split('\n').filter(Boolean);
  return git(root, ['ls-files', '-co', '--exclude-standard']).split('\n').filter(Boolean)
    .filter((p) => fs.existsSync(path.join(root, p)));
}

function readTree(root, head, paths) {
  if (head) {
    const m = catFiles(root, paths.map((p) => `${head}:${p}`));
    return new Map(paths.map((p) => [p, m.get(`${head}:${p}`)]));
  }
  return new Map(paths.map((p) => [p, fs.readFileSync(path.join(root, p), 'utf8')]));
}

// Changed files with their changed line numbers: added/modified in the new file,
// removed in the old one.
function readChanges(root, base, head) {
  const mb = git(root, ['merge-base', base, head || 'HEAD']).trim();
  const range = head ? [mb, head] : [mb];
  const text = git(root, ['diff', '--no-renames', '--no-ext-diff', '-U0', ...range]);
  const files = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      cur = { path: m ? m[2] : line, added: new Set(), removed: new Set(), isNew: false, isDeleted: false };
      files.set(cur.path, cur);
    } else if (!cur) {
      continue;
    } else if (line === '--- /dev/null') {
      cur.isNew = true;
    } else if (line === '+++ /dev/null') {
      cur.isDeleted = true;
    } else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!m) continue;
      const [a, b, c, d] = [Number(m[1]), m[2] === undefined ? 1 : Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
      for (let i = 0; i < b; i++) cur.removed.add(a + i);
      for (let i = 0; i < d; i++) cur.added.add(c + i);
    }
  }
  if (!head) {
    for (const p of git(root, ['ls-files', '-o', '--exclude-standard']).split('\n').filter(Boolean)) {
      const n = fs.readFileSync(path.join(root, p), 'utf8').split('\n').length;
      files.set(p, { path: p, added: new Set(Array.from({ length: n }, (_, i) => i + 1)), removed: new Set(), isNew: true, isDeleted: false });
    }
  }
  return { mergeBase: mb, files };
}

// ---- scanning cfire and C++ ----------------------------------------------------------

// Per line: the code without comments, whether it starts inside a raw string or a block
// comment, and whether its comment is a `///` doc comment (doc-tests live there).
function scanLines(text, lang) {
  const out = [];
  let state = 'code';
  for (const raw of text.split('\n')) {
    const start = state;
    let code = '';
    let doc = false;
    for (let i = 0; i < raw.length;) {
      const c = raw[i], n = raw[i + 1];
      if (state === 'block') { if (c === '*' && n === '/') { state = 'code'; i += 2; } else i++; continue; }
      if (state === 'raw') { code += c; if (c === '`') state = 'code'; i++; continue; }
      if (state === 'str') {
        code += c;
        if (c === '\\') { code += n ?? ''; i += 2; continue; }
        if (c === '"') state = 'code';
        i++; continue;
      }
      if (c === '/' && n === '/') { doc = raw.slice(i).startsWith('///'); break; }
      if (c === '/' && n === '*') { state = 'block'; i += 2; continue; }
      if (c === '"') { state = 'str'; code += c; i++; continue; }
      if (c === '`' && lang === 'cf') { state = 'raw'; code += c; i++; continue; }
      if (c === "'") {
        const m = /^'(?:\\.|[^\\'])'/.exec(raw.slice(i));
        if (m) { code += m[0]; i += m[0].length; continue; }
      }
      code += c; i++;
    }
    if (state === 'str') state = 'code';
    out.push({ start, code: code.replace(/\s+$/, ''), raw, doc });
  }
  return out;
}

// The systems each line compiles on, from #if/#ifdef/#elif/#else/#endif: a Set, or null
// outside any conditional.
const MACROS = { _WIN32: 'windows', _WIN64: 'windows', WIN32: 'windows', __APPLE__: 'mac', __MACH__: 'mac', __linux__: 'linux', __linux: 'linux' };
function condOses(expr) {
  let e = expr.replace(/defined\s*\(\s*(\w+)\s*\)/g, ' $1 ').replace(/defined\s+(\w+)/g, ' $1 ');
  const evalFor = (sys, unknown) => {
    const s = e.replace(/[A-Za-z_]\w*/g, (id) => (id in MACROS ? String(MACROS[id] === sys) : String(unknown)));
    if (!/^[\s!&|()01truefalse]*$/.test(s)) return true;
    try { return Boolean(Function(`return (${s.replace(/\b1\b/g, 'true').replace(/\b0\b/g, 'false')})`)()); } catch { return true; }
  };
  const maybe = new Set(), sure = new Set();
  for (const sys of OSES) {
    const a = evalFor(sys, true), b = evalFor(sys, false);
    if (a || b) maybe.add(sys);
    if (a && b) sure.add(sys);
  }
  return { maybe, sure };
}
function preprocessorOses(lines) {
  const res = [];
  const stack = [];
  const inter = (a, b) => new Set([...a].filter((x) => b.has(x)));
  const minus = (a, b) => new Set([...a].filter((x) => !b.has(x)));
  for (const l of lines) {
    const t = l.code.trim();
    const m = /^#\s*(if|ifdef|ifndef|elif|else|endif)\b(.*)$/.exec(t);
    const top = stack[stack.length - 1];
    if (m) {
      const [, d, rest] = m;
      const expr = d === 'ifdef' ? rest : d === 'ifndef' ? `!(${rest})` : rest;
      if (d === 'if' || d === 'ifdef' || d === 'ifndef') {
        const parent = top ? top.cur : new Set(OSES);
        const c = condOses(expr);
        stack.push({ parent, prevSure: c.sure, cur: inter(parent, c.maybe) });
      } else if (d === 'elif' && top) {
        const c = condOses(expr);
        top.cur = minus(inter(top.parent, c.maybe), top.prevSure);
        top.prevSure = new Set([...top.prevSure, ...c.sure]);
      } else if (d === 'else' && top) {
        top.cur = minus(top.parent, top.prevSure);
      } else if (d === 'endif') {
        stack.pop();
      }
      res.push(stack.length ? stack[stack.length - 1].cur : null);
      continue;
    }
    res.push(top ? top.cur : null);
  }
  return res;
}

const DECL_START = /^(?:pub\s+)?(?:fn|type|test|fuzz|bench|mut|const)\b|^[A-Za-z_]\w*\s*(?::(?!:)|:=)/;
const OS_BRANCH = /\bos_name\(\)|\bos\.name\(\)|#\s*if/;

function declName(code) {
  let m;
  if ((m = /^(?:pub\s+)?fn\s+\(([^)]*)\)\s*([A-Za-z_]\w*)/.exec(code))) {
    const r = /:\s*\*?\s*(?:mut\s+)?([A-Za-z_]\w*)/.exec(m[1]);
    return { kind: 'method', name: m[2], recv: r ? r[1] : '' };
  }
  if ((m = /^(?:pub\s+)?fn\s+([A-Za-z_]\w*)/.exec(code))) return { kind: 'fn', name: m[1] };
  if ((m = /^(?:pub\s+)?type\s+([A-Za-z_]\w*)/.exec(code))) return { kind: 'type', name: m[1] };
  if ((m = /^(test|fuzz|bench)\s+"((?:\\.|[^"\\])*)"/.exec(code))) return { kind: 'test', name: `${m[1]} "${m[2]}"` };
  if ((m = /^(?:pub\s+)?(?:mut|const)\s+([A-Za-z_]\w*)/.exec(code))) return { kind: 'global', name: m[1] };
  if ((m = /^([A-Za-z_]\w*)\s*(?::|:=)/.exec(code))) return { kind: 'global', name: m[1] };
  return { kind: 'other', name: code.slice(0, 40) };
}

// A .cf file: its package line, imports, header text and declarations.
function parseCf(file, text) {
  const lines = scanLines(text, 'cf');
  const pp = preprocessorOses(lines);
  const decls = [];
  const header = [];
  let pkgName = '';
  const imports = [];
  const cppImports = [];
  let cur = null;
  lines.forEach((l, i) => {
    const lineNo = i + 1;
    if (l.start === 'code' && l.raw.length && !/^\s/.test(l.raw) && DECL_START.test(l.code)) {
      cur = { ...declName(l.code), file, start: lineNo, end: lineNo, code: [] };
      decls.push(cur);
    }
    if (!cur) {
      let m;
      if ((m = /^package\s+(\w+)/.exec(l.code))) pkgName = m[1];
      if ((m = /^import\s+"(\.[^"]+)"(?:\s+as\s+(\w+))?/.exec(l.code))) imports.push({ rel: m[1], alias: m[2] || '' });
      if ((m = /^import\s+cpp\s+"([^"]+)"/.exec(l.code))) cppImports.push(path.basename(m[1]));
      if (l.code.trim()) header.push(l.code.trim());
      return;
    }
    cur.end = lineNo;
    if (l.code.trim()) cur.code.push(l.code);
  });
  const seen = new Map();
  for (const d of decls) {
    const base = d.kind === 'method' ? `method:${d.recv}.${d.name}` : `${d.kind}:${d.name}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    d.key = n === 1 ? base : `${base}#${n}`;
    d.text = d.code.join('\n');
    d.osBranch = OS_BRANCH.test(d.text);
    d.isTest = d.kind === 'test' || file.endsWith('_test.cf');
  }
  return { file, lines, pp, decls, header: header.join('\n'), pkgName, imports, cppImports };
}

function lineOses(parsed, lineNo, lang) {
  const set = parsed.pp[lineNo - 1];
  if (set) return set;
  if (lang === 'hpp') return new Set(OSES);
  const d = parsed.decls.find((x) => lineNo >= x.start && lineNo <= x.end);
  if (d && d.osBranch) return new Set(OSES);
  return new Set(['mac']);
}

// ---- the source graph ------------------------------------------------------------------

const DRIVERS = new Set(['src/drivers/cli', 'src/drivers/clicmd', 'src/drivers/gui', 'src/drivers/vault-server', 'src/drivers/update-root']);
// Composition roots and dispatch: reached from another driver file, they would reach
// every command and every RPC; they count only when changed or reached from outside the
// drivers.
const DISPATCH = new Set(['src/drivers/cli/main.cf', 'src/drivers/clicmd/run.cf', 'src/drivers/gui/main.cf']);

function buildGraph(root, head, allFiles) {
  const cfFiles = allFiles.filter((p) => p.startsWith('src/') && p.endsWith('.cf') && !p.includes('/.cfire/'));
  const hppFiles = allFiles.filter((p) => p.startsWith('src/') && /\.(hpp|h)$/.test(p) && !p.includes('/.cfire/'));
  const texts = readTree(root, head, [...cfFiles, ...hppFiles]);
  const pkgs = new Map();
  const parsed = new Map();
  for (const f of cfFiles) {
    const p = parseCf(f, texts.get(f) ?? '');
    parsed.set(f, p);
    const dir = path.posix.dirname(f);
    if (!pkgs.has(dir)) pkgs.set(dir, { dir, name: '', files: [], index: new Map(), suite: false });
    const pk = pkgs.get(dir);
    pk.files.push(f);
    if (p.pkgName) pk.name = p.pkgName;
    if (f.endsWith('_test.cf') || p.decls.some((d) => d.kind === 'test')) pk.suite = true;
  }
  const decls = new Map();
  for (const [f, p] of parsed) {
    const dir = path.posix.dirname(f);
    for (const d of p.decls) {
      d.pkg = dir;
      d.id = `${dir}|${d.key}`;
      decls.set(d.id, d);
      if (d.kind === 'fn' || d.kind === 'type' || d.kind === 'global') {
        const ix = pkgs.get(dir).index;
        if (!ix.has(d.name)) ix.set(d.name, []);
        ix.get(d.name).push(d.id);
      }
    }
  }
  // References.
  const rev = new Map();
  const fwd = new Map();
  const addEdge = (from, to) => {
    if (from === to) return;
    if (!rev.has(to)) rev.set(to, new Set());
    rev.get(to).add(from);
    if (!fwd.has(from)) fwd.set(from, new Set());
    fwd.get(from).add(to);
  };
  for (const [f, p] of parsed) {
    const dir = path.posix.dirname(f);
    const quals = new Map();
    for (const im of p.imports) {
      const target = path.posix.normalize(path.posix.join(dir, im.rel));
      const tp = pkgs.get(target);
      if (!tp) continue;
      quals.set(im.alias || tp.name || path.posix.basename(target), target);
    }
    const own = pkgs.get(dir).index;
    for (const d of p.decls) {
      const tokens = new Set(d.text.match(/[A-Za-z_]\w*/g) || []);
      // A test file's declarations are seen only by the package's own tests.
      for (const t of tokens) for (const id of own.get(t) || []) if (d.isTest || !decls.get(id).isTest) addEdge(d.id, id);
      for (const m of d.text.matchAll(/\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)/g)) {
        const target = quals.get(m[1]);
        if (!target) continue;
        for (const id of pkgs.get(target).index.get(m[2]) || []) if (!decls.get(id).isTest) addEdge(d.id, id);
      }
      // A method is its receiver's type: reaching one reaches the type, so whatever names
      // the type (signatures, constructors, the wiring) is reached too.
      if (d.kind === 'method') for (const id of own.get(d.recv) || []) addEdge(id, d.id);
    }
  }
  // Native headers: which .cf files import each, directly or through #include.
  const byBase = new Map();
  for (const h of hppFiles) byBase.set(path.posix.basename(h), h);
  const includes = new Map();
  for (const h of hppFiles) {
    const inc = [...(texts.get(h) ?? '').matchAll(/#\s*include\s+"([^"]+)"/g)].map((m) => byBase.get(path.posix.basename(m[1]))).filter(Boolean);
    includes.set(h, inc);
  }
  const headerUsers = new Map(hppFiles.map((h) => [h, new Set()]));
  for (const [f, p] of parsed) {
    const seen = new Set();
    const queue = p.cppImports.map((b) => byBase.get(b)).filter(Boolean);
    while (queue.length) {
      const h = queue.pop();
      if (seen.has(h)) continue;
      seen.add(h);
      headerUsers.get(h).add(f);
      queue.push(...(includes.get(h) || []));
    }
  }
  return { pkgs, parsed, decls, rev, fwd, headerUsers, hppTexts: new Map(hppFiles.map((h) => [h, texts.get(h)])) };
}

// ---- what each driver file runs ----------------------------------------------------------

function driverChecks(pkg, file) {
  const base = path.posix.basename(file, '.cf');
  switch (pkg) {
    case 'src/drivers/cli':
      return base === 'update_apply' ? ['e2e:cli', 'gui:selfupdate'] : ['e2e:cli', 'e2e:serve', 'e2e:sync'];
    case 'src/drivers/clicmd':
      if (base === 'serve' || base === 'tokens') return ['e2e:cli', 'e2e:serve'];
      if (base === 'sync_commands') return ['e2e:cli', 'e2e:sync'];
      if (base === 'run') return ['e2e:cli', 'e2e:serve', 'e2e:sync'];
      return ['e2e:cli'];
    case 'src/drivers/gui': {
      const table = {
        tunnels: ['gui:tunnels'], rdp: ['gui:rdp'], paste: ['gui:paste'], update: ['gui:update', 'gui:selfupdate'],
        cli: ['gui:clilink'], serve: ['e2e:serve'], access: ['e2e:serve', 'gui:vault'],
        sync: ['e2e:sync', 'gui:vault'], remote: ['e2e:sync', 'gui:vault'],
      };
      return table[base] || [...GUI_RUNS.map((r) => `gui:${r}`), 'e2e:serve', 'e2e:sync'];
    }
    case 'src/drivers/vault-server':
      return ['e2e:server', 'e2e:sync'];
    case 'src/drivers/update-root':
      return ['selfupdate-linux'];
    default:
      return [];
  }
}

// ---- paths outside the reference graph ----------------------------------------------------

// Whole set: [regex, systems, why]. Test files never ask for it.
const WHOLE = [
  [/^src\/adapters\/(crypto|keychain)\//, OSES, 'keys'],
  [/^src\/adapters\/vault\/(migrations|sqlcipher)\.cf$|^src\/domain\/vault\.cf$/, OSES, 'the vault format or a migration'],
  [/^src\/adapters\/ipc\/|^src\/drivers\/(gui|clicmd)\/serve\.cf$/, OSES, 'the socket'],
  [/^src\/adapters\/uievents\/(native\/flint_(window|monitors)\.hpp|fullscreen\.cf|monitors\.cf)$|^src\/drivers\/gui\/window\.cf$/, OSES, 'the window'],
  [/^build\.cf$|^scripts\/(install-cfire|env|test)\.sh$/, OSES, "the build, cfire's pin or the test harness"],
  [/^src\/adapters\/pkgconfig\/darwin\//, ['mac'], "the Mac's native libraries"],
  [/^src\/adapters\/pkgconfig\/linux\/|^scripts\/linux\/(Dockerfile|inside\.sh|root\.sh|xvfb-flint\.sh)$/, ['linux'], "Linux's native libraries or its test container"],
  [/^src\/adapters\/pkgconfig\/windows\/|^windows\/(bin\/|install\.ps1$|build\.ps1$)/, ['windows'], "Windows' native libraries or its cfire setup"],
];

// Every other path: [regex, (match) → [{check, os}] ]. First match wins; no match is the
// whole set.
const m = (check, sys = 'mac') => ({ check, os: sys });
const ALL_GUI = GUI_RUNS.map((r) => m(`gui:${r}`));
const PATHS = [
  [/^(docs\/|README\.md$|ROADMAP\.md$|CONTRIBUTING\.md$|SECURITY\.md$|LICENSE$)/, () => [m('site')]],
  [/^(CHANGELOG\.md|cliff\.toml)$/, () => [m('release-test'), m('site'), m('site-releases')]],
  [/^(CLAUDE\.md|\.claude\/|\.mcp\.json$|\.gitignore$|\.gitattributes$|spike\/)/, () => []],
  [/^assets\//, () => [m('build'), m('site'), m('package:macos')]],
  [/^site\/src\/demo\/|^site\/scripts\/demo-e2e\.mjs$/, () => [m('site'), m('site-demo')]],
  [/^site\/src\/releases\/|^site\/scripts\/releases-e2e\.mjs$/, () => [m('site'), m('site-releases')]],
  [/^site\//, () => [m('site')]],
  [/^ui\/src\/.*\.test\.tsx?$/, () => [m('ui')]],
  [/^ui\/src\/i18n\/es\.json$/, () => [m('ui'), m('i18n')]],
  [/^ui\/src\/i18n\/en\.json$/, () => [m('ui'), m('i18n'), ...ALL_GUI]],
  [/^ui\/src\/tunnels\//, () => [m('ui'), m('gui:tunnels')]],
  [/^ui\/src\/sessions\/broadcastInput\.ts$/, () => [m('ui'), m('gui:broadcast')]],
  [/^ui\/src\/sessions\/paste\.ts$/, () => [m('ui'), m('gui:paste')]],
  [/^ui\/src\/sessions\/(Rdp[^/]*|MonitorsUi\.tsx|monitors\.ts)$|^ui\/src\/editors\/RdpHostEditor\.tsx$|^ui\/src\/monitor\//, () => [m('ui'), m('gui:rdp')]],
  [/^ui\/src\/sessions\/(fullscreen\.ts|FullScreenBar\.tsx)$/, () => [m('ui'), m('gui:fullscreen')]],
  [/^ui\/src\/update\//, () => [m('ui'), m('gui:update'), m('gui:selfupdate')]],
  [/^ui\//, () => [m('ui'), ...ALL_GUI]],
  [/^scripts\/checks-for-diff\.(sh|mjs)$/, () => [m('self-test')]],
  [/^scripts\/cli-e2e\.sh$|^scripts\/ptyhost\.py$/, () => [m('e2e:cli')]],
  [/^scripts\/serve-e2e(-launch)?\.(sh|js)$/, () => [m('e2e:serve')]],
  [/^scripts\/server-e2e\.sh$/, () => [m('e2e:server')]],
  [/^scripts\/sync-e2e\.sh$/, () => [m('e2e:sync')]],
  [/^scripts\/gui-e2e\.(sh|js)$/, () => ALL_GUI],
  [/^scripts\/build-gui\.sh$/, () => [m('build'), ...ALL_GUI]],
  [/^scripts\/version\.sh$/, () => [m('build'), m('release-test'), m('gui:update'), m('gui:selfupdate')]],
  [/^scripts\/(release|release-draft|release-test)\.sh$/, () => [m('release-test')]],
  [/^scripts\/i18n-missing\.sh$/, () => [m('i18n')]],
  [/^scripts\/agent-guide-docs\.sh$/, () => [m('e2e:cli'), m('site')]],
  [/^scripts\/rdp-testserver\.sh$/, () => [m('suite:src/adapters/rdp'), m('gui:rdp')]],
  [/^scripts\/sign-manifest\.sh$/, () => [m('gui:update'), m('gui:selfupdate'), m('script:scripts/sign-manifest.sh')]],
  [/^scripts\/server-image\.sh$|^packaging\/vault-server\//, () => [m('server-image')]],
  [/^scripts\/package\.sh$/, () => [m('package:macos'), m('package:linux', 'linux'), m('package:windows', 'windows')]],
  [/^scripts\/(deps-macos\.sh|macos\/)|^packaging\/macos\//, () => [m('package:macos')]],
  [/^scripts\/linux\/selfupdate-test\.sh$/, () => [m('selfupdate-linux', 'linux')]],
  [/^scripts\/linux\/(package[^/]*|package\.Dockerfile)$|^packaging\/linux\//, () => [m('package:linux', 'linux')]],
  [/^scripts\/linux\/crash-bt\.c$/, () => [m('suite:*', 'linux')]],
  [/^scripts\/linux\/xorg-two-monitors\.conf$/, () => [m('script:FLINT_E2E_ONLY=multimon (Linux, two X screens)', 'linux')]],
  [/^scripts\/linux-check\.sh$/, () => [m('script:scripts/linux-check.sh', 'linux')]],
  [/^scripts\//, (p) => [m(`script:${p}`)]],
  [/^\.github\/workflows\//, () => [m('workflow')]],
  [/^tools\/cfire-repros\/run\.sh$/, () => [m('repro:all')]],
  [/^tools\/cfire-repros\/[^/]+\.md$/, () => []],
  [/^tools\/cfire-repros\/([^/]+)\//, (p, mm) => [m(`repro:${mm[1]}`)]],
  [/^windows\/(package\.sh|licenses\/)/, () => [m('package:windows', 'windows')]],
  [/^windows\//, (p) => [m(`script:${p}`, 'windows')]],
];

// ---- the analysis ----------------------------------------------------------------------------

export function analyze({ root, base = 'main', head = null }) {
  const { mergeBase, files } = readChanges(root, base, head);
  const req = []; // { check, os, why }
  const notes = [];
  const add = (check, sys, why) => req.push({ check, os: sys, why });
  const changed = [...files.values()];
  const srcChanged = changed.filter((c) => c.path.startsWith('src/') && !c.path.includes('/.cfire/'));
  // Whole set and path table.
  for (const c of changed) {
    if (c.path.includes('/.cfire/')) continue;
    if (!c.path.endsWith('_test.cf')) {
      const w = WHOLE.find(([re]) => re.test(c.path));
      if (w) { for (const sys of w[1]) add('whole', sys, `${c.path}: ${w[2]}`); continue; }
    }
    if (c.path.startsWith('src/')) continue;
    const row = PATHS.find(([re]) => re.test(c.path));
    if (!row) { for (const sys of OSES) add('whole', sys, `${c.path}: a path this script does not know`); continue; }
    const got = row[1](c.path, row[0].exec(c.path));
    if (got.length === 0) notes.push(`${c.path}: no check (agent or editor files, spikes, notes)`);
    for (const g of got) add(g.check, g.os, c.path);
  }
  // src/: the reference graph.
  if (srcChanged.length) {
    const graph = buildGraph(root, head, treeFiles(root, head));
    const oldSpecs = srcChanged.filter((c) => !c.isNew && /\.(cf|hpp|h)$/.test(c.path)).map((c) => `${mergeBase}:${c.path}`);
    const oldTexts = catFiles(root, oldSpecs);
    const start = new Map(); // decl id → { oses:Set, why }
    const mark = (d, oses, why) => {
      const s = start.get(d.id) || { oses: new Set(), why };
      for (const o of oses) s.oses.add(o);
      start.set(d.id, s);
    };
    const suiteOf = (dir) => {
      for (let d = dir; d.startsWith('src'); d = path.posix.dirname(d)) if (graph.pkgs.get(d)?.suite) return d;
      return null;
    };
    for (const c of srcChanged) {
      const dir = path.posix.dirname(c.path);
      if (c.path.endsWith('.cf')) {
        const neu = c.isDeleted ? null : graph.parsed.get(c.path);
        const oldText = c.isNew ? null : oldTexts.get(`${mergeBase}:${c.path}`);
        const old = oldText == null ? null : parseCf(c.path, oldText);
        const oldBy = new Map((old?.decls || []).map((d) => [d.key, d]));
        const newBy = new Map((neu?.decls || []).map((d) => [d.key, d]));
        let any = false;
        for (const d of neu?.decls || []) {
          const o = oldBy.get(d.key);
          if (o && o.text === d.text) continue;
          const oses = new Set();
          for (const ln of c.added) if (ln >= d.start && ln <= d.end) for (const s of lineOses(neu, ln, 'cf')) oses.add(s);
          if (o) for (const ln of c.removed) if (ln >= o.start && ln <= o.end) for (const s of lineOses(old, ln, 'cf')) oses.add(s);
          if (oses.size === 0) for (const s of lineOses(neu, d.start, 'cf')) oses.add(s);
          mark(d, oses, `${c.path} (${d.kind === 'test' ? d.name : d.name + (d.kind === 'method' ? ` on ${d.recv}` : '')})`);
          any = true;
        }
        const suite = suiteOf(dir);
        const removedDecls = (old?.decls || []).filter((d) => !newBy.has(d.key));
        if (removedDecls.length && suite) { add(`suite:${suite}`, 'mac', `${c.path}: ${removedDecls.length} declaration(s) removed`); any = true; }
        if (old && neu && old.header !== neu.header && suite) { add(`suite:${suite}`, 'mac', `${c.path}: its imports`); any = true; }
        if (c.isDeleted && suite) { add(`suite:${suite}`, 'mac', `${c.path} deleted`); any = true; }
        const docLines = [...c.added].some((ln) => neu?.lines[ln - 1]?.doc) || [...c.removed].some((ln) => old?.lines[ln - 1]?.doc);
        if (docLines && suite) { add(`suite:${suite}`, 'mac', `${c.path}: a doc comment (doc-tests)`); any = true; }
        if (!any) notes.push(`${c.path}: comments or blank lines only, no check`);
        if (c.path === 'src/domain/messages.cf') add('i18n', 'mac', c.path);
        if (dir === 'src/drivers/clicmd' && !c.path.endsWith('_test.cf') && any) { add('site', 'mac', `${c.path}: the CLI (docs and demo, rule 5)`); add('site-demo', 'mac', `${c.path}: the CLI's demo`); }
      } else if (/\.(hpp|h)$/.test(c.path)) {
        const newText = c.isDeleted ? '' : graph.hppTexts.get(c.path) ?? '';
        const oldText = c.isNew ? '' : oldTexts.get(`${mergeBase}:${c.path}`) ?? '';
        const nl = scanLines(newText, 'cpp'), ol = scanLines(oldText, 'cpp');
        const np = { pp: preprocessorOses(nl), decls: [] }, op = { pp: preprocessorOses(ol), decls: [] };
        const oses = new Set();
        let code = false;
        for (const ln of c.added) if (nl[ln - 1]?.code.trim()) { code = true; for (const s of lineOses(np, ln, 'hpp')) oses.add(s); }
        for (const ln of c.removed) if (ol[ln - 1]?.code.trim()) { code = true; for (const s of lineOses(op, ln, 'hpp')) oses.add(s); }
        if (!code && (c.added.size || c.removed.size)) { notes.push(`${c.path}: comments or blank lines only, no check`); continue; }
        if (oses.size === 0) OSES.forEach((s) => oses.add(s));
        for (const f of graph.headerUsers.get(c.path) || []) for (const d of graph.parsed.get(f).decls) mark(d, oses, `${c.path} (native, through ${path.posix.basename(f)})`);
        const suite = suiteOf(dir.replace(/\/native(\/.*)?$/, ''));
        if (suite) for (const s of oses) add(`suite:${suite}`, s, `${c.path} (native)`);
      } else {
        const pkgDir = dir.replace(/\/native(\/.*)?$/, '');
        const suite = suiteOf(pkgDir);
        if (suite) for (const s of OSES) add(`suite:${suite}`, s, c.path);
        add('build', 'mac', c.path);
      }
    }
    // Reach, per system.
    for (const sys of OSES) {
      const reached = new Map(); // id → why
      const queue = [];
      for (const [id, s] of start) if (s.oses.has(sys)) { reached.set(id, { why: s.why, direct: true }); queue.push(id); }
      while (queue.length) {
        const x = queue.shift();
        const xd = graph.decls.get(x);
        for (const from of graph.rev.get(x) || []) {
          if (reached.has(from)) continue;
          const fd = graph.decls.get(from);
          if (DISPATCH.has(fd.file) && DRIVERS.has(xd.pkg)) continue;
          reached.set(from, { why: reached.get(x).why, direct: false });
          queue.push(from);
        }
      }
      for (const [id, r] of reached) {
        const d = graph.decls.get(id);
        const suite = suiteOf(d.pkg);
        const why = r.direct ? r.why : `${r.why} → ${d.file}`;
        if (suite) add(`suite:${suite}`, sys, why);
        if (d.isTest) continue;
        if (sys === 'mac' || d.osBranch || r.direct) add('build', sys, why);
        if (DRIVERS.has(d.pkg)) for (const ch of driverChecks(d.pkg, d.file)) add(ch, ch === 'selfupdate-linux' ? 'linux' : sys, why);
      }
    }
  }
  return { base, head, mergeBase, files: changed.map((c) => c.path), plan: normalize(req), notes };
}

// Folds the requests into a plan per system: checks with their reasons, a whole set
// absorbing what it contains, a suite under a requested parent dropped.
function normalize(req) {
  const plan = {};
  for (const sys of OSES) {
    const mine = req.filter((r) => r.os === sys);
    const by = new Map();
    for (const r of mine) {
      if (!by.has(r.check)) by.set(r.check, []);
      if (!by.get(r.check).includes(r.why)) by.get(r.check).push(r.why);
    }
    if (by.has('whole')) {
      const keep = new Map([['whole', by.get('whole')]]);
      for (const [k, v] of by) if (/^(package|script|repro|workflow|server-image|selfupdate-linux|self-test|site-releases|site-demo|release-test|i18n)/.test(k)) keep.set(k, v);
      plan[sys] = Object.fromEntries(keep);
      continue;
    }
    if (by.has('suite:*')) for (const k of [...by.keys()]) if (k.startsWith('suite:') && k !== 'suite:*') by.delete(k);
    const suites = [...by.keys()].filter((k) => k.startsWith('suite:')).map((k) => k.slice(6));
    for (const s of suites) if (suites.some((p) => p !== s && s.startsWith(p + '/'))) {
      const parent = suites.find((p) => p !== s && s.startsWith(p + '/'));
      by.get(`suite:${parent}`).push(...by.get(`suite:${s}`).filter((w) => !by.get(`suite:${parent}`).includes(w)));
      by.delete(`suite:${s}`);
    }
    if ([...by.keys()].some((k) => k.startsWith('gui:'))) if (!by.has('build')) by.set('build', ['gui-e2e builds the app']);
    if (by.size) plan[sys] = Object.fromEntries([...by].sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b)));
  }
  return plan;
}
function order(k) {
  return ['whole', 'suite', 'build', 'e2e', 'gui', 'ui', 'i18n', 'release', 'site', 'self', 'selfupdate', 'server', 'package', 'workflow', 'repro', 'script']
    .findIndex((p) => k.startsWith(p)) + 1 || 99;
}

// ---- printing ---------------------------------------------------------------------------------

function commands(sys, checks) {
  const keys = Object.keys(checks);
  const out = [];
  const suites = keys.filter((k) => k.startsWith('suite:')).map((k) => k.slice(6));
  const guiRuns = keys.filter((k) => k.startsWith('gui:')).map((k) => k.slice(4));
  const e2es = E2E.filter((e) => keys.includes(`e2e:${e}`));
  const only = guiRuns.length === GUI_RUNS.length ? '' : `FLINT_E2E_ONLY=${guiRuns.join(',')} `;
  const tag = (cmd, ks) => out.push({ cmd, keys: ks });
  if (sys === 'mac') {
    if (keys.includes('whole')) tag('scripts/test.sh && cfire build && scripts/build-gui.sh && scripts/cli-e2e.sh && scripts/serve-e2e.sh && scripts/server-e2e.sh && scripts/sync-e2e.sh && scripts/gui-e2e.sh && (cd ui && npm test) && (cd site && npm run build && npm test && npm run test:e2e)', ['whole']);
    if (suites.length) tag(`scripts/test.sh ${suites.includes('*') ? '' : suites.join(' ')}`.trim(), suites.map((s) => `suite:${s}`));
    if (keys.includes('build')) tag('cfire build && scripts/build-gui.sh', ['build']);
    for (const e of e2es) tag(`scripts/${e}-e2e.sh`, [`e2e:${e}`]);
    if (guiRuns.length) tag(`${only}FLINT_E2E_NOBUILD=1 scripts/gui-e2e.sh`, guiRuns.map((r) => `gui:${r}`));
    if (keys.includes('ui')) tag('(cd ui && npm test && npx tsc --noEmit)', ['ui']);
    if (keys.includes('i18n')) tag('scripts/i18n-missing.sh', ['i18n']);
    if (keys.includes('release-test')) tag('scripts/release-test.sh', ['release-test']);
    if (keys.includes('site')) tag('(cd site && npm run build && npm test)', ['site']);
    if (keys.includes('site-demo')) tag('(cd site && npm run test:e2e)', ['site-demo']);
    if (keys.includes('site-releases')) tag('(cd site && npm run test:releases)', ['site-releases']);
    if (keys.includes('self-test')) tag('scripts/checks-for-diff.sh --self-test', ['self-test']);
    if (keys.includes('server-image')) tag('scripts/server-image.sh && FLINT_SERVER_IMAGE=<the image> scripts/server-e2e.sh', ['server-image']);
    if (keys.includes('package:macos')) tag('scripts/package.sh macos', ['package:macos']);
    if (keys.includes('workflow')) tag('the release workflow dispatched on the branch with run=linux-packages (or the release itself)', ['workflow']);
  } else if (sys === 'linux') {
    if (keys.includes('whole')) tag('scripts/linux-check.sh', ['whole']);
    const steps = [];
    if (suites.length) steps.push('tests');
    for (const [e, s] of [['cli', 'cli'], ['serve', 'serve'], ['server', 'server'], ['sync', 'sync']]) if (e2es.includes(e)) steps.push(s);
    if (guiRuns.length) steps.push('gui');
    if (steps.length) {
      const env = [`FLINT_LINUX_STEPS=${steps.join(',')}`];
      if (suites.length && !suites.includes('*')) env.push(`FLINT_LINUX_SUITES="${suites.join(' ')}"`);
      if (guiRuns.length && only) env.push(only.trim());
      tag(`${env.join(' ')} scripts/linux-check.sh`, [...suites.map((s) => `suite:${s}`), ...e2es.map((e) => `e2e:${e}`), ...guiRuns.map((r) => `gui:${r}`)]);
    } else if (keys.includes('build')) tag('FLINT_LINUX_STEPS=none scripts/linux-check.sh   # the build only', ['build']);
    if (keys.includes('selfupdate-linux')) tag('scripts/linux/selfupdate-test.sh', ['selfupdate-linux']);
    if (keys.includes('package:linux')) tag('scripts/package.sh linux', ['package:linux']);
  } else {
    tag('windows/remote.sh windows/vm/pull.sh   # first: the VM onto the pushed branch (FLINT_VM_BRANCH=<branch>)', []);
    if (keys.includes('whole')) tag('windows/remote.sh windows/battery.sh, then in the desktop session (windows/desktop.sh): scripts/gui-e2e.sh, scripts/serve-e2e.sh, scripts/sync-e2e.sh, scripts/test.sh src/adapters/keychain', ['whole']);
    if (suites.length) tag(`windows/vm/test-all.sh ${suites.includes('*') ? '' : suites.join(' ')}   # sent with windows/remote.sh`.replace('  #', ' #'), suites.map((s) => `suite:${s}`));
    else if (keys.includes('build')) tag('cfire build   # sent with windows/remote.sh', ['build']);
    for (const e of e2es) {
      if (e === 'serve' || e === 'sync') tag(`scripts/${e}-e2e.sh   # in the desktop session (windows/desktop.sh)`, [`e2e:${e}`]);
      else tag(`FLINT_VM_E2E=${e} bash windows/vm/e2e.sh   # sent with windows/remote.sh`, [`e2e:${e}`]);
    }
    if (guiRuns.length) tag(`${only}scripts/gui-e2e.sh   # in the desktop session (windows/desktop.sh)`, guiRuns.map((r) => `gui:${r}`));
    if (keys.includes('package:windows')) tag('scripts/package.sh windows', ['package:windows']);
  }
  const repros = keys.filter((x) => x.startsWith('repro:'));
  if (repros.length) tag(`tools/cfire-repros/run.sh ${repros.includes('repro:all') ? '' : repros.map((k) => k.slice(6)).join(' ')}`.trim(), repros);
  for (const k of keys.filter((x) => x.startsWith('script:'))) tag(`${k.slice(7)}   # the script itself, on this system`, [k]);
  return out;
}

function render(result, { why }) {
  const lines = [];
  const range = result.head ? `${result.base}...${result.head}` : `${result.base}...HEAD and the working tree`;
  lines.push(`checks-for-diff: ${range} (merge base ${result.mergeBase.slice(0, 8)}), ${result.files.length} file(s) changed`);
  if (result.files.length === 0) { lines.push('', 'Nothing changed: no checks.'); return lines.join('\n'); }
  for (const sys of OSES) {
    const checks = result.plan[sys];
    if (!checks) continue;
    lines.push('', OS_LABEL[sys]);
    for (const { cmd, keys } of commands(sys, checks)) {
      lines.push(`  ${cmd}`);
      const reasons = [...new Set(keys.flatMap((k) => checks[k] || []))];
      const shown = why ? reasons : reasons.slice(0, 3);
      for (const r of shown) lines.push(`      ← ${r}`);
      if (shown.length < reasons.length) lines.push(`      ← … ${reasons.length - shown.length} more (--why)`);
    }
  }
  const skipped = OSES.filter((s) => !result.plan[s]);
  if (skipped.length) lines.push('', `Not needed: ${skipped.map((s) => OS_LABEL[s].split(' (')[0]).join(', ')} (no line of the diff compiles only there, or reaches what runs there).`);
  if (result.notes.length) { lines.push('', 'Notes:'); for (const n of result.notes) lines.push(`  ${n}`); }
  return lines.join('\n');
}

// ---- self-test ----------------------------------------------------------------------------------

// Fixed diffs over a small tree shaped like Flint's, in a scratch repository. Each case
// is a change from the base commit and the checks it must (and must not) ask for, per
// system. A miss found in real use becomes a case here (docs/checks.md, "Misses").
const FIXTURE = {
  'src/domain/ssh.cf': 'package domain\n\n// Ports.\nfn parse_port(s: str) -> i64 {\n    return 22\n}\n\nfn unused_helper() -> i64 {\n    return 1\n}\n\ntype Host struct {\n    alias: str\n}\n\nfn (self: Host) label() -> str {\n    return self.alias\n}\n',
  'src/domain/ssh_test.cf': 'package domain\n\ntest "port" {\n    assert(parse_port("x") == 22)\n}\n',
  'src/domain/vault.cf': 'package domain\n\nVAULT_SALT_LEN: usize = 16\n',
  'src/ports/ports.cf': 'package ports\n\nimport "../domain"\n\ntype Ssh interface {\n    dial(h: domain.Host) -> void!\n}\n',
  'src/adapters/ssh/link.cf': 'package flint_ssh\n\nimport "../../domain"\nimport cpp "flint_ssh.hpp"\n\ntype SshLink struct {\n    fd: i64\n}\n\nfn (self: SshLink) dial(h: domain.Host) -> void! {\n    mut windows := false\n    cpp {\n#if defined(_WIN32)\n        windows = true;\n#endif\n    }\n    return\n}\n\nfn new_link() -> SshLink {\n    return SshLink{ fd: 0 }\n}\n',
  'src/adapters/ssh/link_test.cf': 'package flint_ssh\n\ntest "link" {\n    _ = new_link()\n}\n',
  'src/adapters/ssh/native/flint_ssh.hpp': '#pragma once\n// libssh glue.\n#if defined(_WIN32)\ninline int flint_sock() { return 1; }\n#else\ninline int flint_sock() { return 2; }\n#endif\ninline int flint_shared() { return 3; }\n',
  'src/adapters/vault/migrations.cf': 'package vault\n\nfn migrations() -> i64 {\n    return 1\n}\n',
  'src/adapters/vault/store_test.cf': 'package vault\n\ntest "store" {\n    assert(migrations() == 1)\n}\n',
  'src/application/hosts.cf': 'package application\n\nimport "../domain"\nimport "../ports"\n\nfn host_port(s: str) -> i64 {\n    return domain.parse_port(s)\n}\n\nfn host_label(h: domain.Host) -> str {\n    return h.alias\n}\n',
  'src/application/hosts_test.cf': 'package application\n\ntest "hosts" {\n    assert(host_port("1") == 22)\n}\n',
  'src/drivers/clicmd/commands.cf': 'package clicmd\n\nimport "../../application"\n\nfn cmd_host_ls() -> str {\n    return "No hosts yet."\n}\n\nfn cmd_port(s: str) -> i64 {\n    return application.host_port(s)\n}\n',
  'src/drivers/clicmd/sync_commands.cf': 'package clicmd\n\nfn cmd_sync() -> str {\n    return "synced"\n}\n',
  'src/drivers/clicmd/run.cf': 'package clicmd\n\nfn run_command(a: str) -> str {\n    if a == "ls" {\n        return cmd_host_ls()\n    }\n    return cmd_sync()\n}\n',
  'src/drivers/clicmd/args_test.cf': 'package clicmd\n\nfn has_token() -> bool {\n    return true\n}\n\ntest "args" {\n    assert(run_command("ls") != "" && has_token())\n}\n',
  'src/drivers/clicmd/serve.cf': 'package clicmd\n\ntype Req struct {\n    has_token: bool\n}\n\nfn serve_req() -> Req {\n    return Req{ has_token: false }\n}\n',
  'src/drivers/cli/main.cf': 'package main\n\nimport "../clicmd"\nimport "../../adapters/ssh" as flint_ssh\n\nfn main() {\n    _ = clicmd.run_command("ls")\n    _ = flint_ssh.new_link()\n}\n',
  'src/drivers/gui/tunnels.cf': 'package main\n\nimport "../../application"\n\nfn rpc_tunnel_label(h: str) -> str {\n    return "tunnel"\n}\n',
  'src/drivers/gui/main.cf': 'package main\n\nimport "../../application"\nimport "../../adapters/ssh" as flint_ssh\n\nfn main() {\n    _ = rpc_tunnel_label("x")\n    _ = flint_ssh.new_link()\n}\n',
  'ui/src/tunnels/TunnelsView.tsx': 'export const x = 1;\n',
  'ui/src/shell/Shell.tsx': 'export const y = 1;\n',
  'site/src/content/docs/index.mdx': '# Flint\n',
  'docs/spec.md': '# Spec\n',
  'build.cf': 'package build\n',
  'scripts/cli-e2e.sh': '#!/bin/sh\n',
};
const CASES = [
  {
    name: 'a docs-only change runs the site build and its tests',
    change: { 'docs/spec.md': '# Spec\n\nMore.\n', 'site/src/content/docs/index.mdx': '# Flint, a client\n' },
    want: { mac: ['site'] }, none: ['linux', 'windows'],
  },
  {
    name: "a CLI command's text runs clicmd's suite, cli-e2e and the site, not the app's runs",
    change: { 'src/drivers/clicmd/commands.cf': (t) => t.replace('No hosts yet.', 'No hosts.') },
    want: { mac: ['suite:src/drivers/clicmd', 'build', 'e2e:cli', 'site', 'site-demo'] },
    not: { mac: ['e2e:sync', 'gui:terminal', 'suite:src/domain'] }, none: ['linux', 'windows'],
  },
  {
    name: 'a domain function runs the suites that reach it and the e2e of the commands that call it',
    change: { 'src/domain/ssh.cf': (t) => t.replace('return 22', 'return 2222') },
    want: { mac: ['suite:src/domain', 'suite:src/application', 'suite:src/drivers/clicmd', 'build', 'e2e:cli'] },
    not: { mac: ['suite:src/adapters/ssh', 'suite:src/adapters/vault', 'gui:tunnels', 'e2e:sync'] }, none: ['linux', 'windows'],
  },
  {
    name: 'a domain function nobody calls runs its own suite and the build only',
    change: { 'src/domain/ssh.cf': (t) => t.replace('return 1', 'return 7') },
    want: { mac: ['suite:src/domain', 'build'] }, not: { mac: ['suite:src/application', 'e2e:cli'] },
  },
  {
    name: "a type's method reaches whatever names the type",
    change: { 'src/domain/ssh.cf': (t) => t.replace('return self.alias', 'return "h:" + self.alias') },
    want: { mac: ['suite:src/domain', 'suite:src/application', 'suite:src/adapters/ssh', 'e2e:cli'] },
  },
  {
    name: 'a migration runs the whole set on the three systems',
    change: { 'src/adapters/vault/migrations.cf': (t) => t.replace('return 1', 'return 2') },
    want: { mac: ['whole'], linux: ['whole'], windows: ['whole'] },
  },
  {
    name: 'a path the script does not know runs the whole set',
    change: { 'weird/new-thing.txt': 'x\n' },
    want: { mac: ['whole'], linux: ['whole'], windows: ['whole'] },
  },
  {
    name: "a Windows-only line in an adapter runs its suite on the VM, not Docker's",
    change: { 'src/adapters/ssh/link.cf': (t) => t.replace('windows = true;', 'windows = true; // WSA') .replace('        windows = true; // WSA', '        windows = 1 == 1;') },
    want: { windows: ['suite:src/adapters/ssh', 'e2e:cli', 'gui:terminal'] }, none: ['linux'],
  },
  {
    name: "a native header's Windows branch reaches the VM only",
    change: { 'src/adapters/ssh/native/flint_ssh.hpp': (t) => t.replace('return 1;', 'return 10;') },
    want: { windows: ['suite:src/adapters/ssh'] }, none: ['linux', 'mac'],
  },
  {
    name: "a native header's shared line reaches all three systems",
    change: { 'src/adapters/ssh/native/flint_ssh.hpp': (t) => t.replace('return 3;', 'return 30;') },
    want: { mac: ['suite:src/adapters/ssh', 'e2e:cli'], linux: ['suite:src/adapters/ssh'], windows: ['suite:src/adapters/ssh'] },
  },
  {
    name: "a gui driver's tunnels file runs the tunnels gui-e2e run only",
    change: { 'src/drivers/gui/tunnels.cf': (t) => t.replace('"tunnel"', '"tunnels"') },
    want: { mac: ['build', 'gui:tunnels'] }, not: { mac: ['gui:terminal', 'e2e:cli'] },
  },
  {
    name: "a page's tunnels folder runs vitest and the tunnels run; another folder runs every run",
    change: { 'ui/src/tunnels/TunnelsView.tsx': 'export const x = 2;\n' },
    want: { mac: ['ui', 'gui:tunnels'] }, not: { mac: ['gui:vault'] },
  },
  {
    name: 'a page file with no run of its own runs every gui-e2e run',
    change: { 'ui/src/shell/Shell.tsx': 'export const y = 2;\n' },
    want: { mac: ['ui', 'gui:terminal', 'gui:vault', 'gui:selfupdate'] },
  },
  {
    name: 'a comment-only change runs nothing',
    change: { 'src/domain/ssh.cf': (t) => t.replace('// Ports.', '// The SSH ports.') },
    want: {}, none: ['mac', 'linux', 'windows'],
  },
  {
    name: 'a test-only change runs that suite and nothing else',
    change: { 'src/application/hosts_test.cf': (t) => t.replace('"1"', '"2"') },
    want: { mac: ['suite:src/application'] }, not: { mac: ['build', 'e2e:cli'] },
  },
  {
    // Milestone 77's diff: a test file's helper named like a field reached serve.cf.
    name: "a test file's helper reaches only its package's tests",
    change: { 'src/drivers/clicmd/args_test.cf': (t) => t.replace('return true', 'return 1 == 1') },
    want: { mac: ['suite:src/drivers/clicmd'] }, not: { mac: ['e2e:serve', 'build', 'whole'] },
  },
  {
    name: 'build.cf runs the whole set',
    change: { 'build.cf': 'package build\n\n// more\n' },
    want: { mac: ['whole'], linux: ['whole'], windows: ['whole'] },
  },
  {
    name: 'an e2e script runs itself',
    change: { 'scripts/cli-e2e.sh': '#!/bin/sh\necho hi\n' },
    want: { mac: ['e2e:cli'] }, not: { mac: ['build', 'suite:src/domain'] },
  },
];

function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flint-checks-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const write = (p, t) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), t); };
  let failed = 0;
  try {
    g('init', '-q', '-b', 'main');
    for (const [p, t] of Object.entries(FIXTURE)) write(p, t);
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
    for (const c of CASES) {
      g('checkout', '-q', '-B', 'case', 'main');
      for (const [p, ch] of Object.entries(c.change)) write(p, typeof ch === 'function' ? ch(fs.readFileSync(path.join(dir, p), 'utf8')) : ch);
      g('add', '-A');
      g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', c.name);
      const r = analyze({ root: dir, base: 'main', head: 'HEAD' });
      const problems = [];
      for (const [sys, want] of Object.entries(c.want)) for (const k of want) if (!r.plan[sys]?.[k]) problems.push(`${sys} lacks ${k}`);
      for (const [sys, not] of Object.entries(c.not || {})) for (const k of not) if (r.plan[sys]?.[k]) problems.push(`${sys} has ${k}`);
      for (const sys of c.none || []) if (r.plan[sys]) problems.push(`${sys} has ${Object.keys(r.plan[sys]).join(', ')}`);
      if (problems.length) {
        failed++;
        console.log(`FAIL ${c.name}\n     ${problems.join('\n     ')}\n     plan: ${JSON.stringify(Object.fromEntries(Object.entries(r.plan).map(([s, v]) => [s, Object.keys(v)])))}`);
      } else console.log(`ok   ${c.name}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(failed ? `checks-for-diff: ${failed} of ${CASES.length} case(s) failed` : `checks-for-diff: ${CASES.length} cases passed`);
  return failed ? 1 : 0;
}

// Every top-level name `cfire outline --json` reports in src/ is a declaration this
// script's scanner found (the scanner is text; cfire's parser is the reference).
function outlineCheck(root) {
  let out;
  try {
    out = JSON.parse(execFileSync('cfire', ['outline', '--json', 'src'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch (e) {
    console.log(`outline: not run (${String(e.message).split('\n')[0]})`);
    return 0;
  }
  const graph = buildGraph(root, null, treeFiles(root, null));
  let missing = 0, total = 0;
  for (const [file, info] of Object.entries(out.files || {})) {
    const p = graph.parsed.get(file);
    if (!p) continue;
    const names = new Set(p.decls.map((d) => d.name));
    const want = [...(info.types || []), ...(info.functions || []), ...(info.constants || []), ...(info.globals || [])].map((x) => x.name).filter(Boolean);
    for (const n of want) {
      total++;
      if (!names.has(n)) { missing++; if (missing <= 20) console.log(`outline: ${file}: ${n} not found by the scanner`); }
    }
  }
  console.log(missing ? `outline: ${missing} of ${total} names missed` : `outline: all ${total} names of cfire's outline found`);
  return missing ? 1 : 0;
}

// ---- main -------------------------------------------------------------------------------------

function main(argv) {
  let base = 'main', head = null, json = false, why = false, positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--self-test') {
      const root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim();
      return selfTest() | outlineCheck(root);
    }
    if (a === '--json') json = true;
    else if (a === '--why') why = true;
    else if (a === '--head') head = argv[++i];
    else if (a === '-h' || a === '--help') { process.stdout.write(fs.readFileSync(new URL('./checks-for-diff.sh', import.meta.url), 'utf8').split('\n').slice(1, 16).map((l) => l.replace(/^# ?/, '')).join('\n') + '\n'); return 0; }
    else if (a.startsWith('-')) { console.error(`checks-for-diff: unknown flag ${a}`); return 2; }
    else positional.push(a);
  }
  if (positional.length > 1) { console.error('checks-for-diff: one base at most'); return 2; }
  if (positional.length) base = positional[0];
  let root;
  try { root = git(process.cwd(), ['rev-parse', '--show-toplevel']).trim(); } catch { console.error('checks-for-diff: not in a git repository'); return 2; }
  let result;
  try { result = analyze({ root, base, head }); } catch (e) { console.error(`checks-for-diff: ${String(e.stderr || e.message).trim()}`); return 2; }
  if (json) {
    const plan = Object.fromEntries(Object.entries(result.plan).map(([s, checks]) => [s, { checks, commands: commands(s, checks).map((c) => c.cmd) }]));
    process.stdout.write(JSON.stringify({ ...result, plan }, null, 2) + '\n');
  } else process.stdout.write(render(result, { why }) + '\n');
  return 0;
}

process.exitCode = main(process.argv.slice(2));
