'use strict';
// #715: Live-Update beim Ziehen wie die Hue-Like Light Card (Gh61).
// Ablauf nach deren LiveUpdateSession, hier nachgebaut, nicht kopiert:
// höchstens ein Aufruf unterwegs, der nächste erst nach der Bestätigung von HA
// und frühestens nach dem Mindestabstand (Lampe 200 ms, Gruppe 1000 ms); der
// erste Wert einer Bewegung nach dem halben Abstand; beim Loslassen genau der
// Endwert; die Anzeige hält den eigenen Wert (1,5 s nach der letzten Bestätigung).
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht, gruppe, mikro } = require('./attrappe.js');

const LAMPEN = ['light.decke_1', 'light.decke_2', 'light.steh'];
const alleAn = (an, opts) => Object.fromEntries([
  ['light.wohnzimmer', gruppe('light.wohnzimmer', ['light.decke', 'light.steh'], an)],
  ['light.decke', gruppe('light.decke', ['light.decke_1', 'light.decke_2'], an)],
  ...LAMPEN.map((id) => [id, licht(id, an, opts)]),
]);
const helligkeit = (ruf) => ruf.data.brightness_pct;

/**
 * Zieht in Schritten von `dt` ms von x[0] nach x.at(-1) (Breite 200 px, also
 * x/2 = Prozent). Zwischen den Schritten laufen Uhr und Mikrotasks, damit
 * Bestätigungen (Promise.then) wie im Browser ankommen.
 */
async function ziehenLive(u, el, xs, { dt = 16, los = true, pointerType } = {}) {
  const e = (type, x) => u.neuesEreignis(type, { pointerId: 9, clientX: x, clientY: 50, pointerType });
  el.dispatchEvent(e('pointerdown', xs[0]));
  await mikro();
  for (const x of xs.slice(1)) {
    u.uhr.vor(dt);
    el.dispatchEvent(e('pointermove', x));
    await mikro();
  }
  if (los) el.dispatchEvent(e('pointerup', xs.at(-1)));
  await mikro();
}
/** Gleichmäßige Strecke von `von` nach `bis` px in `n` Schritten. */
const strecke = (von, bis, n) => Array.from({ length: n + 1 }, (_, i) => Math.round(von + ((bis - von) * i) / n));
async function laufen(u, ms) { for (let t = 0; t < ms; t += 50) { u.uhr.vor(50); await mikro(); } }

// ── Karte ─────────────────────────────────────────────────────────────────
test('Einzellampe: beim Ziehen höchstens 5 Aufrufe/s, erster nach 100 ms, Endwert beim Loslassen', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  // 1 s ziehen: 62 Bewegungen à 16 ms von 90 % auf 30 %
  await ziehenLive(u, karte._slider, strecke(180, 60, 62), { los: false });
  const waehrend = haus.rufe.slice();
  assert.ok(waehrend.length >= 4 && waehrend.length <= 5, 'Aufrufe während 1 s: ' + waehrend.length);
  assert.ok(waehrend.every((r) => r.service === 'turn_on' && r.data.entity_id.length === 1));
  assert.equal(waehrend[0].data.transition, undefined, 'Lampe: kein Übergang (200 ms ≤ 400 ms)');
  karte._slider.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 60, clientY: 50 }));
  await laufen(u, 400);
  assert.equal(helligkeit(haus.rufe.at(-1)), 30, 'letzter Aufruf trägt genau den Endwert');
  assert.equal(haus.rufe.at(-1).data.transition, undefined, 'Endwert ohne Live-Übergang');
  await laufen(u, 2000);
  assert.equal(haus.rufe.filter((r) => helligkeit(r) === 30).length, 1, 'Endwert genau einmal');
});

test('Gruppe: höchstens 1 Aufruf/s, mit 1 s Übergang, wenn alle Lampen ihn können', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  for (const id of LAMPEN) haus.states[id].attributes.supported_features = 32;
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus);
  await ziehenLive(u, karte._slider, strecke(180, 40, 125), { los: false }); // 2 s
  const waehrend = haus.rufe.slice();
  assert.ok(waehrend.length >= 1 && waehrend.length <= 2, 'Aufrufe während 2 s: ' + waehrend.length);
  assert.deepEqual(Array.from(waehrend[0].data.entity_id).sort(), LAMPEN.slice().sort(), 'an die Mitglieder');
  assert.equal(waehrend[0].data.transition, 1, 'Übergang = Abstand (1 s)');
  karte._slider.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 40, clientY: 50 }));
  await laufen(u, 1200);
  assert.equal(helligkeit(haus.rufe.at(-1)), 20);
});

test('wartet auf die Bestätigung von HA: ohne Antwort kein zweiter Aufruf, Endwert nach Frist', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true }); // antwort: offenes Versprechen
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  await ziehenLive(u, karte._slider, strecke(180, 60, 180), { los: false }); // ~3 s
  assert.equal(haus.rufe.length, 1, 'ein Aufruf unterwegs, keiner hinterher');
  karte._slider.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 60, clientY: 50 }));
  await laufen(u, 1000);
  assert.equal(haus.rufe.length, 1, 'Endwert wartet weiter auf die Bestätigung');
  await laufen(u, 5000);
  assert.equal(haus.rufe.length, 2, 'nach der Bestätigungsfrist (5 s) geht der Endwert raus');
  assert.equal(helligkeit(haus.rufe[1]), 30);
});

test('live_update: false sendet nur beim Loslassen (wie bisher)', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus, { entity: 'light.steh', live_update: false });
  await ziehenLive(u, karte._slider, strecke(180, 60, 62));
  assert.equal(haus.rufe.length, 1);
  assert.equal(helligkeit(haus.rufe[0]), 30);
  const k2 = neueKarte(u, haus, { entity: 'light.steh', liveUpdate: false });
  assert.equal(k2._opts.liveUpdate, false, 'camelCase-Alias liveUpdate');
});

test('kein Rücksprung: HA-Zustände während und nach dem Ziehen lassen den Regler stehen', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  await ziehenLive(u, karte._slider, strecke(180, 100, 40), { los: false });
  // HA meldet einen alten Zwischenwert (70 %) mitten im Ziehen
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', true, { helligkeit: 179 }) });
  assert.equal(karte._sliderLabel.textContent, '50 %', 'Regler folgt dem Finger, nicht HA');
  karte._slider.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 100, clientY: 50 }));
  await mikro();
  // Nach dem Loslassen: noch ein alter Zwischenstand von HA
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', true, { helligkeit: 160 }) });
  assert.equal(karte._sliderLabel.textContent, '50 %', 'gehaltener Endwert, kein Zurückspringen');
  await laufen(u, 300);
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', true, { helligkeit: 128 }) });
  assert.equal(karte._sliderLabel.textContent, '50 %', 'Endwert kommt an');
});

test('Tastatur läuft über dieselbe Sitzung: schnelle Tasten bündeln sich', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  for (let i = 0; i < 5; i++) karte._slider.dispatchEvent(u.neuesEreignis('keydown', { key: 'ArrowRight' }));
  assert.equal(haus.rufe.length, 1, 'erster Wert sofort, die übrigen warten auf die Bestätigung');
  assert.equal(karte._sliderLabel.textContent, '100 %');
  await laufen(u, 5200);
  assert.equal(helligkeit(haus.rufe.at(-1)), 100, 'danach der letzte Wert');
});

// ── Touch: kein Scroll-Klau ──────────────────────────────────────────────
test('Touch: senkrechte Wischbewegung über dem Regler ist Scrollen, kein Dimmen', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  const e = (type, x, y) => u.neuesEreignis(type, { pointerId: 4, clientX: x, clientY: y, pointerType: 'touch' });
  const el = karte._slider;
  el.dispatchEvent(e('pointerdown', 100, 50));
  u.uhr.vor(16); el.dispatchEvent(e('pointermove', 102, 62));
  u.uhr.vor(16); el.dispatchEvent(e('pointermove', 103, 80));
  el.dispatchEvent(e('pointercancel', 0, 0)); // Browser übernimmt das Scrollen
  await laufen(u, 600);
  assert.equal(haus.rufe.length, 0, 'kein Aufruf');
  assert.equal(karte._sliderLabel.textContent, '80 %', 'Anzeige unverändert');
  assert.match(u.registry.get('busch-light-card').__internals.CARD_STYLES, /\.slider \{[^}]*touch-action: pan-y/, 'touch-action: pan-y');
});

test('Touch: waagerechtes Ziehen dimmt, Tippen setzt den Wert', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus, { entity: 'light.steh' });
  await ziehenLive(u, karte._slider, strecke(160, 80, 40), { pointerType: 'touch' });
  await laufen(u, 400);
  assert.equal(helligkeit(haus.rufe.at(-1)), 40);
  const vorher = haus.rufe.length;
  const e = (type, x) => u.neuesEreignis(type, { pointerId: 5, clientX: x, clientY: 50, pointerType: 'touch' });
  karte._slider.dispatchEvent(e('pointerdown', 120));
  karte._slider.dispatchEvent(e('pointerup', 121));
  await laufen(u, 400);
  assert.equal(haus.rufe.length, vorher + 1);
  assert.equal(helligkeit(haus.rufe.at(-1)), 61, 'Tippen setzt die Stelle');
});

// ── Dialog ────────────────────────────────────────────────────────────────
test('Dialog: Gruppenregler sendet live (Gruppe 1/s), Rebuild erst nach dem Loslassen', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const d = karte._dialog;
  const regler = d._sheet.querySelector('.dslider');
  const kopf = d._sheet.firstChild;
  await ziehenLive(u, regler, strecke(180, 40, 125), { los: false });
  assert.ok(haus.rufe.length >= 1 && haus.rufe.length <= 2, 'Dialog-Gruppe: ' + haus.rufe.length);
  assert.strictEqual(d._sheet.firstChild, kopf, 'kein Neubau unter dem Finger');
  regler.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 40, clientY: 50 }));
  await laufen(u, 1200);
  assert.equal(helligkeit(haus.rufe.at(-1)), 20);
  const neu = d._sheet.querySelector('.dslider').querySelector('.label');
  assert.equal(neu.textContent, '20 %', 'nach dem Neubau zeigt der Regler den gehaltenen Endwert');
});

test('Dialog: Einzellampe (Detail) live mit 5/s, Farbtemperatur ebenso', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const d = karte._dialog;
  d._detailEntity = 'light.steh'; d._renderSheet();
  await ziehenLive(u, d._sheet.querySelector('.dslider'), strecke(180, 60, 62), { los: false });
  const n = haus.rufe.length;
  assert.ok(n >= 4 && n <= 5, 'Detail-Regler: ' + n);
  assert.deepEqual(Array.from(haus.rufe[0].data.entity_id ? [].concat(haus.rufe[0].data.entity_id) : []), ['light.steh']);
  d._sheet.querySelector('.dslider').dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 60, clientY: 50 }));
  await laufen(u, 2000);
  d._tab = 'white'; d._renderSheet();
  const bar = d._sheet.querySelector('.tempbar');
  assert.ok(bar, 'Farbtemperaturleiste');
  const vorher = haus.rufe.length;
  await ziehenLive(u, bar, strecke(20, 180, 62), { los: false });
  const k = haus.rufe.slice(vorher);
  assert.ok(k.length >= 4 && k.length <= 5, 'Farbtemperatur live: ' + k.length);
  assert.ok(k.every((r) => typeof r.data.color_temp_kelvin === 'number'));
  bar.dispatchEvent(u.neuesEreignis('pointerup', { pointerId: 9, clientX: 180, clientY: 50 }));
  await laufen(u, 400);
  const ende = haus.rufe.at(-1).data.color_temp_kelvin;
  assert.ok(ende > 6000, 'Endwert am rechten Rand: ' + ende);
});

test('Dialog: Kachel-Ziehen dimmt die Lampe live', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  haus.antwort = () => Promise.resolve();
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const d = karte._dialog;
  const kachel = d._sheet.querySelectorAll('.tile')[0];
  const e = (type, y) => u.neuesEreignis(type, { pointerId: 3, clientX: 50, clientY: y });
  kachel.dispatchEvent(e('pointerdown', 20));
  for (let y = 22; y <= 80; y += 1) { u.uhr.vor(16); kachel.dispatchEvent(e('pointermove', y)); await mikro(); }
  assert.ok(haus.rufe.length >= 3, 'live während des Ziehens: ' + haus.rufe.length);
  kachel.dispatchEvent(e('pointerup', 80));
  await laufen(u, 400);
  assert.equal(helligkeit(haus.rufe.at(-1)), 20);
  assert.equal(d._detailEntity, null);
});
