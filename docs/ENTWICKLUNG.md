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
| `geocode.ts`, `pois.ts`, `weather.ts` | Photon, Overpass, Open-Meteo |
| `gpx.ts` | GPX- und KML-Import und -Export |
| `mapStyles.ts`, `routeStyle.ts` | Kartenstile, Overlays, Einfärbung nach Steigung |
| `speech.ts`, `wakelock.ts`, `batterySave.ts` | Sprachausgabe, Display anlassen, Energiesparen |
| `roundtrip.ts` | Wegpunkte für eine Rundtour |

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
- `icon` muss in `src/components/icons.tsx` vorhanden sein, sonst bleibt die Fläche leer.
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
