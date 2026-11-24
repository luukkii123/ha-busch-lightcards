'use strict';
// M26 (#1346, Abschlusstor Prüfung 4, E6): the coloured states of the light card and its dialog, computed from the CSS
// of the bundle — scene tiles, lamp tiles on/off/offline, the warm lit header, success/error hints. The browser
// measurement (visual_contract.py, kontrast_touch.py) gives kein_urteil on gradients and stripes, so these colours
// are computed here: text 4.5:1 (WCAG 1.4.3), symbols and the state they show 3:1 (WCAG 1.4.11). Themes: Home
// Assistant's defaults (hacs/docs/render/regeln.py THEMA_CSS), the two themes of docs/render/visual_contract.py, and
// dialog_theme: dark. Same formula as hacs/scripts/kontrast_touch.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { neueUmgebung } = require('./attrappe.js');

const QUELLE = fs.readFileSync(path.join(__dirname, '..', 'dist', 'busch-lightcards.js'), 'utf8');
const I = (() => { let i; return () => (i = i || neueUmgebung().registry.get('busch-light-card').__internals); })();

/** A family stylesheet of the source (template text, comments removed). */
function blatt(name) {
  const start = QUELLE.indexOf('const ' + name + ' = ');
  assert.ok(start > 0, name);
  const auf = QUELLE.indexOf('`', start);
  return QUELLE.slice(auf + 1, QUELLE.indexOf('`;', auf)).replace(/\/\*[\s\S]*?\*\//g, '');
}
const SHARED = QUELLE.slice(QUELLE.indexOf('/* BEGIN BUSCH SHARED UI'), QUELLE.indexOf('/* END BUSCH SHARED UI'));
const CARD = blatt('CARD_STYLES'), DIALOG = blatt('DIALOG_STYLES'), EDITOR = blatt('EDITOR_STYLES');

/** Body of the rule `sel {` (pretty source) or `sel{` (minified shared block). */
function regel(css, sel) {
  let i = css.indexOf('\n' + sel + ' {');
  if (i < 0) i = css.indexOf(sel + '{');
  assert.ok(i >= 0, 'rule ' + sel);
  // A `${...}` interpolation of the template does not end the rule.
  const von = css.indexOf('{', i) + 1;
  for (let j = von, tiefe = 0; j < css.length; j++) {
    if (css[j] === '$' && css[j + 1] === '{') { tiefe++; j++; } else if (css[j] === '}') { if (!tiefe) return css.slice(von, j); tiefe--; }
  }
  return css.slice(von);
}
function wert(block, prop) {
  const m = block.match(new RegExp('(?:^|[;{\\s])' + prop + ':\\s*([^;]+?)\\s*(?:;|$)'));
  assert.ok(m, prop + ' in ' + block.slice(0, 80));
  return m[1].replace(/\s+/g, ' ').trim();
}
const teile = (s) => { const out = []; let t = 0, von = 0; for (let i = 0; i < s.length; i++) { if (s[i] === '(') t++; else if (s[i] === ')') t--; else if (s[i] === ',' && !t) { out.push(s.slice(von, i).trim()); von = i + 1; } } out.push(s.slice(von).trim()); return out; };
const hex = (h) => (h.length === 4 ? [...h.slice(1)].map((c) => parseInt(c + c, 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
/** A CSS colour as [r, g, b, a]: #hex, rgb(a), var(--x, fallback) via `t`, color-mix in srgb. */
function farbe(w, t) {
  w = w.trim(); let m;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(w)) return hex(w).concat(1);
  if ((m = w.match(/^rgba?\((.*)\)$/))) { const z = teile(m[1]).map(Number); return [z[0], z[1], z[2], z.length > 3 ? z[3] : 1]; }
  if ((m = w.match(/^var\((--[\w-]+)(?:,\s*(.*))?\)$/s))) {
    const name = m[1].slice(2);
    if (Object.hasOwn(t, name)) return farbe(t[name], t);
    assert.ok(m[2] !== undefined, 'unknown variable ' + m[1]);
    return farbe(m[2], t);
  }
  if ((m = w.match(/^color-mix\(in srgb,\s*(.*)\)$/s))) {
    const [a, b] = teile(m[1]), pa = a.match(/^(.*)\s+(\d+)%$/s), fa = farbe(pa[1], t), fb = farbe(b, t), p = Number(pa[2]) / 100;
    return [0, 1, 2].map((i) => fa[i] * p + fb[i] * (1 - p)).concat(fa[3] * p + fb[3] * (1 - p));
  }
  throw new Error('colour not understood: ' + w);
}
const ueber = (f, bg) => [0, 1, 2].map((i) => f[i] * f[3] + bg[i] * (1 - f[3]));
const lum = (c) => { const l = c.slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const quote = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const rgb = (c) => [c.r, c.g, c.b];

// Theme values: Home Assistant's defaults (regeln.py THEMA_CSS) and the two themes of visual_contract.py.
const THEMEN = {
  'ha-hell': { 'primary-color': '#03a9f4', 'primary-text-color': '#212121', 'secondary-text-color': '#727272', 'card-background-color': '#ffffff',
    'secondary-background-color': '#e5e5e5', 'divider-color': '#e0e0e0', 'error-color': '#db4437', 'warning-color': '#ffa600', 'success-color': '#43a047' },
  'ha-dunkel': { 'primary-color': '#03a9f4', 'primary-text-color': '#e1e1e1', 'secondary-text-color': '#9b9b9b', 'card-background-color': '#1c1c1c',
    'secondary-background-color': '#202020', 'divider-color': '#474747', 'error-color': '#db4437', 'warning-color': '#ffa600', 'success-color': '#43a047' },
  'vc-hell': { 'primary-color': '#087bc1', 'primary-text-color': '#17212b', 'secondary-text-color': '#566574', 'card-background-color': '#ffffff',
    'secondary-background-color': '#e9eef2', 'divider-color': '#dbe2e9', 'error-color': '#b33232', 'warning-color': '#986200', 'success-color': '#187b59' },
  'vc-dunkel': { 'primary-color': '#75b8ee', 'primary-text-color': '#f3f5f7', 'secondary-text-color': '#abbac7', 'card-background-color': '#202b35',
    'secondary-background-color': '#2b3844', 'divider-color': '#425360', 'error-color': '#ff8b8b', 'warning-color': '#f5bb67', 'success-color': '#6fd1a8' },
};
/** The dialog's own palette (--blc-d-*) of a host rule. */
const palette = (sel) => Object.fromEntries([...regel(DIALOG, sel).matchAll(/(?:^|[\s;])--(blc-d-[\w-]+):\s*([^;]+);/g)]
  .map((m) => [m[1], m[2].replace(/\s+/g, ' ').trim()]));
/** Dialog looks: the theme look in every theme, dialog_theme: dark in both HA themes. */
function blicke() {
  const thema = palette(':host'), dunkel = palette(":host([dialog-theme='dark'])"), out = {};
  for (const [n, t] of Object.entries(THEMEN)) out['thema ' + n] = { ...t, ...thema };
  for (const n of ['ha-hell', 'ha-dunkel']) out['dark-look ' + n] = { ...THEMEN[n], ...thema, ...dunkel };
  return out;
}
/** Records every shortfall in `faelle`; `.n` counts the checks, so a silent empty loop cannot pass. */
const pruefer = (faelle) => {
  const pruefe = (name, fg, bg, min) => {
    pruefe.n++;
    const q = quote(fg, bg);
    if (q < min) faelle.push(`${name}: ${q.toFixed(2)}:1 < ${min}`);
  };
  pruefe.n = 0;
  return pruefe;
};
// Scene colours of visual_contract.py, Hue-like lamp colours and the extremes.
const FARBEN = ['#ffe0a3', '#2d3c8c', '#ff5ca8', '#ffda95', '#f5f5ff', '#ff0000', '#0000ff', '#00ff00', '#8000ff', '#ff8000',
  '#800000', '#008080', '#ffff00', '#ff00ff', '#ffffff', '#000000', '#808080', '#466eff'];
const parse = (h) => { const [r, g, b] = hex(h); return { r, g, b, a: 1 }; };

test('M26 scene tiles: label 4.5:1 on the scene colour, symbol 3:1 on its badge; a missing scene keeps 3:1', () => {
  const faelle = [], pruefe = pruefer(faelle);
  const badge = { light: farbe(wert(regel(DIALOG, '.scene .badge'), 'background'), {}), dark: farbe(wert(regel(DIALOG, '.scene.fg-dark .badge'), 'background'), {}) };
  for (const h of FARBEN) {
    const s = I().readableSurface([parse(h)]), tile = rgb(s.colors[0]), text = rgb(s.text);
    pruefe(`scene label ${h}`, text, tile, 4.5);
    pruefe(`scene symbol/badge ${h}`, text, ueber(badge[s.fg], tile), 3);
  }
  // The missing scene is a disabled button (WCAG exempts it); M29 keeps its label at 3:1 all the same.
  const aus = regel(DIALOG, '.scene[disabled]');
  for (const [n, t] of Object.entries(blicke())) pruefe(`missing scene ${n}`, farbe(wert(aus, 'color'), t), farbe(wert(aus, 'background'), t), 3);
  assert.equal(pruefe.n, FARBEN.length * 2 + 6);
  assert.deepEqual(faelle, []);
});

test('M26 lamp tiles: on (colour and its shaded part), off and offline (both stripes) keep 4.5:1 text and 3:1 symbols', () => {
  const faelle = [], pruefe = pruefer(faelle);
  for (const h of FARBEN) {
    const s = I().readableSurface([parse(h)], { shade: I().TILE_SHADE }), tile = rgb(s.colors[0]), text = rgb(s.text);
    pruefe(`lit tile ${h}`, text, tile, 4.5);
    pruefe(`lit tile shaded ${h}`, text, tile.map((v) => v * I().TILE_SHADE), 4.5);
  }
  // The shade is rgba(0, 0, 0, 0.32): TILE_SHADE is its rest.
  assert.match(regel(DIALOG, '.tile .tfill'), /background: rgba\(0, 0, 0, 0\.32\)/);
  assert.equal(I().TILE_SHADE, 0.68);
  const kachel = regel(DIALOG, '.tile'), tot = regel(DIALOG, '.tile.dead');
  const streifen = wert(tot, 'background').match(/var\(--blc-d-dead-a\)[\s\S]*var\(--blc-d-dead-b\)/);
  assert.ok(streifen, 'offline tile: stripes of dead-a and dead-b');
  for (const [n, t] of Object.entries(blicke())) {
    pruefe(`off tile ${n}`, farbe(wert(kachel, 'color'), t), farbe(wert(kachel, 'background'), t), 4.5);
    for (const s of ['dead-a', 'dead-b']) pruefe(`offline tile ${s} ${n}`, farbe(wert(tot, 'color'), t), farbe(`var(--blc-d-${s})`, t), 4.5);
  }
  assert.equal(pruefe.n, FARBEN.length * 2 + 6 * 3);
  assert.deepEqual(faelle, []);
});

test('M26 lit dialog header (warm, white, several colours): title and status 4.5:1 on every stop, close symbol 3:1 on its button', () => {
  const faelle = [], pruefe = pruefer(faelle);
  assert.match(regel(DIALOG, '.head.lit .sub'), /color: inherit/);
  assert.match(regel(DIALOG, '.head.lit .iconbtn'), /color: inherit/);
  const knopf = { light: farbe(wert(regel(DIALOG, '.head.lit.fg-light .iconbtn'), 'background'), {}), dark: farbe(wert(regel(DIALOG, '.head.lit.fg-dark .iconbtn'), 'background'), {}) };
  const k = (kelvin) => { const [r, g, b] = I().tempToRgb(kelvin); return { r, g, b, a: 1 }; }, warm = k(2700), kalt = k(6500);
  const koepfe = {
    'warm 2700 K': [warm], 'warm default': [parse('#ffda95')], 'white 6500 K': [kalt],
    'warm + white': [warm, kalt], 'success (visual_contract)': ['#ffb437', '#fff0dc', '#ff5ca8', '#5878ff'].map(parse),
    ...Object.fromEntries(FARBEN.map((h) => [h, [parse(h)]])),
  };
  for (const [n, farben] of Object.entries(koepfe)) {
    const s = I().litSurface(farben), text = rgb(s.text);
    assert.ok(s.colors.length >= 1, n);
    for (const stop of s.colors) {
      pruefe(`header text ${n}`, text, rgb(stop), 4.5);
      pruefe(`header close symbol ${n}`, text, ueber(knopf[s.fg], rgb(stop)), 3);
    }
  }
  assert.ok(pruefe.n >= (FARBEN.length + 5) * 2, String(pruefe.n));
  assert.deepEqual(faelle, []);
});

test('M26 success/error hints: status line, state blocks, offline list and editor notes in the theme colours', () => {
  const faelle = [], pruefe = pruefer(faelle);
  const sel = (css, s) => wert(regel(css, s), 'color');
  for (const [n, t] of Object.entries(THEMEN)) {
    const karte = hex(t['card-background-color']);
    // Status line: the words in the text colour, the tone on the dot (3:1).
    for (const ton of ['success', 'warning', 'unavailable', 'error'])
      pruefe(`status text ${ton} ${n}`, farbe(sel(CARD, ".desc[data-tone='success'] .dtext, .desc[data-tone='warning'] .dtext,\n.desc[data-tone='unavailable'] .dtext, .desc[data-tone='error'] .dtext"), t), karte, 4.5);
    pruefe(`status text neutral ${n}`, farbe(sel(CARD, ".desc[data-tone='neutral'] .dtext"), t), karte, 4.5);
    for (const ton of ['success', 'warning', 'error', 'unavailable'])
      pruefe(`status dot ${ton} ${n}`, farbe(wert(regel(CARD, `.desc[data-tone='${ton}']::before`), 'background'), t), karte, 3);
    // Card state blocks (shared): error and offline symbols 3:1, text and hint 4.5:1.
    pruefe(`card error symbol ${n}`, farbe(sel(SHARED, '.busch-state[data-kind=error] .busch-state-icon'), t), karte, 3);
    pruefe(`card offline symbol ${n}`, farbe(sel(SHARED, '.busch-state[data-kind=offline] .busch-state-icon'), t), karte, 3);
    // Editor: warning note and fallback (error) message.
    pruefe(`editor warning note ${n}`, farbe(sel(EDITOR, '.note.warn'), t), karte, 4.5);
    pruefe(`editor fallback ${n}`, farbe(sel(EDITOR, '.fallback'), t), karte, 4.5);
  }
  for (const [n, t] of Object.entries(blicke())) {
    const blattF = farbe('var(--blc-d-bg)', t);
    pruefe(`dialog state text ${n}`, farbe(sel(DIALOG, '.sheet .busch-state'), t), blattF, 4.5);
    pruefe(`dialog state hint ${n}`, farbe(sel(DIALOG, '.sheet .busch-state-hint, .sheet .busch-state[data-kind=empty] .busch-state-icon'), t), blattF, 4.5);
    pruefe(`dialog offline symbol ${n}`, farbe(sel(DIALOG, '.sheet .busch-state[data-kind=offline] .busch-state-icon'), t), blattF, 3);
    pruefe(`dialog offline list ${n}`, farbe(sel(DIALOG, '.deadlist'), t), blattF, 4.5);
    pruefe(`dialog status line ${n}`, farbe(wert(regel(DIALOG, '.head .sub'), 'color'), t), blattF, 4.5);
  }
  assert.equal(pruefe.n, 4 * 13 + 6 * 5);
  assert.deepEqual(faelle, []);
});
