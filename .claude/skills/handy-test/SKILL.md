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

Ist der Mac noch vertraut, klappt das ohne erneutes Koppeln. Sonst muss der
Nutzer am Handy unter Einstellungen → System → Entwickleroptionen das drahtlose
Debugging einschalten und „Gerät mit Kopplungscode koppeln" öffnen; mit den dort
angezeigten Angaben dann `adb pair <IP>:<Port>`.

## App bereitstellen

**Nicht** `npm run dev:phone` mit `https://<IP>:5173` verwenden – Chrome auf
Android lehnt das selbstsignierte Zertifikat oft mit `ERR_TOO_MANY_RETRIES` ab.
Stattdessen weiterleiten, dann gilt die App als `localhost` und damit als sichere
Herkunft, mit GPS, Service Worker und Wake Lock:

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
`start-free`, `start-nav-dialog`, `nav-go`, `missed-skip`, `missed-back`.
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

**Die Tab-Liste enthält alle privaten Tabs des Nutzers.** Ausschließlich den Tab
der eigenen App anfassen und den Inhalt der übrigen nicht auswerten.

## Grenzen und Fallstricke

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
