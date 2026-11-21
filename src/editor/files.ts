/**
 * The editor's only door to the disk: a folder of Scene files, and the Scene
 * files inside it.
 *
 * Autosave means every change writes the Scene and its SVG, so the editor needs
 * the folder and not just one file: the File System Access API can write a
 * sibling only through a directory handle. Picking the folder once keeps every
 * later write prompt-free, which is what "always autosave" needs.
 *
 * A served folder (`server-folder.ts`) implements the same three calls over
 * http, so the editor has one storage seam whichever way it was opened.
 *
 * A Scene file is named `.esbozo` or `.json`. A `.json` name is any other JSON
 * file's too, so the folder lists one only when its bytes are a Scene.
 *
 * A Scene file that is not there reads as `null`, so a new Scene opens empty.
 */
import { sceneExtension, svgFileName } from '../paths.js';
import { parseScene } from '../scene.js';

/** The slice of the File System Access API this module uses. */
interface FileHandleLike {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface DirectoryHandleLike {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterableIterator<{ kind: string; name: string }>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options?: { startIn?: unknown; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
}

export interface SceneFolder {
  readonly name: string;
  /** True when this folder refuses writes, as `ez serve --read-only` does. */
  readonly readOnly: boolean;
  /** Scene file names in the folder, sorted. */
  listScenes(): Promise<string[]>;
  /** The Scene source, or null when the file does not exist yet. */
  read(name: string): Promise<string | null>;
  /** Write the Scene and the SVG beside it, in that order. */
  write(name: string, scene: string, svg: string): Promise<void>;
}

/**
 * Whether this page can open a folder at all: the File System Access API's
 * picker is only there on a secure origin, and a page served as plain files
 * over HTTP has none. A served page can open a folder without one, because its
 * server lists the Scenes; this is the other way in.
 */
export function canPickFolder(): boolean {
  return (
    typeof (window as unknown as DirectoryPickerWindow).showDirectoryPicker === 'function'
  );
}

/** Ask for a folder. Null when the user cancels. */
export async function pickFolder(): Promise<SceneFolder | null> {
  const picker = (window as unknown as DirectoryPickerWindow).showDirectoryPicker;
  if (picker === undefined) {
    throw new Error('this browser has no File System Access API: try Chrome or Edge');
  }
  try {
    const handle = await picker({ mode: 'readwrite' });
    return folderFromHandle(handle);
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      return null;
    }
    throw error;
  }
}

function folderFromHandle(handle: DirectoryHandleLike): SceneFolder {
  return {
    name: handle.name,
    readOnly: false,

    async listScenes(): Promise<string[]> {
      const names: string[] = [];
      for await (const entry of handle.values()) {
        const extension = entry.kind === 'file' ? sceneExtension(entry.name) : null;
        // An `.esbozo` name is this project's own, so it is a Scene whatever it
        // reads; a `.json` name has to parse, or `package.json` would be one.
        if (extension === '.esbozo' || (extension === '.json' && (await readsAsScene(handle, entry.name)))) {
          names.push(entry.name);
        }
      }
      return names.sort((left, right) => left.localeCompare(right));
    },

    async read(name: string): Promise<string | null> {
      let file: { text(): Promise<string> };
      try {
        file = await (await handle.getFileHandle(name)).getFile();
      } catch (error) {
        if (isMissing(error)) {
          return null;
        }
        throw error;
      }
      return file.text();
    },

    async write(name: string, scene: string, svg: string): Promise<void> {
      await writeText(handle, name, scene);
      await writeText(handle, svgFileName(name), svg);
    },
  };
}

/** Whether a folder's file parses as a Scene, so its other JSON can be left out of the list. */
async function readsAsScene(handle: DirectoryHandleLike, name: string): Promise<boolean> {
  let source: string;
  try {
    source = await (await (await handle.getFileHandle(name)).getFile()).text();
  } catch (error) {
    // Gone between the listing and the read: no Scene this list can offer.
    if (isMissing(error)) {
      return false;
    }
    throw error;
  }
  return parseScene(source).ok;
}

async function writeText(handle: DirectoryHandleLike, name: string, text: string): Promise<void> {  const file = await handle.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  try {
    await writable.write(text);
  } finally {
    await writable.close();
  }
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  return name === 'NotFoundError' || name === 'TypeMismatchError';
}
