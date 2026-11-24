// Moves the page's inline text into ui/src/i18n/en.json (milestones 66-67, D-140).
// A migration tool, removed once all of ui/src is in the catalog (milestone 67).
//
//   node scripts/i18n-extract.mjs <file.tsx>...
//
// It rewrites, inside functions only:
//   - JSX text, alone or mixed with small elements and expressions (tr() with a
//     placeholder per element, `{name}` for a plain `{name}` expression);
//   - string and template literals in visible attributes and props, in `label`/`text`/
//     `title`/… fields, in notify()/fail()/show() calls, and in a JSX expression;
// adds `import { t } from '…/i18n'` (and tr), and the keys to en.json. Everything it
// leaves (module-level literals, `'a' + b`, text inside nested elements) it prints for
// a hand edit.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import ts from 'typescript';

const UI = join(dirname(new URL(import.meta.url).pathname), '..');
const CATALOG = join(UI, 'src/i18n/en.json');
const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'));

const VISIBLE = new Set([
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'desc', 'hint', 'text', 'note',
  'heading', 'confirmLabel', 'cancelLabel', 'okLabel', 'message', 'detail', 'subtitle', 'tooltip', 'empty', 'body', 'action', 'reason',
]);
const SAME = new Set([
  'Flint', 'SSH', 'RDP', 'SFTP', 'CLI', 'ntfy', 'ntfy.sh', 'Tether', 'GitHub', 'macOS', 'Linux', 'Windows',
  'Esc', 'Tab', 'Enter', 'Return', 'Ctrl', 'Alt', 'Shift', 'Space', 'Del', 'Backspace', 'Home', 'End',
  'PgUp', 'PgDn', 'esc', 'tab', 'English', 'Español', 'libssh', 'libsodium', 'SQLCipher', 'FreeRDP', 'OK',
  'root', 'sudo', 'sudo --', 'exec', 'pid',
]);
const COMMON = new Set(['Cancel', 'Save', 'Close', 'Delete', 'Copy', 'Done', 'Back', 'Continue', 'Remove',
  'Edit', 'Add', 'Open', 'Rename', 'Retry', 'Connect', 'Disconnect', 'Paste', 'Unlock', 'Lock', 'Create', 'Quit']);

// `prose`: JSX text, where a lone lowercase word is still a word.
function readable(s, prose = false) {
  s = s.trim();
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (SAME.has(s)) return false;
  if (/^flint( |$)/.test(s)) return false;
  if (!prose && /^[a-z0-9_.:\-/#%()]+$/.test(s)) return false;
  // An identifier in camelCase: an action's or a field's name.
  if (!prose && /^[a-z][A-Za-z0-9]*$/.test(s)) return false;
  if (/^([⌘⇧⌥⌃]|Ctrl\+|Alt\+|Shift\+|Cmd\+)*([A-Z0-9]{1,3}|↵|Tab|Space|Esc)$/.test(s)) return false;
  return true;
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", hellip: '…', middot: '·', rarr: '→', larr: '←', mdash: '—', ndash: '–' };
function decode(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

// React's JSX whitespace rule: lines are trimmed where they meet a line break, empty
// lines dropped, the rest joined with one space.
function jsxText(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  if (lines.length === 1) return decode(raw);
  const out = [];
  lines.forEach((line, i) => {
    let l = line;
    if (i > 0) l = l.replace(/^[ \t]+/, '');
    if (i < lines.length - 1) l = l.replace(/[ \t]+$/, '');
    if (l) out.push(l);
  });
  return decode(out.join(' '));
}

function snake(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').toLowerCase();
}

function slug(text) {
  const words = text.toLowerCase().replace(/\{(\w+)\}/g, '$1').replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 5).join('_') || 'text';
}

function keyFor(prefix, text) {
  if (COMMON.has(text)) {
    const k = 'common.' + text.toLowerCase();
    catalog[k] = text;
    return k;
  }
  for (const [k, v] of Object.entries(catalog)) if (k.startsWith(prefix + '.') && v === text) return k;
  let base = `${prefix}.${slug(text)}`, k = base, n = 2;
  while (catalog[k] !== undefined && catalog[k] !== text) k = `${base}_${n++}`;
  catalog[k] = text;
  return k;
}

function q(s) {
  return "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

function placeholderName(expr, used) {
  let name = 'p';
  if (ts.isIdentifier(expr)) name = expr.text;
  else if (ts.isPropertyAccessExpression(expr)) name = expr.name.text;
  else if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) name = expr.expression.text;
  name = name.replace(/[^A-Za-z0-9_]/g, '') || 'p';
  let n = name, i = 2;
  while (used.has(n)) n = name + i++;
  used.add(n);
  return n;
}

function inFunction(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionLike(p)) return true;
  }
  return false;
}

function hasReadable(node, src) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (ts.isJsxText(n) && readable(jsxText(n.text), true)) found = true;
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.parent && ts.isJsxAttribute(n.parent)
      && VISIBLE.has(n.parent.name.getText(src)) && readable(n.text)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function processFile(file) {
  const text = readFileSync(file, 'utf8');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const prefix = snake(basename(file).replace(/\.tsx?$/, ''));
  const edits = []; // {start, end, text}
  const manual = [];
  let usesT = false, usesTr = false;
  const line = (n) => src.getLineAndCharacterOfPosition(n.getStart(src)).line + 1;
  const done = new Set();

  // A literal (string or template) → t(...) source, or null.
  const literalCall = (node, prose = false) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!readable(node.text, prose)) return null;
      return `t(${q(keyFor(prefix, node.text))})`;
    }
    if (ts.isTemplateExpression(node)) {
      const used = new Set();
      let msg = node.head.text;
      const params = [];
      for (const span of node.templateSpans) {
        const name = placeholderName(span.expression, used);
        msg += `{${name}}` + span.literal.text;
        const src0 = span.expression.getText(src);
        params.push(src0 === name ? name : `${name}: ${src0}`);
      }
      if (!readable(msg.replace(/\{\w+\}/g, ''))) return null;
      return `t(${q(keyFor(prefix, msg))}, { ${params.join(', ')} })`;
    }
    return null;
  };

  // Replace the literals of an expression (through ?:, ||, ??, parentheses).
  const replaceIn = (node, wrapJsx, prose = false) => {
    if (!node) return;
    if (ts.isParenthesizedExpression(node)) return replaceIn(node.expression, wrapJsx, prose);
    if (ts.isConditionalExpression(node)) { replaceIn(node.whenTrue, wrapJsx, prose); replaceIn(node.whenFalse, wrapJsx, prose); return; }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.AmpersandAmpersandToken) {
        replaceIn(node.right, wrapJsx, prose);
        if (op !== ts.SyntaxKind.AmpersandAmpersandToken) replaceIn(node.left, wrapJsx, prose);
        return;
      }
      if (op === ts.SyntaxKind.PlusToken && hasLiteral(node)) { manual.push(`${line(node)}  concatenation: ${node.getText(src).slice(0, 90)}`); }
      return;
    }
    const call = literalCall(node, prose);
    if (call) {
      edits.push({ start: node.getStart(src), end: node.getEnd(), text: wrapJsx ? `{${call}}` : call });
      done.add(node);
      usesT = true;
    }
  };
  const hasLiteral = (node) => {
    let f = false;
    const v = (n) => { if ((ts.isStringLiteral(n) || ts.isTemplateExpression(n)) && readable(n.getText(src).slice(1, -1))) f = true; ts.forEachChild(n, v); };
    v(node);
    return f;
  };

  // A `mono` element is a token (a command, a path): a placeholder, whatever it holds.
  const isMono = (c) => ts.isJsxElement(c) && /className="[^"]*\bmono\b/.test(c.openingElement.getText(src));
  const isCond = (c) => ts.isJsxExpression(c) && c.expression && (ts.isConditionalExpression(c.expression) || ts.isBinaryExpression(c.expression));
  const meaningful = (children) => children.filter((c) => !(ts.isJsxText(c) && jsxText(c.text).trim() === '' && /\n/.test(c.text)) && !(ts.isJsxExpression(c) && !c.expression));

  // The message of a run of children: text, `{name}` for an expression or an element; an
  // element that holds text of its own (a <strong> lead) gets a key of its own, nested.
  // Null when a child cannot be part of one sentence (a conditional, a list).
  const build = (children, used) => {
    let msg = '';
    const nodes = [];
    for (const c of children) {
      if (ts.isJsxText(c)) { msg += jsxText(c.text); continue; }
      if (ts.isJsxExpression(c) && !c.expression) continue;
      if (ts.isJsxExpression(c)) {
        const e = c.expression;
        if (ts.isStringLiteral(e)) { msg += e.text; continue; }
        if (isCond(c)) return null;
        const name = placeholderName(e, used);
        msg += `{${name}}`;
        const s0 = e.getText(src);
        nodes.push(s0 === name ? name : `${name}: ${s0}`);
        continue;
      }
      const tag = ts.isJsxElement(c) ? c.openingElement.tagName.getText(src) : ts.isJsxSelfClosingElement(c) ? c.tagName.getText(src) : 'el';
      const name = placeholderName(ts.factory.createIdentifier(tag.replace(/\W/g, '').toLowerCase()), used);
      msg += `{${name}}`;
      if (ts.isJsxElement(c) && !isMono(c) && hasReadable(c, src)) {
        const inner = build(meaningful(c.children), new Set());
        if (!inner) return null;
        const im = inner.msg.replace(/\s+/g, ' ').trim();
        const ik = keyFor(prefix, im);
        const call = inner.nodes.length ? `tr(${q(ik)}, { ${inner.nodes.join(', ')} })` : `t(${q(ik)})`;
        if (inner.nodes.length) usesTr = true; else usesT = true;
        nodes.push(`${name}: ${c.openingElement.getText(src)}{${call}}${c.closingElement.getText(src)}`);
      } else nodes.push(`${name}: ${c.getText(src)}`);
    }
    return { msg, nodes };
  };

  // Mixed JSX children: text plus small elements/expressions. Leading and trailing
  // elements with no text (an icon, a <Kbd>) stay outside the sentence.
  const tryMixed = (el) => {
    let kids = meaningful(el.children);
    const texts = kids.filter((c) => ts.isJsxText(c));
    if (texts.length === 0 || !texts.some((c) => readable(jsxText(c.text), true))) return false;
    const hasExpr = (n) => { let f = false; const v = (x) => { if (ts.isJsxExpression(x) && x.expression) f = true; else ts.forEachChild(x, v); }; ts.forEachChild(n, v); return f; };
    const deco = (c) => ts.isJsxSelfClosingElement(c) || (ts.isJsxElement(c) && !hasReadable(c, src) && !isMono(c) && !hasExpr(c));
    let lo = 0, hi = kids.length;
    while (lo < hi && deco(kids[lo])) lo++;
    while (hi > lo && deco(kids[hi - 1])) hi--;
    const core = kids.slice(lo, hi);
    if (core.length <= 1) return false;
    const r = build(core, new Set());
    if (!r) return false;
    const msg = r.msg.replace(/\s+/g, ' ').trim();
    const key = keyFor(prefix, msg);
    const call = r.nodes.length ? `{tr(${q(key)}, { ${r.nodes.join(', ')} })}` : `{t(${q(key)})}`;
    if (r.nodes.length) usesTr = true; else usesT = true;
    edits.push({ start: core[0].getStart(src), end: core[core.length - 1].getEnd(), text: call });
    el.children.forEach((c) => done.add(c));
    // Leading/trailing decorations still get a pass for their attributes.
    kids.slice(0, lo).concat(kids.slice(hi)).forEach((c) => ts.forEachChild(c, visit));
    return true;
  };

  const visit = (node) => {
    if (done.has(node)) return;
    if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(src) === 'data-i18n-skip')) return;
    // Text in a `mono` element is a token: only its attributes get a pass.
    if (isMono(node)) { ts.forEachChild(node.openingElement, visit); return; }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      if (inFunction(node) && tryMixed(node)) {
        // Attributes still need a pass.
        if (ts.isJsxElement(node)) ts.forEachChild(node.openingElement, visit);
        return;
      }
    }
    if (ts.isJsxText(node)) {
      const s = jsxText(node.text);
      if (readable(s, true)) {
        if (!inFunction(node)) { manual.push(`${line(node)}  module-level JSX: ${s}`); return; }
        const lead = node.text.match(/^\s*/)[0], trail = node.text.match(/\s*$/)[0];
        const core = s.trim();
        // Keep a space next to a sibling on the same line.
        const pre = /\n/.test(lead) ? lead : lead.length ? `{${q(lead)}}` : '';
        const post = /\n/.test(trail) ? trail : trail.length ? `{${q(trail)}}` : '';
        edits.push({ start: node.pos, end: node.getEnd(), text: `${pre}{t(${q(keyFor(prefix, core))})}${post}` });
        usesT = true;
      }
      return;
    }
    const attrValue = (init) => {
      if (!init) return;
      if (ts.isStringLiteral(init)) {
        const call = literalCall(init);
        if (call) { edits.push({ start: init.getStart(src), end: init.getEnd(), text: `{${call}}` }); usesT = true; }
      } else if (ts.isJsxExpression(init)) replaceIn(init.expression, false);
    };
    if (ts.isJsxAttribute(node) && VISIBLE.has(node.name.getText(src))) {
      if (!inFunction(node)) { manual.push(`${line(node)}  module-level attribute`); return; }
      attrValue(node.initializer);
      return;
    }
    if (ts.isPropertyAssignment(node) && VISIBLE.has(node.name.getText(src).replace(/['"]/g, ''))) {
      if (!inFunction(node)) {
        if (hasLiteral(node.initializer)) manual.push(`${line(node)}  module-level ${node.name.getText(src)}: ${node.initializer.getText(src).slice(0, 80)}`);
        return;
      }
      replaceIn(node.initializer, false);
      return;
    }
    if (ts.isCallExpression(node) && /(^|\.)(notify|fail|show)$/.test(node.expression.getText(src)) && node.arguments[0]) {
      replaceIn(node.arguments[0], false);
    }
    if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && node.expression) {
      if (inFunction(node)) replaceIn(node.expression, false, true);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);

  if (edits.length === 0) return { file, edits: 0, manual };
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of edits) {
    if (e.end > lastStart) continue; // overlapping: the outer edit already covers it
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  const rel = relative(dirname(file), join(UI, 'src/i18n')).replace(/\\/g, '/') || '.';
  const imp = rel.startsWith('.') ? rel : './' + rel;
  const lines = [];
  if (usesT && !/import \{[^}]*\bt\b[^}]*\} from '[^']*i18n'/.test(out)) lines.push(`import { t } from '${imp}';`);
  if (usesTr && !/\btr\b[^}]*\} from '[^']*i18n\/react'/.test(out)) lines.push(`import { tr } from '${imp}/react';`);
  if (lines.length) {
    const m = [...out.matchAll(/^import [^;]+;\n/gm)].pop();
    const at = m ? m.index + m[0].length : 0;
    out = out.slice(0, at) + lines.join('\n') + '\n' + out.slice(at);
  }
  writeFileSync(file, out);
  return { file, edits: edits.length, manual };
}

for (const f of process.argv.slice(2)) {
  const r = processFile(join(process.cwd(), f));
  console.log(`${relative(UI, r.file)}: ${r.edits} edits`);
  for (const m of r.manual) console.log(`  manual ${m}`);
}
const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(CATALOG, JSON.stringify(sorted, null, 2) + '\n');
