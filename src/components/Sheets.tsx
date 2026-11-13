import { useEffect, useRef, useState } from 'react';
import { formatDistance } from '../lib/geo';
import { MAP_STYLES, OVERLAYS } from '../lib/mapStyles';
import { AVG_TILE_BYTES, countTiles, deleteRegion, downloadRegion, listRegions, MAX_TILES, storageEstimate, type OfflineRegion } from '../lib/offline';
import { roundTripWaypoints } from '../lib/roundtrip';
import { PROFILES } from '../lib/routing';
import { saveRoute, uid, type SavedRoute } from '../lib/storage';
import { useStore } from '../store';
import { mapRef } from './MapView';
import { Icon3D, IconClose, IconTrash } from './icons';

function Modal({ title, onClose, children, testid }: { title: string; onClose: () => void; children: React.ReactNode; testid?: string }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid={testid}>
        <div className="head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Schließen"><IconClose /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} />;
}

export function LayersSheet() {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const close = () => useStore.getState().setSheet(null);
  const toggle = (id: string) =>
    setSettings({ overlays: settings.overlays.includes(id) ? settings.overlays.filter((o) => o !== id) : [...settings.overlays, id] });
  return (
    <Modal title="Kartenstil" onClose={close} testid="layers-sheet">
      <div className="style-grid">
        {MAP_STYLES.map((m) => (
          <button key={m.id} className={`style-opt ${settings.mapStyle === m.id ? 'active' : ''}`} onClick={() => setSettings({ mapStyle: m.id })}>
            <div className="sw" style={{ background: m.thumb }} />
            {m.label}
          </button>
        ))}
      </div>
      <h3>Ebenen</h3>
      <div className="panel" style={{ padding: '0 14px', background: 'var(--bg-soft)' }}>
        {OVERLAYS.map((o) => (
          <div className="setting" key={o.id}>
            <div>
              <div className="lbl">{o.label}</div>
              <div className="sub">{o.description}{o.id === 'pois' ? ' (ab Zoomstufe 12)' : ''}</div>
            </div>
            <Switch on={settings.overlays.includes(o.id)} onChange={() => toggle(o.id)} label={o.label} />
          </div>
        ))}
        <div className="setting">
          <div className="row"><Icon3D size={20} /><div><div className="lbl">3D-Gelände</div><div className="sub">Mit zwei Fingern neigen</div></div></div>
          <Switch on={settings.terrain3d} onChange={(v) => setSettings({ terrain3d: v })} label="3D" />
        </div>
      </div>
    </Modal>
  );
}

const DIRS = [
  ['N', 0], ['NO', 45], ['O', 90], ['SO', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315],
] as const;

export function RoundTripSheet() {
  const s = useStore();
  const [km, setKm] = useState(30);
  const [dir, setDir] = useState<number>(0);
  const [variant, setVariant] = useState(0);
  const start = s.waypoints[0]?.lngLat ?? s.fix?.lngLat ?? (mapRef.current ? (mapRef.current.getCenter().toArray() as [number, number]) : null);
  const close = () => s.setSheet(null);
  const create = (v = variant) => {
    if (!start) return;
    const pts = roundTripWaypoints(start, km * 1000, dir, v);
    s.setWaypoints(pts.map((p, i) => ({ id: uid(), lngLat: p, name: i === 0 || i === pts.length - 1 ? s.waypoints[0]?.name ?? (s.fix ? 'Mein Standort' : undefined) : undefined })));
    s.setTab('plan');
    const lons = pts.map((p) => p[0]);
    const lats = pts.map((p) => p[1]);
    s.focusMap({ bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] });
  };
  return (
    <Modal title="Rundtour planen" onClose={close} testid="roundtrip-sheet">
      <p className="muted small" style={{ marginTop: 0 }}>Start: {s.waypoints[0]?.name ?? (s.fix ? 'Mein Standort' : 'Kartenmitte')}</p>
      <h3>Distanz: {km} km</h3>
      <input type="range" min={5} max={150} step={5} value={km} onChange={(e) => setKm(Number(e.target.value))} aria-label="Distanz" />
      <h3>Richtung</h3>
      <div className="dir-grid">
        {DIRS.map(([l, d]) => (
          <button key={l} className={`chip ${dir === d ? 'active' : ''}`} style={{ justifyContent: 'center' }} onClick={() => setDir(d)}>{l}</button>
        ))}
      </div>
      <h3>Routing-Option</h3>
      <div className="chips">
        {PROFILES.filter((p) => p.brouter).map((p) => (
          <button key={p.id} className={`chip ${s.profileId === p.id ? 'active' : ''}`} onClick={() => s.setProfile(p.id)}>{p.label}</button>
        ))}
      </div>
      <h3>Radwege</h3>
      <div className="chips">
        {([['low', 'Niedrig', 'Radwege werden bevorzugt, kleine Umwege möglich'],
           ['medium', 'Mittel', 'Radwege gehen vor, solange der Umweg überschaubar bleibt'],
           ['high', 'Hoch', 'Radwege erzwingen – kann große Umwege bedeuten']] as const).map(([k, l]) => (
          <button key={k} className={`chip ${s.settings.cyclePathPref === k ? 'active' : ''}`} onClick={() => s.setSettings({ cyclePathPref: k })}>{l}</button>
        ))}
      </div>
      <div className="muted small">
        {{ low: 'Radwege werden bevorzugt. Könnte kleinere Umwege verursachen.',
           medium: 'Radwege werden gegenüber anderen Straßen bevorzugt, solange der Umweg überschaubar ist.',
           high: 'Erzwinge Radwege, wenn es sie gibt. Dies kann zu großen Umwegen führen.' }[s.settings.cyclePathPref]}
      </div>
      <div className="spacer" />
      <button className="btn primary block" disabled={!start} onClick={() => { create(); close(); }} data-testid="roundtrip-go">Rundtour erstellen</button>
      <div className="spacer" />
      <button className="btn block" disabled={!start} onClick={() => { const v = variant + 1; setVariant(v); create(v); close(); }}>Andere Variante</button>
    </Modal>
  );
}

export function SaveSheet() {
  const s = useStore();
  const [name, setName] = useState(
    s.planName || (s.waypoints.length >= 2 ? `${s.waypoints[0].name?.split(',')[0] ?? 'Start'} – ${s.waypoints[s.waypoints.length - 1].name?.split(',')[0] ?? 'Ziel'}` : 'Meine Route'),
  );
  const close = () => s.setSheet(null);
  const save = async (asNew: boolean) => {
    if (!s.route) return;
    const existing = s.saved.find((r) => r.id === s.editingId);
    const r: SavedRoute =
      existing && !asNew
        ? { ...existing, name, route: s.route, kind: existing.kind === 'recorded' ? 'planned' : existing.kind === 'imported' && s.undo.length ? 'planned' : existing.kind }
        : { id: uid(), name, kind: 'planned', createdAt: Date.now(), updatedAt: Date.now(), route: s.route, favorite: false, collectionIds: [] };
    await saveRoute(r);
    await s.refreshSaved();
    useStore.setState({ editingId: r.id, planName: name });
    s.toastMsg('Route gespeichert');
    close();
  };
  return (
    <Modal title="Route speichern" onClose={close} testid="save-sheet">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Routenname" />
      <div className="spacer" />
      <button className="btn primary block" onClick={() => save(false)} disabled={!name.trim()} data-testid="save-confirm">Speichern</button>
      {s.editingId && (
        <>
          <div className="spacer" />
          <button className="btn block" onClick={() => save(true)}>Als neue Route speichern</button>
        </>
      )}
    </Modal>
  );
}

export function OfflineSheet() {
  const s = useStore();
  const [regions, setRegions] = useState<OfflineRegion[]>([]);
  const [name, setName] = useState('');
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = () => {
    listRegions().then(setRegions);
    storageEstimate().then(setEst);
  };
  useEffect(() => {
    refresh();
    const map = mapRef.current;
    const upd = () => {
      if (!map) return;
      const b = map.getBounds();
      setBbox([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    };
    upd();
    map?.on('moveend', upd);
    return () => {
      map?.off('moveend', upd);
    };
  }, []);

  const tiles = bbox ? countTiles(bbox, 6, 14) : 0;
  const vectorStyle = MAP_STYLES.find((m) => m.id === s.settings.mapStyle && m.url) ?? MAP_STYLES[0];

  const start = async () => {
    if (!bbox) return;
    setErr(null);
    abort.current = new AbortController();
    try {
      await navigator.storage?.persist?.();
      setProgress([0, tiles]);
      await downloadRegion(name.trim() || `Gebiet ${regions.length + 1}`, bbox, vectorStyle.url!, (d, t) => setProgress([d, t]), abort.current.signal);
      s.toastMsg('Offline-Karte gespeichert');
      setName('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setProgress(null);
      refresh();
    }
  };

  const mb = (b: number) => `${(b / 1024 / 1024).toFixed(b > 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return (
    <div className="sheet" data-testid="offline-sheet" style={{ zIndex: 35 }}>
      <div className="grab" />
      <div className="body">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>Offline-Karten</h2>
          <button className="icon-btn" onClick={() => { abort.current?.abort(); useStore.setState({ offlineSelect: false, sheet: null }); }} aria-label="Schließen"><IconClose size={20} /></button>
        </div>
        <p className="muted small">Verschiebe und zoome die Karte, bis der gewünschte Bereich sichtbar ist. Gespeichert wird der Kartenstil „{vectorStyle.label}“ (Zoom 6–14, auch für Navigation ohne Netz).</p>
        <div className="row small"><b className="grow">{tiles.toLocaleString('de-DE')} Kacheln</b><span className="muted">≈ {mb(tiles * AVG_TILE_BYTES)}</span></div>
        {tiles > MAX_TILES && <div className="err">Bereich zu groß – bitte weiter hineinzoomen (max. {MAX_TILES.toLocaleString('de-DE')} Kacheln).</div>}
        <div className="spacer" />
        <input className="input" placeholder="Name, z. B. Bodensee" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="spacer" />
        {progress ? (
          <>
            <div className="bar"><div style={{ width: `${(progress[0] / Math.max(1, progress[1])) * 100}%`, background: 'var(--primary)' }} /></div>
            <div className="row small" style={{ marginTop: 6 }}>
              <span className="grow">{progress[0]} / {progress[1]}</span>
              <button className="btn sm" onClick={() => abort.current?.abort()}>Abbrechen</button>
            </div>
          </>
        ) : (
          <button className="btn primary block" disabled={tiles > MAX_TILES || !bbox} onClick={start} data-testid="offline-download">Bereich herunterladen</button>
        )}
        {err && <div className="err">{err}</div>}
        <h3>Gespeicherte Gebiete</h3>
        {regions.length === 0 && <div className="muted small">Noch keine Offline-Gebiete.</div>}
        {regions.map((r) => (
          <div className="setting" key={r.id}>
            <button className="grow" style={{ textAlign: 'left' }} onClick={() => s.focusMap({ bbox: r.bbox })}>
              <div className="lbl">{r.name}</div>
              <div className="sub">{r.tileCount.toLocaleString('de-DE')} Kacheln · {mb(r.bytes)} · {new Date(r.createdAt).toLocaleDateString('de-DE')}</div>
            </button>
            <button className="icon-btn" onClick={async () => { await deleteRegion(r.id); refresh(); }} aria-label="Löschen"><IconTrash size={18} /></button>
          </div>
        ))}
        {est && <p className="muted small">Speicher belegt: {mb(est.usage)} von {mb(est.quota)}</p>}
        <p className="muted small">Hinweis: Adresssuche und Neuberechnung brauchen eine Internetverbindung. Gespeicherte Routen lassen sich offline navigieren.</p>
      </div>
    </div>
  );
}

export function routeDistanceLabel(m: number) {
  return formatDistance(m);
}
