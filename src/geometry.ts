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
 *
 * Where a shaft's Label sits is the same kind of pure arithmetic, and it lives
 * here so the drawing and the editor's drag place the words with one rule.
 *
 * A shaft of two or more points resolves here too: the ends a Snap moves, the
 * runs that bend `round` into one smooth curve, the corners that `sharp`
 * softens with a small fillet, and the arc-length measure the Label, the arrow
 * heads and the page bounds all read. One owner for that path is what keeps the
 * ink, the heads pointing along it and the words on it from drifting apart.
 */
import type { Corner, Point } from './scene.js';

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

function centreOf(outline: Outline): Point {
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
function cornerRadius(outline: Outline): number {
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
function pointOnOutline(outline: Outline, from: Point): Point {
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
 * How many points one walk around an outline samples. Fine enough that two bars
 * crossing at their middles find a pairing, and short enough to stay a cheap
 * loop in a Renderer.
 */
const OUTLINE_WALK = 72;

/**
 * The two ends an arrow or line draws, each Snapped end moved onto its target's
 * outline. An end aims at the other end's target centre when that end is
 * Snapped too, or at the other end itself when it is free.
 *
 * Two targets may overlap, so the two outline points can land the wrong way
 * round along the line between their centres, or on the same point. The start
 * end then leaves its own outline on the far side from the end target; if even
 * that point cannot reach the end target, another pair of true outline points
 * is walked out, so the shaft still runs into the end target and its head still
 * points into it. Only a target drawn wholly inside the other has no such pair:
 * then the two ends keep the points on the line between the centres, which is
 * all the two outlines offer.
 */
function settledEnds(
  points: readonly [Point, Point],
  startTarget: Outline | undefined,
  endTarget: Outline | undefined,
): [Point, Point] {
  const [start, end] = points;
  const from = outlineEnd(start, startTarget, end, endTarget);
  const to = outlineEnd(end, endTarget, start, startTarget);
  if (startTarget === undefined || endTarget === undefined) {
    return [from, to];
  }
  const startCentre = centreOf(startTarget);
  const endCentre = centreOf(endTarget);
  const fits = (head: Point, tip: Point): boolean =>
    !runsAgainst(head, tip, startCentre, endCentre) && entersTarget(head, tip, endTarget);
  if (fits(from, to)) {
    return [from, to];
  }
  const behind = { x: 2 * startCentre.x - endCentre.x, y: 2 * startCentre.y - endCentre.y };
  const flipped = pointOnOutline(startTarget, behind);
  if (fits(flipped, to)) {
    return [flipped, to];
  }
  return anotherShaft(startTarget, endTarget) ?? [from, to];
}

/**
 * Another pair of true outline points for two targets the centre line cannot
 * join: the start target's outline is walked from its right-hand point and on
 * clockwise, with the end aiming at each point in turn, and the first point the
 * end can be reached from outside wins. Two crossed bars land on a shaft from
 * one bar's outer edge into the other's, rather than a stub.
 */
function anotherShaft(startTarget: Outline, endTarget: Outline): [Point, Point] | null {
  const centre = centreOf(startTarget);
  const reach = Math.hypot(startTarget.width, startTarget.height) + 1;
  for (let step = 0; step < OUTLINE_WALK; step += 1) {
    const turn = (2 * Math.PI * step) / OUTLINE_WALK;
    const head = pointOnOutline(startTarget, {
      x: centre.x + Math.cos(turn) * reach,
      y: centre.y + Math.sin(turn) * reach,
    });
    const tip = pointOnOutline(endTarget, head);
    if (entersTarget(head, tip, endTarget)) {
      return [head, tip];
    }
  }
  return null;
}

/**
 * Whether a shaft from one outline point to another arrives inside the end
 * target, so the head the Renderer builds on it points into the target: the
 * start is outside the target, and a step past the end point is inside it while
 * a step back from it is not. A shaft that lands and stops — the two outlines
 * meeting, or a stub inside the target — fails, because its step back is inside
 * too.
 */
function entersTarget(head: Point, tip: Point, target: Outline): boolean {
  const length = Math.hypot(tip.x - head.x, tip.y - head.y);
  if (length === 0 || insideOutline(target, head)) {
    return false;
  }
  const direction = { x: (tip.x - head.x) / length, y: (tip.y - head.y) / length };
  const probe = Math.min(0.5, Math.min(target.width, target.height) / 2);
  const ahead = { x: tip.x + direction.x * probe, y: tip.y + direction.y * probe };
  const behind = { x: tip.x - direction.x * probe, y: tip.y - direction.y * probe };
  return insideOutline(target, ahead) && !insideOutline(target, behind);
}

/** One end, moved onto its target's outline, aiming at the other end. */
function outlineEnd(
  point: Point,
  target: Outline | undefined,
  otherPoint: Point,
  otherTarget: Outline | undefined,
): Point {
  if (target === undefined) {
    return { x: point.x, y: point.y };
  }
  return pointOnOutline(target, otherTarget === undefined ? otherPoint : centreOf(otherTarget));
}

/** Whether the drawn shaft runs against the line from the first centre to the second. */
function runsAgainst(from: Point, to: Point, fromCentre: Point, toCentre: Point): boolean {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const between = { x: toCentre.x - fromCentre.x, y: toCentre.y - fromCentre.y };
  return along.x * between.x + along.y * between.y < 0;
}

/**
 * Whether a point is inside an outline: the Element's shape, not the box around
 * it, so an ellipse's empty bounding-box corner is not under the pointer.
 */
export function insideOutline(outline: Outline, point: Point): boolean {
  const centre = centreOf(outline);
  const dx = point.x - centre.x;
  const dy = point.y - centre.y;
  if (outline.type === 'ellipse') {
    const a = outline.width / 2;
    const b = outline.height / 2;
    return (dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1 + 1e-9;
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return true;
  }
  const reach = boundaryReach(centre, { x: dx / length, y: dy / length }, fillets(outline));
  return length <= reach + 1e-9;
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
function unit(from: Point, to: Point): Point {
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

/**
 * The side of a shaft a Label sits on, as a unit normal: up where the shaft has
 * an upper side, and left where it is vertical. The rule depends on the
 * heading, not on which way the arrow points, so two arrows along one line keep
 * their words on the same side.
 */
function shaftSide(along: Point): Point {
  // The perpendicular that points up for a level shaft. On a diagonal only one
  // of the two perpendiculars points up, so take that one; a vertical shaft
  // points neither up nor down, so it takes the left.
  const normal = { x: along.y, y: -along.x };
  return normal.y > 0 || (normal.y === 0 && normal.x > 0)
    ? { x: -normal.x, y: -normal.y }
    : normal;
}

/**
 * The radius a `sharp` bend point is softened by, in pixels, and the most it
 * may take from either neighbouring segment. Small enough that an angled route
 * still reads as a corner, large enough that it never looks mechanically cut —
 * at `roughness: 0` as much as at 2.
 */
const FILLET_RADIUS = 7;

/** How many chords one curve is measured by, for its length and its extremes. */
const CURVE_STEPS = 32;

/**
 * How small a quadratic's square term may be, against the rest of it, before the
 * equation is read as the straight line it is: a shape 12 orders smaller than
 * its own coefficients carries no curvature a float can still resolve.
 */
const QUADRATIC_EPSILON = 1e-12;

/** How far along a curve the direction at a cusp is read from, as a fraction of the piece. */
const CURVE_TOUCH = 1e-3;

/** What every piece of a resolved shaft measures: an arc length from `from` to `to`. */
interface ShaftPieceBase {
  readonly from: Point;
  readonly to: Point;
  /** Arc length from `from` to `to`, so a caller never has to guess how long a piece is. */
  readonly length: number;
}

/** A straight run between two points. */
interface StraightPiece extends ShaftPieceBase {
  readonly kind: 'straight';
}

/** A cubic curve between two points, drawn by its two control points. */
interface CurvedPiece extends ShaftPieceBase {
  readonly kind: 'curved';
  readonly control1: Point;
  readonly control2: Point;
}

/** One piece of a resolved shaft: a straight run, or the cubic curve it bends by. */
type ShaftPiece = StraightPiece | CurvedPiece;

/** The box a resolved shaft covers, its bulge extremes included. */
interface ShaftBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An arrow's or line's shaft as it is really drawn: two or more points resolved
 * into straight runs, smooth curves and softened corners, measured once so the
 * ink, the heads and the words cannot disagree about where the shaft is.
 */
export interface ShaftPath {
  /** The end the shaft starts at, after Snap moved it. */
  readonly start: Point;
  /** The end it finishes at, after Snap moved it. */
  readonly end: Point;
  /** The pieces in drawing order: `start` to `end`, with nothing between them. */
  readonly pieces: readonly ShaftPiece[];
  /** Total arc length of every piece, so `t = 0.5` is the true middle of the ink. */
  readonly length: number;
  readonly bounds: ShaftBounds;
}

/**
 * Every point an arrow or line draws through: the two ends, each Snapped end
 * moved onto its target's outline, and every bend point where the Scene put it.
 *
 * An end with a bend point beside it aims at that point, which is the direction
 * the shaft actually leaves in; a two-point shaft has no bend point to aim at,
 * so it keeps the two-target arithmetic that settles overlapping outlines.
 */
function drawnPoints(
  points: readonly [Point, Point, ...Point[]],
  startTarget: Outline | undefined,
  endTarget: Outline | undefined,
): Point[] {
  const last = points.length - 1;
  if (last === 1) {
    return settledEnds([points[0], points[1]], startTarget, endTarget);
  }
  const drawn = points.map((point) => ({ x: point.x, y: point.y }));
  if (startTarget !== undefined) {
    drawn[0] = pointOnOutline(startTarget, points[1]);
  }
  if (endTarget !== undefined) {
    drawn[last] = pointOnOutline(endTarget, points[last - 1]!);
  }
  return drawn;
}

/**
 * The two ends a shaft draws between, each Snapped end moved onto its target's
 * outline: the ends the editor picks by, settled without measuring a single
 * curve between them.
 */
export function shaftEnds(
  points: readonly [Point, Point, ...Point[]],
  startTarget: Outline | undefined,
  endTarget: Outline | undefined,
): [Point, Point] {
  const drawn = drawnPoints(points, startTarget, endTarget);
  return [drawn[0]!, drawn[drawn.length - 1]!];
}

/**
 * The path a shaft draws through. Each middle point turns by its own `corner`:
 * consecutive `round` points form one continuous smooth curve, and a `sharp`
 * point breaks that curve into a corner softened by a short fillet. A point
 * that writes no corner takes the Element's, resolved here once so the ink, the
 * heads and the words cannot each fall back on their own answer.
 */
export function shaftPath(
  points: readonly [Point, Point, ...Point[]],
  corners: Corner,
  startTarget: Outline | undefined,
  endTarget: Outline | undefined,
): ShaftPath {
  const drawn = drawnPoints(points, startTarget, endTarget);
  const pieces = piecesOf(gathered(drawn, points, corners));
  const start = drawn[0]!;
  const end = drawn[drawn.length - 1]!;
  // A shaft whose points all sit on one another still draws its one point, so
  // the ends it reports and the ink it makes stay the same thing.
  const inked = pieces.length === 0 ? [straight(start, end)] : pieces;
  return {
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y },
    pieces: inked,
    length: inked.reduce((total, piece) => total + piece.length, 0),
    bounds: boundsOf(inked),
  };
}

/** One point a shaft draws through, and the corner it turns by; an end has no bend to style. */
interface ShaftPoint {
  readonly at: Point;
  readonly corner: Corner;
}

/**
 * The points to draw through, each with the corner it turns by, in drawing
 * order: a repeated point adds no ink and no direction, so it is dropped, and a
 * point that writes no corner takes the Element's.
 */
function gathered(
  drawn: readonly Point[],
  scene: readonly Point[],
  corners: Corner,
): ShaftPoint[] {
  const points: ShaftPoint[] = [];
  for (const [index, point] of drawn.entries()) {
    if (samePoint(points[points.length - 1]?.at, point)) {
      continue;
    }
    points.push({ at: { x: point.x, y: point.y }, corner: scene[index]?.corner ?? corners });
  }
  return points;
}

/**
 * The pieces a shaft is drawn as: each `sharp` middle point is cut out of the
 * run it sits in and comes back as a fillet, so the runs between corners are
 * smooth curves when they have a `round` point to bend by and straight lines
 * when they do not.
 */
function piecesOf(points: readonly ShaftPoint[]): ShaftPiece[] {
  if (points.length < 2) {
    return [];
  }
  const pieces: ShaftPiece[] = [];
  let run: Point[] = [points[0]!.at];
  for (let index = 1; index < points.length - 1; index += 1) {
    const bend = points[index]!;
    if (bend.corner === 'round') {
      run.push(bend.at);
      continue;
    }
    const [before, after] = filletEnds(points[index - 1]!.at, bend.at, points[index + 1]!.at);
    run.push(before);
    appendRun(pieces, run);
    pieces.push(
      curve(
        before,
        lerp(before, bend.at, 2 / 3),
        lerp(after, bend.at, 2 / 3),
        after,
      ),
    );
    run = [after];
  }
  run.push(points[points.length - 1]!.at);
  appendRun(pieces, run);
  return pieces;
}

/** One run added: straight between two points, and a smooth curve through three or more. */
function appendRun(pieces: ShaftPiece[], run: readonly Point[]): void {
  if (run.length === 2) {
    pieces.push(straight(run[0]!, run[1]!));
    return;
  }
  pieces.push(...smoothThrough(run));
}

/**
 * The curves one run of three or more points is drawn by: one centripetal
 * Catmull-Rom spline through every point of it.
 *
 * Knots are spaced by the square root of each chord (α = 0.5), and a point's
 * tangent is the tangent of the parabola through the three points around it, in
 * those knots. Spacing is the whole point: a bend point 1px from its neighbour
 * pulls with the weight of that short span instead of swinging the curve like a
 * lever, so a run of clustered points never stops and doubles back on itself.
 */
function smoothThrough(run: readonly Point[]): ShaftPiece[] {
  const spans = run.slice(0, -1).map((point, index) => span(point, run[index + 1]!));
  const tangents = run.map((point, index) => tangentAt(run, index, spans));
  const pieces: ShaftPiece[] = [];
  for (let index = 0; index + 1 < run.length; index += 1) {
    const from = run[index]!;
    const to = run[index + 1]!;
    const knot = spans[index]!;
    pieces.push(
      curve(
        from,
        plus(from, tangents[index]!, knot / 3),
        plus(to, tangents[index + 1]!, -knot / 3),
        to,
      ),
    );
  }
  return pieces;
}

/** The centripetal knot spacing of one chord: its length to the power α = 0.5. */
function span(from: Point, to: Point): number {
  return Math.sqrt(Math.hypot(to.x - from.x, to.y - from.y));
}

/**
 * The tangent the smooth curve passes by one point of the run with: the one-sided
 * secant at either end, and the knot-weighted average of the two secants around
 * a point in the middle. A zero tangent means the run doubles back here, and the
 * curve comes to a cusp its neighbours cannot smooth away.
 */
function tangentAt(run: readonly Point[], index: number, spans: readonly number[]): Point {
  const point = run[index]!;
  if (index === 0) {
    return secant(point, run[1]!, spans[0]!);
  }
  if (index === run.length - 1) {
    return secant(run[index - 1]!, point, spans[index - 1]!);
  }
  const before = spans[index - 1]!;
  const after = spans[index]!;
  const entering = secant(run[index - 1]!, point, before);
  const leaving = secant(point, run[index + 1]!, after);
  const total = before + after;
  return {
    x: (leaving.x * before + entering.x * after) / total,
    y: (leaving.y * before + entering.y * after) / total,
  };
}

/** How far along one knot spacing the run moves from one point to the next. */
function secant(from: Point, to: Point, knot: number): Point {
  return { x: (to.x - from.x) / knot, y: (to.y - from.y) / knot };
}

/** A straight piece, measured by the distance it spans. */
function straight(from: Point, to: Point): ShaftPiece {
  return { kind: 'straight', from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
}

/** A curve piece, measured along its own arc. */
function curve(from: Point, control1: Point, control2: Point, to: Point): ShaftPiece {
  const measured: CurvedPiece = { kind: 'curved', from, control1, control2, to, length: 0 };
  return { ...measured, length: curveLength(measured) };
}

/**
 * The two points a fillet leaves a `sharp` vertex by: `FILLET_RADIUS` back along
 * each leg, and never further than half of either one, so the two legs of a
 * tight corner cannot cross the arc or each other and the corner never inverts.
 * `gathered` dropped repeated points, so both legs have a length to halve.
 */
function filletEnds(previous: Point, vertex: Point, next: Point): [Point, Point] {
  const pullback = Math.min(
    FILLET_RADIUS,
    Math.hypot(vertex.x - previous.x, vertex.y - previous.y) / 2,
    Math.hypot(next.x - vertex.x, next.y - vertex.y) / 2,
  );
  return [along(vertex, previous, pullback), along(vertex, next, pullback)];
}

/** The point `distance` from `from` towards `to`, which are never the same point here. */
function along(from: Point, to: Point, distance: number): Point {
  return lerp(from, to, distance / Math.hypot(to.x - from.x, to.y - from.y));
}

/** `fraction` of the way from `from` to `to`. */
function lerp(from: Point, to: Point, fraction: number): Point {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

/** A point moved `fraction` of the way along a vector. */
function plus(point: Point, vector: Point, fraction: number): Point {
  return { x: point.x + vector.x * fraction, y: point.y + vector.y * fraction };
}

function samePoint(left: Point | undefined, right: Point): boolean {
  return left !== undefined && left.x === right.x && left.y === right.y;
}

/**
 * Where a fraction of the way along the drawn shaft lands: `t = 0` on its start,
 * `t = 1` on its end, and every fraction of its arc length in between, so a
 * curve and a straight shaft are measured by the same rule.
 */
function shaftPointAt(path: ShaftPath, t: number): Point {
  const found = placeOn(path, t);
  return pointOf(found.piece, found.u);
}

/** The unit direction the shaft points in at a fraction of the way along it. */
export function shaftTangentAt(path: ShaftPath, t: number): Point {
  const found = placeOn(path, t);
  if (found.piece.kind === 'straight') {
    return unit(found.piece.from, found.piece.to);
  }
  const tangent = tangentOf(found.piece, found.u);
  if (tangent.x !== 0 || tangent.y !== 0) {
    return unit({ x: 0, y: 0 }, tangent);
  }
  // A cusp: the derivative vanishes where the shaft stops and turns back on
  // itself, so read the direction from the ink a hair before it — or after it,
  // at the very start. Falling back on "rightwards" would turn a vertical
  // shaft's Label up instead of keeping it beside the ink.
  const reach = found.u > CURVE_TOUCH ? found.u - CURVE_TOUCH : found.u + CURVE_TOUCH;
  const here = pointOf(found.piece, found.u);
  const there = pointOf(found.piece, reach);
  return found.u > CURVE_TOUCH ? unit(there, here) : unit(here, there);
}

/** A piece and how far along it a fraction of the shaft lands. */
function placeOn(path: ShaftPath, t: number): { piece: ShaftPiece; u: number } {
  let remained = Math.min(1, Math.max(0, t)) * path.length;
  for (const [index, piece] of path.pieces.entries()) {
    if (remained <= piece.length || index === path.pieces.length - 1) {
      return { piece, u: uAt(piece, remained) };
    }
    remained -= piece.length;
  }
  return { piece: path.pieces[0]!, u: 0 };
}

/** How far along a piece, as its own parameter, a distance from its start lands. */
function uAt(piece: ShaftPiece, distance: number): number {
  if (piece.kind === 'straight') {
    return piece.length === 0 ? 0 : Math.min(1, Math.max(0, distance / piece.length));
  }
  let travelled = 0;
  let previous = piece.from;
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const u = step / CURVE_STEPS;
    const point = pointOf(piece, u);
    const chord = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (travelled + chord >= distance || step === CURVE_STEPS) {
      const inside = chord === 0 ? 0 : (distance - travelled) / chord;
      return (step - 1 + Math.min(1, Math.max(0, inside))) / CURVE_STEPS;
    }
    travelled += chord;
    previous = point;
  }
  return 1;
}

/** The point a piece reaches at its own parameter `u`. */
function pointOf(piece: ShaftPiece, u: number): Point {
  if (piece.kind === 'straight') {
    return lerp(piece.from, piece.to, u);
  }
  const rest = 1 - u;
  const before = rest * rest * rest;
  const first = 3 * rest * rest * u;
  const second = 3 * rest * u * u;
  const last = u * u * u;
  return {
    x:
      piece.from.x * before +
      piece.control1.x * first +
      piece.control2.x * second +
      piece.to.x * last,
    y:
      piece.from.y * before +
      piece.control1.y * first +
      piece.control2.y * second +
      piece.to.y * last,
  };
}

/** The derivative of a curve piece at its own parameter `u`, before it is normalised. */
function tangentOf(piece: CurvedPiece, u: number): Point {
  const rest = 1 - u;
  const before = 3 * rest * rest;
  const first = 6 * rest * u;
  const second = 3 * u * u;
  return {
    x:
      (piece.control1.x - piece.from.x) * before +
      (piece.control2.x - piece.control1.x) * first +
      (piece.to.x - piece.control2.x) * second,
    y:
      (piece.control1.y - piece.from.y) * before +
      (piece.control2.y - piece.control1.y) * first +
      (piece.to.y - piece.control2.y) * second,
  };
}

/** The arc length of a curve piece, as the chords it is walked by add up to. */
function curveLength(piece: CurvedPiece): number {
  let length = 0;
  let previous = piece.from;
  for (let step = 1; step <= CURVE_STEPS; step += 1) {
    const point = pointOf(piece, step / CURVE_STEPS);
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return length;
}

/** The box every piece covers, at the extremes its curves really reach. */
function boundsOf(pieces: readonly ShaftPiece[]): ShaftBounds {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  const reach = (x: number, y: number): void => {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  };
  for (const piece of pieces) {
    reach(piece.from.x, piece.from.y);
    reach(piece.to.x, piece.to.y);
    if (piece.kind === 'straight') {
      continue;
    }
    for (const axis of ['x', 'y'] as const) {
      for (const u of curveTurns(piece, axis)) {
        const point = pointOf(piece, u);
        reach(point.x, point.y);
      }
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where a curve piece turns back on one axis: the roots of its derivative that
 * fall inside the piece, so a bulge past its ends is measured and never clipped.
 */
function curveTurns(piece: CurvedPiece, axis: 'x' | 'y'): number[] {
  const start = piece.from[axis];
  const control1 = piece.control1[axis];
  const control2 = piece.control2[axis];
  const end = piece.to[axis];
  return quadraticRoots(
    -start + 3 * control1 - 3 * control2 + end,
    2 * (start - 2 * control1 + control2),
    control1 - start,
  ).filter((u) => u > 0 && u < 1);
}

/**
 * The roots of `a·t² + b·t + c`. A cubic's extrema sit where its derivative
 * vanishes, and where the ink goes is what the page, the box and the picking all
 * read, so this solve keeps its precision: a square term that vanishes against
 * the others is read as the straight line it is, and the pair of roots is formed
 * without subtracting two numbers that nearly cancel.
 */
export function quadraticRoots(a: number, b: number, c: number): number[] {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (scale === 0) {
    return [];
  }
  if (Math.abs(a) <= QUADRATIC_EPSILON * scale) {
    return b === 0 ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(discriminant);
  const sum = -0.5 * (b + (b < 0 ? -root : root));
  if (sum === 0) {
    return [0];
  }
  const roots = [sum / a];
  const other = c / sum;
  if (other !== roots[0]) {
    roots.push(other);
  }
  return roots;
}

/**
 * Where a shaft's Label is centred: `t` of the way along the drawn shaft by arc
 * length, then `offset` pixels to its side. The offset is signed, so a positive
 * one is the side the Label Layout places by default sits on, and 0 is on the
 * shaft. The side is the local one, so the words follow the curve they sit on.
 */
export function shaftLabelAnchor(
  path: ShaftPath,
  labelAt: { t: number; offset: number },
): Point {
  const at = shaftPointAt(path, labelAt.t);
  const side = shaftSide(unit({ x: 0, y: 0 }, shaftTangentAt(path, labelAt.t)));
  return { x: at.x + side.x * labelAt.offset, y: at.y + side.y * labelAt.offset };
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
