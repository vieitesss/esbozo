/**
 * Script seam, the fake release: the folder of bytes `test/install.test.ts` and
 * `test/update.test.ts` serve instead of GitHub.
 *
 * A release here is what a real one is to the install script — a `SHA256SUMS`
 * and the `ez-<os>-<arch>.gz` asset — served over HTTP on the port the operating
 * system picks, so no test reaches GitHub. Both suites ask this module, so the
 * release the script downloads and the release the binary re-runs the script
 * against cannot drift apart.
 */
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { arch, platform } from 'node:process';
import { gzipSync } from 'node:zlib';

/** The asset the script asks for on this machine. */
const OS = platform === 'darwin' ? 'darwin' : 'linux';
const ARCH = arch === 'x64' ? 'x64' : 'arm64';
const ASSET = `ez-${OS}-${ARCH}.gz`;

/** A tiny shell script standing in for `ez`: running it says which release it is. */
export const EZ = (version: string): string => `#!/bin/sh\necho "ez ${version}"\n`;

/** One release folder served to the script: a `SHA256SUMS` and the asset. */
export function release(
  body: Buffer,
  options: { sums?: string } = {},
): Map<string, Buffer> {
  const archive = gzipSync(body);
  const digest = options.sums ?? createHash('sha256').update(archive).digest('hex');
  return new Map([
    ['SHA256SUMS', Buffer.from(`${digest}  ${ASSET}\n`)],
    [ASSET, archive],
  ]);
}

/** Every release folder the run can ask for, by the path the script asks for. */
function defaults(): Map<string, Map<string, Buffer>> {
  return new Map<string, Map<string, Buffer>>([
    ['/latest/download', release(Buffer.from(EZ('9.9.9')))],
    ['/download/main', release(Buffer.from(EZ('9.9.9-main+abc1234')))],
    ['/download/v1.2.3', release(Buffer.from(EZ('1.2.3')))],
    ['/download/v0.0.9', release(Buffer.from(EZ('0.0.9')), { sums: '0'.repeat(64) })],
  ]);
}

/** A release served to the test, and the one call that stops it. */
export interface FakeRelease {
  /** What `ESBOZO_RELEASE_URL` is set to: the server, with no trailing slash. */
  readonly url: string;
  close(): Promise<void>;
}

/**
 * The fake release, listening. `extra` adds or replaces folders by the path the
 * script asks for, for a case whose release is not one of the defaults.
 */
export async function startRelease(
  extra: Map<string, Map<string, Buffer>> = new Map(),
): Promise<FakeRelease> {
  const files = new Map<string, Buffer>();
  for (const [prefix, folder] of new Map([...defaults(), ...extra])) {
    for (const [name, body] of folder) {
      files.set(`${prefix}/${name}`, body);
    }
  }

  const server = createServer((request, response) => {
    const file = files.get(request.url ?? '');
    if (file === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-length': file.length });
    response.end(file);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close(): Promise<void> {
      await new Promise<void>((closed) => server.close(() => closed()));
    },
  };
}
