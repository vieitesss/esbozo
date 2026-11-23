/**
 * A font file read into the numbers Layout places text with, without a font
 * library.
 *
 * The editor measures in the browser, and a full OpenType parser costs more
 * than the whole bundle is allowed — `opentype.js` alone is over the budget.
 * Layout needs very little from a file: the units per em, the vertical metrics
 * and one advance width per character. So this module reads the four tables
 * that carry those numbers (`head`, `hhea`, `OS/2`, `hmtx`) and the character
 * map (`cmap`), and nothing else. The CLI keeps `opentype.js`, which also has to
 * name the family and count the glyphs; `test/font-metrics.test.ts` holds the
 * two readers to the same numbers, so the editor and `ez render` place a word
 * in the same place.
 *
 * What this reader does not do is kerning. The bundle's font is Kalam, which has
 * no kerning pairs, so there is nothing to apply; a host that points `font` at a
 * kerned font gets advances without kerning, and a drawing that is a little
 * wider than the same Scene drawn by `ez render --font`.
 */
import type { Metrics } from './layout.js';

const FALLBACK_UNITS_PER_EM = 1000;

const OS2_TYPOGRAPHIC_LENGTH = 78;

type Tables = Map<string, number>;

export function measureFontBytes(bytes: Uint8Array): Metrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = directoryOf(view);

  const head = requireTable(view, tables, 'head', 20);
  const stated = view.getUint16(head + 18);
  const unitsPerEm = stated > 0 ? stated : FALLBACK_UNITS_PER_EM;

  const hhea = requireTable(view, tables, 'hhea', 36);
  const count = view.getUint16(hhea + 34);
  if (count === 0) {
    throw new Error('the font has no horizontal metrics');
  }

  const os2 = tables.get('OS/2');
  const typographic =
    os2 !== undefined && os2 + OS2_TYPOGRAPHIC_LENGTH <= view.byteLength ? os2 : null;
  const ascender = typographic === null ? view.getInt16(hhea + 4) : view.getInt16(typographic + 68);
  const descender = typographic === null ? view.getInt16(hhea + 6) : view.getInt16(typographic + 70);
  const lineGap = typographic === null ? 0 : view.getInt16(typographic + 72);

  const lineHeightEm = ascender - descender > 0 ? (ascender - descender + lineGap) / unitsPerEm : 1;
  const inkCentreEm = (ascender + descender) / 2 / unitsPerEm;

  const hmtx = requireTable(view, tables, 'hmtx', count * 4);
  const glyphOf = characterMapOf(view, tables);

  // One advance width per glyph, in font units: the last entry repeats for the
  // glyphs after it, which is the monospaced tail `hmtx` allows.
  const advanceOf = (glyph: number): number =>
    view.getUint16(hmtx + Math.min(glyph, count - 1) * 4);

  return {
    // The same accumulation `opentype.js` does, in the same order, so the two
    // agree to the last bit and not just to the hundredth the Renderer prints.
    advance: (text, size) => {
      const scale = (1 / unitsPerEm) * size;
      let width = 0;
      for (const character of text) {
        width += advanceOf(glyphOf(character.codePointAt(0) ?? 0)) * scale;
      }
      return width;
    },
    lineHeight: (size) => size * lineHeightEm,
    inkCentre: (size) => size * inkCentreEm,
  };
}

function directoryOf(view: DataView): Tables {
  if (view.byteLength < 12) {
    throw notAFont();
  }
  const version = tagAt(view, 0);
  // TrueType outlines, Apple's `true`, or CFF outlines in `OTTO`: the tables read
  // here are the same in all three.
  if (version !== '\u0000\u0001\u0000\u0000' && version !== 'true' && version !== 'OTTO') {
    throw notAFont();
  }
  const tables: Tables = new Map();
  for (let index = 0; index < view.getUint16(4); index += 1) {
    const record = 12 + index * 16;
    if (record + 16 > view.byteLength) {
      throw notAFont();
    }
    const offset = view.getUint32(record + 8);
    if (offset + view.getUint32(record + 12) > view.byteLength) {
      throw notAFont();
    }
    tables.set(tagAt(view, record), offset);
  }
  return tables;
}

function requireTable(view: DataView, tables: Tables, tag: string, length: number): number {
  const offset = tables.get(tag);
  if (offset === undefined || offset + length > view.byteLength) {
    throw new Error(`the font has no usable ${tag} table`);
  }
  return offset;
}

/**
 * The character map, as a function from a code point to a glyph index: the two
 * formats a font uses for it, `4` and `12`. A code point the font does not
 * carry reads as glyph 0, the `.notdef` every file has.
 */
function characterMapOf(view: DataView, tables: Tables): (codePoint: number) => number {
  const cmap = requireTable(view, tables, 'cmap', 4);
  const count = view.getUint16(cmap + 2);
  let wide: number | null = null;
  let narrow: number | null = null;
  for (let index = 0; index < count; index += 1) {
    const record = cmap + 4 + index * 8;
    if (record + 8 > view.byteLength) {
      break;
    }
    const offset = cmap + view.getUint32(record + 4);
    if (offset + 2 > view.byteLength) {
      continue;
    }
    const format = view.getUint16(offset);
    // Format 12 carries the whole code space, so it wins when a file has both;
    // the later subtable of a format wins, as a reader takes the last word.
    if (format === 12 && offset + 16 <= view.byteLength) {
      wide = offset;
    } else if (format === 4 && offset + 14 <= view.byteLength) {
      narrow = offset;
    }
  }
  if (wide !== null) {
    const table = wide;
    return (codePoint) => {
      const groups = view.getUint32(table + 12);
      let low = 0;
      let high = groups - 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        const group = table + 16 + middle * 12;
        const first = view.getUint32(group);
        const last = view.getUint32(group + 4);
        if (codePoint < first) {
          high = middle - 1;
        } else if (codePoint > last) {
          low = middle + 1;
        } else {
          return view.getUint32(group + 8) + (codePoint - first);
        }
      }
      return 0;
    };
  }
  if (narrow !== null) {
    const table = narrow;
    return (codePoint) => segmentOf(view, table, codePoint);
  }
  throw new Error('the font has no character map this reader understands');
}

function segmentOf(view: DataView, table: number, codePoint: number): number {
  const segmentCount = view.getUint16(table + 6);
  const ends = table + 14;
  const starts = ends + segmentCount + 2;
  const deltas = starts + segmentCount;
  const ranges = deltas + segmentCount;
  for (let index = 0; index < segmentCount; index += 2) {
    if (codePoint > view.getUint16(ends + index)) {
      continue;
    }
    const start = view.getUint16(starts + index);
    if (codePoint < start) {
      return 0;
    }
    const delta = view.getInt16(deltas + index);
    const rangeOffset = view.getUint16(ranges + index);
    if (rangeOffset === 0) {
      return (codePoint + delta) & 0xffff;
    }
    const glyph = ranges + index + rangeOffset + (codePoint - start) * 2;
    if (glyph + 2 > view.byteLength) {
      return 0;
    }
    const index_ = view.getUint16(glyph);
    return index_ === 0 ? 0 : (index_ + delta) & 0xffff;
  }
  return 0;
}

function tagAt(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function notAFont(): Error {
  return new Error('not a TrueType or OpenType font');
}
