import { cumulative, elevationGain, haversine, type Coord, type LngLat } from './geo';
import { buildInstructions, type Instruction } from './instructions';

/** Routing profiles, mapped to BRouter profiles. */
export interface RoutingProfile {
  id: string;
  label: string;
  description: string;
  brouter: string | null; // null = freehand (straight lines)
  /** BRouter profile variable overrides (sent as profile:<name>=<value>) */
  params?: Record<string, string | number>;
  speedKmh: number; // default estimated speed
  icon: string;
}

/** Cycle-path preference for the loop planner: low / medium / high. */
export type CyclePathPref = 'low' | 'medium' | 'high';
export const CYCLEPATH_PARAMS: Record<CyclePathPref, Record<string, number>> = {
  low: {},
  medium: { avoid_unsafe: 1 },
  high: { avoid_unsafe: 1, stick_to_cycleroutes: 1 },
};

export const PROFILES: RoutingProfile[] = [
  { id: 'balanced', label: 'Ausgewogen', description: 'Guter Mix aus Radwegen, ruhigen Straßen und Direktheit', brouter: 'trekking', speedKmh: 18, icon: 'balanced' },
  { id: 'fastest', label: 'Schnellste', description: 'Direkt und zügig, auch auf Hauptstraßen', brouter: 'fastbike', speedKmh: 22, icon: 'fast' },
  { id: 'cyclepaths', label: 'Radwege', description: 'Bevorzugt Radwege und verkehrsarme Wege', brouter: 'safety', speedKmh: 17, icon: 'shield' },
  { id: 'road', label: 'Rennrad', description: 'Nur befestigte Wege, wenig Verkehr', brouter: 'fastbike-lowtraffic', speedKmh: 26, icon: 'road' },
  { id: 'smooth', label: 'Geschmeidig', description: 'Glatter Asphalt, wenig Verkehr, keine Stufen – entspannt rollen', brouter: 'fastbike-lowtraffic', params: { allow_steps: 0 }, speedKmh: 18, icon: 'smooth' },
  { id: 'gravel', label: 'Gravel', description: 'Schotter- und Feldwege willkommen', brouter: 'trekking', speedKmh: 19, icon: 'gravel' },
  { id: 'mtb', label: 'Mountainbike', description: 'Trails und unbefestigte Wege', brouter: 'mtb', speedKmh: 14, icon: 'mtb' },
  { id: 'ebike', label: 'E-Bike', description: 'Mehr Steigung ok, keine Treppen', brouter: 'trekking', speedKmh: 23, icon: 'ebike' },
  { id: 'shortest', label: 'Kürzeste', description: 'Kürzester Weg', brouter: 'shortest', speedKmh: 17, icon: 'short' },
  { id: 'freehand', label: 'Freihand', description: 'Gerade Linien ohne Routing', brouter: null, speedKmh: 18, icon: 'pen' },
];

export const profileById = (id: string) => PROFILES.find((p) => p.id === id) ?? PROFILES[0];

export interface Waypoint {
  id: string;
  lngLat: LngLat;
  name?: string;
}

export interface SegmentStat {
  key: string;
  distance: number;
}

export interface Route {
  coords: Coord[]; // [lon, lat, ele]
  cum: number[];
  distance: number;
  ascent: number;
  descent: number;
  /** seconds, derived from distance, ascent and profile speed */
  duration: number;
  instructions: Instruction[];
  surfaces: SegmentStat[];
  wayTypes: SegmentStat[];
  /** per-coordinate surface/waytype category, for colouring the line */
  pointSurface: string[];
  pointWayType: string[];
  profileId: string;
  waypoints: Waypoint[];
}

const BROUTER = 'https://brouter.de/brouter';

export function estimateDuration(distance: number, ascent: number, speedKmh: number): number {
  // Flat time + ~ 1 minute per 10 m climbing at touring effort (Naismith-like for bikes).
  return distance / (speedKmh / 3.6) + ascent * 6;
}

/** Classify an OSM tag string from BRouter into a surface bucket. */
export function surfaceOf(tags: string): string {
  const m = /surface=([a-z_:;]+)/.exec(tags);
  const s = m?.[1];
  if (!s) {
    if (/highway=(primary|secondary|tertiary|residential|unclassified|cycleway|living_street|service|trunk)/.test(tags))
      return 'paved';
    if (/highway=(track|path|bridleway)/.test(tags)) return 'unpaved';
    return 'unknown';
  }
  if (/^(asphalt|concrete|chipseal|paved|concrete:plates|concrete:lanes)/.test(s)) return 'paved';
  if (/^(paving_stones|sett|cobblestone|unhewn_cobblestone|bricks)/.test(s)) return 'cobbles';
  if (/^(compacted|fine_gravel|gravel|pebblestone)/.test(s)) return 'gravel';
  if (/^(ground|dirt|earth|grass|mud|sand|unpaved|woodchips|rock)/.test(s)) return 'unpaved';
  return 'unknown';
}

export function wayTypeOf(tags: string): string {
  const m = /highway=([a-z_]+)/.exec(tags);
  const h = m?.[1] ?? '';
  if (h === 'cycleway' || /cycleway(:both|:right|:left)?=(track|lane|separate)/.test(tags) || /bicycle=designated/.test(tags))
    return 'cycleway';
  if (/^(primary|secondary|trunk)(_link)?$/.test(h)) return 'busyroad';
  if (/^(tertiary|unclassified)(_link)?$/.test(h)) return 'road';
  if (h === 'residential') return 'quiet';
  if (h === 'living_street') return 'living';
  if (h === 'service') return 'access';
  if (h === 'pedestrian') return 'pedestrian';
  if (h === 'steps') return 'steps';
  if (h === 'track') return 'track';
  if (/^(path|footway|bridleway)$/.test(h)) return 'path';
  return 'other';
}

export const SURFACE_META: Record<string, { label: string; color: string }> = {
  paved: { label: 'Asphalt', color: '#3b82f6' },
  cobbles: { label: 'Pflaster', color: '#a855f7' },
  gravel: { label: 'Schotter', color: '#f59e0b' },
  unpaved: { label: 'Unbefestigt', color: '#92400e' },
  unknown: { label: 'Unbekannt', color: '#9ca3af' },
};

export const WAYTYPE_META: Record<string, { label: string; color: string }> = {
  cycleway: { label: 'Radweg', color: '#16a34a' },
  quiet: { label: 'Ruhige Straße', color: '#22d3ee' },
  living: { label: 'Wohnstraße', color: '#67e8f9' },
  access: { label: 'Zufahrtsstraße', color: '#a5b4fc' },
  road: { label: 'Straße', color: '#3b82f6' },
  busyroad: { label: 'Belebte Straße', color: '#ef4444' },
  pedestrian: { label: 'Fußgängerzone', color: '#f472b6' },
  track: { label: 'Forststraße', color: '#d97706' },
  path: { label: 'Pfad', color: '#78350f' },
  steps: { label: 'Stufen', color: '#111827' },
  other: { label: 'Undefiniert', color: '#9ca3af' },
};

interface Leg {
  coords: Coord[];
  surface: string[];
  wayType: string[];
  hints: number[][]; // BRouter voicehints, index relative to leg coords
}

/** Parse a BRouter GeoJSON response into a leg. Exported for tests. */
export function parseBrouter(json: any): Leg {
  const f = json?.features?.[0];
  if (!f) throw new Error('Keine Route gefunden');
  // BRouter omits elevation for some points (e.g. start/end snapping); fillElevation() interpolates them
  const coords: Coord[] = f.geometry.coordinates.map((c: number[]) => [c[0], c[1], c[2] ?? undefined]);
  const surface = new Array<string>(coords.length).fill('unknown');
  const wayType = new Array<string>(coords.length).fill('other');
  const msgs: string[][] = f.properties?.messages ?? [];
  // messages: first row is header; each row ends at a coordinate (lon/lat in 1e-6 deg)
  // and describes the way between the previous message point and that point.
  if (msgs.length > 1) {
    const header = msgs[0];
    const iLon = header.indexOf('Longitude');
    const iLat = header.indexOf('Latitude');
    const iTags = header.indexOf('WayTags');
    let ci = 0;
    for (let r = 1; r < msgs.length; r++) {
      const row = msgs[r];
      const lon = Number(row[iLon]) / 1e6;
      const lat = Number(row[iLat]) / 1e6;
      const tags = row[iTags] ?? '';
      const s = surfaceOf(tags);
      const w = wayTypeOf(tags);
      // advance until the coordinate matching this message point
      let end = ci;
      while (end < coords.length - 1 && !(Math.abs(coords[end][0] - lon) < 2e-6 && Math.abs(coords[end][1] - lat) < 2e-6))
        end++;
      for (let k = ci; k <= end; k++) {
        surface[k] = s;
        wayType[k] = w;
      }
      ci = end;
    }
    // remainder keeps last classification
    for (let k = ci; k < coords.length; k++) {
      surface[k] = surface[Math.max(0, ci)];
      wayType[k] = wayType[Math.max(0, ci)];
    }
  }
  return { coords, surface, wayType, hints: f.properties?.voicehints ?? [] };
}

function freehandLeg(a: LngLat, b: LngLat): Leg {
  const n = Math.max(2, Math.ceil(haversine(a, b) / 200) + 1);
  const coords: Coord[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    coords.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, undefined]);
  }
  return { coords, surface: coords.map(() => 'unknown'), wayType: coords.map(() => 'other'), hints: [] };
}

const legCache = new Map<string, Leg>();

export function profileQuery(params: Record<string, string | number> = {}): string {
  return Object.entries(params).map(([k, v]) => `&profile:${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('');
}

async function fetchLeg(a: LngLat, b: LngLat, profile: RoutingProfile, signal?: AbortSignal, extra: Record<string, string | number> = {}): Promise<Leg> {
  if (!profile.brouter) return freehandLeg(a, b);
  const pq = profileQuery({ ...(profile.params ?? {}), ...extra });
  const key = `${profile.brouter}${pq}|${a.map((v) => v.toFixed(6))}|${b.map((v) => v.toFixed(6))}`;
  const hit = legCache.get(key);
  if (hit) return hit;
  const url =
    `${BROUTER}?lonlats=${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}` +
    `&profile=${profile.brouter}${pq}&alternativeidx=0&format=geojson&timode=3`;
  const res = await fetch(url, { signal });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith('{')) {
    throw new Error(text.includes('not mapped') || text.includes('target island')
      ? 'Punkt liegt abseits befahrbarer Wege'
      : `Routing fehlgeschlagen (${res.status})`);
  }
  const leg = parseBrouter(JSON.parse(text));
  if (legCache.size > 300) legCache.clear();
  legCache.set(key, leg);
  return leg;
}

/** Fill missing elevations (freehand legs) by linear interpolation from neighbours. */
function fillElevation(coords: Coord[]) {
  let last = -1;
  for (let i = 0; i < coords.length; i++) {
    if (coords[i][2] != null) {
      if (last >= 0 && i - last > 1) {
        const e0 = coords[last][2]!;
        const e1 = coords[i][2]!;
        for (let k = last + 1; k < i; k++) coords[k][2] = e0 + ((e1 - e0) * (k - last)) / (i - last);
      } else if (last < 0) {
        for (let k = 0; k < i; k++) coords[k][2] = coords[i][2];
      }
      last = i;
    }
  }
  if (last >= 0) for (let k = last + 1; k < coords.length; k++) coords[k][2] = coords[last][2];
  else for (const c of coords) c[2] = 0;
}

export function assembleRoute(legs: Leg[], profile: RoutingProfile, waypoints: Waypoint[], speedKmh = profile.speedKmh): Route {
  const coords: Coord[] = [];
  const pointSurface: string[] = [];
  const pointWayType: string[] = [];
  const hints: number[][] = [];
  const legEnds: number[] = [];
  legs.forEach((leg, li) => {
    const offset = coords.length === 0 ? 0 : coords.length - 1;
    const startK = coords.length === 0 ? 0 : 1; // skip duplicated join vertex
    for (let k = startK; k < leg.coords.length; k++) {
      coords.push([...leg.coords[k]] as Coord);
      pointSurface.push(leg.surface[k]);
      pointWayType.push(leg.wayType[k]);
    }
    for (const h of leg.hints) hints.push([h[0] + offset, ...h.slice(1)]);
    if (li < legs.length - 1) legEnds.push(coords.length - 1);
  });
  fillElevation(coords);
  const cum = cumulative(coords);
  const distance = cum[cum.length - 1] ?? 0;
  const { up, down } = elevationGain(coords.map((c) => c[2] ?? 0));
  const sums = (arr: string[]) => {
    const m = new Map<string, number>();
    for (let i = 1; i < coords.length; i++) m.set(arr[i], (m.get(arr[i]) ?? 0) + (cum[i] - cum[i - 1]));
    return [...m.entries()].map(([key, d]) => ({ key, distance: d })).sort((a, b) => b.distance - a.distance);
  };
  return {
    coords,
    cum,
    distance,
    ascent: up,
    descent: down,
    duration: estimateDuration(distance, up, speedKmh),
    instructions: buildInstructions(coords, cum, hints, legEnds),
    surfaces: sums(pointSurface),
    wayTypes: sums(pointWayType),
    pointSurface,
    pointWayType,
    profileId: profile.id,
    waypoints,
  };
}

/**
 * Route through all waypoints. Legs are fetched in parallel and cached, so dragging one
 * waypoint only re-requests its two adjacent legs.
 */
export async function computeRoute(
  waypoints: Waypoint[],
  profileId: string,
  opts: { signal?: AbortSignal; speedKmh?: number; freehandLegs?: Set<number>; params?: Record<string, string | number> } = {},
): Promise<Route | null> {
  if (waypoints.length < 2) return null;
  const profile = profileById(profileId);
  const legs = await Promise.all(
    waypoints.slice(1).map((wp, i) => {
      const a = waypoints[i].lngLat;
      const b = wp.lngLat;
      if (opts.freehandLegs?.has(i)) return Promise.resolve(freehandLeg(a, b));
      return fetchLeg(a, b, profile, opts.signal, opts.params);
    }),
  );
  return assembleRoute(legs, profile, waypoints, opts.speedKmh ?? profile.speedKmh);
}

/** Build a route object from an existing track (GPX import, recorded ride). */
export function routeFromTrack(coords: Coord[], profileId = 'balanced', speedKmh?: number): Route {
  const profile = profileById(profileId);
  const leg: Leg = {
    coords,
    surface: coords.map(() => 'unknown'),
    wayType: coords.map(() => 'other'),
    hints: [],
  };
  const wps: Waypoint[] = [
    { id: 'start', lngLat: [coords[0][0], coords[0][1]] },
    { id: 'end', lngLat: [coords[coords.length - 1][0], coords[coords.length - 1][1]] },
  ];
  return assembleRoute([leg], profile, wps, speedKmh ?? profile.speedKmh);
}
