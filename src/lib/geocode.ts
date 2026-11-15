import type { LngLat } from './geo';

export interface Place {
  id: string;
  name: string;
  detail: string;
  lngLat: LngLat;
  kind: string;
  /** OpenStreetMap object ("N123", "W456", "R789") for loading details */
  osm?: string;
}

const PHOTON = 'https://photon.komoot.io';

function label(p: any): { name: string; detail: string } {
  const pr = p.properties ?? {};
  const street = pr.street ? `${pr.street}${pr.housenumber ? ' ' + pr.housenumber : ''}` : '';
  const name = pr.name ?? street ?? pr.city ?? 'Ort';
  const parts = [pr.name && street ? street : '', pr.postcode, pr.city ?? pr.town ?? pr.village, pr.state, pr.country]
    .filter((x) => x && x !== name);
  return { name: name || street, detail: [...new Set(parts)].join(', ') };
}

export function parsePhoton(json: any): Place[] {
  return (json?.features ?? []).map((f: any, i: number) => {
    const { name, detail } = label(f);
    return {
      id: `${f.properties?.osm_type ?? 'x'}${f.properties?.osm_id ?? i}`,
      name,
      detail,
      lngLat: [f.geometry.coordinates[0], f.geometry.coordinates[1]] as LngLat,
      kind: f.properties?.osm_value ?? f.properties?.type ?? '',
      osm: /^[NWR]$/.test(f.properties?.osm_type ?? '') && f.properties?.osm_id ? `${f.properties.osm_type}${f.properties.osm_id}` : undefined,
    };
  });
}

/** Parse "48.137, 11.575" style coordinate input. */
export function parseCoordinates(q: string): LngLat | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lon = Number(m[2].replace(',', '.'));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lon, lat];
}

export async function searchPlaces(q: string, near?: LngLat, signal?: AbortSignal, limit = 8): Promise<Place[]> {
  const c = parseCoordinates(q);
  if (c) return [{ id: 'coord', name: `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`, detail: 'Koordinaten', lngLat: c, kind: 'coord' }];
  const params = new URLSearchParams({ q, limit: String(limit), lang: 'de' });
  if (near) {
    params.set('lat', String(near[1]));
    params.set('lon', String(near[0]));
  }
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  if (!res.ok) throw new Error('Suche nicht verfügbar');
  return parsePhoton(await res.json());
}

export async function reverseGeocode(p: LngLat, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lon=${p[0]}&lat=${p[1]}&lang=de&limit=1`, { signal });
    if (!res.ok) return null;
    const places = parsePhoton(await res.json());
    if (!places[0]) return null;
    return places[0].detail ? `${places[0].name}, ${places[0].detail.split(', ')[0]}` : places[0].name;
  } catch {
    return null;
  }
}

/** Town (city, town or village) at a point, for links to other services. */
export async function reverseTown(p: LngLat, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(`${PHOTON}/reverse?lon=${p[0]}&lat=${p[1]}&lang=de&limit=1`, { signal });
    if (!res.ok) return null;
    const pr = (await res.json())?.features?.[0]?.properties ?? {};
    return pr.city ?? pr.town ?? pr.village ?? pr.district ?? null;
  } catch {
    return null;
  }
}

/**
 * Photon ranks by text match and prominence. Among results with the same name (e.g. many
 * "Barfußpfad"), the nearest one is the one wanted, so those are ordered by distance from
 * `near`; different names keep Photon's order.
 */
export function nearestFirst(places: Place[], near?: LngLat): Place[] {
  if (!near) return places;
  const key = (p: Place) => p.name.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9äöü]/g, '');
  const dist = (p: Place) => (p.lngLat[0] - near[0]) ** 2 * Math.cos((near[1] * Math.PI) / 180) ** 2 + (p.lngLat[1] - near[1]) ** 2;
  const groups = new Map<string, Place[]>();
  for (const p of places) groups.set(key(p), [...(groups.get(key(p)) ?? []), p]);
  return [...groups.values()].flatMap((g) => g.sort((a, b) => dist(a) - dist(b)));
}

/**
 * What is at a tapped point: the named place there (shop, sight …) if it is within a few metres,
 * otherwise the address with house number, otherwise the nearest street. The returned place
 * keeps the tapped coordinates, so a route goes exactly where the rider tapped.
 */
export async function reversePlace(p: LngLat, signal?: AbortSignal): Promise<Place> {
  const fallback: Place = { id: `tap-${p[0]},${p[1]}`, name: 'Punkt auf der Karte', detail: `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`, lngLat: p, kind: 'coord' };
  const res = await fetch(`${PHOTON}/reverse?lon=${p[0]}&lat=${p[1]}&lang=de&limit=3`, { signal });
  if (!res.ok) return fallback;
  const features: any[] = (await res.json())?.features ?? [];
  const dist = (f: any) => {
    const [lon, lat] = f.geometry.coordinates;
    return Math.hypot((lon - p[0]) * 111320 * Math.cos((p[1] * Math.PI) / 180), (lat - p[1]) * 110540);
  };
  const town = (pr: any) => [pr.postcode, pr.city ?? pr.town ?? pr.village].filter(Boolean).join(' ');
  const named = features.find((f) => f.properties?.name && f.properties?.type === 'house' && dist(f) <= 40);
  if (named) return { ...parsePhoton({ features: [named] })[0], lngLat: p };
  const house = features.find((f) => f.properties?.housenumber && dist(f) <= 60);
  if (house) {
    const pr = house.properties;
    return { ...fallback, id: `tap-${pr.osm_type}${pr.osm_id}`, name: `${pr.street} ${pr.housenumber}`, detail: town(pr), kind: 'address' };
  }
  const street = features.find((f) => f.properties?.type === 'street' && f.properties?.name && dist(f) <= 200);
  if (street) return { ...fallback, name: `Bei ${street.properties.name}`, detail: town(street.properties), kind: 'address' };
  const any = features[0]?.properties;
  return any ? { ...fallback, detail: [town(any), fallback.detail].filter(Boolean).join(' · ') } : fallback;
}
