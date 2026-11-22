/**
 * One of the editor suites, split by the area of the editor it drives:
 * `tests/editor-*.e2e.ts`.
 *
 * Seam 2: the page itself — the hand font it serves from its own folder, the
 * theme it follows, and the dark it starts in. The judgement is the pixels it
 * paints and the requests it makes, never the stylesheet it read.
 */
import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';
import { openEditor } from './helpers.ts';
import { shot } from './pixels.ts';
import { SCENE_SOURCE, CORNER } from './editor-shared.ts';

test('a font that will not load leaves the page with a visible error', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  // The hand font 404s, so nothing on the page can be measured with it.
  await ui.browser.route('**/fonts/Kalam-Regular.ttf', (route) =>
    route.fulfill({ status: 404, body: 'gone' }),
  );
  await ui.app.open('/editor.html');

  // The page says what it could not load, in its own status line.
  await expect(ui.screen.getByRole('status')).toContainText('cannot load fonts/Kalam-Regular.ttf');

  // And it is still the editor: the tools a person reaches for are there.
  await expect(ui.screen.getByRole('button', /Open folder/)).toBeVisible();
  await ui.browser.unrouteAll();
});

test('the page serves the hand font itself and nothing from a font CDN', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };

  // Watched from before the navigation, so a font request still in flight when
  // the page says it loaded cannot slip past.
  const requested: string[] = [];
  await ui.browser.route('**', async (route) => {
    requested.push(route.request.url);
    await route.continue();
  });
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  // The page fetched the hand font from its own folder. The filter runs inside
  // the poll, on the live list, so a fetch still in flight is waited for.
  await expect
    .poll(() => requested.filter((url) => new URL(url).pathname === '/fonts/Kalam-Regular.ttf').length)
    .toBeGreaterThan(0);
  await ui.browser.evaluate(() => document.fonts.ready.then(() => true));

  // The browser drew the hand font.
  expect(await ui.browser.evaluate(() => document.fonts.check('18px Kalam'))).toBe(true);

  // Every request went to the page's own origin: no font CDN, no other host.
  const page = await ui.browser.evaluate(() => location.origin);
  const origins = [...new Set(requested.map((url) => new URL(url).origin))];
  expect(origins).toEqual([page]);
  await ui.browser.unrouteAll();
});

test('the page follows the system theme after load and its own switch', async ({ app, browser, screen }) => {
  const ui = { app, browser, screen };
  await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

  const light = (await shot(ui)).meanLuminance(CORNER);
  expect(light).toBeGreaterThan(0.85);

  // The system turns dark after the page loaded: the page follows.
  await ui.browser.emulateMedia({ colorScheme: 'dark' });
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeLessThan(0.4);

  // The page's own switch brings it back.
  await ui.screen.getByRole('button', 'Light').click();
  await expect
    .poll(async () => (await shot(ui)).meanLuminance(CORNER))
    .toBeGreaterThan(0.85);
});

describe('a page that starts in system dark', () => {
  test('paints dark and offers the light switch', async ({ app, browser, screen }) => {
    const ui = { app, browser, screen };
    await ui.browser.emulateMedia({ colorScheme: 'dark' });
    await openEditor(ui, { A: { 'scene.json': SCENE_SOURCE } }, 'scene.json');

    // Dark paper on the first frame, and the switch names the theme it gives.
    expect((await shot(ui)).meanLuminance(CORNER)).toBeLessThan(0.4);
    await ui.screen.getByRole('button', 'Light').click();
    await expect
      .poll(async () => (await shot(ui)).meanLuminance(CORNER))
      .toBeGreaterThan(0.85);
  });
});
