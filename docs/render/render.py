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
                    deadNote: (sr.querySelector('.deadlist') || {}).textContent || '',
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
            page.wait_for_timeout(300)
            shot = out_dir / "dialog-white.png"
            page.screenshot(path=str(shot))
            report["screenshots"].append(shot.name)

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
