/**
 * Seam 2: the Scenes note's opens — the last one a person asks for is the one
 * the page holds. Two opens share one connection, so a read that answers for
 * the open before it is dropped where it lands, whatever it says: it never
 * replaces the Scene in hand, never moves the target of the next edit, and
 * never speaks in the status line.
 *
 * Each test holds one read in the stubbed folder, so the page can move on while
 * the first Scene is still on its way, and answers it afterwards the way a real
 * disk would: with its bytes, or with a failure.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { SCENE, clickScene, savedFiles, savedScene, settle } from './helpers.ts';
import type { Folders, Ui } from './helpers.ts';
import { shot } from './pixels.ts';
import type { Rect } from './pixels.ts';

/** The Scene `b.json` holds: the boxes every editor suite seeds. */
const B_SOURCE = JSON.stringify(SCENE, null, 2);

/** The Scene `c.json` holds: the same boxes, and one more inside their bounds. */
const C_SCENE = {
  version: 1,
  title: 'Three boxes',
  defaults: { roughness: 1 },
  elements: [
    ...SCENE.elements,
    {
      id: 'c',
      type: 'rectangle',
      x: 110,
      y: 130,
      width: 40,
      height: 25,
      fill: { kind: 'solid', grey: 4 },
    },
  ],
};
const C_SOURCE = JSON.stringify(C_SCENE, null, 2);

/**
 * The middle of `c`, which only `c.json` draws: solid grey where `b.json` has
 * bare paper. It sits inside the bounds both Scenes share, so both are fitted
 * into the same view and one page point says which of them is on the page.
 */
const C_BOX: Rect = { x: 590, y: 436, width: 20, height: 14 };

/** A folder handle's file, as the stub hands it over. */
interface GateFile {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ size: number; text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** A folder handle, as the stub hands it over. */
interface GateFolder {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterableIterator<{ kind: string; name: string }>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<GateFile>;
}

/** What the wrapped picker adds to the stub: one file whose read waits for the test. */
interface Holds {
  /** The file whose next read waits, or null when every read answers at once. */
  name: string | null;
  /** The reads waiting to be answered, oldest first. */
  answers: Array<{ land: () => void; refuse: (message: string) => void }>;
}

interface GateWindow {
  showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<GateFolder>;
  __esbozoFolders: Folders;
  __esbozoPicks: string[];
  __esbozoHolds: Holds;
}

/**
 * Open the built page on stubbed folders, with a folder picker that can hold one
 * file's read. Everything else — the note's listing, every other Scene — answers
 * at once, as the stub does on its own.
 */
async function openPage(ui: Ui, folders: Folders): Promise<void> {
  await ui.browser.addInitScript({ path: 'tests/fake-file-system.js' });
  await ui.app.open('/editor.html');
  await ui.browser.evaluate(
    (stub: { folders: Folders; picks: string[] }) => {
      const page = window as unknown as GateWindow;
      page.__esbozoFolders = stub.folders;
      page.__esbozoPicks = stub.picks;
      page.__esbozoHolds = { name: null, answers: [] };
      const pick = page.showDirectoryPicker;
      page.showDirectoryPicker = async (options) => {
        const folder = await pick(options);
        return {
          kind: folder.kind,
          name: folder.name,
          values: () => folder.values(),
          async getFileHandle(fileName, fileOptions) {
            const handle = await folder.getFileHandle(fileName, fileOptions);
            if (fileName !== page.__esbozoHolds.name) {
              return handle;
            }
            return {
              kind: handle.kind,
              name: handle.name,
              createWritable: () => handle.createWritable(),
              getFile: () =>
                new Promise<{ size: number; text(): Promise<string> }>((resolve, reject) => {
                  page.__esbozoHolds.answers.push({
                    land: () => resolve(handle.getFile()),
                    refuse: (message) => reject(new Error(message)),
                  });
                }),
            };
          },
        };
      };
      return true;
    },
    { folders, picks: ['A'] },
  );
  await ui.screen.getByRole('button', /Open folder/).click();
  await expect(ui.screen.getByRole('button', 'b.json')).toBeVisible();
  await expect(ui.screen.getByRole('button', 'c.json')).toBeVisible();
}

/** Hold the next read of `name`: its bytes wait until the test answers them. */
async function holdRead(ui: Ui, name: string): Promise<void> {
  await ui.browser.evaluate((held) => {
    (window as unknown as GateWindow).__esbozoHolds.name = held;
    return true;
  }, name);
}

/** Wait until the page asks for the held bytes, so the read is known to be in flight. */
async function readWaiting(ui: Ui): Promise<void> {
  await expect
    .poll(() =>
      ui.browser.evaluate(
        () => (window as unknown as GateWindow).__esbozoHolds.answers.length,
      ),
    )
    .toBe(1);
}

/** Answer the held read with the file's bytes. */
async function landRead(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as GateWindow).__esbozoHolds.answers.shift()!.land();
    return true;
  });
}

/** Answer the held read with a failure, as a file that cannot be read does. */
async function refuseRead(ui: Ui, message: string): Promise<void> {
  await ui.browser.evaluate((words) => {
    (window as unknown as GateWindow).__esbozoHolds.answers.shift()!.refuse(words);
    return true;
  }, message);
}

test('a Scene read that lands after a later open never replaces it', async ({ app, browser, screen }) => {
  const ui: Ui = { app, browser, screen };
  await openPage(ui, { A: { 'b.json': B_SOURCE, 'c.json': C_SOURCE } });

  // B's read is in flight when the person opens C from the note still in hand.
  await holdRead(ui, 'b.json');
  await screen.getByRole('button', 'b.json').click();
  await readWaiting(ui);
  await screen.getByRole('button', 'c.json').click();

  // C is the Scene in hand: its own box is painted, and the page says saved.
  await expect(screen.getByRole('status')).toHaveText('saved');
  expect((await shot(ui)).meanLuminance(C_BOX)).toBeLessThan(0.7);

  // B's answer lands now, and the two paints below are after it: the answer runs
  // as the page's microtasks, and a frame cannot be painted before those are
  // done. C is still what is drawn.
  await landRead(ui);
  await settle(ui);
  expect((await shot(ui)).meanLuminance(C_BOX)).toBeLessThan(0.7);

  // And the next edit is C's: it goes to c.json, and b.json keeps its bytes.
  await clickScene(ui, { x: 100, y: 80 });
  await browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui, 'c.json');
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(50);
  expect((await savedFiles(ui))['b.json']).toBe(B_SOURCE);
});

test('a Scene read that fails after a later open changes nothing', async ({ app, browser, screen }) => {
  const ui: Ui = { app, browser, screen };
  await openPage(ui, { A: { 'b.json': B_SOURCE, 'c.json': C_SOURCE } });

  await holdRead(ui, 'b.json');
  await screen.getByRole('button', 'b.json').click();
  await readWaiting(ui);
  await screen.getByRole('button', 'c.json').click();
  await expect(screen.getByRole('status')).toHaveText('saved');

  // B's read fails now. The page has moved on, so the failure is not its news:
  // C's status stands, and the two paints below are after the answer landed.
  await refuseRead(ui, 'b.json could not be read');
  await settle(ui);
  await expect(screen.getByRole('status')).toHaveText('saved');

  // The write access C had is C's still: the next edit goes to c.json.
  await clickScene(ui, { x: 100, y: 80 });
  await browser.keyboard.press('Shift+ArrowRight');
  const scene = await savedScene(ui, 'c.json');
  expect(scene.elements.find((element) => element.id === 'a')?.x).toBe(50);
  expect((await savedFiles(ui))['b.json']).toBe(B_SOURCE);
});
