import { useEffect, useRef, useState } from 'react';
import { reverseGeocode } from '../lib/geocode';
import { bikeById, rideSpeed } from '../lib/bike';
import { bearing, formatDistance, formatDuration } from '../lib/geo';
import { downloadFile, safeFilename, toGPX } from '../lib/gpx';
import { fetchWeather, headwindShare, weatherLabel, type Weather } from '../lib/weather';

import { bboxOf, useStore } from '../store';
import ElevationChart from './ElevationChart';
import { IconLocate, IconClose, IconDown, IconDownload, IconLoop, IconNavigate, IconPen, IconRedo, IconSave, IconSwap, IconTrash, IconUndo, IconUp, IconWind } from './icons';
import PlanModeChoice from './PlanModeChoice';
import RouteInsights from './RouteInsights';
import SearchBox from './SearchBox';
import { compassName } from '../lib/roundtrip';
import { BikeSelector } from './BikeSheet';
import { DirBadge } from './RoundTripSheet';
import { ProfileSelector } from './Sheets';

export default function PlannerSheet() {
  const s = useStore();
  const { waypoints, route, routing, routeError, profileId, settings, loop, loopProblem } = s;
  const [size, setSize] = useState<'collapsed' | 'half' | 'full'>('half');
  const collapsed = size === 'collapsed';
  const [weather, setWeather] = useState<Weather | null>(null);
  const named = useRef(new Set<string>());
  const sheetRef = useRef<HTMLDivElement>(null);

  // name waypoints by reverse geocoding
  useEffect(() => {
    for (const w of waypoints) {
      if (w.name || named.current.has(w.id)) continue;
      named.current.add(w.id);
      reverseGeocode(w.lngLat).then((n) => n && useStore.getState().renameWaypoint(w.id, n));
    }
  }, [waypoints]);

  // A trip starts at the GPS position when there is one – once per chosen trip, so a
  // start the user removed stays removed. Clearing the plan asks for the kind again.
  const choosing = waypoints.length === 0 && !loop && s.planKind !== 'trip';
  const autoStart = useRef(false);
  useEffect(() => {
    if (s.planKind == null) autoStart.current = false;
    if (waypoints.length && !loop && s.planKind !== 'trip') useStore.setState({ planKind: 'trip' });
    if (autoStart.current || s.planKind !== 'trip' || s.editingId) return;
    if (waypoints.length) {
      autoStart.current = true;
      return;
    }
    if (!s.fix) return;
    autoStart.current = true;
    s.addWaypoint(s.fix.lngLat, 'Mein Standort');
  }, [s.fix, waypoints.length, loop, s.planKind]);

  // fit map when a new route arrives for the first time
  const fitted = useRef<string>('');
  useEffect(() => {
    if (!route) {
      fitted.current = '';
      return;
    }
    const key = route.waypoints.map((w) => w.id).join();
    if (fitted.current === '' && waypoints.length >= 2 && !loop) s.focusMap({ bbox: bboxOf(route) });
    fitted.current = key;
  }, [route]);

  useEffect(() => {
    if (!route) return;
    const ctrl = new AbortController();
    fetchWeather([route.coords[0][0], route.coords[0][1]], ctrl.signal).then(setWeather).catch(() => {});
    return () => ctrl.abort();
  }, [route?.coords[0]?.[0], route?.coords[0]?.[1]]);

  // expose sheet height so map controls sit above it
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--sheet-h', '0px');
    };
  }, []);

  const speed = rideSpeed(settings, profileId);
  // round trip: what was asked for and how far the result is from it
  const loopGoal = loop ? (loop.duration ? formatDuration(loop.duration) : `${Math.round(loop.distance / 1000)} km`) : '';
  const loopOff = loop && route ? (loop.duration ? Math.abs(route.duration - loop.duration) / loop.duration : Math.abs(route.distance - loop.distance) / loop.distance) : 0;
  /** apply what the round trip says would solve its problem */
  const fixLoop = () => {
    const fix = loopProblem?.fix;
    if (!loop || !fix) return;
    if (fix.direction != null) s.setLoop({ ...loop, direction: fix.direction });
    else if (loop.duration && fix.duration) {
      const min = Math.ceil((fix.duration * 1.03) / 300) * 5;
      s.setLoop({ ...loop, duration: min * 60, distance: (min * 60 * speed) / 3.6 });
    } else if (fix.distance) s.setLoop({ ...loop, duration: undefined, distance: Math.ceil((fix.distance * 1.03) / 5000) * 5000 });
  };
  const fixLabel = !loopProblem
    ? ''
    : loopProblem.fix.direction != null
      ? `Nach ${compassName(loopProblem.fix.direction)} ausrichten`
      : loop?.duration && loopProblem.fix.duration
        ? `Auf ${formatDuration(Math.ceil((loopProblem.fix.duration * 1.03) / 300) * 300)} verlängern`
        : `Auf ${Math.ceil(((loopProblem.fix.distance ?? 0) * 1.03) / 5000) * 5} km verlängern`;
  const useMyLocation = () => {
    if (!s.fix) {
      s.toastMsg('Noch kein GPS-Standort');
      return;
    }
    s.addWaypoint(s.fix.lngLat, 'Mein Standort', 0);
    s.focusMap({ center: s.fix.lngLat, zoom: 14 });
  };

  const wind =
    weather && route
      ? headwindShare(
          route.coords.slice(1).map((c, i) => ({ bearing: bearing(route.coords[i], c), len: route.cum[i + 1] - route.cum[i] })),
          weather.windDirection,
        )
      : null;

  return (
    <div ref={sheetRef} className={`sheet ${size}`} data-testid="planner">
      <button
        className="grab"
        onClick={() => setSize(size === 'half' ? 'full' : size === 'full' ? 'collapsed' : 'half')}
        aria-label={size === 'full' ? 'Einklappen' : 'Ausklappen'}
      />
      <div className="body">
        <div className="row" style={{ marginBottom: 10 }}>
          <h2 className="grow" style={{ margin: 0 }}>{s.editingId ? s.planName || 'Route bearbeiten' : 'Route planen'}</h2>
          <button className="icon-btn" onClick={s.undoPlan} disabled={!s.undo.length} aria-label="Rückgängig"><IconUndo size={20} /></button>
          <button className="icon-btn" onClick={s.redoPlan} disabled={!s.redo.length} aria-label="Wiederholen"><IconRedo size={20} /></button>
          <button className="icon-btn" onClick={s.reverse} disabled={!loop && waypoints.length < 2} aria-label="Richtung umkehren"><IconSwap size={20} /></button>
          <button className="icon-btn" onClick={s.clearPlan} disabled={!waypoints.length} aria-label="Route löschen"><IconTrash size={20} /></button>
        </div>

        {route && !collapsed && (
          <div className="stats" data-testid="route-stats">
            <div className="stat"><div className="v">{formatDistance(route.distance)}</div><div className="l">Distanz</div></div>
            <div className="stat"><div className="v">{formatDuration(route.duration)}</div><div className="l">Dauer</div></div>
            <div className="stat"><div className="v">{route.ascent} m</div><div className="l">Aufstieg</div></div>
            <div className="stat"><div className="v">{route.descent} m</div><div className="l">Abstieg</div></div>
          </div>
        )}
        {route && collapsed && (
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <b>{formatDistance(route.distance)} · {formatDuration(route.duration)} · ↑{route.ascent} m</b>
            <button className="btn primary sm" onClick={() => useStore.getState().requestNavigation(route)}><IconNavigate size={16} /> Los</button>
          </div>
        )}

        {choosing && (
          <>
            <div className="muted" style={{ marginBottom: 12 }}>Was möchtest du planen?</div>
            <PlanModeChoice onPick={s.startPlan} />
          </>
        )}

        {waypoints.length === 0 && !choosing && (
          <>
            <div className="hint">Tippe auf die Karte, um den Start zu setzen – oder suche einen Ort.</div>
            <div className="spacer" />
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <SearchBox placeholder="Start suchen" poiTitle="Start wählen" onSelect={(p) => { s.addWaypoint(p.lngLat, p.name); s.focusMap({ center: p.lngLat, zoom: 14 }); }} />
              </div>
              <button className="icon-btn pick-on-map" onClick={useMyLocation} aria-label="Mein Standort als Start" title="Mein Standort als Start" data-testid="start-here">
                <IconLocate size={22} />
              </button>
            </div>
            <div className="spacer" />
            <button className="btn ghost block" onClick={() => useStore.setState({ planKind: null })} data-testid="plan-kind-back">Andere Art wählen</button>
          </>
        )}

        {waypoints.length > 0 && (
          <div className="wps" data-testid="waypoints">
            {waypoints.map((w, i) => {
              const kind = i === 0 ? 'start' : i === waypoints.length - 1 && !loop ? 'end' : 'via';
              const color = kind === 'start' ? 'var(--green)' : kind === 'end' ? 'var(--red)' : 'var(--primary)';
              return (
                <div key={w.id}>
                  <div className="wp">
                    <div className="dot" style={{ background: color }}>{kind === 'start' ? 'A' : kind === 'end' ? 'B' : i}</div>
                    <div className="name">{w.name ?? `${w.lngLat[1].toFixed(5)}, ${w.lngLat[0].toFixed(5)}`}</div>
                    {!loop && i > 0 && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => { const n = [...waypoints]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; s.setWaypoints(n); }} aria-label="Nach oben"><IconUp size={16} /></button>}
                    {!loop && i < waypoints.length - 1 && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => { const n = [...waypoints]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; s.setWaypoints(n); }} aria-label="Nach unten"><IconDown size={16} /></button>}
                    <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => s.removeWaypoint(w.id)} aria-label="Punkt entfernen"><IconClose size={16} /></button>
                  </div>
                  {!loop && i < waypoints.length - 1 && (
                    <button
                      className="small"
                      style={{ marginLeft: 16, padding: '4px 8px', color: s.freehand.includes(i) ? 'var(--orange)' : 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}
                      onClick={() => s.toggleFreehandLeg(i)}
                      title="Abschnitt als gerade Linie zeichnen"
                    >
                      <IconPen size={14} /> {s.freehand.includes(i) ? 'Freihand-Abschnitt' : 'Abschnitt routen'}
                    </button>
                  )}
                </div>
              );
            })}
            {loop ? (
              <>
                <button className="profile-select" onClick={() => s.setSheet('roundtrip')} data-testid="loop-card">
                  <DirBadge dir={loop.direction} size={30} />
                  <span className="grow">
                    <span className="title">Rundtour · {loopGoal}</span>
                    <span className="meta">Richtung {compassName(loop.direction)} · antippen zum Ändern</span>
                  </span>
                  <IconDown size={18} className="chev" />
                </button>
                <div className="row">
                  <button className="btn sm grow" onClick={() => s.setLoop({ ...loop, variant: loop.variant + 1 })} data-testid="loop-variant"><IconLoop size={16} /> Andere Variante</button>
                  <button className="btn sm grow" onClick={s.editLoopByHand} disabled={!route || routing}><IconPen size={16} /> Von Hand anpassen</button>
                </div>
                <SearchBox placeholder="Zwischenstopp hinzufügen" poiTitle="Zwischenstopp wählen" onSelect={(p) => s.addWaypoint(p.lngLat, p.name)} />
                {waypoints.length === 1 && <div className="muted small" style={{ marginTop: 6 }}>Oder auf die Karte tippen – die Rundtour führt dann dort vorbei.</div>}
                {loopProblem && !routing && (
                  <div className="problem" role="alert" data-testid="loop-problem">
                    <b>{loopProblem.kind === 'direction' ? 'Der Zwischenstopp liegt in der anderen Richtung' : 'Die Zwischenstopps passen nicht in die Rundtour'}</b>
                    <p>{loopProblem.message}</p>
                    <div className="row wrap">
                      <button className="btn sm primary" onClick={fixLoop} data-testid="loop-fix">{fixLabel}</button>
                      <button className="btn sm" onClick={() => s.setSheet('roundtrip')}>Selbst anpassen</button>
                    </div>
                  </div>
                )}
                {route && !routing && loopOff > 0.12 && (
                  <div className="muted small" style={{ marginTop: 6 }}>Von hier aus passt keine Tour genauer auf {loopGoal} – eine andere Variante oder Richtung kann helfen.</div>
                )}
              </>
            ) : (
              <>
                {waypoints.length === 1 && <div className="hint">Tippe auf die Karte, um das Ziel zu setzen.</div>}
                <SearchBox placeholder={waypoints.length === 1 ? 'Ziel suchen' : 'Weiteren Punkt hinzufügen'} poiTitle={waypoints.length === 1 ? 'Ziel wählen' : 'Weiteren Punkt wählen'} onSelect={(p) => s.addWaypoint(p.lngLat, p.name)} />
              </>
            )}
          </div>
        )}

        {!choosing && (
          <>
            <h3>Routenoption</h3>
            <ProfileSelector />
          </>
        )}

        {routing && <div className="muted small" style={{ marginTop: 8 }}>{loop ? 'Rundtour wird gesucht …' : 'Route wird berechnet …'}</div>}
        {routeError && <div className="err">{routeError}</div>}

        {route && (
          <>
            <h3>Höhenprofil</h3>
            <ElevationChart route={route} />
            <h3>Route Insights</h3>
            <RouteInsights route={route} />

            <h3>Tempo</h3>
            <BikeSelector
              onOpen={() => s.setSheet('bike')}
              note={speed === bikeById(settings.bikeType).speedKmh && settings.bikeSpeed == null ? 'Fahrzeit mit dem Tempo aus deinem Profil' : `Fahrzeit mit ${String(speed).replace('.', ',')} km/h bei dieser Routenoption`}
            />

            {weather && (
              <div className="panel" style={{ background: 'var(--bg-soft)', marginTop: 12 }}>
                <div className="row">
                  <b className="grow">Wetter am Start: {Math.round(weather.temperature)}° · {weatherLabel(weather.code)}</b>
                  <span className="small muted">Regen {weather.precipitationProbability}%</span>
                </div>
                {wind && (
                  <div className="row small" style={{ marginTop: 6 }}>
                    <IconWind size={16} /> {Math.round(weather.windSpeed)} km/h ·
                    <span style={{ color: 'var(--red)' }}>Gegenwind {Math.round(wind.head * 100)}%</span> ·
                    <span style={{ color: 'var(--green)' }}>Rückenwind {Math.round(wind.tail * 100)}%</span>
                  </div>
                )}
                <div className="small muted" style={{ marginTop: 6 }}>
                  Wetterdaten: <a href="https://open-meteo.com" target="_blank" rel="noopener noreferrer">Open-Meteo.com</a> (CC BY 4.0)
                </div>
              </div>
            )}

            <div className="spacer" />
            <button className="btn primary block" onClick={() => useStore.getState().requestNavigation(route)} data-testid="start-nav">
              <IconNavigate size={18} /> Navigation starten
            </button>
            <div className="spacer" />
            <div className="row">
              <button className="btn grow" onClick={() => s.setSheet('save')}><IconSave size={18} /> Speichern</button>
              <button className="btn grow" onClick={() => downloadFile(`${safeFilename(s.planName || 'Bikepath-Route')}.gpx`, toGPX(s.planName || 'Bikepath Route', route.coords, undefined, route.waypoints), 'application/gpx+xml')}>
                <IconDownload size={18} /> GPX
              </button>
              <button className="btn" onClick={() => s.setSheet('roundtrip')} aria-label="Rundtour"><IconLoop size={18} /></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
