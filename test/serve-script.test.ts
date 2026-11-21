/**
 * The static harness, `scripts/serve.mjs`, run the way the e2e suite runs it: a
 * folder of built page files on an ephemeral port.
 *
 * What is asserted is what its callers see — the answer for one file, and the
 * answer after it. A build that loses a file while it is being served costs that
 * one answer, not the server the e2e suite is still asking.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

/** The repository the harness runs in, and where it is found. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The page a test folder holds: enough of one to be an answer of its own. */
const PAGE = '<!doctype html><title>a served page</title>\n';

/**
 * The harness serving `folder`, answered once it has announced its URL. The
 * harness is killed at the end of the test whatever the test asserted.
 */
async function serving(t: TestContext, folder: string): Promise<string> {
  const child = spawn(process.execPath, [join(ROOT, 'scripts/serve.mjs'), folder, '0'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));
  return await new Promise((resolve, reject) => {
    let announced = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      announced += chunk;
      const match = /on (http:\/\/127\.0\.0\.1:\d+)\//.exec(announced);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errors += chunk));
    child.once('error', reject);
    child.once('exit', (code) =>
      reject(new Error(`the harness ended with ${code} before it served: ${announced}${errors}`)),
    );
  });
}

/** What one request got back: the bytes it carried, and which are none. */
async function answer(url: string): Promise<{ status: number; body: string }> {
  return await fetch(url).then(
    async (response) => ({ status: response.status, body: await response.text().catch(() => '') }),
    // A connection the server took away carries no answer at all.
    () => ({ status: -1, body: '' }),
  );
}

test('a file that vanishes mid-answer costs that answer, not the server', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'esbozo-serve-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'editor.html'), PAGE);
  // A build that lost a file: the page table has the name, the folder has a
  // directory where the file should be, so the read fails after its headers.
  await mkdir(join(folder, 'editor.js'));

  const url = await serving(t, folder);

  const lost = await answer(`${url}/editor.js`);
  assert.equal(lost.body, '', 'the answer for a lost file carried bytes of one');

  const page = await answer(`${url}/editor.html`);
  assert.equal(page.status, 200, 'the harness stopped answering after one lost file');
  assert.match(page.body, /a served page/);
});
