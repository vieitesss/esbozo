import { host } from '../../src/core-host.js';

export function dirname(path) {
  const trimmed = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) {
    return '.';
  }
  return cut === 0 ? '/' : trimmed.slice(0, cut);
}

export function resolve(...parts) {
  let resolved = '';
  let absolute = false;
  for (let index = parts.length - 1; index >= 0 && !absolute; index -= 1) {
    const part = parts[index];
    if (typeof part !== 'string') {
      throw new TypeError('resolve needs a path');
    }
    if (part === '') {
      continue;
    }
    resolved = `${part}/${resolved}`;
    absolute = part.startsWith('/');
  }
  if (!absolute) {
    resolved = `${host().cwd()}/${resolved}`;
  }
  return normalise(resolved);
}

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
