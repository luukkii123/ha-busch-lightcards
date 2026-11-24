'use strict';
// M26 (#1346, Abschlusstor Prüfung 4): visual_contract.py measures contrast and touch targets with the shared module
// (hacs/scripts/kontrast_touch.py via regeln.messe_kontrast_touch_hier) for every card state and every dialog state
// (group and detail view), at every width and in both themes, and writes the areas `kontrast` and `touch` into
// visual-report.json; a violation fails the run. visual_contract.py is also a repo CI contract
// (.github/ci-contracts.txt) without regeln.py: there both areas carry a kein_urteil instead of a crash.
// Checked in the source: no browser in the Node run.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lies = (name) => fs.readFileSync(path.join(__dirname, '..', 'docs', 'render', name), 'utf8');

test('M26 visual_contract imports the shared contrast/touch measurement only with regeln.py', () => {
  const v = lies('visual_contract.py');
  assert.match(v, /\nif REGELN_DA:[^\n]*\n\s+from regeln import [^\n]*messe_kontrast_touch_hier/, 'guarded import');
  assert.doesNotMatch(v, /^from regeln import/m, 'no unguarded regeln import (CI contract)');
  assert.match(v, /AUSNAHMEN = Path\(__file__\)\.resolve\(\)\.with_name\("kontrast-ausnahmen\.json"\)/);
  assert.match(v, /messe_kontrast_touch_hier\(page, selector, ausnahmen=AUSNAHMEN\)/, 'exception list of the repo not passed');
});

test('M26 visual_contract measures every card state and every dialog state per width and theme', () => {
  const v = lies('visual_contract.py');
  const karte = v.slice(v.indexOf('for name, payload in scenarios.items():'), v.indexOf('# The dialog in the same matrix'));
  assert.match(karte, /measure_kt\("busch-light-card", width, theme, name\)/, 'card state not measured');
  const dialog = v.slice(v.indexOf('for dialog_case, look in'), v.indexOf('editor-long-{width}'));
  assert.match(dialog, /measure_kt\("\.sheet", width, theme, rule_name, "group"\)/, 'dialog group view not measured');
  assert.match(dialog, /measure_kt\("\.sheet", width, theme, rule_name, "detail"\)/, 'dialog detail view not measured');
  assert.match(dialog, /measure_kt\("\.sheet", width, theme, "dialog-offline", "group"\)/, 'offline dialog not measured');
  assert.match(dialog, /measure_kt\("\.sheet", width, theme, "dialog-offline", "detail"\)/, 'offline detail not measured');
  // Every measured state is in the report: one run per state, view, width and theme.
  assert.match(v, /"breite": width, "thema": theme, "zustand": state/);
});

test('M26 visual-report.json carries kontrast and touch, a violation is exit 1', () => {
  const v = lies('visual_contract.py');
  assert.match(v, /report\["kontrast"\] = kontrast_touch\["kontrast"\]/, 'report without kontrast');
  assert.match(v, /report\["touch"\] = kontrast_touch\["touch"\]/, 'report without touch');
  assert.match(v, /bewerte\(kontrast_touch\) == 0/, 'violations do not fail the run');
  assert.match(v, /kontrast_touch\["kontrast"\]\["laeufe"\]/, 'nothing measured must not pass');
  assert.match(v, /and kt_ok\)/, 'kt_ok not in the exit code');
});

test('M26 visual_contract keeps running without regeln.py: kontrast/touch are kein_urteil', () => {
  const v = lies('visual_contract.py');
  assert.match(v, /kontrast_touch = \{bereich: \{"kein_urteil": /, 'no kein_urteil for kontrast/touch without regeln.py');
  assert.match(v, /kt_ok = CI_MODUS/, 'without regeln.py only CI mode passes');
});

test('M26 exceptions: only with a reason, only for stand-ins or Home Assistant elements', () => {
  const liste = JSON.parse(lies('kontrast-ausnahmen.json'));
  for (const bereich of ['kontrast', 'touch']) {
    assert.ok(Array.isArray(liste[bereich]), bereich);
    for (const a of liste[bereich]) {
      assert.ok(String(a.grund || '').trim(), 'reason missing: ' + JSON.stringify(a));
      assert.match(String(a.selektor), /(^|[\s>+~(,])ha-[\w-]+|attrappe/i, 'not a stand-in or HA element: ' + a.selektor);
    }
  }
});
