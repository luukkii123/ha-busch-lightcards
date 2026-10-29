'use strict';
// #715 Kleinkram: Vorlagen, description: false, icon_size, slider: mushroom,
// theme, api_id, is_visible — jeweils mit camelCase-Alias wie bei Hue.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht, mikro } = require('./attrappe.js');

const intern = (u) => u.registry.get('busch-light-card').__internals;

// ── Vorlagen ──────────────────────────────────────────────────────────────
test('title/description: {{ entity }} und {{ entity.attribut }}, %s = Standardbeschreibung', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, {
    title: 'Steh: {{ light.steh }}',
    description: '%s · {{ light.steh.brightness }} · {{light.fehlt}}'
  });
  assert.equal(karte._title.textContent, 'Steh: on');
  assert.equal(karte._descText.textContent, 'Alle an (3) · 204 · ‹light.fehlt fehlt›');
  // Eine Entität, die nur in der Vorlage steht, wird beobachtet
  const k2 = neueKarte(u, haus, { title: 'Sensor {{ sensor.fremd_3 }}' });
  assert.equal(k2._title.textContent, 'Sensor 3');
  k2.hass = haus.setze({ 'sensor.fremd_3': { entity_id: 'sensor.fremd_3', state: 'neu', attributes: {} } });
  assert.equal(k2._title.textContent, 'Sensor neu', 'Vorlagen-Entität löst Neuzeichnen aus');
  const modell = k2._model;
  k2.hass = haus.setze({ 'sensor.fremd_4': { entity_id: 'sensor.fremd_4', state: 'x', attributes: {} } });
  assert.strictEqual(k2._model, modell, 'andere fremde Entität: weiterhin kein Neubau');
});

test('Vorlagen nutzen HAs Formatierer, wenn vorhanden', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { title: '{{ light.steh }} / {{ light.steh.brightness }}' });
  const basis = haus.hass;
  haus.hass = () => Object.assign(basis(), {
    formatEntityState: (s) => 'AN(' + s.entity_id + ')',
    formatEntityAttributeValue: (s, a) => a + '=' + s.attributes[a],
  });
  karte.hass = haus.setze({ 'light.steh': licht('light.steh', true) });
  assert.equal(karte._title.textContent, 'AN(light.steh) / brightness=204');
});

test('Vorlagen schleusen nie HTML ein und werten nichts aus', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const boese = '<img src=x onerror=alert(1)>{{ constructor.constructor }}{{ __proto__.x }}{{ light.steh.__proto__ }}';
  const karte = neueKarte(u, haus, { title: boese, description: '<b>fett</b>' });
  assert.ok(karte._title.textContent.startsWith('<img src=x onerror=alert(1)>'), 'als Text: ' + karte._title.textContent);
  assert.equal(karte._title.childNodes.length, 0, 'kein Kindelement');
  assert.equal(karte._descText.textContent, '<b>fett</b>');
  assert.equal(karte.shadowRoot.querySelectorAll('img').length + karte.shadowRoot.querySelectorAll('b').length, 0);
  assert.ok(!/function|\[object/.test(karte._title.textContent), 'nichts ausgewertet: ' + karte._title.textContent);
});

test('description: false blendet die Zeile aus, der Dialog zeigt weiter den Zustand', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { description: false });
  assert.equal(karte._desc.style.display, 'none');
  karte._openDialog();
  assert.match(karte._dialog._sheet.querySelector('.sub').textContent, /Alle an/);
  // Ein Ausfall-Abzeichen bleibt sichtbar, nur der Text fällt weg.
  const k2 = neueKarte(u, haus, { description: false });
  k2.hass = haus.setze({ 'light.steh': { entity_id: 'light.steh', state: 'unavailable', attributes: {} } });
  assert.notEqual(k2._desc.style.display, 'none');
  assert.equal(k2._descText.style.display, 'none');
});

// ── icon_size ─────────────────────────────────────────────────────────────
test('icon_size: original/big/small/Zahl (wie Hue, original = bisherige 24 px)', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const px = (cfg) => neueKarte(u, haus, cfg).style.getPropertyValue('--blc-icon-size');
  assert.equal(px({}), '24px');
  assert.equal(px({ icon_size: 'original' }), '24px');
  assert.equal(px({ icon_size: 'big' }), '34px');
  assert.equal(px({ icon_size: 'small' }), '17px');
  assert.equal(px({ iconSize: 2 }), '34px', 'Zahl wie bei Hue: 2 = big');
  assert.equal(px({ icon_size: '1.7' }), '29px', 'Zahl als Text aus dem Editor');
  assert.equal(px({ icon_size: 99 }), '68px', 'gekappt auf 4');
  const k = neueKarte(u, haus, { icon_size: 'riesig' });
  assert.ok(k._error, 'unbekannter Wert ist ein Konfigurationsfehler');
});

// ── slider ────────────────────────────────────────────────────────────────
test('slider: default/mushroom/none; Altkonfigurationen true/false bleiben gültig', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const sl = (cfg) => neueKarte(u, haus, cfg)._slider;
  assert.notEqual(sl({}).style.display, 'none');
  assert.notEqual(sl({ slider: true }).style.display, 'none');
  assert.equal(sl({ slider: false }).style.display, 'none');
  assert.equal(sl({ slider: 'none' }).style.display, 'none');
  assert.ok(!sl({ slider: 'default' }).classList.contains('mushroom'));
  const m = sl({ slider: 'mushroom' });
  assert.ok(m.classList.contains('mushroom'));
  assert.notEqual(m.style.display, 'none');
  assert.equal(m.getAttribute('role'), 'slider');
  assert.ok(neueKarte(u, haus, { slider: 'wackel' })._error, 'unbekannter Regler ist ein Fehler');
});

test('Mushroom-Regler bewegt nur transform (translateX)', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { slider: 'mushroom' });
  const fill = karte._slider.querySelector('.mfill');
  assert.ok(fill, 'Mushroom-Spur');
  assert.match(fill.style.transform, /^translateX\(-20%\)$/);
});

// ── theme ─────────────────────────────────────────────────────────────────
test('theme: setzt die Variablen eines HA-Themes auf die Karte, Modi hell/dunkel', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const themes = { darkMode: false, themes: {
    rot: { 'primary-color': '#ff0000', modes: { light: { 'card-background-color': '#fff' }, dark: { 'card-background-color': '#000' } } } } };
  const basis = haus.hass;
  haus.hass = () => Object.assign(basis(), { themes });
  const karte = neueKarte(u, haus, { theme: 'rot' });
  assert.equal(karte.style.getPropertyValue('--primary-color'), '#ff0000');
  assert.equal(karte.style.getPropertyValue('--card-background-color'), '#fff');
  themes.darkMode = true;
  haus.hass = () => Object.assign(basis(), { themes: Object.assign({}, themes) });
  karte.hass = haus.hass();
  assert.equal(karte.style.getPropertyValue('--card-background-color'), '#000', 'Dunkelmodus');
  karte.setConfig({ type: 'custom:busch-light-card', entity: 'light.wohnzimmer' });
  karte.hass = haus.hass();
  assert.equal(karte.style.getPropertyValue('--primary-color'), '', 'ohne theme wieder entfernt');
  const leer = neueKarte(u, haus, { theme: 'gibtsnicht' });
  assert.equal(leer.style.getPropertyValue('--primary-color'), '');
});

// ── api_id ────────────────────────────────────────────────────────────────
test('api_id: window.busch_light_card.<id>_openHueScreen und Hash-Aufruf öffnen den Dialog', async () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const win = u.kontext.window;
  const karte = neueKarte(u, haus, { api_id: 'wohnen' });
  const api = win.busch_light_card;
  assert.ok(api, 'globales API-Objekt');
  assert.equal(typeof api.wohnen_openHueScreen, 'function');
  assert.equal(typeof api.wohnen_openDialog, 'function');
  assert.match(api.version, /^\d+\.\d+\.\d+$/);
  api.wohnen_openHueScreen();
  assert.ok(karte._dialog, 'Dialog offen');
  karte._dialog.remove();
  karte._dialog = null;
  // Hash wie bei Hue: #busch_light_card:<apiId>_openHueScreen
  u.kontext.location.hash = '#busch_light_card:wohnen_openHueScreen';
  (win.listeners.hashchange || []).forEach((fn) => fn({}));
  u.uhr.vor(20);
  assert.ok(karte._dialog, 'Hash öffnet den Dialog');
  // camelCase-Alias
  const k2 = neueKarte(u, haus, { apiId: 'kueche' });
  assert.equal(typeof api.kueche_openHueScreen, 'function');
  k2.remove();
  assert.equal(api.kueche_openHueScreen, undefined, 'beim Entfernen abgemeldet');
});

test('api_id: sicheres Parsing, kein Eval, keine Prototyp-Tricks', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const win = u.kontext.window;
  neueKarte(u, haus, { api_id: 'ok' });
  for (const hash of ['#busch_light_card:__proto___openHueScreen', '#busch_light_card:constructor_openHueScreen',
    '#busch_light_card:ok_alert(1)', '#busch_light_card:ok_openHueScreen;alert(1)', '#hue_card:ok_openHueScreen']) {
    u.kontext.location.hash = hash;
    assert.doesNotThrow(() => (win.listeners.hashchange || []).forEach((fn) => fn({})), hash);
    u.uhr.vor(20);
  }
  assert.ok(neueKarte(u, haus, { api_id: 'a b<script>' })._error, 'unsichere ID ist ein Konfigurationsfehler');
  assert.ok(neueKarte(u, haus, { api_id: '__proto__' })._error, 'reservierter Name');
  assert.equal(Object.getPrototypeOf(win.busch_light_card), null, 'API-Objekt ohne Prototyp');
});

// ── is_visible ────────────────────────────────────────────────────────────
test('is_visible: false versteckt die Karte, API und Dialog bleiben', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { is_visible: false, api_id: 'versteckt' });
  assert.equal(karte.style.display, 'none');
  assert.equal(karte.getCardSize(), 0);
  u.kontext.window.busch_light_card.versteckt_openHueScreen();
  assert.ok(karte._dialog);
  const k2 = neueKarte(u, haus, { isVisible: false });
  assert.equal(k2.style.display, 'none', 'camelCase-Alias');
  const k3 = neueKarte(u, haus, {});
  assert.notEqual(k3.style.display, 'none');
});

// ── Editor-Schema ─────────────────────────────────────────────────────────
test('Editor: jede neue Option hat ein Feld mit Label und Helper in DE und EN', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const namen = [];
  const lauf = (l) => l.forEach((x) => { if (x.schema) lauf(x.schema); if (x.name) namen.push(x.name); });
  lauf(I.SCHEMA);
  for (const n of ['live_update', 'icon_size', 'slider', 'theme', 'api_id', 'is_visible', 'show_description']) {
    assert.ok(namen.includes(n), 'Schemafeld ' + n);
    for (const s of ['de', 'en']) {
      assert.ok(I.TEXTE[s].labels[n], s + ' Label ' + n);
      assert.match(I.TEXTE[s].helpers[n], /\.$/, s + ' Helper ' + n);
    }
  }
  const sl = JSON.stringify(I.SCHEMA);
  assert.match(sl, /"name":"slider","selector":\{"select"/, 'slider ist eine Auswahl');
  assert.match(sl, /"name":"theme","selector":\{"theme"/, 'theme-Selector');
});

test('Editor: camelCase-Aliase werden gefaltet, Vorgaben nicht geschrieben, description:false über Schalter', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const I = intern(u);
  assert.deepEqual(JSON.parse(JSON.stringify(I.toSnakeConfig({ liveUpdate: false, iconSize: 'big', apiId: 'x', isVisible: false }))),
    { live_update: false, icon_size: 'big', api_id: 'x', is_visible: false });
  const ed = u.document.createElement('busch-light-card-editor');
  const raus = [];
  ed.addEventListener('config-changed', (e) => raus.push(e.detail.config));
  ed.hass = haus.hass();
  ed._config = { type: 'custom:busch-light-card', entity: 'light.wohnzimmer' };
  ed._emit({ show_description: false });
  assert.deepEqual(JSON.parse(JSON.stringify(raus.at(-1))), { type: 'custom:busch-light-card', entity: 'light.wohnzimmer', description: false });
  ed._emit({ show_description: true });
  assert.deepEqual(JSON.parse(JSON.stringify(raus.at(-1))), { type: 'custom:busch-light-card', entity: 'light.wohnzimmer' });
  ed._emit({ live_update: true, slider: 'default', icon_size: 'original', is_visible: true, theme: '', api_id: '' });
  assert.deepEqual(JSON.parse(JSON.stringify(raus.at(-1))), { type: 'custom:busch-light-card', entity: 'light.wohnzimmer' }, 'Vorgaben fallen weg');
  ed._config = { type: 'custom:busch-light-card', entity: 'light.wohnzimmer', slider: false, description: false };
  const d = ed._data(['slider', 'show_description', 'description', 'live_update', 'icon_size', 'is_visible']);
  assert.deepEqual(JSON.parse(JSON.stringify(d)), { slider: 'none', show_description: false, description: '', live_update: true, icon_size: 'original', is_visible: true });
  ed._emit({ slider: 'mushroom' });
  assert.equal(raus.at(-1).slider, 'mushroom');
});
