# 09 — Hideouts, Grid Building & Crafting

Status: DRAFT v0.5 (Phase 8 scope proposed in §16)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan decisions: multiple hideouts, mainly for storage; separate storage per hideout; grid-based building; robust customization; the law can't raid; crafting from supplies
- [01 §4.4](01-tech-architecture.md): grid data model, instancing, occupancy-based collision
- [02 §6.5](02-arcade-sailing.md): shipless recovery from stashes
- [03](03-world-scale-chart-travel.md): walkable islands, zones
- [04](04-water-weather-seasons.md): winter, weeks per day, wind shelter
- [05](05-ports-economy-trading.md): goods and materials, hot goods, cash stashes
- [06](06-fame-wanted-law-lighthouses.md): laying low, safe zones
- [07](07-combat-boarding-targets.md): ammo
- [08 §13](08-docks-district-stealth.md): the shared layout editor
- [R1](R1-western-superior-1900-research.md): abandoned quarries, sea caves, logging camps, the dark Minnesota Point light
Feeds: 10 (ship parts, drydock, shipbuilding), 11 (island sites, salvage, secrets → decor and maps), 12 (sandbox goals), 13 (build UI), 14 (kit art)

## Purpose

Define hideouts: where they are, how they're claimed, what they do (storage, crafting, production, laying low, repairs, shelter), the grid building system and its UX, materials (bought and salvaged), crafting recipes and workstations, and the budgets that keep many player-built structures cheap to render.

---

## 1. Goals

1. **Robust, expressive building** (a decided pillar): many pieces, materials, paint, decor and blueprints. Players should want to make each hideout theirs.
2. **Building has purpose:** storage logistics, crafting that feeds piracy (tools, ammo, false lights, untaxed whiskey), and repair and shelter.
3. **Comfortable mouse-and-keyboard UX:** ghost previews, clear validity feedback, undo, drag-placing, blueprints.
4. **Cheap:** hundreds of pieces per hideout render in tens of draw calls on the integrated GPU.
5. **One engine, two uses:** the same placement system powers the dev layout editor for docks districts ([08 §13](08-docks-district-stealth.md)).

---

## 2. Hideout Sites

### 2.1 Predefined, claimable sites
Hideouts are built at **predefined sites**, each a hand-placed area with build bounds, a prepared terrain pad, an anchorage or mooring, and traits. Sites are discovered by exploring, through rumors and maps, or are known from the start.

**MVP site list (draft, grounded in R1):**
| Site | Zone | Character | Traits |
|---|---|---|---|
| **Hermit Island quarry** (abandoned brownstone quarry) | Apostles | Cut-stone ledges, a derrick, a ruined shack | Free brownstone salvage; medium concealment; deep anchorage |
| **Stockton Island quarry / Presque Isle bay** | Apostles | A large bay, a quarry ruin | Big build area; a sheltered anchorage (lee from NW winds) |
| **Devils Island sea caves** | Apostles | A sea cave mooring plus a clifftop pad | **High concealment**; tiny build area; exposed to NE storms |
| **Outer Island fish camp** (abandoned) | Apostles | Remote fish camp | Far from law; long sail to markets |
| **Siskiwit Bay logging camp** (abandoned) | Siskiwit | Bunkhouse ruins, a lumber pile | Free lumber salvage; mainland sea caves nearby; South Shore West region |
| **Minnesota Point lighthouse** (dark since 1885) | Twin Ports | An abandoned light tower and keeper's house | **Inside the Duluth region**: a stash next to the best fence and market; low concealment; small area |
| **North Shore cove** | Two Harbors | A rocky cove with forest | North Shore region; near the ore traffic |

- **Mainland sites (decided 2026-10-22):** Minnesota Point, the North Shore cove and the Siskiwit logging camp are on the mainland. Each has a small on-foot **build pad** (its build bounds plus a margin), the one exception to the mainland not being walkable ([03 §4](03-world-scale-chart-travel.md)).
- Different sites sit in **different Wanted regions**. Laying low ([06 §3.3](06-fame-wanted-law-lighthouses.md)) works for the region the hideout is in, which spreads players across the map.
- **Anchorage shelter** uses the wind shelter maps ([02 §11](02-arcade-sailing.md)): some sites are storm refuges, others are exposed to certain winds.
- **Limit:** one hideout per site. In the full game all 7 sites can be owned; expansions add more.
- **MVP: 2 sites (decided 2026-10-22):** Stockton Island bay and the Siskiwit logging camp. The other five arrive after the MVP.

### 2.2 Claiming
- **Abandoned sites** (most): discover them, then **claim** (free). The first structure placed establishes the claim.
- **Owned sites** (some, e.g., the Minnesota Point light): **buy** the lease or deed from the owner, or squat (illegal: a small heat chance if noticed, and some sites need a bribe to be ignored).
- **Starting hideout:** each background starts with a claim on a specific site (Deckhand: Stockton; Fisherman: Outer Island; Lumberjack: Siskiwit Bay; Saloon Keeper: Minnesota Point; Ex-Navy: North Shore cove; Poacher: Devils Island). Hermit Island is never a starting site. See [12 §2.2](12-sandbox-events-character-failure.md).
  - **A starting hideout comes pre-built with a strongbox and basic storage** (decided 2026-10-22), which also establishes the claim.
  - **In the MVP** (2 sites), the Lumberjack starts at the Siskiwit logging camp and every other background starts at Stockton Island bay.

---

## 3. What Hideouts Do

| Function | Details |
|---|---|
| **Storage** (primary) | Local inventory per hideout (decided). Capacity comes from storage pieces (§5.4). Goods and **cash** (needs a strongbox). |
| **Safe zone** | **Completely safe (decided):** neither the law nor rival pirates can raid hideouts or touch their storage. Reaching the boundary **ends any pursuit**: pursuers break off and the chart lock lifts ([06 §5.4](06-fame-wanted-law-lighthouses.md)). The only risk is being **spotted** (§8). |
| **Lay low** | Sleeping here accelerates Wanted decay in this hideout's region ([06](06-fame-wanted-law-lighthouses.md)). |
| **Autosave point** | Sleeping and leaving trigger autosave ([01 §4.7](01-tech-architecture.md)). |
| **Crafting & production** | Workstations (§7). |
| **Ship services** | Mooring and anchorage. **Slipway/drydock** pieces enable full repairs and **shipbuilding when you have no ship** (§7.4). |
| **Hot-goods cooling** | Stored hot goods cool over weeks; the re-crating station removes company marks ([05 §6.1](05-ports-economy-trading.md)). |
| **Winter shelter** | A stove or fireplace prevents cold exposure on islands (plan 11). Ice-road access in winter ([04 §8](04-water-weather-seasons.md)). |
| **Trophies & display** | Decor from heists and secrets (figureheads, flags, curios, newspaper clippings of your exploits). |
| **Shipless recovery** | Stashed goods and cash fund a new ship after a sinking ([02 §6.5](02-arcade-sailing.md)). |

---

## 4. The Grid

### 4.1 Dimensions
- **Cell:** 2 m × 2 m horizontally.
- **Level:** 3 m tall. Up to **3 levels** (ground plus two upper floors; towers can go higher via special pieces).
- **Rotation:** 4 directions (90°).
- **Foundations adapt to terrain:** stone or timber foundations and **pilings** auto-extend downward to the ground or lake bed (within limits), so builds sit on slopes and over shallow water without terraforming.

### 4.2 Placement types
| Type | Snaps to | Examples |
|---|---|---|
| **Cell** pieces | A cell (1×1, 2×1, 2×2 footprints) | Foundations, floors, stairs, large workstations, storage racks |
| **Edge** pieces | Cell edges | Walls, half-walls, doors, windows, fences, railings |
| **Roof** pieces | Cell plus level (auto-select slope, corner and peak where possible) | Gable, hip, lean-to, flat tarpaper |
| **Props** | A 0.25 m sub-grid inside cells, plus free rotation in 15° steps | Furniture, decor, lanterns, barrels, trophies |
| **Water** pieces | Cells over water within depth limits | Pier sections, pilings, slipway, mooring posts, boathouse |

### 4.3 Validity rules (pure functions in the simulation layer, unit-tested)
- Inside the site's **build bounds**.
- **Support graph** (not physics): floors need a foundation, piling or supporting walls or posts below. Upper levels need support beneath. Roofs need walls or posts. Removing a supporting piece is blocked (or offers to remove its dependents too).
- **No overlap** (cell and edge occupancy).
- **Terrain fit:** foundation auto-height within its limit; no building into cliffs.
- **Water:** depth within the piling limit. The slipway and drydock need a specific depth and a shore slope.
- **Mooring:** a dock edge adjacent to water deeper than your ship's draft.

---

## 5. Piece Catalog (MVP target: ~120 pieces including variants)

### 5.1 Structure
| Category | Pieces | Material variants |
|---|---|---|
| Foundations | Square, half, stairs-foundation, piling | Brownstone, timber |
| Floors | Floor, trapdoor, cellar hatch | Plank, flagstone |
| Walls | Wall, half-wall, wall with door frame, window frame, corner post | **Log, plank (clapboard), brownstone, tarpaper shack** |
| Doors/windows | Plank door, heavy iron-strapped door (lockable), shutters, glazed window | — |
| Roofs | Gable, hip, lean-to, flat, dormers, chimney | Cedar shingle, plank, tarpaper, turf |
| Stairs/ladders | Stairs, ladder, spiral (tower) | — |
| Water | Pier straight/corner/T, ladder, mooring post, boathouse, **slipway**, **drydock** | Timber |
| Fences/outdoor | Palisade, rail fence, gate, path stones, brush screen | — |

### 5.2 Functional pieces
| Piece | Function |
|---|---|
| Crate stack / barrel rack / shelving | Storage (small/medium) |
| Warehouse bay (2×2) | Storage (large) |
| **Hidden cellar vault** | Large storage plus concealment (a cash-safe option) |
| **Strongbox** | Cash stash |
| Workstations | See §7.1 |
| Stove / fireplace | Warmth (winter), cooking (provisions value up); emits light and smoke |
| Well / rain barrel | Required by the distillery and smokehouse |
| **Lookout tower** | See approaching ships from far off (reveals traffic on the zone map) |
| **Signal lantern** | Cosmetic, or a beacon for your own night return |
| Lanterns / lamps | Light (concealment penalty at night) |
| Bed / bunk | Sleep, laying low |
| Cartography table | Combine clues into maps (plan 11) |
| Camouflage (brush screens, netting, painted canvas) | Raises concealment |

### 5.3 Decor
Furniture (tables, chairs, chests, rugs), period items (stove, hand pump, oil lamps), nautical (nets, buoys, oars, anchors, ship's wheel), **trophies** (figureheads and nameboards from ships you've robbed, captured flags, curios from secrets, framed newspaper headlines about you), flags, paint, and color variants.

### 5.4 Storage capacities (draft)
| Piece | Capacity |
|---|---|
| Crate stack | 5 CU |
| Barrel rack | 6 CU (liquids and fish get a bonus) |
| Shelving | 8 CU |
| Warehouse bay (2×2) | 25 CU |
| Hidden cellar vault | 40 CU |
| Strongbox | Unlimited cash (one per hideout needed to stash money) |

---

## 6. Materials (buy & salvage only)

### 6.1 Materials
**Lumber, brownstone, iron hardware, nails, rope, canvas, tar/pitch, glass, kerosene, salt, black powder, grain, and water** (from a well). Most are **goods** in the economy ([05 §3](05-ports-economy-trading.md)) and occupy CU in holds and storage. Hauling materials to remote sites is part of the logistics game.

### 6.2 Sources
| Source | What |
|---|---|
| **Buy** | Ports (lumber at Washburn and Ashland, hardware at Duluth, rope and canvas at chandleries) |
| **Steal** | Warehouses, ship holds |
| **Salvage** | Abandoned quarries (**dressed brownstone blocks**), logging camps (**lumber**), wrecks (iron, rope, canvas; plan 11) |


**Decided: no gathering.** "We're pirates, not lumberjacks or masons." There's no tree felling, stone quarrying or resource harvesting. Materials come only from buying, stealing and salvaging, which keeps hideout building tied to the trade and piracy loops.

### 6.3 Construction time
- **Blueprint placement is instant and free** (ghost pieces).
- **Construction** consumes materials and **game time**. Pressing "**Build**" runs a work session: the clock advances (like sleeping) by the total build time, scaled by:
  - **Crew** (decided invisible crew): T2 and T3 crews help at the hideout, so building is faster. Solo T1 builds slowest. The crew matters, with no management.
  - Season (winter work is slower).
- Partial builds are allowed (build what materials allow, leave the rest as blueprint).
- Deconstruct refunds **75%** of materials (draft).

---

## 7. Crafting

### 7.1 Workstations
| Station | Unlocks |
|---|---|
| **Workbench** | Basic tools, crates and barrels (basic), repair patches, furniture |
| **Smithy / forge** | Lockpicks, crowbar, iron hardware from scrap, **round shot, chain shot, grape**, cannon carriages (plan 10) |
| **Sail loft** | Sail mend kits, **better sails** (plan 10), canvas camouflage, rope work |
| **Cooperage** | Barrels (fish and whiskey), **re-crating** hot goods (removes company marks) |
| **Distillery** | **Untaxed whiskey** (contraband) from grain plus water over time |
| **Smokehouse** | Smoked fish and **venison** (preserved, higher value; poached venison is contraband) |
| **Powder room** | Safe powder storage and cartridges (makes ammo crafting faster; a fire or explosion risk if hit; flavor) |
| **Cartography table** | Combine clues and documents into **treasure or secret maps** (plan 11) |
| **Slipway / drydock** | Full ship repair; hull work (plan 10); **building a new ship when shipless** (§7.4) |
| **Lantern workshop** (on the workbench) | **False-light rig** (lantern, kerosene, pole, colored glass), used for wrecking ([06 §6.2](06-fame-wanted-law-lighthouses.md)) |

### 7.2 Recipes (examples; full list in `recipes.json`)
| Recipe | Inputs | Station | Time | Output |
|---|---|---|---|---|
| Hull patch kit | 2 lumber, 1 tar | Workbench | 1 h | Repairs 25% hull at sea |
| Sail mend kit | 1 canvas, 1 rope | Sail loft | 1 h | Repairs 25% rigging at sea |
| Round shot ×10 | 1 iron | Smithy | 2 h | Ammo |
| Chain shot ×6 | 1 iron, 1 rope | Smithy | 2 h | Ammo |
| Grape ×6 | 1 iron scrap, 1 canvas | Smithy | 2 h | Ammo |
| Lockpicks ×3 | 1 hardware | Smithy | 1 h | Tool |
| False-light rig | 1 lantern, 1 kerosene, 1 lumber | Workbench | 2 h | Wrecking tool |
| Untaxed whiskey ×4 CU | 3 grain, water | Distillery | **1 week** (= 1 game day) | Contraband |
| Smoked venison ×2 CU | 3 venison, 1 salt | Smokehouse | 1 week | Preserved (contraband) |
| Re-crate | 1 hot marked CU, 1 lumber | Cooperage | 30 min | Same goods, unmarked |
| Treasure map | 3 clue documents | Cartography | 1 h | Reveals a secret (plan 11) |

### 7.3 Passive production
- **Decided:** some stations **process over time while you're away**: the distillery ferments and the smokehouse cures. You load inputs, sail off, and come back to outputs.
- Since 1 game day = 1 week ([04 §3.2](04-water-weather-seasons.md)), production is **capped per station per week** to stay balanced. Outputs stay in **that hideout's storage** (haul them yourself; no workers or crew management).

### 7.4 Shipbuilding (decided: only when shipless)
- A hideout with a **slipway** can **build a new schooner from materials**, but **only when you don't currently own a ship** (after abandoning ship, [02 §6.5](02-arcade-sailing.md)). It's a recovery path, not a fleet or upgrade path. Upgrading to a bigger ship stays a shipyard purchase (plan 10).
- **What can be built:** T1 for sure. Whether T2 is buildable (with much larger material costs) is for plan 10 to decide.
- **Cost:** a large stack of lumber, iron hardware, rope, canvas and tar (stored at **that hideout**), plus a long build session. Being solo makes it slow, since you have no crew while shipless. Cheaper in money than buying at a shipyard if you stockpiled materials, which rewards preparation.
- Gets you sailing again without reaching a port, useful if you're stranded with a well-stocked hideout. The new hull is a **new ship profile** (old ship reports no longer match; [06 §2.3](06-fame-wanted-law-lighthouses.md)).

---

## 8. Concealment

Each hideout has a **concealment rating**: site base + camouflage − night lights − chimney/distillery smoke − a ship visibly anchored − size or height (tall towers are visible).

**Effects:**
- Whether passing ships and **copycat rivals** notice the hideout ([07 §8.1](07-combat-boarding-targets.md)).
- Whether witnesses can tie your ship to a location (a hideout spotted by a keeper adds a location to rumors about you, so the cutter patrols nearby more).
- **No raids (decided):** concealment only affects *being spotted*. Hideouts and their storage are never attacked. Defensive pieces (palisades, towers) are cosmetic or flavor.

---

## 9. Build Mode UX (mouse and keyboard)

- Enter with **B** when on foot inside a claimed hideout.
- **Build camera:** a free orbit and pan around the site (WASD pan, mouse orbit, wheel zoom, **PgUp/PgDn** to change level). It cuts away upper levels when you're editing lower ones.
- **Palette** (a Preact UI panel): categories → pieces → material and paint variants, with the material cost and your available materials (from **this hideout's storage plus your ship's hold if it's moored here**).
- **Ghost preview:** green = valid, red = invalid with a reason tooltip ("needs support below").
- **R** rotate · **LMB** place · **drag** to place lines of walls, fences or floors and rectangles of floors and foundations · **X** deconstruct (shows the refund) · **Q** eyedropper (pick the piece under the cursor) · **Ctrl+Z / Ctrl+Y** undo/redo · **paint tool** (recolor and swap materials) · **Tab** toggles a grid overlay.
- **Blueprints:** select an area and save it as a named blueprint. Place blueprints at any hideout (with a materials check) to reuse designs across sites.
- **Build queue summary:** total materials needed vs. available, estimated build time. "Build" starts the work session.

---

## 10. Rendering & Performance

| Item | Approach / Budget |
|---|---|
| Pieces per hideout | ≤ 1,500 (soft cap with a UI warning) |
| Rendering | One `InstancedMesh` per piece type × material (~60–100 combos) → **≤ 80 draw calls** per hideout up close |
| Distant view (from the ship) | After each edit, generate a **merged low-poly proxy** (simplified boxes plus roof shapes) for LOD, so 1–3 draw calls from afar |
| Collision | From grid occupancy (walls block edges, floors are walkable; [01 §4.4](01-tech-architecture.md)). No physics engine. |
| Lights | Lanterns are emissive plus fake pools; ≤ 4 real lights near the player |
| Rebuild cost | Incremental instance updates on placement (≤ 1 frame); proxy regeneration debounced |
| Save size | Pieces saved **packed**: a palette of piece ids plus a flat integer array (type, cell, level, rotation, variant, paint). S6 measured ~17 bytes per piece raw, 7 hideouts × 1,500 pieces = 177 KB raw, 55 KB compressed ([16 §15](16-save-persistence.md)). |

---

## 11. Shared Layout Editor (for docks districts)

The same placement engine (grid, snapping, ghost, validity, undo, blueprints) runs in a **dev-only mode** with:
- the full district kit (warehouses, piers, facades)
- free placement for props and NPC waypoint authoring
- lamp and light authoring
- export to `districts/<id>.json`

Navmesh baking ([08 §5.3](08-docks-district-stealth.md)) runs from the exported layout.

---

## 12. Data & State

**Data:**
- `sites.json`: id, zone, bounds, pad, anchorage, region, base concealment, claim type and cost, salvage yields.
- `structures.json`: id, category, placement type, footprint, materials, build time, support rules, variants, mesh/LOD ids, functions (storage CU, station id, concealment delta, light, smoke, warmth).
- `recipes.json`, `stations.json`, `materials.json` (links to goods), `blueprints/` (shipped examples).

**WorldState:**
- `hideouts[id] = {siteId, claimedAt, pieces[], blueprintsPending[], storage{goods[], cash}, stations{id: {queue, progress}}, concealment}`
- `player.blueprints[]` (saved designs)
- `knowledge.sites` (discovered sites)

**Events:** `SiteDiscovered`, `HideoutClaimed`, `PiecePlaced/Removed`, `BuildSessionCompleted`, `ItemCrafted`, `ProductionCompleted`, `StorageChanged`, `HideoutSpotted`.

---

## 13. Phase 8 Deliverables & Acceptance

**Build:** the two MVP sites (Stockton Island bay and the Siskiwit logging camp with its mainland build pad), pre-built starting hideouts, claiming, the grid engine (cells, edges, roofs, props, water pieces), validity and support rules, ~60 pieces in 2–3 materials, the build mode UX (ghost, drag, undo, eyedropper, paint), per-hideout storage plus strongbox, construction time with a crew multiplier, workbench plus smithy plus cooperage plus distillery with 10+ recipes, passive production, laying low, the distant LOD proxy, and the dev layout editor mode.

**Acceptance:**
- A player can build a weatherproof storehouse with a pier in under 10 real minutes of UI time.
- Invalid placements always explain why.
- 1,500 pieces render within budget.
- Stored goods are only available at that hideout.
- A distillery started before a voyage has whiskey waiting on return.
- Saves round-trip all hideouts exactly.

---

## 14. Cut List
1. Blueprints (save/load designs).
2. Paint and recolor tool (material variants only).
3. Third level (two levels max).
4. Powder room.
5. Lookout tower traffic reveal.
6. Drag-placement (single placement only).

*Not cuttable:* multiple hideouts (2 sites in the MVP, 7 fixed sites in the full game), per-hideout storage, grid building with materials, crafting of tools, ammo, repair kits and false lights, the safe zone, laying low, passive production, shipless shipbuilding.

---

## 15. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | **Hideouts are completely safe:** no raids by the law or rivals; concealment only affects being spotted. |
| 2026-10-21 | **No gathering:** materials only from buying, stealing and salvage. |
| 2026-10-21 | **Passive production** (distillery, smokehouse) continues while away. |
| 2026-10-21 | **Shipbuilding at a hideout slipway, only when shipless.** |
| 2026-10-21 | **Seven fixed hideout sites** in the MVP region. |
| 2026-10-21 | **Construction takes game time** (a work session advances the clock; faster with a bigger crew). |
| 2026-10-22 | **MVP ships 2 sites** (Stockton Island bay, Siskiwit logging camp); all 7 in the full game. |
| 2026-10-22 | Mainland sites get small on-foot **build pads**. |
| 2026-10-22 | Starting hideouts come **pre-built with a strongbox and storage**. |
| 2026-10-22 | Reaching a hideout **ends pursuit**. |

---

## 16. Phase 8 Scope: Hideouts (2026-11-16)

Phase 8 is the **Hideouts** build (version 0.8.0, the MVP/Alpha by [17 §7](17-testing-performance-release.md)), with one goal from the [00 §7](00-master-plan.md) roadmap: **"the base loop."** Phases 4–7 built a captain who trades, is hunted, robs ships at sea and burgles Bayfield on foot, and who keeps whatever they can't sell in a fixed shed on Stockton Island. Phase 8 makes that shed theirs: row ashore at Presque Isle bay with a hold full of lumber and hardware from Washburn, lay out a storehouse and a pier on the grid, press Build and lose a day to the work, then set a still going in the back and sail off to come home to a week's whiskey. Or, after the *Morrill* sinks you, row to the Siskiwit logging camp and build a new schooner on the slipway you laid down last summer.

The scope comes from §13 above and the Phase 8 rows of the other plans, plus what earlier phases left for it: the Stockton stash prefab that this phase replaces in place ([05 §16](05-ports-economy-trading.md), §2 above), the Siskiwit Bay zone and its hideout pad ([03 §20.5](03-world-scale-chart-travel.md)), the second smuggler who lies in Siskiwit Bay ([07 §14.6.1](07-combat-boarding-targets.md)), the Lumberjack's starting site ([05 §16](05-ports-economy-trading.md), [12 §2.2](12-sandbox-events-character-failure.md)), laying low and pursuit ending at a hideout ([06 §3.3, §5.4](06-fame-wanted-law-lighthouses.md)), crafted upgrades, drydock installs and shipless shipbuilding ([10 §13](10-ship-upgrades-customization.md)), the build and crafting UI ([13 §12](13-ui-ux.md)), the hideout kit and stations ([14 §13](14-art-direction-asset-pipeline.md)), build and craft sounds ([15 §11](15-audio.md)), the hideout save slices ([16 §12](16-save-persistence.md)), and Phase 7's open calls ([08 §20.8.3](08-docks-district-stealth.md)).

This section is the phase's scope as proposed. Its exit criteria (§16.3) become the phase's acceptance checklist once Jared approves it, and the playtest piece checks them.

### 16.1 What Phases 4–7 change or put at risk

| Finding | Source | Effect on Phase 8 |
|---|---|---|
| **The Stockton stash is a fixed prefab:** one site in `data/sites.json` with a 40 CU shed and a strongbox, stored in the `hideouts` save slice (`siteId`, `claimedAt`, `storage`), opened at its strongbox on foot or from the anchorage | `src/sim/hideouts/stash.ts`, `src/gameplay/stash.ts`, `src/gameplay/island-ashore.ts` | Piece A grows the slice with `pieces[]` and `stations{}`; piece C turns the prefab into a pre-built shack of grid pieces with the same contents. Nothing stored is lost. |
| **The grid format already exists.** Phase 7's district layout is a palette of kit ids and packed cell, edge and prop tuples on a 2 m grid, with a dev placement editor that snaps, rotates and saves | `src/sim/district/layout.ts`, `src/debug/district/editor.ts`, `data/kit.json` | Piece A extends that format with levels, roofs, water pieces, materials and a support graph instead of writing a second one. The district editor keeps working on it (§11's shared editor). |
| **Kit pieces are procedural geometry,** instanced and merged per block, with ink outlines (style B) | `src/render/district/kit-meshes.ts` | The hideout kit is made the same way (piece B), so the art risk is smaller than Phase 7's body was. |
| **Walking ashore works at Stockton only,** on the island's baked 1 m tiles; the mainland isn't walkable | `src/gameplay/island-ashore.ts`, 03 §4 | Stockton's build bounds go in its existing scene. Siskiwit's logging camp needs its own small walkable pad on the mainland (piece D), the one exception decided on 2026-10-22. |
| **The Siskiwit Bay zone isn't baked;** the chart has its bounds and passes through it | `data/chart.json` `zone.siskiwit`, `data/zones.json` (three zones) | Piece D bakes it through `tools/geo/build.ts` as Phase 3 baked the Twin Ports and Two Harbors, with the logging camp as its set piece. |
| **Every background starts at Stockton,** including the Lumberjack, until Siskiwit exists | `data/sites.json` `startFor`, 05 §16 | Piece D moves the Lumberjack's new runs to Siskiwit. Runs already under way keep the hideouts they have. |
| **Laying low isn't built.** Heat decays faster away from a region, but sleeping at a hideout does nothing special, and nothing ends a pursuit there | `src/sim/law/law.ts` `decayHeat`, 06 §3.3 | Piece F. |
| **There's no shipless state.** Abandoning ship lands you at a yard, which sells you a worn T1 on credit; Phase 7 added rowing to a landing | `src/sim/shipyard/abandon.ts`, 07 §14.12, 08 §20.6 decision 2 | Piece G adds the slipway's way back (§16.5). |
| **The materials are mostly goods already:** lumber, brownstone, hardware, rope and canvas, kerosene, salt, powder and shot, grain | `data/goods.json` | §6.1's tar, glass and nails fold into existing goods (§16.5); no new goods are needed. |
| **Repair kits, lockpicks and ammunition exist** as ship's stores and powder, bought at the chandlery | `data/stores.json`, `data/ammo.json` | Crafting (piece E) makes the same items, so nothing downstream changes. |
| **The audio budget is full:** 4.96 MB of 5 MB decoded | 08 §20.8.3 decision 4, 15 §20 | Piece I raises it to 8 MB, as recommended there. |
| **Phase 7's leftovers:** the island posse that doesn't search, the jailbreak sounds that came out odd, a soft ground disc that follows the player by day, Jared's laptop playtest | 08 §20.8.2–3, 0.7.1–0.7.2 | None of them blocks Phase 8. The posse goes to Phase 9 with the island's life (08 §20.8.3 decision 2's recommendation); the sounds and the disc are parked fixes; the playtest is still Jared's. |

### 16.2 What Phase 8 delivers

| Area | Deliverable | Plan |
|---|---|---|
| The grid engine | Cells, edges, roofs, props and water pieces on the 2 m grid with 3 m levels (two levels in the MVP), four rotations, foundations and pilings that reach down to the ground or lake bed; validity as pure functions with a reason for every refusal (bounds, support, overlap, terrain, water depth, mooring); occupancy colliders; material costs and a 75% refund; undo and redo | §4, §6.3 |
| The pieces | About 60 pieces in timber, plank and brownstone (tarpaper as a fourth if cheap): foundations, floors, walls with door and window frames, doors, shutters, roofs, stairs and ladders, pier sections, mooring posts, the slipway, palisade and fences, storage pieces (crate stack, barrel rack, shelving, warehouse bay, hidden cellar vault), the strongbox, a bunk, a stove, lanterns, the four workstations, and a few decor props | §5, 14 §13 |
| Rendering | One instanced mesh per piece type and material (≤ 80 draw calls up close for a full hideout), the merged low-poly proxy for the distant view (1–3 draw calls), lamps as emissive pools as in the district | §10 |
| Build mode | B on foot inside a claimed site's bounds; the build camera (orbit, pan, zoom, level up and down with upper levels cut away); the palette with costs and what you have (this hideout's storage plus the hold of a ship moored here); the ghost in green or red with its reason; R, LMB, drag for lines and rectangles, X to deconstruct with the refund shown, Q to pick up the piece under the cursor, Ctrl+Z and Ctrl+Y, Tab for the grid; the build queue's materials and time; Build runs a work session that advances the clock, faster with a crew and slower in late autumn | §9, §6.3, 13 §12 |
| Two sites | Stockton Island bay, replacing the prefab with a pre-built shack, strongbox and storage of pieces, its contents kept; the Siskiwit Bay zone baked, the logging camp's ruins and mainland build pad walkable, its anchorage, the Lumberjack starting there, and the second smuggler lying in the bay after dark | §2, 03 §20.5, 07 §14.6.1, 12 §2.2 |
| Storage | Capacity from storage pieces; goods and cash at that hideout only; F at any storage piece or the strongbox on foot opens the hideout's storage, and the anchorage screen still opens it from the ship | §3, §5.4 |
| Crafting | The workbench, smithy, cooperage and distillery as pieces; `recipes.json` and `stations.json` with 12 or more recipes (patch and mend kits, round, chain and grape shot, lockpicks, the crowbar, crates and barrels, re-crating hot goods, the false-light rig as an item for Phase 9's wrecking, untaxed whiskey, two crafted upgrades); crafting from this hideout's storage over game time; the distillery working while you're away, capped per week, its output in that hideout's storage | §7, 10 §6 |
| The slipway | Full repairs from materials and a work session; installing crafted upgrades; building a new T1 when shipless | §7.4, 10 §8–9 |
| Hideout life | Sleeping in a bunk at a hideout lays low (faster decay in its region) and autosaves; reaching a hideout's anchorage ends a pursuit; each site's concealment shown, with being spotted adding the site to the rumors about you; brownstone salvage at the Stockton quarry and lumber at the logging camp | §3, §6.2, §8, 06 §3.3, §5.4 |
| Audio | Build sounds (saw, hammer, stone set, piece placed, refused, deconstructed), the work session's bed, the stations at work (forge, cooperage, still), and the UI set; the decoded budget raised to 8 MB | 15 §11, 08 §20.8.3 |
| Saves | `hideouts[id].pieces` packed as §10 says, `stations{}` with their queues, discovered sites; save v10 with a v9 migration that rebuilds the Stockton prefab as pieces; dirty-slice saving if the hideout slices make autosaves slow | §12, 16 §12 |
| Ambitions | Pinning up to three goals, about twelve of them, with marks in the ledger (decision 1) | 12 §4.1 |

**Out of scope:** the other five sites (after the MVP, §2.1); the sail loft, smokehouse, powder room and cartography table (Phase 9 with venison, clues and maps); wrecking with the false light (Phase 9; the rig is crafted now and used then); copycat rivals noticing hideouts (Phase 9, 12 §7); winter shelter and ice roads (Phase 9's winter); the island posse that searches (Phase 9); events and letters (Phase 9, decision 1); the Ashland, Duluth and Superior districts (8+ in 08 §2.2, left for after the MVP by §16.5); T2 shipbuilding (10 decides; §16.5 keeps it T1); and §14's cuts #1–5 by decision 2.

### 16.3 Exit criteria

Phase 8 is done when these pass on the baseline laptop and Jared signs off the playtest. The first six are §13's acceptance; the rest come from the other plans and plan 17's definition of done.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | A player can build a weatherproof storehouse with a pier in under 10 real minutes of UI time | A playtest route; an e2e test that builds it through the build mode's inputs |
| 2 | Invalid placements always explain why | Unit tests: every refusal from the validity functions carries a reason, and the ghost shows it |
| 3 | 1,500 pieces render within budget: ≤ 80 draw calls up close, 1–3 from the ship, a p95 frame ≤ 16.7 ms on Medium | `bench.hideout` (17); the laptop |
| 4 | Stored goods are only available at that hideout | Unit tests on storage and the build palette's material count |
| 5 | A distillery started before a voyage has whiskey waiting on return, and never more than the week's cap | A sim test across a voyage's time skip |
| 6 | Saves round-trip every hideout exactly; seven hideouts of 1,500 pieces stay in plan 16's budget | `tests/save-*.test.ts`; `bench:save` |
| 7 | A 0.7.x save loads into 0.8.0 with the Stockton stash's goods and cash in a pre-built shack of pieces | `tests/save-migrations.test.ts` with a v9 fixture |
| 8 | Both sites work: Stockton from its walked island, Siskiwit from its baked zone and walkable pad; a new Lumberjack starts at Siskiwit | e2e tests for each; the Siskiwit bake report |
| 9 | Crafting makes items that work where the bought ones do: a crafted patch kit patches, crafted shot fires, crafted picks pick | Unit tests against the stores and ammo already in use |
| 10 | Sleeping at a hideout lays low in its region, and reaching a hideout's anchorage ends a pursuit | Sim tests on the law's decay and the pursuers |
| 11 | Shipless, a hideout with a slipway and the materials builds a T1 and puts you aboard | A sim test; an e2e test through dev hooks |
| 12 | Building, crafting and the new sounds fit the 8 MB audio budget and the frame budget in the build camera | The pipeline test; `bench.hideout` |
| 13 | Building is satisfying and makes you want to make the place yours | Jared decides |
| 14 | Plans 03, 05, 06, 09, 10, 12, 13, 14, 15 and 16 record what was built, CI is green, and 0.8.0 is tagged as the MVP/Alpha | The release PR |

### 16.4 Work pieces

Ten pieces, each sized to be one thread. Four can start at once (A, B, D and H). The playtest (J) closes the phase.

| Stage | Pieces |
|---|---|
| 1, start now | A the grid engine, B the hideout kit, D Siskiwit Bay, H Ambitions |
| 2 | C build mode and Stockton (after A, B), E crafting (after A) |
| 3 | F hideout life (after A, C), G the slipway (after A, E), I build and craft audio (after C, E) |
| 4 | J playtest and 0.8.0 |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | The grid engine | Pure sim first: the district layout format grown for hideouts (levels, roof and water placements, materials and paint variants per piece), `structures.json` with the catalog's ids, footprints, materials, build times, support rules and functions; validity with reasons (bounds, the support graph, overlap, terrain fit with auto-height foundations and pilings, water depth, mooring); placing, removing with dependents, the refund; undo and redo as an edit log; occupancy colliders for on foot; the build queue and the work session's time with crew and season; `hideouts[id].pieces` packed (§10), save v10 with the v9 migration that turns the prefab into pieces. Unit tests throughout | — | — |
| B | The hideout kit | The ~60 pieces as procedural geometry in style B, in timber, plank and brownstone (tarpaper if cheap), from `structures.json`; one `InstancedMesh` per type and material, incremental updates on placement, the merged distant proxy rebuilt after edits; the four stations, storage pieces, the bunk, the stove and lanterns as pieces; `bench.hideout` with 1,500 pieces | — (A's schema; boxes until it lands) | The look |
| C | Build mode and Stockton | B on foot inside a claimed site's bounds; the build camera; the palette as a Preact panel with costs and what's on hand; the ghost and its reasons; place, rotate, drag lines and rectangles, deconstruct, eyedropper, undo, the grid overlay; the queue summary and Build. Stockton's build bounds at Presque Isle bay in the walked island scene, the pre-built shack replacing the prefab, F at storage pieces and the strongbox, colliders from occupancy. Dev hooks (`__glpBuild`) to fill a site, give materials and run a session | A, B | Layout of the pre-built shack |
| D | Siskiwit Bay | `zone.siskiwit` in `zones.json`, baked through `tools/geo/build.ts` with a bake report; the logging camp set piece (bunkhouse ruins, a lumber pile, a landing) and its anchorage; the mainland build pad as a small walkable scene like Stockton's, with going ashore by rowboat; `site.siskiwit` in `sites.json`; the Lumberjack starting there; the second smuggler (`smuggler.siskiwit`, already in `smuggler.json`) switched on; the chart's stop wired in; `?harbor=siskiwit` and the Jump to menu | — | — |
| E | Crafting | `stations.json`, `recipes.json`; crafting at a station from this hideout's storage, over game time like a work session; the workbench, smithy, cooperage and distillery recipes of §16.2; passive production while away (the still's queue and weekly cap, run by the clock on load and after time skips); re-crating hot goods; the false-light rig stored as an item; two crafted upgrades (§16.5) for the slipway to install; the crafting panel | A | — |
| F | Hideout life | Sleep in a bunk: lay low (a decay factor for the hideout's region while asleep there), wake at an hour, autosave on sleeping and on leaving; pursuit ends when you reach a hideout's anchorage (06 §5.4: pursuers break off, the chart lock lifts); concealment per site from its base, pieces, lamps, smoke and a ship at anchor, shown in the build palette; being spotted by a passing ship adds the site to the rumors and the cutter's patrol; salvage at the Stockton quarry (brownstone) and the logging camp (lumber), a limited stock a season | A, C | — |
| G | The slipway | The slipway and its depth and slope rules; full repairs from materials and a session; installing crafted upgrades; building a T1 when shipless (§16.5), with a new ship profile; the abandon-ship flow offering the hideout when you have a slipway | A, E | — |
| H | Ambitions | `ambitions.json` with about twelve goals across the categories that can be met in the MVP (wealth across hideouts, infamy, trade, seamanship, builder), pinning up to three on the HUD and in the journal, the marks in the ledger, a small reward and a newspaper line | — | — |
| I | Build and craft audio | Saw, hammer, stone set, placed, refused and deconstructed; the work session's bed; forge, cooperage and still; the UI set; the decoded budget raised to 8 MB in plan 15 and its pipeline test. Every file in `CREDITS.md` | C, E | Listen by ear |
| J | Phase 8 playtest | The §16.3 scenarios, the benches, plans updated, tag 0.8.0 | All | Playtest, sign-off |

### 16.5 Smaller calls assumed (Jared can override)

- **Materials are existing goods.** Lumber, brownstone, hardware (iron, nails and fittings), rope and canvas, kerosene, salt, powder and shot, and grain. Tar and pitch count as rope and canvas, glass as dry goods, and water comes from a well or rain barrel piece. No new goods, so markets and prices don't move.
- **Two levels and four stations.** The MVP builds on the ground and one floor up (§14 cut #3); the workbench, smithy, cooperage and distillery are in, and the sail loft, smokehouse, powder room and cartography table come with Phase 9's content.
- **The starting hideouts are small:** a one-room plank shack with a bunk, a stove, a strongbox and 40 CU of storage pieces (the prefab's capacity), plus a short pier. Building more is the point.
- **Two crafted upgrades:** improved carriages from the smithy and repair stores from the workbench, both from 10 §5 and installed at the slipway. Sails wait for the sail loft.
- **Shipless shipbuilding is T1 only.** When your ship founders and you have a hideout with a slipway, the rescue offers to set you ashore there instead of at the yard; building the T1 takes 30 lumber, 6 hardware, 6 rope and canvas, and three game days solo. The yard's worn hull on credit stays the other way back.
- **Pursuit ends at the anchorage,** not the build bounds: a ship can't reach the build bounds, and the anchorage is where 06 §5.4's pursuers would lose you.
- **Being spotted is light:** a passing ship within sight of a hideout with a low concealment adds a rumor tying your ship to the site, and the cutter's patrol leans toward it for a week. Nothing ever raids it.
- **Salvage has a stock:** each site's ruins give a fixed amount per season (Stockton's quarry 20 brownstone, the logging camp 20 lumber), taken on foot one load at a time as Phase 7's crates were.
- **The audio budget goes to 8 MB** (08 §20.8.3 decision 4's recommendation), and **the island posse's search waits for Phase 9** (decision 2's recommendation).
- **Districts other than Bayfield wait for after the MVP.** 08 §2.2 says "8+"; Phase 8's goal is the base loop, so Ashland, Duluth and Superior come later with their lockups.
- **Runs already under way keep what they have:** a Lumberjack from 0.7.x keeps Stockton and doesn't get Siskiwit; they can claim it like any abandoned site.
- **Claiming Siskiwit** is free (it's abandoned) and happens with the first piece placed there (§2.2).

### 16.6 Decisions for Jared

1. **Do events, letters and Ambitions come in Phase 8?** **Decided 2026-11-16: Ambitions now, events and letters in Phase 9** (Jared). Plan 12 §11 puts the event system's first ten events, letters and Ambitions in Phase 8; the master plan's roadmap puts events in Phase 9, and the MVP definition lists neither.
   - **Ambitions now, events and letters in Phase 9 (recommended):** Ambitions give the Alpha's sandbox its goals (and the builder ones need hideouts), and they're one small piece (H). The event system is mostly content and belongs with Phase 9's full catalog, the Hollister feud and the rivals.
   - **All three now, as plan 12 says:** a second large piece in Phase 8, about ten events across the rumor, paper and letter channels.
   - **None now:** Phase 8 stays hideouts only; Ambitions and events both go to Phase 9.
2. **How much of the builder goes into 0.8.0?** §13 lists the whole build mode; §14's cut list names what can go.
   - **The core with drag and undo, cuts #1–5 left for later (recommended):** placement, rotation, drag, deconstruct, eyedropper, undo, two levels and four stations; blueprints, the paint tool, the third level, the powder room and the lookout's traffic reveal come after the Alpha. This is enough for criterion 1 and keeps Phase 8 to about Phase 7's size.
   - **All of §13 plus blueprints and paint:** the full builder in 0.8.0. More expressive, a longer phase.
   - **The bare minimum:** single placement without drag (cut #6 too). Fastest, but criterion 1 gets hard.

### 16.7 Housekeeping found along the way

- The master plan's Phase 8 row should gain Siskiwit Bay, crafting, the slipway, laying low and (by decision 1) Ambitions once this scope is approved, and its Phase 9 row should keep events.
- Plan 03 §20.5 says Siskiwit's zone is baked "in Phase 8"; plan 07 §14.6.1's second smuggler is already in `data/smuggler.json` and drops in with it (piece D).
- Plan 12 §11's Phase 8 row and the master plan disagree on events (decision 1); whichever way it goes, one of them changes.
- §7.4's open question for plan 10 (is T2 buildable on a slipway?) is answered "not in the MVP" by §16.5.
- Plan 17 wants a tracking issue per phase with the acceptance checklist; §16.3 can become it once approved.
- Phase 7's laptop playtest (08 §20.8.2) is still open, and Phase 8 doesn't depend on it.

---

## Changelog
- v0.5: Phase 8 scope (§16), as proposed 2026-11-16: what Phases 4–7 change, deliverables, exit criteria, ten work pieces, smaller calls and two decisions. Decision 1 taken the same day: Ambitions in Phase 8, events and letters in Phase 9.
- v0.4: Phase 4 piece E (plan 05 §19) built the Stockton Island stash as a fixed prefab: `data/sites.json` with its first site, the `hideouts` save slice of §12, storage transfer for goods and cash, and lying at anchor. Phase 8 replaces the prefab in place and keeps its contents.
- v0.3: Gap review: MVP = 2 sites, mainland build pads, pre-built starting hideouts, MVP starting sites by background, hideouts end pursuit.
- v0.2: Decisions: hideouts completely safe, no gathering (sawpit removed), passive production, shipless shipbuilding (§7.4), seven fixed sites.
- v0.1: Initial hideouts plan: sites (R1-grounded), claiming, functions, grid dimensions and placement types, validity and support rules, piece catalog, storage capacities, materials and gathering, construction time, workstations, recipes, passive production, concealment, build-mode UX, rendering budgets, shared layout editor, data/state, Phase 8 acceptance.
