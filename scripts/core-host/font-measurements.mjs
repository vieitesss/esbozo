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
     * then the kerning with the next one, both scaled by the font size. The build
     * keeps the table only for a font whose default script kerns nothing, so the
     * kerning term is exactly zero.
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
