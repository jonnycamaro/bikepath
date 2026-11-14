import { create } from 'zustand';
import type { LngLat } from './lib/geo';
import type { Place } from './lib/geocode';
import type { Fix, NavState } from './lib/navigation';
import type { RecorderStatus, RideStats } from './lib/recording';
import type { Route, Waypoint } from './lib/routing';
import { rideSpeed } from './lib/bike';
import { computeRoute, CYCLEPATH_PARAMS } from './lib/routing';
import { computeRoundTrip, isLoopRoute, LoopProblem, type LoopSpec, type LoopStop } from './lib/roundtrip';
import {
  DEFAULT_SETTINGS,
  listRoutes,
  loadCollections,
  loadSettings,
  storeCollections,
  storeSettings,
  uid,
  type Collection,
  type SavedRoute,
  type Settings,
} from './lib/storage';

export type Tab = 'map' | 'plan' | 'record' | 'routes' | 'profile';

interface PlanSnapshot {
  waypoints: Waypoint[];
  freehand: number[];
  loop: LoopSpec | null;
}

export interface SessionView {
  mode: 'navigate' | 'free';
  /** false = self-guided navigation */
  guided: boolean;
  status: RecorderStatus;
  stats: RideStats;
  nav: NavState | null;
  route: Route | null;
  rerouting: boolean;
  track: [number, number][];
  muted: boolean;
}

interface State {
  ready: boolean;
  tab: Tab;
  settings: Settings;
  fix: Fix | null;
  locationError: string | null;
  gpsStatus: 'ok' | 'weak' | 'waiting';
  missedStop: { id: string; name: string } | null;
  /** route waiting for the start dialog */
  pendingNav: Route | null;
  follow: 'off' | 'follow' | 'heading';
  // planner
  waypoints: Waypoint[];
  freehand: number[]; // leg indices drawn freehand
  /** set while the plan is a round trip: the first waypoint is the start, further ones are stops on the way */
  loop: LoopSpec | null;
  /** why the round trip cannot be built as asked, with values that would fix it */
  loopProblem: { kind: LoopProblem['kind']; message: string; fix: LoopProblem['fix'] } | null;
  profileId: string;
  route: Route | null;
  routing: boolean;
  routeError: string | null;
  undo: PlanSnapshot[];
  redo: PlanSnapshot[];
  editingId: string | null; // saved route being edited
  planName: string;
  /** kind chosen for an empty plan; null = the planner first asks for trip or round trip */
  planKind: 'trip' | null;
  // library
  saved: SavedRoute[];
  collections: Collection[];
  detailId: string | null;
  preview: Route | null; // route shown on the map from the library
  // session
  session: SessionView | null;
  // ui
  toast: { msg: string; id: number } | null;
  sheet: null | 'profile' | 'bike' | 'layers' | 'roundtrip' | 'offline' | 'settings' | 'save' | 'cues' | 'import' | 'legal';
  focus: { bbox?: [number, number, number, number]; center?: LngLat; zoom?: number; id: number } | null;
  offlineSelect: boolean;
  /** place shown in the card on the map tab (search result or tapped POI) */
  placeCard: Place | null;

  init: () => Promise<void>;
  setTab: (t: Tab) => void;
  setSettings: (p: Partial<Settings>) => void;
  setFix: (f: Fix) => void;
  setMissedStop: (m: { id: string; name: string } | null) => void;
  requestNavigation: (r: Route) => void;
  setPendingNav: (r: Route | null) => void;
  toastMsg: (m: string) => void;
  setSheet: (s: State['sheet']) => void;
  showPlace: (p: Place | null) => void;
  focusMap: (f: Omit<NonNullable<State['focus']>, 'id'>) => void;

  // planner actions
  addWaypoint: (p: LngLat, name?: string, at?: number) => void;
  moveWaypoint: (id: string, p: LngLat) => void;
  insertWaypoint: (legIndex: number, p: LngLat) => void;
  removeWaypoint: (id: string) => void;
  renameWaypoint: (id: string, name: string) => void;
  setWaypoints: (w: Waypoint[], record?: boolean) => void;
  /** plan a round trip (replaces the current plan) */
  setLoop: (spec: LoopSpec, name?: string, stops?: LoopStop[]) => void;
  /** turn the round trip into ordinary waypoints so it can be edited by hand */
  editLoopByHand: () => void;
  reverse: () => void;
  clearPlan: () => void;
  /** begin an empty plan: a trip goes straight to choosing the start, a round trip opens its sheet */
  startPlan: (kind: 'trip' | 'loop') => void;
  setProfile: (id: string) => void;
  toggleFreehandLeg: (i: number) => void;
  undoPlan: () => void;
  redoPlan: () => void;
  recompute: () => Promise<void>;
  loadIntoPlanner: (s: SavedRoute) => void;

  refreshSaved: () => Promise<void>;
  setCollections: (c: Collection[]) => void;
  setDetail: (id: string | null) => void;
  setSession: (s: SessionView | null | ((p: SessionView | null) => SessionView | null)) => void;
}

let routeAbort: AbortController | null = null;
let routeTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => {
  const snapshot = (): PlanSnapshot => ({ waypoints: get().waypoints, freehand: get().freehand, loop: get().loop });
  const commit = (p: Partial<State>) => {
    set({ undo: [...get().undo.slice(-49), snapshot()], redo: [], ...p });
    scheduleRoute();
  };
  const scheduleRoute = () => {
    if (routeTimer) clearTimeout(routeTimer);
    routeTimer = setTimeout(() => get().recompute(), 120);
  };

  return {
    ready: false,
    tab: 'map',
    settings: DEFAULT_SETTINGS,
    fix: null,
    locationError: null,
    gpsStatus: 'waiting',
    missedStop: null,
    pendingNav: null,
    follow: 'off',
    waypoints: [],
    freehand: [],
    loop: null,
    loopProblem: null,
    profileId: 'balanced',
    route: null,
    routing: false,
    routeError: null,
    undo: [],
    redo: [],
    editingId: null,
    planKind: null,
    placeCard: null,
    planName: '',
    saved: [],
    collections: [],
    detailId: null,
    preview: null,
    session: null,
    toast: null,
    sheet: null,
    focus: null,
    offlineSelect: false,

    init: async () => {
      const [settings, saved, collections] = await Promise.all([
        loadSettings().catch(() => DEFAULT_SETTINGS),
        listRoutes().catch(() => []),
        loadCollections().catch(() => []),
      ]);
      set({ settings, saved, collections, profileId: settings.defaultProfile, ready: true });
    },
    setTab: (tab) => set({ tab, detailId: tab === 'routes' ? get().detailId : null, preview: tab === 'routes' ? get().preview : null }),
    setSettings: (p) => {
      const settings = { ...get().settings, ...p };
      set({ settings });
      storeSettings(settings).catch(() => {});
      if ('bikeType' in p || 'bikeSpeed' in p || 'cyclePathPref' in p) scheduleRoute();
    },
    setFix: (fix) => set({ fix, locationError: null }),
    setMissedStop: (missedStop) => set({ missedStop }),
    setPendingNav: (pendingNav) => set({ pendingNav }),
    requestNavigation: (r) => {
      const mode = get().settings.navMode;
      if (mode === 'ask') set({ pendingNav: r });
      else import('./session').then((m) => m.startNavigation(r, { guided: mode !== 'self-guided' }));
    },
    toastMsg: (msg) => set({ toast: { msg, id: Date.now() } }),
    setSheet: (sheet) => set({ sheet }),
    showPlace: (placeCard) => set({ placeCard }),
    focusMap: (f) => set({ focus: { ...f, id: Date.now() } }),

    addWaypoint: (p, name, at) => {
      const wps = [...get().waypoints];
      const wp = { id: uid(), lngLat: p, name };
      if (at == null || at >= wps.length) wps.push(wp);
      else wps.splice(at, 0, wp);
      commit({ waypoints: wps });
    },
    moveWaypoint: (id, p) => {
      const loop = get().loop;
      commit({
        waypoints: get().waypoints.map((w) => (w.id === id ? { ...w, lngLat: p, name: undefined } : w)),
        ...(loop && get().waypoints[0]?.id === id ? { loop: { ...loop, start: p } } : {}),
      });
    },
    insertWaypoint: (legIndex, p) => {
      if (get().loop) return get().addWaypoint(p); // the round trip sorts its stops itself
      const wps = [...get().waypoints];
      wps.splice(legIndex + 1, 0, { id: uid(), lngLat: p });
      // freehand flags shift for legs after the insert; the split leg keeps its mode for both halves
      const fh = get().freehand.flatMap((i) => (i < legIndex ? [i] : i === legIndex ? [i, i + 1] : [i + 1]));
      commit({ waypoints: wps, freehand: fh });
    },
    removeWaypoint: (id) => {
      const idx = get().waypoints.findIndex((w) => w.id === id);
      const fh = get().freehand.filter((i) => i !== idx && i !== idx - 1).map((i) => (i > idx ? i - 1 : i));
      // a round trip stays one when a stop goes; without its start it is an ordinary plan again
      commit({ waypoints: get().waypoints.filter((w) => w.id !== id), freehand: fh, ...(idx === 0 ? { loop: null } : {}) });
    },
    renameWaypoint: (id, name) => set({ waypoints: get().waypoints.map((w) => (w.id === id ? { ...w, name } : w)) }),
    setWaypoints: (waypoints, record = true) => (record ? commit({ waypoints, freehand: [], loop: null }) : (set({ waypoints }), scheduleRoute())),
    setLoop: (spec, name, stops) => {
      const wps = get().waypoints;
      const cur = wps[0];
      const keep = get().loop && cur && cur.lngLat[0] === spec.start[0] && cur.lngLat[1] === spec.start[1];
      const first = keep ? { ...cur, name: name ?? cur.name } : { id: uid(), lngLat: spec.start, name };
      // stops are kept as waypoints; without a new list the ones already planned stay
      const rest = stops ? stops.map((p) => ({ id: p.id ?? uid(), lngLat: p.lngLat, name: p.name })) : get().loop ? wps.slice(1) : [];
      commit({ waypoints: [first, ...rest], freehand: [], loop: { ...spec, stops: undefined }, route: keep ? get().route : null });
    },
    editLoopByHand: () => {
      const r = get().route;
      if (!get().loop || !r) return;
      // control points along the track keep its shape when legs are routed again
      const n = Math.min(14, Math.max(4, Math.round(r.distance / 3000) + 1));
      const name = get().waypoints[0]?.name;
      const wps: Waypoint[] = Array.from({ length: n }, (_, i) => {
        const along = (r.distance * i) / (n - 1);
        let k = r.cum.findIndex((d) => d >= along);
        if (k < 0) k = r.coords.length - 1;
        const c = r.coords[k];
        return { id: uid(), lngLat: [c[0], c[1]] as LngLat, name: i === 0 || i === n - 1 ? name : undefined };
      });
      commit({ waypoints: wps, freehand: [], loop: null });
    },
    reverse: () => {
      const loop = get().loop;
      if (loop) {
        commit({ loop: { ...loop, reversed: !loop.reversed } });
        return;
      }
      const n = get().waypoints.length;
      commit({ waypoints: [...get().waypoints].reverse(), freehand: get().freehand.map((i) => n - 2 - i) });
    },
    clearPlan: () => {
      routeAbort?.abort();
      set({ undo: [...get().undo, snapshot()], redo: [], waypoints: [], freehand: [], loop: null, loopProblem: null, route: null, routing: false, routeError: null, editingId: null, planName: '', planKind: null });
    },
    startPlan: (kind) => (kind === 'loop' ? set({ planKind: null, sheet: 'roundtrip' }) : set({ planKind: 'trip' })),
    setProfile: (profileId) => {
      set({ profileId });
      scheduleRoute();
    },
    toggleFreehandLeg: (i) => {
      const fh = get().freehand.includes(i) ? get().freehand.filter((x) => x !== i) : [...get().freehand, i];
      commit({ freehand: fh });
    },
    undoPlan: () => {
      const u = get().undo;
      if (!u.length) return;
      const prev = u[u.length - 1];
      set({ undo: u.slice(0, -1), redo: [...get().redo, snapshot()], ...prev });
      scheduleRoute();
    },
    redoPlan: () => {
      const r = get().redo;
      if (!r.length) return;
      const next = r[r.length - 1];
      set({ redo: r.slice(0, -1), undo: [...get().undo, snapshot()], ...next });
      scheduleRoute();
    },
    recompute: async () => {
      const { waypoints, profileId, freehand, settings, loop } = get();
      routeAbort?.abort();
      if (!loop && waypoints.length < 2) {
        set({ route: null, routing: false, routeError: null, loopProblem: null });
        return;
      }
      const ctrl = new AbortController();
      routeAbort = ctrl;
      set({ routing: true, routeError: null, loopProblem: null });
      const speed = rideSpeed(settings, profileId);
      const trip = loop && { ...loop, start: waypoints[0].lngLat, stops: waypoints.slice(1) };
      // A strict cycle-path preference can leave no routable way at all; soften it then.
      const prefs: ('high' | 'medium' | 'low')[] =
        settings.cyclePathPref === 'high' ? ['high', 'medium', 'low'] : settings.cyclePathPref === 'medium' ? ['medium', 'low'] : ['low'];
      let lastError: Error | null = null;
      for (const pref of prefs) {
        try {
          const route = trip
            ? await computeRoundTrip(trip, profileId, { signal: ctrl.signal, speedKmh: speed, params: CYCLEPATH_PARAMS[pref] })
            : await computeRoute(waypoints, profileId, {
                signal: ctrl.signal,
                speedKmh: speed,
                freehandLegs: new Set(freehand),
                params: CYCLEPATH_PARAMS[pref],
              });
          if (ctrl.signal.aborted) return;
          set({ route, routing: false, routeError: null });
          if (pref !== settings.cyclePathPref) {
            get().toastMsg('Mit dieser Radweg-Stufe war keine Route möglich – weniger streng berechnet');
          }
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') return;
          if (e instanceof LoopProblem) {
            // nothing a softer routing option would change: say what is wrong and how to fix it
            set({ routing: false, route: null, loopProblem: { kind: e.kind, message: e.message, fix: e.fix } });
            return;
          }
          lastError = e as Error;
        }
      }
      set({ routing: false, routeError: lastError?.message || 'Routing fehlgeschlagen' });
    },
    loadIntoPlanner: (s) => {
      // saved round trips have no stops to route between: keep their track like an imported one
      const imported = s.kind !== 'planned' || s.route.waypoints.length < 2 || (s.route.waypoints[0].id === 'loop-start' && isLoopRoute(s.route));
      if (imported) {
        // Tracks keep their exact geometry until edited; then they are re-routed through
        // control points sampled along the original track, so the shape is preserved.
        const n = Math.min(20, Math.max(2, Math.round(s.route.distance / 2000) + 1));
        const wps: Waypoint[] = Array.from({ length: n }, (_, i) => {
          const along = (s.route.distance * i) / (n - 1);
          let k = s.route.cum.findIndex((d) => d >= along);
          if (k < 0) k = s.route.coords.length - 1;
          const c = s.route.coords[k];
          return { id: uid(), lngLat: [c[0], c[1]] as LngLat };
        });
        set({ route: s.route, waypoints: wps, freehand: [], loop: null, editingId: s.id, planName: s.name, tab: 'plan', undo: [], redo: [] });
        get().focusMap({ bbox: bboxOf(s.route) });
        return;
      }
      set({
        waypoints: s.route.waypoints,
        freehand: [],
        loop: null,
        profileId: s.route.profileId,
        editingId: s.id,
        planName: s.name,
        tab: 'plan',
        undo: [],
        redo: [],
        route: s.route,
      });
      get().focusMap({ bbox: bboxOf(s.route) });
    },

    refreshSaved: async () => set({ saved: await listRoutes() }),
    setCollections: (collections) => {
      set({ collections });
      storeCollections(collections).catch(() => {});
    },
    setDetail: (detailId) => {
      const s = get().saved.find((x) => x.id === detailId);
      set({ detailId, preview: s?.route ?? null });
      if (s) get().focusMap({ bbox: bboxOf(s.route) });
    },
    setSession: (s) => set({ session: typeof s === 'function' ? s(get().session) : s }),
  };
});

export function bboxOf(r: Route): [number, number, number, number] {
  let w = 180, s = 90, e = -180, n = -90;
  for (const c of r.coords) {
    w = Math.min(w, c[0]);
    e = Math.max(e, c[0]);
    s = Math.min(s, c[1]);
    n = Math.max(n, c[1]);
  }
  return [w, s, e, n];
}
