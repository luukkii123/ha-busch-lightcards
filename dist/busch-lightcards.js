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

const CARD_VERSION = '0.6.0';

const CARD_TAG = 'busch-light-card';
const DIALOG_TAG = 'busch-light-dialog';
const EDITOR_TAG = 'busch-light-card-editor';

/** Marks the history entries the dialog pushes for the back gesture. */
const DIALOG_HISTORY_KEY = 'buschLightDialog';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WARM_COLOR = '#ffda95';
const COLD_COLOR = '#f5f5ff';
const OFF_COLOR = '#666666';
const TILE_OFF_COLOR = 'rgba(102, 102, 102, 0.6)';
// The dialog's own dark palette now lives in DIALOG_STYLES, behind
// --blc-dialog-* variables a theme can override (rule 4).

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

/**
 * Attributes that name a group's members. There is no single convention — each
 * integration picked its own, and reading only the first one silently loses
 * whole platforms.
 *
 *   entity_id       Home Assistant light-group helpers and old-style group.*
 *   group_entities  Zigbee2MQTT, on light.* and switch.* alike
 *   lights          Magic Areas (measured identical to its entity_id)
 *
 * Deliberately NOT followed, both measured on a live 2026.8 install:
 *
 *   child_ids   Magic Areas' internal sub-group ids
 *               (light.…_lights_overhead_lights) — they resolve to `unknown`,
 *               so following them would invent members that do not exist.
 *   entities    switch.schedule_* helpers, pointing at climate.* and
 *               media_player.* — those are schedule targets, not members.
 *               Treating any list of entity ids as membership would turn a
 *               timer switch into a light group.
 */
const MEMBER_ATTRIBUTES = ['entity_id', 'group_entities', 'lights'];

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
// Localisation
// ---------------------------------------------------------------------------

/**
 * The card's ONE dictionary. Every string a user can ever read lives here, in
 * both languages — nothing user-visible is written inline anywhere else in
 * this file.
 *
 *   name         what the card picker calls this card.
 *   description  one sentence in the picker saying what it shows.
 *   labels       one per schema field of SCHEMA_BUSCH_LIGHT_CARD, keyed by
 *                the field's own name. One to four words, sentence case,
 *                no full stop.
 *   helpers      one per schema field, same keys. A whole sentence saying
 *                what happens and naming the default, with a full stop.
 *   texte        everything else: buttons, headings, counters, error
 *                messages, empty states, tooltips and aria labels.
 *
 * The shape is the one `hacs/scripts/ui-regeln-pruefen.py` prescribes in its
 * header; see also `hacs/docs/ui-regeln.md`, rule 3.
 */
const TEXTE_BUSCH_LIGHT_CARD = {
    de: {
        name: 'Busch Lampenkarte',
        description: 'Hue-artige Karte für Lampen und Szenen, die verschachtelte Gruppen auf jeder Ebene auflöst und nicht erreichbare Entitäten übersteht.',
        labels: {
            entity: 'Lampe, Schalter oder Gruppe',
            entities: 'Weitere Entitäten',
            title: 'Überschrift',
            icon: 'Symbol',
            description: 'Beschreibung',
            resolve_groups: 'Verschachtelte Gruppen auflösen',
            max_depth: 'Größte Tiefe',
            show_unavailable: 'Ausfall-Abzeichen',
            group_display: 'Lampen im Dialog',
            off_color: 'Farbe im Aus-Zustand',
            default_color: 'Farbe ohne eigene Farbe',
            hue_borders: 'Hue-Ecken und -Schatten',
            show_switch: 'Schalter auf der Karte',
            slider: 'Regler auf der Karte',
            allow_zero: 'Regler darf auf 0',
            off_shadow: 'Innenschatten im Aus-Zustand',
            tap_action: 'Beim Tippen',
            hold_action: 'Beim Halten',
            scenes: 'Szenenkacheln',
            scene_entity: 'Szene oder Skript',
            scene_title: 'Beschriftung',
            scene_icon: 'Symbol',
            scene_color: 'Kachelfarbe'
        },
        helpers: {
            entity: 'Die Hauptentität der Karte. Ist es eine Gruppe, steigt die Karte in jede verschachtelte Untergruppe ab und schaltet die echten Lampen dahinter; Doppelnennungen zählen einmal, Zyklen werden abgebrochen. Pflichtfeld.',
            entities: 'Wird zusätzlich zur Hauptentität aufgelöst, Gruppen genauso tief wie dort. Vorgabe: leer.',
            title: 'Ersetzt den Namen der Hauptentität auf der Karte und im Dialog. Vorgabe: der Name der Entität.',
            icon: 'Ein mdi-Symbol für die Karte. Vorgabe: das Symbol der Entität.',
            description: 'Ersetzt die Zeile unter der Überschrift, die sonst zählt, wie viele Lampen an sind. Vorgabe: die Zählung.',
            resolve_groups: 'An steigt die Karte in jede Untergruppe ab und schaltet die Lampen einzeln. Aus bleibt die Gruppe eine einzige Entität, wie bei der Vorlage. Vorgabe an.',
            max_depth: 'Wie viele Gruppenebenen die Karte höchstens absteigt, bevor sie abbricht. Vorgabe 10.',
            show_unavailable: 'Zeigt auf der Karte ein Abzeichen mit der Zahl der nicht erreichbaren Mitglieder. Vorgabe an.',
            group_display: 'Nach Gruppe geordnet gibt jeder aufgelösten Gruppe einen eigenen Block mit eigenem Schalter; eine flache Liste zeigt alle Lampen ohne Überschriften. Vorgabe: nach Gruppe geordnet.',
            off_color: 'Hintergrund der Karte, solange keine Lampe an ist. Leer heißt: das Thema entscheidet. Vorgabe leer.',
            default_color: 'Farbe für eine leuchtende Lampe, die selbst keine meldet. Nimmt #rrggbb, rgb(…) oder die Namen warm und cold. Vorgabe #ffda95.',
            hue_borders: 'Rundet die Karte stärker ab und legt den Schlagschatten der Hue-Vorlage darunter. Vorgabe an.',
            show_switch: 'Zeigt rechts oben einen Schalter für die ganze Gruppe. Vorgabe an.',
            slider: 'Zeigt unter der Überschrift einen Regler für die Helligkeit der ganzen Gruppe. Vorgabe an.',
            allow_zero: 'Erlaubt dem Regler den Wert 0, der die Gruppe ausschaltet; sonst ist bei 1 Prozent Schluss. Vorgabe aus.',
            off_shadow: 'Legt einen Innenschatten über die Karte, solange keine Lampe an ist. Vorgabe an.',
            tap_action: 'Was ein kurzer Tipp auf die Karte auslöst. Vorgabe: Dialog öffnen.',
            hold_action: 'Was ein halbe Sekunde langes Halten auf der Karte auslöst. Vorgabe: Mehr Informationen.',
            scenes: 'Die Kacheln oben im Dialog, eine je Szene oder Skript. Ein Knopf übernimmt in einem Zug jede Szene, die diese Lampen benutzt; entfernen lässt sich jede einzeln wieder. Vorgabe: keine.',
            scene_entity: 'Die Szene oder das Skript, das diese Kachel im Dialog auslöst. Pflichtfeld.',
            scene_title: 'Text auf der Kachel. Vorgabe: der Name der Szene.',
            scene_icon: 'Symbol auf der Kachel. Vorgabe: das Symbol der Szene, sonst mdi:palette.',
            scene_color: 'Farbe des runden Flecks auf der Kachel. Vorgabe #ffda95.'
        },
        texte: {
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
            toggle: 'Umschalten',
            unreachable: 'nicht erreichbar',
            groupOf: 'Gruppe aus {n}',
            alreadyIncluded: 'Oben bereits enthalten: {list}',

            groupSections: 'Nach Gruppe geordnet',
            groupFlat: 'Eine flache Liste',

            sectionResolve: 'Gruppenauflösung',
            sectionLook: 'Darstellung',
            sectionActions: 'Aktionen',
            sectionScenes: 'Szenen',

            actDialog: 'Dialog öffnen',
            actToggle: 'Umschalten',
            actMoreInfo: 'Mehr Informationen',
            actNone: 'Nichts',

            addScene: 'Szene hinzufügen',
            importScenes: 'Alle Szenen mit diesen Lampen übernehmen ({n})',
            importNone: 'Keine Szene benutzt diese Lampen',
            importAllThere: 'Alle {n} passenden Szenen stehen schon in der Liste',
            up: 'Nach oben',
            down: 'Nach unten',
            remove: 'Entfernen',

            preview: 'Löst auf zu',
            previewCount: '{leaves} Lampen aus {groups} Gruppen, Tiefe {depth}',
            previewFlat: '1 Entität, Gruppen werden nicht aufgelöst',
            previewNone: 'Erst eine Entität wählen',
            previewDead: '{n} nicht erreichbar',
            previewDropped: '{n} Mitglieder verworfen (weder Lampe noch Schalter)',
            previewTruncated: 'Tiefenbegrenzung erreicht bei: {list}',
            previewRecovered: 'Gemerkte Mitglieder benutzt für: {list}',
            noForm: 'Die Formularelemente von Home Assistant sind nicht geladen. Bitte diese Karte in YAML einrichten.',
            fehlerKeineEntitaet: 'Diese Karte braucht eine Lampe, einen Schalter oder eine Gruppe. Bitte im Editor unter „Lampe, Schalter oder Gruppe" eine Entität wählen.',
            fehlerSzeneOhneEntitaet: 'Ein Szeneneintrag hat keine Entität: {eintrag}. Jede Szenenkachel braucht eine Szene oder ein Skript.'
        }
    },
    en: {
        name: 'Busch Light Card',
        description: 'Hue-like card for lights and scenes that resolves nested groups on every level and survives unavailable entities.',
        labels: {
            entity: 'Light, switch or group',
            entities: 'Additional entities',
            title: 'Title',
            icon: 'Icon',
            description: 'Description',
            resolve_groups: 'Resolve nested groups',
            max_depth: 'Maximum depth',
            show_unavailable: 'Unreachable badge',
            group_display: 'Lights in the dialog',
            off_color: 'Colour while off',
            default_color: 'Colour without its own',
            hue_borders: 'Hue corners and shadow',
            show_switch: 'Toggle on the card',
            slider: 'Slider on the card',
            allow_zero: 'Slider may reach 0',
            off_shadow: 'Inset shadow while off',
            tap_action: 'On tap',
            hold_action: 'On hold',
            scenes: 'Scene tiles',
            scene_entity: 'Scene or script',
            scene_title: 'Label',
            scene_icon: 'Icon',
            scene_color: 'Tile colour'
        },
        helpers: {
            entity: "The card's main entity. If it is a group, the card walks down into every nested sub-group and controls the real lights behind it; a light named twice counts once, and cycles are cut. Required.",
            entities: 'Resolved on top of the main entity, groups just as deep. Default: empty.',
            title: "Replaces the main entity's name on the card and in the dialog. Default: the entity's own name.",
            icon: "An mdi icon for the card. Default: the entity's own icon.",
            description: 'Replaces the line under the title that otherwise counts how many lights are on. Default: the count.',
            resolve_groups: 'On, the card walks into every sub-group and controls the lights one by one. Off, the group stays a single entity, the way the original card does it. Default on.',
            max_depth: 'How many group levels the card descends at most before it stops. Default 10.',
            show_unavailable: 'Shows a badge on the card counting the members that cannot be reached. Default on.',
            group_display: 'Grouped by their group gives every resolved group its own block with its own switch; one flat list shows every light without headings. Default: grouped by their group.',
            off_color: "The card's background while no light is on. Empty uses the theme colour. Default empty.",
            default_color: 'Colour for a lit light that reports none of its own. Accepts #rrggbb, rgb(…) or the names warm and cold. Default #ffda95.',
            hue_borders: "Rounds the card more strongly and puts the Hue template's drop shadow under it. Default on.",
            show_switch: 'Shows a switch for the whole group in the top right. Default on.',
            slider: "Shows a slider for the whole group's brightness under the title. Default on.",
            allow_zero: 'Lets the slider reach 0, which turns the group off; otherwise it stops at 1 per cent. Default off.',
            off_shadow: 'Puts an inset shadow over the card while no light is on. Default on.',
            tap_action: 'What a short tap on the card does. Default: open dialog.',
            hold_action: 'What holding the card for half a second does. Default: more info.',
            scenes: 'The tiles at the top of the dialog, one per scene or script. One button adds every scene using these lights at once, and each one can be removed again. Default: none.',
            scene_entity: 'The scene or script this tile triggers in the dialog. Required.',
            scene_title: "Text on the tile. Default: the scene's own name.",
            scene_icon: "Icon on the tile. Default: the scene's own icon, otherwise mdi:palette.",
            scene_color: 'Colour of the round badge on the tile. Default #ffda95.'
        },
        texte: {
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
            toggle: 'Toggle',
            unreachable: 'unreachable',
            groupOf: 'Group of {n}',
            alreadyIncluded: 'Already shown above: {list}',

            groupSections: 'Grouped by their group',
            groupFlat: 'One flat list',

            sectionResolve: 'Group resolution',
            sectionLook: 'Appearance',
            sectionActions: 'Actions',
            sectionScenes: 'Scenes',

            actDialog: 'Open dialog',
            actToggle: 'Toggle',
            actMoreInfo: 'More info',
            actNone: 'Nothing',

            addScene: 'Add scene',
            importScenes: 'Add every scene using these lights ({n})',
            importNone: 'No scene uses these lights',
            importAllThere: 'All {n} matching scenes are already listed',
            up: 'Move up',
            down: 'Move down',
            remove: 'Remove',

            preview: 'Resolves to',
            previewCount: '{leaves} lights out of {groups} groups, depth {depth}',
            previewFlat: '1 entity, groups not resolved',
            previewNone: 'Pick an entity first',
            previewDead: '{n} unreachable',
            previewDropped: '{n} members dropped (not a light or switch)',
            previewTruncated: 'Depth limit reached at: {list}',
            previewRecovered: 'Remembered members used for: {list}',
            noForm: 'The Home Assistant form elements did not load. Please configure this card in YAML.',
            fehlerKeineEntitaet: 'This card needs a light, a switch or a group. Pick an entity under “Light, switch or group” in the editor.',
            fehlerSzeneOhneEntitaet: 'A scene entry has no entity: {eintrag}. Every scene tile needs a scene or a script.'
        }
    }
};

/**
 * Config keys the card reads that deliberately carry no `ha-form` schema
 * field, with the reason. Named exception list for
 * `hacs/scripts/ui-regeln-pruefen.py`, rule 3, check 3.
 */
const SCHEMA_EXCEPTIONS = {
    type: 'Written by Lovelace itself. Not an option of this card.',
    scenes: 'A list of objects, edited by the editor’s own scene rows (add, reorder, remove, import in one click). `ha-form` has no selector for that shape; every row is itself an `ha-form` whose four fields carry label and helper (scene_entity, scene_title, scene_icon, scene_color).'
};

/**
 * Which of the two languages applies.
 *
 * `hass.locale.language` is what the frontend actually offers; `hass.language`
 * is the older spelling and the test harness still sets only that one. Before
 * `hass` exists at all — the card picker reads name and description at load
 * time — the browser's own language decides.
 */
function textTable(hass) {
    let lang = '';
    if (hass && hass.locale && hass.locale.language) lang = hass.locale.language;
    else if (hass && hass.language) lang = hass.language;
    else if (typeof navigator !== 'undefined' && navigator.language) lang = navigator.language;
    return String(lang).toLowerCase().indexOf('de') === 0 ? TEXTE_BUSCH_LIGHT_CARD.de : TEXTE_BUSCH_LIGHT_CARD.en;
}

function fillVars(text, vars) {
    if (!vars) return text;
    let out = text;
    Object.keys(vars).forEach((name) => {
        out = out.split('{' + name + '}').join(String(vars[name]));
    });
    return out;
}

/** One of the `ui` strings: buttons, headings, counters, errors, empty states. */
function translate(hass, key, vars) {
    const table = textTable(hass);
    const text = table.texte[key] !== undefined ? table.texte[key] : TEXTE_BUSCH_LIGHT_CARD.en.texte[key];
    if (text === undefined) return key;
    return fillVars(text, vars);
}

/** The editor label of one schema field. One to four words, no full stop. */
function fieldLabel(hass, name) {
    const table = textTable(hass);
    const text = table.labels[name] !== undefined ? table.labels[name] : TEXTE_BUSCH_LIGHT_CARD.en.labels[name];
    return text === undefined ? name : text;
}

/**
 * A configuration error the user will read on the card.
 *
 * It carries a dictionary key, not a sentence: `setConfig` runs before `hass`
 * exists, so the language is only known once the card renders the error box.
 * Rule 3 — no user-visible text outside the dictionary — applies to error
 * messages too, and a thrown string is the easiest place to forget that.
 */
class ConfigError extends Error {
    constructor(key, vars) {
        super(key);
        this.name = 'ConfigError';
        this.textKey = key;
        this.textVars = vars || null;
    }
}

/** The editor helper of one schema field. A whole sentence, with a full stop. */
function fieldHelper(hass, name) {
    const table = textTable(hass);
    const text = table.helpers[name] !== undefined ? table.helpers[name] : TEXTE_BUSCH_LIGHT_CARD.en.helpers[name];
    return text === undefined ? '' : text;
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
    const attributes = (state && state.attributes) || {};

    // Union across the known attributes, not first-wins: an integration may
    // publish two of them, and Magic Areas publishes the same list twice.
    const live = [];
    MEMBER_ATTRIBUTES.forEach((name) => {
        const value = attributes[name];
        if (!Array.isArray(value)) return;
        value.forEach((member) => {
            // A group listing itself would otherwise be an immediate cycle.
            if (typeof member !== 'string' || !member || member === entityId) return;
            if (live.indexOf(member) === -1) live.push(member);
        });
    });

    if (live.length) {
        MEMBER_CACHE.set(entityId, live);
        return live;
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
    const full = resolveSections(hass, roots, options);
    return {
        leaves: full.leaves,
        groups: full.groups,
        recovered: full.recovered,
        dropped: full.dropped,
        truncated: full.truncated,
        maxDepth: full.maxDepth
    };
}

/**
 * The same walk, but it keeps the shape it found instead of throwing it away.
 *
 * Resolving a group down to its lights and *showing* a flat pile of lights are
 * two different things: with thirty lamps behind one card, the structure is
 * the only thing that makes the dialog readable. So every expanded group also
 * becomes a section, carrying the lights that were first seen underneath it.
 *
 * Adds to the flat result:
 *   sections    — [{ entityId, name, icon, depth, lights }] in walk order,
 *                 each light listed exactly once, under the first group it
 *                 was met in
 *   emptyGroups — groups whose members had all already appeared elsewhere;
 *                 they would render as empty headings, so they are named
 *                 instead of shown
 */
function resolveSections(hass, roots, options) {
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
    const allSections = [];
    let deepest = 0;

    const nameOf = (entityId) => {
        const state = hass && hass.states ? hass.states[entityId] : null;
        return state && state.attributes && state.attributes.friendly_name
            ? state.attributes.friendly_name
            : entityId;
    };

    const iconOf = (entityId) => {
        const state = hass && hass.states ? hass.states[entityId] : null;
        return state && state.attributes && state.attributes.icon ? state.attributes.icon : null;
    };

    const makeSection = (entityId, depth) => {
        const section = {
            entityId: entityId,
            name: entityId ? nameOf(entityId) : null,
            icon: entityId ? iconOf(entityId) : null,
            depth: depth,
            lights: []
        };
        allSections.push(section);
        return section;
    };

    // Holds roots that are plain lights, or leaves met before any group.
    const loose = makeSection(null, 0);

    const addLeaf = (entityId, section) => {
        if (!LEAF_DOMAINS.has(domainOf(entityId))) {
            if (dropped.indexOf(entityId) === -1) dropped.push(entityId);
            return;
        }
        if (leafSeen.has(entityId)) return;
        leafSeen.add(entityId);
        leaves.push(entityId);
        section.lights.push(entityId);
    };

    const walk = (entityId, depth, section) => {
        if (depth > deepest) deepest = depth;
        const members = follow ? groupMembers(hass, entityId) : null;

        if (!members) {
            addLeaf(entityId, section);
            return;
        }
        if (depth >= limit) {
            // Too deep to keep going: keep the group itself so it stays usable.
            if (truncated.indexOf(entityId) === -1) truncated.push(entityId);
            addLeaf(entityId, section);
            return;
        }
        if (expanded.has(entityId)) return; // already covered by another branch
        expanded.add(entityId);
        groups.push(entityId);

        const state = hass && hass.states ? hass.states[entityId] : null;
        const attributes = (state && state.attributes) || {};
        const publishes = MEMBER_ATTRIBUTES.some((name) => Array.isArray(attributes[name]));
        if (!publishes) recovered.push(entityId);

        const own = makeSection(entityId, depth);
        members.forEach((member) => walk(member, depth + 1, own));
    };

    (roots || []).forEach((root) => walk(root, 0, loose));

    const sections = allSections.filter((s) => s.lights.length > 0);
    const emptyGroups = allSections
        .filter((s) => s.entityId && !s.lights.length)
        .map((s) => s.entityId);

    return {
        leaves,
        groups,
        recovered,
        dropped,
        truncated,
        maxDepth: deepest,
        sections,
        emptyGroups
    };
}

/**
 * Every scene that touches at least one of these lights.
 *
 * A Home Assistant scene lists the entities it sets in `attributes.entity_id`,
 * so this needs no extra API — and it is exactly the set worth offering on a
 * card that drives those lights. Sorted by name so a re-import produces the
 * same order.
 *
 * Note this reads `entity_id` directly rather than going through
 * `groupMembers()`: a scene is not a group, and must never be expanded as one.
 */
function scenesForLights(hass, entityIds) {
    const wanted = new Set(entityIds || []);
    const states = (hass && hass.states) || {};
    const found = [];

    Object.keys(states).forEach((id) => {
        if (domainOf(id) !== 'scene') return;
        const attributes = states[id].attributes || {};
        const members = attributes.entity_id;
        if (!Array.isArray(members)) return;
        if (members.some((member) => wanted.has(member))) found.push(id);
    });

    const nameOf = (id) => {
        const attributes = states[id].attributes || {};
        return String(attributes.friendly_name || id).toLowerCase();
    };
    found.sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0));
    return found;
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
    /**
     * `opts` is the NORMALISED option object out of `normalizeConfig`, not the
     * raw Lovelace config — camelCase, defaults filled in, entity and entities
     * already merged into one list. The distinction matters: only the raw
     * config carries the snake_case keys the editor schema names.
     */
    constructor(hass, opts) {
        this.hass = hass;
        this.opts = opts;

        const roots = opts.entityIds;
        const resolution = resolveSections(hass, roots, {
            maxDepth: opts.maxDepth,
            resolveGroups: opts.resolveGroups
        });

        this.resolution = resolution;
        this.lights = resolution.leaves.map((id) => new LightModel(hass, id));
        this.alive = this.lights.filter((l) => l.isAvailable);
        this.dead = this.lights.filter((l) => !l.isAvailable);

        // The same lights again, but keeping the group they came from, so the
        // dialog can show structure instead of one long pile of tiles.
        const byId = {};
        this.lights.forEach((light) => (byId[light.entityId] = light));
        this.sections = resolution.sections.map((section) => ({
            entityId: section.entityId,
            name: section.name,
            icon: section.icon,
            depth: section.depth,
            lights: section.lights.map((id) => byId[id])
        }));
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
            const fallback = parseColor(this.opts.defaultColor) || parseColor(WARM_COLOR);
            return [fallback];
        }
        return [];
    }

    get icon() {
        if (this.opts.icon) return this.opts.icon;
        const rootId = this.opts.entityIds[0];
        const rootState = this.hass && this.hass.states ? this.hass.states[rootId] : null;
        if (rootState && rootState.attributes && rootState.attributes.icon) return rootState.attributes.icon;
        if (this.lights.length === 1) return this.lights[0].icon;
        return 'mdi:lightbulb-group';
    }

    get title() {
        if (this.opts.title) return this.opts.title;
        const rootId = this.opts.entityIds[0];
        const rootState = this.hass && this.hass.states ? this.hass.states[rootId] : null;
        if (rootState && rootState.attributes && rootState.attributes.friendly_name) {
            return rootState.attributes.friendly_name;
        }
        return rootId || CARD_TAG;
    }

    get description() {
        if (this.opts.description) return this.opts.description;
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

    /** Counts for one section's lights — the reachable ones only, as ever. */
    static tally(lights) {
        const alive = (lights || []).filter((l) => l.isAvailable);
        return {
            total: alive.length,
            on: alive.filter((l) => l.isOn).length,
            dead: (lights || []).length - alive.length,
            isOn: alive.some((l) => l.isOn)
        };
    }

    /** Switches one section as a unit, skipping its unreachable members. */
    toggleLights(lights) {
        const alive = (lights || []).filter((l) => l.isAvailable);
        if (!alive.length) return;
        const anyOn = alive.some((l) => l.isOn);
        this._callByDomain(anyOn ? 'turn_off' : 'turn_on', alive);
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
    throw new ConfigError('fehlerSzeneOhneEntitaet', { eintrag: JSON.stringify(raw) });
}

function normalizeConfig(raw) {
    const opts = {};
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
        throw new ConfigError('fehlerKeineEntitaet');
    }

    opts.entityIds = entityIds;
    opts.title = pick(raw, 'title', null);
    opts.icon = pick(raw, 'icon', null);
    opts.description = pick(raw, 'description', null);

    opts.resolveGroups = pick(raw, 'resolveGroups', true) !== false;
    opts.maxDepth = Number(pick(raw, 'maxDepth', DEFAULT_MAX_DEPTH)) || DEFAULT_MAX_DEPTH;
    opts.showUnavailable = pick(raw, 'showUnavailable', true) !== false;
    opts.groupDisplay = pick(raw, 'groupDisplay', 'sections') === 'flat' ? 'flat' : 'sections';

    opts.offColor = pick(raw, 'offColor', null);
    opts.defaultColor = pick(raw, 'defaultColor', WARM_COLOR);
    opts.hueBorders = pick(raw, 'hueBorders', true) !== false;
    opts.showSwitch = pick(raw, 'showSwitch', true) !== false;
    opts.slider = pick(raw, 'slider', true) !== false;
    opts.allowZero = pick(raw, 'allowZero', false) === true;
    opts.offShadow = pick(raw, 'offShadow', true) !== false;

    opts.tapAction = pick(raw, 'tapAction', 'dialog');
    opts.holdAction = pick(raw, 'holdAction', 'more-info');

    const scenes = pick(raw, 'scenes', []);
    opts.scenes = Array.isArray(scenes) ? scenes.map(parseSceneConfig) : [];

    return opts;
}

/**
 * What each option falls back to. The visual editor writes an option only when
 * it differs from this, so the produced YAML stays as short as a hand-written
 * one instead of listing every default.
 */
const CONFIG_DEFAULTS = {
    resolve_groups: true,
    max_depth: DEFAULT_MAX_DEPTH,
    show_unavailable: true,
    hue_borders: true,
    show_switch: true,
    slider: true,
    allow_zero: false,
    off_shadow: true,
    tap_action: 'dialog',
    hold_action: 'more-info',
    default_color: WARM_COLOR,
    group_display: 'sections'
};

/** Options the card also accepts in camelCase, for upstream compatibility. */
const CAMEL_ALIASES = [
    'resolveGroups', 'maxDepth', 'showUnavailable', 'groupDisplay', 'offColor',
    'defaultColor', 'hueBorders', 'showSwitch', 'allowZero', 'offShadow',
    'tapAction', 'holdAction'
];

/**
 * The editor speaks snake_case only. A config copied from the upstream card
 * uses camelCase, and keeping both spellings of the same option would let them
 * drift apart silently, so one is folded into the other on the way in.
 */
function toSnakeConfig(raw) {
    const out = Object.assign({}, raw);
    CAMEL_ALIASES.forEach((camel) => {
        if (out[camel] === undefined) return;
        const snake = camel.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
        if (out[snake] === undefined) out[snake] = out[camel];
        delete out[camel];
    });
    return out;
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
        try {
            element.setPointerCapture(pointerId);
        } catch (e) {
            /* no live pointer to capture — carry on without it */
        }
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

    /*
     * The card's own theme hooks. The value initial is CSS's guaranteed-
     * invalid one, so every use below falls back to the literal it carries
     * and an untouched card looks exactly as designed — while a theme can
     * override any one of them by name. Rule 4 wants every colour behind a
     * variable; this is where the ones Home Assistant does not provide are
     * declared.
     */
    --blc-background: initial;
    --blc-text-color: initial;
    --blc-shadow: initial;
    --blc-toggle-off: initial;
    --blc-toggle-on: initial;
    --blc-knob-color: initial;
}
ha-card {
    position: relative;
    min-height: 80px;
    overflow: hidden;
    background: var(--blc-background, var(--card-background-color));
    background-origin: border-box;
    box-shadow: var(--blc-shadow, none), var(--ha-default-shadow, none);
    transition: ${TRANSITION_DEFAULT};
    /* HAs own .card-content spacing, with the pre-token value as fallback. */
    --blc-margin: var(--ha-space-4, 14px);
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
    /* min-height, not height: a text container must never cap its own text. */
    min-height: calc(46px - var(--blc-margin));
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
    font-size: var(--ha-font-size-l, 18px);
    font-weight: var(--ha-font-weight-medium, 500);
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.desc {
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
/* The count and the badge are two flex items, so the ellipsis has to sit on
   the text itself — on the flex container it would never fire. */
.desc .dtext {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.warn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 6px;
    border-radius: 9px;
    font-size: var(--ha-font-size-xs, 12px);
    line-height: 18px;
    background: rgba(0, 0, 0, 0.18);
    /* Shrinkable on purpose: a badge that refuses to give way pushes itself
       out of the card instead of being cut. */
    flex-shrink: 1;
    min-width: 0;
    overflow: hidden;
}
.warn span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.warn.light-fg {
    background: rgba(255, 255, 255, 0.22);
}
.warn ha-icon {
    --mdc-icon-size: 13px;
    flex-shrink: 0;
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
    background: var(--blc-knob-color, #fff);
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
/* A block with a matching line-height, not a flex box: only then do overflow
   and text-overflow apply to the text itself. It sits in .slider, which is
   overflow: hidden, so the absolute position cannot escape either. */
.slider .label {
    position: absolute;
    inset: 0;
    display: block;
    box-sizing: border-box;
    line-height: 34px;
    padding: 0 12px;
    font-size: 13px;
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--blc-text-color, var(--secondary-text-color));
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.error {
    padding: 12px 16px;
    color: var(--error-color, #db4437);
    font-size: var(--ha-font-size-s, 14px);
    overflow-wrap: anywhere;
}
`;

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

class BuschLightCard extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._opts = null;
        this._hass = null;
        this._model = null;
        this._built = false;
        this._dragging = false;
        this._error = null;
        this._holdTimer = null;
        this._held = false;
    }

    /** Hands Home Assistant the visual editor for this card. */
    static getConfigElement() {
        return document.createElement(EDITOR_TAG);
    }

    /**
     * The card the picker drops on the dashboard. Prefers a real group, since
     * that is what this card is for — an ungrouped single light would show
     * none of it.
     */
    static getStubConfig(hass, entities) {
        const pool = Array.isArray(entities) && entities.length
            ? entities
            : hass && hass.states
                ? Object.keys(hass.states)
                : [];
        const lights = pool.filter((id) => domainOf(id) === 'light');
        const group = lights.find((id) => {
            const state = hass && hass.states ? hass.states[id] : null;
            return state && state.attributes && Array.isArray(state.attributes.entity_id)
                && state.attributes.entity_id.length > 1;
        });
        return { type: `custom:${CARD_TAG}`, entity: group || lights[0] || '' };
    }

    setConfig(raw) {
        try {
            this._opts = normalizeConfig(raw || {});
            this._error = null;
            this._errorKey = null;
            this._errorVars = null;
        } catch (e) {
            this._opts = null;
            // Remembered as a key, translated when the box is drawn: at this
            // point `hass` — and with it the language — may still be missing.
            this._errorKey = e && e.textKey ? e.textKey : null;
            this._errorVars = e && e.textVars ? e.textVars : null;
            this._error = this._errorKey
                ? translate(this._hass, this._errorKey, this._errorVars)
                : (e && e.message ? e.message : String(e));
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

    /**
     * Sections layout. Twelve columns is the full width of a section; six is
     * half of it and the narrowest the title, the badge and the switch still
     * fit side by side. Both are multiples of three, as the grid demands.
     * Two rows with the brightness slider, one without.
     */
    getGridOptions() {
        const withSlider = !this._opts || this._opts.slider !== false;
        return {
            columns: 12,
            rows: withSlider ? 2 : 1,
            min_columns: 6,
            min_rows: withSlider ? 2 : 1
        };
    }

    // -- building -----------------------------------------------------------

    _build() {
        const root = this.shadowRoot;
        root.innerHTML = '';

        const style = document.createElement('style');
        style.textContent = CARD_STYLES;
        root.appendChild(style);

        if (this._error) {
            // By now `hass` may have arrived, so the sentence is written in
            // the user's language rather than the browser's.
            if (this._errorKey) {
                this._error = translate(this._hass, this._errorKey, this._errorVars);
            }
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
        this._descText.className = 'dtext';
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
        this._toggle.setAttribute('aria-label', translate(this._hass, 'toggle'));
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
                this._runAction(this._opts.holdAction);
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
            this._runAction(this._opts.tapAction);
        });

        onDrag(this._slider, (point, done) => {
            if (!this._model || !this._model.supportsBrightness) return;
            if (this._model.isAllUnavailable) return;
            const min = this._opts.allowZero ? 0 : 1;
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
        const entityId = this._opts.entityIds[0];
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
        dialog.cardConfig = this._opts;
        document.body.appendChild(dialog);
        this._dialog = dialog;
        dialog.addEventListener('dialog-closed', () => {
            this._dialog = null;
        });
    }

    // -- rendering ----------------------------------------------------------

    _render() {
        if (!this._built) this._build();
        if (this._error || !this._opts || !this._hass) return;

        this._model = new GroupModel(this._hass, this._opts);
        const model = this._model;

        this._card.className = this._opts.hueBorders ? 'hue-borders' : '';
        this._icon.setAttribute('icon', model.icon);
        this._title.textContent = model.title;
        this._descText.textContent = model.description;

        // Unavailable members are named, not hidden: the card keeps working,
        // and the badge says how much of the group it is actually driving.
        const showWarn = this._opts.showUnavailable && model.deadCount > 0 && !model.isAllUnavailable;
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
        this._toggle.style.display = this._opts.showSwitch ? '' : 'none';

        // slider
        const sliderOn = this._opts.slider && model.supportsBrightness;
        this._slider.style.display = sliderOn ? '' : 'none';
        const sliderDisabled = this._opts.allowZero ? model.isAllUnavailable : !model.isOn;
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
        const offColor = parseColor(this._opts.offColor);
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
        if (!model.isOn) return this._opts.offShadow ? 'inset 0px 0px 10px rgba(0,0,0,0.2)' : 'none';
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
    resolveSections,
    scenesForLights,
    MEMBER_ATTRIBUTES,
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
    /*
     * The dialog's own theme hooks. Same idea as the card's: the value
     * initial is CSS's guaranteed-invalid one, so each use below falls back
     * to the literal beside it. The sheet stays deliberately dark in both
     * themes — that is the Hue look this card copies, and its text colour is
     * chosen to match it — but every one of those colours can be overridden
     * by name from a theme.
     */
    --blc-dialog-bg: initial;
    --blc-dialog-text: initial;
    --blc-dialog-invert: initial;
    --blc-dialog-tile: initial;
    --blc-dialog-muted: initial;
    --blc-dialog-dim: initial;
    --blc-dialog-faint: initial;
    --blc-dialog-line: initial;
    --blc-dialog-dead-a: initial;
    --blc-dialog-dead-b: initial;
    --blc-scene-badge: initial;
    --blc-knob-color: initial;

    position: fixed;
    inset: 0;
    /*
     * High on purpose. The dialog is appended to document.body, so it shares
     * the page's stacking context with every card on the dashboard — and
     * Leaflet hands its own panes z-index 400 and its controls 1000. At the
     * z-index: 10 this used to carry, a map card rendered straight through
     * the open dialog.
     */
    z-index: 100000;
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
    /* Vertical only. Nothing in here is meant to scroll sideways, so an
       element that overhangs must be clipped, not turned into a scrollbar. */
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--blc-dialog-bg, #171717);
    color: var(--blc-dialog-text, #fff);
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
    font-size: var(--ha-font-size-xl, 20px);
    font-weight: var(--ha-font-weight-medium, 500);
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.head .sub {
    font-size: 13px;
    color: var(--blc-dialog-muted, #aaa);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.iconbtn {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: none;
    background: var(--blc-dialog-tile, #363636);
    color: var(--blc-dialog-text, #fff);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
}
h3 {
    font-size: 13px;
    font-weight: var(--ha-font-weight-medium, 500);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--blc-dialog-muted, #aaa);
    margin: 18px 0 8px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
/* Scenes and lights share one square-tile grid, so the dialog reads as one
   surface rather than a strip above a grid. */
.scenes, .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(94px, 1fr));
    gap: 8px;
}
.scene {
    height: 106px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    color: var(--blc-dialog-text, #fff);
    background: var(--blc-dialog-tile, #363636);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: flex-start;
    padding: 10px;
    box-sizing: border-box;
    text-align: left;
    font-size: var(--ha-font-size-xs, 12px);
    line-height: 1.25;
    overflow: hidden;
}
/* The colour rides in a round badge instead of flooding the whole tile —
   that keeps the label readable whatever colour the scene carries. */
.scene .badge {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--blc-scene-badge, #ffda95);
}
.scene .badge ha-icon { --mdc-icon-size: 22px; }
.scene span {
    overflow: hidden;
    overflow-wrap: anywhere;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
.scene[disabled] { opacity: 0.4; cursor: default; }
.tile {
    position: relative;
    height: 118px;
    border-radius: 12px;
    padding: 8px;
    box-sizing: border-box;
    cursor: pointer;
    overflow: hidden;
    background: var(--blc-dialog-tile, #363636);
    color: var(--blc-dialog-text, #fff);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    text-align: center;
    touch-action: none;
    -webkit-tap-highlight-color: transparent;
}
/* Shades the DARK part from the top, so its height is the missing brightness.
   Filling from the bottom read backwards: a dim lamp looked like a bright one
   with a bright band on top. */
.tile .tfill {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 0%;
    background: rgba(0, 0, 0, 0.32);
    pointer-events: none;
    transition: height 0.2s ease-out;
}
.tile.dragging .tfill { transition: none; }
/* On a coloured tile the theme's accent clashes; the switch borrows the
   tile's own contrast instead. */
.tile.lit .tsw { background: rgba(0, 0, 0, 0.25); }
.tile.lit .tsw.on { background: rgba(0, 0, 0, 0.45); }
.tile .thead { position: relative; width: 100%; display: flex; justify-content: flex-end; min-height: 14px; }
.tile .tmid { position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.tile .ticon { --mdc-icon-size: 26px; }
.tile .tname {
    font-size: var(--ha-font-size-xs, 12px);
    line-height: 1.2;
    overflow: hidden;
    overflow-wrap: anywhere;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
}
/* currentColor, not a fixed white: a lit tile flips its text to dark. */
.tile .tpct {
    font-size: 11px;
    color: currentColor;
    opacity: 0.75;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.tile .tsw { position: relative; }
.tile.dead {
    background: repeating-linear-gradient(45deg,
        var(--blc-dialog-dead-a, #2a2a2a),
        var(--blc-dialog-dead-a, #2a2a2a) 6px,
        var(--blc-dialog-dead-b, #222) 6px,
        var(--blc-dialog-dead-b, #222) 12px);
    color: var(--blc-dialog-faint, #888);
    cursor: default;
}
.detail { margin-top: 6px; }
.picker-tabs { display: flex; gap: 8px; margin: 14px 0 10px; }
.picker-tabs button {
    flex: 1;
    border: none;
    border-radius: 9px;
    padding: 8px;
    background: var(--blc-dialog-tile, #363636);
    color: var(--blc-dialog-dim, #ccc);
    cursor: pointer;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.picker-tabs button.active {
    background: var(--blc-dialog-text, #fff);
    color: var(--blc-dialog-invert, #111);
}
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
    /* border-box, so the 3px ring counts inside the 26px: otherwise the thing
       is really 32px wide and both the -13px offset and the inset travel are
       three pixels short at each end. */
    box-sizing: border-box;
    width: 26px;
    height: 26px;
    margin: -13px 0 0 -13px;
    border-radius: 50%;
    border: 3px solid var(--blc-dialog-text, #fff);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
}
.dslider {
    position: relative;
    height: 44px;
    border-radius: 22px;
    background: var(--blc-dialog-tile, #363636);
    overflow: hidden;
    margin: 8px 0;
    touch-action: none;
    cursor: pointer;
}
.dslider .fill { position: absolute; inset: 0; width: 0%; background: rgba(255,255,255,0.75); }
/* White through mix-blend-mode difference inverts against whatever is behind
   it, so the label stays readable on both the dark track and the light fill. */
/* A block with a matching line-height, not a flex box: only on a block do
   overflow and text-overflow apply to the text. It sits in .dslider, which is
   overflow: hidden, so the absolute position cannot escape either. */
.dslider .label {
    position: absolute;
    inset: 0;
    display: block;
    box-sizing: border-box;
    line-height: 44px;
    padding: 0 14px;
    font-size: 13px;
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--blc-dialog-text, #fff);
    mix-blend-mode: difference;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.empty {
    color: var(--blc-dialog-faint, #888);
    font-size: 13px;
    padding: 8px 0;
    overflow-wrap: anywhere;
}
.deadlist {
    font-size: var(--ha-font-size-xs, 12px);
    color: var(--blc-dialog-faint, #888);
    margin-top: 10px;
    line-height: 1.5;
    overflow-wrap: anywhere;
}

/* One block per resolved group, so thirty lamps behind one card stay readable. */
.group + .group { margin-top: 14px; }
.group.nested { border-left: 2px solid var(--blc-dialog-line, #333); padding-left: 12px; }
.group-head { display: flex; align-items: center; gap: 8px; padding: 4px 0 8px; }
.group-head ha-icon { --mdc-icon-size: 18px; color: var(--blc-dialog-muted, #aaa); flex-shrink: 0; }
.group-head .gname {
    flex: 1; min-width: 0; font-size: 13px; font-weight: var(--ha-font-weight-medium, 500);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.group-head .gcount {
    font-size: var(--ha-font-size-xs, 12px);
    color: var(--blc-dialog-muted, #aaa);
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.gtoggle {
    flex-shrink: 0; width: 34px; height: 20px; border-radius: 10px; border: none;
    padding: 0; position: relative; cursor: pointer;
    background: rgba(255, 255, 255, 0.22); transition: background 0.2s ease-out;
}
.gtoggle .gknob {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: var(--blc-knob-color, #fff);
    transition: transform 0.2s ease-out;
}
.gtoggle.on { background: var(--primary-color, #03a9f4); }
.gtoggle.on .gknob { transform: translateX(14px); }
.gtoggle[disabled] { opacity: 0.4; cursor: default; }
/* The master switch, in the header where it is always reachable — the card's
   own switch is behind the dialog. */
.head .headsw { width: 42px; height: 24px; border-radius: 12px; }
.head .headsw .gknob { width: 20px; height: 20px; }
.head .headsw.on .gknob { transform: translateX(18px); }
`;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

class BuschLightDialog extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._hass = null;
        this._opts = null;
        this._model = null;
        this._built = false;
        this._detailEntity = null; // null = the whole group
        this._tab = 'colour';
        this._dragging = false;
        // How many history entries this dialog has pushed. Back consumes them.
        this._depth = 0;
        this._closing = false;
        this._closed = false;
        this._onKey = (event) => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            this._goBack();
        };
        this._onPop = () => {
            if (this._closing) {
                this._closing = false;
                this._dismiss();
                return;
            }
            if (this._detailEntity) {
                // Back out of one light's detail view, not out of the dialog.
                this._depth = Math.max(0, this._depth - 1);
                this._detailEntity = null;
                this._renderSheet();
                return;
            }
            this._depth = 0;
            this._dismiss();
        };
    }

    set cardConfig(opts) {
        this._opts = opts;
        this._update();
    }

    set hass(hass) {
        this._hass = hass;
        this._update();
    }

    connectedCallback() {
        document.addEventListener('keydown', this._onKey);
        window.addEventListener('popstate', this._onPop);
        // The phone's back gesture is a history navigation. Without an entry
        // of its own the dialog would stay open and the whole dashboard would
        // be left instead.
        this._push();
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this._onKey);
        window.removeEventListener('popstate', this._onPop);
    }

    /** Adds one history entry, keeping the URL as it is. */
    _push() {
        try {
            history.pushState({ [DIALOG_HISTORY_KEY]: this._depth + 1 }, '', location.href);
            this._depth += 1;
        } catch (e) {
            // Private modes and rate limits can refuse this. Escape and the
            // close button still work; only the back gesture is lost.
        }
    }

    /** Escape and the header's arrow: one step back, not always all the way out. */
    _goBack() {
        if (this._detailEntity) {
            if (this._depth > 1) {
                history.back(); // the popstate handler returns to the group view
                return;
            }
            this._detailEntity = null;
            this._renderSheet();
            return;
        }
        this.close();
    }

    close() {
        if (this._depth > 0) {
            const steps = this._depth;
            this._depth = 0;
            this._closing = true;
            history.go(-steps);
            // Insurance: if popstate never arrives, the dialog must not stay
            // stuck open.
            setTimeout(() => {
                if (this.isConnected) this._dismiss();
            }, 300);
            return;
        }
        this._dismiss();
    }

    _dismiss() {
        if (this._closed) return;
        this._closed = true;
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
        if (!this._opts || !this._hass) return;
        if (!this._built) this._build();
        if (this._dragging) return; // never rebuild under a finger
        this._model = new GroupModel(this._hass, this._opts);
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
            const back = this._makeIconButton('mdi:arrow-left', () => this._goBack());
            back.title = translate(hass, 'back');
            head.appendChild(back);
        }

        // Rule 2, anatomy: the close X sits top LEFT, ahead of the title. In
        // the detail view the back arrow keeps the first place — it is the
        // narrower step, and the X beside it still closes the whole dialog.
        head.appendChild(this._makeIconButton('mdi:close', () => this.close()));

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

        // The master switch, always in the header: it belongs to whatever the
        // header names — the whole group, or the single light in detail view.
        head.appendChild(
            detail
                ? this._makeHeadSwitch(detail.isOn, !detail.isAvailable, () =>
                      hass.callService(detail.domain, detail.isOn ? 'turn_off' : 'turn_on', {
                          entity_id: detail.entityId
                      })
                  )
                : this._makeHeadSwitch(model.isOn, model.isAllUnavailable || model.isEmpty, () =>
                      model.toggle()
                  )
        );

        sheet.appendChild(head);

        if (detail) {
            this._renderDetail(sheet, detail);
            return;
        }

        // ---- scenes
        if (this._opts.scenes.length) {
            sheet.appendChild(this._heading(translate(hass, 'scenes')));
            const row = document.createElement('div');
            row.className = 'scenes';
            this._opts.scenes.forEach((scene) => row.appendChild(this._makeSceneTile(scene)));
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

        // ---- the resolved lights
        sheet.appendChild(this._heading(translate(hass, 'lights') + ' (' + model.lights.length + ')'));
        if (!model.lights.length) {
            const empty = document.createElement('div');
            empty.className = 'empty';
            empty.textContent = translate(hass, 'noEntities');
            sheet.appendChild(empty);
        } else if (this._opts.groupDisplay === 'flat' || model.sections.length < 2) {
            // One group, or the user asked for a plain pile: headings would be
            // noise rather than orientation.
            sheet.appendChild(this._makeTileGrid(model.lights));
        } else {
            const single = this._opts.entityIds.length === 1 ? this._opts.entityIds[0] : null;
            model.sections.forEach((section, index) => {
                // The first block belongs to the card's own root, whose name is
                // already the dialog's title. Repeating it there would put the
                // same label on two different sets — all six lights above, only
                // the four direct ones below. So its tiles stand bare.
                const headless =
                    index === 0 && section.depth === 0
                    && (section.entityId === null || section.entityId === single);
                sheet.appendChild(
                    headless ? this._makeTileGrid(section.lights) : this._makeGroupBlock(model, section)
                );
            });
        }

        const emptyGroups = model.resolution.emptyGroups || [];
        if (emptyGroups.length && this._opts.groupDisplay !== 'flat') {
            // Named rather than shown: an empty heading looks like a fault,
            // and silently dropping the group hides that it exists at all.
            const note = document.createElement('div');
            note.className = 'deadlist';
            note.textContent = translate(hass, 'alreadyIncluded', {
                list: emptyGroups.map((id) => {
                    const state = hass.states[id];
                    return state && state.attributes && state.attributes.friendly_name
                        ? state.attributes.friendly_name
                        : id;
                }).join(', ')
            });
            sheet.appendChild(note);
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
        }
        // A light without brightness needs no row of its own: the header
        // switch above already turns it on and off.

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

    _makeHeadSwitch(isOn, disabled, onClick) {
        const toggle = document.createElement('button');
        toggle.className = 'gtoggle headsw' + (isOn ? ' on' : '');
        toggle.setAttribute('aria-label', translate(this._hass, 'toggle'));
        const knob = document.createElement('span');
        knob.className = 'gknob';
        toggle.appendChild(knob);
        if (disabled) toggle.setAttribute('disabled', '');
        else toggle.addEventListener('click', onClick);
        return toggle;
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
        const color = parseColor(scene.color) || parseColor(WARM_COLOR);

        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.style.background = colorToCss(color);
        const icon = document.createElement('ha-icon');
        icon.setAttribute(
            'icon',
            scene.icon || (state && state.attributes && state.attributes.icon) || 'mdi:palette'
        );
        icon.style.color = foregroundFor(color, '#fff', 'rgba(0,0,0,0.75)', 0);
        badge.appendChild(icon);
        button.appendChild(badge);

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

    _makeTileGrid(lights) {
        const tiles = document.createElement('div');
        tiles.className = 'tiles';
        lights.forEach((light) => tiles.appendChild(this._makeLightTile(light)));
        return tiles;
    }

    /**
     * One resolved group: a header naming it, saying how many of its lights
     * are on, and switching the whole group — then its own lights as tiles.
     */
    _makeGroupBlock(model, section) {
        const hass = this._hass;
        const block = document.createElement('div');
        block.className = 'group' + (section.depth > 0 ? ' nested' : '');
        block.dataset.depth = String(section.depth);
        if (section.entityId) block.dataset.entity = section.entityId;

        const tally = GroupModel.tally(section.lights);

        const head = document.createElement('div');
        head.className = 'group-head';

        const icon = document.createElement('ha-icon');
        icon.setAttribute('icon', section.icon || (section.entityId ? 'mdi:lightbulb-group' : 'mdi:lightbulb'));
        head.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'gname';
        // A nameless section holds roots that are plain lights, not a group.
        name.textContent = section.name || translate(hass, 'lights');
        head.appendChild(name);

        const count = document.createElement('span');
        count.className = 'gcount';
        count.textContent = tally.total
            ? tally.on + '/' + tally.total
            : translate(hass, 'unreachable');
        head.appendChild(count);

        const toggle = document.createElement('button');
        toggle.className = 'gtoggle' + (tally.isOn ? ' on' : '');
        toggle.setAttribute('aria-label', section.name || '');
        const knob = document.createElement('span');
        knob.className = 'gknob';
        toggle.appendChild(knob);
        if (!tally.total) toggle.setAttribute('disabled', '');
        else toggle.addEventListener('click', () => model.toggleLights(section.lights));
        head.appendChild(toggle);

        block.appendChild(head);
        block.appendChild(this._makeTileGrid(section.lights));
        return block;
    }

    _makeLightTile(light) {
        // A div, not a button: it carries its own toggle button, and nesting
        // buttons is invalid.
        const tile = document.createElement('div');
        tile.className = 'tile' + (light.isAvailable ? '' : ' dead');
        tile.setAttribute('role', 'button');
        if (light.isAvailable) tile.setAttribute('tabindex', '0');

        const fill = document.createElement('div');
        fill.className = 'tfill';
        tile.appendChild(fill);

        const head = document.createElement('div');
        head.className = 'thead';
        const pct = document.createElement('span');
        pct.className = 'tpct';
        pct.textContent = light.isAvailable ? (light.isOn ? light.brightnessPct + ' %' : '') : '';
        head.appendChild(pct);
        tile.appendChild(head);

        const mid = document.createElement('div');
        mid.className = 'tmid';
        const icon = document.createElement('ha-icon');
        icon.className = 'ticon';
        icon.setAttribute('icon', light.isAvailable ? light.icon : 'mdi:alert-circle-outline');
        mid.appendChild(icon);
        const name = document.createElement('div');
        name.className = 'tname';
        name.textContent = light.name;
        mid.appendChild(name);
        tile.appendChild(mid);

        if (!light.isAvailable) {
            // Shown, greyed and inert. Hiding it would make a missing lamp
            // look like a lamp that was never in the group.
            tile.title = light.entityId + ' — ' + translate(this._hass, 'unreachable');
            return tile;
        }

        // Its own switch, so on/off is one visible tap instead of a gesture
        // nobody discovers.
        const toggle = document.createElement('button');
        toggle.className = 'gtoggle tsw' + (light.isOn ? ' on' : '');
        toggle.setAttribute('aria-label', light.name);
        const knob = document.createElement('span');
        knob.className = 'gknob';
        toggle.appendChild(knob);
        toggle.addEventListener('pointerdown', (event) => event.stopPropagation());
        toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            this._hass.callService(light.domain, light.isOn ? 'turn_off' : 'turn_on', {
                entity_id: light.entityId
            });
        });
        tile.appendChild(toggle);

        const color = light.color;
        if (light.isOn) {
            tile.classList.add('lit');
            tile.style.background = color ? colorToCss(color) : WARM_COLOR;
            tile.style.color = foregroundFor(color || parseColor(WARM_COLOR), '#fff', '#111', 0);
            // height = the darkness, not the brightness
            fill.style.height = 100 - light.brightnessPct + '%';
        }

        // The switch does on/off, so the tile itself is free for the two things
        // that used to need a long press: drag up/down dims, a plain tap opens
        // that light's detail view.
        let moved = false;
        let startY = 0;

        onDrag(tile, (point, done) => {
            if (!moved) startY = point.y;
            const delta = Math.abs(point.y - startY);
            if (!done && delta > 8 && light.supportsBrightness) {
                moved = true;
                this._dragging = true;
                tile.classList.add('dragging');
                const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                fill.style.height = 100 - value + '%';
                pct.textContent = value + ' %';
            }
            if (!done) return;

            tile.classList.remove('dragging');
            this._dragging = false;
            if (moved) {
                const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                this._hass.callService('light', 'turn_on', {
                    entity_id: light.entityId,
                    brightness_pct: value
                });
                moved = false;
                return;
            }
            this._detailEntity = light.entityId;
            // Its own history entry, so back returns here rather than closing.
            this._push();
            this._renderSheet();
        });

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

    /**
     * Colour temperature bar, drawn along Hue's own curve.
     *
     * The marker travels inset by its own radius. At `left: 100%` it hung 13 px
     * past the bar, which was enough to give the whole sheet a horizontal
     * scrollbar.
     */
    _makeTempBar(minKelvin, maxKelvin, currentKelvin, onPick) {
        const markerLeft = (ratio) => `calc(13px + (100% - 26px) * ${clamp(ratio, 0, 1)})`;
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
            marker.style.left = markerLeft(ratio);
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
            marker.style.left = markerLeft(ratio);
            marker.style.background = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
            this._dragging = !done;
            if (done) onPick(kelvin);
        });

        return bar;
    }
}

// ---------------------------------------------------------------------------
// Visual editor
// ---------------------------------------------------------------------------

const EDITOR_STYLES = `
:host { display: block; }
.ed { display: flex; flex-direction: column; gap: 12px; }
details {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 10px;
    padding: 0 12px;
}
details[open] { padding-bottom: 12px; }
summary {
    cursor: pointer;
    padding: 12px 0;
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--primary-text-color);
    list-style-position: inside;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.preview {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 13px;
    color: var(--primary-text-color);
    overflow-wrap: anywhere;
}
.preview .head {
    font-weight: var(--ha-font-weight-medium, 500);
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
}
.preview .count {
    color: var(--secondary-text-color);
    font-weight: var(--ha-font-weight-normal, 400);
    min-width: 0;
    overflow-wrap: anywhere;
}
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.chip {
    font-size: 11px;
    line-height: 20px;
    padding: 0 8px;
    border-radius: 10px;
    background: var(--secondary-background-color, rgba(0, 0, 0, 0.06));
    color: var(--primary-text-color);
    /* One entity name per chip, so it is cut rather than wrapped — but never
       wider than the box it sits in. */
    max-width: 100%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.chip.dead {
    background: repeating-linear-gradient(45deg,
        rgba(219, 68, 55, 0.14), rgba(219, 68, 55, 0.14) 5px,
        transparent 5px, transparent 10px);
    color: var(--error-color, #db4437);
}
.note {
    margin-top: 8px;
    font-size: var(--ha-font-size-xs, 12px);
    color: var(--secondary-text-color);
    overflow-wrap: anywhere;
}
.note.warn { color: var(--warning-color, #ffa600); }
.scene-row {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 10px;
    padding: 8px 10px;
    margin-bottom: 8px;
}
.scene-bar { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.scene-bar .spacer { flex: 1; }
.iconbtn {
    border: none;
    background: none;
    color: var(--secondary-text-color);
    cursor: pointer;
    padding: 4px;
    border-radius: 50%;
    display: inline-flex;
}
.iconbtn:hover { background: var(--secondary-background-color, rgba(0, 0, 0, 0.06)); }
.iconbtn[disabled] { opacity: 0.35; cursor: default; }
.addbtn {
    border: 1px dashed var(--divider-color, #bdbdbd);
    background: none;
    color: var(--primary-color, #03a9f4);
    border-radius: 10px;
    padding: 10px;
    width: 100%;
    cursor: pointer;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.addbtn[disabled] {
    color: var(--secondary-text-color);
    cursor: default;
    opacity: 0.7;
}
.fallback {
    color: var(--error-color, #db4437);
    font-size: 13px;
    padding: 8px 0;
    overflow-wrap: anywhere;
}
`;

/**
 * Makes sure Home Assistant's form elements exist.
 *
 * `ha-form` is loaded lazily by the frontend, so a card editor opened before
 * any built-in editor would find it undefined. Building the built-in entities
 * editor once pulls it in — the established way to do this from a custom card.
 */
let formElementsPromise = null;
function ensureFormElements() {
    if (customElements.get('ha-form')) return Promise.resolve(true);
    if (!formElementsPromise) {
        formElementsPromise = (async () => {
            try {
                if (window.loadCardHelpers) {
                    const helpers = await window.loadCardHelpers();
                    const card = await helpers.createCardElement({ type: 'entities', entities: [] });
                    if (card && card.constructor && card.constructor.getConfigElement) {
                        await card.constructor.getConfigElement();
                    }
                }
            } catch (e) {
                /* nothing else to try — the fallback notice covers it */
            }
            return !!customElements.get('ha-form');
        })();
    }
    return formElementsPromise;
}

const LIGHT_FILTER = [{ domain: 'light' }, { domain: 'switch' }, { domain: 'group' }];
const SCENE_FILTER = [{ domain: 'scene' }, { domain: 'script' }];

/** The four choices behind `tap_action` and `hold_action`. */
const ACTION_OPTIONS = [
    { value: 'dialog', labelKey: 'actDialog' },
    { value: 'toggle', labelKey: 'actToggle' },
    { value: 'more-info', labelKey: 'actMoreInfo' },
    { value: 'none', labelKey: 'actNone' }
];

/**
 * The card's option schema — the one place a card option is declared.
 *
 * The editor slices this list into its four sections instead of carrying four
 * lists of its own, so an option can never exist in the editor without a
 * label and a helper, or the other way round. `labelKey` on a select option
 * names a dictionary entry; `_sliceSchema` turns it into `label` in the
 * user's language, because a schema built at load time cannot know it yet.
 *
 * `scenes` is not rendered by `ha-form`: a list of objects has no selector.
 * The editor draws one row per scene, and every row is itself an `ha-form`
 * over the four `scene_*` fields declared below it.
 */
const SCHEMA_BUSCH_LIGHT_CARD = [
    { name: 'entity', required: true, selector: { entity: { filter: LIGHT_FILTER } } },
    { name: 'entities', selector: { entity: { multiple: true, filter: LIGHT_FILTER } } },
    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'title', selector: { text: {} } },
            { name: 'icon', selector: { icon: {} } }
        ]
    },
    { name: 'description', selector: { text: {} } },

    { name: 'resolve_groups', selector: { boolean: {} } },
    { name: 'max_depth', selector: { number: { min: 1, max: 20, mode: 'box' } } },
    { name: 'show_unavailable', selector: { boolean: {} } },
    {
        name: 'group_display',
        selector: {
            select: {
                mode: 'dropdown',
                options: [
                    { value: 'sections', labelKey: 'groupSections' },
                    { value: 'flat', labelKey: 'groupFlat' }
                ]
            }
        }
    },

    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'off_color', selector: { text: {} } },
            { name: 'default_color', selector: { text: {} } }
        ]
    },
    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'hue_borders', selector: { boolean: {} } },
            { name: 'show_switch', selector: { boolean: {} } },
            { name: 'slider', selector: { boolean: {} } },
            { name: 'allow_zero', selector: { boolean: {} } },
            { name: 'off_shadow', selector: { boolean: {} } }
        ]
    },

    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'tap_action', selector: { select: { mode: 'dropdown', options: ACTION_OPTIONS } } },
            { name: 'hold_action', selector: { select: { mode: 'dropdown', options: ACTION_OPTIONS } } }
        ]
    },

    {
        name: 'scenes',
        type: 'expandable',
        schema: [
            { name: 'scene_entity', selector: { entity: { filter: SCENE_FILTER } } },
            {
                name: '',
                type: 'grid',
                schema: [
                    { name: 'scene_title', selector: { text: {} } },
                    { name: 'scene_icon', selector: { icon: {} } }
                ]
            },
            { name: 'scene_color', selector: { color_rgb: {} } }
        ]
    }
];

/** The names a scene row's four fields carry inside its own little form. */
const SCENE_FIELDS = { scene_entity: 'entity', scene_title: 'title', scene_icon: 'icon', scene_color: 'color' };

/**
 * Copies the entries named in `names` out of the schema, keeping grid
 * wrappers whose children survive, and translates every `labelKey`.
 */
function sliceSchema(hass, names, source) {
    const wanted = (list) => {
        const out = [];
        (list || []).forEach((item) => {
            if (item.type === 'grid' || item.type === 'expandable') {
                const inner = wanted(item.schema);
                if (inner.length) out.push(Object.assign({}, item, { schema: inner }));
                return;
            }
            if (names.indexOf(item.name) === -1) return;
            const copy = JSON.parse(JSON.stringify(item));
            const select = copy.selector && copy.selector.select;
            if (select && Array.isArray(select.options)) {
                select.options = select.options.map((option) => ({
                    value: option.value,
                    label: option.labelKey ? translate(hass, option.labelKey) : option.label
                }));
            }
            out.push(copy);
        });
        return out;
    };
    return wanted(source || SCHEMA_BUSCH_LIGHT_CARD);
}

/**
 * The little form inside one scene row: the four `scene_*` fields of the
 * declaration, under the names a scene entry really carries (`entity`,
 * `title`, `icon`, `color`). Labels and helpers still come from the
 * `scene_*` keys, so the row explains itself without colliding with the
 * card's own `entity` and `title`.
 */
function sceneRowSchema() {
    const group = SCHEMA_BUSCH_LIGHT_CARD.filter((item) => item.name === 'scenes')[0];
    const rename = (list) => list.map((item) => (
        item.type === 'grid'
            ? Object.assign({}, item, { schema: rename(item.schema) })
            : Object.assign({}, item, { name: SCENE_FIELDS[item.name] || item.name })
    ));
    return rename(group.schema);
}

function hexToRgbArray(value) {
    const color = parseColor(value);
    return color ? [Math.round(color.r), Math.round(color.g), Math.round(color.b)] : undefined;
}

function rgbArrayToHex(rgb) {
    if (!Array.isArray(rgb) || rgb.length < 3) return undefined;
    return (
        '#' +
        rgb
            .slice(0, 3)
            .map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0'))
            .join('')
    );
}

class BuschLightCardEditor extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._config = {};
        this._hass = null;
        this._built = false;
        this._sceneCount = -1;
        this._forms = {};
    }

    setConfig(config) {
        this._config = toSnakeConfig(config || {});
        this._render();
    }

    set hass(hass) {
        this._hass = hass;
        Object.keys(this._forms).forEach((key) => {
            if (this._forms[key]) this._forms[key].hass = hass;
        });
        if (this._sceneForms) this._sceneForms.forEach((f) => (f.hass = hass));
        this._renderPreview();
    }

    get hass() {
        return this._hass;
    }

    connectedCallback() {
        this._render();
    }

    // -- config plumbing ----------------------------------------------------

    /**
     * Merges a patch and drops everything that matches its default, so the
     * YAML the editor produces stays as short as a hand-written one.
     */
    _emit(patch) {
        const next = Object.assign({}, this._config, patch);

        Object.keys(CONFIG_DEFAULTS).forEach((key) => {
            if (next[key] !== undefined && next[key] === CONFIG_DEFAULTS[key]) delete next[key];
        });
        ['title', 'icon', 'description', 'off_color', 'default_color'].forEach((key) => {
            if (next[key] === '' || next[key] === null || next[key] === undefined) delete next[key];
        });
        if (Array.isArray(next.entities) && !next.entities.length) delete next.entities;
        if (Array.isArray(next.scenes) && !next.scenes.length) delete next.scenes;

        next.type = 'custom:' + CARD_TAG;
        this._config = next;

        this.dispatchEvent(
            new CustomEvent('config-changed', {
                detail: { config: next },
                bubbles: true,
                composed: true
            })
        );
        this._syncForms();
        this._renderPreview();
    }

    /** One of the dictionary's `ui` strings. */
    _ui(key) {
        return translate(this._hass, key);
    }

    _data(names) {
        const c = this._config;
        const all = {
            entity: c.entity || '',
            entities: Array.isArray(c.entities) ? c.entities : [],
            title: c.title || '',
            icon: c.icon || '',
            description: c.description || '',
            resolve_groups: c.resolve_groups !== false,
            max_depth: c.max_depth === undefined ? DEFAULT_MAX_DEPTH : c.max_depth,
            show_unavailable: c.show_unavailable !== false,
            group_display: c.group_display === 'flat' ? 'flat' : 'sections',
            off_color: c.off_color || '',
            default_color: c.default_color || '',
            hue_borders: c.hue_borders !== false,
            show_switch: c.show_switch !== false,
            slider: c.slider !== false,
            allow_zero: c.allow_zero === true,
            off_shadow: c.off_shadow !== false,
            tap_action: c.tap_action || CONFIG_DEFAULTS.tap_action,
            hold_action: c.hold_action || CONFIG_DEFAULTS.hold_action
        };
        const out = {};
        names.forEach((n) => (out[n] = all[n]));
        return out;
    }

    // -- building -----------------------------------------------------------

    _render() {
        if (!this.isConnected) return;
        ensureFormElements().then((ok) => {
            if (!ok) {
                this._buildFallback();
                return;
            }
            if (!this._built) this._build();
            this._syncForms();
            this._syncScenes();
            this._renderPreview();
        });
    }

    _buildFallback() {
        this.shadowRoot.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = EDITOR_STYLES;
        const box = document.createElement('div');
        box.className = 'fallback';
        box.textContent = this._ui('noForm');
        this.shadowRoot.appendChild(style);
        this.shadowRoot.appendChild(box);
    }

    /** One section's form, cut out of the card's single option schema. */
    _makeForm(names) {
        const form = document.createElement('ha-form');
        form.hass = this._hass;
        form.schema = sliceSchema(this._hass, names);
        form.data = this._data(names);
        // Rule 3: every field carries a label AND a helper, in both languages.
        // Grid wrappers have no name and therefore neither.
        form.computeLabel = (item) => (item.name ? fieldLabel(this._hass, item.name) : '');
        form.computeHelper = (item) => (item.name ? fieldHelper(this._hass, item.name) : '');
        form.addEventListener('value-changed', (event) => {
            event.stopPropagation();
            this._emit(event.detail.value);
        });
        form.__names = names;
        return form;
    }

    _section(titleKey, node, open) {
        const details = document.createElement('details');
        if (open) details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = this._ui(titleKey);
        details.appendChild(summary);
        details.appendChild(node);
        return details;
    }

    _build() {
        const root = this.shadowRoot;
        root.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = EDITOR_STYLES;
        root.appendChild(style);

        const wrap = document.createElement('div');
        wrap.className = 'ed';

        // --- what to control
        this._forms.basic = this._makeForm(
            ['entity', 'entities', 'title', 'icon', 'description']
        );
        wrap.appendChild(this._forms.basic);

        // --- live resolution preview: the whole point of this card, visible
        this._preview = document.createElement('div');
        this._preview.className = 'preview';
        wrap.appendChild(this._preview);

        // --- group resolution
        const resolveBox = document.createElement('div');
        this._forms.resolve = this._makeForm(
            ['resolve_groups', 'max_depth', 'show_unavailable', 'group_display']
        );
        // No loose hint paragraph any more: what it said is now the helper of
        // the field it was about (rule 3 — every field explains itself).
        resolveBox.appendChild(this._forms.resolve);
        wrap.appendChild(this._section('sectionResolve', resolveBox, true));

        // --- appearance
        this._forms.look = this._makeForm(
            ['off_color', 'default_color', 'hue_borders', 'show_switch', 'slider', 'allow_zero', 'off_shadow']
        );
        const lookBox = document.createElement('div');
        lookBox.appendChild(this._forms.look);
        wrap.appendChild(this._section('sectionLook', lookBox, false));

        // --- actions
        this._forms.actions = this._makeForm(['tap_action', 'hold_action']);
        wrap.appendChild(this._section('sectionActions', this._forms.actions, false));

        // --- scenes
        const sceneBox = document.createElement('div');
        this._sceneList = document.createElement('div');
        sceneBox.appendChild(this._sceneList);
        const add = document.createElement('button');
        add.className = 'addbtn';
        add.textContent = '+  ' + this._ui('addScene');
        add.addEventListener('click', () => {
            const scenes = (this._config.scenes || []).slice();
            scenes.push({ entity: '' });
            this._emit({ scenes: scenes });
            this._syncScenes(true);
        });
        sceneBox.appendChild(add);

        // One click pulls in every scene that touches these lights. Removing
        // one afterwards is the same delete button as any hand-added row —
        // an import must not be a one-way door.
        this._importBtn = document.createElement('button');
        this._importBtn.className = 'addbtn';
        this._importBtn.style.marginTop = '6px';
        this._importBtn.addEventListener('click', () => this._importScenes());
        sceneBox.appendChild(this._importBtn);
        wrap.appendChild(this._section('sectionScenes', sceneBox, true));

        root.appendChild(wrap);
        this._built = true;
    }

    /**
     * Pushes current values back into the forms without rebuilding them.
     *
     * The form the cursor is in is left alone: writing a value back into a
     * field that is being typed in fights the user for the caret.
     */
    _syncForms() {
        const focused = this.shadowRoot ? this.shadowRoot.activeElement : null;
        Object.keys(this._forms).forEach((key) => {
            const form = this._forms[key];
            if (!form || !form.__names) return;
            if (focused && (focused === form || form.contains(focused))) return;
            form.data = this._data(form.__names);
        });
    }

    // -- scenes -------------------------------------------------------------

    /**
     * Scene rows are rebuilt only when their number changes. Rebuilding on
     * every keystroke would move focus out of the field being typed in.
     */
    _syncScenes(force) {
        if (!this._sceneList) return;
        const scenes = Array.isArray(this._config.scenes) ? this._config.scenes : [];
        if (!force && scenes.length === this._sceneCount) {
            if (this._sceneForms) {
                this._sceneForms.forEach((form, index) => {
                    form.data = this._sceneData(scenes[index]);
                });
            }
            return;
        }
        this._sceneCount = scenes.length;
        this._sceneForms = [];
        this._sceneList.innerHTML = '';
        scenes.forEach((scene, index) => {
            this._sceneList.appendChild(this._sceneRow(scene, index, scenes.length));
        });
    }

    _sceneData(scene) {
        const raw = typeof scene === 'string' ? { entity: scene } : scene || {};
        return {
            entity: raw.entity || '',
            title: raw.title || '',
            icon: raw.icon || '',
            color: hexToRgbArray(raw.color)
        };
    }

    _sceneRow(scene, index, total) {
        const row = document.createElement('div');
        row.className = 'scene-row';

        const form = document.createElement('ha-form');
        form.hass = this._hass;
        form.data = this._sceneData(scene);
        form.schema = sceneRowSchema();
        // A scene row's four fields share their names with the card's own
        // options, so they get their own dictionary keys instead of borrowing
        // the wrong helper.
        const sceneKey = (item) => 'scene_' + item.name;
        form.computeLabel = (item) => (item.name ? fieldLabel(this._hass, sceneKey(item)) : '');
        form.computeHelper = (item) => (item.name ? fieldHelper(this._hass, sceneKey(item)) : '');
        form.addEventListener('value-changed', (event) => {
            event.stopPropagation();
            const value = event.detail.value;
            const next = { entity: value.entity || '' };
            if (value.title) next.title = value.title;
            if (value.icon) next.icon = value.icon;
            const hex = rgbArrayToHex(value.color);
            if (hex) next.color = hex;
            this._replaceScene(index, next);
        });
        row.appendChild(form);
        this._sceneForms.push(form);

        const bar = document.createElement('div');
        bar.className = 'scene-bar';
        const spacer = document.createElement('span');
        spacer.className = 'spacer';
        bar.appendChild(spacer);
        bar.appendChild(this._sceneButton('mdi:arrow-up', 'up', index === 0, () => this._moveScene(index, -1)));
        bar.appendChild(
            this._sceneButton('mdi:arrow-down', 'down', index === total - 1, () => this._moveScene(index, 1))
        );
        // Removes the row from this card's config — it deletes nothing in
        // Home Assistant. So: Remove, mdi:close, and not red. Red is for the
        // final kind (docs/ui-regeln.md, rule 4, wording).
        bar.appendChild(this._sceneButton('mdi:close', 'remove', false, () => this._removeScene(index)));
        row.appendChild(bar);

        return row;
    }

    _sceneButton(icon, labelKey, disabled, onClick) {
        const button = document.createElement('button');
        button.className = 'iconbtn';
        button.title = this._ui(labelKey);
        if (disabled) button.setAttribute('disabled', '');
        else button.addEventListener('click', onClick);
        const haIcon = document.createElement('ha-icon');
        haIcon.setAttribute('icon', icon);
        button.appendChild(haIcon);
        return button;
    }

    /**
     * Everything this card touches: the resolved lights **and** the groups it
     * walked through. Scenes often name the group rather than its lamps — in
     * this installation `scene.taglicht_2` lists `light.kinderzimmerspots`,
     * not the three spots behind it — so matching on leaves alone would miss
     * exactly the scenes worth importing.
     */
    _resolvedIds() {
        const roots = []
            .concat(this._config.entity ? [this._config.entity] : [])
            .concat(Array.isArray(this._config.entities) ? this._config.entities : [])
            .filter(Boolean);
        if (!this._hass || !roots.length) return [];
        const result = resolveEntities(this._hass, roots, {
            maxDepth: this._config.max_depth === undefined ? DEFAULT_MAX_DEPTH : this._config.max_depth,
            resolveGroups: this._config.resolve_groups !== false
        });
        return result.leaves.concat(result.groups);
    }

    _matchingScenes() {
        return scenesForLights(this._hass, this._resolvedIds());
    }

    _importScenes() {
        const existing = (this._config.scenes || []).map((s) => (typeof s === 'string' ? s : s.entity));
        const fresh = this._matchingScenes().filter((id) => existing.indexOf(id) === -1);
        if (!fresh.length) return;
        const scenes = (this._config.scenes || []).concat(fresh.map((id) => ({ entity: id })));
        this._emit({ scenes: scenes });
        this._syncScenes(true);
    }

    /** Keeps the import button's label honest about what it would add. */
    _syncImportButton() {
        if (!this._importBtn) return;
        const matching = this._matchingScenes();
        const existing = (this._config.scenes || []).map((s) => (typeof s === 'string' ? s : s.entity));
        const fresh = matching.filter((id) => existing.indexOf(id) === -1);

        if (!matching.length) {
            this._importBtn.textContent = this._ui('importNone');
            this._importBtn.setAttribute('disabled', '');
            return;
        }
        if (!fresh.length) {
            this._importBtn.textContent = translate(this._hass, 'importAllThere', { n: matching.length });
            this._importBtn.setAttribute('disabled', '');
            return;
        }
        this._importBtn.removeAttribute('disabled');
        this._importBtn.textContent = '↧  ' + translate(this._hass, 'importScenes', { n: fresh.length });
    }

    _replaceScene(index, value) {
        const scenes = (this._config.scenes || []).slice();
        scenes[index] = value;
        this._emit({ scenes: scenes });
    }

    _moveScene(index, delta) {
        const scenes = (this._config.scenes || []).slice();
        const target = index + delta;
        if (target < 0 || target >= scenes.length) return;
        const held = scenes[index];
        scenes[index] = scenes[target];
        scenes[target] = held;
        this._emit({ scenes: scenes });
        this._syncScenes(true);
    }

    _removeScene(index) {
        const scenes = (this._config.scenes || []).slice();
        scenes.splice(index, 1);
        this._emit({ scenes: scenes });
        this._syncScenes(true);
    }

    // -- resolution preview -------------------------------------------------

    /**
     * Runs the card's own resolver against the live state and reports what it
     * found. Without this, "resolve nested groups" is a switch whose effect is
     * invisible until the card is placed.
     */
    _renderPreview() {
        this._syncImportButton();
        const box = this._preview;
        if (!box) return;
        box.innerHTML = '';

        const roots = []
            .concat(this._config.entity ? [this._config.entity] : [])
            .concat(Array.isArray(this._config.entities) ? this._config.entities : [])
            .filter(Boolean);

        const head = document.createElement('div');
        head.className = 'head';
        const label = document.createElement('span');
        label.textContent = this._ui('preview') + ':';
        head.appendChild(label);
        box.appendChild(head);

        if (!this._hass || !roots.length) {
            const none = document.createElement('span');
            none.className = 'count';
            none.textContent = this._ui('previewNone');
            head.appendChild(none);
            return;
        }

        const follow = this._config.resolve_groups !== false;
        const depth = this._config.max_depth === undefined ? DEFAULT_MAX_DEPTH : this._config.max_depth;
        const result = resolveEntities(this._hass, roots, { maxDepth: depth, resolveGroups: follow });

        const dead = result.leaves.filter((id) => {
            const state = this._hass.states[id];
            return !state || state.state === 'unavailable';
        });

        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = follow
            ? this._ui('previewCount')
                  .split('{leaves}').join(result.leaves.length)
                  .split('{groups}').join(result.groups.length)
                  .split('{depth}').join(result.maxDepth)
            : this._ui('previewFlat');
        head.appendChild(count);

        const chips = document.createElement('div');
        chips.className = 'chips';
        result.leaves.forEach((id) => {
            const state = this._hass.states[id];
            const isDead = !state || state.state === 'unavailable';
            const chip = document.createElement('span');
            chip.className = 'chip' + (isDead ? ' dead' : '');
            chip.textContent =
                state && state.attributes && state.attributes.friendly_name
                    ? state.attributes.friendly_name
                    : id;
            chip.title = id;
            chips.appendChild(chip);
        });
        box.appendChild(chips);

        const notes = [];
        if (dead.length) {
            notes.push({
                warn: true,
                text: translate(this._hass, 'previewDead', { n: dead.length })
            });
        }
        if (result.dropped.length) {
            notes.push({ text: translate(this._hass, 'previewDropped', { n: result.dropped.length }) });
        }
        if (result.truncated.length) {
            notes.push({
                warn: true,
                text: translate(this._hass, 'previewTruncated', { list: result.truncated.join(', ') })
            });
        }
        if (result.recovered.length) {
            notes.push({
                warn: true,
                text: translate(this._hass, 'previewRecovered', { list: result.recovered.join(', ') })
            });
        }
        notes.forEach((note) => {
            const div = document.createElement('div');
            div.className = 'note' + (note.warn ? ' warn' : '');
            div.textContent = note.text;
            box.appendChild(div);
        });
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

if (!customElements.get(CARD_TAG)) customElements.define(CARD_TAG, BuschLightCard);
if (!customElements.get(DIALOG_TAG)) customElements.define(DIALOG_TAG, BuschLightDialog);
if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, BuschLightCardEditor);

// Editor internals, exposed for the browser test harness the same way the
// card's are.
BuschLightCard.__internals.BuschLightCardEditor = BuschLightCardEditor;
BuschLightCard.__internals.toSnakeConfig = toSnakeConfig;
BuschLightCard.__internals.CONFIG_DEFAULTS = CONFIG_DEFAULTS;
BuschLightCard.__internals.hexToRgbArray = hexToRgbArray;
BuschLightCard.__internals.rgbArrayToHex = rgbArrayToHex;
BuschLightCard.__internals.SCHEMA = SCHEMA_BUSCH_LIGHT_CARD;
BuschLightCard.__internals.TEXTE = TEXTE_BUSCH_LIGHT_CARD;
BuschLightCard.__internals.SCHEMA_EXCEPTIONS = SCHEMA_EXCEPTIONS;
BuschLightCard.__internals.sliceSchema = sliceSchema;
BuschLightCard.__internals.fieldLabel = fieldLabel;
BuschLightCard.__internals.fieldHelper = fieldHelper;

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === CARD_TAG)) {
    // The picker reads this at load time, long before `hass` exists — so the
    // language cannot come from `hass.locale.language` here. `textTable(null)`
    // falls through to `navigator.language`, which is what the frontend
    // itself uses at this point.
    const picker = textTable(null);
    window.customCards.push({
        type: CARD_TAG,
        name: picker.name,
        description: picker.description,
        preview: true,
        documentationURL: 'https://github.com/luukkii123/ha-busch-lightcards'
    });
}

console.info(
    `%c BUSCH-LIGHTCARDS %c ${CARD_VERSION} `,
    'color: #111; background: #ffda95; font-weight: 700;',
    'color: #ffda95; background: #111;'
);
