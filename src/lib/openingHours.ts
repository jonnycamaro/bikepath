/**
 * Reader for the OpenStreetMap `opening_hours` tag.
 *
 * Written from the format description in the OSM wiki
 * (https://wiki.openstreetmap.org/wiki/Key:opening_hours/specification), not from an existing
 * library. It covers the forms that make up almost all real entries:
 *
 *   24/7 · Mo-Fr 08:00-18:00 · Mo,We 08:00-12:00,14:00-18:00 · Sa 22:00-02:00 (past midnight)
 *   Su off · PH off · Mo-Fr,PH 10:00-16:00 · Apr-Oct Mo-Su 10:00-18:00 · rules joined by ";" or ","
 *
 * Anything else (sunrise, school holidays, single dates, "open end", comments, week numbers …)
 * makes the whole value "not understood": the app then shows the text as it is and claims
 * nothing about being open, rather than claiming something wrong.
 */

/** minutes since midnight; `to` may exceed 1440 for times past midnight */
export interface Interval {
  from: number;
  to: number;
}

interface Rule {
  /** weekdays 0 = Monday … 6 = Sunday; null = every day (unless `ph` restricts it) */
  days: Set<number> | null;
  /** applies on public holidays */
  ph: boolean;
  /** months 0 … 11; null = all year */
  months: Set<number> | null;
  /** opening times, or [] for closed */
  times: Interval[];
  /** "," rule: adds to earlier rules instead of replacing them */
  additional: boolean;
}

export interface OpeningHours {
  raw: string;
  rules: Rule[];
}

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_ALIASES: Record<string, string> = { Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa', Sun: 'Su' };

class NotUnderstood extends Error {}

/** "Apr-Oct" / "Dec,Jan" -> month numbers */
function monthSet(tok: string): Set<number> {
  const out = new Set<number>();
  for (const part of tok.split(',')) {
    const [a, b] = part.split('-');
    const i = MONTHS.indexOf(a);
    const j = b === undefined ? i : MONTHS.indexOf(b);
    if (i < 0 || j < 0) throw new NotUnderstood();
    for (let m = i; ; m = (m + 1) % 12) {
      out.add(m);
      if (m === j) break;
    }
  }
  return out;
}

/** "Mo-Fr,Su,PH" -> weekdays and whether public holidays are included */
function daySelector(tok: string): { days: Set<number> | null; ph: boolean } {
  const days = new Set<number>();
  let ph = false;
  for (let part of tok.split(',')) {
    if (part === 'PH') {
      ph = true;
      continue;
    }
    part = part.replace(/[A-Z][a-z]{2}/g, (d) => DAY_ALIASES[d] ?? d);
    const [a, b] = part.split('-');
    const i = DAYS.indexOf(a);
    const j = b === undefined ? i : DAYS.indexOf(b);
    if (i < 0 || j < 0) throw new NotUnderstood();
    for (let d = i; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === j) break;
    }
  }
  return { days: days.size ? days : null, ph };
}

const time = (s: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new NotUnderstood();
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 48 || min > 59) throw new NotUnderstood();
  return h * 60 + min;
};

/** "08:00-12:00,14:00-18:00" */
function timeSelector(tok: string): Interval[] {
  return tok.split(',').map((span) => {
    const [a, b] = span.split('-');
    if (b === undefined) throw new NotUnderstood();
    const from = time(a);
    let to = time(b);
    if (to <= from) to += 1440; // past midnight: 22:00-02:00
    return { from, to };
  });
}

function parseRule(text: string, additional: boolean): Rule {
  const rule: Rule = { days: null, ph: false, months: null, times: [{ from: 0, to: 1440 }], additional };
  let tokens = text.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new NotUnderstood();
  if (tokens.join(' ') === '24/7') return rule;
  // state at the end: off / closed / open
  const last = tokens[tokens.length - 1];
  let closed = false;
  if (last === 'off' || last === 'closed') {
    closed = true;
    tokens = tokens.slice(0, -1);
  } else if (last === 'open') tokens = tokens.slice(0, -1);
  let sawTime = false;
  for (const tok of tokens) {
    if (/^[A-Z][a-z]{2}(-[A-Z][a-z]{2})?(,[A-Z][a-z]{2}(-[A-Z][a-z]{2})?)*$/.test(tok) && MONTHS.includes(tok.slice(0, 3)) && !DAY_ALIASES[tok.slice(0, 3)]) {
      rule.months = monthSet(tok);
    } else if (/^(PH|Mo|Tu|We|Th|Fr|Sa|Su|Mon|Tue|Wed|Thu|Fri|Sat|Sun)([,-]|$)/.test(tok)) {
      const s = daySelector(tok);
      rule.days = s.days;
      rule.ph = s.ph;
    } else if (/^\d{1,2}:\d{2}-/.test(tok)) {
      rule.times = timeSelector(tok);
      sawTime = true;
    } else throw new NotUnderstood();
  }
  if (closed) rule.times = [];
  // a rule must say something: a day, a month or a time
  if (!sawTime && !closed && !rule.days && !rule.ph && !rule.months) throw new NotUnderstood();
  return rule;
}

/**
 * Parse an opening_hours value; null if it uses forms this reader does not support.
 * "," separates rules only where the next part starts with a day, holiday or month
 * (otherwise it separates time spans or days inside one rule).
 */
export function parseOpeningHours(raw: string | undefined): OpeningHours | null {
  if (!raw) return null;
  // tidy common spellings: "Mo - Fr", "08:00 - 12:00", "08:00-12:00, 14:00-18:00"
  const value = raw.trim().replace(/\s*-\s*/g, '-').replace(/,\s+(?=\d)/g, ',');
  if (!value || /["\[\]]|sun(rise|set)|dawn|dusk|\bSH\b|\bweek\b|\+|\|\||\d{4}/.test(value)) return null;
  try {
    const rules: Rule[] = [];
    for (const normal of value.split(';')) {
      if (!normal.trim()) continue;
      const parts = normal.split(/,\s+(?=(?:PH|Mo|Tu|We|Th|Fr|Sa|Su|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b)/);
      // "Mo, We 10:00-12:00": a part with only days belongs to the next one
      for (let i = parts.length - 2; i >= 0; i--)
        if (/^[A-Za-z,-]+$/.test(parts[i].trim()) && !/\b(off|closed)\b/.test(parts[i])) parts.splice(i, 2, `${parts[i].trim()},${parts[i + 1].trim()}`);
      parts.forEach((p, i) => rules.push(parseRule(p, i > 0)));
    }
    return rules.length ? { raw: value, rules } : null;
  } catch (e) {
    if (e instanceof NotUnderstood) return null;
    throw e;
  }
}

const weekday = (d: Date) => (d.getDay() + 6) % 7; // 0 = Monday

/** Opening times of one calendar day as written for that day (may run past midnight). */
function ownTimes(oh: OpeningHours, d: Date, holiday: boolean): Interval[] {
  let out: Interval[] = [];
  const wd = weekday(d);
  for (const r of oh.rules) {
    if (r.months && !r.months.has(d.getMonth())) continue;
    const dayMatch = r.days ? r.days.has(wd) : !r.ph;
    if (!(dayMatch || (r.ph && holiday))) continue;
    // a later normal rule replaces what earlier rules said for this day; "," rules add
    out = r.additional ? [...out, ...r.times] : [...r.times];
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Times the place is open on day `d` (00:00-24:00), including what runs over from the day before. */
export function timesOn(oh: OpeningHours, d: Date, isHoliday: (d: Date) => boolean): Interval[] {
  const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
  const spill = ownTimes(oh, prev, isHoliday(prev))
    .filter((t) => t.to > 1440)
    .map((t) => ({ from: 0, to: t.to - 1440 }));
  const own = ownTimes(oh, d, isHoliday(d)).map((t) => ({ from: t.from, to: Math.min(t.to, 1440) }));
  // merge overlapping or touching spans
  const all = [...spill, ...own].sort((a, b) => a.from - b.from);
  const merged: Interval[] = [];
  for (const t of all) {
    const last = merged[merged.length - 1];
    if (last && t.from <= last.to) last.to = Math.max(last.to, t.to);
    else merged.push({ ...t });
  }
  return merged;
}

const at = (d: Date, minutes: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);

export interface OpenState {
  open: boolean;
  /** when the state changes next; undefined = not within the next week (e.g. 24/7) */
  change?: Date;
}

/** Open right now, and until / from when. */
export function openState(oh: OpeningHours, now: Date, isHoliday: (d: Date) => boolean): OpenState {
  const mins = now.getHours() * 60 + now.getMinutes();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Array.from({ length: 8 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  // flatten the next 8 days into one timeline
  const spans: { from: Date; to: Date }[] = [];
  for (const d of days)
    for (const t of timesOn(oh, d, isHoliday)) {
      const s = { from: at(d, t.from), to: at(d, t.to) };
      const last = spans[spans.length - 1];
      if (last && last.to.getTime() === s.from.getTime()) last.to = s.to; // 24:00 = 00:00 next day
      else spans.push(s);
    }
  const nowT = at(today, mins).getTime();
  const current = spans.find((s) => s.from.getTime() <= nowT && nowT < s.to.getTime());
  if (current) {
    const horizon = at(days[days.length - 1], 1440).getTime();
    return { open: true, change: current.to.getTime() >= horizon ? undefined : current.to };
  }
  const next = spans.find((s) => s.from.getTime() > nowT);
  return { open: false, change: next?.from };
}

const pad = (n: number) => String(n).padStart(2, '0');
/** 450 -> "07:30", 1440 -> "24:00" */
export const clock = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
