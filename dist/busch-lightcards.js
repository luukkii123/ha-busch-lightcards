/*
 * busch-lightcards — Hue-like light and scene control for Home Assistant.
 *
 * Contains exactly one card: `busch-light-card`.
 *
 * Two things set this card apart from lovelace-hue-like-light-card, which
 * inspired its looks:
 *
 *   1. Groups are resolved recursively, on every level. A group holding a
 *      group holding a light ends up controlling the light. Duplicates across
 *      branches are collapsed and cycles cannot loop forever.
 *   2. An unreachable entity never takes the card down with it. Counters,
 *      brightness and colour come from the reachable members only, service
 *      calls skip the dead ones, and a missing entity_id renders as
 *      unavailable instead of throwing.
 *
 * No build step: this file is source and delivery in one. See the repository
 * README for why.
 */

const CARD_VERSION = '0.1.0';

const CARD_TAG = 'busch-light-card';
const DIALOG_TAG = 'busch-light-dialog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARM_COLOR = '#ffda95';
const COLD_COLOR = '#f5f5ff';
const OFF_COLOR = '#666666';
const TILE_OFF_COLOR = 'rgba(102, 102, 102, 0.6)';
const DIALOG_BG = '#171717';
const DIALOG_TILE_OFF = '#363636';

// Hue puts the light/dark text breaking point unusually high.
const LUMINANCE_BREAKING_POINT = 192;
const GRADIENT_OFFSET = 7; // percent of a multi-colour gradient held at each end
const TRANSITION_DEFAULT = 'all 0.3s ease-out 0s';

/**
 * Domains whose `entity_id` attribute lists group members.
 * Deliberately narrow: `scene.*` and `automation.*` also carry an `entity_id`
 * attribute, and expanding those would be nonsense.
 */
const GROUP_DOMAINS = new Set(['light', 'switch', 'group']);

/** Domains this card can actually switch. Anything else is dropped on resolve. */
const LEAF_DOMAINS = new Set(['light', 'switch']);

const DEFAULT_MAX_DEPTH = 10;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

const domainOf = (entityId) => String(entityId || '').split('.')[0];

/** Reads a config value, accepting camelCase and snake_case for the same option. */
function pick(config, camel, fallback) {
    if (config == null) return fallback;
    const snake = camel.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (config[camel] !== undefined) return config[camel];
    if (config[snake] !== undefined) return config[snake];
    return fallback;
}

// ---------------------------------------------------------------------------
// Localisation — only the handful of strings the card actually shows
// ---------------------------------------------------------------------------

const STRINGS = {
    en: {
        allOff: 'All off',
        someOn: '{on} of {total} on',
        allOn: 'All on ({total})',
        oneOn: '1 of {total} on',
        unavailable: '{n} unavailable',
        allUnavailable: 'No member reachable',
        noEntities: 'No light resolved',
        scenes: 'Scenes',
        lights: 'Lights',
        brightness: 'Brightness',
        colour: 'Colour',
        white: 'White',
        back: 'Back',
        close: 'Close',
        unreachable: 'unreachable',
        groupOf: 'Group of {n}'
    },
    de: {
        allOff: 'Alle aus',
        someOn: '{on} von {total} an',
        allOn: 'Alle an ({total})',
        oneOn: '1 von {total} an',
        unavailable: '{n} nicht erreichbar',
        allUnavailable: 'Keine Lampe erreichbar',
        noEntities: 'Keine Lampe aufgelöst',
        scenes: 'Szenen',
        lights: 'Lampen',
        brightness: 'Helligkeit',
        colour: 'Farbe',
        white: 'Weiß',
        back: 'Zurück',
        close: 'Schließen',
        unreachable: 'nicht erreichbar',
        groupOf: 'Gruppe aus {n}'
    }
};

function translate(hass, key, vars) {
    const lang = (hass && hass.language ? String(hass.language) : 'en').slice(0, 2);
    const table = STRINGS[lang] || STRINGS.en;
    let text = table[key] !== undefined ? table[key] : STRINGS.en[key];
    if (text === undefined) return key;
    if (vars) {
        Object.keys(vars).forEach((name) => {
            text = text.split('{' + name + '}').join(String(vars[name]));
        });
    }
    return text;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

const NAMED_COLORS = {
    warm: WARM_COLOR,
    cold: COLD_COLOR,
    white: '#ffffff',
    black: '#000000',
    red: '#ff0000',
    green: '#008000',
    blue: '#0000ff',
    yellow: '#ffff00',
    orange: '#ffa500',
    purple: '#800080',
    pink: '#ffc0cb',
    cyan: '#00ffff',
    magenta: '#ff00ff',
    grey: '#808080',
    gray: '#808080'
};

/** Parses '#abc', '#aabbcc', 'rgb(...)', 'rgba(...)' and the names above. */
function parseColor(input) {
    if (input == null) return null;
    if (Array.isArray(input) && input.length >= 3) {
        return { r: clamp(+input[0], 0, 255), g: clamp(+input[1], 0, 255), b: clamp(+input[2], 0, 255), a: 1 };
    }
    let text = String(input).trim().toLowerCase();
    if (NAMED_COLORS[text]) text = NAMED_COLORS[text];

    if (text.startsWith('#')) {
        let hex = text.slice(1);
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        if (hex.length !== 6 && hex.length !== 8) return null;
        const value = parseInt(hex.slice(0, 6), 16);
        if (isNaN(value)) return null;
        const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
        return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255, a: alpha };
    }

    const match = text.match(/^rgba?\(([^)]+)\)$/);
    if (match) {
        const parts = match[1].split(',').map((p) => parseFloat(p.trim()));
        if (parts.length < 3 || parts.some(isNaN)) return null;
        return {
            r: clamp(parts[0], 0, 255),
            g: clamp(parts[1], 0, 255),
            b: clamp(parts[2], 0, 255),
            a: parts.length > 3 ? clamp(parts[3], 0, 1) : 1
        };
    }
    return null;
}

function colorToCss(color) {
    if (!color) return 'transparent';
    const r = Math.round(color.r);
    const g = Math.round(color.g);
    const b = Math.round(color.b);
    if (color.a !== undefined && color.a < 1) return `rgba(${r}, ${g}, ${b}, ${color.a})`;
    return `rgb(${r}, ${g}, ${b})`;
}

function luminance(color) {
    return color.r * 0.299 + color.g * 0.587 + color.b * 0.114;
}

function hueOf(color) {
    return rgb2hsv(color.r, color.g, color.b)[0];
}

/** Picks `light` or `dark` for text on top of `color`. */
function foregroundFor(color, light, dark, offset) {
    return luminance(color) + offset < LUMINANCE_BREAKING_POINT ? light : dark;
}

function hsv2rgb(hue, saturation, value) {
    const h = ((hue % 360) + 360) % 360;
    const s = clamp(saturation, 0, 1);
    const v = clamp(value, 0, 1);
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rgb;
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

function rgb2hsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
        else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
        else h = 60 * ((rn - gn) / delta + 4);
    }
    if (h < 0) h += 360;
    const s = max === 0 ? 0 : delta / max;
    return [h, s, max];
}

/**
 * Colour temperature to RGB along Hue's own curve — not a physical black-body
 * curve. Two straight segments through 2000 K / 4200 K / 6500 K.
 */
function tempToRgb(kelvin) {
    const start = 2000;
    const mid = 4200;
    const end = 6500;
    const startRgb = [255, 180, 55];
    const midRgb = [255, 255, 255];
    const endRgb = [190, 228, 243];
    const scale = (t, min, max) => (max - min) * t + min;

    let k = clamp(kelvin, start, end);
    if (k < mid) {
        const t = (k - start) / (mid - start);
        return [
            Math.round(scale(t, startRgb[0], midRgb[0])),
            Math.round(scale(t, startRgb[1], midRgb[1])),
            Math.round(scale(t, startRgb[2], midRgb[2]))
        ];
    }
    const t = (k - mid) / (end - mid);
    return [
        Math.round(scale(t, midRgb[0], endRgb[0])),
        Math.round(scale(t, midRgb[1], endRgb[1])),
        Math.round(scale(t, midRgb[2], endRgb[2]))
    ];
}

function xyToRgb(x, y, brightness) {
    const bri = brightness === undefined ? 254 : brightness;
    if (!y) return [0, 0, 0];
    const lum = bri / 254;
    const X = (lum / y) * x;
    const Z = (lum / y) * (1 - x - y);
    let r = X * 1.656492 - lum * 0.354851 - Z * 0.255038;
    let g = -X * 0.707196 + lum * 1.655397 + Z * 0.036152;
    let b = X * 0.051713 - lum * 0.121364 + Z * 1.01153;
    const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    r = gamma(Math.max(r, 0));
    g = gamma(Math.max(g, 0));
    b = gamma(Math.max(b, 0));
    const max = Math.max(r, g, b);
    if (max > 1) {
        r /= max;
        g /= max;
        b /= max;
    }
    return [Math.round(clamp(r, 0, 1) * 255), Math.round(clamp(g, 0, 1) * 255), Math.round(clamp(b, 0, 1) * 255)];
}

/**
 * Turns a list of colours into a single CSS background. One colour becomes a
 * flat colour, several become a gradient sorted by hue starting near 195°, the
 * way the Hue app arranges them.
 */
function backgroundCss(colors) {
    if (!colors || !colors.length) return null;
    if (colors.length === 1) return colorToCss(colors[0]);

    const sortValue = (c) => {
        let v = hueOf(c) - 195;
        if (v < 0) v += 360;
        return v;
    };
    const sorted = colors.slice().sort((a, b) => sortValue(a) - sortValue(b));
    const step = 100 / (sorted.length - 1);
    let stops = `${colorToCss(sorted[0])} 0%, ${colorToCss(sorted[0])} ${GRADIENT_OFFSET}%`;
    let at = 0;
    for (let i = 1; i < sorted.length; i++) {
        at += step;
        if (i + 1 === sorted.length) stops += `, ${colorToCss(sorted[i])} ${100 - GRADIENT_OFFSET}%`;
        stops += `, ${colorToCss(sorted[i])} ${Math.round(at)}%`;
    }
    return `linear-gradient(100deg, ${stops})`;
}

/** Foreground for a whole background, mirroring how Hue decides on gradients. */
function foregroundForBackground(colors, offset) {
    if (!colors || !colors.length) return null;
    if (colors.length < 3) return foregroundFor(colors[0], 'light', 'dark', offset);
    let forLight = 0;
    for (let i = 0; i < colors.length / 2; i++) {
        if (foregroundFor(colors[i], true, false, offset)) forLight++;
    }
    return forLight > colors.length / 4 ? 'light' : 'dark';
}

// ---------------------------------------------------------------------------
// Group resolution — the point of this card
// ---------------------------------------------------------------------------

/**
 * Last known member list per group entity.
 *
 * Home Assistant drops the `entity_id` attribute from a group entity as soon
 * as that group goes unavailable — measured on a live 2026.8 install: an
 * unavailable `light` group publishes friendly_name and colour capabilities
 * but no members at all. Without a memory, an unreachable group therefore
 * collapses into one dead entity and takes its entire subtree with it, which
 * is the harshest form of the unavailable problem this card exists to fix.
 */
const MEMBER_CACHE = new Map();

function clearMemberCache() {
    MEMBER_CACHE.clear();
}

/**
 * Returns the member entity ids of `entityId`, or null when it is not a group.
 *
 * A missing entity is *not* a group: it becomes a leaf so it can be shown as
 * unavailable rather than silently disappearing.
 */
function groupMembers(hass, entityId) {
    if (!GROUP_DOMAINS.has(domainOf(entityId))) return null;
    const state = hass && hass.states ? hass.states[entityId] : null;
    const live = state && state.attributes ? state.attributes.entity_id : null;

    if (Array.isArray(live) && live.length) {
        // A group listing itself would otherwise be an immediate cycle.
        const cleaned = live.filter((m) => typeof m === 'string' && m && m !== entityId);
        if (cleaned.length) {
            MEMBER_CACHE.set(entityId, cleaned);
            return cleaned;
        }
        return null;
    }

    // Only fall back to the remembered list while the entity is actually
    // unreachable. An available group that lists nothing really is a leaf,
    // and a stale memory must not override that.
    if (!state || state.state === 'unavailable') {
        const cached = MEMBER_CACHE.get(entityId);
        if (cached && cached.length) return cached;
    }
    return null;
}

/**
 * Resolves `roots` down to controllable leaf entities, following groups on
 * every level.
 *
 * Returns:
 *   leaves     — deduplicated leaf entity ids, in first-seen order
 *   groups     — group entity ids that were expanded
 *   recovered  — groups expanded from the remembered member list because they
 *                are unavailable and no longer publish one
 *   dropped    — members outside LEAF_DOMAINS that were discarded
 *   truncated  — groups left unexpanded because maxDepth was reached
 *   maxDepth   — deepest level actually walked
 *
 * A group met twice (two branches, or a cycle) is expanded once. That makes
 * cycles terminate and keeps a light that sits in two parent groups counted a
 * single time.
 */
function resolveEntities(hass, roots, options) {
    const opts = options || {};
    const limit = opts.maxDepth === undefined ? DEFAULT_MAX_DEPTH : opts.maxDepth;
    const follow = opts.resolveGroups !== false;

    const leaves = [];
    const leafSeen = new Set();
    const expanded = new Set();
    const groups = [];
    const recovered = [];
    const dropped = [];
    const truncated = [];
    let deepest = 0;

    const addLeaf = (entityId) => {
        if (!LEAF_DOMAINS.has(domainOf(entityId))) {
            if (dropped.indexOf(entityId) === -1) dropped.push(entityId);
            return;
        }
        if (leafSeen.has(entityId)) return;
        leafSeen.add(entityId);
        leaves.push(entityId);
    };

    const walk = (entityId, depth) => {
        if (depth > deepest) deepest = depth;
        const members = follow ? groupMembers(hass, entityId) : null;

        if (!members) {
            addLeaf(entityId);
            return;
        }
        if (depth >= limit) {
            // Too deep to keep going: keep the group itself so it stays usable.
            if (truncated.indexOf(entityId) === -1) truncated.push(entityId);
            addLeaf(entityId);
            return;
        }
        if (expanded.has(entityId)) return; // already covered by another branch
        expanded.add(entityId);
        groups.push(entityId);

        const state = hass && hass.states ? hass.states[entityId] : null;
        const publishes = state && state.attributes && Array.isArray(state.attributes.entity_id);
        if (!publishes) recovered.push(entityId);

        members.forEach((member) => walk(member, depth + 1));
    };

    (roots || []).forEach((root) => walk(root, 0));

    return { leaves, groups, recovered, dropped, truncated, maxDepth: deepest };
}

// ---------------------------------------------------------------------------
// A single light or switch
// ---------------------------------------------------------------------------

class LightModel {
    constructor(hass, entityId) {
        this.hass = hass;
        this.entityId = entityId;
        this.domain = domainOf(entityId);
        this.state = hass && hass.states ? hass.states[entityId] : undefined;
        this.attributes = (this.state && this.state.attributes) || {};
    }

    /** Missing from the state machine — a stale group member, usually. */
    get isMissing() {
        return !this.state;
    }

    get isAvailable() {
        return !!this.state && this.state.state !== 'unavailable';
    }

    get isOn() {
        return this.isAvailable && this.state.state === 'on';
    }

    get isOff() {
        return this.isAvailable && this.state.state !== 'on';
    }

    get name() {
        return this.attributes.friendly_name || this.entityId;
    }

    get icon() {
        if (this.attributes.icon) return this.attributes.icon;
        if (this.domain === 'switch') return 'mdi:toggle-switch-outline';
        return 'mdi:lightbulb';
    }

    get colorModes() {
        const modes = this.attributes.supported_color_modes;
        return Array.isArray(modes) ? modes : [];
    }

    get supportsBrightness() {
        if (this.domain !== 'light') return false;
        const modes = this.colorModes;
        if (!modes.length) return false;
        return modes.some((m) => m !== 'onoff');
    }

    get supportsColor() {
        return this.colorModes.some((m) => ['hs', 'xy', 'rgb', 'rgbw', 'rgbww'].indexOf(m) !== -1);
    }

    get supportsTemp() {
        return this.colorModes.indexOf('color_temp') !== -1;
    }

    get minKelvin() {
        return this.attributes.min_color_temp_kelvin || 2000;
    }

    get maxKelvin() {
        return this.attributes.max_color_temp_kelvin || 6535;
    }

    /** Brightness as 0–100. 0 whenever the light is off or unreachable. */
    get brightnessPct() {
        if (!this.isOn) return 0;
        const raw = this.attributes.brightness;
        if (typeof raw !== 'number') return 100;
        return clamp(Math.round((raw / 255) * 100), 1, 100);
    }

    get kelvin() {
        return this.attributes.color_temp_kelvin || null;
    }

    /** Current colour as {r,g,b}, or null when it has none to show. */
    get color() {
        if (!this.isOn) return null;
        const mode = this.attributes.color_mode;
        if (mode === 'color_temp' && this.attributes.color_temp_kelvin) {
            const rgb = tempToRgb(this.attributes.color_temp_kelvin);
            return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
        }
        if (Array.isArray(this.attributes.rgb_color)) {
            const c = this.attributes.rgb_color;
            return { r: c[0], g: c[1], b: c[2], a: 1 };
        }
        if (Array.isArray(this.attributes.xy_color)) {
            const rgb = xyToRgb(this.attributes.xy_color[0], this.attributes.xy_color[1], this.attributes.brightness);
            return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
        }
        if (Array.isArray(this.attributes.hs_color)) {
            const rgb = hsv2rgb(this.attributes.hs_color[0], this.attributes.hs_color[1] / 100, 1);
            return { r: rgb[0], g: rgb[1], b: rgb[2], a: 1 };
        }
        return null;
    }
}

// ---------------------------------------------------------------------------
// The resolved group behind one card
// ---------------------------------------------------------------------------

class GroupModel {
    constructor(hass, config) {
        this.hass = hass;
        this.config = config;

        const roots = config.entityIds;
        const resolution = resolveEntities(hass, roots, {
            maxDepth: config.maxDepth,
            resolveGroups: config.resolveGroups
        });

        this.resolution = resolution;
        this.lights = resolution.leaves.map((id) => new LightModel(hass, id));
        this.alive = this.lights.filter((l) => l.isAvailable);
        this.dead = this.lights.filter((l) => !l.isAvailable);
    }

    get total() {
        return this.alive.length;
    }

    get deadCount() {
        return this.dead.length;
    }

    get onLights() {
        return this.alive.filter((l) => l.isOn);
    }

    get isEmpty() {
        return this.lights.length === 0;
    }

    /** Every single member is unreachable — the only state without controls. */
    get isAllUnavailable() {
        return !this.isEmpty && this.alive.length === 0;
    }

    get isOn() {
        return this.onLights.length > 0;
    }

    get isOff() {
        return this.alive.length > 0 && this.onLights.length === 0;
    }

    get supportsBrightness() {
        return this.alive.some((l) => l.supportsBrightness);
    }

    get supportsColor() {
        return this.alive.some((l) => l.supportsColor);
    }

    get supportsTemp() {
        return this.alive.some((l) => l.supportsTemp);
    }

    get minKelvin() {
        const values = this.alive.filter((l) => l.supportsTemp).map((l) => l.minKelvin);
        return values.length ? Math.max.apply(null, values) : 2000;
    }

    get maxKelvin() {
        const values = this.alive.filter((l) => l.supportsTemp).map((l) => l.maxKelvin);
        return values.length ? Math.min.apply(null, values) : 6535;
    }

    /** Average brightness of the lit, reachable members. */
    get brightnessPct() {
        const lit = this.onLights.filter((l) => l.supportsBrightness);
        if (!lit.length) return 0;
        const sum = lit.reduce((acc, l) => acc + l.brightnessPct, 0);
        return clamp(Math.round(sum / lit.length), 1, 100);
    }

    /** Colours of the lit, reachable members — what paints the card. */
    get colors() {
        const found = [];
        this.onLights.forEach((l) => {
            const c = l.color;
            if (c) found.push(c);
        });
        if (found.length) return found;
        if (this.isOn) {
            const fallback = parseColor(this.config.defaultColor) || parseColor(WARM_COLOR);
            return [fallback];
        }
        return [];
    }

    get icon() {
        if (this.config.icon) return this.config.icon;
        const rootId = this.config.entityIds[0];
        const rootState = this.hass && this.hass.states ? this.hass.states[rootId] : null;
        if (rootState && rootState.attributes && rootState.attributes.icon) return rootState.attributes.icon;
        if (this.lights.length === 1) return this.lights[0].icon;
        return 'mdi:lightbulb-group';
    }

    get title() {
        if (this.config.title) return this.config.title;
        const rootId = this.config.entityIds[0];
        const rootState = this.hass && this.hass.states ? this.hass.states[rootId] : null;
        if (rootState && rootState.attributes && rootState.attributes.friendly_name) {
            return rootState.attributes.friendly_name;
        }
        return rootId || CARD_TAG;
    }

    get description() {
        if (this.config.description) return this.config.description;
        const hass = this.hass;
        if (this.isEmpty) return translate(hass, 'noEntities');
        if (this.isAllUnavailable) return translate(hass, 'allUnavailable');

        const on = this.onLights.length;
        const total = this.total;
        let text;
        if (on === 0) text = translate(hass, 'allOff');
        else if (on === total) text = translate(hass, 'allOn', { total: total });
        else if (on === 1) text = translate(hass, 'oneOn', { total: total });
        else text = translate(hass, 'someOn', { on: on, total: total });
        return text;
    }

    // -- actions ------------------------------------------------------------
    // Every call goes to the reachable members only. That is the whole
    // unavailable fix: a dead entity in the list used to make Home Assistant
    // reject or partially apply the call.

    _callByDomain(service, lights, data) {
        if (!this.hass || !lights.length) return;
        const byDomain = {};
        lights.forEach((l) => {
            (byDomain[l.domain] = byDomain[l.domain] || []).push(l.entityId);
        });
        Object.keys(byDomain).forEach((domain) => {
            const payload = Object.assign({ entity_id: byDomain[domain] }, domain === 'light' ? data || {} : {});
            this.hass.callService(domain, service, payload);
        });
    }

    turnOn(data) {
        this._callByDomain('turn_on', this.alive, data);
    }

    turnOff() {
        this._callByDomain('turn_off', this.alive);
    }

    toggle() {
        if (this.isOn) this.turnOff();
        else this.turnOn();
    }

    /**
     * Mirrors the Hue app: while something is lit, the slider moves only the
     * lit members; from all-off it sets every reachable member.
     */
    setBrightness(pct) {
        const value = clamp(Math.round(pct), 0, 100);
        const dimmable = this.alive.filter((l) => l.supportsBrightness);
        if (!dimmable.length) return;

        if (value <= 0) {
            this._callByDomain('turn_off', this.alive);
            return;
        }
        const lit = dimmable.filter((l) => l.isOn);
        const targets = lit.length ? lit : dimmable;
        this._callByDomain('turn_on', targets, { brightness_pct: value });
    }

    setRgb(rgb) {
        const targets = this.alive.filter((l) => l.supportsColor);
        this._callByDomain('turn_on', targets, { rgb_color: rgb });
    }

    setKelvin(kelvin) {
        const targets = this.alive.filter((l) => l.supportsTemp);
        this._callByDomain('turn_on', targets, { color_temp_kelvin: Math.round(kelvin) });
    }

    activateScene(sceneEntityId) {
        if (!this.hass) return;
        const domain = domainOf(sceneEntityId);
        if (domain === 'scene') this.hass.callService('scene', 'turn_on', { entity_id: sceneEntityId });
        else if (domain === 'script') this.hass.callService('script', 'turn_on', { entity_id: sceneEntityId });
        else this.hass.callService('homeassistant', 'turn_on', { entity_id: sceneEntityId });
    }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function parseSceneConfig(raw) {
    if (typeof raw === 'string') return { entity: raw };
    if (raw && typeof raw === 'object' && raw.entity) {
        return {
            entity: raw.entity,
            title: raw.title,
            icon: raw.icon,
            color: raw.color
        };
    }
    throw new Error(`Scene entry needs an 'entity': ${JSON.stringify(raw)}`);
}

function normalizeConfig(raw) {
    const config = {};
    const entityIds = [];

    const single = pick(raw, 'entity');
    if (typeof single === 'string' && single) entityIds.push(single);

    const many = pick(raw, 'entities');
    if (Array.isArray(many)) {
        many.forEach((item) => {
            if (typeof item === 'string' && item) entityIds.push(item);
            else if (item && typeof item === 'object' && item.entity) entityIds.push(item.entity);
        });
    }

    if (!entityIds.length) {
        throw new Error("busch-light-card: 'entity' or 'entities' is required.");
    }

    config.entityIds = entityIds;
    config.title = pick(raw, 'title', null);
    config.icon = pick(raw, 'icon', null);
    config.description = pick(raw, 'description', null);

    config.resolveGroups = pick(raw, 'resolveGroups', true) !== false;
    config.maxDepth = Number(pick(raw, 'maxDepth', DEFAULT_MAX_DEPTH)) || DEFAULT_MAX_DEPTH;
    config.showUnavailable = pick(raw, 'showUnavailable', true) !== false;

    config.offColor = pick(raw, 'offColor', null);
    config.defaultColor = pick(raw, 'defaultColor', WARM_COLOR);
    config.hueBorders = pick(raw, 'hueBorders', true) !== false;
    config.showSwitch = pick(raw, 'showSwitch', true) !== false;
    config.slider = pick(raw, 'slider', true) !== false;
    config.allowZero = pick(raw, 'allowZero', false) === true;
    config.offShadow = pick(raw, 'offShadow', true) !== false;

    config.tapAction = pick(raw, 'tapAction', 'dialog');
    config.holdAction = pick(raw, 'holdAction', 'more-info');

    const scenes = pick(raw, 'scenes', []);
    config.scenes = Array.isArray(scenes) ? scenes.map(parseSceneConfig) : [];

    return config;
}

// ---------------------------------------------------------------------------
// Drag helper — one place for every slider and picker in this file
// ---------------------------------------------------------------------------

/**
 * Wires pointer drag on `element`. `handler` receives the pointer position and
 * a flag saying whether the gesture is finished.
 */
function onDrag(element, handler) {
    let active = false;
    let pointerId = null;

    const report = (event, done) => {
        const rect = element.getBoundingClientRect();
        handler(
            {
                x: event.clientX - rect.left,
                y: event.clientY - rect.top,
                width: rect.width,
                height: rect.height
            },
            done
        );
    };

    element.addEventListener('pointerdown', (event) => {
        if (element.hasAttribute('disabled')) return;
        active = true;
        pointerId = event.pointerId;
        element.setPointerCapture(pointerId);
        event.preventDefault();
        report(event, false);
    });

    element.addEventListener('pointermove', (event) => {
        if (!active || event.pointerId !== pointerId) return;
        event.preventDefault();
        report(event, false);
    });

    const finish = (event) => {
        if (!active || event.pointerId !== pointerId) return;
        active = false;
        try {
            element.releasePointerCapture(pointerId);
        } catch (e) {
            /* capture may already be gone */
        }
        pointerId = null;
        report(event, true);
    };

    element.addEventListener('pointerup', finish);
    element.addEventListener('pointercancel', finish);
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const CARD_STYLES = `
:host {
    display: block;
}
ha-card {
    position: relative;
    min-height: 80px;
    overflow: hidden;
    background: var(--blc-background, var(--card-background-color));
    background-origin: border-box;
    box-shadow: var(--blc-shadow, none), var(--ha-default-shadow, none);
    transition: ${TRANSITION_DEFAULT};
    --blc-margin: 14px;
}
ha-card.hue-borders {
    border-radius: 10px;
    box-shadow: var(--blc-shadow, none), 0px 2px 3px rgba(0, 0, 0, 0.4);
    border: none;
}
.main {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--blc-margin);
    padding-bottom: 0;
    gap: 6px;
}
.tap {
    flex-grow: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    cursor: pointer;
    height: calc(46px - var(--blc-margin));
    -webkit-tap-highlight-color: transparent;
}
.icon {
    flex-shrink: 0;
    width: 56px;
    margin-left: calc(-1 * var(--blc-margin));
    text-align: center;
    color: var(--blc-text-color, var(--secondary-text-color));
    transition: ${TRANSITION_DEFAULT};
    --mdc-icon-size: 34px;
}
.text {
    flex-grow: 1;
    min-width: 0;
    line-height: normal;
    color: var(--blc-text-color, var(--secondary-text-color));
    transition: ${TRANSITION_DEFAULT};
}
.text h2 {
    font-size: 18px;
    font-weight: 500;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.desc {
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.warn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 9px;
    font-size: 12px;
    line-height: 18px;
    background: rgba(0, 0, 0, 0.18);
    flex-shrink: 0;
}
.warn.light-fg {
    background: rgba(255, 255, 255, 0.22);
}
.warn ha-icon {
    --mdc-icon-size: 13px;
}
.toggle {
    flex-shrink: 0;
    width: 42px;
    height: 24px;
    border-radius: 12px;
    border: none;
    padding: 0;
    position: relative;
    cursor: pointer;
    background: var(--blc-toggle-off, rgba(120, 120, 128, 0.32));
    transition: background 0.2s ease-out;
}
.toggle[disabled] {
    opacity: 0.4;
    cursor: default;
}
.toggle .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.2s ease-out;
}
.toggle.on {
    background: var(--blc-toggle-on, var(--primary-color, #03a9f4));
}
.toggle.on .knob {
    transform: translateX(18px);
}
.slider {
    position: relative;
    height: 34px;
    margin: 8px var(--blc-margin) var(--blc-margin);
    border-radius: 17px;
    background: rgba(0, 0, 0, 0.18);
    overflow: hidden;
    cursor: pointer;
    touch-action: none;
}
.slider.light-fg {
    background: rgba(255, 255, 255, 0.22);
}
.slider[disabled] {
    opacity: 0.45;
    cursor: default;
}
.slider .fill {
    position: absolute;
    inset: 0;
    width: 0%;
    background: var(--blc-text-color, var(--secondary-text-color));
    opacity: 0.55;
    transition: width 0.2s ease-out;
}
.slider.dragging .fill {
    transition: none;
}
.slider .label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font-size: 13px;
    font-weight: 500;
    color: var(--blc-text-color, var(--secondary-text-color));
    pointer-events: none;
}
.error {
    padding: 12px 16px;
    color: var(--error-color, #db4437);
    font-size: 14px;
    white-space: pre-wrap;
}
`;

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

class BuschLightCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._config = null;
        this._hass = null;
        this._model = null;
        this._built = false;
        this._dragging = false;
        this._error = null;
        this._holdTimer = null;
        this._held = false;
    }

    static getStubConfig() {
        return { type: `custom:${CARD_TAG}`, entity: '' };
    }

    setConfig(raw) {
        try {
            this._config = normalizeConfig(raw || {});
            this._error = null;
        } catch (e) {
            this._config = null;
            this._error = e && e.message ? e.message : String(e);
        }
        this._built = false;
        this.shadowRoot.innerHTML = '';
        this._render();
    }

    set hass(hass) {
        this._hass = hass;
        this._render();
        if (this._dialog) this._dialog.hass = hass;
    }

    get hass() {
        return this._hass;
    }

    getCardSize() {
        return 3;
    }

    // -- building -----------------------------------------------------------

    _build() {
        const root = this.shadowRoot;
        root.innerHTML = '';

        const style = document.createElement('style');
        style.textContent = CARD_STYLES;
        root.appendChild(style);

        if (this._error) {
            const box = document.createElement('div');
            box.className = 'error';
            box.textContent = this._error;
            root.appendChild(box);
            this._built = true;
            return;
        }

        const card = document.createElement('ha-card');
        this._card = card;

        const main = document.createElement('div');
        main.className = 'main';

        const tap = document.createElement('div');
        tap.className = 'tap';
        this._tap = tap;

        this._icon = document.createElement('ha-icon');
        this._icon.className = 'icon';
        tap.appendChild(this._icon);

        const text = document.createElement('div');
        text.className = 'text';
        this._title = document.createElement('h2');
        this._desc = document.createElement('div');
        this._desc.className = 'desc';
        this._descText = document.createElement('span');
        this._warn = document.createElement('span');
        this._warn.className = 'warn';
        this._warnIcon = document.createElement('ha-icon');
        this._warnIcon.setAttribute('icon', 'mdi:alert-circle-outline');
        this._warnText = document.createElement('span');
        this._warn.appendChild(this._warnIcon);
        this._warn.appendChild(this._warnText);
        this._desc.appendChild(this._descText);
        this._desc.appendChild(this._warn);
        text.appendChild(this._title);
        text.appendChild(this._desc);
        tap.appendChild(text);

        main.appendChild(tap);

        this._toggle = document.createElement('button');
        this._toggle.className = 'toggle';
        this._toggle.setAttribute('aria-label', 'toggle');
        const knob = document.createElement('span');
        knob.className = 'knob';
        this._toggle.appendChild(knob);
        main.appendChild(this._toggle);

        card.appendChild(main);

        // brightness slider
        this._slider = document.createElement('div');
        this._slider.className = 'slider';
        this._sliderFill = document.createElement('div');
        this._sliderFill.className = 'fill';
        this._sliderLabel = document.createElement('div');
        this._sliderLabel.className = 'label';
        this._slider.appendChild(this._sliderFill);
        this._slider.appendChild(this._sliderLabel);
        card.appendChild(this._slider);

        root.appendChild(card);

        this._wireEvents();
        this._built = true;
    }

    _wireEvents() {
        this._toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!this._model || this._model.isAllUnavailable) return;
            this._model.toggle();
        });

        // tap opens the dialog, hold falls back to more-info
        this._tap.addEventListener('pointerdown', () => {
            this._held = false;
            clearTimeout(this._holdTimer);
            this._holdTimer = setTimeout(() => {
                this._held = true;
                this._runAction(this._config.holdAction);
            }, 500);
        });
        const cancelHold = () => clearTimeout(this._holdTimer);
        this._tap.addEventListener('pointerup', cancelHold);
        this._tap.addEventListener('pointercancel', cancelHold);
        this._tap.addEventListener('pointerleave', cancelHold);
        this._tap.addEventListener('click', () => {
            if (this._held) {
                this._held = false;
                return;
            }
            this._runAction(this._config.tapAction);
        });

        onDrag(this._slider, (point, done) => {
            if (!this._model || !this._model.supportsBrightness) return;
            if (this._model.isAllUnavailable) return;
            const min = this._config.allowZero ? 0 : 1;
            const pct = clamp(Math.round((point.x / point.width) * 100), min, 100);
            this._dragging = !done;
            this._slider.classList.toggle('dragging', !done);
            this._sliderFill.style.width = pct + '%';
            this._sliderLabel.textContent = pct + ' %';
            if (done) this._model.setBrightness(pct);
        });
    }

    _runAction(action) {
        if (!this._model) return;
        switch (action) {
            case 'none':
                return;
            case 'toggle':
                this._model.toggle();
                return;
            case 'more-info':
                this._fireMoreInfo();
                return;
            case 'dialog':
            default:
                this._openDialog();
        }
    }

    _fireMoreInfo() {
        const entityId = this._config.entityIds[0];
        this.dispatchEvent(
            new CustomEvent('hass-more-info', {
                detail: { entityId },
                bubbles: true,
                composed: true
            })
        );
    }

    _openDialog() {
        if (!this._model || this._model.isEmpty) return;
        const dialog = document.createElement(DIALOG_TAG);
        dialog.hass = this._hass;
        dialog.cardConfig = this._config;
        document.body.appendChild(dialog);
        this._dialog = dialog;
        dialog.addEventListener('dialog-closed', () => {
            this._dialog = null;
        });
    }

    // -- rendering ----------------------------------------------------------

    _render() {
        if (!this._built) this._build();
        if (this._error || !this._config || !this._hass) return;

        this._model = new GroupModel(this._hass, this._config);
        const model = this._model;

        this._card.className = this._config.hueBorders ? 'hue-borders' : '';
        this._icon.setAttribute('icon', model.icon);
        this._title.textContent = model.title;
        this._descText.textContent = model.description;

        // Unavailable members are named, not hidden: the card keeps working,
        // and the badge says how much of the group it is actually driving.
        const showWarn = this._config.showUnavailable && model.deadCount > 0 && !model.isAllUnavailable;
        this._warn.style.display = showWarn ? '' : 'none';
        if (showWarn) this._warnText.textContent = String(model.deadCount);
        this._warn.title = showWarn
            ? translate(this._hass, 'unavailable', { n: model.deadCount }) +
              ': ' +
              model.dead.map((l) => l.name).join(', ')
            : '';

        this._paint(model);

        // toggle
        const disabled = model.isAllUnavailable || model.isEmpty;
        this._toggle.classList.toggle('on', model.isOn);
        if (disabled) this._toggle.setAttribute('disabled', '');
        else this._toggle.removeAttribute('disabled');
        this._toggle.style.display = this._config.showSwitch ? '' : 'none';

        // slider
        const sliderOn = this._config.slider && model.supportsBrightness;
        this._slider.style.display = sliderOn ? '' : 'none';
        const sliderDisabled = this._config.allowZero ? model.isAllUnavailable : !model.isOn;
        if (sliderDisabled) this._slider.setAttribute('disabled', '');
        else this._slider.removeAttribute('disabled');
        if (!this._dragging) {
            const pct = model.brightnessPct;
            this._sliderFill.style.width = pct + '%';
            // Left blank when off — the description above already says so.
            this._sliderLabel.textContent = model.isOn ? pct + ' %' : '';
        }
    }

    /** Card background, text colour and the brightness shadow. */
    _paint(model) {
        const offColor = parseColor(this._config.offColor);
        const colors = model.colors;

        let background = null;
        let foreground = null;

        if (model.isOn && colors.length) {
            background = backgroundCss(colors);
            const kind = foregroundForBackground(colors, model.brightnessPct > 50 ? -(10 - (model.brightnessPct - 50) / 5) : 0);
            foreground = model.brightnessPct <= 50 ? '#ffffff' : kind === 'light' ? '#ffffff' : 'rgba(0, 0, 0, 0.7)';
        } else if (offColor) {
            background = colorToCss(offColor);
            foreground = foregroundFor(offColor, 'rgba(255, 255, 255, 0.85)', 'rgba(0, 0, 0, 0.5)', 0);
        }

        this.style.setProperty('--blc-background', background || 'var(--card-background-color)');
        this.style.setProperty('--blc-text-color', foreground || 'var(--primary-text-color)');
        this.style.setProperty('--blc-shadow', this._brightnessShadow(model));

        const lightFg = foreground === '#ffffff' || (foreground || '').indexOf('255, 255, 255') !== -1;
        this._slider.classList.toggle('light-fg', lightFg);
        this._warn.classList.toggle('light-fg', lightFg);
    }

    _brightnessShadow(model) {
        if (!model.isOn) return this._config.offShadow ? 'inset 0px 0px 10px rgba(0,0,0,0.2)' : 'none';
        const height = this._card ? this._card.clientHeight : 0;
        if (!height) return 'none';
        const darkness = 100 - model.brightnessPct;
        const coef = height / 100;
        const spread = 20;
        const position = spread + darkness * 0.95 * coef;
        let width = height / 2;
        if (darkness > 70) width -= ((width - 20) * (darkness - 70)) / 30;
        let density = 0.65;
        if (darkness > 60) density -= ((density - 0.5) * (darkness - 60)) / 40;
        return `inset 0px -${Math.round(position)}px ${Math.round(width)}px -${spread}px rgba(0,0,0,${density.toFixed(2)})`;
    }
}

// Exposed so the browser test harness can exercise the pure logic directly
// instead of guessing at it from rendered pixels.
BuschLightCard.__internals = {
    resolveEntities,
    groupMembers,
    clearMemberCache,
    GroupModel,
    LightModel,
    parseColor,
    backgroundCss,
    tempToRgb,
    hsv2rgb,
    rgb2hsv,
    xyToRgb,
    normalizeConfig,
    version: CARD_VERSION
};

// ---------------------------------------------------------------------------
// Dialog styles
// ---------------------------------------------------------------------------

const DIALOG_STYLES = `
:host {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    align-items: flex-end;
    justify-content: center;
}
.scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    animation: fade 0.2s ease-out;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.sheet {
    position: relative;
    width: min(560px, 100%);
    max-height: 92vh;
    overflow: auto;
    background: ${DIALOG_BG};
    color: #fff;
    border-radius: 16px 16px 0 0;
    padding: 16px;
    box-sizing: border-box;
    animation: rise 0.22s ease-out;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
}
@media (min-width: 700px) {
    :host { align-items: center; }
    .sheet { border-radius: 16px; }
}
.head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
}
.head .who { flex-grow: 1; min-width: 0; }
.head h1 {
    font-size: 20px;
    font-weight: 500;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.head .sub { font-size: 13px; color: #aaa; }
.iconbtn {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: ${DIALOG_TILE_OFF};
    color: #fff;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}
h3 {
    font-size: 13px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #aaa;
    margin: 18px 0 8px;
}
.scenes {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    scrollbar-width: thin;
}
.scene {
    flex: 0 0 auto;
    width: 104px;
    height: 62px;
    border-radius: 10px;
    border: none;
    cursor: pointer;
    color: #fff;
    background: ${DIALOG_TILE_OFF};
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 8px;
    box-sizing: border-box;
    text-align: left;
    font-size: 12px;
    line-height: 1.25;
    overflow: hidden;
}
.scene span {
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
.scene[disabled] { opacity: 0.4; cursor: default; }
.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
}
.tile {
    position: relative;
    height: 96px;
    border-radius: 12px;
    border: none;
    padding: 8px;
    box-sizing: border-box;
    cursor: pointer;
    overflow: hidden;
    background: ${DIALOG_TILE_OFF};
    color: #fff;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    text-align: left;
    touch-action: none;
}
.tile .tfill {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0%;
    background: rgba(255, 255, 255, 0.22);
    pointer-events: none;
    transition: height 0.2s ease-out;
}
.tile.dragging .tfill { transition: none; }
.tile .trow { position: relative; display: flex; justify-content: space-between; align-items: flex-start; }
.tile .tname {
    position: relative;
    font-size: 12px;
    line-height: 1.2;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
/* currentColor, not a fixed white: a lit tile flips its text to dark. */
.tile .tpct { position: relative; font-size: 11px; color: currentColor; opacity: 0.75; }
.tile.dead {
    background: repeating-linear-gradient(45deg, #2a2a2a, #2a2a2a 6px, #222 6px, #222 12px);
    color: #888;
    cursor: default;
}
.detail { margin-top: 6px; }
.picker-tabs { display: flex; gap: 8px; margin: 14px 0 10px; }
.picker-tabs button {
    flex: 1;
    border: none;
    border-radius: 9px;
    padding: 8px;
    background: ${DIALOG_TILE_OFF};
    color: #ccc;
    cursor: pointer;
    font-size: 13px;
}
.picker-tabs button.active { background: #fff; color: #111; }
.wheelwrap { display: flex; justify-content: center; padding: 6px 0 2px; }
canvas.wheel { border-radius: 50%; touch-action: none; cursor: crosshair; max-width: 100%; }
.tempbar {
    position: relative;
    height: 44px;
    border-radius: 22px;
    margin: 10px 0 4px;
    touch-action: none;
    cursor: pointer;
}
.marker {
    position: absolute;
    top: 50%;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border-radius: 50%;
    border: 3px solid #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
}
.dslider {
    position: relative;
    height: 44px;
    border-radius: 22px;
    background: ${DIALOG_TILE_OFF};
    overflow: hidden;
    margin: 8px 0;
    touch-action: none;
    cursor: pointer;
}
.dslider .fill { position: absolute; inset: 0; width: 0%; background: rgba(255,255,255,0.75); }
/* White through mix-blend-mode difference inverts against whatever is behind
   it, so the label stays readable on both the dark track and the light fill. */
.dslider .label {
    position: absolute; inset: 0; display: flex; align-items: center; padding: 0 14px;
    font-size: 13px; font-weight: 500; color: #fff; mix-blend-mode: difference; pointer-events: none;
}
.empty { color: #888; font-size: 13px; padding: 8px 0; }
.deadlist { font-size: 12px; color: #888; margin-top: 10px; line-height: 1.5; }
`;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

class BuschLightDialog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._hass = null;
        this._config = null;
        this._model = null;
        this._built = false;
        this._detailEntity = null; // null = the whole group
        this._tab = 'colour';
        this._dragging = false;
        this._onKey = (event) => {
            if (event.key === 'Escape') this.close();
        };
    }

    set cardConfig(config) {
        this._config = config;
        this._update();
    }

    set hass(hass) {
        this._hass = hass;
        this._update();
    }

    connectedCallback() {
        document.addEventListener('keydown', this._onKey);
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this._onKey);
    }

    close() {
        this.dispatchEvent(new CustomEvent('dialog-closed'));
        this.remove();
    }

    _build() {
        const root = this.shadowRoot;
        root.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = DIALOG_STYLES;
        root.appendChild(style);

        const scrim = document.createElement('div');
        scrim.className = 'scrim';
        scrim.addEventListener('click', () => this.close());
        root.appendChild(scrim);

        this._sheet = document.createElement('div');
        this._sheet.className = 'sheet';
        root.appendChild(this._sheet);

        this._built = true;
    }

    _update() {
        if (!this._config || !this._hass) return;
        if (!this._built) this._build();
        if (this._dragging) return; // never rebuild under a finger
        this._model = new GroupModel(this._hass, this._config);
        this._renderSheet();
    }

    _renderSheet() {
        const model = this._model;
        const hass = this._hass;
        const sheet = this._sheet;
        sheet.innerHTML = '';

        // ---- header
        const head = document.createElement('div');
        head.className = 'head';

        if (this._detailEntity) {
            const back = this._makeIconButton('mdi:arrow-left', () => {
                this._detailEntity = null;
                this._renderSheet();
            });
            back.title = translate(hass, 'back');
            head.appendChild(back);
        }

        const who = document.createElement('div');
        who.className = 'who';
        const h1 = document.createElement('h1');
        const sub = document.createElement('div');
        sub.className = 'sub';

        const detail = this._detailEntity ? new LightModel(hass, this._detailEntity) : null;
        if (detail) {
            h1.textContent = detail.name;
            sub.textContent = detail.isAvailable
                ? detail.isOn
                    ? detail.brightnessPct + ' %'
                    : translate(hass, 'allOff')
                : translate(hass, 'unreachable');
        } else {
            h1.textContent = model.title;
            sub.textContent = model.description;
        }
        who.appendChild(h1);
        who.appendChild(sub);
        head.appendChild(who);

        head.appendChild(this._makeIconButton('mdi:close', () => this.close()));
        sheet.appendChild(head);

        if (detail) {
            this._renderDetail(sheet, detail);
            return;
        }

        // ---- scenes
        if (this._config.scenes.length) {
            sheet.appendChild(this._heading(translate(hass, 'scenes')));
            const row = document.createElement('div');
            row.className = 'scenes';
            this._config.scenes.forEach((scene) => row.appendChild(this._makeSceneTile(scene)));
            sheet.appendChild(row);
        }

        // ---- master brightness
        if (model.supportsBrightness && !model.isAllUnavailable) {
            sheet.appendChild(this._heading(translate(hass, 'brightness')));
            sheet.appendChild(
                this._makeSlider(model.brightnessPct, model.isOn, (pct, done) => {
                    if (done) model.setBrightness(pct);
                })
            );
        }

        // ---- group colour pickers
        if ((model.supportsColor || model.supportsTemp) && !model.isAllUnavailable) {
            this._appendPickers(sheet, {
                supportsColor: model.supportsColor,
                supportsTemp: model.supportsTemp,
                minKelvin: model.minKelvin,
                maxKelvin: model.maxKelvin,
                currentKelvin: null,
                onRgb: (rgb) => model.setRgb(rgb),
                onKelvin: (k) => model.setKelvin(k)
            });
        }

        // ---- the resolved lights, one tile each
        sheet.appendChild(this._heading(translate(hass, 'lights') + ' (' + model.lights.length + ')'));
        if (!model.lights.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = translate(hass, 'noEntities');
            sheet.appendChild(empty);
        } else {
            const tiles = document.createElement('div');
            tiles.className = 'tiles';
            model.lights.forEach((light) => tiles.appendChild(this._makeLightTile(light)));
            sheet.appendChild(tiles);
        }

        if (model.deadCount) {
            const note = document.createElement('div');
            note.className = 'deadlist';
            note.textContent =
                translate(hass, 'unavailable', { n: model.deadCount }) + ': ' + model.dead.map((l) => l.name).join(', ');
            sheet.appendChild(note);
        }
    }

    _renderDetail(sheet, light) {
        const hass = this._hass;
        const wrap = document.createElement('div');
        wrap.className = 'detail';

        if (!light.isAvailable) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = translate(hass, 'unreachable');
            wrap.appendChild(empty);
            sheet.appendChild(wrap);
            return;
        }

        if (light.supportsBrightness) {
            wrap.appendChild(this._heading(translate(hass, 'brightness')));
            wrap.appendChild(
                this._makeSlider(light.brightnessPct, light.isOn, (pct, done) => {
                    if (!done) return;
                    if (pct <= 0) hass.callService(light.domain, 'turn_off', { entity_id: light.entityId });
                    else hass.callService('light', 'turn_on', { entity_id: light.entityId, brightness_pct: pct });
                })
            );
        } else {
            wrap.appendChild(this._heading(translate(hass, 'brightness')));
            const toggleRow = document.createElement('button');
            toggleRow.className = 'scene';
            toggleRow.style.width = '100%';
            toggleRow.textContent = light.isOn ? translate(hass, 'allOff') : 'An';
            toggleRow.addEventListener('click', () => {
                hass.callService(light.domain, light.isOn ? 'turn_off' : 'turn_on', { entity_id: light.entityId });
            });
            wrap.appendChild(toggleRow);
        }

        sheet.appendChild(wrap);

        if (light.supportsColor || light.supportsTemp) {
            this._appendPickers(sheet, {
                supportsColor: light.supportsColor,
                supportsTemp: light.supportsTemp,
                minKelvin: light.minKelvin,
                maxKelvin: light.maxKelvin,
                currentKelvin: light.kelvin,
                onRgb: (rgb) => hass.callService('light', 'turn_on', { entity_id: light.entityId, rgb_color: rgb }),
                onKelvin: (k) =>
                    hass.callService('light', 'turn_on', {
                        entity_id: light.entityId,
                        color_temp_kelvin: Math.round(k)
                    })
            });
        }
    }

    // -- building blocks ----------------------------------------------------

    _heading(text) {
        const h3 = document.createElement('h3');
        h3.textContent = text;
        return h3;
    }

    _makeIconButton(icon, onClick) {
        const button = document.createElement('button');
        button.className = 'iconbtn';
        const haIcon = document.createElement('ha-icon');
        haIcon.setAttribute('icon', icon);
        button.appendChild(haIcon);
        button.addEventListener('click', onClick);
        return button;
    }

    _makeSceneTile(scene) {
        const button = document.createElement('button');
        button.className = 'scene';
        const state = this._hass.states ? this._hass.states[scene.entity] : null;
        const missing = !state;
        const color = parseColor(scene.color);
        if (color) {
            button.style.background = colorToCss(color);
            button.style.color = foregroundFor(color, '#fff', '#111', 0);
        }
        const label = document.createElement('span');
        label.textContent =
            scene.title || (state && state.attributes && state.attributes.friendly_name) || scene.entity;
        button.appendChild(label);
        if (missing) {
            button.setAttribute('disabled', '');
            button.title = scene.entity + ' — ' + translate(this._hass, 'unreachable');
        } else {
            button.addEventListener('click', () => this._model.activateScene(scene.entity));
        }
        return button;
    }

    _makeLightTile(light) {
        const tile = document.createElement('button');
        tile.className = 'tile' + (light.isAvailable ? '' : ' dead');

        const fill = document.createElement('div');
        fill.className = 'tfill';
        tile.appendChild(fill);

        const row = document.createElement('div');
        row.className = 'trow';
        const icon = document.createElement('ha-icon');
        icon.setAttribute('icon', light.isAvailable ? light.icon : 'mdi:alert-circle-outline');
        row.appendChild(icon);
        const pct = document.createElement('span');
        pct.className = 'tpct';
        pct.textContent = light.isAvailable ? (light.isOn ? light.brightnessPct + ' %' : '') : '';
        row.appendChild(pct);
        tile.appendChild(row);

        const name = document.createElement('div');
        name.className = 'tname';
        name.textContent = light.name;
        tile.appendChild(name);

        if (!light.isAvailable) {
            // Shown, greyed and inert. Hiding it would make a missing lamp
            // look like a lamp that was never in the group.
            tile.title = light.entityId + ' — ' + translate(this._hass, 'unreachable');
            return tile;
        }

        const color = light.color;
        if (light.isOn) {
            tile.style.background = color ? colorToCss(color) : WARM_COLOR;
            tile.style.color = foregroundFor(color || parseColor(WARM_COLOR), '#fff', '#111', 0);
            fill.style.height = light.brightnessPct + '%';
            fill.style.background = 'rgba(0, 0, 0, 0.16)';
        }

        // Drag up/down dims, a plain tap toggles, a long press opens detail.
        let moved = false;
        let startY = 0;
        let holdTimer = null;
        let opened = false;

        onDrag(tile, (point, done) => {
            if (!moved) startY = point.y;
            const delta = Math.abs(point.y - startY);
            if (!done && delta > 8 && light.supportsBrightness) {
                moved = true;
                this._dragging = true;
                tile.classList.add('dragging');
                clearTimeout(holdTimer);
                const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                fill.style.height = value + '%';
                pct.textContent = value + ' %';
            }
            if (done) {
                clearTimeout(holdTimer);
                tile.classList.remove('dragging');
                this._dragging = false;
                if (moved) {
                    const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                    this._hass.callService('light', 'turn_on', {
                        entity_id: light.entityId,
                        brightness_pct: value
                    });
                    moved = false;
                } else if (!opened) {
                    this._hass.callService(light.domain, light.isOn ? 'turn_off' : 'turn_on', {
                        entity_id: light.entityId
                    });
                }
                opened = false;
            }
        });

        tile.addEventListener('pointerdown', () => {
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => {
                if (moved) return;
                opened = true;
                this._detailEntity = light.entityId;
                this._renderSheet();
            }, 500);
        });
        tile.addEventListener('pointerup', () => clearTimeout(holdTimer));
        tile.addEventListener('pointercancel', () => clearTimeout(holdTimer));

        return tile;
    }

    _makeSlider(value, enabled, onChange) {
        const slider = document.createElement('div');
        slider.className = 'dslider';
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.width = value + '%';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = enabled ? value + ' %' : translate(this._hass, 'allOff');
        slider.appendChild(fill);
        slider.appendChild(label);

        onDrag(slider, (point, done) => {
            const pct = clamp(Math.round((point.x / point.width) * 100), 0, 100);
            this._dragging = !done;
            fill.style.width = pct + '%';
            label.textContent = pct + ' %';
            onChange(pct, done);
        });
        return slider;
    }

    _appendPickers(sheet, options) {
        const hass = this._hass;
        const tabs = document.createElement('div');
        tabs.className = 'picker-tabs';
        const body = document.createElement('div');

        const showColour = () => {
            body.innerHTML = '';
            body.appendChild(this._makeColorWheel(options.onRgb));
        };
        const showWhite = () => {
            body.innerHTML = '';
            body.appendChild(
                this._makeTempBar(options.minKelvin, options.maxKelvin, options.currentKelvin, options.onKelvin)
            );
        };

        const buttons = [];
        const activate = (name) => {
            this._tab = name;
            buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
            if (name === 'colour') showColour();
            else showWhite();
        };

        if (options.supportsColor) {
            const b = document.createElement('button');
            b.textContent = translate(hass, 'colour');
            b.dataset.tab = 'colour';
            b.addEventListener('click', () => activate('colour'));
            tabs.appendChild(b);
            buttons.push(b);
        }
        if (options.supportsTemp) {
            const b = document.createElement('button');
            b.textContent = translate(hass, 'white');
            b.dataset.tab = 'white';
            b.addEventListener('click', () => activate('white'));
            tabs.appendChild(b);
            buttons.push(b);
        }

        if (buttons.length > 1) sheet.appendChild(tabs);
        sheet.appendChild(body);

        const wanted = this._tab === 'colour' && options.supportsColor ? 'colour' : options.supportsTemp ? 'white' : 'colour';
        activate(wanted);
    }

    /** HSV wheel: hue around, saturation outwards. */
    _makeColorWheel(onPick) {
        const wrap = document.createElement('div');
        wrap.className = 'wheelwrap';
        const size = 220;
        const canvas = document.createElement('canvas');
        canvas.className = 'wheel';
        canvas.width = size;
        canvas.height = size;
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        wrap.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const radius = size / 2;
        const image = ctx.createImageData(size, size);
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                const dx = x - radius;
                const dy = y - radius;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const index = (y * size + x) * 4;
                if (dist > radius) {
                    image.data[index + 3] = 0;
                    continue;
                }
                const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                const sat = clamp(dist / radius, 0, 1);
                const rgb = hsv2rgb(hue, sat, 1);
                image.data[index] = rgb[0];
                image.data[index + 1] = rgb[1];
                image.data[index + 2] = rgb[2];
                // soften the rim so it does not look jagged
                image.data[index + 3] = dist > radius - 1.5 ? Math.round(255 * (radius - dist) / 1.5) : 255;
            }
        }
        ctx.putImageData(image, 0, 0);

        const marker = document.createElement('div');
        marker.className = 'marker';
        marker.style.display = 'none';
        wrap.style.position = 'relative';
        wrap.appendChild(marker);

        onDrag(canvas, (point, done) => {
            const dx = point.x - point.width / 2;
            const dy = point.y - point.height / 2;
            const r = point.width / 2;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > r) dist = r;
            const hue = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
            const rgb = hsv2rgb(hue, clamp(dist / r, 0, 1), 1);

            const angle = Math.atan2(dy, dx);
            marker.style.display = '';
            marker.style.left = point.width / 2 + Math.cos(angle) * dist + 'px';
            marker.style.top = point.height / 2 + Math.sin(angle) * dist + 'px';
            marker.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            this._dragging = !done;
            if (done) onPick(rgb);
        });

        return wrap;
    }

    /** Colour temperature bar, drawn along Hue's own curve. */
    _makeTempBar(minKelvin, maxKelvin, currentKelvin, onPick) {
        const bar = document.createElement('div');
        bar.className = 'tempbar';

        const stops = [];
        const steps = 12;
        for (let i = 0; i <= steps; i++) {
            const k = minKelvin + ((maxKelvin - minKelvin) * i) / steps;
            const rgb = tempToRgb(k);
            stops.push(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${Math.round((i / steps) * 100)}%`);
        }
        bar.style.background = `linear-gradient(90deg, ${stops.join(', ')})`;

        const marker = document.createElement('div');
        marker.className = 'marker';
        if (currentKelvin) {
            const ratio = clamp((currentKelvin - minKelvin) / (maxKelvin - minKelvin), 0, 1);
            marker.style.left = ratio * 100 + '%';
            const rgb = tempToRgb(currentKelvin);
            marker.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
        } else {
            marker.style.display = 'none';
        }
        bar.appendChild(marker);

        onDrag(bar, (point, done) => {
            const ratio = clamp(point.x / point.width, 0, 1);
            const kelvin = minKelvin + (maxKelvin - minKelvin) * ratio;
            const rgb = tempToRgb(kelvin);
            marker.style.display = '';
            marker.style.left = ratio * 100 + '%';
            marker.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            this._dragging = !done;
            if (done) onPick(kelvin);
        });

        return bar;
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, BuschLightCard);
if (!customElements.get(DIALOG_TAG)) customElements.define(DIALOG_TAG, BuschLightDialog);

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
    window.customCards.push({
        type: CARD_TAG,
        name: 'Busch Light Card',
        description: 'Hue-like light and scene control. Resolves nested groups on every level and survives unavailable entities.',
        preview: false,
        documentationURL: 'https://github.com/luukkii123/ha-busch-lightcards'
    });
}

console.info(
    `%c BUSCH-LIGHTCARDS %c ${CARD_VERSION} `,
    'color: #111; background: #ffda95; font-weight: 700;',
    'color: #ffda95; background: #111;'
);
