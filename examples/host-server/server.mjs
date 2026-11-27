/**
 * Reference host server for the esbozo embed bundle.
 *
 * Example code only: not part of `src/`.
 * Copy and adapt this file into your own host application.
 *
 * Usage:
 *   node examples/host-server/server.mjs <dir> [--host 127.0.0.1] [--port 4321] [--render]
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BODY_LIMIT = 8 * 1024 * 1024;
const SCENE_EXT = /\.(?:esbozo|json)$/i;

class WriteRefused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const queued = new Map();

function serialised(key, job) {
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

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function rawPathProblem(raw) {
  let path;
  try {
    path = decodeURIComponent((raw.split('?')[0] ?? '/'));
  } catch {
    return 'the path is not valid percent-encoding';
  }
  if (path.includes('\\')) {
    return 'a request path may not use backslashes';
  }
  for (const segment of path.split('/')) {
    if (segment === '.' || segment === '..') {
      return 'a request path may not name a folder relative to itself';
    }
  }
  return null;
}

function parseScenePath(raw) {
  const rawProblem = rawPathProblem(raw);
  if (rawProblem !== null) {
    return { error: rawProblem };
  }
  const decoded = decodeURIComponent((raw.split('?')[0] ?? '/'));
  const rel = decoded.replace(/^\/+/, '');
  if (rel === '') {
    return { error: 'the Scene name is missing' };
  }
  const segments = rel.split('/');
  for (const segment of segments) {
    if (segment === '' || segment.startsWith('.')) {
      return { error: `${rel}: name a Scene file, not a hidden or relative one` };
    }
  }
  const fileName = segments[segments.length - 1];
  if (!SCENE_EXT.test(fileName)) {
    return { error: `${rel}: a Scene file ends in .esbozo or .json` };
  }
  return { rel, segments };
}

function svgPathFor(scenePath) {
  return scenePath.replace(SCENE_EXT, '.svg');
}

async function staysInside(root, target) {
  const resolved = resolve(target);
  if (!resolved.startsWith(root + sep)) {
    return false;
  }
  let current = resolved;
  while (true) {
    try {
      const real = await realpath(current);
      return real === root || real.startsWith(root + sep);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        const parent = dirname(current);
        if (parent === current) {
          return false;
        }
        current = parent;
        continue;
      }
      return false;
    }
  }
}

async function readScene(path) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  if (!info.isFile()) {
    return null;
  }
  return readFile(path, 'utf8');
}

function announcesJson(request) {
  const header = request.headers['content-type'];
  if (typeof header !== 'string') {
    return false;
  }
  const mediaType = header.split(';')[0]?.trim().toLowerCase();
  return mediaType === 'application/json';
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buffer.length;
    if (total > BODY_LIMIT) {
      return null;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseWriteBody(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    typeof parsed.scene !== 'string' ||
    typeof parsed.svg !== 'string'
  ) {
    return null;
  }
  return { scene: parsed.scene, svg: parsed.svg };
}

async function refuseNonFile(target) {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (info.isDirectory()) {
    throw new WriteRefused(409, `${basename(target)} is a folder: save the Scene under another name`);
  }
  if (!info.isFile()) {
    throw new WriteRefused(409, `${basename(target)} is not a file: save the Scene under another name`);
  }
}

async function copyAside(target, backup) {
  try {
    await copyFile(target, backup);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function putBack(scene, backup, hadScene) {
  if (!hadScene) {
    await unlink(scene).catch(() => {});
    return null;
  }
  try {
    await rename(backup, scene);
    return null;
  } catch {
    return new Error(`write failed and could not restore ${basename(scene)}; backup kept at ${basename(backup)}`);
  }
}

async function renderScene(sceneTemp, svgTemp) {
  let renderedPath = `${sceneTemp}.svg`;
  try {
    const { stdout } = await execFileAsync('ez', ['render', sceneTemp]);
    const trimmed = stdout.trim();
    if (trimmed !== '') {
      renderedPath = trimmed;
    }
  } catch (error) {
    if (error && error.code === 3) {
      const detail = String(error.stderr || error.stdout || error.message).trim();
      throw new WriteRefused(400, `the Scene is invalid: ${detail}`);
    }
    throw error;
  }
  try {
    await rename(renderedPath, svgTemp);
  } catch (error) {
    await unlink(renderedPath).catch(() => {});
    throw error;
  }
}

async function writePair(scenePath, svgPath, written, renderOnSave) {
  await mkdir(dirname(scenePath), { recursive: true });
  await refuseNonFile(scenePath);
  await refuseNonFile(svgPath);

  const backup = `${scenePath}.${randomUUID()}.bak`;
  const hadScene = await copyAside(scenePath, backup);
  const sceneTemp = `${scenePath}.${randomUUID()}.tmp`;
  const svgTemp = `${svgPath}.${randomUUID()}.tmp`;

  let keepBackup = false;
  try {
    await writeFile(sceneTemp, written.scene, 'utf8');
    if (renderOnSave) {
      await renderScene(sceneTemp, svgTemp);
    } else {
      await writeFile(svgTemp, written.svg, 'utf8');
    }
    await rename(sceneTemp, scenePath);
    await rename(svgTemp, svgPath);
  } catch (error) {
    const restoreError = await putBack(scenePath, backup, hadScene);
    keepBackup = restoreError !== null;
    throw restoreError ?? error;
  } finally {
    await unlink(sceneTemp).catch(() => {});
    await unlink(svgTemp).catch(() => {});
    if (!keepBackup) {
      await unlink(backup).catch(() => {});
    }
  }
}

async function handle(request, response, root, renderOnSave) {
  const parsed = parseScenePath(request.url ?? '/');
  if (parsed.error) {
    sendJson(response, 400, { error: parsed.error });
    return;
  }

  const scenePath = join(root, ...parsed.segments);
  const svgPath = svgPathFor(scenePath);
  if (!(await staysInside(root, scenePath)) || !(await staysInside(root, svgPath))) {
    sendJson(response, 403, { error: `${parsed.rel} leaves the folder` });
    return;
  }

  if (request.method === 'GET') {
    const text = await readScene(scenePath);
    if (text === null) {
      sendJson(response, 404, { error: `no Scene named ${parsed.rel}` });
      return;
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(text),
    });
    response.end(text);
    return;
  }

  if (request.method !== 'PUT' && request.method !== 'POST') {
    sendJson(response, 405, { error: 'use GET, PUT or POST' });
    return;
  }

  if (!announcesJson(request)) {
    sendJson(response, 415, { error: 'send the write as content-type: application/json' });
    return;
  }

  const bodyText = await readBody(request);
  if (bodyText === null) {
    sendJson(response, 413, { error: `the body is over ${BODY_LIMIT} bytes` });
    return;
  }

  const written = parseWriteBody(bodyText);
  if (written === null) {
    sendJson(response, 400, { error: 'send a JSON object with string scene and svg fields' });
    return;
  }

  try {
    await serialised(svgPath.toLowerCase(), async () => {
      if (!(await staysInside(root, scenePath)) || !(await staysInside(root, svgPath))) {
        throw new WriteRefused(403, `${parsed.rel} leaves the folder`);
      }
      await writePair(scenePath, svgPath, written, renderOnSave);
    });
  } catch (error) {
    if (error instanceof WriteRefused) {
      sendJson(response, error.status, { error: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
    return;
  }

  sendJson(response, 200, {});
}

function parseArgs(argv) {
  let folder = null;
  let host = '127.0.0.1';
  let port = 4321;
  let renderOnSave = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--host') {
      host = argv[++i] ?? '';
    } else if (arg === '--port') {
      port = Number(argv[++i]);
    } else if (arg === '--render') {
      renderOnSave = true;
    } else if (!arg.startsWith('-') && folder === null) {
      folder = arg;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  if (!folder) {
    throw new Error('usage: node examples/host-server/server.mjs <dir> [--host 127.0.0.1] [--port 4321] [--render]');
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`invalid port: ${port}`);
  }
  return { folder, host, port, renderOnSave };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = await realpath(options.folder);

  const server = createServer((request, response) => {
    void handle(request, response, root, options.renderOnSave).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: message });
      }
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(options.port, options.host, () => resolveListen());
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address !== null ? address.port : options.port;
  process.stdout.write(`listening on http://${options.host}:${actualPort}/ (root: ${root})\n`);

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(2);
});
