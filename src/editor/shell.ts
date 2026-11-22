/**
 * The element's own markup: the paper, the painted Scene's layer, the overlay,
 * the tool rail, the status line and the notes the editor opens over the page.
 *
 * It is one string, set once when the element connects, and every node the
 * editor and the page hold is read back from it by its class. Keeping it here
 * means a change to the chrome is a change to markup alone: nothing in it decides
 * anything, and nothing in the editor draws it.
 */
import { PRIMARY_SCENE_EXTENSION } from '../paths.js';
import { actionById } from './actions.js';
import { railMarkup } from './rail.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SPACING = 22;
const DOT_RADIUS = 1.1;

/**
 * One action's key, as the Shortcuts sheet writes it: read from the action that
 * answers it, so a rebound key moves the sheet with the key press.
 */
function keyOf(id: string): string {
  const action = actionById(id);
  if (action === null) {
    throw new Error(`the Shortcuts sheet names no action called ${id}`);
  }
  return action.primary;
}

/** The chrome the element puts on the page before it draws anything. */
export const SHELL = `
<div class="board">
<div class="surface">
  <svg class="canvas" xmlns="${SVG_NS}" aria-label="Scene canvas" tabindex="0">
    <defs>
      <pattern width="${DOT_SPACING}" height="${DOT_SPACING}" patternUnits="userSpaceOnUse">
        <circle class="dot" cx="1" cy="1" r="${DOT_RADIUS}"></circle>
      </pattern>
    </defs>
    <g class="grid" aria-hidden="true">
      <rect class="grid-rect" x="-100000" y="-100000" width="200000" height="200000"></rect>
    </g>
    <g class="viewport">
      <g class="painted"></g>
    </g>
    <g class="overlay"></g>
  </svg>
</div>
</div>
<nav class="rail" aria-label="Tools"><svg class="rail-art" aria-hidden="true"></svg>${railMarkup()}</nav>
<footer class="status">
  <div class="corner-id">
    <button type="button" data-act="open">Open folder…</button>
    <span class="where"></span>
    <span class="saved" role="status" data-state="idle"></span>
  </div>
  <div class="corner-mode">
    <span class="mode"></span>
  </div>
  <div class="corner-view">
    <button type="button" data-act="grid" aria-pressed="true">Grid</button>
    <button type="button" data-act="roughness" title="Scene default roughness for new Elements"></button>
    <span class="zoom">100%</span>
  </div>
  <div class="corner-help">
    <div class="shortcuts" role="dialog" aria-label="Shortcuts" hidden>
      <h4>Shortcuts</h4>
      <dl class="keys">
        <dt>Space</dt><dd>pan · middle-click too</dd>
        <dt>wheel</dt><dd>zoom</dd>
        <dt>${keyOf('zoom-in')} / ${keyOf('zoom-out')}</dt><dd>zoom</dd>
        <dt>${keyOf('grid')}</dt><dd>Grid</dd>
        <dt>Q</dt><dd>commands</dd>
      </dl>
    </div>
    <button type="button" data-act="shortcuts" aria-label="Shortcuts" aria-expanded="false">?</button>
  </div>
</footer>
<div class="palette" role="dialog" aria-label="Commands" hidden>
  <input
    type="text"
    aria-label="Command"
    placeholder="Type an action"
    spellcheck="false"
    autocomplete="off"
  />
  <ul role="listbox" aria-label="Actions"></ul>
  <p class="palette-nothing" hidden>No action by that name.</p>
</div>
<div class="style-note" role="dialog" aria-label="Style" hidden></div>
<div class="point-menu" role="menu" aria-label="Bend point" tabindex="-1" hidden>
  <button type="button" role="menuitem" data-act="delete-point">Delete point</button>
</div>
<div class="note" role="dialog" aria-label="Scene files" hidden>
  <div class="note-head"><b>Scenes</b><span class="folder"></span></div>
  <ul class="files"></ul>
  <form class="new">
    <input name="name" placeholder="new-scene${PRIMARY_SCENE_EXTENSION}" aria-label="New Scene name" spellcheck="false" autocomplete="off" />
    <button type="submit">New</button>
  </form>
</div>
`;
