import { useRef, useState } from 'react';
import { formatClock, formatDistance, formatSpeed } from '../lib/geo';
import { pauseRide, resumeRide, stopRide, toggleMute } from '../session';
import { bboxOf, useStore } from '../store';
import { GroupPicker } from './Favorites';
import ElevationChart from './ElevationChart';
import { IconBike, IconChevron, IconClose, IconList, IconMap, IconMountain, IconMute, IconPause, IconPlay, IconStop, IconVolume, ManeuverIcon } from './icons';

export const COMPUTER_FIELDS: Record<string, string> = {
  speed: 'Geschwindigkeit',
  distance: 'Distanz',
  time: 'Fahrzeit',
  elapsed: 'Gesamtzeit',
  remaining: 'Verbleibend',
  eta: 'Ankunft',
  ascent: 'Aufstieg',
  avg: 'Ø Geschw.',
  max: 'Max. Geschw.',
  clock: 'Uhrzeit',
  grade: 'Steigung',
  climb: 'Anstieg',
  elevation: 'Höhe',
  descent: 'Abstieg',
};

function Field({ id, onChange }: { id: string; onChange?: (id: string) => void }) {
  const s = useStore((st) => st.session)!;
  const imperial = useStore((st) => st.settings.units === 'imperial');
  const unit = imperial ? 'mph' : 'km/h';
  const st = s.stats;
  const split = (txt: string) => {
    const m = /^([\d.,:]+)\s*(.*)$/.exec(txt);
    return m ? (<>{m[1]}<small>{m[2]}</small></>) : txt;
  };
  let v: React.ReactNode = '–';
  switch (id) {
    case 'speed': v = <>{formatSpeed(st.currentSpeed, imperial)}<small>{unit}</small></>; break;
    case 'distance': v = split(formatDistance(st.distance, imperial)); break;
    case 'time': v = formatClock(st.movingTime); break;
    case 'elapsed': v = formatClock(st.elapsed); break;
    case 'remaining': v = s.nav ? split(formatDistance(s.nav.remaining, imperial)) : '–'; break;
    case 'eta': v = s.nav ? new Date(Date.now() + s.nav.remainingTime * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '–'; break;
    case 'ascent': v = <>{st.ascent}<small>m</small></>; break;
    case 'avg': v = <>{formatSpeed(st.avgSpeed, imperial)}<small>{unit}</small></>; break;
    case 'max': v = <>{formatSpeed(st.maxSpeed, imperial)}<small>{unit}</small></>; break;
    case 'clock': v = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); break;
    case 'descent': v = <>{st.descent}<small>m</small></>; break;
    case 'elevation': {
      const c = s.nav && s.route ? s.route.coords[Math.min(s.route.coords.length - 1, Math.max(0, s.route.cum.findIndex((d) => d >= s.nav!.along)))] : null;
      v = c?.[2] != null ? <>{Math.round(c[2])}<small>m</small></> : '–';
      break;
    }
    case 'grade': {
      const cs = s.nav?.climb;
      v = cs?.kind === 'in' ? <>{Math.round(cs.climb.grade)}<small>%</small></> : '—';
      break;
    }
    case 'climb': {
      const cs = s.nav?.climb;
      if (!cs) v = '—';
      else if (cs.kind === 'in') v = <>{cs.index}/{cs.count}<small>{formatDistance(cs.remaining, imperial)}</small></>;
      else v = <><small style={{ marginLeft: 0 }}>in </small>{formatDistance(cs.distance, imperial)}</>;
      break;
    }
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = () => {
    if (!onChange) return;
    timer.current = setTimeout(() => onChange(id), 550);
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <div
      className={`cell ${id === 'speed' ? 'big' : ''}`}
      data-testid={`field-${id}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onContextMenu={(e) => {
        if (!onChange) return;
        e.preventDefault();
        onChange(id);
      }}
    >
      <div className="v">{v}</div>
      <div className="l">{COMPUTER_FIELDS[id]}</div>
    </div>
  );
}

export default function NavigationScreen() {
  const session = useStore((s) => s.session)!;
  const settings = useStore((s) => s.settings);
  const setTab = useStore((s) => s.setTab);
  const setSettings = useStore((s) => s.setSettings);
  const [confirmStop, setConfirmStop] = useState(false);
  const [cues, setCues] = useState(false);
  const [name, setName] = useState('');
  const [group, setGroup] = useState<string | undefined>();
  const [editField, setEditField] = useState<string | null>(null);
  const [layoutPicker, setLayoutPicker] = useState(false);
  const gpsStatus = useStore((s) => s.gpsStatus);
  const { nav, route } = session;
  const imperial = settings.units === 'imperial';

  const layout = settings.layouts.find((l) => l.id === settings.activeLayout) ?? settings.layouts[0];
  const fields = layout.fields.filter((f) => (session.mode === 'navigate' && session.guided) || !['remaining', 'eta'].includes(f));
  const ordered = ['speed', ...fields.filter((f) => f !== 'speed')].slice(0, 7);

  /** Replace one field of the active layout; built-in layouts are copied first. */
  const replaceField = (oldId: string, newId: string) => {
    const base = settings.layouts.find((l) => l.id === settings.activeLayout) ?? settings.layouts[0];
    const fieldsNew = base.fields.map((f) => (f === oldId ? newId : f));
    if (base.builtin) {
      const custom = { id: `custom-${Date.now()}`, name: `${base.name} (angepasst)`, fields: fieldsNew };
      setSettings({ layouts: [...settings.layouts, custom], activeLayout: custom.id });
    } else {
      setSettings({ layouts: settings.layouts.map((l) => (l.id === base.id ? { ...l, fields: fieldsNew } : l)) });
    }
    setEditField(null);
  };

  const overview = () => {
    if (route) {
      useStore.getState().focusMap({ bbox: bboxOf(route) });
    }
  };

  const finish = async (save: boolean) => {
    setConfirmStop(false);
    const saved = await stopRide(save, name.trim() || undefined, group);
    if (saved) {
      useStore.getState().toastMsg('Fahrt in den Favoriten gespeichert');
      useStore.setState({ tab: 'routes' });
      useStore.getState().setDetail(saved.id);
    }
  };

  return (
    <>
      <div className="nav-top" data-testid="nav-screen">
        {gpsStatus !== 'ok' && (
          <div className="row" style={{ justifyContent: 'center', marginBottom: 6 }}>
            <span className="status-pill" style={{ background: 'var(--orange)', color: '#fff' }} data-testid="gps-hint">
              {gpsStatus === 'waiting' ? 'Warten auf GPS' : 'Schwaches GPS-Signal'}
            </span>
          </div>
        )}
        {session.mode === 'navigate' && !session.guided && nav && (
          <div className="banner" data-testid="self-guided-banner">
            <IconBike size={38} />
            <div className="grow">
              <div className="dist" style={{ fontSize: 24 }}>{formatDistance(nav.remaining, imperial)}</div>
              <div className="txt">{nav.offRoute ? 'Abseits der Route' : 'Selbstgeführt – folge der Linie'}</div>
            </div>
          </div>
        )}
        {session.mode === 'navigate' && session.guided && nav && (
          nav.offRoute || session.rerouting ? (
            <div className="banner off">
              <div className="grow">
                <div className="dist" style={{ fontSize: 22 }}>{session.rerouting ? 'Neuberechnung …' : 'Route verlassen'}</div>
                <div className="txt">{formatDistance(nav.distanceFromRoute)} von der Route entfernt</div>
              </div>
            </div>
          ) : nav.approaching ? (
            <div className="banner">
              <ManeuverIcon m="depart" size={44} />
              <div className="grow">
                <div className="dist">{formatDistance(nav.distanceFromRoute, imperial)}</div>
                <div className="txt">Fahre zum Start der Route</div>
              </div>
            </div>
          ) : nav.arrived ? (
            <div className="banner" style={{ background: 'var(--green)' }}>
              <ManeuverIcon m="arrive" size={44} />
              <div className="grow"><div className="dist" style={{ fontSize: 22 }}>Ziel erreicht!</div></div>
            </div>
          ) : nav.next ? (
            <div>
              <div className="banner" data-testid="nav-banner">
                <ManeuverIcon m={nav.next.maneuver} exit={nav.next.exit} size={52} />
                <div className="grow">
                  <div className="dist">{formatDistance(nav.distanceToNext, imperial)}</div>
                  <div className="txt">{nav.next.text}</div>
                </div>
              </div>
              {nav.afterNext && nav.afterNext.along - nav.next.along < 200 && (
                <div className="then"><span>Dann</span><ManeuverIcon m={nav.afterNext.maneuver} size={20} /></div>
              )}
            </div>
          ) : null
        )}
        {session.mode === 'free' && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <span className={`status-pill ${session.status === 'recording' ? 'rec' : ''}`} style={{ background: '#fff', boxShadow: 'var(--shadow)' }}>
              {session.status === 'recording' ? 'Aufnahme läuft' : session.status === 'autopaused' ? 'Auto-Pause' : 'Pausiert'}
            </span>
          </div>
        )}
      </div>

      <div className="fab-col" style={{ bottom: 'calc(var(--computer-h, 330px) + 12px)', zIndex: 33 }}>
        <button className="fab small" onClick={toggleMute} aria-label="Ton">{session.muted ? <IconMute size={20} /> : <IconVolume size={20} />}</button>
        {route && <button className="fab small" onClick={() => setCues(true)} aria-label="Abbiegehinweise"><IconList size={20} /></button>}
        {route && <button className="fab small" onClick={overview} aria-label="Übersicht"><IconMap size={20} /></button>}      </div>

      <div className="computer" data-testid="computer" ref={(el) => el && document.documentElement.style.setProperty('--computer-h', `${el.offsetHeight}px`)}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 2 }}>
          <span className={`status-pill ${session.status === 'recording' ? 'rec' : ''}`}>
            {session.status === 'recording' ? 'REC' : session.status === 'autopaused' ? 'Auto-Pause' : 'Pause'}
          </span>
          <button className="btn ghost sm" onClick={() => setTab('map')}>Minimieren <IconChevron size={14} /></button>
        </div>
        {session.mode === 'navigate' && route && nav && !settings.batterySave && (
          <ElevationChart route={route} height={48} position={nav.along} window={[Math.max(0, nav.along - 300), Math.min(route.distance, nav.along + 5000)]} compact />
        )}
        {nav?.climb && (
          <div className="row small" style={{ gap: 6, padding: '2px 2px 4px' }} data-testid="climb-strip">
            <IconMountain size={16} style={{ color: 'var(--orange)' }} />
            {nav.climb.kind === 'in' ? (
              <b>Anstieg {nav.climb.index}/{nav.climb.count} · noch {formatDistance(nav.climb.remaining, imperial)} · {Math.round(nav.climb.climb.grade)} %</b>
            ) : (
              <b>Nächster Anstieg in {formatDistance(nav.climb.distance, imperial)} · {nav.climb.climb.gain} m · {Math.round(nav.climb.climb.grade)} %</b>
            )}
          </div>
        )}
        <div className="cgrid">
          {ordered.map((f) => <Field key={f} id={f} onChange={setEditField} />)}
        </div>
        <button className="btn ghost sm block" style={{ height: 28 }} onClick={() => setLayoutPicker(true)} data-testid="layout-btn">
          {layout.name} · Layout ändern
        </button>
        <div className="ctrl-row">
          {session.status === 'paused' ? (
            <button className="btn green" onClick={resumeRide} data-testid="resume"><IconPlay size={18} /> Weiter</button>
          ) : (
            <button className="btn" onClick={pauseRide} data-testid="pause"><IconPause size={18} /> Pause</button>
          )}
          <button className="btn red" onClick={() => setConfirmStop(true)} data-testid="stop"><IconStop size={18} /> Beenden</button>
        </div>
      </div>

      {confirmStop && (
        <div className="modal-bg" onClick={() => setConfirmStop(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="head"><h2>Fahrt beenden?</h2><button onClick={() => setConfirmStop(false)} aria-label="Schließen"><IconClose /></button></div>
            <p className="muted">{formatDistance(session.stats.distance)} in {formatClock(session.stats.movingTime)} · ↑ {session.stats.ascent} m</p>
            <p style={{ margin: '0 0 8px' }}>Soll die Fahrt gespeichert werden? Sonst wird sie verworfen.</p>
            <input className="input" placeholder="Name der Fahrt (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <h3>Gruppe in den Favoriten</h3>
            <GroupPicker value={group} onChange={setGroup} />
            <div className="spacer" />
            <button className="btn primary block" onClick={() => finish(true)} data-testid="save-ride">Fahrt speichern</button>
            <div className="spacer" />
            <button className="btn block" onClick={() => finish(false)} data-testid="discard-ride">Verwerfen</button>
          </div>
        </div>
      )}

      {editField && (
        <div className="modal-bg" onClick={() => setEditField(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="field-picker">
            <div className="head"><h2>Feld ändern</h2><button onClick={() => setEditField(null)} aria-label="Schließen"><IconClose /></button></div>
            <p className="muted small">Statt „{COMPUTER_FIELDS[editField]}“ anzeigen:</p>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {Object.entries(COMPUTER_FIELDS).map(([k, l]) => (
                <button key={k} className={`chip ${k === editField ? 'active' : ''}`} onClick={() => replaceField(editField, k)}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {layoutPicker && (
        <div className="modal-bg" onClick={() => setLayoutPicker(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="layout-picker">
            <div className="head"><h2>Fahrradcomputer-Layouts</h2><button onClick={() => setLayoutPicker(false)} aria-label="Schließen"><IconClose /></button></div>
            <p className="muted small">Tippe lange auf ein beliebiges Feld, um dessen Werte zu ändern.</p>
            {settings.layouts.map((l) => (
              <button
                key={l.id}
                className={`card ${l.id === settings.activeLayout ? 'sel' : ''}`}
                onClick={() => {
                  setSettings({ activeLayout: l.id });
                  setLayoutPicker(false);
                }}
              >
                <div className="grow">
                  <div className="title">{l.name}{l.builtin ? '' : ' · benutzerdefiniert'}</div>
                  <div className="meta">{l.fields.map((f) => COMPUTER_FIELDS[f]).filter(Boolean).join(' · ')}</div>
                </div>
                {!l.builtin && (
                  <span
                    className="icon-btn"
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rest = settings.layouts.filter((x) => x.id !== l.id);
                      setSettings({ layouts: rest, activeLayout: settings.activeLayout === l.id ? rest[0].id : settings.activeLayout });
                    }}
                  >
                    <IconClose size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {cues && route && (
        <div className="modal-bg" onClick={() => setCues(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="head"><h2>Abbiegehinweise</h2><button onClick={() => setCues(false)} aria-label="Schließen"><IconClose /></button></div>
            {route.instructions
              .filter((i) => !nav || i.along >= nav.along - 5)
              .map((i, k) => (
                <div className="cue" key={k}>
                  <div className="ic"><ManeuverIcon m={i.maneuver} exit={i.exit} size={26} /></div>
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>{i.text}</div>
                    <div className="small muted">nach {formatDistance(Math.max(0, i.along - (nav?.along ?? 0)), imperial)}</div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </>
  );
}

/** Small widget shown on other tabs while a ride is active. */
export function MiniWidget() {
  const session = useStore((s) => s.session);
  const setTab = useStore((s) => s.setTab);
  const tab = useStore((s) => s.tab);
  const detail = useStore((s) => s.detailId);
  if (!session) return null;
  const n = session.nav;
  // sheets occupy the bottom on these screens, so the widget moves to the top
  const top = tab === 'plan' || (tab === 'routes' && detail);
  return (
    <button className="mini-widget" style={top ? { bottom: 'auto', top: 'calc(10px + var(--safe-top))' } : undefined} onClick={() => setTab('record')} data-testid="mini-widget">
      {session.mode === 'navigate' && n?.next ? <ManeuverIcon m={n.next.maneuver} size={30} /> : <span className="status-pill rec" style={{ background: 'transparent', color: '#fff' }} />}
      <div className="grow" style={{ textAlign: 'left' }}>
        <b>
          {session.status === 'paused'
            ? 'Fahrt pausiert – tippen zum Fortsetzen'
            : session.mode === 'navigate' && n?.next
              ? `${formatDistance(n.distanceToNext)} · ${n.next.text}`
              : 'Aufnahme läuft'}
        </b>
        <div className="small" style={{ opacity: 0.8 }}>{formatDistance(session.stats.distance)} · {formatClock(session.stats.movingTime)}</div>
      </div>
      <IconChevron />
    </button>
  );
}
