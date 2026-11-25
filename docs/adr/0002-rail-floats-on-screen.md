# The Rail floats on the screen, and where it rests sets its orientation

The Rail used to dock on one of four sides of the diagram's on-screen box, so
the places it could go moved whenever the diagram was panned, zoomed or small.
A person wants to put it where they like and have it stay, so the Rail now sits
anywhere in the editor's box, fixed to the screen and blind to the Scene and the
view. The box's two corner-to-corner diagonals split it into four spaces: in the
top or bottom space the Rail lies, and in the left or right space it stands.
The pointer picks the space while the Rail is dragged live, and orientation
holds until the pointer is 16px past a diagonal, so a shaky hand cannot make it
flicker. A drop stores the Rail's centre as fractions of the editor's box
together with the orientation it was dropped with. Storing the orientation keeps
a reload from turning a Rail whose centre falls across a diagonal from where the
pointer was.

## Considered Options

- Docking against the diagram, as before: the docks shift with every pan and
  zoom, so a person cannot predict where a drop lands.
- Nearest edge instead of corner-to-corner diagonals: on a wide editor the
  standing spaces shrink to small triangles; corner-to-corner gives every space
  the same area.
- Orientation derived from the stored centre on load: one field fewer, but the
  Rail can turn between drop and reload.

## Consequences

- No ghost docks while dragging: the Rail itself is the preview.
- The Rail may cover the drawing and the Style note, and stays on top. The note
  no longer makes room for the Rail.
- An old saved side becomes the middle of that edge, 16px in, which is also
  where the command palette puts the Rail.
- A Rail too long to stand in a short editor lies, and the reverse in a narrow one.
  Better small-screen behaviour, such as two spaces or a collapsed Rail, is left
  for a later issue.
