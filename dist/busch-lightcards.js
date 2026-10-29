/* BEGIN BUSCH SHARED UI 0.3.2 sha256:03f8f2772ce4a11e5bc843226fea493d961f9119bc588f6187190e8bc5a663f2 */
/** Busch UI 0.3.2 — standalone Vanilla source. Synchronized verbatim, never imported at runtime. */
const BuschUI = (() => {
  const sourceVersion = '0.3.2';
  const cloneConfig = value => Array.isArray(value) ? value.map(cloneConfig)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,cloneConfig(item)])) : value;
  function configsEqual(a,b) {
    if (Object.is(a,b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a)!==Array.isArray(b)) return false;
    if (Array.isArray(a) && a.length!==b.length) return false;
    const keys=Object.keys(a);
    return keys.length===Object.keys(b).length && keys.every(key=>Object.hasOwn(b,key)&&configsEqual(a[key],b[key]));
  }
  const validKey = key => !['__proto__','prototype','constructor'].includes(String(key));
  function updateConfig(config,patch) {
    const next=cloneConfig(config||{});
    for (const [key,value] of Object.entries(patch||{})) {
      if (!validKey(key)) throw new Error('Invalid editor config key');
      if (value===undefined) delete next[key]; else next[key]=cloneConfig(value);
    }
    return next;
  }
  function updateConfigPath(config,path,value) {
    const parts=Array.isArray(path)?path:String(path).split('.');
    if (!parts.length || parts.some(key=>!String(key)||!validKey(key))) throw new Error('Invalid editor config path');
    const next=cloneConfig(config||{});let node=next;
    for (let i=0;i<parts.length-1;i++) {const key=parts[i];if (!Object.hasOwn(node,key)||!node[key]||typeof node[key]!=='object') node[key]=typeof parts[i+1]==='number'?[]:{};node=node[key];}
    const key=parts.at(-1);
    if (value===undefined) {if (Array.isArray(node)&&typeof key==='number') node.splice(key,1);else delete node[key];} else node[key]=cloneConfig(value);
    return next;
  }
  const deleteConfigPath=(config,path)=>updateConfigPath(config,path,undefined);
  const editorEchoStates=new WeakMap();
  function editorEchoState(editor) {let state=editorEchoStates.get(editor);if(!state){state=createEchoState();editorEchoStates.set(editor,state);}return state;}
  function emitConfigChanged(editor,config,{echo=true}={}) {
    if(echo)queueEcho(editorEchoState(editor),config);
    editor.dispatchEvent(new CustomEvent('config-changed',{detail:{config:cloneConfig(config)},bubbles:true,composed:true}));
  }
  function guardEditorKeys(root) {
    root.addEventListener?.('keydown',event=>event.stopPropagation());
    root.addEventListener?.('keyup',event=>event.stopPropagation());
  }
  class EditorBase extends (typeof HTMLElement==='undefined'?class{}:HTMLElement) {
    constructor() {super();guardEditorKeys(this);}
    _acceptConfig(config,normalize=cloneConfig,{echo=true}={}) {
      const result=validateConfig(config,{normalize});
      if(!result.ok)throw result.error;
      const next=result.value;
      if (echo?!acceptEcho(editorEchoState(this),next,this._config):configsEqual(next,this._config)) return false;
      this._config=next;return true;
    }
    _publishConfig(config,options) {
      const next=cloneConfig(config);this._config=next;emitConfigChanged(this,next,options);return next;
    }
  }
  // HA supplies no echo ID: match the earliest unacknowledged equal snapshot.
  const createEchoState=()=>({pending:[],received:new Set(),stale:[]});
  function queueEcho(state,config) {state.pending.push(cloneConfig(config));}
  function acceptEcho(state,next,current) {
    const pending=state.pending.findIndex(value=>!state.received.has(value)&&configsEqual(value,next));
    if (pending!==-1) {
      if (pending<state.pending.length-1) {state.received.add(state.pending[pending]);return false;}
      state.stale.push(...state.pending.slice(0,-1).filter(value=>!state.received.has(value)));
      state.pending=[];state.received.clear();
    } else {
      if (configsEqual(current,next)||state.pending.some(value=>state.received.has(value)&&configsEqual(value,next))) return false;
      const stale=state.stale.findIndex(value=>configsEqual(value,next));
      if (stale!==-1) {state.stale.splice(stale,1);return false;}
      state.pending=[];state.received.clear();state.stale=[];
    }
    return !configsEqual(current,next);
  }
  function resolveMedia(config={},metadata={},defaultIcon='mdi:devices') {
    const safe=value=>typeof value==='string'&&value.trim()&&!/^(?:javascript|vbscript|file):/i.test(value.trim())?value.trim():null;
    const available=[metadata.entity_picture,metadata.device_picture,metadata.picture].map(safe).filter(Boolean),custom=safe(config.image),mode=config.display_mode||'auto';
    const images=mode==='icon'?[]:[...new Set((mode==='image'?[custom,...available]:[...available,custom]).filter(Boolean))];
    return {image:images[0]||null,images,icon:config.icon||metadata.icon||defaultIcon};
  }
  function media(config,metadata,defaultIcon,className='card-icon') {
    const resolved=resolveMedia(config,metadata,defaultIcon),holder=document.createElement('span');
    holder.className='busch-media '+className;holder.setAttribute('aria-hidden','true');let index=0;
    const next=()=>{
      if (index>=resolved.images.length) {const icon=ha.icon(resolved.icon);holder.replaceChildren(icon);return;}
      const img=document.createElement('img');img.setAttribute('src',resolved.images[index++]);img.setAttribute('alt','');img.setAttribute('loading','lazy');
      img.addEventListener('error',next,{once:true});holder.replaceChildren(img);
    };
    next();return holder;
  }
  function statusSemantic(status) {
    return ({success:'success',running:'success',online:'success',connected:'success',on:'success',idle:'warning',warning:'warning',partial:'warning',starting:'warning',stopping:'warning',paused:'warning',blocked:'warning',suspended:'warning',error:'error',failed:'error',neutral:'neutral',stopped:'neutral',offline:'neutral',disconnected:'neutral',off:'neutral',unavailable:'unavailable',unknown:'unknown'})[status]||'unknown';
  }
  function statusBadge(status,text,classPrefix='status-') {
    const badge=document.createElement('span');badge.className='status-badge '+classPrefix+statusSemantic(status);badge.textContent=text;return badge;
  }
  function formatNumber(value,locale,options={maximumFractionDigits:1}) {
    return !['number','string'].includes(typeof value)||(typeof value==='string'&&!value.trim())||!Number.isFinite(Number(value))?null:new Intl.NumberFormat(locale||'en',options).format(Number(value));
  }
  function metric(label,value,ratio) {
    const node=document.createElement('div');node.className='metric';
    const caption=document.createElement('span');caption.className='metric-label';caption.textContent=label;
    const text=document.createElement('strong');text.className='metric-value';text.textContent=value;node.appendChild(caption);node.appendChild(text);
    if (ratio!==undefined&&Number.isFinite(ratio)) {const bar=document.createElement('progress');bar.max=100;bar.value=Math.min(100,Math.max(0,ratio*100));bar.setAttribute('aria-label',label);node.appendChild(bar);}return node;
  }
  let helperPromise=null;
  const ha = {
    form() {
      const form=document.createElement('ha-form');
      // HA lazy-loads ha-form. Retain its real selector contract and replay
      // properties after upgrade; a free-text replacement would lose selectors.
      if (typeof customElements!=='undefined' && customElements.get && !customElements.get('ha-form') && customElements.whenDefined) {
        customElements.whenDefined('ha-form').then(()=>{
          const props=['hass','schema','data','computeLabel','computeHelper','computeError','disabled'].filter(key=>Object.hasOwn(form,key)).map(key=>[key,form[key]]);
          for (const [key] of props) delete form[key];
          customElements.upgrade?.(form);
          for (const [key,value] of props) form[key]=value;
        });
      }
      return form;
    },
    input({native=false}={}) {return document.createElement(!native&&typeof customElements!=='undefined'&&customElements.get?.('ha-input')?'ha-input':'input');},
    icon(name) {const icon=document.createElement('ha-icon');icon.setAttribute('icon',name);return icon;},
    async cardHelpers({requireRow=false}={}) {
      if (!helperPromise) {
      if (typeof window==='undefined'||typeof window.loadCardHelpers!=='function') return null;
      helperPromise=Promise.resolve().then(()=>window.loadCardHelpers()).then(helpers=>helpers&&typeof helpers.createCardElement==='function'?helpers:null).catch(()=>null);
      }
      const helpers=await helperPromise;
      if(!helpers||(requireRow&&typeof helpers.createRowElement!=='function')){helperPromise=null;return null;}
      return helpers;
    },
  };
  const tokens=Object.freeze({space1:'var(--ha-space-1, 4px)',space2:'var(--ha-space-2, 8px)',space3:'var(--ha-space-3, 12px)',space4:'var(--ha-space-4, 16px)',mediaRadius:'var(--ha-card-border-radius, 12px)',controlMinHeight:'44px'});
  function language(hass,{legacy=false,browser=true}={}) {
    const code=hass?.locale?.language||(legacy&&hass?.language)||(browser&&typeof navigator!=='undefined'&&navigator.language)||'en';
    return String(code).toLowerCase().startsWith('de')?'de':'en';
  }
  const dictionary=(table,hass,options)=>table[language(hass,options)]||table.en;
  function fieldText(table,hass,name,options) {
    const words=dictionary(table,hass,options),fallback=table.en||{};
    return {label:words?.labels?.[name]??fallback.labels?.[name]??name,helper:words?.helpers?.[name]??fallback.helpers?.[name]??''};
  }
  function validateConfig(input,{parse=false,normalize=cloneConfig,validate}={}) {
    try {
      const copied=cloneConfig(parse?JSON.parse(input):input);
      const error=validate?.(copied);
      if(error) return {ok:false,error:error instanceof Error?error:new Error(String(error))};
      return {ok:true,value:cloneConfig(normalize(copied))};
    } catch(error) {return {ok:false,error};}
  }
  const addClass=(node,name)=>{if(!String(node.className||'').split(/\s+/).includes(name))node.className=((node.className||'')+' '+name).trim();};
  function header({node=document.createElement('div'),titleNode,label}={}) {
    addClass(node,'busch-ui-header');node.setAttribute('role','group');
    const name=label??titleNode?.textContent;if(name)node.setAttribute('aria-label',name);
    if(titleNode){if(!/^H[1-6]$/.test(titleNode.tagName||'')){titleNode.setAttribute('role','heading');titleNode.setAttribute('aria-level','2');}addClass(titleNode,'busch-ui-title');}
    return node;
  }
  const actionBindings=new WeakMap();
  function action({node=document.createElement('button'),label,text,icon,disabled,variant='secondary',onClick}={}) {
    if(!label)throw new Error('Action requires an accessible label');
    addClass(node,'busch-ui-action');node.type='button';node.setAttribute('aria-label',label);node.setAttribute('data-variant',variant);
    if(disabled!==undefined)node.disabled=disabled;
    let binding=actionBindings.get(node);
    if(!binding){
      binding={};actionBindings.set(node,binding);
      // Keep native keyboard activation and owning tablist arrow navigation.
      for(const type of ['keydown','keyup'])node.addEventListener(type,event=>{if(event.key==='Enter'||event.key===' ')event.stopPropagation();});
      node.addEventListener('click',event=>{event.stopPropagation();if(!node.disabled)binding.onClick?.(event);});
    }
    binding.onClick=onClick;
    if(text!==undefined){node.textContent=text;binding.icon=null;}
    if(icon){if(!binding.icon){binding.icon=ha.icon(icon);binding.icon.setAttribute('aria-hidden','true');node.appendChild(binding.icon);}else binding.icon.setAttribute('icon',icon);}
    if(icon||text===undefined){if(!node.title||node.title===binding.tooltip){node.title=label;binding.tooltip=label;}}
    return node;
  }

  function section({title,content,open=false}={}) {
    const node=document.createElement('details');
    addClass(node,'busch-ui-section');node.open=open;
    const summary=document.createElement('summary');summary.textContent=title;node.appendChild(summary);
    if(content)node.appendChild(content);return node;
  }
  // Scoped bases: family layout/grid/padding and domain presentation override
  // these fundamentals. No global selectors or services in shared primitives.
  const cardStyles=`
.busch-ui-header{min-width:0}.busch-ui-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
:where(.busch-ui-action){border:0;border-radius:var(--ha-card-border-radius,12px);padding:var(--ha-space-2,8px) var(--ha-space-3,12px);color:var(--primary-text-color,#212121);background:var(--secondary-background-color,#eeeeee);box-sizing:border-box;min-height:44px;min-width:44px;max-width:100%;font:inherit;cursor:pointer}
:where(.busch-ui-action):focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:2px}
:where(.busch-ui-action[data-variant=primary]){background:var(--primary-color,#03a9f4);color:var(--text-primary-color,#ffffff)}
:where(.busch-ui-action[data-variant=secondary]){background:var(--secondary-background-color,#eeeeee);color:var(--primary-text-color,#212121)}
:where(.busch-ui-action[data-variant=destructive]),:where(.busch-ui-action[data-variant=danger]){color:var(--error-color,#db4437)}
:where(.busch-ui-action[data-variant=quiet]),:where(.busch-ui-action[data-variant=icon-only]),:where(.busch-ui-action[data-variant=overflow]){background:transparent}
:where(.busch-ui-action):disabled{cursor:default;opacity:0.5}
`;
  const editorStyles=cardStyles+`
:host(.busch-ui-editor),.busch-ui-editor{display:block;min-width:0;color:var(--primary-text-color,#212121);font:inherit}
:host(.busch-ui-editor) ha-form,.busch-ui-editor ha-form{display:block;min-width:0}.busch-ui-section{min-width:0}
.busch-ui-section>summary{cursor:pointer;min-height:44px;box-sizing:border-box;overflow-wrap:anywhere;font-weight:var(--ha-font-weight-medium,500)}
.busch-ui-section>summary:focus-visible{outline:2px solid var(--primary-color,#03a9f4);outline-offset:2px}
.busch-ui-validation{color:var(--error-color,#db4437);overflow-wrap:anywhere;font-size:var(--ha-font-size-s,12px)}
`;
  return Object.freeze({sourceVersion,EditorBase,cloneConfig,configsEqual,updateConfig,updateConfigPath,deleteConfigPath,emitConfigChanged,guardEditorKeys,createEchoState,queueEcho,acceptEcho,resolveMedia,media,statusSemantic,statusBadge,metric,formatNumber,ha,tokens,language,dictionary,fieldText,validateConfig,header,action,section,cardStyles,editorStyles});
})();
/* END BUSCH SHARED UI */

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

const CARD_VERSION = '0.10.0';

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

const GRADIENT_OFFSET = 7; // percent of a multi-colour gradient held at each end

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
            show_description: 'Beschreibung zeigen',
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
            live_update: 'Live beim Ziehen',
            icon_size: 'Symbolgröße',
            theme: 'Thema der Karte',
            is_visible: 'Karte sichtbar',
            tap_action: 'Beim Tippen',
            hold_action: 'Beim Halten',
            api_id: 'API-Kennung',
            scenes: 'Szenenkacheln',
            scene_entity: 'Szene oder Skript',
            scene_title: 'Beschriftung',
            scene_icon: 'Symbol',
            scene_color: 'Kachelfarbe'
        },
        helpers: {
            entity: 'Die Hauptentität der Karte. Ist es eine Gruppe, steigt die Karte in jede verschachtelte Untergruppe ab und schaltet die echten Lampen dahinter; Doppelnennungen zählen einmal, Zyklen werden abgebrochen. Pflichtfeld.',
            entities: 'Wird zusätzlich zur Hauptentität aufgelöst, Gruppen genauso tief wie dort. Vorgabe: leer.',
            title: 'Ersetzt den Namen der Hauptentität auf der Karte und im Dialog; {{ light.x }} zeigt einen Zustand, {{ light.x.brightness }} ein Attribut. Vorgabe: der Name der Entität.',
            icon: 'Ein mdi-Symbol für die Karte. Vorgabe: das Symbol der Entität.',
            description: 'Ersetzt die Zeile unter der Überschrift; %s setzt die Zählung ein, {{ light.x }} einen Zustand, {{ light.x.attribut }} ein Attribut. Vorgabe: die Zählung.',
            show_description: 'Aus blendet die Zeile unter der Überschrift auf der Karte aus (description: false); der Dialog zeigt den Zustand weiter. Vorgabe an.',
            resolve_groups: 'An steigt die Karte in jede Untergruppe ab und schaltet die Lampen einzeln. Aus bleibt die Gruppe eine einzige Entität, wie bei der Vorlage. Vorgabe an.',
            max_depth: 'Wie viele Gruppenebenen die Karte höchstens absteigt, bevor sie abbricht. Vorgabe 10.',
            show_unavailable: 'Zeigt auf der Karte ein Abzeichen mit der Zahl der nicht erreichbaren Mitglieder. Vorgabe an.',
            group_display: 'Nach Gruppe geordnet gibt jeder aufgelösten Gruppe einen eigenen Block mit eigenem Schalter; eine flache Liste zeigt alle Lampen ohne Überschriften. Vorgabe: nach Gruppe geordnet.',
            off_color: 'Hintergrund der Karte, solange keine Lampe an ist. Leer heißt: das Thema entscheidet. Vorgabe leer.',
            default_color: 'Farbe für eine leuchtende Lampe, die selbst keine meldet. Nimmt #rrggbb, rgb(…) oder die Namen warm und cold. Vorgabe #ffda95.',
            hue_borders: 'Rundet die Karte stärker ab und legt den Schlagschatten der Hue-Vorlage darunter. Vorgabe an.',
            show_switch: 'Zeigt rechts oben einen Schalter für die ganze Gruppe. Vorgabe an.',
            slider: 'Standard ist der Hue-Regler mit Prozentangabe, Mushroom ein flacher Regler im Mushroom-Stil, Keiner blendet ihn aus. Vorgabe: Standard.',
            allow_zero: 'Erlaubt dem Regler den Wert 0, der die Gruppe ausschaltet; sonst ist bei 1 Prozent Schluss. Vorgabe aus.',
            off_shadow: 'Legt einen Innenschatten über die Karte, solange keine Lampe an ist. Vorgabe an.',
            live_update: 'An schalten die Lampen schon beim Ziehen mit, höchstens fünfmal je Sekunde und bei Gruppen einmal, immer erst nach der Bestätigung von Home Assistant; aus erst beim Loslassen. Vorgabe an.',
            icon_size: 'Größe des Kartensymbols: Original, Groß, Klein oder eine Zahl wie bei der Hue-Karte (1,42 ist Original, 2 ist Groß). Vorgabe: Original.',
            theme: 'Ein Home-Assistant-Thema nur für diese Karte und ihren Dialog. Leer heißt: das Thema des Dashboards. Vorgabe leer.',
            is_visible: 'Aus versteckt die Karte; über die API-Kennung lässt sich ihr Dialog trotzdem öffnen. Vorgabe an.',
            tap_action: 'Was ein kurzer Tipp auf die Karte auslöst. Vorgabe: Dialog öffnen.',
            hold_action: 'Was ein halbe Sekunde langes Halten auf der Karte auslöst. Vorgabe: Mehr Informationen.',
            api_id: 'Mit einer Kennung öffnet window.busch_light_card.<Kennung>_openHueScreen() oder ein Link auf #busch_light_card:<Kennung>_openHueScreen den Dialog; erlaubt sind Buchstaben, Ziffern, _ und -. Vorgabe leer.',
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
            loading: 'Lampen werden geladen',
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
            sliderDefault: 'Standard',
            sliderMushroom: 'Mushroom',
            sliderNone: 'Keiner',
            iconOriginal: 'Original',
            iconBig: 'Groß',
            iconSmall: 'Klein',
            vorlageFehlt: '‹{id} fehlt›',
            noForm: 'Die Formularelemente von Home Assistant sind nicht geladen. Bitte diese Karte in YAML einrichten.',
            fehlerSymbolgroesse: 'Unbekannte Symbolgröße „{wert}“. Erlaubt sind original, big, small oder eine Zahl.',
            fehlerRegler: 'Unbekannter Regler „{wert}“. Erlaubt sind default, mushroom und none.',
            fehlerApiId: 'Die API-Kennung „{wert}“ ist nicht erlaubt. Sie beginnt mit einem Buchstaben oder einer Ziffer und enthält nur Buchstaben, Ziffern, _ und - (höchstens 64 Zeichen).',
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
            show_description: 'Show description',
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
            live_update: 'Live while dragging',
            icon_size: 'Icon size',
            theme: 'Card theme',
            is_visible: 'Card visible',
            tap_action: 'On tap',
            hold_action: 'On hold',
            api_id: 'API id',
            scenes: 'Scene tiles',
            scene_entity: 'Scene or script',
            scene_title: 'Label',
            scene_icon: 'Icon',
            scene_color: 'Tile colour'
        },
        helpers: {
            entity: "The card's main entity. If it is a group, the card walks down into every nested sub-group and controls the real lights behind it; a light named twice counts once, and cycles are cut. Required.",
            entities: 'Resolved on top of the main entity, groups just as deep. Default: empty.',
            title: "Replaces the main entity's name on the card and in the dialog; {{ light.x }} shows a state, {{ light.x.brightness }} an attribute. Default: the entity's own name.",
            icon: "An mdi icon for the card. Default: the entity's own icon.",
            description: 'Replaces the line under the title; %s inserts the count, {{ light.x }} a state, {{ light.x.attribute }} an attribute. Default: the count.',
            show_description: 'Off hides the line under the title on the card (description: false); the dialog still shows the state. Default on.',
            resolve_groups: 'On, the card walks into every sub-group and controls the lights one by one. Off, the group stays a single entity, the way the original card does it. Default on.',
            max_depth: 'How many group levels the card descends at most before it stops. Default 10.',
            show_unavailable: 'Shows a badge on the card counting the members that cannot be reached. Default on.',
            group_display: 'Grouped by their group gives every resolved group its own block with its own switch; one flat list shows every light without headings. Default: grouped by their group.',
            off_color: "The card's background while no light is on. Empty uses the theme colour. Default empty.",
            default_color: 'Colour for a lit light that reports none of its own. Accepts #rrggbb, rgb(…) or the names warm and cold. Default #ffda95.',
            hue_borders: "Rounds the card more strongly and puts the Hue template's drop shadow under it. Default on.",
            show_switch: 'Shows a switch for the whole group in the top right. Default on.',
            slider: 'Default is the Hue slider with its percentage, Mushroom a flat slider in the Mushroom style, None hides it. Default: default.',
            allow_zero: 'Lets the slider reach 0, which turns the group off; otherwise it stops at 1 per cent. Default off.',
            off_shadow: 'Puts an inset shadow over the card while no light is on. Default on.',
            live_update: 'On, the lights follow while you drag, at most five times a second and once a second for groups, always after Home Assistant confirmed the last step; off, only on release. Default on.',
            icon_size: 'Size of the card icon: original, big, small or a number as in the Hue card (1.42 is original, 2 is big). Default: original.',
            theme: 'A Home Assistant theme for this card and its dialog only. Empty uses the dashboard theme. Default empty.',
            is_visible: 'Off hides the card; its dialog still opens through the API id. Default on.',
            tap_action: 'What a short tap on the card does. Default: open dialog.',
            hold_action: 'What holding the card for half a second does. Default: more info.',
            api_id: 'With an id, window.busch_light_card.<id>_openHueScreen() or a link to #busch_light_card:<id>_openHueScreen opens the dialog; letters, digits, _ and - only. Default empty.',
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
            loading: 'Loading lights',
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
            sliderDefault: 'Default',
            sliderMushroom: 'Mushroom',
            sliderNone: 'None',
            iconOriginal: 'Original',
            iconBig: 'Big',
            iconSmall: 'Small',
            vorlageFehlt: '‹{id} missing›',
            noForm: 'The Home Assistant form elements did not load. Please configure this card in YAML.',
            fehlerSymbolgroesse: 'Unknown icon size “{wert}”. Allowed are original, big, small or a number.',
            fehlerRegler: 'Unknown slider “{wert}”. Allowed are default, mushroom and none.',
            fehlerApiId: 'The API id “{wert}” is not allowed. It starts with a letter or digit and holds only letters, digits, _ and - (at most 64 characters).',
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
    const language=BuschUI.language(hass,{legacy:true});
    return TEXTE_BUSCH_LIGHT_CARD[language];
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
    return BuschUI.fieldText(TEXTE_BUSCH_LIGHT_CARD,hass,name,{legacy:true}).label;
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
    return BuschUI.fieldText(TEXTE_BUSCH_LIGHT_CARD,hass,name,{legacy:true}).helper;
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

function hueOf(color) {
    return rgb2hsv(color.r, color.g, color.b)[0];
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

/*
 * Readable surfaces (#712). Since 0.9.0 the whole card carries the light
 * colours, the way the Hue app and the Hue-like card do — so text sits on a
 * light colour of any brightness. WCAG 2.2 AA wants 4.5:1 for normal text.
 * For every surface the text is light or dark, whichever needs the smaller
 * nudge of the colour; a stop that still falls short is mixed towards black
 * (light text) or white (dark text) just far enough. The hue stays.
 */
const MIN_TEXT_CONTRAST = 4.5;
const TEXT_LIGHT = { r: 255, g: 255, b: 255, a: 1 };
const TEXT_DARK = { r: 17, g: 17, b: 17, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };
/** A lamp tile's dark part: rgba(0, 0, 0, 0.32) over its colour. */
const TILE_SHADE = 0.68;
/** Light text wins unless it needs this much more darkening than dark text. */
const LIGHT_TEXT_BIAS = 0.25;

function relativeLuminance(color) {
    const channel = (value) => {
        const v = clamp(value, 0, 255) / 255;
        return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastRatio(a, b) {
    const la = relativeLuminance(a);
    const lb = relativeLuminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mixColor(color, target, t) {
    return {
        r: Math.round(color.r + (target.r - color.r) * t),
        g: Math.round(color.g + (target.g - color.g) * t),
        b: Math.round(color.b + (target.b - color.b) * t),
        a: 1
    };
}

function shadeColor(color, factor) {
    return { r: color.r * factor, g: color.g * factor, b: color.b * factor, a: 1 };
}

/** Nudges one stop until `text` reads on it (and on its shaded part). */
function readableStop(color, text, toward, shade) {
    const reads = (c) => contrastRatio(text, c) >= MIN_TEXT_CONTRAST
        && (!shade || contrastRatio(text, shadeColor(c, shade)) >= MIN_TEXT_CONTRAST);
    const base = mixColor(color, color, 0);
    if (reads(base)) return { color: base, t: 0 };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (reads(mixColor(color, toward, mid))) hi = mid;
        else lo = mid;
    }
    let t = hi;
    let out = mixColor(color, toward, t);
    while (!reads(out) && t < 1) {
        t = Math.min(1, t + 1 / 256);
        out = mixColor(color, toward, t);
    }
    return { color: out, t };
}

/**
 * Text colour and, if needed, gently adjusted stops for a coloured surface.
 * options.shade: the surface also carries a darker part (lamp tiles).
 * options.adjust false: the colour is the user's (off_color), only pick text.
 */
function readableSurface(colors, options) {
    const opts = options || {};
    const list = (colors || []).filter(Boolean);
    if (!list.length) return null;
    const candidates = [
        { fg: 'light', text: TEXT_LIGHT, toward: BLACK },
        { fg: 'dark', text: TEXT_DARK, toward: WHITE }
    ].map((candidate) => {
        if (opts.adjust === false) {
            const stops = list.map((c) => mixColor(c, c, 0));
            const ratio = Math.min.apply(null, stops.map((c) => contrastRatio(candidate.text, c)));
            return Object.assign({}, candidate, { colors: stops, cost: -ratio });
        }
        const stops = list.map((c) => readableStop(c, candidate.text, candidate.toward, opts.shade));
        return Object.assign({}, candidate, {
            colors: stops.map((s) => s.color),
            cost: Math.max.apply(null, stops.map((s) => s.t))
        });
    });
    const light = candidates[0];
    const dark = candidates[1];
    const pick = opts.adjust === false
        ? (light.cost <= dark.cost ? light : dark)
        : (light.cost <= dark.cost + LIGHT_TEXT_BIAS ? light : dark);
    const ratio = Math.min.apply(null, pick.colors.map((c) => contrastRatio(pick.text, c)));
    return { fg: pick.fg, text: pick.text, css: colorToCss(pick.text), colors: pick.colors, ratio };
}

/** Same colour twice is one stop, not a gradient of one colour. */
function uniqueColors(colors) {
    const seen = new Set();
    return (colors || []).filter((c) => {
        const key = Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** A lit surface for a list of light colours: CSS background plus its text. */
function litSurface(colors, options) {
    const surface = readableSurface(uniqueColors(colors), options);
    if (!surface) return null;
    surface.background = backgroundCss(surface.colors);
    return surface;
}

/** Honours prefers-reduced-motion for the few transitions driven from script. */
function reducedMotion() {
    try {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
        return false;
    }
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
// Optimistic display: a tap shows its result before Home Assistant answers
// ---------------------------------------------------------------------------

/**
 * How long a switch or slider keeps showing the value just sent while Home
 * Assistant has not reported a matching state. Zigbee and Hue usually answer
 * well within a second; after this the real state wins again.
 */
const OPTIMISTIC_HOLD_MS = 4000;
/** entityId -> { on, pct?, rgb?, kelvin?, base, timer } — what was just asked for. */
const OPTIMISTIC = new Map();
/** Cards and dialogs that redraw when a preview starts or ends. */
const OPTIMISTIC_VIEWS = new Set();
/** Colour and brightness of each light's last 'on' state, to preview a switch-on. */
const LAST_ON = new Map();
const LAST_ON_KEYS = ['brightness', 'color_mode', 'color_temp_kelvin', 'rgb_color', 'xy_color', 'hs_color'];
const REAL_HASS = Symbol('busch-light-real-hass');

function notifyOptimistic(ids) {
    Array.from(OPTIMISTIC_VIEWS).forEach((view) => view._onOptimistic(ids));
}

function dropOptimistic(entityId, entry) {
    const current = OPTIMISTIC.get(entityId);
    if (!current || (entry && current !== entry)) return false;
    clearTimeout(current.timer);
    OPTIMISTIC.delete(entityId);
    return true;
}

/**
 * Ends every running preview at once, as if each hold had run out: the
 * views redraw from the real states. Not used by the card itself: test
 * harnesses call it between steps so one step's click cannot shine through
 * the next for OPTIMISTIC_HOLD_MS (see docs/render/render.py).
 */
function clearOptimistic() {
    const ids = Array.from(OPTIMISTIC.keys());
    ids.forEach((entityId) => dropOptimistic(entityId));
    if (ids.length) notifyOptimistic(ids);
    return ids.length;
}

function rememberOn(entityId, state) {
    if (!state || state.state !== 'on' || OPTIMISTIC.has(entityId)) return;
    const attributes = state.attributes || {};
    const kept = {};
    LAST_ON_KEYS.forEach((key) => {
        if (attributes[key] !== undefined) kept[key] = attributes[key];
    });
    LAST_ON.set(entityId, kept);
}

/** The end state a light/switch call asks for, or null when it cannot be predicted. */
function optimisticTarget(domain, service, data) {
    if (!LEAF_DOMAINS.has(domain) || !data) return null;
    if (service === 'turn_off') return { on: false };
    if (service !== 'turn_on') return null;
    const want = { on: true };
    if (typeof data.brightness_pct === 'number') want.pct = clamp(Math.round(data.brightness_pct), 1, 100);
    if (Array.isArray(data.rgb_color)) want.rgb = data.rgb_color.slice(0, 3);
    if (typeof data.color_temp_kelvin === 'number') want.kelvin = data.color_temp_kelvin;
    return want;
}

/**
 * Calls the service and previews its result at once, the way the Hue-like
 * card sets its local state before calling. The preview ends as soon as Home
 * Assistant reports a new, matching state, when the call fails, or after
 * OPTIMISTIC_HOLD_MS — whichever comes first.
 */
function optimisticCall(hass, domain, service, data) {
    const real = (hass && hass[REAL_HASS]) || hass;
    const want = optimisticTarget(domain, service, data);
    const started = [];
    if (want) {
        [].concat(data.entity_id || []).forEach((entityId) => {
            const base = real.states ? real.states[entityId] : undefined;
            if (!base || base.state === 'unavailable') return;
            dropOptimistic(entityId);
            const entry = Object.assign({ base }, want);
            entry.timer = setTimeout(() => {
                if (dropOptimistic(entityId, entry)) notifyOptimistic([entityId]);
            }, OPTIMISTIC_HOLD_MS);
            OPTIMISTIC.set(entityId, entry);
            started.push([entityId, entry]);
        });
    }
    const fail = () => {
        const gone = started.filter(([entityId, entry]) => dropOptimistic(entityId, entry)).map((s) => s[0]);
        if (gone.length) notifyOptimistic(gone);
    };
    if (started.length) notifyOptimistic(started.map((s) => s[0]));
    let result;
    try {
        result = real.callService(domain, service, data);
    } catch (e) {
        fail();
        throw e;
    }
    // Home Assistant shows its own error toast; the preview only has to stop.
    if (result && typeof result.then === 'function') result.then(null, fail);
    return result;
}

function optimisticReached(real, want) {
    if (!real || real.state === 'unavailable') return true;
    if (real === want.base) return false; // nothing new from Home Assistant yet
    if ((real.state === 'on') !== want.on) return false;
    const brightness = real.attributes ? real.attributes.brightness : undefined;
    if (want.on && want.pct !== undefined && typeof brightness === 'number') {
        return Math.abs(Math.round((brightness / 255) * 100) - want.pct) <= 2;
    }
    return true;
}

function optimisticState(entityId, real, want) {
    const attributes = Object.assign({}, real.attributes);
    if (want.on) {
        if (real.state !== 'on') Object.assign(attributes, LAST_ON.get(entityId) || {});
        if (want.pct !== undefined) attributes.brightness = Math.round((want.pct * 255) / 100);
        if (want.rgb) {
            attributes.rgb_color = want.rgb;
            attributes.color_mode = 'rgb';
        }
        if (want.kelvin !== undefined) {
            attributes.color_temp_kelvin = Math.round(want.kelvin);
            attributes.color_mode = 'color_temp';
        }
    }
    return Object.assign({}, real, { state: want.on ? 'on' : 'off', attributes });
}

/**
 * `hass` as the card should show it: the real states with every running
 * preview laid over them. Without previews it is `hass` itself.
 */
function optimisticView(hass) {
    if (!OPTIMISTIC.size || !hass || !hass.states) return hass;
    let states = null;
    Array.from(OPTIMISTIC.keys()).forEach((entityId) => {
        const want = OPTIMISTIC.get(entityId);
        const real = hass.states[entityId];
        if (optimisticReached(real, want)) {
            dropOptimistic(entityId, want);
            return;
        }
        if (!states) states = Object.assign({}, hass.states);
        states[entityId] = optimisticState(entityId, real, want);
    });
    if (!states) return hass;
    const view = Object.create(hass);
    view.states = states;
    view[REAL_HASS] = hass;
    return view;
}

/**
 * What a render depended on: the language and the state object of every
 * entity it read. Home Assistant replaces a state object whenever it changes,
 * so identity is enough to tell that nothing relevant moved.
 */
function watchSnapshot(hass, entityIds) {
    const states = (hass && hass.states) || {};
    return {
        language: BuschUI.language(hass, { legacy: true }),
        ids: entityIds,
        objects: entityIds.map((id) => states[id])
    };
}

function snapshotUnchanged(snapshot, hass) {
    if (!snapshot || !hass || !hass.states) return false;
    if (BuschUI.language(hass, { legacy: true }) !== snapshot.language) return false;
    const states = hass.states;
    for (let i = 0; i < snapshot.ids.length; i++) {
        if (states[snapshot.ids[i]] !== snapshot.objects[i]) return false;
    }
    return true;
}

function snapshotWatches(snapshot, entityIds) {
    return !snapshot || entityIds.some((id) => snapshot.ids.indexOf(id) !== -1);
}

// ---------------------------------------------------------------------------
// Live updates while dragging (#715)
// ---------------------------------------------------------------------------

/*
 * Behaviour taken over from the Hue-like card (Gh61/lovelace-hue-like-light-
 * card, LGPL-2.1, src/core/live-update-session.ts): the same pacing, rebuilt
 * here in plain JS, not copied. Per control:
 *
 *  - at most one call in flight; the next value goes out only after Home
 *    Assistant confirmed the previous one (or it failed, or 5 s passed) and at
 *    least the minimum interval after it was sent. Values in between are
 *    skipped, the newest wins;
 *  - the first value of a movement goes out after half the interval, so it is
 *    already closer to where the finger is heading;
 *  - releasing queues exactly the end value behind the call in flight, never
 *    overtaken by an older one;
 *  - the control keeps showing its own value until 1.5 s after the last
 *    confirmation, so a lagging state from Home Assistant cannot pull it back.
 *
 * Minimum interval: 200 ms for one light (5/s). 1000 ms (1/s) when one call
 * reaches several lights — this card resolves groups and sends to their
 * members — or a Hue room/zone (`is_hue_group`), which the Hue bridge itself
 * limits to about one command a second.
 */
const LIVE_LIGHT_INTERVAL_MS = 200;
const LIVE_GROUP_INTERVAL_MS = 1000;
/** Hue lights fade 400 ms on their own; a longer interval sends a transition. */
const LIVE_DEFAULT_TRANSITION_MS = 400;
const LIVE_CONFIRM_TIMEOUT_MS = 5000;
const LIVE_HOLD_MS = 1500;
/** LightEntityFeature.TRANSITION */
const FEATURE_TRANSITION = 32;

class LiveSession {
    /**
     * `enabled` false: update() does nothing and commit() applies at once.
     * `onRelease` runs when the held value is let go (show the real state
     * again). `interval` returns the minimum interval, read before every call.
     */
    constructor(enabled, onRelease, interval) {
        this.enabled = enabled !== false;
        this._onRelease = onRelease || (() => {});
        this._interval = interval || (() => LIVE_LIGHT_INTERVAL_MS);
        /** The value the control shows instead of the real state, or null. */
        this.pinned = null;
        /** The last value a live call actually sent, while held. */
        this.lastSent = null;
        this._pending = null;
        this._busy = false;
        this._lastApply = 0;
        this._run = 0;
        this._applyTimer = null;
        this._releaseTimer = null;
    }

    /** An intermediate value while dragging. `apply` returns the call's promise, or nothing when it sent nothing. */
    update(value, apply) {
        if (!this.enabled) return;
        this._pin(value);
        const first = this._idle();
        this._pending = { value, apply };
        if (first) this._schedule(this._interval() / 2);
        else this._try();
    }

    /** The end value. Always applied, after the call in flight. */
    commit(value, apply) {
        if (!this.enabled) {
            apply(value);
            return;
        }
        this._pin(value);
        this._pending = { value, apply };
        this._clearApply(); // a click needs no head start, only the interval
        this._try();
    }

    /** Drops what is queued and lets go of the held value. */
    stop() {
        const held = this.pinned !== null;
        this._clearApply();
        clearTimeout(this._releaseTimer);
        this._releaseTimer = null;
        this._run++;
        this._pending = null;
        this.pinned = null;
        this.lastSent = null;
        this._busy = false;
        this._lastApply = 0;
        if (held) this._onRelease();
    }

    _idle() {
        return !this._busy && !this._applyTimer && Date.now() - this._lastApply >= this._interval();
    }

    _try() {
        if (!this._pending || this._busy || this._applyTimer) return;
        const wait = this._lastApply + this._interval() - Date.now();
        if (wait > 0) {
            this._schedule(wait);
            return;
        }
        const job = this._pending;
        this._pending = null;
        this._lastApply = Date.now();
        this._busy = true;
        const run = this._run;
        this._confirmed(() => {
            const result = job.apply(job.value);
            if (result) this.lastSent = job.value;
            return result;
        }).then(() => {
            if (run !== this._run) return;
            this._busy = false;
            if (this.pinned !== null) this._restartRelease();
            this._try();
        });
    }

    _schedule(wait) {
        this._applyTimer = setTimeout(() => {
            this._applyTimer = null;
            this._try();
        }, wait);
    }

    /** Resolves on confirmation, failure or after LIVE_CONFIRM_TIMEOUT_MS; never rejects. */
    _confirmed(apply) {
        return new Promise((resolve) => {
            const timer = setTimeout(resolve, LIVE_CONFIRM_TIMEOUT_MS);
            const done = () => {
                clearTimeout(timer);
                resolve();
            };
            try {
                // A failure counts as done: Home Assistant shows its own toast.
                Promise.resolve(apply()).then(done, done);
            } catch (e) {
                done();
            }
        });
    }

    _pin(value) {
        this.pinned = value;
        this._restartRelease();
    }

    _restartRelease() {
        clearTimeout(this._releaseTimer);
        this._releaseTimer = setTimeout(() => {
            this._releaseTimer = null;
            if (this._busy || this._pending) return; // the confirmation restarts it
            this.pinned = null;
            this.lastSent = null;
            this._onRelease();
        }, LIVE_HOLD_MS);
    }

    _clearApply() {
        clearTimeout(this._applyTimer);
        this._applyTimer = null;
    }
}

/** Minimum live interval for one call to these entities (see LiveSession). */
function liveIntervalFor(hass, entityIds) {
    const ids = [].concat(entityIds || []);
    if (ids.length > 1) return LIVE_GROUP_INTERVAL_MS;
    const state = ids.length && hass && hass.states ? hass.states[ids[0]] : null;
    const attributes = (state && state.attributes) || {};
    if (attributes.is_hue_group === true) return LIVE_GROUP_INTERVAL_MS;
    if (MEMBER_ATTRIBUTES.some((key) => Array.isArray(attributes[key]) && attributes[key].length)) {
        return LIVE_GROUP_INTERVAL_MS;
    }
    return LIVE_LIGHT_INTERVAL_MS;
}

/**
 * Service data for a live step: an interval longer than a light's own fade is
 * sent as `transition`, so the light glides until the next value arrives. Only
 * when every target supports transitions, like the Hue card does per light.
 */
function liveTransition(hass, entityIds) {
    const ids = [].concat(entityIds || []);
    const interval = liveIntervalFor(hass, ids);
    if (!ids.length || interval <= LIVE_DEFAULT_TRANSITION_MS) return {};
    const states = (hass && hass.states) || {};
    const all = ids.every((id) => {
        const features = states[id] && states[id].attributes ? states[id].attributes.supported_features : 0;
        return (Number(features) & FEATURE_TRANSITION) !== 0;
    });
    return all ? { transition: interval / 1000 } : {};
}

// ---------------------------------------------------------------------------
// Text templates in title and description (#715)
// ---------------------------------------------------------------------------

/*
 * Syntax of the Hue-like card (README "Text template", hass-text-template.ts):
 * `{{ light.x }}` is the formatted state, `{{ light.x.brightness }}` an
 * attribute — the part after the last dot, when there are two dots. Parsed
 * with indexOf, resolved by own-property lookups only, and shown through
 * textContent: no HTML, no evaluation, no prototype lookups.
 */
const TEMPLATE_ENTITY = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/;
const TEMPLATE_ATTRIBUTE = /^[A-Za-z0-9_]+$/;
const hasOwn = (object, key) => !!object && Object.prototype.hasOwnProperty.call(object, key);

function parseTemplate(text) {
    const source = String(text);
    const parts = [];
    let index = 0;
    while (index < source.length) {
        const open = source.indexOf('{{', index);
        if (open < 0) break;
        const close = source.indexOf('}}', open + 2);
        if (close < 0) break; // unclosed: the rest stays text, as upstream
        if (open > index) parts.push({ text: source.slice(index, open) });
        const inner = source.slice(open + 2, close).trim();
        const first = inner.indexOf('.');
        const last = inner.lastIndexOf('.');
        parts.push(first !== last
            ? { entity: inner.slice(0, last), attribute: inner.slice(last + 1) }
            : { entity: inner, attribute: null });
        index = close + 2;
    }
    if (index < source.length) parts.push({ text: source.slice(index) });
    return parts;
}

/** Entity ids a parsed template reads — the card watches exactly these. */
function templateIds(parts) {
    return (parts || []).filter((part) => part.entity && TEMPLATE_ENTITY.test(part.entity)).map((part) => part.entity);
}

function plainValue(value) {
    if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
    if (value && typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function resolveTemplate(hass, parts) {
    const states = hass && hass.states;
    return (parts || []).map((part) => {
        if (part.text !== undefined) return part.text;
        const valid = TEMPLATE_ENTITY.test(part.entity)
            && (part.attribute === null || TEMPLATE_ATTRIBUTE.test(part.attribute));
        const state = valid && hasOwn(states, part.entity) ? states[part.entity] : null;
        if (!state) return translate(hass, 'vorlageFehlt', { id: part.entity });
        const attributes = state.attributes || {};
        if (part.attribute && hasOwn(attributes, part.attribute)
            && attributes[part.attribute] !== null && attributes[part.attribute] !== undefined
            && attributes[part.attribute] !== '') {
            if (typeof hass.formatEntityAttributeValue === 'function') {
                try {
                    return String(hass.formatEntityAttributeValue(state, part.attribute));
                } catch (e) {
                    /* fall back to the raw value */
                }
            }
            return plainValue(attributes[part.attribute]);
        }
        // An unknown attribute falls back to the state, as upstream.
        if (typeof hass.formatEntityState === 'function') {
            try {
                return String(hass.formatEntityState(state));
            } catch (e) {
                /* fall back to the raw state */
            }
        }
        return String(state.state);
    }).join('');
}

// ---------------------------------------------------------------------------
// Icon size, slider type (#715)
// ---------------------------------------------------------------------------

/**
 * `icon_size` as in the Hue-like card: original, big, small or a factor. The
 * factors are Hue's own (original 1.42, big 2, small 1); "original" stays the
 * 24 px this card always drew, the others scale from there.
 */
const ICON_BASE_PX = 24;
const ICON_SIZES = { original: 1.41666667, big: 2, small: 1 };

function iconSizePx(value) {
    if (value === undefined || value === null || value === '') return ICON_BASE_PX;
    let factor = typeof value === 'number' ? value : NaN;
    if (typeof value === 'string') {
        const key = value.trim().toLowerCase();
        if (hasOwn(ICON_SIZES, key)) factor = ICON_SIZES[key];
        else if (/^\d+(\.\d+)?$/.test(key)) factor = Number(key);
    }
    if (!Number.isFinite(factor) || factor <= 0) {
        throw new ConfigError('fehlerSymbolgroesse', { wert: String(value) });
    }
    return Math.round((ICON_BASE_PX * clamp(factor, 0.5, 4)) / ICON_SIZES.original);
}

/** `slider`: default, mushroom or none; the old booleans stay valid. */
function sliderType(value) {
    if (value === undefined || value === null || value === true || value === 'default') return 'default';
    if (value === false || value === 'none') return 'none';
    if (value === 'mushroom') return 'mushroom';
    throw new ConfigError('fehlerRegler', { wert: String(value) });
}

// ---------------------------------------------------------------------------
// Theme per card (#715)
// ---------------------------------------------------------------------------

const THEME_KEY = /^[A-Za-z0-9_-]+$/;

/** CSS variables of a Home Assistant theme, light or dark mode merged in. */
function themeVars(themes, name) {
    const out = {};
    if (!name || !themes || !hasOwn(themes.themes, name)) return out;
    const take = (source) => {
        if (!source || typeof source !== 'object') return;
        Object.keys(source).forEach((key) => {
            const value = source[key];
            if (key === 'modes' || !THEME_KEY.test(key)) return;
            if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
        });
    };
    const theme = themes.themes[name];
    take(theme);
    if (theme && theme.modes && typeof theme.modes === 'object') {
        take(theme.modes[themes.darkMode ? 'dark' : 'light']);
    }
    return out;
}

/** Sets `vars` on `element` and removes what an earlier theme set. Returns the keys now set. */
function applyThemeVars(element, vars, applied) {
    (applied || []).forEach((key) => {
        if (!hasOwn(vars, key)) element.style.removeProperty('--' + key);
    });
    Object.keys(vars).forEach((key) => element.style.setProperty('--' + key, vars[key]));
    return Object.keys(vars);
}

// ---------------------------------------------------------------------------
// JS and URL API: open a card's dialog from elsewhere (#715)
// ---------------------------------------------------------------------------

/*
 * As in the Hue-like card (src/core/api-provider.ts): a card with `api_id`
 * publishes `window.busch_light_card.<api_id>_openHueScreen()` (alias
 * `_openDialog`), and a link ending in `#busch_light_card:<api_id>_openHueScreen`
 * opens it. Its own name, so it never collides with `window.hue_card` of the
 * Hue card installed next to it. Parsed by one anchored pattern and looked up
 * in a Map and a prototype-free object: no eval, no inherited names.
 */
const API_NAME = 'busch_light_card';
const API_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const API_HASH = /^#busch_light_card:([A-Za-z0-9][A-Za-z0-9_-]{0,63}?)_(openHueScreen|openDialog)$/;
const API_METHODS = ['openHueScreen', 'openDialog'];
const API_CARDS = new Map();
let apiLastHash = '';

function currentHash() {
    try {
        return typeof location !== 'undefined' && location ? String(location.hash || '') : '';
    } catch (e) {
        return '';
    }
}

function onApiLocation() {
    const hash = currentHash();
    if (hash === apiLastHash) return;
    apiLastHash = hash;
    const match = API_HASH.exec(hash);
    if (!match) return;
    const card = API_CARDS.get(match[1]);
    if (!card) {
        apiLastHash = ''; // a card registering later tries again
        return;
    }
    // Asynchronously, like upstream: the dashboard may still be rendering.
    setTimeout(() => card._openDialog(), 10);
    try {
        history.replaceState(history.state, '', location.pathname + location.search);
    } catch (e) {
        /* no history API here; the hash simply stays */
    }
}

function apiObject() {
    if (!window[API_NAME]) {
        const api = Object.create(null);
        Object.defineProperty(api, 'version', { value: CARD_VERSION, enumerable: true });
        window[API_NAME] = api;
        ['hashchange', 'popstate', 'location-changed'].forEach((type) => window.addEventListener(type, onApiLocation));
    }
    return window[API_NAME];
}

function registerApi(apiId, card) {
    const current = API_CARDS.get(apiId);
    if (current && current !== card && current.isConnected) return false; // first one wins, e.g. over an editor preview
    API_CARDS.set(apiId, card);
    const api = apiObject();
    API_METHODS.forEach((method) => {
        api[apiId + '_' + method] = () => card._openDialog();
    });
    setTimeout(onApiLocation, 10);
    return true;
}

function unregisterApi(apiId, card) {
    if (API_CARDS.get(apiId) !== card) return;
    API_CARDS.delete(apiId);
    const api = window[API_NAME];
    if (api) API_METHODS.forEach((method) => delete api[apiId + '_' + method]);
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
        rememberOn(entityId, this.state);
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

    /** Every entity this model read: roots, expanded groups and leaves. */
    watchIds() {
        const ids = new Set(this.opts.entityIds);
        (this.opts.templateIds || []).forEach((id) => ids.add(id));
        this.resolution.groups.forEach((id) => ids.add(id));
        this.resolution.leaves.forEach((id) => ids.add(id));
        return Array.from(ids);
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
        if (this.opts.titleParts) return resolveTemplate(this.hass, this.opts.titleParts);
        if (this.opts.title) return this.opts.title;
        const rootId = this.opts.entityIds[0];
        const rootState = this.hass && this.hass.states ? this.hass.states[rootId] : null;
        if (rootState && rootState.attributes && rootState.attributes.friendly_name) {
            return rootState.attributes.friendly_name;
        }
        return rootId || CARD_TAG;
    }

    /**
     * The line under the title. A configured one may use templates and `%s`
     * for the default line (#715); `description: false` hides it on the card.
     */
    get description() {
        if (this.opts.description === false) return '';
        if (this.opts.descriptionParts) {
            const fallback = this.defaultDescription;
            return resolveTemplate(this.hass, this.opts.descriptionParts.map((part) => (
                part.text !== undefined ? { text: part.text.split('%s').join(fallback) } : part)));
        }
        return this.defaultDescription;
    }

    /** The counting line: how many of the reachable lights are on. */
    get defaultDescription() {
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

    /** Returns the calls' promise, so a live session can wait for Home Assistant. */
    _callByDomain(service, lights, data) {
        if (!this.hass || !lights.length) return undefined;
        const byDomain = {};
        lights.forEach((l) => {
            (byDomain[l.domain] = byDomain[l.domain] || []).push(l.entityId);
        });
        const all = Promise.all(Object.keys(byDomain).map((domain) => {
            const payload = Object.assign({ entity_id: byDomain[domain] }, domain === 'light' ? data || {} : {});
            return optimisticCall(this.hass, domain, service, payload);
        }));
        // Most callers do not wait; Home Assistant shows a failure itself.
        all.catch(() => {});
        return all;
    }

    /** The lights a brightness, colour or white change goes to. */
    targets(kind) {
        if (kind === 'color') return this.alive.filter((l) => l.supportsColor);
        if (kind === 'temp') return this.alive.filter((l) => l.supportsTemp);
        const dimmable = this.alive.filter((l) => l.supportsBrightness);
        const lit = dimmable.filter((l) => l.isOn);
        return lit.length ? lit : dimmable;
    }

    /** Minimum live interval for a change of `kind` (see LiveSession). */
    liveInterval(kind) {
        return liveIntervalFor(this.hass, this.targets(kind).map((l) => l.entityId));
    }

    _liveData(data, lights, opts) {
        return opts && opts.live
            ? Object.assign(data, liveTransition(this.hass, lights.map((l) => l.entityId)))
            : data;
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
    setBrightness(pct, opts) {
        const value = clamp(Math.round(pct), 0, 100);
        const dimmable = this.alive.filter((l) => l.supportsBrightness);
        if (!dimmable.length) return undefined;

        if (value <= 0) return this._callByDomain('turn_off', this.alive);
        const targets = this.targets('brightness');
        return this._callByDomain('turn_on', targets, this._liveData({ brightness_pct: value }, targets, opts));
    }

    setRgb(rgb, opts) {
        const targets = this.targets('color');
        return this._callByDomain('turn_on', targets, this._liveData({ rgb_color: rgb }, targets, opts));
    }

    setKelvin(kelvin, opts) {
        const targets = this.targets('temp');
        return this._callByDomain('turn_on', targets,
            this._liveData({ color_temp_kelvin: Math.round(kelvin) }, targets, opts));
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
    const title = pick(raw, 'title', null);
    opts.title = typeof title === 'string' && title ? title : null;
    opts.titleParts = opts.title && opts.title.indexOf('{{') !== -1 ? parseTemplate(opts.title) : null;
    opts.icon = pick(raw, 'icon', null);
    const description = pick(raw, 'description', null);
    opts.description = description === false ? false : typeof description === 'string' && description ? description : null;
    opts.descriptionParts = typeof opts.description === 'string' ? parseTemplate(opts.description) : null;
    opts.templateIds = Array.from(new Set(templateIds(opts.titleParts).concat(templateIds(opts.descriptionParts))));

    opts.resolveGroups = pick(raw, 'resolveGroups', true) !== false;
    opts.maxDepth = Number(pick(raw, 'maxDepth', DEFAULT_MAX_DEPTH)) || DEFAULT_MAX_DEPTH;
    opts.showUnavailable = pick(raw, 'showUnavailable', true) !== false;
    opts.groupDisplay = pick(raw, 'groupDisplay', 'sections') === 'flat' ? 'flat' : 'sections';

    opts.offColor = pick(raw, 'offColor', null);
    opts.defaultColor = pick(raw, 'defaultColor', WARM_COLOR);
    opts.hueBorders = pick(raw, 'hueBorders', true) !== false;
    opts.showSwitch = pick(raw, 'showSwitch', true) !== false;
    opts.slider = sliderType(pick(raw, 'slider', true));
    opts.allowZero = pick(raw, 'allowZero', false) === true;
    opts.offShadow = pick(raw, 'offShadow', true) !== false;
    opts.liveUpdate = pick(raw, 'liveUpdate', true) !== false;
    opts.iconPx = iconSizePx(pick(raw, 'iconSize', null));
    const theme = pick(raw, 'theme', null);
    opts.theme = typeof theme === 'string' && theme && theme !== 'default' ? theme : null;
    const apiId = pick(raw, 'apiId', null);
    if (apiId !== null && apiId !== undefined && apiId !== '') {
        if (typeof apiId !== 'string' || !API_ID.test(apiId)) throw new ConfigError('fehlerApiId', { wert: String(apiId) });
    }
    opts.apiId = typeof apiId === 'string' && apiId ? apiId : null;
    opts.isVisible = pick(raw, 'isVisible', true) !== false;

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
    slider: 'default',
    allow_zero: false,
    live_update: true,
    is_visible: true,
    icon_size: 'original',
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
    'tapAction', 'holdAction', 'liveUpdate', 'iconSize', 'apiId', 'isVisible'
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
 *
 * `options.axis` ('x' or 'y') marks a one-dimensional slider. A finger then
 * has to move 5 px along that axis before the slider takes over — the Hue
 * card's dead zone — and a move across it is left to the browser, which
 * scrolls (the CSS gives these sliders `touch-action: pan-y`). A tap without
 * movement sets the value where the finger lifted. Mouse and pen-less
 * pointers act at once, as before.
 */
function onDrag(element, handler, options) {
    const axis = options && options.axis;
    const deadZone = 5;
    let active = false;
    let pending = false;
    let pointerId = null;
    let start = null;
    let last = null;

    const point = (event) => {
        const rect = element.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
            width: rect.width,
            height: rect.height
        };
    };
    const capture = () => {
        active = true;
        try {
            element.setPointerCapture(pointerId);
        } catch (e) {
            /* no live pointer to capture — carry on without it */
        }
    };
    const reset = () => {
        active = false;
        pending = false;
        pointerId = null;
    };

    element.addEventListener('pointerdown', (event) => {
        if (element.hasAttribute('disabled') || active || pending) return;
        pointerId = event.pointerId;
        last = point(event);
        if (axis && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
            pending = true;
            start = { x: event.clientX, y: event.clientY };
            return;
        }
        capture();
        event.preventDefault();
        handler(last, false);
    });

    element.addEventListener('pointermove', (event) => {
        if (event.pointerId !== pointerId) return;
        if (pending) {
            const dx = Math.abs(event.clientX - start.x);
            const dy = Math.abs(event.clientY - start.y);
            const along = axis === 'y' ? dy : dx;
            const across = axis === 'y' ? dx : dy;
            if (across > deadZone && across >= along) {
                reset(); // the browser scrolls; this is not a slider gesture
                return;
            }
            if (along <= deadZone) return;
            pending = false;
            capture();
        }
        if (!active) return;
        event.preventDefault();
        last = point(event);
        handler(last, false);
    });

    element.addEventListener('pointerup', (event) => {
        if (event.pointerId !== pointerId) return;
        const wasActive = active;
        const wasPending = pending;
        if (wasActive) {
            try {
                element.releasePointerCapture(pointerId);
            } catch (e) {
                /* capture may already be gone */
            }
        }
        reset();
        if (wasActive || wasPending) handler(point(event), true);
    });

    // A cancelled pointer carries no reliable position: an unfinished drag
    // ends where it was last seen, a not yet started one not at all.
    element.addEventListener('pointercancel', (event) => {
        if (event.pointerId !== pointerId) return;
        const wasActive = active;
        reset();
        if (wasActive && last) handler(last, true);
    });
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

// Embedded Busch HA UI 0.1.0 primitives: Shell, Header, Media,
// Status Badge and Action Bar. This shipped file has no runtime dependency.
const CARD_STYLES = BuschUI.cardStyles + `
:host {
    display: block;
    container-type: inline-size;

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
    --blc-accent: var(--primary-color);
    /* Overlays on a coloured card (#712), set by .fg-light / .fg-dark. */
    --blc-chip: initial;
    --blc-slider-rest: initial;
    --blc-slider-line: initial;
    --blc-mushroom-fill: initial;
    --blc-rest: 1;
    /* icon_size (#715): set per card from the config; the tile grows with it. */
    --blc-icon-size: 24px;
    --blc-media: max(44px, calc(var(--blc-icon-size) + 12px));
}
ha-card {
    position: relative;
    display: block;
    overflow: hidden;
    isolation: isolate;
    background: var(--blc-background, var(--card-background-color));
    background-origin: border-box;
    color: var(--blc-text-color, var(--primary-text-color));
    box-shadow: var(--blc-shadow, none), var(--ha-card-box-shadow, var(--ha-default-shadow, none));
    --blc-margin: ${BuschUI.tokens.space4};
}
ha-card.hue-borders {
    border-radius: var(--ha-card-border-radius, 12px);
}
/* The background a change replaces, faded out over the new one: CSS cannot
   interpolate gradients, but it can fade a layer (opacity only). */
.ghost {
    position: absolute;
    inset: 0;
    z-index: 0;
    opacity: 0;
    pointer-events: none;
}
.main, .slider {
    position: relative;
    z-index: 1;
}
ha-card.fg-light {
    --blc-chip: rgba(0, 0, 0, 0.24);
    --blc-slider-rest: rgba(0, 0, 0, 0.28);
    --blc-slider-line: rgba(255, 255, 255, 0.4);
    --blc-mushroom-fill: rgba(255, 255, 255, 0.85);
}
ha-card.fg-dark {
    --blc-chip: rgba(255, 255, 255, 0.45);
    --blc-slider-rest: rgba(255, 255, 255, 0.5);
    --blc-slider-line: rgba(0, 0, 0, 0.28);
    --blc-mushroom-fill: rgba(0, 0, 0, 0.42);
}
.main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 44px;
    grid-template-areas: 'identity action' 'status action';
    align-items: center;
    padding: var(--blc-margin);
    column-gap: var(--ha-space-2, 8px);
    row-gap: var(--ha-space-1, 4px);
}
.tap {
    grid-area: identity;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--ha-space-3, 12px);
    min-height: 44px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.tap:focus-visible, .desc:focus-visible, .toggle:focus-visible, .slider:focus-visible {
    outline: 2px solid var(--primary-color);
    outline-offset: 2px;
}
.lit .tap:focus-visible, .lit .desc:focus-visible, .lit .toggle:focus-visible, .lit .slider:focus-visible,
.tinted .tap:focus-visible, .tinted .desc:focus-visible, .tinted .toggle:focus-visible {
    outline-color: var(--blc-text-color, var(--primary-color));
}
.media {
    flex: 0 0 var(--blc-media);
    width: var(--blc-media);
    height: var(--blc-media);
    box-sizing: border-box;
    position: relative;
    display: grid;
    place-items: center;
    overflow: hidden;
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--blc-background, var(--card-background-color));
}
.media::after {
    content: '';
    position: absolute;
    inset: auto 0 0;
    height: 4px;
    background: var(--blc-accent);
    transition: opacity 0.3s ease-out;
}
/* On a coloured card the whole card is the accent: the tile turns into a
   translucent chip and the accent strip steps back. */
.lit .media, .tinted .media { background: var(--blc-chip); }
.lit .media::after { opacity: 0; }
.icon {
    color: var(--blc-text-color, var(--primary-text-color));
    --mdc-icon-size: var(--blc-icon-size);
}
.text {
    min-width: 0;
    line-height: normal;
    color: var(--blc-text-color, var(--primary-text-color));
}
.text h2 {
    font-size: var(--ha-font-size-m, 16px);
    font-weight: var(--ha-font-weight-semibold, 600);
    margin: 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.desc {
    grid-area: status;
    margin-left: calc(var(--blc-media) + var(--ha-space-3, 12px));
    font-size: var(--ha-font-size-s, 14px);
    display: flex;
    align-items: center;
    gap: var(--ha-space-2, 8px);
    min-width: 0;
    color: var(--blc-text-color, var(--secondary-text-color));
}
.desc::before {
    content: '';
    flex: 0 0 7px;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--secondary-text-color);
}
.desc[data-tone='success']::before { background: var(--success-color, var(--primary-color)); }
.desc[data-tone='warning']::before { background: var(--warning-color, var(--primary-color)); }
.desc[data-tone='error']::before { background: var(--error-color, var(--primary-color)); }
.desc[data-tone='unavailable']::before { background: var(--error-color, var(--secondary-text-color)); }
.desc[data-tone='unknown']::before { background: var(--secondary-text-color); }
.desc[data-tone='neutral']::before { background: var(--secondary-text-color); }
.desc[data-tone='success'] .dtext { color: var(--success-color, var(--primary-text-color)); }
.desc[data-tone='warning'] .dtext { color: var(--warning-color, var(--primary-text-color)); }
.desc[data-tone='unavailable'] .dtext { color: var(--error-color, var(--primary-text-color)); }
.desc[data-tone='error'] .dtext { color: var(--error-color, var(--primary-text-color)); }
.desc[data-tone='neutral'] .dtext { color: var(--blc-text-color, var(--secondary-text-color)); }
.desc[data-tone='unknown'] .dtext { color: var(--secondary-text-color); }
.desc[data-tone='unavailable'] .warn { display: none; }
/* On a light colour the theme's status colours lose their contrast. The text
   says the state, so it takes the card's own text colour there. */
.lit .desc .dtext, .tinted .desc .dtext { color: var(--blc-text-color, var(--primary-text-color)); }
.lit .desc::before, .tinted .desc::before { background: currentColor; }
.lit .warn, .tinted .warn { background: var(--blc-chip); color: var(--blc-text-color, var(--primary-text-color)); }
.desc .dtext {
    flex: 1 1 0;
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
    background: var(--secondary-background-color, var(--card-background-color));
    color: var(--warning-color, var(--primary-text-color));
    /* The count stays visible while the neighboring long description yields. */
    flex-shrink: 0;
    min-width: 0;
    overflow: hidden;
}
.warn span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.warn ha-icon {
    --mdc-icon-size: 13px;
    flex-shrink: 0;
}
.toggle {
    grid-area: action;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 22px;
    border: none;
    padding: 0;
    position: relative;
    cursor: pointer;
    background: transparent;
}
.toggle::before {
    content: '';
    position: absolute;
    left: 1px;
    top: 10px;
    width: 42px;
    height: 24px;
    border-radius: 12px;
    background: var(--blc-toggle-off, var(--divider-color));
    transition: background 0.2s ease-out;
}
.toggle[disabled] {
    opacity: 0.4;
    cursor: default;
}
.toggle .knob {
    position: absolute;
    top: 12px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--blc-knob-color, var(--card-background-color));
    box-shadow: var(--ha-card-box-shadow, none);
    transition: transform 0.2s ease-out;
}
.toggle.on::before {
    background: var(--blc-toggle-on, var(--primary-color));
}
.toggle.on .knob {
    transform: translateX(18px);
}
/* Light on colour: a darker track with a white knob reads on any light. */
.lit .toggle.on::before { background: var(--blc-toggle-on, rgba(0, 0, 0, 0.35)); }
.lit.fg-dark .toggle.on::before { background: var(--blc-toggle-on, rgba(0, 0, 0, 0.62)); }
.lit .toggle .knob { background: var(--blc-knob-color, rgb(255, 255, 255)); }
.slider {
    position: relative;
    height: 44px;
    margin: 0 var(--blc-margin) var(--blc-margin);
    border-radius: var(--ha-card-border-radius, 12px);
    background: var(--secondary-background-color, var(--divider-color));
    overflow: hidden;
    cursor: pointer;
    /* Vertical swipes stay the page's: no scroll theft on a phone (#715). */
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
}
.slider[disabled] {
    cursor: default;
}
/* Hue's default transition: 0.3 s ease-out, transform only. Off while the
   finger is down, so the bar sits exactly under it. */
.slider .fill {
    position: absolute;
    inset: 0;
    background: var(--primary-color);
    opacity: 0.35;
    transform-origin: left center;
    transform: scaleX(0);
    transition: transform 0.3s ease-out;
}
.slider.dragging .fill, .slider.dragging::before, .slider.dragging .mfill {
    transition: none;
}
/* slider: mushroom (#715) — a flat 28 px track in the Mushroom style inside
   the same 44 px touch target. The active part moves by translateX only. */
.slider .track { display: none; }
.slider.mushroom, .lit .slider.mushroom {
    background: transparent;
    box-shadow: none;
}
.slider.mushroom::before, .lit .slider.mushroom::before,
.slider.mushroom .fill, .slider.mushroom .label { display: none; }
.slider.mushroom .track {
    display: block;
    position: absolute;
    left: 0;
    right: 0;
    top: 8px;
    bottom: 8px;
    border-radius: 12px;
    overflow: hidden;
    background: var(--secondary-background-color, var(--divider-color));
}
.lit .slider.mushroom .track, .tinted .slider.mushroom .track {
    background: var(--blc-slider-rest, rgba(0, 0, 0, 0.28));
}
.slider.mushroom .mfill {
    position: absolute;
    inset: 0;
    background: var(--primary-color);
    transform: translateX(-100%);
    transition: transform 0.3s ease-out;
}
.lit .slider.mushroom .mfill, .tinted .slider.mushroom .mfill {
    background: var(--blc-mushroom-fill, var(--primary-color));
}
.slider.mushroom .mfill::after {
    content: '';
    position: absolute;
    top: 7px;
    bottom: 7px;
    right: 6px;
    width: 3px;
    border-radius: 2px;
    background: var(--card-background-color);
    opacity: 0.85;
}
.lit .slider.mushroom .mfill::after { background: var(--blc-background, var(--card-background-color)); }
/* Lit: the filled part is the card's own colour, the rest a darker (light
   text) or lighter (dark text) veil — the label keeps its contrast on both. */
.lit .slider {
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--blc-slider-line, transparent);
}
.lit .slider::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--blc-slider-rest, transparent);
    transform-origin: right center;
    transform: scaleX(var(--blc-rest, 1));
    transition: transform 0.3s ease-out;
}
.lit .slider .fill { opacity: 0; }
.lit .slider .label { color: var(--blc-text-color, var(--primary-text-color)); }
/* A block with a matching line-height, not a flex box: only then do overflow
   and text-overflow apply to the text itself. It sits in .slider, which is
   overflow: hidden, so the absolute position cannot escape either. */
.slider .label {
    position: absolute;
    inset: 0;
    display: block;
    box-sizing: border-box;
    line-height: 44px;
    padding: 0 12px;
    font-size: var(--ha-font-size-s, 14px);
    font-weight: var(--ha-font-weight-medium, 500);
    color: var(--primary-text-color);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.error {
    display: flex;
    align-items: flex-start;
    gap: var(--ha-space-3, 12px);
    padding: var(--ha-space-4, 16px);
    color: var(--error-color, #db4437);
    font-size: var(--ha-font-size-s, 14px);
    overflow-wrap: anywhere;
}
.error ha-icon { flex: 0 0 24px; }
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
}
@container (max-width: 440px) {
    .main {
        grid-template-columns: minmax(0, 1fr) 44px;
        grid-template-areas: 'identity identity' 'status action';
    }
    .desc { margin-left: 0; }
}
/* description: false (#715): one row, the switch beside the title. */
.main.nodesc { grid-template-areas: 'identity action'; }
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
        this._seen = null; // what the last render read, see watchSnapshot()
        this._live = null; // the slider's live session (#715)
        this._apiId = null;
        this._themeKeys = [];
        this._themeSeen = null;
    }

    connectedCallback() {
        OPTIMISTIC_VIEWS.add(this);
        this._syncApi();
    }

    disconnectedCallback() {
        OPTIMISTIC_VIEWS.delete(this);
        if (this._apiId) unregisterApi(this._apiId, this);
        this._apiId = null;
    }

    /** `api_id`: (un)registers this card for the JS and URL API. */
    _syncApi() {
        const wanted = this._opts && this.isConnected ? this._opts.apiId : null;
        if (this._apiId && this._apiId !== wanted) unregisterApi(this._apiId, this);
        this._apiId = null;
        if (wanted && registerApi(wanted, this)) this._apiId = wanted;
    }

    /** `theme`: the variables of one Home Assistant theme on this card only. */
    _applyTheme() {
        const name = this._opts ? this._opts.theme : null;
        const themes = this._hass ? this._hass.themes : null;
        const key = [name, themes];
        if (this._themeSeen && this._themeSeen[0] === key[0] && this._themeSeen[1] === key[1]) return;
        this._themeSeen = key;
        this._themeKeys = applyThemeVars(this, themeVars(themes, name), this._themeKeys);
        if (this._dialog) this._dialog.themeVars = themeVars(themes, name);
    }

    /** A preview of one of this card's lights started or ended. */
    _onOptimistic(ids) {
        if (this._hass && snapshotWatches(this._seen, ids)) this._render();
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
            const validated=BuschUI.validateConfig(raw||{},{normalize:normalizeConfig});
            if(!validated.ok)throw validated.error;
            if (this._opts && BuschUI.configsEqual(this._opts, validated.value)) return;
            this._opts=validated.value;
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
        this._seen = null;
        this.shadowRoot.innerHTML = '';
        const opts = this._opts;
        this.style.setProperty('--blc-icon-size', (opts ? opts.iconPx : ICON_BASE_PX) + 'px');
        // A pending end value of a replaced session still goes out; only the
        // new one drives this slider.
        // Letting go of the held value only redraws the slider: the model is
        // already current, every own state change rebuilt it.
        this._live = new LiveSession(!opts || opts.liveUpdate, () => {
            if (this._model && this._built && !this._error) this._showSlider(this._model);
        }, () => (this._model ? this._model.liveInterval('brightness') : LIVE_LIGHT_INTERVAL_MS));
        this._syncApi();
        this._applyTheme();
        this._render();
    }

    set hass(hass) {
        // Home Assistant hands every card a new hass on every state change in
        // the whole house. Only redraw when one of our own entities — groups
        // and their resolved members included — or the language changed.
        const unchanged = snapshotUnchanged(this._seen, hass);
        this._hass = hass;
        this._applyTheme();
        if (!unchanged) this._render();
        if (this._dialog) this._dialog.hass = hass;
    }

    get hass() {
        return this._hass;
    }

    getCardSize() {
        if (this._opts && !this._opts.isVisible) return 0;
        // Masonry uses 50px units to balance columns, not to set a height.
        const height = this._card ? this._card.getBoundingClientRect().height : 0;
        return height ? Math.ceil(height / 50) : 4;
    }

    /**
     * Sections layout. Twelve columns is the full width of a section; six is
     * half of it and the narrowest the title, the badge and the switch still
     * fit side by side. Both are multiples of three, as the grid demands.
     * Rows deliberately remain unspecified: the mobile header wraps and the
     * slider/status can change height. Sections must measure the content.
     */
    getGridOptions() {
        return {
            columns: 12,
            min_columns: 6
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
            const card = document.createElement('ha-card');
            card.dataset.uiContract = 'Busch HA UI 0.1.0';
            const box = document.createElement('div');
            box.className = 'error';
            const icon = document.createElement('ha-icon');
            icon.setAttribute('icon', 'mdi:alert-circle-outline');
            const message = document.createElement('span');
            message.textContent = this._error;
            box.appendChild(icon);
            box.appendChild(message);
            card.appendChild(box);
            root.appendChild(card);
            this._built = true;
            return;
        }

        const card = document.createElement('ha-card');
        card.dataset.uiContract = 'Busch HA UI 0.1.0';
        this._card = card;
        this._paintKey = null;
        this._shownBackground = null;

        this._ghost = document.createElement('div');
        this._ghost.className = 'ghost';
        card.appendChild(this._ghost);

        const main = document.createElement('div');
        main.className = 'main';
        this._main = main;

        const tap = document.createElement('div');
        tap.className = 'tap';
        tap.setAttribute('role', 'button');
        tap.tabIndex = 0;
        this._tap = tap;

        const media = document.createElement('div');
        media.className = 'media';
        this._icon = document.createElement('ha-icon');
        this._icon.className = 'icon';
        media.appendChild(this._icon);
        tap.appendChild(media);

        const text = document.createElement('div');
        text.className = 'text';
        this._title = document.createElement('h2');
        this._desc = document.createElement('div');
        this._desc.className = 'desc';
        this._desc.setAttribute('role', 'button');
        this._desc.tabIndex = 0;
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
        tap.appendChild(text);

        main.appendChild(tap);
        main.appendChild(this._desc);

        this._toggle = document.createElement('button');
        this._toggle.className = 'toggle';
        this._toggle.setAttribute('role', 'switch');
        this._toggle.setAttribute('aria-label', translate(this._hass, 'toggle'));
        const knob = document.createElement('span');
        knob.className = 'knob';
        this._toggle.appendChild(knob);
        main.appendChild(this._toggle);

        card.appendChild(main);

        // brightness slider
        this._slider = document.createElement('div');
        this._slider.className = 'slider';
        this._slider.setAttribute('role', 'slider');
        this._slider.setAttribute('aria-label', translate(this._hass, 'brightness'));
        this._slider.setAttribute('aria-valuemin', '0');
        this._slider.setAttribute('aria-valuemax', '100');
        this._slider.tabIndex = 0;
        this._sliderFill = document.createElement('div');
        this._sliderFill.className = 'fill';
        this._sliderLabel = document.createElement('div');
        this._sliderLabel.className = 'label';
        // The Mushroom variant's track; hidden by CSS for the default slider.
        const track = document.createElement('div');
        track.className = 'track';
        this._sliderMFill = document.createElement('div');
        this._sliderMFill.className = 'mfill';
        track.appendChild(this._sliderMFill);
        this._slider.appendChild(this._sliderFill);
        this._slider.appendChild(this._sliderLabel);
        this._slider.appendChild(track);
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

        // Both lines of the header retain the card's tap and hold actions.
        const cancelHold = () => clearTimeout(this._holdTimer);
        [this._tap, this._desc].forEach((target) => {
            target.addEventListener('pointerdown', () => {
                this._held = false;
                clearTimeout(this._holdTimer);
                this._holdTimer = setTimeout(() => {
                    this._held = true;
                    this._runAction(this._opts.holdAction);
                }, 500);
            });
            target.addEventListener('pointerup', cancelHold);
            target.addEventListener('pointercancel', cancelHold);
            target.addEventListener('pointerleave', cancelHold);
            target.addEventListener('click', () => {
                if (this._held) {
                    this._held = false;
                    return;
                }
                this._runAction(this._opts.tapAction);
            });
            target.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                this._runAction(this._opts.tapAction);
            });
        });

        this._slider.addEventListener('keydown', (event) => {
            if (!this._model || !this._model.supportsBrightness ||
                this._model.isAllUnavailable || !this._model.isOn) return;
            const shown = Number(this._slider.getAttribute('aria-valuenow'));
            const current = Number.isFinite(shown) ? shown : this._model.brightnessPct;
            const min = this._opts.allowZero ? 0 : 1;
            const changes = {
                ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5,
                PageDown: -10, PageUp: 10
            };
            let pct;
            if (event.key === 'Home') pct = min;
            else if (event.key === 'End') pct = 100;
            else if (Object.prototype.hasOwnProperty.call(changes, event.key)) {
                pct = clamp(current + changes[event.key], min, 100);
            } else return;
            event.preventDefault();
            event.stopPropagation();
            this._showPct(pct);
            this._sliderLabel.textContent = pct + ' %';
            this._slider.setAttribute('aria-valuenow', String(pct));
            // Through the session as well: fast key repeats collapse into the
            // newest value instead of queueing one call per key.
            this._live.commit(pct, (value) => this._model.setBrightness(value));
        });

        onDrag(this._slider, (point, done) => {
            if (!this._model || !this._model.supportsBrightness) return;
            if (this._model.isAllUnavailable) return;
            const min = this._opts.allowZero ? 0 : 1;
            const pct = clamp(Math.round((point.x / point.width) * 100), min, 100);
            this._dragging = !done;
            this._slider.classList.toggle('dragging', !done);
            this._showPct(pct);
            this._sliderLabel.textContent = pct + ' %';
            this._slider.setAttribute('aria-valuenow', String(pct));
            const live = this._live;
            if (!done) {
                // 0 is never sent while sliding (it would switch lights off
                // and back on), only on release — as in the Hue card.
                live.update(pct, (value) => (value > 0 ? this._model.setBrightness(value, { live: true }) : undefined));
            } else {
                live.commit(pct, (value) => (value !== live.lastSent ? this._model.setBrightness(value) : undefined));
            }
        }, { axis: 'x' });
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
        if (!this._model || this._model.isEmpty || (this._dialog && this._dialog.isConnected)) return;
        const dialog = document.createElement(DIALOG_TAG);
        dialog.themeVars = themeVars(this._hass && this._hass.themes, this._opts.theme);
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
        this._seen = null;
        if (this._error || !this._opts) return;
        this.style.display = this._opts.isVisible ? '' : 'none';
        if (!this._hass) {
            this._title.textContent = (!this._opts.titleParts && this._opts.title) || this._opts.entityIds[0];
            this._descText.textContent = translate(null, 'loading');
            this._desc.dataset.tone = 'unknown';
            this._warn.style.display = 'none';
            this._toggle.setAttribute('disabled', '');
            this._slider.style.display = 'none';
            return;
        }

        this._model = new GroupModel(optimisticView(this._hass), this._opts);
        const model = this._model;
        this._seen = watchSnapshot(this._hass, model.watchIds());

        this._icon.setAttribute('icon', BuschUI.resolveMedia({display_mode:'icon',icon:model.icon},{},'mdi:lightbulb').icon);
        this._title.textContent = model.title;
        this._descText.textContent = model.description;
        this._tap.setAttribute('aria-label', model.title);
        this._desc.dataset.tone = BuschUI.statusSemantic(model.isEmpty ? 'unknown'
            : model.isAllUnavailable ? 'unavailable'
                : model.deadCount > 0 ? 'warning'
                    : model.isOn ? 'success' : 'neutral');

        // Unavailable members are named, not hidden: the card keeps working,
        // and the badge says how much of the group it is actually driving.
        const showWarn = this._opts.showUnavailable && model.deadCount > 0 && !model.isAllUnavailable;
        this._warn.style.display = showWarn ? '' : 'none';
        if (showWarn) this._warnText.textContent = BuschUI.formatNumber(model.deadCount,'en',{useGrouping:false,maximumFractionDigits:0});
        this._warn.title = showWarn
            ? translate(this._hass, 'unavailable', { n: model.deadCount }) +
              ': ' +
              model.dead.map((l) => l.name).join(', ')
            : '';

        // description: false hides the line; a badge for unreachable members
        // keeps its place, only the text goes.
        const hideText = this._opts.description === false;
        this._descText.style.display = hideText ? 'none' : '';
        this._desc.style.display = hideText && !showWarn ? 'none' : '';
        this._main.classList.toggle('nodesc', hideText && !showWarn);

        this._paint(model);

        // toggle
        const disabled = model.isAllUnavailable || model.isEmpty;
        this._toggle.classList.toggle('on', model.isOn);
        this._toggle.setAttribute('aria-checked', String(model.isOn));
        if (disabled) this._toggle.setAttribute('disabled', '');
        else this._toggle.removeAttribute('disabled');
        this._toggle.style.display = this._opts.showSwitch ? '' : 'none';

        // slider
        const sliderOn = this._opts.slider !== 'none' && model.supportsBrightness;
        this._slider.style.display = sliderOn ? '' : 'none';
        this._slider.classList.toggle('mushroom', this._opts.slider === 'mushroom');
        const sliderDisabled = this._opts.allowZero ? model.isAllUnavailable : !model.isOn;
        if (sliderDisabled) this._slider.setAttribute('disabled', '');
        else this._slider.removeAttribute('disabled');
        this._slider.tabIndex = sliderDisabled ? -1 : 0;
        this._slider.setAttribute('aria-valuemin', this._opts.allowZero ? '0' : '1');
        this._showSlider(model);
    }

    /**
     * Under the finger the slider shows the finger; afterwards the value it
     * sent, until Home Assistant has caught up (#715). Never the lagging state
     * in between.
     */
    _showSlider(model) {
        if (!this._dragging) {
            const pinned = this._live ? this._live.pinned : null;
            const pct = pinned !== null ? pinned : model.brightnessPct;
            this._showPct(pct);
            this._slider.setAttribute('aria-valuenow', String(pct));
            this._sliderLabel.textContent = model.isOn || pinned !== null
                ? pct + ' %' : translate(this._hass, 'brightness');
        }
    }

    /** Slider position as transform only: no layout work per drag step. */
    _showPct(pct) {
        const value = clamp(pct, 0, 100);
        const share = value / 100;
        this._sliderFill.style.transform = 'scaleX(' + share + ')';
        this._sliderMFill.style.transform = 'translateX(' + (value - 100) + '%)';
        this._slider.style.setProperty('--blc-rest', String(Math.round((1 - share) * 1000) / 1000));
    }

    /**
     * Hue look (#712, user decision 28.10.2026): while a light is on, the whole
     * card carries the light colours — one colour flat, several as a gradient
     * — and text, switch and slider sit on it in a colour chosen per
     * background for 4.5:1. Off, the theme surface or off_color, with
     * off_shadow. 0.8.x kept the colour in the 44 px tile only (Busch HA UI
     * 0.1.0, "no strong gradients"); the user decision overrides that.
     *
     * Only called for a change of the card's own entities, and it writes only
     * what changed: the gradient is set again only for new colours.
     */
    _paint(model) {
        const opts = this._opts;
        const offColor = parseColor(opts.offColor);
        const lit = model.isOn && model.colors.length > 0;
        const surface = lit
            ? litSurface(model.colors)
            : offColor ? readableSurface([offColor], { adjust: false }) : null;
        const background = lit ? surface.background
            : offColor ? colorToCss(offColor) : 'var(--card-background-color)';
        this._surface = surface;
        const classes = [];
        if (opts.hueBorders) classes.push('hue-borders');
        if (lit) classes.push('lit');
        else if (offColor) classes.push('tinted');
        if (surface) classes.push('fg-' + surface.fg);
        const values = {
            '--blc-background': background,
            '--blc-text-color': surface ? surface.css : 'var(--primary-text-color)',
            '--blc-accent': lit ? background : offColor ? colorToCss(offColor) : 'var(--primary-color)',
            '--blc-shadow': this._brightnessShadow(model, surface)
        };
        const key = classes.join(' ') + '|' + JSON.stringify(values);
        if (key === this._paintKey) return;
        this._paintKey = key;
        this._card.className = classes.join(' ');
        Object.keys(values).forEach((name) => {
            if (this.style.getPropertyValue(name) !== values[name]) this.style.setProperty(name, values[name]);
        });
        if (this._shownBackground !== null && this._shownBackground !== background) this._fadeFrom(this._shownBackground);
        this._shownBackground = background;
    }

    /** Lays the replaced background over the new one and fades it out. */
    _fadeFrom(previous) {
        const ghost = this._ghost;
        if (!ghost || typeof ghost.animate !== 'function' || reducedMotion()) return;
        if (this._fade) this._fade.cancel();
        ghost.style.background = previous;
        this._fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: 'ease-out' });
    }

    _brightnessShadow(model, surface) {
        if (!model.isOn) return this._opts.offShadow ? 'inset 0px 0px 10px rgba(0,0,0,0.2)' : 'none';
        // The Hue card dims the lower part by brightness. That only darkens,
        // so it is safe under light text and skipped under dark text.
        if (!surface || surface.fg !== 'light') return 'none';
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
    contrastRatio,
    readableSurface,
    litSurface,
    TILE_SHADE,
    clearOptimistic,
    LiveSession,
    liveIntervalFor,
    liveTransition,
    parseTemplate,
    resolveTemplate,
    iconSizePx,
    sliderType,
    themeVars,
    CARD_STYLES,
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

const DIALOG_STYLES = BuschUI.cardStyles + `
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
/* Opening like the Hue card's dialog: 0.3 s ease-out, opacity and transform
   only (#715). Bottom sheet rises on a phone, the centred dialog grows in. */
.scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    animation: fade 0.3s ease-out;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { transform: translateY(32px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes grow { from { transform: scale(0.94); opacity: 0; } to { transform: none; opacity: 1; } }
/* A light's detail view slides in from above, as Hue's light detail does. */
@keyframes drop { from { transform: translateY(-30px); opacity: 0; } to { transform: none; opacity: 1; } }
.enter { animation: drop 0.3s ease-out; }
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
    animation: rise 0.3s ease-out;
    font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
}
@media (min-width: 700px) {
    :host { align-items: center; }
    .sheet { border-radius: 16px; animation-name: grow; }
}
.head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
}
.head .who { flex-grow: 1; min-width: 0; }
/* Lit (#712): the header carries the light colours like the card, edge to
   edge at the top of the sheet; its text colour is chosen per background. */
.head.lit {
    margin: -16px -16px 14px;
    padding: 16px;
    border-radius: 16px 16px 0 0;
}
.head.lit .sub { color: inherit; }
.head.lit .iconbtn { color: inherit; }
.head.lit.fg-light .iconbtn { background: rgba(0, 0, 0, 0.24); }
.head.lit.fg-dark .iconbtn { background: rgba(255, 255, 255, 0.45); }
.head.lit .headsw.on { background: rgba(0, 0, 0, 0.35); }
.head.lit.fg-dark .headsw.on { background: rgba(0, 0, 0, 0.62); }
.head.lit .headsw .gknob { background: var(--blc-knob-color, rgb(255, 255, 255)); }
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
    transition: transform 0.15s ease-out;
    -webkit-tap-highlight-color: transparent;
}
/* Tap feedback of the Hue tiles: pressed tiles shrink a little. */
.scene:not([disabled]):active,
.tile:not(.dead):not(.dragging):active { transform: scale(0.95); }
/* Since 0.9.0 the tile carries the scene colour like the Hue app; the label
   colour is chosen per tile for 4.5:1, so it reads on any scene colour. The
   badge is a translucent chip on top. --blc-scene-badge still overrides it. */
.scene .badge {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--blc-scene-badge, rgba(0, 0, 0, 0.24));
}
.scene.fg-dark .badge { background: var(--blc-scene-badge, rgba(255, 255, 255, 0.45)); }
.scene[disabled] .badge { background: var(--blc-scene-badge, rgba(255, 255, 255, 0.12)); }
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
    -webkit-user-select: none;
    user-select: none;
    transition: transform 0.15s ease-out;
}
/* Shades the DARK part from the top, so its height is the missing brightness.
   Filling from the bottom read backwards: a dim lamp looked like a bright one
   with a bright band on top. */
.tile .tfill {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    height: 100%;
    background: rgba(0, 0, 0, 0.32);
    pointer-events: none;
    transform-origin: center top;
    transform: scaleY(0);
    transition: transform 0.3s ease-out;
}
.tile.dragging .tfill { transition: none; }
/* On a coloured tile the theme's accent clashes; the switch borrows the
   tile's own contrast instead. */
.tile.lit .tsw { background: rgba(0, 0, 0, 0.25); }
.tile.lit .tsw.on { background: rgba(0, 0, 0, 0.45); }
.tile.lit.fg-dark .tsw.on { background: rgba(0, 0, 0, 0.62); }
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
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
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
    /* Horizontal slider in a vertically scrolling sheet: the page keeps the
       vertical swipe (#715). */
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    cursor: pointer;
}
/* transform, not width: no layout per drag step (#715). */
.dslider .fill {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.75);
    transform-origin: left center;
    transform: scaleX(0);
    transition: transform 0.3s ease-out;
}
.dslider.dragging .fill { transition: none; }
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
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition: none !important; animation: none !important; }
}
`;

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

/** The colour wheel's pixels, shared by every dialog (see _makeColorWheel). */
let WHEEL_IMAGE = null;

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
        this._pendingUpdate = false;
        this._pickerDraft = null;
        this._pickerContext = null;
        // How many history entries this dialog has pushed. Back consumes them.
        this._depth = 0;
        this._closing = false;
        this._closed = false;
        this._returnFocus = null;
        this._seen = null; // what the last sheet read, see watchSnapshot()
        this._live = new Map(); // one live session per control (#715)
        this._themeKeys = [];
        this._viewKey = undefined;
        this._onKey = (event) => {
            if (event.key === 'Tab') {
                const controls = this._focusable();
                const active = this.shadowRoot.activeElement;
                const index = controls.indexOf(active);
                if (!controls.length) { event.preventDefault(); this._sheet.focus(); return; }
                if (event.shiftKey && index <= 0) {
                    event.preventDefault(); controls[controls.length - 1].focus();
                } else if (!event.shiftKey && (index < 0 || index === controls.length - 1)) {
                    event.preventDefault(); controls[0].focus();
                }
                return;
            }
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            this._goBack();
        };
        this._onFocus = (event) => {
            if (this.isConnected && !event.composedPath().includes(this)) this._focusFirst();
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
        this._seen = null;
        this._update();
    }

    /** The card's `theme`, carried over to the dialog (#715). */
    set themeVars(vars) {
        this._themeKeys = applyThemeVars(this, vars || {}, this._themeKeys);
    }

    /**
     * The live session of one control, kept across rebuilds of the sheet so a
     * rebuilt slider still shows the value it sent. Sessions outlive a closed
     * dialog: an end value already queued is still sent.
     */
    _session(key, interval) {
        let session = this._live.get(key);
        if (!session) {
            session = new LiveSession(this._opts.liveUpdate, () => {
                if (!this._closed) this._update();
            }, interval);
            this._live.set(key, session);
        }
        return session;
    }

    /** One drag step through a session: live while moving, the end value on release. */
    _liveStep(session, value, done, send) {
        if (!done) session.update(value, (v) => send(v, true));
        else session.commit(value, (v) => (v !== session.lastSent ? send(v, false) : undefined));
    }

    set hass(hass) {
        // Rebuilding the sheet is the expensive part of this file; foreign
        // state changes must not trigger it.
        const unchanged = snapshotUnchanged(this._seen, hass);
        this._hass = hass;
        if (!unchanged) this._update();
    }

    /** A preview of one of the dialog's lights started or ended. */
    _onOptimistic(ids) {
        if (this._hass && snapshotWatches(this._seen, ids)) this._update();
    }

    _watchIds() {
        const ids = this._model ? this._model.watchIds() : [];
        (this._opts.scenes || []).forEach((scene) => ids.push(scene.entity));
        return ids;
    }

    connectedCallback() {
        let active = document.activeElement;
        while (active && active.shadowRoot && active.shadowRoot.activeElement) active = active.shadowRoot.activeElement;
        this._returnFocus = active;
        document.addEventListener('keydown', this._onKey);
        document.addEventListener('focusin', this._onFocus, true);
        window.addEventListener('popstate', this._onPop);
        OPTIMISTIC_VIEWS.add(this);
        // The phone's back gesture is a history navigation. Without an entry
        // of its own the dialog would stay open and the whole dashboard would
        // be left instead.
        this._push();
        this._focusFirst();
    }

    disconnectedCallback() {
        document.removeEventListener('keydown', this._onKey);
        document.removeEventListener('focusin', this._onFocus, true);
        window.removeEventListener('popstate', this._onPop);
        OPTIMISTIC_VIEWS.delete(this);
        if (this._returnFocus && this._returnFocus.isConnected) this._returnFocus.focus();
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
        // Light controls act immediately. This is an actionable control
        // dialog, not a transient popover: outside clicks never dismiss it.
        root.appendChild(scrim);

        this._sheet = document.createElement('div');
        this._sheet.className = 'sheet';
        this._sheet.setAttribute('role', 'dialog');
        this._sheet.setAttribute('aria-modal', 'true');
        this._sheet.setAttribute('aria-labelledby', 'light-dialog-title');
        this._sheet.tabIndex = -1;
        root.appendChild(this._sheet);

        this._built = true;
    }

    _update() {
        if (!this._opts || !this._hass) return;
        if (!this._built) this._build();
        if (this._dragging) {
            this._pendingUpdate = true;
            return; // never rebuild under a finger
        }
        this._model = new GroupModel(optimisticView(this._hass), this._opts);
        this._seen = watchSnapshot(this._hass, this._watchIds());
        this._renderSheet();
    }

    _setDragging(dragging) {
        this._dragging = dragging;
        if (!dragging && this._pendingUpdate && this._opts && this._hass) {
            this._model = new GroupModel(optimisticView(this._hass), this._opts);
        }
    }

    _flushPendingUpdate() {
        if (!this._dragging && this._pendingUpdate) {
            this._pendingUpdate = false;
            this._update();
        }
    }

    _focusable() {
        return Array.from(this._sheet.querySelectorAll('button, input, select, textarea, [tabindex]'))
            .filter((node) => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length);
    }

    _focusFirst() {
        if (!this._sheet || !this.isConnected) return;
        (this._focusable()[0] || this._sheet).focus();
    }

    _renderSheet() {
        const controls = this._sheet ? this._focusable() : [];
        const active = this.shadowRoot.activeElement;
        const index = controls.indexOf(active);
        const focusKey = active?.dataset?.focusKey;
        const scrollTop = this._sheet?.scrollTop || 0;
        this._buildSheet();
        if (this._sheet) this._sheet.scrollTop = scrollTop;
        // Into or out of a light's detail view: the content below the header
        // slides in (#715). Rebuilds of the same view stay still.
        const view = this._detailEntity || '';
        if (this._viewKey !== undefined && view !== this._viewKey && !reducedMotion()) {
            Array.from(this._sheet.childNodes).slice(1).forEach((node) => node.classList && node.classList.add('enter'));
        }
        this._viewKey = view;
        if (this.isConnected) {
            const focusable = this._focusable();
            const keyed = focusKey && focusable.find(node => node.dataset.focusKey === focusKey);
            (keyed || focusable[Math.max(0, index)] || this._sheet).focus({ preventScroll: true });
        }
    }

    _buildSheet() {
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
        h1.id = 'light-dialog-title';
        const sub = document.createElement('div');
        sub.className = 'sub';

        const detail = this._detailEntity ? new LightModel(optimisticView(hass), this._detailEntity) : null;
        if (detail) {
            h1.textContent = detail.name;
            sub.textContent = detail.isAvailable
                ? detail.isOn
                    ? detail.brightnessPct + ' %'
                    : translate(hass, 'allOff')
                : translate(hass, 'unreachable');
        } else {
            h1.textContent = model.title;
            // description: false hides the card's line only; the dialog keeps
            // the state as text.
            sub.textContent = model.description || model.defaultDescription;
        }
        who.appendChild(h1);
        who.appendChild(sub);
        head.appendChild(who);
        BuschUI.header({node:head,titleNode:h1});

        // Lit header in the colours of whatever it names (#712).
        const headColors = detail
            ? (detail.isOn ? [detail.color || parseColor(this._opts.defaultColor) || parseColor(WARM_COLOR)] : [])
            : (model.isOn ? model.colors : []);
        const headSurface = headColors.length ? litSurface(headColors) : null;
        if (headSurface) {
            head.classList.add('lit', 'fg-' + headSurface.fg);
            head.style.background = headSurface.background;
            head.style.color = headSurface.css;
        }

        // The master switch, always in the header: it belongs to whatever the
        // header names — the whole group, or the single light in detail view.
        head.appendChild(
            detail
                ? this._makeHeadSwitch(detail.isOn, !detail.isAvailable, () =>
                      optimisticCall(hass, detail.domain, detail.isOn ? 'turn_off' : 'turn_on', {
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
                this._makeSlider('group', model.brightnessPct, model.isOn,
                    (pct, live) => this._model.setBrightness(pct, { live }),
                    () => this._model.liveInterval('brightness'))
            );
        }

        // ---- group colour pickers
        if ((model.supportsColor || model.supportsTemp) && !model.isAllUnavailable) {
            this._appendPickers(sheet, {
                contextKey: 'group:' + this._opts.entityIds.slice().sort().join(','),
                entityIds: model.lights.filter((light) => light.isAvailable
                    && (light.supportsColor || light.supportsTemp)).map((light) => light.entityId),
                supportsColor: model.supportsColor,
                supportsTemp: model.supportsTemp,
                minKelvin: model.minKelvin,
                maxKelvin: model.maxKelvin,
                currentKelvin: null,
                onRgb: (rgb, live) => this._model.setRgb(rgb, { live }),
                onKelvin: (k, live) => this._model.setKelvin(k, { live })
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
            const id = light.entityId;
            wrap.appendChild(
                this._makeSlider('light:' + id, light.brightnessPct, light.isOn, (pct, live) => (
                    pct <= 0
                        ? optimisticCall(this._hass, light.domain, 'turn_off', { entity_id: id })
                        : optimisticCall(this._hass, 'light', 'turn_on', Object.assign(
                            { entity_id: id, brightness_pct: pct }, live ? liveTransition(this._hass, [id]) : {}))
                ), () => liveIntervalFor(this._hass, [id]))
            );
        }
        // A light without brightness needs no row of its own: the header
        // switch above already turns it on and off.

        sheet.appendChild(wrap);

        if (light.supportsColor || light.supportsTemp) {
            this._appendPickers(sheet, {
                contextKey: 'light:' + light.entityId,
                entityIds: [light.entityId],
                supportsColor: light.supportsColor,
                supportsTemp: light.supportsTemp,
                minKelvin: light.minKelvin,
                maxKelvin: light.maxKelvin,
                currentKelvin: light.kelvin,
                onRgb: (rgb, live) => optimisticCall(this._hass, 'light', 'turn_on', Object.assign(
                    { entity_id: light.entityId, rgb_color: rgb }, live ? liveTransition(this._hass, [light.entityId]) : {})),
                onKelvin: (k, live) =>
                    optimisticCall(this._hass, 'light', 'turn_on', Object.assign({
                        entity_id: light.entityId,
                        color_temp_kelvin: Math.round(k)
                    }, live ? liveTransition(this._hass, [light.entityId]) : {}))
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
        button.setAttribute('aria-label', translate(this._hass, icon === 'mdi:close' ? 'close' : 'back'));
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

        // A missing scene stays a grey, disabled tile: colour alone would
        // promise a scene that cannot run.
        if (!missing) {
            const surface = readableSurface([color]);
            button.classList.add('fg-' + surface.fg);
            button.style.background = colorToCss(surface.colors[0]);
            button.style.color = surface.css;
        }

        const badge = document.createElement('span');
        badge.className = 'badge';
        const icon = document.createElement('ha-icon');
        icon.setAttribute(
            'icon',
            scene.icon || (state && state.attributes && state.attributes.icon) || 'mdi:palette'
        );
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
        // Dragging the tile is live too (#715); a rebuilt tile shows what it sent.
        const session = light.isAvailable
            ? this._session('tile:' + light.entityId, () => liveIntervalFor(this._hass, [light.entityId]))
            : null;
        const held = session ? session.pinned : null;
        const shownPct = held !== null ? held : light.brightnessPct;
        const pct = document.createElement('span');
        pct.className = 'tpct';
        pct.textContent = light.isAvailable ? (light.isOn || held !== null ? shownPct + ' %' : '') : '';
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
            optimisticCall(this._hass, light.domain, light.isOn ? 'turn_off' : 'turn_on', {
                entity_id: light.entityId
            });
        });
        tile.appendChild(toggle);

        const color = light.color;
        if (light.isOn) {
            // The text crosses the shaded top part too, so both must read.
            const surface = readableSurface(
                [color || parseColor(this._opts.defaultColor) || parseColor(WARM_COLOR)], { shade: TILE_SHADE });
            tile.classList.add('lit', 'fg-' + surface.fg);
            tile.style.background = colorToCss(surface.colors[0]);
            tile.style.color = surface.css;
            // height = the darkness, not the brightness
            fill.style.transform = 'scaleY(' + (100 - shownPct) / 100 + ')';
        }
        const send = (value, live) => optimisticCall(this._hass, 'light', 'turn_on', Object.assign(
            { entity_id: light.entityId, brightness_pct: value }, live ? liveTransition(this._hass, [light.entityId]) : {}));

        // The switch does on/off, so the tile itself is free for the two things
        // that used to need a long press: drag up/down dims, a plain tap opens
        // that light's detail view.
        let moved = false;
        let startY = null;

        onDrag(tile, (point, done) => {
            // The start is where the finger went down. Taking it anew on every
            // move made a slow drag (under 8 px per event) never count as one.
            if (startY === null) startY = point.y;
            const delta = Math.abs(point.y - startY);
            if (!done && (moved || delta > 8) && light.supportsBrightness) {
                moved = true;
                this._setDragging(true);
                tile.classList.add('dragging');
                const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                fill.style.transform = 'scaleY(' + (100 - value) / 100 + ')';
                pct.textContent = value + ' %';
                this._liveStep(session, value, false, send);
            }
            if (!done) return;

            startY = null;
            tile.classList.remove('dragging');
            this._setDragging(false);
            if (moved) {
                const value = clamp(Math.round(((point.height - point.y) / point.height) * 100), 1, 100);
                this._liveStep(session, value, true, send);
                moved = false;
                this._flushPendingUpdate();
                return;
            }
            this._detailEntity = light.entityId;
            // Its own history entry, so back returns here rather than closing.
            this._push();
            this._renderSheet();
        });

        return tile;
    }

    /**
     * A brightness slider. `send(pct, live)` makes the call and returns its
     * promise; `interval` is the live pace for its targets (#715).
     */
    _makeSlider(key, value, enabled, send, interval) {
        const session = this._session(key, interval);
        const held = session.pinned;
        const shown = held !== null ? held : value;
        const slider = document.createElement('div');
        slider.className = 'dslider';
        const fill = document.createElement('div');
        fill.className = 'fill';
        fill.style.transform = 'scaleX(' + clamp(shown, 0, 100) / 100 + ')';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = enabled || held !== null ? shown + ' %' : translate(this._hass, 'allOff');
        slider.appendChild(fill);
        slider.appendChild(label);

        onDrag(slider, (point, done) => {
            const pct = clamp(Math.round((point.x / point.width) * 100), 0, 100);
            this._setDragging(!done);
            slider.classList.toggle('dragging', !done);
            fill.style.transform = 'scaleX(' + pct / 100 + ')';
            label.textContent = pct + ' %';
            // 0 only on release (it switches off), never while sliding.
            this._liveStep(session, pct, done, (v, live) => (live && v <= 0 ? undefined : send(v, live)));
            if (done) this._flushPendingUpdate();
        }, { axis: 'x' });
        return slider;
    }

    _appendPickers(sheet, options) {
        const hass = this._hass;
        const contextKey = [options.contextKey, options.supportsColor, options.supportsTemp,
            options.minKelvin, options.maxKelvin].join('|');
        const entityIds = (options.entityIds || []).slice().sort();
        const signature = JSON.stringify(entityIds.map((entityId) => {
            const attributes = hass.states[entityId]?.attributes || {};
            return [entityId,
                options.supportsColor ? attributes.rgb_color || null : null,
                options.supportsTemp ? attributes.color_temp_kelvin || null : null];
        }));
        const context = { key: contextKey, entityIds, signature, options };
        this._pickerContext = context;
        const draft = this._pickerDraft;
        if (draft) {
            if (draft.contextKey !== contextKey || Date.now() - draft.createdAt > 8000) {
                this._pickerDraft = null;
            } else if (draft.signature !== signature) {
                if (this._pickerDraftMatches(draft, context)) {
                    draft.signature = signature;
                    draft.submittedAt = null;
                } else if (!draft.submittedAt || Date.now() - draft.submittedAt > 2500) {
                    this._pickerDraft = null;
                } else {
                    draft.signature = signature;
                }
            }
        }
        const tabs = document.createElement('div');
        tabs.className = 'picker-tabs';
        const body = document.createElement('div');

        // Colour and white are live as well, as the Hue card's picker markers.
        const interval = () => liveIntervalFor(this._hass, options.entityIds);
        const rgbSession = this._session('rgb:' + options.contextKey, interval);
        const kelvinSession = this._session('kelvin:' + options.contextKey, interval);
        const liveRgb = (rgb, done) => this._liveStep(rgbSession, rgb, done, options.onRgb);
        const liveKelvin = (k, done) => this._liveStep(kelvinSession, k, done, options.onKelvin);
        const showColour = () => {
            body.innerHTML = '';
            body.appendChild(this._makeColorWheel(liveRgb));
        };
        const showWhite = () => {
            body.innerHTML = '';
            body.appendChild(
                this._makeTempBar(options.minKelvin, options.maxKelvin, options.currentKelvin, liveKelvin)
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
            b.dataset.focusKey = 'picker-tab:colour';
            b.addEventListener('click', () => activate('colour'));
            tabs.appendChild(b);
            buttons.push(b);
        }
        if (options.supportsTemp) {
            const b = document.createElement('button');
            b.textContent = translate(hass, 'white');
            b.dataset.tab = 'white';
            b.dataset.focusKey = 'picker-tab:white';
            b.addEventListener('click', () => activate('white'));
            tabs.appendChild(b);
            buttons.push(b);
        }

        if (buttons.length > 1) sheet.appendChild(tabs);
        sheet.appendChild(body);

        const wanted = this._tab === 'colour' && options.supportsColor ? 'colour' : options.supportsTemp ? 'white' : 'colour';
        activate(wanted);
    }

    _pickerDraftMatches(draft, context) {
        const ids = context.entityIds;
        if (!ids.length) return false;
        return ids.every((entityId) => {
            const attributes = this._hass.states[entityId]?.attributes || {};
            if (draft.mode === 'white') {
                const kelvin = Number(attributes.color_temp_kelvin);
                return Number.isFinite(kelvin) && Math.abs(kelvin - draft.value) <= 100;
            }
            const rgb = attributes.rgb_color;
            return Array.isArray(rgb) && rgb.length === 3
                && rgb.every((channel, index) => Math.abs(channel - draft.value[index]) <= 5);
        });
    }

    _markPickerDraftSubmitted(mode, value) {
        if (!this._pickerDraft || !this._pickerContext) return;
        this._pickerDraft.mode = mode;
        this._pickerDraft.value = value;
        this._pickerDraft.signature = this._pickerContext.signature;
        this._pickerDraft.submittedAt = Date.now();
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
        // The pixels never change, so they are computed once per page load
        // instead of on every rebuild of the sheet.
        if (WHEEL_IMAGE) {
            ctx.putImageData(WHEEL_IMAGE, 0, 0);
        } else {
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
            WHEEL_IMAGE = image;
        }

        const marker = document.createElement('div');
        marker.className = 'marker';
        marker.style.display = 'none';
        wrap.style.position = 'relative';
        wrap.appendChild(marker);
        const draft = this._pickerDraft?.mode === 'colour'
            && this._pickerDraft.contextKey === this._pickerContext?.key
            ? this._pickerDraft : null;
        if (draft) {
            marker.style.display = '';
            marker.style.left = draft.left;
            marker.style.top = draft.top;
            marker.style.background = draft.background;
        }

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
            this._pickerDraft = {
                mode: 'colour', contextKey: this._pickerContext?.key,
                signature: this._pickerContext?.signature, value: rgb, createdAt: Date.now(),
                submittedAt: null,
                left: marker.style.left,
                top: marker.style.top,
                background: marker.style.background
            };
            this._setDragging(!done);
            onPick(rgb, done);
            if (done) {
                this._markPickerDraftSubmitted('colour', rgb);
                this._flushPendingUpdate();
            }
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
        const draft = this._pickerDraft?.mode === 'white'
            && this._pickerDraft.contextKey === this._pickerContext?.key
            ? this._pickerDraft : null;
        if (draft) {
            marker.style.left = draft.left;
            marker.style.background = draft.background;
        } else if (currentKelvin) {
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
            this._pickerDraft = {
                mode: 'white', contextKey: this._pickerContext?.key,
                signature: this._pickerContext?.signature, value: kelvin, createdAt: Date.now(),
                submittedAt: null, left: marker.style.left, background: marker.style.background
            };
            this._setDragging(!done);
            onPick(kelvin, done);
            if (done) {
                this._markPickerDraftSubmitted('white', kelvin);
                this._flushPendingUpdate();
            }
        }, { axis: 'x' });

        return bar;
    }
}

// ---------------------------------------------------------------------------
// Visual editor
// ---------------------------------------------------------------------------

// Busch HA UI 0.1.0 editor actions: responsive scene rows and 44 px targets.
const EDITOR_STYLES = BuschUI.editorStyles + `
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
    width: 44px;
    height: 44px;
    box-sizing: border-box;
    padding: 8px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
}
.iconbtn:hover { background: var(--secondary-background-color, rgba(0, 0, 0, 0.06)); }
.iconbtn[disabled] { opacity: 0.35; cursor: default; }
.addbtn {
    border: 1px dashed var(--divider-color, #bdbdbd);
    background: none;
    color: var(--primary-color, #03a9f4);
    border-radius: 10px;
    padding: 10px;
    min-height: 44px;
    box-sizing: border-box;
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
async function ensureFormElements() {
    if (customElements.get('ha-form')) return Promise.resolve(true);
    if (!formElementsPromise) {
        formElementsPromise = (async () => {
            try {
                if (window.loadCardHelpers) {
                    const helpers = await BuschUI.ha.cardHelpers();
                    const card = await helpers.createCardElement({ type: 'entities', entities: [] });
                    if (card && card.constructor && card.constructor.getConfigElement) {
                        await card.constructor.getConfigElement();
                    }
                }
            } catch (e) {
                /* this render uses the fallback; a later render may retry */
            }
            return !!customElements.get('ha-form');
        })();
    }
    const available = await formElementsPromise;
    // A failed dynamic import can be temporary (network or frontend load
    // order). Allow the next render to try HA's card helpers again.
    if (!available) formElementsPromise = null;
    return available;
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
    { name: 'show_description', selector: { boolean: {} } },

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
            {
                name: 'slider',
                selector: {
                    select: {
                        mode: 'dropdown',
                        options: [
                            { value: 'default', labelKey: 'sliderDefault' },
                            { value: 'mushroom', labelKey: 'sliderMushroom' },
                            { value: 'none', labelKey: 'sliderNone' }
                        ]
                    }
                }
            },
            {
                name: 'icon_size',
                selector: {
                    select: {
                        mode: 'dropdown',
                        custom_value: true,
                        options: [
                            { value: 'original', labelKey: 'iconOriginal' },
                            { value: 'big', labelKey: 'iconBig' },
                            { value: 'small', labelKey: 'iconSmall' }
                        ]
                    }
                }
            }
        ]
    },
    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'hue_borders', selector: { boolean: {} } },
            { name: 'show_switch', selector: { boolean: {} } },
            { name: 'allow_zero', selector: { boolean: {} } },
            { name: 'off_shadow', selector: { boolean: {} } },
            { name: 'live_update', selector: { boolean: {} } },
            { name: 'is_visible', selector: { boolean: {} } }
        ]
    },
    { name: 'theme', selector: { theme: {} } },

    {
        name: '',
        type: 'grid',
        schema: [
            { name: 'tap_action', selector: { select: { mode: 'dropdown', options: ACTION_OPTIONS } } },
            { name: 'hold_action', selector: { select: { mode: 'dropdown', options: ACTION_OPTIONS } } }
        ]
    },
    { name: 'api_id', selector: { text: {} } },

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

function sameEditorValue(a,b){return BuschUI.configsEqual(a,b);}

function copyEditorValue(value){return BuschUI.cloneConfig(value);}

function changedEditorFields(previous, value) {
    const patch = {};
    new Set(Object.keys(previous || {}).concat(Object.keys(value || {}))).forEach((key) => {
        if (!sameEditorValue(previous && previous[key], value && value[key])) patch[key] = value && value[key];
    });
    return patch;
}

class BuschLightCardEditor extends BuschUI.EditorBase {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        BuschUI.guardEditorKeys(this.shadowRoot);
        this._config = {};
        this._hass = null;
        this._built = false;
        this._sceneCount = -1;
        this._forms = {};
    }

    setConfig(config) {
        if (!this._acceptConfig(config||{},toSnakeConfig)) return;
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

        // show_description is the editor's switch for description: false; it
        // is never written itself (#715).
        if (patch && Object.prototype.hasOwnProperty.call(patch, 'show_description')) {
            if (patch.show_description === false) next.description = false;
            else if (next.description === false) delete next.description;
        }
        delete next.show_description;
        // The old boolean `slider: true` is the default as well.
        if (next.slider === true) delete next.slider;
        // A number typed into the icon size box is stored as a number.
        if (typeof next.icon_size === 'string' && /^\d+(\.\d+)?$/.test(next.icon_size.trim())) {
            next.icon_size = Number(next.icon_size.trim());
        }

        Object.keys(CONFIG_DEFAULTS).forEach((key) => {
            if (next[key] !== undefined && next[key] === CONFIG_DEFAULTS[key]) delete next[key];
        });
        ['title', 'icon', 'description', 'off_color', 'default_color', 'icon_size', 'theme', 'api_id'].forEach((key) => {
            if (next[key] === '' || next[key] === null || next[key] === undefined) delete next[key];
        });
        if (Array.isArray(next.entities) && !next.entities.length) delete next.entities;
        if (Array.isArray(next.scenes) && !next.scenes.length) delete next.scenes;

        next.type = 'custom:' + CARD_TAG;
        this._config = copyEditorValue(next);

        BuschUI.emitConfigChanged(this,next);
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
            description: typeof c.description === 'string' ? c.description : '',
            show_description: c.description !== false,
            resolve_groups: c.resolve_groups !== false,
            max_depth: c.max_depth === undefined ? DEFAULT_MAX_DEPTH : c.max_depth,
            show_unavailable: c.show_unavailable !== false,
            group_display: c.group_display === 'flat' ? 'flat' : 'sections',
            off_color: c.off_color || '',
            default_color: c.default_color || '',
            hue_borders: c.hue_borders !== false,
            show_switch: c.show_switch !== false,
            slider: c.slider === false || c.slider === 'none' ? 'none' : c.slider === 'mushroom' ? 'mushroom' : 'default',
            allow_zero: c.allow_zero === true,
            off_shadow: c.off_shadow !== false,
            live_update: c.live_update !== false,
            icon_size: c.icon_size === undefined || c.icon_size === null || c.icon_size === ''
                ? CONFIG_DEFAULTS.icon_size : String(c.icon_size),
            theme: c.theme || '',
            is_visible: c.is_visible !== false,
            tap_action: c.tap_action || CONFIG_DEFAULTS.tap_action,
            hold_action: c.hold_action || CONFIG_DEFAULTS.hold_action,
            api_id: c.api_id || ''
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
        const form = BuschUI.ha.form();
        form.hass = this._hass;
        form.schema = sliceSchema(this._hass, names);
        form.data = this._data(names);
        form.__lastValue = copyEditorValue(form.data);
        // Rule 3: every field carries a label AND a helper, in both languages.
        // Grid wrappers have no name and therefore neither.
        form.computeLabel = (item) => (item.name ? fieldLabel(this._hass, item.name) : '');
        form.computeHelper = (item) => (item.name ? fieldHelper(this._hass, item.name) : '');
        form.addEventListener('value-changed', (event) => {
            event.stopPropagation();
            const value = event.detail.value || {};
            const patch = changedEditorFields(form.__lastValue, value);
            form.__lastValue = copyEditorValue(value);
            if (Object.keys(patch).length) this._emit(patch);
        });
        form.__names = names;
        return form;
    }

    _section(titleKey, node, open) {
        return BuschUI.section({title:this._ui(titleKey),content:node,open:!!open});
    }

    _build() {
        const root = this.shadowRoot;
        root.innerHTML = '';
        const style = document.createElement('style');
        style.textContent = EDITOR_STYLES;
        root.appendChild(style);

        const wrap = document.createElement('div');
        wrap.className = 'ed busch-ui-editor';

        // --- what to control
        this._forms.basic = this._makeForm(
            ['entity', 'entities', 'title', 'icon', 'description', 'show_description']
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
            ['off_color', 'default_color', 'slider', 'icon_size', 'hue_borders', 'show_switch', 'allow_zero',
                'off_shadow', 'live_update', 'is_visible', 'theme']
        );
        const lookBox = document.createElement('div');
        lookBox.appendChild(this._forms.look);
        wrap.appendChild(this._section('sectionLook', lookBox, false));

        // --- actions
        this._forms.actions = this._makeForm(['tap_action', 'hold_action', 'api_id']);
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
            form.__lastValue = copyEditorValue(form.data);
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
                const focused = this.shadowRoot.activeElement;
                this._sceneForms.forEach((form, index) => {
                    if (focused === form || form.contains(focused)) return;
                    form.data = this._sceneData(scenes[index]);
                    form.__lastValue = copyEditorValue(form.data);
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

        const form = BuschUI.ha.form();
        form.hass = this._hass;
        form.data = this._sceneData(scene);
        form.__lastValue = copyEditorValue(form.data);
        form.schema = sceneRowSchema();
        // A scene row's four fields share their names with the card's own
        // options, so they get their own dictionary keys instead of borrowing
        // the wrong helper.
        const sceneKey = (item) => 'scene_' + item.name;
        form.computeLabel = (item) => (item.name ? fieldLabel(this._hass, sceneKey(item)) : '');
        form.computeHelper = (item) => (item.name ? fieldHelper(this._hass, sceneKey(item)) : '');
        form.addEventListener('value-changed', (event) => {
            event.stopPropagation();
            const value = event.detail.value || {};
            const patch = changedEditorFields(form.__lastValue, value);
            form.__lastValue = copyEditorValue(value);
            if (!Object.keys(patch).length) return;
            const current = (this._config.scenes || [])[index];
            const next = typeof current === 'string' ? { entity: current } : Object.assign({}, current);
            Object.keys(patch).forEach((key) => {
                const updated = key === 'color' ? rgbArrayToHex(patch[key]) : patch[key];
                if (updated === '' || updated === null || updated === undefined) delete next[key];
                else next[key] = updated;
            });
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
        const button=BuschUI.action({label:this._ui(labelKey),icon,disabled,onClick});
        button.className+=' iconbtn';button.title=this._ui(labelKey);return button;
    }

    /**
     * Everything this card touches: the resolved lights **and** the groups it
     * walked through. Scenes often name the group rather than its lamps — in
     * this installation `scene.taglicht_2` lists `light.beispiel_spots`,
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
