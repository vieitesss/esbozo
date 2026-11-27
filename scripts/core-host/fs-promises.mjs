export async function readFile(path, encoding) {
  const name = String(path);
  if (encoding === 'utf8') {
    return globalThis.__ezHost.readText(name);
  }
  return new Uint8Array(globalThis.__ezHost.readBytes(name));
}
