import { haversine, snapToLine } from './lib/geo';
import { location } from './lib/location';
import { NavigationEngine, type Fix } from './lib/navigation';
import { Recorder } from './lib/recording';
import { isLoopRoute } from './lib/roundtrip';
import { joinReroute, rejoinTarget, reverseRoute, sliceRoute } from './lib/routeOps';
import { bikeSpeed, rideSpeed } from './lib/bike';
import { computeRoute, CYCLEPATH_PARAMS, routeFromTrack, type Route } from './lib/routing';
import { configureSpeech, speak, unlockSpeech } from './lib/speech';
import { kvDel, kvGet, kvSet, saveRoute, uid, type SavedRoute } from './lib/storage';
import { keepAwake } from './lib/wakelock';
import { applyBatterySave } from './lib/batterySave';
import { useStore, type SessionView } from './store';

/**
 * Ride session controller: owns the recorder, optional navigation engine and GPS
 * subscription, and pushes a render snapshot to the store once per fix.
 */
let recorder: Recorder | null = null;
let engine: NavigationEngine | null = null;
let unsub: (() => void) | null = null;
let persistTimer: number | null = null;
let rerouting = false;
let lastReroute = 0;
let muted = false;
let lastFix: Fix | null = null;
let tickTimer: number | null = null;
/** consecutive watchdog ticks with a poor fix; drives the weak-GPS hint */
let weakTicks = 0;
const WEAK_ENTER_M = 35;
const WEAK_LEAVE_M = 25;
/** route as planned, kept so reroutes can lead back onto it */
let baseRoute: Route | null = null;
let skippedWaypoints = new Set<string>();
let missedAsked = new Set<string>();
let arrivedHandled = false;

const ACTIVE_KEY = 'activeRide';

function view(): SessionView | null {
  if (!recorder) return null;
  const nav = useStore.getState().session?.nav ?? null;
  return {
    mode: engine ? 'navigate' : 'free',
    guided: engine ? engine.guided : true,
    status: recorder.status,
    stats: recorder.stats(),
    nav,
    route: engine?.route ?? null,
    rerouting,
    track: recorder.points().map((p) => [p.lon, p.lat]),
    muted,
  };
}

function push(partial: Partial<SessionView> = {}) {
  const v = view();
  useStore.getState().setSession(v ? { ...v, ...partial } : null);
}

async function reroute(fix: Fix) {
  if (!engine || rerouting || Date.now() - lastReroute < 8000) return;
  const st = useStore.getState();
  if (!st.settings.autoReroute) return;
  rerouting = true;
  lastReroute = Date.now();
  push();
  if (!muted) speak('Route wird neu berechnet');
  try {
    const cur = engine.route;
    const state = engine.update(fix);
    const profile = cur.profileId;
    const speed = rideSpeed(st.settings, cur.profileId);
    const target = baseRoute ?? cur;
    let next: Route | null = null;

    // a round trip has no stops left to aim for – "direct" would simply lead home
    if ((st.settings.rerouteMode === 'rejoin' || isLoopRoute(target)) && target.distance > 0) {
      // guide back onto the planned route, then continue along it
      const progress = baseRoute === cur ? engine.progress : 0;
      const join = rejoinTarget(target, fix.lngLat, progress);
      const detour = haversine(fix.lngLat, join.point);
      if (detour < 20000) {
        const leg = await computeRoute(
          [{ id: uid(), lngLat: fix.lngLat, name: 'Mein Standort' }, { id: uid(), lngLat: join.point, name: 'Route' }],
          profile,
          { speedKmh: speed, params: CYCLEPATH_PARAMS[st.settings.cyclePathPref] },
        );
        if (leg) next = joinReroute(leg, target, join.along);
      }
    }
    if (!next) {
      // fall back to routing straight to the remaining stops
      const rest = cur.waypoints.slice(Math.max(1, state.nextWaypointIndex)).filter((w) => !skippedWaypoints.has(w.id));
      const wps = [{ id: uid(), lngLat: fix.lngLat }, ...rest];
      next = await computeRoute(wps, profile, { speedKmh: speed, params: CYCLEPATH_PARAMS[st.settings.cyclePathPref] });
    }
    if (next && engine) {
      engine.setRoute(next);
      engine.resetOffRoute();
    }
  } catch {
    if (!muted) speak('Neuberechnung nicht möglich');
  } finally {
    rerouting = false;
    // refresh guidance immediately against the new route
    const nav = engine && lastFix ? engine.update(lastFix) : null;
    push(nav ? { nav } : {});
  }
}

/** Detect a stop the rider passed without reaching it. */
function checkMissedStop(nav: ReturnType<NavigationEngine['update']>) {
  if (!engine || !lastFix) return;
  const wps = engine.route.waypoints;
  const alongs = engine.waypointPositions;
  for (let i = 1; i < wps.length - 1; i++) {
    const w = wps[i];
    if (skippedWaypoints.has(w.id) || missedAsked.has(w.id)) continue;
    // passed it by more than 150 m along the route, but never came close to it
    if (nav.along > alongs[i] + 150 && haversine(lastFix.lngLat, w.lngLat) > 120) {
      missedAsked.add(w.id);
      useStore.getState().setMissedStop({ id: w.id, name: w.name ?? `Zwischenziel ${i}` });
      return;
    }
  }
}

/** The rider decided about a missed stop. */
export async function resolveMissedStop(action: 'skip' | 'back') {
  const missed = useStore.getState().missedStop;
  useStore.getState().setMissedStop(null);
  if (!missed || !engine || !lastFix) return;
  if (action === 'skip') {
    skippedWaypoints.add(missed.id);
    const cur = engine.route;
    const rest = cur.waypoints.filter((w, i) => i > 0 && !skippedWaypoints.has(w.id));
    if (rest.length) {
      const st = useStore.getState();
      const profile = cur.profileId;
      const speed = rideSpeed(st.settings, cur.profileId);
      rerouting = true;
      push();
      try {
        const r = await computeRoute([{ id: uid(), lngLat: lastFix.lngLat }, ...rest], profile, { speedKmh: speed });
        if (r && engine) {
          baseRoute = r;
          engine.setRoute(r);
        }
      } finally {
        rerouting = false;
        push(engine && lastFix ? { nav: engine.update(lastFix) } : {});
      }
    }
  } else {
    // route back to the missed stop first
    const cur = engine.route;
    const wp = cur.waypoints.find((w) => w.id === missed.id);
    if (!wp) return;
    const st = useStore.getState();
    const profile = cur.profileId;
    const speed = rideSpeed(st.settings, cur.profileId);
    const idx = cur.waypoints.indexOf(wp);
    const rest = cur.waypoints.slice(idx).filter((w) => !skippedWaypoints.has(w.id));
    rerouting = true;
    push();
    try {
      const r = await computeRoute([{ id: uid(), lngLat: lastFix.lngLat }, ...rest], profile, { speedKmh: speed });
      if (r && engine) {
        baseRoute = r;
        engine.setRoute(r);
      }
    } finally {
      rerouting = false;
      push(engine && lastFix ? { nav: engine.update(lastFix) } : {});
    }
  }
}

function onFix(fix: Fix) {
  if (!recorder) return;
  lastFix = fix;
  // never record stale fixes from before the ride started (e.g. cached last position)
  if (fix.time >= recorder.startedAt - 2000) recorder.add(fix);
  let nav = null;
  if (engine) {
    nav = engine.update(fix);
    if (!muted) for (const s of nav.speak) speak(s);
    if (nav.offRoute) reroute(fix);
    checkMissedStop(nav);
    if (nav.arrived && !arrivedHandled) {
      arrivedHandled = true;
      if (!useStore.getState().settings.continueRecording) recorder.pause();
    }
  }
  const v = view();
  if (v) useStore.getState().setSession({ ...v, nav });
}

/**
 * Hook the prepared recorder and engine up to the live position stream, the
 * persistence timer, the wake lock, the battery-save style and the GPS watchdog.
 *
 * Shared by a fresh ride and by one restored after the app was interrupted: a
 * restored ride needs exactly the same machinery, otherwise it keeps running
 * without a watchdog (no auto-pause when GPS dies, and the GPS hint stuck on
 * "Warten auf GPS"), without the wake lock and without battery save.
 */
function attachLive() {
  const st = useStore.getState();
  skippedWaypoints = new Set();
  missedAsked = new Set();
  arrivedHandled = false;
  weakTicks = 0;
  useStore.setState({ gpsStatus: 'waiting' });
  if (st.settings.keepScreenOn) keepAwake(true);
  applyBatterySave(true);
  unsub = location.subscribe(onFix, (msg) => st.toastMsg(msg));
  persistTimer = window.setInterval(persist, 10000);
  // watchdog: auto-pause when GPS stops delivering, and surface a weak-signal hint
  tickTimer = window.setInterval(() => {
    if (!recorder) return;
    const changed = recorder.tick(Date.now(), lastFix?.time ?? null);
    const stale = !lastFix || Date.now() - lastFix.time > 15000;
    // GPS accuracy fluctuates by tens of metres from one sample to the next, so a plain
    // threshold makes the hint blink on and off. Warn only after two consecutive poor
    // samples and clear it only once the fix is clearly good again (hysteresis).
    if (lastFix) {
      if (lastFix.accuracy > WEAK_ENTER_M) weakTicks++;
      else if (lastFix.accuracy < WEAK_LEAVE_M) weakTicks = 0;
    }
    const weak = weakTicks >= 2;
    const cur = useStore.getState().gpsStatus;
    const next = stale ? 'waiting' : weak ? 'weak' : 'ok';
    if (cur !== next) useStore.setState({ gpsStatus: next });
    if (changed) push();
  }, 3000);
}

function startCommon(route: Route | null, guided = true) {
  const st = useStore.getState();
  unlockSpeech();
  configureSpeech(st.settings.voice, st.settings.voiceVolume);
  muted = !st.settings.voice;
  recorder = new Recorder({ autoPause: st.settings.autoPause });
  recorder.start();
  const speed = route ? rideSpeed(st.settings, route.profileId) : bikeSpeed(st.settings);
  engine = route
    ? new NavigationEngine(route, { speedKmh: speed, guided, climbAnnouncements: st.settings.climbAnnouncements })
    : null;
  baseRoute = route;
  attachLive();
  useStore.setState({ follow: 'heading', tab: 'record' });
  push({ nav: null });
  if (route && !muted) speak(guided ? 'Navigation gestartet' : 'Selbstgeführte Navigation gestartet');
}

export interface StartNavOptions {
  /** false = self-guided (position on the line only) */
  guided?: boolean;
  /** where to join the route: its start, the nearest point, or reversed */
  entry?: 'start' | 'nearest' | 'reverse';
  /** ride the route with simulated GPS instead of the real position (demo / testing) */
  simulate?: boolean;
}

export function startNavigation(route: Route, opts: StartNavOptions = {}) {
  stopInternal();
  let r = route;
  const me = location.last?.lngLat ?? useStore.getState().fix?.lngLat;
  if (opts.entry === 'reverse') r = reverseRoute(route);
  else if (opts.entry === 'nearest' && me) {
    const snap = snapToLine(me, route.coords, route.cum);
    if (snap && snap.along > 50 && route.distance - snap.along > 100) r = sliceRoute(route, snap.along);
  }
  startCommon(r, opts.guided ?? true);
  if (opts.simulate) simulateCurrent(4);
}

/** Entry options for the pre-navigation dialog. */
export function entryOptions(route: Route, me?: [number, number]) {
  const snap = me ? snapToLine(me, route.coords, route.cum) : null;
  const start = me ? haversine(me, [route.coords[0][0], route.coords[0][1]]) : null;
  const end = me ? haversine(me, [route.coords[route.coords.length - 1][0], route.coords[route.coords.length - 1][1]]) : null;
  return {
    startDistance: start,
    endDistance: end,
    nearest: snap && snap.along > 50 && route.distance - snap.along > 100
      ? { distance: snap.distance, along: snap.along, remaining: route.distance - snap.along }
      : null,
  };
}

export function startFreeRide() {
  stopInternal();
  startCommon(null);
}

/** Voice feedback on pause and resume. */
function announcePause(resumed: boolean) {
  if (!muted) speak(resumed ? 'Aufzeichnung fortgesetzt' : 'Aufzeichnung pausiert');
}

export function pauseRide() {
  recorder?.pause();
  announcePause(false);
  push();
}
export function resumeRide() {
  recorder?.resume();
  announcePause(true);
  push();
}
export function toggleMute() {
  muted = !muted;
  configureSpeech(!muted, useStore.getState().settings.voiceVolume);
  push();
}

/** Recentre navigation on a new route (e.g. after user picked "Zur Route"). */
export function simulateCurrent(factor = 4) {
  const s = useStore.getState().session;
  const r = engine?.route ?? s?.route;
  if (!r) {
    useStore.getState().toastMsg('Simulation braucht eine Route');
    return;
  }
  location.simulate(r.coords, r.cum, 20, factor);
}

async function persist() {
  if (!recorder) return;
  await kvSet(ACTIVE_KEY, { rec: recorder.snapshot(), route: engine?.route ?? null }).catch(() => {});
}

function stopInternal() {
  unsub?.();
  unsub = null;
  if (persistTimer) clearInterval(persistTimer);
  persistTimer = null;
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = null;
  keepAwake(false);
  applyBatterySave(false);
  if (location.simulating) location.endSimulation();
}

/** Stop the ride. Returns the saved ride (or null if discarded / too short). */
export async function stopRide(save: boolean, name?: string, groupId?: string): Promise<SavedRoute | null> {
  const rec = recorder;
  const route = engine?.route ?? null;
  stopInternal();
  recorder = null;
  engine = null;
  baseRoute = null;
  useStore.getState().setSession(null);
  useStore.getState().setMissedStop(null);
  useStore.setState({ gpsStatus: 'ok' });
  useStore.setState({ follow: 'follow' });
  await kvDel(ACTIVE_KEY).catch(() => {});
  if (!rec || !save) return null;
  const pts = rec.points();
  if (pts.length < 2) {
    useStore.getState().toastMsg('Fahrt zu kurz – nicht gespeichert');
    return null;
  }
  const stats = rec.stats();
  const r = routeFromTrack(rec.coords(), route?.profileId ?? 'balanced');
  const date = new Date(rec.startedAt);
  const saved: SavedRoute = {
    id: uid(),
    name: name || `Fahrt am ${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
    kind: 'recorded',
    createdAt: rec.startedAt,
    updatedAt: Date.now(),
    route: r,
    favorite: true,
    collectionIds: groupId ? [groupId] : [],
    ride: { stats, points: pts, startedAt: rec.startedAt },
  };
  await saveRoute(saved);
  await useStore.getState().refreshSaved();
  return saved;
}

/** Offer to resume a ride that was interrupted (app killed / reloaded). */
export async function restoreRide(): Promise<boolean> {
  const snap = await kvGet<{ rec: ReturnType<Recorder['snapshot']>; route: Route | null }>(ACTIVE_KEY).catch(() => undefined);
  if (!snap || !snap.rec?.segments?.flat().length) return false;
  const st = useStore.getState();
  recorder = Recorder.restore(snap.rec, { autoPause: st.settings.autoPause });
  engine = snap.route
    ? new NavigationEngine(snap.route, { climbAnnouncements: st.settings.climbAnnouncements })
    : null;
  baseRoute = snap.route;
  muted = !st.settings.voice;
  attachLive();
  push({ nav: null });
  return true;
}

export const currentFix = () => lastFix;
