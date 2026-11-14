// Live checks against the public services Bikepath uses. Run with `npm run test:live` (needs internet).
import { expect, it } from 'vitest';
import { computeRoute } from '../../src/lib/routing';
import { searchPlaces } from '../../src/lib/geocode';
import { fetchWeather } from '../../src/lib/weather';
import { cachedPois, loadPoiTiles, poiTileTemplate, tilesFor } from '../../src/lib/poiTiles';

it('BRouter routes in every profile', async () => {
  for (const p of ['balanced', 'fastest', 'cyclepaths', 'road', 'mtb', 'shortest']) {
    const r = await computeRoute([{ id: 'a', lngLat: [11.5755, 48.1372] }, { id: 'b', lngLat: [11.595, 48.158] }], p);
    expect(r!.distance, p).toBeGreaterThan(2000);
  }
}, 60000);
it('Photon search', async () => {
  const r = await searchPlaces('Marienplatz München');
  expect(r.length).toBeGreaterThan(0);
}, 20000);
it('Open-Meteo weather', async () => {
  const w = await fetchWeather([11.57, 48.13]);
  expect(typeof w.temperature).toBe('number');
}, 20000);
it('POIs from the OpenFreeMap vector tiles', async () => {
  const tiles = tilesFor([11.57, 48.135, 11.59, 48.145]);
  await loadPoiTiles(await poiTileTemplate(), tiles);
  expect(cachedPois(tiles).length).toBeGreaterThan(0);
}, 70000);
it('a POI near a tile border counts once (tiles carry a buffer strip of their neighbours)', async () => {
  // Leer (Ostfriesland): the Aldi at 7.45394, 53.25992 lies in the buffer of the tile to its west
  const tiles = tilesFor([7.43, 53.24, 7.47, 53.27]);
  await loadPoiTiles(await poiTileTemplate(), tiles);
  const pois = cachedPois(tiles);
  const ids = pois.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(pois.filter((p) => p.name === 'Aldi' && Math.abs(p.lon - 7.45394) < 0.0005)).toHaveLength(1);
}, 70000);
