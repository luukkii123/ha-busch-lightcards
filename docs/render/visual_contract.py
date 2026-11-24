#!/usr/bin/env python3
"""Browser probe for Busch HA UI 0.1.0; output stays in an ignored result folder.

Usage: visual_contract.py <dist/busch-lightcards.js> <repo-local-result-dir>
The accepted screenshots are copied separately to docs/render/baseline/.
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

from render import PAGE, serve, ha_icon_einbinden, HANDY_BREITEN, REGELN_DA, CI_MODUS

if REGELN_DA:  # hacs/docs/render/regeln.py, imported by render.py from /work
    from regeln import messe_text, messe_popup, bewerte, zaehle, messe_kontrast_touch_hier

# M26: contrast and touch targets (hacs/scripts/kontrast_touch.py via regeln.messe_kontrast_touch_hier) of every
# card and dialog state, at every width and in both themes. Exceptions only with a reason (R24), and only for
# stand-ins or Home Assistant elements (tests/render-kontrast.test.js).
AUSNAHMEN = Path(__file__).resolve().with_name("kontrast-ausnahmen.json")

# M76 (Buschcheck F14): every state also at the phone widths 360 and 390 px.
BREITEN = (320, *HANDY_BREITEN, 480, 960)


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


# M28: the dialog's close X, measured where it is drawn - in the group view and
# in a light's detail view, at every width and theme: present, first in the
# header, mdi:close, at least 44 x 44 px, inside the sheet and the viewport,
# visible and the topmost element at its centre. Animations are finished first,
# so the sheet's grow-in scale does not shrink the measured box.
CLOSE_X_JS = """(view) => {
    const dlg = document.querySelector('busch-light-dialog');
    if (view === 'detail') { dlg._detailEntity = 'light.demo_2'; dlg._renderSheet(); }
    const sr = dlg.shadowRoot;
    sr.getAnimations().forEach(a => a.finish());
    const sheet = sr.querySelector('.sheet').getBoundingClientRect();
    const head = sr.querySelector('.head');
    const x = head.querySelector('.busch-dialog-close');
    if (!x) return { view, present: false };
    const r = x.getBoundingClientRect();
    const cs = getComputedStyle(x);
    const hit = sr.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { view, present: true, first: head.firstElementChild === x,
        icon: x.querySelector('ha-icon') ? x.querySelector('ha-icon').getAttribute('icon') : null,
        label: x.getAttribute('aria-label'), width: x.offsetWidth, height: x.offsetHeight,
        rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        sheet: { left: sheet.left, top: sheet.top, right: sheet.right, bottom: sheet.bottom },
        inSheet: r.left >= sheet.left - 0.5 && r.top >= sheet.top - 0.5
            && r.right <= sheet.right + 0.5 && r.bottom <= sheet.bottom + 0.5,
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        visible: cs.display !== 'none' && cs.visibility === 'visible' && Number(cs.opacity) >= 0.99,
        hit: !!hit && (hit === x || x.contains(hit)),
        order: Array.from(head.querySelectorAll('.iconbtn')).map(b => b.getAttribute('aria-label')) };
}"""


# M27: one state block for error, empty and offline (BuschUI.stateBlock), the
# same build in card and dialog: kind, role/aria-live, title and hint, symbol,
# centred column, inside its surface. `scope` is the shadow root to search.
STATE_JS = """(scope) => {
    const blocks = Array.from(scope.querySelectorAll('.busch-state'));
    const regions = Array.from(scope.querySelectorAll('[role=status], [role=alert]'))
        .filter(el => el.getAttribute('aria-live'));
    const b = blocks[0];
    if (!b) return { count: 0, regions: regions.length };
    const surface = (scope.querySelector('.sheet') || scope.querySelector('ha-card')).getBoundingClientRect();
    const r = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const icon = b.querySelector('.busch-state-icon');
    return { count: blocks.length, regions: regions.length, kind: b.getAttribute('data-kind'),
        role: b.getAttribute('role'), live: b.getAttribute('aria-live'),
        title: b.querySelector('.busch-state-title') ? b.querySelector('.busch-state-title').textContent : null,
        hint: b.querySelector('.busch-state-hint') ? b.querySelector('.busch-state-hint').textContent : null,
        icon: icon ? icon.getAttribute('icon') : null,
        iconSize: icon ? icon.getBoundingClientRect().width : 0,
        column: cs.display === 'flex' && cs.flexDirection === 'column' && cs.alignItems === 'center'
            && cs.textAlign === 'center',
        inside: r.left >= surface.left - 0.5 && r.right <= surface.right + 0.5
            && r.top >= surface.top - 0.5 && r.bottom <= surface.bottom + 0.5 };
}"""


def state_ok(measured, kind):
    """True when exactly one state block of `kind` is drawn the shared way."""
    return bool(measured.get("count") == 1 and measured["kind"] == kind
                and measured["role"] == ("alert" if kind == "error" else "status")
                and measured["live"] == ("assertive" if kind == "error" else "polite")
                and measured["title"] and measured["hint"] and measured["icon"]
                and measured["iconSize"] >= 20 and measured["column"] and measured["inside"])


def close_x_ok(measured):
    """True when the X of one view passes every M28 measurement."""
    ok = (measured.get("present") is True and measured["first"] and measured["icon"] == "mdi:close"
          and measured["width"] >= 44 and measured["height"] >= 44
          and measured["inSheet"] and measured["inViewport"] and measured["visible"] and measured["hit"])
    if measured.get("view") == "detail":
        # X left, the back arrow after it (picture order = tab order).
        ok = ok and len(measured["order"]) == 2 and measured["order"][0] == measured["label"]
    return bool(ok)


# M76: rule 1 of an open dialog on the whole sheet, as render.py m76_regel1 does it. At a phone
# width the full-screen sheet scrolls (rule 2); a tile below the fold would report a rectangle
# under the visible sheet without any text having left its box. So the window grows to the
# sheet's scrollHeight first (width unchanged: sideways overhang and real overflow still count),
# and goes back afterwards. If the sheet still scrolls, wholeSheet is false and the run fails.
SHEET_JS = """() => {
    const d = document.querySelector('busch-light-dialog');
    const s = d && d.shadowRoot.querySelector('.sheet');
    return s ? { scrollHeight: s.scrollHeight, clientHeight: s.clientHeight } : null;
}"""


def rule1_sheet(page, width):
    """Rule 1 (regeln.messe_text) on the open dialog's `.sheet`, nothing scrolled out of sight."""
    before = page.viewport_size["height"]
    sheet = page.evaluate(SHEET_JS)
    height = before
    for _ in range(3):  # the sheet may grow with the window once
        if not sheet or sheet["scrollHeight"] <= sheet["clientHeight"] + 1:
            break
        height = max(height + 1, height + sheet["scrollHeight"] - sheet["clientHeight"])
        page.set_viewport_size({"width": width, "height": int(height)})
        page.wait_for_timeout(300)
        sheet = page.evaluate(SHEET_JS)
    text = messe_text(page, ".sheet")
    frame = {"windowHeight": int(height), "sheet": sheet,
             "wholeSheet": bool(sheet) and sheet["scrollHeight"] <= sheet["clientHeight"] + 1}
    if height != before:
        page.set_viewport_size({"width": width, "height": int(before)})
        page.wait_for_timeout(300)
    return {"text": text, "frame": frame}


def open_dialog_by_tap(page):
    """Rule 2 opener: a click on the card's title button, like render.py oeffne_dialog."""
    page.evaluate("""() => {
        window.freshStep();
        document.querySelectorAll('busch-light-dialog').forEach(d => d.remove());
        document.querySelector('busch-light-card').shadowRoot.querySelector('.tap')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }""")


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
    # M76: rules 1 and 2 at 360/390 px, one entry per state, width and theme.
    rules = []
    # M26: one run per state (and dialog view), width and theme, in the form of regeln.messe_kontrast_touch.
    if REGELN_DA:
        kontrast_touch = {bereich: {"ausnahmen_datei": None, "laeufe": []} for bereich in ("kontrast", "touch")}
    else:
        kontrast_touch = {bereich: {"kein_urteil": "regeln.py nicht gefunden"
                                    + (" (CI-Modus)" if CI_MODUS else " — /work ist da, Fehler")}
                          for bereich in ("kontrast", "touch")}
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(args=["--force-color-profile=srgb"])
        ha_icon_einbinden(browser)  # M79: real MDI glyphs (regeln.py); CI mode keeps the page's stub
        page = browser.new_page(viewport={"width": 320, "height": 1000},
                                device_scale_factor=2, locale="de-DE")
        page.on("pageerror", lambda error: report["errors"].append(str(error)))

        def open_dialog():
            open_dialog_by_tap(page)

        def measure_kt(selector, width, theme, state, view=None):
            """M26: contrast and touch of `selector` as it is drawn now (animations finished first)."""
            if not REGELN_DA:
                return
            page.evaluate("""() => [document, ...Array.from(document.querySelectorAll(
                    'busch-light-card, busch-light-dialog'), h => h.shadowRoot).filter(Boolean)]
                .forEach(root => root.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }))""")
            measured = messe_kontrast_touch_hier(page, selector, ausnahmen=AUSNAHMEN)
            contrast = measured["kontrast"]
            # A lit card is a colour gradient: the browser measurement cannot judge text on it (kein_urteil,
            # counted, not passed). Only then its "no text judged" is no violation; tests/kontrast.test.js
            # computes those colours instead. Anything else stays a violation.
            gradient = [v for v in contrast["kontrast_verstoesse"]
                        if str(v.get("fehler", "")).startswith("kein Text beurteilt")]
            if (gradient and contrast.get("kein_urteil") and all(
                    str(k.get("grund", "")).startswith("Hintergrundbild/Verlauf")
                    for k in contrast.get("kein_urteil_liste", []))):
                contrast["kontrast_verstoesse"] = [v for v in contrast["kontrast_verstoesse"]
                                                   if v not in gradient]
                contrast["verlauf"] = "Fläche ist ein Verlauf: kein_urteil, gerechnet in tests/kontrast.test.js"
            for bereich, wert in measured.items():
                kontrast_touch[bereich]["ausnahmen_datei"] = wert.pop("ausnahmen_datei", None)
                kontrast_touch[bereich]["laeufe"].append({"breite": width, "thema": theme, "zustand": state,
                                                          **({"ansicht": view} if view else {}), **wert})
        harness = result / "harness.html"
        harness.write_text(PAGE.replace("__SRC__", f"/dist/{card_file.name}")
                           .replace("__WIDTH__", "960"), encoding="utf-8")
        page.goto(f"http://127.0.0.1:{port_holder[0]}/{harness.relative_to(repo)}")
        page.wait_for_function("() => !!customElements.get('busch-light-card')")
        for width in BREITEN:
            phone = REGELN_DA and width in HANDY_BREITEN
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
                        '--secondary-background-color': '#2b3844',
                        '--primary-color': '#75b8ee',
                        '--success-color': '#6fd1a8',
                        '--warning-color': '#f5bb67',
                        '--error-color': '#ff8b8b'
                    } : {
                        '--card-background-color': '#ffffff',
                        '--primary-text-color': '#17212b',
                        '--secondary-text-color': '#566574',
                        '--divider-color': '#dbe2e9',
                        '--secondary-background-color': '#e9eef2',
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
                            error: sr.querySelector('.busch-state[data-kind=error]')?.textContent,
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
                    metrics["state"] = page.evaluate("(scope) => (" + STATE_JS + ")(document"
                        ".querySelector('busch-light-card').shadowRoot)", None)
                    measure_kt("busch-light-card", width, theme, name)
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
                        if (width == 320 and metrics["toggle"]
                                and name not in ("no_description", "empty", "unavailable")):
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
                    # M27: error, empty and offline are the same state block; every
                    # card has a live region, empty while nothing is to be told.
                    state_kind = {"error": "error", "empty": "empty", "unavailable": "offline"}.get(name)
                    if state_kind:
                        valid = valid and state_ok(metrics["state"], state_kind)
                    else:
                        valid = valid and metrics["state"].get("count") == 0
                        valid = valid and metrics["state"]["regions"] >= 1
                    if name == "error":
                        valid = valid and bool(metrics["error"])
                    report["cases"].append({"width": width, "theme": theme, "state": name,
                                            "ok": bool(valid), "metrics": metrics, "screenshot": shot})
                    if phone:
                        rules.append({"width": width, "theme": theme, "state": name,
                                      "regel1": messe_text(page, "busch-light-card")})
                # The dialog in the same matrix; 320 px is the phone (bottom sheet).
                # M29: the sheet follows the theme; dialog_theme: dark ("darklook")
                # must give back the black sheet of 0.13.3 in both themes.
                for dialog_case, look in (("success", None), ("warm", None), ("warm", "dark")):
                    page.set_viewport_size({"width": width, "height": 900})
                    dialog_metrics = page.evaluate("""(payload) => {
                        window.freshStep();
                        document.querySelectorAll('busch-light-dialog').forEach(d => d.remove());
                        const stack = document.getElementById('stack');
                        stack.replaceChildren();
                        const card = document.createElement('busch-light-card');
                        card.setConfig({ type: 'custom:busch-light-card', entity: payload.root,
                            ...(payload.look ? { dialog_theme: payload.look } : {}),
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
                        // M29: sheet colour and the missing scene's contrast, measured.
                        const sheetEl = sr.querySelector('.sheet');
                        const gone = sr.querySelector('.scene[disabled]');
                        const goneBg = rgbOf(getComputedStyle(gone).backgroundColor);
                        const goneFg = rgbOf(getComputedStyle(gone).color);
                        const offTile = sr.querySelector('.tile:not(.lit):not(.dead)');
                        const probe = document.createElement('div');
                        probe.style.background = 'var(--card-background-color)';
                        document.body.appendChild(probe);
                        const themeBg = getComputedStyle(probe).backgroundColor;
                        probe.remove();
                        const sheetBg = getComputedStyle(sheetEl).backgroundColor;
                        const look = {
                            sheetBg, themeBg,
                            sheetLuminance: I.contrastRatio(rgbOf(sheetBg), { r: 0, g: 0, b: 0, a: 1 }),
                            text: getComputedStyle(sheetEl).color,
                            offTileBg: offTile ? getComputedStyle(offTile).backgroundColor : null,
                            goneOpacity: getComputedStyle(gone).opacity,
                            goneContrast: Math.round(I.contrastRatio(goneFg, goneBg) * 100) / 100,
                            attribute: document.querySelector('busch-light-dialog').getAttribute('dialog-theme')
                        };
                        return { look, headLit: head.classList.contains('lit'), headStops: headStops.length,
                                 minRatio: Math.min(...ratios), checked: ratios.length,
                                 sheetWidth: sheet.width, viewport: innerWidth,
                                 scrollWidth: sr.querySelector('.sheet').scrollWidth,
                                 clientWidth: sr.querySelector('.sheet').clientWidth };
                    }""", {"root": root, "states": scenarios[dialog_case]["states"], "look": look})
                    page.wait_for_timeout(300)
                    x_group = page.evaluate(CLOSE_X_JS, "group")
                    shot = (f"dialog-{dialog_case}-{width}-{theme}.png" if not look
                            else f"dialog-{dialog_case}-darklook-{width}-{theme}.png")
                    page.screenshot(path=str(result / shot))
                    rule_name = f"dialog-{dialog_case}" + (f"-{look}look" if look else "")
                    measure_kt(".sheet", width, theme, rule_name, "group")
                    rule1_group = rule1_sheet(page, width) if phone else None
                    x_detail = page.evaluate(CLOSE_X_JS, "detail")
                    measure_kt(".sheet", width, theme, rule_name, "detail")
                    rule1_detail = rule1_sheet(page, width) if phone else None
                    dialog_metrics["closeX"] = [x_group, x_detail]
                    ok = (dialog_metrics["headLit"] and dialog_metrics["minRatio"] >= 4.5
                          and dialog_metrics["checked"] >= 4
                          and dialog_metrics["scrollWidth"] <= dialog_metrics["clientWidth"] + 1)
                    if width < 450:
                        ok = ok and abs(dialog_metrics["sheetWidth"] - dialog_metrics["viewport"]) <= 1
                    measured = dialog_metrics["look"]
                    # The missing scene keeps 3:1 and is not dimmed by opacity (M29).
                    ok = ok and measured["goneContrast"] >= 3 and measured["goneOpacity"] == "1"
                    # M28: the same X, top left, in both views (measured above).
                    ok = ok and close_x_ok(x_group) and close_x_ok(x_detail)
                    if look == "dark":
                        # The 0.13.3 picture: #171717 sheet, white text, #363636 tiles.
                        ok = ok and measured["attribute"] == "dark"
                        ok = ok and measured["sheetBg"] == "rgb(23, 23, 23)"
                        ok = ok and measured["text"] == "rgb(255, 255, 255)"
                        ok = ok and measured["offTileBg"] in (None, "rgb(54, 54, 54)")
                    else:
                        # Light theme light, dark theme dark: the theme's own card colour.
                        ok = ok and measured["attribute"] is None
                        ok = ok and measured["sheetBg"] == measured["themeBg"]
                        ok = ok and ((measured["sheetLuminance"] > 10) if theme == "light"
                                     else (measured["sheetLuminance"] < 3))
                    report["cases"].append({"width": width, "theme": theme,
                        "state": f"dialog-{dialog_case}" + (f"-{look}look" if look else ""), "ok": bool(ok),
                        "metrics": dialog_metrics, "screenshot": shot})
                    page.evaluate("""() => document.querySelectorAll('busch-light-dialog')
                        .forEach(d => d.close ? d.close() : d.remove())""")
                    page.wait_for_timeout(120)
                    page.evaluate("() => document.querySelectorAll('busch-light-dialog').forEach(d => d.remove())")
                    if phone:
                        rules.append({"width": width, "theme": theme, "state": rule_name,
                                      "regel1": {"gruppe": rule1_group, "detail": rule1_detail},
                                      "regel2": messe_popup(page, open_dialog, ".sheet", ".head .iconbtn",
                                                            dialog_typ="bearbeitung")})
                        page.evaluate("() => document.querySelectorAll('busch-light-dialog').forEach(d => d.remove())")
                # M27: no member reachable - the dialog shows the offline state
                # block where the controls were, the detail view of an
                # unreachable light likewise; the X is measured in both (M28).
                page.evaluate("""(payload) => {
                    window.freshStep();
                    document.querySelectorAll('busch-light-dialog').forEach(d => d.remove());
                    const stack = document.getElementById('stack');
                    stack.replaceChildren();
                    const card = document.createElement('busch-light-card');
                    card.setConfig({ type: 'custom:busch-light-card', entity: payload.root });
                    stack.appendChild(card);
                    card.hass = window.makeHass(payload.states);
                    card._openDialog();
                }""", {"root": root, "states": scenarios["unavailable"]["states"]})
                page.wait_for_timeout(300)
                off_group = page.evaluate("() => (" + STATE_JS + ")(document"
                                          ".querySelector('busch-light-dialog').shadowRoot)")
                off_x_group = page.evaluate(CLOSE_X_JS, "group")
                shot = f"dialog-offline-{width}-{theme}.png"
                page.screenshot(path=str(result / shot))
                measure_kt(".sheet", width, theme, "dialog-offline", "group")
                off_rule1_group = rule1_sheet(page, width) if phone else None
                off_x_detail = page.evaluate(CLOSE_X_JS, "detail")
                measure_kt(".sheet", width, theme, "dialog-offline", "detail")
                off_rule1_detail = rule1_sheet(page, width) if phone else None
                off_detail = page.evaluate("() => (" + STATE_JS + ")(document"
                                           ".querySelector('busch-light-dialog').shadowRoot)")
                off_ok = (state_ok(off_group, "offline") and state_ok(off_detail, "offline")
                          and off_group["title"] != off_detail["title"]
                          and close_x_ok(off_x_group) and close_x_ok(off_x_detail))
                report["cases"].append({"width": width, "theme": theme, "state": "dialog-offline",
                    "ok": bool(off_ok), "metrics": {"group": off_group, "detail": off_detail,
                                                    "closeX": [off_x_group, off_x_detail]},
                    "screenshot": shot})
                page.evaluate("""() => document.querySelectorAll('busch-light-dialog')
                    .forEach(d => d.close ? d.close() : d.remove())""")
                page.wait_for_timeout(120)
                page.evaluate("() => document.querySelectorAll('busch-light-dialog').forEach(d => d.remove())")
                if phone:
                    rules.append({"width": width, "theme": theme, "state": "dialog-offline",
                                  "regel1": {"gruppe": off_rule1_group, "detail": off_rule1_detail},
                                  "regel2": messe_popup(page, open_dialog, ".sheet", ".head .iconbtn",
                                                        dialog_typ="bearbeitung")})
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
                if phone:
                    rules.append({"width": width, "theme": theme, "state": "editor-long",
                                  "regel1": messe_text(page, "busch-light-card-editor")})
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
                if phone:
                    rules.append({"width": width, "theme": theme, "state": "editor-optionen",
                                  "regel1": messe_text(page, "busch-light-card-editor")})
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
        # M57: the status line is no tab stop any more (tabindex -1, same action
        # as the title button); focused by script it still answers the key.
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
        # M57 (Buschcheck F6): real Tab presses through one card, off and on.
        # The header has two stops (title button, switch); the slider is the
        # third only while it can act. No heading may sit inside a button.
        tab_stops = {}
        for label, states in (("off", off), ("on", on)):
            page.evaluate("""(payload) => {
                window.freshStep();
                const stack = document.getElementById('stack');
                stack.replaceChildren();
                const before = document.createElement('button');
                before.id = 'tab-start'; before.textContent = 'start';
                stack.appendChild(before);
                const card = document.createElement('busch-light-card');
                card.setConfig({type:'custom:busch-light-card', entity:payload.root});
                stack.appendChild(card);
                card.hass = window.makeHass(payload.states);
                const after = document.createElement('button');
                after.id = 'tab-end'; after.textContent = 'end';
                stack.appendChild(after);
                before.focus();
            }""", {"root": root, "states": states})
            stops = []
            for _ in range(8):
                page.keyboard.press("Tab")
                where = page.evaluate("""() => {
                    const a = document.activeElement;
                    if (a && a.id === 'tab-end') return 'end';
                    const inner = a && a.shadowRoot && a.shadowRoot.activeElement;
                    return inner ? inner.className.split(' ')[0] : (a ? a.tagName : null);
                }""")
                if where == "end":
                    break
                stops.append(where)
            roles = page.evaluate("""() => {
                const sr = document.querySelector('busch-light-card').shadowRoot;
                const buttons = Array.from(sr.querySelectorAll('button, [role=button]'));
                const tap = sr.querySelector('.tap');
                const label = tap.getAttribute('aria-labelledby');
                return { headingsInButtons: buttons.reduce((n, b) =>
                            n + b.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]').length, 0),
                         labelledBy: label, labelText: label && sr.getElementById(label)
                            ? sr.getElementById(label).textContent : null,
                         valuetext: sr.querySelector('.slider').getAttribute('aria-valuetext') };
            }""")
            tab_stops[label] = {"stops": stops, **roles}
        tab_ok = (tab_stops["off"]["stops"] == ["tap", "toggle"]
                  and tab_stops["on"]["stops"] == ["tap", "toggle", "slider"]
                  and all(v["headingsInButtons"] == 0 and v["labelText"] == "Demo-Lichtgruppe"
                          for v in tab_stops.values())
                  and str(tab_stops["on"]["valuetext"]).endswith(" Prozent"))
        report["keyboard"] = {"tapCalls": tap_calls, "statusCalls": status_calls,
                              "slider": slider_result, "toggleCalls": toggle_calls,
                              "tabStops": tab_stops, "tabOk": tab_ok}
        report["keyboard"]["ok"] = (tap_calls > 0 and status_calls > tap_calls
             and slider_result["calls"] > status_calls and slider_result["value"] == "78"
             and toggle_calls > slider_result["calls"] and tab_ok)
        browser.close()
    server.shutdown()
    report["passed"] = sum(case["ok"] for case in report["cases"])
    report["failed"] = len(report["cases"]) - report["passed"]
    # M76: every state at 360 and 390, and rules 1/2 there without a violation.
    widths = {}
    for case in report["cases"]:
        widths.setdefault(case["state"], set()).add(case["width"])
    report["handyBreiten"] = {state: sorted(found) for state, found in widths.items()}
    handy_ok = all(set(HANDY_BREITEN) <= set(found) for found in report["handyBreiten"].values())
    if REGELN_DA:
        report["uiRegeln"] = {"faelle": rules}
        frames = [part["frame"]["wholeSheet"] for entry in rules if isinstance(entry["regel1"], dict)
                  and "gruppe" in entry["regel1"] for part in entry["regel1"].values()]
        rules_ok = (bewerte(report["uiRegeln"]) == 0 and all(frames)
                    and {e["state"] for e in rules} == set(report["handyBreiten"])
                    and len(rules) == len(HANDY_BREITEN) * 2 * len(report["handyBreiten"]))
        report["uiRegeln"]["zaehlung"] = zaehle({"faelle": rules})
        report["uiRegeln"]["ok"] = rules_ok
    else:
        report["uiRegeln"] = {"kein_urteil": "regeln.py nicht gefunden"
                              + (" (CI-Modus)" if CI_MODUS else " — /work ist da, Fehler")}
        rules_ok = CI_MODUS
    # M26: contrast and touch in the report; a violation, or nothing measured, fails the run.
    if REGELN_DA:
        kontrast_touch["touch"]["mindest_px"] = 44
        liste = json.loads(AUSNAHMEN.read_text(encoding="utf-8")) if AUSNAHMEN.is_file() else {}
        for bereich in ("kontrast", "touch"):
            used = {a.get("selektor") for run in kontrast_touch[bereich]["laeufe"] for a in run.get("ausnahmen", [])}
            kontrast_touch[bereich]["ungenutzte_ausnahmen"] = [a["selektor"] for a in liste.get(bereich, [])
                                                               if a["selektor"] not in used]
        kt_ok = bool(kontrast_touch["kontrast"]["laeufe"]) and bewerte(kontrast_touch) == 0
        kt_count = zaehle(kontrast_touch)
    else:
        kt_ok = CI_MODUS
    report["kontrast"] = kontrast_touch["kontrast"]
    report["touch"] = kontrast_touch["touch"]
    (result / "visual-report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False),
                                                encoding="utf-8")
    for case in report["cases"]:
        if not case["ok"]:
            print("FAIL", case["width"], case["theme"], case["state"], case["metrics"])
    print(f"visual contract: {report['passed']}/{len(report['cases'])} passed, "
          f"page errors={len(report['errors'])}")
    print(f"keyboard: {'ok' if report['keyboard']['ok'] else 'FAIL'}")
    print(f"M76 phone widths {list(HANDY_BREITEN)} for every state: {'ok' if handy_ok else 'FAIL'}")
    if REGELN_DA:
        z = report["uiRegeln"]["zaehlung"]
        print(f"M76 rules 1/2 at 360/390: {'ok' if rules_ok else 'FAIL'} ({len(rules)} cases, "
              f"ueberlauf={z['ueberlauf']} ausserhalb={z['ausserhalb']} ueberlappung={z['ueberlappung']} "
              f"verletzt={z['verletzt']} geprueft={z['geprueft']} kein_urteil={z['kein_urteil']})")
    else:
        print("M76 rules 1/2: " + report["uiRegeln"]["kein_urteil"])
    if REGELN_DA:
        print(f"M26 contrast/touch: {'ok' if kt_ok else 'FAIL'} ({len(kontrast_touch['kontrast']['laeufe'])} runs, "
              f"kontrast_verstoesse={kt_count['kontrast_verstoesse']} touch_verstoesse={kt_count['touch_verstoesse']} "
              f"geprueft={kt_count['geprueft']} kein_urteil={kt_count['kein_urteil']})")
    else:
        print("M26 contrast/touch: " + kontrast_touch["kontrast"]["kein_urteil"])
    return 0 if (not report["failed"] and not report["errors"] and report["keyboard"]["ok"]
                 and handy_ok and rules_ok and kt_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
