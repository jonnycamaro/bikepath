import type { LngLat } from './geo';

/**
 * Links that open a place in Google Maps or Tripadvisor. Only links: no API, no key, no data
 * goes to those services until the rider taps one.
 */

/**
 * Kinds Tripadvisor has entries for: our POI types and the OSM values Photon reports for
 * search results (restaurants, cafés, attractions, hotels).
 */
const TRIPADVISOR_KINDS = new Set([
  'restaurant', 'food', 'sight', 'viewpoint', 'lodging',
  'cafe', 'fast_food', 'biergarten', 'ice_cream', 'bar', 'pub',
  'hotel', 'guest_house', 'hostel', 'camp_site', 'attraction', 'museum', 'castle', 'monument', 'zoo',
]);

/**
 * Google Maps search (official "Maps URLs", https://developers.google.com/maps/documentation/urls).
 * A named place is searched by name and town; without a name, the coordinates are opened.
 */
export function googleMapsUrl(name: string | undefined, lngLat: LngLat, town?: string | null): string {
  const query = name ? [name, town].filter(Boolean).join(', ') : `${lngLat[1].toFixed(6)},${lngLat[0].toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Tripadvisor search for a named place; null where Tripadvisor has nothing useful (WC, water, streets …). */
export function tripadvisorUrl(name: string | undefined, kind: string, town?: string | null): string | null {
  if (!name || !TRIPADVISOR_KINDS.has(kind)) return null;
  return `https://www.tripadvisor.de/Search?q=${encodeURIComponent([name, town].filter(Boolean).join(' '))}`;
}
