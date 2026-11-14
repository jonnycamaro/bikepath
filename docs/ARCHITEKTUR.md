# Bikepath – Architektur und Umsetzung

Warum Bikepath eine Web-App ist, was damit geht und wo die Grenzen liegen.

## Android und iPhone ohne App Store

| Variante | Android ohne Store | iPhone ohne Store | GPS im Vordergrund | GPS bei gesperrtem Bildschirm | Aufwand |
|---|---|---|---|---|---|
| **A. PWA (Web-App, „Zum Home-Bildschirm“)** | ✅ Chrome „App installieren“ | ✅ Safari „Zum Home-Bildschirm“ | ✅ | ⚠️ nur solange der Bildschirm an ist (Wake Lock) | 1 Codebasis, sofort |
| B. PWA + Capacitor-Hülle | ✅ APK per Sideload | ⚠️ nur mit Apple-Developer-Konto, AltStore/Sideloadly (7-Tage-Signatur gratis) oder EU-Alternativ-Marktplatz | ✅ | ✅ mit Background-Geolocation-Plugin | gleicher Code + nativer Wrapper |
| C. Komplett nativ (Kotlin + Swift) | ✅ APK | ⚠️ wie B | ✅ | ✅ | doppelter Aufwand |

### Entscheidung: Variante A jetzt, B als Ausbaustufe

1. **Bikepath ist als PWA gebaut.** Es gibt genau eine Codebasis (React + TypeScript + MapLibre) und sie läuft auf Android und iPhone.
   Installiert wird ohne Store über einen Link: „Zum Home-Bildschirm“.
   Danach startet die App im Vollbild, mit eigenem Icon und offline.
2. **Hardware-Zugriff in der PWA:**
   - GPS über die Geolocation-API, mit hoher Genauigkeit und Geschwindigkeit/Richtung (✅ beide Plattformen)
   - Sprachansagen über die Speech-API (✅; iOS braucht dafür einmal einen Fingertipp, das ist beim Start der Navigation eingebaut)
   - Display bleibt an über die Wake-Lock-API (✅ Android, iOS ab 16.4)
   - Offline-Speicher über Service Worker, Cache Storage und IndexedDB (✅)
   - Kompass: Die Fahrtrichtung kommt aus dem GPS-Kurs (✅)
   - Teilen und Dateien über Web Share und den Datei-Import (✅)
3. **Grenze der PWA:** Ist der Bildschirm gesperrt, liefern iOS und Android an Web-Apps nach kurzer Zeit keine GPS-Punkte mehr.
   Lösung in Bikepath: Während Navigation und Aufnahme hält die App den Bildschirm an.
   So machen es auch die meisten Rad-Navis am Lenker.
   Für Aufnahmen mit gesperrtem Bildschirm ist **Variante B** die nächste Stufe.
   Dabei wird derselbe Code in eine Capacitor-Hülle gepackt und bekommt ein Hintergrund-GPS-Plugin.
   - Android: Die APK lässt sich ohne Play Store direkt installieren.
   - iPhone: Ohne Store ist das nur über AltStore oder Sideloadly möglich (Signatur muss alle 7 Tage erneuert werden) oder mit dem Apple-Developer-Programm (99 €/Jahr, TestFlight bzw. Ad-hoc).
     In der EU gibt es zusätzlich alternative Marktplätze.
4. **HTTPS ist Pflicht für GPS.** Zum Testen auf dem Handy dient `npm run dev:phone` mit einem selbstsignierten Zertifikat im WLAN.
   Für den Dauerbetrieb liegt die gebaute App (`dist/`) auf einem statischen HTTPS-Hosting; eingerichtet ist GitHub Pages.

## Aufbau

```
React-UI (Tabs, Sheets)  ──  zustand-Store (Planer, Einstellungen, Bibliothek)
        │                          │
   MapLibre GL  ◄── Kartenstile (OpenFreeMap-Vektor, CyclOSM, OSM, Topo, Esri), Terrain (AWS Terrarium)
        │
   session.ts  ── Recorder (Aufzeichnung) + NavigationEngine (Snapping, Ansagen, Off-Route) ── location.ts (GPS / Simulator)
        │
   lib/: routing (BRouter), instructions, geocode (Photon), pois/poiTiles (OpenFreeMap-Vektorkacheln), weather (Open-Meteo),
         gpx (GPX/KML), offline (Cache Storage), storage (IndexedDB), speech, wakelock, roundtrip
```

Alle Dienste sind kostenlos, brauchen keinen API-Schlüssel und erlauben CORS. Geprüft wurde das am 13.11.2026.
Die Nutzungsbedingungen der Kachelserver gelten trotzdem.
Den Offline-Download bietet Bikepath deshalb nur für die OpenFreeMap-Vektorkarte an.
Die OSM-, CyclOSM- und OpenTopoMap-Server verbieten Massen-Downloads.

## Messwerte, die im Code stecken

Einige Schwellen sind nicht willkürlich gewählt, sondern an etwas Messbares gebunden:

- **Auto-Pause** greift unter 2 km/h, aber nur bei einer Ortung genauer als 15 m, und erst nach 5 Sekunden. Ohne die Genauigkeitsschranke pausiert die Aufnahme bei schlechtem Empfang im Stand ständig von selbst.
- **GPS-Hinweis** mit Hysterese: Warnung erst nach zwei aufeinanderfolgenden Messungen schlechter als 35 m, Entwarnung erst unter 25 m. Eine feste Schwelle lässt den Hinweis flackern, weil die Genauigkeit um jeden Einzelwert schwankt.
- **Höhenmeter:** Der vertikale Fehler einer GNSS-Ortung liegt bei rund dem 1,5-fachen der horizontalen Genauigkeit. Die Schwelle, ab der ein Anstieg zählt, wird daraus abgeleitet (begrenzt auf 5 bis 30 m), davor läuft ein Medianfilter über fünf Punkte.
- **GPS-Sprünge** über 30 m/s (108 km/h) werden verworfen, Stillstandszittern unter 2 m ebenfalls.

## Bekannte Grenzen

- Routing, Suche, POIs und Wetter brauchen Internet. Gespeicherte Routen lassen sich offline navigieren, aber ohne Netz gibt es keine Neuberechnung.
- Die öffentlichen Server (BRouter, Photon, OpenFreeMap) sind Gratisdienste ohne Garantie. Bei vielen Nutzern ist ein eigener BRouter-Server (Docker) zu empfehlen.
- Keine Uhren- oder Garmin-Anbindung, keine Unfallerkennung. Dafür braucht es native Apps.
- Bei gesperrtem Bildschirm friert die Ortung ein. Siehe Variante B oben.
