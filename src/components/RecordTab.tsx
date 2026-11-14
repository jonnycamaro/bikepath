import { formatDistance, haversine } from '../lib/geo';
import { startFreeRide } from '../session';
import { useStore } from '../store';
import { IconNavigate, IconRecord } from './icons';
import PlanModeChoice, { type PlanKind } from './PlanModeChoice';

// The centre tab is primarily about navigating a route; recording a free ride
// without a route is offered as the secondary option at the bottom.
export default function RecordTab() {
  const fix = useStore((s) => s.fix);
  const locErr = useStore((s) => s.locationError);
  const route = useStore((s) => s.route);
  const saved = useStore((s) => s.saved);
  const setTab = useStore((s) => s.setTab);
  const planned = saved.filter((r) => r.kind !== 'recorded').slice(0, 5);

  /** Start an empty plan of the chosen kind. The planner takes the GPS position as start by itself. */
  const newPlan = (kind: PlanKind) => {
    const s = useStore.getState();
    if (s.waypoints.length || s.loop) s.clearPlan(); // undoable in the planner
    s.startPlan(kind);
    setTab('plan');
  };

  return (
    <div className="sheet" data-testid="record-tab">
      <div className="grab" />
      <div className="body">
        <h2>Navigieren</h2>
        <div className="row small" style={{ marginBottom: 6 }}>
          <span className="status-pill" style={{ background: fix ? '#e6f6ec' : '#fff4e0', color: fix ? 'var(--green)' : '#9a5b00' }}>
            {fix ? `GPS bereit · ±${Math.round(fix.accuracy)} m` : locErr ?? 'Suche GPS-Signal …'}
          </span>
        </div>

        {route && (
          <>
            <h3>Geplante Route</h3>
            <button className="card" onClick={() => useStore.getState().requestNavigation(route)} data-testid="nav-current">
              <div className="icon-btn" style={{ background: 'var(--primary)', color: '#fff' }}><IconNavigate size={20} /></div>
              <div className="grow">
                <div className="title">Aktuelle Planung navigieren</div>
                <div className="meta">{formatDistance(route.distance)} · ↑ {route.ascent} m</div>
              </div>
            </button>
          </>
        )}

        <h3>Gespeicherte Route navigieren</h3>
        {planned.length === 0 && <div className="muted small">Noch keine gespeicherten Routen.</div>}
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
        <h3>Neue Route planen</h3>
        <PlanModeChoice onPick={newPlan} testid="nav-plan" />

        <h3>Ohne Route</h3>
        <button className="card" onClick={startFreeRide} data-testid="start-free">
          <div className="icon-btn" style={{ color: 'var(--red)' }}><IconRecord size={20} /></div>
          <div className="grow">
            <div className="title">Nur aufzeichnen</div>
            <div className="meta">Freie Fahrt – Distanz, Zeit, Geschwindigkeit und Höhenmeter</div>
          </div>
        </button>
      </div>
    </div>
  );
}
