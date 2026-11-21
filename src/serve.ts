/**
 * `ez serve`: one folder of Scenes, and the editor page that works on it.
 *
 * The page's own files (HTML, JS, CSS, fonts) come from the folder the built
 * CLI lives in, so `ez serve <dir>` needs no separate static server. Only the
 * files in `PAGE_ASSETS` are served; the folder it is given holds the Scenes,
 * and the save API below is the only way in or out of it:
 *
 *   GET  /api/scenes                  the folder's name, its Scene file names
 *                                     and whether writes are refused
 *   GET  /api/scenes/<name>           200 with the Scene source, or 404
 *   PUT  /api/scenes/<name>           { "scene": "<source>", "svg": "<source>" }
 *   POST /api/scenes/<name>           the same write, for a client that posts
 *
 * A write has to announce `content-type: application/json`, so a cross-origin
 * page cannot reach the folder with a request the browser sends on its own.
 *
 * Every path is a plain Scene file name at the top level of the folder: names
 * with a separator, `..`, an absolute path or a symlink that points outside are
 * refused, so neither a read nor a write can leave the folder.
 *
 * A written Scene is parsed with `parseScene` first and refused with 400 when
 * it is invalid, so the server never stores what `ez check` rejects. A Scene and
 * its SVG are committed together: one write of a name at a time, and two names
 * that a case-insensitive filesystem reads as one file share that one write.
 *
 * No auth: the default bind is 127.0.0.1, and a host that reaches further is
 * the caller's choice.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, readdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { PAGE_ASSETS } from './page-assets.js';
import { svgFileName } from './paths.js';
import { SCENES_API, sceneWrite } from './scenes-api.js';
import type { SceneListing, SceneWrite } from './scenes-api.js';
import { parseScene } from './scene.js';

/** The biggest write the server reads: a Scene is text, and a page of it is small. */
const BODY_LIMIT = 8 * 1024 * 1024;

/** The built page and its assets, beside the bundled CLI. */
const ASSETS = fileURLToPath(new URL('.', import.meta.url));

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
  for (const file of new Set(PAGE_ASSETS.map((asset) => asset.file))) {
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
  if (pathname === SCENES_API || pathname === `${SCENES_API}/`) {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: 'use GET' });
      return;
    }
    const listing: SceneListing = {
      folder: basename(root),
      readOnly,
      scenes: await listScenes(root),
    };
    sendJson(response, 200, listing);
    return;
  }
  if (pathname.startsWith(`${SCENES_API}/`)) {
    await handleScene(request, response, root, readOnly, pathname.slice(SCENES_API.length + 1));
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
  const written = sceneWrite(body);
  if (written === null) {
    sendJson(response, 400, { error: 'the body must be { "scene": "<text>", "svg": "<text>" }' });
    return;
  }

  const parsed = parseScene(written.scene);
  if (!parsed.ok) {
    sendJson(response, 400, {
      error: `the Scene is invalid: ${parsed.problems.map((problem) => problem.message).join('; ')}`,
    });
    return;
  }

  try {
    await serialised(queueKey(root, name), () => writePair(root, name, written));
  } catch (error) {
    if (!(error instanceof WriteRefused)) {
      throw error;
    }
    sendJson(response, error.status, { error: error.message });
    return;
  }
  // The write is the answer: the files say what landed, so no body repeats it.
  sendJson(response, 200, {});
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

/**
 * A Scene is a file's bytes: a name that holds anything else — a folder, a pipe
 * — is not a Scene, and answers as a name that is not there. Nothing is opened
 * before its entry has said it is a file, so no read waits on what is not one.
 */
async function readScene(path: string): Promise<string | null> {
  let found: Stats;
  try {
    found = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!found.isFile()) {
    return null;
  }
  return readFile(path, 'utf8');
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

/**
 * The queue a write belongs to: the two files it will replace, case-folded.
 * `alias.json` and `alias.JSON` are one Scene on a case-insensitive filesystem,
 * so they take one queue; otherwise two names for one pair could write at once.
 */
function queueKey(root: string, name: string): string {
  return join(root, name).toLowerCase();
}

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

/**
 * Replace the Scene and its SVG of one name together. Calls for one pair are
 * queued, so the two files on disk always come from a single write: the pair a
 * reader finds is the one before a write or the one after it, never a Scene from
 * one request beside an SVG from another.
 *
 * Both targets are checked before anything lands, and checked as entries only:
 * a target that is not a file cannot be replaced, and its contents are never
 * read on the way in. The Scene is then copied aside byte for byte — one copy,
 * kept no longer than the write — and the two texts are renamed into place,
 * Scene first. A failure is undone: the SVG is renamed last, so a failure there
 * leaves the SVG as it was and only the Scene has to be put back. A reader
 * between the two renames can see the new Scene beside the previous SVG; the SVG
 * never leads the Scene, and both are the same write once the request answers.
 */
async function writePair(root: string, name: string, written: SceneWrite): Promise<void> {
  const scene = join(root, name);
  const svg = join(root, svgFileName(name));
  await refuseNonFile(scene);
  await refuseNonFile(svg);

  const backup = `${scene}.${randomUUID()}.bak`;
  const hadScene = await copyAside(scene, backup);
  const sceneTemporary = `${scene}.${randomUUID()}.tmp`;
  const svgTemporary = `${svg}.${randomUUID()}.tmp`;

  let keepBackup = false;
  try {
    await writeFile(sceneTemporary, written.scene, 'utf8');
    await writeFile(svgTemporary, written.svg, 'utf8');
    await rename(sceneTemporary, scene);
    await rename(svgTemporary, svg);
  } catch (error) {
    // The Scene goes back whenever the write did not finish, renamed or not: the
    // copy is the same bytes either way, and this is the only way to know that
    // the folder can still keep them.
    const unput = await putBack(scene, backup, hadScene);
    // A restore that failed is the answer: the folder was told to forget bytes it
    // could not keep, so it names the copy that is still there.
    keepBackup = unput !== null;
    throw unput ?? error;
  } finally {
    await unlink(sceneTemporary).catch(() => {});
    await unlink(svgTemporary).catch(() => {});
    if (!keepBackup) {
      await unlink(backup).catch(() => {});
    }
  }
}

/** A target that is not a file cannot be replaced: refuse it before anything lands. */
async function refuseNonFile(target: string): Promise<void> {
  let found: Stats;
  try {
    found = await stat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (found.isDirectory()) {
    throw new WriteRefused(409, `${basename(target)} is a folder: save the Scene under another name`);
  }
  if (!found.isFile()) {
    throw new WriteRefused(409, `${basename(target)} is not a file: save the Scene under another name`);
  }
}

/** Copy a Scene aside byte for byte, so a failed write can put those bytes back. */
async function copyAside(target: string, backup: string): Promise<boolean> {
  try {
    await copyFile(target, backup);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Put back what a failed write replaced, and say so when even that fails: the
 * answer carries the copy's path, so the bytes are never lost silently and a
 * write the folder could not finish is never reported as done.
 */
async function putBack(
  scene: string,
  backup: string,
  hadScene: boolean,
): Promise<WriteRefused | null> {
  try {
    if (hadScene) {
      // A rename, so a reader never sees half of the Scene it had.
      await rename(backup, scene);
      return null;
    }
    try {
      await unlink(scene);
    } catch (error) {
      // No Scene landed, so there is nothing to undo.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return null;
  } catch (error) {
    return new WriteRefused(
      500,
      `${basename(scene)} could not be put back after a failed write: the Scene from before it is at ${backup} (${(error as Error).message})`,
    );
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

/**
 * The page's own files, out of the folder the built CLI lives in: the table is
 * the whole list, so nothing else beside the CLI is published.
 */
async function servePageAsset(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  if (request.method !== 'GET') {
    sendJson(response, 405, { error: 'use GET' });
    return;
  }
  const asset = PAGE_ASSETS.find((entry) => entry.path === pathname);
  if (asset === undefined) {
    sendJson(response, 404, { error: `no page file ${pathname}` });
    return;
  }
  const path = join(ASSETS, asset.file);
  try {
    if (!(await stat(path)).isFile()) {
      sendJson(response, 404, { error: `no page file ${pathname}` });
      return;
    }
  } catch {
    sendJson(response, 404, { error: `no page file ${pathname}` });
    return;
  }
  const encoding = compresses(asset.mime) ? encodingFor(request.headers['accept-encoding']) : null;
  if (encoding !== null) {
    const body = await compressedBody(path, encoding);
    response.writeHead(200, {
      'content-type': asset.mime,
      'cache-control': 'no-store',
      'content-encoding': encoding,
      'content-length': String(body.length),
      vary: 'accept-encoding',
    });
    response.end(body);
    return;
  }
  response.writeHead(200, {
    'content-type': asset.mime,
    'cache-control': 'no-store',
    ...(compresses(asset.mime) ? { vary: 'accept-encoding' } : {}),
  });
  createReadStream(path).pipe(response);
}

/**
 * Whether a page file is worth compressing. The page is text — HTML, CSS, JS,
 * the font's licence — and the font itself is a font: its own format is the
 * compression, and every browser that wants it would fetch it anyway.
 */
function compresses(mime: string): boolean {
  return mime.startsWith('text/');
}

/**
 * What a request will take of what this server offers, best first. A header
 * with no weight, or a weight of zero, means the client does not accept the
 * encoding; `*` stands for the ones it does not name.
 */
function encodingFor(header: string | undefined): 'br' | 'gzip' | null {
  if (header === undefined || header.trim() === '') {
    return null;
  }
  const weights = new Map<string, number>();
  for (const part of header.split(',')) {
    const [rawName, ...parameters] = part.trim().toLowerCase().split(';');
    const name = (rawName ?? '').trim();
    if (name === '') {
      continue;
    }
    let weight = 1;
    for (const parameter of parameters) {
      const [key, value] = parameter.trim().split('=');
      if (key === 'q') {
        const asked = Number(value);
        weight = Number.isFinite(asked) ? asked : 0;
      }
    }
    weights.set(name, weight);
  }
  const weightOf = (name: string): number => weights.get(name) ?? weights.get('*') ?? 0;
  const best = (['br', 'gzip'] as const)
    .map((name) => ({ name, weight: weightOf(name) }))
    .filter((offer) => offer.weight > 0)
    .sort((left, right) => right.weight - left.weight)[0];
  return best?.name ?? null;
}

/** Compressed page files, by path: a page load pays for the compression once. */
const compressed = new Map<string, { readonly stamp: string; readonly body: Buffer }>();

async function compressedBody(path: string, encoding: 'br' | 'gzip'): Promise<Buffer> {
  const file = await stat(path);
  const stamp = `${encoding}:${file.size}:${file.mtimeMs}`;
  const held = compressed.get(path);
  if (held !== undefined && held.stamp === stamp) {
    return held.body;
  }
  const source = await readFile(path);
  const body = encoding === 'br' ? brotliCompressSync(source) : gzipSync(source);
  compressed.set(path, { stamp, body });
  return body;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}
