// Live checks against the public services Bikepath uses. Run with `npm run test:live` (needs internet).
import { expect, it } from 'vitest';
import { computeRoute } from '../../src/lib/routing';
import { searchPlaces } from '../../src/lib/geocode';
import { fetchWeather } from '../../src/lib/weather';
import { fetchPois } from '../../src/lib/pois';

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
it('Overpass POIs (public servers are often overloaded)', async () => {
  const p = await fetchPois([11.57, 48.135, 11.59, 48.145]);
  expect(p.length).toBeGreaterThan(0);
}, 70000);
