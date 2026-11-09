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
