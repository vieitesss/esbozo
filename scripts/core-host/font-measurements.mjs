/**
 * The bundled font's measurements, answered from the table the build wrote.
 *
 * `src/layout.ts` measures every Text and Label through a parsed font, and
 * parsing Kalam costs ~91 ms of a cold `ez check`: 1027 glyph objects built so
 * the Layout can ask for a handful of advance widths. `scripts/measure-font.mjs`
 * parses the very same file with the very same library, and this module answers
 * the measurement from what that parse wrote down — the metrics and the family
 * name, the advance of each glyph, and which character names which glyph.
 *
 * Nothing outside that table is invented here. A font that is not the bundled
 * one (the bytes' table directory says which font it is), text holding a
 * character the build did not verify, and every glyph outline are answered by a
 * real parse, made on the spot, so `--font` and the PNG path measure and draw
 * exactly as they did before this table existed.
 */

/**
 * Whether these bytes are the bundled font the table was taken from.
 *
 * The table directory carries each table's tag, offset, length and checksum, so
 * two fonts that agree on it and on their length are the same font: comparing
 * the 12-byte header and the records is enough, and costs nothing beside the
 * 427 KB a byte-by-byte compare would walk.
 */
export function isBundled(table, buffer) {
  if (buffer.byteLength !== table.font.byteLength) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  const directory = table.font.directory;
  for (let at = 0; at < directory.length; at += 1) {
    if (bytes[at] !== directory[at]) {
      return false;
    }
  }
  return true;
}

/**
 * One font that answers the measurements from `table` and everything else from
 * `parseReal`, opentype.js's own `parse` called on these bytes the first time
 * something needs it.
 *
 * The shape is the part of an `opentype.js` font `src/layout.ts` and
 * `src/glyphs.ts` read: they ask for the metrics, the family, how many glyphs
 * there are, the advance of a line and the curves of a line.
 */
export function fontOf(table, buffer, parseReal) {
  let real = null;
  const parsed = () => (real ??= parseReal(buffer));

  return {
    unitsPerEm: table.unitsPerEm,
    ascender: table.ascender,
    descender: table.descender,
    tables: table.os2 === null ? {} : { os2: table.os2 },
    glyphs: { length: table.glyphCount },
    getEnglishName: (name) => (name === 'fontFamily' ? table.family : parsed().getEnglishName(name)),
    /**
     * `opentype.js`'s own sum, in its own order: for each glyph its advance and
     * then the kerning with the next one, both scaled by the font size. The
     * build keeps the table only for a font whose default script kerns nothing,
     * so the kerning term is exactly zero and adding it would add exactly
     * nothing — `x += 0 * scale` is `x`.
     */
    getAdvanceWidth: (text, size) => {
      const glyphs = glyphSequence(table, text);
      if (glyphs === null) {
        return parsed().getAdvanceWidth(text, size, { kerning: true });
      }
      const scale = (1 / table.unitsPerEm) * size;
      let x = 0;
      for (let at = 0; at < glyphs.length; at += 1) {
        const advance = table.advances[glyphs[at]];
        if (advance) {
          x += advance * scale;
        }
      }
      return x;
    },
    getPath: (...args) => parsed().getPath(...args),
  };
}

/**
 * The glyphs a line is measured as, or null when the table cannot answer for it.
 *
 * One glyph per character: the build verifies that measuring a character from
 * the table gives the number the parser gives, alone and folded into words, so
 * a character it verified is a character this may name. Any other character is
 * a line the real parser shapes, which is why this answers null rather than a
 * guess.
 */
function glyphSequence(table, text) {
  const glyphs = [];
  for (const character of text) {
    const point = character.codePointAt(0);
    if (!isPlain(table.plain, point)) {
      return null;
    }
    glyphs.push(table.cmap[point] ?? 0);
  }
  return glyphs;
}

/** Whether the build verified that this character measures as its own glyph. */
function isPlain(runs, point) {
  for (let at = 0; at < runs.length; at += 1) {
    if (point < runs[at][0]) {
      return false;
    }
    if (point <= runs[at][1]) {
      return true;
    }
  }
  return false;
}
