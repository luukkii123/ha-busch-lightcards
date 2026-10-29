# Busch Light Cards

A Hue-like light and scene card for Home Assistant: one card,
**`busch-light-card`**. Its looks follow
[lovelace-hue-like-light-card][upstream] by Gh61, but it handles groups and
unavailable entities differently.

![Card with several lit colours](docs/render/baseline/hue-0.9.0/card-on-480-light.png)
![Card with one lit colour](docs/render/baseline/hue-0.9.0/card-single-480-dark.png)
![Card with warm white light](docs/render/baseline/hue-0.9.0/card-warm-480-light.png)
![Card while everything is off](docs/render/baseline/hue-0.9.0/card-off-480-dark.png)
![Card with the Mushroom-style slider](docs/render/baseline/hue-0.10.0/card-mushroom-480-dark.png)
![Dialog on a phone](docs/render/baseline/hue-0.9.0/dialog-success-320-dark.png)

## What the card does

- **Resolves nested groups on every level.** Home Assistant light groups,
  old-style `group.*` entities, Zigbee2MQTT groups (`group_entities`) and
  Magic Areas groups (`lights`) are walked down to the real lights. A light
  that sits in several groups is shown and switched once; cycles are cut;
  `max_depth` bounds the walk. Only `light.*` and `switch.*` members are kept.
- **Survives unavailable entities.** Counters, brightness and colour come from
  the reachable members only, service calls go only to reachable members, and a
  deleted member renders as unavailable instead of throwing. When a group goes
  unavailable (Home Assistant then drops its member list) the card keeps using
  the last member list it saw. If every member is unreachable, the card is
  disabled and says so.
- **Card in the light colours:** while a light is on, the whole card takes on
  its colour; several colours become a gradient, like the Hue app. Text,
  switch and slider pick light or dark per background so they stay readable
  on yellow and white light too. Off, the card uses the theme (or
  `off_color`). Switching and dimming show at once, before Home Assistant
  answers.
- **Live while dragging**, like the Hue-like card: the lights follow the
  slider on the card, in the dialog (group, single light, light tiles), the
  colour wheel and the white bar while you drag. At most five steps a second
  for one light and one a second for groups, each only after Home Assistant
  confirmed the previous one; on release exactly the end value is sent. The
  slider never jumps back to a lagging state. On a phone a vertical swipe
  over a slider still scrolls the page.
- **Dialog** (opens on tap by default): a header in the light colours, scene
  tiles in their colours, group brightness, a colour
  wheel and a colour-temperature bar (limited to the range all lights support),
  and one tile per light with its own switch. Resolved groups keep their own
  block with their own counter and switch. A master switch sits in the header.
  Escape and the browser's back gesture close the dialog (from a light's detail
  view they first return to the group).
- **Visual editor** with a live preview of the resolution, one-click import of
  every scene that uses the card's lights, and German and English texts
  (following the Home Assistant language).

## Requirements

- Home Assistant **2026.9.3** or newer. Earlier versions are untested.
- Light, switch or group entities. Scenes and scripts are optional.

## Installation

### HACS

1. HACS, three-dot menu, **Custom repositories**.
2. Add `https://github.com/luukkii123/ha-busch-lightcards` with category
   **Dashboard**.
3. Install **Busch Light Cards** and hard-refresh the browser
   (`Ctrl+Shift+R`) so the old file is not served from cache.

### Manual

1. Copy `dist/busch-lightcards.js` to `/config/www/`.
2. Under **Settings, Dashboards, Resources** (three-dot menu) add
   `/local/busch-lightcards.js` as a **JavaScript module**.

## Configuration

Add the card from the card picker and use the visual editor, or write YAML.
Minimal example:

```yaml
type: custom:busch-light-card
entity: light.living_room_all
```

With scenes:

```yaml
type: custom:busch-light-card
entity: light.living_room_all
title: Living room
scenes:
  - entity: scene.daylight
    color: "#ffe0a3"
  - entity: scene.night
    title: Night
    icon: mdi:weather-night
  - scene.autumn
```

### Options

At least one of `entity` or `entities` is required. Every option may also be
written in camelCase (`resolveGroups`, `offColor`, `liveUpdate`, `iconSize`,
`apiId`, `isVisible`, ...), which keeps a config
copied from the upstream card working; the editor folds it into snake_case.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entity` | string | - | The main light, switch or group. |
| `entities` | list of strings | - | Further entities, resolved and merged with `entity`. |
| `title` | [template](#text-templates) | name of the entity | Replaces the name on the card and in the dialog. |
| `icon` | string | icon of the entity, else `mdi:lightbulb-group` | mdi icon of the card. |
| `description` | [template](#text-templates) or `false` | count of lights on | Replaces the line under the title; `%s` inserts the count line. `false` hides the line on the card (the dialog still shows the state). |
| `icon_size` | `original` / `big` / `small` / number | `original` | Size of the card icon. A number scales like in the Hue-like card: `1.42` is original, `2` big, `1` small. |
| `resolve_groups` | boolean | `true` | Walk into nested groups. `false` keeps a group as a single entity (upstream behaviour). |
| `max_depth` | number (1-20 in the editor) | `10` | Maximum number of group levels to descend. |
| `show_unavailable` | boolean | `true` | Show the badge counting unreachable members. |
| `group_display` | `sections` / `flat` | `sections` | Dialog layout: one block per resolved group, or one flat list of tiles. |
| `off_color` | string | theme | Card background while everything is off. Empty uses the theme colour. |
| `default_color` | string | `#ffda95` | Colour for a lit light that reports none. Accepts `#rgb`, `#rrggbb`, `rgb(...)`, `rgba(...)`, `warm`, `cold` and basic colour names. |
| `hue_borders` | boolean | `true` | Stronger rounded corners and the Hue drop shadow. |
| `show_switch` | boolean | `true` | Show the group switch on the card. |
| `slider` | `default` / `mushroom` / `none` | `default` | Brightness slider on the card: the Hue slider with its percentage, a flat slider in the Mushroom style, or none. `true`/`false` from older configs still work. |
| `live_update` | boolean | `true` | Send brightness, colour and white while dragging (see above). `false` sends only on release. |
| `allow_zero` | boolean | `false` | Let the slider reach 0, which turns the group off (otherwise it stops at 1 %). |
| `off_shadow` | boolean | `true` | Inset shadow while everything is off. |
| `tap_action` | `dialog` / `toggle` / `more-info` / `none` | `dialog` | Short tap on the card. |
| `hold_action` | `dialog` / `toggle` / `more-info` / `none` | `more-info` | Holding the card for half a second. |
| `theme` | string | dashboard theme | A Home Assistant theme for this card and its dialog only. |
| `api_id` | string (letters, digits, `_`, `-`) | - | Makes the dialog openable from elsewhere, see [API](#api). |
| `is_visible` | boolean | `true` | `false` hides the card; its dialog still opens through `api_id`. |
| `scenes` | list | `[]` | Scene tiles at the top of the dialog; see below. |

`scenes` entries are either an entity id (scene or script) or an object:

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entity` | string | - (required) | The scene or script the tile triggers. |
| `title` | string | name of the entity | Text on the tile. |
| `icon` | string | icon of the entity, else `mdi:palette` | Icon on the tile. |
| `color` | string or `[r, g, b]` | `#ffda95` | Colour of the tile. |

The visual editor writes only options that differ from their default.

### Text templates

`title` and `description` may show states and attributes, with the syntax of
the Hue-like card:

```yaml
title: TV - {{ light.tv_backlight }}
description: "%s ({{ light.desk.brightness }})"
```

`{{ light.x }}` is the formatted state, `{{ light.x.brightness }}` an
attribute (an unknown attribute falls back to the state). In `description`,
`%s` inserts the line the card would show otherwise (for example
"2 of 5 on"). A missing entity shows as `‹light.x missing›`. Templates are
plain text: nothing is evaluated and no HTML is rendered.

### API

With `api_id: living_room` the card publishes
`window.busch_light_card.living_room_openHueScreen()` (also
`living_room_openDialog()`), and any link ending in
`#busch_light_card:living_room_openHueScreen` opens its dialog, for example
from a button card's `navigation_path`. The names follow the Hue-like card's
`hue_card` API but use their own object, so both cards can be installed side
by side. Combine with `is_visible: false` to have only the dialog.

### Sections layout

The card takes 12 grid columns (minimum 6) and leaves the height to Home
Assistant, which measures the content.

### Theme variables

The card reads these CSS variables with built-in fallbacks. They are declared
on the card element itself, so set them on `busch-light-card` (for example with
card-mod), not only on `:root`.

| Variable | Used for |
| --- | --- |
| `--blc-background`, `--blc-text-color`, `--blc-shadow` | Card background (the light colours while on), text and shadow |
| `--blc-toggle-off`, `--blc-toggle-on`, `--blc-knob-color` | Switch track and knob (also on the coloured card) |
| `--blc-accent` | Accent of the card (default `--primary-color`) |
| `--blc-dialog-bg`, `--blc-dialog-text`, `--blc-dialog-invert`, `--blc-dialog-tile`, `--blc-dialog-muted`, `--blc-dialog-dim`, `--blc-dialog-faint`, `--blc-dialog-line`, `--blc-dialog-dead-a`, `--blc-dialog-dead-b`, `--blc-scene-badge` | Dialog surface, text, tiles, lines, hatching of unreachable lights and the scene badge. The dialog is dark in both Home Assistant themes by default; its header and the lit tiles take the light colours. |

## Development

Notes on the test setup are in [docs/entwicklung.md](docs/entwicklung.md).

## Credits

The look and the feel follow the
[Hue-Like Light Card][upstream] by Gh61 (LGPL-2.1): the pacing of live updates
while dragging (interval, waiting for Home Assistant, hold time), the text
template syntax, the slider types and the `icon_size`, `theme`, `api_id` and
`is_visible` options with their camelCase names. They were re-implemented
here from that card's documented behaviour and source; no code was copied.

## License

MIT, see [LICENSE](LICENSE). Not affiliated with, or endorsed by,
Signify/Philips Hue.

[upstream]: https://github.com/Gh61/lovelace-hue-like-light-card
