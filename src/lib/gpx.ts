import type { Coord } from './geo';
import type { TrackPoint } from './recording';

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);

export function toGPX(name: string, coords: Coord[], times?: (number | null)[], waypoints: { lngLat: [number, number]; name?: string }[] = []): string {
  const wpts = waypoints
    .map((w, i) => `  <wpt lat="${w.lngLat[1].toFixed(7)}" lon="${w.lngLat[0].toFixed(7)}"><name>${esc(w.name ?? `Punkt ${i + 1}`)}</name></wpt>`)
    .join('\n');
  const pts = coords
    .map((c, i) => {
      const ele = c[2] != null ? `<ele>${c[2].toFixed(1)}</ele>` : '';
      const t = times?.[i] ? `<time>${new Date(times[i]!).toISOString()}</time>` : '';
      return `      <trkpt lat="${c[1].toFixed(7)}" lon="${c[0].toFixed(7)}">${ele}${t}</trkpt>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bikepath" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${esc(name)}</name><time>${new Date().toISOString()}</time></metadata>
${wpts}
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function rideToGPX(name: string, pts: TrackPoint[]): string {
  return toGPX(name, pts.map((p) => [p.lon, p.lat, p.ele ?? undefined]), pts.map((p) => p.time));
}

export function toKML(name: string, coords: Coord[]): string {
  const line = coords.map((c) => `${c[0].toFixed(7)},${c[1].toFixed(7)},${(c[2] ?? 0).toFixed(1)}`).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(name)}</name>
    <Style id="line"><LineStyle><color>ffd8651b</color><width>5</width></LineStyle></Style>
    <Placemark>
      <name>${esc(name)}</name>
      <styleUrl>#line</styleUrl>
      <LineString><tessellate>1</tessellate><coordinates>${line}</coordinates></LineString>
    </Placemark>
  </Document>
</kml>
`;
}

export interface ImportedTrack {
  name: string;
  coords: Coord[];
  times: (number | null)[];
}

/** Parse GPX (trk/rte) or KML (LineString / gx:Track) into a single track. */
export function parseTrackFile(text: string, fallbackName = 'Importierte Route'): ImportedTrack {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Datei ist kein gültiges GPX/KML');
  const byLocal = (root: Document | Element, name: string) =>
    Array.from(root.getElementsByTagName('*')).filter((e) => e.localName === name);
  const nameEl = byLocal(doc, 'name')[0];
  const name = nameEl?.textContent?.trim() || fallbackName;
  const coords: Coord[] = [];
  const times: (number | null)[] = [];

  let pts = byLocal(doc, 'trkpt');
  if (pts.length === 0) pts = byLocal(doc, 'rtept');
  if (pts.length > 0) {
    for (const p of pts) {
      const lat = Number(p.getAttribute('lat'));
      const lon = Number(p.getAttribute('lon'));
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const ele = byLocal(p, 'ele')[0]?.textContent;
      const time = byLocal(p, 'time')[0]?.textContent;
      coords.push([lon, lat, ele != null && ele !== '' ? Number(ele) : undefined]);
      times.push(time ? Date.parse(time) : null);
    }
  } else {
    for (const c of byLocal(doc, 'coordinates')) {
      for (const tuple of (c.textContent ?? '').trim().split(/\s+/)) {
        const [lon, lat, ele] = tuple.split(',').map(Number);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          coords.push([lon, lat, Number.isFinite(ele) ? ele : undefined]);
          times.push(null);
        }
      }
    }
    if (coords.length === 0) {
      for (const c of byLocal(doc, 'coord')) {
        const [lon, lat, ele] = (c.textContent ?? '').trim().split(/\s+/).map(Number);
        if (Number.isFinite(lon) && Number.isFinite(lat)) {
          coords.push([lon, lat, Number.isFinite(ele) ? ele : undefined]);
          times.push(null);
        }
      }
    }
  }
  if (coords.length < 2) throw new Error('Keine Trackpunkte gefunden');
  return { name, coords, times };
}

/** Thin out a dense track (Douglas-Peucker-light by min distance) for routing/display. */
export function simplifyByDistance(coords: Coord[], minDist = 5): Coord[] {
  if (coords.length < 3) return coords;
  const out: Coord[] = [coords[0]];
  const kx = Math.cos((coords[0][1] * Math.PI) / 180) * 111320;
  for (let i = 1; i < coords.length - 1; i++) {
    const l = out[out.length - 1];
    const dx = (coords[i][0] - l[0]) * kx;
    const dy = (coords[i][1] - l[1]) * 110540;
    if (dx * dx + dy * dy >= minDist * minDist) out.push(coords[i]);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share via Web Share API (file) when available, otherwise download. */
export async function shareOrDownload(filename: string, content: string, mime: string) {
  try {
    const file = new File([content], filename, { type: mime });
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
  }
  downloadFile(filename, content, mime);
}

export const safeFilename = (s: string) => s.replace(/[^\p{L}\p{N}\-_ ]+/gu, '').trim().replace(/\s+/g, '_') || 'route';
