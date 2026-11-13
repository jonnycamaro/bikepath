import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import type { Place } from './lib/geocode';
import { formatDistance, haversine } from './lib/geo';
import { location } from './lib/location';
import { restoreRide } from './session';
import { useStore, type Tab } from './store';
import { mapRef } from './components/MapView';
import MapView from './components/MapView';
import PlannerSheet from './components/PlannerSheet';
import NavigationScreen, { MiniWidget } from './components/NavigationScreen';
import RecordTab from './components/RecordTab';
import RoutesScreen from './components/RoutesScreen';
import ProfileScreen from './components/ProfileScreen';
import SearchBox from './components/SearchBox';
import { LayersSheet, OfflineSheet, RoundTripSheet, SaveSheet } from './components/Sheets';
import StartNavDialog, { MissedStopDialog } from './components/StartNavDialog';
import { Icon3D, IconBike, IconClose, IconCompass, IconHeading, IconLayers, IconLocate, IconMap, IconNavigate, IconPlan, IconProfile, IconRecord, IconRoutes } from './components/icons';

function TabBar() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const live = useStore((s) => !!s.session);
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'map', label: 'Karte', icon: <IconMap /> },
    { id: 'plan', label: 'Planen', icon: <IconPlan /> },
    { id: 'record', label: live ? 'Live' : 'Aufzeichnen', icon: <IconRecord /> },
    { id: 'routes', label: 'Meine Routen', icon: <IconRoutes /> },
    { id: 'profile', label: 'Profil', icon: <IconProfile /> },
  ];
  return (
    <nav className="tabbar" data-testid="tabbar">
      {items.map((i) =>
        i.id === 'record' ? (
          <button key={i.id} className={`rec-btn ${live ? 'live' : ''} ${tab === i.id ? 'active' : ''}`} onClick={() => setTab(i.id)} data-testid={`tab-${i.id}`}>
            <span className="bubble">{i.icon}</span>
            {i.label}
          </button>
        ) : (
          <button key={i.id} className={tab === i.id ? 'active' : ''} onClick={() => setTab(i.id)} data-testid={`tab-${i.id}`}>
            {i.icon}
            {i.label}
          </button>
        ),
      )}
    </nav>
  );
}

function MapControls({ bottom }: { bottom: string }) {
  const follow = useStore((s) => s.follow);
  const fix = useStore((s) => s.fix);
  const terrain = useStore((s) => s.settings.terrain3d);
  const [bearing, setBearing] = useState(0);
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const f = () => setBearing(m.getBearing());
    m.on('rotate', f);
    return () => {
      m.off('rotate', f);
    };
  }, []);
  const cycle = () => {
    if (!fix) {
      useStore.getState().toastMsg(useStore.getState().locationError ?? 'Suche GPS-Signal …');
      location.ensureStarted();
      return;
    }
    useStore.setState({ follow: follow === 'off' ? 'follow' : follow === 'follow' ? 'heading' : 'off' });
  };
  return (
    <div className="fab-col" style={{ bottom }}>
      {Math.abs(bearing) > 2 && (
        <button className="fab small" onClick={() => mapRef.current?.easeTo({ bearing: 0, pitch: 0 })} aria-label="Nach Norden ausrichten">
          <IconCompass size={22} style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
      )}
      <button className="fab small" onClick={() => useStore.getState().setSheet('layers')} aria-label="Kartenstil" data-testid="layers-btn"><IconLayers size={20} /></button>
      <button className={`fab small ${terrain ? 'active' : ''}`} onClick={() => useStore.getState().setSettings({ terrain3d: !terrain })} aria-label="3D"><Icon3D size={20} /></button>
      <button className={`fab ${follow !== 'off' ? 'active' : ''}`} onClick={cycle} aria-label="Mein Standort" data-testid="locate-btn">
        {follow === 'heading' ? <IconHeading size={22} /> : <IconLocate size={22} />}
      </button>
    </div>
  );
}

function PlaceCard({ place, onClose }: { place: Place; onClose: () => void }) {
  const s = useStore();
  const marker = useRef<maplibregl.Marker | null>(null);
  useEffect(() => {
    if (!mapRef.current) return;
    marker.current = new maplibregl.Marker({ color: '#e5383b' }).setLngLat(place.lngLat).addTo(mapRef.current);
    return () => {
      marker.current?.remove();
    };
  }, [place]);
  const routeHere = () => {
    const me = s.fix?.lngLat;
    s.setWaypoints(me ? [{ id: 'me' + Date.now(), lngLat: me, name: 'Mein Standort' }, { id: 'p' + Date.now(), lngLat: place.lngLat, name: place.name }] : [{ id: 'p' + Date.now(), lngLat: place.lngLat, name: place.name }]);
    s.setTab('plan');
    onClose();
  };
  return (
    <div className="sheet" data-testid="place-card">
      <div className="grab" />
      <div className="body">
        <div className="row">
          <div className="grow">
            <h2 style={{ margin: 0 }}>{place.name}</h2>
            <div className="muted small">{place.detail}{s.fix ? ` · ${formatDistance(haversine(s.fix.lngLat, place.lngLat))} entfernt` : ''}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen"><IconClose size={20} /></button>
        </div>
        <div className="spacer" />
        <div className="row">
          <button className="btn primary grow" onClick={routeHere} data-testid="route-here"><IconNavigate size={18} /> Route hierher</button>
          <button className="btn grow" onClick={() => { s.setWaypoints([{ id: 'p' + Date.now(), lngLat: place.lngLat, name: place.name }]); s.setTab('plan'); onClose(); }}>Als Start</button>
        </div>
      </div>
    </div>
  );
}

function Onboarding() {
  const setSettings = useStore((s) => s.setSettings);
  return (
    <div className="onboard" data-testid="onboarding">
      <IconBike size={72} />
      <h1>Bikepath</h1>
      <p>Plane Fahrradrouten mit Höhenprofil und Wegeinfo, navigiere mit Sprachansagen und zeichne deine Fahrten auf – auch offline.</p>
      <button
        className="btn block"
        style={{ background: '#fff', color: 'var(--primary)' }}
        onClick={() => {
          setSettings({ onboarded: true });
          location.ensureStarted();
        }}
        data-testid="onboard-start"
      >
        Los geht's – Standort erlauben
      </button>
      <button className="btn ghost" style={{ color: '#fff' }} onClick={() => setSettings({ onboarded: true })}>Ohne Standort fortfahren</button>
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const tab = useStore((s) => s.tab);
  const session = useStore((s) => s.session);
  const sheet = useStore((s) => s.sheet);
  const toast = useStore((s) => s.toast);
  const onboarded = useStore((s) => s.settings.onboarded);
  const detailId = useStore((s) => s.detailId);
  const routing = useStore((s) => s.routing);
  const pendingNav = useStore((s) => s.pendingNav);
  const theme = useStore((s) => s.settings.theme);
  const batterySave = useStore((s) => s.settings.batterySave);
  const [place, setPlace] = useState<Place | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const firstFix = useRef(true);

  useEffect(() => {
    useStore.getState().init().then(async () => {
      if (await restoreRide()) useStore.getState().toastMsg('Unterbrochene Fahrt wiederhergestellt (pausiert)');
    });
  }, []);

  useEffect(() => {
    if (!ready || !onboarded) return;
    return location.subscribe(
      (f) => {
        useStore.getState().setFix(f);
        if (firstFix.current) {
          firstFix.current = false;
          if (!useStore.getState().waypoints.length) useStore.getState().focusMap({ center: f.lngLat, zoom: 14 });
        }
      },
      (msg) => useStore.setState({ locationError: msg }),
    );
  }, [ready, onboarded]);

  useEffect(() => {
    if (!toast) return;
    setToastVisible(true);
    const t = setTimeout(() => setToastVisible(false), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (tab !== 'map') setPlace(null);
  }, [tab]);

  // dark mode: follow the device or force it; battery save mode forces dark
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = batterySave || theme === 'dark' || (theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, batterySave]);

  const navFull = !!session && tab === 'record';
  const showMapControls = !navFull && (tab === 'map' || tab === 'plan' || (tab === 'routes' && detailId) || (tab === 'record' && !session));
  const controlsBottom =
    tab === 'map' && !place && sheet !== 'offline'
      ? `calc(var(--tabbar) + var(--safe-bottom) + ${session ? 84 : 16}px)`
      : 'calc(var(--tabbar) + var(--safe-bottom) + var(--sheet-h, 0px) + 12px)';

  return (
    <div className="app">
      {routing && <div className="loading-bar" />}
      <MapView />

      {tab === 'map' && !navFull && sheet !== 'offline' && (
        <div className="topbar">
          <SearchBox
            onSelect={(p) => {
              setPlace(p);
              useStore.getState().focusMap({ center: p.lngLat, zoom: 15 });
            }}
          />
        </div>
      )}
      {tab === 'map' && place && <SheetHeight><PlaceCard place={place} onClose={() => setPlace(null)} /></SheetHeight>}
      {tab === 'map' && sheet === 'offline' && <SheetHeight><OfflineSheet /></SheetHeight>}
      {tab === 'plan' && <PlannerSheet />}
      {tab === 'record' && (session ? <NavigationScreen /> : <SheetHeight><RecordTab /></SheetHeight>)}
      {tab === 'routes' && (detailId ? <SheetHeight key={detailId}><RoutesScreen /></SheetHeight> : <RoutesScreen />)}
      {tab === 'profile' && <ProfileScreen />}
      {showMapControls && <MapControls bottom={controlsBottom} />}
      {session && tab !== 'record' && <MiniWidget />}
      {!navFull && <TabBar />}

      {pendingNav && <StartNavDialog route={pendingNav} onClose={() => useStore.getState().setPendingNav(null)} />}
      <MissedStopDialog />
      {sheet === 'layers' && <LayersSheet />}
      {sheet === 'roundtrip' && <RoundTripSheet />}
      {sheet === 'save' && <SaveSheet />}
      {toast && toastVisible && <div className="toast" key={toast.id} role="status">{toast.msg}</div>}
      {ready && !onboarded && <Onboarding />}
    </div>
  );
}

/** Publishes the height of the wrapped sheet as --sheet-h so map controls float above it. */
function SheetHeight({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.setProperty('--sheet-h', '0px');
    };
  }, []);
  return <div ref={ref} style={{ display: 'contents' }}>{children}</div>;
}
