# Veröffentlichen

Die App liegt auf GitHub Pages: **https://jonnycamaro.github.io/bikepath/**

## Der normale Weg

```bash
git add -A && git commit -m "Was du geändert hast" && git push
```

Das war alles. Der Workflow in `.github/workflows/deploy.yml` läuft bei jedem Push
auf `main`, prüft Typen, lässt die Tests laufen, baut und veröffentlicht.
Schlägt etwas fehl, wird **nicht** veröffentlicht – die laufende Version auf dem
Handy bleibt unangetastet. Der Durchlauf dauert rund anderthalb Minuten.

Stand prüfen:

```bash
gh run list --limit 3
```

## Der Basispfad

Pages liefert die App aus dem Unterordner `/bikepath/` aus. Deshalb baut der
Workflow mit `BASE_PATH=/bikepath/`, und `vite.config.ts` setzt daraus den
`base`-Pfad sowie `start_url` und `scope` im Manifest.

Lokal ist `BASE_PATH` nicht gesetzt, der Basispfad bleibt `/`. Das ist Absicht:
Sonst liefe der Entwicklungsserver unter `/bikepath/` und die Portweiterleitung
beim Handytest würde ins Leere zeigen.

Wer den Repository-Namen ändert, muss `BASE_PATH` im Workflow mitändern.
Symptom bei einem falschen Pfad: weiße Seite, in der Konsole 404 auf die
JavaScript-Datei.

## Veröffentlichung prüfen

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://jonnycamaro.github.io/bikepath/
```

Ob die App wirklich als PWA zählt, zeigt sich am zuverlässigsten am Gerät:
Chrome bietet im Menü **„Installieren"** nur an, wenn Manifest, Service Worker
und HTTPS zusammen stimmen. Steht dort nur „Verknüpfung erstellen", fehlt etwas.

## Aktualisierung auf dem Handy

Android hält eine installierte Web-App im Speicher. Ein Tipp aufs Symbol holt nur
die alte Seite nach vorn, ohne neu zu laden – die übliche Update-Prüfung beim
Seitenaufruf läuft dann nicht. Deshalb steuert `src/updates.ts` das selbst:

- **Prüfen:** beim Start, bei jeder Rückkehr in die App (höchstens einmal pro
  Minute) und stündlich, solange die App offen ist.
- **Umschalten:** Der Service Worker steht auf `registerType: 'prompt'`; eine neue
  Fassung wartet, bis die App sie übernehmen lässt. Das passiert nur, wenn nichts
  verloren geht: keine Fahrt, keine Planung (die lebt nur im Speicher), kein
  Startdialog. Sonst holt die App es nach, sobald die Fahrt endet oder die Planung
  gelöscht ist, oder wenn die App in den Hintergrund geht.
- Beim Umschalten lädt die Seite einmal neu.

Wer sofort prüfen will: App in der App-Übersicht wegwischen und neu öffnen, ein
paar Sekunden warten.

Einmalig beim Wechsel von `autoUpdate` auf `prompt` (November 2026): Die alte
Fassung auf dem Handy kennt die neue Logik noch nicht. Die neue Fassung wartet
dort, bis die App einmal ganz geschlossen und wieder geöffnet wird.

## Was nicht ins Repository gehört

`.gitignore` schließt `*.apk` und `/vendor-analysis/` aus. Dort liegt fremdes
Analysematerial, das urheberrechtlich geschützt ist. Das Repository ist
öffentlich – vor einem `git add -A` lohnt ein Blick auf `git status`.

## Alternativen zu Pages

Cloudflare Pages und Netlify veröffentlichen ebenfalls kostenlos und aus
privaten Repositories, und sie liefern unter einer eigenen Subdomain aus.
Damit entfiele der Basispfad komplett. Für einen Wechsel genügt es,
`BASE_PATH` wegzulassen.
