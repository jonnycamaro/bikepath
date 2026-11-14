import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { reverseGeocode } from '../lib/geocode';
import { bikeById, rideSpeed } from '../lib/bike';
import { destination, formatDuration, haversine, type LngLat } from '../lib/geo';
import { styleById, styleFor } from '../lib/mapStyles';
import { compassName, loopBounds, loopReach, type LoopStop } from '../lib/roundtrip';
import { useStore } from '../store';
import { mapRef } from './MapView';
import SearchBox from './SearchBox';
import { Amount } from './BikeSheet';
import { Modal, ProfileSelector, ProfileSheet } from './Sheets';
import { IconCheck, IconClock, IconClose, IconDown, IconLocate, IconMapPin, IconRuler } from './icons';

/** Small compass face with a needle pointing in `dir`. */
export function DirBadge({ dir, size = 38 }: { dir: number; size?: number }) {
  return (
    <svg className="dir-badge" width={size} height={size} viewBox="-20 -20 40 40" aria-hidden>
      <circle r="18.5" className="face" />
      {[0, 90, 180, 270].map((a) => <line key={a} x1="0" y1="-18" x2="0" y2="-14.5" transform={`rotate(${a})`} className="tick" />)}
      <g transform={`rotate(${dir})`}>
        <path d="M0 -13 L5.2 3.5 L0 0.6 L-5.2 3.5 Z" className="needle" />
      </g>
    </svg>
  );
}

interface StartPoint {
  lngLat: LngLat;
  name?: string;
}

/** How big the round trip should be: a length or a riding time. */
interface Goal {
  mode: 'distance' | 'time';
  km: number;
  min: number;
}

/** Values of the last planned round trip, so reopening the sheet starts from them. */
const draft = { mode: 'distance' as Goal['mode'], km: 30, min: 90, dir: 45 };

const KM_PRESETS = [10, 20, 30, 40, 50, 60, 80, 100];
const MIN_PRESETS = [30, 45, 60, 90, 120, 180, 240, 300];
const KM_RANGE = [5, 200] as const;
const MIN_RANGE = [15, 600] as const;

/** 90 -> "1½ h", 45 -> "45 min" – short enough for a chip */
const shortTime = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)}${min % 60 === 30 ? '½' : min % 60 ? `:${String(min % 60).padStart(2, '0')}` : ''} h`);
const kmOf = (g: Goal, speed: number) => (g.mode === 'time' ? (g.min / 60) * speed : g.km);
/** next value on the step grid, so 32 km + becomes 35 and not 37 */
const stepTo = (v: number, step: number, dir: -1 | 1, [lo, hi]: readonly [number, number]) =>
  Math.min(hi, Math.max(lo, dir > 0 ? Math.floor(v / step) * step + step : Math.ceil(v / step) * step - step));

/** Sheet on top of the round-trip sheet: choose between a length and a riding time, and set it. */
function GoalSheet({ goal, speed, bike, onApply, onClose }: { goal: Goal; speed: number; bike: string; onApply: (g: Goal) => void; onClose: () => void }) {
  const [g, setG] = useState(goal);
  const time = g.mode === 'time';
  const pace = `${String(speed).replace('.', ',')} km/h`;
  return (
    <Modal title="Umfang der Rundtour" onClose={onClose} testid="goal-sheet">
      <div className="segmented goal-mode" role="tablist">
        <button role="tab" aria-selected={!time} className={time ? '' : 'active'} onClick={() => setG({ ...g, mode: 'distance' })} data-testid="goal-distance"><IconRuler size={17} /> Distanz</button>
        <button role="tab" aria-selected={time} className={time ? 'active' : ''} onClick={() => setG({ ...g, mode: 'time' })} data-testid="goal-time"><IconClock size={17} /> Zeit</button>
      </div>

      {time ? (
        <Amount
          label="Fahrzeit"
          testid="goal-amount"
          value={g.min < 60 ? String(g.min) : `${Math.floor(g.min / 60)}:${String(g.min % 60).padStart(2, '0')}`}
          unit={g.min < 60 ? 'Minuten' : 'Stunden'}
          canDown={g.min > MIN_RANGE[0]}
          canUp={g.min < MIN_RANGE[1]}
          onStep={(d) => setG({ ...g, min: stepTo(g.min, 15, d, MIN_RANGE) })}
        />
      ) : (
        <Amount
          label="Distanz"
          testid="goal-amount"
          value={String(g.km)}
          unit="Kilometer"
          canDown={g.km > KM_RANGE[0]}
          canUp={g.km < KM_RANGE[1]}
          onStep={(d) => setG({ ...g, km: stepTo(g.km, 5, d, KM_RANGE) })}
        />
      )}
      <div className="amount-note" data-testid="goal-note">
        {time
          ? <>Das sind etwa <b>{Math.round(kmOf(g, speed))} km</b> mit deinem {bike} ({pace}). Steigungen kosten Zeit und verkürzen die Strecke.</>
          : <>Das sind etwa <b>{formatDuration((g.km / speed) * 3600)}</b> Fahrzeit mit deinem {bike} ({pace}).</>}
      </div>

      <div className="preset-grid">
        {(time ? MIN_PRESETS : KM_PRESETS).map((v) => (
          <button
            key={v}
            className={`preset ${(time ? g.min : g.km) === v ? 'active' : ''}`}
            onClick={() => setG(time ? { ...g, min: v } : { ...g, km: v })}
          >
            {time ? shortTime(v) : `${v} km`}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <button className="btn primary block" onClick={() => onApply(g)} data-testid="goal-apply"><IconCheck size={18} /> Übernehmen</button>
    </Modal>
  );
}

export function RoundTripSheet() {
  const s = useStore();
  const loop = s.loop;
  const speed = rideSpeed(s.settings, s.profileId);
  const bike = bikeById(s.settings.bikeType).label;
  const [goal, setGoal] = useState<Goal>(() =>
    loop
      ? { mode: loop.duration ? 'time' : 'distance', km: loop.duration ? draft.km : Math.round(loop.distance / 1000), min: loop.duration ? Math.round(loop.duration / 60) : draft.min }
      : { mode: draft.mode, km: draft.km, min: draft.min },
  );
  const [dir, setDir] = useState(loop ? loop.direction : draft.dir);
  const [start, setStart] = useState<StartPoint | null>(() => {
    const wp = s.waypoints[0];
    if (wp) return { lngLat: wp.lngLat, name: wp.name };
    if (s.fix) return { lngLat: s.fix.lngLat, name: 'Mein Standort' };
    const c = mapRef.current?.getCenter();
    return c ? { lngLat: [c.lng, c.lat] } : null;
  });
  const [stops, setStops] = useState<LoopStop[]>(() => (loop ? s.waypoints.slice(1).map((w) => ({ id: w.id, lngLat: w.lngLat, name: w.name })) : []));
  const [stacked, setStacked] = useState<null | 'where' | 'stop' | 'goal' | 'profile'>(null);
  const close = () => s.setSheet(null);
  const distance = kmOf(goal, speed) * 1000;

  // name a start that was set on the map
  useEffect(() => {
    if (!start || start.name) return;
    const ctrl = new AbortController();
    reverseGeocode(start.lngLat, ctrl.signal)
      .then((n) => n && setStart((cur) => (cur && cur.lngLat === start.lngLat ? { ...cur, name: n } : cur)))
      .catch(() => {});
    return () => ctrl.abort();
  }, [start]);

  const create = (variant: number) => {
    if (!start) return;
    Object.assign(draft, goal, { dir });
    s.setLoop(
      { start: start.lngLat, distance, duration: goal.mode === 'time' ? goal.min * 60 : undefined, direction: dir, variant, reversed: loop?.reversed },
      start.name,
      stops,
    );
    s.setTab('plan');
    const [w, so, e, n] = loopBounds(start.lngLat, distance, dir);
    const lons = [w, e, ...stops.map((p) => p.lngLat[0])];
    const lats = [so, n, ...stops.map((p) => p.lngLat[1])];
    s.focusMap({ bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] });
    close();
  };

  if (stacked === 'where' && start) {
    return (
      <RoundTripPicker
        start={start}
        dir={dir}
        distance={distance}
        stops={stops}
        onClose={() => setStacked(null)}
        onApply={(st, d) => {
          setStart(st);
          setDir(d);
          setStacked(null);
        }}
      />
    );
  }

  if (stacked === 'stop' && start) {
    return (
      <StopPicker
        start={start}
        stops={stops}
        // open where a stop is likely wanted: a little way out in the chosen direction
        center={destination(start.lngLat, loopReach(distance) * 0.5, dir)}
        distance={distance}
        onClose={() => setStacked(null)}
        onApply={(p) => {
          setStops([...stops, p]);
          setStacked(null);
        }}
      />
    );
  }

  return (
    <>
      <Modal title="Rundtour planen" onClose={close} testid="roundtrip-sheet">
        <h3 style={{ marginTop: 4 }}>Umfang</h3>
        <button className="profile-select" onClick={() => setStacked('goal')} data-testid="roundtrip-goal">
          <span className="goal-badge">{goal.mode === 'time' ? <IconClock size={18} /> : <IconRuler size={18} />}</span>
          <span className="grow">
            <span className="title">{goal.mode === 'time' ? formatDuration(goal.min * 60) : `${goal.km} km`}</span>
            <span className="meta">
              {goal.mode === 'time' ? `Zeitvorgabe · etwa ${Math.round(kmOf(goal, speed))} km` : `Distanz · etwa ${formatDuration((goal.km / speed) * 3600)} Fahrzeit`}
            </span>
          </span>
          <IconDown size={18} className="chev" />
        </button>

        <h3>Start und Richtung</h3>
        <button className="profile-select" disabled={!start} onClick={() => setStacked('where')} data-testid="roundtrip-where">
          <DirBadge dir={dir} />
          <span className="grow">
            <span className="title">{start?.name ?? (start ? 'Punkt auf der Karte' : 'Kein Startpunkt')}</span>
            <span className="meta">Richtung {compassName(dir)} · {dir}°</span>
          </span>
          <IconDown size={18} className="chev" />
        </button>

        <h3>Zwischenstopps <span className="optional">optional</span></h3>
        {stops.length > 0 && (
          <div className="wps" data-testid="roundtrip-stops" style={{ marginBottom: 8 }}>
            {stops.map((p, i) => (
              <div className="wp" key={p.id ?? i}>
                <div className="dot" style={{ background: 'var(--primary)' }}>{i + 1}</div>
                <div className="name">{p.name ?? `${p.lngLat[1].toFixed(5)}, ${p.lngLat[0].toFixed(5)}`}</div>
                <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setStops(stops.filter((x) => x !== p))} aria-label="Zwischenstopp entfernen"><IconClose size={16} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="grow">
            <SearchBox placeholder={stops.length ? 'Weiteren Zwischenstopp suchen' : 'Zwischenstopp suchen'} poiTitle="Zwischenstopp wählen" onSelect={(p) => setStops([...stops, { lngLat: p.lngLat, name: p.name }])} />
          </div>
          <button className="icon-btn pick-on-map" disabled={!start} onClick={() => setStacked('stop')} aria-label="Zwischenstopp auf der Karte wählen" title="Auf der Karte wählen" data-testid="roundtrip-stop-map">
            <IconMapPin size={22} />
          </button>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>Ort suchen oder mit dem Pin auf der Karte wählen. Die Rundtour führt an den Stopps vorbei.</div>

        <h3>Routenoption</h3>
        <ProfileSelector onOpen={() => setStacked('profile')} />

        <div className="spacer" />
        <button className="btn primary block" disabled={!start} onClick={() => create(loop?.variant ?? 0)} data-testid="roundtrip-go">
          {loop ? 'Rundtour aktualisieren' : 'Rundtour erstellen'}
        </button>
        {loop && (
          <>
            <div className="spacer" />
            <button className="btn block" disabled={!start} onClick={() => create(loop.variant + 1)}>Andere Variante</button>
          </>
        )}
      </Modal>
      {stacked === 'profile' && <ProfileSheet onClose={() => setStacked(null)} />}
      {stacked === 'goal' && (
        <GoalSheet
          goal={goal}
          speed={speed}
          bike={bike}
          onClose={() => setStacked(null)}
          onApply={(g) => {
            setGoal(g);
            setStacked(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Full-screen map to choose a stop: move the map until the pin sits on the place (or tap
 * it, or search), then confirm. Start and the stops chosen so far are shown for orientation.
 */
function StopPicker({ start, stops, center, distance, onApply, onClose }: {
  start: StartPoint;
  stops: LoopStop[];
  center: LngLat;
  distance: number;
  onApply: (stop: LoopStop) => void;
  onClose: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const [at, setAt] = useState<LngLat>(center);
  const [name, setName] = useState<string | undefined>();
  const [moving, setMoving] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  /** set by a search result, so the following map move keeps its name */
  const picked = useRef<string | undefined>();

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: styleFor(styleById(settings.mapStyle)),
      center,
      // the whole tour area is in view: about its reach from edge to edge
      zoom: Math.min(14, Math.max(8, Math.log2((78271.517 * Math.cos((center[1] * Math.PI) / 180) * 340) / (loopReach(distance) * 0.9)))),
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    const mark = (kind: string, label: string, p: LngLat) => {
      const el = document.createElement('div');
      el.className = `wp-marker ${kind}`;
      el.textContent = label;
      el.style.cursor = 'default';
      new maplibregl.Marker({ element: el }).setLngLat(p).addTo(m);
    };
    mark('start', 'A', start.lngLat);
    stops.forEach((p, i) => mark('via', String(i + 1), p.lngLat));
    m.on('movestart', () => setMoving(true));
    m.on('moveend', () => {
      const c = m.getCenter();
      setMoving(false);
      setName(picked.current);
      picked.current = undefined;
      setAt([c.lng, c.lat]);
    });
    m.on('click', (e) => m.easeTo({ center: e.lngLat, duration: 300 }));
    return () => {
      map.current = null;
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // name the place under the pin
  useEffect(() => {
    if (name) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => reverseGeocode(at, ctrl.signal).then((n) => n && setName(n)).catch(() => {}), 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [at, name]);

  const km = haversine(start.lngLat, at) / 1000;
  return (
    <div className="rt-picker" data-testid="stop-picker">
      <div className="rt-map">
        <div ref={box} className="rt-canvas" />
        <div className="rt-top">
          <button className="fab small" onClick={onClose} aria-label="Zurück"><IconClose size={20} /></button>
          <div className="grow">
            <SearchBox
              placeholder="Ort suchen"
              onSelect={(p) => {
                picked.current = p.name;
                map.current?.easeTo({ center: p.lngLat, zoom: Math.max(map.current.getZoom(), 13), duration: 400 });
              }}
            />
          </div>
        </div>
        <svg className={`stop-pin ${moving ? 'moving' : ''}`} viewBox="-20 -46 40 52" aria-hidden>
          <ellipse cx="0" cy="0" rx="6" ry="2.4" className="shade" />
          <g className="body">
            <path d="M0 0C-3 -9 -14 -16 -14 -28a14 14 0 0 1 28 0C14 -16 3 -9 0 0Z" className="drop" />
            <circle cy="-28" r="5.2" className="eye" />
          </g>
        </svg>
      </div>
      <div className="rt-panel">
        <div className="rt-dir stop-name" data-testid="stop-picker-name">{name?.split(',')[0] ?? (moving ? '…' : `${at[1].toFixed(5)}, ${at[0].toFixed(5)}`)}</div>
        <div className="muted small">
          {km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km Luftlinie vom Start · Karte verschieben oder antippen, bis der Pin auf dem Ort sitzt.
        </div>
        <div className="spacer" />
        <button className="btn primary block" onClick={() => onApply({ lngLat: map.current ? [map.current.getCenter().lng, map.current.getCenter().lat] : at, name })} data-testid="stop-picker-apply">
          <IconCheck size={18} /> Als Zwischenstopp übernehmen
        </button>
      </div>
    </div>
  );
}

/** Distance of the arrow tip from the start, in dial units (the dial is 100 units in radius). */
const TIP = 84;

const snapDir = (deg: number) => {
  const d = ((Math.round(deg / 5) * 5) % 360 + 360) % 360;
  const near = Math.round(deg / 45) * 45;
  return Math.abs(deg - near) <= 6 ? ((near % 360) + 360) % 360 : d;
};

/**
 * Full-screen map to choose where the round trip starts and which way it heads.
 * The start is the centre of the map (move the map, tap, or search). The arrow shows the
 * heading and is the control for it: grab it anywhere and drag it round. Its tip lies about
 * where the tour turns back; the shape in between is up to the roads, so none is drawn.
 */
function RoundTripPicker({ start, dir: dir0, distance, stops, onApply, onClose }: {
  start: StartPoint;
  dir: number;
  /** length of the tour in metres, for the scale of the map */
  distance: number;
  stops: LoopStop[];
  onApply: (start: StartPoint, dir: number) => void;
  onClose: () => void;
}) {
  const settings = useStore((s) => s.settings);
  const fix = useStore((s) => s.fix);
  const [dir, setDir] = useState(dir0);
  const [turning, setTurning] = useState(false);
  const [moved, setMoved] = useState(false);
  const [name, setName] = useState(start.name);
  const box = useRef<HTMLDivElement>(null);
  const dial = useRef<SVGSVGElement>(null);
  const arrow = useRef<SVGGElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const live = useRef({ dir });
  live.current = { dir };

  /** Zoom so the tip of the arrow is about where the tour turns back. */
  const fitZoom = (animate: boolean) => {
    const m = map.current;
    const el = dial.current;
    if (!m || !el) return;
    const px = (el.getBoundingClientRect().width / 2) * (TIP / 100);
    const lat = m.getCenter().lat;
    const zoom = Math.log2((78271.517 * Math.cos((lat * Math.PI) / 180) * px) / loopReach(distance));
    if (animate) m.easeTo({ zoom, duration: 250 });
    else m.jumpTo({ zoom });
  };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: styleFor(styleById(settings.mapStyle)),
      center: start.lngLat,
      zoom: 11,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    m.touchZoomRotate.disableRotation();
    map.current = m;
    // the stops already chosen, so the arrow can be pointed at them
    stops.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'wp-marker via';
      el.textContent = String(i + 1);
      new maplibregl.Marker({ element: el }).setLngLat(p.lngLat).addTo(m);
    });
    m.on('style.load', () => fitZoom(false));
    m.on('dragend', () => {
      setMoved(true);
      setName(undefined);
    });
    m.on('click', (e) => {
      m.easeTo({ center: e.lngLat, duration: 300 });
      setMoved(true);
      setName(undefined);
    });
    return () => {
      map.current = null;
      m.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // Some mobile browsers ignore touch-action on SVG shapes and start scrolling or zooming
  // instead, which cancels the drag; claiming the touch outright keeps the arrow in the hand.
  useEffect(() => {
    const el = arrow.current;
    if (!el) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
    };
  }, []);

  const pointerDeg = (e: React.PointerEvent) => {
    const r = dial.current!.getBoundingClientRect();
    return (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
  };
  /** angle between the finger and the arrow when it was grabbed, so the arrow does not jump */
  const grabOffset = useRef(0);
  const turnTo = (e: React.PointerEvent) => {
    const next = snapDir((((pointerDeg(e) - grabOffset.current) % 360) + 360) % 360);
    if (next !== live.current.dir) {
      if (next % 45 === 0) navigator.vibrate?.(8);
      setDir(next);
    }
  };
  const grab = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      const off = ((pointerDeg(e) - live.current.dir + 540) % 360) - 180;
      grabOffset.current = Math.abs(off) < 40 ? off : 0;
      setTurning(true);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) turnTo(e);
    },
    onPointerUp: () => setTurning(false),
    onPointerCancel: () => setTurning(false),
  };

  const goTo = (p: LngLat, label?: string) => {
    map.current?.easeTo({ center: p, duration: 400 });
    setMoved(true);
    setName(label);
  };

  const apply = () => {
    const c = map.current?.getCenter();
    const lngLat: LngLat = moved && c ? [c.lng, c.lat] : start.lngLat;
    const atFix = fix && haversine(fix.lngLat, lngLat) < 30;
    onApply({ lngLat, name: name ?? (atFix ? 'Mein Standort' : undefined) }, dir);
  };

  return (
    <div className="rt-picker" data-testid="roundtrip-picker">
      <div className="rt-map">
        <div ref={box} className="rt-canvas" />
        <div className="rt-top">
          <button className="fab small" onClick={onClose} aria-label="Zurück"><IconClose size={20} /></button>
          <div className="grow"><SearchBox placeholder="Startpunkt suchen" onSelect={(p) => goTo(p.lngLat, p.name)} /></div>
        </div>
        <svg ref={dial} className={`rt-dial ${turning ? 'turning' : ''}`} viewBox="-100 -100 200 200">
          <g className="hand" style={{ transform: `rotate(${dir}deg)` }}>
            <g
              ref={arrow}
              {...grab}
              className="arrow"
              role="slider"
              tabIndex={0}
              aria-label="Richtung"
              aria-valuemin={0}
              aria-valuemax={355}
              aria-valuenow={dir}
              aria-valuetext={`${compassName(dir)}, ${dir} Grad`}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight' || e.key === 'ArrowUp') setDir((d) => (d + 5) % 360);
                if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') setDir((d) => (d + 355) % 360);
              }}
            >
              {/* generous invisible grip along the whole arrow */}
              <path d={`M0 -14 L0 ${-TIP + 4}`} className="hit" />
              <circle cy={-TIP + 12} r="26" className="hit-head" />
              <path d={`M0 -14 L0 ${-TIP + 20}`} className="shaft-edge" />
              <path d={`M0 ${-TIP - 2} L17 ${-TIP + 25} L0 ${-TIP + 17} L-17 ${-TIP + 25} Z`} className="head-edge" />
              <path d={`M0 -14 L0 ${-TIP + 20}`} className="shaft" />
              <path d={`M0 ${-TIP - 2} L17 ${-TIP + 25} L0 ${-TIP + 17} L-17 ${-TIP + 25} Z`} className="head" />
            </g>
          </g>
          <circle r="9" className="pin" />
          <circle r="3.4" className="pin-dot" />
        </svg>
      </div>
      <div className="rt-panel">
        <div className="row">
          <div className="grow">
            <div className="rt-dir">{compassName(dir)} <span>{dir}°</span></div>
            <div className="muted small">Karte verschieben oder antippen für den Start. Pfeil anfassen und ziehen für die Richtung.</div>
          </div>
          {fix && (
            <button className="icon-btn" onClick={() => goTo(fix.lngLat, 'Mein Standort')} aria-label="Mein Standort als Start"><IconLocate size={22} /></button>
          )}
        </div>
        <div className="spacer" />
        <button className="btn primary block" onClick={apply} data-testid="roundtrip-apply"><IconCheck size={18} /> Übernehmen</button>
      </div>
    </div>
  );
}
