import { describe, expect, it } from 'vitest';
import fixture from './fixtures/brouter-munich.json';
import { climbState, detectClimbs } from '../src/lib/climbs';
import { cumulative, destination, haversine, pointAlong, snapToLine, type Coord } from '../src/lib/geo';
import { NavigationEngine, type Fix } from '../src/lib/navigation';
import { Recorder } from '../src/lib/recording';
import { joinReroute, rebuildRoute, rejoinTarget, reverseRoute, sliceRoute } from '../src/lib/routeOps';
import { assembleRoute, CYCLEPATH_PARAMS, parseBrouter, PROFILES, profileById, profileQuery, wayTypeOf } from '../src/lib/routing';

const munich = () =>
  assembleRoute([parseBrouter(fixture)], profileById('balanced'), [
    { id: 'a', lngLat: [11.5755, 48.1372] },
    { id: 'b', lngLat: [11.62, 48.15] },
  ]);

const fix = (lngLat: [number, number], time: number, speed = 5, accuracy = 5): Fix => ({ lngLat, time, speed, accuracy, heading: null, altitude: null });

/** Synthetic route: 6 km east with a 60 m hill between km 2 and km 3. */
function hillRoute() {
  const coords: Coord[] = [];
  for (let i = 0; i <= 240; i++) {
    const d = i * 25;
    let e = 500;
    if (d > 2000 && d <= 3000) e = 500 + ((d - 2000) / 1000) * 60;
    else if (d > 3000 && d <= 4000) e = 560 - ((d - 3000) / 1000) * 60;
    else if (d > 4000) e = 500;
    const p = destination([11, 48], d, 90);
    coords.push([p[0], p[1], e]);
  }
  return rebuildRoute({ profileId: 'balanced' }, coords, coords.map(() => 'paved'), coords.map(() => 'cycleway'), null, [
    { id: 'a', lngLat: [coords[0][0], coords[0][1]] },
    { id: 'b', lngLat: [coords[240][0], coords[240][1]] },
  ]);
}

describe('climb detection', () => {
  it('finds the climb and the descent with plausible numbers', () => {
    const climbs = detectClimbs(hillRoute());
    const up = climbs.filter((c) => c.type === 'climb');
    const down = climbs.filter((c) => c.type === 'descent');
    expect(up).toHaveLength(1);
    expect(down).toHaveLength(1);
    expect(up[0].gain).toBeGreaterThan(50);
    expect(up[0].gain).toBeLessThan(70);
    expect(up[0].grade).toBeGreaterThan(4.5);
    expect(up[0].grade).toBeLessThan(7.5);
    expect(up[0].startAlong).toBeGreaterThan(1800);
    expect(up[0].startAlong).toBeLessThan(2300);
  });
  it('ignores small bumps', () => {
    const flat = hillRoute();
    const coords = flat.coords.map((c, i) => [c[0], c[1], 500 + (i % 2) * 2] as Coord);
    const r = rebuildRoute(flat, coords, flat.pointSurface, flat.pointWayType, null, flat.waypoints);
    expect(detectClimbs(r)).toHaveLength(0);
  });
  it('reports position inside and ahead of a climb', () => {
    const climbs = detectClimbs(hillRoute());
    const inside = climbState(climbs, 2500);
    expect(inside?.kind).toBe('in');
    if (inside?.kind === 'in') {
      expect(inside.index).toBe(1);
      expect(inside.count).toBe(1);
      expect(inside.remaining).toBeGreaterThan(300);
    }
    const ahead = climbState(climbs, 500);
    expect(ahead?.kind).toBe('ahead');
    if (ahead?.kind === 'ahead') expect(ahead.distance).toBeGreaterThan(1000);
    expect(climbState(climbs, 5500)).toBeNull();
  });
  it('announces a climb once at 1 km and once at 100 m', () => {
    const r = hillRoute();
    const nav = new NavigationEngine(r, { climbAnnouncements: true });
    let t = 0;
    const said: string[] = [];
    for (let d = 0; d <= 3000; d += 25) said.push(...nav.update(fix(pointAlong(r.coords, r.cum, d).point, (t += 4000))).speak);
    const climbSaid = said.filter((x) => /Anstieg/.test(x));
    expect(climbSaid).toHaveLength(2);
    expect(climbSaid[0]).toMatch(/in 1 Kilometer/);
    expect(climbSaid[1]).toMatch(/in 100 Metern/);
    expect(climbSaid[0]).toMatch(/Prozent/);
  });
});

describe('self-guided mode', () => {
  it('stays silent on turns but warns when leaving the route', () => {
    const r = munich();
    const nav = new NavigationEngine(r, { guided: false });
    let t = 0;
    const said: string[] = [];
    for (let d = 0; d < 800; d += 20) said.push(...nav.update(fix(pointAlong(r.coords, r.cum, d).point, (t += 3000))).speak);
    expect(said.filter((s) => /abbiegen/i.test(s))).toHaveLength(0);
    const away = destination(pointAlong(r.coords, r.cum, 800).point, 200, 0);
    let off: string[] = [];
    for (let i = 0; i < 4; i++) off = off.concat(nav.update(fix(away, (t += 3000))).speak);
    expect(off.some((s) => /verlassen/i.test(s))).toBe(true);
  });
  it('turn-by-turn still announces turns', () => {
    const r = munich();
    const nav = new NavigationEngine(r, { guided: true });
    let t = 0;
    const said: string[] = [];
    for (let d = 0; d < 1500; d += 20) said.push(...nav.update(fix(pointAlong(r.coords, r.cum, d).point, (t += 3000))).speak);
    expect(said.some((s) => /abbiegen|halten/i.test(s))).toBe(true);
  });
});

describe('route operations', () => {
  it('slices a route from an entry point', () => {
    const r = munich();
    const s = sliceRoute(r, 2000);
    expect(s.distance).toBeCloseTo(r.distance - 2000, -1);
    expect(haversine(s.coords[0], pointAlong(r.coords, r.cum, 2000).point)).toBeLessThan(1);
    expect(s.instructions[0].maneuver).toBe('depart');
    expect(s.instructions[s.instructions.length - 1].maneuver).toBe('arrive');
    expect(s.coords[s.coords.length - 1][0]).toBeCloseTo(r.coords[r.coords.length - 1][0], 5);
  });
  it('reverses a route and keeps length while swapping ends', () => {
    const r = munich();
    const rev = reverseRoute(r);
    expect(rev.distance).toBeCloseTo(r.distance, 0);
    expect(rev.coords[0][0]).toBeCloseTo(r.coords[r.coords.length - 1][0], 6);
    expect(rev.ascent).toBeCloseTo(r.descent, -1);
    expect(rev.instructions[0].maneuver).toBe('depart');
  });
  it('rejoin target lies ahead of the rider, never behind', () => {
    const r = munich();
    const progress = 1500;
    const off = destination(pointAlong(r.coords, r.cum, progress).point, 120, 10);
    const t = rejoinTarget(r, off, progress);
    expect(t.along).toBeGreaterThan(progress);
    expect(t.along).toBeLessThan(progress + 400);
  });
  it('splices a reroute leg back onto the planned route', () => {
    const r = munich();
    const progress = 1500;
    const off = destination(pointAlong(r.coords, r.cum, progress).point, 150, 20);
    const join = rejoinTarget(r, off, progress);
    // detour leg: straight line from the rider to the rejoin point
    const legCoords: Coord[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      legCoords.push([off[0] + (join.point[0] - off[0]) * t, off[1] + (join.point[1] - off[1]) * t, 515]);
    }
    const leg = rebuildRoute({ profileId: 'balanced' }, legCoords, legCoords.map(() => 'paved'), legCoords.map(() => 'road'), null, [
      { id: 'me', lngLat: off },
      { id: 'join', lngLat: join.point },
    ]);
    const joined = joinReroute(leg, r, join.along);
    expect(joined.coords[0][0]).toBeCloseTo(off[0], 6);
    expect(joined.coords[joined.coords.length - 1][0]).toBeCloseTo(r.coords[r.coords.length - 1][0], 5);
    expect(joined.distance).toBeGreaterThan(r.distance - join.along);
    expect(joined.instructions.some((i) => /Zurück auf der Route/.test(i.text))).toBe(true);
    // the new route is continuous: no gap between consecutive points
    for (let i = 1; i < joined.coords.length; i++) expect(haversine(joined.coords[i - 1], joined.coords[i])).toBeLessThan(600);
  });
  it('navigating a spliced route reaches the original destination', () => {
    const r = munich();
    const joined = sliceRoute(r, 1200);
    const nav = new NavigationEngine(joined);
    let t = 0;
    let last;
    for (let d = 0; d <= joined.distance + 10; d += 20) last = nav.update(fix(pointAlong(joined.coords, joined.cum, d).point, (t += 3000)));
    expect(last!.arrived).toBe(true);
  });
});

describe('auto-pause thresholds', () => {
  it('pauses below 2 km/h and resumes above it', () => {
    const rec = new Recorder({ autoPause: true });
    rec.start(0);
    let t = 0;
    for (let i = 0; i < 10; i++) rec.add(fix(destination([11, 48], i * 10, 90), (t += 1000), 5));
    expect(rec.status).toBe('recording');
    const stop = destination([11, 48], 90, 90);
    for (let i = 0; i < 8; i++) rec.add(fix(stop, (t += 1000), 0.3));
    expect(rec.status).toBe('autopaused');
    rec.add(fix(destination([11, 48], 100, 90), (t += 1000), 3));
    expect(rec.status).toBe('recording');
  });
  it('does not auto-pause on an imprecise fix', () => {
    const rec = new Recorder({ autoPause: true });
    rec.start(0);
    let t = 0;
    rec.add(fix(destination([11, 48], 0, 90), (t += 1000), 5, 5));
    for (let i = 0; i < 10; i++) rec.add(fix(destination([11, 48], 10, 90), (t += 1000), 0.2, 25));
    expect(rec.status).toBe('recording');
  });
  it('auto-pauses when GPS stops delivering', () => {
    const rec = new Recorder({ autoPause: true });
    rec.start(0);
    rec.add(fix([11, 48], 1000, 5));
    expect(rec.tick(5000, 1000)).toBe(false);
    expect(rec.tick(20000, 1000)).toBe(true);
    expect(rec.status).toBe('autopaused');
  });
});

describe('routing profiles', () => {
  it('cycle path preference maps to BRouter variables', () => {
    expect(profileQuery(CYCLEPATH_PARAMS.low)).toBe('');
    expect(profileQuery(CYCLEPATH_PARAMS.medium)).toContain('profile:avoid_unsafe=1');
    const high = profileQuery(CYCLEPATH_PARAMS.high);
    expect(high).toContain('profile:avoid_unsafe=1');
    expect(high).toContain('profile:stick_to_cycleroutes=1');
  });
  it('has the smooth-ride profile with no steps', () => {
    const p = PROFILES.find((x) => x.id === 'smooth')!;
    expect(p.params).toEqual({ allow_steps: 0 });
    expect(profileQuery(p.params)).toBe('&profile:allow_steps=0');
  });
  it('classifies way types', () => {
    expect(wayTypeOf('highway=primary')).toBe('busyroad');
    expect(wayTypeOf('highway=living_street')).toBe('living');
    expect(wayTypeOf('highway=service')).toBe('access');
    expect(wayTypeOf('highway=pedestrian')).toBe('pedestrian');
    expect(wayTypeOf('highway=steps')).toBe('steps');
    expect(wayTypeOf('highway=track')).toBe('track');
  });
});

describe('waypoint progress', () => {
  it('exposes waypoint positions and progress for missed-stop detection', () => {
    const r = munich();
    const mid = pointAlong(r.coords, r.cum, r.distance / 2).point;
    const withStop = assembleRoute([parseBrouter(fixture)], profileById('balanced'), [
      { id: 'a', lngLat: [11.5755, 48.1372] },
      { id: 'stop', lngLat: mid },
      { id: 'b', lngLat: [11.62, 48.15] },
    ]);
    const nav = new NavigationEngine(withStop);
    const alongs = nav.waypointPositions;
    expect(alongs).toHaveLength(3);
    expect(alongs[1]).toBeGreaterThan(0);
    expect(alongs[1]).toBeLessThan(withStop.distance);
    let t = 0;
    for (let d = 0; d <= alongs[1] + 300; d += 25) nav.update(fix(pointAlong(withStop.coords, withStop.cum, d).point, (t += 3000)));
    expect(nav.progress).toBeGreaterThan(alongs[1] + 150);
    expect(snapToLine(mid, withStop.coords, cumulative(withStop.coords))!.distance).toBeLessThan(5);
  });
});
