'use strict';
// M65 (Buschcheck W18): eine Szenenkachel in Gruppen- und Einzellampendialog,
// feste Reihenfolge Kopf, Szenen, Helligkeit, Farbe, Lampen.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht } = require('./attrappe.js');

const szene = (id, name, mitglieder) => ({
  entity_id: id, state: 'unknown', attributes: { friendly_name: name, entity_id: mitglieder },
});

/** Haus mit Farblampe und zwei Szenen der Stehlampe; dazu Effekte. */
function haus() {
  const h = neuesHaus({ an: true });
  const steh = licht('light.steh', true);
  steh.attributes.supported_color_modes = ['color_temp', 'xy'];
  steh.attributes.effect_list = ['Kerze', 'Regenbogen'];
  Object.assign(h.states, {
    'light.steh': steh,
    'scene.lesen': szene('scene.lesen', 'Lesen', ['light.steh']),
    'scene.abend': szene('scene.abend', 'Abend', ['light.steh', 'light.decke_1']),
  });
  return h;
}
function gruppenDialog(u, h) {
  const karte = neueKarte(u, h, { scenes: ['scene.lesen', { entity: 'scene.abend', color: '#ff5ca8' }] });
  karte._openDialog();
  return karte._dialog;
}
function detailDialog(u, h) {
  const dialog = gruppenDialog(u, h);
  dialog._detailEntity = 'light.steh';
  dialog._renderSheet();
  return dialog;
}
/** Abschnittsfolge des Blatts: Überschriften und die Bausteine dazwischen. */
function abschnitte(dialog) {
  return dialog._sheet.childNodes.flatMap((n) => {
    const kl = n.classList;
    if (n.tagName === 'H3') return ['h3:' + n.textContent.replace(/ \(\d+\)$/, '')];
    if (kl.contains('head')) return ['kopf'];
    if (kl.contains('scenes')) return ['szenen'];
    if (kl.contains('picker-tabs')) return ['farbe'];
    if (kl.contains('detail')) return n.childNodes.map((c) => (c.tagName === 'H3' ? 'h3:' + c.textContent : c.className));
    return [n.className || n.tagName.toLowerCase()];
  });
}

test('M65 Einzellampe: Szenen sind dieselben Kacheln wie im Gruppendialog', () => {
  const u = neueUmgebung(), h = haus();
  const gruppe = gruppenDialog(u, h)._sheet.querySelectorAll('.scene');
  const detail = detailDialog(u, h)._sheet.querySelectorAll('.scene');
  assert.equal(gruppe.length, 2);
  assert.deepEqual(detail.map((b) => b.textContent), ['Abend', 'Lesen']);
  for (const kachel of detail) {
    assert.equal(kachel.tagName, 'BUTTON');
    assert.ok(kachel.querySelector('.badge'), 'runder Fleck mit Symbol wie im Gruppendialog');
    assert.ok(kachel.querySelector('.badge').querySelector('ha-icon'));
    assert.ok(/^fg-(light|dark)$/.test(kachel.className.split(' ').find((c) => c.startsWith('fg-'))), 'Schriftfarbe je Kachel');
    assert.ok(kachel.style.background, 'Kachelfarbe gesetzt');
  }
  assert.ok(detail[0].parentNode.classList.contains('scenes'), 'gleiches Raster .scenes');
  assert.equal(detailDialog(u, h)._sheet.querySelectorAll('.chips').filter((c) => c.classList.contains('lightscenes')).length, 0,
    'keine Pillen mehr für Szenen');
});

test('M65 Reihenfolge: Kopf, Szenen, Helligkeit, Farbe, Lampen bzw. Effekte – in beiden Dialogen', () => {
  const u = neueUmgebung(), h = haus();
  const gruppe = abschnitte(gruppenDialog(u, h)).filter((x) => /^(kopf|szenen|farbe|h3:)/.test(x));
  assert.deepEqual(gruppe, ['kopf', 'h3:Szenen', 'szenen', 'h3:Helligkeit', 'farbe', 'h3:Lampen']);
  const detail = abschnitte(detailDialog(u, h)).filter((x) => /^(kopf|szenen|farbe|h3:)/.test(x));
  assert.deepEqual(detail, ['kopf', 'h3:Szenen', 'szenen', 'h3:Helligkeit', 'farbe', 'h3:Effekte']);
});

test('M65 Szenenkachel der Lampe: Tippen ruft scene.turn_on und markiert sie über aria-pressed und Häkchen', () => {
  const u = neueUmgebung(), h = haus();
  const dialog = detailDialog(u, h);
  const lesen = dialog._sheet.querySelectorAll('.scene').find((b) => b.textContent === 'Lesen');
  assert.equal(lesen.getAttribute('aria-pressed'), 'false');
  lesen.click();
  assert.deepEqual(h.rufe.at(-1), { domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.lesen' } });
  const neu = dialog._sheet.querySelectorAll('.scene').find((b) => b.textContent === 'Lesen');
  assert.equal(neu.getAttribute('aria-pressed'), 'true');
  assert.ok(neu.classList.contains('active'), 'nicht nur über Farbe: Klasse für Ring und Häkchen');
  const css = u.registry.get('busch-light-card').__internals.DIALOG_STYLES;
  assert.match(css, /\.scene\.active > span:last-child::before \{ content: '\\2713\\00a0'; \}/);
});

test('M65 Farbrad am Handy höchstens 240 px', () => {
  const u = neueUmgebung(), h = haus();
  const dialog = detailDialog(u, h);
  const rad = dialog._sheet.querySelector('canvas');
  assert.ok(rad, 'Farbrad vorhanden');
  assert.ok(parseInt(rad.style.width, 10) <= 240, 'Breite ' + rad.style.width);
  assert.ok(parseInt(rad.style.height, 10) <= 240, 'Höhe ' + rad.style.height);
});
