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
const CORNER_RADIUS = 12;

export function centreOf(outline: Outline): Point {
  return { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 };
}

/**
 * One rounded vertex: the two points where the outline leaves the straight
 * edges, the arc's centre, and its radius. A sharp corner has radius 0 and both
 * points on the vertex itself.
 */
export interface Fillet {
  vertex: Point;
  before: Point;
  after: Point;
  centre: Point;
  radius: number;
}

/**
 * The radius a rounded Element actually draws with: one shared rule for the
 * Renderer's paths and for Snap, so the two cannot drift. A rectangle is
 * limited by its half-width and half-height; a diamond also by its edges, so
 * neighbouring fillets never meet. An ellipse has no corners to round.
 */
export function cornerRadius(outline: Outline): number {
  if (outline.corners === 'sharp' || outline.type === 'ellipse') {
    return 0;
  }
  const a = outline.width / 2;
  const b = outline.height / 2;
  const fit = Math.min(CORNER_RADIUS, a, b);
  if (outline.type === 'rectangle') {
    return fit;
  }
  const edge = Math.hypot(a, b);
  return Math.min(fit, (a * edge) / (2 * b), (b * edge) / (2 * a));
}

/** The four corners of an outline, in boundary order. */
function cornersOf(outline: Outline): Point[] {
  const { x, y, width, height } = outline;
  if (outline.type === 'rectangle') {
    return [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ];
  }
  const centre = centreOf(outline);
  return [
    { x: centre.x, y },
    { x: x + width, y: centre.y },
    { x: centre.x, y: y + height },
    { x, y: centre.y },
  ];
}

/**
 * Every vertex rounded by `cornerRadius`, in boundary order. A fillet of radius
 * r sits on the interior bisector where the two edges are r away from it, and
 * meets each edge where the arc is tangent to it, so a rectangle and a diamond
 * round the same way and at the same radius.
 */
export function fillets(outline: Outline): Fillet[] {
  const radius = cornerRadius(outline);
  const corners = cornersOf(outline);
  return corners.map((vertex, index) => {
    const previous = corners[(index + corners.length - 1) % corners.length]!;
    const next = corners[(index + 1) % corners.length]!;
    if (radius === 0) {
      return { vertex, before: vertex, after: vertex, centre: vertex, radius };
    }
    const inward = unit(vertex, previous);
    const onward = unit(vertex, next);
    const bisector = { x: inward.x + onward.x, y: inward.y + onward.y };
    const across = { x: inward.x - onward.x, y: inward.y - onward.y };
    const spread = Math.hypot(bisector.x, bisector.y);
    const opening = Math.hypot(across.x, across.y);
    const tangent = (radius * spread) / opening;
    const inset = (2 * radius) / (spread * opening);
    return {
      vertex,
      before: { x: vertex.x + inward.x * tangent, y: vertex.y + inward.y * tangent },
      after: { x: vertex.x + onward.x * tangent, y: vertex.y + onward.y * tangent },
      centre: { x: vertex.x + bisector.x * inset, y: vertex.y + bisector.y * inset },
      radius,
    };
  });
}

/**
 * Where the ray from the outline's centre towards `from` leaves the outline.
 * `from` is the other end of the arrow, so the returned point is where the
 * line between the two ends meets the target's real edge: an edge, or the arc
 * that rounds a corner.
 */
export function pointOnOutline(outline: Outline, from: Point): Point {
  const centre = centreOf(outline);
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  if (dx === 0 && dy === 0) {
    // Degenerate: the other end sits on the centre, so aim up and let the
    // outline decide where that lands.
    return pointOnOutline(outline, { x: centre.x, y: centre.y - outline.height });
  }
  if (outline.type === 'ellipse') {
    const a = outline.width / 2;
    const b = outline.height / 2;
    const scale = 1 / Math.hypot(dx / a, dy / b);
    return { x: centre.x + dx * scale, y: centre.y + dy * scale };
  }
  const corners = fillets(outline);
  const length = Math.hypot(dx, dy);
  const direction = { x: dx / length, y: dy / length };
  const reach = boundaryReach(centre, direction, corners);
  return { x: centre.x + direction.x * reach, y: centre.y + direction.y * reach };
}

/**
 * How far from `centre` along the unit `direction` a ray crosses the boundary
 * of a rounded outline: the nearest crossing of any straight run between two
 * fillets and any fillet arc.
 */
function boundaryReach(centre: Point, direction: Point, corners: Fillet[]): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const [index, corner] of corners.entries()) {
    const next = corners[(index + 1) % corners.length]!;
    const alongEdge = rayToSegment(centre, direction, corner.after, next.before);
    if (alongEdge !== null && alongEdge < nearest) {
      nearest = alongEdge;
    }
    const alongArc = rayToFillet(centre, direction, corner);
    if (alongArc !== null && alongArc < nearest) {
      nearest = alongArc;
    }
  }
  return nearest;
}

/** How far along `direction` a ray from `origin` meets the segment `from`-`to`. */
function rayToSegment(origin: Point, direction: Point, from: Point, to: Point): number | null {
  const edge = { x: to.x - from.x, y: to.y - from.y };
  const denominator = direction.x * edge.y - direction.y * edge.x;
  if (denominator === 0) {
    return null;
  }
  const offset = { x: from.x - origin.x, y: from.y - origin.y };
  const along = (offset.x * edge.y - offset.y * edge.x) / denominator;
  const across = (offset.x * direction.y - offset.y * direction.x) / denominator;
  if (along <= 0 || across < -1e-9 || across > 1 + 1e-9) {
    return null;
  }
  return along;
}

/** How far along `direction` a ray from `origin` meets a fillet's arc, if it meets it at all. */
function rayToFillet(origin: Point, direction: Point, fillet: Fillet): number | null {
  if (fillet.radius === 0) {
    return null;
  }
  const offset = { x: origin.x - fillet.centre.x, y: origin.y - fillet.centre.y };
  const along = offset.x * direction.x + offset.y * direction.y;
  const discriminant =
    along * along - (offset.x * offset.x + offset.y * offset.y - fillet.radius * fillet.radius);
  if (discriminant < 0) {
    return null;
  }
  const root = Math.sqrt(discriminant);
  for (const reach of [-along + root, -along - root]) {
    if (reach <= 0) {
      continue;
    }
    const point = { x: origin.x + direction.x * reach, y: origin.y + direction.y * reach };
    if (withinArc(fillet, point)) {
      return reach;
    }
  }
  return null;
}

/** Whether a point on a fillet's circle lies on the arc between its two tangent points. */
function withinArc(fillet: Fillet, point: Point): boolean {
  const sweep = halfTurn(arcAngle(fillet, fillet.after) - arcAngle(fillet, fillet.before));
  const reached = halfTurn(arcAngle(fillet, point) - arcAngle(fillet, fillet.before));
  return reached * sweep >= 0 && Math.abs(reached) <= Math.abs(sweep) + 1e-9;
}

function arcAngle(fillet: Fillet, point: Point): number {
  return Math.atan2(point.y - fillet.centre.y, point.x - fillet.centre.x);
}

/** An angle folded into (-pi, pi]. */
function halfTurn(angle: number): number {
  const turn = 2 * Math.PI;
  const folded = angle - turn * Math.floor((angle + Math.PI) / turn);
  return folded === -Math.PI ? Math.PI : folded;
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
