
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

export function pngFileName(sceneFileName: string, theme: string): string {
  return `${sceneStem(sceneFileName)}.${theme}.png`;
}

/**
 * Why a file name is no Scene name, or null when it is one. The wording is the
 * one a served folder refuses a request with, and the one a listing skips a
 * file by.
 */
export function sceneNameProblem(fileName: string): string | null {
  if (fileName === '') {
    return 'the Scene name is missing';
  }
  if (/[/\\]/.test(fileName)) {
    return `${fileName}: name a Scene in the folder, not a path`;
  }
  if (fileName === '.' || fileName === '..' || fileName.startsWith('.')) {
    return `${fileName}: name a Scene file, not a hidden or relative one`;
  }
  if (sceneExtension(fileName) === null) {
    return `${fileName}: a Scene file ends in ${SCENE_EXTENSIONS.join(' or ')}`;
  }
  return null;
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

/** How a folder lists a file it holds: by its name alone, or by reading it too. */
export type SceneListing = 'always' | 'if-scene' | 'never';

export function sceneListing(sceneFileName: string): SceneListing {
  const extension = sceneExtension(sceneFileName);
  if (extension === PRIMARY_SCENE_EXTENSION) {
    return 'always';
  }
  return extension === '.json' ? 'if-scene' : 'never';
}

export async function listedAsScene(
  sceneFileName: string,
  readsAsScene: (sceneFileName: string) => Promise<boolean>,
): Promise<boolean> {
  const listing = sceneListing(sceneFileName);
  return listing === 'always' || (listing === 'if-scene' && (await readsAsScene(sceneFileName)));
}
