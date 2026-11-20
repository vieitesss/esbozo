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

/** The folder this page is served from, or `null` when nothing is serving one. */
export async function servedFolder(): Promise<SceneFolder | null> {
  const listing = await askListing();
  if (listing === null) {
    return null;
  }

  return {
    name: listing.folder,
    readOnly: listing.readOnly === true,

    // Asked every time, so a Scene made in this page is in the next list.
    async listScenes(): Promise<string[]> {
      const listed = await askListing();
      if (listed === null) {
        throw new Error('the server stopped listing this folder');
      }
      return listed.scenes;
    },

    async read(name: string): Promise<string | null> {
      const response = await request('GET', scenePath(name));
      if (response.status === 404) {
        return null;
      }
      return textOf(response, name);
    },

    async write(name: string, scene: string, svg: string): Promise<void> {
      await textOf(await request('PUT', scenePath(name), { scene, svg }), name);
    },
  };
}

/** The folder's name, its Scenes and whether it refuses writes; `null` if unserved. */
async function askListing(): Promise<Listing | null> {
  let response: Response;
  try {
    response = await fetch(API, { headers: { accept: 'application/json' } });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  try {
    const listed = (await response.json()) as Listing;
    if (typeof listed.folder !== 'string' || !Array.isArray(listed.scenes)) {
      return null;
    }
    return { folder: listed.folder, readOnly: listed.readOnly === true, scenes: listed.scenes };
  } catch {
    return null;
  }
}

function scenePath(name: string): string {
  return `${API}/${encodeURIComponent(name)}`;
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const init: RequestInit =
    body === undefined
      ? { method, headers: { accept: 'application/json' } }
      : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  return fetch(path, init);
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
