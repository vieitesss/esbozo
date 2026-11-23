/**
 * Seam 2: the Scenes note's opens — the last one a person asks for is the one
 * the page holds. Two opens share one connection, so a read that answers for
 * the open before it is dropped where it lands, whatever it says: it never
 * replaces the Scene in hand, never moves the target of the next edit, and
 * never speaks in the status line.
 *
 * Each test holds one read in the stubbed folder, so the page can move on while
 * the first Scene is still on its way, and answers it afterwards the way a real
 * disk would: with its bytes, or with a failure. Between the two, the Scene in
 * hand is edited with its own write held, so a write lands after the page has
 * already spoken about the Scene it was opening.
 */
import { test } from '@e2e-dev/web';
import { expect } from 'e2e';
import {
  SCENE,
  browseFolder,
  clickScene,
  holdWrites,
  savedFiles,
  savedScene,
  settle,
} from './helpers.ts';
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
  answers: Array<{
    land: () => void;
    refuse: (message: string) => void;
    missing: () => void;
  }>;
  /** True while the next listing of a picked folder waits for the test. */
  listing: boolean;
  /** The listings waiting to be answered, oldest first. */
  listings: Array<{ land: () => void }>;
}

/** A write the stub's gate holds: it lands when the test says so. */
interface Held {
  resolve: () => void;
  reject: (error: Error) => void;
}

interface GateWindow {
  showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<GateFolder>;
  __esbozoFolders: Folders;
  __esbozoPicks: string[];
  __esbozoHolds: Holds;
  __esbozoGates?: Held[];
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
      page.__esbozoHolds = { name: null, answers: [], listing: false, listings: [] };
      const pick = page.showDirectoryPicker;
      page.showDirectoryPicker = async (options) => {
        const folder = await pick(options);
        return {
          kind: folder.kind,
          name: folder.name,
          // A listing a test holds: the folder answers it when the test says so,
          // so the page can be moved on while the Scenes note is still waiting.
          values: () => {
            if (!page.__esbozoHolds.listing) {
              return folder.values();
            }
            page.__esbozoHolds.listing = false;
            return (async function* held(): AsyncIterableIterator<{ kind: string; name: string }> {
              await new Promise<void>((resolve) => {
                page.__esbozoHolds.listings.push({ land: resolve });
              });
              yield* folder.values();
            })();
          },
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
                    missing: () =>
                      reject(
                        Object.assign(new Error(`${fileName} not found`), {
                          name: 'NotFoundError',
                        }),
                      ),
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

/** Answer the held read as a file that is gone, which opens a new Scene. */
async function missRead(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as GateWindow).__esbozoHolds.answers.shift()!.missing();
    return true;
  });
}

/** Hold the next listing of a picked folder: its answer waits until the test lands it. */
async function holdListing(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as GateWindow).__esbozoHolds.listing = true;
    return true;
  });
}

/** Wait until the page asks the folder for its Scenes, so the listing is in flight. */
async function listingWaiting(ui: Ui): Promise<void> {
  await expect
    .poll(() =>
      ui.browser.evaluate(
        () => (window as unknown as GateWindow).__esbozoHolds.listings.length,
      ),
    )
    .toBe(1);
}

/** Answer the held listing, as a folder that was only slow does. */
async function landListing(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as GateWindow).__esbozoHolds.listings.shift()!.land();
    return true;
  });
}

/** Put a Scene in a stubbed folder, as a file the disk gained does. */
async function addScene(ui: Ui, folder: string, name: string): Promise<void> {
  await ui.browser.evaluate(
    (added: { folder: string; name: string; source: string }) => {
      const folders = (window as unknown as { __esbozoFolders: Folders }).__esbozoFolders;
      folders[added.folder] = { ...folders[added.folder], [added.name]: added.source };
      return true;
    },
    { folder, name, source: B_SOURCE },
  );
}

/** Wait until the page asks the disk for the held write, so it is in flight. */
async function writeWaiting(ui: Ui): Promise<void> {
  await expect
    .poll(() =>
      ui.browser.evaluate(() => (window as unknown as GateWindow).__esbozoGates?.length ?? 0),
    )
    .toBeGreaterThan(0);
}

/** Let the held write land, as a disk that was only busy does. */
async function landWrite(ui: Ui): Promise<void> {
  await ui.browser.evaluate(() => {
    (window as unknown as GateWindow).__esbozoGates!.shift()!.resolve();
    return true;
  });
}

/** The `a` box's x, as the folder's bytes hold it: the edit reached the disk. */
async function nudged(ui: Ui, name: string): Promise<number | undefined> {
  const files = await savedFiles(ui);
  const scene = JSON.parse(files[name] ?? '{}') as {
    elements?: Array<{ id: string; x?: number }>;
  };
  return scene.elements?.find((element) => element.id === 'a')?.x;
}

/**
 * Open `a.json`, then start opening `name` from the note and hold its read. With
 * that read in hand the Scene in hand is edited, with its write held too: the
 * write is in flight, and the Scene being opened still owes the page an answer.
 */
async function editWhileReadIsHeld(ui: Ui, folders: Folders, name: string): Promise<void> {
  await openPage(ui, folders);
  await ui.screen.getByRole('button', 'a.json').click();
  await expect(ui.screen.getByRole('status')).toHaveText('saved');

  // The note again, so `name` can be clicked while `a.json` is the Scene in hand.
  await browseFolder(ui, 'A');
  await expect(ui.screen.getByRole('button', name)).toBeVisible();
  await holdRead(ui, name);
  await ui.screen.getByRole('button', name).click();
  await readWaiting(ui);
  // The note is in the way of the canvas, and `a.json` is still the Scene in hand.
  await ui.browser.keyboard.press('Escape');

  await holdWrites(ui, 'a.json');
  await clickScene(ui, { x: 100, y: 80 });
  await ui.browser.keyboard.press('Shift+ArrowRight');
  await writeWaiting(ui);
}

/**
 * Let the held write of `a.json` land, and wait until its completion was
 * processed: its bytes are on disk, and a frame is painted only after the
 * microtasks that carried the answer are done, so a status written for it is
 * already there when this returns.
 */
async function landEdit(ui: Ui): Promise<void> {
  await landWrite(ui);
  await expect.poll(() => nudged(ui, 'a.json')).toBe(50);
  await settle(ui);
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

/**
 * The folder these tests read: `a.json` is the Scene being edited, and the other
 * two names are the ones the note lists so a read can be started.
 */
function folderWith(extra: Record<string, string> = {}): Folders {
  return { A: { 'a.json': B_SOURCE, 'b.json': B_SOURCE, 'c.json': C_SOURCE, ...extra } };
}

test("a Scene whose read fails while an edit's write is held keeps its failure", async ({ app, browser, screen }) => {
  const ui: Ui = { app, browser, screen };
  await editWhileReadIsHeld(ui, folderWith(), 'b.json');

  // B says it cannot be read, while A's edit is still waiting to be written.
  await refuseRead(ui, 'b.json could not be read');
  const failure = 'cannot read b.json: b.json could not be read';
  await expect(screen.getByRole('status')).toHaveText(failure);

  // A's write lands now, and it changes nothing the page says: a write that lands
  // after another Scene spoke is not news about this one.
  await landEdit(ui);
  await expect(screen.getByRole('status')).toHaveText(failure);

  // The write did finish, where it was made: a.json holds the edit, and the
  // Scene whose read failed is untouched.
  expect(await nudged(ui, 'a.json')).toBe(50);
  expect((await savedFiles(ui))['b.json']).toBe(B_SOURCE);
});

test('a listing that lands after the note shut neither reopens it nor shows what it read', async ({
  app,
  browser,
  screen,
}) => {
  const ui: Ui = { app, browser, screen };
  await openPage(ui, folderWith());
  await expect(screen.getByRole('dialog', 'Scene files')).toBeVisible();

  // The person browses the same folder again, and this listing waits: the note
  // is the one already in hand, and it is still the page's while the folder is
  // asked what it holds.
  await holdListing(ui);
  await browseFolder(ui, 'A');
  await listingWaiting(ui);

  // They shut the note, and the folder gains a Scene while its answer is on its
  // way: a listing nobody is waiting for any more.
  await browser.keyboard.press('Escape');
  await expect(screen.getByRole('dialog', 'Scene files')).toBeHidden();
  await addScene(ui, 'A', 'z.json');
  await landListing(ui);
  await settle(ui);

  // The note stays shut: an answer for a note that already left does not open
  // it again, and the list it read is not the list the page holds.
  await expect(screen.getByRole('dialog', 'Scene files')).toBeHidden();
  await expect(screen.getByRole('button', 'z.json')).toBeHidden();
});

test("a Scene that opens new while an edit's write is held keeps its own word", async ({ app, browser, screen }) => {
  const ui: Ui = { app, browser, screen };
  await editWhileReadIsHeld(ui, folderWith(), 'b.json');

  // The file is gone by the time its own read answers, as a Scene deleted
  // between the listing and the open is: the page opens it empty and says so.
  await missRead(ui);
  await expect(screen.getByRole('status')).toHaveText('new Scene');

  await landEdit(ui);
  await expect(screen.getByRole('status')).toHaveText('new Scene');

  expect(await nudged(ui, 'a.json')).toBe(50);
  expect((await savedFiles(ui))['b.json']).toBe(B_SOURCE);
});

test("a Scene that will not parse while an edit's write is held keeps its failure", async ({ app, browser, screen }) => {
  const ui: Ui = { app, browser, screen };
  const broken = '{ this is not a Scene';
  await editWhileReadIsHeld(ui, folderWith({ 'broken.esbozo': broken }), 'broken.esbozo');

  await landRead(ui);
  await expect(screen.getByRole('status')).toContainText('broken.esbozo:');

  await landEdit(ui);
  await expect(screen.getByRole('status')).toContainText('broken.esbozo:');

  expect(await nudged(ui, 'a.json')).toBe(50);
  expect((await savedFiles(ui))['broken.esbozo']).toBe(broken);
});
