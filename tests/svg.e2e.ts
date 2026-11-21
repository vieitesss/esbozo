/**
 * Seam 2: a saved `.svg` opened on its own, in a browser.
 *
 * `ez render` writes the file a person opens by double-clicking it, drops into
 * an `<img>` or commits beside a README. Nothing around that document declares
 * a CSS variable, so every colour it paints is the fallback the Renderer writes
 * with each `var()`: paper stays paper, ink stays visible. The page here is
 * that file alone, served as `image/svg+xml` and opened at the top of the
 * window, so no host stylesheet can answer for a variable the drawing names.
 *
 * The pixels are read the way every other browser test reads them
 * (`pixels.ts`), and the Scene is laid out so the page's units are the
 * screenshot's: the Renderer pads a Scene by 16, so Scene (x, y) is window
 * (x + 16, y + 16), and with no host page the drawing sits at the window's
 * top-left corner.
 *
 * No test here uses the model, so `pnpm e2e` passes with no key set.
 */
import { createServer } from 'node:http';
import type { Server, ServerResponse } from 'node:http';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { cliRender } from './helpers.ts';
import { shot } from './pixels.ts';

/**
 * A Scene drawn at zero roughness, so a fill is one solid colour and an outline
 * is one straight stroke: a paper-filled box, a box drawn only in ink, and
 * words in ink. Its page is 432×322, one Scene unit to one CSS pixel.
 */
const SCENE = {
  version: 1,
  title: 'Standalone',
  defaults: { roughness: 0 },
  elements: [
    { id: 'paper', type: 'rectangle', x: 0, y: 0, width: 200, height: 150, fill: { kind: 'solid', grey: 0 } },
    { id: 'outline', type: 'rectangle', x: 240, y: 0, width: 160, height: 150 },
    { id: 'ink', type: 'rectangle', x: 240, y: 200, width: 160, height: 80, fill: { kind: 'solid', grey: 6 } },
    { id: 'words', type: 'text', x: 0, y: 200, content: 'ink', fontSize: 'XL' },
    { id: 'line', type: 'line', points: [{ x: 0, y: 290 }, { x: 400, y: 290 }] },
  ],
};

/** The padding the Renderer puts around a Scene's Elements, in page units. */
const PAD = 16;

/** Well inside the paper-filled box, which covers Scene (0, 0) to (200, 150). */
const PAPER_INSIDE = { x: PAD + 40, y: PAD + 40, width: 120, height: 70 };

/** Across the top edge of the ink-only box, drawn from Scene (240, 0) to (400, 0). */
const INK_OUTLINE = { x: PAD + 250, y: PAD - 5, width: 140, height: 11 };

/** Inside the ink-filled box, which covers Scene (240, 200) to (400, 280). */
const INK_INSIDE = { x: PAD + 260, y: PAD + 215, width: 130, height: 50 };

/** Around the words, which sit below the paper box and reach no further than it. */
const INK_WORDS = { x: PAD - 10, y: PAD + 175, width: 90, height: 80 };

/** The luminance that counts as ink here: paper is about 0.97, ink about 0.1. */
const DARK = 0.6;

test('a saved SVG opened on its own paints paper, keeps its strokes and reads its words', async ({
  app,
  browser,
  screen,
}) => {
  const svg = await cliRender(SCENE);
  const server = await startServer({
    '/standalone.svg': { type: 'image/svg+xml', body: svg },
    '/host.html': { type: 'text/html; charset=utf-8', body: hostPage(svg) },
  });
  try {
    await app.open(`${server.url}/standalone.svg`);

    const view = await shot({ app, browser, screen });

    // The bug this test is named for: `fill="var(--paper)"` is invalid on its
    // own, so the box falls back to SVG's black and the page reads as ink.
    expect(view.meanLuminance(PAPER_INSIDE)).toBeGreaterThan(0.85);

    // An unresolved stroke falls back to `none`, so only an answered `--ink`
    // draws this edge at all.
    expect(view.darkCount(INK_OUTLINE, DARK)).toBeGreaterThan(50);

    // And the words: `fill="var(--ink)"` on its own paints nothing a browser
    // can colour, so they are missing or black.
    expect(view.darkCount(INK_WORDS, DARK)).toBeGreaterThan(20);

    // A grey-6 fill is the ink itself, and it is ink, not the page's white.
    expect(view.meanLuminance(INK_INSIDE)).toBeLessThan(0.2);

    // The file is its own page: no host page wraps it, so every colour it
    // shows came from the drawing.
    expect(await browser.evaluate(() => document.documentElement.tagName.toLowerCase())).toBe('svg');

    // Inlined in a host page, the host's ink and paper answer instead: a
    // fallback is read only when the name is not declared, so a dark host
    // makes the same boxes dark where they were light and light where they
    // were ink, without the drawing changing a byte.
    await app.open(`${server.url}/host.html`);
    const hosted = await shot({ app, browser, screen });
    expect(hosted.meanLuminance(PAPER_INSIDE)).toBeLessThan(0.2);
    expect(hosted.meanLuminance(INK_INSIDE)).toBeGreaterThan(0.8);
  } finally {
    await server.stop();
  }
});

/** A host page that inlines the drawing and paints its own dark theme around it. */
function hostPage(svg: string): string {
  return [
    '<!doctype html>',
    '<html><head><style>',
    'html { --ink: #ece7db; --paper: #17161a; --muted: #878580; }',
    'body { margin: 0; background: var(--paper); }',
    '</style></head><body>',
    svg,
    '</body></html>',
    '',
  ].join('\n');
}

/**
 * The bytes `ez render` wrote, served over http so the browser opens that file
 * as its own page. Nothing else is served: the page the browser shows is the
 * drawing and nothing around it.
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
