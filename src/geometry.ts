/**
 * Geometry: the two pieces of maths the Renderer needs and the Scene does not.
 *
 * An Element's outline is where a Snapped arrow or line end lands. The end is
 * placed where the line from the other end, through the target's centre,
 * crosses that outline: an arrow that points at a box points at its middle and
 * stops on its edge. Rectangles (round corners included), ellipses and
 * diamonds are the Elements with an outline; everything else cannot be a Snap
 * target.
 *
 * The arrow head maths is here too: a head is a triangle whose apex is the
 * end and whose base sits behind it along the arrow, so a head points into its
 * target rather than away from it.
 */
export interface Point {
  x: number;
  y: number;
}

/** The outline of an Element, as a Snap target. */
export interface Outline {
  type: 'rectangle' | 'ellipse' | 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
  /** A rectangle's and a diamond's corner rounding; an ellipse has no corners. */
  corners: 'sharp' | 'round';
}

/** The corner radius of an Element with round corners, in pixels. */
export const CORNER_RADIUS = 12;

export function centreOf(outline: Outline): Point {
  return { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 };
}

/**
 * Where the ray from the outline's centre towards `from` leaves the outline.
 * `from` is the other end of the arrow, so the returned point is where the
 * line between the two ends meets the target's real edge.
 */
export function pointOnOutline(outline: Outline, from: Point): Point {
  const centre = centreOf(outline);
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  const a = outline.width / 2;
  const b = outline.height / 2;
  if (dx === 0 && dy === 0) {
    // Degenerate: the other end sits on the centre. Any outline point will do.
    return { x: centre.x, y: centre.y - b };
  }
  if (outline.type === 'ellipse') {
    const scale = 1 / Math.hypot(dx / a, dy / b);
    return { x: centre.x + dx * scale, y: centre.y + dy * scale };
  }
  if (outline.type === 'diamond') {
    const scale = 1 / (Math.abs(dx) / a + Math.abs(dy) / b);
    return { x: centre.x + dx * scale, y: centre.y + dy * scale };
  }
  return rectanglePoint(outline, centre, dx, dy, a, b);
}

function rectanglePoint(
  outline: Outline,
  centre: Point,
  dx: number,
  dy: number,
  a: number,
  b: number,
): Point {
  const scale = Math.min(
    dx === 0 ? Infinity : a / Math.abs(dx),
    dy === 0 ? Infinity : b / Math.abs(dy),
  );
  const straight = { x: centre.x + dx * scale, y: centre.y + dy * scale };
  const radius = Math.min(CORNER_RADIUS, a, b);
  if (outline.corners === 'sharp' || radius === 0) {
    return straight;
  }
  const insideCorner =
    Math.abs(straight.x - centre.x) > a - radius && Math.abs(straight.y - centre.y) > b - radius;
  if (!insideCorner) {
    return straight;
  }
  // The ray leaves through the rounded corner arc, not the straight edge: solve
  // the ray against the circle that rounds that corner.
  const corner = {
    x: centre.x + Math.sign(dx) * (a - radius),
    y: centre.y + Math.sign(dy) * (b - radius),
  };
  const ux = centre.x - corner.x;
  const uy = centre.y - corner.y;
  const qa = dx * dx + dy * dy;
  const qb = 2 * (ux * dx + uy * dy);
  const qc = ux * ux + uy * uy - radius * radius;
  const root = Math.sqrt(Math.max(qb * qb - 4 * qa * qc, 0));
  const t = Math.max((-qb + root) / (2 * qa), (-qb - root) / (2 * qa));
  return { x: centre.x + dx * t, y: centre.y + dy * t };
}

/** Unit vector from `from` to `to`; a zero-length line points right, so it still draws the same every run. */
export function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
}

/** A head triangle: the apex on the end, its base behind it, along the arrow. */
export function arrowHeadTriangle(
  apex: Point,
  direction: Point,
  length: number,
): [Point, Point, Point] {
  const half = length * 0.45;
  const base = { x: apex.x - direction.x * length, y: apex.y - direction.y * length };
  const normal = { x: -direction.y, y: direction.x };
  return [
    apex,
    { x: base.x + normal.x * half, y: base.y + normal.y * half },
    { x: base.x - normal.x * half, y: base.y - normal.y * half },
  ];
}

/** A bar head: a short stroke across the end, perpendicular to the arrow. */
export function barThrough(
  apex: Point,
  direction: Point,
  halfLength: number,
): [Point, Point] {
  const normal = { x: -direction.y, y: direction.x };
  return [
    { x: apex.x + normal.x * halfLength, y: apex.y + normal.y * halfLength },
    { x: apex.x - normal.x * halfLength, y: apex.y - normal.y * halfLength },
  ];
}
