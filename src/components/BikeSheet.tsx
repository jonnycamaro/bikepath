import { BIKE_TYPES, bikeById, bikeSpeed } from '../lib/bike';
import { useStore } from '../store';
import { Modal } from './Sheets';
import { IconCheck, IconDown, IconMinus, IconPlus, ProfileBadge } from './icons';

/** A number with − and + beside it; the one way amounts are set in the sheets. */
export function Amount({ value, unit, onStep, canDown = true, canUp = true, label, testid }: {
  value: string;
  unit: string;
  onStep: (dir: -1 | 1) => void;
  canDown?: boolean;
  canUp?: boolean;
  label: string;
  testid?: string;
}) {
  return (
    <div className="amount" role="group" aria-label={label} data-testid={testid}>
      <button className="amount-btn" onClick={() => onStep(-1)} disabled={!canDown} aria-label={`${label} verringern`}><IconMinus size={22} /></button>
      <div className="amount-val" aria-live="polite"><b>{value}</b><span>{unit}</span></div>
      <button className="amount-btn" onClick={() => onStep(1)} disabled={!canUp} aria-label={`${label} erhöhen`}><IconPlus size={22} /></button>
    </div>
  );
}

/** Compact row showing the rider's bike and pace; opens the bike sheet. */
export function BikeSelector({ onOpen, note }: { onOpen: () => void; note?: string }) {
  const settings = useStore((s) => s.settings);
  const bike = bikeById(settings.bikeType);
  return (
    <button className="profile-select" onClick={onOpen} data-testid="bike-select">
      <ProfileBadge icon={bike.icon} size={30} />
      <span className="grow">
        <span className="title">{bike.label} · {bikeSpeed(settings)} km/h</span>
        <span className="meta">{note ?? bike.description}</span>
      </span>
      <IconDown size={18} className="chev" />
    </button>
  );
}

/** Choose the bike type; the pace follows from it and can be fine-tuned. */
export function BikeSheet() {
  const onClose = () => useStore.getState().setSheet(null);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const bike = bikeById(settings.bikeType);
  const speed = bikeSpeed(settings);
  const own = settings.bikeSpeed != null && settings.bikeSpeed !== bike.speedKmh;
  return (
    <Modal title="Mein Fahrrad" onClose={onClose} testid="bike-sheet">
      <div className="profile-intro">Dein Fahrrad bestimmt das Tempo, mit dem Fahrzeiten und Ankunft berechnet werden.</div>
      <div className="profile-list" role="radiogroup" aria-label="Fahrradtyp">
        {BIKE_TYPES.map((b) => {
          const active = b.id === bike.id;
          return (
            <div key={b.id} className={`profile-opt ${active ? 'active' : ''}`}>
              <button className="row-btn" role="radio" aria-checked={active} onClick={() => setSettings({ bikeType: b.id, bikeSpeed: null })} data-testid={`bike-${b.id}`}>
                <ProfileBadge icon={b.icon} />
                <span className="grow">
                  <span className="title">{b.label}</span>
                  <span className="meta">{b.description}</span>
                </span>
                <span className="pace">{b.speedKmh} km/h</span>
                <span className="check">{active && <IconCheck size={18} />}</span>
              </button>
            </div>
          );
        })}
      </div>

      <h3>Dein Tempo</h3>
      <Amount
        label="Tempo"
        testid="bike-speed"
        value={String(speed)}
        unit="km/h"
        canDown={speed > 8}
        canUp={speed < 40}
        onStep={(d) => setSettings({ bikeSpeed: Math.min(40, Math.max(8, speed + d)) })}
      />
      <div className="amount-note">
        {own ? (
          <>Üblich für {bike.label}: {bike.speedKmh} km/h · <button className="link" onClick={() => setSettings({ bikeSpeed: null })}>zurücksetzen</button></>
        ) : (
          <>Durchschnitt in der Ebene. Passe ihn an, wenn du schneller oder langsamer fährst.</>
        )}
      </div>
      <div className="spacer" />
      <button className="btn primary block" onClick={onClose} data-testid="bike-done">Fertig</button>
    </Modal>
  );
}
