/**
 * Seam 1: `ez serve` runs for real, on a temporary folder.
 *
 * Every request goes over http to a server the CLI started, and every
 * assertion reads the folder's files afterwards: nothing here reaches into the
 * server's own state. Paths that would leave the folder are tried the way an
 * attacker would try them, and the file outside has to stay untouched.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { PAGE_ASSETS } from '../src/page-assets.ts';
import { promisify } from 'node:util';
import { ez, sceneFolder, startServe, tempFolder } from './cli.ts';
import type { Serve } from './cli.ts';

const run = promisify(execFile);

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

test('the served page is the editor, its styles, its script, its font and its licence', async () => {
  const server = await served(await sceneFolder(SCENE));

  const page = await fetch(`${server.url}/editor.html`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');

  const css = await fetch(`${server.url}/editor.css`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');

  const script = await fetch(`${server.url}/editor.js`);
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');

  const font = await fetch(`${server.url}/fonts/Kalam-Regular.ttf`);
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-type'), 'font/ttf');
  assert.ok((await font.arrayBuffer()).byteLength > 100_000, 'the hand font itself, not an error page');

  const licence = await fetch(`${server.url}/fonts/OFL.txt`);
  assert.equal(licence.status, 200);
  assert.equal(licence.headers.get('content-type'), 'text/plain; charset=utf-8');

  // The folder path, so a page opened at / works the same.
  assert.equal((await request(server, '/')).status, 200);
});

test('the page transfers compressed when the client asks, in the best encoding it takes', async () => {
  const server = await served(await sceneFolder(SCENE));
  /** The built file, as the server reads it. */
  const file = async (path: string): Promise<Buffer> =>
    readFile(new URL(`../dist${path}`, import.meta.url));

  const script = await file('/editor.js');

  for (const [asked, encoding] of [
    ['br', 'br'],
    ['gzip', 'gzip'],
    ['gzip;q=0.4, br;q=0.9', 'br'],
    ['br;q=0, gzip;q=1', 'gzip'],
    ['*', 'br'],
  ] as const) {
    const answer = await fetch(`${server.url}/editor.js`, { headers: { 'accept-encoding': asked } });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('content-encoding'), encoding, `${asked} is answered in ${encoding}`);
    assert.equal(answer.headers.get('vary'), 'accept-encoding');
    // Fewer bytes crossed the wire than the file holds, and they decode to the
    // file itself: `fetch` decodes the answer for us.
    const wire = Number(answer.headers.get('content-length'));
    assert.ok(wire < script.byteLength, `${asked} is smaller on the wire than the file`);
    assert.deepEqual(Buffer.from(await answer.arrayBuffer()), script);
  }

  // A client that asks for no compression, or accepts none of what is offered,
  // is served the file itself.
  for (const asked of ['identity', 'br;q=0, gzip;q=0', '']) {
    const answer = await fetch(`${server.url}/editor.js`, { headers: { 'accept-encoding': asked } });
    assert.equal(answer.status, 200, `${asked} is served`);
    assert.equal(answer.headers.get('content-encoding'), null, `${asked} gets the file`);
    assert.deepEqual(Buffer.from(await answer.arrayBuffer()), script);
  }

  // Nothing it can send is acceptable: identity itself is refused, so the page
  // is not sent at all rather than sent in an encoding the client said no to.
  for (const asked of ['identity;q=0', 'br;q=0, gzip;q=0, identity;q=0', '*;q=0']) {
    const answer = await fetch(`${server.url}/editor.js`, { headers: { 'accept-encoding': asked } });
    assert.equal(answer.status, 406, `${asked} is answered with a refusal`);
    assert.match(await answer.text(), /content coding/);
  }

  // The font is not text: its own format is the compression, so it travels as it is.
  const font = await fetch(`${server.url}/fonts/Kalam-Regular.ttf`, {
    headers: { 'accept-encoding': 'br, gzip' },
  });
  assert.equal(font.status, 200);
  assert.equal(font.headers.get('content-encoding'), null);
  assert.deepEqual(Buffer.from(await font.arrayBuffer()), await file('/fonts/Kalam-Regular.ttf'));
});

test('the build compresses every text page file beside itself, and serves those bytes', async () => {
  const server = await served(await sceneFolder(SCENE));
  const text = PAGE_ASSETS.filter((asset) => asset.mime.startsWith('text/'));
  assert.ok(text.length >= 4, 'the page is HTML, CSS, a script and a licence');

  for (const asset of text) {
    const source = await readFile(new URL(`../dist/${asset.file}`, import.meta.url));
    const br = await readFile(new URL(`../dist/${asset.file}.br`, import.meta.url));
    const gzip = await readFile(new URL(`../dist/${asset.file}.gz`, import.meta.url));
    // The variants are the build's own, and worth sending: smaller than the file
    // they stand for, and decoding to it.
    for (const variant of [br, gzip]) {
      assert.ok(variant.byteLength < source.byteLength, `${asset.file} is smaller compressed`);
    }
    assert.deepEqual(brotliDecompressSync(br), source, `${asset.file}.br is the file`);
    assert.deepEqual(gunzipSync(gzip), source, `${asset.file}.gz is the file`);

    // The server sends the bytes on disk, not a compression of its own: the
    // length it announces is the variant's own.
    const answer = await fetch(`${server.url}${asset.path}`, {
      headers: { 'accept-encoding': 'br' },
    });
    assert.equal(answer.status, 200);
    assert.equal(answer.headers.get('content-encoding'), 'br');
    assert.equal(answer.headers.get('content-length'), String(br.byteLength));
  }
});

test('the page is all that is served: nothing else in the built folder is', async () => {
  const server = await served(await sceneFolder(SCENE));

  // The CLI bundle sits beside the page, and it is not a page file.
  assert.equal((await request(server, '/cli.js')).status, 404);
  assert.equal((await request(server, '/package.json')).status, 404);
  assert.equal((await request(server, '/whatever.txt')).status, 404);
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

test('the list offers only names the API opens', async () => {
  const folder = await tempFolder();
  await writeFile(join(folder, '.hidden.json'), '{}', 'utf8');
  await writeFile(join(folder, 'upper.JSON'), '{}', 'utf8');
  await writeFile(join(folder, 'scene.json'), '{}', 'utf8');
  const server = await served(folder);

  const listed = JSON.parse((await request(server, '/api/scenes')).body) as { scenes: string[] };
  assert.deepEqual(listed.scenes, ['scene.json', 'upper.JSON']);
  for (const name of listed.scenes) {
    assert.equal((await request(server, `/api/scenes/${name}`)).status, 200, `${name} opens`);
  }

  // A hidden file is not a Scene the folder offers, so it is not listed either.
  assert.equal((await request(server, '/api/scenes/.hidden.json')).status, 400);
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

/**
 * A name that holds something other than a file is not a Scene, and it is
 * answered the way any other name that is not a Scene file is: not found. A
 * folder is the shape this can take in a real one, left there by a person.
 */
test('a name that holds a folder instead of a file is not found', async () => {
  const folder = await sceneFolder(SCENE);
  await mkdir(join(folder, 'folder.json'));
  await writeFile(join(folder, 'folder.json', 'inner.json'), SCENE_SOURCE, 'utf8');
  await mkdir(join(folder, 'empty.json'));
  const server = await served(folder);

  for (const name of ['folder.json', 'empty.json']) {
    const answer = await request(server, `/api/scenes/${name}`);
    assert.equal(answer.status, 404, `${name} answered ${answer.status}`);
    assert.match(answer.body, new RegExp(`no Scene named ${name}`));
  }

  // It is not a name the list offers either, so both agree on what a Scene is.
  const listed = JSON.parse((await request(server, '/api/scenes')).body) as { scenes: string[] };
  assert.deepEqual(listed.scenes, ['scene.json']);

  // The file the folder does hold still reads back byte for byte.
  assert.equal((await request(server, '/api/scenes/scene.json')).body, SCENE_SOURCE);
});

test('a write stores the Scene and its SVG side by side', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const write = sent({ ...SCENE, title: 'Saved' });

  const answer = await request(server, '/api/scenes/saved.json', 'PUT', write);

  assert.equal(answer.status, 200);
  assert.equal(await readFile(join(folder, 'saved.json'), 'utf8'), write.scene);
  assert.equal(await readFile(join(folder, 'saved.svg'), 'utf8'), write.svg);

  // POST does the same job, and overwriting keeps both files in step.
  const again = sent(SCENE, '<svg/>');
  assert.equal((await request(server, '/api/scenes/saved.json', 'POST', again)).status, 200);
  assert.equal(await readFile(join(folder, 'saved.svg'), 'utf8'), '<svg/>');

  // Nothing else is beside them: no temporary outlived the write.
  assert.deepEqual((await readdir(folder)).sort(), ['saved.json', 'saved.svg', 'scene.json']);
});

/**
 * Writes that differ in both files, and in the name used, so the pair on disk
 * names the request it came from by its bytes alone.
 */
function distinctWrites(
  count: number,
  nameFor: (index: number) => string,
): { readonly name: string; readonly write: ReturnType<typeof sent> }[] {
  return Array.from({ length: count }, (_, index) => ({
    name: nameFor(index),
    write: {
      scene: JSON.stringify({ ...SCENE, title: `write ${index}` }, null, 2),
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><title>write ${index}</title><desc>${'x'.repeat(index + 1)}</desc></svg>`,
    },
  }));
}

/** The pair on disk is the Scene and the SVG of one request, byte for byte. */
async function assertPairFrom(
  folder: string,
  name: string,
  writes: readonly { readonly write: ReturnType<typeof sent> }[],
): Promise<void> {
  const savedScene = await readFile(join(folder, name), 'utf8');
  const winner = writes.find((candidate) => candidate.write.scene === savedScene);
  assert.ok(winner !== undefined, 'the Scene on disk is one that was sent, byte for byte');
  const svg = join(folder, name.replace(/\.json$/i, '.svg'));
  assert.equal(await readFile(svg, 'utf8'), winner.write.svg, 'the SVG beside it is that same request');
}

/** Whether this folder is on a filesystem that treats two names as one file. */
async function foldsCase(folder: string): Promise<boolean> {
  const probe = join(folder, 'case-probe.json');
  await writeFile(probe, '{}', 'utf8');
  try {
    await stat(join(folder, 'CASE-PROBE.JSON'));
    return true;
  } catch {
    return false;
  } finally {
    await rm(probe);
  }
}

/** Make a file that a rename will not replace, where the platform can. */
async function makeUnreplaceable(path: string): Promise<boolean> {
  try {
    await run('chflags', ['uchg', path]);
    return true;
  } catch {
    return false;
  }
}

/** Give it back, so nothing is left that a folder cannot be cleaned of. */
async function makeReplaceable(path: string): Promise<void> {
  await run('chflags', ['nouchg', path]).catch(() => {});
}

test('writes of one Scene that overlap leave the pair from a single request', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);

  const writes = distinctWrites(48, () => 'busy.json');
  const answers = await Promise.all(
    writes.map((one) => request(server, `/api/scenes/${one.name}`, 'PUT', one.write)),
  );
  assert.deepEqual(
    answers.map((answer) => answer.status),
    answers.map(() => 200),
    'every write is answered',
  );

  await assertPairFrom(folder, 'busy.json', writes);
});

test('two names that are one file here share one write queue', async (t) => {
  const folder = await sceneFolder(SCENE);
  if (!(await foldsCase(folder))) {
    t.skip('this filesystem tells alias.json and alias.JSON apart');
    return;
  }
  const server = await served(folder);

  // Both names open the same two files, so these writes race for one pair: the
  // pair that survives has to be the two texts of a single request.
  const writes = distinctWrites(40, (index) => (index % 2 === 0 ? 'alias.json' : 'alias.JSON'));
  const answers = await Promise.all(
    writes.map((one) => request(server, `/api/scenes/${one.name}`, 'PUT', one.write)),
  );
  assert.deepEqual(
    answers.map((answer) => answer.status),
    answers.map(() => 200),
    'every write is answered',
  );

  await assertPairFrom(folder, 'alias.json', writes);
});

test('aliased writes that all fail keep the previous pair', async (t) => {
  const folder = await sceneFolder(SCENE);
  if (!(await foldsCase(folder))) {
    t.skip('this filesystem tells alias.json and alias.JSON apart');
    return;
  }
  const server = await served(folder);
  const first = sent({ ...SCENE, title: 'Kept' });
  assert.equal((await request(server, '/api/scenes/alias.json', 'PUT', first)).status, 200);

  // A folder took the SVG's name, so no write of either name can land.
  await rm(join(folder, 'alias.svg'));
  await mkdir(join(folder, 'alias.svg'));

  const writes = distinctWrites(20, (index) => (index % 2 === 0 ? 'alias.json' : 'alias.JSON'));
  const answers = await Promise.all(
    writes.map((one) => request(server, `/api/scenes/${one.name}`, 'PUT', one.write)),
  );
  assert.deepEqual(
    answers.map((answer) => answer.status),
    answers.map(() => 409),
    'every write of either name is refused',
  );

  // Neither name wrote anything: the pair is still the one from the first write.
  assert.equal(await readFile(join(folder, 'alias.json'), 'utf8'), first.scene);
  assert.deepEqual((await readdir(folder)).sort(), ['alias.json', 'alias.svg', 'scene.json']);
  assert.ok((await stat(join(folder, 'alias.svg'))).isDirectory(), 'the folder that refused the writes is still a folder');
});

/**
 * An SVG the folder will not replace, with a pair already beside it. The SVG's
 * rename is the one step a write cannot check for beforehand, so this is where
 * the rollback itself is measured: the Scene goes back byte for byte, the SVG it
 * was written with is still the one on disk, and nothing is left over.
 */
test('a write whose SVG cannot be replaced puts the previous Scene back', async (t) => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  // A title a careless round trip through a string would not survive.
  const first = sent({ ...SCENE, title: 'Kept ✓ 世界' });
  assert.equal((await request(server, '/api/scenes/kept.json', 'PUT', first)).status, 200);

  const svg = join(folder, 'kept.svg');
  if (!(await makeUnreplaceable(svg))) {
    t.skip('this platform cannot make a file that a rename will not replace');
    return;
  }
  try {
    const writes = Array.from({ length: 4 }, (_, index) => ({
      scene: JSON.stringify({ ...SCENE, title: `write ${index} ✓` }, null, 2),
      svg: `<svg xmlns="http://www.w3.org/2000/svg"><title>write ${index}</title></svg>`,
    }));
    const answers = await Promise.all(
      writes.map((write) => request(server, '/api/scenes/kept.json', 'PUT', write)),
    );
    for (const answer of answers) {
      assert.ok(answer.status >= 500, `${answer.status} is the answer to a write that did not finish`);
    }

    // The pair is the one that was there, and the failed writes left no files.
    assert.equal(await readFile(join(folder, 'kept.json'), 'utf8'), first.scene);
    assert.equal(await readFile(svg, 'utf8'), first.svg);
    assert.deepEqual((await readdir(folder)).sort(), ['kept.json', 'kept.svg', 'scene.json']);
  } finally {
    await makeReplaceable(svg);
  }
});

/**
 * A folder that cannot put the Scene back either. The write has failed, and the
 * one thing left to do is say so and say where the bytes still are: a Scene this
 * server could not keep is never a success answer, and never lost quietly.
 */
test('a restore that fails is reported, with the copy that still holds the Scene', async (t) => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const first = sent({ ...SCENE, title: 'Kept ✓ 世界' });
  assert.equal((await request(server, '/api/scenes/kept.json', 'PUT', first)).status, 200);

  const scene = join(folder, 'kept.json');
  if (!(await makeUnreplaceable(scene))) {
    t.skip('this platform cannot make a file that a rename will not replace');
    return;
  }
  try {
    const answer = await request(server, '/api/scenes/kept.json', 'PUT', sent({ ...SCENE, title: 'Replaced' }));

    assert.equal(answer.status, 500, 'a write that could not be undone is not a success');
    const { error } = JSON.parse(answer.body) as { error: string };
    assert.match(error, /could not be put back/);
    const copy = /at (\S+\.bak)/.exec(error)?.[1];
    assert.ok(copy !== undefined, `the answer names the copy that holds the Scene: ${error}`);

    // The Scene on disk is the one that was there, and so is its copy.
    assert.equal(await readFile(scene, 'utf8'), first.scene);
    assert.equal(await readFile(copy, 'utf8'), first.scene);
    await rm(copy);
  } finally {
    await makeReplaceable(scene);
  }
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

/**
 * The other half of the same check, on the Scene's own name: a folder there
 * cannot be replaced either. The answer is 409, the code's status for a target
 * that exists but is not a file, and it comes before anything lands.
 */
test('a write whose Scene name holds a folder is refused and the pair stays', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  const first = sent({ ...SCENE, title: 'Kept' });
  assert.equal((await request(server, '/api/scenes/kept.json', 'PUT', first)).status, 200);

  await rm(join(folder, 'kept.json'));
  await mkdir(join(folder, 'kept.json'));

  for (const method of ['PUT', 'POST']) {
    const answer = await request(server, `/api/scenes/kept.json`, method, sent({ ...SCENE, title: 'Replaced' }));
    assert.equal(answer.status, 409, `${method} answered ${answer.status}`);
    assert.match(answer.body, /kept\.json is a folder/);
  }

  // The folder is still a folder, and the SVG it would have been written with is
  // the one the last good write left.
  assert.ok((await stat(join(folder, 'kept.json'))).isDirectory(), 'the folder that refused the writes is still one');
  assert.equal(await readFile(join(folder, 'kept.svg'), 'utf8'), first.svg);
  assert.deepEqual((await readdir(folder)).sort(), ['kept.json', 'kept.svg', 'scene.json']);
  assert.equal((await request(server, '/api/scenes/kept.json')).status, 404);
});

/** Make a pipe, the non-file a test can stand a name on where the platform allows one. */
async function makePipe(path: string): Promise<boolean> {
  try {
    await run('mkfifo', [path]);
    return true;
  } catch {
    return false;
  }
}

/** A target that is a file or a folder is the two real shapes; a pipe is the rest. */
test('a write to a name that holds a pipe is refused, and nothing is written', async (t) => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);
  if (!(await makePipe(join(folder, 'pipe.json')))) {
    t.skip('this platform has no mkfifo');
    return;
  }

  const answer = await request(server, '/api/scenes/pipe.json', 'PUT', sent());

  assert.equal(answer.status, 409);
  assert.match(answer.body, /pipe\.json is not a file/);
  // Neither the pipe nor an SVG beside it is written, and the read agrees.
  assert.equal((await request(server, '/api/scenes/pipe.json')).status, 404);
  assert.deepEqual((await readdir(folder)).sort(), ['pipe.json', 'scene.json']);
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

test('a write has to announce JSON, so a plain cross-origin post cannot write', async () => {
  const folder = await sceneFolder(SCENE);
  const server = await served(folder);

  // `text/plain` is a cross-origin "simple" request: the browser sends it
  // without asking, so the server is the one that has to refuse it.
  const simple = await fetch(`${server.url}/api/scenes/plain.json`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(sent()),
  });
  assert.equal(simple.status, 415);
  await assertMissing(join(folder, 'plain.json'));
  await assertMissing(join(folder, 'plain.svg'));

  // The same body, announced as JSON, writes both files.
  assert.equal((await request(server, '/api/scenes/plain.json', 'PUT', sent())).status, 200);
  assert.equal(await readFile(join(folder, 'plain.json'), 'utf8'), sent().scene);
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
  assert.equal(await readFile(join(folder, 'scene.json'), 'utf8'), SCENE_SOURCE);
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
  assert.equal(await readFile(secret, 'utf8'), '{"version":1,"elements":[]}');
  assert.equal((await request(server, '/api/scenes/escape.json', 'PUT', sent())).status, 403);
  assert.equal(await readFile(secret, 'utf8'), '{"version":1,"elements":[]}');

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

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(stat(path), `${path} was not written`);
}
