# Entwicklung und Prüfung

## Aufbau

- `dist/busch-lightcards.js` ist Quelltext und Auslieferung in einem: reine
  Custom Elements, kein Lit, kein Bundler, keine Unterressourcen. Eine
  Dashboard-Ressource kann keine Dateien aus Unterordnern ausliefern, also
  muss alles in dieser einen Datei stehen. Es gibt bewusst keinen Build-Schritt
  und kein npm.
- Version: `CARD_VERSION` in der Datei. Der Release-Workflow
  (`.github/workflows/release.yml`) vergleicht sie mit dem Tag.
- `hacs.json` verlangt Home Assistant 2026.9.3; auf dieser Version wurden Karte
  und Editor nativ getestet.
- Für Tests ist `BuschLightCard.__internals` exportiert (Auflösung, Farben,
  `normalizeConfig`, ...).

## Gruppenauflösung (Hintergrund)

- Mitglieder stehen in drei Attributen: `entity_id` (HA-Gruppen, alte
  `group.*`), `group_entities` (Zigbee2MQTT, auch auf Schaltern) und `lights`
  (Magic Areas). `entity_id` wird nur bei `light`, `switch` und `group`
  verfolgt, weil `scene.*` und `automation.*` das Attribut ebenfalls tragen.
- Bewusst nicht verfolgt: Magic-Areas-`child_ids` (interne, nicht auflösbare
  Gruppen-IDs) und die `entities`-Liste von `switch.schedule_*` (Ziele wie
  `media_player.*`). Eine beliebige Liste von Entity-IDs ist keine
  Mitgliedschaft.
- Wird eine Lichtgruppe `unavailable`, entfernt Home Assistant ihr
  `entity_id`-Attribut. Die Karte merkt sich die letzte Mitgliederliste und
  nutzt sie nur, solange die Entität wirklich nicht verfügbar ist. Bei einem
  Kaltstart ohne vorherigen Zustand gibt es nichts zu merken; die Gruppe
  erscheint dann als einzelne nicht verfügbare Entität.
- Die Farbtemperaturleiste folgt der Hue-Kurve (2000 K, 4200 K, 6500 K) und
  umfasst den Schnitt der unterstützten Bereiche aller Mitglieder.
- Geschlossen wird der Dialog mit Escape und der Zurück-Geste; er legt dafür
  einen eigenen History-Eintrag an. Ein Klick auf den Hintergrund schließt ihn
  nicht (Steuerungsdialog).
- Sections-Layout: `getGridOptions()` gibt nur Spalten zurück, keine Zeilen;
  die Höhe misst Home Assistant am Inhalt.

## Prüfung

`docs/render/render.py` lädt die ausgelieferte Datei in echtem Chromium
(über HTTP, damit eine fremde Unterressource als 404 auffiele), steuert die
Kartenlogik über `__internals` und schreibt alle Prüfungen, Netzwerkanfragen,
Konsolen- und Seitenfehler nach `report.json`. Ein Beispiellauf liegt als
`docs/render/report-beispiel.json` bei (105 Prüfungen).

`docs/render/fixture.json` enthält erfundene Namen. Aufbau: eine Gruppe mit
sieben Mitgliedern, davon drei Untergruppen, eine nicht erreichbare Lampe,
Zigbee2MQTT-Gruppen, Szenen und ein `switch.schedule_*`-Helfer. Nur das
Szenario `lit` ändert Zustände (markiert mit `"_synthetic": true`).

```bash
REPO=/pfad/zu/ha-busch-lightcards
docker run --rm -v "$REPO:/cards" --entrypoint bash \
  mcr.microsoft.com/playwright/python:v1.62.0-noble -c '
    pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null
    python3 /cards/docs/render/render.py \
      /cards/dist/busch-lightcards.js /cards/docs/render/ergebnis'
```

Das Ergebnisverzeichnis liegt unter `docs/render/ergebnis*/` und ist per
`.gitignore` ausgeschlossen. Der Renderer bindet optional ein gemeinsames
UI-Regel-Messmodul (`regeln.py`) ein, das unter `/work` gemountet sein muss;
fehlt es, meldet er die UI-Regelmessung als nicht gemessen.

Der Browserlauf deckt unter anderem ab: Auflösung (Duplikate, Zyklen,
Selbstreferenz, gelöschte Mitglieder, Fremddomänen, Tiefenlimit), das
Gedächtnis für nicht verfügbare Gruppen, Aggregation und Service-Routing,
Kartentexte, Dialog (Gruppenblöcke, Kacheln, Hauptschalter, Escape/Zurück,
Stapelung gegenüber hohen z-index-Werten), Zigbee2MQTT, Szenenimport und den
Editor (Optionsabdeckung, Labels und Helfer in beiden Sprachen, Live-Vorschau,
minimale Ausgabe, camelCase-Faltung, Szenenzeilen).

Grenzen: Der Editor wird im Renderer mit einer `ha-form`-Attrappe geprüft. Das
belegt Verdrahtung, Schema und erzeugte Konfiguration, nicht die Darstellung
der echten Home-Assistant-Selektoren.

`docs/render/visual_contract.py` erzeugt die synthetische Darstellungsmatrix
(320/480/960 px, hell/dunkel, Karte in allen Zuständen) und vergleicht sie mit
der Baseline in `docs/render/baseline/busch-ha-ui-0.1.0/`; siehe deren README.
Alle Namen darin sind erfunden.

Weitere Prüfungen vor einem Release: `node --check dist/busch-lightcards.js`
und ein Test auf doppelte Top-Level-Namen im Bundle.
