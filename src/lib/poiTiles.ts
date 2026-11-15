import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { classifyTilePoi, type Poi } from './pois';

/**
 * Places for the POI map, read straight from the vector map tiles. Only the tiles of zoom 14
 * carry all places (zoom 13 a few dozen, below 12 none), so the POI map fetches those tiles
 * for the visible area itself – also when zoomed out – and clusters what it finds.
 */

/** the tile zoom that carries every place */
export const POI_TILE_ZOOM = 14;
/** more tiles than this for one view is too much data for a phone; then only cached ones show */
export const MAX_POI_TILES = 64;
/** tiles kept in memory (each holds only its classified places, a few KB) */
const CACHE_TILES = 800;

const cache = new Map<string, Poi[]>();

/** OpenFreeMap's TileJSON; it names the current tile set, whose URL changes with each data release */
const TILEJSON = 'https://tiles.openfreemap.org/planet';
let template: Promise<string> | null = null;

/** URL template ({z}/{x}/{y}) of the vector tiles that carry the places */
export function poiTileTemplate(): Promise<string> {
  template ??= fetch(TILEJSON)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((j: { tiles?: string[] }) => j.tiles?.[0] ?? Promise.reject(new Error('TileJSON ohne Kacheln')))
    .catch((e) => {
      template = null; // try again next time
      throw e;
    });
  return template;
}

const lon2x = (lon: number, n: number) => Math.floor(((lon + 180) / 360) * n);
const lat2y = (lat: number, n: number) => {
  const r = (Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n);
};

/** zoom-14 tiles covering the bounds [w, s, e, n] */
export function tilesFor([w, s, e, n]: [number, number, number, number]): [number, number][] {
  const z = 2 ** POI_TILE_ZOOM;
  const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z);
  const out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}

/** classified places of one tile */
export function decodePoiTile(buf: ArrayBuffer | Uint8Array, x: number, y: number): Poi[] {
  const layer = new VectorTile(new Pbf(buf)).layers.poi;
  if (!layer) return [];
  const out: Poi[] = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 1) continue; // points only
    // A tile also carries the places in a strip around it (so icons at the edge are not cut
    // off). Those belong to the neighbouring tile and would be counted twice.
    const pt = f.loadGeometry()[0]?.[0];
    if (!pt || pt.x < 0 || pt.y < 0 || pt.x >= layer.extent || pt.y >= layer.extent) continue;
    const p = f.properties as Record<string, string>;
    const type = classifyTilePoi(p.class, p.subclass);
    if (!type) continue;
    const g = f.toGeoJSON(x, y, POI_TILE_ZOOM).geometry;
    if (g.type !== 'Point') continue;
    const [lon, lat] = g.coordinates as [number, number];
    out.push({ id: f.id ?? -(x * 1e9 + y * 1e4 + i), lon, lat, type, name: p['name:de'] || p.name_de || p.name || undefined });
  }
  return out;
}

/** places already loaded for these tiles */
export function cachedPois(tiles: [number, number][]): Poi[] {
  return tiles.flatMap(([x, y]) => cache.get(`${x}/${y}`) ?? []);
}

/** every place loaded so far (to show something when zoomed out too far to load more) */
export function allCachedPois(): Poi[] {
  return [...cache.values()].flat();
}

/**
 * Load the given tiles that are not cached yet. `template` is the source's tile URL with
 * {z}/{x}/{y}. The browser and service worker cache the tiles, so a tile the map already
 * showed costs no download.
 */
export async function loadPoiTiles(template: string, tiles: [number, number][], signal?: AbortSignal, onProgress?: () => void) {
  const todo = tiles.filter(([x, y]) => !cache.has(`${x}/${y}`));
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !signal?.aborted) {
      const [x, y] = todo[next++];
      const url = template.replace('{z}', String(POI_TILE_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y));
      try {
        const res = await fetch(url, { signal });
        if (res.status === 204 || res.status === 404) {
          cache.set(`${x}/${y}`, []); // empty sea or no data
          continue;
        }
        if (!res.ok) continue;
        cache.set(`${x}/${y}`, decodePoiTile(await res.arrayBuffer(), x, y));
        if (cache.size > CACHE_TILES) cache.delete(cache.keys().next().value!);
        onProgress?.();
      } catch {
        if (signal?.aborted) return;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}
