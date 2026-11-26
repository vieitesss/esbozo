/**
 * `RegExp.$1`: the one legacy static goja leaves out, installed for the one
 * library that reads it.
 *
 * `path-data-parser`, which roughjs parses some fills through, tokenises path
 * data with `String.prototype.match` and takes the capture back off `RegExp.$1`.
 * In V8 the engine keeps `$1` through `$9` for every successful match; in goja
 * `RegExp.$1` is `undefined`, so the first path fill throws `Cannot read
 * property 'length' of undefined`.
 *
 * This file is the bundle's banner, so it runs before any module does. It
 * records each match that a `String` match found and answers `$1` through `$9`
 * from it — the whole of what the parser reads.
 */
let lastMatch = null;

const builtinMatch = String.prototype.match;

String.prototype.match = function recordMatch(pattern) {
  const found = builtinMatch.call(this, pattern);
  if (pattern instanceof RegExp && found !== null && found !== undefined) {
    lastMatch = found;
  }
  return found;
};

for (let group = 1; group <= 9; group += 1) {
  Object.defineProperty(RegExp, `$${group}`, {
    configurable: true,
    get: () => (lastMatch === null ? undefined : lastMatch[group]),
  });
}
