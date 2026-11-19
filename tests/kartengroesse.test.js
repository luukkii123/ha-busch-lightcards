'use strict';
// M68 (Buschcheck P22): getCardSize forces no layout. It estimates from the
// configuration and what the last render showed, and takes the height a
// ResizeObserver delivered once there is one. Masonry still gets 50-px units.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht } = require('./attrappe.js');

const LAYOUT_LESER = ['offsetHeight', 'offsetWidth', 'offsetTop', 'offsetLeft', 'scrollHeight', 'scrollWidth'];

/** Counts every layout-forcing read on every element of the sandbox. */
function zaehleLayout(u) {
  const zaehler = { n: 0, wer: [] };
  const proto = u.kontext.HTMLElement.prototype;
  const merke = (name) => { zaehler.n++; zaehler.wer.push(name); };
  for (const name of ['getBoundingClientRect', 'getClientRects']) {
    const alt = proto[name];
    proto[name] = function (...a) { merke(name); return alt.apply(this, a); };
  }
  for (const name of LAYOUT_LESER) {
    Object.defineProperty(proto, name, { configurable: true, get() { merke(name); return 0; } });
  }
  u.kontext.getComputedStyle = () => { merke('getComputedStyle'); return {}; };
  u.kontext.window.getComputedStyle = u.kontext.getComputedStyle;
  return zaehler;
}

/** A ResizeObserver stand-in: remembers the callback and what it watches. */
function neuerBeobachter(u) {
  const alle = [];
  u.kontext.ResizeObserver = class {
    constructor(fn) { this.fn = fn; this.ziele = new Set(); this.aus = false; alle.push(this); }
    observe(el) { this.ziele.add(el); }
    unobserve(el) { this.ziele.delete(el); }
    disconnect() { this.ziele.clear(); this.aus = true; }
    melde(el, hoehe) { this.fn([{ target: el, borderBoxSize: [{ blockSize: hoehe, inlineSize: 400 }], contentRect: { height: hoehe, width: 400 } }], this); }
  };
  return alle;
}

test('M68 getCardSize liest kein Layout (zählende Attrappe), weder vor noch nach der Messung', () => {
  const u = neueUmgebung();
  const beobachter = neuerBeobachter(u);
  const karte = neueKarte(u, neuesHaus({ an: true }));
  const zaehler = zaehleLayout(u);
  karte.getCardSize();
  assert.equal(zaehler.n, 0, 'Schätzung: ' + zaehler.wer.join(', '));
  beobachter[0].melde(karte, 230);
  karte.getCardSize();
  assert.equal(zaehler.n, 0, 'gemessen: ' + zaehler.wer.join(', '));
});

test('M68 Schätzung aus der Konfiguration trifft die gemessenen Masonry-Einheiten', () => {
  // Measured in the browser render (device scale 2, halved): with slider
  // 156-158 px -> 4, without status line 136 px -> 3 (baseline hue-0.10.0).
  const u = neueUmgebung();
  assert.equal(neueKarte(u, neuesHaus({ an: true })).getCardSize(), 4, 'Status + Regler');
  assert.equal(neueKarte(u, neuesHaus({ an: false })).getCardSize(), 4, 'aus: Regler bleibt (gesperrt)');
  assert.equal(neueKarte(u, neuesHaus({ an: true }), { description: false }).getCardSize(), 3, 'ohne Statuszeile');
  assert.equal(neueKarte(u, neuesHaus({ an: true }), { slider: 'none' }).getCardSize(), 2, 'ohne Regler');
  assert.equal(neueKarte(u, neuesHaus({ an: true }), { slider: 'none', description: false }).getCardSize(), 2, 'nur Kopf');
  // A single light without brightness support has no slider either.
  const haus = neuesHaus({ an: true });
  haus.states = Object.assign({}, haus.states, {
    'light.schalter': Object.assign(licht('light.schalter', true), { attributes: { friendly_name: 'Schalter', supported_color_modes: ['onoff'], color_mode: 'onoff' } }),
  });
  assert.equal(neueKarte(u, haus, { entity: 'light.schalter' }).getCardSize(), 2, 'onoff: kein Regler');
  assert.equal(neueKarte(u, neuesHaus({ an: true }), { is_visible: false }).getCardSize(), 0, 'unsichtbar');
});

test('M68 ResizeObserver-Wert wird gemerkt, setConfig misst neu, Abhängen trennt', () => {
  const u = neueUmgebung();
  const beobachter = neuerBeobachter(u);
  const karte = neueKarte(u, neuesHaus({ an: true }));
  assert.equal(beobachter.length, 1, 'ein Beobachter je Karte');
  const ro = beobachter[0];
  assert.ok(ro.ziele.has(karte), 'beobachtet die Karte selbst');
  ro.melde(karte, 260);
  assert.equal(karte.getCardSize(), 6, '260 px = 6 Einheiten');
  ro.melde(karte, 0); // hidden by a conditional card: no height to keep
  assert.equal(karte.getCardSize(), 4, '0 px zählt nicht, zurück zur Schätzung');
  ro.melde(karte, 120);
  assert.equal(karte.getCardSize(), 3);
  karte.setConfig({ type: 'custom:busch-light-card', entity: 'light.wohnzimmer', slider: 'none' });
  assert.equal(karte.getCardSize(), 2, 'neue Konfiguration: Schätzung bis zur nächsten Meldung');
  assert.ok(ro.ziele.has(karte), 'nach setConfig wieder beobachtet (erste Meldung kommt neu)');
  karte.remove();
  assert.equal(ro.ziele.size, 0, 'abgehängt: nichts mehr beobachtet');
  u.body.appendChild(karte);
  assert.ok(ro.ziele.has(karte), 'wieder eingehängt: beobachtet');
});

test('M68 ohne ResizeObserver bleibt es bei der Schätzung', () => {
  const u = neueUmgebung();
  assert.equal(typeof u.kontext.ResizeObserver, 'undefined');
  const karte = neueKarte(u, neuesHaus({ an: true }));
  assert.equal(karte.getCardSize(), 4);
});
