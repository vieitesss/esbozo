/**
 * What the root Go package embeds, read from the `//go:embed` lines in its
 * `assets.go`: `check:steps` stands in for the files only `pnpm build` writes,
 * which `go vet` would otherwise refuse to resolve in a tree that has none.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Every file `assets.go` in one root embeds, as the pattern wrote it. */
export async function embeddedFiles(root) {
  const assets = await readFile(join(root, 'assets.go'), 'utf8');
  return [...assets.matchAll(/^\/\/go:embed (.+)$/gm)].flatMap(([, files]) => files.trim().split(/\s+/));
}
