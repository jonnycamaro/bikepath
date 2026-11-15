import { describe, expect, it } from 'vitest';
import { easter, holidayChecker, holidays } from '../src/lib/holidays';
import { clock, openState, parseOpeningHours, timesOn } from '../src/lib/openingHours';
import { commonsFileFromUrl, osmRefFromTileId } from '../src/lib/placeDetails';

const noHoliday = () => false;
/** 2026-11-16 is a Monday */
const day = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m);
const times = (raw: string, d: Date, isHoliday = noHoliday) => timesOn(parseOpeningHours(raw)!, d, isHoliday).map((t) => `${clock(t.from)}-${clock(t.to)}`);

describe('opening hours', () => {
  it('reads weekdays, closed days and holidays (Aldi Nüttermoor)', () => {
    const raw = 'Mo-Sa 07:00-21:00; Su off; PH off';
    expect(times(raw, day(16))).toEqual(['07:00-21:00']);
    expect(times(raw, day(22))).toEqual([]); // Sunday
    expect(times(raw, day(16), () => true)).toEqual([]); // a holiday on a Monday
  });

  it('reads several spans, lists and spaces around the dash', () => {
    expect(times('Mo,We 08:00-12:00,14:00-18:00', day(18))).toEqual(['08:00-12:00', '14:00-18:00']);
    expect(times('Mo - Fr 08:00 - 12:00, 14:00 - 18:00', day(20))).toEqual(['08:00-12:00', '14:00-18:00']);
    expect(times('Mo, We 10:00-12:00', day(18))).toEqual(['10:00-12:00']);
    expect(times('Mo, We 10:00-12:00', day(17))).toEqual([]);
  });

  it('carries times past midnight into the next day', () => {
    const raw = 'Fr,Sa 18:00-02:00';
    expect(times(raw, day(20))).toEqual(['18:00-24:00']);
    expect(times(raw, day(21))).toEqual(['00:00-02:00', '18:00-24:00']);
    expect(times(raw, day(22))).toEqual(['00:00-02:00']);
  });

  it('lets later rules replace earlier ones and "," rules add to them', () => {
    expect(times('Mo-Su 09:00-18:00; Mo off', day(16))).toEqual([]);
    expect(times('Mo-Fr 08:00-12:00, Sa 09:00-11:00', day(21))).toEqual(['09:00-11:00']);
    expect(times('Mo-Fr 08:00-17:00; Mo-Fr,PH 10:00-16:00', day(17))).toEqual(['10:00-16:00']);
  });

  it('knows 24/7 and month ranges', () => {
    expect(times('24/7', day(18))).toEqual(['00:00-24:00']);
    expect(times('Apr-Oct Mo-Su 10:00-18:00', day(18))).toEqual([]);
    expect(times('Apr-Oct Mo-Su 10:00-18:00', new Date(2026, 5, 3))).toEqual(['10:00-18:00']);
  });

  it('refuses forms it does not understand instead of guessing', () => {
    for (const raw of ['Mo-Fr 08:00-18:00; SH off', 'sunrise-sunset', 'Mo-Fr 08:00+', 'Mo[1] 10:00-12:00', '"nach Vereinbarung"', 'Mo-Fr 08:00-18:00 || "auf Anfrage"', 'Dec 24 off', 'by appointment'])
      expect(parseOpeningHours(raw), raw).toBeNull();
  });

  it('says whether it is open now and until when', () => {
    const oh = parseOpeningHours('Mo-Sa 07:00-21:00; Su off')!;
    const open = openState(oh, day(16, 10), noHoliday);
    expect(open.open).toBe(true);
    expect(open.change).toEqual(day(16, 21));
    const sat = openState(oh, day(21, 22), noHoliday); // Saturday evening -> Monday 07:00
    expect(sat).toEqual({ open: false, change: day(23, 7) });
    expect(openState(parseOpeningHours('24/7')!, day(16, 3), noHoliday)).toEqual({ open: true, change: undefined });
    // over midnight: Friday 01:00 still open from Thursday
    expect(openState(parseOpeningHours('Th 20:00-02:00')!, day(20, 1), noHoliday)).toEqual({ open: true, change: day(20, 2) });
  });
});

describe('German public holidays', () => {
  it('computes Easter', () => {
    expect(easter(2026)).toEqual(new Date(2026, 3, 5));
    expect(easter(2027)).toEqual(new Date(2027, 2, 28));
  });

  it('knows nationwide and state holidays', () => {
    const ni = holidays(2026, 'NI');
    expect(ni.has('2026-10-3')).toBe(true); // Tag der Deutschen Einheit
    expect(ni.has('2026-10-31')).toBe(true); // Reformationstag in Niedersachsen
    expect(ni.has('2026-6-4')).toBe(false); // Fronleichnam not in Niedersachsen
    expect(holidays(2026, 'RP').has('2026-6-4')).toBe(true); // … but in Rheinland-Pfalz
    expect(holidays(2026, 'SN').has('2026-11-18')).toBe(true); // Buß- und Bettag
    expect(holidayChecker('NI')(new Date(2026, 3, 3))).toBe(true); // Karfreitag
  });
});

describe('place details', () => {
  it('maps map-tile POI ids to OpenStreetMap objects', () => {
    expect(osmRefFromTileId(4139531952)).toBe('W413953195'); // Aldi Nüttermoor
    expect(osmRefFromTileId(35397573701)).toBe('N3539757370');
    expect(osmRefFromTileId(210610463)).toBe('R21061046');
    expect(osmRefFromTileId(-5)).toBeUndefined();
  });

  it('finds the Commons file behind a Wikipedia image address', () => {
    expect(commonsFileFromUrl('https://upload.wikimedia.org/wikipedia/commons/e/e5/Cochem%2C_Reichsburg%2C_2012-08_CN-01.jpg?utm_source=de.wikipedia.org')).toBe('Cochem,_Reichsburg,_2012-08_CN-01.jpg');
    expect(commonsFileFromUrl('https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e5/A.jpg/330px-A.jpg')).toBe('A.jpg');
    expect(commonsFileFromUrl('https://upload.wikimedia.org/wikipedia/de/1/12/Local.jpg')).toBeUndefined(); // only on de.wikipedia: licence unclear
  });
});
