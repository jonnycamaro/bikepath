/**
 * German public holidays (gesetzliche Feiertage) per federal state, for "PH" in opening hours.
 * Nationwide days plus the state ones; dates moving with Easter use the Gregorian computus.
 */

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/** state names as Nominatim returns them (accept-language=de) -> ISO code */
export const STATE_CODES: Record<string, string> = {
  'Baden-Württemberg': 'BW', Bayern: 'BY', Berlin: 'BE', Brandenburg: 'BB', Bremen: 'HB', Hamburg: 'HH', Hessen: 'HE',
  'Mecklenburg-Vorpommern': 'MV', Niedersachsen: 'NI', 'Nordrhein-Westfalen': 'NW', 'Rheinland-Pfalz': 'RP', Saarland: 'SL',
  Sachsen: 'SN', 'Sachsen-Anhalt': 'ST', 'Schleswig-Holstein': 'SH', Thüringen: 'TH',
};

const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** Holidays of a year as "Y-M-D" keys; without a state only the nationwide ones. */
export function holidays(year: number, state?: string): Set<string> {
  const e = easter(year);
  const rel = (days: number) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + days);
  const fix = (m: number, d: number) => new Date(year, m - 1, d);
  const days: Date[] = [fix(1, 1), rel(-2), rel(1), fix(5, 1), rel(39), rel(50), fix(10, 3), fix(12, 25), fix(12, 26)];
  const s = state ?? '';
  if (['BW', 'BY', 'ST'].includes(s)) days.push(fix(1, 6));
  if (['BE', 'MV'].includes(s)) days.push(fix(3, 8));
  if (s === 'BB') days.push(rel(0), rel(49));
  if (['BW', 'BY', 'HE', 'NW', 'RP', 'SL'].includes(s)) days.push(rel(60));
  if (s === 'SL') days.push(fix(8, 15));
  if (s === 'TH') days.push(fix(9, 20));
  if (['BB', 'HB', 'HH', 'MV', 'NI', 'SN', 'ST', 'SH', 'TH'].includes(s)) days.push(fix(10, 31));
  if (['BW', 'BY', 'NW', 'RP', 'SL'].includes(s)) days.push(fix(11, 1));
  if (s === 'SN') {
    // Buß- und Bettag: the Wednesday before 23 November
    const d = fix(11, 22);
    while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
    days.push(d);
  }
  return new Set(days.map(key));
}

/** isHoliday(date) for one state, caching the years it was asked about. */
export function holidayChecker(state?: string): (d: Date) => boolean {
  const years = new Map<number, Set<string>>();
  return (d) => {
    let set = years.get(d.getFullYear());
    if (!set) years.set(d.getFullYear(), (set = holidays(d.getFullYear(), state)));
    return set.has(key(d));
  };
}
