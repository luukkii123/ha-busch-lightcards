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

// ── M61: card title on the family step 1, one level-2 section heading ─────────

test('M61 Kartentitel über BuschUI.header({level:1}): Stufe 1, beschriftete Gruppe mit dem Titel', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  const titel = karte._title;
  assert.ok(klassen(titel).includes('busch-ui-title'));
  assert.equal(titel.getAttribute('data-level'), '1');
  assert.equal(titel.tagName, 'H2', 'echte Überschrift bleibt');
  const kopf = titel.parentNode;
  assert.ok(klassen(kopf).includes('busch-ui-header'));
  assert.equal(kopf.getAttribute('aria-label'), titel.textContent, 'Gruppe heißt wie der Titel');
  karte.hass = haus.setze({ 'light.wohnzimmer': Object.assign({}, haus.states['light.wohnzimmer'], {
    attributes: Object.assign({}, haus.states['light.wohnzimmer'].attributes, { friendly_name: 'Salon' }) }) });
  assert.equal(titel.textContent, 'Salon');
  assert.equal(kopf.getAttribute('aria-label'), 'Salon', 'folgt dem neuen Titel');
});

test('M61 CSS: Titelgröße und -gewicht kommen aus der Familienstufe, die Farbe bleibt die der Fläche', () => {
  const r = blattRegel(blatt('CARD_STYLES'), '.text h2');
  assert.ok(r, '.text h2 vorhanden');
  assert.doesNotMatch(r, /font-size|font-weight/, 'Stufe 1 aus BuschUI (--ha-card-header-font-size, medium)');
  assert.match(r, /color: inherit/, 'Lichtfarbe der Karte: Schrift der Fläche, nicht die Themafarbe');
});

test('M61 Dialog: Abschnittsüberschriften sind die eine Stufe-2-Überschrift (BuschUI.sectionHeading)', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const dialog = offen(u, haus, { scenes: [{ entity: 'scene.abend' }] });
  const h3 = dialog._sheet.querySelectorAll('h3');
  assert.ok(h3.length >= 3, 'Szenen, Helligkeit, Lampen');
  for (const h of h3) assert.ok(klassen(h).includes('busch-ui-heading2'), h.textContent);
  const r = blattRegel(blatt('DIALOG_STYLES'), 'h3');
  assert.doesNotMatch(r, /font-size|font-weight/, 'Größe und Gewicht aus der Stufe 2');
  assert.match(r, /color: var\(--blc-d-text\)/, 'Textfarbe des Blatts, auch im dunklen Hue-Look');
});

// ── M28: history and focus trap from shared UI, the same X ───────────────────

/** Opens the dialog the way a person does: a tap on the card. */
function geoeffnet(u, haus) {
  const karte = neueKarte(u, haus);
  karte._openDialog();
  return { karte, dialog: karte._dialog };
}
const eigene = (u) => u.verlauf.state && u.verlauf.state.buschUiDialog;
const tippe = (u, dialog, name = 'light.steh') => {
  const kachel = dialog._sheet.querySelectorAll('.tile').find((t) => t.querySelector('.tname').textContent === name);
  const e = (type) => u.neuesEreignis(type, { pointerId: 7, clientX: 40, clientY: 40 });
  kachel.dispatchEvent(e('pointerdown')); kachel.dispatchEvent(e('pointerup'));
  u.uhr.vor(350); // #1254: double-tap window
};

test('M28 kein eigenes pushState/history.go und keine eigene Tab-Falle außerhalb des Shared-Blocks', () => {
  const familie = QUELLE.slice(QUELLE.indexOf('/* END BUSCH SHARED UI */'));
  assert.doesNotMatch(familie, /history\.pushState|history\.go\(|DIALOG_HISTORY_KEY/, 'Verlauf nur über BuschUI.dialogHistory');
  assert.doesNotMatch(familie, /event\.key === 'Tab'/, 'Tab-Falle nur über BuschUI.focusTrap');
  assert.match(familie, /BuschUI\.dialogHistory\(/);
  assert.match(familie, /BuschUI\.focusTrap\(/);
});

test('M28 Verlauf: ein Eintrag je Ebene; Zurück schließt erst die Detailansicht, dann den Dialog, Seite bleibt', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const vorher = u.verlauf.pos;
  const { dialog } = geoeffnet(u, haus);
  assert.equal(u.verlauf.pos, vorher + 1, 'ein Eintrag beim Öffnen');
  assert.equal(eigene(u).name, 'busch-light-dialog');
  tippe(u, dialog);
  assert.equal(dialog._detailEntity, 'light.steh');
  assert.equal(u.verlauf.pos, vorher + 2, 'Detailansicht mit eigenem Eintrag');
  u.zurueck();
  assert.equal(dialog.isConnected, true, 'erstes Zurück: Dialog bleibt');
  assert.equal(dialog._detailEntity, null, 'zurück in der Gruppe');
  u.zurueck();
  assert.equal(dialog.isConnected, false, 'zweites Zurück schließt');
  assert.equal(u.verlauf.pos, vorher, 'Seite nicht verlassen');
});

test('M28 Schließen-X aus der Detailansicht nimmt beide Einträge zurück, ohne verwaisten Eintrag', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const vorher = u.verlauf.pos;
  const { dialog } = geoeffnet(u, haus);
  tippe(u, dialog);
  const x = dialog._sheet.querySelector('.busch-dialog-close');
  assert.ok(x, 'X trägt .busch-dialog-close');
  x.click();
  assert.equal(u.verlauf.pos, vorher + 1, 'erst der Eintrag der Detailansicht');
  u.popstate();
  assert.equal(u.verlauf.pos, vorher, 'dann der des Dialogs');
  assert.equal(dialog.isConnected, true, 'zu erst, wenn der Verlauf angekommen ist (more-info danach)');
  u.popstate();
  assert.equal(dialog.isConnected, false);
});

test('M28 Escape: Detailansicht einen Schritt zurück (Eintrag weg), dann zu; ohne Ankunft schließt die Absicherung', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const vorher = u.verlauf.pos;
  const { dialog } = geoeffnet(u, haus);
  tippe(u, dialog);
  const esc = () => u.document.dispatchEvent(u.neuesEreignis('keydown', { key: 'Escape' }));
  esc();
  assert.equal(dialog._detailEntity, null);
  assert.equal(dialog.isConnected, true);
  assert.equal(u.verlauf.pos, vorher + 1, 'Eintrag der Detailansicht verbraucht');
  u.popstate(); // lands on the dialog's own entry: nothing closes
  assert.equal(dialog.isConnected, true);
  esc();
  assert.equal(u.verlauf.pos, vorher);
  u.uhr.vor(400); // popstate never delivered: insurance
  assert.equal(dialog.isConnected, false);
});

test('M28 Fokus: Tab kreist im Blatt, nach dem Schließen zurück auf die Karte; X steht links vor dem Zurück-Pfeil', () => {
  const u = neueUmgebung(), haus = neuesHaus({ an: true });
  const karte = neueKarte(u, haus);
  karte._tap.focus();
  u.document.activeElement = karte;
  karte._openDialog();
  const dialog = karte._dialog;
  const tab = (shift) => u.document.dispatchEvent(u.neuesEreignis('keydown', { key: 'Tab', shiftKey: !!shift }));
  const fokus = () => dialog.shadowRoot.activeElement;
  const erstes = fokus();
  assert.ok(erstes && klassen(erstes).includes('busch-dialog-close'), 'Fokus beginnt auf dem X');
  tab(true);
  assert.notEqual(fokus(), erstes, 'Shift+Tab springt ans Ende');
  tab();
  assert.equal(fokus(), erstes, 'Tab kreist zurück zum Anfang');
  tippe(u, dialog);
  const kopf = dialog._sheet.querySelector('.head').querySelectorAll('.iconbtn');
  assert.deepEqual(kopf.map((k) => k.getAttribute('aria-label')), ['Schließen', 'Zurück'], 'X links, dann Zurück (Tab-Reihenfolge = Bild)');
  kopf[0].click(); u.popstate(); u.popstate();
  assert.equal(dialog.isConnected, false);
  assert.equal(karte.shadowRoot.activeElement, karte._tap, 'Fokus zurück auf die Karte');
});

// ── M42: double-load safe registration through BuschUI.register ──────────────

test('M42 Registrierung nur über BuschUI.register (kein eigenes define/push)', () => {
  const familie = QUELLE.slice(QUELLE.indexOf('/* END BUSCH SHARED UI */'));
  assert.doesNotMatch(familie, /customElements\.define\(/);
  assert.doesNotMatch(familie, /customCards\.push\(/);
  assert.equal((familie.match(/BuschUI\.register\(/g) || []).length, 3, 'Karte, Dialog, Editor');
});

test('M42 zweites Laden (zweite Ressourcen-URL): kein NotSupportedError, erste Klassen bleiben, ein Wählereintrag', () => {
  const vm = require('node:vm');
  const u = neueUmgebung();
  const ce = u.kontext.customElements;
  // Like the browser: a second define of a name throws.
  ce.define = (name, cls) => { if (u.registry.has(name)) throw new Error('NotSupportedError: ' + name); u.registry.set(name, cls); };
  const vorher = ['busch-light-card', 'busch-light-dialog', 'busch-light-card-editor'].map((n) => u.registry.get(n));
  assert.ok(vorher.every(Boolean), 'erstes Laden registriert alle drei');
  // A second copy of the module: its own module scope, same window.
  assert.doesNotThrow(() => vm.runInContext('(function () {\n' + QUELLE + '\n})();', u.kontext, { filename: 'busch-lightcards.js?v=2' }));
  assert.deepEqual(['busch-light-card', 'busch-light-dialog', 'busch-light-card-editor'].map((n) => u.registry.get(n)), vorher);
  assert.equal(u.kontext.window.customCards.filter((c) => c.type === 'busch-light-card').length, 1);
  const karte = neueKarte(u, neuesHaus({ an: true }));
  assert.equal(karte._title.textContent.length > 0, true, 'die Karte arbeitet nach dem zweiten Laden');
});
