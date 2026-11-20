---
name: esbozo
description: Esbozo Scenes (hand-drawn diagrams as JSON) with the `ez` CLI. Use to write a new diagram, fix or restyle an existing Scene file, or render one to SVG or PNG.
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

## Scene schema

```json
{
  "version": 1,
  "title": "Orders service",
  "defaults": { "fill": { "kind": "none" }, "textAlign": "center" },
  "elements": [
    { "id": "orders", "type": "rectangle", "x": 40, "y": 40, "width": 180, "height": 80, "label": "Orders" },
    { "id": "db", "type": "ellipse", "x": 340, "y": 40, "width": 180, "height": 80, "label": "Database" },
    {
      "id": "orders-db", "type": "arrow", "label": "writes",
      "points": [{ "x": 130, "y": 80, "snap": "orders" }, { "x": 430, "y": 80, "snap": "db" }]
    },
    { "id": "note", "type": "text", "x": 40, "y": 160, "content": "Written once per order", "textAlign": "left" }
  ]
}
```

- Scene: `version` must be `1`. `title` is the SVG's accessible name: give one. `defaults` sets any Element style key for the whole Scene. `elements` is ordered, and the order is the layer order: later Elements draw on top.
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
  | `fill.kind` | `none`, `solid`, `hachure`, `cross-hatch` | `hachure` |
  | `fill.grey` | `0` (paper) to `6` (ink) | `2` |
  | `tone` | `ink`, `muted` (quieter) | `ink` |
  | `corners` | `sharp`, `round` | `sharp` |
  | `fontSize` | `S` 14px, `M` 18px, `L` 24px, `XL` 32px | `M` |
  | `textAlign` | `left`, `center`, `right` | `left` |

  `fill` and `corners` apply to rectangles, ellipses and diamonds; `corners` rounds a rectangle or a diamond.
- Colours are never written: only `tone` and the grey steps exist. No opacity, rotation, images, groups or frames.
- `seed` fixes an Element's wobble and defaults to a hash of its `id`; leave it out, and keep ids unchanged so redrawing never reshuffles the lines.

## Layout rules

Plan the coordinates before you write them. Pick one step (20 works) and make every `x`, `y`, `width`, `height` and gap a multiple of it.

**Room for Labels.** A Label wraps at spaces inside its Element, and a word is never split. The text box is `fraction * side - 20` for each of width and height (`bold` strokes; `thin` takes 18, `extra` 24), where `fraction` is `1` for a rectangle, `0.7` for an ellipse and `0.5` for a diamond. At `M`, with Kalam, a character is about 8px wide and a line about 29px tall. So a rectangle holds `n` lines of `c` characters when `width >= 20 + 8c` and `height >= 20 + 29n`. Scale both numbers by `fontSize / 18` for other sizes.
- Use rectangles for words. An ellipse needs about 1.4 times the room, and a diamond twice.
- A word wider than the text box overflows: widen the Element.
- Use `\n` for a line break you want.
- An arrow's or line's Label does not wrap and `ez check` does not test it. It sits centred above the shaft (left of a vertical one) and runs as wide as its words, so make the arrow longer than the Label plus 40px.

**Snapped arrows.** Put `"snap": "<id>"` on an end to attach it to the outline of a rectangle, ellipse or diamond; the end then follows that Element. `x` and `y` stay required but the Renderer moves the end: it aims at the middle of the other end's target, or at the other end's own point when that end is free. So set a Snapped end's `x`, `y` to its target's centre. A target must exist and cannot be a text, arrow or line. Two ends of one arrow cannot Snap to the same Element.
- Leave at least 60px between two Elements an arrow joins, so the head and Label show.
- Keep third Elements off an arrow's path: move an Element, or Snap to a different one.

**Aligned rows.** Elements in a row share `y` and `height`; in a column they share `x` and `width`. Use the same gap between neighbours, and the same size for Elements of the same role. Compute positions from the step instead of nudging by eye.

**Grid spacing.** The editor's Grid is a visual guide behind the Scene: Elements never jump to it, and nothing in a Scene refers to it. Your step takes its place: one spacing for the whole Scene, with at least two steps (40px) of air between unrelated Elements.

**Look and style.**
- Labels start left-aligned. Set `defaults.textAlign` to `"center"` so words sit in the middle of their Elements.
- List boxes and ellipses first and arrows after them, so arrows draw on top; put Text last.
- The default fill is hachure, which puts lines behind the words. Set `defaults.fill` to `{ "kind": "none" }`, or `{ "kind": "solid", "grey": 1 }` for a wash, unless the hatching is the point.
- Keep to one `roughness` per Scene unless the difference is the point. Use `tone: "muted"` for secondary Elements and `dashed` strokes for optional or planned ones.
- Titles and notes are Text; words that belong to a box or an arrow are its `label`.
