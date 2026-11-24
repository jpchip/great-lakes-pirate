# Great Lakes Pirate

**The Caribbean had Blackbeard. Lake Superior had “Roaring” Dan Seavey—and now it has you.**

It’s spring 1900. Ore freighters choke the Duluth ship canal. Lighthouses sweep the Apostle Islands. The revenue cutter _Morrill_ prowls the lanes while Hollister Fish & Packing counts every crate in the warehouse. You’re nobody—yet—with a small schooner, a ledger that looks honest, and a knack for being somewhere else when the sun comes up.

By day you haul grain, lumber, and fish like any captain trying to eat. By night you slip through the docks district: steal cargo, fence goods, sabotage a rival’s rigging, vanish before the watch bell. At sea you chase fall gales for the richest runs, duck patrols, intimidate steamers into surrender, or explore sea caves and wrecks the charts don’t bother to name. Build hideouts on remote islands—grid by grid—stash contraband, craft, customize. Grow **Fame** so fences and contacts open up; grow **Wanted** and the lake gets smaller, meaner, and more personal.

This is an **open sandbox**: no scripted hero’s journey. Go fully legit (harder margins, no heat), go full outlaw, or live in the grey between. Violence pays—but it brings heat you may not survive. Permadeath is real. The lakes are real. The tall tales are yours to write.

_Sid Meier’s Pirates!_ meets _Sea of Thieves_ meets a grid base-builder—set on western Lake Superior instead of the Spanish Main, with a stealth layer in the port at night and seasons that can freeze the lake solid under your keel.

---

## What you’ll do

| Rhythm               | What happens                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Day (port)**       | Trade, contracts, upgrades, rumors, harbor fees—the respectable face                                    |
| **Night (docks)**    | Stealth, theft, fencing, sabotage—the shadow face                                                       |
| **At sea**           | Arcade sailing with wind and weather, chart travel across open water, ambushes, exploration, evasion    |
| **Ashore (islands)** | Walk forests and cliffs, poach, raid lighthouses, discover secrets, expand hideouts                     |
| **Winter**           | Risky ice sailing, smuggling on frozen routes, warehouse jobs, hideout projects—or skip ahead to spring |

The whole game is set on western Lake Superior. The other Great Lakes may come after 1.0 as expansion packs. Real geography compressed into a believable playground, grounded in 1900 industry (ore, grain, lumber, fishing, brownstone quarries) with legend layered on top—moon-cussing wrecks, venison poaching, whiskey-fueled hijacks—without turning real communities into targets.

---

## Design pillars

1. **Big lakes, real feel** — Hybrid scale: detailed coasts and islands, abstracted open-water crossings with random encounters.
2. **Two faces** — Honest trader by day, pirate by night; your mix is your story.
3. **Consequences** — Separate **Fame** and **Wanted**; optional violence; regional heat; jail, bail, jailbreak, and high-stakes capture.
4. **Hideouts are yours** — Multiple grid-based bases for storage, crafting, and customization.
5. **Discovery** — Apostles sea caves, wrecks, shoals, and secrets worth leaving the shipping lanes.
6. **Grounded history, tall-tale tone** — Real ports and lighthouses; fictional companies where needed; inspired by Seavey’s era, not a biography sim.

---

## Project status

**Phase 9 (Seasons & Secrets) is built, as version 0.9.0, the Beta.** The year turns: from December the bays freeze, a winter is milder or harder by the run's seed, a frozen-in port holds its ships until ice-out, and the ice breaks up in spring. Walk out on the ice (it cracks and gives way if it's thin), haul a sled of cargo down the ice road from Bayfield to La Pointe, and watch your warmth in the wind. Every one of the 22 Apostles can be landed on and walked, with fish camps, farms, trappers' cabins, quarries and their people; go into the sea caves of Devils Island, Sand Island and the mainland cliffs, or an ice cave in winter. Hunt deer for venison (contraband), keep clear of the bears and wolves, and run traplines. Grapple old cargo up from the lake's wrecks, hang a false light to wreck a passing steamer, run down six saloon legends from their clues to a dig, and sit in at poker night with a card up your sleeve. Copycat rivals take to the lake once you're known, Hollister feuds with you over his fish dock, the papers give you a nickname, and a run can end on a farm, behind a saloon bar or with a deputy's badge, kept in the Hall of Captains. Five more hideout sites (Hermit, Devils, Outer, Minnesota Point and the North Shore) bring every background to its own, and four new stations (sail loft, smokehouse, powder room, cartography table) join the workshop. Duluth's waterfront can be walked and burgled, the revenue cutter's hail says what heaving to would cost, and the islands and the winter can be heard. Phases 0–8 are done (the hideouts and grid building came in 0.8.0); Phase 10 (polish and release, ending at 1.0) comes next. See the [changelog](CHANGELOG.md) for everything, and its known limitations. The region is **western Lake Superior**: Duluth, Superior, Two Harbors, Ashland, Bayfield, Washburn, La Pointe, Siskiwit Bay and the Apostle Islands, with the Red Cliff Ojibwe community as a trading partner (Bad River's landing comes later).

**MVP scope:** arcade sailing with weather, hybrid travel (detailed coasts plus chart travel), trading, Fame/Wanted with the revenue cutter and lighthouses, freighter piracy, one docks district (Bayfield, whose lockup holds every MVP prisoner), one fully walkable island, two hideouts with grid building (Stockton Island and the Siskiwit camp), and the season from the May 1900 start through freeze-up.

---

## Roadmap

Solo developer, so each phase ends with something playable. Versions follow `0.<phase>.<patch>`.

| Phase | Name                     | Goal                                                                                | Version                                 |
| ----- | ------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------- |
| 0     | Foundations              | Repo scaffold, core skeleton, local build and CI, spikes S1–S6 and prototypes S7–S9 | 0.0.x                                   |
| 1     | Sailing Prototype        | Sailing feels good: water, wind, schooner, camera                                   | 0.1.x                                   |
| 2     | Superior Slice           | The Apostles and Chequamegon Bay feel real                                          | 0.2.x                                   |
| 3     | Hybrid Travel            | Chart travel, open-water encounters, Duluth/Superior/Two Harbors                    | 0.3.x                                   |
| 4     | Trade & Economy          | Markets, cargo, upgrades v1, save/load                                              | 0.4.x                                   |
| 5     | Law, Fame & Wanted       | Cutters, lighthouse detection, jail                                                 | 0.5.x                                   |
| 6     | Piracy & Combat          | Freighter AI, cannons, boarding, fences                                             | 0.6.x                                   |
| 7     | On Foot: Docks & Islands | Bayfield docks district, stealth, one walkable island                               | 0.7.x                                   |
| 8     | Hideouts                 | Grid building, crafting, two hideouts                                               | **0.8.x = MVP / Alpha** (built, 0.8.0)  |
| 9     | Seasons & Secrets        | Winter, secrets, wrecking, events, newspapers                                       | **0.9.x = Beta** (built, 0.9.0)         |
| 10    | Polish & Release         | Audio, UI polish, performance, tutorial, playtests                                  | 0.10.x release candidates, then **1.0** |

1.0 is western Lake Superior only. The other lakes (Lake Michigan, the Soo Locks and Huron, Erie and Ontario) aren't in 1.0; they may come afterward as expansion packs. Full detail is in [00 §7](plans/00-master-plan.md#7-phased-roadmap) and [17](plans/17-testing-performance-release.md).

---

## Plans

Start with the [master plan](plans/00-master-plan.md): vision, core loop, roadmap and the decisions log. The system plans own the details; where they differ from the master plan, the system plan wins.

| #   | Plan                                                                                                     |
| --- | -------------------------------------------------------------------------------------------------------- |
| 00  | [Master plan](plans/00-master-plan.md)                                                                   |
| 01  | [Tech stack, architecture & project setup](plans/01-tech-architecture.md)                                |
| 02  | [Arcade sailing & ship handling](plans/02-arcade-sailing.md)                                             |
| 03  | [World, hybrid scale, chart travel & streaming](plans/03-world-scale-chart-travel.md)                    |
| 04  | [Water, weather, seasons, day/night](plans/04-water-weather-seasons.md)                                  |
| 05  | [Ports, economy & trading](plans/05-ports-economy-trading.md)                                            |
| 06  | [Fame, Wanted, law enforcement & lighthouses](plans/06-fame-wanted-law-lighthouses.md)                   |
| 07  | [Combat, boarding & targets](plans/07-combat-boarding-targets.md)                                        |
| 08  | [Docks district stealth](plans/08-docks-district-stealth.md)                                             |
| 09  | [Hideouts, grid building & crafting](plans/09-hideouts-building-crafting.md)                             |
| 10  | [Ship upgrades & customization](plans/10-ship-upgrades-customization.md)                                 |
| 11  | [Exploration, islands & secrets](plans/11-exploration-islands-secrets.md)                                |
| 12  | [Sandbox goals, events, character creation & failure](plans/12-sandbox-events-character-failure.md)      |
| 13  | [UI/UX](plans/13-ui-ux.md)                                                                               |
| 14  | [Art direction & asset pipeline](plans/14-art-direction-asset-pipeline.md)                               |
| 15  | [Audio](plans/15-audio.md)                                                                               |
| 16  | [Save/persistence](plans/16-save-persistence.md)                                                         |
| 17  | [Testing, performance & release](plans/17-testing-performance-release.md)                                |
| R1  | [Research: western Lake Superior circa 1900](plans/R1-western-superior-1900-research.md)                 |
| R1a | [Western Superior gazetteer](plans/R1a-western-superior-gazetteer.md) (ports, Wanted regions, distances) |

Historical inspiration: [`references/dan_seavey.md`](references/dan_seavey.md) (mechanics and tone only; Seavey himself does not appear). Reference art for the schooner, early freighters and ferry lives in [`references/`](references/).

---

## Tech

A browser game for **desktop** (current Chrome, Edge, Firefox and Safari; WebGL2 minimum), mouse and keyboard only. Open source, not sold, with no backend. Details in [01](plans/01-tech-architecture.md).

| Area               | Choice                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Language and build | TypeScript (strict), Vite, npm                                                                                                                |
| 3D                 | three.js; spike S1 picks `WebGLRenderer` or `WebGPURenderer` on the baseline laptop                                                           |
| Simulation         | Custom arcade ship model (no physics engine), miniplex ECS, zod-validated JSON data                                                           |
| UI                 | Preact + signals as a DOM overlay                                                                                                             |
| Saves              | IndexedDB via `idb`, compressed with fflate; autosave only (permadeath), versioned with migrations                                            |
| Testing            | Vitest and fast-check for the sim, Playwright smoke tests (CI runs without WebGL)                                                             |
| Lint/format        | ESLint + Prettier                                                                                                                             |
| Assets             | Procedural and CC0 first (Kenney, Quaternius, Poly Pizza); Meshy and nano-banana fill gaps; gltf-transform plus headless Blender, run locally |
| Geodata            | GDAL scripts bake bathymetry and coastline tiles locally                                                                                      |
| Large files        | Git LFS for new binaries (the existing `references/` PNGs stay plain git files)                                                               |

**Performance target:** 60 fps on the Medium preset, 30 fps floor on Low, on a Ryzen 7 7730U laptop with integrated Radeon graphics on Linux.

**Builds run locally for now.** CI covers lint, typecheck, tests, build and smoke tests. Hosting (a static site on a DigitalOcean droplet with an optional itch.io mirror) comes later and stays unlisted until Beta.

---

## Development

Requires Node 22+ and [Git LFS](https://git-lfs.com/) (binaries such as models, textures and audio are stored in LFS).

```sh
git lfs install
npm ci
npm run dev        # Vite dev server
npm test           # Vitest unit, data and save-migration tests
npm run lint       # ESLint, including layer import rules
npm run typecheck
npm run build
npm run e2e        # Playwright: null-renderer smoke (CI) plus WebGL check (local only)
```

`npm ci` also points git at `.githooks/`, whose pre-commit hook runs Prettier on the staged files so CI's format check passes. In a clone set up before the hook was added, run `npm run prepare` once. Skip the hook for a commit with `git commit --no-verify`.

The app opens on the main menu: Continue the saved run, or start a New run from character creation. `?play` skips the menu (continuing the run, or starting off Bayfield in the T1 if there is none), and `?newrun=<background>` starts a new captain of that background (`deckhand`, `fisherman`, `lumberjack`, `saloon_keeper`, `ex_navy`, `poacher`). Keys: A/D steer, W/S raise and lower sail, Q/E trim (with manual trim on), X anchor, F dock or cast off (and come alongside the smuggler), L light or douse the lantern, P the port screen while docked, J the journal and ledger, K a patch or mend kit, R sweeps, H hail, Z lie at anchor, G go ashore (from a berth, or into the boat at anchor), Tab to aim (1/2/3 the swivel, broadside and rifle, C the shot, left mouse fires), M the chart (sail into a zone's edge fog to take to it, or look at it anywhere else), drag to orbit, wheel to zoom, right mouse for the spyglass, Esc for settings. On foot: WASD to walk, Shift to sprint, C to crouch, Space to hop, Q/E to lean, F to use, 1–9 your tools, B build mode at a hideout, M a look at the chart and J the journal (its Messages page keeps every notice). URL options: `?quality=low|medium|high` picks a preset, `?weather=calm|light|moderate|fresh|strong|gale` sets the wind, `?gale` starts the scripted gale, `?wind=<degrees>` and `?knots=<kn>` set where the wind comes from and how hard, `?day=<n>&hour=<h>` sets the time (each game day is a calendar week from May 7, 1900), `?date=1901-02-10` jumps to a calendar date (for winter), `?timewarp=<n>` runs the clock and weather up to 120× faster while the ship sails at normal speed, `?rain`, `?storm`, `?fog`, `?cloud` and `?fogbank` set the sky, `?spawn=x,z,heading`, `?zone=<id>` (with `?entry=west`), `?harbor=bayfield|ashland|washburn|la_pointe|stockton|duluth|superior|two_harbors|duluth_canal|superior_entry` and `?light=<name>` start you somewhere else, `?ashore=<island>` lands you on a walkable island, `?encounter=freighter|barge|steamer|tug|cutter|derelict|squall|fogbank|convoy` drops into an open-water arena (with `?cutter=hunt` for a cutter that hunts you), `?npcs` puts NPC ships around you, `?ship=t2` sails the T2 schooner, `?debug` shows the dev overlay on a production build (it is always on in `npm run dev`), `?bench=water` runs the spike S2 water benchmark ([plan 04 §19](plans/04-water-weather-seasons.md)), and `?renderer=null` boots without WebGL.

Spike pages are dev-only: with `npm run dev` running, open `/onfoot-spike.html` for the on-foot controller spike S5 ([plan 08 §19](plans/08-docks-district-stealth.md)) or `/weather-sim.html` for the weather sim prototype S9 ([plan 04 §20](plans/04-water-weather-seasons.md)). `npm run bench:weather` prints the S9 season report, and `npm run bench:economy` the economy's long balance report (the legit bot from each starting port, the loop hunter, a five-year soak and the world tick with 100+ ships), and `npm run bench:detection` how far each watcher sees the schooner across the moon's phases, lit and dark, and what detection and the law's tick cost. The benches `npm run bench:stream` (`ZONE=twin_ports` or `two_harbors` for the new zones), `bench:chart` and `bench:transitions` run in headless Chromium and save their numbers next to them; run them on real hardware for frame times.

Layout follows [plan 01 §6](plans/01-tech-architecture.md). Save migrations live in `src/core/save/migrations/` with one fixture per save version in `tests/fixtures/saves/` ([plan 16 §7](plans/16-save-persistence.md)).

---

## License

| What                                                          | License                     |
| ------------------------------------------------------------- | --------------------------- |
| Source code, plans, and other software text in this repo      | [MIT](LICENSE)              |
| Original game assets (art, audio, media made for the project) | [CC BY 4.0](LICENSE-ASSETS) |

Reference material under [`references/`](references/) and any third-party or AI-generated assets may use other terms; those are recorded in [`CREDITS.md`](CREDITS.md) as the asset pipeline grows.

---

_Fair winds—or foul, if that’s how you like your profit._
