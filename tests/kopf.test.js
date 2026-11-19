'use strict';
// M73 (Buschcheck D16): the file header lists every card the bundle puts into
// window.customCards. A new card without a header entry turns this red.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { neueUmgebung } = require('./attrappe.js');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'busch-lightcards.js'), 'utf8');

/** The card list of the bundle's own header comment (after the shared block). */
function kopfKarten() {
  const ab = QUELLE.indexOf('/* END BUSCH SHARED UI */');
  const start = QUELLE.indexOf('/*', ab + 5);
  const kopf = QUELLE.slice(start, QUELLE.indexOf('*/', start));
  const liste = kopf.split('\n').map((z) => z.match(/^ \* {3}- `([a-z0-9-]+)`/)).filter(Boolean).map((m) => m[1]);
  return { kopf, liste };
}

test('M73 Kopfkommentar nennt genau die Karten aus window.customCards', () => {
  const { kopf, liste } = kopfKarten();
  assert.match(kopf, /Cards in this bundle/, 'Kopf führt eine Kartenliste');
  const u = neueUmgebung();
  const karten = u.kontext.window.customCards.map((c) => c.type);
  assert.ok(karten.length >= 1, 'customCards gefüllt');
  assert.deepEqual([...liste].sort(), [...karten].sort(), 'Kopfliste = customCards');
  assert.equal(new Set(liste).size, liste.length, 'kein Eintrag doppelt');
});

test('M73 Kopfliste gilt auch für eine neue Karte: ohne Eintrag rot', () => {
  // The comparison the first test makes, against a picker with one card more.
  const { liste } = kopfKarten();
  const u = neueUmgebung();
  const mehr = u.kontext.window.customCards.map((c) => c.type).concat('busch-new-card');
  assert.notDeepEqual([...liste].sort(), [...mehr].sort());
});
