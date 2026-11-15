import { formatClock, formatDistance } from '../lib/geo';
import { customRoutingProfiles, PROFILES } from '../lib/routing';
import { location } from '../lib/location';
import { useStore } from '../store';
import { COMPUTER_FIELDS } from './NavigationScreen';
import { IconChevron, IconOffline, IconPlus, IconShare, ProfileBadge } from './icons';
import { BikeSelector } from './BikeSheet';
import { Switch } from './Sheets';

/** Public address of the app; a dev server shares this instead of its own address. */
const PUBLIC_URL = 'https://jonnycamaro.github.io/bikepath/';

/** Share the app's link with the system share sheet (WhatsApp, mail, …); copy it where that is missing. */
async function shareApp() {
  const url = import.meta.env.PROD ? new URL(import.meta.env.BASE_URL, window.location.origin).href : PUBLIC_URL;
  const data = { title: 'Bikepath', text: 'Bikepath – Fahrrad-Routenplaner und Navigation fürs Handy:', url };
  const toast = useStore.getState().toastMsg;
  if (navigator.share) {
    try {
      await navigator.share(data);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Teilen nicht möglich');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Link kopiert');
  } catch {
    toast(url);
  }
}

export default function ProfileScreen() {
  const saved = useStore((s) => s.saved);
  const settings = useStore((s) => s.settings);
  const setSettings = useStore((s) => s.setSettings);
  const rides = saved.filter((r) => r.kind === 'recorded' && r.ride);
  const now = Date.now();
  const sum = (days: number) => {
    const rs = rides.filter((r) => now - r.createdAt < days * 864e5);
    return {
      n: rs.length,
      dist: rs.reduce((a, r) => a + r.ride!.stats.distance, 0),
      time: rs.reduce((a, r) => a + r.ride!.stats.movingTime, 0),
      up: rs.reduce((a, r) => a + r.ride!.stats.ascent, 0),
    };
  };
  const periods = [
    { l: '7 Tage', ...sum(7) },
    { l: '30 Tage', ...sum(30) },
    { l: 'Gesamt', ...sum(1e6) },
  ];

  return (
    <div className="page" data-testid="profile-screen">
      <h1>Profil</h1>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Statistik</h3>
        {periods.map((p) => (
          <div className="setting" key={p.l}>
            <div className="lbl" style={{ width: 70 }}>{p.l}</div>
            <div className="grow row" style={{ justifyContent: 'space-around', fontSize: 14 }}>
              <span><b>{formatDistance(p.dist)}</b></span>
              <span>{formatClock(p.time)}</span>
              <span>↑ {p.up} m</span>
              <span className="muted">{p.n} {p.n === 1 ? 'Fahrt' : 'Fahrten'}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Mein Fahrrad</h3>
        <BikeSelector onOpen={() => useStore.getState().setSheet('bike')} />
        <p className="muted small" style={{ margin: '8px 2px 0' }}>Daraus ergibt sich das Tempo für Fahrzeiten, Ankunft und Rundtouren nach Zeit.</p>
      </div>

      <button className="panel row" style={{ width: '100%' }} onClick={() => useStore.setState({ sheet: 'offline', offlineSelect: true, tab: 'map' })} data-testid="open-offline">
        <IconOffline />
        <div className="grow" style={{ textAlign: 'left' }}><b>Offline-Karten</b><div className="small muted">Gebiete für unterwegs ohne Netz speichern</div></div>
        <IconChevron />
      </button>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Navigation</h3>
        <div className="setting"><div><div className="lbl">Sprachansagen</div><div className="sub">Abbiegehinweise vorlesen</div></div><Switch on={settings.voice} onChange={(v) => setSettings({ voice: v })} label="Sprachansagen" /></div>
        <div className="setting"><div><div className="lbl">Automatische Neuberechnung</div><div className="sub">Bei Verlassen der Route</div></div><Switch on={settings.autoReroute} onChange={(v) => setSettings({ autoReroute: v })} label="Neuberechnung" /></div>
        <div className="setting"><div><div className="lbl">Auto-Pause</div><div className="sub">Aufnahme pausiert beim Anhalten</div></div><Switch on={settings.autoPause} onChange={(v) => setSettings({ autoPause: v })} label="Auto-Pause" /></div>
        <div className="setting"><div><div className="lbl">Bildschirm anlassen</div><div className="sub">Während Navigation und Aufnahme</div></div><Switch on={settings.keepScreenOn} onChange={(v) => setSettings({ keepScreenOn: v })} label="Bildschirm an" /></div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Navigationsmodus</h3>
        <div className="segmented" style={{ margin: 0 }}>
          {([['ask', 'Jedes Mal fragen'], ['turn-by-turn', 'Turn-by-Turn'], ['self-guided', 'Selbstgeführt']] as const).map(([k, l]) => (
            <button key={k} className={settings.navMode === k ? 'active' : ''} onClick={() => setSettings({ navMode: k })}>{l}</button>
          ))}
        </div>
        <div className="setting" style={{ borderTop: '1px solid var(--line)', marginTop: 10 }}>
          <div>
            <div className="lbl">Zurück auf die Route führen</div>
            <div className="sub">Nach einer Abweichung zuerst zur geplanten Route statt direkt zum nächsten Ziel</div>
          </div>
          <Switch on={settings.rerouteMode === 'rejoin'} onChange={(v) => setSettings({ rerouteMode: v ? 'rejoin' : 'direct' })} label="Zurück zur Route" />
        </div>
        <div className="setting">
          <div><div className="lbl">Steigungsansagen</div><div className="sub">„Anstieg in 1 Kilometer: 800 Meter mit 6 Prozent“</div></div>
          <Switch on={settings.climbAnnouncements} onChange={(v) => setSettings({ climbAnnouncements: v })} label="Steigungsansagen" />
        </div>
        <div className="setting">
          <div><div className="lbl">Aufzeichnung fortsetzen</div><div className="sub">Nach Ankunft am Ziel weiter aufzeichnen</div></div>
          <Switch on={settings.continueRecording} onChange={(v) => setSettings({ continueRecording: v })} label="Aufzeichnung fortsetzen" />
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Batteriesparmodus</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          Verlängert die Akkulaufzeit: seltenere Standortabfragen, Dunkelmodus und ein vereinfachter Kartenstil. Echtzeit-Genauigkeit und Kartendetails nehmen dadurch leicht ab.
        </p>
        <div className="segmented" style={{ margin: 0 }}>
          {([['off', 'Aus'], ['auto', 'Geräteeinstellung'], ['on', 'Immer an']] as const).map(([k, l]) => (
            <button key={k} className={settings.batterySaveMode === k ? 'active' : ''} onClick={() => setSettings({ batterySaveMode: k })}>{l}</button>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Deine Adressen</h3>
        {(['home', 'work'] as const).map((k) => {
          const place = settings.places[k];
          const label = k === 'home' ? 'Zuhause' : 'Arbeit';
          return (
            <div className="setting" key={k}>
              <div>
                <div className="lbl">{label}</div>
                <div className="sub">{place ? `${place.lngLat[1].toFixed(4)}, ${place.lngLat[0].toFixed(4)}` : 'Im Routenplaner festlegen'}</div>
              </div>
              {place && (
                <button className="btn sm" onClick={() => setSettings({ places: { ...settings.places, [k]: undefined } })}>Entfernen</button>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Fahrradcomputer</h3>
        <p className="muted small" style={{ marginTop: 0 }}>Während der Fahrt lange auf ein Feld tippen, um es zu ändern.</p>
        {settings.layouts.map((l) => (
          <div className="setting" key={l.id}>
            <div>
              <div className="lbl">{l.name}</div>
              <div className="sub">{l.fields.map((f) => COMPUTER_FIELDS[f]).filter(Boolean).join(' · ')}</div>
            </div>
            <button className={`btn sm ${settings.activeLayout === l.id ? 'primary' : ''}`} onClick={() => setSettings({ activeLayout: l.id })}>
              {settings.activeLayout === l.id ? 'Aktiv' : 'Wählen'}
            </button>
          </div>
        ))}
      </div>

      <div className="panel" data-testid="custom-profiles">
        <h3 style={{ marginTop: 0 }}>Eigene Routenoptionen</h3>
        {settings.customProfiles.length === 0 && (
          <div className="sub-note" style={{ marginBottom: 10 }}>Lege fest, welche Wege, Untergründe und Steigungen deine Routen nehmen sollen. Eigene Optionen erscheinen im Planer neben den vorgegebenen.</div>
        )}
        {settings.customProfiles.map((p) => (
          <button key={p.id} className="setting row-btn" onClick={() => useStore.setState({ profileEditor: p.id })} data-testid={`custom-${p.id}`}>
            <div className="row" style={{ minWidth: 0 }}>
              <ProfileBadge icon={p.icon} color={p.color} size={34} />
              <div style={{ minWidth: 0 }}><div className="lbl">{p.name}</div>{p.comment && <div className="sub ellipsis">{p.comment}</div>}</div>
            </div>
            <IconChevron size={18} />
          </button>
        ))}
        <button className="btn block" style={{ marginTop: 10 }} onClick={() => useStore.setState({ profileEditor: 'new' })} data-testid="custom-new">
          <IconPlus size={18} /> Neue Routenoption
        </button>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Allgemein</h3>
        <div className="setting">
          <div className="lbl">Einheiten</div>
          <div className="segmented" style={{ margin: 0, width: 180 }}>
            <button className={settings.units === 'metric' ? 'active' : ''} onClick={() => setSettings({ units: 'metric' })}>km</button>
            <button className={settings.units === 'imperial' ? 'active' : ''} onClick={() => setSettings({ units: 'imperial' })}>Meilen</button>
          </div>
        </div>
        <div className="setting">
          <div className="lbl">Darstellung</div>
          <div className="segmented" style={{ margin: 0, width: 200 }}>
            {([['system', 'System'], ['light', 'Hell'], ['dark', 'Dunkel']] as const).map(([k, l]) => (
              <button key={k} className={settings.theme === k ? 'active' : ''} onClick={() => setSettings({ theme: k })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="setting">
          <div className="lbl">Standard-Routing</div>
          <select className="input" style={{ width: 170, height: 40 }} value={settings.defaultProfile} onChange={(e) => setSettings({ defaultProfile: e.target.value })}>
            {[...PROFILES, ...customRoutingProfiles()].map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div className="setting">
          <div><div className="lbl">GPS-Simulation beenden</div><div className="sub">Falls eine Demo-Fahrt aktiv ist</div></div>
          <button className="btn sm" onClick={() => location.endSimulation()}>Echtes GPS</button>
        </div>
      </div>

      <div className="panel" style={{ padding: '0 14px' }}>
        <button className="setting row-btn" onClick={shareApp} data-testid="share-app">
          <div className="row"><IconShare size={20} /><div><div className="lbl">App teilen</div><div className="sub">Link per WhatsApp, Mail oder anderer App senden</div></div></div>
          <IconChevron size={18} />
        </button>
        <button className="setting row-btn" onClick={() => useStore.getState().setSheet('legal')} data-testid="open-legal">
          <div><div className="lbl">Rechtliches & Lizenzen</div><div className="sub">Kartendaten, Dienste und Open-Source-Bibliotheken</div></div>
          <IconChevron size={18} />
        </button>
      </div>

      <div className="panel small muted">
        <b style={{ color: 'var(--navy)' }}>Bikepath 1.0</b><br />
        Kartendaten © OpenStreetMap-Mitwirkende · Karten: OpenFreeMap, CyclOSM, OpenTopoMap, Esri · Routing: BRouter · Suche: Photon (komoot) · Höhen: Mapzen Terrain Tiles · Wetter: Open-Meteo.com (CC BY 4.0)
      </div>
    </div>
  );
}
