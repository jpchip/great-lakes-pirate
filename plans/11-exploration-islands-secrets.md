# 11 — Exploration, Islands & Secrets

Status: DRAFT v0.3 (decisions made; gap review applied)
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
- **Terrain** is the 1 m on-foot heightmap ([03 §8](03-world-scale-chart-travel.md)). Slopes above a threshold aren't walkable, so cliffs are barriers except at authored paths, gullies and ladders.
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
- **Phase 7:** one fully walkable hero island (Stockton or Hermit), the on-foot controller shared with the docks, a quarry POI, a cache, going ashore by rowboat.
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

## Changelog
- v0.3: Gap review: minor islets stay walkable (cut removed), islands load as their own scenes.
- v0.2: Decisions: poaching and trapping, wildlife hazards (bears, wolves), a purchasable diving suit for deep wrecks (with design), cold exposure, 6 legends plus seeded caches.
- v0.1: Initial exploration plan: island catalog and tiers (22 Apostles), POI kits, on-foot traversal and hazards, hunting and trapping, sea and ice caves, wreck sources and salvage, secret types, clue sources and the map flow, 6 legends, seeded variety, lighthouse stations on foot, discovery and journal, rewards and balance, pipeline and budgets, data/state, phasing.
