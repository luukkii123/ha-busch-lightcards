#!/usr/bin/env python3
"""Browser probe for Busch HA UI 0.1.0; output stays in an ignored result folder.

Usage: visual_contract.py <dist/busch-lightcards.js> <repo-local-result-dir>
The accepted screenshots are copied separately to docs/render/baseline/.
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from render import PAGE, serve


def synthetic_states(lit):
    """Invented entities only; committed screenshots never contain live names."""
    root = "light.demo_group"
    members = [f"light.demo_{number}" for number in range(1, 7)]
    states = {root: {"entity_id": root, "state": "on" if lit else "off",
        "attributes": {"friendly_name": "Demo-Lichtgruppe", "icon": "mdi:lightbulb-group",
                       "entity_id": members, "supported_color_modes": ["rgb"]}}}
    colors = ([255, 180, 55], [255, 240, 220], [255, 92, 168], [88, 120, 255])
    brightness = (214, 168, 190, 120)
    for number, entity_id in enumerate(members, 1):
        on = lit and 2 <= number <= 5
        states[entity_id] = {"entity_id": entity_id,
            "state": "unavailable" if number == 6 else "on" if on else "off",
            "attributes": {"friendly_name": f"Testlampe {number}",
                "supported_color_modes": ["rgb"],
                "color_mode": "rgb" if on else None,
                "brightness": brightness[number - 2] if on else None,
                "rgb_color": colors[number - 2] if on else None}}
    return states


def recolored(states, looks):
    """Copy of `states` with lamps 2..5 lit in the given colour attributes."""
    out = json.loads(json.dumps(states))
    for number, look in enumerate(looks, 2):
        attributes = out[f"light.demo_{number}"]["attributes"]
        for key in ("rgb_color", "color_temp_kelvin"):
            attributes.pop(key, None)
        if look is None:
            out[f"light.demo_{number}"]["state"] = "off"
            attributes["color_mode"] = None
            attributes["brightness"] = None
            continue
        out[f"light.demo_{number}"]["state"] = "on"
        attributes["supported_color_modes"] = ["rgb", "color_temp"]
        attributes["brightness"] = attributes.get("brightness") or 200
        attributes.update(look)
    return out


def main():
    card_file = Path(sys.argv[1]).resolve()
    result = Path(sys.argv[2]).resolve()
    repo = card_file.parent.parent
    result.mkdir(parents=True, exist_ok=True)
    root = "light.demo_group"
    off = synthetic_states(False)
    on = synthetic_states(True)
    clean_on = json.loads(json.dumps(on))
    clean_off = json.loads(json.dumps(off))
    for states in (clean_on, clean_off):
        for entity_id, state in states.items():
            if entity_id.startswith("light.") and state["state"] == "unavailable":
                state["state"] = "off"
    unavailable = json.loads(json.dumps(on))
    for entity_id, state in unavailable.items():
        if entity_id.startswith("light.") and not state["attributes"].get("entity_id"):
            state["state"] = "unavailable"
    empty = {"group.empty": {"entity_id": "group.empty", "state": "on",
                              "attributes": {"entity_id": ["sensor.foreign"]}}}
    # Hue look (#712): one colour, several colours, white and warm white.
    single = recolored(clean_on, [{"color_mode": "rgb", "rgb_color": [70, 110, 255]}, None, None, None])
    warm = recolored(clean_on, [{"color_mode": "color_temp", "color_temp_kelvin": 2700}] * 2 + [None, None])
    white = recolored(clean_on, [{"color_mode": "color_temp", "color_temp_kelvin": 6500},
                                 {"color_mode": "rgb", "rgb_color": [255, 255, 255]}, None, None])
    yellow = recolored(clean_on, [{"color_mode": "rgb", "rgb_color": [255, 236, 0]}, None, None, None])
    scenarios = {
        "on": {"states": on, "config": {"entity": root}},
        "single": {"states": single, "config": {"entity": root}},
        "warm": {"states": warm, "config": {"entity": root}},
        "white": {"states": white, "config": {"entity": root}},
        "yellow": {"states": yellow, "config": {"entity": root}},
        "off": {"states": off, "config": {"entity": root}},
        "success": {"states": clean_on, "config": {"entity": root}},
        "neutral": {"states": clean_off, "config": {"entity": root}},
        "custom_color": {"states": clean_off, "config": {"entity": root,
            "off_color": "#112233"}},
        "long": {"states": on, "config": {"entity": root,
            "title": "Sehr lange Demo-Lichtgruppe mit vielen Räumen " * 3,
            "description": "Vier Testlampen leuchten; dieser künstliche Status ist sehr lang " * 3}},
        "unavailable": {"states": unavailable, "config": {"entity": root}},
        "empty": {"states": empty, "config": {"entity": "group.empty"}},
        "loading": {"states": None, "config": {"entity": root}},
        "error": {"states": off, "config": {}},
        # #715: Mushroom slider, icon size, hidden description, template.
        "mushroom": {"states": clean_on, "config": {"entity": root, "slider": "mushroom"}},
        "mushroom_off": {"states": clean_off, "config": {"entity": root, "slider": "mushroom",
            "allow_zero": True}},
        "icon_big": {"states": single, "config": {"entity": root, "icon_size": "big"}},
        "no_description": {"states": clean_on, "config": {"entity": root, "description": False}},
        "template": {"states": clean_on, "config": {"entity": root,
            "title": "Demo {{ light.demo_2 }}",
            "description": "%s · {{ light.demo_2.brightness }}"}},
    }
    expected_tones = {"on": "warning", "off": "warning", "long": "warning",
                      "success": "success", "neutral": "neutral",
                      "single": "success", "warm": "success", "white": "success",
                      "yellow": "success",
                      "custom_color": "neutral",
                      "mushroom": "success", "mushroom_off": "neutral", "icon_big": "success",
                      "no_description": "success", "template": "success",
                      "unavailable": "unavailable", "empty": "unknown"}
    port_holder = []
    server = serve(repo, port_holder)
    report = {"contract": "Busch HA UI 0.1.0", "cases": [], "errors": []}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--force-color-profile=srgb"])
        page = browser.new_page(viewport={"width": 320, "height": 1000},
                                device_scale_factor=2, locale="de-DE")
        page.on("pageerror", lambda error: report["errors"].append(str(error)))
        harness = result / "harness.html"
        harness.write_text(PAGE.replace("__SRC__", f"/dist/{card_file.name}")
                           .replace("__WIDTH__", "960"), encoding="utf-8")
        page.goto(f"http://127.0.0.1:{port_holder[0]}/{harness.relative_to(repo)}")
        page.wait_for_function("() => !!customElements.get('busch-light-card')")
        for width in (320, 480, 960):
            for theme in ("light", "dark"):
                page.set_viewport_size({"width": width, "height": 1000})
                page.evaluate("""(dark) => {
                    document.body.style.padding = '0';
                    document.body.style.background = dark ? '#11171e' : '#f2f4f7';
                    document.body.style.color = dark ? '#f3f5f7' : '#17212b';
                    const stack = document.getElementById('stack');
                    stack.style.maxWidth = 'none';
                    stack.style.width = '100%';
                    const vars = dark ? {
                        '--card-background-color': '#202b35',
                        '--primary-text-color': '#f3f5f7',
                        '--secondary-text-color': '#abbac7',
                        '--divider-color': '#425360',
                        '--primary-color': '#75b8ee',
                        '--success-color': '#6fd1a8',
                        '--warning-color': '#f5bb67',
                        '--error-color': '#ff8b8b'
                    } : {
                        '--card-background-color': '#ffffff',
                        '--primary-text-color': '#17212b',
                        '--secondary-text-color': '#566574',
                        '--divider-color': '#dbe2e9',
                        '--primary-color': '#087bc1',
                        '--success-color': '#187b59',
                        '--warning-color': '#986200',
                        '--error-color': '#b33232'
                    };
                    for (const [key, value] of Object.entries(vars))
                        document.documentElement.style.setProperty(key, value);
                }""", theme == "dark")
                for name, payload in scenarios.items():
                    page.evaluate("""(payload) => {
                        window.freshStep();
                        const stack = document.getElementById('stack');
                        stack.replaceChildren();
                        const card = document.createElement('busch-light-card');
                        card.setConfig({ type: 'custom:busch-light-card', ...payload.config });
                        stack.appendChild(card);
                        if (payload.states) card.hass = window.makeHass(payload.states);
                    }""", payload)
                    page.wait_for_timeout(40)
                    shot = f"card-{name}-{width}-{theme}.png"
                    page.locator("busch-light-card").screenshot(path=str(result / shot))
                    metrics = page.evaluate("""() => {
                        const host = document.querySelector('busch-light-card');
                        const sr = host.shadowRoot;
                        const card = sr.querySelector('ha-card');
                        const title = sr.querySelector('.text h2');
                        const status = sr.querySelector('.desc');
                        const warnText = sr.querySelector('.warn span');
                        const toggle = sr.querySelector('.toggle');
                        const slider = sr.querySelector('.slider');
                        const rect = el => el ? el.getBoundingClientRect() : null;
                        const visible = el => el && getComputedStyle(el).display !== 'none';
                        return {
                            width: rect(host).width, scrollWidth: host.scrollWidth,
                            pageScroll: document.documentElement.scrollWidth,
                            hasCard: !!card, contract: card && card.dataset.uiContract,
                            title: title && title.textContent,
                            titleColor: title && getComputedStyle(title).color,
                            titleEllipsis: title && getComputedStyle(title).textOverflow,
                            status: status && status.textContent,
                            statusCenter: status && (rect(status).top + rect(status).height / 2),
                            tone: status && status.dataset.tone,
                            warnTextWidth: warnText && warnText.getBoundingClientRect().width,
                            toggle: visible(toggle) ? { width: rect(toggle).width,
                                height: rect(toggle).height,
                                center: rect(toggle).top + rect(toggle).height / 2 } : null,
                            slider: visible(slider) ? { width: rect(slider).width,
                                height: rect(slider).height, role: slider.getAttribute('role'),
                                tabIndex: slider.tabIndex,
                                label: slider.querySelector('.label')?.textContent } : null,
                            sliderClass: slider ? slider.className : null,
                            trackHeight: sr.querySelector('.slider .track')
                                ? sr.querySelector('.slider .track').getBoundingClientRect().height : 0,
                            iconSize: getComputedStyle(sr.querySelector('.icon') || host)
                                .getPropertyValue('--mdc-icon-size').trim(),
                            statusDisplay: status ? getComputedStyle(status).display : null,
                            tapRole: sr.querySelector('.tap')?.getAttribute('role'),
                            tapTabIndex: sr.querySelector('.tap')?.tabIndex,
                            error: sr.querySelector('.error')?.textContent,
                            background: card && getComputedStyle(card).backgroundColor,
                            backgroundImage: card && getComputedStyle(card).backgroundImage,
                            accent: getComputedStyle(host).getPropertyValue('--blc-accent').trim(),
                            cardClass: card && card.className,
                            // the text colour of every text on the card, and the
                            // contrast of the chosen colour on every stop (#712)
                            textColors: card ? Array.from(sr.querySelectorAll('.text h2, .desc .dtext, .slider .label'))
                                .filter(visible).map(el => getComputedStyle(el).color) : [],
                            surface: host._surface ? {
                                fg: host._surface.fg, css: host._surface.css,
                                minRatio: Math.min(...host._surface.colors.map(c =>
                                    customElements.get('busch-light-card').__internals
                                        .contrastRatio(host._surface.text, c))),
                                stops: host._surface.colors.length } : null
                        };
                    }""")
                    valid = (metrics["width"] == width
                             and metrics["scrollWidth"] <= width + 1
                             and metrics["pageScroll"] <= width + 1
                             and metrics["hasCard"]
                             and metrics["contract"] == "Busch HA UI 0.1.0")
                    if name not in ("error", "loading"):
                        valid = valid and metrics["titleEllipsis"] == "ellipsis"
                        valid = valid and metrics["tapRole"] == "button" and metrics["tapTabIndex"] == 0
                        valid = valid and metrics["tone"] == expected_tones[name]
                        valid = valid and metrics["toggle"] is not None and metrics["toggle"]["height"] >= 44
                        if width == 320 and metrics["toggle"] and name != "no_description":
                            valid = valid and abs(metrics["toggle"]["center"]
                                - metrics["statusCenter"]) <= 22
                        if name == "long":
                            valid = valid and metrics["warnTextWidth"] >= 6
                        if name == "custom_color":
                            valid = valid and metrics["background"] == "rgb(17, 34, 51)"
                            valid = valid and metrics["titleColor"] == "rgb(255, 255, 255)"
                            valid = valid and "tinted" in metrics["cardClass"].split()
                        lit_case = name in ("on", "success", "single", "warm", "white", "yellow", "long",
                                            "mushroom", "icon_big", "no_description", "template")
                        if name in ("mushroom", "mushroom_off"):
                            valid = valid and "mushroom" in (metrics["sliderClass"] or "").split()
                            valid = valid and round(metrics["trackHeight"]) == 28
                        if name == "icon_big":
                            valid = valid and metrics["iconSize"] == "34px"
                        if name == "no_description":
                            valid = valid and metrics["statusDisplay"] == "none"
                        if name == "template":
                            valid = valid and metrics["title"] == "Demo on" and "{{" not in metrics["status"]
                        if lit_case:
                            surface = metrics["surface"]
                            valid = valid and "lit" in metrics["cardClass"].split()
                            valid = valid and surface is not None and surface["minRatio"] >= 4.5
                            valid = valid and all(color == surface["css"] for color in metrics["textColors"])
                        if name in ("off", "neutral"):
                            valid = valid and "lit" not in metrics["cardClass"].split()
                        if name == "single":
                            valid = valid and metrics["surface"]["fg"] == "light"
                            valid = valid and metrics["surface"]["stops"] == 1
                        if name in ("warm", "white", "yellow"):
                            valid = valid and metrics["surface"]["fg"] == "dark"
                        if name in ("on", "success"):
                            valid = valid and metrics["backgroundImage"].startswith("linear-gradient")
                        if metrics["slider"]:
                            valid = valid and metrics["slider"]["height"] >= 44
                            valid = valid and metrics["slider"]["role"] == "slider"
                            if name == "off":
                                valid = valid and bool(metrics["slider"]["label"])
                    if name == "loading":
                        valid = valid and bool(metrics["status"])
                    if name == "error":
                        valid = valid and bool(metrics["error"])
                    report["cases"].append({"width": width, "theme": theme, "state": name,
                                            "ok": bool(valid), "metrics": metrics, "screenshot": shot})
                # The dialog in the same matrix; 320 px is the phone (bottom sheet).
                for dialog_case in ("success", "warm"):
                    page.set_viewport_size({"width": width, "height": 900})
                    dialog_metrics = page.evaluate("""(payload) => {
                        window.freshStep();
                        document.querySelectorAll('busch-light-dialog').forEach(d => d.remove());
                        const stack = document.getElementById('stack');
                        stack.replaceChildren();
                        const card = document.createElement('busch-light-card');
                        card.setConfig({ type: 'custom:busch-light-card', entity: payload.root,
                            scenes: [{ entity: 'scene.demo_day', title: 'Tageslicht', color: '#ffe0a3',
                                       icon: 'mdi:white-balance-sunny' },
                                     { entity: 'scene.demo_night', title: 'Nachtlicht', color: '#2d3c8c',
                                       icon: 'mdi:weather-night' },
                                     { entity: 'scene.demo_pink', title: 'Abendrot', color: '#ff5ca8' },
                                     { entity: 'scene.demo_gone', title: 'Fehlt absichtlich' }] });
                        stack.appendChild(card);
                        const states = Object.assign({}, payload.states, {
                            'scene.demo_day': { entity_id: 'scene.demo_day', state: 'scening', attributes: {} },
                            'scene.demo_night': { entity_id: 'scene.demo_night', state: 'scening', attributes: {} },
                            'scene.demo_pink': { entity_id: 'scene.demo_pink', state: 'scening', attributes: {} } });
                        card.hass = window.makeHass(states);
                        card._openDialog();
                        const sr = document.querySelector('busch-light-dialog').shadowRoot;
                        const sheet = sr.querySelector('.sheet').getBoundingClientRect();
                        const I = customElements.get('busch-light-card').__internals;
                        const rgbOf = (css) => {
                            const m = String(css).match(/rgba?\\(([^)]+)\\)/);
                            const p = m[1].split(',').map(Number);
                            return { r: p[0], g: p[1], b: p[2], a: 1 };
                        };
                        const head = sr.querySelector('.head');
                        const headStops = (head.style.background.match(/rgba?\\([^)]+\\)/g) || []).map(rgbOf);
                        const headText = rgbOf(getComputedStyle(head.querySelector('h1')).color);
                        const ratios = [];
                        headStops.forEach(c => ratios.push(I.contrastRatio(headText, c)));
                        sr.querySelectorAll('.scene:not([disabled]), .tile.lit').forEach(t => {
                            const bg = rgbOf(getComputedStyle(t).backgroundColor);
                            const fg = rgbOf(getComputedStyle(t).color);
                            ratios.push(I.contrastRatio(fg, bg));
                            if (t.classList.contains('tile')) ratios.push(I.contrastRatio(fg,
                                { r: bg.r * I.TILE_SHADE, g: bg.g * I.TILE_SHADE, b: bg.b * I.TILE_SHADE, a: 1 }));
                        });
                        return { headLit: head.classList.contains('lit'), headStops: headStops.length,
                                 minRatio: Math.min(...ratios), checked: ratios.length,
                                 sheetWidth: sheet.width, viewport: innerWidth,
                                 scrollWidth: sr.querySelector('.sheet').scrollWidth,
                                 clientWidth: sr.querySelector('.sheet').clientWidth };
                    }""", {"root": root, "states": scenarios[dialog_case]["states"]})
                    page.wait_for_timeout(300)
                    shot = f"dialog-{dialog_case}-{width}-{theme}.png"
                    page.screenshot(path=str(result / shot))
                    ok = (dialog_metrics["headLit"] and dialog_metrics["minRatio"] >= 4.5
                          and dialog_metrics["checked"] >= 4
                          and dialog_metrics["scrollWidth"] <= dialog_metrics["clientWidth"] + 1)
                    if width < 450:
                        ok = ok and abs(dialog_metrics["sheetWidth"] - dialog_metrics["viewport"]) <= 1
                    report["cases"].append({"width": width, "theme": theme,
                        "state": f"dialog-{dialog_case}", "ok": bool(ok),
                        "metrics": dialog_metrics, "screenshot": shot})
                    page.evaluate("""() => document.querySelectorAll('busch-light-dialog')
                        .forEach(d => d.close ? d.close() : d.remove())""")
                    page.wait_for_timeout(120)
                    page.evaluate("() => document.querySelectorAll('busch-light-dialog').forEach(d => d.remove())")
                page.set_viewport_size({"width": width, "height": 1000})

                page.evaluate("""() => {
                    const stack = document.getElementById('stack');
                    stack.replaceChildren();
                    const ed = customElements.get('busch-light-card').getConfigElement();
                    stack.appendChild(ed);
                    ed.hass = window.makeHass({});
                    ed.setConfig({type:'custom:busch-light-card', entity:'light.long',
                        title:'Ein sehr langer erfundener Lampenname für viele Testbereiche',
                        scenes:[{entity:'scene.long', title:'Eine sehr lange Szene für Licht am Abend'}]});
                }""")
                page.wait_for_timeout(40)
                shot = f"editor-long-{width}-{theme}.png"
                page.locator("busch-light-card-editor").screenshot(path=str(result / shot))
                editor_metrics = page.evaluate("""() => {
                    const ed = document.querySelector('busch-light-card-editor');
                    return {width: ed.getBoundingClientRect().width, scrollWidth: ed.scrollWidth,
                        rows: ed.shadowRoot.querySelectorAll('.scene-row').length,
                        actions: Array.from(ed.shadowRoot.querySelectorAll('.iconbtn, .addbtn'))
                            .map(button => ({width:button.getBoundingClientRect().width,
                                             height:button.getBoundingClientRect().height}))};
                }""")
                # #715: the editor with the new options set.
                page.evaluate("""() => {
                    const stack = document.getElementById('stack');
                    stack.replaceChildren();
                    const ed = customElements.get('busch-light-card').getConfigElement();
                    stack.appendChild(ed);
                    ed.hass = window.makeHass({});
                    ed.setConfig({type:'custom:busch-light-card', entity:'light.demo_group',
                        slider:'mushroom', icon_size:'big', description:false, live_update:false,
                        theme:'Demo-Thema', api_id:'wohnzimmer', is_visible:false});
                }""")
                page.wait_for_timeout(40)
                page.evaluate("""() => document.querySelector('busch-light-card-editor').shadowRoot
                    .querySelectorAll('details').forEach(d => { d.open = true; })""")
                page.wait_for_timeout(40)
                shot_options = f"editor-optionen-{width}-{theme}.png"
                page.locator("busch-light-card-editor").screenshot(path=str(result / shot_options))
                options_metrics = page.evaluate("""() => {
                    const ed = document.querySelector('busch-light-card-editor');
                    const forms = Array.from(ed.shadowRoot.querySelectorAll('ha-form'));
                    const data = Object.assign({}, ...forms.map(f => f.data || {}));
                    return {width: ed.getBoundingClientRect().width, scrollWidth: ed.scrollWidth,
                        data: {slider: data.slider, icon_size: data.icon_size,
                               show_description: data.show_description, live_update: data.live_update,
                               theme: data.theme, api_id: data.api_id, is_visible: data.is_visible},
                        text: forms.map(f => f.textContent).join(' | ')};
                }""")
                report["cases"].append({"width": width, "theme": theme, "state": "editor-optionen",
                    "ok": options_metrics["width"] == width
                          and options_metrics["scrollWidth"] <= width + 1
                          and options_metrics["data"] == {"slider": "mushroom", "icon_size": "big",
                              "show_description": False, "live_update": False, "theme": "Demo-Thema",
                              "api_id": "wohnzimmer", "is_visible": False}
                          and "Live beim Ziehen" in options_metrics["text"],
                    "metrics": {k: options_metrics[k] for k in ("width", "scrollWidth", "data")},
                    "screenshot": shot_options})
                report["cases"].append({"width": width, "theme": theme, "state": "editor-long",
                    "ok": editor_metrics["width"] == width
                          and editor_metrics["scrollWidth"] <= width + 1
                          and editor_metrics["rows"] == 1
                          and bool(editor_metrics["actions"])
                          and all(action["width"] >= 44 and action["height"] >= 44
                                  for action in editor_metrics["actions"]),
                    "metrics": editor_metrics, "screenshot": shot})

        # Real keyboard events verify the card's three action surfaces. The
        # card's own service routing is exercised, not an event-handler spy.
        page.evaluate("""(payload) => {
            window.freshStep();
            window.__serviceCalls = [];
            const stack = document.getElementById('stack');
            stack.replaceChildren();
            const card = document.createElement('busch-light-card');
            card.setConfig({type:'custom:busch-light-card', entity:payload.root,
                tap_action:'toggle'});
            stack.appendChild(card);
            card.hass = window.makeHass(payload.states);
            card.shadowRoot.querySelector('.tap').focus();
        }""", {"root": root, "states": on})
        page.keyboard.press("Enter")
        tap_calls = page.evaluate("window.__serviceCalls.length")
        page.evaluate("document.querySelector('busch-light-card').shadowRoot.querySelector('.desc').focus()")
        page.keyboard.press("Space")
        status_calls = page.evaluate("window.__serviceCalls.length")
        # The two toggles above left previews (the harness never answers);
        # the slider sub-step starts from the reported state again (#712).
        page.evaluate("""(states) => { window.freshStep();
            document.querySelector('busch-light-card').hass = window.makeHass(states); }""", on)
        page.evaluate("document.querySelector('busch-light-card').shadowRoot.querySelector('.slider').focus()")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        slider_result = page.evaluate("""() => {
            const card = document.querySelector('busch-light-card');
            return {calls: window.__serviceCalls.length,
                value: card.shadowRoot.querySelector('.slider').getAttribute('aria-valuenow'),
                services: window.__serviceCalls};
        }""")
        page.evaluate("document.querySelector('busch-light-card').shadowRoot.querySelector('.toggle').focus()")
        page.keyboard.press("Space")
        toggle_calls = page.evaluate("window.__serviceCalls.length")
        report["keyboard"] = {"tapCalls": tap_calls, "statusCalls": status_calls,
                              "slider": slider_result, "toggleCalls": toggle_calls}
        report["keyboard"]["ok"] = (tap_calls > 0 and status_calls > tap_calls
             and slider_result["calls"] > status_calls and slider_result["value"] == "78"
             and toggle_calls > slider_result["calls"])
        browser.close()
    server.shutdown()
    report["passed"] = sum(case["ok"] for case in report["cases"])
    report["failed"] = len(report["cases"]) - report["passed"]
    (result / "visual-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                                encoding="utf-8")
    for case in report["cases"]:
        if not case["ok"]:
            print("FAIL", case["width"], case["theme"], case["state"], case["metrics"])
    print(f"visual contract: {report['passed']}/{len(report['cases'])} passed, "
          f"page errors={len(report['errors'])}")
    print(f"keyboard: {'ok' if report['keyboard']['ok'] else 'FAIL'}")
    return 0 if not report["failed"] and not report["errors"] and report["keyboard"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
