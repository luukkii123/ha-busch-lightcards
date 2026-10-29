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

## Gestaltung: Hue-Optik (seit 0.9.0)

- Ist eine Lampe an, trägt die ganze Karte die Lichtfarben: eine Farbe flach,
  mehrere als Verlauf (nach Farbton sortiert wie die Hue-App). Aus: Thema bzw.
  `off_color`, mit `off_shadow`. Der Dialogkopf, die Szenen- und die
  Lampenkacheln folgen derselben Regel.
- Textfarbe je Hintergrund (`readableSurface`): hell oder dunkel, je nachdem,
  welche die Farbe weniger verändern muss; helle Schrift hat einen kleinen
  Vorrang. Jede Verlaufsstufe hält mindestens 4,5:1 (WCAG 2.2 AA). Reicht es
  nicht, wird die Stufe nur so weit zu Schwarz bzw. Weiß gemischt wie nötig,
  der Farbton bleibt. Lampenkacheln prüfen zusätzlich ihren abgedunkelten
  Teil. `off_color` wird nie verändert, dort wird nur die Schrift gewählt.
- Die Helligkeits-Abdunklung der Hue-Karte (Innenschatten unten) gibt es nur
  unter heller Schrift, weil sie nur abdunkelt; unter dunkler Schrift würde
  sie den Kontrast senken. Zustand steht immer auch als Text („4 von 5 an“).
- Übergänge: nur Hintergrund, Deckkraft und `transform`. Der alte Hintergrund
  wird bei einer Änderung als Ebene darübergelegt und ausgeblendet (Verläufe
  lassen sich nicht überblenden); Regler über `scaleX`/`scaleY`.
  `prefers-reduced-motion` schaltet beides ab.
- Leistung wie 0.8.3+4f0ab11: gemalt wird nur nach eigener Zustandsänderung,
  und dann nur, was sich geändert hat; der Verlauf wird nur bei neuen Farben
  neu gesetzt (Test `tests/farbe.test.js`).

## Live-Update und Bediengefühl (seit 0.10.0, #715)

Vorbild ist die Hue-Like Light Card (Gh61, LGPL-2.1), deren Quelltext
gelesen wurde (`live-update-session.ts`, `light-controller.ts`,
`view-utils.ts`, `brightness-rollup.ts`, `mushroom-slider-container.ts`,
`hass-text-template.ts`, `api-provider.ts`, `dialog*.ts`). Übernommen ist das
Verhalten, nachgebaut ohne kopierten Code:

- `LiveSession` je Bedienelement (Kartenregler, Dialog-Gruppenregler,
  Detailregler, Lampenkachel, Farbrad, Weißleiste): höchstens ein Aufruf
  unterwegs; der nächste erst nach der Bestätigung von HA (Versprechen von
  `callService`, Notfrist 5 s) und frühestens nach dem Mindestabstand;
  dazwischen gewinnt der neueste Wert. Erster Wert nach dem halben Abstand.
  Loslassen stellt genau den Endwert hinten an. Der Regler zeigt bis 1,5 s
  nach der letzten Bestätigung seinen eigenen Wert.
- Mindestabstand 200 ms für eine Lampe, 1000 ms, sobald ein Aufruf mehrere
  Lampen erreicht (die Karte löst Gruppen auf und schickt an die Mitglieder)
  oder `is_hue_group` gesetzt ist. Ist der Abstand länger als 400 ms und
  können alle Ziele `transition`, geht er als Übergang mit. 0 wird beim
  Ziehen nie gesendet, erst beim Loslassen.
- Touch: waagerechte Regler tragen `touch-action: pan-y` und eine
  5-px-Totzone (wie Hues Rollup); eine senkrechte Bewegung bleibt Scrollen,
  ein Tippen setzt den Wert. Maus wirkt sofort.
- Übergänge 0,3 s ease-out (Hue `TransitionDefault`), nur `transform`,
  `opacity` und Hintergrund; Dialogregler jetzt `scaleX` statt `width`.
  Öffnen: Blatt steigt am Handy auf, mittig wächst es ein; Detailansicht
  gleitet von oben herein; Kacheln und Szenen schrumpfen beim Drücken auf
  0,95 (Hue-Kachel). `prefers-reduced-motion` schaltet alles ab.
- Leistung wie 0.9.0: kein Neubau bei fremden Updates (Messgerüst
  `hacs/docs/render/perf-t715/`, Erweiterung von perf-t712). Das Ende der
  Haltezeit setzt nur den Regler neu.

Bewusste Abweichungen von Hue: `%s` in `description` setzt auf Wunsch des
Nutzers die Standardzeile ein (bei Hue die Zahl der leuchtenden Lampen);
eine fehlende Vorlagen-Entität heißt `‹light.x fehlt›` statt `MISS[…]`; das
API-Objekt heißt `window.busch_light_card` statt `hue_card`, weil beide
Karten nebeneinander installiert sind; `icon_size: original` bleibt das
bisherige 24-px-Symbol. Der Mushroom-Regler ist ein eigener Nachbau im
Mushroom-Stil (28-px-Spur in 44-px-Ziel), braucht also keine Mushroom-Karte.

**Abweichung (R09, R24):** 0.8.x hielt die Lichtfarbe bewusst nur in der
44-px-Medienkachel. Grund war die Umstellung auf den gemeinsamen UI-Vertrag
„Busch HA UI 0.1.0“ (25.09.2026, 0.8.0): Kartenfläche aus dem Thema, „keine
starken Gradients, keine harte Farbe“ (HACS-Corporate-Design §7/§19). Die
Nutzerentscheidung vom 28.10.2026 (#712) geht dem vor: Hue-Optik wie die
Hue-Like Light Card. Risiko: geringerer Kontrast auf hellen Lichtfarben und
Bedeutung nur über Farbe. Ersatzprüfung: berechnete Textfarbe mit 4,5:1 je
Stufe (Node-Tests und Browserlauf messen die Quote), Zustand immer als Text,
Layout, Kopf und Bedienelemente bleiben die des UI-Vertrags.

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
(320/480/960 px, hell/dunkel): Karte in allen Zuständen, an mit einer Farbe,
mehreren Farben, Weiß, Warmweiß und Gelb, aus, `off_color`, dazu der Dialog
je Breite (320 px = Handy) und misst Kontrastquote und Textfarben. Die
gesichtete Auswahl liegt in `docs/render/baseline/hue-0.9.0/`; siehe deren
README. Alle Namen darin sind erfunden.

`node --test tests/*.test.js` prüft ohne Browser Reaktion, Neubau-Grenzen,
die Farbrechnung (Kontrast, Verlauf, Aus-Zustand, `off_color`), seit 0.10.0
auch Live-Takt, Bestätigung, Endwert, Touch, Vorlagen, `icon_size`, `slider`,
`theme`, `api_id`, `is_visible` und den Editor (`tests/live.test.js`,
`tests/optionen.test.js`).

Beide Browserskripte nutzen eine Seite für viele Schritte und beantworten
keinen Dienstaufruf. Seit 0.9.0 zeigt ein Klick sein Ergebnis bis zu 4 s
vorab; damit das nicht in den nächsten Schritt hineinwirkt, beginnt jeder
Schritt mit `window.freshStep()` (ruft `__internals.clearOptimistic()`).
`render.py` belegt das Risiko und die Abhilfe in einer eigenen Prüfung.

Weitere Prüfungen vor einem Release: `node --check dist/busch-lightcards.js`
und ein Test auf doppelte Top-Level-Namen im Bundle.

## Geprüft

**29.10.2026 · 0.10.0 (#715, Live-Update und Kleinkram)** — vier Abnahmebelege vor dem Tag:

1. `node --check dist/busch-lightcards.js` grün.
2. `python3 scripts/ui-regeln-pruefen.py --repo ha-busch-lightcards`
   (HACS-Ebene): 0 Verstöße.
3. `KARTEN_TODO=715 scripts/karten-alle.sh --repo ha-busch-lightcards`
   (`test-hacs-t715-abnahme-…`), Lauf `karten-20261029-125227-a1f447`,
   3/3 grün: `node --test` 52/52 (davon 21 neu, alle 21 rot gegen v0.9.0);
   `render.py` 125/125 (14 neue #715-Prüfungen mit echten PointerEvents:
   Lampe ≤ 5/s, Gruppe ≤ 1/s, Endwert, `live_update: false`, Touch senkrecht
   ohne Aufruf, Mushroom, `icon_size`, `description: false`, Vorlage,
   `theme`, `api_id` samt Hash und Prototyp-Probe, Öffnungsanimation,
   `prefers-reduced-motion`), Regel 1 186 Textelemente ohne Befund, Regel 2
   ohne Verstoß, 0 Konsolen-/Seitenfehler; `visual_contract.py` 138/138
   (neu: `mushroom`, `mushroom_off`, `icon_big`, `no_description`,
   `template`, Editor mit den neuen Optionen, je 320/480/960 px hell/dunkel),
   Tastaturprobe grün. Vorläufe: `karten-20261029-123942-c74d82` (rot:
   Prüfung las Abzeichen-Fall falsch, Rechteck während der Animation, Escape
   im Skript), `-124202-622724` (grün; danach zwei Sichtbefunde behoben).
4. Dieser Abschnitt und der Block im HACS-Stand. Bilder gesichtet; Auswahl
   in `docs/render/baseline/hue-0.10.0/`.

**28.10.2026 · 0.9.0 (#712, Hue-Optik)** — vier Abnahmebelege vor dem Tag:

1. `node --check dist/busch-lightcards.js` grün.
2. `python3 scripts/ui-regeln-pruefen.py --repo ha-busch-lightcards`
   (HACS-Ebene): 0 Verstöße.
3. `scripts/karten-alle.sh --repo ha-busch-lightcards` im
   Playwright-Container (`test-hacs-t712-abnahme-…`), Lauf
   `karten-20261028-225430-438a22`, 3/3 Schritte grün: `node --test` 28/28;
   `render.py` 111/111, Regel 1 186 Textelemente ohne Überlauf/Außerhalb/
   Überlappung, Regel 2 ohne Verstoß, 0 Konsolen-/Seitenfehler, keine
   Unterressource; `visual_contract.py` 102/102 Fälle (Karte 320/480/960 px
   hell/dunkel an mit einer, mehreren Farben, Weiß, Warmweiß, Gelb, aus,
   `off_color`; Dialog je Breite inkl. Handy), Kontrast ≥ 4,5:1 je Fall,
   Tastaturprobe grün. Vorläufe zur Fehlersuche: `karten-20261028-224648-790723`,
   `-224939-5ba3c0`, `-225119-9a0cd3`, `-225229-a5c2d9`.
4. Dieser Abschnitt und der Block im HACS-Stand. Bilder gesichtet; Auswahl
   in `docs/render/baseline/hue-0.9.0/`.
