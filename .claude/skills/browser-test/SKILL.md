---
name: browser-test
description: Einen Ablauf in Bikepath am Mac im ferngesteuerten Chromium durchspielen und prüfen – mit vorgegebenem Standort, ohne Handy. Nutzen, um eine Änderung an Planer, POI-Karte, Dialogen oder Kartenebenen nachzuweisen, bevor sie dem Nutzer übergeben wird, oder wenn das Handy gerade nicht frei ist.
---

# Bikepath im Browser am Mac prüfen

Für alles, was kein echtes GPS, keine Ansagen und kein Display-Verhalten braucht.
Für das echte Gerät gibt es den Skill `handy-test`.

## Vorbereitung

Playwright gehört nicht zum Projekt. Einmal pro Sitzung in einen eigenen Ordner
im Scratchpad installieren, **nicht** ins Repository:

```bash
mkdir -p <scratchpad>/pwenv && cd <scratchpad>/pwenv && npm init -y >/dev/null && npm i playwright-core --silent
```

Als Browser über `executablePath` entweder den Playwright-Cache nehmen (kann nach einem
Neustart fehlen) oder das installierte Chrome – das ist immer da:

```bash
find ~/Library/Caches/ms-playwright -path '*chrome-mac-arm64*MacOS/*' -type f -perm +111 2>/dev/null | head -1 || echo "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

Mit dem installierten Chrome `headless: true` setzen, sonst öffnet sich ein Fenster.

Der Entwicklungsserver muss laufen. Welcher Modus, zeigt:

```bash
ps -o args= -p $(lsof -tnP -iTCP:5173 -sTCP:LISTEN)
```

Mit `--mode phone` ist die Adresse `https://localhost:5173` (dann
`ignoreHTTPSErrors: true`), sonst `http://localhost:5173`.

## Grundgerüst

Das Skript ins Scratchpad legen und `playwright-core` mit absolutem Pfad laden:

```js
const { chromium } = require('<scratchpad>/pwenv/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.EXE });
  const ctx = await b.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    geolocation: { latitude: 53.2606, longitude: 7.4572 }, // Leer (Ostfriesland)
    permissions: ['geolocation'],
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('https://localhost:5173/');
  await p.getByTestId('onboard-start').click(); // jeder neue Kontext startet beim Onboarding
  // …
  await p.screenshot({ path: '<scratchpad>/s.png' });
  await b.close();
})();
```

Screenshots danach mit dem Read-Werkzeug ansehen.

## Karte steuern und prüfen

- `window.__bikepathMap` ist die Hauptkarte, `window.__poiMap` die offene POI-Karte.
- Springen: `p.evaluate(() => window.__poiMap.jumpTo({ center: [lon, lat], zoom: 15 }))`,
  danach 3–5 s warten, bis die Kacheln geladen sind.
- Gezeichnetes zählen: `queryRenderedFeatures({ layers: ['poi-cluster'] })` bzw.
  `poi-point`; auf der Hauptkarte `pois-cluster` und `pois-point`.
- Einen Ort antippen: Koordinate mit `map.project(...)` in Pixel umrechnen und
  `p.mouse.click(box.x + x, box.y + y)` – `box` ist die Box des Kartencontainers
  (`.poi-picker .rt-canvas`), bei der Hauptkarte reicht der Seitenursprung.
  Nur Punkte wählen, die nicht unter der Kategorie-Liste, der Kopfzeile oder der
  Statuszeile liegen (y etwa 120–600), sonst trifft der Klick die Leiste.
- Die Kategorie-Liste der POI-Karte lässt sich mit `poi-filter` einklappen.

## Abläufe und Kennungen

| Ablauf | Kennungen |
|---|---|
| Strecke planen | `tab-plan` → `plan-mode-trip` (Start = simulierter Standort) |
| Ortssuche auf der Karte | `map-search-btn` → Feld in `map-search` → Ortskarte `place-card` |
| Tippen auf die Karte (Karte, Planen, Navigieren) | Halbkreis-Menü `.tap-menu` mit Segmenten `.tap-seg[data-action=start|via|end|info]`, ausgegraute haben die Klasse `off`. Klicken auf `… path` des Segments. `info` öffnet die Ortskarte `place-card`. Ein Tipp unter dem unteren Fenster trifft das Fenster, nicht die Karte – vorher mit `easeTo({ …, offset: [0, -200], duration: 0 })` nach oben schieben (`jumpTo` kennt kein `offset`). |
| Eigene Routenoption | `tab-profile` → `custom-new` → `profile-editor` (`editor-name`, `editor-ways-<art>`, `editor-save-use`) |
| Rundtour | `plan-mode-loop` → `roundtrip-sheet` |
| POI-Karte | `poi-open` → `poi-picker`, Status in `poi-status` |
| Ort übernehmen | Ort antippen → `poi-card` → `poi-take`; Links `link-google`, `link-tripadvisor` |
| POI-Ebene der Hauptkarte | `layers-btn` → Schalter in `.setting` mit Text „POIs“ (`button[role=switch]`), Kategorien in `layer-poi-cats` |
| Ortskarte | Ort auf der Hauptkarte antippen → `place-card` |
| Navigation | `nav-current` bzw. `start-nav` → `start-nav-dialog` → `nav-go` |

Wegpunkte des Planers stehen in `.wps .wp .name`.

## Fallstricke

- **Auf Statuszeilen warten** statt fest zu schlafen, aber auf einen Text, der
  nur während des Ladens vorkommt („werden geladen“) – „geladene Orte“ im
  Herauszoom-Hinweis passt sonst auch.
- **Fremde Dienste** (Photon, OpenFreeMap) werden echt aufgerufen. Ein leeres
  Ergebnis kann am Dienst liegen – bei Zweifel den Dienst direkt mit `curl` fragen.
- Der Kontext hat keine gespeicherten Einstellungen: Ebenen, Kategorien und
  Navigationsmodus stehen auf den Standardwerten.
