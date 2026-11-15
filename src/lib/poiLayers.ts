import type { GeoJSONSource, Map as MLMap, MapGeoJSONFeature } from 'maplibre-gl';
import { osmRefFromTileId } from './placeDetails';
import { POI_META, type Poi } from './pois';

/**
 * Drawing POIs on a MapLibre map – shared by the main map (POI layer) and the POI map.
 * Places close together on screen merge into a circle with their count (MapLibre's own
 * clustering); tapping one zooms in until it splits.
 */

/** places closer together than this many pixels merge into one circle */
export const CLUSTER_RADIUS = 60;
/** from the zoom after this one every place stands alone */
export const CLUSTER_MAX_ZOOM = 15;

/** Marker image for a POI type: coloured disc, white ring, glyph. */
function poiImage(color: string, glyph: string): ImageData {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2 - 4, 0, Math.PI * 2);
  g.fillStyle = color;
  g.shadowColor = 'rgba(10,37,64,.35)';
  g.shadowBlur = 4;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 4;
  g.strokeStyle = '#fff';
  g.stroke();
  g.fillStyle = '#fff';
  g.font = `800 ${glyph.length > 1 && /^[A-Z]+$/.test(glyph) ? 22 : 28}px system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(glyph, s / 2, s / 2 + 2);
  return g.getImageData(0, 0, s, s);
}

/** layer ids for a POI source */
export const poiLayerIds = (source: string) => ({ cluster: `${source}-cluster`, count: `${source}-count`, point: `${source}-point` });

/** Add the clustered POI source and its layers (idempotent; call after every style load). */
export function addPoiLayers(m: MLMap, source: string, dark: boolean, visible = true) {
  for (const [id, meta] of Object.entries(POI_META)) if (!m.hasImage(`poi-${id}`)) m.addImage(`poi-${id}`, poiImage(meta.color, meta.glyph), { pixelRatio: 2 });
  if (!m.getSource(source)) m.addSource(source, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: CLUSTER_RADIUS, clusterMaxZoom: CLUSTER_MAX_ZOOM });
  const ids = poiLayerIds(source);
  const visibility = visible ? 'visible' : 'none';
  if (!m.getLayer(ids.cluster))
    m.addLayer({
      id: ids.cluster, type: 'circle', source, filter: ['has', 'point_count'],
      layout: { visibility },
      paint: {
        'circle-color': '#0b6bd6',
        'circle-opacity': 0.92,
        'circle-radius': ['step', ['get', 'point_count'], 16, 10, 20, 100, 25, 1000, 30],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 3,
      },
    });
  if (!m.getLayer(ids.count))
    m.addLayer({
      id: ids.count, type: 'symbol', source, filter: ['has', 'point_count'],
      layout: { visibility, 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-allow-overlap': true },
      paint: { 'text-color': '#fff' },
    });
  if (!m.getLayer(ids.point))
    m.addLayer({
      id: ids.point, type: 'symbol', source, filter: ['!', ['has', 'point_count']],
      layout: {
        visibility,
        'icon-image': ['concat', 'poi-', ['get', 'type']],
        'icon-allow-overlap': true,
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: dark
        ? { 'text-color': '#e8eef5', 'text-halo-color': '#121820', 'text-halo-width': 1.5 }
        : { 'text-color': '#0a2540', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    });
}

export function setPoiVisible(m: MLMap, source: string, on: boolean) {
  for (const id of Object.values(poiLayerIds(source))) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

/** Show these places (only the given types) in the POI source. */
export function setPois(m: MLMap, source: string, pois: Poi[], types: string[]) {
  const want = new Set(types);
  (m.getSource(source) as GeoJSONSource | undefined)?.setData({
    type: 'FeatureCollection',
    features: pois
      .filter((p) => want.has(p.type))
      .map((p) => ({
        type: 'Feature',
        properties: { type: p.type, name: p.name ?? '', pid: p.id },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
  });
}

/** Zoom in until the tapped circle splits up. */
export function zoomIntoCluster(m: MLMap, source: string, f: MapGeoJSONFeature) {
  const at = (f.geometry as GeoJSON.Point).coordinates as [number, number];
  (m.getSource(source) as GeoJSONSource)
    .getClusterExpansionZoom(f.properties.cluster_id)
    .then((z) => m.easeTo({ center: at, zoom: Math.min(z + 0.2, 19), duration: 450 }))
    .catch(() => m.easeTo({ center: at, zoom: m.getZoom() + 2, duration: 450 }));
}

/** The place behind a tapped POI symbol. */
export function poiPlace(f: MapGeoJSONFeature) {
  const meta = POI_META[f.properties.type];
  const [lon, lat] = (f.geometry as GeoJSON.Point).coordinates;
  const pid = Number(f.properties.pid);
  return { id: `poi-${pid}`, name: (f.properties.name as string) || meta.label, detail: meta.label, lngLat: [lon, lat] as [number, number], kind: f.properties.type as string, osm: osmRefFromTileId(pid) };
}
