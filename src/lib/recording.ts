import { elevationGain, haversine, type Coord } from './geo';
import type { Fix } from './navigation';

export interface TrackPoint {
  lon: number;
  lat: number;
  ele: number | null;
  time: number;
  speed: number | null;
  /** horizontal accuracy of the fix in m; absent in tracks recorded before 1.1 */
  acc?: number;
}

export interface RideStats {
  distance: number;
  movingTime: number; // s
  elapsed: number; // s
  avgSpeed: number; // m/s (moving)
  maxSpeed: number; // m/s
  ascent: number;
  descent: number;
  currentSpeed: number;
}

/**
 * Altitude from a phone is far noisier than its horizontal position: there is no
 * barometer to lean on, and the vertical error of a GNSS fix runs at roughly 1.5× the
 * reported horizontal accuracy. Taken raw, a ride that never left the flat can report
 * a few hundred metres of climbing. Two guards, each tied to something measurable:
 *
 *  - a short median filter, which removes single-sample spikes outright instead of
 *    smearing them over their neighbours the way an average would;
 *  - a gain threshold derived from the ride's own accuracy, so a clean ride in the
 *    open still counts small rollers while a poor fix stops inventing climbs.
 *
 * The track points keep their raw values, so a GPX export still carries what the
 * device actually reported.
 */
const ELE_WINDOW = 5;

export function smoothedElevations(pts: TrackPoint[]): (number | null)[] {
  const half = Math.floor(ELE_WINDOW / 2);
  return pts.map((p, i) => {
    if (p.ele == null) return null;
    const w: number[] = [];
    for (let k = Math.max(0, i - half); k <= Math.min(pts.length - 1, i + half); k++) {
      const e = pts[k].ele;
      if (e != null) w.push(e);
    }
    w.sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
}

/** Minimum rise that counts as climbing, in m — see smoothedElevations. */
export function gainThreshold(pts: TrackPoint[]): number {
  const accs = pts.map((p) => p.acc).filter((a): a is number => a != null && a > 0).sort((a, b) => a - b);
  if (!accs.length) return 5;
  return Math.min(30, Math.max(5, accs[Math.floor(accs.length / 2)] * 1.5));
}

export type RecorderStatus = 'idle' | 'recording' | 'paused' | 'autopaused';

export interface RecorderOptions {
  autoPause?: boolean;
  maxAccuracy?: number;
  /** auto-pause below / resume above this speed (km/h) */
  autoPauseSpeedKmh?: number;
  /** auto-pause decisions only with GPS accuracy better than this (m) */
  autoPauseAccuracy?: number;
  /** time below the speed before pausing (ms) */
  autoPauseDelayMs?: number;
}

/**
 * Ride recorder. Pure logic: feed it fixes; it filters noise and keeps stats.
 * Segments are split on pause so paused movement never counts as distance.
 */
export class Recorder {
  segments: TrackPoint[][] = [];
  status: RecorderStatus = 'idle';
  startedAt = 0;
  private distance = 0;
  private movingTime = 0;
  private maxSpeed = 0;
  private lastFix: TrackPoint | null = null;
  private slowSince: number | null = null;
  private currentSpeed = 0;
  opts: Required<RecorderOptions>;

  constructor(opts: RecorderOptions = {}) {
    this.opts = {
      autoPause: opts.autoPause ?? true,
      maxAccuracy: opts.maxAccuracy ?? 40,
      autoPauseSpeedKmh: opts.autoPauseSpeedKmh ?? 2,
      autoPauseAccuracy: opts.autoPauseAccuracy ?? 15,
      autoPauseDelayMs: opts.autoPauseDelayMs ?? 5000,
    };
  }

  start(now = Date.now()) {
    this.status = 'recording';
    this.startedAt = now;
    this.segments = [[]];
  }

  pause() {
    if (this.status === 'recording' || this.status === 'autopaused') {
      this.status = 'paused';
      this.lastFix = null;
    }
  }

  resume() {
    if (this.status === 'paused' || this.status === 'autopaused') {
      this.status = 'recording';
      this.segments.push([]);
      this.lastFix = null;
      this.slowSince = null;
    }
  }

  /** returns true if the point was accepted */
  add(fix: Fix): boolean {
    if (this.status === 'idle' || this.status === 'paused') return false;
    if (fix.accuracy > this.opts.maxAccuracy) return false;
    const p: TrackPoint = {
      lon: fix.lngLat[0],
      lat: fix.lngLat[1],
      ele: fix.altitude,
      time: fix.time,
      speed: fix.speed,
      acc: fix.accuracy,
    };
    const prev = this.lastFix;
    if (!prev) {
      this.lastFix = p;
      if (this.status === 'recording') this.segments[this.segments.length - 1].push(p);
      return true;
    }
    const d = haversine([prev.lon, prev.lat], [p.lon, p.lat]);
    const dt = Math.max(0.001, (p.time - prev.time) / 1000);
    const v = fix.speed != null && fix.speed >= 0 ? fix.speed : d / dt;
    if (d / dt > 30) return false; // GPS jump (> 108 km/h)
    this.currentSpeed = v;

    if (this.opts.autoPause && fix.accuracy < this.opts.autoPauseAccuracy) {
      // pause below 2 km/h, resume above it – only with a precise fix
      const limit = this.opts.autoPauseSpeedKmh / 3.6;
      if (v < limit) {
        this.slowSince ??= p.time;
        if (this.status === 'recording' && p.time - this.slowSince >= this.opts.autoPauseDelayMs) {
          this.status = 'autopaused';
        }
      } else {
        this.slowSince = null;
        if (this.status === 'autopaused') {
          this.status = 'recording';
          this.segments.push([]);
          this.lastFix = p;
          this.segments[this.segments.length - 1].push(p);
          return true;
        }
      }
    }
    if (this.status === 'autopaused') {
      this.lastFix = p;
      return false;
    }
    if (d < 2 && v < 1) return false; // standing still jitter
    this.distance += d;
    this.movingTime += dt;
    if (v > this.maxSpeed && v < 30) this.maxSpeed = v;
    this.lastFix = p;
    this.segments[this.segments.length - 1].push(p);
    return true;
  }

  /**
   * Called periodically: if no position arrived for `staleMs` while recording,
   * auto-pause (triggered once updates are older than twice the watchdog interval).
   * Returns true when the status changed.
   */
  tick(now: number, lastFixTime: number | null, staleMs = 10000): boolean {
    if (!this.opts.autoPause || this.status !== 'recording' || lastFixTime == null) return false;
    if (now - lastFixTime > staleMs) {
      this.status = 'autopaused';
      return true;
    }
    return false;
  }

  points(): TrackPoint[] {
    return this.segments.flat();
  }

  stats(now = Date.now()): RideStats {
    const pts = this.points();
    const eles = smoothedElevations(pts).filter((e): e is number => e != null);
    const { up, down } = elevationGain(eles, gainThreshold(pts));
    // Moving time is summed from the fixes' own timestamps, so elapsed has to come
    // from the same clock. The simulator runs ahead of the wall clock, and a real
    // ride can be restored after the device slept; taking whichever is later keeps
    // the invariant movingTime <= elapsed.
    const lastPoint = pts.length ? pts[pts.length - 1].time : 0;
    const end = Math.max(now, lastPoint);
    return {
      distance: this.distance,
      movingTime: this.movingTime,
      elapsed: this.startedAt ? (end - this.startedAt) / 1000 : 0,
      avgSpeed: this.movingTime > 0 ? this.distance / this.movingTime : 0,
      maxSpeed: this.maxSpeed,
      ascent: up,
      descent: down,
      currentSpeed: this.status === 'recording' ? this.currentSpeed : 0,
    };
  }

  coords(): Coord[] {
    const pts = this.points();
    const eles = smoothedElevations(pts);
    return pts.map((p, i) => [p.lon, p.lat, eles[i] ?? undefined]);
  }

  /** serialisable snapshot for crash-safe persistence */
  snapshot() {
    return {
      segments: this.segments,
      status: this.status,
      startedAt: this.startedAt,
      distance: this.distance,
      movingTime: this.movingTime,
      maxSpeed: this.maxSpeed,
    };
  }

  static restore(s: ReturnType<Recorder['snapshot']>, opts?: RecorderOptions): Recorder {
    const r = new Recorder(opts);
    r.segments = s.segments;
    r.status = s.status === 'recording' || s.status === 'autopaused' ? 'paused' : s.status;
    r.startedAt = s.startedAt;
    r.distance = s.distance;
    r.movingTime = s.movingTime;
    r.maxSpeed = s.maxSpeed;
    return r;
  }
}
