import type { LngLat } from './geo';

export interface Place {
  id: string;
  name: string;
  detail: string;
  lngLat: LngLat;
  kind: string;
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

export async function searchPlaces(q: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const c = parseCoordinates(q);
  if (c) return [{ id: 'coord', name: `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`, detail: 'Koordinaten', lngLat: c, kind: 'coord' }];
  const params = new URLSearchParams({ q, limit: '8', lang: 'de' });
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
