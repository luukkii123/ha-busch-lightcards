# Busch HA UI 0.1.0 — akzeptierte Browser-Baseline

Stand: 25.09.2026. Die 66 PNGs zeigen die **Busch-Lampenkarte und ihren Editor**
bei 320, 480 und 960 px in Hell und Dunkel. Die Karte ist pro Kombination mit
ein-, aus- und teilweise eingeschaltetem Licht, langen Texten, Ausfall, leerem
Inhalt, Laden, Konfigurationsfehler und eigener Aus-Farbe enthalten. Der Editor
hat lange Titel und eine Szenenzeile. `report.json` enthält die Geometriemessung
und das Ergebnis (66/66 Fälle, Tastaturtest grün).

Alle Entitäten, Zustände und Namen in diesen Bildern sind **synthetisch** und
werden direkt in `../visual_contract.py` erzeugt. Für den Editor nutzt der
Browserlauf eine `ha-form`-Attrappe; die nativen Home-Assistant-Selektoren und
die Darstellung in einer laufenden HA-Installation sind damit nicht belegt.

Die Bilder wurden vor dem Commit angesehen. Neu erzeugen auf dem Unraid-Host:

```bash
docker run --rm \
  -v "/mnt/user/Data/Claude Projekte/hacs/ha-busch-lightcards:/repo" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null && \
      python3 /repo/docs/render/visual_contract.py /repo/dist/busch-lightcards.js \
              /repo/docs/render/ergebnis-visual-synthetic'
```

Das Ergebnisverzeichnis bleibt ignoriert. Eine neue akzeptierte Baseline
entsteht erst nach der Sichtprüfung und dem Kopieren der PNGs und des Berichts
in diesen Ordner.
