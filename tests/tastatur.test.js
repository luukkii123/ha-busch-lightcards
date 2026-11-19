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

// M74 (Buschcheck F11): the hold action has a keyboard way as well.
test('M74 Umschalt+Enter auf dem Kartenknopf löst die Halte-Aktion aus, nicht das Tippen', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { tap_action: 'none', hold_action: 'toggle' });
  const vorher = haus.rufe.length;
  const e = ereignis(u, 'keydown', { key: 'Enter', shiftKey: true });
  karte._tap.dispatchEvent(e);
  assert.equal(haus.rufe.length, vorher + 1, 'hold_action (toggle) lief');
  assert.equal(haus.rufe.at(-1).service, 'turn_off');
  assert.ok(e.defaultPrevented);
  // Plain Enter stays the tap action (none here): nothing more.
  karte._tap.dispatchEvent(ereignis(u, 'keydown', { key: 'Enter' }));
  assert.equal(haus.rufe.length, vorher + 1, 'Enter ohne Umschalt = tap_action');
  // Shift+Space is no hold: only Enter carries it.
  karte._tap.dispatchEvent(ereignis(u, 'keydown', { key: ' ', shiftKey: true }));
  assert.equal(haus.rufe.length, vorher + 1);
});

test('M74 Kontextmenütaste löst die Halte-Aktion aus, das Browsermenü danach nicht', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus, { tap_action: 'none', hold_action: 'toggle' });
  const vorher = haus.rufe.length;
  const taste = ereignis(u, 'keydown', { key: 'ContextMenu' });
  karte._tap.dispatchEvent(taste);
  assert.equal(haus.rufe.length, vorher + 1, 'hold_action lief');
  assert.ok(taste.defaultPrevented);
  const menue = ereignis(u, 'contextmenu', { button: 0 });
  karte._tap.dispatchEvent(menue);
  assert.ok(menue.defaultPrevented, 'das Menü der Taste bleibt zu');
  assert.equal(haus.rufe.length, vorher + 1, 'contextmenu löst nichts zweites aus');
  // A right click is not the key: the browser menu stays the browser's.
  const rechts = ereignis(u, 'contextmenu', { button: 2 });
  karte._tap.dispatchEvent(rechts);
  assert.equal(rechts.defaultPrevented, false);
});

test('M74 Halte-Aktion more-info per Tastatur, aria-keyshortcuts nur mit Halte-Aktion', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const gefeuert = [];
  karte.dispatchEvent = (e) => { gefeuert.push(e.type); return true; };
  karte._tap.dispatchEvent(ereignis(u, 'keydown', { key: 'Enter', shiftKey: true }));
  assert.deepEqual(gefeuert, ['hass-more-info'], 'Vorgabe more-info');
  assert.equal(karte._tap.getAttribute('aria-keyshortcuts'), 'Shift+Enter ContextMenu');
  const ohne = neueKarte(u, neuesHaus({ an: true }), { hold_action: 'none' });
  assert.equal(ohne._tap.getAttribute('aria-keyshortcuts'), null, 'ohne Halte-Aktion kein Kürzel');
});

test('M74 Wörterbuch nennt den Tastaturweg im Hilfetext (de und en)', () => {
  const u = neueUmgebung();
  const T = u.registry.get('busch-light-card').__internals.TEXTE;
  const de = JSON.stringify(T.de || T), en = JSON.stringify(T.en || T);
  assert.match(de, /Umschalt\+Enter/);
  assert.match(de, /Kontextmenütaste/);
  assert.match(en, /Shift\+Enter/);
  assert.match(en, /context menu key/);
});
