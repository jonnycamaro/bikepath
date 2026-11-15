import { useState } from 'react';
import {
  newCustomProfile,
  normalizeProfile,
  SURFACE_LABELS,
  TEMPLATES,
  validateProfile,
  WAY_LABELS,
  type CustomProfile,
  type ItemStatus,
  type RankItem,
} from '../lib/customProfile';
import { useStore } from '../store';
import { IconClose, IconDown, IconUp, PROFILE_SWATCHES, PROFILE_SYMBOLS, ProfileBadge } from './icons';
import { Switch } from './Sheets';

const STATUS: [ItemStatus, string][] = [['ok', 'Ja'], ['avoid', 'Meiden'], ['never', 'Nie']];

/** A list the rider orders by preference; each entry can also be avoided or excluded. */
function RankList<K extends string>({ items, labels, onChange, testid }: {
  items: RankItem<K>[];
  labels: Record<K, { label: string; hint: string }>;
  onChange: (items: RankItem<K>[]) => void;
  testid: string;
}) {
  const move = (i: number, d: -1 | 1) => {
    const n = [...items];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    onChange(n);
  };
  return (
    <div className="rank-list" data-testid={testid}>
      {items.map((it, i) => (
        <div key={it.key} className={`rank-item ${it.status}`} data-testid={`${testid}-${it.key}`}>
          <div className="rank-move">
            <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${labels[it.key].label} nach oben`}><IconUp size={16} /></button>
            <button className="icon-btn" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={`${labels[it.key].label} nach unten`}><IconDown size={16} /></button>
          </div>
          <div className="grow rank-text">
            <div className="lbl">{labels[it.key].label}</div>
            <div className="sub">{labels[it.key].hint}</div>
          </div>
          <div className="segmented sm rank-status">
            {STATUS.map(([s, l]) => (
              <button key={s} className={it.status === s ? `active ${s}` : ''} onClick={() => onChange(items.map((x, j) => (j === i ? { ...x, status: s } : x)))}>{l}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Choice<T extends string | number | null>({ value, options, onChange, testid }: { value: T; options: [T, string][]; onChange: (v: T) => void; testid?: string }) {
  return (
    <div className="chips wrap" data-testid={testid}>
      {options.map(([v, l]) => (
        <button key={String(v)} className={`chip ${value === v ? 'active' : ''}`} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

/**
 * Full-screen editor for an own routing option (Profil → Eigene Routenoptionen). The order of
 * the way and surface lists is the preference; the generator in lib/customProfile.ts turns it
 * into cost factors for BRouter.
 */
export default function ProfileEditor() {
  const target = useStore((s) => s.profileEditor);
  const settings = useStore((s) => s.settings);
  const existing = settings.customProfiles.find((p) => p.id === target);
  const [p, setP] = useState<CustomProfile>(() => (existing ? normalizeProfile(existing) : newCustomProfile()));
  const [template, setTemplate] = useState('touring');
  const [tried, setTried] = useState(false);
  const isNew = !existing;
  const error = validateProfile(p);
  const set = (patch: Partial<CustomProfile>) => setP({ ...p, ...patch });
  const close = () => useStore.setState({ profileEditor: null });

  const save = (use: boolean) => {
    setTried(true);
    if (error) return;
    const s = useStore.getState();
    const list = isNew ? [...settings.customProfiles, p] : settings.customProfiles.map((x) => (x.id === p.id ? p : x));
    s.setSettings({ customProfiles: list });
    if (use) s.setProfile(p.id);
    s.toastMsg(isNew ? `„${p.name}“ angelegt` : `„${p.name}“ gespeichert`);
    close();
  };
  const remove = () => {
    if (!window.confirm(`Routenoption „${p.name}“ löschen?`)) return;
    useStore.getState().setSettings({ customProfiles: settings.customProfiles.filter((x) => x.id !== p.id) });
    close();
  };
  const duplicate = () => {
    const copy = { ...p, id: newCustomProfile().id, name: `${p.name} (Kopie)` };
    useStore.getState().setSettings({ customProfiles: [...settings.customProfiles, copy] });
    useStore.setState({ profileEditor: copy.id });
    setP(copy);
  };

  return (
    <div className="editor-page" data-testid="profile-editor">
      <div className="editor-head">
        <button className="icon-btn" onClick={close} aria-label="Abbrechen"><IconClose size={20} /></button>
        <h2 className="grow">{isNew ? 'Neue Routenoption' : 'Routenoption bearbeiten'}</h2>
        <button className="btn primary sm" onClick={() => save(false)} data-testid="editor-save">Speichern</button>
      </div>

      <div className="editor-body">
        {isNew && (
          <>
            <h3>Vorlage</h3>
            <Choice
              value={template}
              options={TEMPLATES.map((t) => [t.id, t.label])}
              onChange={(id) => {
                setTemplate(id);
                const t = TEMPLATES.find((x) => x.id === id)!.make();
                setP({ ...p, ...t });
              }}
              testid="editor-template"
            />
            <div className="sub-note">Füllt alle Einstellungen vor. Name und Kommentar bleiben.</div>
          </>
        )}

        <h3>Name und Kommentar</h3>
        <input className="input" value={p.name} maxLength={40} placeholder="z. B. Feierabendrunde" onChange={(e) => set({ name: e.target.value })} data-testid="editor-name" />
        <textarea className="input" rows={2} value={p.comment} maxLength={140} placeholder="Kurze Beschreibung – erscheint in der Auswahl unter dem Namen" onChange={(e) => set({ comment: e.target.value })} data-testid="editor-comment" />

        <h3>Symbol</h3>
        <div className="symbol-preview">
          <ProfileBadge icon={p.icon} color={p.color} size={44} />
          <div className="grow">
            <div className="lbl">{p.name || 'Eigene Routenoption'}</div>
            <div className="sub">{p.comment || 'So erscheint sie in der Auswahl'}</div>
          </div>
        </div>
        <div className="symbol-grid" data-testid="editor-symbols">
          {PROFILE_SYMBOLS.map((s) => (
            <button key={s} className={`symbol-opt ${p.icon === s ? 'active' : ''}`} onClick={() => set({ icon: s })} aria-label={`Symbol ${s}`}>
              <ProfileBadge icon={s} color={p.icon === s ? p.color : '#9aa8b8'} size={36} />
            </button>
          ))}
        </div>
        <div className="swatches">
          {PROFILE_SWATCHES.map((c) => (
            <button key={c} className={`swatch ${p.color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => set({ color: c })} aria-label={`Farbe ${c}`} />
          ))}
        </div>

        <h3>Wegarten</h3>
        <div className="sub-note">Oben steht, was du am liebsten fährst. Mit den Pfeilen umsortieren; „Meiden“ nur wenn nötig, „Nie“ schließt sie aus.</div>
        <RankList items={p.ways} labels={WAY_LABELS} onChange={(ways) => set({ ways })} testid="editor-ways" />

        <h3>Untergrund</h3>
        <RankList items={p.surfaces} labels={SURFACE_LABELS} onChange={(surfaces) => set({ surfaces })} testid="editor-surfaces" />

        <h3>Wie stark zählt die Reihenfolge?</h3>
        <Choice value={p.strength} options={[['low', 'Leicht – lieber kurz'], ['mid', 'Mittel'], ['high', 'Stark – Umwege ok']]} onChange={(strength) => set({ strength })} />

        <h3>Steigungen</h3>
        <div className="lbl small-lbl">Höhenmeter vermeiden</div>
        <Choice value={p.climbAvoid} options={[[0, 'Egal'], [1, 'Etwas'], [2, 'Deutlich'], [3, 'Stark']]} onChange={(climbAvoid) => set({ climbAvoid })} testid="editor-climb" />
        <div className="lbl small-lbl">Höchste Steigung</div>
        <Choice value={p.maxUphill} options={[[null, 'Ohne Grenze'], [4, '4 %'], [6, '6 %'], [8, '8 %'], [10, '10 %'], [12, '12 %'], [15, '15 %']]} onChange={(maxUphill) => set({ maxUphill })} testid="editor-maxup" />
        <div className="lbl small-lbl">Höchstes Gefälle</div>
        <Choice value={p.maxDownhill} options={[[null, 'Ohne Grenze'], [6, '6 %'], [8, '8 %'], [10, '10 %'], [12, '12 %'], [15, '15 %']]} onChange={(maxDownhill) => set({ maxDownhill })} />
        <div className="sub-note">Steilere Stücke werden stark gemieden, aber nicht verboten – sonst gäbe es in bergigem Gelände oft gar keine Route.</div>

        <h3>Ausgeschilderte Radrouten</h3>
        <Choice value={p.cycleRoutes} options={[['ignore', 'Egal'], ['prefer', 'Bevorzugen'], ['stick', 'Möglichst folgen']]} onChange={(cycleRoutes) => set({ cycleRoutes })} />

        <h3>Sonstiges</h3>
        <div className="panel" style={{ padding: '0 14px', background: 'var(--bg-soft)' }}>
          <div className="setting">
            <div><div className="lbl">Schieben erlaubt</div><div className="sub">Fußwege ohne Radfreigabe, Einbahnstraßen in Gegenrichtung</div></div>
            <Switch on={p.allowPush} onChange={(allowPush) => set({ allowPush })} label="Schieben erlaubt" />
          </div>
          <div className="setting">
            <div><div className="lbl">Treppen</div><div className="sub">Rad über kurze Treppen tragen</div></div>
            <Switch on={p.allowSteps} onChange={(allowSteps) => set({ allowSteps })} label="Treppen" />
          </div>
          <div className="setting">
            <div><div className="lbl">Fähren</div><div className="sub">Nur wenn es deutlich kürzer ist</div></div>
            <Switch on={p.allowFerries} onChange={(allowFerries) => set({ allowFerries })} label="Fähren" />
          </div>
        </div>

        <h3>Tempo</h3>
        <Choice value={p.pace} options={[[0.85, 'Gemütlich'], [1, 'Normal'], [1.1, 'Zügig']]} onChange={(pace) => set({ pace })} />
        <div className="sub-note">Verschiebt die Fahrzeit gegenüber deinem Tempo aus dem Profil.</div>

        {tried && error && <div className="err" role="alert" data-testid="editor-error">{error}</div>}
        <div className="spacer" />
        <button className="btn primary block" onClick={() => save(true)} data-testid="editor-save-use">Speichern und verwenden</button>
        {!isNew && (
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn grow" onClick={duplicate}>Duplizieren</button>
            <button className="btn grow danger" onClick={remove} data-testid="editor-delete">Löschen</button>
          </div>
        )}
      </div>
    </div>
  );
}
