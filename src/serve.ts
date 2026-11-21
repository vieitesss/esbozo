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
 * it is invalid, so the server never stores what `ez check` rejects. A Scene and
 * its SVG are committed together, one write of a name at a time.
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
  const raw = request.url ?? '/';
  const raised = rawPathProblem(raw);
  if (raised !== null) {
    sendJson(response, 400, { error: raised });
    return;
  }
  const pathname = new URL(raw, 'http://localhost').pathname;
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

/**
 * A dot segment in the request path, decoded but before it is normalised: `..`,
 * `%2e%2e`, `.` and a backslash for a separator are all refused, so no path is
 * read one way here and another way by the URL parser.
 */
function rawPathProblem(raw: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(raw.split('?')[0] ?? '/');
  } catch {
    return 'the path is not valid percent-encoding';
  }
  for (const segment of path.split(/[/\\]/)) {
    if (segment === '.' || segment === '..') {
      return 'a request path may not name a folder relative to itself';
    }
  }
  return null;
}

/**
 * The Scene file names at the top level of the folder, sorted. No recursion, and
 * one rule with the API: every name here is a name the API opens.
 */
async function listScenes(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && nameProblem(entry.name) === null)
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
  if (!announcesJson(request)) {
    sendJson(response, 415, { error: 'send the write as content-type: application/json' });
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

  try {
    await serialised(join(root, name), () => writePair(root, name, written));
  } catch (error) {
    if (!(error instanceof WriteRefused)) {
      throw error;
    }
    sendJson(response, error.status, { error: error.message });
    return;
  }
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

/** A write the folder itself refuses, with the answer it deserves. */
class WriteRefused extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The writes in flight, one queue per output pair, so two never interleave. */
const queued = new Map<string, Promise<void>>();

/** Run `job` after every earlier job for `key`, whatever those jobs did. */
function serialised<T>(key: string, job: () => Promise<T>): Promise<T> {
  const next = (queued.get(key) ?? Promise.resolve()).then(job);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  queued.set(key, settled);
  void settled.then(() => {
    if (queued.get(key) === settled) {
      queued.delete(key);
    }
  });
  return next;
}

/** One file of a pair: where it goes, what it holds now, and where its bytes wait. */
interface StagedFile {
  readonly target: string;
  readonly text: string;
  readonly previous: string | null;
  readonly temporary: string;
}

/**
 * Replace the Scene and its SVG of one name together. Calls for one pair are
 * queued, so the two files on disk always come from a single write: the pair a
 * reader finds is the one before a write or the one after it, never a Scene from
 * one request beside an SVG from another.
 *
 * Each file is replaced atomically, Scene first, and what a write replaces is
 * read before anything lands: a failure after the first rename puts back every
 * file already replaced, so a failed write leaves the previous pair. A reader
 * between the two renames can see the new Scene beside the previous SVG; the SVG
 * never leads the Scene, and both are the same write once the request answers.
 */
async function writePair(root: string, name: string, written: SceneWrite): Promise<void> {
  const wanted = [
    { target: join(root, name), text: written.scene },
    { target: join(root, svgFileName(name)), text: written.svg },
  ];
  const staged: StagedFile[] = [];
  for (const file of wanted) {
    staged.push({
      ...file,
      previous: await previousOf(file.target),
      temporary: `${file.target}.${randomUUID()}.tmp`,
    });
  }

  const replaced: StagedFile[] = [];
  try {
    for (const file of staged) {
      await writeFile(file.temporary, file.text, 'utf8');
    }
    for (const file of staged) {
      await rename(file.temporary, file.target);
      replaced.push(file);
    }
  } catch (error) {
    await putBack(replaced);
    throw error;
  } finally {
    for (const file of staged) {
      await unlink(file.temporary).catch(() => {});
    }
  }
}

/** What a target holds now, `null` when it is not there, or a refusal to replace it. */
async function previousOf(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    if (code === 'EISDIR') {
      throw new WriteRefused(409, `${basename(target)} is a folder: save the Scene under another name`);
    }
    throw error;
  }
}

/** Undo the renames a failed write made, newest first, so the pair comes back. */
async function putBack(replaced: readonly StagedFile[]): Promise<void> {
  for (const file of [...replaced].reverse()) {
    try {
      if (file.previous === null) {
        await unlink(file.target);
        continue;
      }
      // Through a temporary, so a reader never sees half of the old file.
      const temporary = `${file.target}.${randomUUID()}.tmp`;
      await writeFile(temporary, file.previous, 'utf8');
      await rename(temporary, file.target);
    } catch {
      // The write has already failed: this is the most the server can do.
    }
  }
}

/**
 * A write has to announce itself as JSON: a cross-origin page can post
 * `text/plain` without asking, and the answer is the only thing that stops it.
 */
function announcesJson(request: IncomingMessage): boolean {
  const type = request.headers['content-type'] ?? '';
  return type.split(';')[0]?.trim().toLowerCase() === 'application/json';
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
