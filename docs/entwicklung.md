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
  nicht (Steuerungsdialog). Seit M28 (Buschcheck Etappe H) kommen Verlauf und
  Fokusfalle aus Shared UI (`BuschUI.dialogHistory`, je Ebene ein Eintrag:
  Dialog und Detailansicht; `BuschUI.focusTrap`); das X ist `.busch-dialog-close`
  oben links in beiden Ansichten, der Zurück-Pfeil steht rechts daneben. Das X
  nimmt die Einträge nacheinander zurück und schließt erst, wenn der letzte
  angekommen ist (300 ms Absicherung je Schritt), damit HAs Detailansicht nach
  einem Halten nicht vom späten Zurück geschlossen wird.
- Sections-Layout: `getGridOptions()` gibt nur Spalten zurück, keine Zeilen;
  die Höhe misst Home Assistant am Inhalt.
- Masonry: `getCardSize()` liest kein Layout (M68, Buschcheck P22). Es nimmt
  die Höhe, die ein `ResizeObserver` an der Karte zuletzt gemeldet hat, und
  schätzt vorher aus dem, was der letzte Render zeigt (Innenabstand, Symbol,
  Statuszeile, Zustandsblock, Regler; `CARD_SIZE_PX`). Test
  `tests/kartengroesse.test.js` zählt Layout-Lesungen, `render.py` prüft im
  Browser, dass die Einheiten der echten Höhe entsprechen.

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
- Dialogfarben (M29, Buschcheck W5, Nutzerentscheid E4 vom 18.11.2026): Das
  Blatt folgt dem HA-Thema (`--card-background-color`, `--primary-text-color`,
  Kacheln aus `--secondary-background-color`), hell wie dunkel. `dialog_theme:
  dark` setzt `dialog-theme="dark"` am Dialog und stellt die Farben von 0.9.0
  bis 0.13.3 wieder her (`#171717`, Kacheln `#363636`). Alle Regeln lesen die
  aufgelöste Palette `--blc-d-*`; die Haken `--blc-dialog-*` gehen weiter vor.
  Eine fehlende Szene ist eine Kachel ohne Deckkraft mit Nebentextfarbe
  (vorher 0,4 Deckkraft, ca. 2,5:1); `visual_contract.py` misst ≥ 3:1.
- Leistung wie 0.8.3+4f0ab11: gemalt wird nur nach eigener Zustandsänderung,
  und dann nur, was sich geändert hat; der Verlauf wird nur bei neuen Farben
  neu gesetzt (Test `tests/farbe.test.js`).
- Lampenraster (M78, Buschcheck W22): Szenen und Lampen stehen auf einem
  Raster `repeat(auto-fill, minmax(94px, 1fr))`. Eine Untergruppe wird nicht
  eingerückt, ihre Kacheln beginnen auf denselben Spalten wie die der
  Hauptgruppe; markiert ist sie durch eine 2-px-Linie in der 16-px-Rinne des
  Blatts. Ihr Kopf ist eine 44-px-Zeile (Zielgröße des Schalters).
  `render.py` misst die x-Lagen aller Kacheln (`lampRaster`).

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
- Vorschau nach einem Tippen (`optimisticCall`, höchstens 4 s): Sie endet erst,
  wenn HA An/Aus, Effekt, Helligkeit (±2 %) und die gewünschte Farbe meldet,
  rgb ±8 je Kanal im Farbmodus (`rgb`, `rgbw`, `rgbww`, `hs`, `xy`), Kelvin
  ±50 K nur im Modus `color_temp`. Ein Zwischenstand mit alter Farbe beendet
  sie nicht (M37). Die `context.id` aus der Antwort von `callService` wird am
  Vorschau-Eintrag gemerkt. Eigenes Echo, fremder und fehlender `context`
  zählen gleich: Die Vorschau endet bei erreichtem Wert oder nach der Frist
  (Nutzerentscheid 19.11.2026: Polling-Integrationen melden das Ergebnis des
  eigenen Aufrufs mit neuem `context`).

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

## Kartenkopf und Tastatur (M57, Buschcheck F6)

Der Button `.tap` (`role=button`) enthält nur das Symbol und heißt über
`aria-labelledby` wie der Titel; das `h2` steht als Geschwister daneben und
liegt per Grid in derselben Zelle, Tippfläche und Fokusring bleiben gleich.
Kinder eines Buttons sind für Screenreader nur Darstellung, die Überschrift
ging dort verloren. Die Statuszeile `.desc` löst dasselbe aus, ist also kein
eigener Tab-Stopp mehr (`tabindex=-1`, keine Rolle) und beschreibt den Button
(`aria-describedby`). Tippen und Halten hängen an Symbol, Titel und
Statuszeile wie vorher. Tab-Stopps: Titel-Button und Schalter, dazu der Regler,
solange er wirkt (R03). Der Regler trägt `aria-valuetext` („75 Prozent“).
`visual_contract.py` drückt echte Tabs durch die Karte (aus/an) und zählt
Überschriften in Buttons.

Halten per Tastatur (M74, Buschcheck F11): Umschalt+Enter oder die
Kontextmenütaste auf dem Titel-Button lösen `hold_action` aus; Enter und
Leertaste bleiben `tap_action`. Das Browsermenü, das die Kontextmenütaste
gleich danach öffnen würde, bleibt zu (1 s), ein Rechtsklick behält es. Der
Button trägt `aria-keyshortcuts`, solange eine Halte-Aktion gesetzt ist; der
Hilfetext von `hold_action` nennt den Weg (Wörterbuch de/en).

## Dialog am Handy (seit 0.11.0, #877)

Bis 0.10.0 war der Dialog unter 700 px ein unten angedocktes Sheet mit
`max-height: 92vh`. Belegt (rote Probe `render.py` 8e gegen 0.10.0): am Ende
des Sheets scrollte die Geste das Dashboard weiter, der Kopf scrollte weg,
nach dem Drehen passte der Dialog nicht; `vh` folgt den Android-Leisten nicht
(im Headless-Chromium nicht nachstellbar). Jetzt: Höhe aus dem fixierten Host
(folgt dem sichtbaren Viewport), Safe Areas per `env()`, unter 450 × 500 px
Vollbild (hacs/docs/ui-regeln.md), sonst zentriert; `overscroll-behavior:
contain`, Seiten-Scroll gesperrt solange offen (an einer Stelle,
connected/disconnectedCallback), Kopf sticky mit `top: -16px` (Sticky zählt
ab dem Innenabstand des Sheets).

## Szenen und Effekte je Lampe (seit 0.11.0, #885)

Szenen der Detailansicht kommen aus `scenesForLights` (Mitgliedschaft über
das `entity_id`-Attribut der Szene). Live am 09.11.2026 hatten alle 21
Szenen dieses Attribut; Szenen ohne Mitgliederliste (z. B. Hue-eigene) würden
nicht erscheinen. Aktiv: zuletzt aktivierte Szene, solange die Lampe sich
nicht mehr als 10 s danach geändert hat (HA meldet keine aktive Szene).
Effekte bis 12 als Chips, darüber `<select>` (live bis 504 Einträge).
Seit M65 (Buschcheck W18) sind die Szenen der Lampe dieselben Kacheln wie die
konfigurierten Szenen des Gruppendialogs (`_makeSceneTile`, Raster `.scenes`;
aktiv mit Ring, Häkchen und `aria-pressed`), und beide Ansichten folgen einer
Reihenfolge: Kopf, Szenen, Helligkeit, Farbe/Weiß, dann Lampen bzw. Effekte.
Das Farbrad ist 220 CSS-px groß; die 440 px im Befund waren Bildpunkte der
Aufnahmen mit `device_scale_factor=2`. `render.py` misst Reihenfolge,
Kachelmaß, Radgröße ≤ 240 px am Handy und abgeschnittene Bedienelemente.

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

Symbole (M79): Mit `regeln.py` zeichnen `render.py` und `visual_contract.py`
`ha-icon` über die gemeinsame Attrappe `regeln.ha_icon_attrappe` (echte
MDI-Pfade aus `hacs/docs/render/mdi-pfade.json`); die Kontrastmessung prüft
deren Glyphen mit ≥ 3:1. `report.json` enthält `haIcon` (aktiv, fehlende Namen,
gezählte Glyphen); ein Name ohne Pfad ist ein Fehler. Ohne `regeln.py`
(CI-Modus) bleibt die eigene Kastenattrappe der Seite. Die Pixel-Baselines
unter `docs/render/baseline/` zeigen noch die Kästen und werden beim nächsten
bewussten Erneuern neu aufgenommen.

Der Browserlauf deckt unter anderem ab: Auflösung (Duplikate, Zyklen,
Selbstreferenz, gelöschte Mitglieder, Fremddomänen, Tiefenlimit), das
Gedächtnis für nicht verfügbare Gruppen, Aggregation und Service-Routing,
Kartentexte, Dialog (Gruppenblöcke, Kacheln, Hauptschalter, Escape/Zurück,
Stapelung gegenüber hohen z-index-Werten), Zigbee2MQTT, Szenenimport und den
Editor (Optionsabdeckung, Labels und Helfer in beiden Sprachen, Live-Vorschau,
minimale Ausgabe, camelCase-Faltung, Szenenzeilen).

Handybreiten (M76, Buschcheck F14): Editor bei 320/360/390/480/960 px,
Regel 2 des Dialogs bei denselben Breiten, beide Dialogansichten (Gruppe und
Detail) zusätzlich bei 360 und 390 px in hell und dunkel, 844 px hoch:
Regel 1, Vollbild, nichts abgeschnitten, Lampenraster (M78), Kontrast und
Touch (`uiRegeln.m76_dialog_gruppe`/`_detail`, Bilder
`m76-dialog-<ansicht>-<breite>-<thema>.png`). `report.json` fasst die Breiten
je Ansicht unter `handyBreiten` zusammen. Kontrast/Touch des Editors bei
360/390 steht nur zur Information in `editorLayout` (Attrappen-Felder).

Grenzen: Der Editor wird im Renderer mit einer `ha-form`-Attrappe geprüft. Das
belegt Verdrahtung, Schema und erzeugte Konfiguration, nicht die Darstellung
der echten Home-Assistant-Selektoren.

`docs/render/visual_contract.py` erzeugt die synthetische Darstellungsmatrix
(320/360/390/480/960 px, hell/dunkel): Karte in allen Zuständen, an mit einer Farbe,
mehreren Farben, Weiß, Warmweiß und Gelb, aus, `off_color`, dazu der Dialog
je Breite (unter 450 px = Handy, Vollbild) und misst Kontrastquote und Textfarben. Die
gesichtete Auswahl liegt in `docs/render/baseline/hue-0.9.0/`; siehe deren
README. Alle Namen darin sind erfunden.
Bei 360 und 390 px (M76) misst es mit `regeln.py` zusätzlich Regel 1 für jeden
Zustand (Karte, Editor; Dialog in Gruppe und Detail am ganzen Blatt, das Fenster
wächst dafür auf dessen `scrollHeight`) und Regel 2 für jeden Dialogzustand
(`uiRegeln.faelle` in `visual-report.json`); `handyBreiten` listet die Breiten
je Zustand. Ein Verstoß, ein fehlender Zustand oder ein noch scrollendes Blatt
macht den Lauf rot; ohne `regeln.py` im CI-Modus bleibt es `kein_urteil`.

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

**24.11.2026 · 0.17.0, Nachholetappe J2 (#1346, Tag `v0.17.0`)** — Abstände auf --ha-space-* (M63, 2–4 px), Zustände bei 360/390 (M76). Abschlusslauf `karten-20261124-124054-53d328` 58/58 grün, Bildprüfung ok, Beleg gleich.

**20.11.2026 · 0.16.1, Repo-CI (#1323, Tag `v0.16.1`)** — render.py mit ausdrücklichem CI-Modus ohne regeln.py; Vertragsjob `contracts` grün. Karte unverändert. Abschlusslauf `karten-20261120-003418-9d0f74` grün (57/57, Volllauf), `--beleg-pruefen` gleich; Bildabweichungen gegen den Vorlauf nur am Gerätekopf (gewollt) und Rauschen.

**20.11.2026 · 0.16.0, Buschcheck Etappe I (#1323, Tag `v0.16.0`)** — getCardSize ohne erzwungenes Layout (M68, Browserprüfung 0 Layout-Abfragen), Hold per Tastatur (M74), Lampenraster ohne Einrückung (M78), Kopfkommentar (M73), Editor/Dialoge bei 360/390 (M76), Schalter/Regler/Fokus ≥ 3:1, Shared UI 0.5.3, CI aus der Vorlage (M45). 169 Node-Tests. Abschlusslauf `karten-20261119-234243-239269` grün (57/57, Volllauf, 2700 Node-Tests, Block `statisch` grün inkl. CI-Vorlage und Zeilenlänge), `--beleg-pruefen` gleich; Bilder am Bild geprüft (Sonnet).

**19.11.2026 · 0.15.0, Buschcheck Etappe H (#1313, Tag `v0.15.0`)** — Shared UI 0.5.0: `.busch-btn`/`.busch-chip` (M62), Typografie auf Tokens, Prozentlabel 12 px (M63), Kopf Stufe 1 (M61), Steuerdialog über dialogHistory/focusTrap mit X links (M28), Zustandsbaustein (M27), `BuschUI.register` (M42), Kontrast/Touch (M26). 148 Node-Tests. Abschlusslauf `karten-20261119-195834-aaec84` grün (55/55, 2590 Node-Tests, Block `statisch` grün, Kontrast/Touch gemessen), `--beleg-pruefen` gleich; Bilder zweimal am Bild geprüft (Sonnet), Befunde behoben.

**19.11.2026 · 0.14.0, Buschcheck Etappe G (#1310, Tag `v0.14.0`)** — Dialog folgt dem HA-Thema, `dialog_theme: dark` für den bisherigen Look (M29, E4); eine Szenendarstellung, feste Abschnittsreihenfolge (M65); Kartentitel neben dem Button, Kopf 2 Tab-Stopps, aria-valuetext (M57). 118 Node-Tests. Abschlusslauf `karten-20261119-141846-b2547c` grün (43/43, 948 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder zweimal am Bild geprüft (Sonnet), Mängel bei 320 px behoben, sonst Rauschen.

**19.11.2026 · 0.13.3, Buschcheck Etappe F (#1301, Tag `v0.13.3`)** — Farb-/Kelvin-Vorschau endet erst bei erreichtem Wert (rgb ±8, Kelvin ±50, passender `color_mode`) oder nach 4 s; fremder `context` zählt wie keiner (Nutzerentscheid 19.11.) (M37). 104 Node-Tests. Abschlusslauf `karten-20261119-114355-b75c2d` grün (52/52, 1492 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder gegen den Vorlauf am Bild geprüft (Sonnet), `dialog-white` zeigt gewollt die gehaltene Weißvorschau.

**18.11.2026 · 0.13.2, Buschcheck Etappe C (#1278, Tag `v0.13.2`)** — XSS-Payloadtests für Karte, Dialog und Detailansicht und CI-Schritt Sinks (M19), Shared UI 0.4.0. Sichtbar unverändert. 100 Node-Tests. Abschlusslauf `karten-20261118-143236-199107` grün (55/55, 2159 Node-Tests, Block `statisch` mit `sinks` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe B am Bild geprüft (Sonnet), Abweichungen gewollt oder Rauschen (Uhrzeit, Kacheln, Markenlogo aus dem Netz).

**18.11.2026 · main nach 0.13.1, Buschcheck Etappe B (#1271, kein Tag)** — Testkit `tests/_testkit.cjs` (M5); dist unverändert. 71 Node-Tests. Abschlusslauf `karten-20261118-131312-6dd1c4` grün (51/51, 1003 Node-Tests, Block `statisch` grün), `--beleg-pruefen` gleich; Bilder gegen Etappe A: 1836/1901 bytegleich, Rest Uhrzeit-/Animationsrauschen.

**18.11.2026 · 0.13.1, Buschcheck Etappe A (#1266, Tag `v0.13.1`)** — Szenen-Aufrufe mit Fehlerpfad: Chip verliert die Markierung bei Fehler, keine unbehandelte Ablehnung (M40). 71 Node-Tests. Abschlusslauf `karten-20261118-115150-b741a7` grün (38/38, 908 Node-Tests), `--beleg-pruefen` gleich; `node --check`, `ui-regeln-pruefen.py` (0), `hacs-contract-lint.py` (0), Kern bytegleich.

**12.11.2026 · 0.11.1, Kartenwähler ohne Live-Vorschau (#1011, Tag `v0.11.1`)** — Beschreibung ein Satz, englischer Name „Busch light card“; `getStubConfig` merkt die Vorgabe je Entitätsregister (ein Durchlauf über `hass.states`). `docs/render/render.py` erwartet jetzt `preview: false`.

1. `node --check` grün; neue Tests `tests/kartenwaehler.test.js` (preview false, ein Satz Beschreibung de/en, höchstens ein Durchlauf je Register, kein Netz) zuerst rot, danach grün.
2. `python3 scripts/ui-regeln-pruefen.py`: 0 Verstöße, mit der neuen Prüfung R3.6 (Kartenwähler-Vertrag), die vorher für dieses Repo rot war.
3. Einziger Abnahmelauf `karten-alle.sh` für alle fünf geänderten Kartenrepos (Lauf `karten-20261112-175558-77c23e`): 3/3 Schritte grün, Node 68 Tests grün, 164 Bilder.
4. Eintrag in `docs/stand.md` der Projektverwaltung, Block 12.11.2026 (#1011).

**09.11.2026 · 0.11.0 (#877 Dialog am Handy, #885 Szenen/Effekte je Lampe)** — vier Abnahmebelege vor dem Tag:

1. `node --check dist/busch-lightcards.js` grün.
2. `python3 scripts/ui-regeln-pruefen.py --repo ha-busch-lightcards`
   (HACS-Ebene): 0 Verstöße.
3. `KARTEN_TODO=885 scripts/karten-alle.sh --repo ha-busch-lightcards`
   (`test-hacs-t885-abnahme-…`), Lauf `karten-20261109-210216-3a0f50`,
   3/3 grün: `node --test` 66/66 (14 neu: Scroll-Sperre auf allen
   Schließwegen, Effekte, lange Effektlisten, Szenen und Aktivregel; 9 davon
   rot vor der jeweiligen Änderung); `render.py` 132/132 (7 neue Prüfungen:
   #877 Lage/Vollbild/Scrollen/Kopf/Seite/Drehen bei 5 Größen, rot gegen
   0.10.0; #885 Szenen und Effekte bei 360 und 1280 px, Touchziele ≥ 44 px),
   Regel 1 186 Textelemente ohne Befund, Regel 2 ohne Verstoß, 0 Konsolen-/
   Seitenfehler; `visual_contract.py` 138/138, Tastaturprobe grün.
   Zusätzlich lesend im echten HA-Frontend (Schreibzugriffe gesperrt):
   Fokus, Escape, Zurück, Schließen, Detail↔Gruppe, Scroll nach Update grün;
   die vier Regler-/Picker-Fälle des unversionierten
   `layout-dialog-contract.py` setzen das Verhalten vor 0.10.0 voraus und
   starten gegen v0.10.0 gar nicht, kein Beleg. HA-Dashboard scrollt über
   `document.scrollingElement` (Probe 390×700), die Sperre greift dort.
4. Dieser Abschnitt und der Block im HACS-Stand. Bilder gesichtet; Auswahl
   in `docs/render/baseline/hue-0.11.0/`.

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
