/**
 * The save API the served editor speaks: one path, one listing shape.
 *
 * `src/serve.ts` answers it and `src/editor/server-folder.ts` calls it, and both
 * read this module, so the two cannot drift. Browser-safe: no node builtins, so
 * the same code bundles into the page.
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
  if (typeof folder !== 'string' || !Array.isArray(scenes)) {
    return null;
  }
  if (!scenes.every((name): name is string => typeof name === 'string')) {
    return null;
  }
  return { folder, readOnly: readOnly === true, scenes };
}
