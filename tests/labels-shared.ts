/**
 * The Scenes and thresholds the Label suites share: every `tests/labels-*.e2e.ts` reads the
 * same few pages, and one copy of them keeps a test that moves between suites a move and not
 * a rewrite.
 */
import {
  BESIDE_SCENE,
  MIXED_SCENE,
  ROOM_SCENE,
  SCENE,
  WORDS_SCENE,
} from './helpers.ts';
import type { Rect } from './pixels.ts';

export const SCENE_SOURCE = JSON.stringify(SCENE, null, 2);
export const MIXED_SOURCE = JSON.stringify(MIXED_SCENE, null, 2);

export const WORDS_SOURCE = JSON.stringify(WORDS_SCENE, null, 2);
export const ROOM_SOURCE = JSON.stringify(ROOM_SCENE, null, 2);

export const BESIDE_SOURCE = JSON.stringify(BESIDE_SCENE, null, 2);

/** A single word too wide for the box it is typed into. */
export const LONG_WORD = 'antidisestablishmentarianism';

/** Ink: the ink of a Scene is near black on near white, so half way is the line. */
export const DARK = 0.5;

/**
 * What counts as a drawn line: darker than bare paper, the Grid's dots and a
 * wash of the selection, so a stroke and the antialiasing along it are all in.
 * The caret is drawn in the Elements' own ink, so what keeps it apart from the
 * glyphs beside it is where it stands, not how dark it is.
 */
export const CARET = 0.7;

/**
 * The core of a stroke rather than the fringes of it: darker than the
 * antialiasing either side, so a box read with it is the ink's own pixels.
 */
export const GLYPH = 0.3;

/**
 * Darker than paper under the selection's wash, and darker than the wash laid
 * over ink: the pixels that are the ink itself, whatever is behind them.
 */
export const INK_ONLY = 0.13;

/**
 * The inside of `SCENE`'s left-hand box on the page, clear of its outline and of
 * the resize handles of the selection around it. The box's own words are the
 * only ink that can be in here.
 */
export const INSIDE: Rect = { x: 517, y: 346, width: 106, height: 66 };
