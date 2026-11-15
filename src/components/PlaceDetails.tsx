import { useEffect, useState } from 'react';
import type { Place } from '../lib/geocode';
import { holidayChecker } from '../lib/holidays';
import { clock, openState, parseOpeningHours, timesOn } from '../lib/openingHours';
import { loadPlaceDetails, type PlaceDetails as Details } from '../lib/placeDetails';
import { IconClock, IconExternal } from './icons';

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

const CUISINE: Record<string, string> = {
  italian: 'italienisch', pizza: 'Pizza', german: 'deutsch', regional: 'regional', burger: 'Burger', asian: 'asiatisch',
  vietnamese: 'vietnamesisch', chinese: 'chinesisch', greek: 'griechisch', turkish: 'türkisch', kebab: 'Döner/Kebab',
  indian: 'indisch', thai: 'thailändisch', japanese: 'japanisch', sushi: 'Sushi', mexican: 'mexikanisch', french: 'französisch',
  spanish: 'spanisch', fish: 'Fisch', seafood: 'Meeresfrüchte', steak_house: 'Steakhaus', sandwich: 'Sandwiches', chicken: 'Hähnchen',
  ice_cream: 'Eis', coffee_shop: 'Kaffee', cake: 'Kuchen', breakfast: 'Frühstück', international: 'international', balkan: 'Balkan',
  american: 'amerikanisch', friture: 'Pommes', bubble_tea: 'Bubble Tea', crepe: 'Crêpes', vegan: 'vegan', vegetarian: 'vegetarisch',
};

const first = (v?: string) => v?.split(';')[0].trim();
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
const withScheme = (url: string) => (/^https?:\/\//.test(url) ? url : `https://${url}`);

/** "Heute", "morgen" or the weekday, for when a place opens or closes. */
function when(d: Date, now: Date): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  const t = clock(d.getHours() * 60 + d.getMinutes());
  return diff === 0 ? `um ${t}` : diff === 1 ? `morgen ${t}` : `${WEEKDAYS[(d.getDay() + 6) % 7]} ${t}`;
}

function OpeningHoursBlock({ raw, state }: { raw: string; state?: string }) {
  const [open, setOpen] = useState(false);
  const oh = parseOpeningHours(raw);
  if (!oh) {
    return (
      <div className="pd-row">
        <IconClock size={18} />
        <div className="grow"><div className="pd-label">Öffnungszeiten</div><div className="pd-raw">{raw}</div></div>
      </div>
    );
  }
  const now = new Date();
  const isHoliday = holidayChecker(state);
  const st = openState(oh, now, isHoliday);
  const status = st.open
    ? st.change ? `Geöffnet · schließt ${when(st.change, now)}` : 'Rund um die Uhr geöffnet'
    : st.change ? `Geschlossen · öffnet ${when(st.change, now)}` : 'Geschlossen';
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  return (
    <div className="pd-hours" data-testid="pd-hours">
      <button className="pd-row pd-status-row" onClick={() => setOpen(!open)} aria-expanded={open}>
        <IconClock size={18} />
        <span className={`pd-status ${st.open ? 'open' : 'closed'}`} data-testid="pd-status">{status}</span>
        <span className="pd-more">{open ? 'weniger' : 'Woche'}</span>
      </button>
      {open && (
        <table className="pd-week">
          <tbody>
            {week.map((d, i) => {
              const t = timesOn(oh, d, isHoliday);
              const today = d.toDateString() === now.toDateString();
              return (
                <tr key={i} className={today ? 'today' : ''}>
                  <td>{WEEKDAYS[i]}{isHoliday(d) ? ' (Feiertag)' : ''}</td>
                  <td>{t.length ? t.map((x) => `${clock(x.from)}–${clock(x.to)}`).join(', ') : 'geschlossen'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Details of a place from OpenStreetMap (and Wikipedia/Commons where linked), loaded when the
 * place is shown. Renders nothing for places without an OSM object (coordinates, own position).
 */
export default function PlaceDetails({ place }: { place: Place }) {
  const [d, setD] = useState<Details | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setD(undefined);
    setFailed(false);
    if (!place.osm) return;
    let alive = true;
    loadPlaceDetails(place.osm)
      .then((r) => alive && setD(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [place.osm]);

  if (!place.osm) return null;
  if (failed) return <div className="pd small muted">Details gerade nicht verfügbar.</div>;
  if (d === undefined) return <div className="pd small muted" data-testid="pd-loading">Details werden geladen …</div>;
  if (!d) return null;

  const t = d.tags;
  const phone = first(t.phone ?? t['contact:phone']);
  const website = first(t.website ?? t['contact:website'] ?? t.url);
  const email = first(t.email ?? t['contact:email']);
  const cuisine = [
    ...(t.cuisine ? t.cuisine.split(';').map((c) => CUISINE[c.trim()] ?? c.trim().replace(/_/g, ' ')) : []),
    ...(t['diet:vegan'] === 'yes' || t['diet:vegan'] === 'only' ? ['vegan'] : []),
    ...(t['diet:vegetarian'] === 'yes' || t['diet:vegetarian'] === 'only' ? ['vegetarisch'] : []),
  ];
  const features = [
    t.wheelchair === 'yes' ? 'Rollstuhlgerecht' : t.wheelchair === 'limited' ? 'Teilweise rollstuhlgerecht' : t.wheelchair === 'no' ? 'Nicht rollstuhlgerecht' : '',
    t.outdoor_seating === 'yes' ? 'Sitzplätze draußen' : '',
    t.internet_access && t.internet_access !== 'no' ? `WLAN${t['internet_access:fee'] === 'no' ? ' (kostenlos)' : ''}` : '',
    t.fee === 'no' ? 'Kostenlos' : t.fee === 'yes' ? 'Kostenpflichtig' : '',
    t['service:bicycle:repair'] === 'yes' ? 'Fahrradreparatur' : '',
    t.drinking_water === 'yes' ? 'Trinkwasser' : '',
    t.ele ? `Höhe ${Math.round(Number(t.ele))} m` : '',
  ].filter(Boolean);

  return (
    <div className="pd" data-testid="place-details">
      {d.image && (
        <figure className="pd-image">
          <img src={d.image.url} alt={d.name ?? place.name} loading="lazy" />
          <figcaption><a href={d.image.source} target="_blank" rel="noopener noreferrer">{d.image.credit}</a></figcaption>
        </figure>
      )}
      {d.address && <div className="pd-address">{d.address}</div>}
      {t.opening_hours && <OpeningHoursBlock raw={t.opening_hours} state={d.state} />}
      {cuisine.length > 0 && <div className="pd-line"><span className="pd-label">Küche</span> {[...new Set(cuisine)].join(', ')}</div>}
      {features.length > 0 && <div className="pd-tags">{features.map((f) => <span key={f} className="pd-tag">{f}</span>)}</div>}
      {(phone || website || email) && (
        <div className="pd-contact">
          {phone && <a className="btn sm" href={`tel:${phone.replace(/[^\d+]/g, '')}`} data-testid="pd-phone">Anrufen</a>}
          {website && <a className="btn sm" href={withScheme(website)} target="_blank" rel="noopener noreferrer" data-testid="pd-website">Webseite</a>}
          {email && <a className="btn sm" href={`mailto:${email}`}>E-Mail</a>}
        </div>
      )}
      {website && <div className="pd-line small muted ellipsis">{host(website)}{phone ? ` · ${phone}` : ''}</div>}
      {!website && phone && <div className="pd-line small muted">{phone}</div>}
      {t.description && <p className="pd-text">{t.description}</p>}
      {d.wiki && (
        <div className="pd-wiki" data-testid="pd-wiki">
          <p className="pd-text">{d.wiki.extract}</p>
          <a href={d.wiki.url} target="_blank" rel="noopener noreferrer"><IconExternal size={14} /> Weiterlesen bei Wikipedia</a>
        </div>
      )}
      <div className="pd-source">
        Daten: <a href={d.osmUrl} target="_blank" rel="noopener noreferrer">© OpenStreetMap-Mitwirkende</a> (ODbL) – fehlt etwas? Dort ergänzen.
        {d.wiki && <> · Text: Wikipedia (CC BY-SA 4.0)</>}
      </div>
    </div>
  );
}
