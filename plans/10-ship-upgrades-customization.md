# 10 — Ship Upgrades & Customization

Status: DRAFT v0.2 (decisions made)
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
  - Cargo is moved over if it fits. If it doesn't fit, it's sold at 80% on the spot or kept in a shipyard lot for one week (TBD).
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
| Weapons (mounts) | Bow swivel | Swivel + 1–2/side | 2 swivels + 3–4/side |
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
| **Shipyard** (Superior, Duluth, Ashland) | Most upgrades, legit hull work | Paid; takes game time (hours to days) while the ship is in the yard (you're on foot in the docks district meanwhile) |
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
5. Shipyard cargo lot (excess cargo is auto-sold on trade-in).

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

---

## Changelog
- v0.2: Decisions: hull variants (MVP+), trade-in rule, T1-only shipless building, dark-tanned sails, starting prices.
- v0.1: Initial ship progression plan: tiers and prices, hull variants, shipyards, trade-in, naming, the slot system, upgrade catalog (hull, rigging, cargo, weapons, instruments, stealth, utility), sources and installation, cosmetics (cosmetic only), repairs, shipless shipbuilding, visuals and budget, data/state, UI, phasing.
