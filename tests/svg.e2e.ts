/**
 * Seam 2: a saved `.svg` opened with nothing around it, in a browser.
 *
 * `ez render` writes the file a person opens by double-clicking it, drops into
 * an `<img>` or commits beside a README. Nothing around that file declares a
 * CSS variable, so every colour it paints is the fallback the Renderer writes
 * with each `var()`: paper stays paper, ink stays visible, a grey step lands
 * between them. The file is served three ways here — as its own page at the top
 * of the window, as the `src` of an `<img>` on a page that declares no theme at
 * all, and inlined in a host page that declares a dark one — so no host
 * stylesheet can answer for a variable the drawing names in the first two, and
 * a host's own answer is what the third paints.
 *
 * The pixels are read the way every other browser test reads them
 * (`pixels.ts`), and the Scene is laid out so the page's units are the
 * screenshot's: the Renderer pads a Scene by 16, so Scene (x, y) is window
 * (x + 16, y + 16), and every page here puts the drawing at the window's
 * top-left corner.
 *
 * Each page paints a contrasting background, and no region below can be that
 * colour, so a shape that failed to paint is still a failure and one that fell
 * back to SVG's black is not mistaken for ink.
 *
 * No test here uses the model, so `pnpm e2e` passes with no key set.
 */
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test } from '@e2e-dev/web';
import { afterAll, expect } from 'e2e';
import { cliRender } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect, Shot } from './pixels.ts';
import { removeTempFolders } from '../test/temp.ts';

afterAll(removeTempFolders);

/**
 * A Scene drawn at zero roughness, so a fill is one solid colour and an outline
 * is one straight stroke: a paper-filled box, a box drawn only in ink, a grey-3
 * box and an ink-filled box, words in ink, and a muted shaft across the bottom.
 * Its page is one Scene unit to one CSS pixel.
 */
const SCENE = {
  version: 1,
  title: 'Standalone',
  defaults: { roughness: 0 },
  elements: [
    { id: 'paper', type: 'rectangle', x: 0, y: 0, width: 200, height: 120, fill: { kind: 'solid', grey: 0 } },
    { id: 'outline', type: 'rectangle', x: 240, y: 0, width: 160, height: 120 },
    { id: 'grey', type: 'rectangle', x: 0, y: 140, width: 200, height: 80, fill: { kind: 'solid', grey: 3 } },
    { id: 'ink', type: 'rectangle', x: 240, y: 140, width: 160, height: 80, fill: { kind: 'solid', grey: 6 } },
    { id: 'words', type: 'text', x: 0, y: 240, content: 'ink', fontSize: 'XL' },
    {
      id: 'shade',
      type: 'line',
      points: [{ x: 0, y: 300 }, { x: 410, y: 300 }],
      tone: 'muted',
      stroke: { width: 'extra', style: 'solid' },
    },
  ],
};

/** The padding the Renderer puts around a Scene's Elements, in page units. */
const PAD = 16;

/** Well inside the paper-filled box, which covers Scene (0, 0) to (200, 120). */
const PAPER_INSIDE: Rect = { x: PAD + 40, y: PAD + 30, width: 120, height: 60 };

/** Across the top edge of the ink-only box, drawn from Scene (240, 0) to (400, 0). */
const INK_OUTLINE: Rect = { x: PAD + 250, y: PAD - 5, width: 140, height: 11 };

/** Inside the grey-3 box, which covers Scene (0, 140) to (200, 220). */
const GREY_INSIDE: Rect = { x: PAD + 40, y: PAD + 160, width: 120, height: 40 };

/** Inside the ink-filled box, which covers Scene (240, 140) to (400, 220). */
const INK_INSIDE: Rect = { x: PAD + 260, y: PAD + 160, width: 120, height: 40 };

/** Around the words, which sit below the grey box and reach no further than it. */
const INK_WORDS: Rect = { x: PAD - 10, y: PAD + 200, width: 100, height: 80 };

/** Around the muted shaft, drawn four pixels wide along Scene y 300. */
const MUTED_SHAFT: Rect = { x: PAD + 60, y: PAD + 292, width: 320, height: 16 };

/** The luminance that counts as ink here: paper is about 0.97, ink about 0.1. */
const DARK = 0.6;

/** The light theme's muted, `#878580`: the 52% mix of ink into paper. */
const LIGHT_MUTED = { from: 0.45, to: 0.65 };

/** How many pixels a region holds painted between two luminances. */
function paintIn(view: Shot, region: Rect, band: { from: number; to: number }): number {
  return view.darkCount(region, band.to) - view.darkCount(region, band.from);
}

/**
 * What a browser with no stylesheet paints: the light theme's every fallback.
 *
 * The bands are what tell a fallback from SVG's own defaults, which is what a
 * `var()` missing its fallback would paint: paper is lighter than bare black,
 * ink is `#1b1a17` and not `#000`, and the muted shaft is a grey between the
 * two rather than either of them.
 */
function expectLightFallbacks(view: Shot): void {
  // The bug this test is named for: `fill="var(--paper)"` is invalid on its
  // own, so the box falls back to SVG's black and the page reads as ink.
  expect(view.meanLuminance(PAPER_INSIDE)).toBeGreaterThan(0.85);

  // An unresolved stroke falls back to `none`, so only an answered `--ink`
  // draws this edge at all.
  expect(view.darkCount(INK_OUTLINE, DARK)).toBeGreaterThan(50);

  // And the words carry a fill a browser can paint, so the glyphs are drawn.
  expect(view.darkCount(INK_WORDS, DARK)).toBeGreaterThan(20);

  // Solid ink is `#1b1a17`, so it is dark and still not black.
  const ink = view.meanLuminance(INK_INSIDE);
  expect(ink).toBeLessThan(0.2);
  expect(ink).toBeGreaterThan(0.06);

  // Grey 3 is 38% of ink mixed into the two fallbacks: a grey of its own, not
  // paper and not ink.
  const grey = view.meanLuminance(GREY_INSIDE);
  expect(grey).toBeGreaterThan(0.55);
  expect(grey).toBeLessThan(0.75);

  // `--muted` is its own fallback, the 52% mix, rather than ink or paper.
  expect(paintIn(view, MUTED_SHAFT, LIGHT_MUTED)).toBeGreaterThan(500);
}

test('a saved SVG opened on its own paints the light theme, not black', async ({
  app,
  browser,
  screen,
}) => {
  const svg = await cliRender(SCENE);
  const server = await startServer({
    '/standalone.svg': { type: 'image/svg+xml', body: svg },
  });
  try {
    await app.open(`${server.url}/standalone.svg`);
    expectLightFallbacks(await shot({ app, browser, screen }));
  } finally {
    await server.stop();
  }
});

test('the same file loaded as an image paints the same fallbacks', async ({ app, browser, screen }) => {
  const svg = await cliRender(SCENE);
  const server = await startServer({
    '/standalone.svg': { type: 'image/svg+xml', body: svg },
    '/image.html': { type: 'text/html; charset=utf-8', body: imagePage() },
  });
  try {
    // An `<img>` is a document of its own: the page's stylesheet cannot reach
    // into it, so the drawing here has nothing but its own fallbacks.
    await app.open(`${server.url}/image.html`);
    expectLightFallbacks(await shot({ app, browser, screen }));
  } finally {
    await server.stop();
  }
});

test("an inlined SVG paints the host's ink, paper and muted instead of the fallbacks", async ({
  app,
  browser,
  screen,
}) => {
  const svg = await cliRender(SCENE);
  const server = await startServer({
    '/host.html': { type: 'text/html; charset=utf-8', body: hostPage(svg) },
  });
  try {
    // A fallback is read only when the name is not declared, so a dark host
    // makes the same boxes dark where they were light and light where they
    // were ink, without the drawing changing a byte.
    await app.open(`${server.url}/host.html`);
    const hosted = await shot({ app, browser, screen });

    expect(hosted.meanLuminance(PAPER_INSIDE)).toBeLessThan(0.2);
    expect(hosted.meanLuminance(INK_INSIDE)).toBeGreaterThan(0.8);

    // The host's muted is `#7fd4ff`, a light band the light theme's 52% grey is
    // not: a drawing that kept its fallback would hold no pixel up here.
    expect(paintIn(hosted, MUTED_SHAFT, { from: 0.68, to: 0.85 })).toBeGreaterThan(500);
  } finally {
    await server.stop();
  }
});

/**
 * A page that only points an `<img>` at the saved file and declares no theme at
 * all, on a blue background no fallback the drawing paints is: a shape that
 * failed to paint leaves this page's own colour, not a dark or light region.
 */
function imagePage(): string {
  return [
    '<!doctype html>',
    '<html><head><style>',
    'body { margin: 0; background: #1d4ed8; }',
    'img { display: block; }',
    '</style></head><body>',
    '<img src="/standalone.svg" alt="A saved Scene">',
    '</body></html>',
    '',
  ].join('\n');
}

/**
 * A host page that inlines the drawing and paints its own dark theme around it:
 * a dark paper, a light ink, and a muted of its own. The orange behind the
 * drawing is none of the three, so no region below can pass on the background
 * alone.
 */
function hostPage(svg: string): string {
  return [
    '<!doctype html>',
    '<html><head><style>',
    'html { --ink: #ece7db; --paper: #17161a; --muted: #7fd4ff; }',
    'body { margin: 0; background: #c06020; }',
    'svg { display: block; }',
    '</style></head><body>',
    svg,
    '</body></html>',
    '',
  ].join('\n');
}

/**
 * The files served over http, so the browser opens exactly what `ez render`
 * wrote. Nothing else is served: each page is the drawing, or the drawing and
 * the little around it the test means to give it.
 */
async function startServer(
  pages: Readonly<Record<string, { type: string; body: string }>>,
): Promise<{ url: string; stop: () => Promise<void> }> {
  const server: Server = createServer((request, response: ServerResponse) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const page = pages[path];
    if (page === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    response.writeHead(200, { 'content-type': page.type, 'cache-control': 'no-store' });
    response.end(page.body);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
