/**
 * Seam 1: `ez serve` runs for real, on a temporary folder.
 *
 * Every request goes over http to a server the CLI started, and every
 * assertion reads the folder's files afterwards: nothing here reaches into the
 * server's own state. Paths that would leave the folder are tried the way an
 * attacker would try them, and the file outside has to stay untouched.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { ez, sceneFolder, startServe, tempFolder } from './cli.ts';
import type { Serve } from './cli.ts';

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

/** A server to stop at the end of the file, whatever the test asserted. */
const running: Serve[] = [];
after(async () => {
  await Promise.all(running.map((server) => server.stop()));
});

async function served(folder: string, args: readonly string[] = []): Promise<Serve> {
  const server = await startServe(folder, args);
  running.push(server);
  return server;
}

interface Answer {
  readonly status: number;
  readonly body: string;
}

async function request(
  server: Serve,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<Answer> {
  const response = await fetch(`${server.url}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.text() };
}

function sent(scene: unknown = SCENE, svg = SVG): { scene: string; svg: string } {
  return { scene: JSON.stringify(scene, null, 2), svg };
}

/**
 * A request whose path is sent exactly as written: `fetch` normalises dot
 * segments away before they reach the wire, which is the whole point here.
 */
async function rawRequest(server: Serve, path: string, method = 'GET'): Promise<Answer> {
  const { hostname, port } = new URL(server.url);
  return new Promise((resolve_, reject) => {
    const asking = httpRequest({ hostname, port, path, method }, (response) => {
      response.setEncoding('utf8');
      let body = '';
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () => resolve_({ status: response.statusCode ?? 0, body }));
    });
    asking.on('error', reject);
    asking.end();
  });
}

test('the served page and its font come from the built folder', async () => {
  const server = await served(await sceneFolder(SCENE));

  const page = await request(server, '/editor.html');
  assert.equal(page.status, 200);
  assert.match(page.body, /<esbozo-editor>/);
  assert.match(page.body, /editor\.js/);

  const css = await request(server, '/editor.css');
  assert.equal(css.status, 200);

  const font = await fetch(`${server.url}/fonts/Kalam-Regular.ttf`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/ttf');
  assert.ok((await font.arrayBuffer()).byteLength > 100_000, 'the hand font itself, not an error page');

  // The folder path, so a page opened at / works the same.
  assert.equal((await request(server, '/')).status, 200);
});

test('the list names the Scenes at the top level and says the folder is writable', async () => {
  const folder = await tempFolder();
  await writeFile(join(folder, 'b.json'), '{}', 'utf8');
  await writeFile(join(folder, 'a.json'), '{}', 'utf8');
  await writeFile(join(folder, 'notes.txt'), 'not a Scene', 'utf8');
  // A Scene in a subfolder is out of reach: the folder is listed, not walked.
  await mkdir(join(folder, 'nested'));
  await writeFile(join(folder, 'nested', 'deep.json'), '{}', 'utf8');

  const server = await served(folder);
  const answer = await request(server, '/api/scenes');

  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), {
    folder: folder.split('/').pop(),
    readOnly: false,
    scenes: ['a.json', 'b.json'],
  });
});

test('a Scene reads back byte for byte, and a missing one is not found', async () => {
  const folder = await sceneFolder(SCENE, 'sketch.json');
  const server = await served(folder);

  const found = await request(server, '/api/scenes/sketch.json');
  assert.equal(found.status, 200);
  assert.equal(found.body, SCENE_SOURCE);

  const missing = await request(server, '/api/scenes/other.json');
  assert.equal(missing.status, 404);
  assert.match(missing.body, /no Scene named other\.json/);
});

test('a write stores the Scene and its SVG side by side', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const write = sent({ ...SCENE, title: 'Saved' });

  const answer = await request(server, '/api/scenes/saved.json', 'PUT', write);

  assert.equal(answer.status, 200);
  assert.deepEqual(JSON.parse(answer.body), { scene: 'saved.json', svg: 'saved.svg' });
  assert.equal(await read_(join(folder, 'saved.json')), write.scene);
  assert.equal(await read_(join(folder, 'saved.svg')), write.svg);

  // POST does the same job, and overwriting keeps both files in step.
  const again = sent(SCENE, '<svg/>');
  assert.equal((await request(server, '/api/scenes/saved.json', 'POST', again)).status, 200);
  assert.equal(await read_(join(folder, 'saved.svg')), '<svg/>');

  // No temporary files are left behind either.
  const list = JSON.parse((await request(server, '/api/scenes')).body) as { scenes: string[] };
  assert.deepEqual(list.scenes, ['saved.json', 'scene.json']);
});

test('writes of one Scene that overlap leave the pair from a single request', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);

  const overlapping = Array.from({ length: 48 }, (_, index) =>
    request(server, '/api/scenes/busy.json', 'PUT', {
      scene: JSON.stringify({ ...SCENE, title: `write ${index}` }, null, 2),
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><title>write ${index}</title></svg>`,
    }),
  );
  const answers = await Promise.all(overlapping);
  assert.deepEqual(
    answers.map((answer) => answer.status),
    answers.map(() => 200),
    'every write is answered',
  );

  const saved = JSON.parse(await readFile(join(folder, 'busy.json'), 'utf8')) as { title: string };
  const svg = await readFile(join(folder, 'busy.svg'), 'utf8');
  assert.match(svg, new RegExp(`<title>${saved.title}</title>`), `the SVG beside “${saved.title}” is its own`);
});

test('a folder where the SVG name is taken fails the write and keeps the old pair', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const first = sent({ ...SCENE, title: 'Kept' });
  assert.equal((await request(server, '/api/scenes/kept.json', 'PUT', first)).status, 200);

  // A folder took the SVG's name, so the pair can no longer be written.
  await rm(join(folder, 'kept.svg'));
  await mkdir(join(folder, 'kept.svg'));

  const answer = await request(server, '/api/scenes/kept.json', 'PUT', sent({ ...SCENE, title: 'Replaced' }));

  assert.equal(answer.status, 409);
  assert.match(answer.body, /kept\.svg/);
  assert.equal(await readFile(join(folder, 'kept.json'), 'utf8'), first.scene);
});

test('an invalid Scene is refused and nothing is written', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const broken = { version: 1, elements: [{ id: 'box-a', type: 'rectangle', x: 10, y: 10, width: 0, height: 40 }] };

  const answer = await request(server, '/api/scenes/broken.json', 'PUT', sent(broken));

  assert.equal(answer.status, 400);
  assert.match(answer.body, /width must be at least 1 pixel/);
  await assertMissing(join(folder, 'broken.json'));
  await assertMissing(join(folder, 'broken.svg'));

  // A body that is not a Scene and its SVG is refused the same way.
  assert.equal((await request(server, '/api/scenes/odd.json', 'PUT', { scene: '{}' })).status, 400);
  await assertMissing(join(folder, 'odd.json'));
});

test('a request path with a dot segment is refused before it is normalised', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);

  // Every shape of `..`, literal and encoded, and a backslash for a separator.
  for (const path of [
    '/api/scenes/../secret.json',
    '/api/scenes/../../etc/passwd',
    '/api/scenes/%2e%2e/secret.json',
    '/api/scenes/%2E%2E%2Fsecret.json',
    '/api/scenes/.%2E/secret.json',
    '/api/scenes/..%5Csecret.json',
    '/../editor.html',
  ]) {
    const read = await rawRequest(server, path);
    assert.equal(read.status, 400, `${path} read answered ${read.status}`);
    assert.doesNotMatch(read.body, /root:/, 'no file from outside the folder was handed over');

    const write = await rawRequest(server, path, 'PUT');
    assert.equal(write.status, 400, `${path} write answered ${write.status}`);
  }

  // A path with no dot segment is still read as the Scene it names.
  const plain = await rawRequest(server, '/api/scenes/scene.json');
  assert.equal(plain.status, 200);
  assert.equal(plain.body, SCENE_SOURCE);
  assert.equal(await readFile(join(folder, 'scene.json'), 'utf8'), SCENE_SOURCE);
});

test('a read-only folder lists and reads, and refuses every write', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder, ['--read-only']);

  const list = JSON.parse((await request(server, '/api/scenes')).body) as { readOnly: boolean };
  assert.equal(list.readOnly, true);
  assert.equal((await request(server, '/api/scenes/scene.json')).body, SCENE_SOURCE);

  const refused = await request(server, '/api/scenes/scene.json', 'PUT', sent({ ...SCENE, title: 'Edited' }));
  assert.equal(refused.status, 403);
  assert.match(refused.body, /read-only/);
  assert.equal(await read_(join(folder, 'scene.json')), SCENE_SOURCE);
  await assertMissing(join(folder, 'scene.svg'));
});

test('a name that would leave the folder is refused, and the outside file is untouched', async () => {
  const folder = await sceneFolder(SCENE);
  const outside = await tempFolder('esbozo-outside-');
  const secret = join(outside, 'secret.json');
  await writeFile(secret, '{"version":1,"elements":[]}', 'utf8');
  await symlink(secret, join(folder, 'escape.json'));
  await writeFile(join(outside, 'written.json'), 'keep me', 'utf8');
  const server = await served(folder);

  for (const name of ['..%2Fsecret.json', '%2E%2E%2Fsecret.json', '%2Fetc%2Fpasswd', 'nested%2Fdeep.json']) {
    const read = await request(server, `/api/scenes/${name}`);
    assert.ok(read.status === 400 || read.status === 403, `${name} read answered ${read.status}`);
    assert.doesNotMatch(read.body, /root:/, 'no file from outside the folder was handed over');

    const write = await request(server, `/api/scenes/${name}`, 'PUT', sent());
    assert.ok(write.status === 400 || write.status === 403, `${name} write answered ${write.status}`);
  }

  // A symlink inside the folder that points outside is refused for both calls.
  const throughLink = await request(server, '/api/scenes/escape.json');
  assert.equal(throughLink.status, 403);
  assert.equal(await read_(secret), '{"version":1,"elements":[]}');
  assert.equal((await request(server, '/api/scenes/escape.json', 'PUT', sent())).status, 403);
  assert.equal(await read_(secret), '{"version":1,"elements":[]}');

  // Nothing was written into the folder either.
  await assertMissing(join(folder, 'written.json'));
  assert.deepEqual(
    (JSON.parse((await request(server, '/api/scenes')).body) as { scenes: string[] }).scenes,
    ['scene.json'],
  );
});

test('the server binds to 127.0.0.1 unless --host says otherwise', async () => {
  const server = await served(await sceneFolder(SCENE));
  assert.equal(new URL(server.url).hostname, '127.0.0.1');
});

test('a folder it cannot read, a taken port and a bad argument are told apart', async () => {
  const missing = await ez(['serve', '/no/such/folder/here'], process.cwd());
  assert.equal(missing.code, 4);
  assert.match(missing.stderr, /cannot read folder/);

  const running_ = await served(await sceneFolder(SCENE));
  const port = new URL(running_.url).port;
  const taken = await ez(['serve', '.', '--port', port], running_.folder);
  assert.equal(taken.code, 4);
  assert.match(taken.stderr, new RegExp(`port ${port} .* already in use`));

  const folder = await sceneFolder(SCENE);
  for (const argv of [
    ['serve'],
    ['serve', folder, '--port', 'not-a-number'],
    ['serve', folder, '--port', '99999'],
    ['serve', folder, '--nope'],
    ['serve', folder, 'second-folder'],
  ]) {
    const run_ = await ez(argv, folder);
    assert.equal(run_.code, 2, `${argv.join(' ')} is a usage mistake`);
    assert.match(run_.stderr, /usage: ez serve/);
  }
});

async function read_(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(stat(path), `${path} was not written`);
}
