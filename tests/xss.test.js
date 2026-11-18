'use strict';
// #1278 M19 (Buschcheck S5): the light card builds its DOM from nodes, never
// from HTML text. This pins that down: every payload of XSS_PAYLOADS as lamp,
// group, scene and effect name, as card title (plain and via a {{ }} template),
// as scene tile label and inside a config error must stay text in the card,
// the dialog and the detail view. activeMarkup must be empty; the card has no
// wanted img/svg/script or on* attribute, so nothing is exempted.
const test = require('node:test');
const assert = require('node:assert');
const { XSS_PAYLOADS, activeMarkup } = require('./_testkit.cjs');
const { neueUmgebung, neuesHaus, neueKarte, licht } = require('./attrappe.js');

const sauber = (u) => assert.deepStrictEqual(activeMarkup(u.body), [], 'active markup below body');
const texte = (wurzel, sel) => wurzel.querySelectorAll(sel).map((n) => n.textContent);

/** Every name of the default house carries `p`; one scene and one script use the lights. */
function haus(p) {
  const h = neuesHaus({ an: true });
  for (const [id, s] of Object.entries(h.states)) if (id.startsWith('light.')) s.attributes.friendly_name = p;
  const steh = licht('light.steh', true, { name: p });
  steh.attributes.effect_list = [p, 'Kerze'];
  steh.attributes.effect = p;
  Object.assign(h.states, {
    'light.steh': steh,
    'scene.p': { entity_id: 'scene.p', state: 'unknown', attributes: { friendly_name: p, entity_id: ['light.steh'] } },
    'script.p': { entity_id: 'script.p', state: 'off', attributes: { friendly_name: 'Skript' } },
  });
  return h;
}

for (const p of XSS_PAYLOADS) {
  const name = JSON.stringify(p);

  test(`Karte und Dialog, Payload ${name} in Lampen-, Gruppen- und Szenennamen: bleibt Text`, () => {
    const u = neueUmgebung(), h = haus(p);
    const karte = neueKarte(u, h, { scenes: ['scene.p', { entity: 'script.p', title: p }] });
    assert.strictEqual(karte._title.textContent, p, 'Kartentitel aus friendly_name der Gruppe');
    sauber(u);

    karte._openDialog();
    const sheet = karte._dialog._sheet;
    assert.ok(sheet.textContent.includes(p), 'Name im Dialog');
    assert.strictEqual(sheet.querySelectorAll('.scene').length, 2);
    assert.ok(sheet.querySelectorAll('.scene').every((s) => s.textContent.includes(p)), 'Szenenname und Kachelbeschriftung');
    assert.ok(texte(sheet, '.tile').some((t) => t.includes(p)), 'Lampen-/Gruppenkachel');
    sauber(u);

    const dialog = karte._dialog;
    dialog._detailEntity = 'light.steh';
    dialog._renderSheet();
    const chips = (art) => dialog._sheet.querySelectorAll('.' + art).flatMap((b) => texte(b, 'button'));
    assert.ok(chips('effects').includes(p), 'Effektname');
    assert.ok(chips('lightscenes').includes(p), 'Szene der Lampe');
    sauber(u);
  });

  test(`Detailansicht mit Auswahlliste, Payload ${name} als Effekt: bleibt Text`, () => {
    const u = neueUmgebung(), h = haus(p);
    h.states['light.steh'].attributes.effect_list = [p, ...Array.from({ length: 40 }, (_, i) => 'Effekt ' + i)];
    const karte = neueKarte(u, h);
    karte._openDialog();
    karte._dialog._detailEntity = 'light.steh';
    karte._dialog._renderSheet();
    const auswahl = karte._dialog._sheet.querySelector('select');
    assert.ok(texte(auswahl, 'option').includes(p));
    sauber(u);
  });

  test(`Titel aus Konfiguration und Vorlage, Payload ${name}: bleibt Text`, () => {
    const u = neueUmgebung(), h = haus(p);
    const direkt = neueKarte(u, h, { title: p });
    assert.strictEqual(direkt._title.textContent, p);
    const vorlage = neueKarte(u, h, { title: 'A {{ light.steh.friendly_name }}' });
    assert.strictEqual(vorlage._title.textContent, 'A ' + p);
    sauber(u);
  });

  test(`Konfigurationsfehler mit Payload ${name}: bleibt Text`, () => {
    const u = neueUmgebung(), h = haus(p);
    const karte = neueKarte(u, h, { scenes: [{ title: p }] });
    assert.ok(karte.shadowRoot.textContent.includes(JSON.stringify(p).slice(1, -1)), karte.shadowRoot.textContent);
    sauber(u);
  });
}

test('Lightcards schreibt kein HTML aus Text: keine innerHTML-Zuweisung mit Inhalt', () => {
  const quelle = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'dist', 'busch-lightcards.js'), 'utf8');
  const zuweisungen = [...quelle.matchAll(/\.(?:inner|outer)HTML\s*\+?=(?!=)\s*([^;\n]*)/g)].map((m) => m[1].trim());
  assert.deepStrictEqual([...new Set(zuweisungen)], ["''"], 'nur Leeren per innerHTML');
  assert.doesNotMatch(quelle, /insertAdjacentHTML|DOMParser|createContextualFragment/);
});
