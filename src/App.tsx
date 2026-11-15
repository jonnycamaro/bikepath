import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from './lib/geocode';
import { formatDistance, haversine, type LngLat } from './lib/geo';
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
import ExternalLinks from './components/ExternalLinks';
import PlaceDetails from './components/PlaceDetails';
import LegalSheet from './components/LegalSheet';
import ProfileEditor from './components/ProfileEditor';
import { BikeSheet } from './components/BikeSheet';
import { RoundTripSheet } from './components/RoundTripSheet';
import { LayersSheet, OfflineSheet, ProfileSheet, SaveSheet } from './components/Sheets';
import StartNavDialog, { MissedStopDialog } from './components/StartNavDialog';
import { Icon3D, IconBike, IconClose, IconDown, IconSearch, IconUp, IconCompass, IconHeading, IconLayers, IconLocate, IconMap, IconNavigate, IconPlan, IconProfile, IconRecord, IconRoutes } from './components/icons';

function TabBar() {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const live = useStore((s) => !!s.session);
  const items: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'map', label: 'Karte', icon: <IconMap /> },
    { id: 'plan', label: 'Planen', icon: <IconPlan /> },
    { id: 'record', label: live ? 'Live' : 'Navigieren', icon: live ? <IconRecord /> : <IconNavigate /> },
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
    <div className="sheet place-sheet" data-testid="place-card">
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
        <PlaceDetails place={place} />
        <div className="spacer" />
        <ExternalLinks place={place} />
      </div>
    </div>
  );
}

/**
 * Place search on the map: a round button top right (as in other map apps) that opens the
 * search field. Map: the result opens the place card. Planner: a small card offers to add it
 * to the route. Navigieren: switches to the map with the place card ("Route hierher").
 */
function MapSearch() {
  const [open, setOpen] = useState(false);
  const pick = (p: Place) => {
    const s = useStore.getState();
    setOpen(false);
    if (s.tab === 'record') s.setTab('map');
    s.showPlace(p);
    s.focusMap({ center: p.lngLat, zoom: 15 });
  };
  /** Enter without picking: every result as a point on the map, the nearest ones in view */
  const showAll = async (query: string, near?: LngLat) => {
    setOpen(false);
    const s = useStore.getState();
    try {
      const found = await searchPlaces(query, near, undefined, 40);
      const dist = (p: Place) => (near ? haversine(near, p.lngLat) : 0);
      const places = [...found].sort((a, b) => dist(a) - dist(b));
      if (!places.length) return s.toastMsg(`Keine Treffer für „${query}“`);
      if (s.tab === 'record') s.setTab('map');
      useStore.setState({ searchResults: { query, places, centre: near }, placeCard: null });
      // frame the nearest results (and the reference point), not one far away
      const view = places.slice(0, 10).map((p) => p.lngLat).concat(near ? [near] : []);
      const lons = view.map((c) => c[0]);
      const lats = view.map((c) => c[1]);
      s.focusMap(view.length > 1 ? { bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)] } : { center: view[0], zoom: 14 });
    } catch {
      s.toastMsg(navigator.onLine ? 'Suche fehlgeschlagen' : 'Suche ist offline nicht verfügbar');
    }
  };
  if (!open)
    return (
      <button className="fab map-search-btn" onClick={() => setOpen(true)} aria-label="Ort suchen" data-testid="map-search-btn">
        <IconSearch size={22} />
      </button>
    );
  return (
    <div className="topbar map-search-open" data-testid="map-search">
      <div className="grow">
        <SearchBox autoFocus onSelect={pick} onSubmit={showAll} />
      </div>
      <button className="fab small" onClick={() => setOpen(false)} aria-label="Suche schließen"><IconClose size={20} /></button>
    </div>
  );
}

/** Bar for the results of a submitted search: query, count, and a list to pick from. */
function SearchResultsBar() {
  const r = useStore((s) => s.searchResults)!;
  const [list, setList] = useState(false);
  const close = () => useStore.setState({ searchResults: null });
  const go = (p: Place) => {
    setList(false);
    useStore.getState().showPlace(p);
    useStore.getState().focusMap({ center: p.lngLat, zoom: 15 });
  };
  return (
    <div className="results-bar" data-testid="search-results">
      <div className="results-head">
        <button className="grow results-title" onClick={() => setList(!list)} aria-expanded={list} data-testid="search-results-toggle">
          <IconSearch size={18} />
          <span className="grow ellipsis">„{r.query}“ · {r.places.length} Treffer</span>
          {list ? <IconUp size={18} /> : <IconDown size={18} />}
        </button>
        <button className="icon-btn" onClick={close} aria-label="Treffer ausblenden"><IconClose size={18} /></button>
      </div>
      {list && (
        <div className="results results-list" data-testid="search-results-list">
          {r.places.map((p) => (
            <button key={p.id} className="result" onClick={() => go(p)}>
              <span className="result-dot" />
              <div className="grow">
                <div className="t">{p.name}</div>
                <div className="d">{p.detail}</div>
              </div>
              {r.centre && <div className="d">{formatDistance(haversine(r.centre, p.lngLat))}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Search result while planning: marker on the map and a card to add it to the route. */
function PlanPlaceCard({ place, onClose }: { place: Place; onClose: () => void }) {
  const s = useStore();
  useEffect(() => {
    if (!mapRef.current) return;
    const m = new maplibregl.Marker({ color: '#e5383b' }).setLngLat(place.lngLat).addTo(mapRef.current);
    return () => {
      m.remove();
    };
  }, [place]);
  const [more, setMore] = useState(false);
  const role = s.loop ? 'Als Zwischenstopp' : s.waypoints.length === 0 ? 'Als Start' : s.waypoints.length === 1 ? 'Als Ziel' : 'Als weiteren Punkt';
  return (
    <div className="plan-place-wrap" data-testid="plan-place">
      <div className="plan-place">
        <button className="grow plan-place-title" onClick={() => setMore(!more)} aria-expanded={more} data-testid="plan-place-more">
          <div className="poi-card-name">{place.name}</div>
          <div className="muted small ellipsis">{more ? 'Weniger anzeigen' : place.detail ? `${place.detail} · Details` : 'Details'}</div>
        </button>
        <button className="btn primary sm" onClick={() => { s.addWaypoint(place.lngLat, place.name); onClose(); }} data-testid="plan-place-add">{role}</button>
        <button className="icon-btn" onClick={onClose} aria-label="Schließen"><IconClose size={18} /></button>
      </div>
      {more && (
        <div className="plan-place-details">
          <PlaceDetails place={place} />
          <div className="spacer" />
          <ExternalLinks place={place} />
        </div>
      )}
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
  const profileEditor = useStore((s) => s.profileEditor);
  const searchResults = useStore((s) => s.searchResults);
  const place = useStore((s) => s.placeCard);
  const setPlace = useStore((s) => s.showPlace);
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
    if (tab !== 'map' && tab !== 'plan') setPlace(null); // setTab clears it when switching between map and plan
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

      {(tab === 'map' || tab === 'plan' || (tab === 'record' && !session)) && sheet !== 'offline' && <MapSearch key={tab} />}
      {(searchResults || (tab === 'plan' && place)) && (
        <div className="top-stack">
          {searchResults && <SearchResultsBar />}
          {tab === 'plan' && place && <PlanPlaceCard place={place} onClose={() => setPlace(null)} />}
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
      {sheet === 'profile' && <ProfileSheet />}
      {sheet === 'bike' && <BikeSheet />}
      {sheet === 'layers' && <LayersSheet />}
      {sheet === 'roundtrip' && <RoundTripSheet />}
      {sheet === 'save' && <SaveSheet />}
      {sheet === 'legal' && <LegalSheet />}
      {profileEditor && <ProfileEditor key={profileEditor} />}
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
