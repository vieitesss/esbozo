---
name: esbozo
description: Esbozo Scenes (hand-drawn diagrams as JSON) with the `ez` CLI. Use to write a new diagram, fix or restyle an existing Scene file, render one to SVG or PNG, or serve a folder of Scenes in the editor with `ez serve`.
---

# esbozo

A **Scene** is one file: the only source of a diagram. You write it, `ez` checks and renders it, and you look at the result. Name it `<name>.esbozo`; `<name>.json` is accepted too, and older Scenes keep that name. The SVG and PNG files `ez` writes are outputs: change the Scene and render again, and leave every generated file as `ez` wrote it.

A `.esbozo` file is JSON, byte for byte the schema below, so every JSON reader, `jq` and `JSON.stringify` work on it unchanged. The extension is what tells a Scene from the other JSON files a folder holds.

## Run `ez`

Build the repository once, then run the CLI from it:

```sh
pnpm install && pnpm build    # in a clone of the esbozo repository
node dist/cli.js check <name>.esbozo
```

Everywhere below, `ez` stands for `node dist/cli.js`, or for the `ez` bin when the package is linked into the path. The npm package (`npx esbozo <command>`, a global `ez`) arrives with #13 and is not on the registry yet. `ez --help` lists every command, CSS subset and exit code (`ez <command> --help` shows flags, defaults and an example); flags take a separate value: `--theme dark`, never `--theme=dark`. `ez skill` prints this skill to stdout, and `ez skill install [--dir <path>]` copies it into `~/.agents/skills/esbozo/SKILL.md` (or `<path>/esbozo/SKILL.md`).

## The loop

Repeat until `ez check` exits 0 and the PNGs look right:

1. **Write** `<name>.esbozo`.
2. **Check**: `ez check <name>.esbozo`. It prints nothing when clean. Otherwise each problem is one line on stderr, `<element id>: <message>`, and the exit code says which kind:
   - `3` the file does not parse or breaks the schema: fix the named key.
   - `6` a Label does not fit its Element: enlarge the Element or shorten the words (see Layout rules).
   - `5` font or stylesheet unreadable (only when you pass `--font` or `--css`).
   - `2` wrong arguments.

   A note on stderr beside exit `0` is a warning, not a failure: for example a remote `@font-face` in `--css` is replaced by the bundled Kalam, so your Labels were measured with Kalam. Read it.
3. **Render PNGs**: `ez png <name>.esbozo --theme light` and `--theme dark`. Each prints the path it wrote: `<name>.light.png`, `<name>.dark.png`.
4. **Look** at both PNGs with your image viewer. Judge them against the Layout rules: words clear of lines and edges, arrows meeting Elements, rows and columns aligned, nothing crowded, both themes readable.
5. **Fix** the Scene, return to step 2.

When the look is right, `ez render <name>.esbozo` writes `<name>.svg` beside the Scene. A site shows that SVG; it takes its colours and font from the page's CSS variables `--ink`, `--paper`, `--muted` and `--font-hand`, and falls back to the light theme's own values when the file is opened on its own or shown in an `<img>`. The same Scene and the same font file give the same SVG bytes.

For a diagram that belongs to a site, pass its own values: `--css <stylesheet>` and `--font <file>` on `ez check` and `ez png` (`--font` on `ez render`). Otherwise the built-in themes and the bundled Kalam font apply. `ez check` reads the stylesheet only to find the light theme's font, since it draws nothing; `ez png --theme dark` reads the dark theme's colours and font. `ez --help` has the rest.

## Showing Scenes in the editor

`ez serve <dir>` serves the editor page and a save API on a folder of Scenes. Use it only when a person wants to look at or edit Scenes in a browser. Writing, checking and rendering never need it.

1. Start it in the background. It prints `serving <folder> on http://127.0.0.1:<port>/ (build <id>, <time>)`; give the person that URL. `--port 0` picks a free port: read it from that line, and `curl <url>/api/health` answers the same `build` and `builtAt`, so a server already running can be told apart from the one you just started (and from an earlier build of the same commit).
2. Keep the default host (this machine only; the API has no authentication). Add `--read-only` for a person who only wants to look.
3. It exits `4` when it cannot start (port taken: pass another `--port`; editor not built: run `pnpm build`). `SIGINT` or `SIGTERM` stops it with `0`.
4. Keep writing the Scene file, `ez check` it and `ez render` it as before. The page reads a Scene when the person opens it, so ask them to reload after you change the file. A Scene open in the page is saved over your file the next time the person edits it: leave a Scene they are editing alone.

Only top-level `*.esbozo` files in `<dir>` are Scenes, and a `*.json` file there is one only when it holds a Scene: other JSON is left out of the list. Flags, routes and what a save guarantees are in `docs/save-api.md` of the esbozo repository.

## Scene schema

```json
{
  "version": 1,
  "title": "Orders service",
  "elements": [
    { "id": "orders", "type": "rectangle", "x": 44, "y": 44, "width": 176, "height": 88, "label": "Orders" },
    { "id": "db", "type": "ellipse", "x": 396, "y": 44, "width": 176, "height": 88, "label": "Database" },
    {
      "id": "orders-db", "type": "arrow", "label": "writes",
      "points": [{ "x": 132, "y": 88, "snap": "orders" }, { "x": 484, "y": 88, "snap": "db" }]
    },
    { "id": "note", "type": "text", "x": 44, "y": 176, "content": "Written once per order" }
  ]
}
```

- Scene: `version` must be `1`. `title` is the SVG's accessible name: give one. `elements` is ordered, and the order is the layer order: later Elements draw on top.
- Every Element has a unique, non-empty `id` that you keep stable, and a `type`: `rectangle`, `ellipse`, `diamond`, `arrow`, `line` or `text`. Unknown keys are errors.
- `rectangle`, `ellipse`, `diamond`: `x`, `y`, `width`, `height` (whole pixels, size at least 1) and an optional `label`.
- `arrow`, `line`: `points`, two or more `{ "x", "y", "snap"?, "corner"? }`. The first and last are the ends, and only an end takes `snap`; every point between them is a bend point, and only a bend point takes `corner` (`round` pulls the shaft into a smooth curve, `sharp` breaks it into a corner softened by a small fillet; unwritten, it takes the Element's `corners`). Also an optional `label`, an optional `labelAt` that places it, and `heads` from `none | arrow | dot | bar`. An arrow draws an arrow head at its end; a line has none. Both ends may Snap to one Element when a bend point lies between them, which is how a self-loop is drawn.
- `text`: `x`, `y` and `content` (`\n` breaks lines). It has no `label`: its words are the Element.
- Style keys (`roughness`, `stroke`, `fill`, `tone`, `corners`, `fontSize`, `textAlign`) sit on an Element or in a Scene-wide `defaults`; an Element's own value wins. Leave them out and an Element is drawn artist-rough (`roughness` `1`), in a bold solid ink stroke, unfilled, with sharp corners and `M` words (18px): that is the plain look, and a Scene left there is unfinished (see Give it a point of view). Take the values from `docs/schema.md`.
- Colours are never written: only `tone` (`ink` or `muted`) and the grey steps of `fill` exist. No opacity, rotation, images, groups or frames.
- `seed` fixes an Element's wobble and defaults to a hash of its `id`; leave it out, and keep ids unchanged so redrawing never reshuffles the lines.

## Layout rules

Plan the coordinates before you write them. Use one step of 22px, the spacing of the editor's Grid dots, and make every `x`, `y`, `width`, `height` and gap a multiple of it (22, 44, 66, 88, 110, 132, 154, 176, 198, 220).

**Room for Labels.** A box Label wraps at spaces inside its Element, and a word is never split. Estimate the room before you write; `ez check` is the judge. The text box is about `fraction * side - 20` for each of width and height (`bold` strokes), where `fraction` is `1` for a rectangle, `0.7` for an ellipse and `0.5` for a diamond. At `M`, with Kalam, a character is about 8px wide and a line about 29px tall, so a rectangle holds roughly `n` lines of `c` characters when `width >= 20 + 8c` and `height >= 20 + 29n`. Scale both numbers by `fontSize / 18` for other sizes; other fonts differ.
- Use rectangles for words. An ellipse needs about 1.4 times the room, and a diamond twice.
- A word wider than the text box overflows: widen the Element.
- Use `\n` for a line break you want.
- An arrow's or line's Label sits above the shaft (left of a vertical one) unless you place it: `"labelAt": { "t": 0.5, "offset": 0 }` centres the words on the point halfway along the drawn shaft by length, so on a bent or curved shaft that is the middle of the ink; `t` runs from `0` (the start) to `1` (the end) and `offset` in pixels to the side, positive on the upper side there and negative on the lower one. Without `labelAt` the words sit above the middle of the line between the two ends, so place them yourself on a bent shaft. `textAlign` does not apply to it. It does not wrap and `ez check` does not test it, so look at the PNG. It runs as wide as its words: make the arrow longer than the Label plus 40px.
- An arrow or line Label has no paper behind it: when its words sit over their own shaft, the Renderer cuts that shaft open so the words read cleanly, and a shaft wholly under its words draws no shaft at all. Only that shaft is cut — an Element, a fill, another shaft or a head under the words stays whole and shows through, making the words hard to read. Place a shaft Label over open paper or its own bare shaft; do not put it over an Element, a fill, another shaft or a head.

**Snapped arrows.** Put `"snap": "<id>"` on an end to attach it to the outline of a rectangle, ellipse or diamond; the end then follows that Element. `x` and `y` stay required but the Renderer moves the end: it aims at the middle of the other end's target, or at the other end's own point when that end is free. A longer shaft aims each Snapped end at the bend point beside it, so route the first and last bend points towards the outline the end should touch. So set a Snapped end's `x`, `y` to its target's centre. A target must exist and cannot be a text, arrow or line. Two ends of one two-point arrow cannot Snap to the same Element; add a bend point to draw a self-loop.

**Resting a Snapped end where you want it.** `ez anchor <scene> <id> start|end <place>` writes the end's Anchor so it draws on one spot of its target and keeps it as the target moves: a name (`top`, `bottom`, `left`, `right`, `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right`), a pair of fractions `fx,fy` from `0` to `1`, or `none` to drop it and aim at the centre again. `ez anchor <scene> --all` gives every Snapped end that has no Anchor the Anchor of where it draws today, so the SVG does not move. `ez snap <scene> <id> start|end <target>` attaches an end the way a drop does, and `off` turns that end's Snap off. Each prints the line it changed and runs `ez check`'s checks; look at the PNG after.
- Leave at least 66px (three steps) between two Elements an arrow joins, so the head and Label show.
- Keep third Elements off an arrow's path: move an Element, or Snap to a different one.

**Aligned rows.** Elements in a row share `y` and `height`; in a column they share `x` and `width`. Use the same gap between neighbours, and the same size for Elements of the same role. Compute positions from the step instead of nudging by eye.

**Grid spacing.** The editor's Grid is dots every 22px behind the Scene: a visual guide that Elements never jump to, and no Scene key refers to it. Keep to its 22px step so Elements share one rhythm; the editor draws the dots at its own zoom, so do not count on them lining up with every view. Leave at least two steps (44px) of air between unrelated Elements.

**Look and style.**
- Box Labels sit in the middle of their Elements, and Text starts at its `x`. Write `textAlign` only to break that: `"left"` on a box Label's Element, or `"center"` on a Text you centre on its `x`. An explicit `textAlign` wins for box Labels and Text.
- List boxes and ellipses first and arrows after them, so arrows draw on top; put Text last.
- Words stay clear of fills: `{ "kind": "solid", "grey": 1 }` is a light wash that keeps a Label readable, while `hachure` and `cross-hatch` put lines behind the words, so use them only on Elements without a Label.
- Keep to one `roughness` per Scene unless the difference is the point.
- Titles and notes are Text; words that belong to a box or an arrow are its `label`.

## Give it a point of view

A Scene of identical rectangles joined by identical arrows, all in the default look, is a draft, not a diagram. Before you write, decide what the reader should see first, then spend the style keys on it. Each key has a job; use it for that job, not as decoration.

1. **Pick one focal Element**: the thing the diagram is about, or the step that matters most. Give it a solid `fill` (`grey` `1`, or `2` to push harder), `stroke.width` `"extra"`, or both.
2. **Push context back**: the actors, stores and surroundings that are not the story take `tone: "muted"` and `stroke.width` `"thin"`.
3. **Say what kind of thing each Element is by its shape**: a rectangle for a step or a thing, an ellipse for a person, actor or store, a diamond for a decision. Mix shapes when the story has more than one kind of thing.
4. **Mark status with the stroke**: `dashed` for optional, planned or external; `dotted` for something implied.
5. **Group with a dashed container**: a large unlabelled rectangle with `tone: "muted"` and `stroke.style: "dashed"` behind the Elements it holds, named by a small Text in its corner. List it first, so it draws underneath. Keep its edge at least two steps from what it holds, and keep arrows that cross it clear of its Label.
6. **Make the title and the notes speak**: a Text title at `fontSize: "L"` or `"XL"`, notes at `"S"` with `tone: "muted"`. Use a Text note to say the one thing the shapes cannot.
7. **Use the line vocabulary**: `corners: "round"` for friendly flows, `heads: { "end": "dot" }` or `"bar"` for a relationship that is not a step, `muted` or `dashed` arrows for secondary or return paths, a bold `extra` arrow for the main path.
8. **Break the straight line**: a loop is drawn as a loop, a hub with spokes around it, layers as stacked rows. Do not stretch a graph into one row because a row is easy to compute. Keep the 22px step and the aligned-rows rule inside whatever shape you choose.

A Scene is done when it has a focal Element and at least two other keys from this list doing their job, and its PNGs show the focus in both themes. A small Scene of two or three Elements may use fewer levers, but still has a focal Element.

**The person's wishes win.** When the person says how a diagram should look, whether more or less styled, which Element to stress, a given shape, `roughness`, plain, or anything else, do exactly that and skip every default in this section. Their words override these rules, and the Layout rules still apply for a Scene that must be readable. If they ask for plain, draw it plain.
