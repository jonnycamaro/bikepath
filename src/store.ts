import { create } from 'zustand';
import type { LngLat } from './lib/geo';
import type { Fix, NavState } from './lib/navigation';
import type { RecorderStatus, RideStats } from './lib/recording';
import type { Route, Waypoint } from './lib/routing';
import { computeRoute, CYCLEPATH_PARAMS, profileById } from './lib/routing';
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
  profileId: string;
  route: Route | null;
  routing: boolean;
  routeError: string | null;
  undo: PlanSnapshot[];
  redo: PlanSnapshot[];
  editingId: string | null; // saved route being edited
  planName: string;
  // library
  saved: SavedRoute[];
  collections: Collection[];
  detailId: string | null;
  preview: Route | null; // route shown on the map from the library
  // session
  session: SessionView | null;
  // ui
  toast: { msg: string; id: number } | null;
  sheet: null | 'layers' | 'roundtrip' | 'offline' | 'settings' | 'save' | 'cues' | 'import';
  focus: { bbox?: [number, number, number, number]; center?: LngLat; zoom?: number; id: number } | null;
  offlineSelect: boolean;

  init: () => Promise<void>;
  setTab: (t: Tab) => void;
  setSettings: (p: Partial<Settings>) => void;
  setFix: (f: Fix) => void;
  setMissedStop: (m: { id: string; name: string } | null) => void;
  requestNavigation: (r: Route) => void;
  setPendingNav: (r: Route | null) => void;
  toastMsg: (m: string) => void;
  setSheet: (s: State['sheet']) => void;
  focusMap: (f: Omit<NonNullable<State['focus']>, 'id'>) => void;

  // planner actions
  addWaypoint: (p: LngLat, name?: string, at?: number) => void;
  moveWaypoint: (id: string, p: LngLat) => void;
  insertWaypoint: (legIndex: number, p: LngLat) => void;
  removeWaypoint: (id: string) => void;
  renameWaypoint: (id: string, name: string) => void;
  setWaypoints: (w: Waypoint[], record?: boolean) => void;
  reverse: () => void;
  clearPlan: () => void;
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
  const snapshot = (): PlanSnapshot => ({ waypoints: get().waypoints, freehand: get().freehand });
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
    profileId: 'balanced',
    route: null,
    routing: false,
    routeError: null,
    undo: [],
    redo: [],
    editingId: null,
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
      if ('speedKmh' in p || 'cyclePathPref' in p) scheduleRoute();
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
    focusMap: (f) => set({ focus: { ...f, id: Date.now() } }),

    addWaypoint: (p, name, at) => {
      const wps = [...get().waypoints];
      const wp = { id: uid(), lngLat: p, name };
      if (at == null || at >= wps.length) wps.push(wp);
      else wps.splice(at, 0, wp);
      commit({ waypoints: wps });
    },
    moveWaypoint: (id, p) =>
      commit({ waypoints: get().waypoints.map((w) => (w.id === id ? { ...w, lngLat: p, name: undefined } : w)) }),
    insertWaypoint: (legIndex, p) => {
      const wps = [...get().waypoints];
      wps.splice(legIndex + 1, 0, { id: uid(), lngLat: p });
      // freehand flags shift for legs after the insert; the split leg keeps its mode for both halves
      const fh = get().freehand.flatMap((i) => (i < legIndex ? [i] : i === legIndex ? [i, i + 1] : [i + 1]));
      commit({ waypoints: wps, freehand: fh });
    },
    removeWaypoint: (id) => {
      const idx = get().waypoints.findIndex((w) => w.id === id);
      const fh = get().freehand.filter((i) => i !== idx && i !== idx - 1).map((i) => (i > idx ? i - 1 : i));
      commit({ waypoints: get().waypoints.filter((w) => w.id !== id), freehand: fh });
    },
    renameWaypoint: (id, name) => set({ waypoints: get().waypoints.map((w) => (w.id === id ? { ...w, name } : w)) }),
    setWaypoints: (waypoints, record = true) => (record ? commit({ waypoints, freehand: [] }) : (set({ waypoints }), scheduleRoute())),
    reverse: () => {
      const n = get().waypoints.length;
      commit({ waypoints: [...get().waypoints].reverse(), freehand: get().freehand.map((i) => n - 2 - i) });
    },
    clearPlan: () => {
      routeAbort?.abort();
      set({ undo: [...get().undo, snapshot()], redo: [], waypoints: [], freehand: [], route: null, routeError: null, editingId: null, planName: '' });
    },
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
      const { waypoints, profileId, freehand, settings } = get();
      routeAbort?.abort();
      if (waypoints.length < 2) {
        set({ route: null, routing: false, routeError: null });
        return;
      }
      const ctrl = new AbortController();
      routeAbort = ctrl;
      set({ routing: true, routeError: null });
      const speed = settings.speedKmh[profileId] ?? profileById(profileId).speedKmh;
      // A strict cycle-path preference can leave no routable way at all; soften it then.
      const prefs: ('high' | 'medium' | 'low')[] =
        settings.cyclePathPref === 'high' ? ['high', 'medium', 'low'] : settings.cyclePathPref === 'medium' ? ['medium', 'low'] : ['low'];
      let lastError: Error | null = null;
      for (const pref of prefs) {
        try {
          const route = await computeRoute(waypoints, profileId, {
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
          lastError = e as Error;
        }
      }
      set({ routing: false, routeError: lastError?.message || 'Routing fehlgeschlagen' });
    },
    loadIntoPlanner: (s) => {
      const imported = s.kind !== 'planned' || s.route.waypoints.length < 2;
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
        set({ route: s.route, waypoints: wps, freehand: [], editingId: s.id, planName: s.name, tab: 'plan', undo: [], redo: [] });
        get().focusMap({ bbox: bboxOf(s.route) });
        return;
      }
      set({
        waypoints: s.route.waypoints,
        freehand: [],
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
