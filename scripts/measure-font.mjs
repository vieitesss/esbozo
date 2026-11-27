/**
 * The measurement table `ez` carries, taken once in the build.
 *
 * Parsing Kalam with `opentype.js` costs ~91 ms, and the Layout only ever asks
 * that parse for one number: how wide a line of words is. This module runs the
 * same `parse`, writes down what the Layout reads out of it, and proves the table
 * against the parser it came from — a character joins the table only when
 * measuring it from the table gives exactly the number the parse gives.
 *
 * A font this cannot model — one that kerns, one whose shaping moves a pair of
 * characters, or one with no character map — is refused as a whole, and the core
 * parses it at run time exactly as it does today.
 */
import { fontOf } from './core-host/font-measurements.mjs';

/** The sizes `src/layout.ts` measures at, so the proof covers them all. */
const SIZES = [14, 18, 24, 32];

/** Characters that sit beside every other in a proof, so words, not letters, are measured. */
const ANCHORS = ['f', 'i', '.'];

function probesOf(character) {
  return [
    character,
    `a${character}a`,
    character + character,
    `a${character}${character}`,
    `${character}${character}a`,
  ];
}

/**
 * The table for this font, or the reason there is none.
 *
 * `parse` is `opentype.js`'s `parse`, handed in so the builder and this module
 * agree on the parser the table is proved against.
 */
export function measurementsOf(parse, bytes) {
  const buffer = arrayBufferOf(bytes);
  const font = parse(buffer);

  if (kerns(font)) {
    return { refused: 'the bundled font kerns, which the table does not carry' };
  }

  const points = Object.keys(font.tables.cmap?.glyphIndexMap ?? {})
    .map(Number)
    .sort((one, other) => one - other);
  if (points.length === 0) {
    return { refused: 'the bundled font names no character' };
  }

  const cmap = {};
  for (const point of points) {
    cmap[point] = font.tables.cmap.glyphIndexMap[point];
  }

  const advances = [];
  for (let glyph = 0; glyph < font.glyphs.length; glyph += 1) {
    advances.push(font.glyphs.get(glyph)?.advanceWidth ?? 0);
  }

  const table = {
    font: fingerprint(bytes),
    unitsPerEm: font.unitsPerEm,
    ascender: font.ascender,
    descender: font.descender,
    os2: os2Of(font),
    family: font.getEnglishName('fontFamily')?.trim() ?? '',
    glyphCount: font.glyphs.length,
    advances,
    cmap,
    // Every character, until the proof below narrows the table to the ones it
    // answers for; the facade reads the same runs the core will read.
    plain: [[0, 0x10ffff]],
  };

  const measured = fontOf(table, buffer, () => font);
  const meets = (probe, size) =>
    measured.getAdvanceWidth(probe, size) === font.getAdvanceWidth(probe, size, { kerning: true });

  const verified = points.filter((point) =>
    probesOf(String.fromCodePoint(point)).every((probe) => SIZES.every((size) => meets(probe, size))),
  );
  table.plain = runsOf(verified);

  // Pairs last, because a pair is only measurable from the table once its
  // characters are: shaping that moves one of them would make the sum wrong
  // everywhere that pair appears, so a pair the table gets wrong refuses it all.
  const moved = pairProbes(verified).find((probe) => !meets(probe, 18));
  if (moved !== undefined) {
    return { refused: `shaping moves ${JSON.stringify(moved)}, which the table cannot follow` };
  }

  return { table, verified: verified.length, points: points.length };
}

/** Every verified character beside each anchor, which is where shaping shows itself. */
function pairProbes(verified) {
  const probes = [];
  for (const point of verified) {
    const character = String.fromCodePoint(point);
    for (const anchor of ANCHORS) {
      probes.push(anchor + character, character + anchor);
    }
  }
  return probes;
}

/**
 * Whether anything in this font kerns, because the table's sum adds no kerning
 * term and a kerns-nothing font is the only one it can answer for exactly.
 */
function kerns(font) {
  if (Object.keys(font.kerningPairs ?? {}).length > 0) {
    return true;
  }
  const lookups = font.position.getKerningTables(font.position.getDefaultScriptName(), undefined) ?? [];
  if (lookups.length === 0) {
    return false;
  }
  for (let left = 0; left < font.glyphs.length; left += 1) {
    for (let right = 0; right < font.glyphs.length; right += 1) {
      if (font.position.getKerningValue(lookups, left, right) !== 0) {
        return true;
      }
    }
  }
  return false;
}

/** The metrics `src/layout.ts` prefers over the header's, or null when there are none. */
function os2Of(font) {
  const os2 = font.tables.os2;
  if (os2 === undefined || os2 === null) {
    return null;
  }
  return {
    sTypoAscender: os2.sTypoAscender,
    sTypoDescender: os2.sTypoDescender,
    sTypoLineGap: os2.sTypoLineGap,
  };
}

/**
 * How the bytes say which font they are: the table directory, whose every
 * record carries a tag, an offset, a length and a checksum.
 */
function fingerprint(bytes) {
  const records = (bytes[4] << 8) | bytes[5];
  return { byteLength: bytes.byteLength, directory: [...bytes.subarray(0, 12 + records * 16)] };
}

/** The code points folded into runs of consecutive ones, which is how they are stored. */
function runsOf(points) {
  const runs = [];
  for (const point of points) {
    const last = runs.at(-1);
    if (last !== undefined && point === last[1] + 1) {
      last[1] = point;
    } else {
      runs.push([point, point]);
    }
  }
  return runs;
}

/** A copy of the bytes as the ArrayBuffer opentype.js parses. */
function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
