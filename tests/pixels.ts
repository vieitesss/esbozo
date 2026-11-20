/**
 * What the page shows, read from its pixels instead of its markup.
 *
 * A screenshot is a PNG; this decodes the 8-bit, non-interlaced kind Chromium
 * writes, so a test can ask how dark a region is or how much ink is on it.
 * Nothing here knows an element's class, its nesting or its state: moving a
 * wrapper or renaming a group cannot break these tests.
 *
 * Keep these checks for what is exact and stable, such as a solid fill against
 * bare paper. A judgement a person would make by looking, such as "the Grid is
 * showing", belongs in `agent.assert`.
 */
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import type { Ui } from './helpers.ts';

/** A rectangle in page CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the dark pixels of a region sit, on average, in page CSS pixels. */
export interface Centre {
  x: number;
  y: number;
  count: number;
}

/** A decoded screenshot, measured in page CSS pixels. */
export interface Shot {
  /** Mean luminance of a region: 0 is black, 1 is white. */
  meanLuminance(region: Rect): number;
  /** How many pixels in a region are darker than `threshold`. */
  darkCount(region: Rect, threshold: number): number;
  /** Where the dark pixels of a region sit, on average. */
  darkCentre(region: Rect, threshold: number): Centre;
}

/** Screenshot the page as it is now. */
export async function shot(ui: Ui): Promise<Shot> {
  const image = decodePng(await readFile(await ui.app.screenshot('pixels')));
  const scale = image.width / (await ui.browser.evaluate(() => window.innerWidth));
  const channels = image.channels;

  /** Every pixel of a region, in page CSS pixels. */
  const each = (region: Rect, visit: (x: number, y: number, luminance: number) => void): void => {
    const left = Math.max(0, Math.round(region.x * scale));
    const top = Math.max(0, Math.round(region.y * scale));
    const right = Math.min(image.width, Math.round((region.x + region.width) * scale));
    const bottom = Math.min(image.height, Math.round((region.y + region.height) * scale));
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const at = (y * image.width + x) * channels;
        const red = image.data[at] ?? 0;
        const green = image.data[at + 1] ?? red;
        const blue = image.data[at + 2] ?? red;
        visit(x / scale, y / scale, (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255);
      }
    }
  };

  return {
    meanLuminance(region) {
      let total = 0;
      let count = 0;
      each(region, (_x, _y, luminance) => {
        total += luminance;
        count += 1;
      });
      return count === 0 ? 0 : total / count;
    },

    darkCount(region, threshold) {
      let count = 0;
      each(region, (_x, _y, luminance) => {
        if (luminance < threshold) {
          count += 1;
        }
      });
      return count;
    },

    darkCentre(region, threshold) {
      // Weighted in device pixels, so the answer is in page CSS pixels.
      let total = 0;
      let sumX = 0;
      let sumY = 0;
      each(region, (x, y, luminance) => {
        if (luminance < threshold) {
          total += 1;
          sumX += x;
          sumY += y;
        }
      });
      return total === 0
        ? { x: Number.NaN, y: Number.NaN, count: 0 }
        : { x: sumX / total, y: sumY / total, count: total };
    },
  };
}

interface Image {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Decode an 8-bit, non-interlaced PNG: the only kind a Chromium screenshot is. */
function decodePng(png: Buffer): Image {
  for (const [index, byte] of PNG_SIGNATURE.entries()) {
    if (png[index] !== byte) {
      throw new Error('not a PNG');
    }
  }
  let width = 0;
  let height = 0;
  let channels = 0;
  const chunks: Buffer[] = [];
  let at = PNG_SIGNATURE.length;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) {
        throw new Error('only 8-bit, non-interlaced PNGs can be read');
      }
      const colourType = data[9];
      if (colourType !== 2 && colourType !== 6) {
        throw new Error(`unexpected colour type ${colourType}`);
      }
      channels = colourType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      chunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width === 0 || height === 0 || channels === 0) {
    throw new Error('the PNG has no header');
  }

  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const data = new Uint8Array(stride * height);
  let read = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[read++] ?? 0;
    const row = y * stride;
    const previous = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[read++] ?? 0;
      const left = x >= channels ? data[row + x - channels]! : 0;
      const above = y > 0 ? data[previous + x]! : 0;
      const corner = y > 0 && x >= channels ? data[previous + x - channels]! : 0;
      const unfiltered = unfilter(filter, value, left, above, corner);
      data[row + x] = unfiltered & 0xff;
    }
  }
  return { width, height, channels, data };
}

function unfilter(filter: number, value: number, left: number, above: number, corner: number): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return value + left;
    case 2:
      return value + above;
    case 3:
      return value + Math.floor((left + above) / 2);
    case 4:
      return value + paeth(left, above, corner);
    default:
      throw new Error(`unknown PNG filter ${filter}`);
  }
}

function paeth(left: number, above: number, corner: number): number {
  const estimate = left + above - corner;
  const toLeft = Math.abs(estimate - left);
  const toAbove = Math.abs(estimate - above);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toAbove && toLeft <= toCorner) {
    return left;
  }
  return toAbove <= toCorner ? above : corner;
}
