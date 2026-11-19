'use strict';
// M27 (Buschcheck W3/F4, #1313): error, empty and offline of card and dialog are one
// BuschUI.stateBlock (icon, title, hint; role=alert for errors, role=status otherwise),
// and the card has a live region from its first render.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte } = require('./attrappe.js');

const klassen = (el) => String(el.className || '').split(/\s+/).filter(Boolean);
const bloecke = (root) => root.querySelectorAll('.busch-state');
const texte = (u) => u.registry.get('busch-light-card').__internals.TEXTE;
const block = (root, kind) => {
  const alle = bloecke(root);
  assert.equal(alle.length, 1, 'genau ein Zustandsblock');
  const b = alle[0];
  assert.equal(b.getAttribute('data-kind'), kind);
  assert.equal(b.getAttribute('role'), kind === 'error' ? 'alert' : 'status');
  assert.equal(b.getAttribute('aria-live'), kind === 'error' ? 'assertive' : 'polite');
  assert.ok(b.querySelector('.busch-state-icon'), 'Symbol');
  return { node: b, titel: b.querySelector('.busch-state-title').textContent,
           hinweis: b.querySelector('.busch-state-hint')?.textContent };
};
const unerreichbar = (haus) => haus.setze(Object.fromEntries(['light.decke_1', 'light.decke_2', 'light.steh']
  .map((id) => [id, { entity_id: id, state: 'unavailable', attributes: { friendly_name: id } }])));
const leer = { 'light.leer': { entity_id: 'light.leer', state: 'on', attributes: { entity_id: ['sensor.fremd_1'] } } };

test('M27 Karte: Konfigurationsfehler ist ein stateBlock error (role=alert), Titel und Satz aus dem Wörterbuch, kein eigener Kasten', () => {
  for (const sprache of ['de', 'en']) {
    const u = neueUmgebung({ sprache }), haus = neuesHaus({ sprache });
    const karte = u.document.createElement('busch-light-card');
    karte.setConfig({ type: 'custom:busch-light-card' });
    u.body.appendChild(karte);
    karte.hass = haus.hass();
    const t = texte(u)[sprache].texte;
    const b = block(karte.shadowRoot, 'error');
    assert.equal(b.titel, t.errorTitle, sprache + ': Titel');
    assert.equal(b.hinweis, t.fehlerKeineEntitaet, sprache + ': Satz');
    assert.equal(karte.shadowRoot.querySelector('.error'), null, 'kein .error-Kasten mehr');
    assert.ok(karte.shadowRoot.querySelector('ha-card').childNodes.includes(b.node), 'Block steht in ha-card');
  }
});

test('M27 Karte: leere Gruppe zeigt stateBlock empty statt Statuszeile, Texte de/en', () => {
  for (const sprache of ['de', 'en']) {
    const u = neueUmgebung({ sprache }), haus = neuesHaus({ sprache });
    haus.setze(leer);
    const karte = neueKarte(u, haus, { entity: 'light.leer' });
    const t = texte(u)[sprache].texte;
    const b = block(karte.shadowRoot, 'empty');
    assert.equal(b.titel, t.noEntities);
    assert.equal(b.hinweis, t.noEntitiesHint);
    assert.equal(karte._desc.style.display, 'none', 'Statuszeile weicht dem Block');
  }
});

test('M27 Karte: alle Lampen unerreichbar zeigt stateBlock offline, Texte de/en', () => {
  for (const sprache of ['de', 'en']) {
    const u = neueUmgebung({ sprache }), haus = neuesHaus({ sprache });
    const karte = neueKarte(u, haus);
    karte.hass = unerreichbar(haus);
    const t = texte(u)[sprache].texte;
    const b = block(karte.shadowRoot, 'offline');
    assert.equal(b.titel, t.allUnavailable);
    assert.equal(b.hinweis, t.allUnavailableHint);
    assert.equal(karte._desc.style.display, 'none');
  }
});

test('M27 Karte: eine Live-Region ab dem ersten Aufbau, derselbe Knoten über Leer → normal → offline', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const region = karte._state;
  assert.ok(region, 'Region existiert');
  assert.equal(region.getAttribute('role'), 'status');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.childNodes.length, 0, 'im Normalzustand leer');
  assert.ok(!klassen(region).includes('busch-state'), 'ohne Kasten');
  assert.notEqual(karte._desc.style.display, 'none', 'Statuszeile sichtbar');
  karte.hass = unerreichbar(haus);
  assert.equal(karte._state, region, 'derselbe Knoten');
  assert.equal(region.getAttribute('data-kind'), 'offline');
  karte.hass = haus.setze({ 'light.steh': { entity_id: 'light.steh', state: 'on', attributes: { brightness: 100 } } });
  assert.equal(karte._state, region);
  assert.equal(region.childNodes.length, 0, 'wieder leer');
  assert.equal(region.getAttribute('role'), 'status');
  assert.notEqual(karte._desc.style.display, 'none');
});

test('M27 Dialog: unerreichbare Gruppe und unerreichbare Lampe zeigen stateBlock offline; leere Gruppe stateBlock empty', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const dialog = karte._dialog;
  const t = texte(u).de.texte;
  assert.equal(bloecke(dialog._sheet).length, 0, 'normal: kein Block');
  dialog.hass = unerreichbar(haus);
  let b = block(dialog._sheet, 'offline');
  assert.equal(b.titel, t.allUnavailable);
  assert.equal(b.hinweis, t.allUnavailableHint);
  dialog._detailEntity = 'light.steh'; dialog._renderSheet();
  b = block(dialog._sheet, 'offline');
  assert.equal(b.titel, t.lightUnreachable);
  assert.equal(b.hinweis, t.lightUnreachableHint);
  assert.equal(dialog._sheet.querySelector('.empty'), null, 'kein .empty-Satz mehr');
  dialog._detailEntity = null;
  dialog.hass = haus.setze({ 'light.wohnzimmer': { entity_id: 'light.wohnzimmer', state: 'on', attributes: { entity_id: ['sensor.fremd_1'] } } });
  b = block(dialog._sheet, 'empty');
  assert.equal(b.titel, t.noEntities);
  assert.equal(b.hinweis, t.noEntitiesHint);
});

test('M27 Wörterbuch: neue Zustandstexte in beiden Sprachen, nicht leer und verschieden', () => {
  const u = neueUmgebung();
  const T = texte(u);
  for (const key of ['errorTitle', 'noEntitiesHint', 'allUnavailableHint', 'lightUnreachable', 'lightUnreachableHint']) {
    assert.ok(T.de.texte[key] && T.en.texte[key], key + ' de/en');
    assert.notEqual(T.de.texte[key], T.en.texte[key], key + ' übersetzt');
  }
});
