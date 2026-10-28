'use strict';
// DOM-, Uhr- und hass-Attrappe für die Lichtkarten-Tests (node --test, ohne Browser).
// Die Karte wird in einer vm-Sandbox geladen; Zeit läuft nur über `uhr.vor(ms)`.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const KARTE = path.join(__dirname, '..', 'dist', 'busch-lightcards.js');

/** Steuerbare Uhr: setTimeout/clearTimeout/Date.now laufen nur bei `vor()`. */
function neueUhr(start = 1_800_000_000_000) {
  let jetzt = start, nr = 0;
  const wartend = new Map();
  const uhr = {
    get jetzt() { return jetzt; },
    setTimeout(fn, ms = 0, ...a) { const id = ++nr; wartend.set(id, { zeit: jetzt + Math.max(0, Number(ms) || 0), fn, a }); return id; },
    clearTimeout(id) { wartend.delete(id); },
    /** Lässt `ms` vergehen und führt fällige Timer in Zeitreihenfolge aus. */
    vor(ms) {
      const ziel = jetzt + ms;
      for (;;) {
        let naechster = null;
        for (const [id, t] of wartend) if (t.zeit <= ziel && (!naechster || t.zeit < naechster[1].zeit)) naechster = [id, t];
        if (!naechster) break;
        wartend.delete(naechster[0]);
        jetzt = naechster[1].zeit;
        naechster[1].fn(...naechster[1].a);
      }
      jetzt = ziel;
    },
  };
  const Echt = Date;
  uhr.Date = class extends Echt {
    constructor(...a) { if (a.length) super(...a); else super(jetzt); }
    static now() { return jetzt; }
  };
  return uhr;
}

class ClassList {
  constructor(el) { this.el = el; }
  _liste() { return String(this.el.className || '').split(/\s+/).filter(Boolean); }
  contains(c) { return this._liste().includes(c); }
  add(...c) { const l = this._liste(); for (const x of c) if (!l.includes(x)) l.push(x); this.el.className = l.join(' '); }
  remove(...c) { this.el.className = this._liste().filter((x) => !c.includes(x)).join(' '); }
  toggle(c, an) { const soll = an === undefined ? !this.contains(c) : !!an; if (soll) this.add(c); else this.remove(c); return soll; }
}

function neueUmgebung({ uhr, sprache = 'de' } = {}) {
  uhr = uhr || neueUhr();
  const registry = new Map();
  const zaehler = { createImageData: 0 };
  let body;

  class Element {
    constructor(tag = 'div') {
      this.tagName = String(tag).toUpperCase(); this.childNodes = []; this.parentNode = null;
      this.listeners = {}; this.attributes = {}; this.dataset = {}; this.className = ''; this.title = ''; this.id = '';
      this._text = ''; this._tabIndex = -1; this.scrollTop = 0; this.clientHeight = 80;
      const style = {}; style.setProperty = (k, v) => { style[k] = String(v); }; style.getPropertyValue = (k) => style[k] || ''; style.removeProperty = (k) => { delete style[k]; };
      this.style = style; this.classList = new ClassList(this);
    }
    get tabIndex() { return this._tabIndex; } set tabIndex(v) { this._tabIndex = Number(v); }
    get disabled() { return 'disabled' in this.attributes; }
    get firstChild() { return this.childNodes[0] || null; }
    get lastChild() { return this.childNodes.at(-1) || null; }
    get isConnected() { let w = this; while (w) { if (w === body) return true; w = w.parentNode || w.host || null; } return false; }
    attachShadow() { const r = new Element('#shadow'); r.host = this; r._aktiv = null; Object.defineProperty(r, 'activeElement', { get() { return r._aktiv && r.all().includes(r._aktiv) ? r._aktiv : null; } }); this.shadowRoot = r; return r; }
    set textContent(v) { this._text = String(v); for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; }
    get textContent() { return this._text + this.childNodes.map((n) => n.textContent).join(''); }
    set innerHTML(v) { this.textContent = ''; if (v) this._text = String(v); }
    get innerHTML() { return this._text; }
    appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); if (this === body && n.connectedCallback) n.connectedCallback(); return n; }
    append(...n) { for (const x of n) this.appendChild(x); }
    remove() { const p = this.parentNode; if (!p) return; p.childNodes = p.childNodes.filter((c) => c !== this); this.parentNode = null; if (p === body && this.disconnectedCallback) this.disconnectedCallback(); }
    setAttribute(k, v) { this.attributes[k] = String(v); if (k === 'class') this.className = String(v); if (k === 'tabindex') this._tabIndex = Number(v); }
    getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
    hasAttribute(k) { return k in this.attributes; }
    removeAttribute(k) { delete this.attributes[k]; }
    addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
    removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
    dispatchEvent(e) { for (const fn of [...(this.listeners[e.type] || [])]) fn(e); return true; }
    focus() { let w = this; while (w.parentNode) w = w.parentNode; w._aktiv = this; }
    blur() {}
    getClientRects() { return [1]; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100 }; }
    setPointerCapture() {} releasePointerCapture() {}
    getContext() { return { createImageData: (w, h) => { zaehler.createImageData++; return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }; }, putImageData() {} }; }
    composedPath() { return []; }
    all() { return [this, ...this.childNodes.flatMap((c) => c.all())]; }
    _passt(sel) {
      sel = sel.trim();
      const attr = sel.match(/^\[([\w-]+)\]$/);
      if (attr) return attr[1] in this.attributes;
      if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
      return this.tagName === sel.toUpperCase();
    }
    matches(sel) { return sel.split(',').some((s) => this._passt(s)); }
    querySelectorAll(sel) { return this.all().slice(1).filter((n) => n.matches(sel)); }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    click() { this.dispatchEvent(neuesEreignis('click')); }
  }
  function neuesEreignis(type, init = {}) {
    return Object.assign({ type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }, init);
  }
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }

  body = new Element('body');
  const docListeners = {};
  const document = {
    body,
    activeElement: null,
    createElement(tag) { const K = registry.get(tag); if (K) { const n = new K(); n.tagName = tag.toUpperCase(); return n; } return new Element(tag); },
    createElementNS(_ns, tag) { return new Element(tag); },
    addEventListener(t, fn) { (docListeners[t] ||= []).push(fn); },
    removeEventListener(t, fn) { docListeners[t] = (docListeners[t] || []).filter((f) => f !== fn); },
    querySelector() { return null; },
  };
  const fenster = { customCards: [], listeners: {}, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }, removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); } };
  const verlauf = { laenge: 1, pushState() { this.laenge++; }, back() {}, go() {} };
  const kontext = {
    console: { info() {}, warn() {}, error() {}, log() {} },
    window: fenster, document, history: verlauf, location: { href: 'http://ha/lovelace/0' },
    navigator: { language: sprache },
    HTMLElement: Element, CustomEvent, Event: CustomEvent,
    customElements: { define: (k, v) => registry.set(k, v), get: (k) => registry.get(k) },
    setTimeout: uhr.setTimeout, clearTimeout: uhr.clearTimeout, Date: uhr.Date,
    Promise, Math, JSON, Object, Array, Map, Set, WeakMap, Number, String, Boolean, Error, Symbol, Uint8ClampedArray, Intl,
  };
  kontext.globalThis = kontext;
  vm.createContext(kontext);
  vm.runInContext(fs.readFileSync(KARTE, 'utf8'), kontext, { filename: 'busch-lightcards.js' });
  return { uhr, kontext, document, body, registry, zaehler, neuesEreignis };
}

// ---- hass ---------------------------------------------------------------

function licht(id, an, { helligkeit = 204, name } = {}) {
  return {
    entity_id: id, state: an ? 'on' : 'off', last_updated: String(Math.random()),
    attributes: Object.assign({ friendly_name: name || id, supported_color_modes: ['color_temp', 'xy'] },
      an ? { brightness: helligkeit, color_mode: 'color_temp', color_temp_kelvin: 2700 } : {}),
  };
}
function gruppe(id, mitglieder, an) {
  return { entity_id: id, state: an ? 'on' : 'off', attributes: { friendly_name: id, entity_id: mitglieder } };
}

/**
 * Wohnzimmer = Gruppe aus Decke (Gruppe aus zwei Lampen) und Stehlampe; dazu
 * 50 fremde Sensoren. `rufe` sammelt jeden callService-Aufruf; `antwort`
 * bestimmt, was callService zurückgibt (Vorgabe: offenes Versprechen wie ein
 * langsames Zigbee-Gerät).
 */
function neuesHaus({ an = false, sprache = 'de' } = {}) {
  const states = {
    'light.wohnzimmer': gruppe('light.wohnzimmer', ['light.decke', 'light.steh'], an),
    'light.decke': gruppe('light.decke', ['light.decke_1', 'light.decke_2'], an),
    'light.decke_1': licht('light.decke_1', an),
    'light.decke_2': licht('light.decke_2', an),
    'light.steh': licht('light.steh', an),
  };
  for (let i = 0; i < 50; i++) states['sensor.fremd_' + i] = { entity_id: 'sensor.fremd_' + i, state: String(i), attributes: {} };
  const haus = { rufe: [], antwort: () => new Promise(() => {}), sprache };
  haus.hass = () => ({
    states: haus.states, language: haus.sprache, locale: { language: haus.sprache }, themes: {},
    callService: (domain, service, data) => { haus.rufe.push({ domain, service, data }); return haus.antwort(domain, service, data); },
  });
  haus.states = states;
  /** Neuer Zustand wie von HA: neues states-Objekt, nur die genannten Einträge ersetzt. */
  haus.setze = (aenderungen) => { haus.states = Object.assign({}, haus.states, aenderungen); return haus.hass(); };
  /** Eine fremde Entität ändert sich (neues states-Objekt, eigene Einträge identisch). */
  haus.fremd = () => { const id = 'sensor.fremd_' + Math.floor(Math.random() * 50); return haus.setze({ [id]: { entity_id: id, state: String(Math.random()), attributes: {} } }); };
  return haus;
}

/** Karte bauen, ins Dokument hängen, hass setzen. */
function neueKarte(umgebung, haus, config = {}) {
  const karte = umgebung.document.createElement('busch-light-card');
  karte.setConfig(Object.assign({ type: 'custom:busch-light-card', entity: 'light.wohnzimmer' }, config));
  umgebung.body.appendChild(karte);
  karte.hass = haus.hass();
  return karte;
}

/** Alle Mikrotasks (Promise-Ketten) abarbeiten. */
const mikro = () => new Promise((r) => setImmediate(r));

module.exports = { neueUhr, neueUmgebung, neuesHaus, neueKarte, licht, gruppe, mikro };
