
export const SCENES_API = '/api/scenes';

export interface SceneListing {
  readonly folder: string;
  readonly readOnly: boolean;
  readonly scenes: readonly string[];
}

export function sceneApiPath(name: string): string {
  return `${SCENES_API}/${encodeURIComponent(name)}`;
}

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
  if (typeof folder !== 'string' || typeof readOnly !== 'boolean' || !Array.isArray(scenes)) {
    return null;
  }
  if (!scenes.every((name): name is string => typeof name === 'string')) {
    return null;
  }
  return { folder, readOnly, scenes };
}

export interface SceneWrite {
  readonly scene: string;
  readonly svg: string;
}

export function problemIn(text: string, status: number, what: string): string {
  const written = sceneError(text);
  if (written !== null) {
    return written;
  }
  return `${what}: ${status} ${text}`.trim();
}

export class Refusal extends Error {
  readonly status: number;

  constructor(text: string, status: number, what: string) {
    super(problemIn(text, status, what));
    this.name = 'Refusal';
    this.status = status;
  }
}

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
