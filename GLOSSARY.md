# esbozo

A small canvas for hand-drawn diagrams, drawn by people and written by agents.
This file is a glossary only.

## Language

**Scene**:
One diagram's source: every Element in it and the diagram-wide defaults.
What a person draws and an agent writes.
_Avoid_: drawing, document, board

**Element**:
Anything drawn in a Scene: a rectangle, ellipse, diamond, arrow, line or
Text. Each carries its own style, including how rough it looks.
_Avoid_: shape, connector, node

**Label**:
Text that belongs to an Element and moves and wraps with it.
_Avoid_: caption, bound text

**Text**:
An Element that is only words, belonging to nothing else.
_Avoid_: label (for free-standing text)

**Snap**:
An arrow or line end attached to an Element, so it follows that Element when
it moves. Can be turned off.
_Avoid_: binding, grid snap

**Grid**:
The guide drawn behind the Scene. A visual aid only: Elements move freely and
never jump to it.
_Avoid_: snap grid
