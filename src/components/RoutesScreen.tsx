import { useEffect, useMemo, useRef, useState } from 'react';
import { formatClock, formatDistance, formatDuration, formatSpeed } from '../lib/geo';
import { parseTrackFile, rideToGPX, safeFilename, shareOrDownload, simplifyByDistance, toGPX, toKML } from '../lib/gpx';
import { routeFromTrack } from '../lib/routing';
import { deleteRegion, downloadRouteMaps, listRegions, type OfflineRegion } from '../lib/offline';
import { styleById } from '../lib/mapStyles';
import { deleteRoute, saveRoute, uid, type SavedPlace, type SavedRoute } from '../lib/storage';

import { useStore } from '../store';
import ElevationChart from './ElevationChart';
import { IconClose, IconDown, IconDownload, IconEdit, IconFolder, IconNavigate, IconOffline, IconOfflineReady, IconPlus, IconShare, IconStar, IconTrash, IconUp, IconUpload } from './icons';
import { FAV_LABEL, favKindOf, FavSymbol, GroupPicker } from './Favorites';
import { childGroups, groupPath, removeGroup, subtreeIds } from '../lib/groups';
import { Modal } from './Sheets';
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

type Filter = 'all' | 'routes' | 'places';
/** id used for "Ohne Gruppe" in the list */
const NO_GROUP = '';

/** Small modal to create or rename a favourite group. */
function GroupNameSheet({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  return (
    <Modal title={title} onClose={onClose} testid="group-sheet">
      <input className="input" value={name} autoFocus placeholder="Name der Gruppe" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())} data-testid="group-sheet-name" />
      <div className="spacer" />
      <button className="btn primary block" disabled={!name.trim()} onClick={() => onSave(name.trim())} data-testid="group-sheet-save">Speichern</button>
    </Modal>
  );
}

/**
 * Favourites: saved routes (planned / imported), recorded rides and places, sorted into
 * groups (folders). A filter at the top shows everything, only routes or only places.
 */
export default function RoutesScreen() {
  const saved = useStore((s) => s.saved);
  const places = useStore((s) => s.places);
  const collections = useStore((s) => s.collections);
  const detailId = useStore((s) => s.detailId);
  const setDetail = useStore((s) => s.setDetail);
  const setCollections = useStore((s) => s.setCollections);
  const setPlaces = useStore((s) => s.setPlaces);
  const refresh = useStore((s) => s.refreshSaved);
  const toast = useStore((s) => s.toastMsg);
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [groupSheet, setGroupSheet] = useState<null | { id?: string; parentId?: string; name: string }>(null);
  const file = useRef<HTMLInputElement>(null);

  const detail = saved.find((r) => r.id === detailId);
  if (detail) return <RouteDetail r={detail} onClose={() => setDetail(null)} />;

  const groupOfRoute = (r: SavedRoute) => (r.collectionIds[0] && collections.some((c) => c.id === r.collectionIds[0]) ? r.collectionIds[0] : NO_GROUP);
  const groupOfPlace = (p: SavedPlace) => (p.groupId && collections.some((c) => c.id === p.groupId) ? p.groupId : NO_GROUP);

  const onImport = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files)) {
      try {
        const t = parseTrackFile(await f.text(), f.name.replace(/\.(gpx|kml)$/i, ''));
        const coords = simplifyByDistance(t.coords, 3);
        const route = routeFromTrack(coords);
        const s: SavedRoute = { id: uid(), name: t.name, kind: 'imported', createdAt: Date.now(), updatedAt: Date.now(), route, favorite: true, collectionIds: [] };
        await saveRoute(s);
        toast(`„${t.name}“ importiert`);
      } catch (e) {
        toast(`${f.name}: ${(e as Error).message}`);
      }
    }
    await refresh();
  };

  const saveGroup = (name: string) => {
    if (groupSheet?.id) setCollections(collections.map((c) => (c.id === groupSheet.id ? { ...c, name } : c)));
    else setCollections([...collections, { id: uid(), name, createdAt: Date.now(), ...(groupSheet?.parentId ? { parentId: groupSheet.parentId } : {}) }]);
    setGroupSheet(null);
  };
  const deleteGroup = async (id: string, name: string) => {
    if (!confirm(`Gruppe „${name}“ löschen? Ihre Favoriten und Untergruppen wandern eine Ebene nach oben.`)) return;
    const { groups: rest, moveTo } = removeGroup(collections, id);
    setCollections(rest);
    setPlaces(places.map((p) => (p.groupId === id ? { ...p, groupId: moveTo } : p)));
    await Promise.all(saved.filter((r) => r.collectionIds[0] === id).map((r) => saveRoute({ ...r, collectionIds: moveTo ? [moveTo] : [] })));
    await refresh();
  };
  const openPlace = (p: SavedPlace) => {
    const s = useStore.getState();
    s.setTab('map');
    s.showPlace({ id: `fav-${p.id}`, name: p.name, detail: p.detail, lngLat: p.lngLat, kind: p.kind, osm: p.osm });
    s.focusMap({ center: p.lngLat, zoom: 16 });
  };

  const routesIn = (id: string) => saved.filter((r) => groupOfRoute(r) === id);
  const placesIn = (id: string) => places.filter((p) => groupOfPlace(p) === id);
  /** favourites in a group and all its sub-groups that pass the filter */
  const countBelow = (id: string) => {
    const ids = id === NO_GROUP ? new Set([NO_GROUP]) : subtreeIds(collections, id);
    return (filter !== 'places' ? saved.filter((r) => ids.has(groupOfRoute(r))).length : 0) + (filter !== 'routes' ? places.filter((p) => ids.has(groupOfPlace(p))).length : 0);
  };

  /** one folder: header, its favourites, then its sub-folders (indented) */
  const GroupNode = ({ group: g, depth }: { group: { id: string; name: string; createdAt: number }; depth: number }) => {
    const routes = filter !== 'places' ? routesIn(g.id) : [];
    const pls = filter !== 'routes' ? placesIn(g.id) : [];
    const below = countBelow(g.id);
    // empty folders only while showing everything (so a new one is visible); "Ohne Gruppe" only when used
    if (!below && (g.id === NO_GROUP || filter !== 'all')) return null;
    const open = !collapsed.has(g.id);
    const subs = g.id === NO_GROUP ? [] : childGroups(collections, g.id);
    return (
      <section className={`fav-group ${depth ? 'sub' : ''}`} data-testid="fav-group" data-depth={depth}>
        <div className="fav-group-head">
          <button className="grow fav-group-title" onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g.id)) n.delete(g.id); else n.add(g.id); return n; })} aria-expanded={open}>
            <IconFolder size={depth ? 18 : 20} />
            <span className="grow">{g.name}</span>
            <span className="muted small">{below}</span>
            {open ? <IconUp size={18} /> : <IconDown size={18} />}
          </button>
          {g.id !== NO_GROUP && (
            <>
              <button className="icon-btn" onClick={() => setGroupSheet({ parentId: g.id, name: '' })} aria-label={`Untergruppe in ${g.name} anlegen`} data-testid="fav-add-sub"><IconPlus size={16} /></button>
              <button className="icon-btn" onClick={() => setGroupSheet({ id: g.id, name: g.name })} aria-label={`Gruppe ${g.name} umbenennen`}><IconEdit size={16} /></button>
              <button className="icon-btn" onClick={() => deleteGroup(g.id, g.name)} aria-label={`Gruppe ${g.name} löschen`}><IconTrash size={16} /></button>
            </>
          )}
        </div>
        {open && (
          <div className="fav-group-body">
            {below === 0 && <div className="muted small fav-empty">Noch leer – beim Speichern eines Favoriten diese Gruppe wählen.</div>}
            {routes.map((r) => (
              <button className="card fav-item" key={r.id} onClick={() => setDetail(r.id)} data-testid="route-card">
                <FavSymbol kind={favKindOf(r)} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{r.name}</div>
                  <div className="meta">
                    <span>{formatDistance(r.ride ? r.ride.stats.distance : r.route.distance)}</span>
                    <span>↑ {r.ride?.stats.ascent ?? r.route.ascent} m</span>
                    <span>{r.ride ? formatClock(r.ride.stats.movingTime) : formatDuration(r.route.duration)}</span>
                  </div>
                  <div className="meta">{FAV_LABEL[favKindOf(r)]}{r.kind === 'imported' ? ' (importiert)' : ''} · {new Date(r.createdAt).toLocaleDateString('de-DE')}</div>
                </div>
                <span className="fav-thumb">
                  <Thumb r={r} size={52} />
                  {r.offlineRegionId && <span className="offline-badge" title="Offline verfügbar" aria-label="Offline verfügbar" data-testid="offline-badge"><IconOfflineReady size={14} /></span>}
                </span>
              </button>
            ))}
            {pls.map((p) => (
              <button className="card fav-item" key={p.id} onClick={() => openPlace(p)} data-testid="place-fav-card">
                <FavSymbol kind="place" poiType={p.kind} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="title">{p.name}</div>
                  <div className="meta">{FAV_LABEL.place}{p.detail ? ` · ${p.detail}` : ''}</div>
                </div>
              </button>
            ))}
            {subs.map((c) => (
              <GroupNode key={c.id} group={c} depth={depth + 1} />
            ))}
          </div>
        )}
      </section>
    );
  };

  const showRoutes = filter !== 'places';
  const showPlaces = filter !== 'routes';
  const total = (showRoutes ? saved.length : 0) + (showPlaces ? places.length : 0);

  return (
    <div className="page" data-testid="routes-screen">
      <div className="row">
        <h1 className="grow">Favoriten</h1>
        <button className="btn sm" onClick={() => file.current?.click()} data-testid="import-btn"><IconUpload size={16} /> GPX/KML</button>
        <input ref={file} type="file" accept=".gpx,.kml,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,application/xml" multiple hidden onChange={(e) => { onImport(e.target.files); e.target.value = ''; }} data-testid="import-input" />
      </div>
      <div className="segmented" data-testid="fav-filter">
        {([['all', 'Alle'], ['routes', 'Routen'], ['places', 'Orte']] as [Filter, string][]).map(([f, l]) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{l}</button>
        ))}
      </div>
      <button className="btn block" style={{ marginBottom: 12 }} onClick={() => setGroupSheet({ name: '' })} data-testid="fav-new-group"><IconPlus size={18} /> Neue Gruppe</button>

      {total === 0 && (filter !== 'all' || collections.length === 0) && (
        <div className="empty">
          <IconStar size={48} />
          <div>
            {filter === 'places'
              ? 'Noch keine Orte gespeichert. Tippe in der Karte auf einen Ort, dann auf „i“ und den Stern.'
              : 'Noch keine Favoriten. Speichere eine geplante Route mit dem Stern im Planer, einen Ort mit dem Stern in seiner Infokarte – aufgezeichnete Fahrten fragt die App beim Beenden.'}
          </div>
        </div>
      )}

      {(total > 0 || (filter === 'all' && collections.length > 0)) && (
        <>
          {childGroups(collections).map((g) => (
            <GroupNode key={g.id} group={g} depth={0} />
          ))}
          <GroupNode group={{ id: NO_GROUP, name: 'Ohne Gruppe', createdAt: 0 }} depth={0} />
        </>
      )}

      {groupSheet && (
        <GroupNameSheet
          title={groupSheet.id ? 'Gruppe umbenennen' : groupSheet.parentId ? `Untergruppe in „${collections.find((c) => c.id === groupSheet.parentId)?.name ?? ''}“` : 'Neue Gruppe'}
          initial={groupSheet.name}
          onSave={saveGroup}
          onClose={() => setGroupSheet(null)}
        />
      )}
    </div>
  );
}

function RouteDetail({ r, onClose }: { r: SavedRoute; onClose: () => void }) {
  const refresh = useStore((s) => s.refreshSaved);
  const collections = useStore((s) => s.collections);
  const loadIntoPlanner = useStore((s) => s.loadIntoPlanner);
  const toast = useStore((s) => s.toastMsg);
  const [pickGroup, setPickGroup] = useState(false);
  const [offline, setOffline] = useState<{ region?: OfflineRegion; progress?: [number, number]; error?: string }>({});
  const abort = useRef<AbortController | null>(null);
  // is the map along this route stored?
  useEffect(() => {
    if (!r.offlineRegionId) return setOffline({});
    listRegions().then((rs) => setOffline({ region: rs.find((x) => x.id === r.offlineRegionId) }));
  }, [r.offlineRegionId]);
  const saveOffline = async () => {
    abort.current = new AbortController();
    setOffline({ progress: [0, 1] });
    try {
      const st = useStore.getState().settings.mapStyle;
      const styleUrl = styleById(st).url ?? styleById('bikepath').url!;
      const region = await downloadRouteMaps(`Route: ${r.name}`, r.route.coords.map((c) => [c[0], c[1]]), styleUrl, (d, n) => setOffline({ progress: [d, n] }), abort.current.signal);
      await update({ offlineRegionId: region.id });
      setOffline({ region });
      toast('Route und Karte offline gespeichert');
    } catch (e) {
      setOffline({ error: (e as Error).name === 'AbortError' ? undefined : (e as Error).message });
    }
  };
  const removeOffline = async () => {
    if (r.offlineRegionId) await deleteRegion(r.offlineRegionId);
    await update({ offlineRegionId: undefined });
    setOffline({});
  };
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
          <button className="btn sm grow" onClick={() => setPickGroup(!pickGroup)}><IconFolder size={16} /> {r.collectionIds[0] && collections.some((c) => c.id === r.collectionIds[0]) ? groupPath(collections, r.collectionIds[0]) : 'Gruppe'}</button>
        </div>
        {pickGroup && (
          <div className="panel" style={{ background: 'var(--bg-soft)', marginTop: 10 }}>
            <GroupPicker value={r.collectionIds[0]} onChange={(g) => update({ collectionIds: g ? [g] : [] })} />
          </div>
        )}

        <div className={`offline-box ${offline.region ? 'ready' : ''}`} data-testid="route-offline">
          {offline.region ? <IconOfflineReady size={22} /> : <IconOffline size={22} />}
          <div className="grow">
            {offline.region ? (
              <>
                <div className="lbl">Offline verfügbar</div>
                <div className="sub">Route und Karte entlang der Strecke gespeichert · {offline.region.bytes < 1e6 ? '< 1' : (offline.region.bytes / 1e6).toFixed(offline.region.bytes < 1e7 ? 1 : 0).replace('.', ',')} MB</div>
              </>
            ) : offline.progress ? (
              <>
                <div className="lbl">Wird gespeichert … {Math.round((offline.progress[0] / offline.progress[1]) * 100)} %</div>
                <div className="progress"><div style={{ width: `${(offline.progress[0] / offline.progress[1]) * 100}%` }} /></div>
              </>
            ) : (
              <>
                <div className="lbl">Für unterwegs ohne Netz</div>
                <div className="sub">{offline.error ?? 'Speichert die Karte entlang der Route (mit Orten). Die Route selbst liegt schon auf dem Gerät.'}</div>
              </>
            )}
          </div>
          {offline.region ? (
            <button className="btn sm" onClick={removeOffline}>Entfernen</button>
          ) : offline.progress ? (
            <button className="btn sm" onClick={() => abort.current?.abort()}>Abbrechen</button>
          ) : (
            <button className="btn sm primary" onClick={saveOffline} data-testid="route-offline-save">Offline speichern</button>
          )}
        </div>
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
