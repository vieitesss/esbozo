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

/** The one Scene behind `endpoints`, as the editor's storage seam. */
export function sceneFolder(endpoints: SceneEndpoints): SceneFolder {
  const name = fileNameOf(endpoints.scene);
  const save = endpoints.save;
  return {
    // The Scene's own host, so the status line says where what it shows came from.
    name: hostOf(endpoints.scene),
    readOnly: save === null,

    async listScenes(): Promise<string[]> {
      return [name];
    },

    async read(): Promise<string | null> {
      const response = await ask(endpoints.scene, { method: 'GET', headers: { accept: 'application/json' } });
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

    async write(_name: string, scene: string, svg: string): Promise<void> {
      if (save === null) {
        return;
      }
      const body: SceneWrite = { scene, svg };
      const response = await ask(save, {
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
  return last === undefined ? 'scene.json' : decodeName(last);
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
