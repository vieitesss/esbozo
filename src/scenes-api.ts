/**
 * The save API the served editor speaks: one path, one listing shape, one write.
 *
 * `src/serve.ts` answers it, `src/editor/server-folder.ts` and the bundle's
 * `src/editor/scene-url.ts` call it, and all three read this module, so the
 * server and the two pages cannot drift. Browser-safe: no node builtins, so the
 * same code bundles into the page.
 */

/** The one prefix the save API answers on. */
export const SCENES_API = '/api/scenes';

/** `GET /api/scenes`: the folder's name, its Scene file names, and whether writes are refused. */
export interface SceneListing {
  readonly folder: string;
  readonly readOnly: boolean;
  readonly scenes: readonly string[];
}

/** The request path of one Scene: `GET` reads it, `PUT` with both texts writes it. */
export function sceneApiPath(name: string): string {
  return `${SCENES_API}/${encodeURIComponent(name)}`;
}

/** A listing as the server sends it, or `null` when the body is not one. */
export function listingOf(body: string): SceneListing | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { folder, readOnly, scenes } = raw as { folder?: unknown; readOnly?: unknown; scenes?: unknown };
  // Every field has to be the type it claims: a `readOnly` that is text, or a
  // name that is not one, is no listing, so the page says the server did not
  // answer instead of showing a folder it cannot trust.
  if (typeof folder !== 'string' || typeof readOnly !== 'boolean' || !Array.isArray(scenes)) {
    return null;
  }
  if (!scenes.every((name): name is string => typeof name === 'string')) {
    return null;
  }
  return { folder, readOnly, scenes };
}

/**
 * The body of a write: the Scene's source and its SVG, both as text. The server
 * stores the two together and the page reads nothing back, so this pair is the
 * whole of what a save says.
 */
export interface SceneWrite {
  readonly scene: string;
  readonly svg: string;
}

/** A write as the server takes it, or `null` when the body is not one. */
export function sceneWrite(body: string): SceneWrite | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { scene, svg } = raw as { scene?: unknown; svg?: unknown };
  if (typeof scene !== 'string' || typeof svg !== 'string') {
    return null;
  }
  return { scene, svg };
}

/**
 * Why a request failed, as the status line says it: the server's own words when
 * it worded a problem, the status and the body when it did not.
 */
export function problemIn(text: string, status: number, what: string): string {
  const written = sceneError(text);
  if (written !== null) {
    return written;
  }
  return `${what}: ${status} ${text}`.trim();
}

/**
 * A refused request, with the status that refused it: a page reads `403` as
 * "this editor may not write any more", so the status the status line shows is
 * also the one the editor acts on.
 */
export class Refusal extends Error {
  readonly status: number;

  constructor(text: string, status: number, what: string) {
    super(problemIn(text, status, what));
    this.name = 'Refusal';
    this.status = status;
  }
}

/** The `error` a refusal carries, or `null` when the body has none worth saying. */
function sceneError(text: string): string | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const error = (raw as { error?: unknown } | null)?.error;
  return typeof error === 'string' && error !== '' ? error : null;
}
