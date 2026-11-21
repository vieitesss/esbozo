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
import { EMPTY, SCENE, SNAPPED_SCENE, VIEW, at, cliRender, clickScene, drag, settle } from './helpers.ts';
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

/** `SCENE` with a Text in it, so a font's metrics and its face are visible in the drawing. */
const WORDS_SCENE = {
  ...SCENE,
  elements: [...SCENE.elements, { id: 'w', type: 'text', x: 60, y: 200, content: 'hello', fontSize: 'M' }],
};
const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);

/**
 * A box with words that do not fit it: the wide test font breaks them into more
 * lines than Kalam does, so a stale measurement shows below the box.
 */
const LABEL_SCENE = {
  version: 1,
  title: 'Label',
  defaults: { roughness: 1 },
  elements: [
    {
      id: 'l',
      type: 'rectangle',
      x: 40,
      y: 40,
      width: 160,
      height: 80,
      label: 'a label that wraps',
    },
  ],
};
const LABEL_SOURCE = JSON.stringify(LABEL_SCENE, null, 2);

/** A Scene with nothing in it: paper, so ink left on the page is somebody's old ink. */
const EMPTY_SOURCE = JSON.stringify({ version: 1, title: 'Empty', elements: [] }, null, 2);

/** The arrow `link` attached at both ends: the ink a click has to reach. */
const LINK_SOURCE = JSON.stringify(SNAPPED_SCENE, null, 2);

/** The same Scene two ways: one read is answered with each, so a title says which. */
const FIRST_SOURCE = JSON.stringify({ ...SCENE, title: 'First' }, null, 2);
const SECOND_SOURCE = JSON.stringify({ ...SCENE, title: 'Second' }, null, 2);

/** A clipboard fragment, as a Copy in another window leaves one. */
const FRAGMENT = JSON.stringify({
  version: 1,
  elements: [{ id: 'pasted', type: 'rectangle', x: 300, y: 380, width: 80, height: 60 }],
});

/** The page fills the window with the editor, so `VIEW`'s page points hold. */
const FULL = 'body { margin: 0 } esbozo-editor { height: 100vh }';

/** The two-instance page: a half each, so both are on screen at once. */
const HALVES = 'body { margin: 0 } esbozo-editor { height: 50vh }';

/** The view an editor filling a 1280×400 half lands in: `VIEW`, 300px shorter. */
const HALF: View = { zoom: 1, panX: 470, panY: 100 };

/** A part of the page where the Scene's ink is. */
const BOX_A: Rect = { x: 510, y: 340, width: 120, height: 80 };
/** Clear paper: a rectangle drawn here would show. */
const PAPER: Rect = { x: 700, y: 500, width: 120, height: 100 };
/** The page inside the ring a focused canvas draws, for shots of the drawing alone. */
const DRAWING: Rect = { x: 24, y: 24, width: 1232, height: 752 };
/** Below `LABEL_SCENE`'s box: where only words the wide font wrapped reach. */
const UNDER_LABEL: Rect = { x: 500, y: 420, width: 260, height: 120 };
/** The box and the words in it: every line the label breaks into. */
const THE_LABEL: Rect = { x: 500, y: 350, width: 300, height: 200 };
/**
 * Inside the lower half of `LABEL_SCENE`'s box: the lines the wide file's extra
 * wrap puts there, and Kalam's shorter wrap leaves bare.
 */
const LABEL_LOW: Rect = { x: 560, y: 408, width: 170, height: 26 };
/** Where `SNAPPED_SCENE` draws on the bordered page: the whole drawing and nothing else. */
const BORDERED_INK: Rect = { x: 300, y: 200, width: 680, height: 400 };

/** Where `WORDS_SCENE`'s Text draws in a full-window editor: its ink and nothing else. */
const WORDS: Rect = { x: 520, y: 480, width: 240, height: 60 };
/** The same Text, in the upper and the lower half of the two-element page. */
const WORDS_ONE: Rect = { x: 520, y: 280, width: 240, height: 50 };
const WORDS_TWO: Rect = { x: 520, y: 680, width: 240, height: 50 };
/** Bare Grid in the upper and the lower half of the two-element page. */
const DOTS_ONE: Rect = { x: 200, y: 100, width: 120, height: 100 };
const DOTS_TWO: Rect = { x: 200, y: 500, width: 120, height: 100 };

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

test('a font the page swaps is measured again for the words already on the page', async ({
  app,
  browser,
  screen,
}) => {
  const embed = await startEmbed(await bundleFolder(), { l: LABEL_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/label-kalam.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const kalam = await shot(ui);
    const thin = kalam.darkCount(THE_LABEL, 0.6);
    const thinBelow = kalam.darkCount(UNDER_LABEL, 0.6);

    // The page names the wide file. The same box, drawn again: its words are
    // measured with the new file and break into the lines that file gives them.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    await settle(ui);
    const swapped = await shot(ui);

    // What the page that always named the wide file draws: the ink of the
    // swapped page is that page's ink, not the old lines in a new face.
    await app.open(`${embed.url}/label-wide.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const reference = await shot(ui);
    expect(reference.darkCount(UNDER_LABEL, 0.6)).toBeGreaterThan(0);
    expect(swapped.darkCount(UNDER_LABEL, 0.6)).toBe(
      reference.darkCount(UNDER_LABEL, 0.6),
    );
    expect(swapped.darkCount(THE_LABEL, 0.6)).toBeGreaterThan(reference.darkCount(THE_LABEL, 0.6) * 0.9);
    expect(swapped.darkCount(THE_LABEL, 0.6)).toBeLessThan(reference.darkCount(THE_LABEL, 0.6) * 1.1);
    // And the two files draw differently, or none of this says anything.
    expect(reference.darkCount(UNDER_LABEL, 0.6)).toBeGreaterThan(thinBelow);
    expect(thin).toBeGreaterThan(0);
  } finally {
    await embed.stop();
  }
});

test('a font that lands while an Element is being moved redraws it before the release', async ({
  app,
  browser,
  screen,
}) => {
  const embed = await startEmbed(await bundleFolder(), { l: LABEL_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    /** The ink a region of the page shows, or a loud failure: the drawing is there. */
    const inkOf = async (region: Rect): Promise<Rect> => {
      const found = (await shot(ui)).darkBounds(region, 0.6);
      if (found === null) {
        throw new Error('the page shows no ink');
      }
      return found;
    };
    /** How much ink the words put in a part of the box. */
    const inkIn = async (region: Rect): Promise<number> => (await shot(ui)).darkCount(region, 0.6);
    /** Where a drawing sits on the page: the middle of the ink it covers. */
    const middle = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

    // The page that always named the wide file: the wrap a late measurement owes.
    await app.open(`${embed.url}/label-wide.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    await settle(ui);
    const wideLow = await inkIn(LABEL_LOW);

    // The same box in Kalam: fewer lines, so a page still holding them is stale.
    await app.open(`${embed.url}/label-kalam.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    await settle(ui);
    const thinLow = await inkIn(LABEL_LOW);
    // And the two files wrap differently, or none of this says anything: the
    // box draws the same ink in its lower half, and only the wide file's words
    // reach it.
    expect(thinLow).toBeGreaterThan(0);
    expect(wideLow).toBeGreaterThan(thinLow * 2);

    // A press inside the box moves it: the gesture carries the drawing the page
    // already had, and the pointer is still down.
    const box = await inkOf(THE_LABEL);
    const grip = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 5) };
    await browser.mouse.move(grip.x, grip.y);
    await browser.mouse.down();
    await browser.mouse.move(grip.x + 40, grip.y + 20);
    await settle(ui);
    const carried = await inkOf(THE_LABEL);
    expect(Math.abs(middle(carried).x - middle(box).x - 40)).toBeLessThanOrEqual(2);
    expect(Math.abs(middle(carried).y - middle(box).y - 20)).toBeLessThanOrEqual(2);

    // The page names the wide file while the pointer is still down. Its words
    // are measured for the movement in flight, not left for the release: the
    // lines it wraps into are on the page now, drawn with the box the pointer
    // carries — the ink the page that always named it draws, 40 and 20 on.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    const carriedLow = { ...LABEL_LOW, x: LABEL_LOW.x + 40, y: LABEL_LOW.y + 20 };
    await expect.poll(() => inkIn(carriedLow)).toBeGreaterThan(wideLow * 0.9);
    // And it is still where the pointer carries it, not back at its own place.
    const redrawn = await inkOf(THE_LABEL);
    expect(Math.abs(middle(redrawn).x - middle(carried).x)).toBeLessThanOrEqual(2);
    expect(Math.abs(middle(redrawn).y - middle(carried).y)).toBeLessThanOrEqual(2);

    await browser.mouse.up();
    await settle(ui);
    // The release adds nothing to the words: the wide file's wrap was already
    // the drawing when the file landed.
    expect(await inkIn(carriedLow)).toBeGreaterThan(wideLow * 0.9);
  } finally {
    await embed.stop();
  }
});

test('a Scene the page lets go of leaves no ink of its own while the next is read', async ({
  app,
  browser,
  screen,
}) => {
  const embed = await startEmbed(await bundleFolder(), { a: SCENE_SOURCE, b: EMPTY_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect((await shot(ui)).darkCount(BOX_A, 0.6)).toBeGreaterThan(0);

    // The page names another Scene, and its answer is held: until it lands, the
    // page holds no Scene at all, so it shows none of the one it let go of.
    embed.hold('/api/b');
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('scene', 'api/b');
      return true;
    });
    await settle(ui);
    expect((await shot(ui)).darkCount(BOX_A, 0.6)).toBe(0);

    // The Scene that lands is the one the page names: still bare paper.
    embed.release('/api/b');
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect((await shot(ui)).darkCount(BOX_A, 0.6)).toBe(0);
  } finally {
    await embed.stop();
  }
});

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
    expect(afterTools.meanLuminance(DRAWING)).toBe(opened.meanLuminance(DRAWING));

    // A selection and three nudges: selecting is allowed, moving is not, so the
    // drawing after the nudge is the drawing the selection landed on.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    const selected = await shot(ui);
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect((await shot(ui)).meanLuminance(DRAWING)).toBe(selected.meanLuminance(DRAWING));

    // The Style menu is a door into the Scene as well: its controls are refused
    // the same way, with the selection left exactly as it was.
    await screen.getByRole('button', { name: 'Corners: sharp' }).click();
    await settle(ui);
    expect((await shot(ui)).meanLuminance(DRAWING)).toBe(selected.meanLuminance(DRAWING));

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

    // Neither does another font reopen the question: the refusal was this URL's,
    // and it is still this page's.
    const put = embed.puts('/api/a');
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    await settle(ui);
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect(embed.puts('/api/a')).toBe(put);
    await expect(screen.getByText('read-only')).toBeVisible();
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

test('a paste the clipboard answers late lands in no Scene at all', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { a: FIRST_SOURCE, b: SECOND_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The clipboard takes its time: the palette's Paste asks it, and waits.
    await browser.evaluate(() => {
      const held: { answer?: (text: string) => void } = {};
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          readText: () =>
            new Promise<string>((resolve) => {
              held.answer = resolve;
            }),
          writeText: async () => undefined,
        },
      });
      (window as unknown as { held: typeof held }).held = held;
      return true;
    });
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('q');
    await browser.keyboard.type('paste');
    await browser.keyboard.press('Enter');
    await settle(ui);

    // The page names another Scene while the clipboard is still answering.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('scene', 'api/b');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The answer arrives now. It is a fragment of the Scene the page left, so it
    // lands nowhere: no Element, no write, and no word about it either.
    await browser.evaluate((text) => {
      const held = (window as unknown as { held: { answer?: (text: string) => void } }).held;
      held.answer?.(text);
      return true;
    }, FRAGMENT);
    await settle(ui);
    expect(embed.puts('/api/a')).toBe(0);
    expect(embed.puts('/api/b')).toBe(0);
    expect(await embed.saved('a')).toBe(FIRST_SOURCE);
    expect(await embed.saved('b')).toBe(SECOND_SOURCE);
    await expect(screen.getByRole('status')).toHaveText('saved');
  } finally {
    await embed.stop();
  }
});

test('the same file name in another folder is another Scene', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), {
    'first.json': FIRST_SOURCE,
    'other/first.json': SECOND_SOURCE,
  });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/same-name.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // Another `scene` URL that ends in the same file name: the Scene it names is
    // the one at that URL, so it is read, not the one already in hand.
    await browser.evaluate(() => {
      const element = (window as unknown as { live: Element }).live;
      element.setAttribute('scene', 'other/first.json');
      element.setAttribute('save', 'other/first.json');
      return true;
    });
    await expect.poll(() => embed.requests('/other/first.json')).toBe(1);
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect((JSON.parse(await embed.saved('other/first.json')) as { title: string }).title).toBe(
      'Second',
    );

    // What it saves is the Scene it read, and the first folder's file is untouched.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('other/first.json')).toBe(1);
    expect(xOf(await embed.saved('other/first.json'), 'a')).toBe(50);
    expect(embed.writes('first.json')).toBe(0);
    expect(await embed.saved('first.json')).toBe(FIRST_SOURCE);
  } finally {
    await embed.stop();
  }
});

test('an edit queued for one Scene is written to it, and a slow read takes no edit', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A write is on its way to `a` and its answer is held; the read of `b` is
    // held too, so the page is between the two when the next edit is made.
    embed.hold('/api/a');
    embed.hold('/api/b');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.puts('/api/a')).toBe(1);
    await browser.evaluate(() => {
      const element = document.querySelector('esbozo-editor')!;
      element.setAttribute('scene', 'api/b');
      element.setAttribute('save', 'api/b');
      return true;
    });

    // Nothing is open, so an edit belongs to no Scene: it is not written to the
    // Scene on its way in, nor to the one the page left.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);
    expect(embed.puts('/api/b')).toBe(0);

    // The held write lands where it was made: `a`, the Scene it was an edit to.
    embed.release('/api/a');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);

    // `b` opens on its own bytes, without the nudge that was refused.
    embed.release('/api/b');
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(xOf(await embed.saved('b'), 'a')).toBe(40);

    // An edit made once it is open goes there, and only there.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('b')).toBe(1);
    expect(xOf(await embed.saved('b'), 'a')).toBe(50);
    expect(xOf(await embed.saved('a'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('a drag begun on the Scene in hand settles nothing in the next one', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A rectangle is being dragged: pressed and moved, not yet released.
    await screen.getByRole('button', 'Rectangle').click();
    const from = { x: PAPER.x, y: PAPER.y };
    await browser.mouse.move(from.x, from.y);
    await browser.mouse.down();
    await browser.mouse.move(from.x + 60, from.y + 40);
    await browser.mouse.move(from.x + 120, from.y + 80);

    // The page names another Scene before the pointer comes up.
    await browser.evaluate(() => {
      const element = document.querySelector('esbozo-editor')!;
      element.setAttribute('scene', 'api/b');
      element.setAttribute('save', 'api/b');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    await browser.mouse.up();
    await settle(ui);

    // The gesture the old Scene held died with it: the release settles nothing,
    // and the tool it armed is back to Select.
    expect(embed.puts('/api/a')).toBe(0);
    expect(embed.puts('/api/b')).toBe(0);
    expect(await embed.saved('b')).toBe(SCENE_SOURCE);
    await expect(screen.getByRole('button', 'Select')).toHaveAttribute('aria-pressed', 'true');
    expect((await shot(ui)).meanLuminance(PAPER)).toBeGreaterThan(0.85);
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

    // The refusal belonged to the URL the page left: no read-only, and not a
    // word of it in the status line about the Scene on screen now.
    await expect(screen.getByRole('status')).toHaveText('saved');
    await expect(screen.getByText('read-only')).not.toBeVisible();
    expect(embed.writes('a')).toBe(0);
    expect(embed.puts('/api/a')).toBe(1);

    // A refusal for a destination the page no longer writes to says nothing
    // about this one: the next edit is sent, with no holding back. The Scene is
    // the one `a` answered — its bytes, the refused nudge never landed — moved
    // once more.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('b')).toBe(1);
    expect(xOf(await embed.saved('b'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('a write keeps the URL it was queued for when the page moves its base', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The host page moves its base, as a router or a re-render may: from here on
    // every relative URL the page resolves means somewhere else.
    await browser.evaluate(() => {
      const base = document.createElement('base');
      base.href = '/elsewhere/';
      document.head.prepend(base);
      return true;
    });

    // The edit is still written to the URL the element was given, not to the
    // one its attributes would name now.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
    expect(embed.puts('/api/a')).toBe(1);
    expect(embed.requests('/elsewhere/api/a')).toBe(0);
    expect(embed.puts('/elsewhere/api/a')).toBe(0);
  } finally {
    await embed.stop();
  }
});

test('a write still on its way is answered before the next one to that URL is sent', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { a: FIRST_SOURCE, b: SECOND_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // The first write is on its way and its answer is held back.
    embed.hold('/api/a');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.puts('/api/a')).toBe(1);

    // The page names another Scene and keeps the same save URL: another
    // instance of the element, writing to the same destination.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('scene', 'api/b');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await settle(ui);

    // It waits. The write the old instance sent is still unanswered, so this one
    // is not sent at all, and nothing newer can be buried by something older.
    await sleep(400);
    expect(embed.puts('/api/a')).toBe(1);

    // Released, the old write lands first and this one after it: the newest edit
    // is what is on disk, which is what the page says.
    embed.release('/api/a');
    await expect.poll(() => embed.puts('/api/a')).toBe(2);
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
    expect((JSON.parse(await embed.saved('a')) as { title: string }).title).toBe('Second');
    await expect(screen.getByRole('status')).toHaveText('saved');
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

    // Read-only: undo changes nothing, writes nothing, and leaves the Scene and
    // the steps behind it alone.
    const asked = embed.puts('/api/a');
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.removeAttribute('save');
      return true;
    });
    await expect(screen.getByText('read-only')).toBeVisible();
    await browser.keyboard.press('Control+z');
    await browser.keyboard.press('Control+z');
    await settle(ui);
    expect(xOf(await embed.saved('a'), 'a')).toBe(60);
    expect(embed.puts('/api/a')).toBe(asked);

    // Write access comes back: the page reads the Scene it names, so its own
    // history starts there, and one undo takes back its own newest edit.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('save', 'api/a');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(70);
    await browser.keyboard.press('Control+z');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(60);
  } finally {
    await embed.stop();
  }
});

test('a font that is not there is measured again when the page names another', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { w: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/font-fail-words.html`);
    await expect(screen.getByRole('status')).toContainText('cannot load fonts/none.ttf');
    // No measurement, no editor: nothing is drawn on the page at all.
    expect((await shot(ui)).darkCount(WORDS, 0.6)).toBe(0);

    // The page fixes the attribute, and the same element comes back to life.
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/b.ttf');
      return true;
    });
    await expect(screen.getByRole('status')).toHaveText('saved');
    const fixed = (await shot(ui)).darkCount(WORDS, 0.6);
    expect(fixed).toBeGreaterThan(0);

    // And the words are drawn in the file the page names now: the drawing is
    // the one the page that named it from the start makes.
    await app.open(`${embed.url}/words.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const reference = (await shot(ui)).darkCount(WORDS, 0.6);
    expect(fixed).toBeGreaterThan(reference * 0.9);
    expect(fixed).toBeLessThan(reference * 1.1);

    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('w'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('a slow font cannot put its face under a newer measurement', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { w: WORDS_SOURCE });
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

    // The words are drawn and placed with the file the page names now, whichever
    // answer arrived first: the saved SVG is the CLI's drawing of it, and the ink
    // is what the page that always named it draws.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('w')).toBe(1);
    const scene = JSON.parse(await embed.saved('w'));
    expect(await embed.saved('w', 'svg')).toBe(
      await cliRender(scene, join(embed.folder, OTHER_FONT_FILE)),
    );
    const swapped = (await shot(ui)).darkCount(WORDS, 0.6);
    await app.open(`${embed.url}/words.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const reference = (await shot(ui)).darkCount(WORDS, 0.6);
    expect(swapped).toBeGreaterThan(reference * 0.9);
    expect(swapped).toBeLessThan(reference * 1.1);
  } finally {
    await embed.stop();
  }
});

test('a font that will not load does not cancel the Scene on its way', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    // The Scene's read is held, so the page can name another font while its
    // answer is still on its way.
    embed.hold('/api/a');
    await app.open(`${embed.url}/embedded.html`);
    await browser.evaluate(() => {
      document.querySelector('esbozo-editor')!.setAttribute('font', 'fonts/none.ttf');
      return true;
    });

    // The font is the problem, and it is said: the editor keeps the face it had.
    await expect(screen.getByRole('status')).toContainText('cannot load fonts/none.ttf');

    // The Scene still arrives and is the Scene in hand: a font said nothing
    // about the read that was already asked for.
    embed.release('/api/a');
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect((await shot(ui)).darkCount(BOX_A, 0.6)).toBeGreaterThan(0);

    // And it is writable: the edit is saved where the page names it.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(async () => xOf(await embed.saved('a'), 'a')).toBe(50);
  } finally {
    await embed.stop();
  }
});

test('the font is fetched once, and the words are drawn and measured from those bytes', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { w: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/words.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const wide = (await shot(ui)).darkCount(WORDS, 0.6);
    // One request for the file: the face is built from the bytes the words were
    // measured with, so neither a stylesheet nor anything else fetches them again.
    expect(embed.requests('/fonts/b.ttf')).toBe(1);

    // The same Scene in Kalam: one request for it, and visibly less ink, because
    // the wide file's glyphs are solid. One font, drawn twice, would show the same.
    await app.open(`${embed.url}/words-kalam.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    expect(embed.requests('/fonts/Kalam-Regular.ttf')).toBe(1);
    const thin = (await shot(ui)).darkCount(WORDS, 0.6);
    expect(thin).toBeGreaterThan(0);
    expect(wide).toBeGreaterThan(thin * 2);
  } finally {
    await embed.stop();
  }
});

test('a save change while a font is on its way still installs that font', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { w: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/font-swap.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A new font is asked for and does not answer yet; the page then points its
    // writes somewhere else. The font still arrives, and this page is measured
    // and drawn with it, not left on the face it had.
    embed.hold('/fonts/b.ttf');
    await browser.evaluate(() => {
      const element = document.querySelector('esbozo-editor')!;
      element.setAttribute('font', 'fonts/b.ttf');
      element.setAttribute('save', 'api/w2');
      return true;
    });
    embed.release('/fonts/b.ttf');

    // It comes up in that font, and the Scene is written where the page points.
    await expect(screen.getByRole('status')).toHaveText('saved');
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => embed.writes('w2')).toBe(1);
    const scene = JSON.parse(await embed.saved('w2'));
    expect(await embed.saved('w2', 'svg')).toBe(
      await cliRender(scene, join(embed.folder, OTHER_FONT_FILE)),
    );
    const drawn = (await shot(ui)).darkCount(WORDS, 0.6);
    await app.open(`${embed.url}/words.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    const reference = (await shot(ui)).darkCount(WORDS, 0.6);
    expect(drawn).toBeGreaterThan(reference * 0.9);
    expect(drawn).toBeLessThan(reference * 1.1);
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
    // The focus is inside the editor, wherever in it the click landed.
    const inside = await browser.evaluate(
      () => document.activeElement?.closest('esbozo-editor') !== null,
    );
    expect(inside).toBe(true);
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

test('an element the page takes off and puts back takes the keys again', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/scroll.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // A page moves its editor, as a router or a re-render would.
    await browser.evaluate(() => {
      const element = document.querySelector('esbozo-editor')!;
      const parent = element.parentElement!;
      element.remove();
      parent.insertBefore(element, parent.firstChild);
      return true;
    });
    await settle(ui);

    // The click into it is still the editor's: the focus comes with it, and
    // Space and the arrows are the editor's from then on.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    const inside = await browser.evaluate(
      () => document.activeElement?.closest('esbozo-editor') !== null,
    );
    expect(inside).toBe(true);
    const steady = await browser.evaluate(() => window.scrollY);
    await browser.keyboard.press('ArrowDown');
    await settle(ui);
    expect((await browser.evaluate(() => window.scrollY)) - steady).toBeLessThan(10);
  } finally {
    await embed.stop();
  }
});

test('two elements on one page share no font, no Scene, no Grid and no keystroke', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { a: WORDS_SOURCE, b: WORDS_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/two.html`);

    // Each element measured and drew with the file its own attribute names: in
    // the first Kalam's thin hand, in the second a much wider one, so the same
    // words cannot be one font drawn twice. Each file was fetched once.
    await expect(screen.getByRole('status').first()).toHaveText('saved');
    await expect(screen.getByRole('status').nth(1)).toHaveText('saved');
    expect(embed.requests('/fonts/a.ttf')).toBe(1);
    expect(embed.requests('/fonts/b.ttf')).toBe(1);
    const drawn = await shot(ui);
    const thin = drawn.darkCount(WORDS_ONE, 0.6);
    expect(thin).toBeGreaterThan(0);
    expect(drawn.darkCount(WORDS_TWO, 0.6)).toBeGreaterThan(thin * 2);

    // Each element's Grid is its own: the dots one element turns off are still
    // drawn in the other, at the spacing that element has.
    await clickScene(ui, { x: 700, y: 200 }, [], HALF);
    const dots = await shot(ui);
    expect(dots.darkCount(DOTS_ONE, 0.85)).toBeGreaterThan(0);
    const other = dots.darkCount(DOTS_TWO, 0.85);
    expect(other).toBeGreaterThan(0);
    await browser.keyboard.press('g');
    await settle(ui);
    const bare = await shot(ui);
    expect(bare.darkCount(DOTS_ONE, 0.85)).toBe(0);
    expect(bare.darkCount(DOTS_TWO, 0.85)).toBe(other);
    await browser.keyboard.press('g');

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

test('the palette says a PNG cannot be exported here, rather than failing at it', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder());
  try {
    const ui: Ui = { app, browser, screen };
    await app.open(`${embed.url}/embedded.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');

    // Both Export rows are there, greyed out, each saying why: the bundle reads
    // the font's metrics and not its outlines, and the embedding page owns the
    // palette a PNG is drawn in.
    await clickScene(ui, { x: 100, y: 80 }, [], VIEW);
    await browser.keyboard.press('q');
    await browser.keyboard.type('png');
    for (const name of ['Export PNG (light)', 'Export PNG (dark)']) {
      const row = screen.getByRole('option', { name });
      await expect(row).toBeVisible();
      await expect(row).toHaveAttribute('aria-disabled', 'true');
      await expect(row).toContainText('not available in the embedded editor');
    }
  } finally {
    await embed.stop();
  }
});

test('the pointer measures the paper the view draws on, not the host’s border box', async ({ app, browser, screen }) => {
  const embed = await startEmbed(await bundleFolder(), { link: LINK_SOURCE });
  try {
    const ui: Ui = { app, browser, screen };
    // A host draws its own frame around the editor: a 20px border and its own
    // padding. The view fits the paper inside the frame, and the pointer works
    // on that same paper — a click on the ink has to land on the ink.
    await app.open(`${embed.url}/bordered.html`);
    await expect(screen.getByRole('status')).toHaveText('saved');
    await settle(ui);

    // Where the arrow's shaft is drawn, read from the pixels: the Scene's ink
    // is the left box, the right box and the shaft between them, so the ink
    // down the middle of that drawing is the shaft and nothing else. Its centre
    // is a point on the shaft, on ink a person can see.
    const drawing = await shot(ui);
    const ink = drawing.darkBounds(BORDERED_INK, 0.6);
    if (ink === null) {
      throw new Error('the bordered page shows no ink');
    }
    const middle = ink.x + ink.width / 2;
    const shaft = drawing.darkCentre({ x: middle - 2, y: ink.y, width: 5, height: ink.height }, 0.6);
    expect(shaft.count).toBeGreaterThan(0);

    await browser.mouse.move(shaft.x, shaft.y);
    await browser.mouse.down();
    await browser.mouse.up();

    // The arrow is what the click picked, so the note offers its ends, and a
    // nudge moves the arrow itself.
    await expect(screen.getByRole('button', { name: 'Detach: end' })).toBeVisible();
    await browser.keyboard.press('Shift+ArrowRight');
    await expect
      .poll(
        async () =>
          (JSON.parse(await embed.saved('link')) as SavedScene).elements[2]?.points?.[0]?.x,
      )
      .toBe(170);
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
  elements: Array<{ id: string; x?: number; points?: Array<{ x: number; y: number }> }>;
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
    'font-fail-words.html': page(FULL, `<esbozo-editor scene="api/w" save="api/w" font="fonts/none.ttf"></esbozo-editor>`, bundle),
    'font-swap.html': page(FULL, `<esbozo-editor scene="api/w" save="api/w" font="fonts/a.ttf"></esbozo-editor>`, bundle),
    // The same Scene in the wide font, and in Kalam: one page each, so a test
    // can say what the drawing looks like when the file it drew with is known.
    'words.html': page(FULL, `<esbozo-editor scene="api/w" save="api/w" font="fonts/b.ttf"></esbozo-editor>`, bundle),
    'words-kalam.html': page(FULL, `<esbozo-editor scene="api/w" save="api/w" font="${FONT}"></esbozo-editor>`, bundle),
    // Two files with the same name in two folders: one Scene each, named alike.
    'same-name.html': page(
      FULL,
      `<script type="module" src="${bundle}"></script>
<script type="module">
  const element = document.createElement('esbozo-editor');
  element.setAttribute('scene', 'api/first.json');
  element.setAttribute('save', 'api/first.json');
  element.setAttribute('font', '${FONT}');
  document.body.append(element);
  window.live = element;
</script>`,
      null,
    ),
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
    'label-kalam.html': page(FULL, `<esbozo-editor scene="api/l" save="api/l" font="${FONT}"></esbozo-editor>`, bundle),
    'label-wide.html': page(FULL, `<esbozo-editor scene="api/l" save="api/l" font="fonts/b.ttf"></esbozo-editor>`, bundle),
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
    // The host frames the editor: a border and padding of its own, so the
    // element's box is not the paper the Scene is drawn on.
    'bordered.html': page(
      `body { margin: 0 } esbozo-editor { height: 100vh; border: 20px solid #333; padding: 12px }`,
      `<esbozo-editor scene="api/link" save="api/link" font="${FONT}"></esbozo-editor>`,
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
    await writeFile(join(saved, fileOf(name)), source, 'utf8');
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
    const scene = sceneKeyOf(path);
    if (scene !== undefined) {
      await handleScene(scene, request, response);
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
    const body = join(saved, fileOf(name));
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
      return readFile(join(saved, extension === 'json' ? fileOf(name) : `${fileOf(name)}.${extension}`), 'utf8');
    },
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const json = 'application/json; charset=utf-8';

/**
 * The Scene a path names: `/api/a` is `a`, and a Scene in a second folder keeps
 * its folder in the key, so two folders may hold a file of the same name.
 */
function sceneKeyOf(path: string): string | undefined {
  const match = /^\/([\w-]+)\/([\w.-]+)$/.exec(path);
  if (match === null) {
    return undefined;
  }
  const [, folder, name] = match;
  if (folder === undefined || name === undefined) {
    return undefined;
  }
  return folder === 'api' ? name : `${folder}/${name}`;
}

/** The file a Scene key lives in, one flat name per key. */
function fileOf(key: string): string {
  return key.replaceAll('/', '-');
}

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
