/**
 * The CDP seam: browser input no DOM event can fake.
 *
 * e2e's `browser` fixture drives the page through roles, pointer and keys, and
 * deliberately hands out no CDP session. The Playwright engine does keep one —
 * `surfaceOf(handle)` — for the owner of the engine handle, and `e2e` loads the
 * config in each worker process (config modules may hold live engine handles
 * that cannot cross IPC), so the handle `e2e.config.ts` builds is the one its
 * tests run under and the same module instance serves both. The config leaves
 * the handle here; a test reads it back through this module.
 *
 * Two contracts need the real browser protocol rather than events a test
 * dispatches by hand:
 *
 * - **IME.** `Input.imeSetComposition` puts unconfirmed words in the field the
 *   way an input method does, with `isComposing` set and no `compositionend`
 *   until the person commits. A synthetic `compositionstart`/`input` sequence
 *   looks the same to a listener, so only this proves what the editor does with
 *   words that were never confirmed.
 * - **A slow machine.** `Emulation.setCPUThrottlingRate` is how a perf budget
 *   is measured against a 4× slower CPU than this one.
 *
 * Driving the page out of band is what the engine documents `surfaceOf` for: the
 * harness stays the notary for what it witnesses, and a test that needs more
 * says so here, once, instead of every test reaching for the page itself.
 */
import { surfaceOf, type PlaywrightLiveSurface } from '@e2e-dev/web/engine';
import type { EngineHandle } from '@e2e-dev/core/engine';
import type { WebFixtures } from '@e2e-dev/web';

/** The slice of a CDP session this module sends on. */
interface Cdp {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

let live: PlaywrightLiveSurface | undefined;
let held: { readonly page: unknown; readonly session: Cdp } | undefined;
/** The words the last `imeCompose` left unconfirmed, for `imeCommit`. */
let composing: string | undefined;

/**
 * Keeps the engine `e2e.config.ts` builds, so a test can reach its live page.
 * Called from the config alone: the handle is the run's, not a test's.
 */
export function keepSurface(engine: EngineHandle<WebFixtures>): void {
  live = surfaceOf(engine);
}

/** The live Playwright page: the same page the fixtures drive, for a test's own setup. */
export function livePage(): ReturnType<PlaywrightLiveSurface['page']> {
  return liveSurface().page();
}

function liveSurface(): PlaywrightLiveSurface {
  if (live === undefined) {
    throw new Error(
      'no CDP surface: e2e.config.ts must pass its web() engine to keepSurface (tests/cdp.ts)',
    );
  }
  return live;
}

/** One session per page, so a test's calls share the browser's own state. */
async function session(): Promise<Cdp> {
  const surface = liveSurface();
  const page = surface.page();
  if (held?.page === page) return held.session;
  const opened = (await surface.context().newCDPSession(page)) as Cdp;
  held = { page, session: opened };
  return opened;
}

/**
 * Types `text` as an input method's preedit: the words are in the field and
 * unconfirmed, exactly as they are while a person still picks a candidate.
 */
export async function imeCompose(text: string): Promise<void> {
  const cdp = await session();
  composing = text;
  await cdp.send('Input.imeSetComposition', {
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
}

/**
 * Confirms the preedit `imeCompose` left, as picking a candidate does: the
 * browser ends the composition and the words become the field's own text.
 */
export async function imeCommit(): Promise<void> {
  if (composing === undefined) {
    throw new Error('imeCommit without imeCompose: there is no preedit to confirm');
  }
  const cdp = await session();
  const text = composing;
  composing = undefined;
  await cdp.send('Input.insertText', { text });
}

/**
 * Runs this page's Chromium at `rate` times slower than the machine's CPU, for
 * the rest of the attempt; `1` puts it back. A perf budget is measured here, so
 * the number the test asserts on is the slow phone's, not this laptop's.
 */
export async function throttleCpu(rate: number): Promise<void> {
  const cdp = await session();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}
