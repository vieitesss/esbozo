# Scene schema

A Scene is one JSON file. `ez check` and the editor read it through the same parser (`src/scene.ts`), so what this page says is what both accept. For a quick start, read `skills/esbozo/SKILL.md`.

```json
{
  "version": 1,
  "title": "Two boxes",
  "elements": [
    { "id": "a", "type": "rectangle", "x": 44, "y": 44, "width": 176, "height": 88, "label": "Orders" },
    { "id": "b", "type": "rectangle", "x": 330, "y": 44, "width": 176, "height": 88, "label": "Billing" },
    { "id": "a-b", "type": "arrow", "points": [{ "x": 132, "y": 88, "snap": "a" }, { "x": 418, "y": 88, "snap": "b" }] },
    { "id": "note", "type": "text", "x": 44, "y": 176, "content": "Billed once per order" }
  ]
}
```

The parser rejects every key it does not know, so a misspelt key is an error and never ignored. Every problem names the Element's `id`, or the Scene when it belongs to the Scene.

## Scene

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `version` | integer | none, required | Must be `1`. |
| `title` | string | `"Scene"` | Not blank. No characters XML cannot hold (control characters, lone surrogates). It becomes the SVG's accessible name. |
| `defaults` | object | the defaults in Style | Style keys only (see Style). |
| `elements` | array | none, required | Element objects. List order is layer order: later Elements draw on top. |

## Elements

Every Element has these keys.

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `id` | string | none, required | Not empty, unique in the Scene. Snap targets name it, and the problems `ez check` prints start with it. |
| `type` | string | none, required | `rectangle`, `ellipse`, `diamond`, `arrow`, `line` or `text`. |
| `seed` | integer | a hash of `id` | `1` to `2147483647`. Fixes the Element's wobble, so redrawing never reshuffles its lines. |
| style keys | | the Scene's `defaults` | See Style. |

### rectangle, ellipse, diamond

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `x`, `y` | number | none, required | Finite. Rounded to whole pixels. The top-left of the Element's box. |
| `width`, `height` | number | none, required | Finite, at least `1` after rounding. |
| `label` | string | none | Not blank. No characters XML cannot hold. `\n` is a line break. Wraps inside the Element; `ez check` reports a Label that does not fit. |

### arrow, line

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `points` | array of two or more points | none, required | The first and last are the ends; every point between them is a bend point. |
| `heads` | object | arrow: `{ "start": "none", "end": "arrow" }`; line: both `none` | Keys `start` and `end` only, each `none`, `arrow`, `dot` or `bar`. A missing key takes the default. |
| `label` | string | none | As above. It does not wrap: it breaks only at `\n`. Without `labelAt` it is centred on the middle of the shaft, on the side that points up (left of a vertical shaft); `textAlign` does not apply to it. Every arrow's or line's Label has paper behind it. `ez check` does not measure it. |
| `labelAt` | object | none: Layout's own place | Keys `t` and `offset` only. `t` is the fraction along the drawn shaft: `0` at the start, `1` at the end, between `0` and `1`. `offset` is a signed distance in pixels to one side, rounded to whole pixels: `0` sits on the shaft, and a positive value is the side the default Label takes, which is the side that points up (the left of a vertical shaft). Only an arrow or line carries one. |

A Label with `labelAt` is centred on the point that fraction of the way along the
shaft the Renderer draws, then moved `offset` pixels to that side. It follows the
ends a Snap moves, so it stays where the author put it on the arrow as its
targets move. A Scene that writes no `labelAt` places the Label where Layout
always has: centred above the middle of the shaft.

Every shaft Label sits on paper: the Renderer draws `var(--paper)` behind its
words, so a Label placed over its own shaft — or over anything else — is read
against paper rather than through what runs under it. That holds in the SVG,
both PNG themes and the editor.

A point has these keys.

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `x`, `y` | number | none, required | Finite. Rounded to whole pixels. |
| `snap` | string | none (a free end) | The `id` of a rectangle, ellipse or diamond in the Scene. First and last point only. |
| `corner` | string | the Element's `corners` | `sharp` or `round`. Middle points only. |

A bend point turns the shaft: `round` pulls it into a smooth curve, and `sharp` breaks the curve into a corner softened by a small fillet. Consecutive `round` points form one continuous curve, so an S-bend flows without a kink; a `sharp` point between them ends one curve and starts the next. A point that writes no `corner` takes the Element's `corners`, so a whole shaft is `round` or `sharp` until a single point overrides it.

Only an end may carry a `snap` and only a bend point may carry a `corner`: a Scene that writes either where it does not belong is refused, and so is a `corner` that is neither `sharp` nor `round`.

A Snapped end is drawn on its target's outline, where the line from the point beside it meets it: the other end of a two-point shaft, or the bend point next to an end of a longer one. That line aims at the other end's target centre when that end is Snapped too, or at the other end's own `x`, `y` when it is free. Two targets may overlap: when their outlines would put the two ends the wrong way round along the line between their centres, the start end leaves its own outline on the far side from the end target, so it still lands on an outline and the end head still points into its target. When even that cannot reach the end target — two bars crossing at their middles, where the line between the centres is no direction at all — the two ends take another pair of true outline points: the start target's outline is walked from its right-hand point, and the first of those points that lies outside the end target wins, with the end aiming at it. The shaft stays on each target's outline and still runs into the end target. Only a target drawn wholly inside the other has no such pair, and then the shaft keeps the two points on the line between the centres. Overlapping targets are settled for a two-point shaft; a longer shaft aims each Snapped end at the bend point beside it. The end's own `x`, `y` are required but the Renderer replaces them. Both ends of a two-point arrow or line cannot Snap to the same Element: with no bend point between them there is no direction to draw the shaft along. A shaft with a bend point may Snap both ends to one Element, which is how a self-loop is written. A Snap to an id that does not exist, or to a text, arrow or line, is an error.

### text

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `x`, `y` | number | none, required | Finite. Rounded to whole pixels. The edge the words align to: the left edge, the centre or the right edge, by `textAlign`. |
| `content` | string | none, required | Not blank. No characters XML cannot hold. `\n` is a line break. |

A Text has no `label`: its words are the Element.

## Style

These keys sit in `defaults` for the whole Scene, and on any Element, where they win. A nested object (`stroke`, `fill`) may set one key and leave the other to the default.

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `roughness` | integer | `1` | `0` architect, `1` artist, `2` cartoonist. |
| `stroke.width` | string | `"bold"` | `thin` (1px), `bold` (2px) or `extra` (4px). |
| `stroke.style` | string | `"solid"` | `solid`, `dashed` or `dotted`. |
| `fill.kind` | string | `"none"` | `none`, `solid`, `hachure` or `cross-hatch`. Nothing is filled unless the Scene asks. |
| `fill.grey` | integer | `2` | `0` to `6`: a ladder of seven greys from paper (`0`) to ink (`6`). |
| `tone` | string | `"ink"` | `ink` or `muted`: the colour of the stroke and the words. |
| `corners` | string | `"sharp"` | `sharp` or `round`. Rounds a rectangle's or a diamond's vertices, and sets the corner an arrow's or line's bend point turns by. |
| `fontSize` | string | `"M"` | `S` (14px), `M` (18px), `L` (24px) or `XL` (32px). |
| `textAlign` | string | none written: `"center"` for a box Label, `"left"` for a Text | `left`, `center` or `right`. Written on an Element or in `defaults`, it wins for every box Label (rectangle, ellipse, diamond) and Text it covers. An arrow's or line's Label ignores it (see Elements); the editor offers no Text Align for them. |

Unwritten `textAlign` means what suits the words: a box Label centres in its Element, and a Text keeps the left edge its `x` places. Write `"textAlign": "center"` in `defaults` to centre Text too. Write `"left"` to put box Labels on the left edge.

Every Element accepts every style key, and each type draws the ones that mean something to it:

- Rectangle and diamond: all of them. `corners` rounds their corners.
- Ellipse: all except `corners`, which it has none of.
- Arrow and line: `roughness`, `stroke`, `tone`, `corners` for their bend points, and `fontSize` for the Label. They have no fill and no `textAlign` effect: their Label sits on the shaft, placed by `labelAt` when one is written.
- Text: `tone`, `fontSize` and `textAlign`.

Colours are never written in a Scene. The look comes from the host's CSS variables `--ink`, `--paper`, `--muted` and `--font-hand`; the grey ladder is a fixed mix of ink into paper. There is no opacity, rotation, image, group or frame.

## Canonical form

`serialiseScene` writes a Scene with two-space indentation, a fixed key order, whole-pixel geometry, every style key spelt out on each Element (an unwritten `textAlign` is written as what it resolved to) and a final newline. In `defaults`, `textAlign` appears only when the Scene wrote one. A shaft's `labelAt` is written after the `label` it places, and only when the Scene has one: its `t` keeps four decimals and its `offset` whole pixels, like the geometry around it. The Scene hash in an SVG's `data-scene-hash` is the SHA-256 of that text, so a Scene that parses to the same values hashes the same, whatever its file looked like. Saving from the editor writes this form.

## Labels

A Label wraps at spaces inside the largest centred box its Element holds, less padding. The box is the whole Element for a rectangle, `1/√2` of each side for an ellipse and half of each side for a diamond, minus `8` pixels plus the stroke width on every side. A word wider than the box is not split. What does not fit overflows: the SVG still draws it, and `ez check` reports it and exits `6`. The Scene keeps the size you gave the Element; widen or heighten it, or shorten the words.

A Label that belongs to an arrow or line has no box to wrap in and no overflow to report: it sits on the shaft, where `labelAt` puts it or above the middle when the Scene writes none, and the Renderer draws paper behind it so it never reads through the shaft.
