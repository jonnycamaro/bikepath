/** Geometry helpers. Coordinates are [lon, lat] or [lon, lat, ele]. Distances in metres. */
export type LngLat = [number, number];
export type Coord = [number, number, number?];

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function haversine(a: Coord | LngLat, b: Coord | LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees 0..360 (0 = north). */
export function bearing(a: Coord | LngLat, b: Coord | LngLat): number {
  const φ1 = rad(a[1]);
  const φ2 = rad(b[1]);
  const Δλ = rad(b[0] - a[0]);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at distance/bearing from origin. */
export function destination(o: LngLat, distance: number, brng: number): LngLat {
  const δ = distance / R;
  const θ = rad(brng);
  const φ1 = rad(o[1]);
  const λ1 = rad(o[0]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((deg(λ2) + 540) % 360) - 180, deg(φ2)];
}

/** Cumulative distance along a polyline; result[i] = distance from start to coords[i]. */
export function cumulative(coords: Coord[]): number[] {
  const out = new Array<number>(coords.length);
  let d = 0;
  for (let i = 0; i < coords.length; i++) {
    if (i > 0) d += haversine(coords[i - 1], coords[i]);
    out[i] = d;
  }
  return out;
}

export interface Snap {
  /** index of segment start vertex */
  index: number;
  /** fraction 0..1 along the segment */
  t: number;
  /** snapped point */
  point: LngLat;
  /** distance from the query point to the line (m) */
  distance: number;
  /** distance along the line from its start (m) */
  along: number;
}

/**
 * Snap a point to a polyline using a local equirectangular projection (accurate for
 * the short segment lengths of routes). `from`/`to` optionally restrict the search window.
 */
export function snapToLine(
  p: LngLat,
  coords: Coord[],
  cum: number[],
  from = 0,
  to = coords.length - 1,
): Snap | null {
  if (coords.length === 0) return null;
  if (coords.length === 1) {
    return { index: 0, t: 0, point: [coords[0][0], coords[0][1]], distance: haversine(p, coords[0]), along: 0 };
  }
  const kx = Math.cos(rad(p[1])) * 111320;
  const ky = 110540;
  let best: Snap | null = null;
  const start = Math.max(0, from);
  const end = Math.min(coords.length - 1, to);
  for (let i = start; i < end; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const ax = (a[0] - p[0]) * kx;
    const ay = (a[1] - p[1]) * ky;
    const bx = (b[0] - p[0]) * kx;
    const by = (b[1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + t * dx;
    const y = ay + t * dy;
    const dist = Math.sqrt(x * x + y * y);
    if (!best || dist < best.distance) {
      const segLen = cum[i + 1] - cum[i];
      best = {
        index: i,
        t,
        point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
        distance: dist,
        along: cum[i] + segLen * t,
      };
    }
  }
  return best;
}

/** Point at a given distance along a polyline. */
export function pointAlong(coords: Coord[], cum: number[], along: number): { point: LngLat; index: number } {
  if (along <= 0) return { point: [coords[0][0], coords[0][1]], index: 0 };
  const total = cum[cum.length - 1];
  if (along >= total) {
    const l = coords[coords.length - 1];
    return { point: [l[0], l[1]], index: coords.length - 2 };
  }
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo];
  const t = seg === 0 ? 0 : (along - cum[lo]) / seg;
  const a = coords[lo];
  const b = coords[hi];
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], index: lo };
}

export function bbox(coords: (Coord | LngLat)[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const c of coords) {
    if (c[0] < w) w = c[0];
    if (c[0] > e) e = c[0];
    if (c[1] < s) s = c[1];
    if (c[1] > n) n = c[1];
  }
  return [w, s, e, n];
}

/** Ascent/descent with a hysteresis threshold to suppress GPS/DEM noise. */
export function elevationGain(eles: number[], threshold = 3): { up: number; down: number } {
  let up = 0;
  let down = 0;
  let ref: number | undefined;
  for (const e of eles) {
    if (e == null || Number.isNaN(e)) continue;
    if (ref === undefined) {
      ref = e;
      continue;
    }
    const d = e - ref;
    if (d >= threshold) {
      up += d;
      ref = e;
    } else if (d <= -threshold) {
      down -= d;
      ref = e;
    }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

/** Signed smallest difference between two headings (-180..180). */
export function angleDiff(a: number, b: number): number {
  return ((b - a + 540) % 360) - 180;
}

export function formatDistance(m: number, imperial = false): string {
  if (imperial) {
    const mi = m / 1609.344;
    if (mi < 0.1) return `${Math.round(m * 3.28084 / 10) * 10} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (m < 1000) return `${Math.max(0, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 100 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export function formatClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatSpeed(ms: number, imperial = false): string {
  const v = imperial ? ms * 2.236936 : ms * 3.6;
  return v.toFixed(1).replace('.', ',');
}
