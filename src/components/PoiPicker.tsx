import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Place } from '../lib/geocode';
import type { LngLat } from '../lib/geo';
import { styleById, styleFor } from '../lib/mapStyles';
import { allCachedPois, cachedPois, loadPoiTiles, MAX_POI_TILES, poiTileTemplate, tilesFor } from '../lib/poiTiles';
import { addPoiLayers, CLUSTER_MAX_ZOOM, poiLayerIds, poiPlace, setPois, zoomIntoCluster } from '../lib/poiLayers';
import { PICKER_TYPES, POI_META, type Poi } from '../lib/pois';
import { useStore } from '../store';
import { mapRef } from './MapView';
import ExternalLinks from './ExternalLinks';
import { IconCheck, IconClose, IconFilter } from './icons';

/** the POI map needs a vector style (its tiles carry the places); raster styles fall back to this */
const VECTOR_STYLE = 'bikepath';
type Status = { kind: 'loading' } | { kind: 'done'; count: number; zoom: number } | { kind: 'far'; count: number } | { kind: 'none' };

/**
 * Full-screen map with points of interest from OpenStreetMap, read from the vector map
 * tiles (no extra service; works with offline maps). Places close together on screen merge
 * into a circle with their count – tapping it zooms in until they separate. The categories
 * on the right switch kinds on and off; tapping a place picks it and closes the map.
 */
export default function PoiPicker({ title, onPick, onClose, center: around }: { title: string; onPick: (p: Place) => void; onClose: () => void; center?: LngLat }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const types = settings.poiTypes;
  const [panel, setPanel] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  /** tapped place, shown in a card with "take over" and links to Google Maps / Tripadvisor */
  const [sel, setSel] = useState<Place | null>(null);
  const selMarker = useRef<maplibregl.Marker | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** places of the current view, before filtering by category */
  const shown = useRef<Poi[]>([]);
  const live = useRef({ types, onPick });
  live.current = { types, onPick };

  /** put the places of the chosen categories on the map */
  const render = (pois: Poi[], far = false) => {
    const m = map.current;
    shown.current = pois;
    if (!m || !m.getSource('poi')) return;
    const want = new Set(live.current.types);
    setPois(m, 'poi', pois, live.current.types);
    const sel = pois.filter((p) => want.has(p.type));
    if (!want.size) return setStatus({ kind: 'none' });
    const b = m.getBounds();
    const inView = sel.filter((p) => b.contains([p.lon, p.lat])).length;
    setStatus(far ? { kind: 'far', count: inView } : { kind: 'done', count: inView, zoom: m.getZoom() });
  };

  /** load the places of the visible area (zoom-14 tiles), unless that is too much data */
  const refresh = async () => {
    const m = map.current;
    if (!m) return;
    abort.current?.abort();
    const template = await poiTileTemplate().catch(() => undefined);
    if (map.current !== m) return;
    const b = m.getBounds();
    const tiles = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
    if (!template || tiles.length > MAX_POI_TILES) {
      // zoomed out too far to load everything: show what is known, merged into circles
      render(allCachedPois(), true);
      return;
    }
    render(cachedPois(tiles));
    const ctrl = new AbortController();
    abort.current = ctrl;
    if (tiles.some(([x, y]) => !cachedPois([[x, y]]).length)) setStatus({ kind: 'loading' });
    let n = 0;
    await loadPoiTiles(template, tiles, ctrl.signal, () => {
      if (++n % 8 === 0 && !ctrl.signal.aborted) render(cachedPois(tiles));
    });
    if (!ctrl.signal.aborted) render(cachedPois(tiles));
  };

  useEffect(() => {
    const fix = useStore.getState().fix;
    const c = mapRef.current?.getCenter();
    const center: LngLat = around ?? (c ? [c.lng, c.lat] : fix ? fix.lngLat : [10.45, 51.16]);
    const styleDef = styleById(styleById(settings.mapStyle).url ? settings.mapStyle : VECTOR_STYLE);
    const m = new maplibregl.Map({
      container: box.current!,
      style: styleFor(styleDef),
      center,
      zoom: Math.max(13, mapRef.current?.getZoom() ?? 15),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    (window as unknown as { __poiMap?: maplibregl.Map }).__poiMap = m;
    if (fix) {
      const me = document.createElement('div');
      me.className = 'me-dot';
      new maplibregl.Marker({ element: me }).setLngLat(fix.lngLat).addTo(m);
    }

    m.on('style.load', () => {
      // the style draws its own POI icons; hide them so only the pickable ones show
      for (const l of m.getStyle().layers) if ((l as { 'source-layer'?: string })['source-layer'] === 'poi') m.setLayoutProperty(l.id, 'visibility', 'none');
      addPoiLayers(m, 'poi', !!styleDef.dark);
      refresh();
    });

    const ids = poiLayerIds('poi');
    m.on('click', (e) => {
      const [f] = m.queryRenderedFeatures(e.point, { layers: [ids.cluster, ids.point] });
      if (!f) setSel(null);
      else if (f.layer.id === ids.cluster) zoomIntoCluster(m, 'poi', f);
      else setSel(poiPlace(f));
    });
    for (const l of [ids.cluster, ids.point]) {
      m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''));
    }
    let t: ReturnType<typeof setTimeout>;
    m.on('moveend', () => {
      clearTimeout(t);
      t = setTimeout(refresh, 250);
    });
    return () => {
      clearTimeout(t);
      abort.current?.abort();
      map.current = null;
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ring around the tapped place
  useEffect(() => {
    selMarker.current?.remove();
    selMarker.current = null;
    if (!sel || !map.current) return;
    const el = document.createElement('div');
    el.className = 'poi-sel';
    selMarker.current = new maplibregl.Marker({ element: el }).setLngLat(sel.lngLat).addTo(map.current);
  }, [sel]);

  // categories changed: filter what is loaded again
  const typesKey = types.join();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    render(shown.current, status.kind === 'far');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesKey]);

  const toggle = (t: string) => setSettings({ poiTypes: types.includes(t) ? types.filter((x) => x !== t) : [...types, t] });

  const statusText =
    status.kind === 'loading' ? 'Orte werden geladen …'
    : status.kind === 'far' ? `Weit herausgezoomt: ${status.count ? `${status.count} bereits geladene Orte` : 'nur bereits geladene Orte'} – zum Laden heranzoomen`
    : status.kind === 'done'
      ? !status.count ? 'Hier keine Orte dieser Kategorien'
        : Math.floor(status.zoom) <= CLUSTER_MAX_ZOOM ? `${status.count} Orte – Kreis antippen zum Heranzoomen, Ort antippen für Details`
        : `${status.count} Orte – einen antippen für Details`
    : 'Wähle rechts mindestens eine Kategorie';

  return createPortal(
    <div className="rt-picker poi-picker" data-testid="poi-picker">
      <div className="rt-map">
        <div ref={box} className="rt-canvas" />
        <div className="rt-top">
          <button className="fab small" onClick={onClose} aria-label="Zurück"><IconClose size={20} /></button>
          <div className="poi-title grow">{title}</div>
          <button className={`fab small ${panel ? 'active' : ''}`} onClick={() => setPanel(!panel)} aria-label="Kategorien" data-testid="poi-filter"><IconFilter size={20} /></button>
        </div>
        {panel && !sel && (
          <div className="poi-cats" data-testid="poi-cats">
            {PICKER_TYPES.map((id) => {
              const meta = POI_META[id];
              const on = types.includes(id);
              return (
                <button key={id} className={`poi-cat ${on ? 'on' : ''}`} style={{ '--c': meta.color } as React.CSSProperties} onClick={() => toggle(id)} aria-pressed={on} data-testid={`poi-cat-${id}`}>
                  <span className="poi-glyph">{meta.glyph}</span>
                  <span className="grow">{meta.label}</span>
                  <span className="poi-check">{on && <IconCheck size={14} />}</span>
                </button>
              );
            })}
          </div>
        )}
        {sel ? (
          <div className="poi-card" data-testid="poi-card">
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="poi-card-name">{sel.name}</div>
                {sel.detail !== sel.name && <div className="muted small">{sel.detail}</div>}
              </div>
              <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => setSel(null)} aria-label="Auswahl aufheben"><IconClose size={18} /></button>
            </div>
            <button className="btn primary block" style={{ margin: '10px 0 8px' }} onClick={() => onPick(sel)} data-testid="poi-take">
              <IconCheck size={18} /> Übernehmen
            </button>
            <ExternalLinks place={sel} />
          </div>
        ) : (
          <div className={`poi-status ${status.kind}`} role="status" data-testid="poi-status">{statusText}</div>
        )}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}
