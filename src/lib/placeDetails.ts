/**
 * Details of a place from free sources, loaded when the rider opens it:
 * - OpenStreetMap tags (opening hours, phone, website, wheelchair …) via Nominatim's lookup
 *   (ODbL; usage policy: at most one request per second, only on demand – both kept here)
 * - a Wikipedia summary when the OSM object links one (text CC BY-SA)
 * - a photo from Wikimedia Commons with author and licence (each image has its own licence)
 */
import { STATE_CODES } from './holidays';

const NOMINATIM = 'https://nominatim.openstreetmap.org';

export interface PlaceImage {
  url: string;
  /** "Foto: <author>, <licence>" */
  credit: string;
  /** file page on Commons */
  source: string;
}

export interface PlaceDetails {
  /** e.g. "W413953195" */
  osm: string;
  osmUrl: string;
  name?: string;
  address?: string;
  /** federal state code (for public holidays) */
  state?: string;
  tags: Record<string, string>;
  wiki?: { title: string; extract: string; url: string };
  image?: PlaceImage;
}

/** OSM reference from an OpenMapTiles POI id: osm id × 10 + 1 node / 2 way / 3 relation. */
export function osmRefFromTileId(id: number): string | undefined {
  const type = { 1: 'N', 2: 'W', 3: 'R' }[id % 10];
  return type && id > 10 ? `${type}${Math.floor(id / 10)}` : undefined;
}

const TYPE_PATH: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };

// Nominatim allows one request per second: requests wait for each other.
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;
function nominatim<T>(path: string): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(`${NOMINATIM}${path}`);
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    return res.json() as Promise<T>;
  });
  queue = run.catch(() => {});
  return run;
}

const cache = new Map<string, Promise<PlaceDetails | null>>();

/** Details for an OSM object ("N123", "W456", "R789"); null if Nominatim does not know it. */
export function loadPlaceDetails(osm: string): Promise<PlaceDetails | null> {
  let p = cache.get(osm);
  if (!p) {
    p = fetchDetails(osm).catch((e) => {
      cache.delete(osm); // try again next time
      throw e;
    });
    cache.set(osm, p);
  }
  return p;
}

interface NominatimResult {
  name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

async function fetchDetails(osm: string): Promise<PlaceDetails | null> {
  const [r] = await nominatim<NominatimResult[]>(`/lookup?osm_ids=${osm}&format=json&extratags=1&addressdetails=1&namedetails=0&accept-language=de`);
  if (!r) return null;
  const a = r.address ?? {};
  const street = [a.road ?? a.pedestrian ?? a.footway ?? a.path, a.house_number].filter(Boolean).join(' ');
  const town = [a.postcode, a.city ?? a.town ?? a.village ?? a.municipality].filter(Boolean).join(' ');
  const details: PlaceDetails = {
    osm,
    osmUrl: `https://www.openstreetmap.org/${TYPE_PATH[osm[0]]}/${osm.slice(1)}`,
    name: r.name || undefined,
    address: [street, town].filter(Boolean).join(', ') || undefined,
    state: a.state ? STATE_CODES[a.state] : undefined,
    tags: r.extratags ?? {},
  };
  // extras from Wikipedia / Commons are a bonus: their failure must not hide the OSM details
  const [wiki, image] = await Promise.all([loadWiki(details.tags).catch(() => undefined), loadOsmImage(details.tags).catch(() => undefined)]);
  details.wiki = wiki?.summary;
  details.image = image ?? wiki?.image;
  return details;
}

/** "de:Reichsburg Cochem" (OSM `wikipedia`) or the German article of the `wikidata` item. */
async function wikiTitle(tags: Record<string, string>): Promise<{ lang: string; title: string } | undefined> {
  const w = tags.wikipedia;
  if (w && /^de:/.test(w)) return { lang: 'de', title: w.slice(3) };
  if (tags.wikidata && /^Q\d+$/.test(tags.wikidata)) {
    const res = await fetch(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${tags.wikidata}&props=sitelinks&sitefilter=dewiki|enwiki&format=json&origin=*`);
    const links = (await res.json())?.entities?.[tags.wikidata]?.sitelinks ?? {};
    if (links.dewiki) return { lang: 'de', title: links.dewiki.title };
    if (links.enwiki) return { lang: 'en', title: links.enwiki.title };
  }
  const m = w && /^([a-z]{2,3}):(.+)$/.exec(w);
  return m ? { lang: m[1], title: m[2] } : undefined;
}

async function loadWiki(tags: Record<string, string>) {
  const t = await wikiTitle(tags);
  if (!t) return undefined;
  const res = await fetch(`https://${t.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.title.replace(/ /g, '_'))}`);
  if (!res.ok) return undefined;
  const j = await res.json();
  if (j.type === 'disambiguation' || !j.extract) return undefined;
  const summary = { title: j.title as string, extract: j.extract as string, url: (j.content_urls?.mobile?.page ?? j.content_urls?.desktop?.page) as string };
  // the article's picture, if it is on Commons (files only on a local Wikipedia may be unfree)
  const file = commonsFileFromUrl(j.originalimage?.source);
  const image = file ? await commonsImage(file).catch(() => undefined) : undefined;
  return { summary, image };
}

/** File name of an upload.wikimedia.org/wikipedia/commons/… URL (original or thumbnail). */
export function commonsFileFromUrl(url?: string): string | undefined {
  // query parameters (Wikipedia adds ?utm_source=…) are not part of the file name
  const m = url && /(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** OSM `wikimedia_commons=File:…` or `image=` pointing to Commons. Other image links have unknown licences and are ignored. */
async function loadOsmImage(tags: Record<string, string>): Promise<PlaceImage | undefined> {
  const wc = tags.wikimedia_commons;
  let file = wc && /^File:/i.test(wc) ? wc.slice(5) : undefined;
  const img = tags.image;
  if (!file && img) {
    const m = /commons\.wikimedia\.org\/wiki\/File:([^?#]+)/i.exec(img);
    file = m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : commonsFileFromUrl(img);
  }
  return file ? commonsImage(file) : undefined;
}

const stripHtml = (s?: string) => (s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

/** Scaled image and attribution of a Commons file. */
async function commonsImage(file: string): Promise<PlaceImage | undefined> {
  const res = await fetch(
    `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(`File:${file}`)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&format=json&origin=*`,
  );
  const page = Object.values((await res.json())?.query?.pages ?? {})[0] as { imageinfo?: { thumburl?: string; descriptionurl?: string; extmetadata?: Record<string, { value: string }> }[] } | undefined;
  const info = page?.imageinfo?.[0];
  if (!info?.thumburl) return undefined;
  const meta = info.extmetadata ?? {};
  const author = stripHtml(meta.Artist?.value) || 'unbekannt';
  const licence = stripHtml(meta.LicenseShortName?.value);
  return { url: info.thumburl, credit: `Foto: ${author}${licence ? `, ${licence}` : ''}`, source: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file)}` };
}
