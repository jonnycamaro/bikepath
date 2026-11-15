import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/brouter-munich.json';

// Serve the BRouter fixture for every routing request.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => JSON.stringify(fixture), json: async () => fixture, url })),
  );
});
afterEach(() => vi.unstubAllGlobals());

const { useStore } = await import('../src/store');
const { listRoutes, saveRoute, uid } = await import('../src/lib/storage');

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('planner store', () => {
  it('moves the start of a round trip and keeps its stops', () => {
    const s = useStore.getState();
    s.clearPlan();
    s.setLoop({ start: [11.5, 48.1], distance: 20000, direction: 90, variant: 0 }, 'Alt', [{ lngLat: [11.6, 48.1], name: 'Stopp' }]);
    useStore.getState().placeAs('start', { id: 'n', name: 'Neuer Start', detail: '', lngLat: [11.45, 48.12], kind: 'test' });
    const st = useStore.getState();
    expect(st.loop?.start).toEqual([11.45, 48.12]);
    expect(st.waypoints.map((w) => w.name)).toEqual(['Neuer Start', 'Stopp']);
    st.clearPlan();
    useStore.setState({ undo: [], redo: [], planKind: null, route: null, routing: false });
  });

  it('puts a tapped place into the plan as start, destination or stop', () => {
    const pl = (name: string, lon: number, lat: number) => ({ id: name, name, detail: '', lngLat: [lon, lat] as [number, number], kind: 'test' });
    useStore.getState().clearPlan();
    useStore.setState({ fix: { lngLat: [11.5, 48.1], time: 0, speed: 0, accuracy: 5, heading: null, altitude: null } });
    // destination with an empty plan: the own position becomes the start
    useStore.getState().placeAs('end', pl('Ziel', 11.7, 48.2));
    expect(useStore.getState().waypoints.map((w) => w.name)).toEqual(['Mein Standort', 'Ziel']);
    // a new destination replaces the old one, a new start the old start
    useStore.getState().placeAs('end', pl('Neues Ziel', 11.8, 48.2));
    useStore.getState().placeAs('start', pl('Start', 11.4, 48.1));
    expect(useStore.getState().waypoints.map((w) => w.name)).toEqual(['Start', 'Neues Ziel']);
    // stops go into the leg with the least detour
    useStore.getState().placeAs('via', pl('Mitte', 11.6, 48.15));
    useStore.getState().placeAs('via', pl('Kurz vor Ziel', 11.75, 48.19));
    expect(useStore.getState().waypoints.map((w) => w.name)).toEqual(['Start', 'Mitte', 'Kurz vor Ziel', 'Neues Ziel']);
    useStore.getState().clearPlan();
    useStore.setState({ fix: null, undo: [], redo: [], planKind: null }); // leave a clean planner for the next test
  });

  it('routes after adding two waypoints, supports undo/redo/reverse', async () => {
    const s = useStore.getState();
    s.addWaypoint([11.5755, 48.1372]);
    s.addWaypoint([11.62, 48.15]);
    await wait(300);
    expect(useStore.getState().route?.distance).toBeGreaterThan(4800);
    expect(useStore.getState().undo.length).toBe(2);

    useStore.getState().undoPlan();
    expect(useStore.getState().waypoints.length).toBe(1);
    await wait(300);
    expect(useStore.getState().route).toBeNull();
    useStore.getState().redoPlan();
    expect(useStore.getState().waypoints.length).toBe(2);

    const first = useStore.getState().waypoints[0].id;
    useStore.getState().reverse();
    expect(useStore.getState().waypoints[1].id).toBe(first);

    useStore.getState().insertWaypoint(0, [11.6, 48.14]);
    expect(useStore.getState().waypoints.length).toBe(3);
    useStore.getState().removeWaypoint(useStore.getState().waypoints[1].id);
    expect(useStore.getState().waypoints.length).toBe(2);
    useStore.getState().clearPlan();
    expect(useStore.getState().waypoints.length).toBe(0);
  });

  it('switching profile re-routes with that profile', async () => {
    const s = useStore.getState();
    s.addWaypoint([11.5755, 48.1372]);
    s.addWaypoint([11.62, 48.15]);
    s.setProfile('mtb');
    await wait(300);
    const calls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes('profile=mtb'))).toBe(true);
    expect(useStore.getState().route?.profileId).toBe('mtb');
    useStore.getState().clearPlan();
  });

  it('persists saved routes in IndexedDB', async () => {
    useStore.getState().addWaypoint([11.5755, 48.1372]);
    useStore.getState().addWaypoint([11.62, 48.15]);
    await wait(300);
    const route = useStore.getState().route!;
    await saveRoute({ id: uid(), name: 'Isar', kind: 'planned', createdAt: Date.now(), updatedAt: Date.now(), route, favorite: false, collectionIds: [] });
    const all = await listRoutes();
    expect(all.find((r) => r.name === 'Isar')?.route.coords.length).toBe(route.coords.length);
    await useStore.getState().refreshSaved();
    expect(useStore.getState().saved.length).toBeGreaterThan(0);
  });
});
