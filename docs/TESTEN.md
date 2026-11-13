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

Ruft BRouter, Photon, Open-Meteo, Overpass und die Kachelserver wirklich auf.
Braucht Internet und ist **absichtlich nicht Teil von `npm test`**: Die
öffentlichen Overpass-Server sind oft überlastet und antworten mit 429, 502 oder 504.
Ein Fehlschlag dort heißt zuerst „Server gerade überlastet", nicht „Code kaputt".

## Auf dem Handy testen

Am Mac liefert der Browser nur eine grobe Ortung. Alles, was mit Bewegung,
Ansagen oder Display zu tun hat, lässt sich nur auf einem echten Gerät beurteilen.

### Der zuverlässige Weg: Portweiterleitung

Der naheliegende Weg über `npm run dev:phone` und `https://<IP-des-Macs>:5173`
scheitert auf Android oft mit `ERR_TOO_MANY_RETRIES`, weil Chrome selbstsignierte
Zertifikate dort streng behandelt. Besser ist die Weiterleitung über adb: Die App
erscheint dem Browser dann als `localhost` und gilt damit automatisch als sichere
Herkunft – ohne Zertifikat, mit GPS, Service Worker und Wake Lock.

```bash
npm run dev
```

```bash
adb reverse tcp:5173 tcp:5173
```

Danach am Handy `http://localhost:5173` öffnen.

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

Der ▷-Knopf in der Navigation fährt die Route virtuell ab, mit 20 km/h und
4-facher Geschwindigkeit. Damit lassen sich Ansagen, Abbiegebanner,
Fahrradcomputer und Ankunft prüfen, ohne vor die Tür zu gehen.

Zwei Eigenheiten: Der Simulator setzt eigene, beschleunigte Zeitstempel – eine so
aufgezeichnete Fahrt hat deshalb andere Zeiten als eine echte. Und ein Neustart
der Simulation springt an den Routenanfang zurück, was in der Aufzeichnung wie
ein GPS-Sprung aussieht.

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
