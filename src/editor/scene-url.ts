/**
 * One Scene at two URLs, seen through the same seam as a folder of Scenes.
 *
 * The bundle's page is not esbozo's page: it has no folder to list and no File
 * System Access handle. It has a URL that answers a Scene (the element's `scene`
 * attribute) and, when the page may save, a URL that takes the write `ez serve`'s
 * API takes (its `save` attribute). This is the third implementation of
 * `SceneFolder` — after a picked folder and a served one — so the editor's
 * autosave needs no branch for it: every change is written, read-only is a
 * folder that refuses, and a failure is the server's words in the status line.
 *
 * The folder holds exactly this one Scene, so listing it answers that one name
 * and every write is the same URL: a page with one Scene has nowhere else to
 * put another.
 */
import type { SceneFolder } from './files.js';
import { Refusal } from '../scenes-api.js';
import type { SceneWrite } from '../scenes-api.js';

/** The two URLs the element's attributes name: where the Scene is read, and where it is written. */
export interface SceneEndpoints {
  /** A URL a GET answers the Scene's source on. */
  readonly scene: string;
  /** A URL a PUT takes `{ scene, svg }` on, or `null` when the page may only read. */
  readonly save: string | null;
}

/**
 * The one Scene behind `endpoints`, as the editor's storage seam.
 *
 * The endpoints are a snapshot, taken when the element makes the folder: a
 * `scene` or `save` that changes afterwards is another instance of the element
 * with a folder of its own, so a write can never be aimed at a URL it was not
 * made for, and the Scene is identified by its full URL rather than by a file
 * name two folders may share.
 */
export function sceneFolder(endpoints: SceneEndpoints): SceneFolder {
  return {
    // The Scene's own host, so the status line says where what it shows came from.
    get name(): string {
      return hostOf(endpoints.scene);
    },
    get readOnly(): boolean {
      return endpoints.save === null;
    },

    async listScenes(): Promise<string[]> {
      return [fileNameOf(endpoints.scene)];
    },

    async read(): Promise<string | null> {
      const { scene } = endpoints;
      const name = fileNameOf(scene);
      const response = await ask(scene, { method: 'GET', headers: { accept: 'application/json' } });
      if (response.status === 404) {
        // Not there yet: the editor opens an empty Scene and writes nothing
        // until the first edit.
        return null;
      }
      const text = await response.text();
      if (!response.ok) {
        throw new Refusal(text, response.status, name);
      }
      return text;
    },

    async write(name: string, scene: string, svg: string): Promise<void> {
      const { save } = endpoints;
      if (save === null) {
        // The editor asks `readOnly` before it writes, so this is the page
        // being told to write where nothing may be written.
        throw new Error('this page has no save URL: it may only read');
      }
      const body: SceneWrite = { scene, svg };
      const response = await writeOnce(save, {
        method: 'PUT',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // `403` is the server saying this page may only read: the editor stops
        // writing and blocks every edit, rather than trying again per change.
        throw new Refusal(await response.text(), response.status, name);
      }
    },
  };
}

/**
 * The writes in flight to one destination, by URL: the whole page shares it, so
 * two elements — or the same element after a `scene` or a `save` change — never
 * have two writes to one URL in the air at once.
 *
 * This is what keeps an old snapshot from landing on top of a new one. A write
 * that was queued before a rebuild is still a person's edit to the Scene it was
 * made for, and it finishes first: the write the new instance sends waits for it
 * to answer, so the bytes on disk are always the newest ones the page has, and
 * `saved` is never a claim an older write can bury.
 */
const writes = new Map<string, Promise<unknown>>();

/** One write, sent once every write to the same URL that came before it answered. */
async function writeOnce(url: string, init: RequestInit): Promise<Response> {
  const before = writes.get(url) ?? Promise.resolve();
  // A refusal is the last write's answer, not this one's: the queue goes on.
  const sending = before.then(
    () => ask(url, init),
    () => ask(url, init),
  );
  const settled = sending.then(
    () => undefined,
    () => undefined,
  );
  writes.set(url, settled);
  // Nothing is left holding a destination nobody is writing to any more.
  void settled.then(() => {
    if (writes.get(url) === settled) {
      writes.delete(url);
    }
  });
  return sending;
}

/** One request, with a server that is not there reported as the problem it is. */
async function ask(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    throw new Error(`cannot reach ${url}: ${(error as Error).message}`);
  }
}

/** The Scene's file name, as the status line names it: the last segment of the URL. */
function fileNameOf(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const last = path.split('/').filter((segment) => segment !== '').pop();
  return last === undefined ? 'scene.esbozo' : decodeName(last);
}

function decodeName(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The host the Scene comes from, so an embedded editor can say where it read it. */
function hostOf(url: string): string {
  try {
    return new URL(url, document.baseURI).host;
  } catch {
    return '';
  }
}
