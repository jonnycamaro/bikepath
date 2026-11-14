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
  bikeshop: { label: 'Radladen / Verleih', color: '#2563eb', glyph: '🚲' },
  bikeparking: { label: 'Fahrradparkplatz', color: '#1d4ed8', glyph: 'P' },
  shelter: { label: 'Rastplatz / Unterstand', color: '#a16207', glyph: '⛺' },
  food: { label: 'Café / Eis / Biergarten', color: '#db2777', glyph: '☕' },
  restaurant: { label: 'Restaurant / Imbiss', color: '#dc2626', glyph: '🍽' },
  shop: { label: 'Supermarkt / Bäcker', color: '#7c3aed', glyph: '🛒' },
  fuel: { label: 'Tankstelle', color: '#0f766e', glyph: '⛽' },
  sight: { label: 'Sehenswürdigkeit', color: '#b45309', glyph: '🏛' },
  viewpoint: { label: 'Aussichtspunkt', color: '#15803d', glyph: '👁' },
  lodging: { label: 'Unterkunft / Camping', color: '#4f46e5', glyph: '🛏' },
  pharmacy: { label: 'Apotheke', color: '#e11d48', glyph: '✚' },
  station: { label: 'Bahnhof', color: '#334155', glyph: '🚆' },
};

/** categories offered on the POI map, in this order; they come from the vector map tiles */
export const PICKER_TYPES = ['restaurant', 'food', 'shop', 'water', 'toilets', 'shelter', 'bikeshop', 'bikeparking', 'sight', 'viewpoint', 'lodging', 'fuel', 'pharmacy', 'station'];

/** POI type of a feature from the OpenMapTiles `poi` layer (class / subclass), or null */
export function classifyTilePoi(cls: string, sub: string): string | null {
  if (cls === 'restaurant' || cls === 'fast_food') return 'restaurant';
  if (cls === 'cafe' || cls === 'ice_cream' || sub === 'biergarten') return 'food';
  if (cls === 'grocery' || cls === 'bakery' || sub === 'convenience' || sub === 'kiosk') return sub === 'department_store' ? null : 'shop';
  if (cls === 'drinking_water') return 'water';
  if (cls === 'toilets') return 'toilets';
  if (cls === 'shelter' || cls === 'picnic_site') return 'shelter';
  if (cls === 'bicycle' || cls === 'bicycle_rental') return 'bikeshop';
  if (cls === 'bicycle_parking') return 'bikeparking';
  if (sub === 'viewpoint') return 'viewpoint';
  if (cls === 'attraction' || cls === 'museum' || cls === 'castle' || cls === 'monument' || cls === 'zoo') return 'sight';
  if ((cls === 'lodging' && sub !== 'dormitory') || cls === 'campsite') return 'lodging';
  if (cls === 'fuel' && sub === 'fuel') return 'fuel';
  if (cls === 'pharmacy') return 'pharmacy';
  if ((cls === 'railway' && (sub === 'station' || sub === 'halt')) || cls === 'ferry_terminal') return 'station';
  return null;
}

