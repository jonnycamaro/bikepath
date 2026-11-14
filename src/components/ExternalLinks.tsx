import { useEffect, useState } from 'react';
import { googleMapsUrl, tripadvisorUrl } from '../lib/externalLinks';
import type { Place } from '../lib/geocode';
import { reverseTown } from '../lib/geocode';
import { IconExternal } from './icons';

/**
 * Buttons that open a place in Google Maps or Tripadvisor (plain links, no API). The town is
 * looked up so the search there finds the right entry.
 */
export default function ExternalLinks({ place }: { place: Place }) {
  const [town, setTown] = useState<string | null>(null);
  const named = place.name && place.name !== place.detail && place.kind !== 'coord' && place.kind !== 'me';
  useEffect(() => {
    setTown(null);
    if (!named) return;
    const ctrl = new AbortController();
    reverseTown(place.lngLat, ctrl.signal).then((t) => !ctrl.signal.aborted && setTown(t));
    return () => ctrl.abort();
  }, [place.lngLat[0], place.lngLat[1], named]);

  const name = named ? place.name : undefined;
  const ta = tripadvisorUrl(name, place.kind, town);
  return (
    <div className="row ext-links" data-testid="ext-links">
      <a className="btn sm grow" href={googleMapsUrl(name, place.lngLat, town)} target="_blank" rel="noopener noreferrer" data-testid="link-google">
        <IconExternal size={16} /> Google Maps
      </a>
      {ta && (
        <a className="btn sm grow" href={ta} target="_blank" rel="noopener noreferrer" data-testid="link-tripadvisor">
          <IconExternal size={16} /> Tripadvisor
        </a>
      )}
    </div>
  );
}
