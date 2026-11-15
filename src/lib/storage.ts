import { createStore, del, entries, get, set } from 'idb-keyval';
import type { RideStats, TrackPoint } from './recording';
import type { Route } from './routing';
import type { CustomProfile } from './customProfile';

export type RouteKind = 'planned' | 'recorded' | 'imported';

export interface SavedRoute {
  id: string;
  name: string;
  kind: RouteKind;
  createdAt: number;
  updatedAt: number;
  route: Route;
  favorite: boolean;
  collectionIds: string[];
  /** only for recorded rides */
  ride?: { stats: RideStats; points: TrackPoint[]; startedAt: number };
  note?: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export type NavMode = 'ask' | 'turn-by-turn' | 'self-guided';

export interface BikeComputerLayout {
  id: string;
  name: string;
  fields: string[];
  builtin?: boolean;
}

export interface Settings {
  units: 'metric' | 'imperial';
  /** which navigation mode to use; 'ask' shows the chooser on every start */
  navMode: NavMode;
  /** 'rejoin' leads back onto the planned route, 'direct' routes straight to the next stop */
  rerouteMode: 'rejoin' | 'direct';
  climbAnnouncements: boolean;
  /** keep recording after arriving at the destination */
  continueRecording: boolean;
  /** 'auto' follows the device's own power saver */
  batterySaveMode: 'off' | 'auto' | 'on';
  theme: 'system' | 'light' | 'dark';
  cyclePathPref: 'low' | 'medium' | 'high';
  layouts: BikeComputerLayout[];
  activeLayout: string;
  places: { home?: { lngLat: [number, number]; name: string }; work?: { lngLat: [number, number]; name: string } };
  voice: boolean;
  voiceVolume: number;
  autoReroute: boolean;
  autoPause: boolean;
  keepScreenOn: boolean;
  batterySave: boolean;
  mapStyle: string;
  overlays: string[];
  /** POI categories shown when picking a place from the POI map, see lib/pois.ts */
  poiTypes: string[];
  /** own routing options (Profil → Eigene Routenoptionen) */
  customProfiles: CustomProfile[];
  terrain3d: boolean;
  defaultProfile: string;
  /** id of the rider's bike, see lib/bike.ts */
  bikeType: string;
  /** own average in km/h; null = the bike type's usual pace */
  bikeSpeed: number | null;
  computerFields: string[];
  routeColorMode: 'solid' | 'surface' | 'waytype' | 'gradient';
  onboarded: boolean;
}

export const BUILTIN_LAYOUTS: BikeComputerLayout[] = [
  { id: 'standard', name: 'Standard', fields: ['speed', 'distance', 'time', 'remaining', 'eta', 'ascent'], builtin: true },
  { id: 'simple', name: 'Einfach', fields: ['speed', 'distance', 'time'], builtin: true },
  { id: 'climbing', name: 'Berg', fields: ['speed', 'ascent', 'grade', 'climb', 'distance', 'remaining'], builtin: true },
  { id: 'training', name: 'Training', fields: ['speed', 'avg', 'max', 'distance', 'time', 'ascent'], builtin: true },
];

export const DEFAULT_SETTINGS: Settings = {
  units: 'metric',
  navMode: 'ask',
  rerouteMode: 'rejoin',
  climbAnnouncements: true,
  continueRecording: false,
  batterySaveMode: 'off',
  theme: 'system',
  cyclePathPref: 'low',
  layouts: BUILTIN_LAYOUTS,
  activeLayout: 'standard',
  places: {},
  voice: true,
  voiceVolume: 1,
  autoReroute: true,
  autoPause: true,
  keepScreenOn: true,
  batterySave: false,
  mapStyle: 'bikepath',
  overlays: [],
  customProfiles: [],
  poiTypes: ['food', 'restaurant', 'shop', 'water', 'toilets', 'bikeshop', 'sight'],
  terrain3d: false,
  defaultProfile: 'balanced',
  bikeType: 'trekking',
  bikeSpeed: null,
  computerFields: ['speed', 'distance', 'time', 'remaining', 'eta', 'ascent'],
  routeColorMode: 'solid',
  onboarded: false,
};

const routesStore = typeof indexedDB !== 'undefined' ? createStore('bikepath', 'routes') : undefined;
const kvStore = typeof indexedDB !== 'undefined' ? createStore('bikepath-kv', 'kv') : undefined;

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function listRoutes(): Promise<SavedRoute[]> {
  const all = await entries<string, SavedRoute>(routesStore);
  return all.map(([, v]) => v).sort((a, b) => b.createdAt - a.createdAt);
}
export const saveRoute = (r: SavedRoute) => set(r.id, { ...r, updatedAt: Date.now() }, routesStore);
export const deleteRoute = (id: string) => del(id, routesStore);
export const getRoute = (id: string) => get<SavedRoute>(id, routesStore);

export async function loadSettings(): Promise<Settings> {
  const s = await get<Partial<Settings>>('settings', kvStore);
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export const storeSettings = (s: Settings) => set('settings', s, kvStore);

export async function loadCollections(): Promise<Collection[]> {
  return (await get<Collection[]>('collections', kvStore)) ?? [];
}
export const storeCollections = (c: Collection[]) => set('collections', c, kvStore);

export const kvGet = <T>(k: string) => get<T>(k, kvStore);
export const kvSet = (k: string, v: unknown) => set(k, v, kvStore);
export const kvDel = (k: string) => del(k, kvStore);
