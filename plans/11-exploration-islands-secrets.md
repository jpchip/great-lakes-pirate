# 11 — Exploration, Islands & Secrets

Status: DRAFT v0.5 (decisions made; gap review applied; Phase 7's hero island built in 0.7.0; Phase 9 scope proposed in §18)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan: islands fully walkable, mainland not; secrets on islands; hunting and poaching; lighthouse raids on foot
- [R1](R1-western-superior-1900-research.md): the 22 Apostle Islands, quarries, lights, wrecks, Ojibwe guidance
- [03](03-world-scale-chart-travel.md): walkable islands as on-foot sub-areas, C = 8, going ashore, chart fog of war
- [04](04-water-weather-seasons.md): winter, walkable ice, snow, aurora
- [06](06-fame-wanted-law-lighthouses.md): lighthouses, marshal island searches
- [07 §7.3](07-combat-boarding-targets.md): wreck sites
- [08](08-docks-district-stealth.md): the on-foot controller, perception, swimming, weapons
- [09](09-hideouts-building-crafting.md): sites, the cartography table, salvage, trophies, no gathering
- [05](05-ports-economy-trading.md): venison, furs, rumors
Feeds: 12 (legends as sandbox goals, newspapers), 13 (journal and map UI), 14 (island art, POI kits)

## Purpose

Define what's out there to find, and how finding it works:
- the island catalog and how detailed each island is
- on-foot exploration and its hazards
- hunting and trapping
- sea caves (and winter ice caves)
- wreck salvage
- the clue → map → secret flow
- hand-authored legends vs. seeded caches
- rewards, and the content budget

---

## 1. Goals

1. **Curiosity pays:** sailing off the lanes and walking an island should regularly turn up something: a cache, a wreck, a hideout site, a story.
2. **Every island feels distinct:** lighthouse islands, quarry islands, fish-camp islands, wild islands, the settled island.
3. **Feasible for one developer:** a few hand-crafted *legends*, plus seeded caches and gameplay-born wrecks that give variety per run.
4. **Reuse everything:** the same on-foot controller, perception and kit as the docks districts ([08](08-docks-district-stealth.md)), and the same layout editor ([09 §11](09-hideouts-building-crafting.md)).
5. **Respectful:** mysteries draw on **settler and maritime folklore** and invented tall tales, **not** Ojibwe sacred stories ([R1 §5](R1-western-superior-1900-research.md)).

---

## 2. The Islands

### 2.1 Detail tiers
| Tier | Meaning | Count (MVP) |
|---|---|---|
| **Hero** | Fully walkable, several points of interest (POIs), a hideout site and/or a lighthouse, a legend location | ~8 |
| **Standard** | Walkable terrain, 1–3 POIs (a cache spot, a camp, a viewpoint) | ~8 |
| **Minor** | Small islets: walkable but sparse; a seeded cache candidate or nothing | ~6 |

### 2.2 Catalog (the 22 Apostle Islands; 1900 features from R1, ❓ = verify)
| Island | Tier | 1900 features & game role |
|---|---|---|
| **Madeline** | Hero | Settled; La Pointe village (docks set piece), farms, the old fur-trade post area; ice road in winter |
| **Stockton** | Hero | Abandoned brownstone quarry (closed 1897); a big sheltered bay; **hideout site** |
| **Hermit** | Hero | Abandoned quarry and derrick; **hideout site**; legend: the quarry payroll |
| **Basswood** | Hero | The first brownstone quarry (1868–1893), ruins; a farm ❓ |
| **Devils** | Hero | Light station (new tower, weak temporary light in 1900); **sea caves**; **hideout site** |
| **Sand** | Hero | Light station (1881, brownstone); a farming/fishing settlement ❓; sea caves; the *Sevona* shoal nearby |
| **Outer** | Hero | Remote light station (1874); fish camp; **hideout site** |
| **Raspberry** | Hero | Light station (1863), near Bayfield; a fast-reporting keeper |
| **Michigan** | Standard | Light station (1857), "the unwanted lighthouse" |
| **Long** (with Chequamegon Point) | Standard | La Pointe light (1858) and Chequamegon Point light (1896–97); a long sandspit |
| **Oak** | Standard | High, forested; a lookout viewpoint; logging ❓ |
| **Manitou** | Standard | Fish camp ❓ |
| **Rocky** | Standard | Fish camp ❓; the anchorage between Rocky and South Twin |
| **South Twin** | Standard | Fish camp ❓ |
| **Otter** | Standard | Wild; cache candidate |
| **Bear** | Standard | Wild; cliffs |
| **Cat** | Minor | Wild |
| **Ironwood** | Minor | Wild |
| **York** | Minor | Sandspit |
| **North Twin** | Minor | Remote, tiny |
| **Gull** | Minor | Bird rock, tiny (a cache candidate only) |
| **Eagle** | Minor | Tiny, rocky |

The ❓ entries go on the R1 research list (island-by-island history, item 12).

### 2.3 Point-of-interest types (prefab kits)
Lighthouse station (tower, keeper's house, oil house, fog signal) · quarry ruins (cut ledges, derrick, office shack, block piles) · fish camp (net reels, shanties, fish house, dock) · farmstead (cabin, barn, fields, clearing) · logging camp remnants · trapper's cabin · beach wreckage · viewpoint (cliff top, high ground) · sea cave entrance · **hideout site pads** ([09 §2](09-hideouts-building-crafting.md)).

---

## 3. On-Foot Exploration

### 3.1 Movement & traversal
- The same controller and third-person camera as the docks ([08 §3](08-docks-district-stealth.md)): walk, crouch, run, vault and climb at marked spots, swim.
- **Terrain** is the 1 m on-foot heightmap ([03 §8](03-world-scale-chart-travel.md)). Slopes above a threshold (**42°**, from spike S5, [08 §19](08-docks-district-stealth.md)) aren't walkable, so cliffs are barriers except at authored paths, gullies and ladders.
- **Going ashore:** anchor, take the rowboat to a beach or landing ([03 §7](03-world-scale-chart-travel.md)). You can carry loot back by rowboat or have the ship moored at a dock (lighthouse docks, fish camps, hideouts).
- Clock: R_foot ≈ 6 ([03 §3.3](03-world-scale-chart-travel.md)).

### 3.2 Hazards
| Hazard | Notes |
|---|---|
| **Cold exposure (winter, wet)** | A **warmth meter** on foot in winter, after swimming, or in freezing rain. It's restored by fire (campfire kit, a hideout stove, a keeper's house). At zero: health drains, eventually leading to **death** (permadeath), with clear warnings well before. |
| **Thin ice** | [04 §8.2](04-water-weather-seasons.md): cracking warnings; falling through is a deadly check |
| **Falls** | From cliffs or ladders: damage, and possibly death from high falls |
| **Surf in sea caves** | Rowboat entry is only safe in calm seas. Waves can swamp the rowboat or bash it against rock. |
| **People** | Keepers (witnesses), fishermen at camps (witnesses), marshals searching islands at tier 4+ ([06 §5.3](06-fame-wanted-law-lighthouses.md)), copycat rivals at their stash islands |
| **Wildlife (decided)** | **Black bears** (rare; dangerous if surprised or near their cubs; back away, scare off with noise or a gunshot, or fight with the rifle) and **wolves** in winter (heard more than seen; packs on larger islands or on the ice; they avoid fire). Simple FSM: Wander → Wary → Threaten → Attack/Flee. Animal attacks can injure or kill (permadeath), with clear warning cues (growls, howls, visual tells). Killing animals is not a crime. |

### 3.3 Perception on islands
The same model as [08 §4](08-docks-district-stealth.md): moonlight and fewer lamps make islands darker; there's less noise from surfaces (forest floor) but snow crunches and leaves tracks. Keepers and fishermen use the same FSM, with fewer of them.

---

## 4. Hunting, Poaching & Trapping

The "no gathering" decision ([09 §6](09-hideouts-building-crafting.md)) covers building materials. **Hunting and trapping are economy and crime activities** (Seavey's venison poaching), and both are **in (decided)**.

| Activity | How | Legal status | Output |
|---|---|---|---|
| **Deer hunting / poaching** | Track deer on larger islands (Stockton, Madeline, Oak ❓); shoot with the rifle; field-dress (time); carry the carcass (2 CU, slow) to the boat | **Market hunting is illegal**, so venison sold commercially is **contraband** (R1 backlog #9: verify WI/MN game laws around 1900) | Venison → smokehouse ([09 §7](09-hideouts-building-crafting.md)) → sold to camps and fences |
| **Fur trapping (winter)** | Place traps at marked trap spots on islands; return days (weeks) later to collect | Legal in season (simplified) | Furs (high value, [05 §3](05-ports-economy-trading.md)) |

- Gunshots are noise events (keepers and fishermen may hear and investigate).
- Background perk: *Poacher/Trapper* tracks better, trap yields are higher, and carcasses carry faster.

---

## 5. Sea Caves & Ice Caves

- **Sea caves** (Devils Island, Sand Island, the mainland shore east of Siskiwit Bay) are **authored cave meshes** embedded in the terrain ([03 §3.4](03-world-scale-chart-travel.md)).
- **Access:** by **rowboat in calm seas** (wave height below a threshold), by **swimming** (cold), or on foot from inland openings (some caves).
- **Contents:** smuggler caches, a hideout mooring (Devils Island), legend locations, echoing atmosphere (audio).
- **Winter ice caves:** when the lake freezes along the cliffs, sea caves become **walkable ice caves** reached across the ice on foot. Lake Superior's sea caves are famous for this. In-game, the frozen state unlocks winter-only areas (icicles, frozen spray) and some winter-only caches.

---

## 6. Wrecks & Salvage

### 6.1 Wreck sources
| Source | Examples |
|---|---|
| **Historical (pre-1900)** | The ***Lucerne*** (schooner, lost November 1886 off Long Island with all hands) and others from R1's wreck database pass (backlog #8) |
| **Seeded per run** | A few invented old wrecks placed at candidate shoals (different each run) |
| **Gameplay-born** | Ships sunk or wrecked during play: by you ([07 §7.3](07-combat-boarding-targets.md)), by storms, or by your false lights ([06 §6.2](06-fame-wanted-law-lighthouses.md)) |
| **Your own lost ship** | After abandoning ship ([02 §6.5](02-arcade-sailing.md)), its cargo can be partly recovered |

### 6.2 Salvage mechanics
- **Locate:** a rumor, chart mark or map gives an area (an uncertainty circle). Find it by sight in clear shallow water (Superior's water is very clear) or by sounding (the depth readout spikes).
- **Shallow wrecks** (depth ≤ ~10 m game): anchor over the wreck and use the **grapple and hook** (a hold action with game time and a chance per attempt). Recovers cargo CU, fittings (guns, instruments), and curios.
- **Deep wrecks (decided: unlocked by buying a diving suit):** a **hard-hat diving suit** (period-accurate around 1900; air pump, hose, weighted boots) is an **expensive purchase** (chandlery or shipyard in Duluth or Superior; utility upgrade in [10 §5.7](10-ship-upgrades-customization.md)). Owning it **unlocks deep-wreck salvage**:
  - Anchor over the wreck in **calm seas** (wave-height limit), then go down. A short **on-foot underwater segment** in the heavy suit: slow walking on the lake bed, limited by **hose length** (a radius around the ship), murky light (a helmet lamp), and hand-carrying small items or attaching a hoist line to cargo.
  - Hazards: weather turning (the hose and ship pitch, so you must surface), entanglement in wreckage (a timed escape), cold.
  - It opens wrecks too deep for the grapple: legend payoffs, rich old cargoes, guns.
  - T1 solo note: with no crew to work the pump, the suit includes a hand-pumped reservoir that gives shorter dives on T1 and longer dives on T2/T3 (the crew pumps).
- **Hazards:** salvaging takes time at anchor (spotting risk), the weather can turn, and salvaging a wreck **you caused** keeps your stay suspicious (more heat if seen near it).
- **Legal angle:** salvage of old, abandoned wrecks is legal-ish. Recent wrecks' cargo is **hot** (owners' marks).

---

## 7. Secrets & Clues

### 7.1 Secret types
| Type | Description | Reward |
|---|---|---|
| **Caches** | Hidden stashes (smugglers', trappers', old fur-trade-era) under rocks, in caves, buried at marked trees | Money, goods, ammo, rare items |
| **Legend chains** (hand-authored) | Multi-step stories (§8) | Big payoff plus **Fame** plus a unique trophy plus a newspaper story |
| **Wrecks** | §6 | Cargo, fittings, curios |
| **Hideout sites** | Undiscovered sites ([09 §2](09-hideouts-building-crafting.md)) | New hideout |
| **Rival stashes** | Copycat rivals' hoards ([07 §8.1](07-combat-boarding-targets.md)) | Their loot |
| **Charting** | Uncharted coves, anchorages and shoals | Chart knowledge (safer navigation, shortcuts) |
| **Natural wonders** | Sea caves, ice caves, aurora viewpoints, **Superior mirages** (looming: distant ships appear on the horizon; flavor plus a scouting bonus) | Journal entries, small Fame |
| **Curios** | Unique objects for hideout trophies (a ship's bell, a brass compass, a quarryman's pick, an old lighthouse lens prism) | Decor and display |

### 7.2 Clue sources
- **Documents** stolen in docks districts ([08 §7](08-docks-district-stealth.md)): letters, ledgers, ship logs.
- **Lighthouse logbooks** (from a raid, or a friendly keeper visit by day).
- **Wreck manifests and captains' papers** (from salvage and looting).
- **Rumors and newspapers** ([05 §9](05-ports-economy-trading.md)), old-timers in saloons.
- **Exploration itself:** carved marks, odd cairns, a rusted lantern on a ledge.

### 7.3 Clue → map flow
1. Each clue adds a **lead** in the journal with a **search area** on the chart (a large circle).
2. More clues shrink the circle. **Three related clues** can be combined at the **cartography table** ([09 §7.1](09-hideouts-building-crafting.md)) into a **precise map** (an X marks the spot).
3. On site: environmental hints (a marked tree, a cairn) guide the final search. **Hold-to-dig** or open the hidden spot.
4. Reward. The journal records the story.

---

## 8. Legends (hand-authored, MVP target: 6)

Tall tales grounded in 1900 places. Fictional details, real settings. Each is a 3–5 step chain.

| Legend | Setting | Hook | Payoff |
|---|---|---|---|
| **The *Lucerne*'s Last Cargo** | Off Long Island / Chequamegon Bay | Fishermen speak of a lantern bobbing where the *Lucerne* went down in '86 | The captain's strongbox; ship's bell curio; Fame |
| **The Quarryman's Payroll** | Hermit and Basswood quarries | When the quarry company went bust in the Panic of '93, the last payroll "vanished" | Payroll gold; a quarry pick curio; reveals the Hermit hideout site if undiscovered |
| **The Dark Light of Minnesota Point** | The abandoned Minnesota Point light | Smugglers have been seen signaling from the dead tower | A smuggler ring's cache; a Duluth-side hideout site; a fence contact |
| **The Devil's Grotto** | Devils Island sea caves | A drowned smuggler's journal mentions "the third cave, at the dark of the moon" | A cache reachable only in calm, at night, by rowboat (or in winter via ice caves) |
| **Outer Island's Ghost Net** | Outer Island fish camp | A fisherman vanished, and his nets still come up with odd things | A lost fortune in a net shed; a lighthouse lens prism curio |
| **The Copycat's Hoard** (dynamic) | Generated per rival ([07 §8.1](07-combat-boarding-targets.md)) | Clues from beating or shadowing a copycat | The rival's loot; their nameboard trophy |

**Tone:** spooky, but never supernatural in fact. The "ghosts" are always explained (smugglers, a hermit, the wind), in keeping with the grounded-history, tall-tale pillar.

---

## 9. Seeded Variety (per run)

- Each run's **seed** places: cache contents and which candidate spots are active, invented old wrecks, trap spot yields, deer populations, the clue documents that drop in docks districts, and the rival stash islands.
- Legends keep fixed locations (authored) but can vary which clue sources appear first.
- So a new run (after permadeath) isn't a memorized treasure hunt.

---

## 10. Lighthouse Stations On Foot

Island lighthouses use the **lighthouse station kit** (tower with a climbable interior stair and lantern room, keeper's house, oil house, fog signal building, a dock or landing). It supports [06 §6.2](06-fame-wanted-law-lighthouses.md):
- Raiding supplies (the oil house has kerosene; the house has valuables).
- **Dousing** (climb to the lantern room).
- Tying up or bribing the keeper, or killing them (with the matching heat).
- Reading or stealing the **logbook** (clues, ship schedules).
- **Daytime visits:** keepers welcome visitors at low Wanted (rumors, weather knowledge, a logbook peek).

---

## 11. Discovery, Charting & Journal

- **Chart fog of war** ([03 §5.2](03-world-scale-chart-travel.md)): coves, caves, wrecks and POIs are revealed when seen (spyglass from sea, or on foot) or learned (rumors, maps).
- **"Charted" knowledge:** visiting and sounding coves adds anchorages and shoals to your chart, which helps navigation (safer night approaches).
- **Journal** (plan 13 UI): leads, clues, legends (with step progress), discovered sites, wrecks, natural wonders and a curio catalog. It doubles as the run's story log.

---

## 12. Rewards & Balance
- Secrets supplement income but **shouldn't outpace piracy or trade**. Cache cash is capped per region per season. The big money is in legend payoffs (~6 in the MVP).
- Their real value: **Fame** (legends make headlines), **unique curios**, **hideout sites**, **intel** (schedules, fence contacts), salvaged **guns and fittings** (shortcuts to upgrades).
- Wreck salvage of your own sunk victims is a risky profit loop, kept in check by the hot-goods rules and suspicion.

---

## 13. Content Pipeline & Performance
- **Islands** come from the geo pipeline heightmaps ([03 §8](03-world-scale-chart-travel.md)) plus a hand-placed POI layout per island (JSON via the shared layout editor, [09 §11](09-hideouts-building-crafting.md)).
- **POI prefabs** are built from kits (lighthouse station, quarry, fish camp, farm, cabin, cave set), so they can be reused across islands.
- **Vegetation:** instanced stylized pines and birches from density maps, with impostors in the distance.

| Budget (on-foot island, Medium) | Target |
|---|---|
| Draw calls | ≤ 150 (instanced vegetation, merged POI statics) |
| NPCs | ≤ 6 full AI (keepers, fishermen, marshals) plus wildlife (≤ 4) |
| Terrain | 1 m tiles, loaded as the island's own scene ([03 §7](03-world-scale-chart-travel.md)) |
| Caves | Separate small meshes; fog and light tuned; ≤ 40 draw calls inside |

---

## 14. Data & State

**Data:** `islands.json` (tier, POIs, landings, trap spots, deer range, cache candidates), `pois.json` (prefab refs), `legends.json` (steps, clues, conditions, rewards), `clues.json`, `caches.json` (candidate spots plus loot tables), `wrecks.json` (historical and seeded candidates), `curios.json`, `wildlife.json`.

**WorldState:**
- `discovery` (from [03 §9](03-world-scale-chart-travel.md)): POIs, sites, wrecks, wonders, charted areas
- `leads[]` (clues held, search area)
- `legends[id].step`
- `caches[id].{active, looted}`
- `wrecks[id].{remainingCargo, salvagedBy, causedByPlayer}`
- `traps[]` (placed, set time)
- `player.warmth`
- `curios[]` (owned, where displayed)

**Events:** `IslandLanded`, `PoiDiscovered`, `ClueFound`, `LeadUpdated`, `MapCrafted`, `CacheOpened`, `LegendStepCompleted/Completed`, `WreckFound/Salvaged`, `AnimalKilled`, `TrapPlaced/Collected`, `WarmthCritical`, `WonderSeen`.

---

## 15. Phasing
- **Phase 7:** one fully walkable hero island (Stockton or Hermit), the on-foot controller shared with the docks, a quarry POI, a cache, going ashore by rowboat. **Built as 0.7.0** ([08 §20](08-docks-district-stealth.md), pieces A and H): Stockton, walked end to end on the zone's ground within its baked 1 m extent, with trunks and shore rocks to walk round; the brownstone quarry on the south shore (spoil wharf with steps and a ladder, two cut faces, a derrick, dressed blocks, the office); one cache under one of three cairns, the cairn and the cash seeded by the run and saved in `caches[id]`; the Phase 4 stash opened on foot; the rowboat from the anchored ship (not launched in seas over 1.1 m, swamped over 1.6 m); a marshal posse at tier 4+. Space scrambles a steep bank up to about 2.6 m. Nobody lives there and there's no wildlife, hunting or cold exposure yet (Phase 9).
- **Phase 9 (Seasons & Secrets):** all 22 islands at their tiers, lighthouse stations on foot, sea caves (and winter ice caves), wreck salvage (shallow), hunting and trapping, wildlife, the clue → map flow, 6 legends, seeded caches, the journal, cold exposure.
- **Phase 9 or first post-MVP update:** the diving suit and deep-wreck salvage. More legends and mirages after that.

---

## 16. Cut List
1. Winter ice caves (sea caves stay boat-only).
2. Fur trapping (hunting only).
3. Mirages.
4. Legends reduced from 6 to 4.
5. Diving-suit entanglement hazard.

*Not cuttable:* walkable islands (**all 22 by Beta**, minor islets included), caches, legends (at least 4), shallow wreck salvage, **the diving suit and deep wrecks** (may ship in the first post-MVP update), **wildlife hazards**, **deer poaching**, the clue → map flow, lighthouse stations on foot, cold exposure in winter.

---

## 17. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | **Deer poaching** (contraband venison) and **winter fur trapping** are in. |
| 2026-10-21 | **Wildlife hazards** on islands: rare black bears and winter wolves. |
| 2026-10-21 | **Diving suit:** an expensive purchase that unlocks deep-wreck salvage. |
| 2026-10-21 | **Cold exposure** can kill (with clear warnings). |
| 2026-10-21 | **6 hand-authored legends** (never actually supernatural) plus **seeded caches** varying per run. |
| 2026-10-22 | All 22 islands, minor islets included, get 1 m on-foot tiles and stay walkable; each island loads as its own scene. |

---

## 18. Phase 9 Scope: Seasons & Secrets (2026-11-17)

Phase 9 is the **Seasons & Secrets** build (version 0.9.0, the **Beta** and the first public release by [17 §7](17-testing-performance-release.md)), with one goal from the [00 §7](00-master-plan.md) roadmap: **"depth."** Phases 4–8 built a captain who trades, is hunted, robs ships, burgles Bayfield, walks Stockton and builds a home there, but whose world stops being itself at the first freeze-up and has only one island worth landing on. Phase 9 gives the year its winter and the Apostles their secrets. In November a false light on Sand Island's shoal puts a laden steamer aground in a gale; a rival the papers call *Black-Sail* gets the blame for it, and the *Lantern* calls you *the Moon-Cusser* anyway. In January you haul a sled of whiskey across the ice road to La Pointe with your warmth running down, and in April you read a drowned smuggler's journal from a keeper's logbook, combine it with two other clues at your cartography table, and row into Devils Island's third cave at the dark of the moon.

The scope comes from the Phase 9 rows of every plan: islands, lighthouse stations, caves, salvage, hunting and trapping, wildlife, clues and legends, and cold (§15 above); winter, ice, snow and the year's variation ([04 §15](04-water-weather-seasons.md)); false lights, wrecking and wreck investigations ([06 §6.2](06-fame-wanted-law-lighthouses.md)); the event catalog, letters, the Hollister feud, rivals, nicknames, poker, the Mataafa storm, voluntary endings and the Hall of Captains ([12 §11](12-sandbox-events-character-failure.md)); the districts marked 9+ ([08 §2.2](08-docks-district-stealth.md)); the ice bow ([10 §13](10-ship-upgrades-customization.md)); the full journal, poker and the Hall of Captains' screens ([13 §12](13-ui-ux.md)); POI kits, caves, animals, curios and season palettes ([14 §13](14-art-direction-asset-pipeline.md)); island, cave, winter and wildlife sound and the ending music ([15 §11](15-audio.md)); the remaining save slices ([16 §12](16-save-persistence.md)); and what Phase 8 left for it: events and letters (09 §16.6 decision 1), the sail loft, smokehouse, powder room and cartography table, wrecking with the false-light rig, rivals noticing hideouts, winter at the hideouts, the island posse's search, and the other five hideout sites ([09 §16.2](09-hideouts-building-crafting.md)).

**Phase 9 is about three Phase 8s of work** (§18.4 counts 26 pieces against Phase 8's 10), so the plan works in three stages, each ending in something Jared can play. The stages and the docks districts are the two decisions in §18.6. The two parked Phase 7 fixes (the jailbreak sounds, the ground disc) are not in this scope (Jared, 2026-11-17).

### 18.1 What Phases 4–8 change or put at risk

| Finding | Source | Effect on Phase 9 |
|---|---|---|
| **All 22 islands are already baked to 1 m tiles** (1.2 MB under `public/world/apostles/islands/`), but only Stockton and the Siskiwit pad have an `onFoot` entry in `islands.json`; the rest are a name and a position | `data/islands.json`, `src/sim/islands/on-foot.ts` | Walking an island is landings, POIs and residents, not a bake. That makes "all 22 by Beta" a content job (pieces P–R), not a pipeline one. |
| **Winter isn't there, and neither is the MVP's stop at freeze-up.** The clock runs on past December with open water and summer traffic; nothing ends the run at the first freeze-up as 04 §15 decided | grep finds no freeze-up, ice or end-of-content code in `src/` | Stage 2 builds the whole year (piece K). Until then a 0.8.x run that reaches December sails on in open water. A save made in autumn must carry on into Phase 9's winter (criterion 10). |
| **Wrecks are recorded:** every sinking, scuttling, foundering and abandoning leaves a wreck with where she lies, what she carried, who drowned and whether you did it (the last 40) | `src/sim/wrecks.ts`, save `wrecks` | Salvage (piece U), wreck investigations (piece I) and the *Lucerne* legend read them; no new slice is needed for gameplay-born wrecks. |
| **The false-light rig exists** as an item crafted at the workbench and kept in a hideout's storage | `data/items.json` `item.false_light`, `data/recipes.json` | Piece I gives it a use. Nothing else changes. |
| **Lighthouses watch but can't be walked:** ten kept stations are observers from their galleries with vigilance and dozing (Phase 5); Minnesota Point is dark and unkept | `data/lighthouses.json`, `src/sim/lighthouses.ts`, `src/sim/law/observers.ts` | Piece H puts keepers on foot at the seven Apostles stations, using the same observer numbers so detection at sea doesn't move. |
| **The island posse walks beats and doesn't search;** it never breaks off at a hideout's bounds because it never comes near one | 08 §20.8.3 decision 2, 09 §16.10 "Not in piece F" | Piece F. |
| **Legends are already teased:** five legend rumors (the *Lucerne*, the payroll, the Dark Light, the Devil's Grotto, the Ghost Net) are told in saloons as Tall tale or Doubtful and lead nowhere | `data/rumors.json` `legends`, 05 §26 | Piece T makes each one lead somewhere, keeping its ids so rumors heard in an old save count as the first clue. |
| **The harbor master has a tab** in every port screen (heat, pardons) | `src/ui/port/Harbor.tsx` | Letters wait there (piece A), so there's no new building. |
| **Hollister Fish & Packing exists** as a company in contracts and cargo, and its packing house and cooperage stand in Bayfield's district | `src/sim/economy/contracts.ts`, `src/sim/traffic/cargo.ts`, 08 §2.2 | The feud (piece D) has its stage and its company already. |
| **No nickname, poker, rivals, endings or Hall of Captains** exist yet; the papers call you by name | `src/sim/news/papers.ts` | Pieces B, C and E. |
| **Claiming an abandoned site by building there isn't in:** build mode opens only at a site you hold | CHANGELOG 0.8 known limitations, 09 §2.2 | Piece W, with the five other sites. |
| **The docks-district machinery exists:** the 56-piece kit, the placement editor, the ground and navmesh bake, the watch and the lockup | `data/kit.json`, `src/debug/district/editor.ts`, `npm run district:bake` | A second district is layout, data and its jail, not new systems (piece X). |
| **Budgets:** audio 5.22 of 8 MB decoded; save v10, a month of crime about 15 KB; an island's on-foot scene ≤ 150 draw calls | 15 §21, 16 §12, §13 above | Each stage's audio piece checks its share; winter and the islands are the frame-time risk (criteria 12 and 19). |
| **Phase 8 isn't closed:** its playtest (piece J) and the 0.8.0 tag are still to do, as is Phase 7's laptop playtest | 09 §16.4 | Stage 1 builds on what's merged and doesn't wait for them, but 0.9.0 can't be tagged before 0.8.0 is. |

### 18.2 What Phase 9 delivers

| Area | Deliverable | Plan |
|---|---|---|
| Events and letters | `events.json` with triggers (date, season, place, region, Fame, Wanted, Standing, flags, weather), weights, cooldowns, prerequisites and outcomes; the five channels (saloon rumors, the papers, letters at the harbor master's, chart encounters, short on-site scenes with choices); about 20 events from 12 §5.2 by the end of the phase, each changing the sim (a special voyage, a price, the cutter) rather than playing a mini-game | 12 §5 |
| The run's voice | Your nickname coined by the papers at Fame tier 1 from your deeds and haunts, changing with your record, one reroll by a letter to the editor; Retire and Turn Lawman as endings with their front pages; the Hall of Captains, a local record of past runs | 12 §4.2, §6.3, §9 |
| Poker night | Five-card draw against two or three at a saloon table, stakes in money, cargo, a contract or a cache map, cheating by a sleight check with a brawl or heat if caught | 12 §5.3 |
| The Hollister feud | A chain in stages: Hollister undercuts your fish and turns your catch away; you sabotage their sheds, rob their tugs or out-trade them; it ends when one side gives | 12 §5.2 |
| Copycat rivals | Up to three rival captains from Fame tier 2, each with a personality, a ship a tier at most below yours, a lane and a camp; they copy your methods and take your blame (and you theirs); they leave by your hand, the law's, retirement or a storm; a parley in a saloon; never at your hideouts | 12 §7, 07 §8.1 |
| The island posse searches | At tier 4+ the marshals land where your boat is, search outward by sight, sound and (in winter) tracks, and break off at a hideout's build bounds | 06 §5.3–5.4, 08 §20.8.3 |
| Four more stations | The sail loft (mend kits, quality canvas, topsails, storm sails, dark-tanned sails, muffled blocks), the smokehouse (smoked fish and venison), the powder room (faster, larger powder batches) and the cartography table (leads into maps), as pieces with recipes | 09 §7.1, 10 §5 |
| Lighthouse stations on foot | The station kit (tower with stair and lantern room, keeper's house, oil house, fog signal, landing) at the seven Apostles lights; keepers on foot by the same perception as the watch; raiding the oil house and the house, dousing and relighting, tying up, bribing or killing the keeper, reading or taking the logbook; welcome by day at low Wanted | §10, 06 §6.2 |
| Wrecking | The false-light rig set on a headland or shoal edge; traffic steering by the lights it knows at night, in fog or storm; a misled ship grounding or breaking up; the dead counted as killings; several suspicious wrecks near one light opening an investigation (heat and the cutter) | 06 §6.2 |
| The whole year | The ice sim per zone (coverage and thickness by freezing degree-days), freeze-up and ice-out rolled each year with a winter's severity, floes at ice-out, ice on the chart, ice dragging, damaging and stopping a hull, harbors frozen in, the *Morrill* laid up, winter traffic near nothing, winter markets, the "first boat in" race to Duluth, the ice bow, and the Mataafa storm for runs that reach November 1905 | 04 §4, §8, 10 §13 |
| Winter's look | The ice sheet and floes, snow on the ground, roofs and decks, falling snow, winter palettes for every time of day, frozen spray, and the aurora on clear winter nights | 04 §8.3, §11, 14 §13 |
| On the ice and in the cold | Walking on ice thick enough to hold you, the Bayfield–La Pointe ice road, a sled to haul goods, thin ice that cracks before it breaks, a warmth meter (winter, wet, after a swim) restored at a fire, a stove or a keeper's house, death by cold only after clear warnings, tracks in the snow that guards and the posse follow, and winter heists on frozen-in ships | 04 §8.2, §3.2 above, 08 |
| Discovery and the journal | Fog of war on the chart, lifted by sight, spyglass, rumors and maps; charted coves and shoals; the journal's leads, legends, discoveries, wrecks and curios | §11, 03 §5.2, 13 §12 |
| All 22 islands | Every island landable and walkable at its tier (8 hero, 8 standard, 6 minor) with its POIs from the kits (lighthouse station, quarry, fish camp, farmstead, trapper's cabin, viewpoint, beach wreckage, cave mouth), keepers and fishermen who see and report, and La Pointe's village on Madeline | §2 |
| Caves | Sea caves at Devils, Sand and the mainland shore east of Siskiwit, by rowboat in a calm, by swimming or from inland; the same caves walkable from the ice in winter | §5 |
| Clues, caches and legends | Clues from documents, logbooks, wreck papers, rumors and the land itself; leads with a shrinking circle; three clues made into a map at the cartography table; hold to dig; the six legends; caches seeded per run across the islands | §7–9 |
| Salvage | Shallow wrecks (historical, seeded and gameplay-born, your own included) found by sight or sounding and worked with grapple and hook at anchor; recent cargo hot | §6 |
| Hunting and wildlife | Deer on the larger islands, tracked, shot, dressed and carried; venison as contraband through the smokehouse; winter fur trapping; black bears and winter wolves that warn before they attack | §3.2, §4 |
| Seven sites | The five other hideout sites (Hermit, Devils, Outer, Minnesota Point, the North Shore cove) with their pads and anchorages; each background starting at its own; claiming by building; Minnesota Point leased, or squatted with a chance of heat | 09 §2, 12 §2.2 |
| Docks districts | Duluth (decision 2): its waterfront, watch, jail and walkable back room | 08 §2.2 |
| Audio | Saloon music and poker, the lighthouse station, ice, snow and winter wind, chattering teeth, islands and caves, wildlife, the ending music; within the 8 MB budget | 15 §11 |
| Saves | `events`, `mail`, `rivals`, `feuds`, `ice`, `discovery`, `leads`, `legends`, `wrecks[].salvaged`, `traps`, `player.warmth`, `curios` and the new sites; the Hall of Captains outside the save; a 0.8.x save loading with everything at its start | 16 §12 |

**Out of scope:** the diving suit and deep wrecks (§15 allows the first update after the MVP; §18.5), mirages (cut #3), T3 hulls and hull variants (10 §13), T2 on the slipway (09 §16.5), the builder's cuts #1–3 and #5 (blueprints, paint, a third level, the lookout's traffic reveal), the districts decision 2 leaves out, bounty hunters (06 cut #1), Lake Michigan and the other lakes (Phase 10), and the two parked Phase 7 fixes.

### 18.3 Exit criteria

Phase 9 is done when these pass on the baseline laptop and Jared signs off the last playtest.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | Every event in the catalog fires from its triggers through its channel, respects its cooldown, and changes the sim it names | A seeded year's sim test per event; unit tests on triggers |
| 2 | A letter waits at the harbor master's in any port, is read there, and can carry an event's choice | Unit tests; an e2e reading a letter |
| 3 | Rivals: the first at Fame 2, up to three at 3–4; blame follows method; each way out works; none ever comes to a hideout | Sim tests over a season of crime |
| 4 | The papers coin a nickname at tier 1 and change it with your record; Retire and Turn Lawman end a run with their pages; the Hall of Captains survives a reload and a new run | Unit tests; an e2e retiring a run |
| 5 | A poker hand plays out with stakes changing hands; a caught cheat starts a brawl or adds heat | Unit tests on the deal and the odds; an e2e hand |
| 6 | The island posse lands near your boat, searches, and breaks off at a hideout's bounds | Sim tests; an e2e on Stockton |
| 7 | The four new stations craft their recipes, and loft-made sails fit at the slipway | Unit tests against `recipes.json` and the upgrades |
| 8 | A lighthouse can be raided, doused and relit, its keeper tied up, bribed or killed with the heat each brings, its logbook read | Unit tests; an e2e at one station |
| 9 | A false light on a dark night in weather puts a laden ship on a shoal; three suspicious wrecks near one light open an investigation | A sim test with a seeded storm; the investigation test |
| 10 | A run lives a whole year: freeze-up, a winter on the ice, ice-out and the first boat in; ice blocks and holes a hull without the ice bow; the cutter lies up; an autumn 0.8.x save carries on into winter | Sim tests over a seeded year; `tests/save-migrations.test.ts` with a v10 fixture |
| 11 | Cold and thin ice kill only after clear warnings; the ice road carries a sled; tracks lead the watch to you | Unit tests on warmth and ice; an e2e on the ice road |
| 12 | All 22 islands land and walk at their tiers; each island ≤ 150 draw calls with ≤ 6 people and ≤ 4 animals; a cave ≤ 40 | `tests/islands.test.ts` over every landing; `bench.island` per tier; the laptop |
| 13 | Each of the six legends can be finished from its first clue to its payoff; caches differ by seed; three clues make a map | e2e per legend through dev hooks; seeded tests |
| 14 | Salvage recovers cargo from a historical, a seeded and a gameplay-born wreck, and recent cargo comes up hot | Unit tests |
| 15 | Deer can be poached and venison smoked and sold as contraband; bears and wolves warn before they attack; traps fill over weeks | Unit tests on the FSM and yields; an e2e hunt |
| 16 | Every background starts at its own site; all seven sites can be claimed; Minnesota Point by lease or squatting | Unit tests; an e2e per new start |
| 17 | The districts of decision 2 can be burgled, and their jails hold and can be broken out of | e2e as Bayfield's |
| 18 | Saves round-trip every new slice; a long run (a year with rivals, legends, seven hideouts and a winter) stays in plan 16's budget | `tests/save-*.test.ts`; `bench:save` |
| 19 | Audio within 8 MB; the frame budget in a winter storm, on a hero island and in a cave | The pipeline test; the benches; the laptop |
| 20 | The seasons feel different, and an island is worth landing on | Jared decides |
| 21 | Plans 04, 06, 08, 09, 10, 11, 12, 13, 14, 15 and 16 record what was built, CI is green, 17 §9's Beta checklist is worked through or its gaps listed, and 0.9.0 is tagged as the Beta | The release PR |

### 18.4 Work pieces

Twenty-six pieces, each sized to be one thread, in three stages by decision 1. A stage ends with a playtest of what it built; a piece starts when what it needs has landed, so stage 2's ice sim can start while stage 1 is still in review.

| Stage | Pieces |
|---|---|
| **1, the sandbox comes alive** (start now: A, F, G, H) | A events and letters, B nickname and endings, C poker, D the Hollister feud, E rivals, F the posse searches, G four stations, H lighthouse stations, I wrecking, J stage 1 audio; then a playtest |
| **2, winter** (K can start now) | K the year turns, L winter's look, M on the ice and in the cold, N winter audio; then a playtest |
| **3, the islands and their secrets** (O and P can start now) | O discovery and the journal, P POI kits, Q hero islands, R standard and minor islands, S caves, T clues and legends, U salvage, V hunting and wildlife, W seven sites, X districts, Y islands audio, Z playtest and 0.9.0 |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | Events and letters | Pure sim first: `events.json` and its schema; triggers over the world state, weights, cooldowns, prerequisites and outcomes as sim effects; the channels (a rumor, a paper's item, a letter, a chart encounter, a short scene with choices on paper); `mail[]` and the Letters list on the harbor master's tab; `events {active, cooldowns, flags}` in the save. The first ten events from what already exists: the payroll run, the storm-bound fleet, wreck survivors, the whiskey hijack, camp demand, a mill fire, a herring run, a coal shortage, the *Morrill* arriving, and an informant. `__glpEvents` to fire any event | — | — |
| B | Nickname and endings | Nickname pools in `newspapers.json`; coined at Fame tier 1 from your most frequent and most notorious deeds and your haunt, changing as they change, rerolled once by a letter to the editor; used in headlines, the WANTED column and the end page. Retire (wealth and no region at tier 3+, three retirements) and Turn Lawman (Fame high, every region ≤ 1, Standing good), each offered by letter, with their epilogue pages; the Hall of Captains as its own local store with a menu entry | A | Nickname pools and epilogue wording |
| C | Poker night | A table in the saloon at night; five-card draw against two or three captains with a shown pot; stakes of money, a lot of cargo, a contract or a cache map (a lead once O exists); cheating by a sleight check, caught into a brawl or assault heat; the Won It at Poker Ambition; the poker screen | A | — |
| D | The Hollister feud | `feuds.hollister` in stages, started by an event once you sell fish in Bayfield often; Hollister's undercut and refusals; escalation by sabotage at their sheds (Bayfield's packing house), robbing their tugs (existing targets) or out-trading them on Standing; how it ends either way, with the papers | A | — |
| E | Copycat rivals | `rival_templates.json`; emergence at Fame 2, up to three at 3–4; each rival a traffic ship with a personality, lane and camp (an anchorage on a standard or minor island, walkable once R lands); robbing on your lanes by their methods; blame by method similarity through the crime pipeline; the ways they leave; a parley offered by letter and met in a saloon, honored or betrayed; defeat gives Fame and a lead to their stash (the Copycat's Hoard in T); never near a hideout | A | Names and personalities |
| F | The posse searches | The island posse at tier 4+ landing near your beached boat or your anchorage, sweeping outward with the watch's perception, following tracks when M lands, giving up after a while, and breaking off at a hideout's build bounds; it searches any walkable island as they come | — | — |
| G | Four stations | The sail loft, smokehouse, powder room (09 cut #4 lifted) and cartography table as kit pieces with `functions.station`; their recipes (§16.5's materials, no new goods but venison in V); the loft's sails and muffled blocks as upgrades fitted at the slipway; the smokehouse's smoked fish (venison in V); the powder room's larger, quicker powder batches; the table's charting until T gives it maps | — | — |
| H | Lighthouse stations | The station kit in the docks kit's style; the seven Apostles stations at their landings (Raspberry, Sand, Devils, Outer, Michigan, La Pointe, Chequamegon Point) as walkable pads clipped from their islands' tiles (the rest of each island in Q and R); keepers on foot on the watch's FSM with the gallery observer's vigilance; the oil house's kerosene and the house's valuables; dousing in the lantern room and relighting; tie up, bribe or kill; the logbook as clues and schedules; day visits at low Wanted | — | The kit's look |
| I | Wrecking | The rig set from the hold on a marked headland or shoal edge; traffic at night, in fog or storm steering by the lights it knows, so a false or doused light sends some ships onto shoals (by weather, darkness and her captain); a grounded ship struck and lootable as a boarded one, a broken one a wreck; the drowned as killings with witnesses only if seen; an investigation after several suspicious wrecks near one light within weeks (heat, the cutter sent); the moon-cussing night event; the Moon-Cusser Ambition and nickname | H, A | — |
| J | Stage 1 audio | The saloon's piano and fiddle by night, cards and chips, the station (the lamp's clockwork, the oil house, the keeper), letters and the harbor master, a rival's stinger, a ship grounding | C, H | Listen by ear |
| K | The year turns | `ice` per zone (a coarse grid of coverage and thickness, daily by freezing and thawing degree-days, sheltered bays first); the year's roll (freeze-up, ice-out, severity, fall storms); floes at ice-out; `iceAt` for sailing (drag, damage, a hull stopped, the ice bow), harbors frozen in, ice on the chart and voyages around it; the *Morrill* laid up December to March; winter traffic and markets; the first-boat-in race; the Mataafa storm on November 27–28, 1905 | — | — |
| L | Winter's look | The ice sheet over the water from the coverage grid, instanced floes, snow on terrain, the district, hideouts and decks by season, falling snow and frozen spray, winter palettes, the aurora on clear cold nights (04 cut #3 lifted if it stays cheap) | K | The look |
| M | On the ice and in the cold | Walking where the ice holds; the ice road between Bayfield and La Pointe; a sled hauling a few CU; thin ice that cracks, groans and then breaks, with a short chance to climb out; `player.warmth` (winter, wet, a swim, freezing rain) and fires, stoves and keepers' houses to warm at; tracks in snow for the watch and the posse; heists on ships frozen in | K | — |
| N | Winter audio | Ice cracking and groaning, snow underfoot, winter wind, a sled, teeth chattering and gusts as warmth drops, frozen-in harbor nights | L, M | Listen by ear |
| O | Discovery and the journal | `discovery` (POIs, sites, wrecks, wonders, charted waters), fog of war on the chart lifted by sight, spyglass, rumors and maps (an existing save starts with what it has visited charted); `leads[]` with search circles; the journal's Leads, Legends, Discoveries and Curios tabs; `curios[]` and showing them at a hideout | — | — |
| P | POI kits | The fish camp, farmstead, trapper's cabin, viewpoint, beach wreckage, cairns and dig spots, and the cave mouth, built as the quarry and station kits were; `bench.island` per tier | — | The look |
| Q | Hero islands | Madeline (with La Pointe's village and the ice road's landing), Hermit, Basswood, Devils, Sand, Outer and Raspberry walked whole, each with its POIs, landings, trees and residents (fishermen and farmers who see and report) | P, H | — |
| R | Standard and minor islands | The other fourteen islands landable and walkable with their one to three POIs, or none, at their tiers; a test that lands on every one | P | — |
| S | Caves | Sea cave meshes at Devils, Sand and the mainland east of Siskiwit; rowing in below a wave height, swimming in, or walking in from an inland mouth; winter ice caves from the ice (11 cut #1 kept in if M lands); caches and the Grotto's chamber | P, Q | — |
| T | Clues and legends | `clues.json`, `legends.json`, `caches.json`; clue sources (stolen documents, logbooks, wreck papers, rumors, marks in the land); leads that shrink; three clues into a map at the cartography table; hold to dig; seeded caches across the islands; the six legends (the *Lucerne*, the Quarryman's Payroll, the Dark Light of Minnesota Point, the Devil's Grotto, Outer Island's Ghost Net, the Copycat's Hoard) with their curios, Fame and papers | O, G, Q, S, E | Legend wording |
| U | Salvage | Wrecks from the *Lucerne* and R1's list, seeded old wrecks, and the ones you and the lake made; finding by sight in clear water or the sounding spike; grapple and hook at anchor, a chance per attempt and the time it takes; old cargo clean, recent cargo hot; salvaging your own victims as suspicious | O | — |
| V | Hunting and wildlife | `wildlife.json`; deer on Stockton, Madeline and Oak; tracking, the rifle, dressing and carrying a carcass; venison as contraband through the smokehouse and sold to camps and fences; bears and wolves on the Wander → Wary → Threaten → Attack or Flee FSM, scared by noise, shot, or kept off by fire; winter trap spots that fill over weeks; the Venison King Ambition | Q, G, K | — |
| W | Seven sites | Hermit, Devils (the sea cave mooring and the clifftop pad), Outer (the fish camp) on their islands, Minnesota Point and the North Shore cove as mainland pads in their zones, each with build bounds, anchorage, concealment and a pre-built start; every background starting at its own; claiming by building; Minnesota Point's lease or squatting | Q, S | Pre-built layouts |
| X | Duluth | By decision 2: Duluth's district laid out with the editor from Sanborn maps, baked, its watch, its lockup holding that region's prisoners, its back room where it has one | — | Layout |
| Y | Islands audio | Island ambience by tier and season, caves, deer, bears and wolves, the grapple and a dig, the ending music | Q, S, V | Listen by ear |
| Z | Playtest and 0.9.0 | The §18.3 scenarios, the benches, 17 §9's Beta checklist, the plans updated, tag 0.9.0 | All | Playtest, sign-off |

### 18.5 Smaller calls assumed (Jared can override)

- **About twenty events at Beta,** not every row of 12 §5.2 at once: piece A brings ten from systems that exist, and the rest arrive with their pieces (the feud, rivals, moon-cussing, first boat in, camp demand for venison, poker night, the marshal posse landing).
- **Letters live on the harbor master's tab,** in any port with a port screen. Bail by sending word stays as it is.
- **12's cut list stays uncut:** letters, rival parley, the nickname reroll and poker cheating are all in.
- **Rivals' camps are anchorages until the islands are walkable:** in stage 1 a rival lives at a chart mark with a stash you can't yet reach on foot; piece T makes it the Copycat's Hoard.
- **The posse searches from your boat,** not from your hideout, and never sets foot in a hideout's bounds.
- **The powder room is in** (09 cut #4 lifted, since Jared's Phase 8 decision left cuts #1–5 for later): it speeds powder and shot and makes bigger batches; nothing explodes, since nothing raids a hideout.
- **Wrecking works on the traffic's real routes:** ships steer by lights they know, so a false light only fools a ship whose route passes it; a clear night and an alert captain mostly see through it.
- **Lighthouse stations come before their islands:** piece H walks each station's pad, and Q and R open the rest of the island around it.
- **The cutter lies up from December to March** as the *Morrill* did; winter policing is the watch and the posse.
- **A winter you'd rather skip:** sleeping in a hideout's bunk offers "until ice-out" from freeze-up on, with the still and the law running; it's a choice, not the default.
- **Ice and snow are their own slice and visual layer;** frozen harbors use the berths, not a new port state.
- **The aurora and winter ice caves are in if cheap** (04 cut #3, 11 cut #1), and the first to go if stage 2 or 3 runs long.
- **The diving suit and deep wrecks wait for the first update after Beta,** as §15 allows; shallow salvage is in.
- **La Pointe comes with Madeline** in piece Q as a small village with its pier and trading post, not a district with a watch and a lockup.
- **No new goods:** poached venison is already contraband in `goods.json`, and furs are already a good.
- **Each stage's playtest is short:** the stage's criteria and an hour's play, not a full Phase sign-off; the 0.9.0 playtest covers everything.
- **The two parked Phase 7 fixes stay parked** (Jared, 2026-11-17).

### 18.6 Decisions for Jared

1. **How should Phase 9 be staged?** **Decided 2026-11-17: three stages, each ending in a playtest, Beta at the end** (Jared).
   - **Three stages, each ending in a playtest, Beta at the end (recommended):** the sandbox's life first (events, rivals, the posse, stations, lighthouses and wrecking), then winter, then the islands and their secrets. Each stage is about one Phase 8, so there's something new to play at each stage's end, and stage 3 can be cut to fit.
   - **One phase, one playtest at the end:** as Phases 5–8 ran. Fewer stops, but nothing to play for a long time and a large final playtest.
   - **Beta after stages 1 and 2:** tag 0.9.0 with the sandbox and winter, and move the islands and secrets to a Phase 9.5 before the lakes. Beta comes much sooner, but plan 17's Beta definition (islands and legends) changes.
2. **Which docks districts come in Phase 9?** **Decided 2026-11-17: Duluth only; Ashland, Washburn, Superior and Two Harbors after Beta, La Pointe with Madeline** (Jared). Plan 17 says Beta has all of them; 08 §2.2 lists six more.
   - **Duluth only, the rest after Beta (recommended):** the biggest port, the best fence, the Saloon Keeper's start, the Dark Light legend's town and a jail of its own. One piece, and the machinery is built. Ashland, Washburn, Superior and Two Harbors follow after Beta; La Pointe comes with Madeline.
   - **All six, as plan 17 says:** about four more pieces of layout and guards, and the longest stage 3.
   - **None:** Bayfield stays the only district at Beta, and Duluth's back room stays a port tab.

### 18.7 Housekeeping found along the way

- The master plan's Phase 9 row should name the three stages and decision 2's districts once this is approved, and plan 17's Beta row should match decision 2.
- Plan 04 §15 says the MVP ends at freeze-up; that stop was never built (§18.1), and stage 2 makes it moot. 04 says so now (piece K, [04 §26](04-water-weather-seasons.md)).
- Plan 12 §11's Phase 8 row still lists events and letters; 09 §16.6 moved them here.
- Plan 09 has two sections numbered 16.11 (the slipway and build audio); the slipway's should be 16.12.
- Plan 17 §9's Beta checklist wants the Ojibwe cultural review "well before Beta" and hosting for the first public release. Both are Jared's to start; neither blocks a piece.
- Phase 8's playtest and 0.8.0 tag, and Phase 7's laptop playtest, are still open.

### 18.8 Piece O as built: discovery and the journal (2026-11-19)

**What the fog of war covers.** The Lake Survey printed western Superior's coast and soundings, so they stay on the chart as plan 03 §5.2 has them. What the fog covers is the places on it: points of interest, natural wonders, the coves you can lie in, shoals the survey didn't sound (or you haven't bought), hideout sites you don't hold, and the lake's wrecks. Each goes on the chart in the survey's own signs (a small inked building, an asterisk for a wonder, a teal anchor, a dotted line with rock crosses round a shoal, a dashed pencil square for a site), with names written once zoomed in. Jared can ask for a visible wash over unvisited water instead; it's a drawing change on the same state.

**Data.** `data/discoveries.json` lists 26 places in the Apostles and Siskiwit Bay: 7 points of interest (the Stockton, Hermit and Basswood quarries, the Outer, Rocky and Manitou fish camps, the Sand Island farms), 4 wonders (the Devils Island, Sand Island and mainland sea caves, Big Bay's spit), 8 anchorages and 7 shoals, each with a by-day sight range or the radius you sail into, the survey sheet that has it, Fame for a wonder, the journal's line, and saloon talk for some. Sites come from `sites.json` and wrecks from the save. It also holds each legend's lead circle and the leads' shrink rule. `data/curios.json` is a catalog of 8 curios.

**Lifting it.** About once a real second the game looks round: from the deck (further through the spyglass, by the instruments' magnification), from your feet ashore, or the lookouts on a chart voyage. Range is the place's by-day range, down to 30% at night, capped by the weather's visibility. Coves and shoals are charted only by sailing (or rowing) into them. A `place` rumor (the new kind, "Local knowledge") puts a place on as reported, a pencilled query, until it's seen. The chandlery sells the **Lake Survey chart of the Apostle Islands** ($12, once), which charts its 14 anchorages and shoals. Reading or taking a station's logbook copies the shoals within 9 km and the wrecks within 12 km of its light. Your own hideouts and wrecks are always on it. Each new place gets a HUD line and a logbook entry, a wonder 2 Fame. A charted shoal under the keel makes the depth readout warn at 3 drafts, as the sounding machine does: the "safer night approach".

**Leads, legends and curios.** `leads[]` keeps each lead's search circle, clues and outcome; a clue shrinks the circle to 55% (no smaller than 400 m) and moves it toward where the clue points, keeping the spot inside. Every legend tale heard opens its legend's lead, so a 0.8 save's rumors count as the first clue. Piece T adds the other clue sources through `discovery.lead()`. `curios[]` keeps each curio, where it came from and the hideout it's set out at; the Stockton cache now holds the brass compass. A hideout's new Curios tab sets them out on its shelving (one a piece), tables (two) and sea chests (one).

**Journal.** Four new tabs in the ledger: Leads (each with its area and its clues, dated), Legends (heard ones with their steps; unheard ones as blanks), Discoveries (by kind, with how and when, and "n of m known"), and Curios (the catalog count and where each is).

**Save.** `discovery`, `leads` and `curios` are optional slices, so no version bump. A run from before them is charted on load with what it has been near (3 km round each port it has prices from, the stations it landed at, the caches it searched, and where it is), and keeps every wreck it already had on the chart.

**Not in piece O:** the curios aren't drawn on the shelves in the world yet (piece P's kits, with the POIs), the legends' steps beyond the first and every other clue source (piece T), salvage finding wrecks by sounding (piece U), a chart-voyage grounding risk on uncharted shoals (the Apostles' shoals all lie inside the zone, where the real depth already grounds you), and charts of the other regions. `__glpDiscovery` reads and drives it.

---

### 18.9 Piece B as built: the nickname and the endings (2026-11-19)

**The nickname** (`src/sim/news/nickname.ts`, `gameplay/nickname.ts`; pools in `newspapers.json` `nicknames`). The record is the papers' view: a crime counts once a report lands that names you or your ship (`ReportFiled`, heat added, identification `ship` or `person`), once per crime; honest feats count as `feat`. Ten deed kinds, each a list of crimes, a notoriety and four forms: killer 8, wrecker 6, scuttler 6, defiant (firing on the law, jailbreak) 5, gentleman 3.5 (piracy and firing on ships while the papers know of nobody killed), pirate 3, thief 1.5, brawler 1.5, smuggler 1, honest 0.6; and a fallback for Fame with nothing to name. A kind's score is its count times its notoriety, so the most frequent and the most notorious lead together. The haunt is the place with the highest score of port calls (1), nights at a hideout (2) and named crimes at a port (1), from 6 up. A form can name the haunt (`the Terror of {haunt}`) or take " of {haunt}" (`the Moon-Cusser of Stockton Island`); `{first}` and `{last}` are the captain's names; the form is picked by the run's seed. At Fame tier 1 the name is coined; another kind or haunt has to beat the current one by 1.25 times to change it. Each coining or change is a `nickname` or `renamed` story in the paper of your hottest region (or your haunt's), a logbook line, a HUD notice and `NicknameChanged`. While the reroll is unused, the editor's letter (`event.nickname_letter`, `draw: false`) offers to print a letter from you; writing it rerolls the name once (the same record, another form), and changes after that keep the new reading. In print, `{WHO}` in a story about you by name is the nickname, `{who}` sets it in ("Captain Ida Bergquist, "Bloody Ida," of the schooner Hope"), the WANTED notice gets `alias`, and the Most Wanted page and the end page use it. Saved as an optional `nickname` slice.

**The endings** (`data/endings.json`, `src/sim/run/endings.ts`, `gameplay/endings.ts`). Every 6 game hours, out of jail: **Retire** when the cash in your hideouts' strongboxes is $10,000 or more (the measure and sum of the `ambition.money_in_the_bank` Ambition, so the offer never comes before that goal; Jared, 2026-11-19) and no region is above tier 2; **Turn Lawman** when Fame is tier 3 (Infamous) or more, every region tier 1 or below, and Standing 60 in two ports. Each sends its letter (`event.retirement_offer` from a Bayfield land agent with three choices, `event.lawman_offer` from the U.S. Marshal of the Western District of Wisconsin), standing three game days and offered again six game days after it lapses or is put off. A retirement choice or the badge ends the run (`retired` with the retirement, or `lawman`): the port screen closes and the end screen shows the ending's front page (the Duluth daily for the saloon and the badge, the Bayfield weekly for the cabin, by Fame for the farm), the summary ("How it ended" from the page) and its epilogue, "What became of the captain". The summary also gives the nickname and lives taken (`stats.killed`, counted from every killing).

**The Hall of Captains** (`src/sim/run/hall.ts`; the `hall` IndexedDB store plan 16 §2 already made). Each ended run's record now carries the nickname; the main menu's **Hall of Captains** lists them latest first (portrait, name, nickname, ship, epitaph), each opening to its headline and summary. It survives a reload and a new run (`e2e/endings.spec.ts`).

**Hooks:** `__glpNickname` (`state`, `deed`, `place`, `check`, `reroll`), `__glpEndings` (`eligibility`, `offer`, `check`, `end`) and `__glpLaw.setFame`.

**For Jared:** the nickname pools (`newspapers.json` `nicknames`), the nickname stories and the editor's letter, the endings' pages and epilogues (`endings.json`) and the two offer letters (`events.json`) are first drafts; the thresholds ($10,000 stashed, matched to the Ambition; Fame tier 3 and Standing 60 in two ports) are guesses. The land agent H. L. Dahl and Marshal J. C. Merriam are invented names.

**Not in piece B:** the ending music (piece Y); rivals' names (piece E); Abandon recorded as "Abandoned" was already in the Hall; no journal page shows the nickname yet (the papers, the end page and the Hall do).

### 18.10 Piece U as built: salvage (2026-11-19)

**The wrecks.** `data/salvage.json` holds the old wrecks of the record and the rules. The record's three, all in the Apostles zone: the ***Lucerne*** (three-masted schooner, iron ore, lost with all hands off Long Island, November 1886; R1 ✅), the ***R.G. Stewart*** (wooden steam barge burned off Michigan Island, 1899) and the ***Antelope*** (schooner-barge, coal, sank north of Michigan Island in 1897; deep, so out of the grapple's reach until the diving suit). R1's other names (*Coffinberry*, *Fedora*, *Ottawa*, *Pretoria*, *Noquebay*, *Sevona*) were lost after 1900, so by R1's rule they stay live ships. Each run also places three invented old wrecks (1868–1898, schooners, scows, tugs, a steam barge, a lumber hooker) at three of seven shallow spots off Eagle, Sand, Gull, Outer, Stockton, Basswood and Rocky islands, drawn by the run's seed. The spots and the *Lucerne*'s place were set where the baked terrain is 5–8 m deep. The run's own wrecks (`state.wrecks`) are worked the same way.

**Finding one.** About once a second at the helm the game looks over the side: a wreck within 70 zone m (less the deeper she lies) is seen on the bottom by day, in a calm (Hs ≤ 0.7 m) and no deeper than 12 m; within 22 m of her middle the lead line finds her, and the HUD's depth readout spikes by her hull's relief (2.5 m) whether she's known or not. Either way she goes on the chart through piece O's discovery (a new found-how, `sounding`, "Found by the lead"), with a logbook line and her chart mark, and a lead pointing at her is run down. A light station's logbook charts the old wrecks the keepers know of (the record's three, not the seeded ones). The run's wrecks are still sighted from 2.5 km by their masts, as piece O has them. A simple broken hull is drawn on the bottom where each lies (a mast standing for the run's own); the water's look hides it mostly, so the depth spike is the tell.

**Working one.** Anchored within 35 zone m of a wreck you know, the HUD offers "F cast the grapple · the Lucerne, 5 m down". F puts the line down for 2.5 real seconds ("Dragging the grapple over…"); weighing anchor brings it in. The cast takes 40 game minutes and hooks by a chance: 55% in calm shallow water by day, down to 55% of that at the grapple's 10 m limit, 45% of it at the 1 m sea limit, ×0.7 by night and ×0.8 for a wreck five years down. A hooked cast brings up 1–3 CU of a good still in her (picked by what's left of each), each CU sound by the good's half-life on the bottom in calendar days (`halfLifeDays`: fresh fish 3, salt 6, grain 20, flour 30, provisions 45, furs 90, salted fish and dry goods 120, rope and canvas 1500, hardware 3650, kerosene 7300; ore, coal, stone, lumber, copper and whiskey keep), the spoiled ones over the side. Now and then (25%, and always once the cargo's gone, or when the hold's full) it brings up her papers or her curio instead. A full hold, too deep, too rough or picked clean, it won't go down and says why.

**The law.** Old wrecks are anybody's and your own abandoned ship is yours: clean cargo. A lost ship of the run comes up under her owners' marks (hot, `hotHeat` 0.6, traceable to the company); one you sank is hot too. Seen at a hot wreck by any witness the law has at that moment, it's the new **`crime.wreck_plunder`** (Plundering a wreck, heat 15, Standing 3, grudge 5), at most once a wreck a day; seen at one you sank, 20 more heat in the region and a line in the logbook ("keeps your stay suspicious").

**Papers and curios.** The *Lucerne*'s log adds a clue to her legend's lead (the company's box "stowed aft under my bunk"), moving its circle to her; each seeded wreck's papers name the next seeded wreck and open a `wreck` lead with a 2.5 km circle round where she went down. Piece T can give more wrecks papers through the same field. The *R.G. Stewart* gives the ship's bell, and the first seeded wreck a new curio, the ship's side lantern.

**Save and hooks.** `salvage {wrecks: {id: {raised, spoiled, casts, hooked, papersAt, curioAt, lastAt, crimeAt}}}` is an optional slice for every wreck worked, old or the run's (plan 16's `wrecks[].salvaged` folded in here, since the old wrecks aren't in `state.wrecks`); no version bump. Seeded wrecks come from the seed, not the save. The journal's Wrecks group lists the old ones found and what's come up from each. `__glpSalvage` reads and drives it (`sites`, `over`, `look`, `cast`, `left`, `note`, `depthAt`, `zoneAt`, `geoAt`). `GrappleCast` and `WreckWorked` are new game events for piece Y's sounds.

**Not in piece U:** the diving suit and deep wrecks (post-MVP, §18.5); fittings (guns, instruments) from a wreck; wrecks outside the Apostles zone (there's no other baked zone to anchor in); the run's wrecks' papers; the grapple and wreck sounds (piece Y); saloon talk of old wrecks as `place` rumors; the *Lucerne* legend's strongbox payoff (piece T); the hull's look under water (Jared). The R.G. Stewart's and Antelope's dates, places and cargoes are marked `verify` in the data.

**For Jared:** the wreck names, lore and papers wording; whether the seeded wrecks should be more than three; the chance and time per cast (40 min, about one CU an hour in good conditions); whether seeing the hull on the bottom wants a clearer water look.

### 18.11 Piece L as built: winter's look (2026-11-19)

Built as scoped; the write-up is [04 §27](04-water-weather-seasons.md). The ice sheet over the water comes from K's ice through the zone's shelter and a daily lookup strip (and calms the sea under it), floes are instanced at ice-out, snow lies on the terrain, the trees, Bayfield, the hideouts and the decks by a snow series worked out from each winter's air, cold air turns rain to snow, spray freezes, the palettes go to winter, and the aurora is in (04 cut #3 lifted; it is cheap). Not in L: shore ice ridges, rime on hulls, tracks (M), ice caves (S), sea smoke.

**For Jared (the look):** the ice and snow tones (`ICE_*_HEX` in `water-material.ts`, the snow color in `stylized-material.ts`), how white the land goes, the crack density, the winter palette's strength (`winter-palette.ts`), the aurora's color, height and frequency (`data/winter.json`), and whether snow should come off the decks of a ship under way.

### 18.13 Piece J as built: stage 1 audio (2026-11-19)

Plan 15 §22 has the detail. The saloon plays "The Late Boat Waltz" on piano and fiddle from 7 PM (on foot in Bayfield and at any port screen's saloon or card table); the card table is heard move by move as cards and chips from beats the table now records; a lighthouse station's lamp turns its clockwork while it burns at night, and its keepers snore, greet and are heard at their stair, lamp and oil house; the harbor master rings his bell and letters tear open and seal; a ship put on a wrecking mark's shoal is heard going aground from up to 3 km (`ShipStranded`), and your own ship touching bottom; a rival's stinger waits for piece E on the bus (`RivalStinger { rival, why }`). 25 synthesized sounds, 0.93 MB; the decoded audio is 6.13 MB of 8 MB.

**Not in piece J:** the stinger raised by anything but the dev hook until piece E lands, a fixed light's lamp without clockwork, a letter's arrival heard, the moon-cussing night's music. **For Jared:** the listen by ear (row J).

### 18.14 Piece P as built: POI kits (2026-11-19)

**The kits.** Twenty-two new piece kinds in `data/schemas/pois.ts`, built in the quarry's way (procedural parts in palette colors, `src/render/onfoot/poi-kit.ts`) and merged with every other point of interest on the zone into the one toon-lit mesh `poi-view.ts` already drew, so the kits add no draw calls: the **fish camp**'s timber dock on rock-filled cribs, board shanties with stovepipes, the fish house on its posts, gill-net reels, net-drying racks, barrels and a Mackinaw boat turned over on blocks; the **farmstead**'s log cabin with its fieldstone chimney, a board-and-batten barn, fields draped over the ground (plowed, oats, potatoes or hay), split-rail fences, a woodpile and stumps; the **trapper's cabin** (the cabin's stovepipe-and-lean-to variant) with its pelt-stretching racks; the **viewpoint**'s Lake Survey signal tripod; **beach wreckage** (a hull's ribs and keel in the sand, a broken spar and its rigging, strewn planks); **cairns and dig spots** (a dig spot is a hump of turned earth and a blazed stake; a cairn scales from the cache cairn); boulders; and the **cave mouth**, an arch in bedded sandstone, black inside, closed 0.8 m in by a back wall until piece S opens the cave. `pois.json` lays them out as eight prefabs: `poi.fish_camp`, `poi.farmstead`, `poi.trapper_cabin`, `poi.viewpoint`, `poi.beach_wreck`, `poi.cairn`, `poi.dig_spot` and `poi.cave_mouth` (from about 100 triangles for a dig spot to 3,700 for the fish camp). Each kind is solid where it's drawn (`pieceColliders`): buildings as boxes, barrels, reels, the boat, woodpiles, fences and stumps to vault, racks, fences, ribs and the signal to see through, fields, planks and dig spots walked over; the cave mouth's jambs, lintel and back wall come from the same `caveMouthBlocks` the renderer draws, so its opening is walkable to the back wall.

**Placing a POI (for pieces Q and R).** A POI goes on an island the way Stockton's quarry did: an entry in its `islands.json` `onFoot.pois` (`{ id, poi, x, z, facingDeg }`, meters on the island's 1 m tiles, facing the prefab's open side). Behind it is one function, `placePoi(poi, at, origin, heightAt)` in `src/sim/islands/on-foot.ts`, which `placeIsland` now calls for each: platforms (ledges and the dock) first, everything else standing on them or the ground, a ladder down a dock's end into water, fields sampled on a 2 m grid over the ground, stumps each on the ground under it. Each prefab says what it stands on (`site`: shore, beach, clearing, hilltop or cliff) and carries **marks**, named points in its frame placed with it into `PlacedIsland.marks`: `fire` (a stove or hearth to warm at, piece M), `resident` (where a fisherman or farmer works, Q), `dig` and `cache` (T), `view`, `cave` (S), `landing` (where a rowboat comes in) and `search` (U, T). `__glpPoi.marks(kind)`, `pois()` and `shelves()` read them in the game.

**The budget per tier.** `data/island_tiers.json` holds each tier's budget: the whole frame on foot at Medium (draw calls 150 / 140 / 130, triangles 400k / 300k / 250k for hero / standard / minor), the island's prefabs together (40k / 15k / 4k triangles, at most 10 / 3 / 1 prefabs), its people and animals, any one prefab (8,000 triangles) and a cave (40 calls). `tests/poi-kits.test.ts` fails if any prefab or any island in `islands.json` goes over its tier, so Q and R find out as they lay islands out. `npm run bench:island` now runs both benches: the Stockton walk against the hero frame budget (65 draw calls and 222k triangles at most, headless), and `pois.bench.ts`, which draws each tier's showcase set on `/pois.html` and checks it is one draw call within its triangles (hero set: 9 prefabs, 15.9k).

**The showcase.** `/pois.html` (dev only, like `hideout.html`) sets every prefab down with `placePoi` on ground shaped like its site and draws it with the game's POI view: `?tier=` shows a tier's set, `?poi=` some prefabs, `?marks=1` each mark as a colored pin, T steps the hour; `window.pois.frame(id)` and `piece(kind)` frame one for screenshots.

**Curios on the shelves.** The curios a hideout's Curios tab sets out (piece O) are drawn there: each of the eight has a small model (`src/render/hideout/curios.ts`), and `curioSlots` puts them in the order they were set out on the gap in a shelving's top shelf, two places on a table, a sea chest's lid. They merge into one mesh per hideout and are redrawn when what's set out changes.

**Not in piece P:** placing the POIs on the islands (pieces Q and R; Stockton keeps just its quarry), a logging-camp-remnants prefab beyond Siskiwit's (the Phase 8 kinds serve), lit windows at night in the cabins and shanties (they need the glow mesh the lighthouse kit has; Q, with the residents), the cave behind the mouth (S), digging at a dig spot (T), and screenshots of curios on a hideout's shelves in the game (the slots are computed and drawn, but no camera shot was taken).

**For Jared:** the look of every kit (the screenshots in `poi-kits/`), especially the barn's faded red, the oats' gold, the cave mouth's square bedded arch, and whether the viewpoint should carry a Lake Survey signal; the tier budgets; and where the curios sit on a shelf.

### 18.15 Piece M as built: on the ice and in the cold (2026-11-19)

**Data.** `data/cold.json` holds every number: what ice holds a walker (10 cm, plus 1 cm per 25 kg hauled), the thin-ice stress and its stages, warmth rates, the sled, the prints, and the ice road. The pure sim is `src/sim/cold/` (footing, warmth, sled, tracks, road), and `src/gameplay/cold.ts` lays the ice over the on-foot ground.

**Walking on the ice.** In the zone scene, wherever piece K's ice covers at least 70% of a cell and is at least 3 cm thick, the ground is a walkable sheet just above the water. G at anchor or at a frozen non-district pier steps down onto it. Seeded weak spots run thinner. On ice under what holds you, stress builds (faster running, slower standing still). It cracks at 25%, groans at 60%, and gives way at 100%. A hole opens under you, and you have **one chance**: within 14 s, hold F for 2.2 s to haul out onto ice of at least 35% hold. A slip resets the haul, and when the window runs out you're lost (a new run end, "Went through the ice"). Hauled out, you're soaked.

**The ice road.** Once Chequamegon Bay is 20 cm thick (most Februaries), the road runs from Bayfield's city pier head to La Pointe's pier, about 460 m in the zone, marked with spruce boughs every 30 m, with a fire barrel at each end. In the district, at the pier head, "Down onto the ice road to La Pointe" puts you on it in the zone scene, and "Up the ladder into Bayfield" at the far end brings you back. The road's ice is cleared and stays thick, so it never groans under a loaded sled.

**The sled.** Beside a frozen-in ship, F puts the hand sled down, and F again loads it from the hold, the most valuable clean goods first (3 CU; contract cargo stays aboard). It follows on a 2.6 m rope and slows you 10% per CU (down to 60%), and its weight counts against the ice. At La Pointe's end, "Sell the sled's load at La Pointe's trading post" sells clean goods at La Pointe's market price; hot goods stay on the sled. Leaving within 40 m of the ship stows it and its load. `player.sled` is saved.

**Warmth.** `player.warmth {value, wet}`. On foot, value falls with the wind-chilled air below 8 °C, three times faster when wet, much faster in the water, and slower running. Rain wets you, snow a little. It recovers under a roof (any district, a keeper's house) and fast within 4 m of a fire, which also dries you. Aboard it comes back 60 an hour. Stages: chilled at 60, cold at 35, freezing at 15, each with a HUD line. At 0, health drains (0.5/s), and dying of it is "Froze to death". The HUD has a warmth bar with its stage word.

**Tracks.** Walking on snow-covered ice lays a print every 0.9 m (a sled's runners too), up to 600. Snow fills them in over 40 minutes of falling snow, and they go after a day. A print laid within 6 hours of a crime is suspect. When the watch or the island posse loses you on the ice, a guard who comes on suspect prints within 3 m follows them toward their freshest end (`stealth.follow`). Prints are drawn as instanced decals.

**Heists on frozen-in ships.** A ship laid up in a frozen harbor posts no deck watch, so her hold can be robbed in the district, and she's found robbed late.

**Not in piece M:**
- Bayfield's district harbor isn't walkable ice; the road starts at the pier head and goes into the zone scene.
- No raids on frozen ships from the zone scene's ice; heists stay in the district.
- No campfire kit to carry. Heat comes from roofs and the road's fire barrels.
- No ice caves and no wolves on the ice (plan 11 §6).
- No winter audio: cracks, groans and footsteps on snow are piece N's job.
- A sled left on ice that later melts isn't sunk. It's only stowed when you leave within 40 m of the ship.
- A hole's size follows the ground grid's cell (4 m in the zone).
- The ice sheet and snow aren't drawn (piece L), so until L lands the figure seems to walk on water.

`__glpCold` reads and drives it.

### 18.16 Piece N as built: winter audio (2026-11-20)

Plan 15 §23 has the detail. Piece M's thin ice cracks at 25% (with more cracks after that, coming faster as it builds), groans at 60%, and gives way with a crash; the haul out (`IceClimbed`) and an edge breaking away are heard too. Strides on bare ice tick, on snow they crunch, and below −10 °C they squeak. The sled is heard as it's handled (`SledHandled`), and its runners hiss behind you, following its speed and load. As warmth drops, a shiver comes from chilled, teeth chatter at cold and freezing, and gusts come harder and more often. A winter wind blows by the season, the air and the ice cover. Where the lake is frozen over, the lapping and the gulls stop. A harbor frozen in at night goes still, with the ice booming far off. Snowfall makes no sound. 18 synthesized sounds, 0.46 MB; the decoded audio is 6.59 MB of 8 MB.

**Not in piece N:** a sound for the ice grinding on a hull (piece K's `IceGrinding`), wind in a frozen-in ship's rigging, and any change to the noise radius on snow and ice (sound only). **For Jared:** the listen by ear (row N).

### 18.17 Piece Q as built: hero islands (2026-11-20)

**The seven.** Madeline (with La Pointe), Hermit, Basswood, Devils, Sand, Outer and Raspberry are `tier: "hero"` in `islands.json`, each walked whole on the baked 4 m zone terrain as Stockton is. Their `onFoot` entries hold the POIs (P's prefabs, set with `placePoi`), named **landings** (`{ name, x, z }`, where `__glpIslands.land` brings the rowboat in), the **residents**, how fast word leaves the island (`reporting`), and for Madeline the **village**. The POIs:
- **Sand:** the East Bay fish camp, the Hansen and Johnson farmsteads, a cave mouth at the swallow caves (closed, as P left it), a beach wreck on the west shore, and a viewpoint.
- **Devils:** a cave mouth on the north cliffs, a south-beach wreck and a viewpoint. There's no fish camp, because the shore is cliff all round.
- **Raspberry:** a fish camp on the sandspit and a viewpoint, round the light station.
- **Hermit:** the brownstone quarry, Wilson's trapper cabin (empty), a fish camp on the north shore and a viewpoint.
- **Basswood:** the old quarry, the Becker farm, a fish camp on the east shore and a viewpoint.
- **Outer:** an empty fish camp on the sandspit, a trapper cabin, a viewpoint and a wreck on the west beach.
- **Madeline:** the Haskell and Nygaard farms on the Big Bay road, the north end fish camp, a trapper cabin, a viewpoint and the Big Bay wreck. **La Pointe** is the harbor layout already there (pier, store, church, mission, fish sheds), now walkable as part of the island. At the store's front door, F offers "Trade at the trading post", which opens La Pointe's market.

The fish camps and quarries were placed by a search for the lowest shore near each spot, scored on dock height and dry footings. The trees are the zone's own, cleared round each piece as before. Every island fits its hero budget in `tests/poi-kits.test.ts`.

**Growing round the stations.** An island's scene now includes its light station's solids, landing and ladder (the keeper's stairs stay H's), so landing anywhere on Sand or Raspberry walks you to the light, and the keepers nearest your landing are on duty. Where baked boxes overlap (Basswood's lies inside Madeline's, and Madeline's reaches Bayfield), the island under you is the one whose land is nearest. `placeZoneIslands` works this out on an 8 m grid from the island's chart position (`PlacedIsland.land`, `landDistanceM`). In winter, the ice road's far end at La Pointe offers "Up the ladder onto La Pointe's dock", which builds Madeline's scene there.

**Residents.** There are three new NPC types, `npc.fisherman`, `npc.farmer` and `npc.villager`, with the keepers' sight and hearing. They don't chase. They are witness kind `townsfolk`, and `law_actors.json` gives that kind a `byReporting` delay: fast 0.5–1.5 h, medium 2–5 h, slow at dawn plus 1–3 h. Raspberry is fast, Sand and Madeline medium, and Hermit and Basswood slow. A resident's round is his home POI's `resident` marks (P), then any `round` points, snapped to walkable ground on a 1 m grid of his own (`LocalNavs`), so a whole island is never gridded at a meter.

The residents by island:
- **Sand:** four (the Hansen and Johnson farmers, and the Brekkes of the fish camp).
- **Madeline:** five (two farmers, the north end fisherman, and a villager and a fisherman in La Pointe).
- **Basswood:** three.
- **Hermit and Raspberry:** one each.

With a keeper, no island has more than six people. Residents are out from dawn to dusk and indoors at night. Their fates (dead, out cold, bribed) are saved in an optional `residents` slice, as the keepers' are. On an island with a station, they join `createStationWatch`. Elsewhere, `createIslandWatch` (`src/gameplay/onfoot/island-watch.ts`) runs them with the same tool belt, foot law and HUD.

By day at Wanted tier 1 or below, F next to a resident is "Talk with …": one of his own lines, a line a day. At higher tiers or at night, standing in his yard is trespass, and carrying a body or showing a weapon is suspect anywhere. What he sees goes through `createFootLaw` as a `townsfolk` witness with the island's reporting speed, and a notice tells you how soon word will reach town.

**Lit windows.** The shanties, cabins and fish houses where someone lives get amber panes, drawn as one more mesh (`island-pois-windows`) whose glow follows `lampLevel` from dusk, as the towns' windows do.

**Hooks and tests.** `__glpIslands`:
- `list()` returns each walkable island with its landings, residents and village.
- `land(id, k)` anchors off a landing, rows in and steps ashore.
- `here()` returns the island under you, its people as the watch has them, and their fates.
- `meet(id)` stands you in front of a resident.

`tests/hero-islands.test.ts` checks:
- the data and budgets;
- every landing at the water and resolving to its own island;
- each resident's round snapped on the real terrain, with people out by day and none at night;
- townsfolk reports at their island's speed.

`e2e/hero-islands.spec.ts` lands on all seven, finds the residents about, and walks.

**Not in piece Q:**
- La Pointe's light is on Long Island (`light_stations.json`), so Madeline has no station or keeper.
- La Pointe is not a district: it has no watch, lockup, or houses to rob.
- No hunting or wildlife (V).
- Caves stay closed (S).
- No digging or caches on these islands (T).
- No new hideout sites (W).
- Residents don't row to town on screen: a report is a timer, as a keeper's is.
- Hermit and Basswood's quarry wharves and Basswood's fish camp dock stand 4–5 m over the water, because their shores are steep in the baked terrain.

**For Jared:**
- The residents' names and lines, all invented.
- Their looks: the fisherman's oilskin, the farmer's straw hat, the villager's coat.
- Where each POI sits, especially the high quarry wharves.
- Each island's reporting speed.
- The residents' vigilance and bribe odds (0.45–0.65; 55% / 45% / 40%).
- The trading post's title.

Screenshots are in `hero-islands/`.

### 18.18 Piece R as built: standard and minor islands (2026-11-20)

**The islands.** All fourteen standard and minor Apostles now walk, on the real baked terrain the bake already cut for each (its 1 m tiles mark the extent; the walked ground is the zone's 4 m terrain, as Stockton's is). Each has a `tier` and an `onFoot` entry in `islands.json`, with its prefabs placed by piece P's `placePoi`, sites picked off the baked ground (the shore with the lowest bank for a camp or a wreck, the island's top for a lookout, the flattest ground near the hint for a cabin):

| Island | Tier | What's ashore |
|---|---|---|
| Michigan | standard | Piece H's light station on its bluff; beach wreckage on the west sandspit; a Lake Survey lookout on the high ground at the northeast end |
| Long (Chequamegon Point) | standard | Piece H's two stations at the point; beach wreckage on the spit (the _Lucerne_ was lost off it); a fish camp on the lagoon shore |
| Oak | standard | A lookout on the summit (42 m, the highest in the islands); a trapper's cabin on the plateau above the southwest spit |
| Manitou | standard | A trapper's cabin above the southwest beach, standing for the fisherman's log cabin (piece O's place text), where the rival camp says "by the old fish camp" |
| Rocky | standard | A fish camp on the sandspit at the south end, facing the anchorage between Rocky and South Twin (piece O's place moved there from the east shore, which is all bank); a lookout on the high west side |
| South Twin | standard | A fish camp on the west shore, across the sound |
| Otter | standard | A trapper's cabin; a cairn on the high ground (a cache candidate for piece T) |
| Bear | standard | A lookout on the cliff top at the south end; beach wreckage on the south beach |
| Cat | minor | A cairn on the high ground (a cache candidate) |
| York | minor | Beach wreckage on the sandspit |
| Gull | minor | A cairn on the bird rock (a cache candidate) |
| Ironwood, North Twin, Eagle | minor | Nothing: walkable and wild |

No caches are filled (piece T), nobody lives there (residents are Q's), and there's no wildlife (V), cave (S), digging (T) or hideout site (W).

**Which island you land on, and stations.** Tile boxes overlap here too (Rocky's holds South Twin, Gull's the tip of Michigan, Oak's a corner of Manitou). Piece Q's `islandLand` (each island's own land, grown from its `islands.json` point, with every cell's distance to it) tells them apart, and Q's station merge puts Michigan's and Long Island's stations inside their islands' scenes, keepers of the nearest one watching; R built both the same way in parallel and kept Q's on merging. `placeZoneIslands` also keeps that point as the island's `anchor`, for `findLanding`.

**Landing.** `findLanding` picks where to come ashore: one of the island's own landings (Q's), else a prefab's `landing` mark (a fish camp's dock end, a wreck's beach) where you can step out there, else round the island from its anchor the shore with the lowest bank and water for the boat off it. Gull's rock is steep all round, so stepping out of the boat now falls back to `rockStep`: up the rock from the water's edge to the first ground you can stand on, no more than 4.5 m up and 8 m in, only where no beach step exists. Every rival camp's anchorage (piece E) lands on its own island, so a rival's camp is walkable ground (no camp is drawn).

**Tests and benches.** `tests/islands.test.ts` covers all 22 (Q's seven included): the catalog's tiers; for every island with `onFoot` data, a landing whose boat water takes you to that island and no other, a step out of the boat, the scene built whole and eight seconds' walk inland without swimming; each island's prefabs, triangles and people (station keepers and resident marks) within its tier; stations in their island's scenes; and the rival camps. An island without `onFoot` data would be skipped; on this branch none is. `bench.island` now also lands on Long (standard, two stations), Oak (standard) and Cat (minor) and holds each frame to its tier's draw calls: 97, 59 and 78 at most headless, against 140 / 140 / 130 (Stockton 69). Facing the wrecks off Long Island first drew 166: piece U's wreck hulls were 24 meshes apiece, and each is now two (hull and timbers merged).

**Hooks.** One `__glpIslands` for Q and R: `list()` (now with each island's `landing`), `landing(id)`, `land(id, k)` (Q's `k`th landing, or for an island without landings the beach `findLanding` gives), `here()` and `meet()`; `?ashore=oak` (any walkable island's slug) and an Islands folder in the dev jump menu.

**For Jared:** every placement and which kit each island got (above; the screenshots in `other-islands/`); Manitou and South Twin's camps as a cabin and a fish camp on a steep bank; the frame triangle budgets for standard (300k) and minor (250k) islands, which the zone's forest exceeds from some beaches (Cat 263k, Long up to 375k looking at the mainland): the bench holds them to the hero frame's 400k; the 4.5 m rock climb out of the boat.

**Not in piece R:** residents, lit windows, caches in the cairns, wildlife, caves, digging, hideout sites, drawn rival camps, and discovery places for the new prefabs (only Rocky's fish camp moved).

### 18.19 Piece X as built: Duluth (2026-11-20)

Built as scoped; the write-up is [08 §21](08-docks-district-stealth.md). You go ashore at the merchandise dock from the Twin Ports zone. Duluth's waterfront has a police constable on each of three beats and a fourth at the station, five buildings worth burgling, and counters at the saloon, general store, chandlery and harbor office. The fence's back room after dark replaces its port-screen tab. A captain taken in the Duluth, Superior or North Shore region is held in the police station's lockup and can break out of it. Criterion 17 is checked by `e2e/duluth.spec.ts`. The layout is a first draft for Jared to review in the district editor.

### 18.20 Piece S as built: sea caves (2026-11-20)

**The caves.** Five, in `data/caves.json` (schema `data/schemas/caves.ts`): three on Devils Island (the first cave through P's north `cave_mouth`, a second cave in the west cliff with the Devils cave cache, and the Devil's Grotto with its `grotto` mark for piece T), the swallow caves on Sand through its `cave_mouth`, and a mainland cave east of Siskiwit Bay with a winter cache. A heightmap can't overhang, so each cave is a passage: a line of nodes in its frame (a prefab's origin and facing, a point on its island's tiles, or a point on the chart), each with a width, a floor and a roof (none on the open channel in). Every one is tied to a wonder on the chart, so seeing one from inside charts it (piece O).

**How it's built.** `src/sim/caves/caves.ts` places them and samples a point's floor and roof. On foot the ground is a `CaveGround` that reads the cave's floor under its roof and the drawn terrain above it; the walls and roof are box colliders (`caveSolids`). The terrain shader discards its fragments inside each passage (`cave-clip.ts`, at most 8 caves and 40 segments a zone), and the water shader goes dark and still under a roof, with no foam or ice. The rock is one procedural mesh a cave (`cave-view.ts`), shaded darker with depth and frosted in winter, with an ice floor and icicles shown when it's frozen. P's cave mouths at Devils and Sand are opened (no back wall) where a cave runs through them. The mainland cave has its own small landing pad, as Siskiwit's camp does.

**Getting in.** You can row in under the roof only in a calm: above `rowMaxHsM` (0.6 m) at the mouth the boat is turned back with a notice. You can always swim in, but above `surgeHsM` (0.9 m) the surge throws you on the rock for 2.5 health a second, more as the sea builds. You can walk in at the open prefab mouths, which sit at shore level (not the inland shafts the scope imagined). In winter, when the lake's ice at a cave's mouth holds a walker (piece M's `iceUnderfoot`), the cave is an ice cave: no boat goes in, you walk in across the ice, and its winter cache in a crack over the water comes within reach. The first time in, the HUD says a line of its own (`entered`), saved in `caves.entered`. Caches are seeded among their spots by the run's seed and searched with F, as the cairns are.

**For Jared to check.** These are first drafts:
- where the caves sit and how they're shaped
- the `entered` lines and the cache texts
- the cache amounts: $40–110 at Devils, $25–60 at Sand, $50–140 in winter on the mainland
- the 0.6 m rowing limit and the surge numbers

The character isn't darkened inside a cave. `__glpCaves` lists, rows to, walks, freezes and reads the caves, and `tests/caves.test.ts` checks the data, the placement, rowing in and turned back, the walls, the ice cache and the draw budget.

### 18.21 Piece V as built: hunting and wildlife (2026-11-20)

**Data.** `data/wildlife.json` (schema `data/schemas/wildlife.ts`) holds every number: the three species (white-tailed deer, black bear, timber wolf) with their months, group sizes, speeds, senses, fire distance and warning lines; the islands with game; the herd's spread and regrowth; the rifle's odds at game; dressing and the carcass; the deer sign; and the traplines. The pure sim is `src/sim/wildlife/` (the FSM in `animals.ts`, the herd and the odds in `hunt.ts`, lying up and the sign in `spawn.ts`, the traplines in `traps.ts`), and `src/gameplay/onfoot/wildlife.ts` puts it on an island's ground.

**Who's about.** Deer live on Stockton (9), Madeline (12) and Oak (7), each spread ±30% by the run's seed. A deer you take is gone from its island's herd for two weeks (two game days). Landing on one, two or three of what's left lie up at least 140 m from where you came ashore and 90 m from anyone's door. A black bear may be about on Stockton, Madeline, Oak or Outer from April to November (15–35% a landing), and in December to March a pack of two or three wolves instead (30–55%) on Madeline, Oak or Outer. The tier's animal budget (`island_tiers.json`, 4) is never passed. The same landing on the same day finds the same animals.

**Tracking.** Up to five patches of deer sign (prints and droppings) run from 30–70 m off your landing toward the herd. F at one reads it: the way they went, and with the Poacher's woodcraft how many and about how far on.

**The senses.** Each animal looks five times a second. It sees you up to its sight range, cut by dark, crouching and standing still, and blocked by trees and the ground; it hears your strides by their noise radius; and downwind of you it smells you a long way (a deer 110 m, a wolf 160 m), in a calm only close.

**Deer.** Graze, Alert (head up, looking at you), Flee. An alert deer bolts if you come within 25 m or it hears you again; any shot within 600 m sends every deer off.

**Bears and wolves.** Wander, Wary, Threaten, then Attack or Flee, each change with a line on the HUD. A bear rears on its hind legs, huffing, and wolves circle growling. Back off past its threat distance and it goes back to watching you. If the threat runs out, a bold one (bear 30%, wolves 45%, rolled as it starts) charges, and the rest turn and go. Come on one inside 7 m (wolves 9 m) and it charges at once. Each bite or swipe costs health (bear 30 every 1.6 s, wolf 18 every 1.2 s), and dying of it is a new run end, "Mauled by a wild animal", with its own front page. A miss or a shot nearby may turn one (bear 60%, wolf 50%), and a hit may too. A bear takes three balls and a wolf one. None comes within its fire distance of a fire (a cabin's stove, a camp's fire): standing near one, a threat breaks off and a charge stops short and watches. In the boat or the water you're out of reach. Killing an animal is no crime.

**The rifle.** Every captain's ship carries the rifle in its hand mount. With one in your sights within 110 m and 7° of where you face (wider for a close one), F is "Shoot the deer (64 m)". The chance to hit falls from 95% at 25 m to 35% at 110 m. Crouching steadies it ×1.15, moving costs ×0.6, and a running animal ×0.55. Reloading takes 2.5 s. A hit deer drops 70% of the time; otherwise it runs on wounded and is down 35 s later where it stops. The shot is a 600 m noise to the island's keepers and residents, who come to look, and it's heard.

**Dressing and carrying.** Beside a downed deer, hold F for 9 s (5 s with woodcraft) to field-dress it, then lift the carcass onto your shoulders. You walk at 62% (80% with woodcraft), can't crouch, and F only puts it down. At the boat, "Lay the carcass in the boat" puts 2 CU of venison in the hold. Going aboard with it does the same.

**Venison.** Venison is contraband as before. Nils Okerlund at Bayfield now takes it at his better rate, and Mr. Carrow and the smugglers buy it as any hot lot. The smokehouse's new recipe turns 3 venison, 1 salt and 1 lumber into 2 CU of **smoked venison** (a new contraband good at $60, which keeps all year, against fresh venison's $25 in fall and winter). **The Venison King** Ambition (sell 50 CU of venison, fresh or smoked, on the quiet, to a fence or a smuggler; $50 and 5 Fame) has a story in the papers.

**Traplines.** Four trap spots, each a blazed stake, stand round each trapper's cabin on Madeline, Outer, Oak, Hermit, Manitou and Otter, on gentle dry ground 30–90 m from the door. Steel traps are a new chandlery store ($0.90, eight in the lockers). From November to March, F at a spot sets one. A setting may hold a pelt after one to three weeks (45%, 65% with woodcraft), and F there takes it (1 CU of furs into the hold) and the trap back. A pelt left five weeks after its catch is spoiled. What a setting holds comes from the run's seed and the time it was set, so a reload finds the same.

**State and events.** The optional `wildlife` slice keeps the deer taken by island and the traps set by spot, so there's no save version bump. A carcass on your shoulders isn't saved. The events are `AnimalKilled`, `TrapPlaced` and `TrapCollected`. The Ambitions count `venisonSold` by the CU from `ContrabandSold`, `FenceDealt` and a smuggler's `SmugglerDealt`.

**Drawing.** The deer, bear and wolf are low-poly figures of boxes and capsules in the toon style, one mesh each. A bear rears to threaten, the dead lie on their side, and a carcass rides across the captain's shoulders. Sign shows as dark prints on the ground, and a set trap as a ring of steel at its stake.

**Hooks and tests.** `__glpWildlife` has `here()`, `spawn(species, m)`, `face(id)`, `near(id)`, `toSign(k)`, `toSpot(k)` and `shoot(id?)`. `tests/wildlife.test.ts` covers the data, the deer's and the predators' FSM, the odds, the herd and its regrowth, the season and budget of who's about, the sign's words, the traps, and the Venison King's count. On the baked terrain it checks deer about on the three islands on their own ground, the trap spots round each cabin, a deer shot, dressed, carried and stowed as venison, and a trap set in January and emptied three weeks on. `e2e/wildlife.spec.ts` hunts a deer on Stockton from the landing to the hold, and sets a bear down to warn.

**Not in piece V:**
- No sounds: the growls, huffs, howls and bounding deer are piece Y's. The warnings are HUD lines until then.
- No campfire to carry: fire is a cabin's stove or a camp's fire.
- No wolves on the ice (11 §3.2 says packs "on larger islands or on the ice"). The ice is walked in the zone scene, and the animals are an island scene's.
- No cubs (a bear is always alone).
- No bearskins or wolf pelts from a kill. Only traps give furs.
- Being seen with a carcass, or hunting out of season, isn't a crime. The shot only draws people to look.
- A carcass left on the ground, and the dead, are gone when you land again. The deer is counted as taken all the same.
- Deer don't cross between islands, even on the ice.

**For Jared:**
- Every number in `wildlife.json`, especially the herd sizes, the bear and wolf odds, the hit odds, and the attack damage (two or three bites kill from full health).
- The trap catch rate and the price of a pelt. 1 CU of furs is $70, so one good trapline round is worth about $100–200 a few weeks on.
- Adding smoked venison as a good, where §18.5 said "no new goods" but 09 §7 lists it.
- The warning lines and the Mauled front page.
- The animals' look (screenshots in `wildlife/`).
- Woodcraft's tracking text.

### 18.22 Piece T as built: clues and legends (2026-11-20)

**The data.** `data/legends.json`, `data/clues.json` and `data/caches.json` (schema `data/schemas/legends.ts`). Six legends, each with a spot of one kind:
- the _Lucerne_'s strongbox is grappled up from her wreck;
- the quarry payroll is dug behind the Hermit's cabin;
- the Dark Light's cache is dug on Minnesota Point, on a pad walked round the spot on the mainland, with a clue on the dead tower's door;
- the Devil's Grotto is searched at the Grotto's ledge, only at the dark of the moon (under 0.3) or on the ice;
- the Ghost Net's cache is in the Outer Island fish house;
- the Copycat's Hoard is dug above a beaten rival's camp.

Ten clues are found in a light's logbook, among the papers rifled from a box in Bayfield or Duluth (half the boxes bear on a legend while its clues are still to find), at a carving or a net reel read with F, at a cave's mark or at the pad. Eight seeded caches lie at prefab marks on the standard islands; each run stocks 60% of them, and a box's papers are a note about a stocked one 35% of the time.

**The lead to the payoff.** Every clue shrinks the lead's circle (piece O). With three clues, counting the tale, the cartography table draws a map in 3 game hours: the circle goes to 250 m round the spot, with a red X on the chart. At the spot you hold F for 3 s to dig or search (`Prompt.holdS`, with the progress on the HUD). The _Lucerne_'s strongbox comes up on a hooked cast once her lead has three clues, in place of that cast's cargo. The payoff:
- the cash, rolled from the run's seed in each legend's range ($600–1,800);
- the legend's curio (new: the captain's watch and the dark lantern);
- the journal's `told` line;
- a story in the papers with its Fame;
- for the Dark Light, an introduction to Carrow, Duluth's fence, who deals with you whatever your Fame.

The hoard is the rival's stash, taken into the hold where it fits. `legends` (clues, maps, done, notes, contacts) is saved; a run from before it starts with none.

**For Jared to check.** These are first drafts:
- the legends' wording, the clue texts, the `found` and `told` lines and the papers' stories;
- the payoffs ($900–1,400 _Lucerne_, $1,200–1,800 payroll, $700–1,100 Dark Light, $600–1,000 Grotto, $800–1,200 Ghost Net) and the caches' ($15–120);
- three clues to a map, 3 hours at the table, and the 60% stocked share;
- the dark-moon rule for the Grotto;
- the odds that a box's papers hold a clue.

**Left for later.** The legends' `site` field is unset until piece W adds the sites. There's no e2e per legend (§18 criterion 13); `tests/legends.test.ts` covers each kind of spot and clue at the data, placement and gameplay levels. `__glpLegends` reads the state, gives a clue, draws a map, goes to a lead's spot and forces the dark of the moon.

### 18.23 Piece W as built: the seven sites (2026-11-21)

**The five new sites.** Each is in `data/sites.json`, with a set piece in `data/zones.json`. All are first drafts.

| Site | Where | Notes | Build bounds | Concealment |
|---|---|---|---|---|
| Hermit Quarry | A terrace on Hermit's west shore below the quarry | Deep water close in, the quarry's brownstone to salvage (16 loads a season), the shack and a pier | 18 × 22 cells | 0.55 |
| Devils Caves | The clifftop on Devils' east side, 6 m up | Anchorage off the first cave's mouth, no pier, open to the northeast | 10 × 10 cells (the smallest) | 0.85 |
| Outer Station | A fish station up the beach from Outer's camp | The shallows run out 70 m, so you anchor off and row in; no pier | 16 × 18 cells | 0.6 |
| Minnesota Point | The keeper's ground at the dead light, at the point's end by the Superior entry | In the Duluth region; owned, so leased or squatted | 12 × 14 cells | 0.3 |
| North Shore Cove | A cove a mile up the shore from Two Harbors | In the North Shore region, the shack and a pier | 14 × 16 cells | 0.65 |

A site is seen from less far the better hidden it is: the full 3.5 km up to 0.6, down to about 500 m at Devils (`siteSightM`).

**Ground without a bake.** The zones aren't baked again here, because the bake needs GDAL and the DEM sources. The loader flattens any set piece that the manifest's `handEdits` doesn't list, as the bake would (`src/sim/terrain/edits.ts`): only land changes, so the shoreline, SDF and wind maps stay as baked. After the next bake it does nothing. The two mainland sites have no 1 m island ground. A landing there walks the zone's ground round the site, as the legends' and caves' pads do (`Hideouts.mainlandPads`), and this pad also stands the Dark Light's dig beside the site.

**Starts.** Each background starts at its own site, pre-built with the shack (40 CU and a strongbox) and the pier where there's water for one:

| Background | Start |
|---|---|
| Deckhand | Stockton |
| Fisherman | Outer |
| Lumberjack | Siskiwit |
| Saloon Keeper | Minnesota Point, with the lease in her name |
| Ex-Navy | the North Shore cove |
| Poacher | Devils |

Nobody starts at Hermit. A run that already has hideouts keeps them, as before.

**Claiming.** Build mode (B) opens at a site nobody holds, with a line saying so. The first piece placed claims the site, empty, and emits `SiteClaimed`. Minnesota Point belongs to the Lighthouse Board. On its ground, F offers the lease ($150). Building without one is a squat. Each day a squat has a 6% chance of being noticed, which puts 8 heat on Duluth with a notice and `SquatNoticed`. Buying the lease later makes the squat good. `hideouts[id].tenure` holds `leased` or `squatted`. The legends now chart their sites: the payroll charts Hermit, and the Dark Light charts Minnesota Point.

**For Jared to check.** These are first drafts:
- where each site sits, its bounds and its concealment
- the blurbs
- the $150 lease
- the squat odds and heat
- Outer and Devils having no pier
- the pre-built layout, which is the same shack and pier everywhere

The concealment and sight numbers are guesses.

**Tests.**
- `tests/sites.test.ts` checks the data and each new site on its baked zone:
  - the shack and pier place piece by piece;
  - a schooner can sail to the anchorage;
  - the site is clear of prefabs, caves and legend spots.
- It also covers the runtime flatten, the starts, claiming, the lease and squat, and the walk ashore at the point.
- `e2e/sites.spec.ts` lands a new Fisherman, Poacher, Saloon Keeper and Ex-Navy at their sites through `?site=` and opens each stash.

### 18.24 Piece Y as built: islands audio (2026-11-21)

**The islands' sounds** (plan 15 §23 has the audio side). Each island walked has the birds, a creek and the surf by its tier and the season: songbirds in spring and summer (hero islands loudest, rock islands few), a creek on the hero and standard islands (swollen at the thaw, frozen in winter), and surf on the rock islands that rises with the wind. A woodpecker drums in spring and summer by day on a wooded island. Beds are quieter under a roof.

**The sea cave** (piece S): its hush while you're inside, from the boat or on foot, with drips from the roof every few seconds and the surge booming at the mouth, `CaveEntered`, `CaveLeft` and `CaveSurge`.

**The animals** (piece V). A deer snorts and bounds off when it bolts. A bear huffs when it stands up to you and growls as it charges. The wolves howl from the trees, and the nearer pack answers. Each call is placed where the animal is, quieter with distance (full within 10 m, gone by 300 m), and captioned. The HUD line about a bear or a wolf is still there, as before. Wildlife now raises `AnimalCue` on each warning and on a deer bolting.

**The grapple and a dig** (pieces U and T). The line whirrs out at `GrappleCast` with a splash, and comes up with a stick-slip creak at `WreckWorked`. A dig (`Dug`) plays three spade strikes over the hold's last two seconds, whichever way the dig turned out.

**The ending.** `RunEnded` plays the ending air, a slow tune in D minor over a fiddle drone, about 55 s, once after a second. It streams from its own bundle, like the other tunes.

**For Jared to check.** These are first drafts, all synthesized and none heard in the game yet:
- the birds' and the creek's levels against the forest bed;
- the wolves' and the bear's loudness and how far a call carries (300 m is a guess);
- the cave's drips, its hush and the surge;
- the spade, the grapple and the dig's three strikes;
- the ending air (its tune and its length, about 55 s; it isn't stopped if a new run starts within that time);
- the woodpecker's odds.

**Not in piece Y:** the diving suit's sounds (§18.5), a bear's crash off through the brush (a bear that flees makes no sound yet), a separate wolf growl (the threat is the second howl), a reverb preset for the islands beyond the sounds' own, and the sea cave's ice variant (the ice flag is kept for it, but the room is the same).

**Tests.**
- `tests/audio-island.test.ts` (40): the seasons, the beds by tier, season, day, wind and roof; the woodpecker; the drips and the surge; each animal's cue and its distance; the spade and the ending delay; the playback with a fake mixer (a dig from the shore, a grapple from the boat, a call only ashore and captioned, a cave hush from entering to leaving, the surge once); and the synthesis, every loop and one-shot finite and audible, and the ending air's length.
- `tests/audio-pipeline.test.ts` now counts `island-audio` as decoded and `ending-audio` as streamed (the streamed ceiling is 7 MB for the ending air).
- `CREDITS.md` lists the sixteen island files and the ending air.

**Checked:** the unit suite and the pipeline; `npm run audio` for all 211 sounds (about 12.9 MB, the ending air 0.86 MB). Not yet in the game: the wiring is there (`game-audio.ts`, `ashore.ts`, `wildlife.ts`, `main.ts`), and a Playwright check of a landing is the next step.

### 18.25 Piece Z: the playtest and 0.9.0 (2026-11-22)

**Status: released as 0.9.0 (2026-11-24).** Jared called the release on 2026-11-24 with the automated checks green; the tag `0.9.0` follows the release PR's merge. The open items below (criterion 19's storm and cave benches, the hideout yard's on-foot draw calls, the Beta checklist's gaps) go out as known limitations in CHANGELOG 0.9.0 and are worked in 0.9.x patches.

_As written before the release:_ the automated checks are green, and the release waits on Jared. The tag `0.9.0` isn't cut yet: criterion 21 needs his sign-off, and the Beta gaps below need work first.

**What ran here.** Each run is on `main` at a305f7d (PR #171 merged):
- Static: `tsc --noEmit`, `eslint .` and `prettier --check .` pass.
- Gates: the island, save-migration, save-size, islands, hero-island, island-on-foot and audio pipeline tests (574) pass.
- CI on b7d1474 (the same code as the merge): the `check` job passed (lint, typecheck, unit, e2e). The unit suite had 133 files, 2720 passed, 1 skipped.
- Local e2e: the new island spec passes, and the smoke and neighbouring audio specs pass. A full local e2e run was too slow on this box to finish, so the full e2e result is CI's. Two specs were flaky under CI load (`boarding`, `winters-look`) and one passed on retry; the bear-warning test in `wildlife.spec.ts` can time out in the full file run, passing alone.

**§18.3 exit criteria, as checked.**

| # | Criterion | Checked by | Status |
|---|---|---|---|
| 1 | Events fire, cool down and change the sim | Piece A's tests and the seeded-year tests | Green in CI |
| 2 | Letters at the harbor master's | Piece A's tests and e2e | Green in CI |
| 3 | Rivals at their Fame tiers | Piece E's sim tests | Green in CI |
| 4 | Nickname, endings and the Hall | Piece B's tests and `e2e/endings.spec.ts` | Green in CI |
| 5 | Poker hand and cheats | Piece C's tests | Green in CI |
| 6 | Island posse | Piece F's sim tests and e2e | Green in CI |
| 7 | Four stations and loft sails | Piece G's tests | Green in CI |
| 8 | Lighthouse raid, relight, keeper | Piece H's tests | Green in CI |
| 9 | False light and investigations | Piece I's sim tests | Green in CI |
| 10 | A year, freeze-up to ice-out; v10 save fixture | `save-migrations.test.ts`, the year tests | Green here and in CI |
| 11 | Cold and ice warnings, the ice road | Piece M's tests and e2e | Green in CI |
| 12 | 22 islands land and walk; draw-call budgets | `islands.test.ts` (over every landing), `bench:island` | **Green:** tests here, and the bench on the laptop (below) |
| 13 | Six legends finishable, caches seeded | Piece T's tests and per-legend e2e | Green in CI |
| 14 | Salvage from three kinds of wreck | Piece U's tests | Green in CI |
| 15 | Poaching, bears and wolves warn, traps | Piece V's tests and `e2e/wildlife.spec.ts` | Green in CI, with the bear-warning timing caveat above |
| 16 | Every background at its own site | Piece W's tests and `e2e/sites.spec.ts` | Green in CI |
| 17 | Districts burgled, jails hold | Piece X's tests and e2e | Green in CI |
| 18 | Saves round-trip, a long run in budget | `save-*.test.ts` and `bench:save` | **Green:** tests here, and `bench:save` on the laptop (below) |
| 19 | Audio within 8 MB; frame budgets in a storm, on a hero island, in a cave | Pipeline test (green); the benches | Audio budget green. **Open:** no bench yet walks a storm or a cave, and `bench:island` reports draw calls, not frame times |
| 20 | The seasons feel different; an island is worth landing on | Jared decides | **Open: for the playtest** |
| 21 | Plans recorded, CI green, Beta checklist worked, 0.9.0 tagged | This release PR | **Open: the tag waits on sign-off and the gaps below** |

**The benches on the laptop (2026-11-22, Jared, `GPU=1 npm run bench:all`).** Headed Chromium on its GPU for the island, docks, stream and hideout benches, which have the `GPU` switch; frame times hold the display's 60 Hz (16.7 ms median, 16.8 ms p95, the vsync interval's jitter) wherever a bench reports them.

| Bench | Result | Budget |
|---|---|---|
| `bench:save` | Packed save 211 KB compressed; clone median 3.9 ms; the worker path 67 ms median, off the main thread; no long tasks while saving | Clone ≤ 4 ms |
| `bench:island` | Stockton (hero) 72 calls, 342k triangles; Long 105–110 calls, 308k–337k; Oak 61 calls, 330k; Cat (minor) 91–95 calls, 338k–359k. POI kits: hero 12.5k triangles, standard 6.7k, minor 216 | Each tier's calls (`island_tiers.json`); 400k triangles; POI 40k / 15k / 4k |
| `bench:docks` | Bayfield at night with 12 guards: 101 calls, 255k triangles. Duluth: 138 calls, 318k | Within the gate |
| `bench:hideout` | Kit bench 1,500 pieces: 77 calls near, 1 far. In the game, 1,542 pieces: the hideout adds 15 calls (79 for the whole frame); on foot in the yard, 167 calls at most (83 median), over the 150 of an on-foot frame. Most of it was the world, not the hideout (15 calls): passing ships, the schooner and far lighthouses, each outline and rigging line a call. Their ink is now dropped past 400 m, and the bench gates on foot at 150: 129 in the container after the change | The hideout's own ≤ 80 |
| `bench:stream` | Apostles at Medium: no hitches over 33 ms, 23 draw calls at most, streaming 0.2 ms p95 | No hitch over 33 ms |
| `bench:chart` | Still and panning p95 0.6 / 0.9 ms; a settled redraw 81 ms p95, once | Still and panning p95 ≤ 8 ms |
| `bench:transitions` | Zone loads 1.4–6.6 s; heap 180.2 MB before a round trip and 181.4 MB after (one trip, not the leak test) | — |

Two fixes came out of the run: the Oak island bench landed before its anchor held and failed before measuring (the landing helper now sets the anchor again until it holds, 8ef5e48), and a one-off spike of 165 calls in the hideout's build camera didn't come back on a second laptop run (79), so its max gate stays.

**Piece Y's listen, folded in.** Jared said he'll listen to the islands audio during this playtest. The list is in plan 15 §24: the birds and creek against the forest bed; the wolves' and bear's levels and reach (300 m is a guess); the cave's drips, hush and surge; the spade and the grapple; and the ending air (about 55 s, which doesn't stop if a new run starts first).

**Beta checklist (plan 17 §9): gaps.** These block the Beta tag, and aren't in this piece's code:
- **Ojibwe content review:** the cultural offices (Red Cliff, Bad River) or a paid reviewer, before Beta. Not started.
- **Accessibility pass** (13 §9): captions are in; colourblind modes, the plain font, reduce motion and rebinding aren't checked here.
- **Bench gate and the leak test** on the baseline laptop (§4.4): the bench gate ran (below) and passes; the leak test (plan 17 §3: 50 zone loads and unloads, heap and GPU memory within 10%) isn't built, and neither are the storm, winter and cave scenes.
- **Browser matrix smoke** (§5): only Chromium was run here.
- **Licensing:** `CREDITS.md` lists the island and ending sounds; the tool terms and `assets/LICENSES.json` still need the release check.

**Not in piece Z:** the playtest itself and its sign-off are Jared's. The tag and the plan records for each phase (criterion 21) follow after that.

## Changelog
- v0.25: Phase 9 released as 0.9.0 (2026-11-24) at Jared's call; the open criteria and Beta gaps are the release's known limitations (CHANGELOG 0.9.0).
- v0.24: Piece Z: the laptop's bench results recorded (§18.25); criteria 12 and 18 green, 19's frame budgets still need storm and cave scenes.
- v0.23: Piece Z: the playtest checks run and the Beta gaps listed (§18.25); 0.9.0 is not tagged until Jared's sign-off.
- v0.22: Piece Y as built (§18.24): the islands' birds, creek and surf by tier and season, a sea cave's hush, drips and surge, the animals' calls, the grapple, a dig and the ending air.
- v0.21: Piece W as built (§18.23): the five new hideout sites, every background at its own, claiming by building, Minnesota Point leased or squatted.
- v0.20: Piece T as built (§18.22): legends, clues, maps at the cartography table, digging and seeded caches.
- v0.19: Piece V as built (§18.21): deer, bears and wolves on their FSM, the rifle, dressing and carrying, venison and smoked venison, the traplines and the Venison King.
- v0.18: Piece S as built (§18.20): the sea caves at Devils, Sand and the mainland, rowing, swimming and walking in, ice caves, caches and the Grotto's mark.
- v0.17: Piece X as built (§18.19): the Duluth district.
- v0.16: Piece R as built (§18.18): the fourteen standard and minor islands walkable with their prefabs, landings, stations inside their islands, the overlapping-box fix, the rock climb out of the boat, `tests/islands.test.ts` over all 22 and `bench.island` per tier.
- v0.15: Piece Q as built (§18.17): the seven hero islands walked whole with their POIs, landings and residents, La Pointe's trading post on foot, islanders who see and report as townsfolk, and lit windows at night.
- v0.14: Piece N as built (§18.16): winter audio.
- v0.13: Phase 9 piece M as built (§18.15): walking on the ice, thin ice and the climb out, the ice road to La Pointe, the hand sled, warmth, and tracks in the snow.
- v0.12: Piece P as built (§18.14): the POI kits, `placePoi` and marks, the tier budgets and `bench.island` per tier, and curios on the shelves.
- v0.11: Piece J as built (§18.13): stage 1 audio.
- v0.10: Piece E (copycat rivals) built; as built in [12 §7.1](12-sandbox-events-character-failure.md).
- v0.9: Piece L as built (§18.11): winter's look; the aurora is in.
- v0.8: Piece U as built (§18.10): old wrecks of the record and the seed, found by sight or the lead line, worked by grapple and hook at anchor, hot recent cargo, papers as leads.
- v0.7: Piece B as built (§18.9): the nickname, Retire and Turn Lawman, and the Hall of Captains.
- v0.6: Piece O as built (§18.8): discovery and the fog of war on the chart, leads, the journal's four pages, and curios.
- v0.5: Phase 9 scope (§18), as proposed 2026-11-17: what Phases 4–8 change, deliverables, exit criteria, 26 work pieces in three stages, smaller calls and two decisions (staging, districts). Both decisions taken the same day: three stages with a playtest each, and Duluth as the one new district.
- v0.4: Phase 7 as built (§15): Stockton on foot, the quarry, the seeded cache, the rowboat and the posse.
- v0.3: Gap review: minor islets stay walkable (cut removed), islands load as their own scenes.
- v0.2: Decisions: poaching and trapping, wildlife hazards (bears, wolves), a purchasable diving suit for deep wrecks (with design), cold exposure, 6 legends plus seeded caches.
- v0.1: Initial exploration plan: island catalog and tiers (22 Apostles), POI kits, on-foot traversal and hazards, hunting and trapping, sea and ice caves, wreck sources and salvage, secret types, clue sources and the map flow, 6 legends, seeded variety, lighthouse stations on foot, discovery and journal, rewards and balance, pipeline and budgets, data/state, phasing.
