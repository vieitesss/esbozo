import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { arch, platform } from 'node:process';
import { gzipSync } from 'node:zlib';
import type { Run } from './cli.ts';

const OS = platform === 'darwin' ? 'darwin' : 'linux';
const ARCH = arch === 'x64' ? 'x64' : 'arm64';
const ASSET = `ez-${OS}-${ARCH}.gz`;

export const fakeEz = (version: string): string => `#!/bin/sh\necho "ez ${version}"\n`;

export function release(
  body: Buffer,
  options: { sums?: string; line?: (digest: string, asset: string) => string } = {},
): Map<string, Buffer> {
  const archive = gzipSync(body);
  const digest = options.sums ?? createHash('sha256').update(archive).digest('hex');
  const line = options.line ?? ((sum: string, asset: string) => `${sum}  ${asset}\n`);
  return new Map([
    ['SHA256SUMS', Buffer.from(line(digest, ASSET))],
    [ASSET, archive],
  ]);
}

export function run(
  file: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = {},
): Promise<Run> {
  return new Promise((ended) => {
    execFile(file, [...args], { env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : -1;
      ended({ code, stdout, stderr });
    });
  });
}

function defaults(): Map<string, Map<string, Buffer>> {
  return new Map<string, Map<string, Buffer>>([
    ['/latest/download', release(Buffer.from(fakeEz('9.9.9')))],
    ['/download/main', release(Buffer.from(fakeEz('9.9.9-main+abc1234')))],
    ['/download/v1.2.3', release(Buffer.from(fakeEz('1.2.3')))],
    ['/download/v0.0.9', release(Buffer.from(fakeEz('0.0.9')), { sums: '0'.repeat(64) })],
  ]);
}

export interface FakeRelease {
  readonly url: string;
  close(): Promise<void>;
}

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
