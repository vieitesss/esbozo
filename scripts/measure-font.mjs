import { fontOf } from './core-host/font-measurements.mjs';

const SIZES = [14, 18, 24, 32];
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
    plain: [[0, 0x10ffff]],
  };

  const measured = fontOf(table, buffer, () => font);
  const meets = (probe, size) =>
    measured.getAdvanceWidth(probe, size) === font.getAdvanceWidth(probe, size, { kerning: true });

  const verified = points.filter((point) =>
    probesOf(String.fromCodePoint(point)).every((probe) => SIZES.every((size) => meets(probe, size))),
  );
  table.plain = runsOf(verified);

  const moved = pairProbes(verified).find((probe) => !meets(probe, 18));
  if (moved !== undefined) {
    return { refused: `shaping moves ${JSON.stringify(moved)}, which the table cannot follow` };
  }

  return { table, verified: verified.length, points: points.length };
}

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

const SFNT_HEADER_BYTES = 12;
const SFNT_TABLE_RECORD_BYTES = 16;

function fingerprint(bytes) {
  const tableCount = (bytes[4] << 8) | bytes[5];
  const directoryLength = SFNT_HEADER_BYTES + tableCount * SFNT_TABLE_RECORD_BYTES;
  return { byteLength: bytes.byteLength, directory: [...bytes.subarray(0, directoryLength)] };
}

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

function arrayBufferOf(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
