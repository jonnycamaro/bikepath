import maplibregl, { type GeoJSONSource, type Map as MLMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { snapToLine, type LngLat } from '../lib/geo';
import { styleById, styleFor, TERRAIN_TILES } from '../lib/mapStyles';
import { cachedPois, loadPoiTiles, MAX_POI_TILES, poiTileTemplate, tilesFor } from '../lib/poiTiles';
import { addPoiLayers, poiLayerIds, poiPlace, setPois, setPoiVisible, zoomIntoCluster } from '../lib/poiLayers';
import type { Poi } from '../lib/pois';
import { colouredLines } from '../lib/routeStyle';
import type { Route } from '../lib/routing';
import { useStore } from '../store';

export const mapRef: { current: MLMap | null } = { current: null };

const EMPTY = { type: 'FeatureCollection' as const, features: [] };

/** true once the current style finished loading (sources/layers can be touched). */
const styleReady = (map: MLMap | null): map is MLMap => !!map && !!(map as any).style?._loaded;

function lineFC(coords: [number, number][]) {
  return coords.length > 1
    ? { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: coords } }] }
    : EMPTY;
}

/** (Re)create all app sources and layers. Called after every style load. */
function addAppLayers(map: MLMap) {
  const src = (id: string, data: any = EMPTY) => {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data });
  };
  // overlays (below route)
  if (!map.getSource('cycleroutes'))
    map.addSource('cycleroutes', { type: 'raster', tiles: ['https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 17, attribution: '© waymarkedtrails.org' });
  if (!map.getSource('mtbroutes'))
    map.addSource('mtbroutes', { type: 'raster', tiles: ['https://tile.waymarkedtrails.org/mtb/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 17, attribution: '© waymarkedtrails.org' });
  if (!map.getSource('dem'))
    map.addSource('dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Höhen: Mapzen/AWS Terrain Tiles' });
  if (!map.getSource('dem-hs'))
    map.addSource('dem-hs', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 14 });
  if (!map.getLayer('hillshade')) map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-hs', layout: { visibility: 'none' }, paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#3d4b5c' } });
  if (!map.getLayer('cycleroutes')) map.addLayer({ id: 'cycleroutes', type: 'raster', source: 'cycleroutes', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } });
  if (!map.getLayer('mtbroutes')) map.addLayer({ id: 'mtbroutes', type: 'raster', source: 'mtbroutes', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } });

  src('preview');
  src('route');
  src('nav-route');
  src('track');
  src('drag-ghost');
  src('search');
  const casing = (id: string, source: string, width = 9) => {
    if (!map.getLayer(id))
      map.addLayer({ id, type: 'line', source, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, width * 0.55, 16, width * 1.4] } });
  };
  casing('preview-casing', 'preview');
  if (!map.getLayer('preview-line'))
    map.addLayer({ id: 'preview-line', type: 'line', source: 'preview', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7c3aed', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 8] } });
  casing('route-casing', 'route');
  if (!map.getLayer('route-line'))
    map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 16, 9] } });
  casing('nav-casing', 'nav-route', 11);
  if (!map.getLayer('nav-line'))
    map.addLayer({ id: 'nav-line', type: 'line', source: 'nav-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 18, 12] } });
  if (!map.getLayer('track-line'))
    map.addLayer({ id: 'track-line', type: 'line', source: 'track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#e5383b', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 16, 6] } });
  if (!map.getLayer('drag-ghost'))
    map.addLayer({ id: 'drag-ghost', type: 'line', source: 'drag-ghost', paint: { 'line-color': '#0b6bd6', 'line-width': 3, 'line-dasharray': [2, 2] } });
  // results of a submitted search ("alle Treffer auf der Karte")
  if (!map.getLayer('search-dot'))
    map.addLayer({
      id: 'search-dot', type: 'circle', source: 'search',
      paint: { 'circle-radius': 9, 'circle-color': '#e5383b', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2.5 },
    });
  if (!map.getLayer('search-label'))
    map.addLayer({
      id: 'search-label', type: 'symbol', source: 'search',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 10 },
      paint: { 'text-color': '#a4161a', 'text-halo-color': '#fff', 'text-halo-width': 1.6 },
    });
  // POIs on top, clustered; shown only when the "POIs" layer is switched on
  const st = useStore.getState().settings;
  addPoiLayers(map, 'pois', !!styleById(st.mapStyle).dark, st.overlays.includes('pois'));
}

function makeWpEl(kind: 'start' | 'via' | 'end', label: string) {
  const el = document.createElement('div');
  el.className = `wp-marker ${kind}`;
  el.textContent = label;
  return el;
}

export default function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(0); // increments on each style load
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const dragging = useRef(false);
  const poisAbort = useRef<AbortController | null>(null);

  const settings = useStore((s) => s.settings);
  const tab = useStore((s) => s.tab);
  const waypoints = useStore((s) => s.waypoints);
  const loop = useStore((s) => !!s.loop);
  const route = useStore((s) => s.route);
  const preview = useStore((s) => s.preview);
  const fix = useStore((s) => s.fix);
  const follow = useStore((s) => s.follow);
  const focus = useStore((s) => s.focus);
  const session = useStore((s) => s.session);

  // init
  useEffect(() => {
    const st = useStore.getState();
    const map = new maplibregl.Map({
      container: container.current!,
      style: styleFor(styleById(st.settings.mapStyle)),
      center: [10.45, 51.16],
      zoom: 5.2,
      attributionControl: { compact: true },
      maxPitch: 75,
      dragRotate: true,
    });
    mapRef.current = map;
    (window as any).__bikepathMap = map;
    map.touchZoomRotate.enableRotation();
    map.addControl(new maplibregl.ScaleControl({ unit: st.settings.units === 'imperial' ? 'imperial' : 'metric' }), 'bottom-left');
    map.on('style.load', () => {
      addAppLayers(map);
      setLoaded((n) => n + 1);
    });
    map.on('dragstart', (e) => {
      if ((e as any).originalEvent && useStore.getState().follow !== 'off') useStore.setState({ follow: 'off' });
    });
    // Planner: tap to add waypoint
    map.on('click', (e) => {
      if (dragging.current) return;
      const s = useStore.getState();
      // a search result: zoom there and show its card
      const [hitResult] = s.searchResults && map.getLayer('search-dot') ? map.queryRenderedFeatures(e.point, { layers: ['search-dot'] }) : [];
      if (hitResult) {
        const place = s.searchResults!.places[hitResult.properties.i as number];
        if (place) {
          s.showPlace(place);
          s.focusMap({ center: place.lngLat, zoom: Math.max(map.getZoom(), 15) });
          return;
        }
      }
      // POI layer: a circle zooms in, a place is picked (planner) or shown (map)
      const ids = poiLayerIds('pois');
      if (s.settings.overlays.includes('pois') && map.getLayer(ids.cluster)) {
        const [f] = map.queryRenderedFeatures(e.point, { layers: [ids.cluster, ids.point] });
        if (f?.layer.id === ids.cluster) return zoomIntoCluster(map, 'pois', f);
        if (f && s.tab === 'plan') return s.addWaypoint(poiPlace(f).lngLat, poiPlace(f).name);
        if (f && s.tab === 'map') return s.showPlace(poiPlace(f));
      }
      if (s.tab === 'plan') {
        const hit = map.queryRenderedFeatures(e.point, { layers: ['route-line'] });
        if (hit.length && s.waypoints.length >= 2 && !s.loop) return; // handled by drag logic
        s.addWaypoint([e.lngLat.lng, e.lngLat.lat]); // in a round trip: a stop on the way
      }
    });
    // Long-press / right-click: plan a route to here
    map.on('contextmenu', (e) => {
      const s = useStore.getState();
      if (s.session) return;
      const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const el = document.createElement('div');
      el.innerHTML = `<button class="btn primary sm" data-a="to">Route hierher</button> <button class="btn sm" data-a="from" style="margin-top:6px">Start hier</button>`;
      const popup = new maplibregl.Popup({ closeButton: false, offset: 6 }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
      el.addEventListener('click', (ev) => {
        const a = (ev.target as HTMLElement).dataset.a;
        if (!a) return;
        popup.remove();
        const st = useStore.getState();
        const me = st.fix?.lngLat;
        if (a === 'to') st.setWaypoints(me ? [{ id: 'me' + Date.now(), lngLat: me, name: 'Mein Standort' }, { id: 'to' + Date.now(), lngLat: p }] : [{ id: 'to' + Date.now(), lngLat: p }]);
        else st.setWaypoints([{ id: 'from' + Date.now(), lngLat: p }]);
        st.setTab('plan');
      });
    });

    // Drag the route line to insert a via point
    const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      const s = useStore.getState();
      if (s.tab !== 'plan' || !s.route || s.waypoints.length < 2) return;
      if ('points' in e && (e as any).points?.length > 1) return;
      e.preventDefault();
      dragging.current = true;
      map.getCanvas().style.cursor = 'grabbing';
      const r = s.route;
      const startP: LngLat = [e.lngLat.lng, e.lngLat.lat];
      const snap = snapToLine(startP, r.coords, r.cum)!;
      const wpAlongs = s.waypoints.map((w) => snapToLine(w.lngLat, r.coords, r.cum)?.along ?? 0);
      let leg = wpAlongs.findIndex((a, i) => i > 0 && a >= snap.along) - 1;
      if (leg < 0) leg = s.waypoints.length - 2;
      const a = s.waypoints[leg].lngLat;
      const b = s.waypoints[leg + 1].lngLat;
      let cur = startP;
      const move = (ev: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
        cur = [ev.lngLat.lng, ev.lngLat.lat];
        (map.getSource('drag-ghost') as GeoJSONSource).setData(lineFC([a, cur, b]));
      };
      const end = () => {
        map.off('mousemove', move);
        map.off('touchmove', move);
        (map.getSource('drag-ghost') as GeoJSONSource).setData(EMPTY);
        map.getCanvas().style.cursor = '';
        setTimeout(() => (dragging.current = false), 50);
        useStore.getState().insertWaypoint(leg, cur);
      };
      map.on('mousemove', move);
      map.on('touchmove', move);
      map.once('mouseup', end);
      map.once('touchend', end);
    };
    map.on('mousedown', 'route-line', startDrag);
    map.on('touchstart', 'route-line', startDrag);
    map.on('mouseenter', 'route-line', () => {
      if (useStore.getState().tab === 'plan') map.getCanvas().style.cursor = 'grab';
    });
    map.on('mouseleave', 'route-line', () => (map.getCanvas().style.cursor = ''));

    // POIs, read from the vector map tiles of zoom 14 (they carry every place)
    const showPois = (pois: Poi[]) => setPois(map, 'pois', pois, useStore.getState().settings.poiTypes);
    const loadPois = async () => {
      const s = useStore.getState();
      if (!s.settings.overlays.includes('pois') || map.getZoom() < 12) return;
      poisAbort.current?.abort();
      const b = map.getBounds();
      const tiles = tilesFor([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      showPois(cachedPois(tiles));
      if (tiles.length > MAX_POI_TILES) return; // zoomed out: only what is loaded already
      const ctrl = new AbortController();
      poisAbort.current = ctrl;
      try {
        const template = await poiTileTemplate();
        let n = 0;
        await loadPoiTiles(template, tiles, ctrl.signal, () => {
          if (++n % 8 === 0 && !ctrl.signal.aborted) showPois(cachedPois(tiles));
        });
        if (!ctrl.signal.aborted) showPois(cachedPois(tiles));
      } catch (e) {
        if (ctrl.signal.aborted || Date.now() - poiErrorAt < 60000) return;
        poiErrorAt = Date.now();
        useStore.getState().toastMsg(`Rad-POIs gerade nicht verfügbar (${(e as Error).message || 'keine Verbindung'})`);
      }
    };
    let poiErrorAt = 0;
    let poiTimer: ReturnType<typeof setTimeout>;
    map.on('moveend', () => {
      clearTimeout(poiTimer);
      poiTimer = setTimeout(loadPois, 600);
    });
    (map as any).__loadPois = loadPois;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // style switching
  const styleId = settings.mapStyle;
  const appliedStyle = useRef(useStore.getState().settings.mapStyle);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || appliedStyle.current === styleId) return;
    appliedStyle.current = styleId;
    // diff:false forces a full reload so 'style.load' fires and app layers are re-added
    map.setStyle(styleFor(styleById(styleId)), { diff: false });
  }, [styleId]);

  // overlays + terrain
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    vis('cycleroutes', settings.overlays.includes('cycleroutes'));
    vis('mtbroutes', settings.overlays.includes('mtbroutes'));
    vis('hillshade', settings.overlays.includes('hillshade'));
    const poisOn = settings.overlays.includes('pois');
    setPoiVisible(map, 'pois', poisOn);
    if (poisOn) (map as any).__loadPois?.();
    if (settings.terrain3d) {
      map.setTerrain({ source: 'dem', exaggeration: 1.4 });
      if (map.getPitch() < 30) map.easeTo({ pitch: 55, duration: 600 });
    } else {
      map.setTerrain(null);
      if (map.getPitch() > 0 && !useStore.getState().session) map.easeTo({ pitch: 0, duration: 400 });
    }
  }, [loaded, settings.overlays, settings.terrain3d]);

  // POI categories changed
  useEffect(() => {
    const map = mapRef.current;
    if (loaded && styleReady(map) && settings.overlays.includes('pois')) (map as any).__loadPois?.();
  }, [settings.poiTypes.join()]);

  // results of a submitted search
  const searchResults = useStore((s) => s.searchResults);
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    (map.getSource('search') as GeoJSONSource)?.setData(
      searchResults
        ? {
            type: 'FeatureCollection',
            features: searchResults.places.map((p, i) => ({ type: 'Feature', properties: { i, name: p.name }, geometry: { type: 'Point', coordinates: p.lngLat } })),
          }
        : EMPTY,
    );
  }, [searchResults, loaded]);

  // planned route
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    const show = route && tab === 'plan';
    (map.getSource('route') as GeoJSONSource)?.setData(show ? colouredLines(route!, settings.routeColorMode) : EMPTY);
  }, [route, loaded, settings.routeColorMode, session, tab]);

  // library preview
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    const show = preview && tab === 'routes';
    (map.getSource('preview') as GeoJSONSource)?.setData(show ? lineFC(preview!.coords.map((c) => [c[0], c[1]])) : EMPTY);
  }, [preview, loaded, tab, session]);

  // session route + recorded track
  const navRoute: Route | null = session?.route ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    (map.getSource('nav-route') as GeoJSONSource)?.setData(navRoute ? colouredLines(navRoute, settings.routeColorMode) : EMPTY);
  }, [navRoute, loaded, settings.routeColorMode]);
  const trackLen = session?.track.length ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !styleReady(map)) return;
    (map.getSource('track') as GeoJSONSource)?.setData(session ? lineFC(session.track) : EMPTY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackLen, loaded, !!session]);

  // waypoint markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const visible = tab === 'plan';
    const ids = new Set(visible ? waypoints.map((w) => w.id) : []);
    for (const [id, m] of markers.current) {
      if (!ids.has(id)) {
        m.remove();
        markers.current.delete(id);
      }
    }
    if (!visible) return;
    waypoints.forEach((w, i) => {
      // a round trip ends at its start, so everything after the first point is a stop
      const kind = i === 0 ? 'start' : i === waypoints.length - 1 && waypoints.length > 1 && !loop ? 'end' : 'via';
      const label = kind === 'start' ? 'A' : kind === 'end' ? 'B' : String(i);
      let m = markers.current.get(w.id);
      if (!m) {
        m = new maplibregl.Marker({ element: makeWpEl(kind, label), draggable: true }).setLngLat(w.lngLat).addTo(map);
        m.on('dragstart', () => (dragging.current = true));
        m.on('dragend', () => {
          const ll = m!.getLngLat();
          useStore.getState().moveWaypoint(w.id, [ll.lng, ll.lat]);
          setTimeout(() => (dragging.current = false), 50);
        });
        m.getElement().addEventListener('click', (ev) => {
          ev.stopPropagation();
          // tapping a via point removes it (start/end are removed in the sheet)
          const st = useStore.getState();
          const idx = st.waypoints.findIndex((x) => x.id === w.id);
          if (idx > 0 && (idx < st.waypoints.length - 1 || st.loop)) st.removeWaypoint(w.id);
        });
        markers.current.set(w.id, m);
      } else {
        m.setLngLat(w.lngLat);
        const el = m.getElement();
        el.className = `wp-marker ${kind} maplibregl-marker`;
        el.textContent = label;
      }
    });
  }, [waypoints, tab, session, loop]);

  // own location marker + follow
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fix) return;
    const pos = session?.nav && !session.nav.offRoute && !session.nav.approaching ? session.nav.snapped : fix.lngLat;
    if (!meMarker.current) {
      const el = document.createElement('div');
      el.className = 'me';
      meMarker.current = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(pos).addTo(map);
    }
    meMarker.current.setLngLat(pos);
    const el = meMarker.current.getElement();
    const hasHeading = fix.heading != null && !Number.isNaN(fix.heading) && (fix.speed ?? 0) > 0.8;
    el.classList.toggle('heading', hasHeading);
    if (hasHeading) meMarker.current.setRotation(fix.heading!);
    if (follow !== 'off') {
      const nav = !!session;
      map.easeTo({
        center: pos,
        zoom: nav ? Math.max(map.getZoom(), 16.5) : Math.max(map.getZoom(), 15),
        bearing: follow === 'heading' && hasHeading ? fix.heading! : follow === 'heading' ? map.getBearing() : 0,
        pitch: follow === 'heading' && nav ? 50 : settings.terrain3d ? map.getPitch() : 0,
        padding: nav ? { top: 160, bottom: 260, left: 0, right: 0 } : { top: 0, bottom: 0, left: 0, right: 0 },
        duration: 900,
        easing: (t) => t,
      });
    }
  }, [fix, follow, session?.nav, settings.terrain3d]);

  // focus requests
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    useStore.setState({ follow: 'off' });
    if (focus.bbox) {
      const [w, s, e, n] = focus.bbox;
      // keep the route clear of the bottom sheet + tab bar
      const sheetH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 0;
      const desktop = window.innerWidth > 760;
      const bottom = Math.min(window.innerHeight * 0.7, (desktop ? 0 : sheetH) + 64 + 50);
      map.fitBounds([[w, s], [e, n]], { padding: { top: 70, bottom, left: desktop ? 440 : 40, right: 64 }, maxZoom: 16, duration: 700 });
    } else if (focus.center) map.flyTo({ center: focus.center, zoom: focus.zoom ?? 15, duration: 800 });
  }, [focus]);

  return <div id="map" ref={container} data-testid="map" />;
}
