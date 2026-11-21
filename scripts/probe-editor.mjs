/**
 * A live-editor probe: one command boots the built editor in Chromium and runs a
 * probe module against it.
 *
 * A probe is how a change is judged on the running page — what a click paints,
 * what a keystroke saves, what the screen looks like a moment later — without
 * writing a whole e2e file for it. Each probe used to boot its own static server
 * and Chromium from an inline `node --input-type=module` script that named the
 * pnpm store's copy of Playwright by version, so the script broke on every
 * upgrade. The helper owns that boilerplate once.
 *
 * Usage: `pnpm probe [probe.mjs]`, or `pnpm probe < probe.mjs` to read the probe
 * from stdin. `--folder <dir>` serves another build (default `dist`).
 *
 * The probe module's default export is called with `{ page, url, cdp }`:
 *
 * - `page` — the live Playwright page, opened on the editor;
 * - `url` — where it was opened;
 * - `cdp()` — a CDP session on that page, for the input only the browser
 *   protocol can send (`tests/cdp.ts` is where the editor's own suite uses one).
 *
 * What the probe returns is printed as JSON on stdout, and the page's URL goes to
 * stderr before the probe runs. The browser and the server are closed whether the
 * probe returned, threw, or the run was interrupted.
 *
 * It serves `dist/` as it finds it: `pnpm probe` does not build.
 */
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PAGE_ASSETS } from '../src/page-assets.ts';

/**
 * Playwright, as the e2e stack installed it. `playwright-core` arrives with
 * `@e2e-dev/web`, so it is resolved through that dependency's own folder instead
 * of naming a `.pnpm/playwright-core@<version>` path that moves on every upgrade.
 * Imported as CommonJS, whose named exports the module lexer does not recover,
 * so the browser comes off its default export.
 */
const fromRepo = createRequire(import.meta.url);
const web = fromRepo.resolve('@e2e-dev/web');
const playwright = await import(pathToFileURL(createRequire(web).resolve('playwright-core')).href);
const { chromium } = playwright.chromium === undefined ? playwright.default : playwright;

/** The page size a probe sees: the same one `e2e.config.ts` opens. */
const VIEWPORT = { width: 1280, height: 800 };

/** What the probe is called with: the live page, its URL, and a CDP session factory. */
const CONTEXT = '{ page, url, cdp }';

/**
 * What to run, read from the command line alone: the probe module's path (absent
 * for stdin), and the build folder to serve.
 */
function options(argv) {
  const options = { probe: undefined, folder: 'dist' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--folder') {
      options.folder = argv[index + 1];
      index += 1;
    } else if (arg === '-') {
      options.probe = undefined;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option "${arg}"`);
    } else {
      options.probe = arg;
    }
  }
  if (options.folder === undefined) throw new Error('--folder needs a folder');
  return options;
}

/**
 * The built page on an ephemeral port, so two probes — or two worktrees — never
 * fight over one. Answers exactly the table `ez serve` and `scripts/serve.mjs`
 * answer, and holds every connection so `closeAllConnections` can end a run that
 * left the page loading something.
 */
function serve(folder) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const asset = PAGE_ASSETS.find((entry) => entry.path === pathname);
    if (asset === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': asset.mime, 'cache-control': 'no-store' });
    const file = createReadStream(join(folder, asset.file));
    // A build that lost a file mid-run ends that answer, not the probe: the run
    // still has to close the browser and the port it opened.
    file.on('error', () => response.destroy());
    file.pipe(response);
  });
  return new Promise((started, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address !== 'object' || address === null) {
        failed(new Error('the server has no port'));
        return;
      }
      started({ server, port: address.port });
    });
  });
}

/**
 * The probe as an async function: the default export of a module the person
 * wrote, or of a snippet read from stdin. A snippet is written to a temporary
 * folder first, so it is imported as a module like any other and syntax errors
 * read the same either way.
 */
async function load(source) {
  let file;
  let scratch;
  if (source.path !== undefined) {
    file = pathToFileURL(resolve(source.path)).href;
  } else {
    scratch = await mkdtemp(join(tmpdir(), 'esbozo-probe-'));
    file = pathToFileURL(join(scratch, 'probe.mjs')).href;
    await writeFile(join(scratch, 'probe.mjs'), source.text, 'utf8');
  }
  const module = await import(file);
  if (typeof module.default !== 'function') {
    throw new Error(`a probe must export default an async function of ${CONTEXT}`);
  }
  return { run: module.default, done: async () => scratch === undefined ? undefined : rm(scratch, { recursive: true, force: true }) };
}

/** Everything a run has to close, so one path closes it. */
let browser;
let server;
let closing;

/** Closes the browser and the server once, however many callers ask. */
function stop() {
  closing ??= (async () => {
    await browser?.close();
    browser = undefined;
    if (server !== undefined) {
      server.closeAllConnections();
      await new Promise((closed) => server.close(() => closed()));
      server = undefined;
    }
  })();
  return closing;
}

/** Set by a signal: the run ends where the person ended it, not where the probe was. */
let interrupted = false;

/** Ends the run on a signal, with the exit code a shell reads for it. */
function interrupt(code) {
  interrupted = true;
  void stop().then(() => process.exit(code));
}
process.once('SIGINT', () => interrupt(130));
process.once('SIGTERM', () => interrupt(143));

/** Reads all of stdin, for a probe piped in. */
async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const chosen = options(process.argv.slice(2));
  const folder = resolve(chosen.folder);
  let source = { path: chosen.probe, text: undefined };
  if (chosen.probe === undefined) {
    if (process.stdin.isTTY) {
      throw new Error(`no probe: pass the path to one, or pipe its source in, as ${CONTEXT}`);
    }
    source = { path: undefined, text: await stdin() };
  }
  let probe;
  try {
    probe = await load(source);
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && chosen.probe !== undefined) {
      throw new Error(`no probe at "${chosen.probe}": ${error.message}`);
    }
    throw error;
  }

  const builtPage = PAGE_ASSETS.find((entry) => entry.path === '/editor.html');
  const built = join(folder, builtPage.file);
  try {
    await access(built);
  } catch {
    throw new Error(`no built page at ${built}: run pnpm build first`);
  }

  browser = await chromium.launch();
  try {
    const served = await serve(folder);
    server = served.server;
    const url = `http://127.0.0.1:${served.port}/editor.html`;
    process.stderr.write(`probing ${url}\n`);
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url, { waitUntil: 'load' });
    const returned = await probe.run({
      page,
      url,
      cdp: () => page.context().newCDPSession(page),
    });
    process.stdout.write(`${JSON.stringify(returned ?? null, null, 2)}\n`);
  } finally {
    await probe.done();
    await stop();
  }
}

try {
  await main();
} catch (error) {
  if (!interrupted) {
    process.stderr.write(`probe failed: ${error?.message ?? String(error)}\n`);
    if (error?.stack !== undefined) process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = interrupted ? 130 : 1;
} finally {
  await stop();
}
