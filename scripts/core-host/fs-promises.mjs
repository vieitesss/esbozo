import { host } from '../../src/core-host.js';

export async function readFile(path, encoding) {
  const name = String(path);
  if (encoding === 'utf8') {
    return host().readText(name);
  }
  return new Uint8Array(host().readBytes(name));
}
