# 09 — Hideouts, Grid Building & Crafting

Status: DRAFT v0.3 (all decisions made; gap review applied)
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

## Changelog
- v0.3: Gap review: MVP = 2 sites, mainland build pads, pre-built starting hideouts, MVP starting sites by background, hideouts end pursuit.
- v0.2: Decisions: hideouts completely safe, no gathering (sawpit removed), passive production, shipless shipbuilding (§7.4), seven fixed sites.
- v0.1: Initial hideouts plan: sites (R1-grounded), claiming, functions, grid dimensions and placement types, validity and support rules, piece catalog, storage capacities, materials and gathering, construction time, workstations, recipes, passive production, concealment, build-mode UX, rendering budgets, shared layout editor, data/state, Phase 8 acceptance.
