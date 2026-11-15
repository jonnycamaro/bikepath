---
name: routing-profil
description: Ein Routing-Profil in Bikepath hinzufügen oder ändern, etwa eine neue Fahrweise oder angepasste BRouter-Parameter. Nutzen, wenn es um die Auswahl im Planer, um BRouter-Profile oder um das Verhalten der Routenberechnung geht.
---

# Routing-Profil hinzufügen oder ändern

Alles Nötige steht in `src/lib/routing.ts`. Planer und Einstellungen lesen
`PROFILES` direkt – es gibt keine weitere Stelle zum Registrieren.

## Ein Profil ergänzen

```ts
{
  id: 'tour',
  label: 'Tagestour',
  description: 'Kurze Erklärung, die im Planer unter den Chips erscheint',
  brouter: 'trekking',
  params: { allow_steps: 0 },
  speedKmh: 18,
  icon: 'balanced',
}
```

- **`brouter`** ist ein Profilname des öffentlichen BRouter-Servers:
  `trekking`, `fastbike`, `fastbike-lowtraffic`, `safety`, `mtb`, `shortest`.
  `null` bedeutet Freihand – gerade Linien ohne Routing.
- **`params`** werden als `profile:<name>=<wert>` an die Anfrage gehängt und
  überschreiben einzelne Variablen des BRouter-Profils. Gebräuchlich:
  `allow_steps`, `avoid_unsafe`, `stick_to_cycleroutes`.
- **`icon`** muss in `src/components/icons.tsx` existieren, sonst bleibt die
  Fläche leer.
- **`speedKmh`** ist nur die Vorbelegung für die Zeitschätzung; im Planer
  veränderbar.

## Vorher prüfen, ob BRouter mitspielt

Ein erfundener Profilname oder eine unbekannte Variable führt zu HTTP 400.
Deshalb die Anfrage erst von Hand testen, bevor Code geschrieben wird:

```bash
curl -s "https://brouter.de/brouter?lonlats=6.14,51.78|6.04,51.74&profile=trekking&alternativeidx=0&format=geojson&profile:allow_steps=0" | head -c 300
```

## Danach

- Einen Fall in `tests/features.test.ts` ergänzen, wenn das Profil eigene
  `params` mitbringt – dort wird geprüft, dass sie korrekt in die Abfrage wandern.
- `npm test` und `npm run typecheck`.
- Die Profilliste in `README.md` stimmt sonst nicht mehr.

## Radweg-Stufe

Unabhängig vom Profil gibt es `CYCLEPATH_PARAMS` mit den Stufen
niedrig/mittel/hoch. Diese Parameter kommen zu denen des Profils hinzu.

In `store.ts` sitzt dazu eine Rückfallkette: Schlägt „hoch" fehl, wird „mittel"
versucht, dann „niedrig", mit einem Hinweis an den Nutzer. Strenge Vorgaben
führen bei BRouter sonst zu 400, wenn keine Route existiert. Wer neue harte
Einschränkungen einbaut, sollte sie in diese Kette einhängen.

## Eigene Routenoptionen (vom Nutzer)

Nicht in `PROFILES`, sondern `src/lib/customProfile.ts`: Daraus entsteht ein komplettes
BRouter-Profil, das zur Laufzeit hochgeladen wird (`uploadProfile` in `routing.ts`).
Wer dort einen Wert ergänzt (neue Wegart, neuer Untergrund):

- Nur **Hauptwerte** aus `https://brouter.de/brouter/profiles2/lookups.dat` verwenden,
  keine Aliase – sonst scheitert jede Route mit HTTP 500.
- Vorher von Hand prüfen: Skript hochladen und die Antwort auf `"error"` ansehen.

```bash
curl -s -X POST --data-binary @profil.brf https://brouter.de/brouter/profile
```

- Danach `LIVE=1 npx vitest run --environment node tests/live/customProfile.live.test.ts`:
  routet mit jeder Vorlage gegen den echten Server.
- `normalizeProfile()` ergänzt neue Wegarten/Untergründe in gespeicherten Optionen.
