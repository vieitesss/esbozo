---
name: esbozo
description: Esbozo Scenes (hand-drawn diagrams as JSON) with the `ez` CLI. Use to write a new diagram, fix or restyle an existing Scene file, render one to SVG or PNG, or serve a folder of Scenes in the editor with `ez serve`.
---

# esbozo

A **Scene** is one JSON file: the only source of a diagram. You write it, `ez` checks and renders it, and you look at the result. The SVG and PNG files `ez` writes are outputs: change the Scene and render again, and leave every generated file as `ez` wrote it.

`ez` is the CLI of the `esbozo` npm package (`npx esbozo <command>` runs the same commands). Flags take a separate value: `--theme dark`, never `--theme=dark`.

## The loop

Repeat until `ez check` exits 0 and the PNGs look right:

1. **Write** `<name>.json`.
2. **Check**: `ez check <name>.json`. It prints nothing when clean. Otherwise each problem is one line on stderr, `<element id>: <message>`, and the exit code says which kind:
   - `3` the file does not parse or breaks the schema: fix the named key.
   - `6` a Label does not fit its Element: enlarge the Element or shorten the words (see Layout rules).
   - `5` font or stylesheet unreadable (only when you pass `--font` or `--css`).
   - `2` wrong arguments.
3. **Render PNGs**: `ez png <name>.json --theme light` and `--theme dark`. Each prints the path it wrote: `<name>.light.png`, `<name>.dark.png`.
4. **Look** at both PNGs with your image viewer. Judge them against the Layout rules: words clear of lines and edges, arrows meeting Elements, rows and columns aligned, nothing crowded, both themes readable.
5. **Fix** the Scene, return to step 2.

When the look is right, `ez render <name>.json` writes `<name>.svg` beside the Scene. A site shows that SVG; it takes its colours and font from the page's CSS variables `--ink`, `--paper`, `--muted` and `--font-hand`.

`ez png` and `ez check` accept `--font <file>` (measure and draw with that font) and `--css <stylesheet>` (take the colours and font from a site's stylesheet); `ez png` also accepts `--ink`, `--paper` and `--muted`. Pass the site's own values when the diagram is for a site; otherwise the built-in themes and the bundled Kalam font apply.

## Showing Scenes in the editor

`ez serve <dir>` serves the editor page and a save API on a folder of Scenes. Use it only when a person wants to look at or edit Scenes in a browser. Writing, checking and rendering never need it.

1. Start it in the background: `ez serve <dir>`. It prints `serving <folder> on http://127.0.0.1:<port>/`; give the person that URL.
2. `--port N` picks the port (default `4320`; `0` lets the system pick a free one, so read the printed line for the number). `--host <address>` picks the address (default `127.0.0.1`: this machine only; there is no authentication, so change it only when the person asks). `--read-only` refuses every write, for a person who only wants to look.
3. It exits `4` when it cannot start (port taken: pass another `--port`; editor not built: run `pnpm build`) and `2` for wrong arguments. `SIGINT` or `SIGTERM` stops it with `0`.
4. It does not replace the loop: keep writing the Scene file, `ez check` it and `ez render` it as before. The page reads a Scene when the person opens it, so ask them to reload after you change the file. A Scene open in the page is saved over your file the next time the person edits it: do not rewrite a Scene they are editing.

Only top-level `*.json` files in `<dir>` are Scenes (no subfolders, no names starting with `.`). The HTTP contract is in `docs/save-api.md` of the esbozo repository.

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

- Scene: `version` must be `1`. `title` is the SVG's accessible name: give one. `defaults` sets any Element style key for the whole Scene; leave it out unless you want a look every Element shares. `elements` is ordered, and the order is the layer order: later Elements draw on top.
- Every Element has a unique, non-empty `id` that you keep stable, and a `type`: `rectangle`, `ellipse`, `diamond`, `arrow`, `line` or `text`. Unknown keys are errors.
- `rectangle`, `ellipse`, `diamond`: `x`, `y`, `width`, `height` (whole pixels, size at least 1) and an optional `label`.
- `arrow`, `line`: `points`, exactly two ends `{ "x", "y", "snap"? }`, an optional `label`, and `heads` `{ "start", "end" }` from `none | arrow | dot | bar`. An arrow defaults to `end: arrow`; a line to no heads.
- `text`: `x`, `y` and `content` (`\n` breaks lines). It has no `label`: its words are the Element.
- Style keys, on any Element or in `defaults`; an Element's own value wins:

  | key | values | default |
  | --- | --- | --- |
  | `roughness` | `0` architect, `1` artist, `2` cartoonist | `1` |
  | `stroke.width` | `thin`, `bold`, `extra` | `bold` |
  | `stroke.style` | `solid`, `dashed`, `dotted` | `solid` |
  | `fill.kind` | `none`, `solid`, `hachure`, `cross-hatch` | `none` |
  | `fill.grey` | `0` (paper) to `6` (ink) | `2` |
  | `tone` | `ink`, `muted` (quieter) | `ink` |
  | `corners` | `sharp`, `round` | `sharp` |
  | `fontSize` | `S` 14px, `M` 18px, `L` 24px, `XL` 32px | `M` |
  | `textAlign` | `left`, `center`, `right` | Label `center`, Text `left` |

  Unwritten `textAlign` is `center` for every Label (rectangle, ellipse, diamond, arrow, line) and `left` for a Text, whose `x` is its left edge. A `textAlign` you write, on an Element or in `defaults`, wins for both.

  `fill` and `corners` apply to rectangles, ellipses and diamonds; `corners` rounds a rectangle or a diamond.
- Colours are never written: only `tone` and the grey steps exist. No opacity, rotation, images, groups or frames.
- `seed` fixes an Element's wobble and defaults to a hash of its `id`; leave it out, and keep ids unchanged so redrawing never reshuffles the lines.

## Layout rules

Plan the coordinates before you write them. Use one step of 22px, the spacing of the editor's Grid dots, and make every `x`, `y`, `width`, `height` and gap a multiple of it (22, 44, 66, 88, 110, 132, 154, 176, 198, 220).

**Room for Labels.** A Label wraps at spaces inside its Element, and a word is never split. The text box is `fraction * side - 20` for each of width and height (`bold` strokes; `thin` takes 18, `extra` 24), where `fraction` is `1` for a rectangle, `0.7` for an ellipse and `0.5` for a diamond. At `M`, with Kalam, a character is about 8px wide and a line about 29px tall. So a rectangle holds `n` lines of `c` characters when `width >= 20 + 8c` and `height >= 20 + 29n`. Scale both numbers by `fontSize / 18` for other sizes.
- Use rectangles for words. An ellipse needs about 1.4 times the room, and a diamond twice.
- A word wider than the text box overflows: widen the Element.
- Use `\n` for a line break you want.
- An arrow's or line's Label does not wrap and `ez check` does not test it. It sits centred above the shaft (left of a vertical one) and runs as wide as its words, so make the arrow longer than the Label plus 40px.

**Snapped arrows.** Put `"snap": "<id>"` on an end to attach it to the outline of a rectangle, ellipse or diamond; the end then follows that Element. `x` and `y` stay required but the Renderer moves the end: it aims at the middle of the other end's target, or at the other end's own point when that end is free. So set a Snapped end's `x`, `y` to its target's centre. A target must exist and cannot be a text, arrow or line. Two ends of one arrow cannot Snap to the same Element.
- Leave at least 66px (three steps) between two Elements an arrow joins, so the head and Label show.
- Keep third Elements off an arrow's path: move an Element, or Snap to a different one.

**Aligned rows.** Elements in a row share `y` and `height`; in a column they share `x` and `width`. Use the same gap between neighbours, and the same size for Elements of the same role. Compute positions from the step instead of nudging by eye.

**Grid spacing.** The editor's Grid is dots every 22px behind the Scene: a visual guide that Elements never jump to, and no Scene key refers to it. Keep to its 22px step so a person who opens your Scene sees every Element on the dots. Leave at least two steps (44px) of air between unrelated Elements.

**Look and style.**
- Labels sit in the middle of their Elements, and Text starts at its `x`. Write `textAlign` only to break that: `"left"` on an Element for a left-aligned Label, or `"center"` on a Text you centre on its `x`.
- List boxes and ellipses first and arrows after them, so arrows draw on top; put Text last.
- Nothing is filled by default, so words stay clear. Add a fill only for emphasis: `{ "kind": "solid", "grey": 1 }` is a light wash, and `hachure` puts lines behind the words, so use it only on Elements without a Label.
- Keep to one `roughness` per Scene unless the difference is the point. Use `tone: "muted"` for secondary Elements and `dashed` strokes for optional or planned ones.
- Titles and notes are Text; words that belong to a box or an arrow are its `label`.
