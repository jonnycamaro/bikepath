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

Der Service Worker ist auf `autoUpdate` gestellt. Die installierte App holt sich
eine neue Fassung beim nächsten Start selbst – nicht sofort, sondern wenn sie
das nächste Mal geöffnet wird. Wer sofort sehen will, ob etwas angekommen ist,
schließt die App und startet sie neu.

## Was nicht ins Repository gehört

`.gitignore` schließt `*.apk` und `/vendor-analysis/` aus. Dort liegt fremdes
Analysematerial, das urheberrechtlich geschützt ist. Das Repository ist
öffentlich – vor einem `git add -A` lohnt ein Blick auf `git status`.

## Alternativen zu Pages

Cloudflare Pages und Netlify veröffentlichen ebenfalls kostenlos und aus
privaten Repositories, und sie liefern unter einer eigenen Subdomain aus.
Damit entfiele der Basispfad komplett. Für einen Wechsel genügt es,
`BASE_PATH` wegzulassen.
