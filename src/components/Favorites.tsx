import { useState } from 'react';
import type { Place } from '../lib/geocode';
import { POI_META } from '../lib/pois';
import { uid, type SavedPlace, type SavedRoute } from '../lib/storage';
import { useStore } from '../store';
import { flattenGroups } from '../lib/groups';
import { IconCheck, IconFolder, IconPlus } from './icons';
import { Modal } from './Sheets';

/** What a favourite is: planned (or imported) route, recorded ride, or place. */
export type FavKind = 'route' | 'ride' | 'place';
export const favKindOf = (r: SavedRoute): FavKind => (r.kind === 'recorded' ? 'ride' : 'route');

const FAV_GLYPH: Record<FavKind, string> = {
  // a planned route: start dot, winding line, flag
  route: '<circle cx="5.5" cy="18.5" r="2.3" fill="currentColor"/><path d="M8 18.5h6a3.4 3.4 0 0 0 0-6.8H10a3.4 3.4 0 0 1 0-6.8h4.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M17 9V2.5h4.5l-1 1.6 1 1.6H17" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  // a recorded ride: recording dot with a track behind it
  ride: '<path d="M3 19c3-1 4-5 7-5s3 3 6 2" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><circle cx="17.5" cy="7" r="4.3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.5" cy="7" r="1.9" fill="currentColor"/>',
  // a place: pin with a star
  place: '<path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="m12 6.4 1.2 2.4 2.6.4-1.9 1.8.5 2.6L12 12.4l-2.3 1.2.4-2.6-1.9-1.8 2.6-.4Z" fill="currentColor"/>',
};
const FAV_COLOR: Record<FavKind, { bg: string; fg: string }> = {
  route: { bg: '#c6ddf6', fg: '#0b5bb5' },
  ride: { bg: '#f7c9ca', fg: '#b3262a' },
  place: { bg: '#f9e3b4', fg: '#9a5b00' },
};
export const FAV_LABEL: Record<FavKind, string> = { route: 'Geplante Route', ride: 'Aufgezeichnete Fahrt', place: 'Ort' };

/** Badge telling at a glance whether a favourite is a route, a recorded ride or a place. */
export function FavSymbol({ kind, poiType, size = 40 }: { kind: FavKind; poiType?: string; size?: number }) {
  const poi = kind === 'place' && poiType ? POI_META[poiType] : undefined;
  const c = FAV_COLOR[kind];
  return (
    <span className="fav-symbol" style={{ width: size, height: size, background: c.bg, color: c.fg }} aria-label={FAV_LABEL[kind]}>
      {poi ? (
        <span className="fav-poi" style={{ background: poi.color }}>{poi.glyph}</span>
      ) : (
        <svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: FAV_GLYPH[kind] }} />
      )}
    </span>
  );
}

/** Choose the favourite group (folder) from the tree – or create a group or sub-group on the spot. */
export function GroupPicker({ value, onChange }: { value: string | undefined; onChange: (id: string | undefined) => void }) {
  const collections = useStore((s) => s.collections);
  /** creating: a top-level group, or a sub-group of the selected one */
  const [adding, setAdding] = useState<null | 'top' | 'sub'>(null);
  const [name, setName] = useState('');
  const selected = collections.find((c) => c.id === value);
  const create = () => {
    const n = name.trim();
    if (!n) return;
    const g = { id: uid(), name: n, createdAt: Date.now(), ...(adding === 'sub' && selected ? { parentId: selected.id } : {}) };
    useStore.getState().setCollections([...collections, g]);
    onChange(g.id);
    setAdding(null);
    setName('');
  };
  return (
    <div data-testid="group-picker">
      <div className="group-list" role="radiogroup">
        <button className={`group-opt ${!value ? 'active' : ''}`} role="radio" aria-checked={!value} onClick={() => onChange(undefined)}>
          <span className="grow">Ohne Gruppe</span>
          {!value && <IconCheck size={16} />}
        </button>
        {flattenGroups(collections).map(({ group, depth }) => (
          <button key={group.id} className={`group-opt ${value === group.id ? 'active' : ''}`} role="radio" aria-checked={value === group.id} onClick={() => onChange(group.id)} style={{ paddingLeft: 12 + depth * 18 }}>
            <IconFolder size={16} />
            <span className="grow">{group.name}</span>
            {value === group.id && <IconCheck size={16} />}
          </button>
        ))}
      </div>
      {adding ? (
        <div className="row" style={{ marginTop: 6 }}>
          <input className="input grow" value={name} placeholder={adding === 'sub' && selected ? `Untergruppe in „${selected.name}“` : 'Name der Gruppe'} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} data-testid="group-name" />
          <button className="icon-btn" onClick={create} disabled={!name.trim()} aria-label="Gruppe anlegen" data-testid="group-create"><IconCheck size={18} /></button>
        </div>
      ) : (
        <div className="chips wrap" style={{ marginTop: 6 }}>
          <button className="chip" onClick={() => setAdding('top')} data-testid="group-new"><IconPlus size={15} /> Neue Gruppe</button>
          {selected && <button className="chip" onClick={() => setAdding('sub')} data-testid="group-new-sub"><IconPlus size={15} /> Untergruppe in „{selected.name}“</button>}
        </div>
      )}
    </div>
  );
}

const near = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 2e-5 && Math.abs(a[1] - b[1]) < 2e-5;
/** The saved favourite for a place, if it is one (same OSM object or same spot). */
export function savedPlaceFor(places: SavedPlace[], p: Place): SavedPlace | undefined {
  return places.find((x) => (p.osm && x.osm === p.osm) || near(x.lngLat, p.lngLat));
}

/** Save a place (POI, search result, tapped point) as a favourite with name and group. */
export function SavePlaceSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const places = useStore((s) => s.places);
  const [name, setName] = useState(place.name);
  const [group, setGroup] = useState<string | undefined>();
  const save = () => {
    const sp: SavedPlace = {
      id: uid(),
      name: name.trim(),
      detail: place.detail,
      lngLat: place.lngLat,
      kind: place.kind,
      osm: place.osm,
      groupId: group,
      createdAt: Date.now(),
    };
    useStore.getState().setPlaces([...places, sp]);
    useStore.getState().toastMsg(`„${sp.name}“ zu den Favoriten hinzugefügt`);
    onClose();
  };
  return (
    <Modal title="Ort als Favorit speichern" onClose={onClose} testid="save-place-sheet">
      <h3 style={{ marginTop: 4 }}>Name</h3>
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name des Favoriten" data-testid="fav-name" />
      <h3>Gruppe</h3>
      <GroupPicker value={group} onChange={setGroup} />
      <div className="spacer" />
      <button className="btn primary block" onClick={save} disabled={!name.trim()} data-testid="fav-save">Speichern</button>
    </Modal>
  );
}
