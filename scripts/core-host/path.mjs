/**
 * `node:path`, as the core bundle uses it when a host that is not Node runs it.
 *
 * The core resolves one path: the font a stylesheet's local `@font-face` names,
 * beside that stylesheet. The stylesheet is wherever `--css` pointed, as the
 * command line wrote it, so a relative path has to be resolved against the
 * folder the host's process is in — the one thing a shim cannot know, so it asks.
 */

/** The folder a path is in, as Node's `dirname` answers it. */
export function dirname(path) {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) {
    return '.';
  }
  return cut === 0 ? '/' : trimmed.slice(0, cut);
}

/**
 * A path against a base, as Node's `resolve` answers it: the last absolute part
 * is the base, every part after it is joined on, and a result with no absolute
 * part sits in the host's working folder.
 */
export function resolve(...parts) {
  let resolved = '';
  let absolute = false;
  for (let index = parts.length - 1; index >= 0 && !absolute; index -= 1) {
    const part = parts[index];
    if (typeof part !== 'string' || part === '') {
      throw new TypeError('resolve needs a path');
    }
    resolved = `${part}/${resolved}`;
    absolute = part.startsWith('/');
  }
  if (!absolute) {
    resolved = `${globalThis.__ezHost.cwd()}/${resolved}`;
  }
  return normalise(resolved);
}

/** Every `.` folded away and every `..` folded into the segment before it. */
function normalise(path) {
  const segments = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
