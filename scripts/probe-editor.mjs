/**
 * A live-editor probe: one command boots the built editor in Chromium and runs a
 * probe module against it.
 *
 * A probe is how a change is judged on the running page — what a click paints,
 * what a keystroke saves, what the screen looks like a moment later — without
 * writing a whole e2e file or setting up a static server and Chromium.
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
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
 */
const fromRepo = createRequire(import.meta.url);
const fromWeb = createRequire(fromRepo.resolve('@e2e-dev/web'));
const { chromium } = fromWeb('playwright-core');
const EDITOR_PAGE = PAGE_ASSETS.find((entry) => entry.path === '/editor.html');

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
 * Import stdin as a module too, so both forms report syntax errors the same way.
 */
async function probeFile(path) {
  if (path !== undefined) {
    return resolve(path);
  }
  if (process.stdin.isTTY) {
    throw new Error(`no probe: pass the path to one, or pipe its source in, as ${CONTEXT}`);
  }
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  scratch = await mkdtemp(join(tmpdir(), 'esbozo-probe-'));
  const file = join(scratch, 'probe.mjs');
  await writeFile(file, Buffer.concat(chunks));
  return file;
}

/** Everything a run has to close, so one path closes it. */
let scratch;
let browser;
let server;
let closing;

/** Close the run once. Failure to close one resource cannot skip the others. */
function stop() {
  closing ??= Promise.all([
    browser?.close(),
    server === undefined ? undefined : new Promise((closed) => {
      server.close(() => closed());
      server.closeAllConnections();
    }),
    scratch === undefined ? undefined : rm(scratch, { recursive: true, force: true }),
  ]);
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

async function main() {
  const chosen = options(process.argv.slice(2));
  const folder = resolve(chosen.folder);
  const file = await probeFile(chosen.probe);
  let probe;
  try {
    ({ default: probe } = await import(pathToFileURL(file).href));
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && chosen.probe !== undefined) {
      throw new Error(`no probe at "${chosen.probe}": ${error.message}`);
    }
    throw error;
  }
  if (typeof probe !== 'function') {
    throw new Error(`a probe must export default an async function of ${CONTEXT}`);
  }

  const built = join(folder, EDITOR_PAGE.file);
  try {
    await access(built);
  } catch {
    throw new Error(`no built page at ${built}: run pnpm build first`);
  }

  browser = await chromium.launch();
  const served = await serve(folder);
  server = served.server;
  const url = `http://127.0.0.1:${served.port}${EDITOR_PAGE.path}`;
  process.stderr.write(`probing ${url}\n`);
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(url, { waitUntil: 'load' });
  const returned = await probe({ page, url, cdp: () => page.context().newCDPSession(page) });
  process.stdout.write(`${JSON.stringify(returned ?? null, null, 2)}\n`);
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
