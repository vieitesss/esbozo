
export const PRIMARY_SCENE_EXTENSION = '.esbozo';

const SCENE_EXTENSIONS = [PRIMARY_SCENE_EXTENSION, '.json'] as const;

type SceneExtension = (typeof SCENE_EXTENSIONS)[number];

function sceneExtension(sceneFileName: string): SceneExtension | null {
  const folded = sceneFileName.toLowerCase();
  return SCENE_EXTENSIONS.find((extension) => folded.endsWith(extension)) ?? null;
}

export function sceneStem(sceneFileName: string): string {
  const extension = sceneExtension(sceneFileName);
  return extension === null ? sceneFileName : sceneFileName.slice(0, -extension.length);
}

export function svgFileName(sceneFileName: string): string {
  return `${sceneStem(sceneFileName)}.svg`;
}

export const DEFAULT_SCENE_FILE_NAME = `scene${PRIMARY_SCENE_EXTENSION}`;

export function sceneFileNameFor(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return DEFAULT_SCENE_FILE_NAME;
  }
  return sceneExtension(trimmed) === null ? `${trimmed}${PRIMARY_SCENE_EXTENSION}` : trimmed;
}

export const MAX_LISTED_SCENE_BYTES = 5 * 1024 * 1024;

export async function listedAsScene(
  sceneFileName: string,
  readsAsScene: (sceneFileName: string) => Promise<boolean>,
): Promise<boolean> {
  const extension = sceneExtension(sceneFileName);
  return extension === '.esbozo' || (extension === '.json' && (await readsAsScene(sceneFileName)));
}
