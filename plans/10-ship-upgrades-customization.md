# 10 — Ship Upgrades & Customization

Status: DRAFT v0.3 (decisions made; gap review applied)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan decisions: one ship at a time and always your own (no stealing ships); the invisible crew comes with bigger ships
- [02](02-arcade-sailing.md): tiers, stats, sailing model, sweeps, rowboat
- [05](05-ports-economy-trading.md): prices, balance targets, Standing
- [06](06-fame-wanted-law-lighthouses.md): no disguise; a new hull is a new profile; inspections only at tier ≥ 1
- [07](07-combat-boarding-targets.md): weapons by tier and their upgrades
- [09](09-hideouts-building-crafting.md): sail loft, smithy, drydock, shipless shipbuilding
- [03 §3.5](03-world-scale-chart-travel.md): display scale
- [04](04-water-weather-seasons.md): ice, barometer
Feeds: 12 (progression goals), 13 (shipyard and upgrade UI), 14 (ship models and attachments)

## Purpose

Define ship progression:
- the hull tiers (and variants)
- buying and trading in at shipyards
- the upgrade slot system and upgrade catalog
- where upgrades come from (bought, crafted, installed)
- cosmetic customization, which is cosmetic only
- repairs
- what a hideout slipway can build when you're shipless

---

## 1. Goals

1. **Choices, not a ladder.** Bigger ships haul and fight better. Small ships hide, slip over shallows and accelerate. Upgrades push a ship toward a playstyle (stealth, speed, hauling, fighting).
2. **Visible progress:** most upgrades change the model (topsails, guns, dark sails, an ice-plated bow, a crow's nest).
3. **Feeds both paths:** legit captains want hold and speed. Pirates want guns, hidden compartments and stealth gear.
4. **Ties into hideout crafting:** many upgrades can be crafted, which gives the sail loft and smithy purpose.
5. **Respects the decisions:** one ship, your own, cosmetics don't shed heat.

---

## 2. Hull Tiers

Base stats come from [02 §10](02-arcade-sailing.md). Summary:

| | **T1 Small schooner** | **T2 Schooner** | **T3 Large three-master** |
|---|---|---|---|
| Length / masts | ~65 ft / 2 | ~100 ft / 2–3 | ~140 ft / 3 |
| Crew (invisible) | 0 (solo) | ~4 | ~8 |
| Hold | ~20 CU | ~45 CU | ~90 CU |
| Max speed (game kn) | 8.0 | 9.0 | 10.0 |
| Draft (empty → full) | 1.5 → 2.0 m | 2.5 → 3.2 m | 3.5 → 4.5 m |
| Visibility | Low | Medium | High |
| Upgrade slots | Few | Medium | Many |
| **Price (draft)** | ~$500 | ~$1,600 | ~$4,200 |

Prices are tuned to [05 §5.3](05-ports-economy-trading.md): T2 ≈ 8–12 h legit or 3–5 h piracy; T3 ≈ 20–30 h legit or 8–12 h piracy.

### 2.1 Hull variants (decided: one alternative per tier, MVP+ if time allows)
Grounded in real Great Lakes craft around 1900:

| Tier | Standard | Variant | Trade-off |
|---|---|---|---|
| T1 | Small schooner | **Scow schooner** (flat-bottomed, square-ended; common on the lakes) | Very shallow draft (~1.0 m) and a bigger hold, but slower and worse upwind |
| T2 | Schooner | **Packet schooner** (fine-lined, fast) | +0.7 kn and better pointing; smaller hold (~35 CU) |
| T3 | Three-master | **Lumber schooner** (boxy hold, deck-load capacity) | Hold ~120 CU, slower, deeper |

The MVP ships the standard hull per tier. Variants are added if time allows (cut list).

---

## 3. Shipyards: Buying, Trading In, Naming

- **Shipyards:** **Superior** (best selection, the Superior Steel Barge Works analog), Duluth, Ashland. Smaller ports offer repairs only.
- **One ship at a time (decided):** buying a new hull **trades in** your current ship automatically.
  - Trade-in value = **50%** of the hull's base price × condition, plus **25%** of installed upgrade value.
  - **Transferable items** move to the new ship if it has slots: weapons (if the class allows), instruments, the rowboat upgrade, cosmetic flags. **Hull-bound items** stay with the old ship: sails, hull plating, hold expansions, hidden compartments.
  - Cargo is moved over if it fits. If it doesn't fit, it's **auto-sold at 80%** on the spot (decided 2026-10-22; no shipyard lot).
- **Naming:** you name each new ship. **Renaming is cosmetic** and never sheds heat ([06 §2.3](06-fame-wanted-law-lighthouses.md)).
- **New hull = new ship profile:** reports about your old ship no longer match the new one. That's a side benefit of genuinely replacing the ship, not a disguise.
- **Standing discounts:** high Standing with the shipyard's port lowers prices up to 15%. High Wanted in that region raises prices and adds suspicion (tier 3+: refusal, or a "no questions asked" price at 1.5×).

---

## 4. Upgrade Slots

Each hull has slots per category, which prevents stacking everything onto one ship.

| Category | T1 | T2 | T3 |
|---|---|---|---|
| Hull | 1 | 2 | 2 |
| Rigging & sails | 1 | 2 | 3 |
| Cargo | 1 | 1 | 2 |
| Weapons (mounts) | Bow swivel | Swivel + 1–2/side | Swivel + 3–4/side |
| Weapon mods | 1 | 2 | 3 |
| Instruments | 2 | 3 | 3 |
| Stealth gear | 2 | 1 | 1 |
| Utility | 1 | 2 | 2 |

T1 gets **more stealth slots** than the big ships. It's the sneak's ship by design.

---

## 5. Upgrade Catalog (MVP draft)

Numbers are draft tuning values. ★ = visible on the model.

### 5.1 Hull
| Upgrade | Effect | Source |
|---|---|---|
| Reinforced planking | +25% hull HP, −0.2 kn | Shipyard; drydock (lumber, iron) |
| **Ice-strengthened bow** ★ | −70% ice damage, lower ice drag; enables safer winter sailing | Shipyard; smithy plus drydock (iron) |
| Lightened build | +0.4 kn, faster acceleration, −15% hull HP | Shipyard only |
| Shallow keel (centerboard) | −0.4 m draft, slightly worse pointing | Shipyard only |

### 5.2 Rigging & sails
| Upgrade | Effect | Source |
|---|---|---|
| Quality canvas | +5% speed at all sail levels | Shipyard; **sail loft** (canvas, rope) |
| **Topsails** ★ | +10% speed in light–moderate wind; +visibility; more strain in strong wind | Shipyard; sail loft |
| Storm sails | −40% strain at Reefed and Half; safer in gales | Sail loft |
| **Dark-tanned sails** ★ | −25% night visibility (stealth stat; not a disguise, and it doesn't shed heat) | Sail loft (canvas plus tanning bark/tar) |
| Improved blocks & rigging | Faster sail-level changes (big for solo T1) | Chandlery; shipyard |

### 5.3 Cargo
| Upgrade | Effect | Source |
|---|---|---|
| Expanded hold | +25% CU, −0.2 kn, +draft | Shipyard |
| **Hidden compartments** | 4 / 8 / 12 CU (by tier) **invisible to inspections** (relevant at tier ≥ 1; [06 §5.1](06-fame-wanted-law-lighthouses.md)) | Shady shipwright (**Fame-gated**); drydock (lumber) |
| Cargo hoist / boom ★ | Faster looting and loading transfers ([07 §7.1](07-combat-boarding-targets.md)) | Shipyard; smithy plus workbench |
| Ice room | Fresh fish doesn't spoil | Workbench (lumber, salt) |

### 5.4 Weapons & weapon mods (see [07 §2](07-combat-boarding-targets.md))
| Item | Effect | Source |
|---|---|---|
| Swivel gun ★ | Mount | Shady chandler (Fame-gated); salvage |
| Light / medium cannon ★ | Broadside mounts (T2/T3) | Shady shipwright (Fame-gated); salvage |
| Bored-out barrels | +range | Smithy |
| Improved carriages | −20% reload | Smithy (iron, lumber) |
| Gun sights | +accuracy | Smithy or shipyard |
| **Hidden gun ports** ★ | The ship looks unarmed to targets (surprise; doesn't affect the law's ship profile) | Shady shipwright; drydock |
| Rifle upgrades | Range and accuracy (player weapon) | Chandlery |

### 5.5 Instruments & navigation
| Upgrade | Effect | Source |
|---|---|---|
| Barometer → aneroid barometer | Forecast quality ([04 §5.4](04-water-weather-seasons.md)) | Chandlery |
| Sounding lead → sounding machine | Earlier and longer-range depth warnings | Chandlery |
| Spyglass → marine telescope | Identification range | Chandlery |
| Updated charts | Reveal charted shoals, faster chart voyages (better routing) | Chandlery, harbor master |
| **Crow's nest** ★ | +detection range for spotting ships (encounters and the cutter) | Shipyard; workbench |

### 5.6 Stealth gear
| Upgrade | Effect | Source |
|---|---|---|
| Shuttered lanterns | Toggle the lantern with less "light flare" detection; running dark is safer | Chandlery |
| Muffled blocks | Quieter ship near watchers (night docking, anchoring near lighthouses) | Sail loft |
| Low-profile rig (T1/T2) | −visibility silhouette, −3% speed | Shipyard |

### 5.7 Utility
| Upgrade | Effect | Source |
|---|---|---|
| **Larger rowboat** ★ | More CU in the rowboat; better abandon-ship survival odds ([02 §6.5](02-arcade-sailing.md)) | Shipyard; workbench |
| Better sweeps | +0.5 kn rowing in calm (T1/T2) | Workbench |
| Heavy anchor | Holds in gales (no dragging) | Chandlery |
| Improved pumps | Slower flooding from hull damage | Shipyard; smithy |
| Repair stores | Carry more patch and mend kits (doesn't use cargo CU) | Workbench |
| **Hard-hat diving suit** ★ | **Unlocks deep-wreck salvage** ([11 §6.2](11-exploration-islands-secrets.md)); dive time is longer with a crew to pump | Chandlery or shipyard in Duluth or Superior (**expensive**, ~$600 draft); transferable |

---

## 6. Sources & Installation

| Source | What | Install |
|---|---|---|
| **Shipyard** (Superior, Duluth, Ashland) | Most upgrades, legit hull work | Paid; takes game time (hours to days) while the ship is in the yard (you're on foot in the docks district meanwhile; until that port's district exists, the wait passes as a time skip at the shipyard screen) |
| **Chandlery** | Instruments, gear, rope and canvas items | Instant, or self-installed |
| **Shady shipwright** (Fame-gated, docks district at night) | Hidden compartments, guns, hidden gun ports, "no questions asked" work at high Wanted | Paid premium; a night job |
| **Hideout crafting** ([09 §7](09-hideouts-building-crafting.md)) | Sails (sail loft), carriages and plating (smithy), compartments and hoists (drydock) | **Self-installed at a hideout drydock or slipway** (a construction session, faster with crew) |
| **Salvage** | Guns, fittings from wrecks (plan 11) | Needs a drydock or shipyard |

**Requirements:** some upgrades need Fame (illicit gear) or Standing (legit shipyard premium items, e.g., the lightened build).

---

## 7. Cosmetic Customization (cosmetic only, decided)

- **Hull paint** (colors and trim stripes), **figurehead** (several), **nameboard** (text and style), **flags and pennants** (house flags, personal pennant), **sail color** (white, cream, ochre; *dark-tanned sails* are a separate stealth upgrade in §5.2), lantern style, deck clutter and trophies (a captured nameboard on the cabin wall).
- Done at a shipyard or hideout drydock. Cheap, quick.
- **Never affects heat or the ship profile** ([06 §2.3](06-fame-wanted-law-lighthouses.md)). It's purely for player expression.

---

## 8. Repairs
| Where | What | Cost |
|---|---|---|
| At sea | Patch and mend kits (crafted or bought): partial hull and rigging | Kits |
| Any port chandlery | Rigging repair | Money |
| Shipyard | Full hull and rigging repair | Money plus game time (depends on damage) |
| Hideout drydock/slipway | Full repair | Materials (lumber, tar, canvas, rope) plus a construction session |

---

## 9. Shipless Shipbuilding (from [09 §7.4](09-hideouts-building-crafting.md))
- Only when you **don't own a ship**. Built at a hideout **slipway**.
- **T1 only (decided):** ~40 lumber, 10 iron hardware, 8 rope, 8 canvas, 4 tar (≈ $350 of materials if bought), plus a long solo construction session (~3–4 game days ≈ 3–4 calendar weeks). Shipyards remain the only path to T2 and T3.
- The hull comes bare (no upgrades). Transferable gear stored at that hideout (instruments, guns) can be installed right away.

---

## 10. Visual Representation & Budget
- Upgrades marked ★ are **model attachments** (topsail meshes, gun meshes, plating decal or mesh, crow's nest, larger rowboat, hoist). Attachment points are defined per hull.
- **Triangle budget includes attachments:** player ship ≤ 12k triangles at the closest LOD ([01 §5](01-tech-architecture.md)).
- Cosmetics are mostly **material and texture parameters** (palette-indexed colors in the stylized material) plus a few figurehead meshes. Cheap.

---

## 11. Data & State
**Data:**
- `ships.json` (hull classes; extends [02 §12](02-arcade-sailing.md)): price, slots, attachment points, cosmetic options, trade-in rules.
- `upgrades.json`: id, category, effects (stat modifiers), slot cost, sources, requirements (Fame, Standing, tier), transferable flag, attachment mesh, recipe link.
- `cosmetics.json`, `shipyards.json` (stock, prices, which upgrades each offers).

**WorldState:**
- `player.ship = {classId, name, condition{hull, rigging}, upgrades[], cosmetics{}, weapons[], profileId}`
- `player.shipless` (bool)
- `hideouts[id].storage` holds uninstalled gear.

**Events:** `ShipPurchased {tradeIn}`, `UpgradeInstalled/Removed`, `CosmeticChanged`, `ShipRepaired`, `ShipBuilt`, `ShipLost`.

---

## 12. UI (plan 13 owns the look)
- **Shipyard screen:** a 3D ship preview (rotating), hull comparison (stat bars vs. your current ship), trade-in breakdown, upgrade slots with drag-drop, cost and install time.
- **Upgrade tooltips** show stat deltas and their sailing effect in plain words ("Faster sail changes, which helps most when sailing solo").
- **Cosmetic editor** with live preview.

---

## 13. Phasing
- **Phase 4:** shipyard buying and trading in (T1 → T2), ~10 upgrades (quality canvas, reinforced planking, expanded hold, barometer, sounding, spyglass, improved blocks), repairs.
- **Phase 6:** weapons and weapon mods, hidden compartments, the shady shipwright.
- **Phase 8:** hideout-crafted upgrades, drydock installs, shipless shipbuilding.
- **Phase 9+:** ice bow, T3, hull variants, cosmetic editor polish.

---

## 14. Cut List
1. Hull variants (one hull per tier).
2. Low-profile rig, muffled blocks.
3. Ice room.
4. Cosmetic figureheads (paint and flags only).

*Not cuttable:* three tiers, trade-in, the slot system, weapons and stealth upgrades, hidden compartments, crafted upgrades, cosmetics (at least paint, name and flag), shipless shipbuilding (T1).

---

## 15. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | One **hull variant** per tier (scow, packet, lumber schooner), added MVP+ if time allows. |
| 2026-10-21 | **Trade-in:** 50% of hull value × condition plus 25% of upgrade value; transferable gear moves over. |
| 2026-10-21 | Shipless shipbuilding at a slipway: **T1 only**. |
| 2026-10-21 | **Dark-tanned sails** are a stealth upgrade (lower night visibility; not a disguise). |
| 2026-10-21 | Starting prices: T1 ~$500, T2 ~$1,600, T3 ~$4,200 (tunable). |
| 2026-10-22 | Excess cargo on trade-in is **auto-sold at 80%** (no shipyard lot). |
| 2026-10-22 | T3 has one bow swivel (07). Shipyard waits are a time skip until the port's docks district exists. |

---

## 16. Phase 4 Piece G, First Half: The T2 Hull (2026-11-01)

The T2 schooner is built and sails; buying it (the shipyard), upgrades, repairs and the ship's condition in the save are the other half of piece G, after the port screen ([05 §16.4](05-ports-economy-trading.md)).

| Part | Where | What |
|---|---|---|
| Ship record | `data/ships.json` `ship.t2_schooner` | 30 m (≈100 ft), tier 2, hull speed 9 kn, accelTau 6 s, decelTau 10 s, sail changes 3 s (a crew of four), sweeps 1.1 kn, draft 2.5 → 3.2 m, hull 160 and rigging 130 HP, anchor rode 45 m, visibility medium (conspicuity 0.9), the T1's polar. `cargoCapacity` 90 m³ (twice the T1's 40, i.e. ~45 CU once piece A converts it). Buoyancy uses the S2 values, which were tuned for a ~30 m schooner. |
| Lines | `src/render/ships/schooner-lines.ts` `T2_SCHOONER_LINES` | Half again the T1 in every line: 30 × 7.6 m, 2.6 m draft, more sheer and a taller bulwark, an 11 m bowsprit, a 19.5 m fore and 21 m main with 7.5–8.2 m topmasts. The same two-masted gaff rig and sail plan per level as the T1. Plan 02 §10 allows 2–3 masts; two keeps the three-master for T3. |
| Deck and paint | `schooner-hull.ts` (`DeckLayout`, `buildYawlBoat`) | A forecastle house for the crew forward of the foremast, three hatches between the masts, a long after cabin, and a yawl boat in iron davits across the stern, the way the lake schooners carried theirs. White topsides and a black boot like the T1, with a green rail and houses, so the two read apart beyond their size. |
| Rig scale | `SchoonerLines.rigScale` (1.45) | Spar sections, crosstrees, chainplate spread, furled canvas and the pennant scale with it, so the bigger rig doesn't carry the T1's toothpicks. The T1 (no `rigScale`, no `deck`) builds vertex for vertex as before (checked). |
| In the game | `test-scene.ts`, `main.ts` | A player ship is drawn from its class's lines (`schoonerLines(cls.id)`), with its own waterline for the wake and spray. `?ship=t2` starts the run in the T2 until the shipyard sells one. `/bench/ship/?ship=t2` is its contact sheet. |

**Handling against the T1** (14 kn true, Full, auto-trim; unit tested in `tests/sailing.test.ts`):

| | T1 | T2 |
|---|---|---|
| Close-hauled 45° / beam / broad 120–135° / run | 4.3 / 6.9 / 7.2 / 5.4 kn | 4.9 / 7.7 / 8.1 / 6.1 kn |
| Standstill to 90% of beam-reach speed | 9.2 s | 13.8 s |
| Tack from 50–55° | 8.4–9.0 s, 34–37% speed lost | 9.0–9.7 s, 36–39% lost |

So she is about 12% faster on every point of sail, slower to gather way and to come about, and still inside plan 02 §4's 6–10 s tack. About 2.8k triangles with every sail set (the T1 is 2.6k) and 16 meshes, inside the hero-ship budget (`tests/schooner.test.ts`).

**Needs Jared:** the T2 look (screenshots in the project's `t2-schooner/` folder). Not yet: the shipyard, trade-in, upgrades, repairs and saving the ship's tier and condition (piece G's second half), and no T2 sailing audio changes (she uses the T1's mix).

## 17. Phase 4 Piece G, Second Half: Shipyard, Upgrades and Repairs (2026-11-02)

**Goal** ([05 §16.4](05-ports-economy-trading.md), piece G): buying and trading in at Superior, Ashland and Duluth (§3), about ten upgrades with their effects wired into the controller, repairs at a shipyard and a chandlery and with the chandlery's kits at sea (§8), and the ship's tier, condition and fit in the save.

**Result:** dock at Ashland's city dock with $1,400 in the purse, open the Shipyard tab, and buy the T2 with the T1 in trade at half her price: her model swaps alongside the pier, the hold grows to 45 CU, and she sails on the T2's numbers. Fit quality canvas and the yard keeps her 8 game hours. Run her aground, cast off with a patch kit, and K patches the hull. Screenshots are in the project files (`shipyard/`).

### 17.1 What was built

| Part | Where | What |
|---|---|---|
| Hulls | `data/ships.json`, `data/schemas/ships.ts` | Player classes carry `priceCents` (T1 $500, T2 $1,600, §2) and `slots` by category (§4: T1 1/1/1/2/1, T2 2/2/1/3/2 for hull, rigging, cargo, instruments, utility). The T2's hold is now **45 CU** (piece A converted only the T1; the record still said 90) |
| Upgrades | `data/upgrades.json`, `data/schemas/upgrades.ts` | Ten, from §5 and the §13 list: reinforced planking, improved pumps, quality canvas, storm sails, improved blocks and rigging, expanded hold, aneroid barometer, sounding machine, marine telescope, heavy anchor. Each has a category, a plain-words blurb (§12), a price, where it's fitted (shipyard, chandlery or both), yard hours, whether it moves to a new hull, and its effects |
| Fit | `src/sim/shipyard/fit.ts` | `fitShip(record, rules, upgrades)` folds the effects into the class record (hull speed, hull HP, hold, laden draft, sail-change time) and the hazard rules (safe wind per sail level, anchor holding, leak speed and draft, the depth warning). The controller and hazards run on the fitted numbers with no upgrade code of their own. Instruments outside the sim come back separately: the chart's forecast reach, the spyglass's field of view and the look-her-over range |
| Shipyard | `src/sim/shipyard/shipyard.ts` | Pure functions over `player.ship`, the purse, the hold and the lockers, each all or nothing: `buyHull` with `tradeInQuote` (§3: 50% of her price × condition, weighted by pool size, plus 25% of the gear left aboard; transferable gear moves while the new hull has slots; cargo that won't fit is sold at 80% of what it fetches there, cheapest first, and contract or hot cargo that won't fit stops the sale), `installUpgrade` and `removeUpgrade` (a quarter back), `repairQuote` and `repairShip`, `useKit`. Prices carry the port's spread, as the chandlery's do, and take piece F's Standing discount (up to 15%) when it lands |
| In the game | `src/gameplay/shipyard.ts`, `src/main.ts` | `attachShipyard` keeps the player entity on her class and fit: a hull or an upgrade rebuilds the sailing and hazard classes, resizes the hold (`GameEconomy.setCapacity`), resets buoyancy to the hull's, and keeps damage as a share of each pool. A new hull re-adds the entity, so the view draws her from her class's lines. Yard work is a time skip at the screen (§6), with every world tick run, so markets and the clock move on. An `adjustClass` hook lets piece C's perks ride on each rebuilt class |
| Port screen | `src/ui/port/Shipyard.tsx`, `shipyard-model.ts`, `PortScreen.tsx` | A **Shipyard** tab at the three yards: repairs, the hulls side by side with their fitted numbers and the trade-in sum ("To pay" or "The yard pays you"), what comes across and what's sold off, the upgrades by category with price and yard time, and her condition and slots beside them. The **Chandlery** tab gains rigging repair and the fittings a chandler sells, fitted on the spot |
| At sea | `src/core/input.ts` | **K** (Repair, rebindable) uses a patch kit on the hull or a mend kit on the rigging, whichever she needs most, and says what it did on the HUD |
| Save | `src/sim/world-state.ts` | `player.ship = {classId, hull01, rigging01, upgrades}` in save v6, optional and filled on load with a sound, bare T1, the way piece D added `traffic`, so there's no version bump to collide with the other Phase 4 pieces. Damage now survives a reload; the name stays `player.captain.shipName` |
| Events | `src/modes/context.ts` | `ShipPurchased` (with the trade-in, cargo sold off and gear moved), `UpgradeInstalled`, `UpgradeRemoved`, `ShipRepaired` |
| Dev hook | `src/main.ts` | `__glpShipyard` (dev builds and `?debug`): `ship`, `fit`, `buy`, `install`, `remove`, `repair`, `kit`, `damage`, `grant`, `sailing`. `?ship=t2` now puts the run in a sound, bare T2 |

### 17.2 The upgrades

| Upgrade | Slot | Price | Where | Effect |
|---|---|---|---|---|
| Reinforced planking | Hull | $120 | Yard, 12 h | Hull HP ×1.25, −0.2 kn |
| Improved pumps | Utility | $80 | Yard, 4 h | A leak costs half the speed and draft |
| Quality canvas | Rigging | $90 | Yard, 8 h | Hull speed ×1.05 |
| Storm sails | Rigging | $70 | Yard, 6 h | Reefed and Half carry 4 kn more wind before strain (40 → 44, 27 → 31) |
| Improved blocks and rigging | Rigging | $45 | Yard 3 h, chandlery | Sail changes take 40% less time (T1 4 → 2.4 s) |
| Expanded hold | Cargo | $150 | Yard, 16 h | Hold ×1.25 (T1 25 CU, T2 56), laden draft +0.2 m, −0.2 kn |
| Aneroid barometer | Instruments | $40 | Yard, chandlery | The chart forecasts 24 h ahead instead of 12 |
| Sounding machine | Instruments | $55 | Yard, chandlery | The depth warning at 3 drafts instead of 2 |
| Marine telescope | Instruments | $35 | Yard, chandlery | Spyglass field of view halved (twice the magnification), look her over from 240 m instead of 160 |
| Heavy anchor | Utility | $30 | Yard, chandlery | Anchor holding ×1.5 (30 → 45 kn): holds in a gale |

The four instruments and the anchor move to a new hull; sails, planking, the hold and the pumps stay with the old one. A T1 has room for one rigging upgrade and two of the three instruments, so she can't carry everything; a T2 nearly can.

### 17.3 Repairs

| Where | What | Cost |
|---|---|---|
| Shipyard | Hull and rigging to full | A wrecked hull costs a quarter of the hull's price and a stripped rig a tenth, pro rata, plus a game hour per 8% of hull and 15% of rigging missing |
| Chandlery | Rigging to full | A third over the yard's rigging rate, while you wait |
| At sea | A patch kit (hull) or mend kit (rigging) from the lockers | A fifth of the pool each, up to 80%: the rest is yard work |

### 17.4 Decisions made in the piece

- **Instruments use what the game already shows.** The aneroid lengthens the chart's forecast (the plain barometer now forecasts to 12 h; the 24 h lead needs the aneroid), the sounding machine moves the depth warning, the telescope narrows the spyglass and reaches further to look a ship over. No new HUD instruments.
- **Kits only go to 80%.** Plan 02 §6.1 calls at-sea repairs partial; this makes "partial" a number and keeps the yards worth a visit. The cargo lumber and pitch of plan 02 §6.1 become the chandlery's kits, which piece B already sells.
- **Downgrading is allowed.** Buying the T1 back with a T2 in trade pays out the difference. Up and back down always loses (unit tested), as does fitting and removing an upgrade.
- **Repairing before a trade-in pays a little.** The yard's hull rate is slightly under what the condition adds to a trade-in ($125 against $139 for a wrecked T1 hull), so a careful captain repairs first. It can't loop: every trade-in buys a hull at full price.
- **Upgrades are installed instantly at the screen, with the yard hours passing as a time skip** (§6, decided 2026-10-22). The ship stays at her berth through it.
- **No model attachments yet.** None of the ten is a ★ upgrade, so no meshes change; topsails and the crow's nest wait for a later pass.

### 17.5 Checks

`tests/shipyard.test.ts` (21 tests): the yards and prices, the trade-in sum, buying the T2 at Superior for $1,350 with a sound T1, cargo sold off at 80% and contract cargo blocking the sale, no money loop up and down the hulls or in and out of an upgrade, upgrades changing a minute's beam-reach speed and every effect folded into the class and rules, slots per tier, chandlery fittings, yard and chandlery repairs, kits and their cap, the hull swap in the game (class, hold, buoyancy, model), damage kept through an upgrade with the yard's time passing, K, and `player.ship` through a save and from an older save. The e2e smoke test buys a T2 at Ashland with the mouse, fits quality canvas, repairs her, and patches the hull at sea with K.

### 17.6 Still to do

- Jared's feel of the upgrades (§16.4's "Upgrade feel").
- Piece F's Standing discount into `hullPriceCents` and `upgradePriceCents`, and piece C's perks into `adjustClass`.
- The sailing bench before and after (criterion 8) with the T2 and a full fit.
- Ship naming at purchase (§3) comes with character creation's name field (piece C); the new hull keeps the captain's `shipName` until then.

---

## Changelog
- v0.5: Phase 4 piece G, second half (§17): the shipyard, trade-in, ten upgrades, repairs and kits, `player.ship` in the save.
- v0.4: Phase 4 piece G, first half (§16): the T2 schooner's record, lines, deck layout, yawl boat and handling.
- v0.3: Gap review: auto-sell excess cargo, T3 single swivel, shipyard wait before districts exist.
- v0.2: Decisions: hull variants (MVP+), trade-in rule, T1-only shipless building, dark-tanned sails, starting prices.
- v0.1: Initial ship progression plan: tiers and prices, hull variants, shipyards, trade-in, naming, the slot system, upgrade catalog (hull, rigging, cargo, weapons, instruments, stealth, utility), sources and installation, cosmetics (cosmetic only), repairs, shipless shipbuilding, visuals and budget, data/state, UI, phasing.
