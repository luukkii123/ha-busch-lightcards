'use strict';
// #712 Hue-Optik: ganze Karte in den Lichtfarben, Textfarbe je Hintergrund,
// Aus-Zustand mit off_color/off_shadow, Dialog in Lichtfarbe.
const test = require('node:test');
const assert = require('node:assert');
const { neueUmgebung, neuesHaus, neueKarte, licht, gruppe } = require('./attrappe.js');

const AA = 4.5; // WCAG 2.2 AA, normaler Text
const intern = (u) => u.registry.get('busch-light-card').__internals;
const rgb = (r, g, b) => ({ r, g, b, a: 1 });
const ausCss = (css) => {
  const m = String(css).match(/rgba?\(([^)]+)\)/);
  const [r, g, b] = m[1].split(',').map(Number);
  return rgb(r, g, b);
};
const stopsAus = (css) => (String(css).match(/rgba?\([^)]+\)/g) || []).map(ausCss);

/** Wohnzimmer mit drei Lampen in frei wählbaren Farben (null = aus). */
function farbHaus(farben) {
  const haus = neuesHaus({ an: true });
  const ids = ['light.decke_1', 'light.decke_2', 'light.steh'];
  const neu = {};
  ids.forEach((id, i) => {
    const f = farben[i];
    const s = licht(id, f !== null && f !== undefined);
    if (f) {
      s.attributes = Object.assign({}, s.attributes, f.kelvin
        ? { color_mode: 'color_temp', color_temp_kelvin: f.kelvin }
        : { color_mode: 'rgb', rgb_color: f });
      delete (f.kelvin ? s.attributes.rgb_color : s.attributes.color_temp_kelvin);
    }
    neu[id] = s;
  });
  const an = farben.some((f) => f);
  neu['light.decke'] = gruppe('light.decke', ['light.decke_1', 'light.decke_2'], an);
  neu['light.wohnzimmer'] = gruppe('light.wohnzimmer', ['light.decke', 'light.steh'], an);
  haus.setze(neu);
  return haus;
}

// ── reine Farbrechnung ─────────────────────────────────────────────────────
test('Kontrastquote nach WCAG: Weiß/Schwarz 21:1, gleiche Farbe 1:1', () => {
  const I = intern(neueUmgebung());
  assert.ok(Math.abs(I.contrastRatio(rgb(255, 255, 255), rgb(0, 0, 0)) - 21) < 0.01);
  assert.ok(Math.abs(I.contrastRatio(rgb(90, 90, 90), rgb(90, 90, 90)) - 1) < 1e-9);
  // Gelb ist hell: weißer Text fällt durch, dunkler besteht
  assert.ok(I.contrastRatio(rgb(255, 255, 255), rgb(255, 255, 0)) < 1.1);
});

test('helle Lichtfarben (Gelb, Weiß, Kaltweiß, Warmweiß) bekommen dunklen Text mit ≥ 4,5:1', () => {
  const I = intern(neueUmgebung());
  const hell = {
    gelb: rgb(255, 255, 0), weiss: rgb(255, 255, 255),
    kaltweiss: rgb(...I.tempToRgb(6500)), warmweiss: rgb(...I.tempToRgb(2700)),
    vorgabe: I.parseColor('#ffda95'),
  };
  for (const [name, farbe] of Object.entries(hell)) {
    const f = I.readableSurface([farbe]);
    assert.equal(f.fg, 'dark', name);
    assert.ok(f.ratio >= AA, `${name}: ${f.ratio}`);
    assert.ok(I.contrastRatio(f.text, f.colors[0]) >= AA, name);
  }
});

test('kräftige Farben bekommen hellen Text, nötigenfalls leicht abgedunkelt', () => {
  const I = intern(neueUmgebung());
  for (const farbe of [rgb(88, 120, 255), rgb(255, 92, 168), rgb(255, 0, 0), rgb(128, 0, 200)]) {
    const f = I.readableSurface([farbe]);
    assert.equal(f.fg, 'light', JSON.stringify(farbe));
    assert.ok(I.contrastRatio(f.text, f.colors[0]) >= AA, JSON.stringify(f));
    // gleicher Farbton, nur dunkler – keine fremde Farbe
    assert.ok(Math.abs(I.rgb2hsv(f.colors[0].r, f.colors[0].g, f.colors[0].b)[0]
      - I.rgb2hsv(farbe.r, farbe.g, farbe.b)[0]) < 3);
  }
});

test('Verlauf aus Gelb und Blau: jede Stufe hält den Kontrast zur gewählten Textfarbe', () => {
  const I = intern(neueUmgebung());
  const f = I.readableSurface([rgb(255, 230, 0), rgb(40, 60, 200), rgb(255, 92, 168)]);
  assert.equal(f.colors.length, 3);
  for (const stufe of f.colors) assert.ok(I.contrastRatio(f.text, stufe) >= AA, JSON.stringify(stufe));
  assert.ok(f.ratio >= AA);
});

test('Kachel mit Abdunklung: Kontrast hält auf hellem und abgedunkeltem Teil', () => {
  const I = intern(neueUmgebung());
  for (const farbe of [rgb(255, 180, 55), rgb(255, 255, 255), rgb(120, 200, 90), rgb(88, 120, 255)]) {
    const f = I.readableSurface([farbe], { shade: I.TILE_SHADE });
    const c = f.colors[0];
    const dunkel = rgb(c.r * I.TILE_SHADE, c.g * I.TILE_SHADE, c.b * I.TILE_SHADE);
    assert.ok(I.contrastRatio(f.text, c) >= AA, JSON.stringify(f));
    assert.ok(I.contrastRatio(f.text, dunkel) >= AA, 'abgedunkelt ' + JSON.stringify(f));
  }
});

test('off_color wird nicht verändert, nur die Textfarbe gewählt', () => {
  const I = intern(neueUmgebung());
  const dunkel = I.readableSurface([I.parseColor('#112233')], { adjust: false });
  assert.deepEqual([dunkel.fg, dunkel.colors[0].r, dunkel.colors[0].g, dunkel.colors[0].b], ['light', 17, 34, 51]);
  const hell = I.readableSurface([I.parseColor('#ffffff')], { adjust: false });
  assert.equal(hell.fg, 'dark');
  assert.ok(hell.ratio >= AA);
});

// ── Karte ──────────────────────────────────────────────────────────────────
test('Karte an mit mehreren Farben: ganze Karte als Verlauf, Text lesbar', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const haus = farbHaus([[255, 0, 0], [40, 60, 220], [150, 0, 200]]);
  const karte = neueKarte(u, haus);
  const bg = karte.style.getPropertyValue('--blc-background');
  assert.match(bg, /^linear-gradient\(/, 'Verlauf über die Lichtfarben');
  const stufen = stopsAus(bg);
  assert.ok(stufen.length >= 3);
  const text = ausCss(karte.style.getPropertyValue('--blc-text-color'));
  for (const s of stufen) assert.ok(I.contrastRatio(text, s) >= AA, JSON.stringify(s));
  assert.ok(karte._card.classList.contains('lit'));
  assert.ok(karte._card.classList.contains('fg-light'));
  assert.ok(karte._card.classList.contains('hue-borders'), 'hue_borders bleibt Vorgabe');
});

test('Karte an mit einer Farbe: flache Lichtfarbe; Warmweiß → dunkler Text', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const haus = farbHaus([{ kelvin: 2700 }, { kelvin: 2700 }, null]);
  const karte = neueKarte(u, haus);
  const bg = karte.style.getPropertyValue('--blc-background');
  assert.match(bg, /^rgb\(/, 'gleiche Farben → keine Verlaufsstufen');
  assert.ok(karte._card.classList.contains('fg-dark'));
  const text = ausCss(karte.style.getPropertyValue('--blc-text-color'));
  assert.ok(I.contrastRatio(text, ausCss(bg)) >= AA);
});

test('Lampe ohne eigene Farbe nutzt default_color', () => {
  const u = neueUmgebung();
  const haus = neuesHaus({ an: true });
  const ohne = (id) => ({ entity_id: id, state: 'on', attributes: { friendly_name: id, supported_color_modes: ['brightness'], color_mode: 'brightness', brightness: 200 } });
  haus.setze({ 'light.decke_1': ohne('light.decke_1'), 'light.decke_2': ohne('light.decke_2'), 'light.steh': ohne('light.steh') });
  const karte = neueKarte(u, haus, { default_color: '#3050c0' });
  assert.equal(stopsAus(karte.style.getPropertyValue('--blc-background')).length, 1);
  assert.ok(karte._card.classList.contains('fg-light'));
});

test('Karte aus: Themahintergrund, kein Licht-Zustand, off_shadow schaltbar', () => {
  const u = neueUmgebung();
  const karte = neueKarte(u, neuesHaus({ an: false }));
  assert.equal(karte.style.getPropertyValue('--blc-background'), 'var(--card-background-color)');
  assert.equal(karte.style.getPropertyValue('--blc-text-color'), 'var(--primary-text-color)');
  assert.ok(!karte._card.classList.contains('lit'));
  assert.match(karte.style.getPropertyValue('--blc-shadow'), /^inset /, 'off_shadow Vorgabe an');
  const ohne = neueKarte(u, neuesHaus({ an: false }), { off_shadow: false });
  assert.equal(ohne.style.getPropertyValue('--blc-shadow'), 'none');
});

test('Karte aus mit off_color: genau diese Farbe, Textfarbe nach Kontrast', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const dunkel = neueKarte(u, neuesHaus({ an: false }), { off_color: '#112233' });
  assert.equal(dunkel.style.getPropertyValue('--blc-background'), 'rgb(17, 34, 51)');
  assert.ok(dunkel._card.classList.contains('tinted') && dunkel._card.classList.contains('fg-light'));
  const hell = neueKarte(u, neuesHaus({ an: false }), { off_color: '#eeeeee' });
  const text = ausCss(hell.style.getPropertyValue('--blc-text-color'));
  assert.ok(I.contrastRatio(text, rgb(238, 238, 238)) >= AA, 'vorher rgba(0,0,0,.5) = 3,9:1');
});

test('Hintergrund wird nur bei eigener Farbänderung neu gesetzt', () => {
  const u = neueUmgebung();
  const haus = farbHaus([[255, 0, 0], [40, 60, 220], null]);
  const karte = neueKarte(u, haus);
  let schreiben = 0;
  let wert = karte.style['--blc-background'];
  const sp = karte.style.setProperty;
  karte.style.setProperty = (k, v) => { if (k === '--blc-background') schreiben++; sp(k, v); };
  for (let i = 0; i < 5; i++) karte.hass = haus.fremd();
  assert.equal(schreiben, 0, 'fremde Updates schreiben nichts');
  // eigene Änderung ohne neue Farbe (nur Helligkeit): Verlauf bleibt stehen
  const s = JSON.parse(JSON.stringify(haus.states['light.decke_1']));
  s.attributes.brightness = 90;
  karte.hass = haus.setze({ 'light.decke_1': s });
  assert.equal(schreiben, 0, 'gleiche Farben → kein neuer Verlauf');
  const t = JSON.parse(JSON.stringify(haus.states['light.decke_1']));
  t.attributes.rgb_color = [0, 160, 80];
  karte.hass = haus.setze({ 'light.decke_1': t });
  assert.equal(schreiben, 1, 'neue Farbe → genau ein neuer Verlauf');
  assert.notEqual(karte.style['--blc-background'], wert);
});

test('Regler: Wert über transform, nicht über Breite', () => {
  const u = neueUmgebung();
  const karte = neueKarte(u, neuesHaus({ an: true }));
  assert.equal(karte._sliderFill.style.transform, 'scaleX(0.8)');
  assert.equal(karte._sliderFill.style.width || '', '');
});

// ── Dialog ─────────────────────────────────────────────────────────────────
test('Dialog: Kopf in Lichtfarbe, Kacheln und Szenen in ihrer Farbe, Text lesbar', () => {
  const u = neueUmgebung();
  const I = intern(u);
  const haus = farbHaus([[255, 230, 0], [40, 60, 220], { kelvin: 6500 }]);
  haus.setze({ 'scene.abend': { entity_id: 'scene.abend', state: 'scening', attributes: { friendly_name: 'Abend' } } });
  const karte = neueKarte(u, haus, { scenes: [{ entity: 'scene.abend', color: '#ff5ca8' }, { entity: 'scene.weiss', color: '#ffffff' }] });
  karte._openDialog();
  const sheet = karte._dialog._sheet;
  const kopf = sheet.querySelector('.head');
  assert.ok(kopf.classList.contains('lit'), 'Kopf in Lichtfarbe');
  const kopfText = ausCss(kopf.style.color);
  for (const s of stopsAus(kopf.style.background)) assert.ok(I.contrastRatio(kopfText, s) >= AA);

  const szenen = sheet.querySelectorAll('.scene');
  assert.equal(szenen.length, 2);
  const abend = szenen[0];
  assert.ok(I.contrastRatio(ausCss(abend.style.color), ausCss(abend.style.background)) >= AA);
  const hsvA = I.rgb2hsv(...['r', 'g', 'b'].map((k) => ausCss(abend.style.background)[k]));
  assert.ok(Math.abs(hsvA[0] - I.rgb2hsv(255, 92, 168)[0]) < 3, 'Szenenkachel in Szenenfarbe');

  const kacheln = sheet.querySelectorAll('.tile');
  assert.equal(kacheln.length, 3);
  for (const k of kacheln) {
    const bg = ausCss(k.style.background);
    const fg = ausCss(k.style.color);
    const dunkel = rgb(bg.r * I.TILE_SHADE, bg.g * I.TILE_SHADE, bg.b * I.TILE_SHADE);
    assert.ok(I.contrastRatio(fg, bg) >= AA && I.contrastRatio(fg, dunkel) >= AA, k.style.background);
  }
});

test('Dialog aus: Kopf ohne Lichtfarbe', () => {
  const u = neueUmgebung();
  const karte = neueKarte(u, neuesHaus({ an: false }));
  karte._openDialog();
  const kopf = karte._dialog._sheet.querySelector('.head');
  assert.ok(!kopf.classList.contains('lit'));
  assert.equal(kopf.style.background || '', '');
});

test('Kachelschalter auf heller Kachel: dunklere Spur wie auf der Karte', () => {
  const u = neueUmgebung();
  const css = u.registry.get('busch-light-dialog') && require('node:fs')
    .readFileSync(require('node:path').join(__dirname, '..', 'dist', 'busch-lightcards.js'), 'utf8');
  assert.match(css, /\.tile\.lit\.fg-dark \.tsw\.on \{ background: rgba\(0, 0, 0, 0\.62\); \}/);
  const haus = farbHaus([{ kelvin: 6500 }, null, null]);
  const karte = neueKarte(u, haus);
  karte._openDialog();
  const hell = karte._dialog._sheet.querySelectorAll('.tile').find((k) => k.classList.contains('lit'));
  assert.ok(hell.classList.contains('fg-dark'), 'Kaltweiß-Kachel trägt fg-dark');
});
