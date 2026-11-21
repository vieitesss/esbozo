/**
 * The rules review kept finding by hand, as one script a machine runs.
 *
 * Three rules, each named by the ticket that paid for it:
 *
 *   1. A browser-safe module imports no Node builtin. The editor's page, the
 *      bundle and the Scene all run in a browser, so `node:crypto` anywhere in
 *      them is a build that only works in Node.
 *   2. A GLOSSARY.md _Avoid_ term never names something in the code, in a test
 *      name or in copy. One word per idea is the point of the glossary, and the
 *      list is read from GLOSSARY.md so the two cannot drift.
 *   3. A test never asserts on the seam's implementation: no markup regexes, no
 *      bounding boxes, no `data-element-id`, no tag-name selectors, and no test
 *      reads a `src/` file for itself.
 *
 * Usage: node scripts/check-rules.mjs [root]
 *
 * Plain Node, no dependencies, and no configuration but the root: `pnpm check`
 * runs it on the project, and `test/check-rules.test.ts` runs it on fixtures.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));

/** The modules that ship to a browser, so no Node builtin may reach them. */
const BROWSER_SAFE = /^src\/(?:scene|renderer|layout|geometry|paths|sha256)\.ts$|^src\/editor\//;

/** The suites whose job is to drive the outside, never the inside. */
const SUITES = /^(?:test|tests)\//;

/**
 * The files allowed to name a `src/` module, each for a reason:
 * `test/modules.ts` is the module seam itself, and `test/sha256.test.ts` imports
 * the dependency-free digest to compare it with OpenSSL, which is the point of
 * that suite.
 */
const SEAMS = ['test/modules.ts', 'test/sha256.test.ts'];

/** The tag names an SVG is written with, and so the ones a test may not select on. */
const TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'use', 'marker',
];

/** The calls a tag name reaches the page through. */
const SELECTORS = /(?:\bquerySelector(?:All)?|\bgetElementsByTagName|\blocator|\$+)\s*\(\s*$/;

/** The calls that open a file, so a `src/` argument to one is a test reading source. */
const READERS = /\b(?:readFile|readFileSync|createReadStream|readdir|open)\s*\(\s*$/;

/** The calls whose first argument names a test. */
const TEST_CALL = /\b(?:test|it|describe|test\.only|test\.skip)\s*\(\s*$/;

/** The specifier contexts, whose strings are paths rather than copy. */
const SPECIFIER = /\b(?:from|import|export|require\s*\()\s*$/;

/** The checker and its fixtures name the very things it bans, on purpose. */
const SELF = /^(?:scripts\/check-rules\.mjs|test\/check-rules\.test\.ts)$/;

/** Checks that need no filesystem: one file's text, and where it lives. */
const RULES = [nodeImports, avoidTerms, testSeams];

/** The Avoid terms GLOSSARY.md rejects. */
const rejected = avoidTermsOf(await readFile(join(ROOT, 'GLOSSARY.md'), 'utf8').catch(() => ''));

/** Every finding the rules make, as `path:line: message`. */
const findings = [];

for (const path of await files(ROOT)) {
  const text = await readFile(join(ROOT, path), 'utf8');
  const file = {
    path,
    ...scan(text),
    report: (at, message) => findings.push(`${path}:${lineAt(text, at)}: ${message}`),
  };
  for (const rule of RULES) rule(file);
}

findings.sort();
if (findings.length > 0) {
  process.stdout.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
}

/** Rule 1: a Node builtin in a module the browser loads. */
function nodeImports({ path, report, strings }) {
  if (!BROWSER_SAFE.test(path)) return;
  for (const { body, at, before } of strings) {
    if (body.startsWith('node:') && SPECIFIER.test(before)) {
      report(at, `node import "${body}" in a browser-safe module`);
    }
  }
}

/**
 * Rule 2: a GLOSSARY.md _Avoid_ term, as a name, a test name or copy.
 *
 * An entry with a parenthetical qualifier — `label (for free-standing text)` —
 * is one sense of a word the glossary prefers elsewhere (`Label` is a headword),
 * so no mechanical rule can tell those senses apart. Those entries are left to a
 * person. Every other term is matched whole, word by word, so `keyboard` is not
 * `board` and `shaped` is not `shape`.
 */
function avoidTerms({ path, report, code, strings }) {
  if (rejected.length === 0 || SELF.test(path)) return;

  for (const [name, at] of exportedNames(code)) {
    const hit = findTerm(rejected, words(name));
    if (hit !== undefined) report(at, `avoid term "${hit}" in name "${name}"`);
  }

  for (const { body, at, before } of strings) {
    const hit = findTerm(rejected, words(body));
    if (hit === undefined) continue;
    if (TEST_CALL.test(before)) report(at, `avoid term "${hit}" in test name "${body}"`);
    else if (isCopy(body, before)) report(at, `avoid term "${hit}" in copy "${body}"`);
  }
}

/** Rule 3: a test that reaches past the seam it is testing. */
function testSeams({ path, report, code, strings, regexes }) {
  if (!SUITES.test(path) || SELF.test(path)) return;

  for (const match of code.matchAll(/\bboundingBox\s*\(/g)) {
    report(match.index, "bounding box: assert on what the page shows, not on the SVG's geometry");
  }

  const markup = new RegExp(`<\\s*/?\\s*(?:${TAGS.join('|')})\\b`, 'i');
  for (const { body, at, kind } of [...regexes, ...strings]) {
    if (kind === 'regex' && markup.test(body)) {
      report(at, 'markup in a regex: drive the page, do not read the SVG it wrote');
    }
    if (body.includes('data-element-id')) {
      report(at, 'data-element-id reaches into the page: use a role, a name or a key');
    }
  }

  for (const { body, at, before } of strings) {
    if (SELECTORS.test(before) && TAGS.includes(body.trim().toLowerCase())) {
      report(at, `tag-name selector "${body.trim()}": use a role, a name or a key`);
    }
    if (SEAMS.includes(path)) continue;
    if (!READERS.test(before) || !/(?:^|\/)src\//.test(body)) continue;
    report(at, `a test reads "${body}": the module seam is ${SEAMS[0]}`);
  }
}

/** The terms a glossary's `_Avoid_:` lines reject. */
function avoidTermsOf(markdown) {
  const headwords = new Set(
    [...markdown.matchAll(/^\*\*(.+?)\*\*:/gm)].map(([, headword]) => headword.trim().toLowerCase()),
  );
  const terms = [];
  for (const [, list] of markdown.matchAll(/^_Avoid_:(.*(?:\n(?!\*|_|$).*)*)/gm)) {
    for (const entry of list.split(',')) {
      const qualified = /\([^)]*\)/.test(entry);
      const bare = entry.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (bare === '' || !/[a-z]/.test(bare)) continue;
      // One sense of the glossary's own word: `label` is a headword, and only
      // free-standing Text is the wrong sense. A person reads that, not a script.
      if (qualified && headwords.has(bare)) continue;
      terms.push(bare);
    }
  }
  return terms;
}

/** Whether a string reads as copy a person sees, rather than as code or a path. */
function isCopy(body, before) {
  if (SPECIFIER.test(before)) return false;
  if (!/^[A-Za-z][A-Za-z0-9 ,.!?'’—–-]*$/.test(body)) return false;
  // A sentence or a UI label: words with spaces, or one capitalised word.
  return body.includes(' ') || /^[A-Z]/.test(body);
}

/** Whether a word is the term, or the term's plural: `drawings` is `drawing`. */
function same(word, term) {
  return word === term || word === `${term}s`;
}

/** Whether any of the terms appears as that run of whole words in these words. */
function findTerm(terms, found) {
  for (const term of terms) {
    const wanted = term.split(' ');
    for (let at = 0; at + wanted.length <= found.length; at += 1) {
      if (wanted.every((word, step) => same(found[at + step], word))) return term;
    }
  }
  return undefined;
}

/**
 * A name or a line of copy as whole words: `ShapeElement` is `shape` and
 * `element`, and `node_modules` is one word, not `node`.
 */
function words(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/_\s*|[^A-Za-z_]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}

/**
 * The names that leave their module: an Element, a Style, a tool — the words
 * other code and other people have to live with. A local called `node` for a
 * DOM node is that module's own business, and the glossary has no quarrel.
 */
function exportedNames(code) {
  const found = [];
  for (const pattern of [
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+default\s+(?:async\s+)?(?:class|function)\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push([match[1], match.index]);
  }
  return found;
}

/**
 * A file as this script sees it: its code with comments and strings blanked, and
 * the strings and regexes it holds, each with the text that calls it.
 */
function scan(text) {
  const code = [...text];
  const strings = [];
  const regexes = [];
  let at = 0;
  let last = '';
  while (at < text.length) {
    const here = text[at];
    const end =
      here === '/' && text[at + 1] === '/' ? endOfLine(text, at)
      : here === '/' && text[at + 1] === '*' ? endOfBlock(text, at)
      : here === "'" || here === '"' || here === '`' ? endOfString(text, at)
      : here === '/' && /^(?:[(,=:[!&|?{};]|return)$/.test(last) ? endOfRegex(text, at)
      : null;
    if (end === null) {
      if (!/\s/.test(here)) last = here;
      at += 1;
      continue;
    }
    const before = text.slice(Math.max(0, at - 32), at).trimStart();
    if (here === "'" || here === '"' || here === '`') {
      if (text[end] !== here) {
        // An unterminated string is a syntax error: the compiler's to report.
        last = here;
        at += 1;
        continue;
      }
      strings.push({ body: text.slice(at + 1, end), at: at + 1, before, kind: 'string' });
    } else if (here === '/' && text[at + 1] !== '/' && text[at + 1] !== '*') {
      regexes.push({ body: text.slice(at + 1, end), at: at + 1, before, kind: 'regex' });
    }
    for (let index = at; index < end + 1; index += 1) {
      if (code[index] !== '\n') code[index] = ' ';
    }
    at = end + 1;
  }
  return { code: code.join(''), strings, regexes };
}

function endOfLine(text, at) {
  const newline = text.indexOf('\n', at);
  return newline === -1 ? text.length : newline - 1;
}

function endOfBlock(text, at) {
  const close = text.indexOf('*/', at + 2);
  return close === -1 ? text.length - 1 : close + 1;
}

function endOfString(text, at) {
  const quote = text[at];
  let index = at + 1;
  while (index < text.length) {
    if (text[index] === '\\') index += 2;
    else if (text[index] === quote) return index;
    else if (text[index] === '\n' && quote !== '`') return index;
    else index += 1;
  }
  return text.length;
}

function endOfRegex(text, at) {
  let index = at + 1;
  let inClass = false;
  while (index < text.length) {
    const here = text[index];
    if (here === '\\') index += 2;
    else if (here === '[') {
      inClass = true;
      index += 1;
    } else if (here === ']') {
      inClass = false;
      index += 1;
    } else if (here === '/' && !inClass) return index;
    else if (here === '\n') return at;
    else index += 1;
  }
  return at;
}

/** The 1-based line an offset sits on. */
function lineAt(text, at) {
  return text.slice(0, at).split('\n').length;
}

/** The files the rules read, relative to the root and `/`-separated. */
async function files(root) {
  const found = [];
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name)).split(sep).join('/');
    if (/^(?:node_modules|dist|\.e2e|\.git)\//.test(path)) continue;
    if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(path)) found.push(path);
  }
  return found.sort();
}
