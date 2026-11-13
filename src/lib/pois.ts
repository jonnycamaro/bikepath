export interface Poi {
  id: number;
  lon: number;
  lat: number;
  type: string;
  name?: string;
}

export const POI_META: Record<string, { label: string; color: string; glyph: string }> = {
  water: { label: 'Trinkwasser', color: '#0ea5e9', glyph: '💧' },
  toilets: { label: 'WC', color: '#64748b', glyph: 'WC' },
  bikeshop: { label: 'Radladen', color: '#2563eb', glyph: '🚲' },
  repair: { label: 'Reparaturstation', color: '#f97316', glyph: '🔧' },
  charging: { label: 'E-Bike laden', color: '#16a34a', glyph: '⚡' },
  shelter: { label: 'Unterstand', color: '#a16207', glyph: '⛺' },
  food: { label: 'Café / Biergarten', color: '#db2777', glyph: '☕' },
};

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export function classifyPoi(tags: Record<string, string>): string | null {
  if (tags.amenity === 'drinking_water' || tags.drinking_water === 'yes' && tags.amenity === 'fountain') return 'water';
  if (tags.amenity === 'toilets') return 'toilets';
  if (tags.shop === 'bicycle') return 'bikeshop';
  if (tags.amenity === 'bicycle_repair_station') return 'repair';
  if (tags.amenity === 'charging_station' && (tags.bicycle === 'yes' || tags['socket:schuko'])) return 'charging';
  if (tags.amenity === 'shelter') return 'shelter';
  if (tags.amenity === 'biergarten' || tags.amenity === 'cafe') return 'food';
  return null;
}

export async function fetchPois(bounds: [number, number, number, number], signal?: AbortSignal): Promise<Poi[]> {
  const [w, s, e, n] = bounds;
  const bb = `${s},${w},${n},${e}`;
  const q = `[out:json][timeout:20];(
node[amenity=drinking_water](${bb});
node[amenity=toilets](${bb});
nwr[shop=bicycle](${bb});
node[amenity=bicycle_repair_station](${bb});
node[amenity=charging_station][bicycle=yes](${bb});
node[amenity=shelter](${bb});
node[amenity=biergarten](${bb});
);out center 400;`;
  let lastErr: unknown;
  for (const srv of SERVERS) {
    try {
      // public Overpass servers are often overloaded: give each one 12 s, then try the next
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      signal?.addEventListener('abort', () => ctrl.abort());
      const res = await fetch(`${srv}?data=${encodeURIComponent(q)}`, { signal: ctrl.signal }).finally(() => clearTimeout(timer));
      if (!res.ok) throw new Error(String(res.status));
      const json = await res.json();
      return (json.elements ?? [])
        .map((el: any) => {
          const type = classifyPoi(el.tags ?? {});
          const lon = el.lon ?? el.center?.lon;
          const lat = el.lat ?? el.center?.lat;
          return type && lon != null ? { id: el.id, lon, lat, type, name: el.tags?.name } : null;
        })
        .filter(Boolean) as Poi[];
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('POI-Dienst nicht erreichbar');
}
