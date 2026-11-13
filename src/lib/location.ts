import { bearing, haversine, pointAlong, type Coord, type LngLat } from './geo';
import type { Fix } from './navigation';

export type FixListener = (f: Fix) => void;
export type ErrorListener = (msg: string) => void;

/**
 * Location source: real GPS (watchPosition) or a simulator that rides along a route —
 * used for the in-app "Simulation" mode and for automated tests.
 */
class LocationService {
  private listeners = new Set<FixListener>();
  private errorListeners = new Set<ErrorListener>();
  private watchId: number | null = null;
  private simTimer: number | null = null;
  last: Fix | null = null;
  simulating = false;
  /** battery save mode: fewer position updates */
  private lowPower = false;

  setLowPower(on: boolean) {
    if (this.lowPower === on) return;
    this.lowPower = on;
    if (this.watchId != null) {
      this.stopWatch();
      this.ensureStarted();
    }
  }

  subscribe(fn: FixListener, onError?: ErrorListener) {
    this.listeners.add(fn);
    if (onError) this.errorListeners.add(onError);
    // replay the last position only if it is fresh
    if (this.last && Date.now() - this.last.time < 15000) fn(this.last);
    this.ensureStarted();
    return () => {
      this.listeners.delete(fn);
      if (onError) this.errorListeners.delete(onError);
    };
  }

  private emit(f: Fix) {
    this.last = f;
    for (const l of this.listeners) l(f);
  }

  ensureStarted() {
    if (this.simulating || this.watchId != null) return;
    if (!('geolocation' in navigator)) {
      this.errorListeners.forEach((e) => e('GPS wird nicht unterstützt'));
      return;
    }
    this.watchId = navigator.geolocation.watchPosition(
      (p) =>
        this.emit({
          lngLat: [p.coords.longitude, p.coords.latitude],
          accuracy: p.coords.accuracy,
          speed: p.coords.speed,
          heading: p.coords.heading,
          altitude: p.coords.altitude,
          time: p.timestamp,
        }),
      (err) => {
        const msg = err.code === 1 ? 'Standortzugriff verweigert – bitte in den Einstellungen erlauben' : 'Kein GPS-Signal';
        this.errorListeners.forEach((e) => e(msg));
        if (err.code === 1) this.stopWatch();
      },
      this.lowPower
        ? { enableHighAccuracy: false, maximumAge: 8000, timeout: 30000 }
        : { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  private stopWatch() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
  }

  /** Simulate riding along coords at speedKmh (time-compressed by `factor`). */
  simulate(coords: Coord[], cum: number[], speedKmh = 20, factor = 1, offsetStart = 0) {
    this.stopSimulation();
    this.stopWatch();
    this.simulating = true;
    let along = offsetStart;
    const v = speedKmh / 3.6;
    const tick = 1000;
    let t = Date.now();
    const total = cum[cum.length - 1];
    const step = () => {
      along = Math.min(total, along + v * factor * (tick / 1000));
      t += tick * factor;
      const { point, index } = pointAlong(coords, cum, along);
      const next = coords[Math.min(index + 1, coords.length - 1)];
      const ele = coords[index][2] ?? null;
      this.emit({ lngLat: point, accuracy: 5, speed: v, heading: bearing(point, next), altitude: ele, time: t });
      if (along >= total) this.stopSimulation(false);
    };
    step();
    this.simTimer = window.setInterval(step, tick);
  }

  stopSimulation(restartGps = true) {
    if (this.simTimer != null) clearInterval(this.simTimer);
    this.simTimer = null;
    if (this.simulating && restartGps) {
      this.simulating = false;
      this.ensureStarted();
    } else if (!restartGps) {
      // keep simulating flag until user ends; position stays at the end
    }
  }

  endSimulation() {
    if (this.simTimer != null) clearInterval(this.simTimer);
    this.simTimer = null;
    this.simulating = false;
    this.ensureStarted();
  }

  /** inject a fix manually (tests / debugging) */
  inject(lngLat: LngLat, speed = 5) {
    const prev = this.last;
    this.emit({
      lngLat,
      accuracy: 5,
      speed,
      heading: prev ? bearing(prev.lngLat, lngLat) : null,
      altitude: null,
      time: prev ? prev.time + Math.max(1000, (haversine(prev.lngLat, lngLat) / speed) * 1000) : Date.now(),
    });
  }
}

export const location = new LocationService();
