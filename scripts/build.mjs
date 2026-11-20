import { chmod } from 'node:fs/promises';
import { build } from 'esbuild';

const outfile = 'dist/cli.js';

await build({
  entryPoints: ['src/cli.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  loader: { '.wasm': 'binary', '.ttf': 'binary' },
  logLevel: 'info',
});

await chmod(outfile, 0o755);
