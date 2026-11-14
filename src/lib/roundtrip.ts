import { angleDiff, bearing, destination, elevationGain, formatDuration, haversine, type Coord, type LngLat } from './geo';
import { assembleRoute, estimateDuration, fetchTrack, profileById, type Leg, type Route, type RoutingProfile, type Waypoint } from './routing';

/**
 * Round trips ("Rundtour").
 *
 * A round trip here is not a circle. The rider picks a direction and a length; the tour heads
 * that way to a turning point and comes back on other roads. What shape that gives – a narrow
 * lens along a river, a wide loop where the network allows it – is left to the road network
 * and the routing option, which is how Garmin ("heads out in the selected direction and then
 * returns") and Bikemap's loop planner behave as well.
 *
 *  1. the way out is an ordinary route to a turning point half the wanted length away, so it
 *     follows whatever the routing option likes best in that direction;
 *  2. the way back is routed with weighted no-go circles along the way out: riding a road
 *     twice costs extra, so the router looks for another one and only shares where it must;
 *  3. the turning point is moved in or out until the total length fits;
 *  4. dead-end spurs and tiny detour loops (typically at the turning point) are cut out.
 *
 * The wanted size is a length or a riding time. Stops the rider asks for are woven in: the
 * farthest one becomes the turning point if it lies about that far out, the others are visited
 * on the way out or back, whichever side they lie on. If the stops cannot fit – too far for
 * the size, or behind the rider's back – a `LoopProblem` says so and what would fix it.
 *
 * Helper points never leave this module; the result is one continuous track.
 */
export interface LoopStop {
  id?: string;
  lngLat: LngLat;
  name?: string;
}

export interface LoopSpec {
  start: LngLat;
  /** wanted length in metres (with `duration` set: the length that time is expected to cover) */
  distance: number;
  /** wanted riding time in seconds; takes precedence over `distance` */
  duration?: number;
  /** places the tour has to pass */
  stops?: LoopStop[];
  /** compass bearing (deg) in which the tour heads, seen from the start */
  direction: number;
  /** "andere Variante": turns the heading a little or bends the way out to one side */
  variant: number;
  /** ride the tour the other way round */
  reversed?: boolean;
}

/** Roads are longer than the straight line; first guess before the measured way out corrects it. */
const ROAD_FACTOR = 1.3;
/** Cost per metre (in BRouter cost units) for riding where the other half already runs. */
const REUSE_WEIGHT = 8;

/** Straight-line distance from the start to the turning point, in metres. */
export const loopReach = (distance: number) => distance / 2 / ROAD_FACTOR;

/** Rough bounding box of the tour, for framing the map before the route is there. */
export function loopBounds(start: LngLat, distance: number, direction: number): [number, number, number, number] {
  const reach = loopReach(distance);
  const mid = destination(start, reach / 2, direction);
  const pts = [start, destination(start, reach, direction), destination(mid, reach * 0.35, direction + 90), destination(mid, reach * 0.35, direction - 90)];
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** [turn of the heading in degrees, sideways bend of the way out as a share of the reach] */
const VARIANTS: [number, number][] = [[0, 0], [0, 0.32], [0, -0.32], [24, 0], [-24, 0], [12, 0.5], [-12, -0.5], [40, 0], [-40, 0]];

export interface LoopSkeleton {
  /** where the tour turns round */
  turn: LngLat;
  /** set when the turning point is one of the rider's stops */
  turnStop?: LoopStop;
  /** helper points on the way out (none for the plain tour) */
  via: LngLat[];
  /** stops visited on the way out, in riding order */
  out: LoopStop[];
  /** stops visited on the way back, in riding order */
  back: LoopStop[];
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Turning point, helper points and the order of the stops for `spec`. `scale` moves the turning point in or out. */
export function loopSkeleton(spec: LoopSpec, scale = 1): LoopSkeleton {
  const stops = spec.stops ?? [];
  const [rot, bend] = VARIANTS[spec.variant % VARIANTS.length];
  const side = stops.length ? 0 : bend; // stops shape the tour themselves
  const dir = spec.direction + rot;
  // a bent way out is longer, so the turning point comes a little closer
  const reach = (loopReach(spec.distance) * scale * 2) / (1 + Math.sqrt(1 + 4 * side * side));
  const via = side ? [destination(destination(spec.start, reach / 2, dir), Math.abs(side) * reach, dir + (side > 0 ? 90 : -90))] : [];

  // where each stop lies relative to the heading: how far along it, how far to the side
  const placed = stops.map((stop) => {
    const d = haversine(spec.start, stop.lngLat);
    const a = rad(angleDiff(dir, bearing(spec.start, stop.lngLat)));
    return { stop, along: d * Math.cos(a), lat: d * Math.sin(a) };
  });
  let turn = destination(spec.start, reach, dir);
  let turnStop: LoopStop | undefined;
  const far = placed.reduce<(typeof placed)[number] | null>((m, p) => (!m || p.along > m.along ? p : m), null);
  if (far && far.along >= reach * 0.8) {
    // the farthest stop is about where the tour would turn anyway: turn there
    turn = far.stop.lngLat;
    turnStop = far.stop;
    placed.splice(placed.indexOf(far), 1);
  }
  // stops on one side are visited on the way out, those clearly on the other side on the way back
  const widest = placed.reduce<(typeof placed)[number] | null>((m, p) => (!m || Math.abs(p.lat) > Math.abs(m.lat) ? p : m), null);
  const sign = widest && widest.lat < 0 ? -1 : 1;
  const tol = loopReach(spec.distance) * 0.1;
  const out = placed.filter((p) => p.lat * sign > -tol).sort((a, b) => a.along - b.along);
  const back = placed.filter((p) => p.lat * sign <= -tol).sort((a, b) => b.along - a.along);
  return { turn, turnStop, via, out: out.map((p) => p.stop), back: back.map((p) => p.stop) };
}

/** Why a round trip cannot be built as asked, and what would make it work. */
export class LoopProblem extends Error {
  constructor(
    public kind: 'too-short' | 'direction',
    message: string,
    /** values that solve it: needed length (m) and riding time (s), or a heading (deg) */
    public fix: { distance?: number; duration?: number; direction?: number },
  ) {
    super(message);
    this.name = 'LoopProblem';
  }
}

const same = (a: Coord, b: Coord) => Math.abs(a[0] - b[0]) < 1.5e-6 && Math.abs(a[1] - b[1]) < 1.5e-6;

/**
 * Cut spurs and small loops out of a track.
 *
 * A spur is the track turning round and retracing itself (any length); a small loop is the
 * track coming back to a node it left less than `maxLoop` metres ago. Turn hints inside a
 * cut are dropped and the turn at the cut is derived from the remaining geometry.
 */
export function cleanTrack(leg: Leg, maxLoop = 600): Leg {
  const n = leg.coords.length;
  const keep: number[] = []; // original indices kept so far
  const alongKept: number[] = [];
  const cuts = new Set<number>(); // original index after which something was removed
  const seen = new Map<string, number>(); // coordinate -> position in `keep`
  const key = (c: Coord) => `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;
  const popTo = (pos: number) => {
    while (keep.length > pos + 1) {
      const idx = keep.pop()!;
      alongKept.pop();
      cuts.delete(idx);
      const k = key(leg.coords[idx]);
      if (seen.get(k) === keep.length) seen.delete(k);
    }
    cuts.add(keep[pos]);
  };
  for (let i = 0; i < n; i++) {
    const c = leg.coords[i];
    const top = keep.length - 1;
    if (top >= 0 && same(leg.coords[keep[top]], c)) continue; // duplicate vertex
    if (top >= 1 && same(leg.coords[keep[top - 1]], c)) {
      popTo(top - 1); // immediate U-turn: unwind the spur one step
      continue;
    }
    const along = top >= 0 ? alongKept[top] + haversine(leg.coords[keep[top]], c) : 0;
    const k = key(c);
    const prev = seen.get(k);
    // the very last point closes the round trip onto the start; that is not a detour
    if (prev != null && i < n - 1 && along - alongKept[prev] < maxLoop) {
      popTo(prev);
      continue;
    }
    keep.push(i);
    alongKept.push(along);
    if (prev == null) seen.set(k, keep.length - 1);
  }
  if (keep.length === n) return leg;

  const newIndex = new Map<number, number>();
  keep.forEach((orig, i) => newIndex.set(orig, i));
  const coords = keep.map((i) => leg.coords[i]);
  const hints: number[][] = [];
  for (const h of leg.hints) {
    const ni = newIndex.get(h[0]);
    if (ni == null || cuts.has(h[0])) continue;
    hints.push([ni, ...h.slice(1)]);
  }
  for (const orig of cuts) {
    const i = newIndex.get(orig);
    if (i == null || i === 0 || i >= coords.length - 1) continue;
    const a = turnAngle(coords, i);
    if (Math.abs(a) >= 35) hints.push([i, 0, 0, 0, a]);
  }
  hints.sort((a, b) => a[0] - b[0]);
  return { coords, surface: keep.map((i) => leg.surface[i]), wayType: keep.map((i) => leg.wayType[i]), hints };
}

/** Signed turn at vertex i, looking ~15 m back and ahead so jittery nodes do not matter. */
function turnAngle(coords: Coord[], i: number): number {
  let a = i - 1;
  while (a > 0 && haversine(coords[a], coords[i]) < 15) a--;
  let b = i + 1;
  while (b < coords.length - 1 && haversine(coords[b], coords[i]) < 15) b++;
  return angleDiff(bearing(coords[a], coords[i]), bearing(coords[i], coords[b]));
}

/** Share (0..1) of the track's length that runs where another part of the track runs too. */
export function overlapShare(coords: Coord[]): number {
  if (coords.length < 2) return 0;
  const kx = Math.cos(rad(coords[0][1])) * 111320;
  const ky = 110540;
  const pts: [number, number, number][] = [[coords[0][0] * kx, coords[0][1] * ky, 0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const ax = coords[i - 1][0] * kx, ay = coords[i - 1][1] * ky;
    const bx = coords[i][0] * kx, by = coords[i][1] * ky;
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(d / 20));
    for (let k = 1; k <= steps; k++) pts.push([ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps, acc + (d * k) / steps]);
    acc += d;
  }
  const cell = 25;
  const grid = new Map<string, number[]>();
  const cellOf = (v: number) => Math.floor(v / cell);
  pts.forEach((p, i) => {
    const k = `${cellOf(p[0])},${cellOf(p[1])}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  let twice = 0;
  for (const p of pts) {
    const cx = cellOf(p[0]), cy = cellOf(p[1]);
    let hit = false;
    for (let dx = -1; dx <= 1 && !hit; dx++) {
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        for (const j of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          const q = pts[j];
          if (Math.abs(q[2] - p[2]) > 250 && Math.hypot(q[0] - p[0], q[1] - p[1]) < 15) {
            hit = true;
            break;
          }
        }
      }
    }
    if (hit) twice++;
  }
  return twice / pts.length;
}

/**
 * Weighted no-go circles along a track, in BRouter's `nogos=` syntax. Riding inside a circle
 * costs `weight` per metre on top, which is how the way back is kept off the way out.
 * (Weighted polygons do not work for this: BRouter only charges ways that cross their edge.)
 * The number of circles is capped so the list still fits into a URL; on long tracks they grow.
 */
export function reuseNogos(coords: Coord[], weight = REUSE_WEIGHT, maxCircles = 220): string {
  if (coords.length < 2) return '';
  const cum: number[] = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const total = cum[cum.length - 1];
  const spans: [number, number][] = [[0, total]];
  const covered = spans.reduce((d, [a, b]) => d + b - a, 0);
  const spacing = Math.max(45, covered / maxCircles);
  const radius = Math.round(Math.max(28, spacing * 0.62));
  const out: string[] = [];
  let i = 1;
  for (const [from, to] of spans) {
    for (let d = from; d <= to; d += spacing) {
      while (i < coords.length - 1 && cum[i] < d) i++;
      const t = cum[i] > cum[i - 1] ? (d - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
      const lon = coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t;
      const lat = coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t;
      out.push(`${lon.toFixed(5)},${lat.toFixed(5)},${radius},${weight}`);
    }
  }
  return out.join('|');
}

function joinLegs(a: Leg, b: Leg): Leg {
  const off = a.coords.length - 1;
  return {
    coords: [...a.coords, ...b.coords.slice(1)],
    surface: [...a.surface, ...b.surface.slice(1)],
    wayType: [...a.wayType, ...b.wayType.slice(1)],
    hints: [...a.hints, ...b.hints.map((h) => [h[0] + off, ...h.slice(1)])],
  };
}

/**
 * The way back avoids the way out, so right after the turning point it often takes a side road
 * and crosses the way out again a little later: a hook that leads nowhere. Cut the widest one
 * (shorter than `maxLen` metres) around the turning point at index `at`.
 */
export function cutTurnHook(leg: Leg, at: number, maxLen: number): Leg {
  const key = (c: Coord) => `${Math.round(c[0] * 1e6)},${Math.round(c[1] * 1e6)}`;
  const n = leg.coords.length;
  const before = new Map<string, number>();
  let d = 0;
  for (let i = at; i > 0 && d < maxLen; i--) {
    before.set(key(leg.coords[i]), i); // ends with the earliest index per node
    d += haversine(leg.coords[i], leg.coords[i - 1]);
  }
  const after: number[] = [];
  d = 0;
  for (let j = at + 1; j < n - 1 && d < maxLen; j++) {
    d += haversine(leg.coords[j], leg.coords[j - 1]);
    after.push(j);
  }
  const len = (i: number, j: number) => lengthOf(leg.coords.slice(i, j + 1));
  for (const j of after.reverse()) {
    const i = before.get(key(leg.coords[j]));
    if (i == null || i === j || len(i, j) > maxLen) continue;
    // drop i+1..j: the track continues from node i, which is the same place as node j
    const keepIdx = [...Array(n).keys()].filter((k) => k <= i || k > j);
    const hints = leg.hints.filter((h) => h[0] < i || h[0] > j).map((h) => (h[0] > j ? [h[0] - (j - i), ...h.slice(1)] : h));
    const coords = keepIdx.map((k) => leg.coords[k]);
    if (i > 0 && i < coords.length - 1) {
      const a = turnAngle(coords, i);
      if (Math.abs(a) >= 35) hints.push([i, 0, 0, 0, a]);
      hints.sort((x, y) => x[0] - y[0]);
    }
    return { coords, surface: keepIdx.map((k) => leg.surface[k]), wayType: keepIdx.map((k) => leg.wayType[k]), hints };
  }
  return leg;
}

const lengthOf = (coords: Coord[]) => coords.reduce((d, c, i) => (i ? d + haversine(coords[i - 1], c) : 0), 0);

export interface RoundTripOptions {
  signal?: AbortSignal;
  speedKmh?: number;
  params?: Record<string, string | number>;
  /** replaceable for tests */
  track?: typeof fetchTrack;
}

interface Candidate {
  /** one leg per stretch between two of the rider's points */
  legs: Leg[];
  /** the stops in the order they are ridden */
  order: LoopStop[];
  length: number;
  /** what is compared with the target: metres, or seconds for a time-based tour */
  value: number;
  overlap: number;
  /** the turning point is a stop, so the tour cannot get any shorter */
  minimal: boolean;
}

const km = (m: number) => `${Math.round(m / 1000)} km`;

/** Compute a round trip for `spec` with the routing option `profileId`. */
export async function computeRoundTrip(spec: LoopSpec, profileId: string, opts: RoundTripOptions = {}): Promise<Route> {
  const chosen = profileById(profileId);
  const profile: RoutingProfile = chosen.brouter ? chosen : profileById('balanced');
  const track = opts.track ?? fetchTrack;
  const req = { signal: opts.signal, params: opts.params };
  const speed = opts.speedKmh ?? chosen.speedKmh;
  const start = spec.start;
  const stops = spec.stops ?? [];
  // a time-based tour is laid out for the length that time covers on the flat, then measured in time
  const base: LoopSpec = spec.duration ? { ...spec, distance: (spec.duration * speed) / 3.6 } : spec;
  const target = spec.duration ?? spec.distance;
  const climb = (coords: Coord[]) => {
    let last = coords.find((c) => c[2] != null)?.[2] ?? 0;
    return elevationGain(coords.map((c) => (last = c[2] ?? last))).up;
  };
  const measure = (coords: Coord[], length: number) => (spec.duration ? estimateDuration(length, climb(coords), speed) : length);
  const [, bend] = VARIANTS[spec.variant % VARIANTS.length];
  const side = stops.length ? 0 : bend;
  // share of the whole tour that the freely routed half makes up
  const freeShare = Math.sqrt(1 + 4 * side * side) / (1 + Math.sqrt(1 + 4 * side * side)) / 1.03;
  const tooShort = (length: number, value?: number) => {
    const what = stops.length === 1 ? 'dem Zwischenstopp' : 'den Zwischenstopps';
    return spec.duration
      ? new LoopProblem(
          'too-short',
          `Mit ${what} dauert die Rundtour mindestens rund ${formatDuration(value ?? (length / speed) * 3.6)} – vorgegeben sind ${formatDuration(spec.duration)}.`,
          { distance: length, duration: value ?? (length / speed) * 3.6 },
        )
      : new LoopProblem('too-short', `Mit ${what} wird die Rundtour mindestens rund ${km(length)} lang – vorgegeben sind ${km(spec.distance)}.`, { distance: length });
  };

  if (stops.length) {
    // a stop behind the rider's back cannot be part of a tour in this direction
    const far = stops.reduce((m, p) => (haversine(start, p.lngLat) > haversine(start, m.lngLat) ? p : m));
    const toFar = bearing(start, far.lngLat);
    if (haversine(start, far.lngLat) > 400 && Math.abs(angleDiff(spec.direction, toFar)) > 90) {
      const name = far.name ? `„${far.name.split(',')[0]}“` : stops.length === 1 ? 'Der Zwischenstopp' : 'Der weiteste Zwischenstopp';
      throw new LoopProblem('direction', `${name} liegt im ${compassName(toFar)}, die Rundtour führt aber nach ${compassName(spec.direction)}.`, {
        direction: ((Math.round(toFar / 5) * 5) % 360 + 360) % 360,
      });
    }
    // not even the straight lines through the stops fit: no need to ask the router
    const sk = loopSkeleton(base, 1e-6);
    const pts = [start, ...sk.out.map((p) => p.lngLat), sk.turn, ...sk.back.map((p) => p.lngLat), start];
    const straight = lengthOf(pts as Coord[]);
    if (straight > base.distance * 1.08) throw tooShort(straight * ROAD_FACTOR);
  }

  interface Pt {
    p: LngLat;
    stop?: LoopStop;
    turn?: boolean;
  }
  const maxLoop = Math.min(800, Math.max(250, base.distance * 0.03));

  /** Route the tour for one skeleton: the free half first, then the other half kept off it. */
  const build = async (sk: LoopSkeleton): Promise<Candidate> => {
    const seq: Pt[] = [
      { p: start },
      ...sk.out.map((stop) => ({ p: stop.lngLat, stop })),
      ...sk.via.map((p) => ({ p })),
      { p: sk.turn, stop: sk.turnStop, turn: true },
      ...sk.back.map((stop) => ({ p: stop.lngLat, stop })),
      { p: start },
    ];
    const turnAt = 1 + sk.out.length + sk.via.length;
    const fwd = seq.slice(1).map((b, i) => ({ a: seq[i], b, free: i < turnAt }));
    // riding the other way round keeps the same free half, so the tour is the same one backwards
    const ride = spec.reversed ? fwd.reverse().map((s) => ({ a: s.b, b: s.a, free: s.free })) : fwd;
    const legs: Leg[] = new Array(ride.length);
    await Promise.all(ride.map(async (s, i) => s.free && (legs[i] = await track([s.a.p, s.b.p], profile, req))));
    const nogos = reuseNogos(ride.flatMap((s, i) => (s.free ? legs[i].coords : [])));
    await Promise.all(ride.map(async (s, i) => s.free || (legs[i] = await track([s.a.p, s.b.p], profile, { ...req, nogos }))));

    // helper points are joined away; at the rider's stops the track stays split (and a way in and out is wanted there)
    const pieces: Leg[] = [];
    const order: LoopStop[] = [];
    let cur = legs[0];
    for (let i = 1; i < ride.length; i++) {
      const joint = ride[i].a;
      if (joint.stop) {
        pieces.push(cleanTrack(cur, maxLoop));
        order.push(joint.stop);
        cur = legs[i];
      } else {
        const at = cur.coords.length - 1;
        cur = joinLegs(cur, legs[i]);
        if (joint.turn) cur = cutTurnHook(cur, at, base.distance * 0.06);
      }
    }
    pieces.push(cleanTrack(cur, maxLoop));
    const coords = pieces.flatMap((l, i) => (i ? l.coords.slice(1) : l.coords));
    const length = lengthOf(coords);
    return { legs: pieces, order, length, value: measure(coords, length), overlap: overlapShare(coords), minimal: !!sk.turnStop };
  };

  let scale = 1;
  let turn = 0;
  let misses = 0;
  let best: Candidate | null = null;
  let shortest: Candidate | null = null;
  // closest tries on either side of the target: [scale, value]
  let under: [number, number] | null = null;
  let over: [number, number] | null = null;
  const clamp = (f: number) => Math.min(1.7, Math.max(0.55, f));
  const skeleton = () => loopSkeleton({ ...base, direction: base.direction + turn }, scale);
  // a tour through stops rides some roads twice by nature, so that counts for less there
  const score = (c: Candidate) => Math.abs(c.value - target) / target + (stops.length ? 1 : 2.5) * c.overlap;
  const rounds = 6;
  let nudges = 0;

  for (let round = 0; round < rounds; round++) {
    try {
      if (round === 0 && !stops.length) {
        // the free half alone tells how long the roads are here: move the turning point before routing the rest
        const sk = skeleton();
        const pts = [start, ...sk.via, sk.turn];
        const legs = await Promise.all(pts.slice(1).map((b, i) => track(spec.reversed ? [b, pts[i]] : [pts[i], b], profile, req)));
        const coords = legs.flatMap((l) => l.coords);
        const est = measure(coords, lengthOf(coords)) / freeShare;
        if (Math.abs(est - target) / target > 0.08) scale *= clamp(target / est);
      }
      const c = await build(skeleton());
      if (!best || score(c) < score(best)) best = c;
      if (!shortest || c.value < shortest.value) shortest = c;
      const off = (c.value - target) / target;
      if (Math.abs(off) <= 0.08) break;
      if (off > 0 && c.minimal) break; // it turns at a stop already: shorter is not possible
      if (off > 0 && (!over || c.value < over[1])) over = [scale, c.value];
      if (off < 0 && (!under || c.value > under[1])) under = [scale, c.value];
      const closed = under && over && Math.abs(over[0] - under[0]) < 0.06;
      if (stops.length && off > 0 && round === rounds - 2) scale = 1e-6; // last try: turn at the farthest stop
      else if ((closed || round === 3) && nudges < 2) {
        // No turning point on this line gives the wanted size (the length jumps where it crosses
        // a river or a ridge). A slightly different heading usually has one.
        if (under && over) scale = (under[0] + over[0]) / 2;
        turn += nudges++ ? -28 : 14;
        under = over = null;
      } else if (under && over) {
        // The length jumps where the turning point crosses a river or a ridge, so close in on the
        // target from both sides instead of trusting proportions.
        const t = (target - under[1]) / (over[1] - under[1]);
        scale = under[0] + (over[0] - under[0]) * Math.min(0.8, Math.max(0.2, t));
      } else scale *= clamp(target / c.value);
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') throw e;
      if (/abseits/.test(err.message) && ++misses <= 3) {
        // a point landed where nothing is rideable (lake, forest): pull the turning point in and turn a little
        scale *= 0.96;
        turn += misses % 2 ? 10 : -20;
        round--;
        continue;
      }
      // keep what we have if it is close; otherwise the failure is the more honest answer
      if (!best || Math.abs(best.value - target) / target > 0.15) throw e;
      break;
    }
  }
  if (!best || !shortest) throw new Error('Keine Rundtour gefunden');
  if (stops.length && shortest.value > target * 1.15) throw tooShort(shortest.length, shortest.value);

  const wps: Waypoint[] = [
    { id: 'loop-start', lngLat: start },
    ...best.order.map((p, i) => ({ id: p.id ?? `loop-stop-${i}`, lngLat: p.lngLat, name: p.name })),
    { id: 'loop-end', lngLat: start },
  ];
  return assembleRoute(best.legs, profile.id === chosen.id ? chosen : profile, wps, speed);
}

/** True for routes that end where they start (round trips). */
export function isLoopRoute(r: Route): boolean {
  if (r.coords.length < 2 || r.distance < 500) return false;
  return haversine(r.coords[0], r.coords[r.coords.length - 1]) < 60;
}

const COMPASS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];
export const compassName = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
