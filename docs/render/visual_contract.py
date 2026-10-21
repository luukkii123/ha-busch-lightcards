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
    scenarios = {
        "on": {"states": on, "config": {"entity": root}},
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
    }
    expected_tones = {"on": "warning", "off": "warning", "long": "warning",
                      "success": "success", "neutral": "neutral",
                      "custom_color": "neutral",
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
                            tapRole: sr.querySelector('.tap')?.getAttribute('role'),
                            tapTabIndex: sr.querySelector('.tap')?.tabIndex,
                            error: sr.querySelector('.error')?.textContent,
                            background: card && getComputedStyle(card).backgroundColor,
                            accent: getComputedStyle(host).getPropertyValue('--blc-accent').trim()
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
                        if width == 320 and metrics["toggle"]:
                            valid = valid and abs(metrics["toggle"]["center"]
                                - metrics["statusCenter"]) <= 22
                        if name == "long":
                            valid = valid and metrics["warnTextWidth"] >= 6
                        if name == "custom_color":
                            valid = valid and metrics["background"] == "rgb(17, 34, 51)"
                            valid = valid and metrics["titleColor"].startswith("rgba(255, 255, 255")
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
