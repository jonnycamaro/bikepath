# Entwicklung

Wie der Code aufgebaut ist und wo man für eine bestimmte Änderung ansetzt.
Für das Warum hinter der Technikwahl siehe [ARCHITEKTUR.md](ARCHITEKTUR.md).

## Loslegen

```bash
npm install
npm run dev
```

Läuft auf http://localhost:5173. Am Mac liefert der Browser nur eine grobe Ortung –
für echtes GPS siehe [TESTEN.md](TESTEN.md).

## Die drei Schichten

```
Komponenten (src/components)   React, zeigt an und nimmt Eingaben entgegen
        │
Store + Session (src/store.ts, src/session.ts)   Zustand und Ablaufsteuerung
        │
Bibliothek (src/lib)   reine Logik und Dienste, kennt kein React
```

Die Regel, an der sich fast alles ausrichtet: **`src/lib` enthält keine React-Importe.**
Dadurch ist die gesamte Rechenlogik ohne Browser testbar, und die Tests laufen in
unter einer Sekunde. Wer eine Berechnung in eine Komponente schreibt, nimmt ihr die
Testbarkeit.

### src/lib – die Bausteine

| Datei | Zuständig für |
|---|---|
| `geo.ts` | Entfernung, Peilung, Punkt auf Linie, Formatierung (deutsche Zahlen mit Komma) |
| `routing.ts` | Routing-Profile, BRouter-Aufruf und -Auswertung, `Route`-Typ |
| `instructions.ts` | Abbiegehinweise aus Winkeln und BRouter-Sprachhinweisen |
| `navigation.ts` | `NavigationEngine`: Position auf die Route schnappen, Ansagen, Abweichung, Ankunft |
| `recording.ts` | `Recorder`: Fahrt aufzeichnen, Auto-Pause, Statistik, Höhenfilter |
| `routeOps.ts` | Route zuschneiden, umkehren, nach einer Abweichung wieder zusammenfügen |
| `climbs.ts` | Anstiege und Abfahrten erkennen |
| `location.ts` | GPS über `watchPosition` und der Simulator für Demo und Test |
| `storage.ts` | Einstellungen und Routenbibliothek in IndexedDB |
| `offline.ts` | Kartenkacheln in den Cache Storage laden |
| `geocode.ts`, `weather.ts` | Photon, Open-Meteo |
| `pois.ts` | POI-Kategorien (`POI_META`, `PICKER_TYPES`) und Zuordnung der OpenMapTiles-Klassen (`classifyTilePoi`) |
| `poiTiles.ts` | Orte aus den OpenFreeMap-Vektorkacheln der Zoomstufe 14 laden und dekodieren, mit Zwischenspeicher |
| `poiLayers.ts` | POIs auf eine MapLibre-Karte zeichnen: gruppiert (Kreis mit Anzahl), Symbole je Kategorie; genutzt von Hauptkarte und POI-Karte |
| `externalLinks.ts` | Links „Google Maps“ (offizielle Maps URLs) und „Tripadvisor“ (Suche) für einen Ort |
| `gpx.ts` | GPX- und KML-Import und -Export |
| `mapStyles.ts`, `routeStyle.ts` | Kartenstile, Overlays, Einfärbung nach Steigung |
| `speech.ts`, `wakelock.ts`, `batterySave.ts` | Sprachausgabe, Display anlassen, Energiesparen |
| `roundtrip.ts` | Rundtour-Suche: kein Kreis, sondern Wendepunkt in der gewählten Richtung; Vorgabe als Distanz oder Fahrzeit; Hinweg frei geroutet, Rückweg mit Strafkosten auf dem Hinweg; Zwischenstopps werden eingereiht (weitester Stopp = Wendepunkt); `LoopProblem` meldet, wenn Stopps nicht in Umfang oder Richtung passen, samt Lösungswert |
| `bike.ts` | Fahrradtypen und das Tempo daraus (`rideSpeed`): Grundlage für Fahrzeiten, Ankunft und Rundtouren nach Zeit; die Routenoption verschiebt es nur leicht |

### store.ts – was die Oberfläche sieht

Ein zustand-Store. Er hält den Routenplaner (Wegpunkte, berechnete Route,
Rückgängig-Stapel), die Einstellungen, die gespeicherten Routen und den
Anzeigezustand (aktiver Tab, offenes Sheet, Kartenmodus).

`recompute()` ist die zentrale Stelle: Sie ruft das Routing auf, sobald sich
Wegpunkte oder Profil ändern. Dort sitzt auch die Rückfallkette für die
Radweg-Stufe – schlägt „hoch" fehl, wird „mittel" versucht, dann „niedrig",
jeweils mit einem Hinweis an den Nutzer.

### session.ts – die laufende Fahrt

Besitzt den `Recorder`, optional die `NavigationEngine` und das GPS-Abonnement.
Pro Positionsmeldung schiebt es eine fertige Momentaufnahme in den Store.

Zwei Dinge, die man leicht übersieht:

- **`attachLive()`** hängt eine Fahrt an GPS, Persistenz-Timer, Watchdog, Wake Lock
  und Batteriesparmodus. Sowohl eine frisch gestartete als auch eine nach einer
  Unterbrechung wiederhergestellte Fahrt muss da durch. Wer einen neuen Startweg
  einbaut und das vergisst, bekommt eine Fahrt ohne Überwachung, die niemandem
  auffällt, bis sie unterwegs schiefgeht.
- **Der Watchdog** läuft alle 3 Sekunden, pausiert bei abreißendem GPS und steuert
  den Signalhinweis.

## Häufige Änderungen

### Ein Routing-Profil hinzufügen

In `src/lib/routing.ts` einen Eintrag in `PROFILES` ergänzen:

```ts
{ id: 'tour', label: 'Tagestour', description: 'Kurze Erklärung für die Auswahl',
  brouter: 'trekking', params: { allow_steps: 0 }, speedKmh: 18, icon: 'balanced' }
```

- `brouter` ist ein Profilname des BRouter-Servers (`trekking`, `fastbike`,
  `fastbike-lowtraffic`, `safety`, `mtb`, `shortest`). `null` bedeutet Freihand ohne Routing.
- `params` wird als `profile:<name>=<wert>` angehängt und überschreibt einzelne
  Variablen des BRouter-Profils.
- `icon` ist ein Schlüssel in `PROFILE_GLYPHS` und `PROFILE_COLORS` (`src/components/icons.tsx`).
  Ohne Eintrag zeigt das Auswahlfenster „Routenoption“ das Symbol von „Ausgewogen“ in Blau.
- `speedKmh` ist nur die Vorbelegung für die Zeitschätzung; der Nutzer kann sie im Planer ändern.

Es braucht keine weitere Registrierung – Planer und Einstellungen lesen `PROFILES` direkt.

### Ein Feld für den Fahrradcomputer hinzufügen

`COMPUTER_FIELDS` in `src/components/NavigationScreen.tsx` erweitern und den Wert
in der Anzeigefunktion berechnen. Die Layouts in `BUILTIN_LAYOUTS`
(`src/lib/storage.ts`) verweisen über den Schlüssel darauf.

### Eine Einstellung hinzufügen

1. Feld im `Settings`-Interface in `src/lib/storage.ts` ergänzen **und** einen
   Vorgabewert setzen. Gespeicherte Einstellungen werden mit den Vorgaben
   zusammengeführt, ein fehlender Vorgabewert ist bei bestehenden Installationen `undefined`.
2. Bedienelement in `src/components/ProfileScreen.tsx` einbauen.

### Einen Kartenstil hinzufügen

`MAP_STYLES` in `src/lib/mapStyles.ts`. Rasterquellen brauchen eine
Attributionszeile – die Nutzungsbedingungen der Kachelserver verlangen das.
Für den Offline-Download kommt nur OpenFreeMap in Frage, die anderen Server
verbieten Massenabrufe.

## POIs

Die Orte kommen **nicht** aus einer Abfrage-API, sondern aus den Vektorkacheln, die
die Karte ohnehin lädt. Das ist schnell, braucht keinen Schlüssel und funktioniert
mit Offline-Karten. Overpass wurde dafür aufgegeben: Die öffentlichen Server waren
überlastet, `overpass-api.de` sperrte Anfragen sogar ganz (406).

- **Nur Zoomstufe 14 enthält alle Orte** (gemessen Hamburg-Innenstadt: z14 4.618,
  z13 46, z12 90, z11 0). `poiTiles.ts` lädt deshalb für den sichtbaren Bereich selbst
  die z14-Kacheln, auch wenn die Karte weiter herausgezoomt ist – höchstens
  `MAX_POI_TILES` (64) auf einmal. Darüber zeigt die Karte nur bereits Geladenes.
- **Gruppieren** übernimmt MapLibre (`cluster: true` an der GeoJSON-Quelle): Orte,
  die näher als `CLUSTER_RADIUS` (60 px) beieinander liegen, werden ein Kreis mit
  Anzahl. Weil der Radius in Pixeln gilt, bleibt die Zahl der Kreise beim Zoomen etwa
  gleich. Ab Zoom 16 steht jeder Ort einzeln.
- **Zwei Stellen, eine Einstellung:** die Ebene „POIs“ auf der Hauptkarte
  (`MapView.tsx`, Quelle `pois`) und die POI-Karte beim Planen (`PoiPicker.tsx`, eigene
  Karte, Quelle `poi`). Beide lesen die gewählten Kategorien aus `settings.poiTypes`.
- **Google-Inhalte dürfen nicht angezeigt werden.** Die Places API verbietet Kunden im
  EWR seit Juli 2025, ihre Inhalte mit einer Nicht-Google-Karte zu zeigen. Deshalb nur
  Links (`externalLinks.ts`); Tripadvisor bekommt einen Link nur bei Kategorien, für die
  es dort Einträge gibt.

## Planen: Ablauf

- **Art zuerst:** `PlanModeChoice.tsx` (Strecke oder Rundtour) erscheint im Navigieren-Tab
  und im leeren Planer. `store.planKind` merkt sich „Strecke“; `clearPlan()` setzt es
  zurück, dann fragt der Planer wieder.
- **Start = eigener Standort:** Bei gewählter Strecke setzt `PlannerSheet` die GPS-Position
  einmal als Start. Entfernt der Nutzer ihn, bleibt er weg.
- **Suchfelder mit POI-Karte:** `SearchBox` mit `poiTitle` zeigt rechts das POI-Symbol und
  öffnet `PoiPicker`. Ein Tipp auf einen Ort zeigt eine Karte mit „Übernehmen“ und den Links.
- **Simulation** ist ein Schalter im Startdialog (`StartNavDialog.tsx`, standardmäßig aus)
  und wird an `startNavigation(route, { simulate })` übergeben.

## Lizenzen und Quellenangaben

- **Bibliotheken:** `build/licenses-plugin.mjs` sammelt beim Build die Lizenzen aller
  npm-Pakete, die im Bundle landen, und schreibt sie nach `dist/licenses.json`. Die App
  zeigt sie unter Profil → „Rechtliches & Lizenzen“ (`LegalSheet.tsx`). MIT, BSD, ISC und
  Apache-2.0 verlangen, Copyright und Lizenztext mitzuliefern; der Minifier behält nur
  einen Teil der Kommentare. Stand November 2026: 45 Pakete, keines unter GPL oder AGPL.
  Zwei Sonderfälle sind im Plugin-Aufruf in `vite.config.ts` von Hand eingetragen: die
  Workbox-Laufzeit im Service Worker (baut Workbox, nicht Rollup) und die Abhängigkeiten,
  die MapLibre schon fertig gebündelt mitbringt.
- **Daten und Dienste:** Die Quellenangaben stehen in `SOURCES` in `LegalSheet.tsx`. Wer
  einen Kartenstil, eine Ebene oder einen Dienst ergänzt, trägt ihn dort mit der
  geforderten Namensnennung ein. Open-Meteo (CC BY 4.0) ist zusätzlich direkt am
  Wetter im Planer genannt; die Karten selbst nennen ihre Quellen im Attributionsfeld.
- **Vor einer neuen Abhängigkeit** deren Lizenz prüfen: GPL/AGPL würde verlangen, den
  Quellcode der App unter derselben Lizenz offenzulegen.

## Konventionen

- **Sprache:** Oberfläche und Dokumentation auf Deutsch, Code und Kommentare auf Englisch.
- **Zahlen:** Immer über die `format*`-Funktionen aus `geo.ts` ausgeben, nie selbst
  zusammenbauen. Sie liefern deutsche Schreibweise mit Komma und passende Einheiten.
- **Kommentare** erklären das Warum, nicht das Was. Besonders bei Schwellenwerten:
  Wo eine Zahl im Code steht, gehört dazu, woher sie kommt.
- **Keine neuen Abhängigkeiten** ohne guten Grund. Die App lädt heute rund 1,7 MB;
  jedes Paket landet im Offline-Cache auf dem Handy.
- **Keine API-Schlüssel.** Alle genutzten Dienste sind frei und erlauben CORS.
  Ein Dienst mit Schlüssel wäre im Quelltext einer Web-App ohnehin sichtbar.

## Fallstricke

- **Vektorkacheln haben einen Randstreifen.** Jede Kachel enthält auch die Objekte knapp
  jenseits ihres Rands (damit Symbole an der Kante nicht abgeschnitten werden). Wer Orte
  aus mehreren Kacheln zusammenführt, zählt sie sonst doppelt oder vierfach.
  `decodePoiTile` übernimmt deshalb nur Punkte innerhalb `0 … extent`.
- **Neue Fassungen** schaltet `src/updates.ts` erst um, wenn weder Fahrt noch Planung
  offen ist – das Umschalten lädt die Seite neu, und die Planung lebt nur im Speicher.
  Wer neuen Zustand einführt, der ein Neuladen nicht überstehen soll, ergänzt ihn dort
  in `idle()`. Details in [VEROEFFENTLICHEN.md](VEROEFFENTLICHEN.md).
- **Steuerelemente der Karte** (Quellenangabe) sind per CSS über Tab-Leiste und Sheet
  angehoben. Vollbildkarten (`.rt-picker`, `.poi-picker`) setzen das zurück.

- **Kartenstil wechseln** setzt die Ebenen zurück. `map.setStyle(..., { diff: false })`
  ist Absicht, damit `style.load` feuert und die Routenlinie neu angelegt wird.
  Jeder Zugriff auf die Karte braucht vorher den `styleReady()`-Test, sonst wirft
  MapLibre „Style is not done loading".
- **GPS-Höhe ist ungenau.** Rohwerte gehören nicht in eine Statistik. `recording.ts`
  filtert sie; die Begründung steht in [ARCHITEKTUR.md](ARCHITEKTUR.md).
- **Der Simulator läuft 4-fach beschleunigt** und setzt eigene Zeitstempel. Alles,
  was Zeit misst, muss dieselbe Uhr benutzen wie die Positionsmeldungen.
- **Hot Reload und laufende Fahrten vertragen sich schlecht.** Beim Ändern von
  `session.ts` während einer Fahrt kann der alte Timer weiterlaufen. Bei merkwürdigem
  Verhalten die Seite neu laden, bevor man einen Fehler sucht.
