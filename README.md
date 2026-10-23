# Great Lakes Pirate

**The Caribbean had Blackbeard. Lake Superior had “Roaring” Dan Seavey—and now it has you.**

It’s spring 1900. Ore freighters choke the Duluth ship canal. Lighthouses sweep the Apostle Islands. The revenue cutter *Morrill* prowls the lanes while Hollister Fish & Packing counts every crate in the warehouse. You’re nobody—yet—with a small schooner, a ledger that looks honest, and a knack for being somewhere else when the sun comes up.

By day you haul grain, lumber, and fish like any captain trying to eat. By night you slip through the docks district: steal cargo, fence goods, sabotage a rival’s rigging, vanish before the watch bell. At sea you chase fall gales for the richest runs, duck patrols, intimidate steamers into surrender, or explore sea caves and wrecks the charts don’t bother to name. Build hideouts on remote islands—grid by grid—stash contraband, craft, customize. Grow **Fame** so fences and contacts open up; grow **Wanted** and the lake gets smaller, meaner, and more personal.

This is an **open sandbox**: no scripted hero’s journey. Go fully legit (harder margins, no heat), go full outlaw, or live in the grey between. Violence pays—but it brings heat you may not survive. Permadeath is real. The lakes are real. The tall tales are yours to write.

*Sid Meier’s Pirates!* meets *Sea of Thieves* meets a grid base-builder—set on western Lake Superior instead of the Spanish Main, with a stealth layer in the port at night and seasons that can freeze the lake solid under your keel.

---

## What you’ll do

| Rhythm | What happens |
|--------|----------------|
| **Day (port)** | Trade, contracts, upgrades, rumors, harbor fees—the respectable face |
| **Night (docks)** | Stealth, theft, fencing, sabotage—the shadow face |
| **At sea** | Arcade sailing with wind and weather, chart travel across open water, ambushes, exploration, evasion |
| **Ashore (islands)** | Walk forests and cliffs, poach, raid lighthouses, discover secrets, expand hideouts |
| **Winter** (from Beta) | Risky ice sailing, smuggling on frozen routes, warehouse jobs, hideout projects—or skip ahead to spring |

Start on western Lake Superior; all five Great Lakes and the connecting waters (Soo Locks and beyond) arrive before 1.0. Real geography compressed into a believable playground, grounded in 1900 industry (ore, grain, lumber, fishing, brownstone quarries) with legend layered on top—moon-cussing wrecks, venison poaching, whiskey-fueled hijacks—without turning real communities into targets.

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

**Planning complete; Phase 0 (Foundations) is next.** Every system plan (00–17) and the research docs (R1, R1a) are drafted with their decisions recorded. There is no playable build yet. The MVP region is **western Lake Superior**: Duluth, Superior, Two Harbors, Ashland, Bayfield, Washburn, La Pointe, Siskiwit Bay and the Apostle Islands, with the Red Cliff and Bad River Ojibwe communities as trading partners.

**MVP scope:** arcade sailing with weather, hybrid travel (detailed coasts plus chart travel), trading, Fame/Wanted with the revenue cutter and lighthouses, freighter piracy, one docks district (Bayfield, whose lockup holds every MVP prisoner), one fully walkable island, two hideouts with grid building (Stockton Island and the Siskiwit camp), and the season from the May 1900 start through freeze-up.

---

## Roadmap

Solo developer, so each phase ends with something playable. Versions follow `0.<phase>.<patch>`.

| Phase | Name | Goal | Version |
|---|---|---|---|
| 0 | Foundations | Repo scaffold, core skeleton, local build and CI, spikes S1–S6 and prototypes S7–S9 | 0.0.x |
| 1 | Sailing Prototype | Sailing feels good: water, wind, schooner, camera | 0.1.x |
| 2 | Superior Slice | The Apostles and Chequamegon Bay feel real | 0.2.x |
| 3 | Hybrid Travel | Chart travel, open-water encounters, Duluth/Superior/Two Harbors | 0.3.x |
| 4 | Trade & Economy | Markets, cargo, upgrades v1, save/load | 0.4.x |
| 5 | Law, Fame & Wanted | Cutters, lighthouse detection, jail | 0.5.x |
| 6 | Piracy & Combat | Freighter AI, cannons, boarding, fences | 0.6.x |
| 7 | On Foot: Docks & Islands | Bayfield docks district, stealth, one walkable island | 0.7.x |
| 8 | Hideouts | Grid building, crafting, two hideouts | **0.8.x = MVP / Alpha** (invited testers) |
| 9 | Seasons & Secrets | Winter, secrets, wrecking, events, newspapers | **0.9.x = Beta** (first public release) |
| 10 | Expand the Lakes | Lake Michigan, then Huron, Erie, Ontario and the Soo Locks | 0.10.x |
| 11 | Polish & Release | Audio, UI polish, performance, tutorial, playtests | 0.11.x release candidates, then **1.0** |

The lake expansions (Phase 10) ship before the final polish pass (Phase 11), so all five lakes are in 1.0. Full detail is in [00 §7](plans/00-master-plan.md#7-phased-roadmap) and [17](plans/17-testing-performance-release.md).

---

## Plans

Start with the [master plan](plans/00-master-plan.md): vision, core loop, roadmap and the decisions log. The system plans own the details; where they differ from the master plan, the system plan wins.

| # | Plan |
|---|---|
| 00 | [Master plan](plans/00-master-plan.md) |
| 01 | [Tech stack, architecture & project setup](plans/01-tech-architecture.md) |
| 02 | [Arcade sailing & ship handling](plans/02-arcade-sailing.md) |
| 03 | [World, hybrid scale, chart travel & streaming](plans/03-world-scale-chart-travel.md) |
| 04 | [Water, weather, seasons, day/night](plans/04-water-weather-seasons.md) |
| 05 | [Ports, economy & trading](plans/05-ports-economy-trading.md) |
| 06 | [Fame, Wanted, law enforcement & lighthouses](plans/06-fame-wanted-law-lighthouses.md) |
| 07 | [Combat, boarding & targets](plans/07-combat-boarding-targets.md) |
| 08 | [Docks district stealth](plans/08-docks-district-stealth.md) |
| 09 | [Hideouts, grid building & crafting](plans/09-hideouts-building-crafting.md) |
| 10 | [Ship upgrades & customization](plans/10-ship-upgrades-customization.md) |
| 11 | [Exploration, islands & secrets](plans/11-exploration-islands-secrets.md) |
| 12 | [Sandbox goals, events, character creation & failure](plans/12-sandbox-events-character-failure.md) |
| 13 | [UI/UX](plans/13-ui-ux.md) |
| 14 | [Art direction & asset pipeline](plans/14-art-direction-asset-pipeline.md) |
| 15 | [Audio](plans/15-audio.md) |
| 16 | [Save/persistence](plans/16-save-persistence.md) |
| 17 | [Testing, performance & release](plans/17-testing-performance-release.md) |
| R1 | [Research: western Lake Superior circa 1900](plans/R1-western-superior-1900-research.md) |
| R1a | [Western Superior gazetteer](plans/R1a-western-superior-gazetteer.md) (ports, Wanted regions, distances) |

Historical inspiration: [`references/dan_seavey.md`](references/dan_seavey.md) (mechanics and tone only; Seavey himself does not appear). Reference art for the schooner, early freighters and ferry lives in [`references/`](references/).

---

## Tech

A browser game for **desktop** (current Chrome, Edge, Firefox and Safari; WebGL2 minimum), mouse and keyboard only. Open source, not sold, with no backend. Details in [01](plans/01-tech-architecture.md).

| Area | Choice |
|---|---|
| Language and build | TypeScript (strict), Vite, npm |
| 3D | three.js; spike S1 picks `WebGLRenderer` or `WebGPURenderer` on the baseline laptop |
| Simulation | Custom arcade ship model (no physics engine), miniplex ECS, zod-validated JSON data |
| UI | Preact + signals as a DOM overlay |
| Saves | IndexedDB via `idb`, compressed with fflate; autosave only (permadeath), versioned with migrations |
| Testing | Vitest and fast-check for the sim, Playwright smoke tests (CI runs without WebGL) |
| Lint/format | ESLint + Prettier |
| Assets | Procedural and CC0 first (Kenney, Quaternius, Poly Pizza); Meshy and nano-banana fill gaps; gltf-transform plus headless Blender, run locally |
| Geodata | GDAL scripts bake bathymetry and coastline tiles locally |
| Large files | Git LFS for new binaries (the existing `references/` PNGs stay plain git files) |

**Performance target:** 60 fps on the Medium preset, 30 fps floor on Low, on a Ryzen 7 7730U laptop with integrated Radeon graphics on Linux.

**Builds run locally for now.** CI covers lint, typecheck, tests, build and smoke tests. Hosting (a static site on a DigitalOcean droplet with an optional itch.io mirror) comes later and stays unlisted until Beta.

---

## License

| What | License |
|------|---------|
| Source code, plans, and other software text in this repo | [MIT](LICENSE) |
| Original game assets (art, audio, media made for the project) | [CC BY 4.0](LICENSE-ASSETS) |

Reference material under [`references/`](references/) and any third-party or AI-generated assets may use other terms; those will be recorded in `ATTRIBUTION.md` as the asset pipeline grows.

---

*Fair winds—or foul, if that’s how you like your profit.*
