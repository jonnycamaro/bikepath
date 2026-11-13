import { useMemo, useRef, useState } from 'react';
import { formatClock, formatDistance, formatDuration, formatSpeed } from '../lib/geo';
import { parseTrackFile, rideToGPX, safeFilename, shareOrDownload, simplifyByDistance, toGPX, toKML } from '../lib/gpx';
import { routeFromTrack } from '../lib/routing';
import { deleteRoute, saveRoute, uid, type SavedRoute } from '../lib/storage';

import { useStore } from '../store';
import ElevationChart from './ElevationChart';
import { IconClose, IconDownload, IconEdit, IconFolder, IconNavigate, IconPlus, IconRoutes, IconShare, IconStar, IconTrash, IconUpload } from './icons';
import RouteInsights from './RouteInsights';

export function Thumb({ r, size = 72 }: { r: SavedRoute; size?: number }) {
  const path = useMemo(() => {
    const c = r.route.coords;
    const step = Math.max(1, Math.floor(c.length / 120));
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of c) { w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]); }
    const kx = Math.cos(((s + n) / 2) * Math.PI / 180);
    const sx = (e - w) * kx || 1e-6;
    const sy = n - s || 1e-6;
    const sc = (size - 12) / Math.max(sx, sy);
    const ox = (size - sx * sc) / 2;
    const oy = (size - sy * sc) / 2;
    const pts = [];
    for (let i = 0; i < c.length; i += step) pts.push(`${(ox + (c[i][0] - w) * kx * sc).toFixed(1)},${(oy + (n - c[i][1]) * sc).toFixed(1)}`);
    pts.push(`${(ox + (c[c.length - 1][0] - w) * kx * sc).toFixed(1)},${(oy + (n - c[c.length - 1][1]) * sc).toFixed(1)}`);
    return pts.join(' ');
  }, [r.route, size]);
  const color = r.kind === 'recorded' ? '#e5383b' : r.kind === 'imported' ? '#7c3aed' : '#0b6bd6';
  return (
    <svg className="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <rect width={size} height={size} fill="#eef3f8" rx={12} />
      <polyline points={path} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

type Filter = 'planned' | 'recorded' | 'favorites' | 'collections';

export default function RoutesScreen() {
  const saved = useStore((s) => s.saved);
  const collections = useStore((s) => s.collections);
  const detailId = useStore((s) => s.detailId);
  const setDetail = useStore((s) => s.setDetail);
  const setCollections = useStore((s) => s.setCollections);
  const refresh = useStore((s) => s.refreshSaved);
  const toast = useStore((s) => s.toastMsg);
  const [filter, setFilter] = useState<Filter>('planned');
  const [openCollection, setOpenCollection] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const detail = saved.find((r) => r.id === detailId);
  if (detail) return <RouteDetail r={detail} onClose={() => setDetail(null)} />;

  const list = saved.filter((r) => {
    if (openCollection) return r.collectionIds.includes(openCollection);
    if (filter === 'planned') return r.kind !== 'recorded';
    if (filter === 'recorded') return r.kind === 'recorded';
    if (filter === 'favorites') return r.favorite;
    return false;
  });

  const onImport = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const t = parseTrackFile(await f.text(), f.name.replace(/\.(gpx|kml)$/i, ''));
        const coords = simplifyByDistance(t.coords, 3);
        const route = routeFromTrack(coords);
        const s: SavedRoute = { id: uid(), name: t.name, kind: 'imported', createdAt: Date.now(), updatedAt: Date.now(), route, favorite: false, collectionIds: [] };
        await saveRoute(s);
        toast(`„${t.name}“ importiert`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    await refresh();
    setFilter('planned');
  };

  return (
    <div className="page" data-testid="routes-screen">
      <div className="row">
        <h1 className="grow">Meine Routen</h1>
        <button className="btn sm" onClick={() => file.current?.click()} data-testid="import-btn"><IconUpload size={16} /> GPX/KML</button>
        <input ref={file} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml" multiple hidden onChange={(e) => { onImport(e.target.files); e.target.value = ''; }} data-testid="import-input" />
      </div>
      {openCollection ? (
        <div className="row" style={{ marginBottom: 12 }}>
          <button className="btn sm" onClick={() => setOpenCollection(null)}>‹ Zurück</button>
          <b className="grow">{collections.find((c) => c.id === openCollection)?.name}</b>
        </div>
      ) : (
        <div className="segmented">
          {(['planned', 'recorded', 'favorites', 'collections'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {{ planned: 'Geplant', recorded: 'Gefahren', favorites: 'Favoriten', collections: 'Sammlungen' }[f]}
            </button>
          ))}
        </div>
      )}

      {filter === 'collections' && !openCollection && (
        <>
          <button
            className="card"
            onClick={() => {
              const name = prompt('Name der Sammlung');
              if (name?.trim()) setCollections([...collections, { id: uid(), name: name.trim(), createdAt: Date.now() }]);
            }}
          >
            <div className="icon-btn"><IconPlus size={20} /></div>
            <div className="title">Neue Sammlung</div>
          </button>
          {collections.map((c) => (
            <button className="card" key={c.id} onClick={() => setOpenCollection(c.id)}>
              <div className="icon-btn"><IconFolder size={20} /></div>
              <div className="grow">
                <div className="title">{c.name}</div>
                <div className="meta">{saved.filter((r) => r.collectionIds.includes(c.id)).length} Routen</div>
              </div>
            </button>
          ))}
        </>
      )}

      {(filter !== 'collections' || openCollection) && list.length === 0 && (
        <div className="empty">
          <IconRoutes size={48} />
          <div>{filter === 'recorded' ? 'Noch keine Fahrten aufgezeichnet.' : filter === 'favorites' ? 'Markiere Routen mit dem Stern als Favorit.' : 'Noch keine Routen gespeichert. Plane eine Route oder importiere eine GPX-Datei.'}</div>
        </div>
      )}
      {(filter !== 'collections' || openCollection) &&
        list.map((r) => (
          <button className="card" key={r.id} onClick={() => setDetail(r.id)} data-testid="route-card">
            <Thumb r={r} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="title">{r.favorite ? '★ ' : ''}{r.name}</div>
              <div className="meta">
                <span>{formatDistance(r.route.distance)}</span>
                <span>↑ {r.route.ascent} m</span>
                <span>{r.ride ? formatClock(r.ride.stats.movingTime) : formatDuration(r.route.duration)}</span>
              </div>
              <div className="meta">{new Date(r.createdAt).toLocaleDateString('de-DE')} · {r.kind === 'recorded' ? 'Aufgezeichnet' : r.kind === 'imported' ? 'Importiert' : 'Geplant'}</div>
            </div>
          </button>
        ))}
    </div>
  );
}

function RouteDetail({ r, onClose }: { r: SavedRoute; onClose: () => void }) {
  const refresh = useStore((s) => s.refreshSaved);
  const collections = useStore((s) => s.collections);
  const loadIntoPlanner = useStore((s) => s.loadIntoPlanner);
  const toast = useStore((s) => s.toastMsg);
  const [pickCollection, setPickCollection] = useState(false);
  const update = async (p: Partial<SavedRoute>) => {
    await saveRoute({ ...r, ...p });
    await refresh();
  };
  const fn = safeFilename(r.name);
  const st = r.ride?.stats;

  return (
    <div className="sheet half" data-testid="route-detail">
      <div className="grab" />
      <div className="body">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>{r.name}</h2>
          <button className="icon-btn" onClick={() => update({ favorite: !r.favorite })} aria-label="Favorit" style={{ color: r.favorite ? 'var(--orange)' : undefined }}>
            <IconStar filled={r.favorite} size={20} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><IconClose size={20} /></button>
        </div>
        <div className="muted small" style={{ margin: '4px 0 8px' }}>
          {new Date(r.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} · {r.kind === 'recorded' ? 'Aufgezeichnete Fahrt' : r.kind === 'imported' ? 'Importierter Track' : 'Geplante Route'}
        </div>
        <div className="stats">
          {/* a recorded ride reports its own filtered distance; r.route.distance is the raw
              track and counts GPS jumps, which would disagree with the other ride stats */}
          <div className="stat"><div className="v">{formatDistance(st ? st.distance : r.route.distance)}</div><div className="l">Distanz</div></div>
          <div className="stat"><div className="v">{st ? formatClock(st.movingTime) : formatDuration(r.route.duration)}</div><div className="l">{st ? 'Fahrzeit' : 'Dauer'}</div></div>
          <div className="stat"><div className="v">{st?.ascent ?? r.route.ascent} m</div><div className="l">Aufstieg</div></div>
          <div className="stat"><div className="v">{st ? formatSpeed(st.avgSpeed) : `${r.route.descent} m`}</div><div className="l">{st ? 'Ø km/h' : 'Abstieg'}</div></div>
        </div>
        {st && (
          <div className="stats">
            <div className="stat"><div className="v">{formatSpeed(st.maxSpeed)}</div><div className="l">Max km/h</div></div>
            <div className="stat"><div className="v">{formatClock(st.elapsed)}</div><div className="l">Gesamtzeit</div></div>
            <div className="stat"><div className="v">{st.descent} m</div><div className="l">Abstieg</div></div>
            <div className="stat"><div className="v">{Math.round(st.distance / 1000 * 25)}</div><div className="l">kcal ≈</div></div>
          </div>
        )}
        <button className="btn primary block" onClick={() => useStore.getState().requestNavigation(r.route)} data-testid="detail-nav"><IconNavigate size={18} /> Navigieren</button>
        <div className="spacer" />
        <div className="row wrap">
          <button className="btn sm grow" onClick={() => loadIntoPlanner(r)}><IconEdit size={16} /> Bearbeiten</button>
          <button className="btn sm grow" onClick={() => shareOrDownload(`${fn}.gpx`, r.ride ? rideToGPX(r.name, r.ride.points) : toGPX(r.name, r.route.coords, undefined, r.kind === 'planned' ? r.route.waypoints : []), 'application/gpx+xml')}><IconShare size={16} /> GPX</button>
          <button className="btn sm grow" onClick={() => shareOrDownload(`${fn}.kml`, toKML(r.name, r.route.coords), 'application/vnd.google-earth.kml+xml')}><IconDownload size={16} /> KML</button>
          <button className="btn sm grow" onClick={() => setPickCollection(!pickCollection)}><IconFolder size={16} /> Sammlung</button>
        </div>
        {pickCollection && (
          <div className="panel" style={{ background: 'var(--bg-soft)', marginTop: 10 }}>
            {collections.length === 0 && <div className="muted small">Lege zuerst unter „Sammlungen“ eine Sammlung an.</div>}
            {collections.map((c) => {
              const on = r.collectionIds.includes(c.id);
              return (
                <div className="setting" key={c.id}>
                  <div className="lbl">{c.name}</div>
                  <button className={`switch ${on ? 'on' : ''}`} onClick={() => update({ collectionIds: on ? r.collectionIds.filter((x) => x !== c.id) : [...r.collectionIds, c.id] })} aria-label={c.name} />
                </div>
              );
            })}
          </div>
        )}
        <h3>Höhenprofil</h3>
        <ElevationChart route={r.route} />
        <h3>Route Insights</h3>
        <RouteInsights route={r.route} />
        <div className="spacer" />
        <div className="row">
          <button className="btn sm grow" onClick={() => { const n = prompt('Neuer Name', r.name); if (n?.trim()) update({ name: n.trim() }); }}>Umbenennen</button>
          <button
            className="btn sm grow"
            style={{ color: 'var(--red)' }}
            onClick={async () => {
              if (!confirm(`„${r.name}“ wirklich löschen?`)) return;
              await deleteRoute(r.id);
              await refresh();
              onClose();
              toast('Route gelöscht');
            }}
          >
            <IconTrash size={16} /> Löschen
          </button>
        </div>
      </div>
    </div>
  );
}
