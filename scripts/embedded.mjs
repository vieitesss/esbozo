import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function embeddedFiles(root) {
  const assets = await readFile(join(root, 'assets.go'), 'utf8');
  return [...assets.matchAll(/^\/\/go:embed (.+)$/gm)].flatMap(([, files]) => files.trim().split(/\s+/));
}
