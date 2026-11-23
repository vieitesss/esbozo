# A Snapped end's Anchor is a fraction of its target's box

A Snapped end used to be drawn where the line toward its neighbour meets the
target's outline, so it re-aimed at the target every time the target moved. A
person wants the end to stay where they put it, so a Snapped end now stores an
Anchor: `{ "x", "y" }` as fractions of the target's box, `0` to `1`, drawn at the
nearest point of the outline. Fractions of the box survive moves and resizes for
every Snap target shape, read plainly in JSON, and need no notion of sides, which
an ellipse does not have.

An end with a `snap` but no `anchor` keeps the old centre-aiming rule, so existing
and hand-written Scenes still draw. `ez anchor` writes Anchors, including names
such as `top` or `bottom-left` that it turns into fractions, and
`ez anchor <scene> --all` freezes every unanchored end where it is drawn today.

## Considered Options

- A side plus a fraction along it: an ellipse has no sides.
- A fraction of the way around the outline: hard to read or write by hand, and
  it shifts when the box changes its aspect.
