import { kvGet, kvSet, uid } from './storage';

export const TILE_CACHE = 'bikepath-tiles';

export interface OfflineRegion {
  id: string;
  name: string;
  bbox: [number, number, number, number];
  minZoom: number;
  maxZoom: number;
  tileCount: number;
  bytes: number;
  styleUrl: string;
  tileTemplates: string[];
  createdAt: number;
  /** tiles of a corridor along a route ("z/x/y"); without it the region is the whole bbox */
  tileKeys?: string[];
}

export function lon2tile(lon: number, z: number) {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}
export function lat2tile(lat: number, z: number) {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
}

export function tilesInBbox(bbox: [number, number, number, number], minZ: number, maxZ: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lon2tile(bbox[0], z);
    const x1 = lon2tile(bbox[2], z);
    const y0 = lat2tile(bbox[3], z);
    const y1 = lat2tile(bbox[1], z);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  }
  return out;
}

export const countTiles = (bbox: [number, number, number, number], minZ: number, maxZ: number) => {
  let n = 0;
  for (let z = minZ; z <= maxZ; z++) {
    n += (lon2tile(bbox[2], z) - lon2tile(bbox[0], z) + 1) * (lat2tile(bbox[1], z) - lat2tile(bbox[3], z) + 1);
  }
  return n;
};

/** Average vector tile size estimate (bytes) for the size preview. */
export const AVG_TILE_BYTES = 28_000;
export const MAX_TILES = 30_000;

async function cacheUrl(cache: Cache, url: string): Promise<number> {
  const hit = await cache.match(url);
  // already cached (e.g. seen on the map before): count its real size, the header is often missing
  if (hit) return Number(hit.headers.get('content-length')) || (await hit.blob()).size;
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
  const buf = await res.clone().arrayBuffer();
  await cache.put(url, res);
  return buf.byteLength;
}

/** Collect style assets (style JSON, tilejson, sprites, glyphs) and vector tile templates. */
async function styleAssets(styleUrl: string): Promise<{ assets: string[]; templates: string[]; maxzoom: number }> {
  const style = await (await fetch(styleUrl)).json();
  const assets = [styleUrl];
  const templates: string[] = [];
  let maxzoom = 14;
  for (const src of Object.values<any>(style.sources ?? {})) {
    if (src.type !== 'vector') continue;
    if (src.url) {
      assets.push(src.url);
      const tj = await (await fetch(src.url)).json();
      templates.push(...(tj.tiles ?? []));
      maxzoom = Math.min(maxzoom, tj.maxzoom ?? 14);
    } else if (src.tiles) templates.push(...src.tiles);
  }
  if (typeof style.sprite === 'string') {
    for (const sfx of ['.json', '.png', '@2x.json', '@2x.png']) assets.push(style.sprite + sfx);
  }
  if (style.glyphs) {
    const fonts = new Set<string>();
    for (const l of style.layers ?? []) {
      const f = l.layout?.['text-font'];
      if (Array.isArray(f) && f.every((x: unknown) => typeof x === 'string')) fonts.add(f.join(','));
    }
    for (const f of fonts) for (const range of ['0-255', '256-511', '8192-8447']) {
      assets.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', range));
    }
  }
  return { assets, templates, maxzoom };
}

export async function listRegions(): Promise<OfflineRegion[]> {
  return (await kvGet<OfflineRegion[]>('offlineRegions')) ?? [];
}

export async function downloadRegion(
  name: string,
  bbox: [number, number, number, number],
  styleUrl: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
  zoom: [number, number] = [6, 14],
): Promise<OfflineRegion> {
  return downloadTiles(name, bbox, (maxZ) => tilesInBbox(bbox, zoom[0], maxZ), styleUrl, onProgress, signal, zoom, false);
}

const WORLD_M = 40075016.686;
/**
 * Tiles to ride a route without network: the whole area at the overview zooms (6–11), and a
 * corridor along the route at the detail zooms (12–14) – each point's tile and its neighbours,
 * so the map around the track and its places (zoom 14 carries the POIs) are there.
 */
export function routeTiles(coords: [number, number][], maxZ = 14): [number, number, number][] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of coords) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  const pad = 0.02;
  const out = new Map<string, [number, number, number]>();
  for (const t of tilesInBbox([w - pad, s - pad, e + pad, n + pad], 6, Math.min(11, maxZ))) out.set(t.join('/'), t);
  for (let z = 12; z <= maxZ; z++) {
    // sample the track about every half tile so no tile it crosses is skipped
    const step = (WORLD_M / 2 ** z) * Math.cos((((s + n) / 2) * Math.PI) / 180) * 0.5;
    let last: [number, number] | null = null;
    for (const c of coords) {
      if (last && Math.hypot((c[0] - last[0]) * 111320 * Math.cos((c[1] * Math.PI) / 180), (c[1] - last[1]) * 110540) < step) continue;
      last = c;
      const tx = lon2tile(c[0], z);
      const ty = lat2tile(c[1], z);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.set(`${z}/${tx + dx}/${ty + dy}`, [z, tx + dx, ty + dy]);
    }
  }
  return [...out.values()];
}

/** Store the map along a route for offline use (style, fonts, tiles of the corridor). */
export async function downloadRouteMaps(
  name: string,
  coords: [number, number][],
  styleUrl: string,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<OfflineRegion> {
  let w = 180, s = 90, e = -180, n = -90;
  for (const [x, y] of coords) {
    w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y);
  }
  return downloadTiles(name, [w, s, e, n], (maxZ) => routeTiles(coords, maxZ), styleUrl, onProgress, signal, [6, 14], true);
}

async function downloadTiles(
  name: string,
  bbox: [number, number, number, number],
  tilesFor: (maxZ: number) => [number, number, number][],
  styleUrl: string,
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal | undefined,
  zoom: [number, number],
  keepKeys: boolean,
): Promise<OfflineRegion> {
  if (!('caches' in window)) throw new Error('Offline-Speicher wird von diesem Browser nicht unterstützt');
  const cache = await caches.open(TILE_CACHE);
  const { assets, templates, maxzoom } = await styleAssets(styleUrl);
  const maxZ = Math.min(zoom[1], maxzoom);
  const tiles = tilesFor(maxZ);
  if (tiles.length > MAX_TILES) throw new Error('Bereich zu groß – bitte weiter hineinzoomen');
  const urls = [
    ...assets,
    ...tiles.flatMap(([z, x, y]) => templates.slice(0, 1).map((t) => t.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))),
  ];
  let done = 0;
  let bytes = 0;
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      const u = queue.shift()!;
      try {
        bytes += await cacheUrl(cache, u);
      } catch {
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === urls.length) onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed > urls.length * 0.2) throw new Error(`${failed} von ${urls.length} Kacheln fehlgeschlagen`);
  const region: OfflineRegion = {
    id: uid(),
    name,
    bbox,
    minZoom: zoom[0],
    maxZoom: maxZ,
    tileCount: tiles.length,
    bytes,
    styleUrl,
    tileTemplates: templates.slice(0, 1),
    createdAt: Date.now(),
    ...(keepKeys ? { tileKeys: tiles.map((x) => x.join('/')) } : {}),
  };
  await kvSet('offlineRegions', [...(await listRegions()), region]);
  return region;
}

export async function deleteRegion(id: string) {
  const regions = await listRegions();
  const r = regions.find((x) => x.id === id);
  const rest = regions.filter((x) => x.id !== id);
  await kvSet('offlineRegions', rest);
  if (!r || !('caches' in window)) return;
  const cache = await caches.open(TILE_CACHE);
  // keep tiles that are still covered by another region
  const keysOf = (o: OfflineRegion) => o.tileKeys ?? tilesInBbox(o.bbox, o.minZoom, o.maxZoom).map((t) => t.join('/'));
  const keep = new Set<string>();
  for (const o of rest) for (const k of keysOf(o)) keep.add(k);
  await Promise.all(
    keysOf(r)
      .filter((k) => !keep.has(k))
      .map((k) => k.split('/').map(Number) as [number, number, number])
      .map(([z, x, y]) => cache.delete(r.tileTemplates[0].replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))),
  );
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
