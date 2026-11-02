# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow `0.<phase>.<patch>` until 1.0 ([plan 17 §7](plans/17-testing-performance-release.md)).

## [Unreleased]

### Added

- **The port screen and trade:** dock at a pier and that port's screen opens over the paused game. The market lists every good with what they ask and what they pay, their stock, what you have aboard and the best price you know of to sell it elsewhere; a quantity slider buys and sells (shift-click for all, ctrl-click for one), and your hold sits beside it with a capacity bar and hot goods marked with an ember diamond. Every visit writes the port's prices into your ledger with the week you saw them: press J at the helm, or open the Ledger tab in port, to compare ports. The chandlery sells patch and mend kits, lamp oil and provisions for the lockers. Esc goes back aboard, P reopens the port while docked, F casts off. Saves move to v6 ([plan 05 §18](plans/05-ports-economy-trading.md)).
- **The economy core:** 23 trade goods counted in cargo units (the T1 holds 20), and markets in Duluth, Superior, Two Harbors, Ashland, Washburn, Bayfield and La Pointe whose prices follow their stock: buying pushes a price up, dumping a hold crashes it, and it recovers over a few weeks, with seasons on top. Money is kept in cents; the purse and the hold are in the save (v5), and a 0.3.0 run carries on as a Deckhand with $150 and some rope and canvas. A loaded hold sits the schooner deeper and slows her by up to a fifth, more for ore than for furs. A balance harness checks that honest trade pays from the first half hour and that no pattern prints money (`npm run bench:economy` for the long run) ([plan 05 §16.8](plans/05-ports-economy-trading.md)).
- **La Pointe and Washburn**, two more harbors in the Apostles zone, built on new set-piece footprints in a rebaked zone. La Pointe on Madeline Island is a small village: a village dock and a fish dock, the old American Fur Company warehouse, St. Joseph's Church and the Old Mission, and a few dozen houses on the low ground behind them. Washburn is a rail and lumber port on Chequamegon Bay's west shore: the Omaha road's coal dock and merchandise dock with its grain elevator between them, the Bigelow mill and its lumber dock, a second sawmill, and the town on the bluff above. The T1 docks at every berth in both, and both join `data/ports.json`. `?harbor=la_pointe` and `?harbor=washburn` start off their docks ([plan 05 §17](plans/05-ports-economy-trading.md)).
- **The T2 schooner:** a 100 ft two-master from the hull generator, half again the T1 with a forecastle house, three hatches, a yawl boat in davits across the stern and a green rail. About 12% faster on every point of sail than the T1, slower to gather way and to tack, with a 2.5–3.2 m draft. The shipyard sells her later in Phase 4; until then `?ship=t2` starts a run in her, and `/bench/ship/?ship=t2` is her contact sheet ([plan 10 §16](plans/10-ship-upgrades-customization.md)).
- **The harbors at work:** sail near a port by day and hear it working: the sawmills' head saws biting through logs at Bayfield, Ashland, Washburn and Superior, caulking mallets at the Superior shipyard, the Bayfield cooper hammering hoops, ore cars dumping into the Ashland and Two Harbors pockets around the clock, and railroad cars banging together as a train takes up its slack along the coal and ore docks and at the depots. Each keeps its 1900 hours and season (the shipyard stops for dinner, the yards stop in a downpour), carries by its own range, and comes from where it is. La Pointe stays a quiet fishing town ([plan 15 §17](plans/15-audio.md)).
- **Trade sounds:** the port screen and the journal open and close with a rustle of paper, a trade counts coins onto the counter (more handfuls for more money, a poured heap past $100) and a pen writes it into the ledger, and the chandler's bill is paid the same way.
- **Captions for fog signals and whistles:** each fog signal and ship's signal you hear gets a line low on screen with an arrow toward it, saying what it is and what it means ("Schooner-barge: fog horn, two blasts (port tack)"), shown when the sound reaches you. On by default; Settings → Sound turns them off.

### Changed

- The package steamer's chime whistle is now a real recording, a multi-bell ship whistle at Owen Sound on Georgian Bay, in place of the synthesized one. The Sound tab's ambience slider is now "Weather, wildlife & harbors".

## [0.3.0] - 2026-11-01

The **Hybrid Travel** build (Phase 3): take to a chart baked from the real lake, plot a course across western Superior through the weather sim's weather, meet ships on their timetables in open-water arenas, and arrive in the Twin Ports and Two Harbors, with harbors to dock at and the run saved wherever you stop.

### Added

- **Continue where you left off:** a reload puts the ship back where the run was last saved, instead of at the North Channel spawn. Saves from 0.2.0 carry over and start at the spawn ([plan 03 §21](plans/03-world-scale-chart-travel.md)).
- **Zones load by id** behind a fade to fog, with the zone just left kept for a minute in case you turn back. The Apostles have entry points on their west, north and east edges for arrivals from the chart. `?zone=` and `?entry=west` start there; with `?debug`, the dev panel's Zone folder changes zone.
- **The real chart:** chart mode's coastline, 173 islands, depth contours and 3,400 soundings are baked from the NOAA bathymetry and USGS DEM for the whole western lake (`npm run geo:chart`), replacing the hand-traced outline. Shallows are shaded by depth, the zone outlines come from the zones' bake settings, and the chart keeps its unchanging layer offscreen so a still or dragged chart redraws in under a millisecond. `/bench/chart/` (`npm run bench:chart`) times it ([plan 03 §22](plans/03-world-scale-chart-travel.md)).
- **The Twin Ports and Two Harbors zones** baked from NOAA and USGS data (not loaded in the game yet): Duluth, Superior, Minnesota and Wisconsin Points and St. Louis Bay in 16 tiles, and Agate Bay and the North Shore bluffs in 9. The Duluth Ship Canal and Superior Entry are dredged through at their real widths, and Agate Bay is widened into a basin for the ore docks. Duluth, Superior and Two Harbors join `data/ports.json` ([plan 03 §23](plans/03-world-scale-chart-travel.md)).
- **Chart mode in the game:** sail into a zone's edge fog and press M (or click **Take to the chart**) to take to the chart, lay a course with the mouse, read its ETA and set sail with the clock running about 3.5 seconds a game hour. Lookouts call ships and squalls on an encounter card (Engage, Avoid with the odds, or Ignore), and a course into another zone loads it at the matching entry. Engaging, or failing to avoid, meets them in an open-water arena and leaving it returns to the chart. M anywhere else in a zone is a look at the chart with the world held; there's no chart inside a harbor. The lookout setting is in settings, and a voyage under way is saved, so a reload comes back on the chart ([plan 03 §24](plans/03-world-scale-chart-travel.md)).
- **Ship whistles you hear in fog:** the NPC ships sound their fog signals under the 1895 Great Lakes rules, three blasts a minute from a steamer and one, two or three on the fog horn from the schooner-barge by her tack, with a bell from a ship lying stopped. Each class has its own whistle: the freighter's deep one, the package steamer's chime, the tug's shrill one and the revenue cutter _Morrill_'s warble. In clear weather a steamer meeting you gives the passing signal. `?npcs&fog=600` to hear them ([plan 15 §15](plans/15-audio.md)).
- **Chart music and encounter stingers:** the chart plays its own traveling tune, "The Long Reach" (concertina, guitar and tin whistle in 6/8), once it has been open a moment, looping until you leave it. Each lookout report has a short stinger: a sail sighted, the cutter seen, the cutter closing with no way out, a squall line and a derelict, and another when you slip away. The loading screen's fade to fog has its own sound, a swell of wind and sea with two strokes of a ship's bell, and the Sound tab gains an Interface slider for it ([plan 15 §16](plans/15-audio.md)).
- **Cuts** in the geo bake's hand-edit layer: a set piece can dredge a channel to a depth, which opens 1:1 harbor entries through compressed land.
- **Open-water arenas:** a 3 × 3 km patch of lake at the encounter point, with the weather sim's wind, sea and sky there, the ships met on their courses (giving way to each other and to you, and steering clear of land), the coast in view as low silhouettes, and fog closing in at the edge. Sail off the edge to leave; the revenue cutter, when hunting, locks you in until you shake her off. Hold F alongside a ship to look her over. `?encounter=freighter` (or `barge`, `steamer`, `tug`, `cutter`, `derelict`, `squall`, `fogbank`, `convoy`) drops into one, with `?at=lat,lon`, `?heading=` and `?cutter=hunt` ([plan 03 §25](plans/03-world-scale-chart-travel.md)).
- **Weather on the chart:** the chart and the zones share one sky. The chart's wind is the weather sim's, and the chart draws its isobars, lows and highs with their tracks, fronts, rain, fog banks, squalls and wind arrows. A weather card shows the barometer, a six-hour outlook and any squall, fog or gale on your course, and **+6 h / +12 h / +24 h** shows the forecast with its uncertainty. Squalls and fog banks on your course are reported by the lookouts and met in an arena where the sim has them; fog hides you (from the cutter too) and a squall shortens sail. In a calm the schooner still ghosts along at about 3 kn, so a crossing in light air isn't a long wait ([plan 03 §28](plans/03-world-scale-chart-travel.md)).
- **Traffic on the lake:** 21 ships sail timetables on ten lanes of a route graph (`data/routes.json`): ore and grain boats down the lake from Duluth, Two Harbors and Ashland, colliers up to Superior, the Duluth–Bayfield–Ashland package line, lumber schooners out of Washburn, fishing tugs on their grounds, and the revenue cutter _Morrill_ on her beat. Fall is busy and the ice months empty; the known lanes are drawn faint on the chart. An encounter director sets each voyage a budget of reports by its length, its lanes and the month, so an Apostles crossing brings about two meetings. Steering clear of a squall or the cutter now costs time, and a squall raised late can still catch you. The _Morrill_ is sighted but hunts no one until Wanted comes in (`?cutter=hunt` to test it). Two derelicts drift on the lake, and an arena brings in any other ships nearby ([plan 03 §26](plans/03-world-scale-chart-travel.md)).
- **Harbors at the Twin Ports and Two Harbors:** sail into Duluth between the Ship Canal's two piers and out of Superior Entry between its pair, both at their real widths, and dock at Duluth's merchandise and coal docks, Superior's city and mill docks, and alongside Two Harbors' wooden ore dock. Grain elevators, the Superior shipyard with a whaleback on the ways, and the towns climbing their hills, with windows lit at night. The 1900 lights: the canal's temporary south pier light, the Superior Entry pierhead light, Two Harbors Light, and the old Minnesota Point tower standing dark. `?harbor=duluth` (or `superior`, `two_harbors`, `duluth_canal`, `superior_entry`) starts there ([plan 03 §27](plans/03-world-scale-chart-travel.md)).
- **Benches for the playtest:** `npm run bench:transitions` times chart to zone (cold and warm), chart to arena and arena to chart, and checks a round trip to another zone gives the heap back; `ZONE=twin_ports` (or `two_harbors`) `npm run bench:stream` flies a route through the new zones.

### Fixed

- NPC ships steamed about twice as fast as their class speed.
- Every zone was laying out the Apostles' harbors and lights, clamped to its edge; each zone now gets only its own.

### Changed

- The "Zone edge" chip is now a **Take to the chart** button, and the save format is version 4 (0.2.0 saves still load).
- November gales bring squalls in their rain, without the lightning of a summer thunderstorm.

### Known limitations

- An Apostles crossing from Duluth takes about 35 real seconds in May and 25 s in October at the default chart clock, against a 20–30 s target: spring's head winds and calms in the sim make it long (plan 03 §29).
- The chart tune, the encounter stingers, the fade-to-fog sound and the ship whistles are synthesized placeholders (`npm run audio:synth`), and the fog signals still have no caption.
- The 1900 characteristics (color, fixed or flashing) of the Duluth canal, Superior Entry and Two Harbors lights are best guesses, not yet checked against the 1900 Light List.
- An encounter is a meeting and a look: no hails, cargo, trading or boarding until Phases 4 and 6, and the revenue cutter is sighted but hunts no one until Wanted comes in (Phase 5).
- Traffic is seen on the chart and met in arenas, but doesn't sail through the zones yet, so the harbors' docks stand empty (Phase 4).
- Siskiwit Bay is a chart area you pass through; its zone comes with the hideout in Phase 8.
- A reload brings the ship back undamaged; the ship's condition joins the save with plan 10.
- A summer squall rains and darkens but doesn't raise the wind, and the chart has no barometer readout on hover yet.
- The Duluth waterfront is the modern one from the DEM (its slips and fills), and Chequamegon Point's spit breaks into fragments on the chart.

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

[Unreleased]: https://github.com/jpchip/great-lakes-pirate/compare/0.3.0...HEAD
[0.3.0]: https://github.com/jpchip/great-lakes-pirate/compare/0.2.0...0.3.0
[0.2.0]: https://github.com/jpchip/great-lakes-pirate/compare/0.1.0...0.2.0
[0.1.0]: https://github.com/jpchip/great-lakes-pirate/releases/tag/0.1.0
