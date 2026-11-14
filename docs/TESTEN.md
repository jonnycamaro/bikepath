# Testen

## Unit-Tests

```bash
npm test
```

59 Tests in vier Dateien, Laufzeit rund 18 Sekunden.

| Datei | Inhalt |
|---|---|
| `tests/core.test.ts` | Geometrie, BRouter-Auswertung an einer echten Antwort, Abbiegehinweise, Navigations-Engine, Recorder, GPX/KML, Rundtour, Offline-Kacheln |
| `tests/features.test.ts` | Steigungserkennung, selbstgeführter Modus, Routen-Operationen, Auto-Pause-Schwellen, Profilparameter, Wegpunkt-Fortschritt |
| `tests/session.test.ts` | Wiederherstellen einer unterbrochenen Fahrt, GPS-Signalhinweis |
| `tests/store.test.ts` | Planer-Store gegen IndexedDB, mit BRouter-Antwort aus `tests/fixtures/` |

Die Tests sprechen **kein Netz** an. `tests/store.test.ts` ersetzt `fetch` durch eine
gespeicherte BRouter-Antwort, IndexedDB kommt von `fake-indexeddb`.

### Warum einige Tests Sekunden brauchen

`tests/session.test.ts` arbeitet mit echten Zeitgebern, weil der Watchdog im
3-Sekunden-Takt läuft und sich mit künstlichen Zeitgebern nicht sauber mit
IndexedDB verträgt. Das kostet etwa 17 Sekunden. Bewusst in Kauf genommen –
die Alternative wäre ein Test gewesen, der die Zeitsteuerung gar nicht prüft.

### Ein Test muss ohne die Korrektur fehlschlagen

Bei jeder Fehlerkorrektur gehört dazu, den neuen Test einmal gegen den **alten**
Code laufen zu lassen. Ein Test, der immer grün ist, sichert nichts.
Praktisch: Korrektur kurz zurücknehmen, Test laufen lassen, Fehlschlag sehen,
Korrektur wiederherstellen.

## Dienste live prüfen

```bash
npm run test:live
```

Ruft BRouter, Photon, Open-Meteo und die Kachelserver (auch für die POIs) wirklich auf.
Braucht Internet und ist **absichtlich nicht Teil von `npm test`**: Die
öffentlichen Gratisdienste sind manchmal überlastet und antworten mit 429, 502 oder 504.
Ein Fehlschlag dort heißt zuerst „Server gerade überlastet", nicht „Code kaputt".

## Auf dem Handy testen

Am Mac liefert der Browser nur eine grobe Ortung. Alles, was mit Bewegung,
Ansagen oder Display zu tun hat, lässt sich nur auf einem echten Gerät beurteilen.

Chrome gibt den Standort nur an sichere Seiten heraus: `https://…` oder `localhost`.
Über `http://<IP-des-Macs>:5173` lädt die App zwar, meldet aber „Standortzugriff
verweigert“ – ohne dass Chrome überhaupt fragt.

### Weg 1: HTTPS im WLAN (ohne Kabel und ohne adb)

```bash
npm run dev:phone
```

Am Handy `https://<IP-des-Macs>:5173` öffnen (die IP zeigt Vite beim Start), die
Zertifikatswarnung über „Erweitert → Weiter zu …“ einmal bestätigen und den Standort
erlauben. Danach funktionieren GPS, Service Worker und Wake Lock. Am Mac heißt die
Adresse dann `https://localhost:5173`; die http-Adresse geht nicht mehr.

### Weg 2: Portweiterleitung über adb

Die App erscheint dem Browser als `localhost` und gilt damit als sichere Herkunft –
ohne Zertifikat und unabhängig von WLAN-Berechtigungen.

```bash
npm run dev
```

```bash
adb reverse tcp:5173 tcp:5173
```

Danach am Handy `http://localhost:5173` öffnen. Die Weiterleitung hält, solange die
adb-Verbindung steht; schläft das Handy länger, muss sie neu eingerichtet werden.

### Android 17: „Geräte in der Nähe“ für Chrome

Ab Android 17 braucht jede App die Berechtigung **„Geräte in der Nähe“**
(`ACCESS_LOCAL_NETWORK`), um Geräte im eigenen Netz zu erreichen. Fehlt sie Chrome,
verlässt die Anfrage an die IP des Macs das Handy gar nicht, und Chrome zeigt
`ERR_TOO_MANY_RETRIES` – bei http und https gleich. Mit dem Zertifikat hat das nichts zu
tun. Erkennen lässt es sich so:

```bash
adb shell appops get com.android.chrome | grep LOCAL_NETWORK
```

Steht dort `ACCESS_LOCAL_NETWORK: ignore` und springt `rejectTime` bei jedem Aufruf neu,
ist es diese Sperre. Abhilfe am Handy: Einstellungen → Apps → Chrome → Berechtigungen →
„Geräte in der Nähe“ → Zulassen, dann Chrome neu starten. Weg 2 ist von der Sperre
nicht betroffen.

Weitere Fehlerquellen, die sich bei der Suche als harmlos erwiesen haben: Die
macOS-Firewall war aus, Vite lauscht mit `--host` auf allen Schnittstellen, und
Tailscale am Handy leitet das Heimnetz nicht um, solange kein Exit-Node aktiv ist.

### Verbindung ohne Kabel

Am Handy unter Einstellungen → System → Entwickleroptionen das **drahtlose
Debugging** einschalten, beim ersten Mal über „Gerät mit Kopplungscode koppeln"
verbinden:

```bash
adb pair <IP>:<Kopplungs-Port>
```

Später genügt:

```bash
adb mdns services
```

```bash
adb connect <IP>:<Port>
```

### Was sich nur draußen zeigt

- Ob die Ansagen zeitlich passen, wenn man wirklich fährt
- Ob der Höhenfilter bei gutem Empfang echte Anstiege noch mitzählt
- Ob die Neuberechnung bei einer Abweichung schnell genug greift

Im Haus liegt die Ortungsgenauigkeit bei 20 bis 60 m und das Gerät meldet im
Stand mehrere km/h. Zahlen aus solchen Messungen sind für die Beurteilung
der Genauigkeit wertlos – für Abläufe und Oberfläche aber brauchbar.

### Simulierte Fahrt

Im Startdialog der Navigation („Weiter mit“) gibt es den Schalter **„Simulation
aktivieren“**. Er ist jedes Mal aus. Eingeschaltet fährt die App die Route virtuell ab,
mit 20 km/h und 4-facher Geschwindigkeit, ab dem gewählten Einstiegspunkt. Damit lassen
sich Ansagen, Abbiegebanner, Fahrradcomputer und Ankunft prüfen, ohne vor die Tür zu
gehen. Beim Beenden der Navigation schaltet die App zurück auf echtes GPS.

Ist im Profil „Nicht mehr fragen“ gesetzt, erscheint der Dialog nicht – dann den
Navigationsmodus wieder auf „Fragen“ stellen.

Eigenheit: Der Simulator setzt eigene, beschleunigte Zeitstempel – eine so
aufgezeichnete Fahrt hat deshalb andere Zeiten als eine echte.

## Im Browser am Mac durchspielen

Für Abläufe ohne echtes GPS (Planer, POI-Karte, Dialoge) reicht ein ferngesteuerter
Chromium am Mac. Der Standort lässt sich dabei frei vorgeben. Playwright ist kein Teil
des Projekts; `playwright-core` in einem eigenen Ordner außerhalb des Repos genügt, der
Browser aus `~/Library/Caches/ms-playwright` wird über `executablePath` angegeben.

```js
const ctx = await browser.newContext({
  ignoreHTTPSErrors: true,                      // für npm run dev:phone
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 53.2606, longitude: 7.4572 },
  permissions: ['geolocation'],
});
```

Hilfreich:

- `window.__bikepathMap` ist die Hauptkarte, `window.__poiMap` die gerade offene
  POI-Karte. Damit lässt sich zoomen (`jumpTo`) und mit `queryRenderedFeatures` prüfen,
  was gezeichnet ist (Ebenen `pois-cluster`, `pois-point`, in der POI-Karte
  `poi-cluster`, `poi-point`).
- Ein Ort auf der Karte wird angetippt, indem man seine Koordinate mit `project()` in
  Pixel umrechnet und dorthin klickt.
- Testkennungen (Auswahl): `onboard-start`, `tab-plan`, `plan-mode-trip`,
  `plan-mode-loop`, `nav-plan-trip`, `poi-open`, `poi-picker`, `poi-filter`, `poi-status`,
  `poi-card`, `poi-take`, `link-google`, `link-tripadvisor`, `layers-btn`, `place-card`,
  `mode-turn`, `nav-go`.

## Fehlersuche am Gerät

Chrome auf Android lässt sich vom Mac aus auslesen:

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

`http://localhost:9222/json/list` listet dann die offenen Tabs mit ihrer
WebSocket-Adresse. Darüber lassen sich Konsolenmeldungen mitlesen und
Ausdrücke in der Seite auswerten.

**Dabei sind alle Tabs des Nutzers sichtbar, auch private.** Nur den Tab der
eigenen App anfassen.
