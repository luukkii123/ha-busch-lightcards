# Hue-Optik 0.9.0 — gesichtete Browser-Auswahl

Stand: 28.10.2026 (#712). 30 PNGs aus `../../visual_contract.py`: die Karte
bei 480 px in Hell und Dunkel an mit mehreren Farben (`on`, mit einer nicht
erreichbaren Lampe), einer Farbe (`single`), Warmweiß (`warm`), Kaltweiß und
Weiß (`white`), Gelb (`yellow`), aus (`off`, `unavailable`), mit `off_color`
(`custom_color`) und langen Texten (`long`); `on` zusätzlich bei 320 und
960 px; der Dialog bei 320 (Handy, Blatt von unten), 480 und 960 px.
`report.json` ist der vollständige Bericht desselben Laufs (102 Fälle,
Kontrastquote je Fall, Tastaturprobe).

Alle Entitäten, Zustände und Namen sind **synthetisch** und werden in
`../../visual_contract.py` erzeugt. Icons sind Platzhalter der Testseite,
nicht die echten mdi-Icons. Die Bilder wurden vor dem Commit angesehen.

Neu erzeugen (Docker, `$REPO` = Pfad dieses Repos):

```bash
docker run --rm --name test-lightcards-visual \
  -v "$REPO:/repo" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null && \
      python3 /repo/docs/render/visual_contract.py /repo/dist/busch-lightcards.js \
              /repo/docs/render/ergebnis-visual'
```

Das Ergebnisverzeichnis bleibt ignoriert. Eine neue Auswahl entsteht erst
nach der Sichtprüfung und dem Kopieren der PNGs in diesen Ordner.
