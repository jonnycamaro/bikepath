# Bikepath 🚲

Fahrrad-Routenplaner und Navigations-App für **Android und iPhone**.
Bikepath ist eine installierbare Web-App (PWA). Sie braucht keinen App Store und läuft mit einer Codebasis auf beiden Plattformen.

**Dokumentation**

| | |
|---|---|
| [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) | Warum eine Web-App, Aufbau, bekannte Grenzen |
| [docs/ENTWICKLUNG.md](docs/ENTWICKLUNG.md) | Codeaufbau, häufige Änderungen, Konventionen, Fallstricke |
| [docs/TESTEN.md](docs/TESTEN.md) | Unit-Tests, Dienste live prüfen, Test auf dem Handy |
| [docs/VEROEFFENTLICHEN.md](docs/VEROEFFENTLICHEN.md) | Deploy über GitHub Pages, Basispfad, Fehlersuche |

Unter `.claude/skills/` liegen zusätzlich Anleitungen für Claude Code
(Handytest, Browser-Test am Mac, Veröffentlichen, Routing-Profile).

## Funktionen

- **Suche:** Lupe oben rechts auf Karte, Planen und Navigieren. Ein Vorschlag zoomt zum Ort; Enter bzw. „Alle Treffer auf der Karte zeigen“ zeigt alle Treffer (bis 40) als Punkte mit Liste, nach Entfernung sortiert. Beim Planen wird um den letzten Routenpunkt gesucht, sonst um den sichtbaren Kartenausschnitt.
- **Karte:** Suche (Adressen, Orte, Koordinaten), eigener Standort mit Folgemodus und Fahrtrichtung, 7 Kartenstile, 3D-Gelände, Ebenen (Radrouten, MTB-Routen, Relief, POIs). Langes Drücken auf die Karte öffnet „Route hierher“.
- **POIs:** Cafés, Restaurants, Supermärkte, Trinkwasser, WCs, Radläden, Sehenswürdigkeiten, Unterkünfte und mehr aus OpenStreetMap – 14 Kategorien, einzeln wählbar. Als Kartenebene zuschaltbar; herausgezoomt fassen Kreise mit Anzahl nahe Orte zusammen, ein Tipp zoomt hinein. Ein angetippter Ort zeigt Name, Kategorie und Links „Google Maps“ und „Tripadvisor“.
- **Planen:**
  - Zuerst die Art wählen: **Strecke** (Ziel mit Zwischenstopps) oder **Rundtour** – im Planen-Tab und im Navigieren-Tab
  - Bei aktivem GPS ist der eigene Standort automatisch der Start
  - Start, Ziel und Zwischenpunkte per Antippen, Suche oder über die POI-Karte setzen (Symbol rechts im Suchfeld)
  - Punkte verschieben, Routenlinie ziehen, um einen Punkt einzufügen
  - Rückgängig, Wiederholen, Umkehren, Reihenfolge ändern, Freihand-Abschnitte
  - 9 Routing-Optionen: Ausgewogen, Schnellste, Radwege, Rennrad, Geschmeidig, Gravel, Mountainbike, E-Bike, Kürzeste
  - Eigene Routenoptionen (Profil → Eigene Routenoptionen): Wegarten und Untergründe in Wunschreihenfolge, je Ja/Meiden/Nie; Höhenmeter meiden, höchste Steigung und höchstes Gefälle; Radrouten, Schieben, Treppen, Fähren, Tempo; Name, Kommentar, Symbol und Farbe. Vorlagen: Ausgewogen, Rennrad, Gravel, Familie
  - Radweg-Stufe niedrig/mittel/hoch
  - Distanz, Dauer, Auf- und Abstieg, Höhenprofil nach Steigung eingefärbt
  - Route Insights: Untergrund, Wegtyp und Steigung, auch farbig auf der Karte
  - Geschwindigkeitsregler, Wetter mit Gegenwind-Anteil, Rundtour-Planer
- **Navigation:**
  - Zwei Modi: Turn-by-Turn mit Ansagen oder Selbstgeführt (nur Position auf der Linie)
  - Einstiegspunkt wählbar: Routenstart, nächster Punkt oder Route umkehren
  - Abbiege-Banner mit „Dann …“, Sprachansagen auf Deutsch
  - Automatische Neuberechnung – führt wahlweise zurück auf die geplante Route
  - Steigungsansagen und Anstiegsanzeige („Anstieg 2/5 · 7 %“)
  - Hinweis bei verpasstem Zwischenstopp: Überspringen oder Zurückgehen
  - Fahrradcomputer mit 4 Layouts; langer Druck auf ein Feld ändert es
  - Höhen-Vorschau, Abbiegeliste, Hinweis bei schwachem GPS
  - Display bleibt an; Minimieren-Widget für die anderen Tabs
- **Aufzeichnen:** Freie Fahrt mit Pause und Auto-Pause (unter 2 km/h, nur bei gutem GPS), mit Ansage. Wird die App unterbrochen, lässt sich die Fahrt wiederherstellen – samt GPS-Überwachung, Bildschirmsperre und Batteriesparmodus.
  Die Höhenwerte des Handys sind ungenauer als die Position: Bikepath glättet sie und leitet die Schwelle fürs Zählen von Höhenmetern aus der tatsächlichen Messgenauigkeit der Fahrt ab, damit eine flache Runde keinen Aufstieg erfindet. Der GPX-Export enthält weiterhin die Rohwerte.
- **Batteriesparmodus:** Aus, nach Geräteeinstellung oder immer an – seltenere Ortung, Dunkelmodus und vereinfachte Karte.
- **Meine Routen:** Geplant, Gefahren, Favoriten, Sammlungen. Detailansicht, Bearbeiten, Umbenennen, Löschen.
  - Import: GPX und KML
  - Export: GPX und KML, auch über das Teilen-Menü
- **Profil:** Eigene Routenoptionen anlegen und bearbeiten, App-Link teilen (Teilen-Menü des Handys), Rechtliches & Lizenzen (Quellenangaben, Open-Source-Lizenzen). Statistik für 7 Tage, 30 Tage und gesamt. Navigationsmodus, Batteriesparmodus, Darstellung (System/Hell/Dunkel), Adressen, Fahrradcomputer-Layouts, Offline-Karten.
- **Offline:** App-Shell, gespeicherte Routen und heruntergeladene Kartengebiete funktionieren ohne Netz.
- **Simulation:** Im Startdialog der Navigation („Weiter mit“) schaltet „Simulation aktivieren“ eine virtuelle Fahrt entlang der Route ein (standardmäßig aus). Gedacht für Demo und Test.

## Starten

```bash
npm install
```

```bash
npm run dev
```

Öffnet http://localhost:5173. Am Mac-Browser ist GPS nur ungenau verfügbar.

### Auf dem Handy testen (gleiches WLAN)

```bash
npm run dev:phone
```

Auf dem Handy `https://<IP-des-Macs>:5173` öffnen und die Zertifikatswarnung bestätigen. GPS funktioniert nur über HTTPS (oder `localhost`). Unter Android 17 braucht Chrome dafür die Berechtigung „Geräte in der Nähe“ – Details und weitere Wege in [docs/TESTEN.md](docs/TESTEN.md).

### Dauerhaft installieren (ohne Store)

1. Build erstellen:

   ```bash
   npm run build
   ```

2. Den Ordner `dist/` auf ein HTTPS-Hosting hochladen, z. B. GitHub Pages, Cloudflare Pages oder Netlify (alle kostenlos).
3. Auf dem Handy installieren:
   - **iPhone:** Link in Safari öffnen → Teilen → **„Zum Home-Bildschirm“**
   - **Android:** Link in Chrome öffnen → Menü → **„App installieren“**

Danach startet Bikepath im Vollbild mit eigenem Icon.

## Tests

```bash
npm test
```

Unit-Tests (über 70): Geometrie, BRouter-Parser mit einer echten Antwort, Abbiegehinweise, Navigations-Engine (Ansagen, Verlassen der Route, Ankunft, selbstgeführter Modus), Steigungserkennung und -ansagen, Routen-Operationen (Einstiegspunkt, Umkehren, Rückführung auf die Route), Recorder (Auto-Pause-Schwellen, GPS-Sprünge, Zeitmessung, Höhenfilter), GPX/KML, Rundtour, Offline-Kacheln, Planer-Store mit IndexedDB und die Fahrt-Session (Wiederherstellen nach Unterbrechung, GPS-Signalhinweis).

```bash
npm run test:live
```

Prüft die öffentlichen Dienste live; braucht Internet.

```bash
npm run typecheck
```

## Technik

React 18, TypeScript, Vite, MapLibre GL, zustand, idb-keyval, vite-plugin-pwa (Workbox).

| Zweck | Dienst |
|---|---|
| Routing | [BRouter](https://brouter.de) |
| Suche | [Photon](https://photon.komoot.io) |
| Vektorkarten | [OpenFreeMap](https://openfreemap.org) |
| Rasterkarten | CyclOSM, OSM, OpenTopoMap, Esri |
| Höhen | AWS Terrain Tiles |
| POIs | OpenStreetMap-Daten aus den OpenFreeMap-Vektorkacheln |
| Wetter | Open-Meteo |

Alle Dienste sind kostenlos und brauchen keinen API-Schlüssel. Kartendaten © OpenStreetMap-Mitwirkende.

**Hinweis zu Google und Tripadvisor:** Bikepath zeigt keine Inhalte dieser Dienste an, sondern verlinkt nur auf deren Suche (Google „Maps URLs“, ohne Schlüssel). Daten gehen erst beim Antippen eines Links dorthin.
