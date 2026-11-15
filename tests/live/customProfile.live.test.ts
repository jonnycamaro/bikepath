// Own routing options against the real BRouter server: every template must compile there and route.
import { expect, it } from 'vitest';
import { newCustomProfile, TEMPLATES, toRoutingProfile } from '../../src/lib/customProfile';
import { fetchTrack } from '../../src/lib/routing';

it.each(TEMPLATES.map((t) => t.id))('template %s is accepted by BRouter and routes', async (id) => {
  const p = { ...newCustomProfile(id), name: `Test ${id}` };
  const leg = await fetchTrack([[7.4572, 53.2606], [7.40, 53.24]], toRoutingProfile(p));
  expect(leg.coords.length).toBeGreaterThan(10);
  // the statistics need surface and way type from the way tags
  expect(leg.surface.some((s) => s !== 'unknown')).toBe(true);
}, 60000);

it('a maximum climb makes the route avoid a steep hill (Stuttgart)', async () => {
  const base = { ...newCustomProfile('touring'), name: 'flach', climbAvoid: 0 as const };
  const a = await fetchTrack([[9.1707, 48.7644], [9.1716, 48.7486]], toRoutingProfile(base));
  const b = await fetchTrack([[9.1707, 48.7644], [9.1716, 48.7486]], toRoutingProfile({ ...base, id: 'c-flat', maxUphill: 4 }));
  expect(b.coords.length).toBeGreaterThan(a.coords.length);
}, 60000);
