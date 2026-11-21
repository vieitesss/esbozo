/**
 * Seam 2, the bundle: plain HTML pages holding only the element and its
 * attributes.
 *
 * Nothing on these pages is esbozo's: no page script, no stylesheet request, no
 * folder picker. `ez bundle` writes the module beside them, the page loads it,
 * and each element reads, edits and saves through the URLs its own attributes
 * name. The assertions are the bytes the save API received — and the saved SVG,
 * which has to be the CLI's own drawing of those bytes, or the bundle is
 * measuring words with something other than the font the page draws them in.
 *
 * The save API is a stub of the one `ez serve` answers: `GET` the Scene, `PUT`
 * `{ scene, svg }`. It reads the body with its own eyes instead of either side's
 * parser, so a body the editor gets wrong fails here.
 *
 * `host.html` is the one page that does not fill the window with the editor: it
 * is a page with its own margins, its own font and its own words after the
 * element, and one test reads its computed styles to prove the bundle styled
 * nothing but the element.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { EMPTY, SCENE, VIEW, at, cliRender, clickScene, drag, settle } from './helpers.ts';
import type { Ui, View } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';
import { ez, tempFolder } from '../test/cli.ts';
import { fontBytes } from '../test/fonts.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const KALAM = fileURLToPath(new URL('../fonts/Kalam-Regular.ttf', import.meta.url));
const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
const FONT = 'fonts/Kalam-Regular.ttf';

/**
 * A second font, made for these tests: wider glyphs than Kalam's, so an editor
 * that measured with the wrong file draws different words. Served at
 * `fonts/b.ttf`, so `a.ttf` and `b.ttf` are never the same bytes.
 */
const OTHER_FONT = Buffer.from(fontBytes({ advance: 1200, family: 'Wide' }));
const OTHER_FONT_FILE = 'other.ttf';

/** `SCENE` with a Text in it, so a font's metrics are visible in the drawing. */
const WORDS_SCENE = {
  ...SCENE,
  elements: [...SCENE.elements, { id: 'w', type: 'text', x: 60, y: 200, content: 'hello', fontSize: 'M' }],
};
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);

/** The page fills the window with the editor, so `VIEW`'s page points hold. */
const FULL = 'body { margin: 0 } esbozo-editor { height: 100vh }';

/** The two-instance page: a half each, so both are on screen at once. */
const HALVES = 'body { margin: 0 } esbozo-editor { height: 50vh }';

/** The view an editor filling a 1280×400 half lands in: `VIEW`, 300px shorter. */
const HALF: View = { zoom: 1, panX: 470, panY: 100 };

/** A part of the page where the Scene's ink is. */
const BOX_A: Rect = { x: 510, y: 340, width: 120, height: 80 };
/** The whole page: two shots that mean the same drawing are equal on it. */
const PAGE: Rect = { x: 0, y: 0, width: 1280, height: 800 };
/** Clear paper: a rectangle drawn here would show. */
const PAPER: Rect = { x: 700, y: 500, width: 120, height: 100 };

/** A stub fault: what the API answers, and with which status. */
interface Fault {
  readonly status: number;
  readonly problem: string;
}

/** The folder a run serves: the bundle, the fonts, the pages, and where a save lands. */
interface Embed {
  readonly url: string;
  readonly folder: string;
  /** Writes the API accepted for this Scene. */
  writes(name: string): number;
  /** Requests the API answered on this path, by pathname. */
  requests(path: string): number;
  /** `PUT`s sent to this path, refused or not. */
  puts(path: string): number;
  /** Answer this Scene's reads with a fault. */
  failRead(name: string, status: number, problem: string): void;
  /** Refuse this Scene's writes with a fault. */
  refuseSave(name: string, status: number, problem: string): void;
  /** Hold every answer on this path back, so a test can overtake a slow server. */
  hold(path: string): void;
  /** Let the answers held on this path go, and answer the next ones at once. */
  release(path: string): void;
  /** The bytes saved beside a Scene name. */
  saved(name: string, extension?: string): Promise<string>;
  stop(): Promise<void>;
}

/** The folder the bundle was written into once, for the whole file. */
let bundled: Promise<string> | undefined;

test('a plain page with the element and its attributes opens, edits and saves a Scene', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);

    // The editor read the Scene the `scene` attribute names, and says it stands.
    await expect(screen.getByRole('status')).toHaveText('saved');

    // An edit through the canvas autosaves, with no folder picker and no prompt.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');

    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);

    // The Scene it saved is the Scene it read, with the one Element moved, and
    // the SVG beside it is exactly what `ez render` draws for those bytes.
    const scene = JSON.parse(await embed.saved('a')) as SavedScene;
    expect(scene.title).toBe('Two boxes');
    expect(scene.elements.map((element) => element.id)).toEqual(['a', 'b']);
    expect(await embed.saved('a', 'svg')).toBe(await cliRender(scene));
  } finally {
    await embed.stop();
  }
});

test('a Scene that is not there opens empty, says so, and is written by the first edit', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/missing.html`);

    // A 404 is a Scene nobody has drawn yet, not a failure: the canvas is empty
    // paper and the status line says so instead of showing an error.
    await expect(screen.getByRole('status')).toHaveText('new Scene');
    expect((await shot(ui)).meanLuminance(BOX_A)).toBeGreaterThan(0.85);
    // And nothing was written to a URL that never asked to be written.
    expect(embed.writes('missing')).toBe(0);
    expect((await readdir(join(embed.folder, 'saved'))).sort()).toEqual(['a', 'b']);

    // The first edit is what makes it a Scene, with its SVG beside it.
    await clickScene(ui, { x: PAPER.x, y: PAPER.y }, [], EMPTY);
    await browser.keyboard.press('r');
    await drag(ui, at({ x: 420, y: 40 }, EMPTY), at({ x: 540, y: 140 }, EMPTY));

    await expect.poll(() => embed.writes('missing')).toBe(1);
    const scene = JSON.parse(await embed.saved('missing')) as SavedScene;
    expect(scene.title).toBe('missing');
    expect(scene.elements).toHaveLength(1);
    expect(await embed.saved('missing', 'svg')).toBe(await cliRender(scene));
  } finally {
    await embed.stop();
  }
});

test('a Scene the API cannot read is the server’s words, and nothing is ever written', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    embed.failRead('broken', 500, 'the drawer is jammed');
    await app.open(`${embed.url}/failing.html`);

    await expect(screen.getByRole('status')).toContainText('the drawer is jammed');
    // The canvas is empty, and a would-be draw changes neither it nor the disk.
    expect((await shot(ui)).meanLuminance(PAPER)).toBeGreaterThan(0.85);
    await clickScene(ui, { x: PAPER.x, y: PAPER.y }, [], EMPTY);
    await browser.keyboard.press('r');
    await drag(ui, { x: PAPER.x, y: PAPER.y }, { x: PAPER.x + 120, y: PAPER.y + 80 });
    await settle(ui);

    expect(embed.writes('broken')).toBe(0);
    expect((await shot(ui)).meanLuminance(PAPER)).toBeGreaterThan(0.85);
    await expect(screen.getByRole('status')).toContainText('the drawer is jammed');
  } finally {
    await embed.stop();
  }
});

test('an element with no save attribute is read-only: it says so and refuses every edit', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/read-only.html`);
    await expect(screen.getByText('read-only')).toBeVisible();

    // The Scene draws: a read-only editor is still an editor.
    const opened = await shot(ui);
    expect(opened.darkCount(BOX_A, 0.6)).toBeGreaterThan(0);

    // A drawing tool and a Text: both are refused, so the page paints exactly
    // the drawing it started on, pixel for pixel.
    await clickScene(ui, { x: 340, y: 40 }, [], VIEW);
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 340, y: 40 }, [], { zoom: 1, panX: 470, panY: 300 });
    await browser.keyboard.press('Escape');
    await browser.keyboard.press('r');
    await drag(ui, { x: PAPER.x, y: PAPER.y }, { x: PAPER.x + 120, y: PAPER.y + 80 });
    await settle(ui);
    const afterTools = await shot(ui);
    expect(afterTools.meanLuminance(PAGE)).toBe(opened.meanLuminance(PAGE));

    // A selection and three nudges: selecting is allowed, moving is not, so the
    // drawing after the nudge is the drawing the selection landed on.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    const selected = await shot(ui);
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect((await shot(ui)).meanLuminance(PAGE)).toBe(selected.meanLuminance(PAGE));

    // The Style menu is a door into the Scene as well: its controls are refused
    // the same way, with the selection left exactly as it was.
    await screen.getByRole('button', { name: 'Corners: sharp' }).click();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(PAGE)).toBe(selected.meanLuminance(PAGE));

    expect(embed.writes('a')).toBe(0);
    expect(await embed.saved('a')).toBe(SCENE_SOURCE);

    // The view still answers: the Grid toggles from the status bar, and a
    // keyboard zoom moves the view.
    await screen.getByRole('button', 'Grid').click();
    await expect(screen.getByRole('button', 'Grid')).toHaveAttribute('aria-pressed', 'false');
    await browser.keyboard.press('Control+Equal');
    await expect(screen.getByText('120%')).toBeVisible();
    await expect(screen.getByText('read-only')).toBeVisible();
  } finally {
    await embed.stop();
  }
});

test('a save the API refuses is the server’s words in the status line', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    embed.refuseSave('a', 500, 'the folder is unreadable');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');

    await expect(screen.getByRole('status')).toContainText('the folder is unreadable');
    expect(embed.writes('a')).toBe(0);
  } finally {
    await embed.stop();
  }
});

test('a save refused with 403 makes the page read-only, and it stops trying', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    embed.refuseSave('a', 403, 'this folder is served read-only');
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The first edit is refused by the server, and the refusal is the status.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect(screen.getByRole('status')).toContainText('this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();

    // From then on the page does not even ask: a second edit is refused here.
    const asked = embed.requests('/api/a');
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect(embed.writes('a')).toBe(0);
    expect(embed.requests('/api/a')).toBe(asked);
    expect(await embed.saved('a')).toBe(SCENE_SOURCE);
  } finally {
    await embed.stop();
  }
});

test('a Scene read answered late never replaces the Scene the page names now', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), {
    a: JSON.stringify({ ...SCENE, title: 'First' }, null, 2),
    b: JSON.stringify({ ...SCENE, title: 'Second' }, null, 2),
  });
  try {
    const ui: Ui = { app, browser, screen };
    // The first Scene's read is held, so the page can move on before it answers.
    embed.hold('/api/a');
    await app.open(`${embed.url}/live.html`);
    await browser.evaluate(() => {
      const element = (window as unknown as { live: Element }).live;
      element.setAttribute('scene', 'api/b');
      element.setAttribute('save', 'api/b');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The old answer lands now. It is not the Scene in hand: the edit below
    // saves the Scene the page names, not the one that arrived late.
    embed.release('/api/a');
    await settle(ui);
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');

    await expect.poll(async () => xOf(await embed.saved('b'), 'a')).toBe(50);
    expect((JSON.parse(await embed.saved('b')) as { title: string }).title).toBe('Second');
    expect(embed.requests('/api/a')).toBe(1);
    expect(embed.writes('a')).toBe(0);
  } finally {
    await embed.stop();
  }
});

test('removing save while the Scene is on its way leaves nothing to write', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    embed.hold('/api/a');
    await app.open(`${embed.url}/live.html`);
    await browser.evaluate(() => {
      (window as unknown as { live: Element }).live.removeAttribute('save');
      return true;
    });
    await expect(screen.getByText('read-only')).toBeVisible();

    // The Scene still arrives and draws: a page that may only read is a reader.
    embed.release('/api/a');
    await expect.poll(async () => (await shot(ui)).darkCount(BOX_A, 0.6)).toBeGreaterThan(0);

    // And it writes nothing, whatever a person asks it to draw.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('r');
    await drag(ui, { x: PAPER.x, y: PAPER.y }, { x: PAPER.x + 120, y: PAPER.y + 80 });
    await settle(ui);
    expect(embed.puts('/api/a')).toBe(0);
    expect(embed.writes('a')).toBe(0);
    expect(await embed.saved('a')).toBe(SCENE_SOURCE);
    expect((await shot(ui)).meanLuminance(PAPER)).toBeGreaterThan(0.85);
  } finally {
    await embed.stop();
  }
});

test('words half-typed into a Scene do not land in the next one', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/live.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A Text opened and typed into, never committed.
    await clickScene(ui, { x: 300, y: 260 }, [], VIEW);
    await browser.keyboard.press('t');
    await clickScene(ui, { x: 300, y: 260 }, [], VIEW);
    await browser.keyboard.type('half typed');

    // The page names another Scene while the words are still in the input.
    await browser.evaluate(() => {
      const element = (window as unknown as { live: Element }).live;
      element.setAttribute('scene', 'api/b');
      element.setAttribute('save', 'api/b');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(await browser.evaluate(() => document.querySelector('textarea') === null)).toBe(true);

    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('b'), 'a')).toBe(50);

    const saved = JSON.parse(await embed.saved('b')) as { elements: Array<{ type: string }> };
    expect(saved.elements.filter((element) => element.type === 'text')).toHaveLength(0);
    expect(embed.writes('a')).toBe(0);
  } finally {
    await embed.stop();
  }
});

test('a 403 stops the writes queued behind it', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The first write's answer is held, so the next two are already queued
    // when the server refuses the first.
    embed.hold('/api/a');
    embed.refuseSave('a', 403, 'this folder is served read-only');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.puts('/api/a')).toBe(1);
    embed.release('/api/a');

    await expect(screen.getByRole('status')).toContainText('this folder is served read-only');
    await expect(screen.getByText('read-only')).toBeVisible();
    await settle(ui);

    // One `PUT`, not three: the refusal is about every write behind it.
    expect(embed.puts('/api/a')).toBe(1);
    expect(embed.writes('a')).toBe(0);
    expect(await embed.saved('a')).toBe(SCENE_SOURCE);
  } finally {
    await embed.stop();
  }
});

test('a refusal for the save URL the page moved away from is not its own', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The first write goes to `a`, and its answer is held back.
    embed.hold('/api/a');
    embed.refuseSave('a', 403, 'this folder is served read-only');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.puts('/api/a')).toBe(1);

    // The page points its writes at `b`, and only then does `a` refuse.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('save', 'api/b');
      return true;
    });
    embed.release('/api/a');
    await settle(ui);

    // A refusal for a destination the page no longer writes to says nothing
    // about this one: the next edit is sent, with no holding back.
    expect(embed.writes('a')).toBe(0);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('b')).toBe(1);
    expect(xOf(await embed.saved('b'), 'a')).toBe(60);
  } finally {
    await embed.stop();
  }
});

test('write access ending lets go of the tool in hand', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    await screen.getByRole('button', 'Rectangle').click();
    await expect(screen.getByRole('button', 'Rectangle')).toHaveAttribute('aria-pressed', 'true');

    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.removeAttribute('save');
      return true;
    });
    await expect(screen.getByText('read-only')).toBeVisible();
    await expect(screen.getByRole('button', 'Select')).toHaveAttribute('aria-pressed', 'true');

    // The drag that would have drawn a box under the tool in hand draws nothing.
    await drag(ui, { x: PAPER.x, y: PAPER.y }, { x: PAPER.x + 120, y: PAPER.y + 80 });
    await settle(ui);
    expect(embed.puts('/api/a')).toBe(0);
    expect((await shot(ui)).meanLuminance(PAPER)).toBeGreaterThan(0.85);
  } finally {
    await embed.stop();
  }
});

test('a read-only page takes no undo step it cannot show', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // Two nudges far enough apart to be two steps.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
    await sleep(900);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(60);

    // Read-only: undo changes nothing, and spends nothing either.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.removeAttribute('save');
      return true;
    });
    await expect(screen.getByText('read-only')).toBeVisible();
    await browser.keyboard.press('Control+z');
    await browser.keyboard.press('Control+z');
    await settle(ui);
    expect(xOf(await embed.saved('a'), 'a')).toBe(60);

    // Writing again, one undo takes the newest edit back: 60, not 40.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('save', 'api/a');
      return true;
    });
    await browser.keyboard.press('Control+z');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('a font that is not there is measured again when the page names another', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/font-fail.html`);
    await expect(screen.getByRole('status')).toContainText('cannot load fonts/none.ttf');

    // The page fixes the attribute and the same element comes back to life.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/Kalam-Regular.ttf');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect((await shot(ui)).darkCount(BOX_A, 0.6)).toBeGreaterThan(0);
    expect(await faceOf(browser)).toBe('fonts/Kalam-Regular.ttf');

    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('a slow font cannot put its face under a newer measurement', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { a: SCENE_SOURCE, b: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    embed.hold('/fonts/a.ttf');
    await app.open(`${embed.url}/font-swap.html`);

    // The page names another font while the first is still on its way.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    embed.release('/fonts/a.ttf');
    await settle(ui);

    // The words are drawn with the font the page names now: the face and the
    // metrics are the same file, whichever arrived first.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('a')).toBe(1);
    const scene = JSON.parse(await embed.saved('a'));
    expect(await embed.saved('a', 'svg')).toBe(await cliRender(scene, join(embed.folder, OTHER_FONT_FILE)));
    expect(await faceOf(browser)).toBe('fonts/b.ttf');
  } finally {
    await embed.stop();
  }
});

test('the host page keeps Space and the arrows until the editor has the focus', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/scroll.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const scrolled = (): Promise<number> => browser.evaluate(() => window.scrollY);
    /**
     * Back to the top. Chrome animates the scroll a key asks for, so the top is
     * only really the top once a moment later it is still the top.
     */
    const top = async (): Promise<void> => {
      await expect
        .poll(() =>
          browser.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise((resolve) => setTimeout(resolve, 80));
            return window.scrollY;
          }),
        )
        .toBe(0);
    };

    // Nobody has clicked into the editor: Space and the arrows are the page's.
    await browser.keyboard.press('ArrowDown');
    await expect.poll(scrolled).toBeGreaterThan(0);
    await top();
    await browser.keyboard.press('Space');
    await expect.poll(scrolled).toBeGreaterThan(0);
    await top();

    // A click into the editor hands it the keys, and the focus with them.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    const active = await browser.evaluate(() => document.activeElement?.tagName ?? '');
    expect(active).toBe('ESBOZO-EDITOR');
    // Space pans and the arrow nudges now, so the page does not scroll: a
    // scroll step is tens of pixels, the browser's focus nudge is a few.
    const steady = await scrolled();
    await browser.keyboard.press('Space');
    await browser.keyboard.press('ArrowDown');
    await settle(ui);
    expect((await scrolled()) - steady).toBeLessThan(10);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // Clicking the host's own words takes them back.
    await screen.getByText('words after the editor').click();
    await browser.keyboard.press('ArrowDown');
    await expect.poll(scrolled).toBeGreaterThan(0);
  } finally {
    await embed.stop();
  }
});

test('two elements on one page share no font, no Scene, no Grid and no keystroke', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { a: WORDS_SOURCE, b: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/two.html`);

    // Each element measured the font its own attribute names, and drew with
    // that face: the two files hold different bytes, so the two drawings differ.
    await expect(screen.getByRole('status').first()).toHaveText('saved');
    await expect(screen.getByRole('status').nth(1)).toHaveText('saved');
    expect(embed.requests('/fonts/a.ttf')).toBeGreaterThanOrEqual(1);
    expect(embed.requests('/fonts/b.ttf')).toBeGreaterThanOrEqual(1);
    expect(await faceOf(browser, 0)).toBe('fonts/a.ttf');
    expect(await faceOf(browser, 1)).toBe('fonts/b.ttf');

    // Each element's Grid is a pattern of its own: the second editor does not
    // fill its dots from the first one's.
    const grids = await browser.evaluate(() =>
      [...document.querySelectorAll('esbozo-editor')].map((element) => ({
        id: element.querySelector('pattern')?.id ?? '',
        fill: element.querySelector('.grid-rect')?.getAttribute('fill') ?? '',
      })),
    );
    expect(grids[0]?.id).not.toBe(grids[1]?.id);
    expect(grids[0]?.fill).toBe(`url(#${grids[0]?.id})`);
    expect(grids[1]?.fill).toBe(`url(#${grids[1]?.id})`);

    // A nudge in the first element saves the first Scene and nothing else, and
    // the words in it are the CLI's drawing of them with the first element's
    // own font.
    await clickScene(ui, { x: 100, y: 80 }, [], HALF);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
    expect(await embed.saved('b')).toBe(WORDS_SOURCE);
    const first = JSON.parse(await embed.saved('a'));
    expect(await embed.saved('a', 'svg')).toBe(await cliRender(first, KALAM));

    // And a nudge in the second reaches only the second: the half below is the
    // same Scene at the same view, 400px down the page, drawn with b's font.
    await clickScene(ui, { x: 100, y: 80 }, [], { ...HALF, panY: HALF.panY + 400 });
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('b'), 'a')).toBe(50);
    expect(xOf(await embed.saved('a'), 'a')).toBe(50);
    const second = JSON.parse(await embed.saved('b'));
    expect(await embed.saved('b', 'svg')).toBe(
      await cliRender(second, join(embed.folder, OTHER_FONT_FILE)),
    );
  } finally {
    await embed.stop();
  }
});

test('attributes are live: a late element works, and a change reloads, retargets or goes read-only', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    // This page has no element when the module runs: it appends one afterwards.
    await app.open(`${embed.url}/live.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // All three attributes at once: another Scene, another save URL, another font.
    await browser.evaluate(() => {
      const element = (window as unknown as { live: Element }).live;
      element.setAttribute('scene', 'api/b');
      element.setAttribute('save', 'api/b');
      element.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    await expect.poll(() => embed.requests('/api/b')).toBeGreaterThanOrEqual(1);
    await expect.poll(() => embed.requests('/fonts/b.ttf')).toBeGreaterThanOrEqual(1);
    await expect(screen.getByRole('status')).toHaveText('saved');

    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('b'), 'a')).toBe(50);
    expect(embed.writes('a')).toBe(0);
    expect(await embed.saved('a')).toBe(SCENE_SOURCE);

    // Take the write URL away and the same element becomes read-only.
    await browser.evaluate(() => {
      (window as unknown as { live: Element }).live.removeAttribute('save');
      return true;
    });
    await expect(screen.getByText('read-only')).toBeVisible();
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect(embed.writes('b')).toBe(1);
    expect(xOf(await embed.saved('b'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('the element is a box in the host page’s content, and the bundle styles nothing else', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    await app.open(`${embed.url}/host.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const after = await styles(browser);

    // The host's own page, exactly as it was: margins, font, scrolling and its
    // custom properties. Nothing the bundle writes reaches them.
    expect(after.margin).toBe('24px');
    expect(after.overflow).toBe('visible');
    expect(after.family).toContain('Georgia');
    expect(after.ink).toBe('');
    expect(after.headingFamily).toContain('Georgia');

    // The element is a 480px box in the flow, under the heading, with the page's
    // words after it rather than behind it.
    expect(after.height).toBe(480);
    expect(after.position).toBe('relative');
    expect(after.top).toBeGreaterThan(24);
    expect(after.wordsTop).toBeGreaterThan(after.top + after.height - 1);
  } finally {
    await embed.stop();
  }
});

/**
 * The file the element draws its words with: the family the element names, and
 * the URL that family's `@font-face` rule loads. A face installed without its
 * metrics — or metrics installed without their face — shows up here.
 */
async function faceOf(browser: Ui['browser'], index = 0): Promise<string> {
  return browser.evaluate((which) => {
    const element = document.querySelectorAll('esbozo-editor')[which]!;
    const family = getComputedStyle(element).getPropertyValue('--font-hand').trim();
    const name = /"([^"]+)"/.exec(family)?.[1] ?? '';
    const rules = [...document.querySelectorAll('style')]
      .map((style) => style.textContent ?? '')
      .join('\n');
    const block = new RegExp(`@font-face \\{[^}]*font-family: "${name}"[^}]*\\}`).exec(rules)?.[0] ?? '';
    return /url\("([^"]+)"\)/.exec(block)?.[1] ?? '';
  }, index);
}

interface HostStyles {
  [key: string]: string | number;
  margin: string;
  overflow: string;
  family: string;
  headingFamily: string;
  ink: string;
  height: number;
  top: number;
  position: string;
  wordsTop: number;
}

/**
 * What the browser computed for the host page's own nodes, read straight from
 * the page: the body's box and font, the root's custom properties, and where
 * the element and the words after it landed.
 */
async function styles(browser: Ui['browser']): Promise<HostStyles> {
  return browser.evaluate(() => {
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    const element = document.querySelector('esbozo-editor')!;
    const box = element.getBoundingClientRect();
    const words = document.querySelector('.after')!.getBoundingClientRect();
    return {
      margin: body.marginTop,
      overflow: body.overflowY,
      family: body.fontFamily,
      headingFamily: getComputedStyle(document.querySelector('h1')!).fontFamily,
      ink: root.getPropertyValue('--ink').trim(),
      height: Math.round(box.height),
      top: Math.round(box.top),
      position: getComputedStyle(element).position,
      wordsTop: Math.round(words.top),
    } as HostStyles;
  });
}

interface SavedScene {
  version: number;
  title: string;
  elements: Array<{ id: string; x: number }>;
}

function xOf(source: string, id: string): number | undefined {
  return (JSON.parse(source) as SavedScene).elements.find((element) => element.id === id)?.x;
}

/**
 * The bundle, the fonts and the pages, in one folder a server can hand out.
 * `ez bundle` builds nothing: it copies the editor `pnpm build` made, so this
 * happens once for the whole file.
 */
function bundleFolder(): Promise<string> {
  bundled ??= writeBundle();
  return bundled;
}

async function writeBundle(): Promise<string> {
  const folder = await tempFolder('esbozo-embed-');
  const run = await ez(['bundle', folder], ROOT);
  if (run.code !== 0) {
    throw new Error(`ez bundle exited ${run.code}: ${run.stderr}`);
  }
  const bundle = run.stdout.trim().split('/').pop() ?? '';
  // The second font on disk too, so a test can hand it to `ez render`.
  await writeFile(join(folder, OTHER_FONT_FILE), OTHER_FONT);

  const pages: Record<string, string> = {
    'embedded.html': page(FULL, `<esbozo-editor scene="api/a" save="api/a" font="${FONT}"></esbozo-editor>`, bundle),
    'read-only.html': page(FULL, `<esbozo-editor scene="api/a" font="${FONT}"></esbozo-editor>`, bundle),
    'missing.html': page(FULL, `<esbozo-editor scene="api/missing" save="api/missing" font="${FONT}"></esbozo-editor>`, bundle),
    'failing.html': page(FULL, `<esbozo-editor scene="api/broken" save="api/broken" font="${FONT}"></esbozo-editor>`, bundle),
    'font-fail.html': page(FULL, `<esbozo-editor scene="api/a" save="api/a" font="fonts/none.ttf"></esbozo-editor>`, bundle),
    'font-swap.html': page(FULL, `<esbozo-editor scene="api/a" save="api/a" font="fonts/a.ttf"></esbozo-editor>`, bundle),
    'two.html': page(
      HALVES,
      `<esbozo-editor scene="api/a" save="api/a" font="fonts/a.ttf"></esbozo-editor>
<esbozo-editor scene="api/b" save="api/b" font="fonts/b.ttf"></esbozo-editor>`,
      bundle,
    ),
    'scroll.html': page(
      // A page of its own words, taller than the window: Space and the arrows
      // have somewhere to scroll to.
      'body { margin: 24px } .tall { height: 900px }',
      `<esbozo-editor scene="api/a" save="api/a" font="${FONT}"></esbozo-editor>
<p class="after">words after the editor</p>
<div class="tall"></div>`,
      bundle,
    ),
    'live.html': page(
      FULL,
      `<script type="module" src="${bundle}"></script>
<script type="module">
  // The module is registered before this runs, so the element it makes here is
  // upgraded like any other: a page may hold its editor wherever it likes.
  const element = document.createElement('esbozo-editor');
  element.setAttribute('scene', 'api/a');
  element.setAttribute('save', 'api/a');
  element.setAttribute('font', '${FONT}');
  document.body.append(element);
  window.live = element;
</script>`,
      null,
    ),
    'host.html': page(
      `body { margin: 24px; font-family: Georgia, serif; overflow: visible; color: #333 }`,
      `<h1>Someone else's page</h1>
<esbozo-editor scene="api/a" save="api/a" font="${FONT}"></esbozo-editor>
<p class="after">words after the editor, in the host's own font</p>`,
      bundle,
    ),
  };
  for (const [name, html] of Object.entries(pages)) {
    await writeFile(join(folder, name), html, 'utf8');
  }
  return folder;
}

/** A page with its own rules, its element and the module, and nothing else. */
function page(style: string, markup: string, bundle: string | null): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>embedded esbozo</title><style>${style}</style></head>
<body>
${markup}
${bundle === null ? '' : `<script type="module" src="${bundle}"></script>`}
</body>
</html>
`;
}

/** The bundle's folder, served on a port the operating system picks. */
async function startEmbed(
  folder: string,
  scenes: Record<string, string> = { a: SCENE_SOURCE, b: SCENE_SOURCE },
): Promise<Embed> {
  const saved = join(folder, 'saved');
  // Every test starts on the Scenes it names, from before any edit.
  await rm(saved, { recursive: true, force: true });
  await mkdir(saved, { recursive: true });
  for (const [name, source] of Object.entries(scenes)) {
    await writeFile(join(saved, name), source, 'utf8');
  }

  const writes = new Map<string, number>();
  const requests = new Map<string, number>();
  const puts = new Map<string, number>();
  const faults = new Map<string, { read?: Fault; save?: Fault }>();
  const faultFor = (name: string, kind: 'read' | 'save'): Fault | undefined =>
    faults.get(name)?.[kind];
  // Paths whose answers wait for the test, and the answers waiting on each.
  const holding = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();

  /** The answer to this path is held back until the test lets it go. */
  async function waitOn(path: string): Promise<void> {
    if (holding.has(path)) {
      await new Promise<void>((resolve) => {
        const queue = waiting.get(path) ?? [];
        queue.push(resolve);
        waiting.set(path, queue);
      });
    }
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: (error as Error).message }));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    requests.set(path, (requests.get(path) ?? 0) + 1);
    if (request.method === 'PUT') {
      puts.set(path, (puts.get(path) ?? 0) + 1);
    }
    await waitOn(path);

    const scene = /^\/api\/([\w-]+)$/.exec(path)?.[1];
    if (scene !== undefined) {
      await handleScene(scene, request, response);
      return;
    }
    if (path.startsWith('/fonts/')) {
      // One file per URL, so two elements that asked for two files can be seen
      // to have drawn with the one each asked for.
      const bytes =
        path === '/fonts/b.ttf'
          ? OTHER_FONT
          : path === '/fonts/a.ttf' || path === '/fonts/Kalam-Regular.ttf'
            ? await readFile(KALAM)
            : null;
      if (bytes === null) {
        await send(response, 404, 'text/plain; charset=utf-8', 'not found');
        return;
      }
      await send(response, 200, 'font/ttf', bytes);
      return;
    }
    const file = path === '/' ? 'index.html' : path.slice(1);
    try {
      await send(response, 200, mimeOf(file), await readFile(join(folder, file)));
    } catch {
      await send(response, 404, 'text/plain; charset=utf-8', 'not found');
    }
  }

  async function handleScene(
    name: string,
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const body = join(saved, name);
    if (request.method === 'GET') {
      const fault = faultFor(name, 'read');
      if (fault !== undefined) {
        await send(response, fault.status, json, errorBody(fault.problem));
        return;
      }
      try {
        await send(response, 200, json, await readFile(body));
      } catch {
        await send(response, 404, json, errorBody('no Scene'));
      }
      return;
    }
    if (request.method !== 'PUT') {
      await send(response, 405, json, errorBody('use GET or PUT'));
      return;
    }
    const fault = faultFor(name, 'save');
    if (fault !== undefined) {
      await send(response, fault.status, json, errorBody(fault.problem));
      return;
    }
    const written = JSON.parse(await text(request)) as { scene?: unknown; svg?: unknown };
    if (typeof written.scene !== 'string' || typeof written.svg !== 'string') {
      await send(response, 400, json, errorBody('not a write'));
      return;
    }
    await writeFile(body, written.scene, 'utf8');
    await writeFile(`${body}.svg`, written.svg, 'utf8');
    writes.set(name, (writes.get(name) ?? 0) + 1);
    await send(response, 200, json, '{}');
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    folder,
    writes: (name) => writes.get(name) ?? 0,
    requests: (path) => requests.get(path) ?? 0,
    puts: (path) => puts.get(path) ?? 0,
    failRead(name, status, problem) {
      faults.set(name, { ...faults.get(name), read: { status, problem } });
    },
    refuseSave(name, status, problem) {
      faults.set(name, { ...faults.get(name), save: { status, problem } });
    },
    hold(path) {
      holding.add(path);
    },
    release(path) {
      holding.delete(path);
      for (const resolve of waiting.get(path) ?? []) {
        resolve();
      }
      waiting.delete(path);
    },
    async saved(name, extension = 'json') {
      return readFile(join(saved, extension === 'json' ? name : `${name}.${extension}`), 'utf8');
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const json = 'application/json; charset=utf-8';

function errorBody(problem: string): string {
  return JSON.stringify({ error: problem });
}

function mimeOf(file: string): string {
  if (file.endsWith('.js')) {
    return 'text/javascript; charset=utf-8';
  }
  if (file.endsWith('.ttf')) {
    return 'font/ttf';
  }
  return 'text/html; charset=utf-8';
}

async function send(response: ServerResponse, status: number, type: string, body: string | Buffer): Promise<void> {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

async function text(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
