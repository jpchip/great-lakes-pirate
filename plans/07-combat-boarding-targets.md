# 07 — Combat, Boarding & Targets

Status: DRAFT v0.2 (decisions made)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs: master plan decisions (weapons vary by ship and are upgradable; boarding is an intimidate/fight check driven by crew; solo players can only loot surrendered ships; violence is optional and adds heavy heat), [02](02-arcade-sailing.md) (ship model, tiers, damage pools, sinking/rowboat, NPC steam mode), [05](05-ports-economy-trading.md) (manifests, grudges), [06](06-fame-wanted-law-lighthouses.md) (heat, witnesses, the cutter)
Feeds: 10 (weapon upgrades), 11 (wreck salvage), 12 (rival pirates, events), 13 (aim UI)

## Purpose

Define ship-to-ship combat (weapons, aiming, ballistics, damage), the AI's will to fight or surrender, the boarding check, looting, what happens to crews and witnesses, and the roster of targets. All of it stays arcade-simple and cheap ([01 §5](01-tech-architecture.md)).

---

## 1. Goals

1. **Combat is a means, not the point.** The best piracy is a surrender without a shot. Fighting is risky, slow and hot.
2. **Non-lethal is a real path.** Rigging shots, warning shots, intimidation and the whiskey trick let a careful pirate stay off the murder list.
3. **Positioning beats stats.** Wind, angle, shallows, islands and range matter more than raw guns.
4. **Short and readable.** A typical engagement lasts 1–4 real minutes.
5. **Solo stays viable.** T1 can't win slugfests. It wins by stealth, speed, shallows and forcing surrenders.

---

## 2. Weapons

### 2.1 Types (decided set: broadside cannons, swivel gun, small arms)
| Weapon | Mount | Arc | Range (game) | Reload (solo / crewed) | Best against | Lethality |
|---|---|---|---|---|---|---|
| **Swivel gun** | Bow (and stern on T3), on a pivot | ~120° | Short | 6 s / 4 s | Rigging (chain), crew (grape), warning shots | Medium with grape |
| **Broadside cannons** | Fixed, port and starboard | ~30° off the beam | Medium | n/a (T1 has none) / 10–14 s per side | Hull (round shot), rigging (chain) | Low–medium (round shot can kill crew by chance) |
| **Rifle / pistols** | Player (on deck or on foot) | Aimed | Short–medium | 2–3 s | Single crew member, a lamp, a tow line | High (aimed at people) |

**Era note:** cannon on a civilian schooner in 1900 is a tall-tale stretch, justified by Seavey's alleged cannon attack on a fishing vessel. Guns are bought from shady chandlers (Fame-gated) or salvaged, never sold openly.

### 2.2 Ammunition
| Ammo | Effect | Heat profile |
|---|---|---|
| **Round shot** | Hull damage → leaks → sinking | Sinking risk; a small crew-death chance per hit |
| **Chain shot** | Rigging damage → target slows, can't flee | **Non-lethal** (almost) |
| **Grape / canister** (swivel only) | Crew casualties → morale collapse | **Lethal** |
| **Warning shot** (any gun, aimed across the bow) | Morale hit, no damage | None (it's still a piracy act if you then board) |
| *(Incendiary)* | *Fire* | *Cut: too destructive and heavy to simulate* |

Ammo is cargo (powder and shot, per [05](05-ports-economy-trading.md)) and is consumed per shot. Running dry is a real constraint.

### 2.3 By ship tier (from [02 §10](02-arcade-sailing.md); plan 10 owns upgrades)
| Tier | Weapons |
|---|---|
| T1 (solo) | Bow swivel plus small arms |
| T2 | Bow swivel plus 1–2 cannons per side plus small arms |
| T3 | Bow and stern swivels plus 3–4 cannons per side plus small arms |

**Upgrades** (plan 10): bore and range, faster reload (better carriages, crew drill on T2/T3), accuracy (sights), more guns (slots), and a **hidden gun ports** option (the ship looks unarmed to targets, which improves surprise; it doesn't affect the law's ship profile).

---

## 3. Aiming & Firing

- **Aim mode (Tab):** the camera shifts to the chosen side (or the bow for the swivel). The mouse aims within the weapon's arc, and a **ballistic arc preview** shows the impact point (a dotted line plus a splash ring), shortened at night and in fog (you can't see as far).
- **Fire (LMB):** the swivel fires one shot. A broadside fires a **volley** (all guns on that side; T2/T3 crews fire with a slight ripple).
- **Accuracy modifiers:** wave motion and heel ([02 §5.1](02-arcade-sailing.md)) shift the barrel, which means **firing on the downroll** is the skill. Range spread, the *Ex-Navy* perk, target speed and visibility also apply.
- **Small arms:** in aim mode, switch to the rifle (key **1/2/3** cycles swivel, broadside, rifle). Precise but short range. Useful for cutting a tow line, shooting out a lantern, or sniping (lethal).
- **Solo constraint:** on T1 you must **steer and shoot yourself**. Entering aim mode keeps the rudder where it was, so you can't steer while aiming. That's the solo pirate's handicap and part of why T1 avoids fights.

---

## 4. Ballistics & Damage

### 4.1 Projectiles
- **Kinematic arcs** (gravity plus initial velocity), with no physics engine. They're tested against **hull capsules/OBBs** of materialized ships (the same shapes as [02 §6.3](02-arcade-sailing.md)) and the water plane (splash).
- **Hit location** (from the impact point on the ship's local box): **hull** (waterline hits leak more), **rigging** (high hits), **deck** (crew), **rudder/stern** (a rare steering hit), **boiler/engine** (steamers, midship-aft).

### 4.2 Damage pools (extends [02 §6.1](02-arcade-sailing.md))
| Pool | Effect |
|---|---|
| Hull | Leaks → slower, then sinking at 0 (with founder time; the rowboat rule for the player) |
| Rigging | Speed loss (sailing ships) |
| Crew | Casualties → morale loss; deaths are recorded (lethal flag) |
| Steering (rare) | Turn rate reduced or jammed for a while |
| Engine (steamers) | Speed loss → dead in the water. **Boiler explosion** chance at critical damage (catastrophic, lethal) |

### 4.3 Lethality accounting (ties into [06](06-fame-wanted-law-lighthouses.md))
- Every crew **death** emits `CrimeCommitted{kind: killing}` (if witnessed or later reported).
- The combat log and HUD show **casualties** ("2 killed aboard the *Ada Bell*") so the player understands the heat they're creating.
- Non-lethal tools: chain shot, warning shots, intimidation, rifle shots at objects, the whiskey trick (plan 08/12), and stranding ships on shoals.

---

## 5. Morale & Surrender (AI)

### 5.1 Morale meter (per target ship, 0–100)
| Lowers morale | Raises morale |
|---|---|
| Hull, rigging and engine damage | Larger crew, an armed crew (officers' pistols, passenger steamers) |
| Crew casualties (big drop) | The cutter or another friendly vessel nearby |
| **Warning shots** across the bow | Being close to a port or the cutter's known position |
| **Player Fame** (intimidation by reputation; ships surrender faster to an infamous pirate) | Being faster than you in the current wind (steamers in a calm) |
| Being outgunned (weapon comparison) | A determined captain trait (rare, seeded) |
| Being **aground, becalmed, disabled or trapped** | Daylight with other ships in view |
| Night or fog surprise | |

### 5.2 Decisions
- Morale < threshold → **strike colors** (surrender): heave to, crew gathers on deck. The player sees a white flag icon.
- Mid morale → **flee** (most freighters and steamers flee first; steamers often succeed in light wind).
- High morale plus armed → **fight back** (rare: payroll guards, rival pirates, the cutter). Companies never arm their freighters ([05 §8.2](05-ports-economy-trading.md)).

### 5.3 Ship combat AI
A small FSM per ship: `Transit → Alert → Flee | Fight | Surrender`.
- **Fight:** sailing ships seek a broadside angle using the wind; steamers turn to present guns or ram.
- **Flee:** steamers make for the nearest port, the cutter or deep water; sailing ships head off the wind.
- **The cutter** uses its own law behavior ([06 §5.1](06-fame-wanted-law-lighthouses.md)): hail, then warning shot, then disable (chain and rigging), then demand surrender.

---

## 6. Boarding (decided: a check, not action combat)

### 6.1 Getting alongside
- Come alongside at low relative speed (< 2 kn) and press **F** to grapple. A surrendered ship heaves to and makes this easy. A fleeing ship must be disabled or caught.
- **T1 solo rule (decided):** you can only board ships that have **already surrendered** (from intimidation, damage, being stranded, a drunk crew, etc.). The board option is disabled against resisting crews, and the UI says why ("You can't take a resisting crew single-handed").

### 6.2 The boarding check (T2/T3 vs. a resisting crew, or confirming a surrender)
A resolution panel (with brief animated vignettes, not action gameplay):

```
Your strength  = crewSize(tier) × armsFactor (small arms, swivel trained on deck)
               + background perk + Fame intimidation + surprise (night/fog/drunk crew)
Their defense  = crew × armsFactor × moraleFactor × guardBonus (payroll guards only)
```

| Option | Mechanic | Outcome on success | Outcome on failure |
|---|---|---|---|
| **Intimidate** | Chance from the strength/defense ratio, weighted heavily by Fame and morale | Surrender, no casualties | They resist: choose Fight or Withdraw (or they cast off) |
| **Fight** | Higher success chance, but casualties on **both sides** scale with the defense | Ship taken; **deaths likely** (lethal heat) | **Repelled**: damage, possible **player injury**; at bad odds, a chance of **player death** (permadeath). The odds are shown before you commit. |
| **Withdraw** | Always possible | — | — |

- **Already surrendered** ships skip to looting (Intimidate auto-succeeds).
- **Decided:** the small, always-shown death chance in a lost Fight at bad odds stays, under permadeath.
- **Player injury:** a temporary debuff (slower on foot, weaker in the next check) that heals over game days or is treated at a doctor in town.

---

## 7. Looting, Crews & Aftermath

### 7.1 Looting
- A transfer screen like [05](05-ports-economy-trading.md) trade: the target's manifest vs. your hold capacity. **Valuables first** (strongbox, payroll, tobacco, furs), then bulk.
- **Time pressure:** each transfer step takes game time. The longer you stay, the more likely you are to be spotted (other traffic, a keeper's sightline, the cutter's patrol). There's a quick-grab option (valuables only, instant).
- Looted goods are flagged **hot** ([05 §6.1](05-ports-economy-trading.md)), traceable by company markings.

### 7.2 What to do with the ship and crew
| Choice | Heat | Witnesses | Notes |
|---|---|---|---|
| **Let them go** | Piracy only | The crew reports at their next port (delay = voyage time) | Default; your ship profile is reported |
| **Disable and leave** (cut the rigging, dump the coal) | Piracy | Report delayed (they limp to port) | Buys time |
| **Set the crew adrift in the lifeboat and scuttle the ship** | Piracy plus sinking | Report delayed further (they row ashore) | No deaths if conditions are fair; **deaths if weather is bad or it's winter** (a check, shown) |
| **Sink with the crew aboard** | Sinking plus **killing** | None alive, unless someone escapes or there's a wreck investigation | The darkest option; huge heat if ever discovered; Fame notoriety |
| **The whiskey trick** (plan 08/12) | Piracy | The crew wakes up confused hours later | Seavey's *Nellie Johnson* move: get the crew drunk at the dock, then loot (you can't take the ship, per the decision) |

### 7.3 Wrecks
Ships that sink or ground leave **wreck sites** in the world: salvageable cargo (diving and grappling, plan 11), a lore entry, and evidence for wreck investigations ([06 §6.2](06-fame-wanted-law-lighthouses.md)).

---

## 8. Targets

| Target | Typical crew | Armed? | Behavior | Loot | Heat notes |
|---|---|---|---|---|---|
| **Fishing tug** | 3–5 | No | Surrenders easily | Fish, small cash | Low; owned by Hollister Fish & Packing (grudge) |
| **Schooner / schooner-barge** (under tow) | 4–7 | No | Barges can't flee (cut the tow line with the rifle → the barge drifts) | Lumber, coal, grain | Low–medium; a clever two-for-one (the steamer flees, the barge stays) |
| **Wooden steam package freighter** (`freighter1.png`) | 12–18 | No | Flees, then surrenders if disabled | **General cargo: the best loot mix** | Medium |
| **Steel bulk freighter** (`freighter2.png`, shrunk) | 18–25 | Rarely | Flees well (fast steam); hard to stop with T1 | Ore or grain (low value per CU) plus the ship's stores and cash | Medium–high |
| **Whaleback** steamer plus barges | 15–20 (plus barge crews) | No | Low freeboard (easy boarding); towing barges slows it | Ore, grain | Medium; regional icon |
| **Passenger steamer** (`ferry.png`) | 30+ plus passengers | Officers with pistols | Flees; many witnesses | **Valuables, mail, cash** | **Very high**: many witnesses, news spreads. **Decided: a valid target.** |
| **Payroll / mail runs** | Varies | Guards | Rumor-timed | **Cash** | High; big Fame |
| **Rival pirate** | 6–12 | Yes | Fights; may flee to its hideout | Their loot plus a **stash map** | Low Wanted (who's going to report it?) but big Fame |
| **Revenue cutter *Morrill*** | 30+ | Yes (bow gun) | Pursues | Nothing worth it | **Extreme** (attacking the law, 200 heat); almost always flee instead |
| **Lighthouse** | 1–3 keepers | Rarely (shotgun) | On-foot raid ([06 §6.2](06-fame-wanted-law-lighthouses.md)) | Kerosene, supplies, valuables | Medium; wrecking potential |
| **Warehouses & moored ships** | Guards | Some | Docks heists (plan 08) | Varies | By crime type |

### 8.1 Rival pirates: copycats (decided)
- **None at game start.** Rivals emerge **as your Fame grows**: newspapers glamorize your exploits and **copycats** take up piracy, often imitating your methods. The first appears around Fame tier 2 (Known), more at tiers 3–4.
- **Max 2–3 active at once.** When one is defeated, captured by the law or retires, another may appear later if Fame stays high.
- Each is generated from templates: a name and personality, a ship (scaled to your tier), a home hideout in some region, preferred targets and methods, and rumors about them.
- **Interplay:**
  - They raid the same lanes (they **compete for prizes** and steal "your" targets).
  - Their crimes raise **regional alertness**. They may be **blamed on you** if their methods resemble yours, or you on them, which can cut either way.
  - Defeating one gives **Fame** plus their **stash location**.
- Rare encounters, mostly rumor-driven. Plan 12 writes the templates.

### 8.2 Ramming & tow lines
- **Ramming:** possible; both ships take damage by mass and speed. T3 can cripple small craft. Ramming a steamer is suicidal for T1.
- **Tow lines:** a rifle shot or a swivel hit at the tow cable separates a barge from its steamer (the barge drifts, and the steamer usually keeps going).

---

## 9. Player Death & Injury in Combat (permadeath context)
- **Sinking:** the rowboat abandon-ship rule ([02 §6.5](02-arcade-sailing.md)).
- **Boarding fight lost at bad odds:** a death chance, **always shown before you commit**.
- **Rifle duels / on-foot fights:** plan 08/11 (health, wounds, no regeneration in combat; wounds heal over days).
- **No surprise one-shot deaths:** the cutter disables rather than sinks unless you fired on it. Boiler explosions happen to the *target*, but a blast radius near it can damage your hull (keep your distance).

---

## 10. Data & State

**Data:**
- `weapons.json`: type, arc, range, reload solo/crewed, damage by ammo vs. pool, ammo cost.
- `ammo.json`
- `ship_classes.json` (NPC, extends `ships.json`): crew, armament, morale base, flee preference, loot table hooks.
- `surrender_rules.json`, `boarding_rules.json`, `rivals.json`.

**WorldState:**
- `player.ship.weapons[]` (slot, type, upgrade level)
- `player.ammo` (cargo)
- `player.injury`
- `combat.active?` (participants, morale, damage; transient, but saved if mid-combat autosave triggers; prefer not to autosave mid-combat)
- `wrecks[]`
- `rivals[id]` state

**Events:** `WeaponFired`, `ShipHit {pool, damage}`, `CrewCasualties {killed, wounded}`, `MoraleBroken`, `ShipSurrendered`, `ShipFled`, `BoardingAttempted/Succeeded/Repelled`, `ShipLooted`, `CrewSetAdrift`, `ShipScuttled`, `BoilerExploded`, `TowCut`, `PlayerInjured`.

---

## 11. Phase 6 Deliverables & Acceptance

**Build:** the swivel, broadside and rifle with aim mode, arc preview, three ammo types plus warning shots, ballistic hit tests and hit locations, damage pools, casualty accounting, the morale/surrender/flee AI, the boarding check UI, looting with time pressure, aftermath choices, 4 target classes (tug, schooner-barge plus tow, package freighter, bulk freighter), wrecks as world objects.

**Acceptance:**
- A T1 player can force a fishing tug or a stranded schooner to surrender with warning shots and loot it **without killing anyone**.
- A T2 player can take a package freighter by intimidation at medium Fame, and by fighting at the cost of casualties and heat.
- A steamer in a calm outruns T1. In a fresh breeze on a reach, T1 can catch a wooden steamer.
- Every death shows up in the combat log and produces the expected heat (if witnessed).
- An engagement lasts 1–4 real minutes typical; GPU and CPU stay within budget with 4 ships firing.

---

## 12. Cut List
1. Stern swivel (bow only).
2. Steering and boiler hit locations (hull, rigging, crew only).
3. Ramming damage model (block or bounce only).
4. Rival-pirate three-way prize contests and blame-shifting.
5. Player injury (injury becomes "repelled plus damage").

---

## 13. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Aim mode **freezes steering on T1** (solo handicap). |
| 2026-10-21 | A small, always-shown chance of player death in boarding fights at bad odds. |
| 2026-10-21 | Steamer **boiler explosions** at critical damage are kept. |
| 2026-10-21 | **Passenger steamers are valid targets** (very high heat). |
| 2026-10-21 | **No rivals at start;** copycat rival pirates emerge as Fame grows, max 2–3 active. |
| 2026-10-21 | Companies never arm their ships (from 05). |

---

## Changelog
- v0.2: Decisions: steering freeze, boarding death chance, boiler explosions, passenger steamers targetable, copycat rivals (none at start, max 2–3); removed company guards and decoys.
- v0.1: Initial combat plan: weapons and ammo, tier loadouts, aim mode and solo handicap, ballistics, hit locations, damage pools, lethality accounting, morale/surrender/flee AI, the boarding check, looting with time pressure, aftermath choices, target roster, rival pirates, ramming and tow lines, death and injury rules, data/state, Phase 6 acceptance.
