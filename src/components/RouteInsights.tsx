import { formatDistance } from '../lib/geo';
import { GRADE_COLORS, grades } from '../lib/routeStyle';
import { SURFACE_META, WAYTYPE_META, type Route } from '../lib/routing';
import { useStore } from '../store';

export default function RouteInsights({ route }: { route: Route }) {
  const mode = useStore((s) => s.settings.routeColorMode);
  const setSettings = useStore((s) => s.setSettings);
  const hasTags = route.surfaces.some((s) => s.key !== 'unknown');

  let rows: { key: string; label: string; color: string; distance: number }[] = [];
  if (mode === 'surface' || mode === 'solid') {
    rows = route.surfaces.map((s) => ({ key: s.key, distance: s.distance, ...SURFACE_META[s.key] }));
  } else if (mode === 'waytype') {
    rows = route.wayTypes.map((s) => ({ key: s.key, distance: s.distance, ...WAYTYPE_META[s.key] }));
  } else {
    const g = grades(route);
    const sums = GRADE_COLORS.map(() => 0);
    for (let i = 1; i < route.coords.length; i++) {
      const k = GRADE_COLORS.findIndex((c) => Math.abs(g[i]) < c.max);
      sums[k < 0 ? 3 : k] += route.cum[i] - route.cum[i - 1];
    }
    rows = GRADE_COLORS.map((c, i) => ({ key: c.label, label: c.label, color: c.color, distance: sums[i] })).filter((r) => r.distance > 0);
  }
  const total = rows.reduce((a, r) => a + r.distance, 0) || 1;

  // while the elevation profile is touched: the category at that spot is shown in bold
  const at = useStore((s) => s.chartHover);
  let current: string | null = null;
  if (at != null) {
    let i = route.cum.findIndex((c) => c >= at);
    if (i < 0) i = route.coords.length - 1;
    if (mode === 'surface' || mode === 'solid') current = route.pointSurface[i] ?? null;
    else if (mode === 'waytype') current = route.pointWayType[i] ?? null;
    else {
      const g = Math.abs(grades(route)[i] ?? 0);
      const k = GRADE_COLORS.findIndex((c) => g < c.max);
      current = GRADE_COLORS[k < 0 ? 3 : k].label;
    }
  }

  return (
    <div data-testid="insights">
      <div className="segmented">
        <button className={mode === 'solid' ? 'active' : ''} onClick={() => setSettings({ routeColorMode: 'solid' })}>Route</button>
        <button className={mode === 'surface' ? 'active' : ''} onClick={() => setSettings({ routeColorMode: 'surface' })} disabled={!hasTags}>Untergrund</button>
        <button className={mode === 'waytype' ? 'active' : ''} onClick={() => setSettings({ routeColorMode: 'waytype' })} disabled={!hasTags}>Wegtyp</button>
        <button className={mode === 'gradient' ? 'active' : ''} onClick={() => setSettings({ routeColorMode: 'gradient' })}>Steigung</button>
      </div>
      {!hasTags && mode !== 'gradient' ? (
        <div className="muted small">Für importierte oder aufgezeichnete Strecken sind keine Weginformationen verfügbar.</div>
      ) : (
        <>
          <div className="bar">
            {rows.map((r) => (
              <div key={r.key} style={{ width: `${(r.distance / total) * 100}%`, background: r.color }} />
            ))}
          </div>
          <div className="legend">
            {rows.map((r) => (
              <div key={r.key} className={r.key === current ? 'current' : ''} data-testid={r.key === current ? 'legend-current' : undefined}>
                <span className="sw" style={{ background: r.color }} />
                {r.label} <span className="muted">{formatDistance(r.distance)} · {Math.round((r.distance / total) * 100)} %</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
