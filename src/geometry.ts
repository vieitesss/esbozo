import type { Anchor, Corner, Point } from './scene.js';
import type { Box } from './layout.js';

export interface Outline {
  type: 'rectangle' | 'ellipse' | 'diamond';
  x: number;
  y: number;
  width: number;
  height: number;
  corners: 'sharp' | 'round';
}

/**
 * The Element one end of a shaft is drawn on: its outline, and the Anchor that
 * says where on it the end sits. An end with no Anchor aims as it always did.
 */
export interface EndTarget {
  readonly outline: Outline;
  readonly anchor?: Anchor;
}

/** Which end of a Shaft a place is measured from. */
type End = 'start' | 'end';

const CORNER_RADIUS = 12;

function centreOf(outline: Outline): Point {
  return { x: outline.x + outline.width / 2, y: outline.y + outline.height / 2 };
}

export interface Fillet {
  vertex: Point;
  before: Point;
  after: Point;
  centre: Point;
  radius: number;
}

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
 * Where the line from the box's centre out through `from` leaves the outline:
 * the spot a named corner means, since an ellipse and a rounded box have no
 * corner where their box has one.
 */
export function pointOnOutline(outline: Outline, from: Point): Point {
  const centre = centreOf(outline);
  const dx = from.x - centre.x;
  const dy = from.y - centre.y;
  if (dx === 0 && dy === 0) {
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

const OUTLINE_WALK = 72;

/**
 * How near the outline a crossing walk leaves the ink: a quarter pixel, so the
 * ink stops outside the fill and no further from it than that. A walk counting
 * halvings instead bounds its own parameter, and a Scene's coordinates are only
 * required to be finite, so a long enough leg turns that into pixels by the
 * hundred.
 */
const CROSSING_PX = 0.25;

/** Halvings a crossing walk may take before it settles for the nearest it can measure. */
const CROSSING_STEPS = 60;

/** Angles the ellipse is walked at before the walk is narrowed. */
const ELLIPSE_WALK = 360;

/** Steps the ellipse walk is narrowed by, each a third of the span it has left. */
const ELLIPSE_STEPS = 48;

/**
 * The point of an outline nearest a place in its box: the place an Anchored end
 * is drawn at. A rectangle and a diamond are walked edge by edge and fillet by
 * fillet, and an ellipse is walked around and then narrowed, because the
 * nearest point of an ellipse has no closed form worth the arithmetic. Ties
 * take the earlier piece of the outline, so a shot through the very middle of a
 * rectangle — the same distance from all four edges — lands on the top one.
 * The middle of an ellipse's box has no nearest point to take: every point of a
 * circle is the same distance from it, and the walk decides which one wins.
 */
function nearestOnOutline(outline: Outline, spot: Point): Point {
  if (outline.type === 'ellipse') {
    return nearestOnEllipse(outline, spot);
  }
  const corners = fillets(outline);
  // Replaced by the first candidate, which every convex outline has.
  let best: Point = corners[0]!.vertex;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [index, corner] of corners.entries()) {
    const next = corners[(index + 1) % corners.length]!;
    for (const candidate of [onSegment(corner.after, next.before, spot), onArc(corner, spot)]) {
      if (candidate === null) {
        continue;
      }
      const distance = Math.hypot(candidate.x - spot.x, candidate.y - spot.y);
      if (distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** The closest point of a segment to `spot`: the perpendicular foot, held to its ends. */
function onSegment(from: Point, to: Point, spot: Point): Point {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const squared = along.x * along.x + along.y * along.y;
  if (squared === 0) {
    return { x: from.x, y: from.y };
  }
  const raw = ((spot.x - from.x) * along.x + (spot.y - from.y) * along.y) / squared;
  const along01 = Math.min(1, Math.max(0, raw));
  return { x: from.x + along.x * along01, y: from.y + along.y * along01 };
}

/** The closest point of a fillet's arc to `spot`, or null where its foot is off the arc. */
function onArc(fillet: Fillet, spot: Point): Point | null {
  const offset = { x: spot.x - fillet.centre.x, y: spot.y - fillet.centre.y };
  const length = Math.hypot(offset.x, offset.y);
  if (fillet.radius === 0 || length === 0) {
    return null;
  }
  const point = {
    x: fillet.centre.x + (offset.x / length) * fillet.radius,
    y: fillet.centre.y + (offset.y / length) * fillet.radius,
  };
  return withinArc(fillet, point) ? point : null;
}

function nearestOnEllipse(outline: Outline, spot: Point): Point {
  const centre = centreOf(outline);
  const a = outline.width / 2;
  const b = outline.height / 2;
  const at = (angle: number): Point => ({
    x: centre.x + a * Math.cos(angle),
    y: centre.y + b * Math.sin(angle),
  });
  const reach = (angle: number): number => {
    const point = at(angle);
    return Math.hypot(point.x - spot.x, point.y - spot.y);
  };

  let best = 0;
  let bestReach = Number.POSITIVE_INFINITY;
  for (let step = 0; step < ELLIPSE_WALK; step += 1) {
    const angle = (2 * Math.PI * step) / ELLIPSE_WALK;
    const distance = reach(angle);
    if (distance < bestReach) {
      best = angle;
      bestReach = distance;
    }
  }

  // One step either side of the nearest sample holds the nearest point: the
  // walk is fine enough that the distance only ever falls towards it.
  let low = best - 2 * Math.PI / ELLIPSE_WALK;
  let high = best + 2 * Math.PI / ELLIPSE_WALK;
  for (let step = 0; step < ELLIPSE_STEPS; step += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    if (reach(left) < reach(right)) {
      high = right;
    } else {
      low = left;
    }
  }
  return at((low + high) / 2);
}

/**
 * Where an Anchor is drawn on an outline: the outline point nearest the place
 * the fraction names in the box. The Renderer draws Anchored ends here and `ez
 * check` asks the same function whether two ends of one shaft are drawn apart,
 * so a refusal and a drawing cannot disagree about where an end lands.
 */
export function anchorPoint(outline: Outline, anchor: Anchor): Point {
  return nearestOnOutline(outline, {
    x: outline.x + anchor.x * outline.width,
    y: outline.y + anchor.y * outline.height,
  });
}

/**
 * The Anchor that names where a point on an outline sits, the inverse of
 * `anchorPoint`: the outline point nearest the one given, as fractions of the
 * box. The editor writes one whenever it attaches an end, and `ez anchor --all`
 * freezes every end where it draws, so both name a place the Renderer draws back
 * where the person saw it.
 */
export function anchorOf(outline: Outline, point: Point): Anchor {
  const spot = nearestOnOutline(outline, point);
  return {
    x: fractionAcross(spot.x - outline.x, outline.width),
    y: fractionAcross(spot.y - outline.y, outline.height),
  };
}

/**
 * How far across a box a point sits, as a fraction of that side, rounded to the
 * decimals that put the drawn point back within half a pixel of where it was.
 * Each axis stays inside 1/√2 px, so the two together move the point at most
 * 0.5 px, and a box too small to round further keeps the fractions it can.
 */
function fractionAcross(offset: number, side: number): number {
  if (side <= 0) {
    return 0;
  }
  // Rounding to `places` decimals moves the spot by at most side / 10 ** places
  // / 2 along this side. Rounding up from log10(side √2) keeps that under 1/√2.
  const places = Math.max(0, Math.ceil(Math.log10(side * Math.SQRT2)));
  const scale = 10 ** places;
  return Math.min(1, Math.max(0, Math.round((offset / side) * scale) / scale));
}

/**
 * Where an Anchored end is drawn: the outline point nearest the place its
 * Anchor names in the target's box.
 */
function anchoredPoint(target: EndTarget | undefined): Point | null {
  if (target === undefined || target.anchor === undefined) {
    return null;
  }
  return anchorPoint(target.outline, target.anchor);
}

function settledEnds(
  points: readonly [Point, Point],
  startTarget: EndTarget | undefined,
  endTarget: EndTarget | undefined,
): [Point, Point] {
  const [start, end] = points;
  const from = endOf(start, startTarget, end, endTarget);
  const to = endOf(end, endTarget, start, startTarget);
  if (startTarget === undefined || endTarget === undefined) {
    return [from, to];
  }
  if (startTarget.anchor !== undefined || endTarget.anchor !== undefined) {
    return [from, to];
  }
  const startCentre = centreOf(startTarget.outline);
  const endCentre = centreOf(endTarget.outline);
  const fits = (head: Point, tip: Point): boolean =>
    !runsAgainst(head, tip, startCentre, endCentre) && entersTarget(head, tip, endTarget.outline);
  if (fits(from, to)) {
    return [from, to];
  }
  const behind = { x: 2 * startCentre.x - endCentre.x, y: 2 * startCentre.y - endCentre.y };
  const flipped = pointOnOutline(startTarget.outline, behind);
  if (fits(flipped, to)) {
    return [flipped, to];
  }
  return anotherShaft(startTarget.outline, endTarget.outline) ?? [from, to];
}

/**
 * One end of a two-point shaft: where its Anchor draws it, or the rule an end
 * with no Anchor has always taken — towards the other end's target centre, or
 * towards the other end's own point when that end is free.
 */
function endOf(
  point: Point,
  target: EndTarget | undefined,
  otherPoint: Point,
  otherTarget: EndTarget | undefined,
): Point {
  return (
    anchoredPoint(target) ?? outlineEnd(point, target?.outline, otherPoint, otherTarget?.outline)
  );
}

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

function runsAgainst(from: Point, to: Point, fromCentre: Point, toCentre: Point): boolean {
  const along = { x: to.x - from.x, y: to.y - from.y };
  const between = { x: toCentre.x - fromCentre.x, y: toCentre.y - fromCentre.y };
  return along.x * between.x + along.y * between.y < 0;
}

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

function withinArc(fillet: Fillet, point: Point): boolean {
  const sweep = halfTurn(arcAngle(fillet, fillet.after) - arcAngle(fillet, fillet.before));
  const reached = halfTurn(arcAngle(fillet, point) - arcAngle(fillet, fillet.before));
  return reached * sweep >= 0 && Math.abs(reached) <= Math.abs(sweep) + 1e-9;
}

function arcAngle(fillet: Fillet, point: Point): number {
  return Math.atan2(point.y - fillet.centre.y, point.x - fillet.centre.x);
}

function halfTurn(angle: number): number {
  const turn = 2 * Math.PI;
  const folded = angle - turn * Math.floor((angle + Math.PI) / turn);
  return folded === -Math.PI ? Math.PI : folded;
}

function unit(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length };
}

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

export function shaftSide(along: Point): Point {
  const length = Math.hypot(along.x, along.y);
  if (length === 0) {
    return { x: 0, y: -1 };
  }
  const normal = { x: along.y / length, y: -along.x / length };
  return normal.y > 0 || (normal.y === 0 && normal.x > 0)
    ? { x: -normal.x, y: -normal.y }
    : normal;
}

const FILLET_RADIUS = 7;

const CURVE_FLATNESS = 0.1;

const CURVE_MIN_STEPS = 16;
const CURVE_MAX_STEPS = 1024;

const CURVE_SOLVE_STEPS = 40;

/**
 * How small a quadratic's square term may be, against the rest of it, before the
 * equation is read as the straight line it is: a shape 12 orders smaller than
 * its own coefficients carries no curvature a float can still resolve.
 */
const QUADRATIC_EPSILON = 1e-12;

const CURVE_TOUCH = 1e-3;

interface ShaftPieceBase {
  readonly from: Point;
  readonly to: Point;
  readonly length: number;
}

interface StraightPiece extends ShaftPieceBase {
  readonly kind: 'straight';
}

interface CurvedPiece extends ShaftPieceBase {
  readonly kind: 'curved';
  readonly control1: Point;
  readonly control2: Point;
  /**
   * The arc length at each of the piece's own steps: `arcs[i]` is the length
   * from `from` to the point at `u = i / (arcs.length - 1)`, so the last one is
   * the whole piece. Measured once, so nothing has to walk the curve again.
   */
  readonly arcs: readonly number[];
}

export type ShaftPiece = StraightPiece | CurvedPiece;

interface ShaftBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShaftPath {
  readonly start: Point;
  readonly end: Point;
  readonly pieces: readonly ShaftPiece[];
  readonly segments: readonly ShaftSegment[];
  readonly length: number;
  readonly bounds: ShaftBounds;
}

interface ShaftSegment {
  readonly index: number;
  readonly from: number;
  readonly to: number;
}

interface ShaftDot {
  readonly at: Point;
  readonly index: number;
}

interface DrawnPoints {
  /** Every point the ink runs through, with each end landed on its outline. */
  readonly drawn: Point[];
  /** The target a covered end stops at, or null where its ink runs free. */
  readonly covered: { readonly start: Outline | null; readonly end: Outline | null };
}

/**
 * The points a Shaft is drawn through: each Snapped end landed on its target's
 * outline, at its Anchor or where the rule for an end without one puts it. An
 * end whose neighbouring point a move carried inside the target it Snaps to is
 * reported as covered, and the ink stops where it enters that target.
 */
function drawnPoints(
  points: readonly [Point, Point, ...Point[]],
  startTarget: EndTarget | undefined,
  endTarget: EndTarget | undefined,
): DrawnPoints {
  const last = points.length - 1;
  const covered: { start: Outline | null; end: Outline | null } = { start: null, end: null };
  if (last === 1) {
    return { drawn: settledEnds([points[0], points[1]], startTarget, endTarget), covered };
  }
  const drawn = points.map((point) => ({ x: point.x, y: point.y }));
  const loop = points[0].snap !== undefined && points[0].snap === points[last]!.snap;
  const anchoredStart = anchoredPoint(startTarget);
  const anchoredEnd = anchoredPoint(endTarget);
  if (
    last === 2 &&
    loop &&
    startTarget !== undefined &&
    anchoredStart === null &&
    anchoredEnd === null
  ) {
    [drawn[0], drawn[last]] = loopEnds(startTarget.outline, points[1]);
    return { drawn, covered };
  }
  // Both ends land on their outlines before either is cut, so the ink a covered
  // end stops at is the ink drawn from where the other end draws, not from the
  // place the Scene still stores for it.
  if (anchoredStart !== null) {
    drawn[0] = anchoredStart;
  } else if (startTarget !== undefined) {
    covered.start = landedEnd(drawn, points, 0, startTarget.outline, loop);
  }
  if (anchoredEnd !== null) {
    drawn[last] = anchoredEnd;
  } else if (endTarget !== undefined) {
    covered.end = landedEnd(drawn, points, last, endTarget.outline, loop);
  }
  return { drawn, covered };
}

/**
 * Lands a Snapped end on its target's outline and says which target still has
 * ink to cut, or null where the end already sits where the ink is drawn. An end
 * whose neighbour is the target's own middle gives the aim no direction, so
 * `pointOnOutline` falls back on a point of its own invention — an ellipse's
 * top — and the spline through that fallback curls back out across the fill.
 * Such an end is put where the build before this change put it: where the leg
 * reaching it from outside crosses the outline, with the points the walk covered
 * collapsed onto it. The ink then stops on the outline, and no cut is left to
 * make.
 */
function landedEnd(
  drawn: Point[],
  points: readonly [Point, Point, ...Point[]],
  end: number,
  target: Outline,
  loop: boolean,
): Outline | null {
  const step = end === 0 ? 1 : -1;
  const beside = points[end + step]!;
  drawn[end] = pointOnOutline(target, beside);
  if (loop || !insideOutline(target, beside)) {
    return null;
  }
  if (!samePoint(centreOf(target), beside)) {
    return target;
  }
  let outside = -1;
  for (let index = end + step; index >= 0 && index < points.length; index += step) {
    if (!insideOutline(target, points[index]!)) {
      outside = index;
      break;
    }
  }
  if (outside === -1) {
    return null;
  }
  const tip = crossingInto(target, points[outside]!, points[outside - step]!);
  for (let index = end; index !== outside; index += step) {
    drawn[index] = { x: tip.x, y: tip.y };
  }
  return null;
}

/**
 * How far along the ink a covered end enters its target. The walk starts at
 * that end, which is drawn on the outline, and reads the ink itself: the first
 * place the curve is outside the target is where the ink has to stop.
 */
function entryAlong(pieces: readonly ShaftPiece[], target: Outline, side: End): number | null {
  const outward = side === 'start' ? 1 : -1;
  const start = side === 'start' ? 0 : pieces.length - 1;
  const starts: number[] = [];
  let walked = 0;
  for (const piece of pieces) {
    starts.push(walked);
    walked += piece.length;
  }
  for (let index = start; index >= 0 && index < pieces.length; index += outward) {
    const piece = pieces[index]!;
    const beyond = side === 'start' ? piece.to : piece.from;
    if (!insideOutline(target, beyond)) {
      return starts[index]! + arcAt(piece, entrySides(piece, target, side).outside);
    }
  }
  return null;
}

/**
 * The fraction of a piece where it crosses into `target`, answered on both
 * sides: the piece is known to be inside the target at one end and outside it
 * at the other, so the walk halves the span until the two are `CROSSING_PX`
 * apart and no ink runs on into the fill.
 */
function entrySides(
  piece: ShaftPiece,
  target: Outline,
  side: End,
): { inside: number; outside: number } {
  let inside = side === 'start' ? 0 : 1;
  let outside = side === 'start' ? 1 : 0;
  for (let step = 0; step < CROSSING_STEPS; step += 1) {
    const middle = (inside + outside) / 2;
    if (insideOutline(target, pointOf(piece, middle))) {
      inside = middle;
    } else {
      outside = middle;
    }
    const reached = pointOf(piece, outside);
    const nearly = pointOf(piece, inside);
    if (Math.hypot(nearly.x - reached.x, nearly.y - reached.y) <= CROSSING_PX) {
      break;
    }
  }
  return { inside, outside };
}

/**
 * Where the leg between a point outside an outline and one inside it crosses the
 * outline: read on a straight piece, so the same quarter pixel that stops a cut
 * stops this walk, and answered on the inside, where the ink ends.
 */
function crossingInto(target: Outline, outside: Point, inside: Point): Point {
  const leg = straight(outside, inside);
  return pointOf(leg, entrySides(leg, target, 'end').inside);
}

/**
 * The ink cut at a distance along it, counted from one end: the piece the cut
 * falls in keeps the curve it was drawn on, so the ink left before it holds the
 * control points it always had.
 */
function cutAt(pieces: readonly ShaftPiece[], distance: number, side: End): ShaftPiece[] {
  const kept: ShaftPiece[] = [];
  let walked = 0;
  for (const piece of pieces) {
    const from = walked;
    const to = walked + piece.length;
    walked = to;
    if (side === 'end') {
      if (from >= distance) {
        break;
      }
      kept.push(sliceOf(piece, 0, uAt(piece, Math.min(distance, to) - from)));
      continue;
    }
    if (to <= distance) {
      continue;
    }
    kept.push(sliceOf(piece, uAt(piece, Math.max(distance, from) - from), 1));
  }
  return kept;
}

/** The segments the same cut leaves, in the arc lengths the shorter ink keeps. */
function cutSegments(
  segments: readonly ShaftSegment[],
  distance: number,
  side: End,
): ShaftSegment[] {
  if (side === 'end') {
    return segments
      .filter((segment) => segment.from < distance)
      .map((segment) => ({ ...segment, to: Math.min(segment.to, distance) }));
  }
  return segments
    .filter((segment) => segment.to > distance)
    .map((segment) => ({
      ...segment,
      from: Math.max(segment.from, distance) - distance,
      to: segment.to - distance,
    }));
}

function loopEnds(target: Outline, bend: Point): [Point, Point] {
  const centre = centreOf(target);
  const through = unit(centre, bend);
  const across = { x: -through.y, y: through.x };
  const spread = Math.max(
    Math.min(target.width, target.height) / 2,
    Math.hypot(bend.x - centre.x, bend.y - centre.y),
  );
  return [
    pointOnOutline(target, { x: bend.x + across.x * spread, y: bend.y + across.y * spread }),
    pointOnOutline(target, { x: bend.x - across.x * spread, y: bend.y - across.y * spread }),
  ];
}

export function shaftPath(
  points: readonly [Point, Point, ...Point[]],
  corners: Corner,
  startTarget: EndTarget | undefined,
  endTarget: EndTarget | undefined,
): ShaftPath {
  const { drawn, covered } = drawnPoints(points, startTarget, endTarget);
  const whole = piecesOf(gathered(drawn, points, corners));
  // Both entries are measured on the whole ink, so a cut at one end says nothing
  // about where the other end's crossing lies.
  const entries: [number | null, number | null] = [
    covered.start === null ? null : entryAlong(whole.pieces, covered.start, 'start'),
    covered.end === null ? null : entryAlong(whole.pieces, covered.end, 'end'),
  ];
  let { pieces, segments } = whole;
  for (const [side, entry] of [
    ['end', entries[1]],
    ['start', entries[0]],
  ] as const) {
    if (entry !== null) {
      pieces = cutAt(pieces, entry, side);
      segments = cutSegments(segments, entry, side);
    }
  }
  const first = pieces[0]?.from ?? drawn[0]!;
  const last = pieces[pieces.length - 1]?.to ?? drawn[drawn.length - 1]!;
  const inked = pieces.length === 0 ? [straight(first, last)] : pieces;
  return {
    start: { x: first.x, y: first.y },
    end: { x: last.x, y: last.y },
    pieces: inked,
    segments,
    length: inked.reduce((total, piece) => total + piece.length, 0),
    bounds: boundsOf(inked),
  };
}

export function shaftDots(path: ShaftPath): ShaftDot[] {
  return path.segments.map((segment) => ({
    at: pointAt(path, (segment.from + segment.to) / 2),
    index: segment.index,
  }));
}

interface ShaftPoint {
  readonly at: Point;
  readonly corner: Corner;
  readonly index: number;
}

export function cornerOf(point: Point | undefined, corners: Corner): Corner {
  return point?.corner ?? corners;
}

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
    points.push({ at: { x: point.x, y: point.y }, corner: cornerOf(scene[index], corners), index });
  }
  return points;
}

function piecesOf(points: readonly ShaftPoint[]): {
  pieces: ShaftPiece[];
  segments: ShaftSegment[];
} {
  const pieces: ShaftPiece[] = [];
  const segments: ShaftSegment[] = [];
  if (points.length < 2) {
    return { pieces, segments };
  }
  let run: ShaftPoint[] = [points[0]!];
  let walked = 0;
  const flush = (): void => {
    for (const [step, piece] of piecesThrough(run.map((point) => point.at)).entries()) {
      pieces.push(piece);
      segments.push({
        index: run[step + 1]!.index,
        from: walked,
        to: walked + piece.length,
      });
      walked += piece.length;
    }
  };
  for (let index = 1; index < points.length - 1; index += 1) {
    const bend = points[index]!;
    if (bend.corner === 'round') {
      run.push(bend);
      continue;
    }
    const [before, after] = filletEnds(points[index - 1]!.at, bend.at, points[index + 1]!.at);
    run.push({ ...bend, at: before });
    flush();
    const corner = curve(before, lerp(before, bend.at, 2 / 3), lerp(after, bend.at, 2 / 3), after);
    pieces.push(corner);
    walked += corner.length;
    run = [{ ...bend, at: after }];
  }
  run.push(points[points.length - 1]!);
  flush();
  return { pieces, segments };
}

function piecesThrough(run: readonly Point[]): ShaftPiece[] {
  if (run.length === 2) {
    return [straight(run[0]!, run[1]!)];
  }
  return smoothThrough(run);
}

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

function secant(from: Point, to: Point, knot: number): Point {
  return { x: (to.x - from.x) / knot, y: (to.y - from.y) / knot };
}

export function straight(from: Point, to: Point): StraightPiece {
  return { kind: 'straight', from, to, length: Math.hypot(to.x - from.x, to.y - from.y) };
}

export function curve(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
): CurvedPiece {
  const arcs = arcsOf(from, control1, control2, to);
  return { kind: 'curved', from, control1, control2, to, arcs, length: arcs[arcs.length - 1]! };
}

function arcsOf(from: Point, control1: Point, control2: Point, to: Point): number[] {
  const steps = curveSteps(from, control1, control2, to);
  const arcs = [0];
  let length = 0;
  for (let step = 1; step <= steps; step += 1) {
    length += arcOf(from, control1, control2, to, (step - 1) / steps, step / steps);
    arcs.push(length);
  }
  return arcs;
}

const GAUSS_NODES = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GAUSS_WEIGHTS = [
  0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891,
];

function arcOf(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  start: number,
  end: number,
): number {
  const half = (end - start) / 2;
  const middle = (start + end) / 2;
  let total = 0;
  for (const [index, node] of GAUSS_NODES.entries()) {
    total += GAUSS_WEIGHTS[index]! * curveSpeed(from, control1, control2, to, middle + half * node);
  }
  return total * half;
}

function curveSpeed(from: Point, control1: Point, control2: Point, to: Point, u: number): number {
  const tangent = curveTangent(from, control1, control2, to, u);
  return Math.hypot(tangent.x, tangent.y);
}

function curveSteps(from: Point, control1: Point, control2: Point, to: Point): number {
  const tight = Math.max(
    Math.hypot(from.x - 2 * control1.x + control2.x, from.y - 2 * control1.y + control2.y),
    Math.hypot(control1.x - 2 * control2.x + to.x, control1.y - 2 * control2.y + to.y),
  );
  const steps = Math.ceil(Math.sqrt((6 * tight) / (8 * CURVE_FLATNESS)));
  return Math.min(CURVE_MAX_STEPS, Math.max(CURVE_MIN_STEPS, steps));
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

function along(from: Point, to: Point, distance: number): Point {
  return lerp(from, to, distance / Math.hypot(to.x - from.x, to.y - from.y));
}

function lerp(from: Point, to: Point, fraction: number): Point {
  return { x: from.x + (to.x - from.x) * fraction, y: from.y + (to.y - from.y) * fraction };
}

function plus(point: Point, vector: Point, fraction: number): Point {
  return { x: point.x + vector.x * fraction, y: point.y + vector.y * fraction };
}

function samePoint(left: Point | undefined, right: Point): boolean {
  return left !== undefined && left.x === right.x && left.y === right.y;
}

function placedOn(path: ShaftPath, t: number): { at: Point; direction: Point } {
  const found = placeOn(path, t);
  return { at: pointOf(found.piece, found.u), direction: directionAt(found.piece, found.u) };
}

export function shaftTangentAt(path: ShaftPath, t: number): Point {
  return placedOn(path, t).direction;
}

function directionAt(piece: ShaftPiece, u: number): Point {
  if (piece.kind === 'straight') {
    return unit(piece.from, piece.to);
  }
  const tangent = tangentOf(piece, u);
  if (tangent.x !== 0 || tangent.y !== 0) {
    return unit({ x: 0, y: 0 }, tangent);
  }
  // A cusp: the derivative vanishes where the shaft stops and turns back on
  // itself, so read the direction from the ink a hair before it — or after it,
  // at the very start. Falling back on "rightwards" would turn a vertical
  // shaft's Label up instead of keeping it beside the ink.
  const reach = u > CURVE_TOUCH ? u - CURVE_TOUCH : u + CURVE_TOUCH;
  const here = pointOf(piece, u);
  const there = pointOf(piece, reach);
  return u > CURVE_TOUCH ? unit(there, here) : unit(here, there);
}

function placeOn(path: ShaftPath, t: number): { piece: ShaftPiece; u: number } {
  return placeAt(path, Math.min(1, Math.max(0, t)) * path.length);
}

function pointAt(path: ShaftPath, distance: number): Point {
  const found = placeAt(path, distance);
  return pointOf(found.piece, found.u);
}

function placeAt(path: ShaftPath, distance: number): { piece: ShaftPiece; u: number } {
  let remained = distance;
  for (const [index, piece] of path.pieces.entries()) {
    if (remained <= piece.length || index === path.pieces.length - 1) {
      return { piece, u: uAt(piece, remained) };
    }
    remained -= piece.length;
  }
  return { piece: path.pieces[0]!, u: 0 };
}

export function uAt(piece: ShaftPiece, distance: number): number {
  if (piece.kind === 'straight') {
    return piece.length === 0 ? 0 : Math.min(1, Math.max(0, distance / piece.length));
  }
  const arcs = piece.arcs;
  const steps = arcs.length - 1;
  let short = 0;
  let long = steps;
  while (long - short > 1) {
    const middle = (short + long) >> 1;
    if (arcs[middle]! <= distance) {
      short = middle;
    } else {
      long = middle;
    }
  }
  const from = short / steps;
  const to = long / steps;
  const within = distance - arcs[short]!;
  if (within <= 0) {
    return from;
  }
  if (within >= arcs[long]! - arcs[short]!) {
    return to;
  }
  return whereOnCurve(piece, from, to, within);
}

function whereOnCurve(piece: CurvedPiece, from: number, to: number, distance: number): number {
  let short = from;
  let long = to;
  for (let step = 0; step < CURVE_SOLVE_STEPS; step += 1) {
    const middle = (short + long) / 2;
    const reached = arcOf(piece.from, piece.control1, piece.control2, piece.to, from, middle);
    if (reached < distance) {
      short = middle;
    } else {
      long = middle;
    }
  }
  return (short + long) / 2;
}

function pointOf(piece: ShaftPiece, u: number): Point {
  if (piece.kind === 'straight') {
    return lerp(piece.from, piece.to, u);
  }
  return pointOnCurve(piece.from, piece.control1, piece.control2, piece.to, u);
}

function pointOnCurve(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  u: number,
): Point {
  const rest = 1 - u;
  const before = rest * rest * rest;
  const first = 3 * rest * rest * u;
  const second = 3 * rest * u * u;
  const last = u * u * u;
  return {
    x: from.x * before + control1.x * first + control2.x * second + to.x * last,
    y: from.y * before + control1.y * first + control2.y * second + to.y * last,
  };
}

function tangentOf(piece: CurvedPiece, u: number): Point {
  return curveTangent(piece.from, piece.control1, piece.control2, piece.to, u);
}

function curveTangent(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  u: number,
): Point {
  const rest = 1 - u;
  const before = 3 * rest * rest;
  const first = 6 * rest * u;
  const second = 3 * u * u;
  return {
    x: (control1.x - from.x) * before + (control2.x - control1.x) * first + (to.x - control2.x) * second,
    y: (control1.y - from.y) * before + (control2.y - control1.y) * first + (to.y - control2.y) * second,
  };
}

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

export function shaftLabelAnchor(
  path: ShaftPath,
  labelAt: { t: number; offset: number },
): Point {
  const found = placedOn(path, labelAt.t);
  const side = shaftSide(found.direction);
  return {
    x: found.at.x + side.x * labelAt.offset,
    y: found.at.y + side.y * labelAt.offset,
  };
}

export function alongSegment(start: Point, end: Point, point: Point): number {
  const across = end.x - start.x;
  const down = end.y - start.y;
  const lengthSquared = across * across + down * down;
  if (lengthSquared === 0) {
    return 0;
  }
  const travelled = (point.x - start.x) * across + (point.y - start.y) * down;
  return Math.min(1, Math.max(0, travelled / lengthSquared));
}

export function labelAtFor(
  path: ShaftPath,
  anchor: Point,
  whenFlat = 0,
): { t: number; offset: number } {
  if (path.length === 0) {
    const side = shaftSide({ x: 0, y: 0 });
    return {
      t: whenFlat,
      offset: (anchor.x - path.start.x) * side.x + (anchor.y - path.start.y) * side.y,
    };
  }
  const t = writtenFraction(nearestFraction(path, anchor));
  // One straight run has one heading all the way along, so its offset is read
  // from the shaft's start as a straight shaft always was: reading it from the
  // rounded place instead subtracts two nearly equal numbers and can land an
  // exact half pixel on the other side of the tie the save rounds on, which
  // would write bytes a drag never asked to change.
  const only = path.pieces.length === 1 ? path.pieces[0] : undefined;
  if (only !== undefined && only.kind === 'straight') {
    const side = shaftSide({ x: only.to.x - only.from.x, y: only.to.y - only.from.y });
    return {
      t,
      offset: (anchor.x - path.start.x) * side.x + (anchor.y - path.start.y) * side.y,
    };
  }
  // The side is read at the fraction a Scene keeps, not at the inkless float the
  // search lands on: where the ink turns upright, a place a hair inside the end
  // faces the other way from the end itself, and the words would be drawn on the
  // side the pointer never was.
  const found = placedOn(path, t);
  const side = shaftSide(found.direction);
  return {
    t,
    offset: (anchor.x - found.at.x) * side.x + (anchor.y - found.at.y) * side.y,
  };
}

const LABEL_AT_T_DECIMALS = 4;

export function writtenFraction(t: number): number {
  const scale = 10 ** LABEL_AT_T_DECIMALS;
  const kept = Math.min(1, Math.max(0, t));
  const rounded = Math.round(kept * scale) / scale;
  return rounded === 0 ? 0 : rounded;
}

function nearestFraction(path: ShaftPath, anchor: Point): number {
  let walked = 0;
  let found: { piece: ShaftPiece; u: number; from: number } | null = null;
  let closest = Number.POSITIVE_INFINITY;
  for (const piece of path.pieces) {
    const u = nearestU(piece, anchor);
    const away = squaredAway(pointOf(piece, u), anchor);
    if (away < closest) {
      closest = away;
      found = { piece, u, from: walked };
    }
    walked += piece.length;
  }
  const nearest = found as { piece: ShaftPiece; u: number; from: number };
  // A shaft of one straight run is measured by its own parameter: a projection
  // reads back the exact fraction such a shaft has always written, with no round
  // trip through two lengths to land a float below the tie it rounds on.
  if (path.pieces.length === 1 && nearest.piece.kind === 'straight') {
    return nearest.u;
  }
  const along = nearest.from + arcAt(nearest.piece, nearest.u);
  return along / path.length;
}

const NEAREST_STEPS = 64;

const NEAREST_TURNS = 40;

function nearestU(piece: ShaftPiece, point: Point): number {
  if (piece.kind === 'straight') {
    return alongSegment(piece.from, piece.to, point);
  }
  const margin = 1 / NEAREST_STEPS;
  // The ends as they are: a point past the ink clamps onto the end it went past,
  // which is the place the drawing keeps, and not the float just inside it where
  // the side can face the other way.
  const from = squaredAway(piece.from, point);
  const to = squaredAway(piece.to, point);
  let best = from <= to ? 0 : 1;
  let closest = Math.min(from, to);
  const head = narrowest(piece, point, 0, margin);
  const headAway = squaredAway(pointOf(piece, head), point);
  if (headAway < closest) {
    closest = headAway;
    best = head;
  }
  const tail = narrowest(piece, point, 1 - margin, 1);
  const tailAway = squaredAway(pointOf(piece, tail), point);
  if (tailAway < closest) {
    closest = tailAway;
    best = tail;
  }
  let before = from;
  let here = squaredAway(pointOf(piece, margin), point);
  for (let step = 1; step < NEAREST_STEPS; step += 1) {
    const next = squaredAway(pointOf(piece, (step + 1) * margin), point);
    if (here <= before && here < next) {
      const u = narrowest(piece, point, (step - 1) * margin, (step + 1) * margin);
      const away = squaredAway(pointOf(piece, u), point);
      if (away < closest) {
        closest = away;
        best = u;
      }
    }
    before = here;
    here = next;
  }
  return best;
}

function narrowest(piece: CurvedPiece, point: Point, from: number, to: number): number {
  const golden = (Math.sqrt(5) - 1) / 2;
  let short = from;
  let long = to;
  for (let turn = 0; turn < NEAREST_TURNS; turn += 1) {
    const left = long - (long - short) * golden;
    const right = short + (long - short) * golden;
    if (squaredAway(pointOf(piece, left), point) <= squaredAway(pointOf(piece, right), point)) {
      long = right;
    } else {
      short = left;
    }
  }
  return (short + long) / 2;
}

function squaredAway(from: Point, to: Point): number {
  return (from.x - to.x) ** 2 + (from.y - to.y) ** 2;
}

function arcAt(piece: ShaftPiece, u: number): number {
  if (piece.kind === 'straight') {
    return piece.length * u;
  }
  const steps = piece.arcs.length - 1;
  const step = Math.min(steps - 1, Math.max(0, Math.floor(u * steps)));
  const from = step / steps;
  return (
    piece.arcs[step]! +
    arcOf(piece.from, piece.control1, piece.control2, piece.to, from, Math.max(u, from))
  );
}

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

export interface CutPath {
  readonly pieces: readonly ShaftPiece[];
  readonly start: number;
}

/**
 * Whether a drawn path enters the gap: the shaft's own centre line, before
 * Rough.js roughens it, is what decides, so a stroke wobbling past the words
 * never cuts them and a Label placed beside its shaft never cuts it either.
 */
export function pathMeetsGap(pieces: readonly ShaftPiece[], gap: Box): boolean {
  return pieces.some((piece) => {
    const spans = outsideSpans(piece, gap);
    return spans.length !== 1 || spans[0]![0] !== 0 || spans[0]![1] !== 1;
  });
}

export function cutAtGap(pieces: readonly ShaftPiece[], gap: Box): CutPath[] {
  const cut: CutPath[] = [];
  let open: { pieces: ShaftPiece[]; start: number } | null = null;
  let walked = 0;
  for (const piece of pieces) {
    const spans = outsideSpans(piece, gap);
    for (const [from, to] of spans) {
      if (from > 0 && open !== null) {
        cut.push(open);
        open = null;
      }
      open ??= { pieces: [], start: walked + sliceOf(piece, 0, from).length };
      open.pieces.push(sliceOf(piece, from, to));
    }
    const last = spans[spans.length - 1];
    if (open !== null && (last === undefined || last[1] < 1)) {
      cut.push(open);
      open = null;
    }
    walked += piece.length;
  }
  if (open !== null) {
    cut.push(open);
  }
  return cut;
}

function outsideSpans(piece: ShaftPiece, gap: Box): [number, number][] {
  const stops = [0, ...edgeCrossings(piece, gap), 1];
  const spans: [number, number][] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index]!;
    const to = stops[index + 1]!;
    if (from === to || insideGap(pointOf(piece, (from + to) / 2), gap)) {
      continue;
    }
    const last = spans[spans.length - 1];
    if (last !== undefined && last[1] === from) {
      last[1] = to;
    } else {
      spans.push([from, to]);
    }
  }
  return spans;
}

function edgeCrossings(piece: ShaftPiece, gap: Box): number[] {
  const found = [
    ...crossingsOn(piece, 'x', gap.x),
    ...crossingsOn(piece, 'x', gap.x + gap.width),
    ...crossingsOn(piece, 'y', gap.y),
    ...crossingsOn(piece, 'y', gap.y + gap.height),
  ]
    .filter((u) => u > 0 && u < 1)
    .sort((left, right) => left - right);
  return found.filter((u, index) => index === 0 || u !== found[index - 1]);
}

function crossingsOn(piece: ShaftPiece, axis: 'x' | 'y', value: number): number[] {
  if (piece.kind === 'straight') {
    const from = piece.from[axis];
    const to = piece.to[axis];
    return from === to ? [] : [(value - from) / (to - from)];
  }
  const stops = [0, ...curveTurns(piece, axis), 1];
  const found: number[] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index]!;
    const to = stops[index + 1]!;
    const start = pointOf(piece, from)[axis] - value;
    const end = pointOf(piece, to)[axis] - value;
    if (start * end > 0) {
      continue;
    }
    const rising = start < 0;
    let short = from;
    let long = to;
    for (let step = 0; step < CURVE_SOLVE_STEPS; step += 1) {
      const middle = (short + long) / 2;
      if (pointOf(piece, middle)[axis] - value < 0 === rising) {
        short = middle;
      } else {
        long = middle;
      }
    }
    found.push((short + long) / 2);
  }
  return found;
}

function insideGap(point: Point, gap: Box): boolean {
  return (
    point.x > gap.x &&
    point.x < gap.x + gap.width &&
    point.y > gap.y &&
    point.y < gap.y + gap.height
  );
}

function sliceOf(piece: ShaftPiece, from: number, to: number): ShaftPiece {
  if (from === 0 && to === 1) {
    return piece;
  }
  if (piece.kind === 'straight') {
    return straight(pointOf(piece, from), pointOf(piece, to));
  }
  const rest = from === 0 ? piece : splitCurve(piece, from)[1];
  return to === 1 ? rest : splitCurve(rest, (to - from) / (1 - from))[0];
}

function splitCurve(piece: CurvedPiece, u: number): [CurvedPiece, CurvedPiece] {
  const first = lerp(piece.from, piece.control1, u);
  const second = lerp(piece.control1, piece.control2, u);
  const third = lerp(piece.control2, piece.to, u);
  const before = lerp(first, second, u);
  const after = lerp(second, third, u);
  const middle = lerp(before, after, u);
  return [
    curve(piece.from, first, before, middle),
    curve(middle, after, third, piece.to),
  ];
}
