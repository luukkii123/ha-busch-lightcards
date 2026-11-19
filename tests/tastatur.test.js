'use strict';
// M57 (Buschcheck F6): Überschrift nicht im Button, höchstens zwei Tab-Stopps
// im Kartenkopf, aria-valuetext am Regler; Tipp-/Halte-Logik unverändert.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte } = require('./attrappe.js');

const ereignis = (u, type, init) => u.neuesEreignis(type, init);
const sichtbar = (el) => { for (let w = el; w; w = w.parentNode) if (w.style && w.style.display === 'none') return false; return true; };
/** Tab-Stopps wie im Browser: Knöpfe ohne tabindex=-1 und alles mit tabindex >= 0. */
function tabStopps(karte) {
  return karte.shadowRoot.all().slice(1).filter((el) => {
    if (!sichtbar(el) || el.disabled) return false;
    // Die Attrappe kennt den Vorgabewert 0 eines <button> nicht; die Karte setzt dort nie -1.
    if (el.tagName === 'BUTTON') return true;
    return el.tabIndex >= 0;
  });
}

test('M57 Überschrift steht neben dem Button, nicht darin; Button über aria-labelledby benannt', () => {
  const u = neueUmgebung(), karte = neueKarte(u, neuesHaus({ an: true }));
  const tap = karte._tap;
  assert.equal(tap.getAttribute('role'), 'button');
  assert.equal(tap.querySelectorAll('h2').length, 0, 'kein heading im button');
  assert.ok(!tap.all().includes(karte._title), 'Titel ist kein Kind des Buttons');
  assert.ok(karte._title.id, 'Titel hat eine id');
  assert.equal(tap.getAttribute('aria-labelledby'), karte._title.id);
  assert.equal(tap.getAttribute('aria-label'), null, 'kein überschreibendes aria-label');
  assert.equal(karte._title.parentNode.parentNode, tap.parentNode, 'Titelblock ist Geschwister des Buttons');
  assert.equal(tap.getAttribute('aria-describedby'), karte._desc.id, 'Zustandszeile beschreibt den Button');
});

test('M57 Kartenkopf: höchstens 2 Tab-Stopps; Statuszeile nicht fokussierbar, ohne Button-Rolle', () => {
  const u = neueUmgebung();
  const aus = neueKarte(u, neuesHaus({ an: false }));
  assert.deepEqual(tabStopps(aus).map((e) => e.className.split(' ')[0]), ['tap', 'toggle'], 'aus: Titelfläche und Schalter');
  assert.equal(aus._desc.tabIndex, -1);
  assert.equal(aus._desc.getAttribute('role'), null);
  const an = neueKarte(u, neuesHaus({ an: true }));
  const stopps = tabStopps(an).map((e) => e.className.split(' ')[0]);
  assert.deepEqual(stopps.filter((c) => c !== 'slider'), ['tap', 'toggle'], 'an: Kopf weiter 2');
  assert.ok(stopps.includes('slider'), 'der Regler bleibt per Tastatur erreichbar (R03)');
});

test('M57 Tippen und Halten auf Titel, Symbol und Statuszeile wirken wie vorher', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { tap_action: 'toggle', hold_action: 'toggle' });
  const flaechen = { symbol: karte._tap, titel: karte._title.parentNode, status: karte._desc };
  for (const [name, el] of Object.entries(flaechen)) {
    const vorher = haus.rufe.length;
    el.dispatchEvent(ereignis(u, 'pointerdown'));
    el.dispatchEvent(ereignis(u, 'pointerup'));
    el.dispatchEvent(ereignis(u, 'click'));
    assert.equal(haus.rufe.length, vorher + 1, name + ': Tippen = tap_action');
    el.dispatchEvent(ereignis(u, 'pointerdown'));
    u.uhr.vor(500);
    assert.equal(haus.rufe.length, vorher + 2, name + ': 500 ms Halten = hold_action');
    el.dispatchEvent(ereignis(u, 'pointerup'));
    el.dispatchEvent(ereignis(u, 'click'));
    assert.equal(haus.rufe.length, vorher + 2, name + ': Klick nach dem Halten löst nichts aus');
  }
  const vorher = haus.rufe.length;
  karte._tap.dispatchEvent(ereignis(u, 'keydown', { key: 'Enter' }));
  assert.equal(haus.rufe.length, vorher + 1, 'Enter auf dem Button = tap_action');
});

test('M57 Regler: aria-valuetext in Worten, folgt Tastatur und Zustand', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const regler = karte._slider;
  assert.equal(regler.getAttribute('aria-valuetext'), regler.getAttribute('aria-valuenow') + ' Prozent');
  regler.dispatchEvent(ereignis(u, 'keydown', { key: 'Home' }));
  assert.equal(regler.getAttribute('aria-valuenow'), '1');
  assert.equal(regler.getAttribute('aria-valuetext'), '1 Prozent');
  const en = neueUmgebung({ sprache: 'en' }), haus2 = neuesHaus({ an: true, sprache: 'en' });
  const k2 = neueKarte(en, haus2);
  assert.match(k2._slider.getAttribute('aria-valuetext'), /^\d+ percent$/);
});
