# Dialog und Detailansicht 0.11.0 — gesichtete Browser-Auswahl

Stand: 09.11.2026 (#877, #885). Lauf `karten-20261109-210216-3a0f50`.

- `dialog-success-320-dark.png`, `dialog-success-960-light.png` aus
  `../../visual_contract.py`: am Handy Vollbild, am Desktop zentriert (#877).
- `t877-detail-640x360.png` aus `../../render.py` (8e): Detailansicht im
  Querformat, Kopf bleibt beim Scrollen stehen.
- `t885-detail-8-360x640.png`, `t885-detail-40-1280x800.png` aus
  `../../render.py` (8f): Szenen der Lampe, 8 Effekte als Knöpfe, 40 als
  Auswahlliste (#885).

`report.json` ist der vollständige Bericht des visual_contract-Schritts
desselben Laufs. Alle Entitäten, Zustände und Namen sind **synthetisch**
(`../../visual_contract.py`, `../../fixture.json`). Icons sind Platzhalter
der Testseite. Die Bilder wurden vor dem Commit angesehen.

Neu erzeugen: `bash scripts/karten-alle.sh --repo ha-busch-lightcards`
(HACS-Ebene), dann die Bilder aus `artifacts/e2e/<lauf>/` übernehmen.
