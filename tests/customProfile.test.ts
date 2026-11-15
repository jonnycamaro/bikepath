import { afterEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/brouter-munich.json';
import { rideSpeed } from '../src/lib/bike';
import { brouterScript, newCustomProfile, normalizeProfile, rankFactors, toRoutingProfile, validateProfile, type CustomProfile } from '../src/lib/customProfile';
import { fetchTrack, profileById, setCustomProfiles } from '../src/lib/routing';

const profile = (patch: Partial<CustomProfile> = {}): CustomProfile => ({ ...newCustomProfile('touring'), name: 'Test', ...patch });

describe('own routing options', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setCustomProfiles([]);
  });

  it('turns the order of a list into cost factors', () => {
    const f = rankFactors(
      [
        { key: 'a', status: 'ok' },
        { key: 'b', status: 'never' },
        { key: 'c', status: 'ok' },
        { key: 'd', status: 'avoid' },
      ],
      'mid',
    );
    expect(f).toEqual({ a: 1, b: 10000, c: 1.3, d: 4.8 }); // excluded items don't use up a rank; avoid = ×3
  });

  it('rejects options without name, way or surface', () => {
    expect(validateProfile(profile({ name: ' ' }))).toMatch(/Namen/);
    expect(validateProfile(profile({ ways: profile().ways.map((w) => ({ ...w, status: 'never' as const })) }))).toMatch(/Wegart/);
    expect(validateProfile(profile({ surfaces: profile().surfaces.map((s) => ({ ...s, status: 'never' as const })) }))).toMatch(/Untergrund/);
    expect(validateProfile(profile())).toBeNull();
  });

  it('writes the rider’s choices into the BRouter script', () => {
    const s = brouterScript(profile({ climbAvoid: 3, maxUphill: 6, allowSteps: false, allowFerries: true }));
    expect(s).toContain('assign uphillcost = 140');
    expect(s).toContain('assign uphillmaxslope = 6');
    expect(s).toContain('else if highway=steps then 10000');
    expect(s).toContain('else if route=ferry then 5.67');
    expect(s).not.toContain('downhillmaxslope');
    // BRouter only knows the main lookup values; an alias is a parse error on the server
    expect(s).not.toMatch(/chipseal|concrete:plates|paving_stones:30|unhewn_cobblestone|woodchips/);
    // the app overrides these for its cycle-path level, so the script must declare them
    expect(s).toContain('assign avoid_unsafe = false');
    expect(s).toContain('assign stick_to_cycleroutes = false');
  });

  it('fills in way and surface kinds missing from an older stored option', () => {
    const old = profile({ ways: [{ key: 'cycleway', status: 'ok' }], surfaces: [{ key: 'paved', status: 'ok' }] });
    const n = normalizeProfile(old);
    expect(n.ways).toHaveLength(7);
    expect(n.ways[0]).toEqual({ key: 'cycleway', status: 'ok' });
    expect(n.surfaces).toHaveLength(5);
  });

  it('is found by id and sets the pace', () => {
    const p = profile({ id: 'c-test', pace: 0.85 });
    setCustomProfiles([toRoutingProfile(p)]);
    expect(profileById('c-test').label).toBe('Test');
    const pace = { bikeType: 'trekking', bikeSpeed: 20 } as Parameters<typeof rideSpeed>[0];
    expect(rideSpeed(pace, 'c-test')).toBe(17);
    expect(profileById('c-gone').id).toBe('balanced');
  });

  it('uploads the script once and again when the server has forgotten it', async () => {
    const calls: string[] = [];
    let routed = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(init?.method === 'POST' ? 'upload' : 'route');
        if (init?.method === 'POST') return { ok: true, status: 200, json: async () => ({ profileid: `custom_${calls.length}` }) };
        routed++;
        // first route request: the uploaded profile has expired on the server
        if (routed === 1) return { ok: false, status: 500, text: async () => '' };
        expect(url).toContain('profile=custom_');
        return { ok: true, status: 200, text: async () => JSON.stringify(fixture) };
      }),
    );
    const rp = toRoutingProfile(profile({ id: 'c-up' }));
    await fetchTrack([[11.5755, 48.1372], [11.62, 48.15]], rp);
    expect(calls).toEqual(['upload', 'route', 'upload', 'route']);
    // a second request with the same option reuses the uploaded profile
    await fetchTrack([[11.5755, 48.1372], [11.63, 48.151]], rp);
    expect(calls.slice(4)).toEqual(['route']);
  });
});

describe('tap menu', () => {
  it('greys out what makes no sense for the current plan', async () => {
    const { enabledActions } = await import('../src/lib/tapActions');
    expect(enabledActions({ waypoints: [], loop: null }, false)).toEqual({ start: true, via: false, end: true, info: true, delete: true });
    expect(enabledActions({ waypoints: [1, 2], loop: null }, false)).toEqual({ start: true, via: true, end: true, info: true, delete: true });
    // round trip: start and stops, but no separate destination
    expect(enabledActions({ waypoints: [1], loop: {} }, false)).toEqual({ start: true, via: true, end: false, info: true, delete: true });
    // while the address is looked up only the info works
    expect(enabledActions({ waypoints: [1, 2], loop: null }, true)).toEqual({ start: false, via: false, end: false, info: true, delete: true });
  });
});
