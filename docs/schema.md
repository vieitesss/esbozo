# Scene schema

A Scene is one file: JSON named `<name>.esbozo`, or `<name>.json` for a Scene that already carries that name. `.esbozo` is the extension a new Scene takes, and the bytes are JSON either way. `ez check` and the editor read it through the same parser (`src/scene.ts`), so what this page says is what both accept. For a quick start, read `skills/esbozo/SKILL.md`.

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
| `label` | string | none | As above. It does not wrap: it breaks only at `\n`. Without `labelAt` it is centred on the middle of the line between the two ends, on the side that points up (left of a vertical shaft); each line reads from the edge `textAlign` names inside the block the words fill. It has no paper behind it: where its words sit over its own shaft, that shaft is cut open. `ez check` does not measure it. |
| `labelAt` | object | none: Layout's own place | Keys `t` and `offset` only. `t` is the fraction of the drawn shaft's length: `0` at the start, `1` at the end, between `0` and `1`. `offset` is a signed distance in pixels to one side, rounded to whole pixels: `0` sits on the shaft, and a positive value is the local perpendicular side where the words land — up while the run there is level, left while it runs down the page — which is the side at that fraction of the ink, not the side the default Label takes, and not a side the line between the two ends decides. Only an arrow or line carries one. |

A Label with `labelAt` is centred on the point that fraction of the way along the
ink the Renderer draws. It is measured along the shaft, not across the gap
between its ends, so on a bent or curved shaft `0.5` is half the ink rather than
the middle of the line between the ends. The measure is a sampled one: each step
of the curve is integrated along its own arc, fine enough that the ink's middle
lands well under a pixel from the fraction's. The words are moved `offset`
pixels along the side the shaft is on where they land — the side that points up
(left of a vertical shaft) on a level or straight run, and the local side where
the shaft bends. It follows the ends a Snap moves, so it stays where the author
put it on the arrow as its targets move.

A shaft that writes no `labelAt` keeps the place Layout gives every Label: the
middle of the line between the two ends, on the side that points up (left of a
vertical shaft). That is the middle of the ink for a two-point arrow or line, and
the middle of the gap rather than of the ink for a bent one. Place the words with
`labelAt` on a bent one.

A shaft Label has no paper behind it. When the shaft's centre line enters the
words' box, the Renderer leaves that shaft undrawn under the words, cutting out
the words' ink box grown by half the stroke width. Words beside the shaft, and
blank words, cut nothing. Only the Label's own shaft is cut: anything else under
the words — an Element, a fill, another shaft — shows through, and heads are
never cut, so a head under the words stays whole and overlaps them. A shaft
wholly under its words draws no shaft at all, so an arrow needs to be longer than
its words. That holds in the SVG, both PNG themes and the editor.

A point has these keys.

| Key | Type | Default | Constraint |
| --- | --- | --- | --- |
| `x`, `y` | number | none, required | Finite. Rounded to whole pixels. |
| `snap` | string or `false` | none (a free end) | The `id` of a rectangle, ellipse or diamond in the Scene, or `false` for an end that remembers no Snap. First and last point only. |
| `anchor` | object | none (the Renderer aims the end) | Fractions of the target's box, both required: `0`–`1`. Only on an end whose `snap` is an `id`. |
| `corner` | string | the Element's `corners` | `sharp` or `round`. Middle points only. |

A bend point turns the shaft: `round` pulls it into a smooth curve, and `sharp` breaks the curve into a corner softened by a small fillet. Consecutive `round` points form one continuous curve, so an S-bend flows without a kink; a `sharp` point between them ends one curve and starts the next. A point that writes no `corner` takes the Element's `corners`, so a whole shaft is `round` or `sharp` until a single point overrides it.

Only an end may carry a `snap` or an `anchor`, and only a bend point may carry a `corner`: a Scene that writes one where it does not belong is refused, and so is a `corner` that is neither `sharp` nor `round`, an `anchor` on an end that is free or Snaps to no `id`, and an `anchor` fraction outside `0`–`1`. `"snap": false` draws like no `snap` at all.

A Snapped end with no `anchor` is drawn on its target's outline, where the line from the point beside it meets it: the other end of a two-point shaft, or the bend point next to an end of a longer one. That line aims at the other end's target centre when that end is Snapped too, or at the other end's own `x`, `y` when it is free. Two targets may overlap: when their outlines would put the two ends the wrong way round along the line between their centres, the start end leaves its own outline on the far side from the end target, so it still lands on an outline and the end head still points into its target. When even that cannot reach the end target — two bars crossing at their middles, where the line between the centres is no direction at all — the two ends take another pair of true outline points: the start target's outline is walked from its right-hand point, and the first of those points that lies outside the end target wins, with the end aiming at it. The shaft stays on each target's outline and still runs into the end target. Only a target drawn wholly inside the other has no such pair, and then the shaft keeps the two points on the line between the centres. Overlapping targets are settled for a two-point shaft; a longer shaft aims each Snapped end at the bend point beside it. The end's own `x`, `y` are required but the Renderer replaces them.

An end that carries an `anchor` skips the aiming: its `anchor` is the place it is drawn at, as a fraction of its target's box — `{"x": 0, "y": 0.5}` is the middle of the target's left edge, `{"x": 1, "y": 0}` its top right corner. The Renderer walks the target's outline and draws the end at the point nearest that place: the foot on the nearest edge of a rectangle or diamond — a rounded corner's fillet included — and the nearest point of an ellipse. A place in the middle of a box is the same distance from every edge, so the first piece of the outline wins and the end lands on the top edge. Because an `anchor` names the outline point itself, it also decides the two ends of a two-point shaft: both ends may Snap to one Element when they carry differing `anchor`s, and identical `anchor`s, or only one, are refused like two ends with no `anchor` at all. An anchored end keeps its target's outline as the target moves, because the fraction is of the box and not of the page. Overlap rules that turn the ends around, or reach for another pair of outline points, apply only when neither end carries an `anchor`: an anchored end is drawn where it says even when that is inside another Element.

Both ends of a two-point arrow or line cannot Snap to the same Element with no `anchor` between them: with no bend point between them there is no direction to draw the shaft along. A shaft with a bend point may Snap both ends to one Element, which is how a self-loop is written. A Snap to an id that does not exist, or to a text, arrow or line, is an error.

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
| `textAlign` | string | none written: `"center"` for a Label, `"left"` for a Text | `left`, `center` or `right`. Written on an Element or in `defaults`, it wins for every Label (a box's, an arrow's or a line's) and Text it covers. |

Unwritten `textAlign` means what suits the words: a Label centres — in the box that holds it, and in the block a shaft gives it — and a Text keeps the left edge its `x` places. Write `"textAlign": "center"` in `defaults` to centre Text too. Write `"left"` to put Labels on the left edge, and a shaft's lines on the left edge of their block.

Every Element accepts every style key, and each type draws the ones that mean something to it:

- Rectangle and diamond: all of them. `corners` rounds their corners.
- Ellipse: all except `corners`, which it has none of.
- Arrow and line: `roughness`, `stroke`, `tone`, `corners` for their bend points, and `fontSize` and `textAlign` for the Label. They have no fill: their Label sits on the shaft, placed by `labelAt` when one is written.
- Text: `tone`, `fontSize` and `textAlign`.

Colours are never written in a Scene. The look comes from the host's CSS variables `--ink`, `--paper`, `--muted` and `--font-hand`, and each one is written with the light theme's value as its fallback (`var(--ink, #1b1a17)`, `var(--paper, #fbf8f1)`, `var(--muted, #878580)`, `var(--font-hand, 'Kalam', 'Bradley Hand', 'Segoe Print', cursive)`), so a saved SVG opened on its own — or dropped into an `<img>` — still draws paper, ink and words; a host that declares the name wins over the fallback. The grey ladder is a fixed mix of ink into paper. There is no opacity, rotation, image, group or frame.

## Canonical form

`serialiseScene` writes a Scene with two-space indentation, a fixed key order, whole-pixel geometry, every style key spelt out on each Element (an unwritten `textAlign` is written as what it resolved to) and a final newline. In `defaults`, `textAlign` appears only when the Scene wrote one. A shaft's `labelAt` is written after the `label` it places, and only when the Scene has one: its `t` keeps four decimals and its `offset` whole pixels, like the geometry around it. A bend point's `corner` is written after its `y`, and only when the point wrote one; an unwritten corner is never written, so the Element's `corners` still speaks for that point when the file reopens. The Scene hash in an SVG's `data-scene-hash` is the SHA-256 of that text, so a Scene that parses to the same values hashes the same, whatever its file looked like. Saving from the editor writes this form.

## Labels

A Label wraps at spaces inside the largest centred box its Element holds, less padding. The box is the whole Element for a rectangle, `1/√2` of each side for an ellipse and half of each side for a diamond, minus `8` pixels plus the stroke width on every side. A word wider than the box is not split. What does not fit overflows: the SVG still draws it, and `ez check` reports it and exits `6`. The Scene keeps the size you gave the Element; widen or heighten it, or shorten the words.

A Label that belongs to an arrow or line has no box to wrap in and no overflow to report: it sits on the shaft, where `labelAt` puts it or above the middle of the line between the ends when the Scene writes none, with no paper behind it; where its words sit over their own shaft, the Renderer cuts that shaft open. Its block keeps that place whatever `textAlign` says: the lines read from the block's left edge, its centre or its right edge, so one line lands where it always did and several line up with each other.
