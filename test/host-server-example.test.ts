/**
 * Script seam: the reference host server in `examples/host-server/server.mjs`
 * runs as a child process against a temporary root folder.
 *
 * Every request goes over HTTP to the spawned server, and every assertion
 * inspects the HTTP response or the files on disk.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { delimiter, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ezShimScript } from './cli.ts';
import { removeTempFolders, tempFolder } from './temp.ts';

const SERVER_SCRIPT = fileURLToPath(
  new URL('../examples/host-server/server.mjs', import.meta.url),
);

const SCENE = {
  version: 1,
  title: 'Host example',
  elements: [{ id: 'a', type: 'rectangle', x: 20, y: 20, width: 100, height: 60 }],
};
const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><title>Host example</title></svg>';

interface RunningHost {
  readonly url: string;
  stop(): Promise<void>;
}

const running: RunningHost[] = [];
after(async () => {
  await Promise.all(running.map((server) => server.stop()));
  await removeTempFolders();
});

async function startHostServer(
  root: string,
  extraArgs: readonly string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): Promise<RunningHost> {
  const child = spawn(
    process.execPath,
    [SERVER_SCRIPT, root, '--port', '0', ...extraArgs],
    { stdio: ['ignore', 'pipe', 'pipe'], env },
  );

  const url = await new Promise<string>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      const match = /http:\/\/[^\s/]+:\d+/.exec(stdout);
      if (match) {
        resolve(match[0]);
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('exit', (code) => {
      reject(new Error(`host server exited with ${code}: ${stderr || stdout}`));
    });
  });

  const handle: RunningHost = {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
  running.push(handle);
  return handle;
}

async function rawRequest(
  server: RunningHost,
  path: string,
  method = 'GET',
): Promise<{ status: number; body: string }> {
  const { hostname, port } = new URL(server.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method }, (res) => {
      res.setEncoding('utf8');
      let body = '';
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('GET returns an existing Scene verbatim and 404 for a missing one', async () => {
  const root = await tempFolder('esbozo-host-');
  await writeFile(join(root, 'intro.esbozo'), SCENE_SOURCE, 'utf8');
  const server = await startHostServer(root);

  const ok = await fetch(`${server.url}/intro.esbozo`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), SCENE_SOURCE);

  const missing = await fetch(`${server.url}/missing.esbozo`);
  assert.equal(missing.status, 404);
  const body = (await missing.json()) as { error?: string };
  assert.match(body.error ?? '', /no Scene named/);
});

test('PUT writes a nested Scene and its sibling SVG on disk', async () => {
  const root = await tempFolder('esbozo-host-');
  const server = await startHostServer(root);

  const put = await fetch(`${server.url}/zett/assets/page/flow.esbozo`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: SCENE_SOURCE, svg: SVG }),
  });
  assert.equal(put.status, 200);
  assert.deepEqual(await put.json(), {});

  const savedScene = await readFile(join(root, 'zett', 'assets', 'page', 'flow.esbozo'), 'utf8');
  const savedSvg = await readFile(join(root, 'zett', 'assets', 'page', 'flow.svg'), 'utf8');
  assert.equal(savedScene, SCENE_SOURCE);
  assert.equal(savedSvg, SVG);
});

test('refuses parent traversal and symlink escapes outside the root', async () => {
  const root = await tempFolder('esbozo-host-');
  const outside = await tempFolder('esbozo-outside-');
  await writeFile(join(outside, 'secret.esbozo'), SCENE_SOURCE, 'utf8');
  await mkdir(join(root, 'sub'), { recursive: true });
  await symlink(join(outside, 'secret.esbozo'), join(root, 'sub', 'escape.esbozo'));

  const server = await startHostServer(root);

  const dotDot = await rawRequest(server, '/sub/../secret.esbozo');
  assert.equal(dotDot.status, 400);
  assert.ok(JSON.parse(dotDot.body).error);

  const encodedDotDot = await rawRequest(server, '/%2e%2e/secret.esbozo');
  assert.equal(encodedDotDot.status, 400);
  assert.ok(JSON.parse(encodedDotDot.body).error);

  const escaped = await fetch(`${server.url}/sub/escape.esbozo`);
  assert.equal(escaped.status, 403);
  const body = (await escaped.json()) as { error?: string };
  assert.match(body.error ?? '', /leaves the folder/);
});

test('--render rejects an invalid Scene with 400 and leaves previous files untouched', async () => {
  const root = await tempFolder('esbozo-host-');
  const binDir = await tempFolder('esbozo-bin-');
  const ezShim = join(binDir, 'ez');
  await writeFile(ezShim, ezShimScript(), 'utf8');
  await chmod(ezShim, 0o755);

  await writeFile(join(root, 'flow.esbozo'), SCENE_SOURCE, 'utf8');
  await writeFile(join(root, 'flow.svg'), SVG, 'utf8');

  const env = { ...process.env, PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}` };
  const server = await startHostServer(root, ['--render'], env);

  const bad = await fetch(`${server.url}/flow.esbozo`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scene: '{not valid json', svg: '<svg/>' }),
  });
  assert.equal(bad.status, 400);
  const body = (await bad.json()) as { error?: string };
  assert.match(body.error ?? '', /^the Scene is invalid: /);

  assert.equal(await readFile(join(root, 'flow.esbozo'), 'utf8'), SCENE_SOURCE);
  assert.equal(await readFile(join(root, 'flow.svg'), 'utf8'), SVG);
});
