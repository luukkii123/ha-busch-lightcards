# Busch Light Cards

A Hue-like light and scene card for Home Assistant. One card:
**`busch-light-card`**.

![The card driving a nested light group](docs/images/card-on.png)

The looks follow [lovelace-hue-like-light-card][upstream] by Gh61 — a big tile
that carries the light's own colour, a brightness slider on the card itself,
and a dialog with scenes, per-light tiles and colour pickers.

Two things work differently, and they are the reason this card exists.

## 1. Groups resolve on every level

Upstream treats `light.a_group` as one entity. It never reads the group's
`entity_id` attribute, so a group inside a group is a black box: you get one
tile, one aggregate state, and no way to reach the lights underneath.

This card walks the tree all the way down.

```
light.magic_areas_..._kinderzimmer_all_lights   (7 members, 3 of them groups)
├── light.kinderzimmer_spot_1
├── light.hubschrauberlampe
├── light.vorhang
├── light.ledstreifen_kinderzimm
├── light.kinderzimmerspots            ──► spot_1, spot_2, spot_3
├── light.lichtgruppe_kinderzimmer     ──► kinderzimmerspots, hubschrauberlampe,
│                                          vorhang, ledstreifen
└── light.leds_kinderzimmer            ──► kinderzimmerspots, vorhang, ledstreifen

resolves to 6 distinct lights, not 7 mixed entities
```

- **Every level**, not just the first. `max_depth` (default 10) is the only bound,
  and reaching it is reported rather than silently swallowed.
- **Duplicates collapse.** A light sitting in three parent groups is counted,
  shown and switched once.
- **Cycles terminate.** A group that contains itself, directly or through a
  chain, is expanded exactly once.
- **Only `light.*` and `switch.*` survive.** An old-style `group.*` holding
  `person.*` or `device_tracker.*` contributes its lights and drops the rest.
- **`entity_id` is followed only on `light`, `switch` and `group`.** `scene.*`
  and `automation.*` carry that attribute too, and expanding those would be
  nonsense.

Set `resolve_groups: false` to get the upstream behaviour back.

## 2. An unavailable entity does not take the card down

Three separate problems, three fixes.

**A dead member no longer poisons the aggregate.** Counters, brightness and
colour come from the reachable members only, and every service call is
addressed to the reachable ones. The card says `4 von 5 an` with a badge
naming what is missing, instead of quietly reporting the wrong number or
pushing a call that Home Assistant rejects.

**A missing entity renders instead of throwing.** Upstream raises
`Entity 'x' not found in states.` when a group member has been deleted from
the registry. Here it becomes a leaf shown as unavailable.

**An unavailable group keeps its members.** This is the one that bites hardest.
Measured on Home Assistant 2026.8.3: when a `light` group goes unavailable, HA
**drops its `entity_id` attribute entirely** — friendly name and colour
capabilities stay, the member list is gone. Any card that reads membership from
live state therefore watches a 12-light group collapse into a single dead
entity. This card remembers the last member list it saw and keeps using it
while the group is unreachable.

> The memory is only consulted while the entity is actually unavailable. An
> available group that lists nothing really is a leaf, and a stale memory must
> not override that. On a cold start — HA restarted while the group was already
> down — there is nothing to remember, and the group degrades to a single
> unavailable entity. That is honest, not fixed.

Only when *every* member is unreachable does the card switch to a disabled
state, and it still says so in words rather than erroring.

## The dialog

![Dialog with scenes, colour wheel and per-light tiles](docs/images/dialog.png)

- **Scene row** — one tile per configured scene, each with its own colour. A
  scene entity that does not exist is greyed out and disabled, not a crash.
- **Group brightness** — moves the lit members while anything is lit, and every
  reachable member when all are off. That is what the Hue app does.
- **Colour / White** — an HSV wheel and a colour-temperature bar drawn along
  Hue's own curve (2000 K → 4200 K → 6500 K), not a black-body approximation.
  The bar spans the **intersection** of the members' supported ranges, so it
  can never ask a lamp for a temperature it cannot do.
- **Light tiles** — one per resolved light. Tap toggles, drag up and down dims,
  press and hold opens that single light's detail view. An unreachable light is
  hatched, inert and named — hiding it would make a missing lamp look like a
  lamp that was never in the group.

<img src="docs/images/dialog-mobile.png" width="320" alt="The same dialog at phone width">

## Install

**HACS → three-dot menu → Custom repositories** →
`luukkii123/ha-busch-lightcards`, category **Dashboard**. Then install, and
hard-refresh the browser (`Ctrl+Shift+R`) — otherwise the old file stays cached.

Manual: drop `dist/busch-lightcards.js` into `/config/www/` and add it under
**Settings → Dashboards → Resources** as a JavaScript module.

## Configure

```yaml
type: custom:busch-light-card
entity: light.magic_areas_light_groups_ld_kinderzimmer_all_lights
scenes:
  - entity: scene.taglicht
    color: "#ffe0a3"
  - entity: scene.nachtlicht
    color: "#2b3a67"
  - scene.herbst
```

| Option | Default | What it does |
| --- | --- | --- |
| `entity` | — | The group or light to control. One of `entity`/`entities` is required. |
| `entities` | — | Several roots at once; all of them are resolved and merged. |
| `title` | group name | Card heading. |
| `icon` | group icon | Card icon. Falls back to `mdi:lightbulb-group`. |
| `description` | auto | Replaces the `4 von 5 an` line with fixed text. |
| `resolve_groups` | `true` | **Set `false` for upstream behaviour**: the group stays one entity. |
| `max_depth` | `10` | How deep to follow nested groups. |
| `show_unavailable` | `true` | Show the badge counting unreachable members. |
| `scenes` | `[]` | Scene entity ids, or `{entity, title, icon, color}` objects. |
| `off_color` | theme | Card background while everything is off. |
| `default_color` | `warm` | Colour used when a lit light reports none. |
| `hue_borders` | `true` | Hue's rounded corners and drop shadow. |
| `show_switch` | `true` | The on/off toggle on the card. |
| `slider` | `true` | The brightness slider on the card. |
| `allow_zero` | `false` | Let the slider reach 0 (which turns the group off). |
| `off_shadow` | `true` | Inset shadow while off. |
| `tap_action` | `dialog` | `dialog`, `toggle`, `more-info` or `none`. |
| `hold_action` | `more-info` | Same set of values. |

Every option is also accepted in camelCase (`resolveGroups`, `offColor`, …) so
a config copied from the upstream card keeps working.

## Proof

`docs/render/render.py` runs the shipped file in real Chromium, serves it over
HTTP (so a stray sub-resource would be a real 404), drives the card's own logic
through `BuschLightCard.__internals`, and writes every assertion, network
request, console error and page error to `report.json`. A sample run is checked
in as `docs/render/report-beispiel.json`.

The fixture in `docs/render/fixture.json` is captured verbatim from a live
Home Assistant 2026.8.3 — real names, real colour capabilities, real kelvin
ranges, real nested membership, and a genuinely unavailable lamp. The only
invented values are the `lit` scenario's brightness and colour, so the
screenshots are not of an all-off card; each is marked `"_synthetic": true`.

```bash
docker run --rm \
  -v "$PWD:/repo" \
  --entrypoint bash mcr.microsoft.com/playwright/python:v1.62.0-noble \
  -c 'pip install --quiet --break-system-packages playwright==1.62.0 >/dev/null; \
      python3 /repo/docs/render/render.py /repo/dist/busch-lightcards.js /repo/docs/render/ergebnis'
```

33 checks, covering: the hand-derived leaf list, duplicate collapse, cycles,
self-reference, deleted members, foreign domains, the depth limit, the
unavailable-group memory (cold and warm), aggregation, service-call routing,
the rendered card text, and the dialog.

**Not yet proven: none of this has run against a live dashboard.** The logic
and the rendering are tested; the two together in a running Home Assistant are
not.

## Why there is no build step

The repository lives on an SMB share where `npm` is not an option. The file is
source and delivery in one: plain custom elements, no Lit, no bundler, no
sub-resources. A HACS dashboard resource cannot serve files from subfolders
anyway, so everything a card needs has to be in the one file.

## Licence

MIT. Not affiliated with, or endorsed by, Signify/Philips Hue.

[upstream]: https://github.com/Gh61/lovelace-hue-like-light-card
