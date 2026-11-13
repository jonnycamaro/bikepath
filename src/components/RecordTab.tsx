import { formatDistance, haversine } from '../lib/geo';
import { startFreeRide } from '../session';
import { useStore } from '../store';
import { IconBike, IconNavigate } from './icons';

export default function RecordTab() {
  const fix = useStore((s) => s.fix);
  const locErr = useStore((s) => s.locationError);
  const route = useStore((s) => s.route);
  const saved = useStore((s) => s.saved);
  const setTab = useStore((s) => s.setTab);
  const planned = saved.filter((r) => r.kind !== 'recorded').slice(0, 5);

  return (
    <div className="sheet" data-testid="record-tab">
      <div className="grab" />
      <div className="body">
        <h2>Aufzeichnen & Navigieren</h2>
        <div className="row small" style={{ marginBottom: 6 }}>
          <span className="status-pill" style={{ background: fix ? '#e6f6ec' : '#fff4e0', color: fix ? 'var(--green)' : '#9a5b00' }}>
            {fix ? `GPS bereit · ±${Math.round(fix.accuracy)} m` : locErr ?? 'Suche GPS-Signal …'}
          </span>
        </div>
        <button className="big-start" onClick={startFreeRide} data-testid="start-free">
          <div className="center"><IconBike size={40} /><div>Start</div></div>
        </button>
        <p className="center muted small">Freie Fahrt aufzeichnen – Distanz, Zeit, Geschwindigkeit und Höhenmeter.</p>

        {route && (
          <>
            <h3>Geplante Route</h3>
            <button className="card" onClick={() => useStore.getState().requestNavigation(route)}>
              <div className="icon-btn" style={{ background: 'var(--primary)', color: '#fff' }}><IconNavigate size={20} /></div>
              <div className="grow">
                <div className="title">Aktuelle Planung navigieren</div>
                <div className="meta">{formatDistance(route.distance)} · ↑ {route.ascent} m</div>
              </div>
            </button>
          </>
        )}
        <h3>Gespeicherte Route navigieren</h3>
        {planned.length === 0 && (
          <div className="muted small">Noch keine gespeicherten Routen. <button className="btn ghost sm" onClick={() => setTab('plan')}>Route planen</button></div>
        )}
        {planned.map((r) => (
          <button key={r.id} className="card" onClick={() => useStore.getState().requestNavigation(r.route)}>
            <div className="icon-btn"><IconNavigate size={20} /></div>
            <div className="grow">
              <div className="title">{r.name}</div>
              <div className="meta">
                {formatDistance(r.route.distance)} · ↑ {r.route.ascent} m
                {fix && <span>· {formatDistance(haversine(fix.lngLat, r.route.coords[0]))} entfernt</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
