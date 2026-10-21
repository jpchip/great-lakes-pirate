# Great Lakes Pirate — Master Plan

Status: DRAFT v0.4 (third round of decisions made, no code yet)
Working title: *Great Lakes Pirate* (placeholder)

This is the top-level plan. It captures the vision, pillars, systems, decisions, and a phased roadmap. Each system listed here gets its own detailed plan in `plans/` later (see [Plan Index](#9-plan-index)). Anything marked **TBD** or listed under [Open Questions](#10-open-questions) is a gap for later planning sessions to fill. Settled choices are recorded in [Decisions Log](#decisions-log).

---

## 1. Vision

Play as an original pirate captain on the Great Lakes around the turn of the 20th century, loosely inspired by the life of "Roaring" Dan Seavey (see `references/dan_seavey.md`). Start as a small-time schooner operator on western Lake Superior. Work honest cargo by day and thieve by night. Explore a huge, believable recreation of the lakes, then steal, trade, fight and build your way to riches and fame, while the law and the lighthouse keepers try to catch you. It's an **open sandbox**: no forced story, and you set your own goals.

**Elevator pitch:** *Sid Meier's Pirates! meets Sea of Thieves meets a grid base-builder, set on Lake Superior instead of the Caribbean, with a stealth layer in the docks at night.*

### Design pillars

1. **Big lakes, real feel.** Real geography, weather and seasons that matter. The world feels vast even though open water is abstracted.
2. **Two faces: honest trader, shadow pirate.** Day = trade/legit front. Night = stealth/theft. You can play fully legit (harder) or fully outlaw.
3. **Your choices have consequences.** Violence is optional. Killing and sinking pay off but bring a lot of heat. **Fame** and **Wanted** are separate meters.
4. **Hideouts are yours.** Multiple grid-based hideouts around the lakes, for storage, crafting and customization.
5. **Discovery rewards curiosity.** Islands, sea caves, wrecks and secrets worth sailing off the shipping lanes for.
6. **Grounded history, tall-tale tone.** Real ports, lighthouses and industries, with Seavey-style legend layered on top ("moon cussing", poaching, whiskey-fueled hijackings).

### Reference material
- `references/dan_seavey.md`: biography, used as inspiration for mechanics and optional events (wrecking with false lights, venison poaching, the *Nellie Johnson*-style hijack, Booth Fisheries rivalry, a later career as a lawman).
- `references/schooner.png`: the player ship style (a multi-mast Great Lakes schooner with many headsails).
- `references/freighter1.png`: an early steam package freighter (*Onoko*-style, pilothouse forward).
- `references/freighter2.png`: a steel bulk freighter ("Henry Phipps" type, long hull, stern engines). *Era caveat:* the largest of these came a few years after 1900. Use it as a visual guide for the steel bulk carriers of ~1900 (slightly smaller), the biggest and most valuable prey on the lake.
- `references/ferry.png`: a sidewheel passenger steamer.

---

## 2. Era & Setting

- **Era: the game starts in spring 1900; technology is fixed.** The calendar advances (seasons and years), but ship types, weapons and world technology stay at their 1900 level. 1900 also lines up with Seavey's own active years. The world is a snapshot of sail in decline: schooners (many now towed as barges) share the lake with wooden and steel steam freighters, steel bulk ore carriers, tugs and sidewheel/passenger steamers.
  - Local color for 1900: Duluth–Superior is a booming ore and grain port, and the Two Harbors ore docks are busy. Alexander McDougall's **whaleback** ships (built at Duluth/Superior from 1888 into the 1890s) are a perfect regional oddity to include as a freighter type.
  - Picking 1900 means most Apostle-area lighthouses exist (Devils Island, Chequamegon Point and Two Harbors were all built in the 1890s, from memory, *verify in R1*). Historical accuracy is "1900-flavored," not strict. Things built after 1900 (e.g., the Duluth aerial bridge, 1905) are excluded by default.
  - **Ojibwe communities (included):** Red Cliff and Bad River bands, and Madeline Island's history as a historic Ojibwe center. Portray them respectfully as communities with their own interests: trading partners, guides, sources of local knowledge and lore, not stereotypes or targets. R1 must research this carefully (treaty-era context, the 1854 treaty reservations, fishing and wild rice economies). Consider authenticity review/sensitivity reading before release.
- **Seasons:** spring, summer, fall and winter change weather, ice, traffic and prices (see §4.2).
- **Player character:** an original, customizable pirate *inspired by* Seavey. **Seavey himself does not appear.** His exploits inspire mechanics and events only.
- **Geography (long-term):** all five lakes and the connecting waters (St. Marys River/Soo Locks, Straits of Mackinac, St. Clair/Detroit Rivers, Welland Canal).
- **Starting region / MVP: western Lake Superior.**
  - **Ports:** Duluth, Superior (WI), Ashland, Bayfield, Washburn, La Pointe (Madeline Island), Two Harbors, Siskiwit Bay (a fading logging landing in 1900; the Cornucopia fishing boom came later), plus the Red Cliff and Bad River communities (trade only). Profiles are in [R1a](R1a-western-superior-gazetteer.md).
  - **Apostle Islands** (22 islands, including Madeline; see R1): sea caves, sandstone cliffs, brownstone quarries (e.g., Basswood, Hermit and Stockton Islands) and fishing camps. Natural hideout and secret territory.
  - **Lighthouses (Apostles area):** Raspberry Island, Sand Island, Devils Island, Outer Island, Michigan Island, La Pointe, Chequamegon Point, plus Duluth and Two Harbors. *Verify construction dates against the chosen era.*
  - **Economy flavor:** iron ore (Two Harbors and Duluth ore docks), lumber, brownstone, commercial fishing (Booth fishing operations were present in the region, a natural rival), grain via Duluth–Superior, and furs/venison (poaching).
  - **Hazards:** reefs and shoals around the Apostles, Superior's cold and violent fall storms, fog, and the Duluth ship canal.
- **Real vs. invented:** real ports, islands and lighthouse names. Invented ships, NPCs, companies (where needed) and secrets layered on top.

---

## 3. Core Game Loop

```
 DAY (port)                       NIGHT (docks district)        AT SEA
 trade legit cargo ──────┐        sneak, steal cargo,           sail coastlines, evade
 buy supplies/upgrades   │        sabotage, fence goods         patrols & lighthouses,
 rumors, contracts       │                │                     ambush freighters, explore
        │                ▼                │                             │
        └────────► goods / gold ◄─────────┴─────────────────────────────┘
                         │
                         ▼
     upgrade ship  +  build/expand hideouts (grid, crafting, storage)
                         │
                         ▼
   FAME grows (better fences, contacts, prices)  /  WANTED grows (patrols, bounties)
```

- **Short loop (minutes):** sail to a target, do the job, get away.
- **Medium loop (an hour):** run a circuit of ports, upgrade the ship or a hideout.
- **Long loop (many hours):** grow Fame, uncover island secrets, expand to new lakes, chase personal goals (wealth, infamy, going legit).
- **Legit path:** trading-only play is supported but deliberately harder: thinner margins, more competition and slower upgrades. Its upside is no heat.

---

## 4. Systems Overview

Each of these gets its own plan doc. Summaries capture decisions plus remaining gaps.

### 4.1 Sailing & Ship Handling — **Arcade**
- Arcade feel (Sea of Thieves-ish): simple controls, satisfying motion, readable wind. No detailed sail-trim simulation.
- Wind still matters: direction and strength affect speed (a simplified points-of-sail curve), and tacking upwind is slower.
- **Weather impacts sailing:** storms (heavy waves, hull stress, reduced control), fog (visibility), calm (slow), ice (blocked or damaging in winter).
- Ship stats: speed, turning, hull HP, cargo capacity, firepower, stealth/visibility.
- Damage, sinking and repair.
- **Crew model:** no crew management, ever.
  - **Start:** truly solo, aboard a **small schooner** (a two-masted, one-person arcade abstraction).
  - **Upgrades:** buying larger schooners or hull upgrades brings an **invisible crew** that is implied by the ship (it unlocks more sails, cannons and cargo). It is never hired, paid or managed.
  - Crew size is a hidden **ship stat** that matters for boarding (see §4.6). Solo, you can only loot ships that have already surrendered.
  - Ship tiers (draft): small schooner → mid schooner (e.g., three-masted) → large/fast schooner. Exact tiers belong to plan 10.
- **Always your own ship:** the player can't steal or captain other vessels, only take their cargo.
- **Controls: mouse and keyboard only** (decided). No gamepad support planned.
- **TBD:** camera modes.

### 4.2 World, Scale, Weather & Seasons — **Hybrid Scale**
- **Hybrid model:** detailed, real-time **coastal zones** (ports, island clusters, lighthouses, river mouths) connected by **abstracted open water**.
- **Decided:** open-water crossings use a **chart travel mode** with time compression. Random encounters (freighters, cutters, storms, derelicts, ice fields) drop the player into real-time sailing at that spot.
- Coastlines are based on real geography (NOAA/USGS shoreline and bathymetry data, simplified). *TBD:* data-processing pipeline.
- **Day/night cycle** drives the trade-vs-steal rhythm.
- **Weather system:** wind fields, fog banks, storms (fall "gales" are the deadliest), calm spells. Forecasts or signs (barometer, sky) could be a light skill element.
- **Seasons:**
  - Spring: ice breakup, the shipping season opens, high demand.
  - Summer: steady trade, frequent fog on Superior.
  - Fall: peak shipping and the most valuable cargo, but dangerous storms.
  - **Winter (decided):** ice closes most commercial shipping, but the player stays active.
    - **Risky winter sailing:** drifting ice, frozen harbors, hull damage, freezing spray. Almost no freighters, but also few patrols. An ice-strengthened bow upgrade helps.
    - **Winter activities:** hideout building and crafting, poaching (venison) and fur trapping on islands, ice-road smuggling between the islands and the mainland (e.g., Madeline Island to Bayfield), and docks-district theft (warehouses full of stockpiled goods).
    - Optional "skip to spring" for players who want to.
- Points of interest: ports, lighthouses, life-saving stations, islands, sea caves, quarries, fishing camps, Ojibwe communities, wrecks, shoals/reefs, shipping lanes.
- **On-foot areas (decided):**
  - **Islands are fully walkable:** explore, hunt and poach, find secrets, raid lighthouses on foot, build hideouts.
  - **The mainland is not walkable** except the docks-district scenes in ports.
  - This makes island terrain a real on-foot level (forest, cliffs, beaches, sea caves, quarries) and a major content and performance item for plans 03 and 11.

### 4.3 Ports & Trading (Day)
- Port markets with supply and demand varying by port, season and events (e.g., ore at Two Harbors, fish at Bayfield, grain at Duluth).
- Legit cargo contracts and freight hauling as income and cover.
- Stolen goods and contraband must go to **fences** (which unlock with Fame), at a risk.
- Services: shipyard (repairs/upgrades), chandlery (supplies), saloon (rumors, contacts), harbor master (fees, papers).
- Rumors and tips: cargo shipments, patrol routes, island legends.
- **TBD:** economy depth (static tables vs. lightweight simulation), cargo list, price dynamics.

### 4.4 Docks District Stealth (Night)
- Each port has a compact, hand-built **docks district** scene (wharves, warehouses, moored ships, a saloon, a few streets) rather than a full town.
- On foot (third-person assumed, TBD): sneak, steal cargo from warehouses and moored ships, sabotage, meet fences.
- Threats: night watchmen, constables, dogs(?), lanterns/gas lamps, noise. Alertness scales with Wanted.
- Tools/tactics: lockpicks, distractions, bribes, whiskey (getting a crew drunk, à la *Nellie Johnson*, to loot their cargo, not to steal the ship).
- Moving loot: carry limits, rowboat/cart to your schooner.
- *Build cost note:* one reusable kit of dock parts (piers, warehouses, cranes, crates) assembled into per-port layouts keeps this feasible for a solo dev.

### 4.5 Fame & Wanted — **Separate Meters**
- **Fame (long-term, mostly positive):** grows from big heists, daring escapes, newspaper coverage and wealth. It unlocks better fences, black-market contacts, rumor quality, intimidation (ships surrender faster) and special opportunities. **Fame fades over time** if you stop doing notable things (decided), so you have to stay in the papers. TBD: decay rate, and whether legit success earns Fame too.
- **Wanted (short-term heat, negative):** grows from witnessed crimes and scales by severity. **Violence raises heat a lot:** theft < assault < sinking a ship < killing people. It drives patrol density, cutter aggression, lighthouse vigilance and bounty hunters. It decays over time when you lay low, and can be reduced with bribes, fines, a changed ship appearance or name, or hiding.
- **Wanted is per region (decided).** Each region has its own level (e.g., the Apostles/Chequamegon Bay, the Duluth–Superior harbor, the North Shore; eventually each lake or sub-region). Fleeing to another region is a valid way to escape heat. *TBD in plan 06:* region boundaries, and whether extreme Wanted spreads to neighboring regions (news travels).
- **Law enforcement (era-accurate):** the US Revenue Cutter Service (historically **one cutter, the *Morrill*, covered Lakes Michigan and Superior**. The game keeps it that sparse: a roaming, trackable threat that focuses on your region as Wanted rises. See R1 §2.2), local constables and police in ports, lighthouse keepers (lookouts who report sightings), the Life-Saving Service (witnesses, not fighters), and US Marshals/bounty hunters at high Wanted. *Naming decision:* use era-accurate names in-game. The Coast Guard didn't exist until 1915.
- **Lighthouses:** sweeping beams and keepers act as detection nodes. Higher Wanted makes keepers signal and report faster.
- **The law cannot raid hideouts.** Hideouts are safe zones (they could still be a place to lose pursuit).

### 4.6 Combat & Targets
- **Freighters** (primary prey): force a surrender, board, or shell and sink. Cargo value depends on ship type.
- **Boarding (decided): an intimidate-or-fight check, not action combat.**
  - Inputs: your crew size (from ship tier), weapons, Fame (intimidation), the target's damage state and crew size, and your background perks.
  - Outcomes: they surrender and you loot, they fight and you win (loot, plus heat if people die), or they repel you (you take damage and must flee).
  - **Solo (starter ship):** you can't board a resisting ship. You can only loot ships that have **already surrendered** (from cannon damage, intimidation, being stranded on a reef, a drunken crew, etc.).
  - Bigger ships bring more crew, which allows forced boarding of tougher targets.
- **Weapons (decided):** broadside cannons, a bow swivel gun, and rifles/pistols. Availability varies by **ship type/tier**, and each can be **upgraded** (range, damage, reload, accuracy). The player aims and fires in real time; small arms matter for intimidation and on-foot defense.
- **Lighthouses:** raid supplies, or extinguish or relocate lights for wrecking (§4.7).
- **Other pirates:** rare, tough encounters, and possible named rivals.
- **Revenue cutters:** flee, outwit or fight (very high heat).
- **Violence is optional:** non-lethal options (intimidation, surrender, the whiskey trick, stealth theft) vs. lethal ones (killing crews, sinking ships). Lethal options are more efficient but spike Wanted.
- **TBD:** surrender logic (what makes AI ships give up), exact check formula, weapon stats and upgrade trees.

### 4.7 Wrecking ("Moon Cussing")
- Signature mechanic: douse a lighthouse or hang a false light to lure a ship onto the rocks, then salvage the wreck.
- It depends on the night, the weather, ship routes and hazard knowledge, and on not being seen by the keeper.
- Deadly and high-heat if crews die. Big payoff and big Fame.

### 4.8 Hideouts, Base Building & Crafting — **Grid, Multiple Hideouts**
- The player can claim **multiple hideouts** around the world (islands, coves, sea caves, abandoned quarries or fishing camps).
- Primary purpose: **storage** of goods/loot, plus crafting, ship services and personalization.
- **Grid-based building:** snap-to-grid placement of foundations, walls, roofs, docks, storage, workshops and decorations. Rich customization with lots of piece types, materials, paint and props.
- **Crafting from supplies:** lumber, iron, rope, canvas, powder, brownstone, tar, rum, etc. Craft ship upgrades, ammo, tools (lockpicks, false lights), base pieces and disguises (sail colors, nameboards, flags).
- Possible structures: dock, warehouse, workshop, smithy, sawmill, distillery, smokehouse (venison!), drydock/slipway, lookout tower, signal lantern, living quarters, trophy room.
- **Law can't raid,** so defenses are cosmetic or flavor (or useful vs. rival pirates, TBD).
- **Storage is local to each hideout (decided).** Goods must be physically hauled between hideouts and ports, which makes logistics part of the game. Hideout placement matters (near markets, near prey, in different Wanted regions).
- **TBD:** claim rules, hideout limits, and production (passive generation?).

### 4.9 Ship Upgrades & Customization
- Upgrades: hull, sails/rigging (speed), cannons, cargo hold, hidden compartments (smuggling), lanterns/dark-running gear, ice-strengthened bow (winter?).
- Visual customization: paint, figurehead, flags, nameboard, sail color. A changed appearance reduces recognition, and ties into Wanted.
- **One ship, always yours (decided).** You can't steal other ships. Progression comes from upgrading or buying a bigger schooner (see §4.1 tiers). TBD: when you buy a new hull, is the old one sold or traded in?

### 4.10 Exploration & Secrets
- Islands with hidden content: caches, wrecks, sea caves, quarry ruins, fishing-camp mysteries, legends and lore, treasure maps.
- Real Superior lore as inspiration (shipwrecks, island history), plus invented secrets.
- Discovery: chart fog-of-war, journal clues, collectibles.
- **TBD:** hand-authored vs. procedural placement, reward types (gold, blueprints, unique parts, lore).

### 4.11 Progression, Sandbox Goals & Failure
- **Open sandbox:** no fixed campaign. Optional goals and milestones (e.g., "first $10,000", "become the most wanted on Superior", "own 5 hideouts", "go fully legit").
- Optional Seavey-inspired **events/jobs** (not a linear story): a whiskey hijack, a fishing-company feud, poaching runs, a wrecking job, a cutter chase.
- **Failure (decided):**
  - Caught below the top Wanted level → **jail.** You lose your **current cargo** and **time** (days or weeks pass; seasons and prices move on). Ship, gold and hideout contents are kept. Escape options:
    - **Pay bail** (cost scales with Wanted) to skip or shorten the sentence.
    - **Jailbreak:** a small escape scenario (stealth/timing). Success frees you but raises Wanted; failure adds time.
  - Caught at the **top Wanted level only → execution.** The run ends.
  - **Permadeath is always on:** death in combat, sinking, storms, ice, or execution ends the run. **Nothing carries over.**
  - Plan 12 defines the warning UX: players must always know when capture means death (a clear top-tier Wanted indicator per region).
- **Character creation (decided):** pick a **name**, **appearance** and **background**. The background grants starting perks. Draft backgrounds:
  - *Deckhand* (sailing speed/handling bonus)
  - *Fisherman* (better fish prices, knows the reefs)
  - *Lumberjack/Teamster* (cheaper building materials, carry more on foot)
  - *Saloon Keeper* (better bribes, the whiskey trick, rumor quality)
  - *Ex-Navy* (cannon accuracy, intimidation)
  - *Poacher/Trapper* (hunting, winter survival, stealth on islands)
  - Final list and perk balance in plan 12.

### 4.12 UI / UX
- Chart/map (critical with hybrid travel), logbook/journal, trade screens, inventory and hideout storage, a grid build-mode UI, Fame and Wanted indicators, HUD (compass, wind, hull, time/season).
- Flavor: period nautical charts and newspaper headlines that react to your exploits (and feed Fame).

### 4.13 Audio & Atmosphere
- Wind, waves, creaking rigging, foghorns, bells, ice groaning, dock ambience, shanties/period music.
- Dynamic music for stealth and chase states.
- **Sourcing: AI-generated audio** (decided): music, ambience and SFX. Evaluate tools in Phase 0/plan 15. Check each tool's license allows commercial use. CC0 SFX libraries are a fallback.

### 4.14 Save / Persistence
- Local saves (IndexedDB). No backend planned.
- Must save: world state, season/date, economy, Fame/Wanted, ship, all hideout layouts and storage, discoveries.
- Permadeath is always on, so: **autosave only** (one save slot per run, written on key events), and the save is deleted on death. The format still needs versioning for game updates.

---

## 5. Art Direction & Assets

- Period-authentic ship silhouettes based on `references/` (schooner, early steam freighter, steel bulk freighter, sidewheel ferry), plus a revenue cutter, tug, and fishing boats.
- Moody Superior atmosphere: cold blue-gray water, fog, red sandstone cliffs, dark pine forests, lantern light, ice. Sepia/newsprint UI flavor.
- **Style (decided): stylized.** Clean, chunky shapes, a limited palette, painterly or toon-ish shading, exaggerated silhouettes. Stylized art is far more forgiving for a solo developer and for AI-generated assets than realism.
- **3D assets: AI-generated where it helps, mixed with other sources.** The pipeline needs planning (plan 14):
  - No AI 3D tool chosen yet. Evaluate the free tiers of image/text-to-3D tools (e.g., Meshy, Tripo, Rodin) during Phase 0. No subscription is needed until then.
  - Complementary sources: CC0 stylized asset packs (e.g., Kenney, Quaternius, Poly Pizza) for props, procedural/code-built geometry (water, terrain, simple ship parts), and simple Blender modeling.
  - Feed the reference photos into image-to-3D for ships.
  - Cleanup: decimation, consistent scale/pivots, texture size budgets, and glTF/GLB export (Blender for touch-up as needed).
  - Style consistency: pick a target style (stylized vs. semi-real) and write prompt templates to match.
  - Modular kits for docks districts and hideout grid pieces. Grid pieces need precise dimensions, so these may be easier modeled simply or procedurally than AI-generated.
- **TBD:** the exact stylized look. **Plan:** a Phase 0 **style test**. Render the same scene (the schooner, an Apostle island, a lighthouse, water at dusk) in 2–3 candidate looks and pick one:
  1. **Low-poly flat-shaded:** cheapest, very consistent, and matches CC0 packs.
  2. **Toon/cel-shaded:** outlines plus banded lighting. Forgiving of messy AI meshes.
  3. **Painterly/soft-stylized:** most atmospheric (fog, light), with the highest shader/texture effort.
  - Current recommendation: lean toward **1 or 2** for a solo dev with AI-generated meshes, since a unifying shader hides inconsistencies between assets from different sources.

---

## 6. Technical Approach

- **Stack (decided):** TypeScript + Vite + three.js. Desktop browsers.
- **Backend:** none; local saves only. Hosted as static files on a DigitalOcean droplet, with an optional itch.io mirror.
- **Key technical risks** (each gets a spike/prototype):
  1. **Hybrid world:** coastal zone streaming plus a chart travel mode, and transitions between them. Floating origin to avoid precision jitter.
  2. **Water:** a performant, good-looking lake shader with waves driving ship motion, storm states and ice.
  3. **Arcade sailing:** a wind model that feels good and is cheap.
  4. **Weather and seasons:** a global state driving visuals, physics, AI traffic and the economy.
  5. **Docks district scenes:** an on-foot mode, separate scene loading, stealth AI (perception, patrols).
  6. **Grid building:** placement, snapping, instancing for performance, and a save format.
  7. **Simulation at scale:** NPC ships, patrols and the economy simulated off-screen cheaply.
  8. **AI asset pipeline:** quality, consistency and polygon budgets.
- **Architecture sketch (to detail in plan 01):** a game-mode state machine (Chart, Sailing, Docks, Build, Menus); simulation separate from rendering; data-driven definitions (ships, goods, ports, structures, events as JSON); a lightweight ECS or entity/system layer; an event bus for crimes, witnesses and heat.
- **Performance target:** 60 fps on the Medium preset on the developer's limited laptop, 30 fps floor on Low. Physics stays minimal. Mobile is out of scope. Details in [01](01-tech-architecture.md#5-performance-budgets-low-end-baseline-the-developers-limited-laptop).

---

## 7. Phased Roadmap

**Solo developer:** phases are sized to always end with something playable. Scope cuts are expected. MVP first, other lakes later.

| Phase | Name | Goal | Key deliverables |
|---|---|---|---|
| 0 | **Foundations** | Tech set up, key plans written | Repo scaffold (TS/Vite/three.js), plans 01–04, AI asset pipeline test (one schooner) |
| 1 | **Sailing Prototype** | "Sailing feels good" | Water shader, arcade wind sailing, schooner, camera, test bay |
| 2 | **Superior Slice** | The Apostle Islands feel real | Real coastline for the Apostles and Chequamegon Bay, Bayfield + Ashland, lighthouses, day/night, weather v1 |
| 3 | **Hybrid Travel** | Big-world feel | Chart travel mode, open-water encounters, Duluth/Superior/Two Harbors zones |
| 4 | **Trade & Economy** | The day loop works | Markets, cargo, gold, ship upgrades v1, save/load |
| 5 | **Law, Fame & Wanted** | Heat has teeth | Cutters, lighthouse detection, Fame/Wanted meters, jail |
| 6 | **Piracy & Combat** | At-sea crime | Freighter AI, cannons, boarding/surrender, sinking, fences |
| 7 | **On Foot: Docks & Islands** | The night loop + island exploration | On-foot mode, one docks district (Bayfield?), stealth AI, theft, one fully walkable island |
| 8 | **Hideouts** | Base loop | Grid building, crafting, storage, multiple hideouts |
| 9 | **Seasons & Secrets** | Depth | Full season cycle (winter rules), island secrets, wrecking, events, newspapers, permadeath polish |
| 10 | **Expand the Lakes** | More world | Lake Michigan (Seavey's home waters), then Huron, Erie, Ontario, and the Soo Locks |
| 11 | **Polish & Release** | Ship it | Audio, UI polish, performance, tutorial, playtests |

### MVP definition
Western Lake Superior (Apostles, Bayfield, Ashland, Duluth/Superior), arcade sailing with weather, hybrid travel, trading, Fame/Wanted with cutters and lighthouses, freighter piracy, one docks district, one or two hideouts with grid building, and at least summer + fall seasons.

---

## 8. Scale — **Decided: Hybrid**

For reference, Lake Superior is ~350 mi long and ~160 mi wide, and the Apostle Islands span roughly 25 × 20 mi. Approach:
- **Coastal zones** are detailed and real-time. Their scale is TBD (maybe 1:4 to 1:10 compression so that islands are minutes, not hours, apart while their relative positions stay recognizable).
- **Open water** is abstracted via chart travel with time compression and encounters (decided).
- Plan 03 decides zone boundaries, compression ratios and transition UX. **Draft:** [03](03-world-scale-chart-travel.md) proposes C = 8 (geography only; ships, people and buildings stay 1:1), a ~60-minute real day, four MVP zones, and hand-built 1:1 harbor set pieces.

---

## 9. Plan Index

| # | Plan | Status |
|---|---|---|
| 00 | Master plan (this doc) | Draft v0.2 |
| 01 | [Tech stack, architecture & project setup](01-tech-architecture.md) | Draft v0.1 |
| 02 | [Arcade sailing & ship handling](02-arcade-sailing.md) | Draft v0.2 |
| 03 | [World, hybrid scale, chart travel & streaming](03-world-scale-chart-travel.md) | Draft v0.2 |
| 04 | [Water, weather, seasons, day/night](04-water-weather-seasons.md) | Draft v0.1 |
| 05 | Ports, economy & trading | Not started |
| 06 | Fame, Wanted, law enforcement & lighthouses | Not started |
| 07 | Combat, boarding & targets | Not started |
| 08 | Docks district stealth | Not started |
| 09 | Hideouts, grid building & crafting | Not started |
| 10 | Ship upgrades & customization | Not started |
| 11 | Exploration, islands & secrets | Not started |
| 12 | Sandbox goals, events & failure (jail/permadeath) | Not started |
| 13 | UI/UX | Not started |
| 14 | Art direction & AI asset pipeline | Not started |
| 15 | Audio | Not started |
| 16 | Save/persistence | Not started |
| 17 | Testing, performance & release | Not started |
| R1 | [Research: western Lake Superior circa 1900](R1-western-superior-1900-research.md) (ports, lights, industries, ships, Ojibwe communities) | Draft v0.3 |
| R1a | [Western Superior gazetteer](R1a-western-superior-gazetteer.md) (port profiles, Wanted regions, distances, spring-1900 snapshot) | Draft v0.1 |

---

## 10. Open Questions

Items marked ★ affect the next plans (01–04).

The big design questions are answered. What remains is detail for the system plans to resolve; none of it blocks plans 01–04.

### Gameplay (for system plans)
- On-foot perspective and controls (third-person assumed). Is there on-foot combat or only evasion? (plans 08, 11)
- On-foot danger on islands: wildlife (wolves, bears), exposure/cold in winter? (plan 11)
- Surrender logic and boarding check formula (plan 07).
- Number of Wanted tiers, decay rates, regional boundaries (plan 06).
- Fame decay rate; does legit trading earn Fame or a separate "reputation"? (plan 06)
- Jail sentence lengths, bail costs, jailbreak scenario design (plan 12).
- Final backgrounds and perks (plan 12).
- Hideout claim rules and limits; passive production? (plan 09)
- Ship tiers and the trade-in rule when buying a new hull (plan 10).

### World & content
- Final MVP port list (proposed: Duluth, Superior, Two Harbors, Ashland, Washburn, Bayfield, La Pointe, Cornucopia, plus Red Cliff and Bad River communities)? (R1)
- How Ojibwe communities participate: trade, guides, lore, quests. Approach for respectful portrayal and possible review. (R1, plan 12)

### Art & tech
- Final stylized look: decided by the Phase 0 style test (plan 14).
- AI audio tool choice and license check (plan 15).

---

## 11. Next Steps

1. Write **R1** (western Superior circa 1900 research, including Ojibwe communities) and **01** (tech/architecture).
3. Write **03** (hybrid world) and **02** (arcade sailing), then **04** (water/weather/seasons).
4. Phase 0: scaffold the repo and run a one-ship AI asset pipeline test.

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-10-20 | Player is an original pirate loosely inspired by Dan Seavey, not Seavey himself. |
| 2026-10-20 | Open sandbox structure; no linear campaign. |
| 2026-10-20 | Hybrid world scale: detailed coastlines, abstracted open water. |
| 2026-10-20 | Start region/MVP: western Lake Superior (Apostle Islands, Duluth, Ashland, etc.). |
| 2026-10-20 | Arcade sailing; the weather system impacts sailing. |
| 2026-10-20 | Port stealth uses compact "docks district" scenes, not full towns. |
| 2026-10-20 | No crew system. |
| 2026-10-20 | Violence is optional (killing/sinking allowed) and greatly increases heat. |
| 2026-10-20 | Fame and Wanted are separate meters. |
| 2026-10-20 | A legit trading-only path is supported but harder. |
| 2026-10-20 | Permadeath is possible; jail when caught at low Wanted. |
| 2026-10-20 | Seasons change; technology does not advance (fixed era, ~1895–1905). |
| 2026-10-20 | Multiple hideouts allowed, primarily for storage. |
| 2026-10-20 | Grid-based building. |
| 2026-10-20 | The law cannot raid hideouts. |
| 2026-10-20 | Stack: TypeScript + Vite + three.js, desktop browsers. |
| 2026-10-20 | 3D assets are AI-generated. |
| 2026-10-20 | Solo developer. |
| 2026-10-20 | Start truly solo on a small schooner; larger ships bring an unmanaged invisible crew. |
| 2026-10-20 | Open-water crossings use chart travel with encounters. |
| 2026-10-20 | Winter: risky sailing plus winter activities (poaching, ice-road smuggling, building); skipping is optional. |
| 2026-10-20 | Stylized art style. |
| 2026-10-20 | Permadeath always on; execution when caught at high Wanted; nothing carries over. |
| 2026-10-20 | Jail costs current cargo and time. |
| 2026-10-20 | Hideout storage is separate per hideout. |
| 2026-10-20 | Wanted level is tracked per region. |
| 2026-10-20 | Always the player's own ship; other ships can be looted but not taken. |
| 2026-10-20 | Game starts in 1890 (technology fixed at that level). |
| 2026-10-20 | Dan Seavey does not appear in the game. |
| 2026-10-20 | No AI 3D tool yet; evaluate free tiers in Phase 0 alongside CC0 packs and procedural geometry. |
| 2026-10-21 | Islands are fully walkable; the mainland is not (docks districts only). |
| 2026-10-21 | Boarding is an intimidate-or-fight check driven by crew size; solo players can only loot ships that already surrendered. |
| 2026-10-21 | Weapons: broadside cannons, a swivel gun, rifles/pistols; vary by ship type and are upgradable. |
| 2026-10-21 | Execution only at the top Wanted level. |
| 2026-10-21 | Jailbreak and bail are both options. |
| 2026-10-21 | Fame fades over time. |
| 2026-10-21 | Character creation: name, appearance and a background with starting perks. |
| 2026-10-21 | Ojibwe communities included, portrayed respectfully. |
| 2026-10-21 | Start year moved to 1900 (supersedes 1890) to include more lighthouses. |
| 2026-10-21 | Mouse and keyboard only. |
| 2026-10-21 | Audio is AI-generated. |
| 2026-10-21 | Art style is stylized; the specific look will be picked via a Phase 0 style test. |
| 2026-10-21 | Companies the player can attack are fictionalized; neutral landmarks keep real names; a few real ships appear as Easter eggs. |
| 2026-10-21 | Ojibwe communities are trading partners only; no crimes against them are possible. |
| 2026-10-21 | Duluth and Superior are separate Wanted regions. |
| 2026-10-21 | Open source (public GitHub repo), not sold; large files in git via LFS. |
| 2026-10-21 | Hosting on a DigitalOcean droplet (static site, deployed by GitHub Actions), with an optional itch.io mirror. GitHub Pages is not used. |
| 2026-10-21 | Limited dev hardware is the performance baseline; physics kept minimal; quality presets from Phase 1. |
| 2026-10-21 | MIT license for code (CC BY 4.0 for original assets). Baseline machine: Ryzen 7 7730U, integrated Radeon, 28 GB RAM, Linux. |
| 2026-10-21 | World scale: geography compressed 8×, ~60-minute real day while sailing, slower clock on foot, freighters shrunk slightly, no chart escape while detected, lookout setting for encounters (see 03). |
| 2026-10-21 | Sailing: abandon ship by rowboat (survival check, or death); play continues shipless; auto-trim with optional manual trim; sweeps in calm; islands block wind (lee shelter is a core feature). See 02. |
| 2026-10-21 | Law patrols stay historically sparse: one roaming revenue cutter (*Morrill*), with only a small escalation at top Wanted. Most danger comes from watchers and local law. |

---

## Changelog
- v0.4: Third round of decisions: walkable islands, check-based boarding tied to crew, weapons, jail/bail/jailbreak, Fame decay, character creation with backgrounds, Ojibwe communities, start year 1900, mouse and keyboard only, AI audio, style test plan.
- v0.3: Second round of decisions: crew model, chart travel, winter, stylized art, failure rules, per-hideout storage, regional Wanted, own-ship-only, 1890 start, no Seavey cameo, asset-sourcing approach.
- v0.2: Incorporated the first round of decisions: Lake Superior start, hybrid scale, arcade sailing, Fame/Wanted split, hideouts, failure rules, tech stack, solo dev. Reworked the roadmap and MVP.
- v0.1: Initial draft from the concept discussion and a review of `references/`.
