// Every visible string of the page comes from the catalog (milestone 66, D-140): this
// walks the migrated folders and fails on text written in place: JSX text, a literal in
// a visible attribute or prop, a literal `label`/`text`/`title`/`desc` field, and a
// literal given to notify(). Milestone 67 extends it to all of ui/src.

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import en from './en.json';

// Every source of the page, by its path under src/ ('shell/Shell.tsx').
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)
    .map(([k, v]) => [k.replace(/^\.\.\//, ''), v]),
);

/** The folders and files already in the catalog. */
export const MIGRATED = ['ui', 'update', 'screens', 'palette', 'shell', 'pages', 'App.tsx', 'i18n', 'access', 'sync', 'lib/sync.ts'];

/** Attributes and props whose value a person reads. */
const VISIBLE = new Set([
  'title', 'placeholder', 'aria-label', 'alt', 'label', 'desc', 'hint', 'text', 'note',
  'heading', 'confirmLabel', 'cancelLabel', 'okLabel', 'message', 'detail', 'subtitle', 'tooltip', 'empty', 'body', 'action', 'reason',
]);

/** Literals that read the same in every language: names, keys, symbols. */
const SAME_IN_EVERY_LANGUAGE = new Set([
  'Flint', 'SSH', 'RDP', 'SFTP', 'CLI', 'ntfy', 'ntfy.sh', 'Tether', 'GitHub', 'macOS', 'Linux', 'Windows',
  'Esc', 'Tab', 'Enter', 'Return', 'Ctrl', 'Alt', 'Shift', 'Space', 'Del', 'Backspace', 'Home', 'End',
  'PgUp', 'PgDn', 'esc', 'tab', 'English', 'Español', 'libssh', 'libsodium', 'SQLCipher', 'FreeRDP', 'OK',
  'root', 'sudo', 'sudo --', 'exec', 'pid',
]);

// `prose`: JSX text, where a lone lowercase word is still a word.
function readable(text: string, prose = false): boolean {
  const s = text.trim();
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (SAME_IN_EVERY_LANGUAGE.has(s)) return false;
  // A `flint` command line reads the same in every language.
  if (/^flint( |$)/.test(s)) return false;
  // A CSS value, a class list, an id or a key: no space and not capitalised prose.
  if (!prose && /^[a-z0-9_.:\-/#%()]+$/.test(s)) return false;
  // An identifier in camelCase: an action's or a field's name.
  if (!prose && /^[a-z][A-Za-z0-9]*$/.test(s)) return false;
  // A shortcut such as ⌘R, Ctrl+Shift+P, F5.
  if (/^([⌘⇧⌥⌃]|Ctrl\+|Alt\+|Shift\+|Cmd\+)*([A-Z0-9]{1,3}|↵|Tab|Space|Esc)$/.test(s)) return false;
  return true;
}

function files(path: string): string[] {
  return Object.keys(SOURCES).filter((f) => (f === path || f.startsWith(path + '/'))
    && !/\.test\.tsx?$/.test(f) && !f.includes('fixture'));
}

export interface Leak { file: string; line: number; text: string }

function literalText(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((s) => s.literal.text).join(' ');
  if (ts.isJsxExpression(node)) return literalText(node.expression);
  if (ts.isParenthesizedExpression(node)) return literalText(node.expression);
  if (ts.isConditionalExpression(node)) {
    const a = literalText(node.whenTrue), b = literalText(node.whenFalse);
    if (a !== null && readable(a, true)) return a;
    return b !== null && readable(b, true) ? b : null;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = literalText(node.left), b = literalText(node.right);
    return [a, b].filter((x) => x !== null).join(' ') || null;
  }
  return null;
}

function insideFunction(node: ts.Node): boolean {
  for (let p = node.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return true;
  return false;
}

/** Keys named as literals in t('…') and tr('…') calls that en.json lacks. */
export function missingKeys(paths: string[]): string[] {
  const cat = en as Record<string, string>;
  const out: string[] = [];
  for (const file of paths.flatMap(files)) {
    for (const m of SOURCES[file].matchAll(/\btr?\(\s*'([a-z0-9_.]+)'/g)) {
      const k = m[1];
      if (cat[k] === undefined && cat[`${k}.other`] === undefined) out.push(`${file}  ${k}`);
    }
    // Keys kept in tables ('settings_page.section.vault') and read through t(table[x]).
    for (const m of SOURCES[file].matchAll(/'((?:[a-z0-9_]+\.){2,}[a-z0-9_]+)'/g)) {
      const k = m[1];
      if (/^[a-z_]+\.[a-z_]+\./.test(k) && k.split('.')[0] in PREFIXES && cat[k] === undefined && cat[`${k}.other`] === undefined) out.push(`${file}  ${k}`);
    }
  }
  return [...new Set(out)];
}

const PREFIXES: Record<string, true> = Object.fromEntries(Object.keys(en).map((k) => [k.split('.')[0], true]));

export function leaks(paths: string[]): Leak[] {
  const out: Leak[] = [];
  for (const file of paths.flatMap(files)) {
    const src = ts.createSourceFile(file, SOURCES[file], ts.ScriptTarget.Latest, true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const lines = SOURCES[file].split('\n');
    const report = (node: ts.Node, text: string | null, prose = false) => {
      // `// i18n-ignore: why` on the line, or above the statement that holds the text:
      // text that must stay as it is (what the core sends a phone).
      for (let n: ts.Node | undefined = node; n && n !== src; n = n.parent) {
        const at = src.getLineAndCharacterOfPosition(n.getStart()).line;
        if (/i18n-ignore/.test(lines[at] ?? '') || /i18n-ignore/.test(lines[at - 1] ?? '')) return;
      }
      // Text in a `mono` element is a token: a command, a file extension, a code.
      for (let n: ts.Node | undefined = node.parent; n && n !== src; n = n.parent) {
        if (ts.isJsxElement(n) && /className="[^"]*\bmono\b/.test(n.openingElement.getText(src))) return;
      }
      if (text !== null && readable(text, prose)) {
        out.push({ file, line: src.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: text.trim() });
      }
    };
    const visit = (node: ts.Node) => {
      // An element marked `data-i18n-skip` holds sample content (a terminal preview).
      if ((ts.isJsxElement(node) && node.openingElement.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(src) === 'data-i18n-skip'))) return;
      if (ts.isJsxText(node)) report(node, node.text, true);
      else if (ts.isJsxExpression(node) && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) report(node, literalText(node.expression), true);
      else if (ts.isJsxAttribute(node) && VISIBLE.has(node.name.getText(src))) report(node, literalText(node.initializer));
      else if (ts.isPropertyAssignment(node) && VISIBLE.has(node.name.getText(src).replace(/['"]/g, ''))) report(node, literalText(node.initializer));
      else if (ts.isCallExpression(node) && /(^|\.)(notify|fail|show)$/.test(node.expression.getText(src))) report(node, literalText(node.arguments[0]));
      // A sentence or a capitalised word kept in a module-level table (a label map).
      else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !insideFunction(node)
        && !ts.isImportDeclaration(node.parent) && !ts.isLiteralTypeNode(node.parent) && !ts.isExportDeclaration(node.parent)
        && /^[A-Z][a-z]*([ ,.?!]|$)/.test(node.text) && /[a-z]{2}/.test(node.text)) report(node, node.text);
      ts.forEachChild(node, visit);
    };
    visit(src);
  }
  return out;
}

describe('the catalog guard', () => {
  it('finds every key the migrated folders name in en.json', () => {
    expect(missingKeys(MIGRATED)).toEqual([]);
  });

  it('finds no text written in place in the migrated folders', () => {
    const found = leaks(MIGRATED).map((l) => `${l.file}:${l.line}  ${l.text}`);
    expect(found).toEqual([]);
  });
});
