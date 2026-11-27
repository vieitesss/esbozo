/**
 * `RegExp.$1`: the one legacy static goja leaves out, installed for the one
 * library that reads it.
 *
 * `path-data-parser`, which roughjs parses some fills through, tokenises path
 * data with `String.prototype.match` and takes the capture back off `RegExp.$1`.
 * In V8 the engine keeps `$1` through `$9` for every successful match; in goja
 * `RegExp.$1` is `undefined`, so the first path fill throws.
 *
 * A banner runs in the realm's global scope, so the two names it keeps are held
 * inside a function instead: a top-level `let` or `const` is a binding the realm
 * keeps, and evaluating the bundle again in that realm — which is how a host
 * reloads one — would throw `Identifier 'lastMatch' has already been declared`.
 */
(() => {
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
})();
