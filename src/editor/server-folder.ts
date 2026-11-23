/**
 * The served folder: the save API in `src/serve.ts` seen through the same seam
 * as a picked File System Access folder.
 *
 * A page served as files has no server to ask, so `servedFolder()` returns `null`
 * and the editor keeps its folder picker. Under `ez serve` it answers with the
 * folder, and the editor lists, opens and autosaves over http without a picker.
 */
import type { SceneFolder } from './files.js';
import { listingOf, Refusal, sceneApiPath, SCENES_API } from '../scenes-api.js';
import type { SceneListing } from '../scenes-api.js';

/**
 * The folder this page is served from, or `null` when nothing is serving one.
 * `null` is exactly the page-served-as-files case, which answers 404; every
 * other failure is thrown, so the status line can say what the server said.
 */
export async function servedFolder(): Promise<SceneFolder | null> {
  const listing = await askListing();
  if (listing === null) {
    return null;
  }

  return {
    name: listing.folder,
    readOnly: listing.readOnly,

    // Asked every time, so a Scene made in this page is in the next list.
    async listScenes(): Promise<string[]> {
      const listed = await askListing();
      if (listed === null) {
        throw new Error('the server stopped listing this folder');
      }
      return [...listed.scenes];
    },

    async read(name: string): Promise<string | null> {
      const response = await ask(sceneApiPath(name));
      if (response.status === 404) {
        return null;
      }
      return textOf(response, name);
    },

    async write(name: string, scene: string, svg: string): Promise<void> {
      await textOf(await ask(sceneApiPath(name), { scene, svg }), name);
    },
  };
}

/**
 * The folder's name, its Scenes and whether it refuses writes; `null` only when
 * the API is not there at all, which is what a page without a server answers.
 */
async function askListing(): Promise<SceneListing | null> {
  const response = await ask(SCENES_API);
  if (response.status === 404) {
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Refusal(text, response.status, 'the served folder');
  }
  const listed = listingOf(text);
  if (listed === null) {
    throw new Error(`${SCENES_API} did not answer with a folder`);
  }
  return listed;
}

/** One request to the save API. A server that is not there is an error, not a folder. */
async function ask(path: string, body?: unknown): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method: 'GET', headers: { accept: 'application/json' } }
      : {
          method: 'PUT',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
  try {
    return await fetch(path, init);
  } catch (error) {
    throw new Error(`cannot reach the server that serves this page: ${(error as Error).message}`);
  }
}

/**
 * The response body as text, or the server's own words when it refused. A
 * `Refusal` carries the status, so a `403` makes the page read-only here as it
 * does for a picked folder.
 */
async function textOf(response: Response, what: string): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new Refusal(text, response.status, what);
  }
  return text;
}
