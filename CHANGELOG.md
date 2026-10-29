# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow `0.<phase>.<patch>` until 1.0 ([plan 17 §7](plans/17-testing-performance-release.md)).

## [Unreleased]

### Changed

- **Water is cheaper on every preset:** it draws after the land and ships so hidden water isn't shaded, cat's-paws use one noise octave and are off on Low, and the water's noise skips pixels where it can't show ([plan 04 §23](plans/04-water-weather-seasons.md)).

## [0.1.0] - 2026-10-29

The **Sailing Prototype** (Phase 1): one T1 schooner you can sail, tack, reef, ground, anchor and dock around a slice of the real Apostle Islands, with every handling number on a tuning panel. This is the first tagged build, so it also carries the Phase 0 foundations.

### Added

- **Test bay** on the real Apostles bake: Bayfield, the North Channel, Red Cliff, Basswood, Hermit and Madeline, with terrain meshes, a whole-zone backdrop in the fog, depth and shoreline queries, the baked shelter, fetch and funneling maps, and a greybox Bayfield pier with two berths ([plan 03 §8.3](plans/03-world-scale-chart-travel.md)).
- **Sailing controller** from plan 02: the polar curve, four sail levels, auto and manual trim, inertia, speed-dependent turning, tacking and jibing, stall in irons, sweeps, leeway and heel on top of the S2 buoyancy. The T1 lives in `data/ships.json` with its schema ([plan 02 §14](plans/02-arcade-sailing.md)).
- **Wind, waves and sky:** dev-panel wind with drift and gusts, wind shadow and calmer seas in island lees, funneling through channels, weather presets from calm to gale, a scripted November gale, sun, moon and sky gradient, and global fog ([plan 04 §21](plans/04-water-weather-seasons.md)).
- **Hazards and mooring:** grounding and rock strikes, kedging off, pier collisions, hull and rigging damage with their effects on speed and sail handling, overpressing strain, knockdowns, anchoring with drag in a blow, and auto-docking and casting off ([plan 02 §14](plans/02-arcade-sailing.md)).
- **Water look and speed cues:** depth bands, shore foam, a far-water ring out to the horizon, bow wave and wake ribbons, spray, wind streaks and cat's-paws that show gusts before they arrive ([plan 04 §22](plans/04-water-weather-seasons.md)).
- **Camera:** chase and orbit with terrain collision and swing-back, a tactical zoom-out, and a spyglass on the right mouse button ([plan 02 §14](plans/02-arcade-sailing.md)).
- **HUD v1 and settings:** wind ring with the no-go zone and best-speed band, speed, sail level, hull and rigging bars, strain, depth, the clock, compass and moon; a settings screen on Esc for the graphics preset, resolution scale, HUD density, camera options, manual trim and key rebinding, kept in a settings store ([plan 13 §12](plans/13-ui-ux.md), [plan 16 §12](plans/16-save-persistence.md)).
- **Procedural T1 schooner** in style B: hull, two raked masts, bowsprit, sails for each level and a slack luffing shape, animated sail changes, booms that swing to the sheet, and a pennant and telltales on the apparent wind ([plan 14](plans/14-art-direction-asset-pipeline.md)).
- **Sailing audio:** procedural wind, rigging whistle and swell beds, 14 CC0 clips for hull wash, slaps, breaking seas, creak, luffing, sail fill, halyards and the anchor, a mixer with buses, and the autoplay unlock. Every clip is listed in `CREDITS.md` ([plan 15](plans/15-audio.md)).
- **Tuning panel** in the dev overlay (`?debug`): every sailing, hazard, weather and audio number live, with sailing presets saved to and loaded from JSON.
- **Playtest URL switches:** `?weather=<preset>`, `?gale`, `?wind=<deg>`, `?knots=<kn>`, `?day=<n>&hour=<h>` and `?quality=low|medium|high`.
- **Phase 0 foundations:** the Vite and TypeScript scaffold, CI (lint, format, typecheck, unit, data and save tests), the fixed-step loop, game clock, mode machine, event bus, seeded RNG, coordinates, input map, ECS, the IndexedDB save layer with migrations, quality presets with dynamic resolution, and the spike pages for the on-foot controller (S5), chart mode (S8) and weather sim (S9).

### Known limitations

- Wind comes from the dev panel and the gale script, not the S9 weather sim (Phase 2).
- The T1 is the only ship class; there are no NPC ships in the test bay.
- Damage and tuning presets aren't part of the run save yet.
- Volume sliders are only in the dev overlay's Audio folder; the settings screen gets them later.
- The S7 scale greybox and the S8 chart arena still use their Phase 0 stand-in helms; moving them onto the plan 02 controller is carried over to Phase 2.

[0.1.0]: https://github.com/jpchip/great-lakes-pirate/releases/tag/v0.1.0
