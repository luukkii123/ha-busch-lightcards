#!/usr/bin/env python3
"""
Renders and tests dist/busch-lightcards.js in real Chromium.

Two jobs in one run, because both need a browser:

  1. Assertions against the card's own logic (group resolution, unavailable
     handling, service-call routing), driven through BuschLightCard.__internals
     so the claims are about the shipped code and not a re-implementation.
  2. Screenshots of the card and its dialog for the README.

The file is served over HTTP rather than loaded via file://, so that any
attempt to pull in a sub-resource would show up as a real 404. Every network
request, console error and page error lands in report.json.

Usage:
    render.py <path/busch-lightcards.js> <output-dir> [width]

On the Unraid server this has to run inside the Playwright container; the
locally installed Chromium is missing libnspr4/libnss3. See the repository
README for the exact docker run line.
"""

import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent


def serve(directory, port_holder):
    handler_cls = http.server.SimpleHTTPRequestHandler

    class Handler(handler_cls):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(directory), **kwargs)

        def log_message(self, *args):
            pass

    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port_holder.append(httpd.server_address[1])
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd


PAGE = """<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<style>
  :root {
    --card-background-color: #ffffff;
    --primary-text-color: #212121;
    --secondary-text-color: #727272;
    --primary-color: #03a9f4;
    --divider-color: #e0e0e0;
    --error-color: #db4437;
    --ha-card-border-radius: 12px;
  }
  body {
    margin: 0;
    padding: 24px;
    background: #f2f4f7;
    font-family: Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .stack { display: flex; flex-direction: column; gap: 16px; max-width: __WIDTH__px; }
</style>
</head><body>
<div class="stack" id="stack"></div>
<script>
  // --- stubs for the two Home Assistant elements the card uses -------------
  window.__iconsAsked = [];

  class HaCardStub extends HTMLElement {
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:block;border-radius:var(--ha-card-border-radius,12px);' +
        'background:var(--card-background-color);color:var(--primary-text-color);}</style><slot></slot>';
    }
  }
  customElements.define('ha-card', HaCardStub);

  // ha-form is loaded lazily by the real frontend. The stub honours the same
  // contract the editor relies on: hass/schema/data/computeLabel in, a
  // 'value-changed' event carrying the full data object out. It proves the
  // editor's wiring, NOT that Home Assistant's own ha-form renders it.
  class HaFormStub extends HTMLElement {
    constructor() { super(); this._schema = []; this._data = {}; }
    set hass(v) { this._hass = v; }
    get hass() { return this._hass; }
    set schema(v) { this._schema = v; this._paint(); }
    get schema() { return this._schema; }
    set data(v) { this._data = v; this._paint(); }
    get data() { return this._data; }
    set computeLabel(fn) { this._computeLabel = fn; this._paint(); }
    get computeLabel() { return this._computeLabel; }
    /** Flattens grid wrappers, the way the real element does. */
    fields() {
      const out = [];
      const walk = (items) => (items || []).forEach(item => {
        if (item.type === 'grid') walk(item.schema);
        else if (item.name) out.push(item);
      });
      walk(this._schema);
      return out;
    }
    _paint() {
      if (!this._computeLabel) return;
      this.textContent = this.fields()
        .map(f => this._computeLabel(f) + ': ' + JSON.stringify(this._data[f.name]))
        .join('\\n');
    }
    /** Simulates the user changing one field. */
    change(patch) {
      this.dispatchEvent(new CustomEvent('value-changed', {
        detail: { value: Object.assign({}, this._data, patch) },
        bubbles: true, composed: true
      }));
    }
  }
  customElements.define('ha-form', HaFormStub);

  class HaIconStub extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:inline-block;width:var(--mdc-icon-size,24px);' +
        'height:var(--mdc-icon-size,24px);vertical-align:middle;}' +
        'i{display:block;width:100%;height:100%;border-radius:22%;background:currentColor;opacity:.85;}' +
        '</style><i></i>';
    }
    attributeChangedCallback(name, _old, value) {
      if (name === 'icon' && value) window.__iconsAsked.push(value);
    }
  }
  customElements.define('ha-icon', HaIconStub);

  // --- a fake hass --------------------------------------------------------
  window.__serviceCalls = [];
  window.makeHass = function (states) {
    return {
      language: 'de',
      themes: {},
      states: states,
      callService: function (domain, service, data) {
        window.__serviceCalls.push({ domain: domain, service: service, data: data });
        return Promise.resolve();
      }
    };
  };
</script>
<script type="module" src="__SRC__"></script>
</body></html>
"""


def deep_merge(base, override):
    """Merges the scenario overrides onto the captured states."""
    out = json.loads(json.dumps(base))
    for entity_id, patch in override.items():
        if entity_id.startswith("_"):
            continue
        if entity_id not in out:
            out[entity_id] = json.loads(json.dumps(patch))
            continue
        if "attributes" in patch and "state" in patch and "entity_id" not in patch.get("attributes", {}):
            # An unavailable group replaces its attribute set wholesale — that
            # is the point of the group_down scenario.
            if patch.get("state") == "unavailable":
                out[entity_id] = json.loads(json.dumps(patch))
                continue
        merged = out[entity_id]
        for key, value in patch.items():
            if key == "attributes":
                merged.setdefault("attributes", {}).update(value)
            else:
                merged[key] = value
    return out


def with_entity_ids(states):
    """Home Assistant states carry their own entity_id; the fixture keys them."""
    out = {}
    for entity_id, body in states.items():
        record = json.loads(json.dumps(body))
        record["entity_id"] = entity_id
        record.setdefault("attributes", {})
        out[entity_id] = record
    return out


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    card_file = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve()
    width = int(sys.argv[3]) if len(sys.argv) > 3 else 620
    out_dir.mkdir(parents=True, exist_ok=True)

    fixture = json.loads((HERE / "fixture.json").read_text(encoding="utf-8"))

    base_states = with_entity_ids(fixture["states"])
    lit_states = with_entity_ids(deep_merge(fixture["states"], fixture["overrides"]["lit"]))
    down_states = with_entity_ids(deep_merge(fixture["states"], fixture["overrides"]["group_down"]))

    # serve the repository root so /dist/... resolves the way HACS serves it
    repo_root = card_file.parent.parent
    ports = []
    httpd = serve(repo_root, ports)
    port = ports[0]
    src = f"http://127.0.0.1:{port}/dist/{card_file.name}"

    report = {
        "cardFile": str(card_file),
        "servedFrom": src,
        "requests": [],
        "badResponses": [],
        "requestFailures": [],
        "consoleErrors": [],
        "pageErrors": [],
        "checks": [],
        "screenshots": [],
    }

    def check(name, passed, detail=""):
        report["checks"].append({"name": name, "pass": bool(passed), "detail": detail})

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": width + 48, "height": 900},
                                device_scale_factor=2, locale="de-DE")

        page.on("request", lambda r: report["requests"].append(r.url))
        page.on("response", lambda r: report["badResponses"].append({"url": r.url, "status": r.status})
                if r.status >= 400 else None)
        page.on("requestfailed", lambda r: report["requestFailures"].append(
            {"url": r.url, "error": r.failure}))
        page.on("console", lambda m: report["consoleErrors"].append(m.text)
                if m.type == "error" else None)
        page.on("pageerror", lambda e: report["pageErrors"].append(str(e)))

        # The harness page is served over HTTP too. Loaded via set_content it
        # would sit on about:blank, and a module script from http:// does not
        # load into an opaque origin — the card would silently never register.
        html = PAGE.replace("__SRC__", f"/dist/{card_file.name}").replace("__WIDTH__", str(width))
        harness = out_dir / "harness.html"
        harness.write_text(html, encoding="utf-8")
        harness_url = f"http://127.0.0.1:{port}/{harness.relative_to(repo_root).as_posix()}"
        report["harnessUrl"] = harness_url
        page.goto(harness_url)
        page.wait_for_function("() => !!customElements.get('busch-light-card')", timeout=15000)

        internals = "customElements.get('busch-light-card').__internals"

        # ------------------------------------------------------------------
        # 1. Recursive resolution against real captured membership
        # ------------------------------------------------------------------
        resolution = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                const hass = window.makeHass(states);
                return I.resolveEntities(hass, [{json.dumps(fixture['root'])}], {{}});
            }}""",
            base_states,
        )
        report["resolution"] = resolution
        expected = fixture["expected"]

        check("leaves match hand-derived expectation",
              resolution["leaves"] == expected["leaves"],
              f"got {resolution['leaves']}")
        check("groups match hand-derived expectation",
              resolution["groups"] == expected["groups"],
              f"got {resolution['groups']}")
        check("walked to the expected depth",
              resolution["maxDepth"] == expected["maxDepth"],
              f"maxDepth={resolution['maxDepth']}")

        # The raw member lists add up to more entries than the leaf count:
        # that difference is exactly what deduplication removes.
        raw_total = sum(
            len(base_states[g]["attributes"].get("entity_id", []))
            for g in expected["groups"]
        )
        check("duplicates across branches collapsed",
              len(resolution["leaves"]) == 6 and raw_total > 6,
              f"{raw_total} raw member entries -> {len(resolution['leaves'])} leaves")

        # ------------------------------------------------------------------
        # 2. The upstream behaviour, for contrast: no resolution at all
        # ------------------------------------------------------------------
        flat = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                return I.resolveEntities(window.makeHass(states),
                    [{json.dumps(fixture['root'])}], {{ resolveGroups: false }});
            }}""",
            base_states,
        )
        check("resolve_groups:false keeps the group as a single entity",
              flat["leaves"] == [fixture["root"]],
              f"got {flat['leaves']}")

        # ------------------------------------------------------------------
        # 3. Cycle, missing entity, foreign domain, depth limit
        # ------------------------------------------------------------------
        edge = page.evaluate(
            f"""() => {{
                const I = {internals};
                const out = {{}};

                // a) cycle A -> B -> A
                I.clearMemberCache();
                const cyc = window.makeHass({{
                    'light.a': {{ entity_id: 'light.a', state: 'on',
                        attributes: {{ entity_id: ['light.b', 'light.leaf'] }} }},
                    'light.b': {{ entity_id: 'light.b', state: 'on',
                        attributes: {{ entity_id: ['light.a', 'light.leaf2'] }} }},
                    'light.leaf': {{ entity_id: 'light.leaf', state: 'on', attributes: {{}} }},
                    'light.leaf2': {{ entity_id: 'light.leaf2', state: 'on', attributes: {{}} }}
                }});
                out.cycle = I.resolveEntities(cyc, ['light.a'], {{}});

                // b) self-reference
                I.clearMemberCache();
                const self = window.makeHass({{
                    'light.selfie': {{ entity_id: 'light.selfie', state: 'on',
                        attributes: {{ entity_id: ['light.selfie'] }} }}
                }});
                out.selfRef = I.resolveEntities(self, ['light.selfie'], {{}});

                // c) member missing from the state machine entirely
                I.clearMemberCache();
                const gone = window.makeHass({{
                    'light.grp': {{ entity_id: 'light.grp', state: 'on',
                        attributes: {{ entity_id: ['light.here', 'light.deleted'] }} }},
                    'light.here': {{ entity_id: 'light.here', state: 'on', attributes: {{}} }}
                }});
                out.missing = I.resolveEntities(gone, ['light.grp'], {{}});
                const gm = new I.GroupModel(gone, I.normalizeConfig({{ entity: 'light.grp' }}));
                out.missingModel = {{
                    lights: gm.lights.length, alive: gm.total, dead: gm.deadCount,
                    isOn: gm.isOn, description: gm.description
                }};

                // d) group.* with members this card cannot switch
                I.clearMemberCache();
                const mixed = window.makeHass({{
                    'group.mixed': {{ entity_id: 'group.mixed', state: 'on',
                        attributes: {{ entity_id: ['light.ok', 'device_tracker.phone',
                                                   'person.someone', 'switch.plug'] }} }},
                    'light.ok': {{ entity_id: 'light.ok', state: 'on', attributes: {{}} }},
                    'switch.plug': {{ entity_id: 'switch.plug', state: 'off', attributes: {{}} }},
                    'device_tracker.phone': {{ entity_id: 'device_tracker.phone', state: 'home', attributes: {{}} }},
                    'person.someone': {{ entity_id: 'person.someone', state: 'home', attributes: {{}} }}
                }});
                out.mixed = I.resolveEntities(mixed, ['group.mixed'], {{}});

                // e) depth limit
                I.clearMemberCache();
                const deep = {{}};
                for (let i = 0; i < 6; i++) {{
                    deep['light.l' + i] = {{ entity_id: 'light.l' + i, state: 'on',
                        attributes: {{ entity_id: ['light.l' + (i + 1)] }} }};
                }}
                deep['light.l6'] = {{ entity_id: 'light.l6', state: 'on', attributes: {{}} }};
                const deepHass = window.makeHass(deep);
                out.deepFull = I.resolveEntities(deepHass, ['light.l0'], {{}});
                I.clearMemberCache();
                out.deepCapped = I.resolveEntities(deepHass, ['light.l0'], {{ maxDepth: 3 }});

                return out;
            }}"""
        )
        report["edgeCases"] = edge

        check("cycle terminates and yields both leaves",
              sorted(edge["cycle"]["leaves"]) == ["light.leaf", "light.leaf2"],
              f"got {edge['cycle']['leaves']}")
        check("self-referencing group becomes a leaf",
              edge["selfRef"]["leaves"] == ["light.selfie"],
              f"got {edge['selfRef']['leaves']}")
        check("member missing from states is kept as an unavailable leaf",
              edge["missing"]["leaves"] == ["light.here", "light.deleted"]
              and edge["missingModel"]["lights"] == 2
              and edge["missingModel"]["alive"] == 1
              and edge["missingModel"]["dead"] == 1,
              json.dumps(edge["missingModel"]))
        check("non-switchable domains dropped from a group.*",
              edge["mixed"]["leaves"] == ["light.ok", "switch.plug"]
              and sorted(edge["mixed"]["dropped"]) == ["device_tracker.phone", "person.someone"],
              f"leaves={edge['mixed']['leaves']} dropped={edge['mixed']['dropped']}")
        check("deep chain fully resolved by default",
              edge["deepFull"]["leaves"] == ["light.l6"] and edge["deepFull"]["maxDepth"] == 6,
              f"got {edge['deepFull']['leaves']} depth={edge['deepFull']['maxDepth']}")
        check("max_depth stops and reports instead of silently truncating",
              edge["deepCapped"]["leaves"] == ["light.l3"]
              and edge["deepCapped"]["truncated"] == ["light.l3"],
              json.dumps(edge["deepCapped"]))

        # ------------------------------------------------------------------
        # 4. The unavailable-group memory
        # ------------------------------------------------------------------
        down = page.evaluate(
            f"""(payload) => {{
                const I = {internals};
                I.clearMemberCache();
                const root = payload.root;

                // Cold start with the group already unavailable: nothing to
                // remember yet, so it can only be a leaf.
                const cold = I.resolveEntities(window.makeHass(payload.down), [root], {{}});

                // Now the normal case: seen alive once, then it drops out.
                I.clearMemberCache();
                const warm1 = I.resolveEntities(window.makeHass(payload.base), [root], {{}});
                const warm2 = I.resolveEntities(window.makeHass(payload.down), [root], {{}});

                const model = new I.GroupModel(window.makeHass(payload.down),
                    I.normalizeConfig({{ entity: root }}));
                return {{
                    coldLeaves: cold.leaves,
                    warmBefore: warm1.leaves,
                    warmAfter: warm2.leaves,
                    recovered: warm2.recovered,
                    deadCount: model.deadCount,
                    total: model.total
                }};
            }}""",
            {"root": fixture["root"], "base": base_states, "down": down_states},
        )
        report["groupDown"] = down

        check("unavailable group without memory degrades to a single leaf",
              "light.kinderzimmerspots" in down["coldLeaves"]
              and "light.kinderzimmer_spot_2" not in down["coldLeaves"],
              f"got {down['coldLeaves']}")
        check("remembered membership survives the group going unavailable",
              down["warmAfter"] == down["warmBefore"],
              f"before={down['warmBefore']} after={down['warmAfter']}")
        check("recovered groups are named, not hidden",
              down["recovered"] == ["light.kinderzimmerspots"],
              f"got {down['recovered']}")

        # ------------------------------------------------------------------
        # 5. Aggregation and service-call routing skip the dead
        # ------------------------------------------------------------------
        agg = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                window.__serviceCalls = [];
                const hass = window.makeHass(states);
                const config = I.normalizeConfig({{ entity: {json.dumps(fixture['root'])} }});
                const m = new I.GroupModel(hass, config);
                const before = {{
                    lights: m.lights.length, alive: m.total, dead: m.deadCount,
                    on: m.onLights.length, brightness: m.brightnessPct,
                    isOn: m.isOn, description: m.description,
                    deadNames: m.dead.map(l => l.entityId)
                }};
                m.turnOn();
                m.setBrightness(40);
                m.setKelvin(3000);
                return {{ before: before, calls: window.__serviceCalls }};
            }}""",
            lit_states,
        )
        report["aggregate"] = agg
        before = agg["before"]

        check("unavailable leaf counted separately, not as off",
              before["lights"] == 6 and before["alive"] == 5 and before["dead"] == 1
              and before["deadNames"] == ["light.hubschrauberlampe"],
              json.dumps(before))
        # 214,168,190,120 of 255 -> 84,66,75,47 percent -> mean 68
        check("brightness is the average of the lit, reachable members",
              before["brightness"] == 68,
              f"brightness={before['brightness']}, expected mean of 84/66/75/47 = 68")
        check("description counts reachable members only",
              before["description"] == "4 von 5 an",
              f"got {before['description']!r}")

        turn_on = [c for c in agg["calls"] if c["service"] == "turn_on"]
        all_targets = []
        for call in turn_on:
            target = call["data"]["entity_id"]
            all_targets.extend(target if isinstance(target, list) else [target])
        check("no service call ever targets the unavailable entity",
              "light.hubschrauberlampe" not in all_targets,
              f"targets={sorted(set(all_targets))}")
        bright_calls = [c for c in agg["calls"] if c["data"].get("brightness_pct") is not None]
        check("brightness goes to the lit members only, as the Hue app does",
              len(bright_calls) == 1
              and sorted(bright_calls[0]["data"]["entity_id"]) == [
                  "light.kinderzimmer_spot_2", "light.kinderzimmer_spot_3",
                  "light.ledstreifen_kinderzimm", "light.vorhang"],
              json.dumps(bright_calls))

        # every member unreachable -> controls off, but no crash
        allgone = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                const dead = JSON.parse(JSON.stringify(states));
                Object.keys(dead).forEach(k => {{ if (k.startsWith('light.')) dead[k].state = 'unavailable'; }});
                const m = new I.GroupModel(window.makeHass(dead),
                    I.normalizeConfig({{ entity: {json.dumps(fixture['root'])} }}));
                return {{ allDead: m.isAllUnavailable, empty: m.isEmpty,
                          desc: m.description, total: m.total, lights: m.lights.length }};
            }}""",
            base_states,
        )
        report["allUnavailable"] = allgone
        check("all members unreachable is a state, not an exception",
              allgone["allDead"] is True and allgone["lights"] > 0
              and allgone["desc"] == "Keine Lampe erreichbar",
              json.dumps(allgone))

        # ------------------------------------------------------------------
        # 6. Render the card and read back what it actually shows
        # ------------------------------------------------------------------
        def build_card(states, scenario, scenes=True):
            return page.evaluate(
                """(payload) => {
                    const stack = document.getElementById('stack');
                    stack.innerHTML = '';
                    const card = document.createElement('busch-light-card');
                    const config = { type: 'custom:busch-light-card', entity: payload.root };
                    if (payload.scenes) config.scenes = payload.scenes;
                    card.setConfig(config);
                    stack.appendChild(card);
                    const hass = window.makeHass(payload.states);
                    card.hass = hass;
                    card.hass = hass;   // second pass so the shadow can be measured
                    const sr = card.shadowRoot;
                    return {
                        title: sr.querySelector('.text h2').textContent,
                        desc: sr.querySelector('.desc span').textContent,
                        warnVisible: sr.querySelector('.warn').style.display !== 'none',
                        warnText: sr.querySelector('.warn span:last-child').textContent,
                        warnTitle: sr.querySelector('.warn').title,
                        icon: sr.querySelector('.icon').getAttribute('icon'),
                        fill: sr.querySelector('.slider .fill').style.width,
                        sliderLabel: sr.querySelector('.slider .label').textContent,
                        background: getComputedStyle(card).getPropertyValue('--blc-background').trim(),
                        toggleOn: sr.querySelector('.toggle').classList.contains('on')
                    };
                }""",
                {"root": fixture["root"], "states": states,
                 "scenes": fixture["scenesConfig"] if scenes else None},
            )

        card_off = build_card(base_states, "off")
        report["cardOff"] = card_off
        check("card names the group and its own icon",
              card_off["title"] == "LD Kinderzimmer Alle Lichter"
              and card_off["icon"] == "mdi:lightbulb-group",
              json.dumps(card_off))
        check("off card says all off over the reachable members",
              card_off["desc"] == "Alle aus", f"got {card_off['desc']!r}")
        check("badge names the unreachable member by name",
              card_off["warnVisible"] and card_off["warnText"] == "1"
              and "Hubschrauber Lampe" in card_off["warnTitle"],
              json.dumps({"text": card_off["warnText"], "title": card_off["warnTitle"]}))
        page.wait_for_timeout(400)
        shot = out_dir / "card-off.png"
        page.locator("busch-light-card").screenshot(path=str(shot))
        report["screenshots"].append(shot.name)

        card_lit = build_card(lit_states, "lit")
        report["cardLit"] = card_lit
        check("lit card shows the mixed count and a colour gradient",
              card_lit["desc"] == "4 von 5 an"
              and card_lit["background"].startswith("linear-gradient")
              and card_lit["toggleOn"] is True,
              json.dumps(card_lit))
        check("slider fill matches the reported brightness",
              card_lit["fill"] == "68%" and card_lit["sliderLabel"] == "68 %",
              json.dumps({"fill": card_lit["fill"], "label": card_lit["sliderLabel"]}))
        page.wait_for_timeout(400)
        shot = out_dir / "card-on.png"
        page.locator("busch-light-card").screenshot(path=str(shot))
        report["screenshots"].append(shot.name)

        # ------------------------------------------------------------------
        # 7. The dialog
        # ------------------------------------------------------------------
        dialog = page.evaluate(
            """() => {
                const card = document.querySelector('busch-light-card');
                card.shadowRoot.querySelector('.tap').dispatchEvent(
                    new MouseEvent('click', { bubbles: true }));
                const dlg = document.querySelector('busch-light-dialog');
                if (!dlg) return { opened: false };
                const sr = dlg.shadowRoot;
                const tiles = Array.from(sr.querySelectorAll('.tile'));
                const scenes = Array.from(sr.querySelectorAll('.scene'));
                return {
                    opened: true,
                    title: sr.querySelector('.head h1').textContent,
                    sub: sr.querySelector('.head .sub').textContent,
                    tileCount: tiles.length,
                    tileNames: tiles.map(t => t.querySelector('.tname').textContent),
                    deadTiles: tiles.filter(t => t.classList.contains('dead'))
                                    .map(t => t.querySelector('.tname').textContent),
                    sceneCount: scenes.length,
                    disabledScenes: scenes.filter(s => s.hasAttribute('disabled'))
                                          .map(s => s.textContent),
                    headings: Array.from(sr.querySelectorAll('h3')).map(h => h.textContent),
                    hasWheel: !!sr.querySelector('canvas.wheel'),
                    hasTempBar: !!sr.querySelector('.tempbar'),
                    tabs: Array.from(sr.querySelectorAll('.picker-tabs button'))
                               .map(b => b.dataset.tab),
                    // Since v0.3.0 there are two of these: the already-shown
                    // groups and the unreachable members. Take them all, so
                    // adding a third note cannot silently break the check.
                    deadNote: Array.from(sr.querySelectorAll('.deadlist'))
                        .map(n => n.textContent).join(' | '),
                    // a lit tile on a light background must not print white on white
                    litTilePct: (function () {
                        const t = tiles.find(t => (t.querySelector('.tpct').textContent || '').trim()
                                                  && getComputedStyle(t).color === 'rgb(17, 17, 17)');
                        if (!t) return null;
                        return {
                            name: t.querySelector('.tname').textContent,
                            tileColor: getComputedStyle(t).color,
                            pctColor: getComputedStyle(t.querySelector('.tpct')).color
                        };
                    })()
                };
            }"""
        )
        report["dialog"] = dialog
        check("dialog opens on tap", dialog.get("opened") is True, json.dumps(dialog)[:400])
        if dialog.get("opened"):
            check("dialog lists every resolved light, not the seven raw members",
                  dialog["tileCount"] == 6
                  and "Kinderzimmer Spot 3" in dialog["tileNames"]
                  and "Spots" not in dialog["tileNames"],
                  json.dumps(dialog["tileNames"], ensure_ascii=False))
            check("unreachable light is shown and marked, not dropped",
                  dialog["deadTiles"] == ["Hubschrauber Lampe"]
                  and "Hubschrauber Lampe" in dialog["deadNote"],
                  json.dumps({"dead": dialog["deadTiles"], "note": dialog["deadNote"]},
                             ensure_ascii=False))
            check("scene row renders, missing scene disabled rather than broken",
                  dialog["sceneCount"] == 5 and len(dialog["disabledScenes"]) == 1,
                  json.dumps(dialog["disabledScenes"], ensure_ascii=False))
            # Only one picker body exists at a time — colour is the default tab.
            # A dashboard is full of cards the dialog has to cover. Leaflet is
            # the worst offender: its panes carry z-index 400 and its controls
            # 1000, in the page's own stacking context. Asserting the number
            # would not prove much, so this puts a real interloper on the page
            # and asks the browser who is on top.
            stacking = page.evaluate(
                """() => {
                    const intruder = document.createElement('div');
                    intruder.id = 'intruder';
                    intruder.style.cssText = 'position:absolute;left:0;top:0;' +
                        'width:100vw;height:100vh;z-index:1000;background:rgba(255,0,0,0.5)';
                    document.body.appendChild(intruder);
                    const dlg = document.querySelector('busch-light-dialog');
                    const box = dlg.shadowRoot.querySelector('.sheet').getBoundingClientRect();
                    const x = Math.round(box.left + box.width / 2);
                    const y = Math.round(box.top + box.height / 2);
                    const top = document.elementFromPoint(x, y);
                    const result = {
                        zIndex: getComputedStyle(dlg).zIndex,
                        intruderZ: getComputedStyle(intruder).zIndex,
                        topmost: top ? (top.id || top.tagName.toLowerCase()) : null
                    };
                    intruder.remove();
                    return result;
                }"""
            )
            report["stacking"] = stacking
            check("dialog covers a Leaflet-grade z-index instead of being drawn through",
                  stacking["topmost"] == "busch-light-dialog"
                  and int(stacking["zIndex"]) > int(stacking["intruderZ"]),
                  json.dumps(stacking))

            # The card's own switch is behind the dialog, so the header carries
            # a master switch of its own — in both views.
            master = page.evaluate(
                f"""(states) => {{
                    const I = {internals};
                    const sr = document.querySelector('busch-light-dialog').shadowRoot;
                    const sw = () => sr.querySelector('.head .headsw');
                    const out = {{
                        present: !!sw(),
                        onInGroupView: sw() ? sw().classList.contains('on') : null
                    }};
                    window.__serviceCalls = [];
                    sw().click();
                    out.groupCalls = window.__serviceCalls.slice();

                    // and once more with every member unreachable
                    I.clearMemberCache();
                    const dead = JSON.parse(JSON.stringify(states));
                    Object.keys(dead).forEach(k => {{
                        if (k.startsWith('light.')) dead[k].state = 'unavailable';
                    }});
                    const dlg = document.querySelector('busch-light-dialog');
                    dlg.hass = window.makeHass(dead);
                    out.disabledWhenAllDead = dlg.shadowRoot
                        .querySelector('.head .headsw').hasAttribute('disabled');
                    dlg.hass = window.makeHass(states);
                    return out;
                }}""",
                lit_states,
            )
            report["masterSwitch"] = master
            targets = []
            for call in master["groupCalls"]:
                target = call["data"]["entity_id"]
                targets.extend(target if isinstance(target, list) else [target])
            check("dialog header carries a master switch, reflecting the group",
                  master["present"] and master["onInGroupView"] is True,
                  json.dumps({"present": master["present"], "on": master["onInGroupView"]}))
            check("the master switch drives the whole group, skipping the dead one",
                  master["groupCalls"] and all(c["service"] == "turn_off" for c in master["groupCalls"])
                  and "light.hubschrauberlampe" not in targets and len(targets) == 5,
                  json.dumps({"calls": master["groupCalls"], "targets": sorted(targets)}))
            check("the master switch is disabled when nothing is reachable",
                  master["disabledWhenAllDead"] is True, str(master["disabledWhenAllDead"]))

            check("brightness label on a light tile follows the tile's text colour",
                  dialog["litTilePct"] is not None
                  and dialog["litTilePct"]["pctColor"] == dialog["litTilePct"]["tileColor"],
                  json.dumps(dialog["litTilePct"], ensure_ascii=False))
            check("colour tab active by default, both tabs offered",
                  dialog["tabs"] == ["colour", "white"]
                  and dialog["hasWheel"] and not dialog["hasTempBar"],
                  json.dumps({"tabs": dialog["tabs"], "wheel": dialog["hasWheel"],
                              "temp": dialog["hasTempBar"]}))
            page.wait_for_timeout(500)
            shot = out_dir / "dialog.png"
            page.screenshot(path=str(shot))
            report["screenshots"].append(shot.name)

            # switch to the white tab: the temperature bar must replace the wheel
            after_tab = page.evaluate(
                """() => {
                    const sr = document.querySelector('busch-light-dialog').shadowRoot;
                    const tab = Array.from(sr.querySelectorAll('.picker-tabs button'))
                        .find(b => b.dataset.tab === 'white');
                    if (tab) tab.click();
                    const bar = sr.querySelector('.tempbar');
                    return {
                        hasWheel: !!sr.querySelector('canvas.wheel'),
                        hasTempBar: !!bar,
                        gradient: bar ? bar.style.background : ''
                    };
                }"""
            )
            report["dialogWhiteTab"] = after_tab
            # The group's usable range is the INTERSECTION of its members':
            # spots 2200-6500, strips 2000-9009 -> 2200-6500. The gradient must
            # therefore start at tempToRgb(2200) and end at tempToRgb(6500).
            kelvin_range = page.evaluate(
                f"""(states) => {{
                    const I = {internals};
                    I.clearMemberCache();
                    const m = new I.GroupModel(window.makeHass(states),
                        I.normalizeConfig({{ entity: {json.dumps(fixture['root'])} }}));
                    return {{ min: m.minKelvin, max: m.maxKelvin,
                              startRgb: I.tempToRgb(m.minKelvin),
                              endRgb: I.tempToRgb(m.maxKelvin) }};
                }}""",
                lit_states,
            )
            report["kelvinRange"] = kelvin_range
            check("group temperature range is the intersection of its members'",
                  kelvin_range["min"] == 2200 and kelvin_range["max"] == 6500,
                  json.dumps(kelvin_range))
            start_css = "rgb({}, {}, {})".format(*kelvin_range["startRgb"])
            end_css = "rgb({}, {}, {})".format(*kelvin_range["endRgb"])
            check("white tab swaps in a temperature bar spanning that range",
                  after_tab["hasTempBar"] and not after_tab["hasWheel"]
                  and start_css in after_tab["gradient"]
                  and end_css in after_tab["gradient"],
                  f"expected {start_css} .. {end_css} in {after_tab['gradient'][:160]}")
            # The marker used to sit at `left: 100%` and hang half its width
            # past the bar, which gave the whole sheet a horizontal scrollbar.
            overflow = page.evaluate(
                """() => {
                    const sr = document.querySelector('busch-light-dialog').shadowRoot;
                    const sheet = sr.querySelector('.sheet');
                    const bar = sr.querySelector('.tempbar');
                    const marker = () => bar.querySelector('.marker');
                    const drag = (x) => {
                        const r = bar.getBoundingClientRect();
                        const y = r.top + r.height / 2;
                        ['pointerdown', 'pointerup'].forEach(type =>
                            bar.dispatchEvent(new PointerEvent(type,
                                { bubbles: true, pointerId: 7, clientX: x, clientY: y })));
                    };
                    const measure = () => {
                        const b = bar.getBoundingClientRect();
                        const m = marker().getBoundingClientRect();
                        return {
                            markerLeft: Math.round(m.left), markerRight: Math.round(m.right),
                            barLeft: Math.round(b.left), barRight: Math.round(b.right),
                            scrollWidth: sheet.scrollWidth, clientWidth: sheet.clientWidth,
                            bodyScroll: document.documentElement.scrollWidth,
                            bodyClient: document.documentElement.clientWidth
                        };
                    };
                    drag(bar.getBoundingClientRect().right + 60);   // past the warm/cold end
                    const atMax = measure();
                    drag(bar.getBoundingClientRect().left - 60);
                    const atMin = measure();
                    return { atMax: atMax, atMin: atMin };
                }"""
            )
            report["tempBarOverflow"] = overflow
            check("temperature marker stays inside its bar at both ends",
                  overflow["atMax"]["markerRight"] <= overflow["atMax"]["barRight"]
                  and overflow["atMin"]["markerLeft"] >= overflow["atMin"]["barLeft"],
                  json.dumps(overflow))
            check("the dialog never scrolls sideways",
                  overflow["atMax"]["scrollWidth"] <= overflow["atMax"]["clientWidth"]
                  and overflow["atMin"]["scrollWidth"] <= overflow["atMin"]["clientWidth"]
                  and overflow["atMax"]["bodyScroll"] <= overflow["atMax"]["bodyClient"],
                  json.dumps({"max": overflow["atMax"], "min": overflow["atMin"]}))

            page.wait_for_timeout(300)
            shot = out_dir / "dialog-white.png"
            page.screenshot(path=str(shot))
            report["screenshots"].append(shot.name)

        # ------------------------------------------------------------------
        # 7b. Groups stay visible as groups
        # ------------------------------------------------------------------
        sections = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                const r = I.resolveSections(window.makeHass(states),
                    [{json.dumps(fixture['root'])}], {{}});
                return {{
                    sections: r.sections.map(s => ({{
                        entityId: s.entityId, name: s.name, depth: s.depth, lights: s.lights
                    }})),
                    emptyGroups: r.emptyGroups,
                    leaves: r.leaves
                }};
            }}""",
            base_states,
        )
        report["sections"] = sections

        check("resolution keeps the group structure, not just the leaves",
              [s["name"] for s in sections["sections"]] == ["LD Kinderzimmer Alle Lichter", "Spots"]
              and [s["depth"] for s in sections["sections"]] == [0, 1],
              json.dumps([(s["name"], s["depth"]) for s in sections["sections"]], ensure_ascii=False))
        check("each light sits in exactly one section, under the group it was first met in",
              sections["sections"][0]["lights"] == [
                  "light.kinderzimmer_spot_1", "light.hubschrauberlampe",
                  "light.vorhang", "light.ledstreifen_kinderzimm"]
              and sections["sections"][1]["lights"] == [
                  "light.kinderzimmer_spot_2", "light.kinderzimmer_spot_3"]
              and sorted(sum([s["lights"] for s in sections["sections"]], [])) == sorted(sections["leaves"]),
              json.dumps([s["lights"] for s in sections["sections"]]))
        check("groups that add nothing new are named, not rendered as empty headings",
              sorted(sections["emptyGroups"]) == [
                  "light.leds_kinderzimmer", "light.lichtgruppe_kinderzimmer"],
              json.dumps(sections["emptyGroups"]))

        grouped = page.evaluate(
            """() => {
                const sr = document.querySelector('busch-light-dialog').shadowRoot;
                const blocks = Array.from(sr.querySelectorAll('.group'));
                return {
                    blockCount: blocks.length,
                    names: blocks.map(b => b.querySelector('.gname').textContent),
                    counts: blocks.map(b => b.querySelector('.gcount').textContent),
                    depths: blocks.map(b => b.dataset.depth),
                    nested: blocks.map(b => b.classList.contains('nested')),
                    tilesPerBlock: blocks.map(b => b.querySelectorAll('.tile').length),
                    totalTiles: sr.querySelectorAll('.tile').length,
                    gridCount: sr.querySelectorAll('.tiles').length,
                    // tiles that sit outside any group block — the root's own
                    bareTiles: Array.from(sr.querySelectorAll('.tile'))
                        .filter(t => !t.closest('.group')).length,
                    alreadyNote: Array.from(sr.querySelectorAll('.deadlist'))
                        .map(n => n.textContent).find(t => t.startsWith('Oben bereits')) || ''
                };
            }"""
        )
        report["dialogGroups"] = grouped
        check("dialog gives the nested group its own block instead of one flat pile",
              grouped["blockCount"] == 1
              and grouped["names"] == ["Spots"]
              and grouped["tilesPerBlock"] == [2]
              and grouped["totalTiles"] == 6
              and grouped["gridCount"] == 2,
              json.dumps(grouped, ensure_ascii=False))
        check("the root's own lights stand bare, not under a heading repeating the title",
              "LD Kinderzimmer Alle Lichter" not in grouped["names"]
              and grouped["bareTiles"] == 4,
              json.dumps({"names": grouped["names"],
                          "bare": grouped["bareTiles"]}, ensure_ascii=False))
        check("a nested group is indented and marked as nested",
              grouped["depths"] == ["1"] and grouped["nested"] == [True],
              json.dumps({"depths": grouped["depths"], "nested": grouped["nested"]}))
        check("the group header counts only its own reachable lights",
              grouped["counts"] == ["2/2"],
              json.dumps(grouped["counts"]))
        check("groups that added nothing are named under the tiles",
              "Lichtgruppe Kinderzimmer" in grouped["alreadyNote"]
              and "LEDs Kinderzimmer" in grouped["alreadyNote"],
              grouped["alreadyNote"])

        # the header toggle must switch that group alone, skipping its dead
        group_toggle = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                window.__serviceCalls = [];
                const sr = document.querySelector('busch-light-dialog').shadowRoot;
                const blocks = Array.from(sr.querySelectorAll('.group'));
                // .group-head, not just .gtoggle — since v0.4.0 the tiles
                // carry switches of their own class.
                blocks[0].querySelector('.group-head .gtoggle').click();   // "Spots", both on
                const spots = window.__serviceCalls.slice();

                // A section holding an unreachable member is only reachable
                // through the model here, since the root block is headless.
                I.clearMemberCache();
                window.__serviceCalls = [];
                const m = new I.GroupModel(window.makeHass(states),
                    I.normalizeConfig({{ entity: {json.dumps(fixture['root'])} }}));
                const mixed = m.sections[0];
                m.toggleLights(mixed.lights);
                return {{
                    spots: spots,
                    mixedSection: mixed.lights.map(l => l.entityId),
                    mixedCalls: window.__serviceCalls.slice()
                }};
            }}""",
            lit_states,
        )
        report["groupToggle"] = group_toggle
        check("group header switches that group alone",
              len(group_toggle["spots"]) == 1
              and group_toggle["spots"][0]["service"] == "turn_off"
              and sorted(group_toggle["spots"][0]["data"]["entity_id"]) == [
                  "light.kinderzimmer_spot_2", "light.kinderzimmer_spot_3"],
              json.dumps(group_toggle["spots"]))
        check("switching a section skips its unreachable member",
              "light.hubschrauberlampe" in group_toggle["mixedSection"]
              and group_toggle["mixedCalls"]
              and all("light.hubschrauberlampe" not in call["data"]["entity_id"]
                      for call in group_toggle["mixedCalls"]),
              json.dumps(group_toggle["mixedCalls"]))

        page.wait_for_timeout(300)
        shot = out_dir / "dialog-groups.png"
        page.screenshot(path=str(shot))
        report["screenshots"].append(shot.name)

        # group_display: flat must go back to one pile
        flat_dialog = page.evaluate(
            """(payload) => {
                const old = document.querySelector('busch-light-dialog');
                if (old) old.remove();
                const card = document.querySelector('busch-light-card');
                card.setConfig({ type: 'custom:busch-light-card', entity: payload.root,
                                 group_display: 'flat' });
                card.hass = window.makeHass(payload.states);
                card.shadowRoot.querySelector('.tap').dispatchEvent(
                    new MouseEvent('click', { bubbles: true }));
                const sr = document.querySelector('busch-light-dialog').shadowRoot;
                return {
                    blocks: sr.querySelectorAll('.group').length,
                    grids: sr.querySelectorAll('.tiles').length,
                    tiles: sr.querySelectorAll('.tile').length,
                    alreadyNote: Array.from(sr.querySelectorAll('.deadlist'))
                        .some(n => n.textContent.startsWith('Oben bereits'))
                };
            }""",
            {"root": fixture["root"], "states": lit_states},
        )
        report["flatDialog"] = flat_dialog
        check("group_display: flat returns to a single pile of tiles",
              flat_dialog["blocks"] == 0 and flat_dialog["grids"] == 1
              and flat_dialog["tiles"] == 6 and flat_dialog["alreadyNote"] is False,
              json.dumps(flat_dialog))

        # ------------------------------------------------------------------
        # 7c. Zigbee2MQTT groups hide their members under `group_entities`
        # ------------------------------------------------------------------
        zig = fixture["zigbee"]
        zig_states = with_entity_ids(zig["states"])
        zigbee = page.evaluate(
            f"""(payload) => {{
                const I = {internals};
                const out = {{ attributes: I.MEMBER_ATTRIBUTES }};

                I.clearMemberCache();
                const full = I.resolveSections(window.makeHass(payload.states), [payload.root], {{}});
                out.leaves = full.leaves;
                out.sectionNames = full.sections.map(s => s.name);
                out.emptyGroups = full.emptyGroups;
                out.maxDepth = full.maxDepth;

                // Control run: same data with `group_entities` removed. If the
                // attribute is what makes the difference, this must fall back
                // to naming the two Zigbee groups as if they were lamps.
                const blind = JSON.parse(JSON.stringify(payload.states));
                Object.keys(blind).forEach(k => {{ delete blind[k].attributes.group_entities; }});
                I.clearMemberCache();
                out.leavesBlind = I.resolveEntities(window.makeHass(blind), [payload.root], {{}}).leaves;

                // child_ids must NOT be followed — those ids do not exist.
                out.childIds = payload.states[payload.root].attributes.child_ids;

                // nor `entities` on a schedule helper, which points at media players
                I.clearMemberCache();
                out.schedule = I.resolveEntities(window.makeHass(payload.states),
                    ['switch.schedule_fernseher_ausschalten'], {{}}).leaves;

                return out;
            }}""",
            {"root": zig["root"], "states": zig_states},
        )
        report["zigbee"] = zigbee
        exp = zig["expected"]

        check("Zigbee2MQTT groups resolve through their `group_entities`",
              zigbee["leaves"] == exp["leaves"] and zigbee["maxDepth"] == exp["maxDepth"],
              f"got {zigbee['leaves']}")
        check("without that attribute the same tree stops at the Zigbee groups",
              zigbee["leavesBlind"] == exp["leavesWithoutGroupEntities"]
              and len(zigbee["leavesBlind"]) == 7 and len(zigbee["leaves"]) == 5,
              f"blind={zigbee['leavesBlind']}")
        check("the Zigbee group becomes its own block in the dialog",
              zigbee["sectionNames"] == exp["sectionNames"]
              and zigbee["emptyGroups"] == exp["emptyGroups"],
              json.dumps({"sections": zigbee["sectionNames"],
                          "empty": zigbee["emptyGroups"]}, ensure_ascii=False))
        check("only the three proven member attributes are followed",
              zigbee["attributes"] == ["entity_id", "group_entities", "lights"],
              json.dumps(zigbee["attributes"]))
        check("child_ids is ignored — those ids resolve to nothing",
              zigbee["childIds"] and not any(c in zigbee["leaves"] for c in zigbee["childIds"]),
              json.dumps(zigbee["childIds"]))
        check("a schedule helper's `entities` is not mistaken for membership",
              zigbee["schedule"] == ["switch.schedule_fernseher_ausschalten"],
              json.dumps(zigbee["schedule"]))

        # ------------------------------------------------------------------
        # 7d. Importing every scene that uses these lights
        # ------------------------------------------------------------------
        scene_import = page.evaluate(
            f"""(states) => {{
                const I = {internals};
                I.clearMemberCache();
                const hass = window.makeHass(states);
                const r = I.resolveSections(hass, [{json.dumps(fixture['root'])}], {{}});
                return {{
                    all: I.scenesForLights(hass, r.leaves.concat(r.groups)),
                    leavesOnly: I.scenesForLights(hass, r.leaves),
                    none: I.scenesForLights(hass, [])
                }};
            }}""",
            base_states,
        )
        report["sceneImport"] = scene_import
        expected_import = fixture["expectedSceneImport"]

        check("scene import finds every scene touching these lights, sorted by name",
              scene_import["all"] == expected_import["forNurseryRoot"],
              json.dumps(scene_import["all"]))
        check("scenes for other rooms are left out",
              "scene.herbst" not in scene_import["all"]
              and "scene.fernschauen_wohnzimmer" not in scene_import["all"],
              json.dumps(scene_import["all"]))
        check("matching includes the traversed groups, not just the leaves",
              expected_import["leavesOnlyWouldMiss"][0] in scene_import["all"]
              and expected_import["leavesOnlyWouldMiss"][0] not in scene_import["leavesOnly"],
              json.dumps({"all": scene_import["all"], "leavesOnly": scene_import["leavesOnly"]}))
        check("an empty light list imports nothing",
              scene_import["none"] == [], json.dumps(scene_import["none"]))

        # ------------------------------------------------------------------
        # 7e. The redesigned tiles
        # ------------------------------------------------------------------
        tiles = page.evaluate(
            """(payload) => {
                const old = document.querySelector('busch-light-dialog');
                if (old) old.remove();
                const card = document.querySelector('busch-light-card');
                card.setConfig({ type: 'custom:busch-light-card', entity: payload.root,
                                 scenes: payload.scenes });
                card.hass = window.makeHass(payload.states);
                card.shadowRoot.querySelector('.tap').dispatchEvent(
                    new MouseEvent('click', { bubbles: true }));
                const sr = document.querySelector('busch-light-dialog').shadowRoot;

                const sceneTiles = Array.from(sr.querySelectorAll('.scene'));
                const lightTiles = Array.from(sr.querySelectorAll('.tile'));
                const out = {
                    sceneBadges: sceneTiles.length
                        && sceneTiles.every(s => !!s.querySelector('.badge ha-icon')),
                    sceneIcons: sceneTiles.map(s => s.querySelector('.badge ha-icon')
                        .getAttribute('icon')),
                    sceneBadgeColors: sceneTiles.map(s =>
                        getComputedStyle(s.querySelector('.badge')).backgroundColor),
                    tilesWithSwitch: lightTiles.filter(t => t.querySelector('.tsw')).length,
                    deadWithSwitch: lightTiles.filter(t => t.classList.contains('dead')
                        && t.querySelector('.tsw')).length,
                    totalTiles: lightTiles.length,
                    nestedButtons: lightTiles.filter(t => t.tagName.toLowerCase() === 'button').length
                };

                // the switch acts on that one light only
                window.__serviceCalls = [];
                const lit = lightTiles.find(t => t.querySelector('.tsw.on'));
                lit.querySelector('.tsw').click();
                out.switchCalls = window.__serviceCalls.slice();

                // tapping the tile body opens that light's detail view
                const target = lightTiles.find(t => t.querySelector('.tname')
                    .textContent === 'Kuschelecke');
                target.dispatchEvent(new PointerEvent('pointerdown',
                    { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
                target.dispatchEvent(new PointerEvent('pointerup',
                    { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
                out.detailTitle = sr.querySelector('.head h1').textContent;
                out.hasBackButton = sr.querySelectorAll('.head .iconbtn').length === 2;

                // the master switch follows into the detail view and acts on
                // that one light
                const detailSw = sr.querySelector('.head .headsw');
                out.detailSwitchPresent = !!detailSw;
                out.detailSwitchOn = detailSw ? detailSw.classList.contains('on') : null;
                window.__serviceCalls = [];
                detailSw.click();
                out.detailSwitchCalls = window.__serviceCalls.slice();
                return out;
            }""",
            {"root": fixture["root"], "states": lit_states,
             "scenes": fixture["scenesConfig"]},
        )
        report["tiles"] = tiles

        check("scene tiles carry a round icon badge instead of a flooded colour",
              tiles["sceneBadges"] and "mdi:white-balance-sunny" in tiles["sceneIcons"]
              and "mdi:power-sleep" in tiles["sceneIcons"],
              json.dumps(tiles["sceneIcons"]))
        check("a scene without its own icon still gets one",
              tiles["sceneIcons"].count("mdi:palette") >= 1,
              json.dumps(tiles["sceneIcons"]))
        check("every reachable light tile has its own switch, the dead one none",
              tiles["tilesWithSwitch"] == 5 and tiles["deadWithSwitch"] == 0
              and tiles["totalTiles"] == 6,
              json.dumps(tiles))
        check("tiles are not nested buttons",
              tiles["nestedButtons"] == 0, str(tiles["nestedButtons"]))
        check("the tile switch acts on that light alone",
              len(tiles["switchCalls"]) == 1
              and tiles["switchCalls"][0]["service"] == "turn_off"
              and isinstance(tiles["switchCalls"][0]["data"]["entity_id"], str),
              json.dumps(tiles["switchCalls"]))
        check("tapping the tile body opens that light's detail view",
              tiles["detailTitle"] == "Kuschelecke" and tiles["hasBackButton"],
              json.dumps({"title": tiles["detailTitle"], "back": tiles["hasBackButton"]}))
        check("the master switch follows into the detail view and drives that light",
              tiles["detailSwitchPresent"] and tiles["detailSwitchOn"] is True
              and len(tiles["detailSwitchCalls"]) == 1
              and tiles["detailSwitchCalls"][0]["service"] == "turn_off"
              and tiles["detailSwitchCalls"][0]["data"]["entity_id"] == "light.vorhang",
              json.dumps(tiles["detailSwitchCalls"]))

        page.wait_for_timeout(300)
        shot = out_dir / "dialog-tiles.png"
        page.screenshot(path=str(shot))
        report["screenshots"].append(shot.name)

        # ------------------------------------------------------------------
        # 8. The visual editor
        # ------------------------------------------------------------------
        editor = page.evaluate(
            f"""async (payload) => {{
                const I = {internals};
                const dlg = document.querySelector('busch-light-dialog');
                if (dlg) dlg.remove();
                I.clearMemberCache();

                const settle = () => new Promise(r => setTimeout(r, 0));
                const CardClass = customElements.get('busch-light-card');
                const hass = window.makeHass(payload.states);
                const out = {{}};

                out.hasGetConfigElement = typeof CardClass.getConfigElement === 'function';
                const ed = CardClass.getConfigElement();
                out.editorTag = ed.tagName.toLowerCase();

                // the picker's starting card should prefer a real group
                out.stub = CardClass.getStubConfig(hass, Object.keys(payload.states));

                document.getElementById('stack').innerHTML = '';
                document.getElementById('stack').appendChild(ed);
                ed.hass = hass;
                ed.setConfig({{ type: 'custom:busch-light-card', entity: payload.root }});
                await settle(); await settle();

                const sr = ed.shadowRoot;
                const forms = Array.from(sr.querySelectorAll('ha-form'));
                out.formCount = forms.length;
                out.fields = forms.flatMap(f => f.fields().map(x => x.name));
                out.labels = forms.flatMap(f => f.fields().map(x => f.computeLabel(x)));
                out.selectorless = forms.flatMap(f => f.fields()
                    .filter(x => !x.selector).map(x => x.name));
                out.sections = Array.from(sr.querySelectorAll('summary')).map(s => s.textContent);

                // resolution preview
                const prev = sr.querySelector('.preview');
                out.previewHead = prev.querySelector('.head').textContent;
                out.previewChips = Array.from(prev.querySelectorAll('.chip')).map(c => c.textContent);
                out.previewDeadChips = Array.from(prev.querySelectorAll('.chip.dead')).map(c => c.textContent);
                out.previewNotes = Array.from(prev.querySelectorAll('.note')).map(n => n.textContent);

                // --- a change must emit a MINIMAL config
                let emitted = null;
                ed.addEventListener('config-changed', e => {{ emitted = e.detail.config; }});
                const byName = (n) => forms.find(f => f.fields().some(x => x.name === n));
                byName('slider').change({{ slider: false }});
                await settle();
                out.afterSliderOff = emitted;

                // setting it back to the default must REMOVE the key again
                ed.setConfig(emitted); await settle();
                Array.from(sr.querySelectorAll('ha-form'))
                    .find(f => f.fields().some(x => x.name === 'slider'))
                    .change({{ slider: true }});
                await settle();
                out.afterSliderBackOn = emitted;

                // --- camelCase config folded into snake_case
                ed.setConfig({{ type: 'custom:busch-light-card', entity: payload.root,
                                resolveGroups: false, offColor: '#123456' }});
                await settle(); await settle();
                const prev2 = ed.shadowRoot.querySelector('.preview');
                out.flatPreviewHead = prev2.querySelector('.head').textContent;
                Array.from(ed.shadowRoot.querySelectorAll('ha-form'))
                    .find(f => f.fields().some(x => x.name === 'max_depth'))
                    .change({{ max_depth: 4 }});
                await settle();
                out.afterCamel = emitted;

                // --- scenes: add, fill, move, remove
                ed.setConfig({{ type: 'custom:busch-light-card', entity: payload.root }});
                await settle(); await settle();
                const addBtn = ed.shadowRoot.querySelector('.addbtn');
                addBtn.click(); await settle();
                addBtn.click(); await settle();
                out.sceneRowsAfterAdd = ed.shadowRoot.querySelectorAll('.scene-row').length;

                const sceneForms = Array.from(ed.shadowRoot.querySelectorAll('.scene-row ha-form'));
                sceneForms[0].change({{ entity: 'scene.taglicht', color: [255, 224, 163] }});
                await settle();
                sceneForms[1].change({{ entity: 'scene.nachtlicht', title: 'Nacht' }});
                await settle();
                out.afterScenes = emitted;

                const rows = () => Array.from(ed.shadowRoot.querySelectorAll('.scene-row'));
                rows()[0].querySelectorAll('.iconbtn')[1].click(); // move first down
                await settle();
                out.afterMove = emitted;

                rows()[0].querySelectorAll('.iconbtn')[2].click(); // delete first
                await settle();
                out.afterDelete = emitted;
                out.sceneRowsAfterDelete = ed.shadowRoot.querySelectorAll('.scene-row').length;

                // --- colour round trip
                out.colorRoundTrip = I.rgbArrayToHex(I.hexToRgbArray('#ffe0a3'));

                // --- scene import button
                ed.setConfig({{ type: 'custom:busch-light-card', entity: payload.root }});
                await settle(); await settle();
                const importBtn = () => Array.from(ed.shadowRoot.querySelectorAll('.addbtn'))
                    .find(b => b.textContent.indexOf('übernehmen') !== -1
                            || b.textContent.indexOf('stehen schon') !== -1
                            || b.textContent.indexOf('Keine Szene') !== -1);
                out.importLabelBefore = importBtn().textContent.trim();
                out.importDisabledBefore = importBtn().hasAttribute('disabled');

                importBtn().click(); await settle();
                out.afterImport = emitted;
                out.rowsAfterImport = ed.shadowRoot.querySelectorAll('.scene-row').length;

                // a second click has nothing left to add
                out.importLabelAfter = importBtn().textContent.trim();
                out.importDisabledAfter = importBtn().hasAttribute('disabled');

                // …and removing one makes it offer that one again
                ed.shadowRoot.querySelectorAll('.scene-row')[0]
                    .querySelectorAll('.iconbtn')[2].click();
                await settle();
                out.afterRemoveOne = emitted;
                out.importLabelAfterRemove = importBtn().textContent.trim();
                out.importDisabledAfterRemove = importBtn().hasAttribute('disabled');

                return out;
            }}""",
            {"root": fixture["root"], "states": lit_states},
        )
        report["editor"] = editor

        check("card offers a visual editor",
              editor["hasGetConfigElement"] and editor["editorTag"] == "busch-light-card-editor",
              json.dumps({"tag": editor["editorTag"]}))
        check("picker's starting card prefers a real group",
              editor["stub"]["entity"] == fixture["root"],
              json.dumps(editor["stub"]))
        expected_fields = sorted([
            "entity", "entities", "title", "icon", "description",
            "resolve_groups", "max_depth", "show_unavailable", "group_display",
            "off_color", "default_color", "hue_borders", "show_switch",
            "slider", "allow_zero", "off_shadow", "tap_action", "hold_action"])
        check("editor exposes every documented option",
              sorted(editor["fields"]) == expected_fields,
              f"missing={sorted(set(expected_fields) - set(editor['fields']))} "
              f"extra={sorted(set(editor['fields']) - set(expected_fields))}")
        check("every field has a selector and a translated label",
              not editor["selectorless"]
              and all(l and not l.startswith("ed") for l in editor["labels"]),
              json.dumps({"noSelector": editor["selectorless"],
                          "untranslated": [l for l in editor["labels"]
                                           if not l or l.startswith("ed")]}, ensure_ascii=False))
        check("editor is grouped into sections",
              editor["sections"] == ["Gruppenauflösung", "Darstellung", "Aktionen", "Szenen"],
              json.dumps(editor["sections"], ensure_ascii=False))

        # The preview is what makes "resolve nested groups" visible before the
        # card is ever placed on a dashboard.
        check("editor previews the resolution live",
              "6 Lampen aus 4 Gruppen, Tiefe 2" in editor["previewHead"]
              and len(editor["previewChips"]) == 6
              and editor["previewDeadChips"] == ["Hubschrauber Lampe"],
              json.dumps({"head": editor["previewHead"],
                          "chips": editor["previewChips"],
                          "dead": editor["previewDeadChips"]}, ensure_ascii=False))
        check("preview names the unreachable member count",
              any("1 nicht erreichbar" in n for n in editor["previewNotes"]),
              json.dumps(editor["previewNotes"], ensure_ascii=False))
        check("preview reflects resolve_groups: false",
              "1 Entität, Gruppen werden nicht aufgelöst" in editor["flatPreviewHead"],
              editor["flatPreviewHead"])

        # A visual editor that writes back every default turns a three-line
        # card into a twenty-line one.
        check("editor writes only what differs from the default",
              editor["afterSliderOff"] == {"type": "custom:busch-light-card",
                                           "entity": fixture["root"], "slider": False},
              json.dumps(editor["afterSliderOff"]))
        check("returning an option to its default removes the key again",
              editor["afterSliderBackOn"] == {"type": "custom:busch-light-card",
                                              "entity": fixture["root"]},
              json.dumps(editor["afterSliderBackOn"]))
        check("camelCase from the upstream card is folded into snake_case",
              editor["afterCamel"] == {"type": "custom:busch-light-card",
                                       "entity": fixture["root"],
                                       "resolve_groups": False,
                                       "off_color": "#123456",
                                       "max_depth": 4},
              json.dumps(editor["afterCamel"]))

        check("scene rows add and write hex colour, not an rgb triple",
              editor["sceneRowsAfterAdd"] == 2
              and editor["afterScenes"]["scenes"] == [
                  {"entity": "scene.taglicht", "color": "#ffe0a3"},
                  {"entity": "scene.nachtlicht", "title": "Nacht"}],
              json.dumps(editor["afterScenes"], ensure_ascii=False))
        check("scene rows reorder and delete",
              editor["afterMove"]["scenes"][0]["entity"] == "scene.nachtlicht"
              and editor["afterDelete"]["scenes"] == [
                  {"entity": "scene.taglicht", "color": "#ffe0a3"}]
              and editor["sceneRowsAfterDelete"] == 1,
              json.dumps({"move": editor["afterMove"]["scenes"],
                          "delete": editor["afterDelete"]["scenes"],
                          "rows": editor["sceneRowsAfterDelete"]}, ensure_ascii=False))
        check("colour survives the hex/rgb round trip the picker needs",
              editor["colorRoundTrip"] == "#ffe0a3", str(editor["colorRoundTrip"]))

        # The import must not be a one-way door: what it adds, the same delete
        # button removes, and the button then offers it again.
        expected_import = fixture["expectedSceneImport"]["forNurseryRoot"]
        check("import button offers exactly the matching scenes",
              not editor["importDisabledBefore"]
              and str(len(expected_import)) in editor["importLabelBefore"],
              json.dumps({"label": editor["importLabelBefore"],
                          "disabled": editor["importDisabledBefore"]}, ensure_ascii=False))
        check("importing writes those scenes into the config",
              [s["entity"] for s in editor["afterImport"]["scenes"]] == expected_import
              and editor["rowsAfterImport"] == len(expected_import),
              json.dumps(editor["afterImport"]["scenes"]))
        check("a second import has nothing left to add",
              editor["importDisabledAfter"] and "schon" in editor["importLabelAfter"],
              json.dumps({"label": editor["importLabelAfter"],
                          "disabled": editor["importDisabledAfter"]}, ensure_ascii=False))
        check("a removed scene is offered again, so the import is reversible",
              [s["entity"] for s in editor["afterRemoveOne"]["scenes"]] == expected_import[1:]
              and not editor["importDisabledAfterRemove"]
              and "(1)" in editor["importLabelAfterRemove"],
              json.dumps({"scenes": editor["afterRemoveOne"].get("scenes"),
                          "label": editor["importLabelAfterRemove"]}, ensure_ascii=False))

        report["iconsAsked"] = page.evaluate("() => window.__iconsAsked")
        browser.close()

    httpd.shutdown()

    report["vendorRequests"] = [u for u in report["requests"]
                                if "/dist/" in u and not u.endswith(".js")]
    report["passed"] = sum(1 for c in report["checks"] if c["pass"])
    report["failed"] = sum(1 for c in report["checks"] if not c["pass"])
    report["clean"] = (report["failed"] == 0
                       and not report["badResponses"]
                       and not report["requestFailures"]
                       and not report["consoleErrors"]
                       and not report["pageErrors"]
                       and not report["vendorRequests"])

    (out_dir / "report.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    for entry in report["checks"]:
        print(("  ok   " if entry["pass"] else "  FAIL ") + entry["name"])
        if not entry["pass"]:
            print("         " + entry["detail"])
    print(f"\n{report['passed']} passed, {report['failed']} failed")
    print(f"requests={len(report['requests'])} bad={len(report['badResponses'])} "
          f"failures={len(report['requestFailures'])} "
          f"consoleErrors={len(report['consoleErrors'])} pageErrors={len(report['pageErrors'])}")
    if report["pageErrors"]:
        for e in report["pageErrors"]:
            print("  page error: " + e)
    if report["consoleErrors"]:
        for e in report["consoleErrors"]:
            print("  console error: " + e)
    print(f"report: {out_dir / 'report.json'}")
    return 0 if report["clean"] else 1


if __name__ == "__main__":
    sys.exit(main())
