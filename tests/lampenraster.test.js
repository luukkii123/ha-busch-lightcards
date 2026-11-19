'use strict';
// M78 (Buschcheck W22): one tile raster in the dialog. A nested group is
// marked by a line in the sheet's gutter, not indented, so its tiles start on
// the same columns as the root's; its header is a 44 px row. The browser
// render (docs/render/render.py, "M78 ...") measures the x positions.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte } = require('./attrappe.js');

const regel = (css, selektor) => {
  const i = css.indexOf('\n' + selektor + ' {');
  return i < 0 ? null : css.slice(i, css.indexOf('}', i) + 1);
};
const dialogCss = (u) => {
  const karte = neueKarte(u, neuesHaus({ an: true }));
  karte._openDialog();
  return { dialog: karte._dialog, css: karte._dialog.shadowRoot.querySelector('style').textContent };
};

test('M78 Szenen und Lampen auf einem Raster: repeat(auto-fill, minmax(..))', () => {
  const { css } = dialogCss(neueUmgebung());
  const r = regel(css, '.scenes, .tiles');
  assert.ok(r, '.scenes, .tiles teilen eine Regel');
  assert.match(r, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(\d+px,\s*1fr\)\)/);
  assert.equal(css.match(/\.tiles[^{]*\{[^}]*grid-template-columns/g).length, 1, 'kein zweites Spaltenmaß für .tiles');
});

test('M78 Untergruppe ohne Einrückung, nur mit linker Linie in der Blattrinne', () => {
  const { css } = dialogCss(neueUmgebung());
  const nested = regel(css, '.group.nested') || '';
  assert.doesNotMatch(nested, /padding(-left)?\s*:|margin(-left)?\s*:|border(-left)?\s*:/, 'kein Einzug: ' + nested);
  const linie = regel(css, '.group.nested::before');
  assert.ok(linie, 'die Linie ist ein ::before');
  assert.match(linie, /position:\s*absolute/);
  assert.match(linie, /width:\s*2px/);
  assert.match(linie, /background:\s*var\(--blc-d-line\)/);
  // Inside the sheet's 16 px padding: the line sits in the gutter, it is not cut off.
  const links = Number((linie.match(/left:\s*(-?\d+)px/) || [])[1]);
  assert.ok(links < 0 && links >= -14, 'links in der Rinne: ' + links);
  assert.match(nested, /position:\s*relative/);
});

test('M78 Kopfzeile der Untergruppe ist eine 44-px-Zeile', () => {
  const { css } = dialogCss(neueUmgebung());
  const kopf = regel(css, '.group-head');
  assert.match(kopf, /min-height:\s*44px/);
  assert.match(kopf, /padding:\s*0\b/, 'kein eigener Innenabstand, die Zeile bestimmt die Höhe');
});

test('M78 Aufbau bleibt: Gruppe = Kopf + Kachelraster, Untergruppe markiert', () => {
  const u = neueUmgebung();
  const haus = neuesHaus({ an: true });
  // Wohnzimmer = Decke (group of two) + Stehlampe: the root's own lamp bare, Decke as a block.
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const sheet = karte._dialog._sheet;
  const bloecke = sheet.querySelectorAll('.group');
  assert.ok(bloecke.length >= 1, 'mindestens ein Gruppenblock');
  for (const b of bloecke) {
    assert.deepEqual(b.childNodes.map((c) => c.className.split(' ')[0]), ['group-head', 'tiles']);
  }
  assert.ok(bloecke.some((b) => b.classList.contains('nested')), 'Untergruppe trägt .nested');
});
