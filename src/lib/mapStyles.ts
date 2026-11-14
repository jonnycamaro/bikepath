import type { StyleSpecification } from 'maplibre-gl';

export interface MapStyleDef {
  id: string;
  label: string;
  /** vector style URL or raster tile template(s) */
  url?: string;
  raster?: { tiles: string[]; attribution: string; maxzoom?: number; tileSize?: number };
  dark?: boolean;
  thumb: string; // css background for the chooser
}

export const MAP_STYLES: MapStyleDef[] = [
  { id: 'bikepath', label: 'Bikepath', url: 'https://tiles.openfreemap.org/styles/liberty', thumb: 'linear-gradient(135deg,#f2efe9 40%,#c8e6c9 40% 60%,#aad3df 60%)' },
  { id: 'light', label: 'Hell', url: 'https://tiles.openfreemap.org/styles/positron', thumb: 'linear-gradient(135deg,#fafafa 50%,#e0e0e0 50%)' },
  { id: 'night', label: 'Nacht', url: 'https://tiles.openfreemap.org/styles/dark', dark: true, thumb: 'linear-gradient(135deg,#1f2933 50%,#3e4c59 50%)' },
  {
    id: 'cycle',
    label: 'Radkarte',
    raster: {
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png`),
      attribution: '© <a href="https://www.cyclosm.org">CyclOSM</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 20,
    },
    thumb: 'linear-gradient(135deg,#f5f1e8 40%,#7b3fa0 40% 46%,#f5f1e8 46%)',
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    raster: {
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxzoom: 19,
    },
    thumb: 'linear-gradient(135deg,#f2efe9 40%,#f7d38a 40% 48%,#f2efe9 48%)',
  },
  {
    id: 'topo',
    label: 'Outdoor / Topo',
    raster: {
      tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) © OpenStreetMap',
      maxzoom: 17,
    },
    thumb: 'repeating-linear-gradient(135deg,#e8e4c9 0 6px,#c9b98a 6px 7px)',
  },
  {
    id: 'satellite',
    label: 'Satellit',
    raster: {
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      attribution: 'Bilder © Esri, Maxar, Earthstar Geographics',
      maxzoom: 19,
    },
    dark: true,
    thumb: 'linear-gradient(135deg,#2f4a2a 40%,#5b6b3b 40% 70%,#24384d 70%)',
  },
];

export interface OverlayDef {
  id: string;
  label: string;
  description: string;
}

export const OVERLAYS: OverlayDef[] = [
  { id: 'cycleroutes', label: 'Radrouten', description: 'Beschilderte Radfernwege und Netze' },
  { id: 'mtbroutes', label: 'MTB-Routen', description: 'Ausgeschilderte Mountainbike-Strecken' },
  { id: 'hillshade', label: 'Relief', description: 'Schummerung des Geländes' },
  { id: 'pois', label: 'POIs', description: 'Orte wie Cafés, Supermärkte, Trinkwasser oder WCs' },
];

export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function styleFor(def: MapStyleDef): string | StyleSpecification {
  if (def.url) return def.url;
  const r = def.raster!;
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      base: { type: 'raster', tiles: r.tiles, tileSize: r.tileSize ?? 256, attribution: r.attribution, maxzoom: r.maxzoom ?? 19 },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  };
}

export const styleById = (id: string) => MAP_STYLES.find((s) => s.id === id) ?? MAP_STYLES[0];
