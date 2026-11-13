---
name: veroeffentlichen
description: Eine Änderung an Bikepath veröffentlichen und prüfen, dass sie auf dem Handy ankommt. Nutzen, wenn eine Fassung ausgeliefert, der Deploy-Lauf kontrolliert oder ein fehlgeschlagener Build untersucht werden soll.
---

# Bikepath veröffentlichen

Ziel: https://jonnycamaro.github.io/bikepath/ · Repository: `jonnycamaro/bikepath`

## Ablauf

Vor dem Push **immer** lokal prüfen, sonst schlägt der Lauf erst nach anderthalb
Minuten fehl:

```bash
npm run typecheck && npm test && npm run build
```

Dann:

```bash
git status --short
```

Prüfen, dass nichts aus `vendor-analysis/` oder keine `.apk` dabei ist – das
Repository ist öffentlich.

```bash
git add -A && git commit -m "Beschreibung" && git push
```

```bash
gh run list --limit 3
```

Der Workflow (`.github/workflows/deploy.yml`) prüft Typen, lässt die Tests
laufen, baut mit `BASE_PATH=/bikepath/` und veröffentlicht. Bei einem Fehlschlag
wird nichts ausgeliefert; die Fassung auf dem Handy bleibt unangetastet.

Auf das Ergebnis warten, ohne zu pollen:

```bash
gh run watch <run-id> --exit-status --interval 15
```

## Nachsehen, ob es angekommen ist

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://jonnycamaro.github.io/bikepath/
```

Gründlicher, falls es um die PWA-Eigenschaften geht:

```bash
curl -s https://jonnycamaro.github.io/bikepath/manifest.webmanifest
```

`start_url` und `scope` müssen `/bikepath/` lauten. Am Gerät ist das beste
Kennzeichen, dass Chrome im Menü **„Installieren"** anbietet und nicht nur
„Verknüpfung erstellen".

Die installierte App aktualisiert sich beim nächsten Start selbst, nicht sofort.

## Wenn etwas schiefgeht

| Symptom | Ursache |
|---|---|
| Weiße Seite, 404 auf die JS-Datei | Basispfad falsch. `BASE_PATH` im Workflow muss zum Repository-Namen passen. |
| Chrome bietet nur „Verknüpfung erstellen" | Manifest, Service Worker oder HTTPS stimmen nicht zusammen. Manifest live abrufen und `scope` prüfen. |
| Lauf schlägt bei `npm test` fehl | Zuerst lokal reproduzieren. `tests/session.test.ts` arbeitet mit echten Zeitgebern und braucht rund 17 Sekunden; bei knapper CI kann es eng werden. |
| Änderung ist am Handy nicht da | App schließen und neu starten, damit der Service Worker die neue Fassung holt. |

## Nie tun

- Nicht mit `--force` auf `main` pushen, ohne dass der Nutzer es ausdrücklich will.
- Keine Dateien aus `vendor-analysis/` committen.
- Kein `gh repo delete` ohne ausdrückliche Zustimmung.
