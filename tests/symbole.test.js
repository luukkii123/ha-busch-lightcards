'use strict';
// M79 (Buschcheck W23): the render scripts draw ha-icon with the shared
// stand-in of hacs/docs/render/regeln.py (real MDI glyphs, measured by the
// contrast module as non-text contrast, 3:1) instead of their own square stub.
// Without regeln.py (CI job `contracts`) the page's own stub stays the fallback.
// The browser runs stay the evidence for the drawn pictures; this pins the wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RENDER = path.join(__dirname, '..', 'docs', 'render');
const render = fs.readFileSync(path.join(RENDER, 'render.py'), 'utf8');
const vertrag = fs.readFileSync(path.join(RENDER, 'visual_contract.py'), 'utf8');

test('M79 render.py imports the shared stand-in with the other regeln helpers', () => {
  const imp = render.match(/from regeln import \(([^)]*)\)/);
  assert.ok(imp, 'regeln import block missing');
  assert.match(imp[1], /\bha_icon_attrappe\b/);
  assert.match(imp[1], /\bha_icon_fehlend\b/);
});

test('M79 both scripts install the shared ha-icon right after chromium.launch', () => {
  for (const [name, src] of [['render.py', render], ['visual_contract.py', vertrag]]) {
    const launches = src.match(/\n( *)(\w+) = \w+\.chromium\.launch\([^\n]*\n\1([^\n]*)/g) || [];
    assert.ok(launches.length >= 1, name + ': no chromium.launch found');
    for (const block of launches) {
      const browser = block.match(/(\w+) = \w+\.chromium\.launch/)[1];
      assert.match(block, new RegExp('ha_icon_einbinden\\(' + browser + '\\)'), name + ': ' + block.trim());
    }
  }
});

test('M79 the helper uses regeln.ha_icon_attrappe only when regeln.py is there', () => {
  const fn = render.match(/\ndef ha_icon_einbinden\(browser\):[\s\S]*?\n(?=\S)/);
  assert.ok(fn, 'ha_icon_einbinden missing in render.py');
  assert.match(fn[0], /if REGELN_DA:\s*\n\s*ha_icon_attrappe\(browser\)/);
  assert.match(vertrag, /from render import [^\n]*\bha_icon_einbinden\b/);
});

test('M79 the page keeps its own stub as the CI fallback', () => {
  assert.match(render, /customElements\.define\('ha-icon', HaIconStub\)/);
});

test('M79 render.py checks real glyphs, no missing names and measured symbols', () => {
  assert.match(render, /report\["haIcon"\]\s*=\s*ha_icon_urteil\(ha_icon_fehlend\(page\), page\.evaluate\(GLYPHEN_JS\)\)/);
  // J (#1329): only names of another icon set (hue:…) leave `fehlend`; every missing mdi: name still fails.
  assert.match(render, /"fehlend": \[n for n in alle if n\.startswith\("mdi:"\)\]/);
  assert.match(render, /else if \(name\.startsWith\('fehlt:mdi:'\)\) ersatz\+\+/);
  assert.match(render, /check\("M79 shared ha-icon draws real MDI glyphs/);
  assert.match(render, /check\("M79 contrast runs measured icon glyphs at 3:1/);
});
