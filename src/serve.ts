/**
 * `ez serve`: one folder of Scenes, and the editor page that works on it.
 *
 * The page's own files (HTML, JS, CSS, fonts) come from the folder the built
 * CLI lives in, so `ez serve <dir>` needs no separate static server. The
 * folder it is given holds the Scenes, and the save API below is the only way
 * in or out of it:
 *
 *   GET  /api/scenes                  the folder's name, its Scene file names
 *                                     and whether writes are refused
 *   GET  /api/scenes/<name>           200 with the Scene source, or 404
 *   PUT  /api/scenes/<name>           { "scene": "<source>", "svg": "<source>" }
 *
 * Every path is a plain Scene file name at the top level of the folder: names
 * with a separator, `..`, an absolute path or a symlink that points outside are
 * refused, so neither a read nor a write can leave the folder.
 *
 * A written Scene is parsed with `parseScene` first and refused with 400 when
 * it is invalid, so the server never stores what `ez check` rejects. The two
 * files are written to temporaries and renamed into place, Scene then SVG.
 *
 * No auth: the default bind is 127.0.0.1, and a host that reaches further is
 * the caller's choice.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { basename, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svgFileName } from './paths.js';
import { parseScene } from './scene.js';

/** Where the save API lives, and the one prefix the server answers for it. */
export const API = '/api/scenes';

/** The biggest write the server reads: a Scene is text, and a page of it is small. */
const BODY_LIMIT = 8 * 1024 * 1024;

/** The built page and its assets, beside the bundled CLI. */
const ASSETS = fileURLToPath(new URL('.', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/** The page files a served editor needs; missing ones are a startup problem. */
const PAGE_FILES = ['editor.html', 'editor.js', 'editor.css'];

export interface ServeOptions {
  /** The folder the Scenes live in, already resolved. */
  readonly folder: string;
  readonly host: string;
  /** 0 lets the operating system pick, which is what the tests ask for. */
  readonly port: number;
  readonly readOnly: boolean;
}

/** A server that is listening, and the promise that settles when it stops. */
export interface RunningServe {
  readonly folder: string;
  readonly readOnly: boolean;
  /** `http://host:port`, no trailing slash. */
  readonly url: string;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export async function serve(options: ServeOptions): Promise<RunningServe> {
  const root = await realpath(options.folder);
  await checkPageAssets();

  const server = createServer((request, response) => {
    handle(request, response, root, options.readOnly).catch((error: unknown) => {
      const message = (error as Error).message;
      if (response.headersSent) {
        response.end();
        return;
      }
      sendJson(response, 500, { error: message });
    });
  });

  const url = await listen(server, options.host, options.port);
  let closedResolve: () => void = () => {};
  const closed = new Promise<void>((resolve_) => {
    closedResolve = resolve_;
  });
  server.once('close', () => closedResolve());

  return {
    folder: root,
    readOnly: options.readOnly,
    url,
    closed,
    async close(): Promise<void> {
      server.closeAllConnections();
      await new Promise<void>((resolve_) => server.close(() => resolve_()));
    },
  };
}

/** The page's own files have to be beside the CLI: `pnpm build` puts them there. */
async function checkPageAssets(): Promise<void> {
  for (const file of PAGE_FILES) {
    try {
      await stat(join(ASSETS, file));
    } catch {
      throw new Error(`the editor is not built: missing ${join(ASSETS, file)} (run pnpm build)`);
    }
  }
}

/** Listen, and report a taken port as the startup problem it is. */
async function listen(server: Server, host: string, port: number): Promise<string> {
  await new Promise<void>((resolve_, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => {
      server.off('listening', onListening);
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`port ${port} on ${host} is already in use: pass --port N`)
          : new Error(`cannot listen on ${host}:${port}: ${error.message}`),
      );
    };
    const onListening = (): void => {
      server.off('error', onError);
      resolve_();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the server did not report an address');
  }
  const shown = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `http://${shown}:${address.port}`;
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  readOnly: boolean,
): Promise<void> {
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  if (pathname === API || pathname === `${API}/`) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'use GET' });
      return;
    }
    sendJson(response, 200, {
      folder: basename(root),
      readOnly,
      scenes: await listScenes(root),
    });
    return;
  }
  if (pathname.startsWith(`${API}/`)) {
    await handleScene(request, response, root, readOnly, pathname.slice(API.length + 1));
    return;
  }
  await servePageAsset(request, response, pathname);
}

/** The Scene file names at the top level of the folder, sorted. No recursion. */
async function listScenes(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function handleScene(
  request: IncomingMessage,
  response: ServerResponse,
  root: string,
  readOnly: boolean,
  encodedName: string,
): Promise<void> {
  let name: string;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    sendJson(response, 400, { error: 'the Scene name is not valid percent-encoding' });
    return;
  }
  const refusal = nameProblem(name);
  if (refusal !== null) {
    sendJson(response, 400, { error: refusal });
    return;
  }

  const path = join(root, name);
  if (!(await staysInside(root, path))) {
    sendJson(response, 403, { error: `${name} leaves the folder` });
    return;
  }

  if (request.method === 'GET') {
    const source = await readScene(path);
    if (source === null) {
      sendJson(response, 404, { error: `no Scene named ${name}` });
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(source);
    return;
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'use GET, PUT or POST' });
    return;
  }
  if (readOnly) {
    sendJson(response, 403, { error: 'this folder is served read-only' });
    return;
  }

  const body = await readBody(request);
  if (body === null) {
    sendJson(response, 413, { error: `the body is over ${BODY_LIMIT} bytes` });
    return;
  }
  const written = parseWrite(body);
  if (written === null) {
    sendJson(response, 400, { error: 'the body must be { "scene": "<text>", "svg": "<text>" }' });
    return;
  }

  const parsed = parseScene(written.scene);
  if (!parsed.ok) {
    sendJson(response, 400, {
      error: `the Scene is invalid: ${parsed.problems.map((problem) => problem.message).join('; ')}`,
      problems: parsed.problems,
    });
    return;
  }

  await writePair(root, name, written);
  sendJson(response, 200, { scene: name, svg: svgFileName(name) });
}

/** `null` for a name that is not a plain Scene file at the folder's top level. */
function nameProblem(name: string): string | null {
  if (name === '') {
    return 'the Scene name is missing';
  }
  if (name.includes('/') || name.includes('\\')) {
    return `${name}: name a Scene in the folder, not a path`;
  }
  if (name === '.' || name === '..' || name.startsWith('.')) {
    return `${name}: name a Scene file, not a hidden or relative one`;
  }
  if (!/\.json$/i.test(name)) {
    return `${name}: a Scene file ends in .json`;
  }
  return null;
}

/** A target that a symlink carries outside the folder is not the folder's. */
async function staysInside(root: string, path: string): Promise<boolean> {
  if (resolve(path) !== join(root, basename(path))) {
    return false;
  }
  try {
    return (await realpath(path)).startsWith(root + sep);
  } catch (error) {
    // Not there yet: a new Scene is written straight into the folder itself.
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

async function readScene(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

interface SceneWrite {
  readonly scene: string;
  readonly svg: string;
}

function parseWrite(body: string): SceneWrite | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { scene, svg } = raw as { scene?: unknown; svg?: unknown };
  if (typeof scene !== 'string' || typeof svg !== 'string') {
    return null;
  }
  return { scene, svg };
}

/**
 * Both files land or neither does: each is written to its own temporary and
 * then renamed, Scene first, so a reader never sees a Scene beside an old SVG.
 */
async function writePair(root: string, name: string, written: SceneWrite): Promise<void> {
  const pair = [
    { target: join(root, name), text: written.scene },
    { target: join(root, svgFileName(name)), text: written.svg },
  ];
  const staged = pair.map((file) => ({ ...file, temporary: `${file.target}.${randomUUID()}.tmp` }));
  try {
    for (const file of staged) {
      await writeFile(file.temporary, file.text, 'utf8');
    }
    for (const file of staged) {
      await rename(file.temporary, file.target);
    }
  } finally {
    for (const file of staged) {
      await unlink(file.temporary).catch(() => {});
    }
  }
}

/** The body as text, or `null` when it grew past the limit. */
async function readBody(request: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > BODY_LIMIT) {
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The editor page and its assets, out of the folder the built CLI lives in. */
async function servePageAsset(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'use GET' });
    return;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(pathname === '/' ? 'editor.html' : pathname.slice(1));
  } catch {
    sendJson(response, 400, { error: 'the path is not valid percent-encoding' });
    return;
  }
  const path = resolve(join(ASSETS, relative));
  if (path !== ASSETS && !path.startsWith(ASSETS.endsWith(sep) ? ASSETS : ASSETS + sep)) {
    sendJson(response, 403, { error: 'that path is outside the page' });
    return;
  }
  try {
    if (!(await stat(path)).isFile()) {
      sendJson(response, 404, { error: 'not found' });
      return;
    }
  } catch {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  response.writeHead(200, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(response);
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
