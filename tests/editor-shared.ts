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

// --------------------------------------------------------------- the palette

/** A command palette row, by the name and the shortcut the row shows. */
export function command(ui: Ui, name: string | RegExp) {
  return ui.screen.getByRole('option', { name });
}

/** Open the palette the way the rail's left hand does. */
export async function palette(ui: Ui): Promise<void> {
  await ui.browser.keyboard.press('q');
  await expect(ui.screen.getByRole('dialog', 'Commands')).toBeVisible();
}
