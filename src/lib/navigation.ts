import { climbState, detectClimbs, type Climb } from './climbs';
import { haversine, snapToLine, type LngLat } from './geo';
import type { Instruction } from './instructions';
import { spokenInstruction } from './instructions';
import type { Route } from './routing';

export interface Fix {
  lngLat: LngLat;
  accuracy: number; // m
  speed: number | null; // m/s
  heading: number | null;
  altitude: number | null;
  time: number; // ms epoch
}

export interface NavState {
  snapped: LngLat;
  along: number;
  remaining: number;
  remainingTime: number;
  distanceFromRoute: number;
  next: Instruction | null;
  afterNext: Instruction | null;
  distanceToNext: number;
  offRoute: boolean;
  /** true until the rider first reaches the route (guides to the start) */
  approaching: boolean;
  arrived: boolean;
  /** phrases to speak now (may be empty) */
  speak: string[];
  /** index of the next waypoint not yet passed (for rerouting) */
  nextWaypointIndex: number;
  /** climb the rider is in / approaching (bike computer "Anstieg 2/5") */
  climb: ReturnType<typeof climbState>;
}

export interface NavOptions {
  offRouteDistance?: number;
  offRouteFixes?: number;
  arriveDistance?: number;
  speedKmh?: number;
  /** false = self-guided: no turn announcements, only position + off-route warning */
  guided?: boolean;
  /** announce climbs/descents ahead */
  climbAnnouncements?: boolean;
}

function climbPhrase(c: Climb, distance: number): string {
  const when = distance > 500 ? 'in 1 Kilometer' : 'in 100 Metern';
  const len = c.endAlong - c.startAlong;
  const lenTxt = len >= 1000 ? `${(Math.round(len / 100) / 10).toString().replace('.', ',')} Kilometer` : `${Math.round(len / 50) * 50} Meter`;
  return c.type === 'climb'
    ? `Anstieg ${when}: ${lenTxt} mit ${Math.round(c.grade)} Prozent`
    : `Abfahrt ${when}: ${lenTxt} mit ${Math.round(c.grade)} Prozent Gefälle`;
}

const ANNOUNCE = [400, 120, 25];

export class NavigationEngine {
  route: Route;
  private lastIndex = 0;
  private along = 0;
  private offCount = 0;
  private onRouteOnce = false;
  private spoken = new Set<string>();
  private opts: Required<NavOptions>;
  private waypointAlongs: number[];
  climbs: Climb[] = [];
  arrived = false;

  constructor(route: Route, opts: NavOptions = {}) {
    this.route = route;
    this.opts = {
      offRouteDistance: opts.offRouteDistance ?? 40,
      offRouteFixes: opts.offRouteFixes ?? 3,
      arriveDistance: opts.arriveDistance ?? 25,
      speedKmh: opts.speedKmh ?? 18,
      guided: opts.guided ?? true,
      climbAnnouncements: opts.climbAnnouncements ?? true,
    };
    this.climbs = detectClimbs(route);
    // along-distance of each waypoint (snap waypoint onto the line)
    this.waypointAlongs = route.waypoints.map((w, i) => {
      if (i === 0) return 0;
      if (i === route.waypoints.length - 1) return route.distance;
      return snapToLine(w.lngLat, route.coords, route.cum)?.along ?? 0;
    });
  }

  /** Replace the route after a reroute; spoken state is kept for instructions far away. */
  setRoute(route: Route) {
    this.route = route;
    this.lastIndex = 0;
    this.along = 0;
    this.offCount = 0;
    this.spoken.clear();
    this.climbs = detectClimbs(route);
    this.waypointAlongs = route.waypoints.map((w, i) =>
      i === 0 ? 0 : i === route.waypoints.length - 1 ? route.distance : snapToLine(w.lngLat, route.coords, route.cum)?.along ?? 0,
    );
  }

  update(fix: Fix): NavState {
    const { coords, cum } = this.route;
    const speak: string[] = [];
    // Search a forward window first (prevents jumping to a parallel section of a loop).
    let snap = snapToLine(fix.lngLat, coords, cum, Math.max(0, this.lastIndex - 3), this.lastIndex + 150);
    if (!snap || snap.distance > this.opts.offRouteDistance) {
      const full = snapToLine(fix.lngLat, coords, cum);
      if (full && (!snap || full.distance < snap.distance - 5)) snap = full;
    }
    if (!snap) throw new Error('empty route');

    const tolerance = Math.max(this.opts.offRouteDistance, Math.min(fix.accuracy * 1.5, 80));
    const near = snap.distance <= tolerance;
    if (near) {
      this.offCount = 0;
      if (!this.onRouteOnce && snap.distance < 30) this.onRouteOnce = true;
      // monotonic progress, allowing small backwards GPS jitter
      if (snap.along >= this.along - 30 || !this.onRouteOnce) {
        this.along = snap.along;
        this.lastIndex = snap.index;
      }
    } else if (this.onRouteOnce) {
      this.offCount++;
    }
    const offRoute = this.onRouteOnce && this.offCount >= this.opts.offRouteFixes;

    const remaining = Math.max(0, this.route.distance - this.along);
    const ins = this.route.instructions;
    let ni = ins.findIndex((i) => i.along > this.along + 3 && i.maneuver !== 'depart');
    if (ni < 0) ni = ins.length - 1;
    const next = ins[ni] ?? null;
    const afterNext = ins[ni + 1] ?? null;
    const distanceToNext = next ? Math.max(0, next.along - this.along) : 0;

    const end = coords[coords.length - 1];
    if (!this.arrived && this.onRouteOnce && (remaining < this.opts.arriveDistance ||
      // the straight-line test must not fire at the start of a loop, where start and end coincide
      (haversine(fix.lngLat, end) < this.opts.arriveDistance && remaining < Math.max(200, this.route.distance * 0.2)))) {
      this.arrived = true;
      speak.push('Du hast dein Ziel erreicht');
    }

    if (offRoute && !this.opts.guided && !this.spoken.has(`off-${this.lastIndex}`)) {
      this.spoken.add(`off-${this.lastIndex}`);
      speak.push('Du hast die Route verlassen');
    }
    if (near) for (const k of [...this.spoken]) if (k.startsWith('off-')) this.spoken.delete(k);

    if (this.opts.guided && !this.arrived && !offRoute && next && this.onRouteOnce) {
      for (const t of ANNOUNCE) {
        const key = `${next.along.toFixed(0)}-${t}`;
        if (distanceToNext <= t && !this.spoken.has(key)) {
          // mark all larger thresholds as done too, speak only the closest
          for (const t2 of ANNOUNCE) if (t2 >= t) this.spoken.add(`${next.along.toFixed(0)}-${t2}`);
          if (next.maneuver !== 'waypoint' || t === 25) {
            speak.length = 0;
            speak.push(spokenInstruction(next, distanceToNext));
          }
        }
      }
    }
    // climb / descent announcements 1 km and 100 m ahead
    if (this.opts.climbAnnouncements && this.onRouteOnce && !offRoute && !this.arrived) {
      for (const c of this.climbs) {
        const d = c.startAlong - this.along;
        for (const [t, lo] of [[1000, 700], [100, 0]] as const) {
          const key = `climb-${c.startAlong}-${t}`;
          if (d <= t && d > lo && !this.spoken.has(key)) {
            this.spoken.add(key);
            if (t === 1000) this.spoken.add(`climb-${c.startAlong}-1000`);
            speak.push(climbPhrase(c, d));
          }
        }
      }
    }

    if (!this.onRouteOnce && !this.spoken.has('approach')) {
      this.spoken.add('approach');
      speak.push('Fahre zur Route');
    }

    let nextWaypointIndex = this.waypointAlongs.findIndex((a) => a > this.along + 20);
    if (nextWaypointIndex < 0) nextWaypointIndex = this.waypointAlongs.length - 1;

    const v = fix.speed && fix.speed > 1.5 ? fix.speed : this.opts.speedKmh / 3.6;
    return {
      snapped: near || !this.onRouteOnce ? snap.point : fix.lngLat,
      along: this.along,
      remaining,
      remainingTime: remaining / v,
      distanceFromRoute: snap.distance,
      next,
      afterNext,
      distanceToNext,
      offRoute,
      approaching: !this.onRouteOnce,
      arrived: this.arrived,
      speak,
      nextWaypointIndex,
      climb: climbState(this.climbs, this.along),
    };
  }

  /** true = turn-by-turn, false = self-guided */
  get guided() {
    return this.opts.guided;
  }

  /** along-distances of the route's waypoints */
  get waypointPositions() {
    return this.waypointAlongs;
  }

  /** current progress along the route (m) */
  get progress() {
    return this.along;
  }

  /** Called after a reroute was triggered so we don't loop. */
  resetOffRoute() {
    this.offCount = 0;
  }
}
