import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from '../lib/geocode';
import { formatDistance, haversine } from '../lib/geo';
import { useStore } from '../store';
import { IconClose, IconLocate, IconPoi, IconSearch } from './icons';
import PoiPicker from './PoiPicker';

interface Props {
  placeholder?: string;
  onSelect: (p: Place) => void;
  autoFocus?: boolean;
  showMyLocation?: boolean;
  onFocusChange?: (f: boolean) => void;
  /** show a POI button that opens a map of places to pick from; the value is that map's title */
  poiTitle?: string;
}

export default function SearchBox({ placeholder = 'Ort oder Adresse suchen', onSelect, autoFocus, showMyLocation, onFocusChange, poiTitle }: Props) {
  const [poiOpen, setPoiOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Place[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const fix = useStore((s) => s.fix);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      setErr(null);
      return;
    }
    const t = setTimeout(async () => {
      abort.current?.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setBusy(true);
      try {
        const center = fix?.lngLat ?? (window as any).__bikepathMap?.getCenter().toArray();
        setRes(await searchPlaces(q, center, ctrl.signal));
        setErr(null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setErr(navigator.onLine ? 'Suche fehlgeschlagen' : 'Suche ist offline nicht verfügbar');
      } finally {
        setBusy(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (p: Place) => {
    setQ('');
    setRes([]);
    setFocused(false);
    onFocusChange?.(false);
    (document.activeElement as HTMLElement)?.blur();
    onSelect(p);
  };

  return (
    <div>
      <div className="searchbox">
        <IconSearch size={20} style={{ color: '#5b6b7f' }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          enterKeyHint="search"
          onFocus={() => {
            setFocused(true);
            onFocusChange?.(true);
          }}
          onBlur={() => setTimeout(() => { setFocused(false); onFocusChange?.(false); }, 200)}
          onKeyDown={(e) => e.key === 'Enter' && res[0] && pick(res[0])}
          aria-label="Suche"
        />
        {busy && <span className="muted small">…</span>}
        {q && (
          <button onClick={() => setQ('')} aria-label="Suche leeren">
            <IconClose size={18} />
          </button>
        )}
        {poiTitle && (
          <button className="poi-open" onClick={() => setPoiOpen(true)} aria-label="Orte auf der Karte (POIs)" title="Orte auf der Karte" data-testid="poi-open">
            <IconPoi size={22} />
          </button>
        )}
      </div>
      {poiOpen && poiTitle && (
        <PoiPicker
          title={poiTitle}
          onClose={() => setPoiOpen(false)}
          onPick={(p) => {
            setPoiOpen(false);
            onSelect(p);
          }}
        />
      )}
      {(res.length > 0 || err || (focused && showMyLocation && fix)) && (
        <div className="results">
          {focused && showMyLocation && fix && !q && (
            <button className="result" onMouseDown={(e) => e.preventDefault()} onClick={() => pick({ id: 'me', name: 'Mein Standort', detail: '', lngLat: fix.lngLat, kind: 'me' })}>
              <IconLocate size={20} style={{ color: '#0b6bd6' }} />
              <div className="t">Mein Standort</div>
            </button>
          )}
          {err && <div className="result muted">{err}</div>}
          {res.map((p) => (
            <button key={p.id} className="result" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p)}>
              <IconSearch size={18} style={{ color: '#9aa8b8', flexShrink: 0 }} />
              <div className="grow">
                <div className="t">{p.name}</div>
                <div className="d">{p.detail}</div>
              </div>
              {fix && <div className="d">{formatDistance(haversine(fix.lngLat, p.lngLat))}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
