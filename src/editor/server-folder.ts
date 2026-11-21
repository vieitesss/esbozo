/**
 * The served folder: the save API in `src/serve.ts` seen through the same seam
 * as a picked File System Access folder.
 *
 * A static page has no server to ask, so `servedFolder()` returns `null` and the
 * editor keeps its folder picker. Under `ez serve` it answers with the folder,
 * and the editor lists, opens and autosaves over http without a picker.
 */
import type { SceneFolder } from './files.js';

const API = '/api/scenes';

interface Listing {
  readonly folder: string;
  readonly readOnly: boolean;
  readonly scenes: string[];
}

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
      const response = await ask(scenePath(name));
      if (response.status === 404) {
        return null;
      }
      return textOf(response, name);
    },

    async write(name: string, scene: string, svg: string): Promise<void> {
      await textOf(await ask(scenePath(name), { scene, svg }), name);
    },
  };
}

/**
 * The folder's name, its Scenes and whether it refuses writes; `null` only when
 * the API is not there at all, which is what a page without a server answers.
 */
async function askListing(): Promise<Listing | null> {
  const response = await ask(API);
  if (response.status === 404) {
    return null;
  }
  const text = await response.text();
  if (!response.ok) {
    throw new Error(problemIn(text, response.status, 'the served folder'));
  }
  const listed = listingIn(text);
  if (listed === null) {
    throw new Error(`${API} did not answer with a folder`);
  }
  return listed;
}

/** A listing as the server sends it, or `null` when the body is not one. */
function listingIn(text: string): Listing | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { folder, readOnly, scenes } = raw as { folder?: unknown; readOnly?: unknown; scenes?: unknown };
  if (typeof folder !== 'string' || !Array.isArray(scenes)) {
    return null;
  }
  if (!scenes.every((name): name is string => typeof name === 'string')) {
    return null;
  }
  return { folder, readOnly: readOnly === true, scenes };
}

function scenePath(name: string): string {
  return `${API}/${encodeURIComponent(name)}`;
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

/** The response body as text, or the server's own words when it refused. */
async function textOf(response: Response, what: string): Promise<string> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(problemIn(text, response.status, what));
  }
  return text;
}

function problemIn(text: string, status: number, what: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string' && parsed.error !== '') {
      return parsed.error;
    }
  } catch {
    // Not JSON: fall through to the status line.
  }
  return `${what}: ${status} ${text}`.trim();
}
