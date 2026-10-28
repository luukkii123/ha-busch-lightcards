'use strict';
// #712: sofortige Rückmeldung beim Tippen und kein Neubau bei fremden Updates.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht, gruppe, mikro } = require('./attrappe.js');

const LAMPEN = ['light.decke_1', 'light.decke_2', 'light.steh'];
const alleAn = (an, opts) => Object.fromEntries([
  ['light.wohnzimmer', gruppe('light.wohnzimmer', ['light.decke', 'light.steh'], an)],
  ['light.decke', gruppe('light.decke', ['light.decke_1', 'light.decke_2'], an)],
  ...LAMPEN.map((id) => [id, licht(id, an, opts)]),
]);
const schalterAn = (karte) => karte._toggle.classList.contains('on');

function ziehen(umgebung, el, punkte) {
  const e = (type, x) => umgebung.neuesEreignis(type, { pointerId: 7, clientX: x, clientY: 50 });
  el.dispatchEvent(e('pointerdown', punkte[0]));
  for (const x of punkte.slice(1, -1)) el.dispatchEvent(e('pointermove', x));
  el.dispatchEvent(e('pointerup', punkte.at(-1)));
}

// ── optimistische Anzeige ──────────────────────────────────────────────────
test('Schalter zeigt den Zielzustand sofort, bevor HA antwortet', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  const karte = neueKarte(u, haus);
  assert.equal(schalterAn(karte), false);
  karte._toggle.click();
  assert.equal(haus.rufe.length, 1, 'genau ein callService');
  assert.equal(haus.rufe[0].service, 'turn_on');
  assert.equal(schalterAn(karte), true, 'Schalter steht sofort auf an');
  assert.equal(karte._toggle.getAttribute('aria-checked'), 'true');
  // Ein fremdes Update vor der Antwort darf den Schalter nicht zurückspringen lassen.
  karte.hass = haus.fremd();
  assert.equal(schalterAn(karte), true, 'bleibt an trotz fremdem Update');
});

test('ohne passenden Zustand gilt nach der Frist wieder der echte Zustand', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  const karte = neueKarte(u, haus);
  karte._toggle.click();
  assert.equal(schalterAn(karte), true);
  u.uhr.vor(3000);
  karte.hass = haus.fremd();
  assert.equal(schalterAn(karte), true, 'innerhalb der Frist noch optimistisch');
  u.uhr.vor(2000);
  assert.equal(schalterAn(karte), false, 'nach Ablauf zurück auf echt (ohne weiteres hass-Update)');
});

test('Fehler von callService setzt sofort auf den echten Zustand zurück', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  haus.antwort = () => Promise.reject(new Error('Gerät antwortet nicht'));
  const karte = neueKarte(u, haus);
  karte._toggle.click();
  assert.equal(schalterAn(karte), true);
  await mikro();
  assert.equal(schalterAn(karte), false, 'Fehler → echter Zustand');
});

test('passender Zustand beendet die Vorschau; spätere echte Änderungen gelten sofort', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  const karte = neueKarte(u, haus);
  karte._toggle.click();
  karte.hass = haus.setze(alleAn(true));
  assert.equal(schalterAn(karte), true);
  u.uhr.vor(500);
  karte.hass = haus.setze(alleAn(false)); // z. B. Wandschalter
  assert.equal(schalterAn(karte), false, 'echtes Aus wird nicht von der alten Vorschau überdeckt');
});

test('Regler: ein callService je Zug, Wert bleibt nach dem Loslassen stehen', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  assert.equal(karte._sliderLabel.textContent, '80 %');
  ziehen(u, karte._slider, [100, 90, 80, 70, 65, 60, 60]);
  assert.equal(haus.rufe.length, 1, 'nur beim Loslassen');
  assert.deepEqual(JSON.parse(JSON.stringify(haus.rufe[0].data)).brightness_pct, 30);
  karte.hass = haus.fremd();
  assert.equal(karte._sliderLabel.textContent, '30 %', 'kein Rücksprung auf 80 % bei fremdem Update');
  karte.hass = haus.setze(alleAn(true, { helligkeit: 77 }));
  assert.equal(karte._sliderLabel.textContent, '30 %', 'echter Wert 30 % kommt an');
});

// ── kein Neubau bei fremden Updates ─────────────────────────────────────────
test('Karte: fremdes Update baut kein neues Modell, eigenes (auch verschachteltes) schon', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const modell = karte._model;
  for (let i = 0; i < 5; i++) karte.hass = haus.fremd();
  assert.strictEqual(karte._model, modell, 'fremde Updates: kein Neubau');
  karte.hass = haus.setze({ 'light.decke_2': licht('light.decke_2', false) });
  assert.notStrictEqual(karte._model, modell, 'verschachteltes Mitglied geändert: Neubau');
  assert.match(karte._descText.textContent, /2/);
});

test('Karte: Sprachwechsel baut neu', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const vorher = karte._descText.textContent;
  haus.sprache = 'en';
  karte.hass = haus.hass();
  assert.notEqual(karte._descText.textContent, vorher);
});

test('Dialog: fremdes Update baut das Blatt nicht neu, eigenes schon', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  assert.ok(dialog, 'Dialog offen');
  const kopf = dialog._sheet.firstChild;
  for (let i = 0; i < 5; i++) karte.hass = haus.fremd();
  assert.strictEqual(dialog._sheet.firstChild, kopf, 'fremde Updates: kein Neubau');
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', false) });
  assert.notStrictEqual(dialog._sheet.firstChild, kopf, 'eigene Lampe geändert: Neubau');
});

test('Dialog: Lampen-Schalter zeigt sofort an, Karte zieht mit', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  const kachelSchalter = () => dialog._sheet.querySelectorAll('.tsw');
  assert.equal(kachelSchalter().length, 3);
  const steh = () => kachelSchalter().find((b) => b.getAttribute('aria-label') === 'light.steh');
  steh().click();
  assert.equal(haus.rufe.length, 1);
  assert.equal(haus.rufe[0].data.entity_id, 'light.steh');
  assert.ok(steh().classList.contains('on'), 'Kachelschalter sofort an');
  assert.equal(schalterAn(karte), true, 'Kartenschalter zieht sofort mit');
});

test('Dialog: Farbrad wird nur einmal berechnet', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  const erst = u.zaehler.createImageData;
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', false) });
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', true) });
  assert.ok(dialog._sheet.querySelectorAll('.wheelwrap').length + dialog._sheet.querySelectorAll('.tempbar').length >= 1, 'Wähler vorhanden');
  assert.equal(erst, 1, 'beim Öffnen einmal berechnet');
  assert.equal(u.zaehler.createImageData, 1, 'keine neue Pixelberechnung je Neubau');
});

test('Dialog: langsames Ziehen auf einer Kachel dimmt (kein Öffnen der Detailansicht)', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  const kachel = dialog._sheet.querySelectorAll('.tile')[0];
  const e = (type, y) => u.neuesEreignis(type, { pointerId: 3, clientX: 50, clientY: y });
  kachel.dispatchEvent(e('pointerdown', 20));
  for (let y = 22; y <= 70; y += 2) kachel.dispatchEvent(e('pointermove', y)); // 2 px je Ereignis
  kachel.dispatchEvent(e('pointerup', 70));
  assert.equal(dialog._detailEntity, null, 'Ziehen ist kein Tippen');
  assert.equal(haus.rufe.length, 1, 'ein callService beim Loslassen');
  assert.equal(haus.rufe[0].data.brightness_pct, 30);
});

test('clearOptimistic beendet Vorschauen wie der Fristablauf: Karte zeigt sofort den echten Zustand', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._toggle.click();
  assert.equal(schalterAn(karte), false, 'Vorschau aus');
  const n = u.registry.get('busch-light-card').__internals.clearOptimistic();
  assert.ok(n >= 1);
  assert.equal(schalterAn(karte), true, 'ohne weiteres hass-Update wieder echt');
});
