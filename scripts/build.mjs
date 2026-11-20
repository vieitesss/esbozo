/**
 * Build the two artefacts: the `ez` CLI and the editor page.
 *
 * Both share the Scene and the Renderer, and neither needs a node builtin, so
 * the browser bundle is the same source as the CLI's.
 */
import { chmod, copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

const cliOutfile = 'dist/cli.js';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: cliOutfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  loader: { '.wasm': 'binary', '.ttf': 'binary' },
  logLevel: 'info',
});

await chmod(cliOutfile, 0o755);

await build({
  entryPoints: ['src/editor/main.ts'],
  outfile: 'dist/editor.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'info',
});

await mkdir('dist/fonts', { recursive: true });
await copyFile('src/editor/editor.css', 'dist/editor.css');
await copyFile('src/editor/page.html', 'dist/editor.html');
await copyFile('fonts/Kalam-Regular.ttf', 'dist/fonts/Kalam-Regular.ttf');
await copyFile('fonts/OFL.txt', 'dist/fonts/OFL.txt');
