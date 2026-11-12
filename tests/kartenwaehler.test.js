'use strict';

// #1011 Kartenwähler: keine Live-Vorschau, ein Satz Beschreibung, billige Vorgabe.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, licht, gruppe } = require('./attrappe.js');

test('Kartenwähler-Eintrag: preview false, Name „Busch …“ und ein Satz Beschreibung (de und en)', () => {
    for (const sprache of ['de-DE', 'en-US']) {
        const { kontext } = neueUmgebung({ sprache });
        const liste = kontext.window.customCards;
        assert.strictEqual(liste.length, 1);
        for (const e of liste) {
            assert.strictEqual(e.preview, false);
            assert.match(e.name, /^Busch \S/);
            assert.match(e.description, /^[A-ZÄÖÜ].*[^.]\.$/, e.description);
            assert.ok(!/[.!?] /.test(e.description), e.description);
        }
    }
});

test('getStubConfig: ein Durchlauf über hass.states je Wählerbesuch, gleiche Vorgabe wie bisher', () => {
    const { registry } = neueUmgebung();
    const Karte = registry.get('busch-light-card');
    let durchlaeufe = 0;
    const states = { 'sensor.x': { entity_id: 'sensor.x', state: '1', attributes: {} }, 'light.a': licht('light.a', true), 'light.b': licht('light.b', false),
        'light.wohnzimmer': gruppe('light.wohnzimmer', ['light.a', 'light.b'], true) };
    const netz = () => { throw new Error('Netz im Kartenwähler'); };
    const hass = { states: new Proxy(states, { ownKeys(t) { durchlaeufe++; return Reflect.ownKeys(t); } }), entities: {}, callWS: netz, callService: netz };
    for (let i = 0; i < 3; i++) assert.strictEqual(Karte.getStubConfig(hass).entity, 'light.wohnzimmer');
    assert.ok(durchlaeufe <= 1, `hass.states ${durchlaeufe}× durchlaufen`);
    // Mit Vorauswahl („Nach Entität") gilt weiter die übergebene Liste.
    assert.strictEqual(Karte.getStubConfig(hass, ['light.b']).entity, 'light.b');
    assert.strictEqual(Karte.getStubConfig({ states: {} }).entity, '');
});
