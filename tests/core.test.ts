import { describe, expect, it } from 'vitest';
import fixture from './fixtures/brouter-munich.json';
import { BIKE_TYPES, bikeSpeed, rideSpeed } from '../src/lib/bike';
import { angleDiff, bearing, cumulative, destination, elevationGain, formatDistance, haversine, pointAlong, snapToLine, type Coord } from '../src/lib/geo';
import { buildInstructions, maneuverFromAngle, spokenInstruction } from '../src/lib/instructions';
import { NavigationEngine, type Fix } from '../src/lib/navigation';
import { Recorder } from '../src/lib/recording';
import { assembleRoute, estimateDuration, parseBrouter, profileById, routeFromTrack, surfaceOf, wayTypeOf } from '../src/lib/routing';
import { parseTrackFile, toGPX, toKML, simplifyByDistance } from '../src/lib/gpx';
import { cleanTrack, computeRoundTrip, cutTurnHook, isLoopRoute, LoopProblem, loopSkeleton, overlapShare, reuseNogos } from '../src/lib/roundtrip';
import { countTiles, lat2tile, lon2tile, tilesInBbox } from '../src/lib/offline';
import { parseCoordinates, parsePhoton } from '../src/lib/geocode';
import { colouredLines, grades } from '../src/lib/routeStyle';
import { headwindShare } from '../src/lib/weather';
import { classifyTilePoi } from '../src/lib/pois';
import { decodePoiTile, tilesFor } from '../src/lib/poiTiles';
import { googleMapsUrl, tripadvisorUrl } from '../src/lib/externalLinks';

const munich = () => {
  const leg = parseBrouter(fixture);
  return assembleRoute([leg], profileById('balanced'), [
    { id: 'a', lngLat: [11.5755, 48.1372] },
    { id: 'b', lngLat: [11.62, 48.15] },
  ]);
};

const fix = (lngLat: [number, number], time: number, speed = 5, accuracy = 5): Fix => ({ lngLat, time, speed, accuracy, heading: null, altitude: null });

describe('geo', () => {
  it('haversine matches known distance (Berlin–Munich ≈ 504 km)', () => {
    const d = haversine([13.405, 52.52], [11.582, 48.135]);
    expect(d / 1000).toBeGreaterThan(500);
    expect(d / 1000).toBeLessThan(508);
  });
  it('destination/bearing round trip', () => {
    const p = destination([11, 48], 1000, 90);
    expect(haversine([11, 48], p)).toBeCloseTo(1000, 0);
    expect(bearing([11, 48], p)).toBeCloseTo(90, 0);
  });
  it('snaps to the closest segment and reports along-distance', () => {
    const line: Coord[] = [[11, 48], [11.01, 48], [11.02, 48]];
    const cum = cumulative(line);
    const s = snapToLine([11.015, 48.0005], line, cum)!;
    expect(s.index).toBe(1);
    expect(s.distance).toBeGreaterThan(50);
    expect(s.distance).toBeLessThan(60);
    expect(s.along).toBeCloseTo(cum[2] * 0.75, -1);
    expect(pointAlong(line, cum, cum[2] / 2).point[0]).toBeCloseTo(11.01, 5);
  });
  it('elevation gain uses hysteresis against noise', () => {
    expect(elevationGain([100, 101, 100, 101, 100, 101])).toEqual({ up: 0, down: 0 });
    expect(elevationGain([100, 110, 105, 120])).toEqual({ up: 25, down: 5 });
  });
  it('formats German distances', () => {
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(12345)).toBe('12,3 km');
  });
});

describe('routing (BRouter parsing)', () => {
  it('parses geometry, elevation and way tags of a real response', () => {
    const r = munich();
    expect(r.coords.length).toBe(235);
    expect(r.distance).toBeGreaterThan(4800);
    expect(r.distance).toBeLessThan(5200);
    expect(r.coords.every((c) => typeof c[2] === 'number')).toBe(true);
    const surfTotal = r.surfaces.reduce((a, s) => a + s.distance, 0);
    expect(surfTotal).toBeCloseTo(r.distance, 0);
    expect(r.surfaces.some((s) => s.key === 'paved')).toBe(true);
    expect(r.wayTypes.length).toBeGreaterThan(1);
  });
  it('builds turn instructions from voice hints', () => {
    const r = munich();
    expect(r.instructions[0].maneuver).toBe('depart');
    expect(r.instructions[r.instructions.length - 1].maneuver).toBe('arrive');
    const turns = r.instructions.filter((i) => /left|right|roundabout/.test(i.maneuver));
    expect(turns.length).toBeGreaterThan(5);
    for (let i = 1; i < r.instructions.length; i++) expect(r.instructions[i].along).toBeGreaterThanOrEqual(r.instructions[i - 1].along);
  });
  it('interpolates missing elevations instead of dropping to 0', () => {
    const fx = JSON.parse(JSON.stringify(fixture));
    const cs = fx.features[0].geometry.coordinates;
    cs[cs.length - 1] = cs[cs.length - 1].slice(0, 2);
    cs[cs.length - 2] = cs[cs.length - 2].slice(0, 2);
    const r = assembleRoute([parseBrouter(fx)], profileById('balanced'), [{ id: 'a', lngLat: [0, 0] }, { id: 'b', lngLat: [0, 0] }]);
    expect(r.coords[r.coords.length - 1][2]).toBeGreaterThan(400);
    expect(Math.abs(r.ascent - r.descent)).toBeLessThan(100);
  });
  it('classifies surfaces and way types', () => {
    expect(surfaceOf('highway=residential surface=asphalt')).toBe('paved');
    expect(surfaceOf('highway=track surface=gravel')).toBe('gravel');
    expect(surfaceOf('highway=footway surface=sett')).toBe('cobbles');
    expect(wayTypeOf('highway=cycleway surface=asphalt')).toBe('cycleway');
    expect(wayTypeOf('highway=primary')).toBe('busyroad');
    expect(wayTypeOf('highway=residential')).toBe('quiet');
    expect(wayTypeOf('highway=living_street')).toBe('living');
    expect(wayTypeOf('highway=service')).toBe('access');
    expect(wayTypeOf('highway=steps')).toBe('steps');
    expect(wayTypeOf('highway=pedestrian')).toBe('pedestrian');
    expect(wayTypeOf('highway=track')).toBe('track');
  });
  it('estimates duration including climbing', () => {
    expect(estimateDuration(18000, 0, 18)).toBeCloseTo(3600, 0);
    expect(estimateDuration(18000, 100, 18)).toBeCloseTo(4200, 0);
  });
  it('joins multiple legs without duplicate vertices and marks waypoints', () => {
    const leg = parseBrouter(fixture);
    const half = Math.floor(leg.coords.length / 2);
    const a = { ...leg, coords: leg.coords.slice(0, half + 1), surface: leg.surface.slice(0, half + 1), wayType: leg.wayType.slice(0, half + 1), hints: [] };
    const b = { ...leg, coords: leg.coords.slice(half), surface: leg.surface.slice(half), wayType: leg.wayType.slice(half), hints: [] };
    const r = assembleRoute([a, b], profileById('balanced'), [
      { id: 'a', lngLat: [0, 0] }, { id: 'v', lngLat: [0, 0] }, { id: 'b', lngLat: [0, 0] },
    ]);
    expect(r.coords.length).toBe(leg.coords.length);
    expect(r.instructions.some((i) => i.maneuver === 'waypoint')).toBe(true);
  });
});

describe('instructions', () => {
  it('maps angles to maneuvers', () => {
    expect(maneuverFromAngle(-90)).toBe('left');
    expect(maneuverFromAngle(40)).toBe('slight-right');
    expect(maneuverFromAngle(5)).toBe('straight');
    expect(maneuverFromAngle(175)).toBe('uturn');
  });
  it('derives turns from geometry for tracks without hints', () => {
    // L-shaped track: east then north => left turn
    const c: Coord[] = [];
    for (let i = 0; i <= 10; i++) c.push([11 + i * 0.0005, 48, 0]);
    for (let i = 1; i <= 10; i++) c.push([11.005, 48 + i * 0.0005, 0]);
    const ins = buildInstructions(c, cumulative(c), []);
    expect(ins.map((i) => i.maneuver)).toEqual(['depart', 'left', 'arrive']);
  });
  it('speaks distances in German', () => {
    expect(spokenInstruction({ index: 0, along: 0, maneuver: 'left', text: 'Links abbiegen' }, 120)).toBe('In 120 Metern links abbiegen');
    expect(spokenInstruction({ index: 0, along: 0, maneuver: 'right', text: 'Rechts abbiegen' }, 10)).toBe('Jetzt rechts abbiegen');
  });
});

describe('navigation engine', () => {
  it('follows the route, announces turns and arrives', () => {
    const r = munich();
    const nav = new NavigationEngine(r);
    let t = 0;
    const spoken: string[] = [];
    let last;
    for (let d = 0; d <= r.distance + 10; d += 15) {
      const p = pointAlong(r.coords, r.cum, d).point;
      last = nav.update(fix(p, (t += 3000)));
      spoken.push(...last.speak);
      expect(last.offRoute).toBe(false);
    }
    expect(last!.arrived).toBe(true);
    expect(spoken.some((s) => /links|rechts/i.test(s))).toBe(true);
    expect(spoken[spoken.length - 1]).toMatch(/Ziel/);
    // no phrase spoken twice in a row for the same turn
    expect(spoken.length).toBeLessThan(r.instructions.length * 3 + 3);
  });
  it('detects leaving the route after consecutive fixes', () => {
    const r = munich();
    const nav = new NavigationEngine(r);
    let t = 0;
    for (let d = 0; d < 600; d += 20) nav.update(fix(pointAlong(r.coords, r.cum, d).point, (t += 3000)));
    const here = pointAlong(r.coords, r.cum, 600).point;
    const away = destination(here, 150, 0);
    const s1 = nav.update(fix(away, (t += 3000)));
    expect(s1.offRoute).toBe(false);
    nav.update(fix(away, (t += 3000)));
    const s3 = nav.update(fix(away, (t += 3000)));
    expect(s3.offRoute).toBe(true);
    expect(s3.distanceFromRoute).toBeGreaterThan(40);
  });
  it('guides to the route start when far away', () => {
    const r = munich();
    const nav = new NavigationEngine(r);
    const s = nav.update(fix(destination([11.5755, 48.1372], 500, 200), 1000));
    expect(s.approaching).toBe(true);
    expect(s.offRoute).toBe(false);
  });
  it('remaining distance decreases monotonically', () => {
    const r = munich();
    const nav = new NavigationEngine(r);
    let prev = Infinity;
    let t = 0;
    for (let d = 0; d < r.distance; d += 100) {
      const s = nav.update(fix(pointAlong(r.coords, r.cum, d).point, (t += 3000)));
      expect(s.remaining).toBeLessThanOrEqual(prev + 0.001);
      prev = s.remaining;
    }
  });
});

describe('recorder', () => {
  it('accumulates distance, ignores jumps and auto-pauses', () => {
    const rec = new Recorder({ autoPause: true });
    rec.start(0);
    let t = 0;
    for (let i = 0; i <= 100; i++) rec.add({ ...fix(destination([11, 48], i * 10, 90), (t += 2000), 5), altitude: 500 + i * 0.5 });
    const s1 = rec.stats(t);
    expect(s1.distance).toBeGreaterThan(990);
    expect(s1.distance).toBeLessThan(1010);
    expect(s1.ascent).toBeGreaterThan(40);
    // GPS jump of 5 km in 2 s is rejected
    expect(rec.add(fix(destination([11, 48], 6000, 90), (t += 2000), null as any))).toBe(false);
    // standing still for 20 s => auto pause
    const stand = destination([11, 48], 1000, 90);
    for (let i = 0; i < 10; i++) rec.add(fix(stand, (t += 2000), 0));
    expect(rec.status).toBe('autopaused');
    rec.add(fix(destination([11, 48], 1010, 90), (t += 2000), 5));
    expect(rec.status).toBe('recording');
    expect(rec.segments.length).toBe(2);
  });
  it('ignores fixes while manually paused', () => {
    const rec = new Recorder({ autoPause: false });
    rec.start(0);
    rec.add(fix([11, 48], 1000));
    rec.pause();
    expect(rec.add(fix([11.01, 48], 5000))).toBe(false);
    rec.resume();
    rec.add(fix([11.02, 48], 9000));
    rec.add(fix([11.0201, 48], 11000));
    expect(rec.stats().distance).toBeLessThan(20);
  });
  it('never reports more moving time than total time, even on the simulator clock', () => {
    // the ride simulator advances its own clock faster than real time, so a ride
    // played back through it must not end up with movingTime > elapsed
    const rec = new Recorder({ autoPause: false });
    const start = Date.now();
    rec.start(start);
    let t = start;
    for (let i = 1; i <= 60; i++) rec.add(fix(destination([11, 48], i * 20, 90), (t += 4000), 5));
    const s = rec.stats(); // the wall clock has barely moved meanwhile
    expect(s.movingTime).toBeGreaterThan(200);
    expect(s.elapsed).toBeGreaterThanOrEqual(s.movingTime);
  });
  it('does not invent climbing from a noisy fix, but still counts a real one', () => {
    // flat ride, poor reception: the altitude wobbles by +-12 m around 50 m
    const noisy = new Recorder({ autoPause: false });
    noisy.start(0);
    let t = 0;
    for (let i = 0; i <= 120; i++)
      noisy.add({ ...fix(destination([11, 48], i * 15, 90), (t += 2000), 5, 30), altitude: 50 + 12 * Math.sin(i) });
    expect(noisy.stats(t).ascent).toBe(0);

    // same ride, clean reception and a genuine 60 m climb
    const real = new Recorder({ autoPause: false });
    real.start(0);
    t = 0;
    for (let i = 0; i <= 120; i++)
      real.add({ ...fix(destination([11, 48], i * 15, 90), (t += 2000), 5, 5), altitude: 50 + i * 0.5 });
    expect(real.stats(t).ascent).toBeGreaterThan(50);
    expect(real.stats(t).ascent).toBeLessThanOrEqual(60);
  });
  it('ignores a single altitude spike', () => {
    const rec = new Recorder({ autoPause: false });
    rec.start(0);
    let t = 0;
    for (let i = 0; i <= 60; i++)
      rec.add({ ...fix(destination([11, 48], i * 15, 90), (t += 2000), 5, 5), altitude: i === 30 ? 400 : 100 });
    expect(rec.stats(t).ascent).toBe(0);
  });
  it('snapshots and restores', () => {
    const rec = new Recorder();
    rec.start(0);
    rec.add(fix([11, 48], 1000));
    rec.add(fix([11.001, 48], 5000));
    const r2 = Recorder.restore(JSON.parse(JSON.stringify(rec.snapshot())));
    expect(r2.status).toBe('paused');
    expect(r2.points().length).toBe(2);
  });
});

describe('GPX / KML', () => {
  it('round-trips a route through GPX', () => {
    const r = munich();
    const gpx = toGPX('Test <Route>', r.coords, undefined, r.waypoints);
    expect(gpx).toContain('&lt;Route&gt;');
    const t = parseTrackFile(gpx);
    expect(t.name).toBe('Test <Route>');
    expect(t.coords.length).toBe(r.coords.length);
    expect(t.coords[10][2]).toBeCloseTo(r.coords[10][2]!, 0);
  });
  it('parses KML LineStrings', () => {
    const kml = toKML('K', [[11, 48, 500], [11.01, 48.01, 510]]);
    const t = parseTrackFile(kml);
    expect(t.coords).toEqual([[11, 48, 500], [11.01, 48.01, 510]]);
  });
  it('parses GPX routes (rtept) and rejects garbage', () => {
    const t = parseTrackFile('<gpx><rte><rtept lat="48" lon="11"/><rtept lat="48.1" lon="11.1"/></rte></gpx>');
    expect(t.coords.length).toBe(2);
    expect(() => parseTrackFile('<<<nope')).toThrow();
  });
  it('simplifies dense tracks', () => {
    const c: Coord[] = Array.from({ length: 1000 }, (_, i) => [11 + i * 0.00001, 48, 0]);
    const s = simplifyByDistance(c, 5);
    expect(s.length).toBeLessThan(200);
    expect(s[s.length - 1]).toEqual(c[c.length - 1]);
  });
  it('builds a route from a track', () => {
    const r = routeFromTrack(munich().coords);
    expect(r.distance).toBeGreaterThan(4800);
    expect(r.instructions[0].maneuver).toBe('depart');
  });
});

describe('round trip', () => {
  const start: [number, number] = [11.5755, 48.1372];
  // a square block of streets, ~110 m per side
  const A: [number, number] = [11.0, 48.0], B: [number, number] = [11.0015, 48.0], C: [number, number] = [11.0015, 48.001], D: [number, number] = [11.0, 48.001];
  const legOf = (pts: [number, number][], hints: number[][] = []) => ({ coords: pts.map((p) => [p[0], p[1], 500] as [number, number, number]), surface: pts.map(() => 'paved'), wayType: pts.map(() => 'road'), hints });

  it('heads for a turning point in the wanted direction instead of drawing a circle', () => {
    const plain = loopSkeleton({ start, distance: 30000, direction: 90, variant: 0 });
    expect(plain.via).toHaveLength(0);
    expect(haversine(start, plain.turn)).toBeGreaterThan(9000);
    expect(haversine(start, plain.turn)).toBeLessThan(15000);
    expect(Math.abs(bearing(start, plain.turn) - 90)).toBeLessThan(1);
    // riding the other way round keeps the turning point; other variants bend the way out or turn the heading
    expect(loopSkeleton({ start, distance: 30000, direction: 90, variant: 0, reversed: true }).turn).toEqual(plain.turn);
    const bent = loopSkeleton({ start, distance: 30000, direction: 90, variant: 1 });
    expect(bent.via).toHaveLength(1);
    expect(bearing(start, bent.via[0])).toBeGreaterThan(95);
    expect(haversine(start, bent.turn)).toBeLessThan(haversine(start, plain.turn));
    const turned = loopSkeleton({ start, distance: 30000, direction: 90, variant: 3 });
    expect(Math.abs(bearing(start, turned.turn) - 90)).toBeGreaterThan(15);
  });

  it('cuts the hook the way back makes right after the turning point', () => {
    // out along A -> B -> C, back leaves over D, crosses the way out at B again and goes home
    const E: [number, number] = [11.0015, 47.999];
    const leg = legOf([A, B, C, D, [11.0008, 48.0005], B, E, A], [[1, 0, 0, 0, 90], [3, 0, 0, 0, -90]]);
    const cut = cutTurnHook(leg, 2, 2000);
    expect(cut.coords.map((c) => [c[0], c[1]])).toEqual([A, B, E, A]);
    expect(cut.hints.every((h) => h[0] <= 3)).toBe(true);
    expect(cutTurnHook(leg, 2, 100)).toBe(leg); // too long to be a hook
  });

  it('cuts a dead-end spur out of a track and fixes the turn hint', () => {
    const tip: [number, number] = [11.003, 48.0];
    const mid: [number, number] = [11.0022, 48.0];
    // A → B, into the dead end and back, then on to C
    const leg = legOf([A, B, mid, tip, mid, B, C], [[1, 1, 0, 0, 0], [3, 10, 0, 0, 180], [5, 5, 0, 0, 90]]);
    const clean = cleanTrack(leg);
    expect(clean.coords.map((c) => [c[0], c[1]])).toEqual([A, B, C]);
    expect(clean.hints).toHaveLength(1);
    expect(clean.hints[0][0]).toBe(1);
    expect(clean.hints[0][4]).toBeLessThan(-60); // left turn at B, derived from the geometry
  });

  it('cuts a short detour loop but keeps the round trip itself', () => {
    const far: [number, number] = [11.02, 48.0];
    const round = cleanTrack(legOf([A, B, C, D, A]));
    expect(round.coords).toHaveLength(5);
    const detour = cleanTrack(legOf([far, A, B, C, D, A, [10.99, 48.0]]));
    expect(detour.coords.map((c) => [c[0], c[1]])).toEqual([far, A, [10.99, 48.0]]);
  });

  it('measures how much of a track is ridden twice', () => {
    const line: [number, number][] = Array.from({ length: 41 }, (_, i) => [11 + i * 0.0005, 48]);
    expect(overlapShare(line)).toBe(0);
    expect(overlapShare([...line, ...line.slice().reverse()])).toBeGreaterThan(0.7);
  });

  it('describes the way out as weighted no-go circles', () => {
    const line: [number, number][] = Array.from({ length: 200 }, (_, i) => [11 + i * 0.0005, 48]);
    const parts = reuseNogos(line, 8).split('|');
    expect(parts.length).toBeGreaterThan(20);
    expect(parts.length).toBeLessThanOrEqual(225);
    const [lon, lat, radius, weight] = parts[0].split(',').map(Number);
    expect(lon).toBeCloseTo(11, 4);
    expect(lat).toBeCloseTo(48, 4);
    expect(radius).toBeGreaterThanOrEqual(28);
    expect(weight).toBe(8);
  });

  it('moves the turning point to fit the length and keeps the way back off the way out', async () => {
    const calls: { points: number; nogos: boolean }[] = [];
    // a "router" whose roads are straight lines; with no-gos it swings out to one side
    const track = async (pts: [number, number][], _p: unknown, o: { nogos?: string } = {}) => {
      calls.push({ points: pts.length, nogos: !!o.nogos });
      const dense: [number, number][] = [];
      pts.forEach((p, i) => {
        if (i === 0) return dense.push(p);
        const a = pts[i - 1];
        for (let k = 1; k <= 20; k++) {
          const bow = o.nogos ? Math.sin((Math.PI * k) / 20) * 0.02 : 0;
          dense.push([a[0] + ((p[0] - a[0]) * k) / 20 + bow, a[1] + ((p[1] - a[1]) * k) / 20]);
        }
      });
      return legOf(dense);
    };
    const spec = { start, distance: 30000, direction: 0, variant: 0 };
    const route = await computeRoundTrip(spec, 'balanced', { track: track as never });
    expect(calls[0]).toEqual({ points: 2, nogos: false }); // way out: start -> turning point, nothing in between
    expect(calls[calls.length - 1].nogos).toBe(true); // way back avoids the way out
    expect(Math.abs(route.distance - 30000)).toBeLessThan(2400);
    expect(isLoopRoute(route)).toBe(true);
    expect(route.waypoints).toHaveLength(2);
    expect(route.instructions.filter((i) => i.maneuver === 'waypoint')).toHaveLength(0);
    // farthest point lies in the wanted direction
    const far = route.coords.reduce((m, c) => (haversine(start, c) > haversine(start, m) ? c : m), route.coords[0]);
    expect(Math.abs(angleDiff(0, bearing(start, far)))).toBeLessThan(20);

    // the other way round: the penalised half is ridden first
    calls.length = 0;
    const rev = await computeRoundTrip({ ...spec, reversed: true }, 'balanced', { track: track as never });
    expect(isLoopRoute(rev)).toBe(true);
    expect(Math.abs(rev.coords[10][0] - start[0])).toBeGreaterThan(0.001);
  });

  // roads are straight lines; the half that has to avoid the other one bows out to the side
  const fakeTrack = (calls: [number, number][][] = []) => async (pts: [number, number][], _p: unknown, o: { nogos?: string } = {}) => {
    calls.push(pts);
    const dense: [number, number][] = [pts[0]];
    for (let k = 1; k <= 20; k++) {
      const bow = o.nogos ? Math.sin((Math.PI * k) / 20) * 0.01 : 0;
      dense.push([pts[0][0] + ((pts[1][0] - pts[0][0]) * k) / 20 + bow, pts[0][1] + ((pts[1][1] - pts[0][1]) * k) / 20]);
    }
    return legOf(dense);
  };

  it('plans by riding time when a duration is given', async () => {
    // 90 min at 20 km/h: about 30 km
    const route = await computeRoundTrip({ start, distance: 0, duration: 5400, direction: 0, variant: 0 }, 'balanced', { track: fakeTrack() as never, speedKmh: 20 });
    expect(Math.abs(route.duration - 5400)).toBeLessThan(5400 * 0.09);
    expect(Math.abs(route.distance - 30000)).toBeLessThan(3000);
    // the same time on a slower bike gives a shorter tour
    const slow = await computeRoundTrip({ start, distance: 0, duration: 5400, direction: 0, variant: 0 }, 'balanced', { track: fakeTrack() as never, speedKmh: 12 });
    expect(slow.distance).toBeLessThan(route.distance * 0.7);
  });

  it('sorts stops along the heading and turns at the farthest one', () => {
    const near = { id: 'near', lngLat: destination(start, 4000, 55) };
    const farStop = { id: 'far', lngLat: destination(start, 11000, 95) };
    const other = { id: 'other', lngLat: destination(start, 6000, 130) };
    const sk = loopSkeleton({ start, distance: 30000, direction: 90, variant: 0, stops: [farStop, other, near] });
    expect(sk.turnStop?.id).toBe('far');
    expect(sk.via).toHaveLength(0);
    // the two remaining stops lie on opposite sides of the heading: one on the way out, one on the way back
    expect([...sk.out, ...sk.back].map((p) => p.id).sort()).toEqual(['near', 'other']);
    expect(sk.out).toHaveLength(1);
    expect(sk.back).toHaveLength(1);
    // a stop close to the start does not become the turning point
    const short = loopSkeleton({ start, distance: 30000, direction: 90, variant: 0, stops: [near] });
    expect(short.turnStop).toBeUndefined();
    expect(short.out.map((p) => p.id)).toEqual(['near']);
  });

  it('leads the round trip past the stops and names them as waypoints', async () => {
    const stop = { id: 's1', lngLat: destination(start, 5000, 20), name: 'Café' };
    const calls: [number, number][][] = [];
    const route = await computeRoundTrip({ start, distance: 30000, direction: 0, variant: 0, stops: [stop] }, 'balanced', { track: fakeTrack(calls) as never });
    expect(route.waypoints.map((w) => w.id)).toEqual(['loop-start', 's1', 'loop-end']);
    expect(route.coords.some((c) => haversine(c, stop.lngLat) < 30)).toBe(true);
    expect(route.instructions.filter((i) => i.maneuver === 'waypoint')).toHaveLength(1);
    expect(Math.abs(route.distance - 30000)).toBeLessThan(3000);
    expect(isLoopRoute(route)).toBe(true);
    // the other way round the stop is still on the tour
    const rev = await computeRoundTrip({ start, distance: 30000, direction: 0, variant: 0, reversed: true, stops: [stop] }, 'balanced', { track: fakeTrack() as never });
    expect(rev.coords.some((c) => haversine(c, stop.lngLat) < 30)).toBe(true);
  });

  it('says what to change when a stop is too far away or lies the other way', async () => {
    const farStop = { lngLat: destination(start, 20000, 10), name: 'Starnberg, Bayern' };
    const tooShort = await computeRoundTrip({ start, distance: 20000, direction: 0, variant: 0, stops: [farStop] }, 'balanced', { track: fakeTrack() as never }).catch((e) => e);
    expect(tooShort).toBeInstanceOf(LoopProblem);
    expect(tooShort.kind).toBe('too-short');
    expect(tooShort.fix.distance).toBeGreaterThan(40000);
    expect(tooShort.message).toMatch(/mindestens rund \d+ km/);
    // with the suggested length it works
    const ok = await computeRoundTrip({ start, distance: Math.ceil(tooShort.fix.distance / 5000) * 5000, direction: 0, variant: 0, stops: [farStop] }, 'balanced', { track: fakeTrack() as never });
    expect(isLoopRoute(ok)).toBe(true);

    // time-based: the suggestion is a riding time
    const tooQuick = await computeRoundTrip({ start, distance: 0, duration: 3600, direction: 0, variant: 0, stops: [farStop] }, 'balanced', { track: fakeTrack() as never, speedKmh: 20 }).catch((e) => e);
    expect(tooQuick.kind).toBe('too-short');
    expect(tooQuick.fix.duration).toBeGreaterThan(7000);
    expect(tooQuick.message).toMatch(/dauert die Rundtour mindestens/);

    const behind = { lngLat: destination(start, 6000, 180), name: 'Sendling' };
    const wrongWay = await computeRoundTrip({ start, distance: 30000, direction: 0, variant: 0, stops: [behind] }, 'balanced', { track: fakeTrack() as never }).catch((e) => e);
    expect(wrongWay).toBeInstanceOf(LoopProblem);
    expect(wrongWay.kind).toBe('direction');
    expect(wrongWay.fix.direction).toBe(180);
    expect(wrongWay.message).toContain('„Sendling“ liegt im Süden');
    const turned = await computeRoundTrip({ start, distance: 30000, direction: wrongWay.fix.direction, variant: 0, stops: [behind] }, 'balanced', { track: fakeTrack() as never });
    expect(turned.coords.some((c) => haversine(c, behind.lngLat) < 30)).toBe(true);
  });
});

describe('bike', () => {
  it('derives the pace from the bike type, an own tempo and the routing option', () => {
    expect(rideSpeed({}, 'balanced')).toBe(18); // trekking bike by default
    expect(rideSpeed({ bikeType: 'road' }, 'balanced')).toBe(26);
    expect(rideSpeed({ bikeType: 'road', bikeSpeed: 30 }, 'balanced')).toBe(30);
    expect(rideSpeed({ bikeType: 'mtb' }, 'mtb')).toBeLessThan(bikeSpeed({ bikeType: 'mtb' }));
    expect(BIKE_TYPES.map((b) => b.id)).toContain('ebike');
  });
});

describe('offline tiles', () => {
  it('computes slippy tile indices', () => {
    expect(lon2tile(11.5755, 10)).toBe(544);
    expect(lat2tile(48.1372, 10)).toBe(355);
    const bb: [number, number, number, number] = [11.5, 48.1, 11.6, 48.2];
    expect(tilesInBbox(bb, 6, 12).length).toBe(countTiles(bb, 6, 12));
  });
});

describe('misc', () => {
  it('parses Photon results and coordinates', () => {
    const p = parsePhoton({ features: [{ geometry: { coordinates: [11.5, 48.1] }, properties: { name: 'Marienplatz', city: 'München', country: 'Deutschland', osm_id: 1, osm_type: 'N' } }] });
    expect(p[0].name).toBe('Marienplatz');
    expect(p[0].detail).toContain('München');
    expect(parseCoordinates('48,137 11,575')).toEqual([11.575, 48.137]);
    expect(parseCoordinates('48.137, 11.575')).toEqual([11.575, 48.137]);
    expect(parseCoordinates('Berlin')).toBeNull();
  });
  it('colours route by surface and gradient', () => {
    const r = munich();
    expect(colouredLines(r, 'solid').features.length).toBe(1);
    const s = colouredLines(r, 'surface');
    expect(s.features.length).toBeGreaterThan(1);
    const pts = s.features.reduce((a, f) => a + f.geometry.coordinates.length - 1, 0);
    expect(pts).toBe(r.coords.length - 1);
    expect(grades(r).length).toBe(r.coords.length);
  });
  it('computes head/tail wind shares', () => {
    const w = headwindShare([{ bearing: 0, len: 1 }, { bearing: 180, len: 1 }], 0);
    expect(w.head).toBeCloseTo(0.5);
    expect(w.tail).toBeCloseTo(0.5);
  });
  it('finds the map tiles that carry the POIs', () => {
    // zoom-14 tiles of a small box in Hamburg: 2 × 2
    expect(tilesFor([9.99, 53.55, 10.01, 53.555])).toEqual([[8646, 5294], [8646, 5295], [8647, 5294], [8647, 5295]]);
    expect(decodePoiTile(new Uint8Array(0), 0, 0)).toEqual([]);
  });
  it('builds links to Google Maps and Tripadvisor', () => {
    expect(googleMapsUrl('Asia Pho&Co', [7.4572, 53.2606], 'Leer')).toBe('https://www.google.com/maps/search/?api=1&query=Asia%20Pho%26Co%2C%20Leer');
    expect(googleMapsUrl(undefined, [7.4572, 53.2606])).toBe('https://www.google.com/maps/search/?api=1&query=53.260600%2C7.457200');
    expect(tripadvisorUrl('Eiscafé Milano', 'food', 'Leer')).toBe('https://www.tripadvisor.de/Search?q=Eisca' + 'f%C3%A9%20Milano%20Leer');
    expect(tripadvisorUrl('WC', 'toilets', 'Leer')).toBeNull();
    expect(tripadvisorUrl(undefined, 'restaurant')).toBeNull();
  });
  it('sorts places from the map tiles into the POI map categories', () => {
    expect(classifyTilePoi('restaurant', 'restaurant')).toBe('restaurant');
    expect(classifyTilePoi('beer', 'biergarten')).toBe('food');
    expect(classifyTilePoi('beer', 'pub')).toBeNull();
    expect(classifyTilePoi('grocery', 'supermarket')).toBe('shop');
    expect(classifyTilePoi('attraction', 'viewpoint')).toBe('viewpoint');
    expect(classifyTilePoi('fuel', 'charging_station')).toBeNull();
    expect(classifyTilePoi('railway', 'tram_stop')).toBeNull();
  });
});
