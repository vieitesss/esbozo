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
import { railMarkup } from './rail.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const DOT_SPACING = 22;
const DOT_RADIUS = 1.1;

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
  <span class="hint">Space pan · wheel zoom · ⌘ +/− · G Grid · Q commands</span>
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
<div class="note" role="dialog" aria-label="Scene files" hidden>
  <div class="note-head"><b>Scenes</b><span class="folder"></span></div>
  <ul class="files"></ul>
  <form class="new">
    <input name="name" placeholder="new-scene${PRIMARY_SCENE_EXTENSION}" aria-label="New Scene name" spellcheck="false" autocomplete="off" />
    <button type="submit">New</button>
  </form>
</div>
`;
