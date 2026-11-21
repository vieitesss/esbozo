/**
 * A static file server for the built editor page, so the e2e suite can open
 * `dist/editor.html` over http: ES modules do not load from `file://`.
 *
 * Test-only: `pnpm e2e` starts it on the port e2e picked, and `ez serve` is what
 * a person runs — it answers the save API as well as the page. Both serve the
 * same table and the same answer, `src/page-assets.ts`, so neither can disagree
 * about the page.
 *
 * Usage: node scripts/serve.mjs [folder] [port]
 */
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { answerPageAsset } from '../src/page-assets.ts';

const folder = resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4319);

const server = createServer((request, response) => answerPageAsset(folder, request, response));

server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const bound = typeof address === 'object' && address !== null ? address.port : port;
  process.stdout.write(`serving ${folder} on http://127.0.0.1:${bound}/\n`);
});
