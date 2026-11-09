'use strict';
// #885: Effekte und Szenen einer Lampe in ihrer Detailansicht.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht } = require('./attrappe.js');

/** Stehlampe mit Effekten; Detailansicht der Stehlampe offen. */
function detail(u, haus, id = 'light.steh') {
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  dialog._detailEntity = id;
  dialog._renderSheet();
  return dialog;
}
const mitEffekten = (an, effekt) => {
  const l = licht('light.steh', an);
  l.attributes.effect_list = ['Kerze', 'Regenbogen', 'off'];
  if (effekt !== undefined) l.attributes.effect = effekt;
  return l;
};
const chips = (dialog, art) => dialog._sheet.querySelectorAll('.' + art).flatMap((b) => b.querySelectorAll('button'));
const aktiv = (dialog, art) => chips(dialog, art).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

test('Effekte: Abschnitt mit allen Einträgen, aktiver markiert', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.states['light.steh'] = mitEffekten(true, 'Kerze');
  const dialog = detail(u, haus);
  assert.deepEqual(chips(dialog, 'effects').map((b) => b.textContent), ['Kerze', 'Regenbogen']);
  assert.deepEqual(aktiv(dialog, 'effects'), ['Kerze']);
});

test('Effekt antippen: ein Aufruf light.turn_on mit effect, sofort markiert', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.states['light.steh'] = mitEffekten(true, 'Kerze');
  const dialog = detail(u, haus);
  chips(dialog, 'effects')[1].click();
  assert.equal(haus.rufe.length, 1);
  assert.deepEqual(haus.rufe[0], { domain: 'light', service: 'turn_on', data: { entity_id: 'light.steh', effect: 'Regenbogen' } });
  assert.deepEqual(aktiv(dialog, 'effects'), ['Regenbogen']);
  // HA bestätigt: die Markierung bleibt, ohne Neuladen der Karte.
  dialog.hass = haus.setze({ 'light.steh': mitEffekten(true, 'Regenbogen') });
  assert.deepEqual(aktiv(dialog, 'effects'), ['Regenbogen']);
});

test('Lampe ohne Effekte: kein Abschnitt', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = detail(u, haus);
  assert.equal(dialog._sheet.querySelectorAll('.effects').length, 0);
  assert.ok(!dialog._sheet.querySelectorAll('h3').some((h) => h.textContent === 'Effekte'));
});

test('Effekt off/none gilt nicht als aktiv', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.states['light.steh'] = mitEffekten(true, 'off');
  assert.deepEqual(aktiv(detail(u, haus), 'effects'), []);
});

test('Effekte: leerer Eintrag fällt weg', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const l = mitEffekten(true);
  l.attributes.effect_list = ['', 'Kerze'];
  haus.states['light.steh'] = l;
  assert.deepEqual(chips(detail(u, haus), 'effects').map((b) => b.textContent), ['Kerze']);
});

test('viele Effekte: Auswahlliste statt Chips, aktiver gewählt, Wahl ruft den Dienst', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const l = mitEffekten(true, 'Effekt 7');
  l.attributes.effect_list = Array.from({ length: 40 }, (_, i) => 'Effekt ' + i);
  haus.states['light.steh'] = l;
  const dialog = detail(u, haus);
  assert.equal(chips(dialog, 'effects').length, 0, 'keine 40 Chips');
  const auswahl = dialog._sheet.querySelector('select');
  assert.ok(auswahl, 'Auswahlliste');
  assert.equal(auswahl.querySelectorAll('option').length, 41, 'leere Wahl + 40');
  assert.equal(auswahl.value, 'Effekt 7');
  auswahl.value = 'Effekt 3';
  auswahl.dispatchEvent(u.neuesEreignis('change'));
  assert.deepEqual(haus.rufe.at(-1).data, { entity_id: 'light.steh', effect: 'Effekt 3' });
});

// ── Szenen der Lampe ───────────────────────────────────────────────────────
const szene = (id, name, mitglieder, zeit) => ({
  entity_id: id, state: zeit || 'unknown', attributes: { friendly_name: name, entity_id: mitglieder },
});

test('Szenen: nur die der Lampe, nach Name, Tippen ruft scene.turn_on', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  Object.assign(haus.states, {
    'scene.lesen': szene('scene.lesen', 'Lesen', ['light.steh']),
    'scene.abend': szene('scene.abend', 'Abend', ['light.steh', 'light.decke_1']),
    'scene.kueche': szene('scene.kueche', 'Küche', ['light.kueche']),
  });
  const dialog = detail(u, haus);
  const knoepfe = chips(dialog, 'lightscenes');
  assert.deepEqual(knoepfe.map((b) => b.textContent), ['Abend', 'Lesen']);
  knoepfe[1].click();
  assert.deepEqual(haus.rufe.at(-1), { domain: 'scene', service: 'turn_on', data: { entity_id: 'scene.lesen' } });
  assert.deepEqual(aktiv(dialog, 'lightscenes'), ['Lesen'], 'sofort markiert');
});

test('Szenen: zuletzt aktivierte markiert, Wechsel verschiebt die Markierung', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const t0 = new Date(u.uhr.jetzt - 60_000).toISOString();
  const l = licht('light.steh', true); l.last_updated = new Date(u.uhr.jetzt - 59_000).toISOString();
  Object.assign(haus.states, {
    'light.steh': l,
    'scene.lesen': szene('scene.lesen', 'Lesen', ['light.steh'], t0),
    'scene.abend': szene('scene.abend', 'Abend', ['light.steh'], new Date(u.uhr.jetzt - 3_600_000).toISOString()),
  });
  const dialog = detail(u, haus);
  assert.deepEqual(aktiv(dialog, 'lightscenes'), ['Lesen']);
  const t1 = new Date(u.uhr.jetzt).toISOString();
  const l2 = licht('light.steh', true, { helligkeit: 90 }); l2.last_updated = new Date(u.uhr.jetzt + 500).toISOString();
  dialog.hass = haus.setze({ 'scene.abend': szene('scene.abend', 'Abend', ['light.steh'], t1), 'light.steh': l2 });
  assert.deepEqual(aktiv(dialog, 'lightscenes'), ['Abend']);
});

test('Szenen: Lampe danach von Hand geändert -> keine Markierung', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const l = licht('light.steh', true); l.last_updated = new Date(u.uhr.jetzt).toISOString();
  Object.assign(haus.states, {
    'light.steh': l,
    'scene.lesen': szene('scene.lesen', 'Lesen', ['light.steh'], new Date(u.uhr.jetzt - 600_000).toISOString()),
  });
  assert.deepEqual(aktiv(detail(u, haus), 'lightscenes'), []);
});

test('Lampe ohne Szenen und Effekte: Detailansicht ohne beide Abschnitte', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = detail(u, haus);
  assert.equal(dialog._sheet.querySelectorAll('.chips').length, 0);
  assert.equal(dialog._sheet.querySelectorAll('select').length, 0);
});
