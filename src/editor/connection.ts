/**
 * The connection a page's editor runs on: the page's font, the folder of Scenes,
 * the Scene it opened and the writes that Scene's edits become.
 *
 * Everything here answers late — a font, a folder, a read, a write — so every
 * answer is bound to the connection that asked for it. A change of `scene` or
 * `save` makes a new number, and a read, a font or a clipboard answer that
 * arrives for an older one is dropped where it lands, never drawn and never
 * spoken about: the page has moved on, and an answer about the Scene it left is
 * not news. The font has a number of its own, because a font is the drawing's
 * and not the Scene's: a slow font, or a missing one, never speaks for the Scene
 * a connection is opening.
 *
 * Writes are serialised per destination and fixed at the moment they are queued:
 * a `save` that changes afterwards is another connection, and a write already
 * queued is a person's edit to *this* Scene, so it goes where it was made and
 * never to a URL the page names later. A `403` stops the page writing for good:
 * it stops the writes already queued behind it rather than asking again per
 * edit, and everything armed is let go.
 *
 * The bytes are assembled in the frame that is already due, out of what the page
 * holds, so the task that asked for the save — a release, a key press — ends
 * before the file is built and hashed.
 */
import { createLayout } from '../layout.js';
import type { Layout, Metrics } from '../layout.js';
import { emptyScene, parseScene } from '../scene.js';
import type { Scene } from '../scene.js';
import { sceneStem } from '../paths.js';
import { pickFolder } from './files.js';
import type { SceneFolder } from './files.js';
import type { SceneFiles } from './paint.js';

/** Where the open Scene saves: the folder and the name it was opened from. */
export interface SaveTarget {
  readonly folder: SceneFolder;
  readonly name: string;
}

/** What the status line says about the writes. */
type SavedState = 'idle' | 'saving' | 'saved' | 'new' | 'failed';

/**
 * What the connection asks of the editor, and the one place an answer about a
 * Scene becomes the page's Scene again. Every call arrives after the token that
 * asked for it was checked.
 */
interface ConnectionHost {
  /** The element the page's font and its folder are asked about. */
  readonly element: HTMLElement;
  /** The page holds another Scene: show it, and name where it saves. */
  show(scene: Scene, target: SaveTarget): void;
  /** The page holds no Scene any more: half an edit, a selection, a history. */
  forget(): void;
  /** A connection has a Scene to start on: its defaults, a fitted view, one frame. */
  start(): void;
  /** Say what this page may do with the Scene in hand, and drop what it may not. */
  mode(readOnly: boolean): void;
  /** A measurement arrived: every drawing keyed on the last one is stale. */
  measure(): void;
  /** The status line's word for what the writes are doing. */
  status(state: SavedState, detail?: string): void;
  /** List the browsed folder's Scenes in the note. */
  note(): Promise<void>;
  /** The page's folder is the one it serves: the Scenes button lists it. */
  served(): void;
  /** A Scene's file and its SVG, assembled after the frame that is already due. */
  files(scene: Scene): Promise<SceneFiles>;
}

/**
 * The measurement a page's editor runs on, or the reason it has none: the page
 * cannot place a Scene's words without the font's metrics, so it says so
 * instead of showing an editor that cannot draw. `face` puts the face those
 * metrics were read from into the page, called by the element that accepts the
 * measurement, so the drawing and the measuring arrive together.
 */
export type PageFont =
  | { ok: true; layout: Layout; family: string; face?: () => void }
  | { ok: false; problem: string };

/**
 * A page's measurement for one element. Consecutive elements are measured
 * separately, so two editors on one page can draw with two different fonts, and
 * a `font` attribute that changes is measured again.
 */
export type FontSource = (element: HTMLElement) => Promise<PageFont>;

/**
 * Where the editor finds a folder of Scenes when it connects. The served page
 * asks the save API (`servedFolder`); the bundle answers with the one Scene its
 * attributes name (`src/editor/scene-url.ts`). `null` means there is no folder
 * to join, so the page keeps its folder picker.
 */
export type FolderSource = (element: HTMLElement) => Promise<SceneFolder | null>;

/** The frame that is already due: a save waits for it, so the task that asked ends first. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * What measures nothing, for the moment between connecting and reading the
 * page's font. Nothing is painted with it: the element starts drawing once it
 * has the measurement it draws with.
 */
function unmeasured(): Layout {
  const none: Metrics = { advance: () => 0, lineHeight: () => 0, inkCentre: () => 0 };
  return createLayout({ family: '', metrics: none });
}

export class Connection {
  readonly #host: ConnectionHost;
  /** The page's font, as the page gets it: one measurement per element. */
  readonly #fonts: FontSource;
  /** Where a folder of Scenes comes from: `ez serve`'s, or the page's own. */
  readonly #folder: FolderSource;
  /**
   * The page's font, measured: every Text and Label is placed with it. It is
   * empty until the page's font arrives, and nothing is drawn with it before
   * then: the element starts drawing once it has the measurement.
   */
  #font = { layout: unmeasured(), family: '' };
  /** True once the page's font is measured and the editor is drawing. */
  #ready = false;
  /**
   * Which connection the element is on: a change of `scene` or `save` makes a
   * new one, and a read or a write that answers for an older number is dropped,
   * never drawn.
   */
  #token = 0;
  /**
   * Which request for the page's font is the current one. It is a number of its
   * own, because a font is the drawing's, not the Scene's: a font that is slow,
   * or missing, never speaks for the Scene a connection is opening.
   */
  #fontRequest = 0;
  /**
   * Which request to open a Scene is the current one. It is a number of its own,
   * because two opens share a connection: a read that answers for an open a
   * later one superseded is dropped, whatever its connection.
   */
  #openRequest = 0;
  /** The Scene this connection opened, once one is open: where its writes go. */
  #target: SaveTarget | null = null;
  /** True once a save was refused with `403`: this page may not write any more. */
  #refused = false;
  /** The folder the Scenes note lists. Browsing it never moves the save target. */
  #browsed: SceneFolder | null = null;
  /** True when the page is served by `ez serve`, so its folder needs no picker. */
  #served = false;
  /** The writes in order; the number each answers with is whether it landed. */
  #saveQueue: Promise<unknown> = Promise.resolve();

  constructor(fonts: FontSource, folder: FolderSource, host: ConnectionHost) {
    this.#fonts = fonts;
    this.#folder = folder;
    this.#host = host;
  }

  /** The font the page draws with, which a fitted view and every Element are measured against. */
  get layout(): Layout {
    return this.#font.layout;
  }

  /** The family that font is drawn as, which an exported SVG is resolved in. */
  get family(): string {
    return this.#font.family;
  }

  /** True once the page's font is measured and the editor is drawing. */
  get ready(): boolean {
    return this.#ready;
  }

  /** Which connection is in hand: a clipboard answer speaks only for this one. */
  get token(): number {
    return this.#token;
  }

  /** The Scene this page opened, or null before one is open. */
  get target(): SaveTarget | null {
    return this.#target;
  }

  /** The folder the Scenes note lists, or null before the page has one. */
  get browsed(): SceneFolder | null {
    return this.#browsed;
  }

  /** True when the page is served by `ez serve`, so its folder needs no picker. */
  get served(): boolean {
    return this.#served;
  }

  /**
   * Whether this page may change the Scene at all. Every Scene change asks
   * this one question, so read-only is one rule and not one per tool. An editor
   * the page has taken off is no page at all: a blur the removal causes is not a
   * person leaving the words, so nothing they were typing lands there.
   */
  writable(): boolean {
    const target = this.#target;
    return (
      this.#host.element.isConnected &&
      target !== null &&
      !target.folder.readOnly &&
      !this.#refused
    );
  }

  /**
   * Bring the element up on the attributes it names now: the page's font, then
   * the folder and the Scene it holds. The first connect runs this, and so does
   * every change of `scene` or `save`. A font already measured carries a new
   * connection at once, so a change of Scene never waits on the page's font.
   */
  async connect(): Promise<void> {
    const token = ++this.#token;
    if (!this.#ready && !(await this.#readFont())) {
      // No measurement means nothing can be placed: the status line says why.
      return;
    }
    if (token !== this.#token) {
      return;
    }
    this.#host.start();
    await this.#joinFolder(token);
  }

  /** Draw the Scene in hand in the font the page names now: `font` alone, and
   * only the drawing. A font that will not load changes nothing at all. */
  async remeasure(): Promise<void> {
    if (!(await this.#readFont())) {
      return;
    }
    this.#host.start();
  }

  /**
   * Let go of the connection in hand: the Scene it opened, the folder it
   * browsed, the writes it has not landed and any refusal it earned. The read
   * still on its way is dropped where it lands.
   */
  reset(): void {
    this.#token++;
    this.#target = null;
    this.#browsed = null;
    this.#refused = false;
    this.#saveQueue = Promise.resolve();
    this.#host.forget();
  }

  /** Ask for a folder and list the Scenes in it, without moving the save target. */
  async pick(): Promise<void> {
    try {
      const folder = await pickFolder();
      if (folder === null) {
        return;
      }
      this.#browsed = folder;
      await this.#host.note();
    } catch (error) {
      this.#host.status('failed', (error as Error).message);
    }
  }

  /**
   * Open a Scene by name. Writes the current Scene already queued land first,
   * so a reopen reads the edit it just made instead of the bytes before it. A
   * file that is not there is a Scene nobody has drawn yet: it opens empty and
   * says so, and the first edit is what writes it — unless a person asked for
   * it by name, which makes it a Scene there and then. A Scene that will not
   * load leaves nothing writable, so a failed open is never a write.
   *
   * A read is bound to the connection that asked for it and to the open that
   * asked: an answer for a Scene the page has moved away from, or for one a
   * later open has superseded, is dropped, not drawn.
   */
  async open(name: string, options: { create?: boolean } = {}, bound = this.#token): Promise<void> {
    // Every open supersedes the ones before it on this connection: only the
    // newest one may show a Scene, move the target or speak in the status line.
    const request = ++this.#openRequest;
    const folder = this.#browsed;
    if (folder === null) {
      this.#host.status('failed', 'open a folder first');
      return;
    }
    await this.#saveQueue;
    if (!this.#current(bound, request)) {
      return;
    }
    let source: string | null;
    try {
      source = await folder.read(name);
    } catch (error) {
      if (!this.#current(bound, request)) {
        return;
      }
      this.#target = null;
      this.#host.status('failed', `cannot read ${name}: ${(error as Error).message}`);
      return;
    }
    if (!this.#current(bound, request)) {
      return;
    }
    if (source === null) {
      // A new Scene takes its title from the file name: `flow.esbozo` opens as "flow".
      this.#load(emptyScene(sceneStem(name) || 'Scene'), { folder, name });
      if (options.create === true) {
        // A person asked for this name, so it is a Scene now, SVG and all. Only
        // a 404 the page did not ask for waits for its first edit.
        await this.save(emptyScene(sceneStem(name) || 'Scene'));
        return;
      }
      this.#host.status('new');
      return;
    }
    const parsed = parseScene(source);
    if (!parsed.ok) {
      const first = parsed.problems[0];
      const where = first === undefined ? '' : first.elementId === null ? '' : `${first.elementId}: `;
      const message = first === undefined ? 'invalid Scene' : `${where}${first.message}`;
      this.#target = null;
      this.#host.status('failed', `${name}: ${message}`);
      return;
    }
    this.#load(parsed.scene, { folder, name });
    // A read-only folder saved nothing: the status bar says only that.
    this.#host.status(folder.readOnly ? 'idle' : 'saved');
  }

  /**
   * Write the Scene and the SVG beside it, to the Scene they were made for.
   *
   * The destination is fixed here, when the write is queued: a `save` or a
   * `scene` that changes afterwards is another connection, and a write already
   * queued is a person's edit to *this* Scene, so it goes where it was made and
   * never to a URL the page names later. Writes land in order, and the status
   * says `saved` only for the newest one, and only while the Scene it was made
   * for is still the one in hand: a write that lands after the page moved to
   * another Scene says nothing about the Scene it left.
   */
  async save(scene: Scene): Promise<void> {
    const target = this.#target;
    if (target === null || target.folder.readOnly || this.#refused) {
      return;
    }
    this.#host.status('saving');
    const writing = this.#saveQueue.then(() => this.#writeScene(target, scene));
    this.#saveQueue = writing;
    if (await writing && this.#saveQueue === writing && this.#target === target) {
      this.#host.status('saved');
    }
  }

  /**
   * Read the page's font, and take it if it is still the font the page names. A
   * font that will not load leaves the face and the metrics that did, with the
   * reason in the status line: it is never a reason to let go of a Scene.
   */
  async #readFont(): Promise<boolean> {
    const request = ++this.#fontRequest;
    const font = await this.#fontOf();
    if (request !== this.#fontRequest) {
      // A newer request answers for this page: this one is not its font.
      return false;
    }
    if (!font.ok) {
      this.#host.status('failed', font.problem);
      return false;
    }
    this.#adopt(font);
    return true;
  }

  /**
   * Take the measurement: the face those metrics were read from, the metrics,
   * and the editor listening and ready to draw. Nothing is painted here, so a
   * caller can fit the view first.
   */
  #adopt(font: Extract<PageFont, { ok: true }>): void {
    font.face?.();
    this.#font = { layout: font.layout, family: font.family };
    this.#ready = true;
    // Labels break with the measurement: what was drawn with the old one is not
    // the same drawing any more.
    this.#host.measure();
  }

  /**
   * Whether an answer still speaks for this page: the connection it was asked on
   * is the one in hand, and no open has superseded the one that asked.
   */
  #current(bound: number, request: number): boolean {
    return bound === this.#token && request === this.#openRequest;
  }

  /** The page's font, with a source that will not answer reported as the problem it is. */
  async #fontOf(): Promise<PageFont> {
    try {
      return await this.#fonts(this.#host.element);
    } catch (error) {
      return { ok: false, problem: (error as Error).message };
    }
  }

  /**
   * Join the folder the page hands this element: `ez serve`'s, or the single
   * Scene its attributes name. It lists what it holds and opens the first. A
   * static page gets `null` and keeps its Open folder button.
   */
  async #joinFolder(token: number): Promise<void> {
    let folder: SceneFolder | null;
    try {
      folder = await this.#folder(this.#host.element);
    } catch (error) {
      if (token === this.#token) {
        this.#host.status('failed', (error as Error).message);
      }
      return;
    }
    if (token !== this.#token) {
      return;
    }
    if (folder === null) {
      // A page with no folder to join keeps its picker, and has nothing to open.
      return;
    }
    this.#served = true;
    this.#browsed = folder;
    this.#host.served();
    // The folder's own read-only and a refusal earned before this join are the
    // one answer to what the page may do, and the page is told it once.
    this.#host.mode(folder.readOnly || this.#refused);
    let names: string[];
    try {
      names = await folder.listScenes();
    } catch (error) {
      if (token === this.#token) {
        this.#host.status('failed', (error as Error).message);
      }
      return;
    }
    if (token !== this.#token) {
      return;
    }
    // A folder of Scenes opens its first; the bundle's folder holds the one
    // Scene its attributes name, so that is the one it opens.
    const first = names[0];
    if (first === undefined) {
      await this.#host.note();
      return;
    }
    await this.open(first, {}, token);
  }

  /** A Scene to show, and the destination its writes go to from now on. */
  #load(scene: Scene, target: SaveTarget): void {
    this.#target = target;
    this.#host.show(scene, target);
  }

  /** One write of one Scene, assembled after the frame that is already due. */
  async #writeScene(target: SaveTarget, scene: Scene): Promise<boolean> {
    await nextFrame();
    const files = await this.#host.files(scene);
    return this.#write(target, files.json, files.svg);
  }

  /**
   * One write, to the Scene it was queued for. Its answer speaks for this page
   * only: the destination has to be the Scene in hand now, or it is an old
   * connection's answer and changes nothing — no `403` made read-only here, no
   * words about a Scene the page has moved away from.
   */
  async #write(target: SaveTarget, sceneSource: string, svgSource: string): Promise<boolean> {
    if (this.#refused || target.folder.readOnly) {
      // A refusal, or write access that ended, stops the writes already queued
      // behind it: a page that may only read does not ask again per edit.
      return false;
    }
    try {
      await target.folder.write(target.name, sceneSource, svgSource);
      return true;
    } catch (error) {
      if (this.#target !== target) {
        return false;
      }
      if ((error as { status?: unknown }).status === 403) {
        // The server says this page may only read: it stops writing, and stops
        // every edit, rather than trying again per change.
        this.#refused = true;
        this.#host.mode(true);
      }
      this.#host.status('failed', (error as Error).message);
      return false;
    }
  }
}
