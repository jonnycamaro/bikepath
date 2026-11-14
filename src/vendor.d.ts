// Minimal types for the vector tile decoder used by the POI map (lib/poiTiles.ts).
declare module 'pbf' {
  export default class Pbf {
    constructor(buf?: ArrayBuffer | Uint8Array);
  }
}

declare module '@mapbox/vector-tile' {
  import type Pbf from 'pbf';
  export interface VectorTileFeature {
    type: number;
    properties: Record<string, string | number | boolean>;
    id?: number;
    toGeoJSON(x: number, y: number, z: number): { geometry: { type: string; coordinates: unknown } };
    /** geometry in tile pixels (0 … extent); points outside lie in the buffer around the tile */
    loadGeometry(): { x: number; y: number }[][];
  }
  export interface VectorTileLayer {
    length: number;
    extent: number;
    feature(i: number): VectorTileFeature;
  }
  export class VectorTile {
    constructor(pbf: Pbf);
    layers: Record<string, VectorTileLayer>;
  }
}
