/** Scene fixtures, page regions and input helpers shared by the editor suites. */
import { expect } from 'e2e';
import { MIXED_SCENE, SCENE, THREE_SCENE } from './helpers.ts';
import type { Ui } from './helpers.ts';
import type { Rect } from './pixels.ts';

export const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
export const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

export const THREE_SOURCE = JSON.stringify(THREE_SCENE, null, 2);

/** Bare paper wide enough for the dot Grid to show its dots. */
export const GRID: Rect = { x: 850, y: 500, width: 200, height: 150 };

/** Empty canvas in the top right corner, where only paper and Grid show. */
export const CORNER: Rect = { x: 950, y: 100, width: 100, height: 100 };

/**
 * One control of the Style menu, by the name it gives itself: the row's name
 * and the value's, so a test asks for the button a person clicks and never for
 * the markup around it. A control that is not offered has no such button.
 */
export function control(ui: Ui, name: string) {
  return ui.screen.getByRole('button', { name });
}

/** The percentage shown by the zoom readout. */
export function zoomReadout(ui: Ui) {
  return ui.screen.getByText(/^\d+%$/);
}

/**
 * The strip is drawn at the ink a person sees, its fade to full ink finished.
 *
 * A tile taking the focus or the pointer fades the strip from 0.58 to 1 over
 * 0.22 s, and a screenshot taken during that fade holds the tiles' ink while the
 * thin pencil outline around them is still too pale to pass an ink threshold: the
 * same strip reads 26 px down instead of 8 px. The opacity is the page's own
 * answer to when the fade is over, so a starved machine waits as long as it
 * takes; a stopwatch would be this machine's guess, and CI outlasted it.
 */
export async function fullInk(ui: Ui): Promise<void> {
  await expect
    .poll(
      () =>
        ui.browser.evaluate(() => {
          const strip = document.querySelector('esbozo-editor nav[aria-label="Tools"]');
          return strip === null ? 0 : Number(getComputedStyle(strip).opacity);
        }),
      { timeout: 5000 },
    )
    .toBe(1);
}

// --------------------------------------------------------------- the palette

/**
 * Where the focus a note hands back went: the canvas it belongs to, the
 * palette's search field while the palette holds it, or somewhere else.
 */
export function focusOn(ui: Ui): Promise<'canvas' | 'search' | 'other'> {
  return ui.browser.evaluate(() => {
    const active = document.activeElement;
    if (active === document.querySelector('.canvas')) {
      return 'canvas';
    }
    return active === document.querySelector('.palette input') ? 'search' : 'other';
  });
}

/** A command palette row, by the name and the shortcut the row shows. */
export function command(ui: Ui, name: string | RegExp) {
  return ui.screen.getByRole('option', { name });
}

/** Open the palette the way the rail's left hand does. */
export async function palette(ui: Ui): Promise<void> {
  await ui.browser.keyboard.press('q');
  await expect(ui.screen.getByRole('dialog', 'Commands')).toBeVisible();
}
