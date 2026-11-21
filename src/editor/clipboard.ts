/**
 * The clipboard, as the named actions use it: Copy, Cut and Paste off the async
 * Clipboard API rather than a clipboard event.
 *
 * The API answers later, and a page can name another Scene while it is still
 * answering, so every call is bound to the connection that asked for it. A copy
 * that lands after the page moved on says nothing about the one it was for; a
 * paste that arrives late lands in no Scene at all; and a cut deletes exactly
 * the Elements it copied, and none of them when the Scene is no longer the one
 * they came from — the write is awaited and the page keeps taking edits while it
 * runs, so what may be deleted is decided after it lands.
 *
 * A page without the API — a non-secure origin has none — says so in the status
 * line instead of offering a command that cannot run.
 */
import { parseFragment, serialiseFragment, serialiseScene } from '../scene.js';
import type { Element as SceneElement, Scene } from '../scene.js';

/**
 * What the commands ask of the editor: the Scene and its selection, the
 * connection they speak for, and the one way an answer becomes an edit.
 */
export interface ClipboardHost {
  /** The Scene in hand. */
  scene(): Scene;
  /** The selected Elements, as the page shows them. */
  selected(): readonly SceneElement[];
  /** The connection this answer speaks for: one that arrives for another lands nowhere. */
  token(): number;
  /** Add the pasted copies, as one step, selected. */
  insert(elements: readonly SceneElement[]): void;
  /** Delete exactly these Elements, as one step. */
  remove(ids: ReadonlySet<string>): void;
  /** The status line's word for words that will not land. */
  status(detail: string): void;
}

/**
 * The async Clipboard API, when the page has one: a non-secure origin has none,
 * and the palette says to use the keys instead of offering a command that
 * cannot run. The cast keeps the check honest: the type says it is always there.
 */
export function clipboardApi(): Clipboard | null {
  return (navigator as Navigator & { clipboard?: Clipboard }).clipboard ?? null;
}

/** The selected Elements as the text a clipboard event carries, or false when there is none. */
export function copyTo(
  data: DataTransfer | null,
  scene: Scene,
  selected: readonly SceneElement[],
): boolean {
  if (selected.length === 0 || data === null) {
    return false;
  }
  data.setData('text/plain', serialiseFragment(scene, selected));
  return true;
}

/** Copy for a named action: the same Scene text a copy event would carry. */
export async function copySelection(host: ClipboardHost): Promise<void> {
  const clipboard = clipboardApi();
  if (clipboard === null) {
    host.status('this page cannot use the clipboard: press ⌘C');
    return;
  }
  const connection = host.token();
  try {
    await clipboard.writeText(serialiseFragment(host.scene(), host.selected()));
  } catch (error) {
    if (connection === host.token()) {
      host.status(`cannot copy: ${(error as Error).message}`);
    }
  }
}

/** Cut for a named action: the same text Copy writes, then the one delete step. */
export async function cutSelection(host: ClipboardHost): Promise<void> {
  const clipboard = clipboardApi();
  if (clipboard === null) {
    host.status('this page cannot use the clipboard: press ⌘X');
    return;
  }
  const selected = host.selected();
  if (selected.length === 0) {
    return;
  }
  const connection = host.token();
  const copied = new Set(selected.map((element) => element.id));
  const scene = host.scene();
  const before = serialiseScene(scene);
  try {
    await clipboard.writeText(serialiseFragment(scene, selected));
  } catch (error) {
    if (connection === host.token()) {
      host.status(`cannot cut: ${(error as Error).message}`);
    }
    return;
  }
  if (connection !== host.token()) {
    // Another instance of the element owns the page now: the ids are its
    // Scene's, not this one's, so nothing is deleted.
    return;
  }
  if (serialiseScene(host.scene()) !== before) {
    host.status('the Scene changed during the cut, so nothing was deleted');
    return;
  }
  host.remove(copied);
}

/** Paste for a named action: the clipboard, read on the spot, landing in the Scene that asked. */
export async function pasteClipboard(host: ClipboardHost): Promise<void> {
  const clipboard = clipboardApi();
  if (clipboard === null) {
    host.status('this page cannot use the clipboard: press ⌘V');
    return;
  }
  const connection = host.token();
  let text: string;
  try {
    text = await clipboard.readText();
  } catch (error) {
    if (connection === host.token()) {
      host.status(`cannot paste: ${(error as Error).message}`);
    }
    return;
  }
  if (connection !== host.token()) {
    return;
  }
  const scene = host.scene();
  host.insert(parseFragment(text, scene.defaults) ?? []);
}
