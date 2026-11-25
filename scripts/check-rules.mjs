/**
 * The rules review kept finding by hand, as one script a machine runs.
 *
 * Seven rules, each named by the ticket that paid for it:
 *
 *   1. A browser-safe module imports no Node builtin. The editor's page, the
 *      bundle and the Scene all run in a browser, so `node:crypto` anywhere in
 *      them is a build that only works in Node.
 *   2. A GLOSSARY.md _Avoid_ term never names something in the code, in a test
 *      name or in copy. One word per idea is the point of the glossary, and the
 *      list is read from GLOSSARY.md so the two cannot drift.
 *   3. A test never asserts on the seam's implementation: no markup regexes, no
 *      bounding boxes, no DOM structure or rect reads, no `data-element-id`, no
 *      tag-name selectors, and no test reads a `src/` file for itself.
 *   4. A Node test reaches the Editor only through the `src/editor/` modules
 *      `test/modules.ts` may load. The list is today's set, held still: the
 *      bundle loader names its modules in strings no rule above judges, so a
 *      new Editor internal reached `node:test` four times without a finding.
 *   5. Every `tests/*.e2e.ts` runs in exactly one of the `e2e` scripts, and a
 *      file a script names exists. A suite added without its line in
 *      package.json ran nowhere, and CI stayed green while it did.
 *   6. A module under `src/editor/` imports none of the Renderer's outline
 *      maths, and no fine-grained drawing answer beside `drawnGeometry`: the
 *      drawn place has one answer, and a caller that works it out again is the
 *      second one that disagrees with the page.
 *   7. Every `test/*.test.ts` and `tests/*.e2e.ts` names its seam in its
 *      leading comment (`CLI seam`, `Browser seam`, `Module seam`, or
 *      `Script seam`) and never uses a numbered `Seam <N>`.
 *
 * Usage: node scripts/check-rules.mjs [root]
 *
 * The files are read as the compiler reads them — a parse tree, not a guess at
 * where the strings are — so an import split by a comment, an export alias and
 * a template literal are all seen for what they are. `package.json` is read as
 * JSON, for the files the e2e scripts name. `pnpm check` runs it on the project,
 * and `test/check-rules.test.ts` runs it on fixtures.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));

/** Where the rules look: the sources, the suites, and the scripts a person runs. */
const ROOTS = ['src', 'test', 'tests', 'scripts'];

/** The modules that ship to a browser, so no Node builtin may reach them. */
const BROWSER_SAFE = /^src\/(?:scene|renderer|layout|geometry|paths|sha256)\.ts$|^src\/editor\//;

/** The suites whose job is to drive the outside, never the inside. */
const SUITES = /^(?:test|tests)\//;

/**
 * The `src/editor/` modules a Node test may load, as `test/modules.ts` loads
 * them today. The set is frozen on purpose: a Node test that needs another one
 * is asking the Editor for an inside, and the Browser seam is where it is proved.
 * `bend-point.ts` is the exception the rule allows: what it decides is one
 * arithmetic rule over a Scene and a view, and a tie in that rule is a place no
 * page is driven to on purpose. `snap.ts` is the same kind of exception: one
 * set of pure Scene-to-Scene Snap rules over target choice, settling, freeing,
 * and Anchored ends.
 * `rail.ts` is the exception for the Rail: it owns the floating-placement maths and pointer
 * state machine with supplied measurements, so Node tests can prove them directly.
 * `hand.ts` is the exception for the Scene in hand: it owns the read-only gate,
 * landing, nudge folding, selection, and undo/redo over a supplied save callback.
 * `exits.ts` is the exception for the exit table: it owns every exit row and
 * held-thing column over supplied holders, so Node tests can prove the table directly.
 */
const TEST_EDITOR_MODULES = new Set([
  'history.ts',
  'words.ts',
  'geometry.ts',
  'paint.ts',
  'bend-point.ts',
  'snap.ts',
  'rail.ts',
  'hand.ts',
  'exits.ts',
]);

/** A path in a test that names a module under `src/editor/`: written whole, or as a loader builds it. */
const EDITOR_MODULE = /(?:^|\/)editor\/([\w.-]+\.ts)$/;

/**
 * The Renderer's fine-grained drawn-geometry answers, the ones the query
 * replaced, named one export at a time: the Editor reads `drawnGeometry` and
 * nothing beside it, and this list is what says so if one comes back.
 */
const FINE_GRAINED = new Set([
  'drawnShaft',
  'elementBounds',
  'outlineBox',
  'shaftInk',
  'shaftLabel',
  'strokeWidthOf',
  'wordsInkBounds',
]);

/**
 * The outline maths in `src/geometry.ts` the Editor may not reach, because
 * `drawnGeometry` is the ink's one answer: the Shaft's path, its corners, its
 * dots, its heads and the cut a covered bend takes. The helpers the Editor
 * already shares over an outline — `anchorPoint`, `anchorOf`, `insideOutline`,
 * `alongSegment`, `labelAtFor` — are not here: a Snap and a Label's place are
 * the Editor's own arithmetic over a box the Renderer answers.
 */
const OUTLINE_MATHS = new Set([
  'arrowHeadTriangle',
  'barThrough',
  'cornerOf',
  'curve',
  'cutAtGap',
  'fillets',
  'pathMeetsGap',
  'pointOnOutline',
  'quadraticRoots',
  'shaftDots',
  'shaftLabelAnchor',
  'shaftPath',
  'shaftSide',
  'shaftTangentAt',
  'straight',
  'uAt',
  'writtenFraction',
]);

/** Where those names live, and where a fine-grained answer would come back. */
const OUTLINE_MATHS_MODULE = 'src/geometry.ts';
const RENDERER_MODULE = 'src/renderer.ts';

/** The scripts a `tests/*.e2e.ts` runs in: exactly one of them runs it. */
const E2E_SCRIPTS = ['e2e', 'e2e:agent', 'e2e:shots'];

/** One e2e file as a script names it. */
const E2E_FILE = /tests\/[\w.-]+\.e2e\.ts/g;

/** The checker and its fixtures name the very things it bans, on purpose. */
const SELF = /^(?:scripts\/check-rules\.mjs|test\/check-rules\.test\.ts)$/;

/**
 * The two comments this script takes, each for one rule and nothing else: a
 * markup regex may parse the SVG a save wrote, because that file is public
 * output, and a test may measure a box of the host page's own chrome, because
 * that page is not the element and its layout is nobody's seam. The host-page
 * comment forgives a rect read alone — the structure of a page is never its
 * words — and both are exact on purpose: a string that happens to hold
 * `check-rules:` excuses nothing.
 *
 * They are honour-system: the script sees a pattern and a nearby comment, never
 * the SVG that pattern is handed, so it cannot tell a written file from the
 * page; nor can it see the node a rect is taken of. A person reading the diff is
 * the one who catches a comment on the wrong line.
 */
const EXCUSE = '// check-rules: markup of a written SVG file, not the page';
const HOST_EXCUSE = "// check-rules: rect of the host page's own words, outside <esbozo-editor>";

/** The one read the host-page comment forgives: a box of the host's own chrome. */
const HOST_READ = 'getBoundingClientRect';

/**
 * The tag names the page draws its Scene with, and the one HTML tag a test
 * reaches for by name where a role is the seam. A host page's own chrome — its
 * headings, its inputs — is that page's business, and is not checked.
 */
const TAGS = new Set([
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'text', 'tspan', 'textPath', 'defs', 'use', 'marker', 'title', 'desc', 'symbol',
  'image', 'pattern', 'clipPath', 'linearGradient', 'radialGradient', 'stop', 'mask',
  'filter', 'foreignObject', 'animate', 'button',
]);

/**
 * The reads that see the page's build rather than what it shows: its nodes, the
 * markup it was made of, and the box it was given. A test that reaches for one
 * is asserting on the seam's implementation, so it drives the role or the name
 * and reads the pixels instead.
 */
const DOM_READS = new Set([
  'tagName', 'nodeName', 'children', 'childElementCount', 'firstElementChild',
  'lastElementChild', 'innerHTML', 'outerHTML', 'getBoundingClientRect',
]);

/** The calls a tag name reaches the page through. */
const SELECTOR_CALLS = new Set(['querySelector', 'querySelectorAll', 'getElementsByTagName', 'locator', '$', '$$']);

/** The calls that open a file, so a `src/` argument to one is a test reading source. */
const READERS = new Set(['readFile', 'readFileSync', 'createReadStream', 'readdir', 'readdirSync', 'open', 'openSync']);

/** The calls whose first argument names a test. */
const TEST_CALLS = new Set(['test', 'it', 'describe', 'suite', 'bench']);

/** The tags a page and its drawing are written with, so a regex that names one reads markup. */
const MARKUP_TAGS = new Set([
  ...TAGS,
  'div', 'span', 'p', 'section', 'main', 'header', 'footer', 'nav', 'article', 'aside',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'a', 'img', 'input', 'textarea', 'select', 'option',
  'label', 'form', 'iframe', 'video', 'audio', 'script', 'style', 'link', 'meta', 'html',
  'head', 'body', 'canvas', 'pre', 'code', 'em', 'strong', 'b', 'i', 'small', 'figure',
  'figcaption', 'blockquote', 'hr', 'br',
]);

/**
 * The two sets above, case-folded. Markup spells `clipPath`, `linearGradient`
 * and `textPath` with a capital, and a selector or a regex may spell them any
 * way at all, so the lookup cannot use the written entries.
 */
const TAGS_FOLDED = new Set([...TAGS].map((tag) => tag.toLowerCase()));
const MARKUP_TAGS_FOLDED = new Set([...MARKUP_TAGS].map((tag) => tag.toLowerCase()));

/** The `src/` a test may not open: a path segment, whether written whole or by `join`. */
const SRC = /(?:^|\/)src(?:\/|$)/;

/** The test files whose leading comment must name their seam. */
const NODE_TEST_FILE = /^test\/[^/]+\.test\.ts$/;
const E2E_TEST_FILE = /^tests\/[^/]+\.e2e\.ts$/;
const NUMBERED_SEAM = /\bSeam\s+\d+\b/;
const NAMED_SEAM = /\b(CLI|Browser|Module|Script) seam\b/g;

/** The rules, each one file: its parse tree, its text, and where to report. */
/**
 * The rules, each one file: its parse tree, its text, and where to report.
 */
const RULES = [nodeImports, avoidTerms, testSeams, testSeamLabels, testEditorModules, drawnGeometryOnly];

/** Every finding the rules make, as `path:line: message`. */
const findings = [];

const terms = await glossary(join(ROOT, 'GLOSSARY.md'));
const paths = await files(ROOT);

for (const path of paths) {
  const text = await readFile(join(ROOT, path), 'utf8');
  const source = parse(path, text);
  const file = {
    path,
    text,
    source,
    report: (at, message) => findings.push(`${path}:${lineAt(text, at)}: ${message}`),
  };
  for (const rule of RULES) rule(file);
}

await e2eScripts(ROOT, paths);

findings.sort();
if (findings.length > 0) {
  process.stdout.write(`${findings.join('\n')}\n`);
  process.exitCode = 1;
}

/** Rule 1: a Node builtin in a module the browser loads. */
function nodeImports(file) {
  if (!BROWSER_SAFE.test(file.path)) return;
  for (const { value, at } of specifiers(file.source)) {
    if (value.startsWith('node:')) {
      file.report(at, `node import "${value}" in a browser-safe module`);
    }
  }
}

/**
 * Rule 2: a GLOSSARY.md _Avoid_ term, as a name, a test name or copy.
 *
 * An entry with a parenthetical qualifier — `label (for free-standing text)` —
 * is one sense of the word, so no mechanical rule can tell the senses apart.
 * Every such entry is left to a person; the rest are matched whole, word by
 * word, with the plain inflections a name takes (`shapes`, `shaped`). `Node`
 * followed by a version, `-compatible`, `.js` or `runtime` names the runtime,
 * not an Element, so it is not the term.
 */
function avoidTerms(file) {
  const { path, source, report } = file;
  if (SELF.test(path)) return;

  const specifierNodes = new Set(specifiers(source).map((spec) => spec.node));
  const testNames = testNameNodes(source);

  for (const name of exportedNames(source)) {
    const hit = avoidTermIn(name.text);
    if (hit !== undefined) report(name.at, `avoid term "${hit}" in name "${name.text}"`);
  }

  for (const literal of literals(source)) {
    if (specifierNodes.has(literal.node)) continue;
    if (testNames.has(literal.node)) {
      const hit = avoidTermIn(literal.text);
      if (hit !== undefined) report(literal.at, `avoid term "${hit}" in test name "${literal.text}"`);
      continue;
    }
    for (const run of copyRuns(literal.text)) {
      if (!isCopy(run.text)) continue;
      const hit = avoidTermIn(run.text);
      if (hit !== undefined) {
        report(literal.at + run.at, `avoid term "${hit}" in copy "${run.text.trim()}"`);
      }
    }
  }
}

/** Rule 3: a test that reaches past the seam it is testing. */
function testSeams(file) {
  const { path, text, source, report } = file;
  if (!SUITES.test(path) || SELF.test(path)) return;

  const comments = commentsOf(text, source);
  const excused = (at, excuse = EXCUSE) => {
    const line = lineAt(text, at);
    return comments.some(
      (comment) =>
        comment.text.trim() === excuse && [line, line - 1].includes(lineAt(text, comment.at)),
    );
  };

  every(source, (node) => {
    if (ts.isRegularExpressionLiteral(node)) {
      const body = patternOf(node.getText(source));
      if (body.includes('data-element-id')) {
        report(node.getStart(source), 'data-element-id reaches into the page: use a role, a name or a key');
      } else if (namesMarkup(body) && !excused(node.getStart(source))) {
        report(node.getStart(source), 'markup in a regex: drive the page, do not read the SVG it wrote');
      }
      return;
    }

    if (ts.isPropertyAccessExpression(node) && DOM_READS.has(node.name.text)) {
      const at = node.name.getStart(source);
      const hostBox = node.name.text === HOST_READ && excused(at, HOST_EXCUSE);
      if (!hostBox) {
        report(at, `dom read "${node.name.text}": assert on what the page shows, not on its structure or its rect`);
      }
      return;
    }

    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const method = methodName(node.expression);
      if (method === 'RegExp') {
        const [first] = node.arguments ?? [];
        const body = first === undefined ? undefined : patternSource(first);
        if (body !== undefined && namesMarkup(body) && !excused(node.getStart(source))) {
          report(node.getStart(source), 'markup in a regex: drive the page, do not read the SVG it wrote');
        }
        return;
      }
    }

    if (!ts.isCallExpression(node)) return;
    const method = methodName(node.expression);
    if (method === undefined) return;
    const [first] = node.arguments;

    if (method === 'boundingBox') {
      report(node.getStart(source), "bounding box: assert on what the page shows, not on the SVG's geometry");
      return;
    }

    if (SELECTOR_CALLS.has(method) && first !== undefined) {
      const selector = textOf(first);
      if (selector !== undefined && tagNamed(selector.trim()) !== undefined) {
        report(first.getStart(source), `tag-name selector "${selector.trim()}": use a role, a name or a key`);
      }
      return;
    }

    if (READERS.has(method)) {
      const named = pathLiterals(node.arguments);
      const hit = named.find((part) => part === 'src' || SRC.test(part));
      if (hit !== undefined) {
        report(node.getStart(source), `a test reads "${hit}": the module seam is test/modules.ts`);
      }
    }
  });

  for (const literal of literals(source)) {
    if (literal.text.includes('data-element-id')) {
      const at = literal.at + literal.text.indexOf('data-element-id');
      report(at, 'data-element-id reaches into the page: use a role, a name or a key');
    }
  }
}

/**
 * Rule 7: every test file names its seam in its leading comment, using the
 * named seams in CODING_STANDARDS.md rather than numbered seams.
 */
function testSeamLabels(file) {
  const { path, text, report } = file;
  const isNodeTest = NODE_TEST_FILE.test(path);
  const isE2eTest = E2E_TEST_FILE.test(path);
  if (!isNodeTest && !isE2eTest) return;

  const comment = leadingComment(text);
  const expected = isE2eTest ? 'Browser seam' : 'CLI seam, Module seam, or Script seam';
  if (comment === undefined) {
    report(0, `missing leading seam comment: name ${expected}`);
    return;
  }

  const numbered = NUMBERED_SEAM.exec(comment.text);
  if (numbered !== null) {
    report(
      comment.at + numbered.index,
      `numbered seam "${numbered[0]}": use a named seam (CLI seam, Browser seam, Module seam, or Script seam)`,
    );
    return;
  }

  const found = [...comment.text.matchAll(NAMED_SEAM)].map((match) => match[1]);
  if (found.length === 0) {
    report(comment.at, `leading comment must name a seam (${expected})`);
    return;
  }

  const allowed = isE2eTest ? new Set(['Browser']) : new Set(['CLI', 'Module', 'Script']);
  const wrong = found.find((seam) => !allowed.has(seam));
  if (wrong !== undefined) {
    report(comment.at, `${isE2eTest ? 'tests/*.e2e.ts' : 'test/*.test.ts'} must use ${expected}, not ${wrong} seam`);
  }
}

/** The leading comment of a file (block or consecutive line comments), if any. */
function leadingComment(text) {
  const at = text.search(/\S/);
  if (at === -1) return undefined;
  if (text.startsWith('/*', at)) {
    const end = text.indexOf('*/', at + 2);
    const stop = end === -1 ? text.length : end + 2;
    return { at, text: text.slice(at, stop) };
  }
  if (text.startsWith('//', at)) {
    let cursor = at;
    while (cursor < text.length && text.startsWith('//', cursor)) {
      const nl = text.indexOf('\n', cursor);
      if (nl === -1) {
        cursor = text.length;
        break;
      }
      cursor = nl + 1;
      while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1;
    }
    return { at, text: text.slice(at, cursor) };
  }
  return undefined;
}

/**
 * Rule 4: a Node test loads an Editor module that is not on the allow-list.
 *
 * `test/modules.ts` bundles `src/editor/` by name, so an import rule reading
 * import statements never sees what the bundle reaches. The five modules on the
 * allow-list are the whole of what `node:test` may see of the Editor.
 */
function testEditorModules(file) {
  const { path, source, report } = file;
  if (!/^test\/[^/]+\.ts$/.test(path) || SELF.test(path)) return;
  for (const literal of literals(source)) {
    const named = EDITOR_MODULE.exec(literal.text);
    if (named === null || TEST_EDITOR_MODULES.has(named[1])) continue;
    report(
      literal.at,
      `loads "${literal.text}": node:test reaches the Editor only through the allow-list in check-rules`,
    );
  }
}

/**
 * Rule 6: the Editor reaches an Element's drawn place through the Renderer's
 * query, never through its outline maths.
 *
 * `drawnGeometry` is the one answer to where an Element draws, so a handle, a
 * pick, a Snap and a Label's cue cannot each work it out again. A module under
 * `src/editor/` may not import the Shaft maths in `src/geometry.ts`, and may
 * not import a fine-grained geometry answer beside the query. Reaching for the
 * maths module whole is the same finding: the rule could not then see which
 * outline maths the Editor reads.
 */
function drawnGeometryOnly(file) {
  const { path, source, report } = file;
  if (!path.startsWith('src/editor/')) return;

  for (const { specifier, name, at } of namedImports(source)) {
    const module = resolved(path, specifier);
    if (module === OUTLINE_MATHS_MODULE) {
      if (name === undefined) {
        report(at, 'reaches the outline maths whole: name the export the Editor needs, or ask drawnGeometry');
      } else if (OUTLINE_MATHS.has(name)) {
        report(at, `reaches "${name}" in the outline maths: ask drawnGeometry for the drawn place`);
      }
      continue;
    }
    if (module === RENDERER_MODULE && name !== undefined && FINE_GRAINED.has(name)) {
      report(at, `reaches "${name}" in the Renderer: drawnGeometry is the one answer to a drawn place`);
    }
  }
}

/**
 * Rule 5: every `tests/*.e2e.ts` runs in exactly one e2e script, and every file
 * the scripts name exists.
 *
 * The scripts name their files one by one, so a suite written without its line
 * in package.json runs nowhere while CI stays green — which happened twice. The
 * rule reads the scripts as JSON rather than counting, so the list of files has
 * one owner and the README need not keep a count.
 */
async function e2eScripts(root, paths) {
  let text;
  try {
    text = await readFile(join(root, 'package.json'), 'utf8');
  } catch {
    return;
  }
  let commands;
  try {
    commands = JSON.parse(text).scripts ?? {};
  } catch (error) {
    fail(`package.json: cannot read its scripts: ${error.message}`);
  }

  const report = (at, message) => findings.push(`package.json:${lineAt(text, at)}: ${message}`);
  const scriptsAt = text.indexOf('"scripts"');

  /** Every e2e file a script names, with the scripts that name it. */
  const named = new Map();
  for (const script of E2E_SCRIPTS) {
    const command = commands[script];
    if (typeof command !== 'string') continue;
    for (const [file] of command.matchAll(E2E_FILE)) {
      named.set(file, [...(named.get(file) ?? []), script]);
    }
  }

  const present = new Set(paths);
  for (const path of paths) {
    if (!/^tests\/[^/]+\.e2e\.ts$/.test(path) || named.has(path)) continue;
    report(
      scriptsAt === -1 ? 0 : scriptsAt,
      `${path} is in no e2e script: name it in e2e, e2e:agent or e2e:shots`,
    );
  }

  for (const [file, scripts] of named) {
    const at = text.indexOf(file);
    if (!present.has(file)) {
      report(at, `the ${scripts[0]} script names "${file}", which does not exist`);
    } else if (scripts.length > 1) {
      report(at, `${file} is in more than one e2e script (${scripts.join(', ')}): exactly one runs it`);
    }
  }
}

/** The text of a regex literal's pattern, without its slashes and flags. */
function patternOf(literal) {
  const close = literal.lastIndexOf('/');
  return literal.slice(1, close === 0 ? literal.length : close);
}

/**
 * A `RegExp(...)` argument as a pattern. A template's literal parts are joined
 * by one letter of the drawing's own words, so `<${name}[^>]*>` still reads as
 * the tag it builds.
 */
function patternSource(node) {
  const literal = textOf(node);
  if (literal !== undefined) return literal;
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('g');
  }
  return undefined;
}

/**
 * Whether a pattern, or the text of a string, names markup: a tag of the page or
 * of the drawing, or a custom element. A usage line's `<scene>` and `<file>` are
 * placeholders, not tags, and stay quiet.
 */
function namesMarkup(text) {
  for (const match of text.matchAll(/<\/?([A-Za-z][\w:-]*)/g)) {
    // `<svg:svg>` writes a tag the drawing uses under its namespace, so the
    // name after the colon is the one that counts.
    for (const written of [match[1], match[1].slice(match[1].lastIndexOf(':') + 1)]) {
      const name = written.toLowerCase();
      if (MARKUP_TAGS_FOLDED.has(name) || name.includes('-')) return true;
    }
  }
  return false;
}

/** The tag a selector names, if it names one: `svg path`, `g[data-element]`, `button`. */
function tagNamed(selector) {
  for (const part of selector.split(/[\s>+~,]+/)) {
    if (part === '') continue;
    const match = /^([A-Za-z][\w-]*)/.exec(part);
    if (match !== null && TAGS_FOLDED.has(match[1].toLowerCase())) return match[1].toLowerCase();
  }
  return undefined;
}

/** Every literal in the file's arguments: the parts of a path a reader may open. */
function pathLiterals(nodes) {
  const parts = [];
  for (const node of nodes) {
    every(node, (child) => {
      const text = ts.isTemplateExpression(child) ? undefined : textOf(child);
      if (text !== undefined) parts.push(text);
      if (ts.isTemplateExpression(child)) {
        parts.push(child.head.text, ...child.templateSpans.map((span) => span.literal.text));
      }
    });
  }
  return parts;
}

/** The terms a glossary's `_Avoid_:` lines reject, or a loud failure. */
async function glossary(file) {
  let markdown;
  try {
    markdown = await readFile(file, 'utf8');
  } catch (error) {
    fail(`GLOSSARY.md: cannot read the Avoid list: ${error.code ?? error.message}`);
  }
  const found = avoidTermsOf(markdown);
  if (found.length === 0) fail('GLOSSARY.md: no _Avoid_ entries, so rule 2 would check nothing');
  return found;
}

/** Stop with a message a person can act on: a missing policy is not a quiet pass. */
function fail(message) {
  process.stdout.write(`${message}\n`);
  process.exit(1);
}

/** The terms a glossary's `_Avoid_:` lines reject. */
function avoidTermsOf(markdown) {
  const terms = [];
  for (const [, list] of markdown.matchAll(/^_Avoid_:(.*(?:\n(?!\*|_|$).*)*)/gm)) {
    for (const entry of list.split(',')) {
      // A qualifier makes the entry one sense of a word the glossary uses
      // elsewhere: `label (for free-standing text)`. A person picks the sense.
      if (/\([^)]*\)/.test(entry)) continue;
      const bare = entry.replace(/\s+/g, ' ').trim().toLowerCase();
      if (bare === '' || !/[a-z]/.test(bare)) continue;
      terms.push(bare);
    }
  }
  return terms;
}

/** Whether a string reads as copy a person sees, rather than as code or a path. */
function isCopy(body) {
  const text = body.trim();
  if (!/^[A-Za-z][A-Za-z0-9 ,.!?;:'’"()\-–—]*$/.test(text)) return false;
  // `esbozo-editor .board` is a selector, not a sentence a person reads.
  if (/\.\s*[a-z]/i.test(text)) return false;
  // A sentence or a UI label: words with spaces, or one capitalised word.
  return text.includes(' ') || /^[A-Z]/.test(text);
}

/**
 * The runs of a literal that a person reads: the whole string, or — in a
 * template that is markup — the words between its tags and the labels its
 * attributes carry, because a button's text is copy like any other.
 */
function copyRuns(text) {
  if (!text.includes('<')) return [{ text, at: 0 }];
  const runs = [];
  let cursor = 0;
  for (const tag of text.matchAll(/<[^>]*>/g)) {
    if (tag.index > cursor) runs.push({ text: text.slice(cursor, tag.index), at: cursor });
    for (const attribute of tag[0].matchAll(/\b(?:aria-label|title|placeholder|alt)\s*=\s*"([^"]*)"/g)) {
      runs.push({ text: attribute[1], at: tag.index + attribute.index + attribute[0].indexOf('"') + 1 });
    }
    cursor = tag.index + tag[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), at: cursor });
  return runs;
}

/** The Avoid term this text holds, if it holds one. */
function avoidTermIn(text) {
  const found = words(text);
  for (const term of terms) {
    const wanted = term.split(' ');
    for (let at = 0; at + wanted.length <= found.length; at += 1) {
      if (!wanted.every((word, step) => same(found[at + step].word, word))) continue;
      // `Node 22`, `Node-compatible`, `Node.js` and the `Node runtime` name the
      // runtime the code runs on, not an Element.
      if (wanted.length === 1 && term === 'node' && namesRuntime(text, found[at].end)) continue;
      return term;
    }
  }
  return undefined;
}

/** Whether what follows a `node` makes it the runtime's name. */
function namesRuntime(text, end) {
  return /^\s*(?:\d|-compatible|\.js|runtime)/i.test(text.slice(end));
}

/** Whether a word is the term, or the plain inflection of it: `shapes`, `shaped`. */
function same(word, term) {
  return [`${term}`, `${term}s`, `${term}es`, `${term}d`, `${term}ed`].includes(word);
}

/**
 * A name or a line of copy as whole words, each with where it sits: `ShapeElement`
 * is `shape` and `element`, `SHAPE_ELEMENT` is two words, and `node_modules` is
 * one word, not `node`.
 */
function words(text) {
  const found = [];
  for (const token of text.matchAll(/[A-Za-z0-9_]+/g)) {
    const raw = token[0];
    const base = token.index;
    if (raw.includes('_') && /^[A-Z0-9_]+$/.test(raw)) {
      let at = 0;
      for (const piece of raw.split('_')) {
        if (piece !== '') found.push({ word: piece.toLowerCase(), at: base + at, end: base + at + piece.length });
        at += piece.length + 1;
      }
      continue;
    }
    let start = 0;
    for (let index = 1; index <= raw.length; index += 1) {
      const next = raw[index] ?? '';
      const before = raw[index - 1];
      const boundary =
        index === raw.length ||
        (/[a-z0-9]/.test(before) && /[A-Z]/.test(next)) ||
        (/[A-Z]/.test(before) && /[A-Z]/.test(next) && /[a-z]/.test(raw[index + 1] ?? ''));
      if (!boundary) continue;
      found.push({ word: raw.slice(start, index).toLowerCase(), at: base + start, end: base + index });
      start = index;
    }
  }
  return found;
}

/**
 * The names that leave their module: an Element, a Style, a tool — the words
 * other code and other people have to live with. A local called `node` for a
 * DOM node is that module's own business, and the glossary has no quarrel.
 */
function exportedNames(source) {
  const found = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          found.push(named(source, element.name));
        }
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) found.push(named(source, name));
      }
      continue;
    }
    const name = statement.name;
    if (name !== undefined) found.push(named(source, name));
  }
  return found.filter((entry) => entry !== undefined);
}

/** A node as the name it writes, and where it writes it. */
function named(source, node) {
  return { text: node.getText(source), at: node.getStart(source) };
}

/** The names a binding introduces: `const { a, b } = x` names two. */
function bindingNames(binding) {
  if (ts.isIdentifier(binding)) return [binding];
  const names = [];
  for (const element of binding.elements) {
    if (ts.isBindingElement(element)) names.push(...bindingNames(element.name));
  }
  return names;
}

/** The literals in a test call's first argument: the name a failure prints. */
function testNameNodes(source) {
  const found = new Set();
  every(source, (node) => {
    if (!ts.isCallExpression(node) || !isTestCall(node.expression)) return;
    const [first] = node.arguments;
    if (first !== undefined) found.add(first);
  });
  return found;
}

/**
 * Whether a callee is `test`, `it`, `describe` or one of their forms. A runner
 * hangs the same call off its own handle — `t.test`, `describe.skip`, `it.only`
 * — so every name in the chain is read, not only the leftmost one.
 */
function isTestCall(expression) {
  let callee = expression;
  while (ts.isPropertyAccessExpression(callee)) {
    if (TEST_CALLS.has(callee.name.text)) return true;
    callee = callee.expression;
  }
  return ts.isIdentifier(callee) && TEST_CALLS.has(callee.text);
}

/** The name a call is made by: `page.locator(...)` is a `locator`. */
function methodName(expression) {
  if (expression === undefined) return undefined;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text;
  return undefined;
}

/**
 * The names a file imports from a module, and the module itself: a named
 * import, a re-export, or the whole module under a namespace, which names no
 * export at all. A type-only import is named like any other, because every
 * name the rules know is a value name.
 */
function namedImports(source) {
  const found = [];
  every(source, (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = textOf(node.moduleSpecifier);
      const bindings = node.importClause?.namedBindings;
      if (specifier === undefined || bindings === undefined) return;
      if (ts.isNamespaceImport(bindings)) {
        found.push({ specifier, name: undefined, at: node.getStart(source) });
        return;
      }
      for (const element of bindings.elements) {
        const name = element.propertyName ?? element.name;
        found.push({ specifier, name: name.text, at: name.getStart(source) });
      }
      return;
    }
    if (!ts.isExportDeclaration(node)) return;
    const specifier = node.moduleSpecifier === undefined ? undefined : textOf(node.moduleSpecifier);
    const clause = node.exportClause;
    if (specifier === undefined || clause === undefined || !ts.isNamedExports(clause)) return;
    for (const element of clause.elements) {
      const name = element.propertyName ?? element.name;
      found.push({ specifier, name: name.text, at: name.getStart(source) });
    }
  });
  return found;
}

/** The file a relative specifier names, as the `.ts` this repository writes. */
function resolved(from, specifier) {
  if (!specifier.startsWith('.')) return undefined;
  const parts = from.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join('/').replace(/\.js$/, '.ts');
}

/** The specifiers a file imports, exports or requires, however it writes them. */
function specifiers(source) {
  const found = [];
  const add = (node) => {
    const value = textOf(node);
    if (value !== undefined) found.push({ value, node, at: node.getStart(source) });
  };
  every(source, (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined) add(specifier);
      return;
    }
    if (ts.isImportEqualsDeclaration(node)) {
      // `import crypto = require('node:crypto')` is the alias form of the same
      // import, and imports the same builtin.
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && reference.expression !== undefined) {
        add(reference.expression);
      }
      return;
    }
    if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
      return;
    }
    if (!ts.isCallExpression(node)) return;
    const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const required = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (!dynamic && !required) return;
    const [first] = node.arguments;
    if (first !== undefined) add(first);
  });
  return found;
}

/** A string literal's text, when the node is one. */
function textOf(node) {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

/** Every string in a file, as its text, its offset and the node the compiler made. */
function literals(source) {
  const found = [];
  every(source, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      found.push({ node, text: node.text, at: node.getStart(source) + 1 });
      return;
    }
    if (!ts.isTemplateExpression(node)) return;
    found.push({ node: node.head, text: node.head.text, at: node.head.getStart(source) + 1 });
    for (const span of node.templateSpans) {
      found.push({ node: span.literal, text: span.literal.text, at: span.literal.getStart(source) + 1 });
    }
  });
  return found;
}

/** Every line of the file that is a comment, rather than a string that looks like one. */
function commentsOf(text, source) {
  const spans = [];
  every(source, (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      spans.push([node.getStart(source), node.getEnd()]);
    }
  });
  spans.sort((left, right) => left[0] - right[0]);

  const found = [];
  let span = 0;
  let at = 0;
  while (at < text.length) {
    while (span < spans.length && spans[span][1] <= at) span += 1;
    const here = spans[span];
    if (here !== undefined && at >= here[0] && at < here[1]) {
      at = here[1];
      continue;
    }
    if (text.startsWith('//', at)) {
      const end = text.indexOf('\n', at);
      const stop = end === -1 ? text.length : end;
      found.push({ at, text: text.slice(at, stop) });
      at = stop;
      continue;
    }
    if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
      continue;
    }
    at += 1;
  }
  return found;
}

/** A file as the compiler reads it, from its extension. */
function parse(path, text) {
  const extension = path.slice(path.lastIndexOf('.'));
  const kinds = {
    '.ts': ts.ScriptKind.TS,
    '.tsx': ts.ScriptKind.TSX,
    '.js': ts.ScriptKind.JS,
    '.mjs': ts.ScriptKind.JS,
    '.cjs': ts.ScriptKind.JS,
  };
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kinds[extension] ?? ts.ScriptKind.TS);
}

/** Every node of the tree, the root included. */
function every(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => every(child, visit));
}

/** The 1-based line an offset sits on. */
function lineAt(text, at) {
  return text.slice(0, at).split('\n').length;
}

/** The files the rules read, relative to the root and `/`-separated. */
async function files(root) {
  const found = [];
  for (const name of ROOTS) {
    const top = join(root, name);
    let entries;
    try {
      entries = await readdir(top, { withFileTypes: true, recursive: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const path = `${name}/${relative(top, join(entry.parentPath, entry.name)).split(sep).join('/')}`;
      if (path.includes('node_modules/')) continue;
      if (!/\.(?:ts|tsx|js|mjs|cjs)$/.test(path)) continue;
      found.push(path);
    }
  }
  return found.sort();
}
