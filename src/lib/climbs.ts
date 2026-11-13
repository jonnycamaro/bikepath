import type { Route } from './routing';

export interface Climb {
  type: 'climb' | 'descent';
  startAlong: number;
  endAlong: number;
  /** metres gained (climb) or lost (descent), positive */
  gain: number;
  /** average grade in % (positive) */
  grade: number;
  maxGrade: number;
}

/**
 * Detect noticeable climbs and descents along a route.
 * Elevation is smoothed over ~100 m; a section counts when it is at least `minLength` long,
 * averages at least `minGrade` % and changes at least `minGain` metres. Short flat dips
 * (< `tolerance` m of counter-movement) do not split a climb.
 */
export function detectClimbs(route: Route, opts: { minGrade?: number; minGain?: number; minLength?: number; tolerance?: number } = {}): Climb[] {
  const { minGrade = 3, minGain = 20, minLength = 200, tolerance = 8 } = opts;
  const { coords, cum } = route;
  if (coords.length < 3) return [];
  // resample every 25 m for stable grades
  const step = 25;
  const samples: { d: number; e: number }[] = [];
  let j = 0;
  for (let d = 0; d <= route.distance; d += step) {
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[j]) / seg));
    const e0 = coords[j][2] ?? 0;
    const e1 = coords[j + 1][2] ?? e0;
    samples.push({ d, e: e0 + (e1 - e0) * t });
  }
  // moving average over 5 samples (~100 m)
  const sm = samples.map((s, i) => {
    let sum = 0;
    let n = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(samples.length - 1, i + 2); k++) {
      sum += samples[k].e;
      n++;
    }
    return { d: s.d, e: sum / n };
  });

  const out: Climb[] = [];
  const scan = (dir: 1 | -1) => {
    let i = 0;
    while (i < sm.length - 1) {
      // find start: rising (dir) step
      if ((sm[i + 1].e - sm[i].e) * dir <= 0) {
        i++;
        continue;
      }
      const start = i;
      let peak = i;
      let k = i + 1;
      while (k < sm.length) {
        // extend only on a real gain; a flat tail must not dilute the average grade
        if ((sm[k].e - sm[peak].e) * dir > 0) peak = k;
        else if ((sm[peak].e - sm[k].e) * dir > tolerance) break;
        k++;
      }
      const gain = Math.abs(sm[peak].e - sm[start].e);
      const len = sm[peak].d - sm[start].d;
      if (len >= minLength && gain >= minGain && (gain / len) * 100 >= minGrade) {
        let maxGrade = 0;
        for (let q = start + 4; q <= peak; q += 1) {
          const g = (Math.abs(sm[q].e - sm[q - 4].e) / (sm[q].d - sm[q - 4].d)) * 100;
          if (g > maxGrade) maxGrade = g;
        }
        out.push({
          type: dir === 1 ? 'climb' : 'descent',
          startAlong: sm[start].d,
          endAlong: sm[peak].d,
          gain: Math.round(gain),
          grade: Math.round((gain / len) * 1000) / 10,
          maxGrade: Math.round(maxGrade),
        });
      }
      i = Math.max(peak, i + 1);
    }
  };
  scan(1);
  scan(-1);
  return out.sort((a, b) => a.startAlong - b.startAlong);
}

/** Current climb state at a position, for the bike computer ("Anstieg 2/5 · 7 %"). */
export function climbState(climbs: Climb[], along: number):
  | { kind: 'in'; climb: Climb; index: number; count: number; remaining: number }
  | { kind: 'ahead'; climb: Climb; index: number; count: number; distance: number }
  | null {
  const ups = climbs.filter((c) => c.type === 'climb');
  const cur = ups.findIndex((c) => along >= c.startAlong && along <= c.endAlong);
  if (cur >= 0) return { kind: 'in', climb: ups[cur], index: cur + 1, count: ups.length, remaining: ups[cur].endAlong - along };
  const next = ups.findIndex((c) => c.startAlong > along);
  if (next >= 0) return { kind: 'ahead', climb: ups[next], index: next + 1, count: ups.length, distance: ups[next].startAlong - along };
  return null;
}
