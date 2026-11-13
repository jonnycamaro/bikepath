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

  it('freehand legs do not call the router', async () => {
    useStore.getState().setProfile('freehand');
    useStore.getState().addWaypoint([11.5, 48.1]);
    useStore.getState().addWaypoint([11.51, 48.1]);
    await wait(300);
    expect((fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes('brouter')).length).toBe(0);
    expect(useStore.getState().route?.distance).toBeGreaterThan(700);
    useStore.getState().clearPlan();
    useStore.getState().setProfile('balanced');
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
