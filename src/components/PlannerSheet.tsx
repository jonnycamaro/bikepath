import { useEffect, useRef, useState } from 'react';
import { reverseGeocode } from '../lib/geocode';
import { bearing, formatDistance, formatDuration } from '../lib/geo';
import { downloadFile, safeFilename, toGPX } from '../lib/gpx';
import { PROFILES, profileById } from '../lib/routing';
import { fetchWeather, headwindShare, weatherLabel, type Weather } from '../lib/weather';

import { bboxOf, useStore } from '../store';
import ElevationChart from './ElevationChart';
import { IconHome, IconWork, IconClose, IconDown, IconDownload, IconLoop, IconNavigate, IconPen, IconRedo, IconSave, IconSwap, IconTrash, IconUndo, IconUp, IconWind } from './icons';
import RouteInsights from './RouteInsights';
import SearchBox from './SearchBox';

export default function PlannerSheet() {
  const s = useStore();
  const { waypoints, route, routing, routeError, profileId, settings } = s;
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

  // fit map when a new route arrives for the first time
  const fitted = useRef<string>('');
  useEffect(() => {
    if (!route) {
      fitted.current = '';
      return;
    }
    const key = route.waypoints.map((w) => w.id).join();
    if (fitted.current === '' && waypoints.length >= 2) s.focusMap({ bbox: bboxOf(route) });
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

  const speed = settings.speedKmh[profileId] ?? profileById(profileId).speedKmh;
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
          <button className="icon-btn" onClick={s.reverse} disabled={waypoints.length < 2} aria-label="Richtung umkehren"><IconSwap size={20} /></button>
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

        {waypoints.length === 0 && (
          <>
            <div className="hint">Tippe auf die Karte, um Start und Ziel zu setzen – oder suche einen Ort.</div>
            <div className="spacer" />
            <SearchBox placeholder="Start suchen" showMyLocation onSelect={(p) => { s.addWaypoint(p.lngLat, p.name); s.focusMap({ center: p.lngLat, zoom: 14 }); }} />
            <div className="spacer" />
            <div className="row">
              <button className="btn grow" onClick={useMyLocation}>Von meinem Standort</button>
              <button className="btn grow" onClick={() => s.setSheet('roundtrip')}><IconLoop size={18} /> Rundtour</button>
            </div>
            <div className="spacer" />
            <div className="row wrap">
              {(['home', 'work'] as const).map((k) => {
                const place = s.settings.places[k];
                const label = k === 'home' ? 'Zuhause' : 'Arbeit';
                return place ? (
                  <button key={k} className="btn sm grow" onClick={() => { s.addWaypoint(place.lngLat, label); s.focusMap({ center: place.lngLat, zoom: 14 }); }} data-testid={`place-${k}`}>
                    {k === 'home' ? <IconHome size={16} /> : <IconWork size={16} />} {label}
                  </button>
                ) : (
                  <button
                    key={k}
                    className="btn sm grow"
                    style={{ opacity: 0.75 }}
                    onClick={() => {
                      const w = s.waypoints[0]?.lngLat ?? s.fix?.lngLat;
                      if (!w) {
                        s.toastMsg(`Setze zuerst einen Punkt, um ${label} zu speichern`);
                        return;
                      }
                      s.setSettings({ places: { ...s.settings.places, [k]: { lngLat: w, name: label } } });
                      s.toastMsg(`${label} gespeichert`);
                    }}
                  >
                    {k === 'home' ? <IconHome size={16} /> : <IconWork size={16} />} {label} festlegen
                  </button>
                );
              })}
            </div>
          </>
        )}

        {waypoints.length > 0 && (
          <div className="wps" data-testid="waypoints">
            {waypoints.map((w, i) => {
              const kind = i === 0 ? 'start' : i === waypoints.length - 1 ? 'end' : 'via';
              const color = kind === 'start' ? 'var(--green)' : kind === 'end' ? 'var(--red)' : 'var(--primary)';
              return (
                <div key={w.id}>
                  <div className="wp">
                    <div className="dot" style={{ background: color }}>{kind === 'start' ? 'A' : kind === 'end' ? 'B' : i}</div>
                    <div className="name">{w.name ?? `${w.lngLat[1].toFixed(5)}, ${w.lngLat[0].toFixed(5)}`}</div>
                    {i > 0 && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => { const n = [...waypoints]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; s.setWaypoints(n); }} aria-label="Nach oben"><IconUp size={16} /></button>}
                    {i < waypoints.length - 1 && <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => { const n = [...waypoints]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; s.setWaypoints(n); }} aria-label="Nach unten"><IconDown size={16} /></button>}
                    <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => s.removeWaypoint(w.id)} aria-label="Punkt entfernen"><IconClose size={16} /></button>
                  </div>
                  {i < waypoints.length - 1 && (
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
            {waypoints.length === 1 && <div className="hint">Tippe auf die Karte, um das Ziel zu setzen.</div>}
            <SearchBox placeholder={waypoints.length === 1 ? 'Ziel suchen' : 'Weiteren Punkt hinzufügen'} onSelect={(p) => s.addWaypoint(p.lngLat, p.name)} />
          </div>
        )}

        <h3>Routing-Option</h3>
        <div className="chips" data-testid="profiles">
          {PROFILES.map((p) => (
            <button key={p.id} className={`chip ${p.id === profileId ? 'active' : ''}`} onClick={() => s.setProfile(p.id)} title={p.description}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="muted small">{profileById(profileId).description}</div>

        {routing && <div className="muted small" style={{ marginTop: 8 }}>Route wird berechnet …</div>}
        {routeError && <div className="err">{routeError}</div>}

        {route && (
          <>
            <h3>Höhenprofil</h3>
            <ElevationChart route={route} />
            <h3>Route Insights</h3>
            <RouteInsights route={route} />

            <h3>Geschwindigkeit: {speed} km/h</h3>
            <input type="range" min={8} max={35} value={speed} onChange={(e) => s.setSettings({ speedKmh: { ...settings.speedKmh, [profileId]: Number(e.target.value) } })} aria-label="Geschwindigkeit" />

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
