'use strict';
// M29 (Buschcheck W5, Entscheidung E4): Der Dialog folgt dem HA-Thema;
// `dialog_theme: dark` stellt den bisherigen dunklen Hue-Look her.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte } = require('./attrappe.js');

const intern = (u) => u.registry.get('busch-light-card').__internals;

/** Der Wert, den eine Palette-Variable in einem Regelblock bekommt. */
function palette(css, selektor) {
  // DIALOG_STYLES starts with the shared card styles, which have a :host of their own.
  const start = selektor === ':host'
    ? css.lastIndexOf(':host {', css.indexOf('--blc-d-bg:')) : css.indexOf(selektor + ' {');
  assert.ok(start >= 0, 'Block ' + selektor);
  const block = css.slice(start, css.indexOf('}', start));
  const werte = {};
  for (const m of block.matchAll(/(--blc-d-[a-z-]+)\s*:\s*([^;]+);/g)) werte[m[1]] = m[2].trim();
  return werte;
}
/** Hex-Rückfall hinter einem var(): `var(--x, #171717)` -> {r,g,b}. */
function hexAus(wert) {
  const m = String(wert).match(/#([0-9a-f]{3,6})\)/i);
  assert.ok(m, 'Hex-Rückfall in ' + wert);
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
}

test('M29 Konfiguration: dialog_theme Vorgabe theme, dark wird übernommen, Unbekanntes ist ein Fehler', () => {
  const u = neueUmgebung();
  const I = intern(u);
  assert.equal(I.normalizeConfig({ entity: 'light.x' }).dialogTheme, 'theme');
  assert.equal(I.normalizeConfig({ entity: 'light.x', dialog_theme: 'dark' }).dialogTheme, 'dark');
  assert.equal(I.normalizeConfig({ entity: 'light.x', dialogTheme: 'dark' }).dialogTheme, 'dark', 'camelCase-Alias');
  assert.equal(I.normalizeConfig({ entity: 'light.x', dialog_theme: 'theme' }).dialogTheme, 'theme');
  assert.throws(() => I.normalizeConfig({ entity: 'light.x', dialog_theme: 'schwarz' }),
    (e) => e.textKey === 'fehlerDialogThema' && e.textVars.wert === 'schwarz');
  // Die Karte zeigt den Fehler im Wörterbuchtext, mit dem falschen Wert.
  const karte = neueKarte(u, neuesHaus(), { dialog_theme: 'schwarz' });
  assert.match(karte.shadowRoot.textContent, /Aussehen des Dialogs „schwarz“/);
});

test('M29 Dialog: Standard ohne Markierung, dialog_theme: dark setzt sie am Host', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const hell = neueKarte(u, haus);
  hell._openDialog();
  assert.equal(hell._dialog.getAttribute('dialog-theme'), null);
  const dunkel = neueKarte(u, haus, { dialog_theme: 'dark' });
  dunkel._openDialog();
  assert.equal(dunkel._dialog.getAttribute('dialog-theme'), 'dark');
});

test('M29 Stile: Standard aus den HA-Variablen, Kacheln aus --secondary-background-color', () => {
  const u = neueUmgebung();
  const css = intern(u).DIALOG_STYLES;
  const p = palette(css, ':host');
  assert.match(p['--blc-d-bg'], /^var\(--blc-dialog-bg, var\(--card-background-color/);
  assert.match(p['--blc-d-text'], /^var\(--blc-dialog-text, var\(--primary-text-color/);
  assert.match(p['--blc-d-tile'], /^var\(--blc-dialog-tile, var\(--secondary-background-color/);
  assert.match(p['--blc-d-muted'], /^var\(--blc-dialog-muted, var\(--secondary-text-color/);
  assert.match(p['--blc-d-line'], /^var\(--blc-dialog-line, var\(--divider-color/);
  // Kein Bauteil liest mehr den alten festen Rückfall direkt.
  assert.doesNotMatch(css, /var\(--blc-dialog-bg, #171717\)\s*;\s*\n\s*color/);
  assert.doesNotMatch(css.slice(css.indexOf('.sheet {')), /background: var\(--blc-dialog-bg, #171717\)/);
});

test('M29 Stile: dialog_theme: dark stellt jede alte Farbe wieder her', () => {
  const u = neueUmgebung();
  const p = palette(intern(u).DIALOG_STYLES, ":host([dialog-theme='dark'])");
  const alt = {
    '--blc-d-bg': ['--blc-dialog-bg', '#171717'], '--blc-d-text': ['--blc-dialog-text', '#fff'],
    '--blc-d-invert': ['--blc-dialog-invert', '#111'], '--blc-d-tile': ['--blc-dialog-tile', '#363636'],
    '--blc-d-muted': ['--blc-dialog-muted', '#aaa'], '--blc-d-dim': ['--blc-dialog-dim', '#ccc'],
    '--blc-d-faint': ['--blc-dialog-faint', '#888'], '--blc-d-line': ['--blc-dialog-line', '#333'],
    '--blc-d-dead-a': ['--blc-dialog-dead-a', '#2a2a2a'], '--blc-d-dead-b': ['--blc-dialog-dead-b', '#222'],
  };
  for (const [name, [haken, hex]] of Object.entries(alt)) {
    assert.equal(p[name], 'var(' + haken + ', ' + hex + ')', name);
  }
});

test('M29 deaktivierte Szenenkachel: keine Deckkraft, Kontrast ≥ 3:1 im dunklen Look', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const css = I.DIALOG_STYLES;
  const block = css.slice(css.indexOf('.scene[disabled] {'), css.indexOf('}', css.indexOf('.scene[disabled] {')));
  assert.doesNotMatch(block, /opacity/, 'Deckkraft senkt den Kontrast (vorher 0.4, ca. 2,5:1)');
  assert.match(block, /color: var\(--blc-d-faint\)/);
  assert.match(block, /background: var\(--blc-d-scene-off\)/);
  const dunkel = palette(css, ":host([dialog-theme='dark'])");
  const ratio = I.contrastRatio(hexAus(dunkel['--blc-d-faint']), hexAus(dunkel['--blc-d-scene-off']));
  assert.ok(ratio >= 3, 'Kontrast dunkel ' + ratio.toFixed(2));
});

test('M29 Editor: dialog_theme als Auswahl mit Label und Helper in DE und EN, Vorgabe wird nicht geschrieben', () => {
  const u = neueUmgebung(), haus = neuesHaus();
  const I = intern(u);
  const sl = JSON.stringify(I.SCHEMA);
  assert.match(sl, /"name":"dialog_theme","selector":\{"select"/);
  for (const s of ['de', 'en']) {
    assert.ok(I.TEXTE[s].labels.dialog_theme, s + ' Label');
    assert.match(I.TEXTE[s].helpers.dialog_theme, /\.$/, s + ' Helper');
    assert.ok(I.TEXTE[s].texte.dialogThemeTheme && I.TEXTE[s].texte.dialogThemeDark, s + ' Optionen');
    assert.ok(I.TEXTE[s].texte.fehlerDialogThema.includes('{wert}'), s + ' Fehlertext');
  }
  assert.equal(I.CONFIG_DEFAULTS.dialog_theme, 'theme');
  const ed = u.document.createElement('busch-light-card-editor');
  const raus = [];
  ed.addEventListener('config-changed', (e) => raus.push(e.detail.config));
  ed.hass = haus.hass();
  ed._config = { type: 'custom:busch-light-card', entity: 'light.wohnzimmer' };
  assert.deepEqual(JSON.parse(JSON.stringify(ed._data(['dialog_theme']))), { dialog_theme: 'theme' });
  ed._emit({ dialog_theme: 'dark' });
  assert.equal(raus.at(-1).dialog_theme, 'dark');
  ed._emit({ dialog_theme: 'theme' });
  assert.equal(raus.at(-1).dialog_theme, undefined, 'Vorgabe fällt weg');
  assert.deepEqual(JSON.parse(JSON.stringify(I.toSnakeConfig({ dialogTheme: 'dark' }))), { dialog_theme: 'dark' });
});
