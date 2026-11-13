import { useState } from 'react';
import { formatDistance, formatDuration } from '../lib/geo';
import type { Route } from '../lib/routing';
import { entryOptions, startNavigation } from '../session';
import { useStore } from '../store';
import { IconBike, IconClose, IconFlag, IconLocate, IconNavigate, IconSwap } from './icons';
import { Switch } from './Sheets';

/**
 * Shown before navigation starts: pick the navigation mode (turn-by-turn or self-guided)
 * and where to join the route.
 */
export default function StartNavDialog({ route, onClose }: { route: Route; onClose: () => void }) {
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const fix = useStore((s) => s.fix);
  const [guided, setGuided] = useState(settings.navMode !== 'self-guided');
  const [entry, setEntry] = useState<'start' | 'nearest' | 'reverse'>('start');
  const [remember, setRemember] = useState(settings.navMode !== 'ask');
  const opts = entryOptions(route, fix?.lngLat);

  const go = () => {
    if (remember) setSettings({ navMode: guided ? 'turn-by-turn' : 'self-guided' });
    else setSettings({ navMode: 'ask' });
    onClose();
    startNavigation(route, { guided, entry });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} data-testid="start-nav-dialog">
        <div className="head">
          <h2>Weiter mit</h2>
          <button onClick={onClose} aria-label="Schließen"><IconClose /></button>
        </div>

        <button className={`card ${guided ? 'sel' : ''}`} onClick={() => setGuided(true)} data-testid="mode-turn">
          <div className="icon-btn" style={guided ? { background: 'var(--primary)', color: '#fff' } : undefined}><IconNavigate size={20} /></div>
          <div className="grow">
            <div className="title">Turn-by-Turn-Navigation</div>
            <div className="meta">Ansagen und Hinweise für jede Abbiegung. Ideal in der Stadt und auf gut ausgebauten Wegen.</div>
          </div>
        </button>
        <button className={`card ${!guided ? 'sel' : ''}`} onClick={() => setGuided(false)} data-testid="mode-self">
          <div className="icon-btn" style={!guided ? { background: 'var(--primary)', color: '#fff' } : undefined}><IconBike size={20} /></div>
          <div className="grow">
            <div className="title">Selbstgeführte Navigation</div>
            <div className="meta">Nur deine Position auf der Linie, ohne Abbiege-Ansagen. Ideal abseits befestigter Wege.</div>
          </div>
        </button>

        <h3>Einstiegspunkt</h3>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          <button className={`chip ${entry === 'start' ? 'active' : ''}`} onClick={() => setEntry('start')}>
            <IconFlag size={16} /> Routenstart{opts.startDistance != null ? ` (${formatDistance(opts.startDistance)})` : ''}
          </button>
          {opts.nearest && (
            <button className={`chip ${entry === 'nearest' ? 'active' : ''}`} onClick={() => setEntry('nearest')} data-testid="entry-nearest">
              <IconLocate size={16} /> Nächster Punkt ({formatDistance(opts.nearest.distance)})
            </button>
          )}
          <button className={`chip ${entry === 'reverse' ? 'active' : ''}`} onClick={() => setEntry('reverse')} data-testid="entry-reverse">
            <IconSwap size={16} /> Route umkehren{opts.endDistance != null ? ` (${formatDistance(opts.endDistance)})` : ''}
          </button>
        </div>
        <div className="muted small">
          {entry === 'nearest' && opts.nearest
            ? `Neue Schätzung: ${formatDistance(opts.nearest.remaining)} · ${formatDuration((route.duration * opts.nearest.remaining) / route.distance)}`
            : `${formatDistance(route.distance)} · ${formatDuration(route.duration)} · ↑ ${route.ascent} m`}
        </div>

        <div className="setting" style={{ marginTop: 10 }}>
          <div>
            <div className="lbl">Nicht mehr fragen</div>
            <div className="sub">Diesen Modus künftig immer verwenden</div>
          </div>
          <Switch on={remember} onChange={setRemember} label="Nicht mehr fragen" />
        </div>

        <div className="spacer" />
        <button className="btn primary block" onClick={go} data-testid="nav-go">
          <IconNavigate size={18} /> Weiter zur Navigation
        </button>
      </div>
    </div>
  );
}

/** Prompt shown when the rider rode past a stop without reaching it. */
export function MissedStopDialog() {
  const missed = useStore((s) => s.missedStop);
  const session = useStore((s) => s.session);
  // only meaningful while navigating; never leave it on screen after the ride ended
  if (!missed || !session) return null;
  return (
    <div className="modal-bg" data-testid="missed-stop">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="head"><h2>Du hast einen Halt verpasst</h2></div>
        <p className="muted">Möchtest du „{missed.name}“ überspringen oder dich weiter dorthin zurückführen lassen?</p>
        <div className="spacer" />
        <button className="btn primary block" onClick={() => import('../session').then((m) => m.resolveMissedStop('skip'))} data-testid="missed-skip">
          Überspringen
        </button>
        <div className="spacer" />
        <button className="btn block" onClick={() => import('../session').then((m) => m.resolveMissedStop('back'))} data-testid="missed-back">
          Zurückgehen
        </button>
      </div>
    </div>
  );
}
