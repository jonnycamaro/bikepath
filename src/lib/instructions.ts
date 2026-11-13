import { angleDiff, bearing, haversine, type Coord } from './geo';

export type Maneuver =
  | 'depart'
  | 'straight'
  | 'slight-left'
  | 'left'
  | 'sharp-left'
  | 'slight-right'
  | 'right'
  | 'sharp-right'
  | 'keep-left'
  | 'keep-right'
  | 'uturn'
  | 'roundabout'
  | 'waypoint'
  | 'arrive';

export interface Instruction {
  /** index into route coords where the maneuver happens */
  index: number;
  /** distance from route start (m) */
  along: number;
  maneuver: Maneuver;
  exit?: number;
  text: string;
}

/** BRouter VoiceHint command codes (btools.router.VoiceHint). */
const BROUTER_CMD: Record<number, Maneuver> = {
  1: 'straight',
  2: 'left',
  3: 'slight-left',
  4: 'sharp-left',
  5: 'right',
  6: 'slight-right',
  7: 'sharp-right',
  8: 'keep-left',
  9: 'keep-right',
  10: 'uturn',
  11: 'uturn',
  12: 'uturn',
  14: 'roundabout',
  15: 'roundabout',
  17: 'keep-left',
  18: 'keep-right',
};

const COMPASS = ['Norden', 'Nordosten', 'Osten', 'Südosten', 'Süden', 'Südwesten', 'Westen', 'Nordwesten'];

export function maneuverFromAngle(a: number): Maneuver {
  const abs = Math.abs(a);
  if (abs < 25) return 'straight';
  if (abs < 60) return a < 0 ? 'slight-left' : 'slight-right';
  if (abs < 125) return a < 0 ? 'left' : 'right';
  if (abs < 165) return a < 0 ? 'sharp-left' : 'sharp-right';
  return 'uturn';
}

export function instructionText(m: Maneuver, exit?: number, extra?: string): string {
  switch (m) {
    case 'depart':
      return `Starte Richtung ${extra ?? 'Ziel'}`;
    case 'straight':
      return 'Geradeaus weiter';
    case 'slight-left':
      return 'Leicht links abbiegen';
    case 'left':
      return 'Links abbiegen';
    case 'sharp-left':
      return 'Scharf links abbiegen';
    case 'slight-right':
      return 'Leicht rechts abbiegen';
    case 'right':
      return 'Rechts abbiegen';
    case 'sharp-right':
      return 'Scharf rechts abbiegen';
    case 'keep-left':
      return 'Links halten';
    case 'keep-right':
      return 'Rechts halten';
    case 'uturn':
      return 'Wenden';
    case 'roundabout':
      return exit ? `Im Kreisverkehr die ${exit}. Ausfahrt nehmen` : 'In den Kreisverkehr fahren';
    case 'waypoint':
      return 'Zwischenziel erreicht';
    case 'arrive':
      return 'Du hast dein Ziel erreicht';
  }
}

/** Heading of the route around index i, using points ~`span` metres away to smooth noise. */
function headingAt(coords: Coord[], cum: number[], i: number, dir: 1 | -1, span = 20): number {
  let j = i;
  while (j + dir >= 0 && j + dir < coords.length && Math.abs(cum[j] - cum[i]) < span) j += dir;
  if (j === i) return NaN;
  return dir === 1 ? bearing(coords[i], coords[j]) : bearing(coords[j], coords[i]);
}

/** Derive turn instructions purely from geometry (for imported tracks without hints). */
export function geometryHints(coords: Coord[], cum: number[]): number[][] {
  const hints: number[][] = [];
  let lastAlong = -Infinity;
  for (let i = 1; i < coords.length - 1; i++) {
    if (haversine(coords[i - 1], coords[i]) < 0.5) continue;
    const hin = headingAt(coords, cum, i, -1);
    const hout = headingAt(coords, cum, i, 1);
    if (Number.isNaN(hin) || Number.isNaN(hout)) continue;
    const a = angleDiff(hin, hout);
    if (Math.abs(a) >= 40 && cum[i] - lastAlong > 40) {
      hints.push([i, 0, 0, 0, a]);
      lastAlong = cum[i];
    }
  }
  return hints;
}

export function buildInstructions(coords: Coord[], cum: number[], hints: number[][], legEnds: number[] = []): Instruction[] {
  if (coords.length < 2) return [];
  const list: Instruction[] = [];
  const h0 = headingAt(coords, cum, 0, 1, 30);
  list.push({
    index: 0,
    along: 0,
    maneuver: 'depart',
    text: instructionText('depart', undefined, COMPASS[Math.round((Number.isNaN(h0) ? 0 : h0) / 45) % 8]),
  });
  const source = hints.length > 0 ? hints : geometryHints(coords, cum);
  for (const h of source) {
    const idx = Math.min(Math.max(0, h[0]), coords.length - 1);
    const cmd = h[1];
    const exit = h[2] || undefined;
    const angle = h[4] ?? 0;
    let m: Maneuver = BROUTER_CMD[cmd] ?? maneuverFromAngle(angle);
    if (m === 'straight') continue; // BRouter emits "continue" hints at name changes; not spoken
    if (m === 'uturn' && Math.abs(angle) < 150) m = maneuverFromAngle(angle);
    list.push({ index: idx, along: cum[idx], maneuver: m, exit, text: instructionText(m, exit) });
  }
  for (const e of legEnds) list.push({ index: e, along: cum[e], maneuver: 'waypoint', text: instructionText('waypoint') });
  const last = coords.length - 1;
  list.push({ index: last, along: cum[last], maneuver: 'arrive', text: instructionText('arrive') });
  list.sort((a, b) => a.along - b.along);
  return list;
}

/** Spoken phrase for an upcoming maneuver at a given distance. */
export function spokenInstruction(ins: Instruction, distance: number): string {
  const base = ins.text;
  if (distance < 30) return ins.maneuver === 'arrive' ? base : `Jetzt ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
  const d = distance >= 1000 ? `${(Math.round(distance / 100) / 10).toString().replace('.', ',')} Kilometern` : `${Math.round(distance / 10) * 10} Metern`;
  if (ins.maneuver === 'arrive') return `In ${d} erreichst du dein Ziel`;
  return `In ${d} ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}
