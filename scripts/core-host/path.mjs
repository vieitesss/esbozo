/**
 * `node:path`, as the core bundle uses it when a host that is not Node runs it.
 *
 * The core resolves one path: the font a stylesheet's local `@font-face` names,
 * beside that stylesheet. Both arguments are absolute POSIX paths, because the
 * host resolves what the command line said before it hands them over — so this
 * is `dirname` and `resolve` for absolute POSIX paths and nothing more.
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

/** A path against a base, as Node's `resolve` answers it for absolute POSIX paths. */
export function resolve(...parts) {
  let resolved = '/';
  for (const part of parts) {
    if (typeof part !== 'string' || part === '') {
      throw new TypeError('resolve needs a path');
    }
    if (part.startsWith('/')) {
      resolved = part;
      continue;
    }
    resolved = resolved.endsWith('/') ? resolved + part : `${resolved}/${part}`;
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
