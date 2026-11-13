import { cumulative, elevationGain, pointAlong, snapToLine, type Coord, type LngLat } from './geo';
import { buildInstructions, instructionText, type Instruction } from './instructions';
import { estimateDuration, profileById, type Route, type Waypoint } from './routing';

/** Re-derive all aggregate fields of a route from its geometry + per-point categories. */
export function rebuildRoute(
  base: Pick<Route, 'profileId'>,
  coords: Coord[],
  pointSurface: string[],
  pointWayType: string[],
  instructions: Omit<Instruction, 'along'>[] | null,
  waypoints: Waypoint[],
  speedKmh = profileById(base.profileId).speedKmh,
): Route {
  const cum = cumulative(coords);
  const distance = cum[cum.length - 1] ?? 0;
  const { up, down } = elevationGain(coords.map((c) => c[2] ?? 0));
  const sums = (arr: string[]) => {
    const m = new Map<string, number>();
    for (let i = 1; i < coords.length; i++) m.set(arr[i], (m.get(arr[i]) ?? 0) + (cum[i] - cum[i - 1]));
    return [...m.entries()].map(([key, d]) => ({ key, distance: d })).sort((a, b) => b.distance - a.distance);
  };
  const ins = instructions
    ? instructions.map((i) => ({ ...i, along: cum[Math.min(i.index, cum.length - 1)] }))
    : buildInstructions(coords, cum, []);
  return {
    coords,
    cum,
    distance,
    ascent: up,
    descent: down,
    duration: estimateDuration(distance, up, speedKmh),
    instructions: ins.sort((a, b) => a.along - b.along),
    surfaces: sums(pointSurface),
    wayTypes: sums(pointWayType),
    pointSurface,
    pointWayType,
    profileId: base.profileId,
    waypoints,
  };
}

/** Insert an exact point at `along` and return its index in the new coordinate list. */
function splitAt(route: Route, along: number) {
  const { point, index } = pointAlong(route.coords, route.cum, along);
  const a = route.coords[index];
  const b = route.coords[Math.min(index + 1, route.coords.length - 1)];
  const seg = route.cum[Math.min(index + 1, route.cum.length - 1)] - route.cum[index] || 1;
  const t = (along - route.cum[index]) / seg;
  const ele = (a[2] ?? 0) + ((b[2] ?? a[2] ?? 0) - (a[2] ?? 0)) * Math.max(0, Math.min(1, t));
  return { point: [point[0], point[1], ele] as Coord, index };
}

/** The part of a route from `from` metres to `to` metres (default: end). Waypoints before `from` are dropped. */
export function sliceRoute(route: Route, from: number, to = route.distance): Route {
  from = Math.max(0, Math.min(from, route.distance));
  to = Math.max(from, Math.min(to, route.distance));
  const s = splitAt(route, from);
  const e = splitAt(route, to);
  const coords: Coord[] = [s.point, ...route.coords.slice(s.index + 1, e.index + 1).map((c) => [...c] as Coord), e.point];
  const surf = [route.pointSurface[s.index], ...route.pointSurface.slice(s.index + 1, e.index + 1), route.pointSurface[e.index]];
  const way = [route.pointWayType[s.index], ...route.pointWayType.slice(s.index + 1, e.index + 1), route.pointWayType[e.index]];
  const offset = s.index; // coords index k (>=1) in the slice == original index offset + k
  const ins: Omit<Instruction, 'along'>[] = [
    { index: 0, maneuver: 'depart', text: instructionText('depart', undefined, 'Route') },
    ...route.instructions
      .filter((i) => i.maneuver !== 'depart' && i.along > from + 1 && i.along < to - 1)
      .map((i) => ({ index: i.index - offset, maneuver: i.maneuver, exit: i.exit, text: i.text })),
    { index: coords.length - 1, maneuver: 'arrive', text: instructionText('arrive') },
  ];
  const wpAlong = route.waypoints.map((w) => snapToLine(w.lngLat, route.coords, route.cum)?.along ?? 0);
  const startWp: Waypoint = { id: `slice-${Math.round(from)}`, lngLat: [s.point[0], s.point[1]], name: from > 0 ? 'Einstieg' : route.waypoints[0]?.name };
  const wps = [startWp, ...route.waypoints.filter((_, i) => i > 0 && wpAlong[i] > from + 5 && wpAlong[i] <= to + 5)];
  if (wps.length < 2) wps.push({ id: 'end', lngLat: [e.point[0], e.point[1]] });
  return rebuildRoute(route, coords, surf, way, ins, wps);
}

/** Ride a route backwards. Turn instructions are re-derived from geometry. */
export function reverseRoute(route: Route): Route {
  const coords = [...route.coords].reverse().map((c) => [...c] as Coord);
  const surf = [...route.pointSurface].reverse();
  const way = [...route.pointWayType].reverse();
  const cum = cumulative(coords);
  const ins = buildInstructions(coords, cum, []).map(({ along: _a, ...i }) => i);
  return rebuildRoute(route, coords, surf, way, ins, [...route.waypoints].reverse());
}

/**
 * Splice a reroute leg (current position → rejoin point) onto the remainder of the original
 * route after `rejoinAlong`.
 */
export function joinReroute(leg: Route, original: Route, rejoinAlong: number): Route {
  const rest = sliceRoute(original, rejoinAlong);
  const coords = [...leg.coords, ...rest.coords.slice(1)];
  const surf = [...leg.pointSurface, ...rest.pointSurface.slice(1)];
  const way = [...leg.pointWayType, ...rest.pointWayType.slice(1)];
  const off = leg.coords.length - 1;
  const ins: Omit<Instruction, 'along'>[] = [
    ...leg.instructions.filter((i) => i.maneuver !== 'arrive').map(({ along: _a, ...i }) => i),
    { index: off, maneuver: 'waypoint', text: 'Zurück auf der Route' },
    ...rest.instructions.filter((i) => i.maneuver !== 'depart').map(({ along: _a, ...i }) => ({ ...i, index: i.index + off })),
  ];
  return rebuildRoute(original, coords, surf, way, ins, [leg.waypoints[0], ...rest.waypoints.slice(1)]);
}

/** Point on the route a bit ahead of the rider's progress to rejoin (avoid U-turns). */
export function rejoinTarget(route: Route, position: LngLat, progressAlong: number, ahead = 150): { along: number; point: LngLat } {
  // nearest point on the remaining route, but never behind the progress
  const startIdx = Math.max(0, route.cum.findIndex((d) => d >= progressAlong) - 1);
  const snap = snapToLine(position, route.coords, route.cum, startIdx);
  const base = Math.max(progressAlong, snap?.along ?? progressAlong);
  const along = Math.min(route.distance, base + ahead);
  return { along, point: pointAlong(route.coords, route.cum, along).point };
}
