import type { Feature, FeatureCollection, LineString } from 'geojson';
import { SURFACE_META, WAYTYPE_META, type Route } from './routing';

export const GRADE_COLORS = [
  { max: 3, color: '#22a35a', label: '< 3 %' },
  { max: 6, color: '#f2c200', label: '3–6 %' },
  { max: 10, color: '#ff8a00', label: '6–10 %' },
  { max: Infinity, color: '#e5383b', label: '> 10 %' },
];

export const gradeColor = (g: number) => (GRADE_COLORS.find((c) => Math.abs(g) < c.max) ?? GRADE_COLORS[3]).color;

/** Per-vertex grade (%) smoothed over a window of ~`win` metres. */
export function grades(route: Route, win = 60): number[] {
  const { coords, cum } = route;
  const out = new Array<number>(coords.length).fill(0);
  let j = 0;
  for (let i = 0; i < coords.length; i++) {
    while (j < coords.length - 1 && cum[j] - cum[i] < win) j++;
    const d = cum[j] - cum[i];
    out[i] = d > 5 ? (((coords[j][2] ?? 0) - (coords[i][2] ?? 0)) / d) * 100 : i > 0 ? out[i - 1] : 0;
  }
  return out;
}

/** Split the route into runs of equal category, each with a colour. */
export function colouredLines(route: Route, mode: 'solid' | 'surface' | 'waytype' | 'gradient'): FeatureCollection<LineString> {
  const coords = route.coords.map((c) => [c[0], c[1]]);
  if (mode === 'solid' || coords.length < 2) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: '#0b6bd6' }, geometry: { type: 'LineString', coordinates: coords } }] };
  }
  let colorAt: (i: number) => string;
  if (mode === 'surface') colorAt = (i) => SURFACE_META[route.pointSurface[i]]?.color ?? '#9ca3af';
  else if (mode === 'waytype') colorAt = (i) => WAYTYPE_META[route.pointWayType[i]]?.color ?? '#9ca3af';
  else {
    const g = grades(route);
    colorAt = (i) => gradeColor(g[i]);
  }
  const features: Feature<LineString>[] = [];
  let start = 0;
  let cur = colorAt(1);
  for (let i = 1; i < coords.length; i++) {
    const c = colorAt(i);
    if (c !== cur) {
      features.push({ type: 'Feature', properties: { color: cur }, geometry: { type: 'LineString', coordinates: coords.slice(start, i + 1) } });
      start = i;
      cur = c;
    }
  }
  features.push({ type: 'Feature', properties: { color: cur }, geometry: { type: 'LineString', coordinates: coords.slice(start) } });
  return { type: 'FeatureCollection', features };
}
