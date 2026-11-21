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
 * - **A still caret.** A blinking caret is caught by a screenshot in either half
 *   of its blink, so a pixel test cannot say where it is; the page draws it still
 *   when the person asked for less motion (`prefers-reduced-motion: reduce`),
 *   and `stillCaret` asks for exactly that.
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
/**
 * The words the last `imeCompose` left unconfirmed, for `imeCommit`. It belongs
 * to the page the compose was sent to, and is dropped when the page changes.
 */
let composing: string | undefined;

/**
 * Marks the page's own composition state on `globalThis`, so `imeCommit` can
 * tell a preedit still open from one the browser ended (a blur ends it).
 * Installed per page, as text: this module is typechecked without the DOM,
 * because `e2e.config.ts` imports it.
 */
const WATCH_COMPOSITION = `(() => {
  globalThis.__esbozoComposition = 'idle';
  const mark = (state) => () => { globalThis.__esbozoComposition = state; };
  document.addEventListener('compositionstart', mark('open'), true);
  document.addEventListener('compositionend', mark('ended'), true);
})()`;

/** What the page made of its own composition events: `open`, `ended`, or neither known. */
async function compositionState(cdp: Cdp): Promise<string> {
  const answer = (await cdp.send('Runtime.evaluate', {
    expression: 'globalThis.__esbozoComposition ?? null',
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  const state = answer.result?.value;
  return typeof state === 'string' ? state : 'unknown';
}

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

/**
 * Takes the focus off the page for real, as the person picking another window
 * does: an input inside an iframe of this page takes it, and the browser blurs
 * this page's window on its own. A test cannot dispatch that event and be
 * believed — a synthesized `blur` reaches the same listener while the browser's
 * own pointer state stays as it was — so a gesture that ends out of sight is
 * proved here. Resolves once the page has really lost the focus.
 */
const TAKE_FOCUS = `new Promise((resolve) => {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-20px;top:-20px;width:1px;height:1px;border:0';
  document.body.append(frame);
  const input = frame.contentDocument.createElement('input');
  frame.contentDocument.body.append(input);
  addEventListener('blur', () => resolve(true), { once: true });
  setTimeout(() => resolve(false), 2000);
  input.focus();
})`;

/**
 * Blurs the page through that iframe, and refuses a page that never let the
 * focus go: the test that follows is about what the editor does when it does.
 */
export async function blurPage(): Promise<void> {
  const cdp = await session();
  const answer = (await cdp.send('Runtime.evaluate', {
    expression: TAKE_FOCUS,
    awaitPromise: true,
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  if (answer.result?.value !== true) {
    throw new Error('the page never lost the focus: nothing to blur');
  }
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
  // A preedit is the page's, not the module's: a new page has none.
  composing = undefined;
  await opened.send('Runtime.evaluate', { expression: WATCH_COMPOSITION });
  return opened;
}

/**
 * Types `text` as an input method's preedit: the words are in the field and
 * unconfirmed, exactly as they are while a person still picks a candidate.
 * `caret` is where the composition's own caret sits in it, which is not always
 * its end: a person reading a preedit can leave it anywhere inside the words
 * being composed.
 */
export async function imeCompose(text: string, caret = text.length): Promise<void> {
  const cdp = await session();
  composing = text;
  await cdp.send('Input.imeSetComposition', {
    text,
    selectionStart: caret,
    selectionEnd: caret,
  });
}

/**
 * Confirms the preedit `imeCompose` left, as picking a candidate does: the
 * browser ends the composition and the words become the field's own text.
 * `chosen` is the word the person picked, when it is not the preedit itself
 * (`にほん` shown, `日本` committed) — the case where reading the field's value
 * while the composition is open gets the words wrong.
 *
 * Precondition: the composition `imeCompose` opened is still open. It has to
 * be, or the words are typed after the composition the editor was reading
 * ended. A composition the browser ended itself (a blur ends one) is refused;
 * one this module could not see — the page navigated, so its marker is gone —
 * is confirmed on this module's own record.
 */
export async function imeCommit(chosen?: string): Promise<void> {
  const cdp = await session();
  if (composing === undefined) {
    throw new Error('imeCommit without imeCompose: there is no preedit to confirm');
  }
  if ((await compositionState(cdp)) === 'ended') {
    composing = undefined;
    throw new Error(
      'imeCommit after the composition ended (a blur ends a composition): there is no preedit to confirm',
    );
  }
  const text = chosen ?? composing;
  composing = undefined;
  await cdp.send('Input.insertText', { text });
}

/**
 * Types `text` into the field as the browser's own input: one commit, no keys,
 * the way a paste or an input method hands words over. Text a person has no key
 * for — the control characters the Scene refuses — arrives no other way.
 */
export async function insertText(text: string): Promise<void> {
  const cdp = await session();
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

/**
 * Stops the caret's blink for the rest of the attempt: the page keeps the caret
 * still when the person asked for less motion, and a still caret is the one
 * picture a pixel test can measure. It is a media query, not an editor setting,
 * so nothing of the page's own state is reached into.
 */
export async function stillCaret(): Promise<void> {
  const cdp = await session();
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}
