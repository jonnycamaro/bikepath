---
name: handy-test
description: Bikepath auf dem echten Android-Handy starten, bedienen und auslesen. Nutzen, wenn etwas am Gerät geprüft, vorgeführt oder ein Fehler reproduziert werden soll, der am Mac nicht auftritt – GPS, Ansagen, Wake Lock, Installation als PWA, Verhalten im Hintergrund.
---

# Bikepath auf dem Handy testen

Am Mac liefert der Browser nur eine grobe Ortung. Alles mit Bewegung, Ansagen
oder Display gehört aufs Gerät.

## Verbinden (ohne Kabel)

```bash
adb mdns services
```

Zeigt das Gerät als `_adb-tls-connect`. Dann:

```bash
adb connect <IP>:<Port>
```

Der Port wechselt, wenn das Handy das drahtlose Debugging neu startet (etwa nach
längerem Schlaf) – dann `adb devices` ist leer und `adb mdns services` zeigt den
neuen Port. Ist der Mac noch vertraut, klappt das ohne erneutes Koppeln. Sonst muss der
Nutzer am Handy unter Einstellungen → System → Entwickleroptionen das drahtlose
Debugging einschalten und „Gerät mit Kopplungscode koppeln" öffnen; mit den dort
angezeigten Angaben dann `adb pair <IP>:<Port>`.

## App bereitstellen

Zuerst nachsehen, ob schon ein Entwicklungsserver läuft und in welchem Modus –
oft hat der Nutzer ihn selbst im Terminal gestartet:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN; ps -o args= -p $(lsof -tnP -iTCP:5173 -sTCP:LISTEN)
```

`vite --host` = http im WLAN, `vite --host --mode phone` = https im WLAN, `vite` =
nur am Mac. Einen Server des Nutzers nur beenden, wenn er zustimmt.

### Weg A: HTTPS im WLAN (so testet der Nutzer selbst)

```bash
npm run dev:phone
```

Am Handy `https://<IP-des-Macs>:5173`, Zertifikatswarnung einmal bestätigen.
GPS funktioniert, weil HTTPS. Die IP des Macs zeigt Vite beim Start
(`192.168.178.x`, nicht die Adressen der VM-Bridges). Startet Claude den Server
selbst im Hintergrund, endet er nach dem Zeitlimit für Hintergrundbefehle
(höchstens 2 Stunden) – dem Nutzer sagen, und für längeres Testen raten, ihn im
eigenen Terminal zu starten.

### Weg B: adb-Weiterleitung

Der bequemste Weg für Claude ist die Weiterleitung über adb. Dann gilt die App als
`localhost` und damit als sichere Herkunft, mit GPS, Service Worker und Wake
Lock, ganz ohne Zertifikat:

```bash
npm run dev
```

```bash
adb reverse tcp:5173 tcp:5173
```

```bash
adb shell am start -a android.intent.action.VIEW -d "http://localhost:5173/" com.android.chrome
```

Für die veröffentlichte Fassung stattdessen `https://jonnycamaro.github.io/bikepath/`.

### Zugriff über die IP des Macs (`ERR_TOO_MANY_RETRIES`)

Ab Android 17 braucht jede App die Berechtigung „Geräte in der Nähe“
(`ACCESS_LOCAL_NETWORK`), um Geräte im lokalen Netz zu erreichen. Fehlt sie
Chrome, verlässt eine Anfrage an `http(s)://<IP-des-Macs>:5173` das Handy gar
nicht. Chrome meldet dann `ERR_TOO_MANY_RETRIES`, bei http und https gleich. Das
selbstsignierte Zertifikat ist dafür nicht die Ursache. Die adb-Shell ist von
der Sperre ausgenommen und `localhost` per `adb reverse` gilt nicht als lokales
Netz, deshalb funktioniert beides trotzdem.

Prüfen:

```bash
adb shell appops get com.android.chrome | grep LOCAL_NETWORK
```

Steht dort `ACCESS_LOCAL_NETWORK: ignore` und springt `rejectTime` bei jedem
Aufruf der IP auf „vor wenigen Sekunden“, ist es diese Sperre. Beheben muss das
der Nutzer am Handy: `adb shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:com.android.chrome`
öffnet die App-Einstellungen, dort unter Berechtigungen → „Geräte in der Nähe“
auf „Zulassen“ stellen und Chrome neu starten.

Danach lädt `http://<IP>:5173` (Server mit `vite --host` bzw. `npm run dev:phone`).
GPS gibt Chrome über eine IP aber nur bei HTTPS heraus, also dann
`npm run dev:phone` und die Zertifikatswarnung einmal bestätigen. Über http
erscheint in der App „Standortzugriff verweigert“, ohne dass Chrome fragt – das
ist keine fehlende Berechtigung, sondern die unsichere Herkunft.

Bevor man das Netz verdächtigt: vom Handy aus prüfen, ob der Mac erreichbar ist.
Die adb-Shell ist von der Android-17-Sperre ausgenommen:

```bash
adb shell 'ping -c 2 <IP-des-Macs>; ip route get <IP-des-Macs>'
```

## Ansehen und bedienen

```bash
adb exec-out screencap -p > /tmp/s.png
```

Das Bild dann lesen. Der Bildschirm ist 1080×2424; ein angezeigtes Bild mit
891 Pixeln Breite wird mit 1,21 auf die echten Koordinaten umgerechnet.

```bash
adb shell input tap <x> <y>
```

```bash
adb shell input swipe <x1> <y1> <x2> <y2> 300
```

```bash
adb shell input text "Suchbegriff%smit%sLeerzeichen"
```

**Tippen auf Koordinaten ist unzuverlässig**, wenn die Seite gerade lädt oder
scrollt. Robuster ist der Klick über die Debug-Schnittstelle (siehe unten), etwa
`document.querySelector('[data-testid=tab-record]').click()`. Vorhandene
Testkennungen: `tab-map`, `tab-plan`, `tab-record`, `tab-routes`, `tab-profile`,
`start-free`, `start-nav-dialog`, `nav-go`, `missed-skip`, `missed-back`,
`nav-plan-trip`, `nav-plan-loop`, `plan-mode-trip`, `plan-mode-loop`, `poi-open`,
`poi-take`, `layers-btn`.
Die `tab-*`-Kennungen werden in `App.tsx` per Template erzeugt – eine Textsuche
im Quelltext findet sie deshalb nicht. Die vollständige Liste liefert am
laufenden Gerät `Array.from(document.querySelectorAll('[data-testid]')).map(e => e.dataset.testid)`.

## In die Seite hineinsehen

```bash
adb forward tcp:9222 localabstract:chrome_devtools_remote
```

`http://localhost:9222/json/list` liefert alle Tabs mit WebSocket-Adresse. Über
ein kurzes Node-Skript mit `ws` (liegt in `node_modules`) lassen sich
`Runtime.evaluate` für Ausdrücke und `Runtime.enable` plus `Log.enable` für
Konsolenmeldungen nutzen.

Nützliche Ausdrücke:

```js
document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400)
navigator.serviceWorker.getRegistrations().then(rs => rs.map(r => r.scope))
new Promise(r => navigator.geolocation.getCurrentPosition(p => r({acc: p.coords.accuracy, spd: p.coords.speed})))
```

Den eigenen Tab findet man über die URL: `/:5173\//` passt für localhost und
die IP des Macs. Die POI-Karte ist als `window.__poiMap` erreichbar, die
Hauptkarte als `window.__bikepathMap`.

**Die Tab-Liste enthält alle privaten Tabs des Nutzers.** Ausschließlich den Tab
der eigenen App anfassen und den Inhalt der übrigen nicht auswerten.

## Simulierte Fahrt

Navigation starten, im Dialog „Weiter mit“ den Schalter **„Simulation
aktivieren“** einschalten (Kennung des Dialogs `start-nav-dialog`), dann `nav-go`.
Einen eigenen Simulationsknopf in der Navigation gibt es nicht mehr. Ist im
Profil „Nicht mehr fragen“ gesetzt, erscheint der Dialog nicht.

## Grenzen und Fallstricke

- **Der Nutzer benutzt das Handy oft gerade selbst.** Vor jeder Bedienung
  einen Screenshot ansehen; ist eine andere App oder ein Assistent offen, nicht
  dazwischenfunken, sondern fragen oder am Mac im Browser weitertesten
  (Skill `browser-test`).

- **Gesperrtes Gerät:** Nicht entsperren – das ist die Sicherheitssperre des
  Nutzers. Danach fragen.
- **Berechtigungsdialoge** (Standort) und Anmeldungen bleiben beim Nutzer.
- **Chrome verwirft Hintergrund-Tabs.** Wird die App in den Hintergrund
  gedrängt, kann eine laufende Aufzeichnung verloren gehen. Das ist kein Fehler
  der App, sondern die bekannte Grenze von Web-Apps.
- **Messwerte im Haus taugen nichts** für Aussagen über Genauigkeit: 20 bis 60 m
  Ortungsfehler, mehrere km/h im Stand, stark schwankende Höhe. Für Abläufe und
  Oberfläche sind sie brauchbar.
- **Nach Änderungen an `session.ts`** während einer laufenden Fahrt die Seite neu
  laden, bevor ein Fehler gesucht wird – der alte Timer aus dem Hot Reload kann
  weiterlaufen und falsche Symptome erzeugen.

## Aufräumen

```bash
adb reverse --remove tcp:5173; adb forward --remove tcp:9222
```

Den Entwicklungsserver beenden, wenn er nicht mehr gebraucht wird.
