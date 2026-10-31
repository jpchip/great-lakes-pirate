# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow `0.<phase>.<patch>` until 1.0 ([plan 17 §7](plans/17-testing-performance-release.md)).

## [Unreleased]

### Added

- **The Twin Ports and Two Harbors zones** baked from NOAA and USGS data (not loaded in the game yet): Duluth, Superior, Minnesota and Wisconsin Points and St. Louis Bay in 16 tiles, and Agate Bay and the North Shore bluffs in 9. The Duluth Ship Canal and Superior Entry are dredged through at their real widths, and Agate Bay is widened into a basin for the ore docks. Duluth, Superior and Two Harbors join `data/ports.json` ([plan 03 §21](plans/03-world-scale-chart-travel.md)).
- **Cuts** in the geo bake's hand-edit layer: a set piece can dredge a channel to a depth, which opens 1:1 harbor entries through compressed land.

## [0.2.0] - 2026-10-31

The **Superior Slice** (Phase 2): the whole Apostles zone and Chequamegon Bay to sail with no loading screen, the weather sim running the sky, the seven lighthouses of 1900, harbors at Bayfield and Ashland, and the sounds of weather, shore and harbor.

### Added

- **The whole Apostles zone:** all 56 tiles from Eagle Island to Outer Island and down to Ashland and the Bad River mouth, sailable with no loading screen. Terrain meshes stream around the camera with geomipmapped LOD built in a worker, over a whole-zone backdrop (at most 24 terrain draw calls on Medium). Fog closes in over the last kilometer of the zone, a "Zone edge" chip warns, and the ship is held at the very edge ([plan 03 §17](plans/03-world-scale-chart-travel.md)).
- **`data/zones.json` and `data/islands.json`** with schemas; the geo bake reads them. Its new hand-edit layer raises Gull Island, keeps Long Island's clip, and flattens the Bayfield and Ashland set-piece footprints.
- **`?spawn=x,z,heading`** starts anywhere in the zone, and **`/bench/stream/`** (`npm run bench:stream`) times streaming along the Bayfield–Ashland–Outer Island route.
- **Weather v1:** the S9 weather sim now drives the wind, visibility and cloud while sailing, so the weather changes on its own as lows and highs cross the lake. The dev panel and the playtest switches still override it, and **Use sim weather** hands it back ([plan 04 §24](plans/04-water-weather-seasons.md)).
- **Barometer** on the HUD, under the clock: inches of mercury with a trend arrow, red when it falls fast ([plan 04 §24](plans/04-water-weather-seasons.md)).
- **The Apostles' look:** a style B terrain shader with pale beaches, red sandstone bluffs in beds over dark wave-washed rock, meadows and forest floor, and a canopy color on far forest; and about 250k pines, birches and shore rocks planted from a vegetation density map, as instanced meshes near the ship and baked impostors out to 1.8 km on Medium. Each preset sets the density and distances ([plan 14 §17](plans/14-art-direction-asset-pipeline.md)).
- **Lees behind wooded islands are longer:** the shelter maps count a 15 m forest canopy (`npm run geo:canopy` applies it to an existing bake).
- **Weather you can see:** lighting by sun height and weather (clear, overcast, thunderstorm and fog columns drawn from the photochrom palette), two drifting cloud layers, rain streaks with wet surfaces, fog bank walls you can watch come across the water, and summer thunderstorms with lightning. The dev panel gets Rain and Thunderstorm sliders, and `?rain`, `?storm`, `?fog`, `?cloud`, `?fogbank` and `?seed` set the sky for a look ([plan 04 §25](plans/04-water-weather-seasons.md)).
- **The seven lighthouses of 1900:** Raspberry, Sand, Devils, Outer and Michigan Islands, La Pointe and Chequamegon Point stand on the Apostles' shores in three tower styles. From dusk their lanterns and windows glow, Raspberry and Outer Island flash a sweeping beam every 90 s, Sand Island shows a fixed white light and Devils Island its temporary fixed red, and the nearest light lights the ground around it. `?light=raspberry` spawns you in front of one ([plan 14 §18](plans/14-art-direction-asset-pipeline.md)).
- **Harbors at Bayfield and Ashland:** Bayfield's waterfront with the city dock, fish company dock and mill dock, the fish packing house, cooperage, sawmill and a town of about 70 houses up the hill; Ashland's 520 m Soo Line ore dock at full size, its lumber and city docks, and a bigger town. Windows light up from dusk. You can dock at every pier, and `?harbor=bayfield` (or `ashland`, `,1`, `,2`) starts you off one ([plan 03 §18](plans/03-world-scale-chart-travel.md)).
- **Weather and harbor audio:** rain that follows the rain on the water, thunder that arrives about 3 s per kilometer after the lightning from where it struck, and in fog a low hush and drips off the rigging, with distant sounds dulled. Outer Island sounds a steam fog whistle and Raspberry Island and La Pointe ring fog bells when fog closes in, each with its own rhythm and heard from its direction, so you can steer by ear. Gulls gather along the shores and around the Bayfield and Ashland docks by day, and loons call across calm water at dusk and through the night ([plan 15 §14](plans/15-audio.md)).
- **Open-water music v1:** a waltz on concertina and guitar by day and a slow tin-whistle air over a fiddle drone at night, each followed by a long silence. It fades out in fog and heavy weather, and dips under the fog signals. Both tunes are original and synthesized for now (`npm run audio:synth`).
- **Sound settings:** a Sound tab on the settings screen with Master, Music, Weather & wildlife, and Ship & signals volumes and a mute, kept between sessions.
- The water bench also times the terrain and the vegetation.
- **`?timewarp=<n>`** and a **Clock speed** slider in the dev panel's Time folder run the clock and weather up to 120× faster while the ship sails at normal speed, so a game week of weather fits in a playtest (60× is a game day a real minute).
- **`data/climate.json`:** monthly climate for western Superior from NOAA normals (Madeline Island air, GLERL lake temperature) and Devils Island wind, with the sim's tuning beside it.

### Changed

- The greybox pier in the Bayfield test bay is replaced by the harbor piers.
- **Docking along the whole pier:** every pier has berths on both sides from its end back toward the shore wherever the water is deep enough, not just one pair at the end. A refused F or anchor press now says why on the HUD ("No berth in reach", "Too fast to dock").
- **Water is cheaper on every preset:** it draws after the land and ships so hidden water isn't shaded, cat's-paws use one noise octave and are off on Low, and the water's noise skips pixels where it can't show ([plan 04 §23](plans/04-water-weather-seasons.md)).
- **Saves are version 2:** the weather is saved with the run. A 0.1.0 save migrates and catches up on weather when loaded.
- **Retuned climate:** colder spring lake, May winds from the northeast, and far fewer summer gales. November is still the stormy month, at about four times the observed gale time.
- The **S7 scale greybox** and the **S8 chart arena** now sail the T1 on the plan 02 controller and hazards instead of their Phase 0 stand-in helms, which are deleted. The greybox gets a steady test wind (`?wind=<deg>&windkn=<kn>` and a Wind folder) and the full sailing tuning panel; the arena sails in the chart's wind and shows hull, rigging and strain ([plan 02 §14](plans/02-arcade-sailing.md), [plan 03 §15–16](plans/03-world-scale-chart-travel.md)).
- The HUD speed reads 0.0 at rest instead of -0.0 while the ship drifts.

### Known limitations

- The zone ends at a fog wall: there's no chart travel yet to Duluth, Superior or Two Harbors (Phase 3).
- Washburn, La Pointe, Red Cliff and Bad River have no set pieces yet (Phase 4, with trading).
- The lighthouses are scenery: no keepers and no detection until Phase 5.
- The open-water music is two synthesized placeholder tunes, and the fog signals have no on-screen caption.
- There are no NPC ships yet, so Ashland's ore dock stands empty.
- Weather is one sample for the whole zone; lees and channels still shape it locally.

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

[Unreleased]: https://github.com/jpchip/great-lakes-pirate/compare/0.2.0...HEAD
[0.2.0]: https://github.com/jpchip/great-lakes-pirate/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/jpchip/great-lakes-pirate/releases/tag/0.1.0
