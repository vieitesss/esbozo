/**
 * Seam 1, the image: the container `ez serve`s a mounted folder.
 *
 * Not part of `pnpm test`, because a first run builds the image: `pnpm
 * test:docker`. Everything here is external behaviour — the container's HTTP
 * answers, the files left in the mounted folder, and the log line it prints —
 * never the image's own contents. Docker is only asked for the host platform's
 * image, since buildx is not everywhere; `pnpm test:docker` says so when it
 * cannot run.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const IMAGE = 'esbozo:test';
/** The port the image serves on, so a published port maps this one. */
const PORT = 4320;

const SCENE = {
  version: 1,
  title: 'Two boxes',
  elements: [
    { id: 'a', type: 'rectangle', x: 40, y: 40, width: 120, height: 80 },
    { id: 'b', type: 'rectangle', x: 200, y: 60, width: 100, height: 100 },
  ],
};
const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><title>Two boxes</title></svg>';

const skip = (await unusableReason()) ?? undefined;

before(async () => {
  if (skip !== undefined) {
    return;
  }
  await run('docker', ['build', '--tag', IMAGE, ROOT]);
});

/** Why the image cannot be tested here, or `null` when it can. */
async function unusableReason(): Promise<string | null> {
  try {
    await run('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch {
    return 'docker is not available: start Docker to run pnpm test:docker';
  }
  return null;
}

interface Container {
  readonly id: string;
  /** `http://127.0.0.1:<host port>`, as the published port maps it. */
  readonly url: string;
  stop(): Promise<void>;
}

/** The containers and folders these tests made, removed whatever they asserted. */
const running: Container[] = [];
const folders: string[] = [];
after(async () => {
  await Promise.all(running.map((container) => container.stop()));
  await Promise.all(folders.map((folder) => rm(folder, { recursive: true, force: true })));
});

/**
 * A temporary folder the daemon can mount. Not `os.tmpdir()`: Docker Desktop
 * shares `/Users`, `/Volumes` and `/private` by default and not the system's
 * per-user temporary folder, so a mount of one shows an empty folder.
 */
async function tempFolder(): Promise<string> {
  const folder = await mkdtemp(join(homedir(), '.esbozo-docker-'));
  folders.push(folder);
  return folder;
}

interface StartOptions {
  /** Appended after the image, as a user's own arguments would be. */
  readonly args?: readonly string[];
  /**
   * Whether the container has to answer on its published port before the test
   * goes on. A container told to bind its own loopback does not, by design.
   */
  readonly reachable?: boolean;
}

/** The image on `folder`, with `args` appended, its port published on loopback. */
async function start(folder: string, options: StartOptions = {}): Promise<Container> {
  const { stdout } = await run('docker', [
    'run',
    '--detach',
    '--volume',
    `${folder}:/scenes`,
    '--publish',
    `127.0.0.1::${PORT}`,
    IMAGE,
    ...(options.args ?? []),
  ]);
  const id = stdout.trim();
  const container = await published(id, options.reachable ?? true);
  running.push(container);
  return container;
}

async function published(id: string, reachable: boolean): Promise<Container> {
  const { stdout } = await run('docker', ['port', id, String(PORT)]);
  const mapped = /127\.0\.0\.1:(\d+)/.exec(stdout)?.[1];
  assert.ok(mapped !== undefined, `the published port is not on 127.0.0.1: ${stdout}`);

  const container: Container = {
    id,
    url: `http://127.0.0.1:${mapped}`,
    async stop(): Promise<void> {
      await run('docker', ['rm', '--force', id]).catch(() => {});
    },
  };
  if (reachable) {
    await ready(container);
  }
  return container;
}

/** Wait for the server to answer, and fail with the container's own log if it does not. */
async function ready(container: Container): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${container.url}/api/scenes`);
      if (response.status === 200) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const { stdout } = await run('docker', ['logs', container.id]).catch(() => ({ stdout: '' }));
  assert.fail(`the container never answered on ${container.url}: ${stdout}`);
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function put(container: Container, name: string, scene: string, svg: string): Promise<Answer> {
  const response = await fetch(`${container.url}/api/scenes/${name}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene, svg }),
  });
  return { status: response.status, body: await response.text() };
}

/** The container's log once it is serving, so the arguments it read are visible. */
async function servedOn(container: Container): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const { stdout } = await run('docker', ['logs', container.id]).catch(() => ({ stdout: '' }));
    const line = /serving [^\n]*\n/.exec(stdout)?.[0];
    if (line !== undefined) {
      return line.trim();
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail('the container never printed the URL it serves');
}

test('the image serves the mounted folder and saves a Scene into it', { skip }, async () => {
  const folder = await tempFolder();
  await writeFile(join(folder, 'scene.json'), JSON.stringify({ version: 1, elements: [] }), 'utf8');
  const container = await start(folder);

  const listing = await fetch(`${container.url}/api/scenes`);
  assert.equal(listing.status, 200);
  assert.deepEqual(await listing.json(), {
    // The listing names the folder, which inside the container is the mount.
    folder: 'scenes',
    readOnly: false,
    scenes: ['scene.json'],
  });

  const page = await fetch(`${container.url}/`);
  assert.equal(page.status, 200, 'the editor page travels in the image');
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

  const written = await put(container, 'hello.json', SCENE_SOURCE, SVG);
  assert.deepEqual(written, { status: 200, body: '{}' });

  assert.equal(await readFile(join(folder, 'hello.json'), 'utf8'), SCENE_SOURCE);
  assert.equal(await readFile(join(folder, 'hello.svg'), 'utf8'), SVG);
});

test('the image refuses every write when it is run read-only', { skip }, async () => {
  const folder = await tempFolder();
  await writeFile(join(folder, 'scene.json'), JSON.stringify({ version: 1, elements: [] }), 'utf8');
  const container = await start(folder, { args: ['--read-only'] });

  const listing = await fetch(`${container.url}/api/scenes`);
  assert.equal(listing.status, 200);
  assert.equal(((await listing.json()) as { readOnly: boolean }).readOnly, true);

  const written = await put(container, 'hello.json', SCENE_SOURCE, SVG);
  assert.deepEqual(written, { status: 403, body: '{"error":"this folder is served read-only"}' });
  await assert.rejects(readFile(join(folder, 'hello.json'), 'utf8'), 'nothing was written');
});

test('a later --host wins over the one the image passes', { skip }, async () => {
  const folder = await tempFolder();
  const container = await start(folder, { args: ['--host', '127.0.0.1'], reachable: false });

  assert.match(await servedOn(container), /^serving .* on http:\/\/127\.0\.0\.1:4320\/$/);
});