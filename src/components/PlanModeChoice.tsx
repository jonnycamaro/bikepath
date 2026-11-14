import { IconAtoB, IconLoop } from './icons';

export type PlanKind = 'trip' | 'loop';

/** The two kinds of plan as large cards: a trip to a destination, or a round trip. */
export default function PlanModeChoice({ onPick, testid = 'plan-mode' }: { onPick: (k: PlanKind) => void; testid?: string }) {
  return (
    <div className="mode-grid" data-testid={testid}>
      <button className="mode-card" style={{ '--c': 'var(--primary)' } as React.CSSProperties} onClick={() => onPick('trip')} data-testid={`${testid}-trip`}>
        <span className="mode-ico"><IconAtoB size={26} /></span>
        <span className="mode-title">Strecke</span>
        <span className="mode-meta">Zu einem Ziel, mit Zwischenstopps</span>
      </button>
      <button className="mode-card" style={{ '--c': 'var(--green)' } as React.CSSProperties} onClick={() => onPick('loop')} data-testid={`${testid}-loop`}>
        <span className="mode-ico"><IconLoop size={26} /></span>
        <span className="mode-title">Rundtour</span>
        <span className="mode-meta">Zurück zum Start, nach Distanz oder Zeit</span>
      </button>
    </div>
  );
}
