'use strict';
// Buschcheck Etappe H: Lightcards on the shared design system (Shared UI 0.5.0).
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht } = require('./attrappe.js');

const klassen = (el) => String(el.className || '').split(/\s+/).filter(Boolean);
const offen = (u, haus, config) => { const karte = neueKarte(u, haus, config); karte._openDialog(); return karte._dialog; };
const zeigeDetail = (dialog, id) => { dialog._detailEntity = id; dialog._renderSheet(); };
const dialogCss = (dialog) => dialog.shadowRoot.querySelector('style').textContent;
const kartenCss = (karte) => karte.shadowRoot.querySelector('style').textContent;
/** The family part of a stylesheet: everything after the embedded shared block. */
const eigenesCss = (css, anker) => css.slice(css.indexOf(anker));
const regel = (css, selektor) => {
  const i = css.indexOf('\n' + selektor + ' {');
  return i < 0 ? null : css.slice(i, css.indexOf('}', i) + 1);
};

// ── M62: buttons and chips from the shared base components ──────────────────

test('M62 Dialog: Schließen-X und Zurück sind .busch-btn (Variante text), Rolle und Name bleiben', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = offen(u, haus);
  const x = dialog._sheet.querySelector('.iconbtn');
  assert.ok(klassen(x).includes('busch-btn'), 'X ist ein .busch-btn');
  assert.equal(x.getAttribute('data-variant'), 'text');
  assert.equal(x.getAttribute('aria-label'), 'Schließen');
  zeigeDetail(dialog, 'light.steh');
  const knoepfe = dialog._sheet.querySelector('.head').querySelectorAll('.iconbtn');
  assert.equal(knoepfe.length, 2, 'Zurück und X');
  for (const k of knoepfe) assert.ok(klassen(k).includes('busch-btn'), k.getAttribute('aria-label') + ' ist ein .busch-btn');
});

test('M62 Dialog: Farbe/Weiß sind .busch-btn (secondary) mit aria-pressed am gewählten', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = offen(u, haus);
  const tabs = dialog._sheet.querySelector('.picker-tabs').querySelectorAll('button');
  assert.ok(tabs.length >= 2, 'zwei Reiter');
  for (const t of tabs) {
    assert.ok(klassen(t).includes('busch-btn'), t.dataset.tab + ' ist ein .busch-btn');
    assert.equal(t.getAttribute('data-variant'), 'secondary');
  }
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-pressed')), ['true', 'false']);
  tabs[1].click();
  assert.deepEqual(tabs.map((t) => t.getAttribute('aria-pressed')), ['false', 'true'], 'Wahl folgt dem Klick');
});

test('M62 Detailansicht: Effekte sind button.busch-chip', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const steh = licht('light.steh', true);
  steh.attributes.effect_list = ['Kerze', 'Regenbogen'];
  steh.attributes.effect = 'Kerze';
  haus.states['light.steh'] = steh;
  const dialog = offen(u, haus);
  zeigeDetail(dialog, 'light.steh');
  const chips = dialog._sheet.querySelector('.effects').querySelectorAll('button');
  assert.equal(chips.length, 2);
  for (const c of chips) assert.ok(klassen(c).includes('busch-chip'), c.textContent + ' ist ein .busch-chip');
});

test('M62 Karte: Abzeichen für nicht erreichbare Mitglieder ist .busch-chip mit Ton warning', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: false });
  haus.states['light.decke_2'] = { entity_id: 'light.decke_2', state: 'unavailable', attributes: { friendly_name: 'Decke 2' } };
  const karte = neueKarte(u, haus);
  assert.notEqual(karte._warn.style.display, 'none', 'Abzeichen sichtbar');
  assert.ok(klassen(karte._warn).includes('busch-chip'));
  assert.equal(karte._warn.getAttribute('data-tone'), 'warning');
});

test('M62 CSS: keine eigene Knopfgeometrie mehr für X, Reiter und Effekte', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const css = eigenesCss(dialogCss(offen(u, haus)), ':host {');
  assert.doesNotMatch(regel(css, '.iconbtn') || '', /width: 36px|height: 36px/, 'X misst 44 px über .busch-btn');
  assert.doesNotMatch(regel(css, '.picker-tabs button') || '', /padding: 8px/, 'Reiter-Höhe aus .busch-btn');
  assert.equal(regel(css, '.chips button'), null, 'Effekte ohne eigene Knopfregel');
});

// ── M63: type scale and radii from tokens, sentence case, percent label ≥ 12 px ──

const fs = require('node:fs');
const path = require('node:path');
const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'busch-lightcards.js'), 'utf8');
/** The family stylesheet as written in the source (template text, interpolations unresolved). */
function blatt(name) {
  const start = QUELLE.indexOf('const ' + name + ' = ');
  assert.ok(start > 0, name + ' gefunden');
  const auf = QUELLE.indexOf('`', start);
  return QUELLE.slice(auf + 1, QUELLE.indexOf('`;', auf));
}
const BLAETTER = ['CARD_STYLES', 'DIALOG_STYLES', 'EDITOR_STYLES'];
const blattRegel = (css, selektor) => {
  const i = css.indexOf('\n' + selektor + ' {');
  return i < 0 ? '' : css.slice(i, css.indexOf('}', i) + 1);
};

test('M63 keine feste font-size: Npx und kein --ha-font-size-xs (10 px in HA) in den Familienstilen', () => {
  for (const name of BLAETTER) {
    const css = blatt(name);
    const fest = [...css.matchAll(/font-size:\s*\d+(?:\.\d+)?px/g)].map((m) => m[0]);
    assert.deepEqual(fest, [], name + ': feste Schriftgrößen');
    assert.doesNotMatch(css, /--ha-font-size-xs/, name + ': xs ist in HA 10 px, unter der 12-px-Grenze');
  }
});

test('M63 Prozentlabel der Lampenkacheln mindestens 12 px (Stufe s)', () => {
  const r = blattRegel(blatt('DIALOG_STYLES'), '.tile .tpct');
  assert.match(r, /font-size: \$\{BuschUI\.tokens\.fontSizeS\}/);
  assert.match(QUELLE, /fontSizeS:'var\(--busch-font-size-s,var\(--ha-font-size-s,12px\)\)'/, 'Stufe s fällt auf 12 px zurück');
});

test('M63 Abschnittsüberschriften in Satzschreibweise: keine Versalien, keine Sperrung', () => {
  for (const name of BLAETTER) {
    assert.doesNotMatch(blatt(name), /text-transform:\s*uppercase/, name);
    assert.doesNotMatch(blatt(name), /letter-spacing/, name);
  }
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = offen(u, haus, { scenes: [{ entity: 'scene.abend' }] });
  for (const h of dialog._sheet.querySelectorAll('h3')) {
    const t = h.textContent;
    assert.equal(t[0], t[0].toUpperCase(), t + ' beginnt groß');
    assert.notEqual(t, t.toUpperCase(), t + ' ist nicht in Versalien geschrieben');
  }
});

test('M63 Radien nur aus Token: Kreis, Pille, Dialog- oder Innenradius', () => {
  for (const name of BLAETTER) {
    const werte = [...blatt(name).matchAll(/border-radius:\s*([^;]+);/g)].map((m) => m[1].trim());
    const fest = werte.filter((w) => w.split(/\s+(?![^(]*\))/).some((teil) => /^\d+(?:\.\d+)?px$/.test(teil)));
    assert.deepEqual(fest, [], name + ': feste Radien');
  }
  const d = blatt('DIALOG_STYLES');
  for (const sel of ['.scene', '.tile', '.picker-tabs .busch-btn', '.pick']) {
    assert.match(blattRegel(d, sel), /border-radius: \$\{BuschUI\.tokens\.radiusInner\}/, sel + ' nimmt die eine Innenradius-Stufe');
  }
});
