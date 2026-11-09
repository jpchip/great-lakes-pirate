# 07 — Combat, Boarding & Targets

Status: DRAFT v0.4 (decisions made; gap review applied; Phase 6 scope proposed in §14)
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
| **Swivel gun** | Bow, on a pivot | ~120° | Short | 6 s / 4 s | Rigging (chain), crew (grape), warning shots | Medium with grape |
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
| T3 | Bow swivel plus 3–4 cannons per side plus small arms |

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
1. Steering and boiler hit locations (hull, rigging, crew only).
2. Ramming damage model (block or bounce only).
3. Rival-pirate three-way prize contests and blame-shifting.
4. Player injury (injury becomes "repelled plus damage").

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
| 2026-10-22 | T3 carries **one bow swivel** plus its broadside (matches 02 §10); no stern swivel. |

---

## 14. Phase 6 Scope: Piracy & Combat (2026-11-08)

Phase 6 is the **Piracy & Combat** build (version 0.6.0), with one goal from the [00 §7](00-master-plan.md) roadmap: **"at-sea crime."** Phase 4 put ships with manifests on every lane and let you look them over; Phase 5 built the law that hears about what you do to them. Today you can only watch the *Ada Bell* go by. Phase 6 lets you take her: a warning shot across her bow off Sand Island at dusk, her captain heaving to under your swivel, her furs and tobacco in your hold, flagged hot with the company's marks, and her crew rowing for Bayfield with your ship's description. Sell it to a fence before the papers print it.

The scope comes from §11 above, the Phase 6 rows in plans 10 §13 (weapons and weapon mods, the shady shipwright; the hidden compartment already shipped in 0.5.0), 13 (aim HUD, target info, boarding panel, looting, aftermath), 15 (combat sounds, the boiler explosion, the chase layer) and 05 §6.2 (fences), plus what Phases 3–5 left for it (03 §25's "close and look until Phase 6", 05 §16.5's dev command for hot goods, 06 §14.5's cutter that only shoots rigging, 06 §14.3 criterion 3's stand-in for sinking).

This section is the phase's scope, approved by Jared on 2026-11-08 with the calls in §14.6. Its exit criteria (§14.3) are the phase's acceptance checklist, and the playtest piece checks them.

### 14.1 What Phases 3–5 change or put at risk

| Finding | Source | Effect on Phase 6 |
|---|---|---|
| **NPC hulls aren't solid.** The player can sail through any ship; collisions were left for combat | 03 §25.4, `src/sim/arena/steering.ts` | Getting alongside (§6.1) needs contact. Piece C adds block-and-bounce collisions (cut list #2 stays: no ramming damage model). |
| **The cutter's fire is a dice roll, not a shot.** `law-at-sea.ts` rolls a hit and calls `damageRigging`; the splash is drawn where the roll says | `src/gameplay/law-at-sea.ts` | Piece F moves her bow gun onto piece A's ballistics, so her shots and yours obey the same rules, and she can fire round shot at your hull once you've fired on her (§9). |
| **Foundering is a HUD word.** At hull 0 the player's ship shows "Foundering" and nothing else happens; abandon ship in the rowboat (02 §6.5) was never built | `src/sim/sailing/hazards.ts`, `src/modes/sailing.ts` | Once the cutter and armed targets can hole you, sinking must mean something. Decision 2 (§14.6). |
| **Fences live in docks districts at night**, which are Phase 7. The only buyer of hot goods is the island smuggler's *Whippoorwill* | 05 §6.2, 08 | Phase 6 makes far more hot goods than she can take in a week. Decision 1 (§14.6). |
| **The shady shipwright is a docks-district night job** too, and guns are never sold openly | 10 §6, §2.1 above | Same answer as the fences (decision 1): a night-only stand-in on the port screen until Phase 7. |
| Traffic ships already carry a class, a crew count and a manifest with an owning company, and the arena draws up to five of them | `src/sim/traffic/cargo.ts`, `src/sim/arena/encounter.ts` | Targets need no new traffic system: piece C adds combat stats to the classes that sail today. The package steamer's crew is 28 in code and 12–18 here; piece C settles one number. |
| **Hot goods come only from the smuggler or `__glpContraband.makeHot`** | 05 §16.5, CHANGELOG 0.5.0 | Looting (piece D) makes hot goods for real, marked with the owner company, and the dev command stays dev-only. |
| The law pipeline takes any crime from `crimes.json` with witnesses, reports that travel and heat spread; contract theft stands in as the crime that spreads | 06 §14.8, `data/crimes.json` | Piracy, firing on a ship, sinking and killing slot into the same pipeline (piece F). Sinking becomes the crime that spreads. |
| The detection module already scores observers (keepers, crews, the cutter's lookout) by light, moon, weather and silhouette | 06 §7.1, `src/gameplay/detection.ts` | Who witnessed a robbery uses it unchanged. Gunfire adds a loud event that wakes observers in range (piece F). |
| Plan 04's "snow and the aurora are Phase 6" | 04 §8, §11 | A leftover numbering; they belong with winter (Phase 9). Not in this scope. |

### 14.2 What Phase 6 delivers

| Area | Deliverable | Plan |
|---|---|---|
| Combat core | `weapons.json`, `ammo.json`; kinematic projectiles tested against hull boxes and the water; hit locations (hull, rigging, deck); damage pools for NPC ships (hull, rigging, crew, engine for steamers); casualty accounting with `CrewCasualties` and the lethal flag; NPC ships that founder and sink; powder and shot as cargo, used per shot | §2, §4 |
| Aiming and firing | Aim mode (Tab) with the arc preview, shortened at night and in fog; 1/2/3 cycles swivel, broadside and rifle; the T1 rudder freezes while aiming; firing on the downroll; muzzle smoke, splashes and splinters | §3 |
| Targets and their will | Combat stats for the four target classes (fish tug, schooner-barge under tow, package steamer, ore freighter); the morale meter; `Transit → Alert → Flee / Fight / Surrender`; striking colors; steamers that outrun the T1 in a calm; tow lines that part to a rifle or swivel hit; collisions that block | §5, §8, §8.2 |
| Boarding | F to grapple under 2 kn; the T1 boards only a ship that's already struck; the boarding panel (Intimidate, Fight, Withdraw) with the odds and the death chance shown before you commit | §6 |
| Looting and aftermath | The transfer screen against your hold, valuables first, a quick grab, time passing while you work; goods flagged hot with the owner's marks; let them go, disable and leave, set them adrift and scuttle (with the weather check shown), or sink her with the crew aboard | §7.1, §7.2 |
| Wrecks | A sunk or scuttled ship leaves a wreck site (a mast above water or a debris field, a chart mark and a lore line); salvage waits for plan 11 | §7.3 |
| The law answers | `piracy`, `firing_on_a_ship`, `sinking`, `killing` and `firing_on_the_law` in `crimes.json`; the crew as witnesses reporting at their next port, delayed by what you did to them; gunfire heard; sinking spreads; the *Morrill* on real ballistics, shooting to sink only once fired on; company grudges and Standing | §4.3, §7.2, 06 |
| Selling it | Fences and the shady shipwright by decision 1; Fame gates; the informant risk at high Wanted | 05 §6.2, 10 §5.4, §6 |
| Weapons for sale | The bow swivel, light cannon for the T2's broadside, the rifle, weapon mods (one slot on the T1, two on the T2) and hidden gun ports, from the shady shipwright; powder and shot from the chandlery | 10 §5.4 |
| Your ship sinking | By decision 2 | 02 §6.5 |
| Newspapers | Piracy headlines from the new events (the ship's name, what was taken, the dead if any), Fame from them as in Phase 5 | 06 §9 |
| UI | The aim HUD, the target card (her name, class, crew, morale, damage, colors), the boarding panel, the looting screen, the aftermath choice, the combat log with casualties | 13 |
| Audio | Swivel, cannon and rifle fire, the round's flight and its landing (water, wood, canvas), the boiler explosion, the grapple, a chase layer for the music | 15 |
| Saves | `weapons`, `ammo`, `wrecks` and the traffic slice's robbed and sunk ships in save v8, with a v7 migration | 16 |

**Out of scope:** rival pirates (§8.1, decision 3); passenger steamers, payroll runs and the whaleback (more target classes after the four above); the T3; on foot, docks districts, the whiskey trick and the walkable fence's back room (Phase 7); salvage diving, wreck investigations and wrecking (Phases 9 and plan 11); incendiaries; and §12's cut list as it stands (steering and boiler hit locations, ramming damage, rival three-way contests, player injury), except that the **boiler explosion stays** (decided 2026-10-21) as a rare event at critical engine damage, without a hit location of its own.

### 14.3 Exit criteria (proposed)

Phase 6 is done when these pass on the baseline laptop and Jared signs off the playtest. The first five are §11's acceptance; the rest come from Phases 3–5 and plan 17's definition of done.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | A T1 player can force a fishing tug or a stranded schooner-barge to strike with warning shots and loot her **without killing anyone** | An e2e test through dev hooks; a playtest route off Sand Island |
| 2 | A T2 player can take a package steamer by intimidation at medium Fame, and by fighting at the cost of casualties and heat | A unit test on the boarding odds by Fame; a playtest |
| 3 | A steamer in a calm outruns the T1; in a fresh breeze on a reach, the T1 catches a wooden steamer | The sailing bench against `ships.json` speeds; an arena run |
| 4 | Every death shows in the combat log and produces the expected heat if witnessed | A pipeline unit test per aftermath choice |
| 5 | An engagement typically lasts 1–4 real minutes; frame and tick budgets hold with four ships firing | Timed playtest runs; `/bench/stream/` with a forced four-ship fight |
| 6 | Looted goods are hot with the owner's marks, sell to a fence, and are refused or reported by an honest merchant as in Phase 5 | Unit tests; a playtest from robbery to sale |
| 7 | Letting a crew go means a report at their next port; setting them adrift or disabling the ship delays it; sinking her with all hands leaves no report unless someone else saw | A unit test on report ETAs per choice |
| 8 | Sinking spreads to the neighboring regions; firing on the *Morrill* puts the region at Most Wanted and she shoots to sink | Unit tests; an arena run with `?encounter=cutter` |
| 9 | Your own ship sinking does what decision 2 says, and closing the tab while she founders lands you back in it (the danger snapshot) | An e2e test |
| 10 | No surprise one-shot deaths: the death chance is shown before any Fight, and the cutter never sinks you unless you fired on her | Unit tests |
| 11 | A 0.5.0 save loads into 0.6.0 unarmed with no ammo at its saved place, and the save stays under the plan 16 budget | `tests/save-migrations.test.ts` with a v7 fixture |
| 12 | Piracy feels like a choice: a careful pirate can stay off the murder list, and you can see why a robbery went wrong | Jared decides |
| 13 | Plans 02, 05, 07, 10, 13, 15 and 16 record what was built, CI is green, and 0.6.0 is tagged | The release PR |

### 14.4 Work pieces

Eight pieces, each sized to be one thread. Three can start at once (A, C and E). The playtest (H) closes the phase.

| Stage | Pieces |
|---|---|
| 1, start now | A combat core, C targets and morale, E fences and the gun trade |
| 2 | B aiming and firing (after A), D boarding, looting and aftermath (after A, C) |
| 3 | F the law and the world answer (after A, D), G combat audio (after B, D) |
| 4 | H playtest |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | Combat core | `weapons.json` and `ammo.json` with schemas (§2: arc, range, reload solo and crewed, damage by ammo against each pool). Projectiles as kinematic arcs from a muzzle velocity and gravity, tested against the hull boxes of 02 §6.3 and the water; hit location from the impact point. NPC damage pools (hull, rigging, crew, engine) and their effects: leaks slow her and sink her at 0, rigging slows a sailing ship, engine damage stops a steamer, crew casualties with killed and wounded, and the rare boiler explosion. `WeaponFired`, `ShipHit`, `CrewCasualties`, `BoilerExploded`. Powder and shot in `goods.json`, used per shot. `player.ship.weapons[]` and ammo in save v8 with the v7 migration. A dev panel and `__glpCombat` to arm the ship, fire at a bearing and damage a target | — | — |
| B | Aiming and firing | Tab into aim mode with the camera on the chosen side or the bow; the dotted arc and splash ring, shortened by light and fog; 1/2/3 to cycle; LMB fires one swivel shot or a rippled broadside; the T1's rudder holds while aiming; heel and roll move the barrel so firing on the downroll is the skill; reload timers. Muzzle smoke, splashes, splinters and torn canvas. The aim HUD and the target card | A | Aim feel |
| C | Targets and morale | Combat stats per class in `ships.json` (crew, armament, base morale, flee preference, loot hooks) for the fish tug, schooner-barge, package steamer and ore freighter. The morale meter (§5.1) with Fame, warning shots, damage, casualties, being outgunned, aground or becalmed, night and fog surprise, the cutter or a port near. The `Transit → Alert → Flee / Fight / Surrender` FSM in zones and arenas, built on the steering of `src/sim/arena/steering.ts`; a struck ship heaves to with a white flag. Tow lines: a barge behind her steamer, parted by a hit on the cable. Collisions that block and bounce for every hull. Pure sim first, so it unit-tests and can start before A's damage lands | — (A's damage interface) | — |
| D | Boarding, looting and aftermath | F to grapple alongside under 2 kn. The T1 solo rule with its reason shown. The boarding panel (§6.2) with strength against defense, Intimidate, Fight, Withdraw, the odds and the death chance shown first; a lost Fight is repelled with damage, or death at bad odds (permadeath, through Phase 5's end screen). The looting screen on the port screen's market pattern: her manifest against your hold, valuables first, a quick grab, game time per step. Hot goods with the owning company's marks. The four aftermath choices with the weather check for the boat. `ShipSurrendered`, `BoardingAttempted/Succeeded/Repelled`, `ShipLooted`, `CrewSetAdrift`, `ShipScuttled`. Robbed and sunk ships recorded in the traffic slice so the timetable doesn't bring them back that week | A, C | Panel look |
| E | Fences and the gun trade | Fences by decision 1 (the back room on the port screen at night; `smuggler.json` made to hold more than one boat for the Siskiwit Bay smuggler, §14.6.1), with weekly cash, preferences (Bayfield wants fish and furs, Duluth takes anything), rates by Fame, trust and heat, and the informant risk at tier 2+ on Phase 5's rules. The shady shipwright in the same place: the bow swivel, light cannon (T2 broadside), the rifle, weapon mods and hidden gun ports, Fame-gated as 10 §6 says; installs on 10's slot system. Powder and shot at the chandlery. Weapons move with you on a trade-in as 10 §3 says | — (A's `weapons.json` for prices; stubbed until it lands) | Prices |
| F | The law and the world answer | The new crimes in `crimes.json` and their heat. The robbed crew as witnesses, their report delayed by the aftermath choice; gunfire as a loud event that alerts observers in range; passengers none yet. Sinking as the crime that spreads, retiring contract theft as the stand-in. The *Morrill* on A's ballistics; fired on, she goes to Most Wanted and round shot. Your ship sinking by decision 2. Wrecks: a world object, a chart mark and a ledger line. Company grudges and Standing for robbing their ships. Papers: piracy headlines and Fame | A, D | — |
| G | Combat audio | Swivel, cannon and rifle, the round in flight, landing in water, wood or canvas, the boiler, the grapple and the boarding vignette, the crew's shouts when she strikes, and a chase layer for the music (plan 15 §11). Every file in `CREDITS.md` | B, D | Listen by ear |
| H | Phase 6 playtest | The §14.3 scenarios, the benches, plans updated, tag 0.6.0 | All | Playtest, sign-off |

### 14.5 Smaller calls assumed (Jared can override)

- **The crew is implied by the tier.** The T1 is you alone; the T2 carries six hands for the boarding check and the broadside's reload. Hiring and paying a crew waits for plan 12.
- **The T1 isn't armed at the start.** A new run has small arms only; the bow swivel is the first purchase at the shady shipwright, with no Fame gate, and cannon need Known (Fame tier 2). Backgrounds whose perks said "from phase 6" (the Ex-Navy's accuracy) start working.
- **Ammo is cargo** in the hold's capacity units, as §2.2 says; running dry is the limit.
- **Every target class is unarmed** in Phase 6 (companies never arm their ships, 05 §8.2), so the only ship that shoots back is the *Morrill*. Fight in §5.2 means a steamer turning to ram, which collisions turn into a shove.
- **Combat happens wherever ships are drawn**: in the coastal zones and in open-water arenas. The chart never resolves a fight abstractly; engaging on the chart drops you into an arena as today.
- **No autosave mid-fight** (§10); the danger snapshot from Phase 5 covers closing the tab.
- **Killing is counted, not shown.** The combat log names the dead by number and the ship; no bodies on deck.

### 14.6 Decisions for Jared

1. **Where do you sell stolen goods before the docks districts exist?** **Decided 2026-11-08: a back-room tab on the port screen at night, and a second smuggler ship in Siskiwit Bay once that zone is built** (Jared). Plan 05 puts fences in saloon back rooms at night, which is Phase 7's on-foot district.
   - **A back-room tab on the port screen at night (recommended):** after dark, Bayfield's saloon has a back room with a fence and the shady shipwright, Duluth's opens at Known Fame. Phase 7 replaces the tab with the walkable room and keeps the same fence data.
   - **More smugglers at sea:** add a second smuggler boat near Duluth that fences like the *Whippoorwill*. No port-screen stand-in to throw away later, but fewer places to sell and no shipwright.
   - **Only the *Whippoorwill* until Phase 7:** raise her weekly cash. Least work; the money loop of piracy is thin.
2. **What happens when your own ship sinks?** **Decided 2026-11-08: a simple abandon ship.** Today nothing does.
   - **A simple abandon ship (recommended):** press F while foundering to take to the boat; the ship and cargo are lost, and you're landed at the nearest port by a passing vessel, which may know your face (an extra report). You keep your stash money and buy a new hull at the shipyard. The rowable rowboat comes with going ashore in Phase 7.
   - **The full rowboat now (02 §6.5):** row yourself to an island or town in the zone, at 2–3 kn, swamped in a sea. Closer to the plan, a good deal more work, and the shipless life has little to do until Phase 7.
   - **Sinking ends the run:** the end screen, as for the gallows. Harsh for a storm loss.
3. **Do rival pirates come in Phase 6?** **Decided 2026-11-08: later, with events.** The roadmap row leaves them out; §8.1 has copycats appear from Known Fame.
   - **Later, with events (recommended):** Phase 6 is the four target classes and the law. Rivals arrive with plan 12's event templates in Phase 9, when the papers are rich enough to inspire copycats.
   - **One copycat in Phase 6:** a single armed schooner that appears at Known, raids your lanes and fights back, worth Fame and a stash map. The first ship other than the cutter that shoots at you.

### 14.6.1 The Siskiwit Bay smuggler (Jared, 2026-11-08)

A second smuggler ship lies in Siskiwit Bay, built with the Siskiwit Bay zone (03 §4's `zone.siskiwit`, which isn't built yet; today the bay is passed through on the chart). She works like the *Whippoorwill* (05 §23): she lies to her anchor after dark, sells contraband, and fences hot goods out of her own week's cash and her own trust in you, from `data/smuggler.json` as a second entry. She gives the western end of the south shore a buyer, so a pirate working the Duluth lanes doesn't have to run to the Apostles to sell. Piece E makes the smuggler data hold more than one boat so she drops in when the zone does; if the zone lands in a later phase (with the Siskiwit camp hideout, Phase 8), she ships with it.

### 14.7 Housekeeping found along the way

- The 0.5.0 tag is still Jared's to push from the release merge (PR #88). Two Phase 5 calls are open in 06 §14.14.3: whether the end screen looks right, and where the smuggler anchors relative to Raspberry light.
- Plan 17 wants a tracking issue per phase with the acceptance checklist; §14.3 can become it once approved.
- Plan 04 still calls snow and the aurora Phase 6 (§14.1); its next edit should say Phase 9.

### 14.10 Piece E built: fences and the gun trade (2026-11-08)

**Result:** dock at Bayfield after dark with stolen furs aboard and the port screen has a **Back room** tab. Nils Okerlund buys the furs at 40% of value out of his $250 for the week, no questions asked; the shipwright beside him mounts a bow swivel for $75 (before the port's spread) while four game hours pass. Screenshots are in the project files (`back-room/`).

| Part | Where | What |
|---|---|---|
| Fences | `data/fences.json`, `data/schemas/fences.ts`, `src/sim/economy/fence.ts` | Two fences by decision 1. Bayfield (Unknown and up, $250 a week, wants fresh fish, salt fish and furs, other goods at 75% of his rate) and Duluth (Known, $800 a week, takes anything). Rate = 40% + 3% a Fame tier + up to 10–12% trust + up to 12% as heat cools, capped at 70% (05 §6.2). Open while the sun is 6° below the horizon; cash comes back each night (a game day is a week). Clean goods and contract cargo refused |
| Informants | `src/gameplay/law.ts`, `data/crimes.json` | `FenceDealt` rolls Phase 5's receiver odds by the port region's tier (none below 2), once a night's business per fence; a hit commits `crime.fence_deal` (20 heat) with the fence as the informant witness. Nobody else sees a deal made indoors |
| The back room | `src/gameplay/back-room.ts`, `src/ui/port/BackRoom.tsx`, `back-room-model.ts` | A port-screen tab after the saloon, only when open to you; by day the saloon tab says a back room opens after dark (silent at Duluth to a captain who isn't Known). Phase 7's walkable room keeps the same fence data |
| Guns for sale | `data/guns.json`, `data/schemas/guns.ts`, `src/sim/shipyard/guns.ts` | The shipwright sells guns whole, and each one mounts straight into `player.ship.weapons`, where piece A fires it. Bow swivel $75 (Fame 0, T1+). Light cannon, one a side, $240 (Known, T2+). Each mount goes through piece A's `fitRefusal` (`fame`, `hull`, `wrongMount`, `noRoom`, then `noMoney`), so a class takes only the guns its mounts hold in `weapons.json`. The rifle is not for sale: every captain carries one in hand, and a second would always be refused |
| Gun work | `data/upgrades.json`, `src/sim/shipyard/fit.ts`, `src/sim/shipyard/shipyard.ts` | Four mods with the source `backRoom`, in the `weaponMods` slot (T1 1, T2 2): gun sights (spread ×0.75), bored-out barrels (range ×1.2, Rumored), improved carriages (reload ×0.8, Rumored), and hidden gun ports ($110, Known, looks unarmed, stays with the hull). Each mod needs a gun aboard (`gunAboard`). `fitRefusal` adds `fame` and `noGun`; the trade-in moves a gun to a new hull that has its mount, and the mods that need one go with it |
| Mods for piece A | `src/sim/shipyard/fit.ts` | `gunModsOf(upgrades)` folds the mods into a `GunMods` (range, reload and spread multipliers, and `looksUnarmed`). Piece A's `weapons.json` keeps the ballistics; the shop prices in `guns.json` are separate, and the `guide price` in `weapons.json` is not used for sales |
| Powder and shot | `src/ui/port/PortScreen.tsx`, `src/gameplay/port-law.ts` | The chandlery sells `good.powder_shot` into the hold at the market's price. It is a restricted good: from Wanted tier 2 in the port's region neither the chandler nor the market will sell it to you |
| More smugglers | `data/smuggler.json`, `src/sim/economy/smuggler.ts`, `src/gameplay/smuggler.ts` | The file holds a list; the island smuggler stays first. The _Gannet_ (a fish tug, $400 a week, untaxed whiskey, known to the Lumberjack) lies off the old logging dock in Siskiwit Bay in `region.south_shore_west`. She stays out of the world until `zone.siskiwit` is in `zones.json`, then appears with no more code. `attachSmugglers` drives every boat as one control; each has her own cash, stock, trust and known anchorage |
| Save | `src/sim/world-state.ts` | `contraband.boats`, `contraband.knownBoats` and `contraband.fences`, optional and filled as used, so a 0.5.0 save loads with no version bump; guns live in `player.ship.weapons` (piece A's save field) and the mods in `player.ship.upgrades` |

**Checks:** `tests/back-room.test.ts` (20 tests): the fences' gates, rates, cash and refusals; the tab by night and day, at Duluth by Fame; a sale raising `FenceDealt`; the informant at tier 4 and not below 2; the shipwright's gates, mounts and trade-ins, with guns landing in `ship.weapons`; powder refused at tier 2; two smugglers with their own state through a save. The full suite, lint and typecheck pass.

**Decided by Jared:** the shop prices in `data/guns.json` ($75 swivel, $240 cannon pair) stand, and the T2 carries two cannon pairs, two a side (07 §2.3). The _Gannet_'s anchorage (46.874° N, 91.13° W) still needs a depth check when the Siskiwit zone is baked.
### 14.8 Piece A as built: the combat core (2026-11-08)

- **Data.** `data/weapons.json` has the bow swivel, the light cannon and the rifle (kind, arc, reach, muzzle speed, reload alone and crewed, scatter, powder charges a shot, the ammo each fires, damage by ammo against hull, rigging, crew and engine, a guide price for piece E) and the guns each player hull mounts (the T1 a bow swivel; the T2 a bow swivel and two cannon a side; both small arms). `data/ammo.json` has round, chain, grape, the warning shot (round shot laid to miss) and the rifle ball, with each one's reach, scatter, share killed of the hands it hits, stray splinter deaths, and the non-lethal flag; and the powder: `good.powder_shot`, 10 charges a keg (CU). The swivel burns 1 charge a shot, a cannon 2. Ranges and speeds are in scene meters and real seconds, the frame ships are steered in: the swivel reaches 320 m, the cannon 520 m, grape 65% of the swivel's.
- **Shot.** `sim/combat/ballistics.ts` flies kinematic arcs (gravity, no drag) and finds the elevation for a range and the lead on a moving ship. `sim/combat/hull.ts` gives every class a hull box to her rail, a deck band above it, and a narrower box aloft for masts or a funnel, sized from ships.json; a hit is at the waterline (holes her half again as badly), the hull, the deck (crew), aloft (rigging), or, on a steamer, midships to aft in her engine spaces. `sim/combat/shots.ts` moves every ball each tick and tests the stretch against every ship's boxes and the sea; a ship's own shot never strikes her. The player's ship is a target too (hull and rigging; no crew on a T1), so piece F's *Morrill* can fire real rounds through `fireFrom`.
- **Damage** (`sim/combat/damage.ts`). An NPC's pools start full the first time she's touched: hull and rigging from ships.json, the engine at 35% of a steamer's hull points, the crew from the traffic's manifest numbers (piece C may move them into ships.json). Leaks take up to 60% of her speed, a bare rig leaves a sailing ship a quarter of hers, and an engine under 12% stops a steamer. Under 25% engine, each further engine hit has an 8% chance of bursting her boiler: her engine gone, 45% of her hull points, 30% of her crew killed, and up to 30 hull points off any ship within 60 m, yours included. At hull 0 she founders for 30 real seconds, settling and listing, then goes under. Casualties are counted killed and wounded.
- **In play** (`gameplay/combat.ts`). Runs in the sailing tick after the law. A zone ship that's hit comes off her timetable and holds her course at the way she has left (piece C's FSM takes over from here); in an arena her helm's service speed is scaled. Events: `WeaponFired`, `ShotLanded` (water or ship), `ShipHit` (pool, location, points), `CrewCasualties` (killed, wounded, the lethal flag, shot or boiler), `BoilerExploded`, `ShipFoundering` and `ShipSunk`. Balls in the air are drawn as small dark spheres; piece B adds smoke, splashes and splinters.
- **Your guns.** `player.ship.weapons[]` (gun and mount) and `player.ammo` (loose charges) in save v8; v7 migrates with small arms only and no loose powder. Firing opens a keg from the hold as the loose charges run out, clean kegs first. Reload is solo on the T1, crewed on the T2. The Ex-Navy's Gunnery now works: 30% less scatter and the swivel loads a fifth faster. A new hull keeps the guns it has a mount for (piece E prices the move). Laying a gun picks the armed mount whose arc holds the bearing, refuses with a reason (unarmed, wrong ammo, out of arc, reloading, no powder, out of range), and with a target leads her and lays on her rail.
- **Dev.** The overlay's Combat folder mounts every gun the hull carries, stows powder, fires at the nearest ship or a bearing, knocks a pool down or bursts a boiler, and reads her damage. `__glpCombat` does the same from the console (`arm`, `armFully`, `powder`, `fire`, `fireAt`, `damage`, `explode`, `ships`).
- **Calls made here.** The rifle counts as the small arms every captain carries (§14.5), so a new run and a migrated 0.5.0 run both have it and no ship's guns; criterion 11's "unarmed" reads as no ship's guns. The rifle burns no powder. A sunk ship comes back with the timetable until piece D records her in the traffic slice. Scatter in elevation is half that in bearing until piece B adds the roll.

### 14.9 Piece C as built: targets and morale (2026-11-08)

**Data.** Each traffic class in `ships.json` has a `combat` block: `crew`, `armed`, `target`, `moraleBase`, `flee` (0–1, how readily she runs), `flankKn` (a steamer's forced draught) and `cashCents` (her cash box, low and high, for piece D's looting). The manifest's crew and armed flag read it. The crews settle §8's ranges: tug 5, schooner-barge 7, package steamer **16** (the code had 28), ore freighter 22; the cutter has 40 and is the only armed class, and isn't a target.

| Class | Base | Flee | Flee line | Flank | Behavior |
|---|---|---|---|---|---|
| Fish tug | 50 | 0.2 | 58 | 8.5 kn | Runs slowly at first, strikes to two or three warning shots from a T1 |
| Schooner-barge | 50 | 0.4 | 66 | (towed) | Can't run on her own; adrift or stranded, strikes to two warning shots |
| Package steamer | 70 | 0.9 | 86 | 12.5 kn | Runs at once (a T1's swivel won't stop her); strikes when disabled, or to a T2 at Known Fame after three or four shots |
| Ore freighter | 80 | 0.8 | 82 | 11 kn | Holds on at full speed and is hard to stop with a T1 |

**The meter** (`sim/targets/morale.ts`) is the base, plus the situation's named parts (−4 per Fame tier, −6 per gun she faces up to three, +20 the cutter within 2.5 km, +8 a harbor within 3 km, +4 per other ship in view by day up to two, +10 she can outrun you, +15 a determined captain (one in eight, seeded by her id), −25 disabled, −30 sinking at 30% hull, −10 becalmed, −15 nowhere to run, −15 adrift, −15 caught alongside by a ship she can't outrun), plus her shock (a warning shot −14 and each after it three quarters of the last, hits by share of each pool, casualties by share of her crew killed ×120 and wounded ×40, a night or fog surprise −12). Shock wears off at 0.2 a second once nobody has fired for 20 s. Every part has a label, so the target card (piece B) can say why she struck or didn't (§14.3 criterion 12).

**The captain.** Transit until the player runs down on her inside 550 m (less at night or in fog), lies within 180 m for ten seconds, or fires on or near her (gunfire is heard 2 km off). On the alert: below 25 she strikes for good (heaves to, `npc.struck`, a white flag at the aftermost masthead, `MoraleBroken`); below her flee line she runs (steamers for a harbor off her quarter, sailing ships off the wind, at her best speed, slowed by a tow and by engine or rigging damage) until 1.8 km off (`ShipFled`); otherwise she holds on. Only an armed ship fights; a determined steamer's captain rams inside 400 m. Left alone a minute 1.5 km off, she stands down. In a zone a ship and her consort leave their timetable (`hold`) when her captain is alerted and are steered with the arena's helms, feeling for their own draft.

**Tow lines** (`sim/targets/tow.ts`): the consort's hawser runs from the steamer's stern to her bow at the length they lie at when first seen; taut, it pulls her along and swings her to the pull; slack, she lies. It's drawn as a sagging line. A shot within 4 m of it parts it (`TowCut`): the barge's helm heaves to and she loses her way, and the steamer, free of the tow, gets her full speed back.

**Collisions** (`sim/arena/collide.ts`, `gameplay/collisions.ts`): every hull is a capsule (keel line swept by half the beam) tested after the ships move; overlaps are pushed apart by mass (length × beam²) and the closing speed taken off with a quarter bounce. A ship on her timetable in a zone, and a docked player, can't be shoved. `ShipsCollided` reports a bump; there's no damage (cut list #2).

**For pieces A, B and D.** Until piece A lands, the guns are the dev hook's: `__glpTargets.warn(id)`, `hit(id, pool, share)`, `casualties(id, killed, wounded)`, `cutTow(id)`, and `?guns=N` for the guns the captains see (default 1, a swivel). Piece A calls `targets.shotLanded(at, hitId?)` where each round falls (it parts a hawser, counts as a warning shot for the ship it fell across the bow of, and alerts every captain in earshot), `targets.hit(id, pool, share)` with the share of the pool carried away, and `targets.casualties(id, killed, wounded)`; the player's armament replaces `playerGuns`. A's NPC damage pools own the slowing; the captain reads the shares it's told for her best speed and the disabled and sinking parts. Piece B's target card reads `targets.captains()` (phase, morale, parts, why) and can draw aim on `towLines()`. Piece D's boarding confirms a surrender on `isStruck(id)` / `MoraleBroken`, and loots `combat.cashCents`.

### 14.10 Piece D as built: boarding, looting and the aftermath (2026-11-08)

**Data.** `data/boarding.json` (schema `data/schemas/boarding.ts`) holds every number below: getting alongside, the hands each tier takes over the rail, arms, the Fame, perk and surprise strength, the odds' weights, casualties, the death chance, the repelled damage, loot times by good category, the aftermath's report delays and the boat's weather check, freight for ships with no timetable (the `?encounter=` checks), and how long a sunk or robbed ship is off her timetable.

**Alongside** (`sim/boarding/check.ts`). F grapples when the water between the hulls (their keel capsules, `hullGapM` in `sim/arena/collide.ts`) is under 30 m and you're within 2 kn of her. In a zone F reaches boarding when it finds no berth (or you're anchored); in an arena it comes before "look her over". The HUD chip says "F board her", or why not: "Match her speed to grapple", "You can't take a resisting crew single-handed" (the T1 solo rule), "You have already stripped her", "She is going down". A ship that has struck heaves to and slows to a stop in about 15 real seconds.

**The panel.** Your strength is hands × arms (the T1 is you alone, the T2 seven: you and six; small arms 1, +0.5 a swivel, +0.1 a cannon), plus 2 for the Ex-Navy's Quarterdeck voice, 1.5 per Fame tier, and 2 for surprise at night or in fog. Her defense is her able hands (wounded count 0.4) × their arms (0.5 unarmed, 1 armed) × her nerve (morale ÷ 50, kept within 0.3–1.6). Intimidate: ratio × 0.25 + Fame tier × 0.06 + (50 − morale) × 0.005, within 3–95%; a failure means they won't strike, and only Fight or Withdraw remain. Fight: ratio ÷ (ratio + 0.6), within 5–97%; won, 15–40% of her able hands are hit and about a third of them killed, and a T2 has some hands cut up (no crew roster until plan 12, so it's only told). Lost, you're repelled: 8–20% of her hull points off yours, never below 10% of your own, and at bad odds (Fight under 50%) a chance of death of (0.5 − Fight) × 0.3, at most 15%, always shown on the Fight card before you commit. Death ends the run on Phase 5's end screen with a new cause, `killed` ("PIRATE … SHOT DEAD"). A ship that has already struck skips the panel: her master hands over the papers and you're in her hold. With these numbers a T2 at Known (tier 2) against a package steamer shaken to 45 by warning shots intimidates at about 70%; unknown, against her fresh crew, about 20% (§14.3 criterion 2, in `tests/boarding.test.ts`).

**Her hold** (`sim/boarding/loot.ts`). Her share of her manifest (a steamer and her consort split it by capacity), short anything taken on this passage, with her cash box (from `combat.cashCents`, seeded by her passage) first, then valuables, contraband, manufactured goods, provisions and bulk. Each CU swung across runs the clock: 2 game minutes for valuables, 4 for manufactured goods and provisions, 8 for bulk, 5 for the cash box. A quick grab takes the box and the valuables that fit at once. Everything comes aboard hot (heat 1, the region she was taken in) with her owner's marks (`hot.owner`, a new optional field), one stack per good per robbery. The screen counts the other ships in sight as you work; piece F turns them into witnesses.

**Her crew** (`sim/boarding/aftermath.ts`). Let them go: she makes for port (her captain goes to `fled`) and her crew reports when she gets there, her passage at service speed to the nearest harbor in the zone, or 6 game hours at sea. Disable and leave: rigging and engine shot to nothing, the report three times as slow, and she's off her timetable until then. Set adrift and scuttle: the crew rows ashore (report after the passage or 12 hours, whichever is longer, plus 12) and her hull goes to zero so piece A founders her. The boat's weather check is 0 in fair weather, rises from 20% at 20 kn of wind by 3% a knot, adds 25% in the cold months (November to April) and 5% in the dark on top of either, up to 90%; when it fails 30–80% of the boat drowns. Sink her with the crew aboard: every hand dies and nobody reports. The card for each choice shows the report time and the death chance first. Esc lets them go.

**Events** for the law (piece F), the papers and the audio: `ShipSurrendered` (how: struck, intimidated, fought), `BoardingAttempted` (option, chance, death chance), `BoardingSucceeded`, `BoardingRepelled`, `ShipLooted` (goods, cash, value, owner, region, minutes, quick), `CrewSetAdrift`, `ShipScuttled`, `AftermathChosen` (choice, killed, survivors, `reportInS`), and `CrewCasualties` with three new causes (`boarding`, `adrift`, `sunk`).

**The traffic slice.** `traffic.ships[id]` gains `robbed` (when, the passage, what was taken, her cash) and `lostAt`/`lostUntil`/`lostHow`. Any ship that sinks, by your hand or not, is off her timetable for one game day (a week); a disabled one until her report time. While lost she isn't on the water, in port or on the chart (`placeTraffic` marks her `lost`), and her calls don't move the markets. A robbed ship's manifest is short what was taken for that passage only, her cash box stays empty a week, and she can't be boarded again that passage. All optional fields: no save version bump.

**Also fixed.** Rounds that fell in the water never reached the captains (`main.ts` dropped them before `targets.shotLanded`), so a warning shot across the bow didn't count and a fire-fight out of a ship's earshot was never heard. Every round reaches them now; it's what makes criterion 1 work with real warning shots.

**Calls made here.** Abandoning your own ship when she founders (decision 2) stays with piece F, as §14.4 has it: a repelled boarding never takes your hull below 10%, and every target is unarmed (§14.5), so nothing in this piece sinks you. The T2's wounded hands are only told. Witnesses while looting are counted, not yet acted on (piece F). `__glpBoarding` (`near`, `board`, `odds`, `lay`, `astern`, `record`) drives it from the console; `e2e/boarding.spec.ts` runs criterion 1 with real warning shots from the swivel.

### 14.11 Piece B as built: aiming and firing (2026-11-08)

- **Aim mode** (`gameplay/aim.ts`, `sim/combat/aim.ts`). Tab toggles it at sea (not alongside a pier). 1/2/3 take up the swivel, the broadside and the rifle; 2 again swaps sides, and a broadside first opens on the side of the nearest ship. C cycles the gun's shot. Tab comes back to the gun last picked. The cursor's ray meets the water at the aim point; the bearing is held to the mount's arc and the range to the reach (the shot goes to the edge, and the HUD says why). The left mouse fires only when it went down on the canvas, not on a HUD button. New bindings `AimSwivel`, `AimBroadside`, `AimRifle`, `CycleAmmo` (Digit1–3, C), all rebindable with `AimMode` and `Fire`.
- **The camera** (`ShipCamera.setAim`). A broadside is aimed from the gun's rail, 6 m up and a little abaft the guns, looking out along the beam; the swivel from 24 m up amidships, above the headsails, which block a deck-level view forward; the rifle from 16 m. The swivel and rifle views turn toward an aim off to one side (edge-pan with a dead zone); the broadside's holds the beam. The view eases in and out and ignores drag and the wheel while aiming. It's steadied against the roll, so the cue for the roll is the ring, not the horizon.
- **The arc preview** (`render/aim-view.ts`): dots along the flight and a ring of the gun's one-sigma spread at the fall (never less than about a degree across), drawn over everything, cream when ready and red when not. The sight for the fall of shot is 35% of the perception module's hull sight in this light, and 60% of the fog's: past any gun by day, about 100 m on a moonless night, 500 m under a moon. The target card shows only ships within 1.7× that.
- **Firing on the roll.** The combat core takes `barrelTilt(mount)`: a broadside's elevation moves with her roll less her steady heel (the gunner lays out the heel), the swivel's with her pitch, the rifle's barely. It's added as each gun goes off, so the preview, the dev hook's shots and the aimed shot all obey it. 3° of tilt moves a swivel shot at 120 m by more than 15 m.
- **The ripple.** A crewed ship (the T2) fires a broadside gun by gun, 0.22 s apart, each laid by the roll at that moment; powder for all of them comes out at the order, and the reload starts with the first. `FireOrder.ripple: false` fires them together. `WeaponFired` is raised per gun and now carries the muzzle's height.
- **Effects** (`render/combat-fx.ts`): one point-sprite pool for muzzle flash, smoke that billows out 10–35 m and drifts downwind, splinters off a hull or deck hit and canvas off a rig hit. Splashes are the spray's column, as before.
- **HUD** (`ui/hud/AimHud.tsx`): the aim HUD (gun, shots with the loaded one marked, status, range of reach, the barrel's tilt and whether it's falling, powder, a load ring per mount, "Steering locked" on the T1, the keys), and the target card (name, class, range, the captain's phase and nerve with his latest reason, hull, rig and engine, crew with killed and wounded, colors struck, hawser).
- **Dev.** `__glpCombat.aim(weapon?)`, `standDown()`, `aimAt(x, z)`, `aimAtShip(id)`, `aimFire()`, `cycleAmmo()`, `aimState()`, `place(id, relDeg, m)` and `screenOf(id)`.
- **For Jared: aim feel.** The camera places, the edge-pan rate, the smoke's density and the tilt rule (full roll on a broadside) are first guesses to tune by hand.

### 14.12 Piece F as built: the law and the world answer (2026-11-09)

- **Sea crimes** (`data/crimes.json`, `sim/law/sea-crimes.ts`, `gameplay/sea-law.ts`). New `crime.firing_on_ship` (25 heat; a warning shot across her bow counts). Piracy, sinking and killing now come from piece A's gunfire and piece D's boarding: firing on a ship when a round lands within 150 m of her, killing on the first death aboard a ship you fired on, boarded or sank (one crime an encounter), piracy when her hold is looted, sinking when she's scuttled or shot under. Each is committed once a ship, when it happens. `crime.attack_law` is now "Firing on the law".
- **Who tells.** Each crime's witnesses are whoever has you in sight at that moment (piece B's watchers) plus, for piracy, the ships the looting screen counted in sight (`sightingIdentification`: your profile within 600 m by day, "a schooner" further off or at night). The victim's crew is a **pending witness** on the same crime (`CrimeInput.pending`), so a crime two people saw lands once at the better identification. When you let them go, `releasePending` sends them off with piece D's report time (her next port, later disabled, after the row ashore adrift); if they went down with her, never. A ship that got away, or that you left lying (quiet for two game hours, the zone left, the arena ended), reports as if let go. A boarded crew knows your ship, and your face from Fame tier 2 (`law_actors.json` `sea`).
- **Gunfire is heard** to 2 km: every watcher in earshot with a line of sight has you spotted at once, the rest at least watching (`Detection.hear`).
- **Sinking spreads** to the neighboring regions (its `news` flag, as contract theft's). Killing and firing on the law spread too.
- **Firing on the law.** A round landing near the _Morrill_ or the tug puts the region at Most Wanted at once and turns her hostile (`turnHostile`): no more hails, she fires as soon as she has you in sight, and her rounds go at your hull, whatever your tier.
- **The _Morrill_'s bow gun is real** (`weapon.cutter_gun`, `LawAtSea.layGun`). Her warning shot is a ball across your bow, her chain goes for your rigging and her round shot for your hull, all on piece A's ballistics (`combat.fireFrom`), led on your course. Until you've fired on her, a hit can't take your hull below 20% (`playerHullFloor`), so she never sinks you unprovoked (criterion 10). The tug's rifles still roll dice. `CutterFired` is still raised per shot (now with `aim`), and her `WeaponFired`/`ShotLanded` follow from the core; the law sounds play from `CutterFired`, and piece G's combat sounds skip law ships, so her gun sounds once.
- **Company grudges** (`law_actors.json` `companies`). A crime named to you against a company's ship raises its grudge by the crime's `grudge` (firing on 10, piracy 20, killing 25, sinking 30, to 100) and lowers your Standing with them by a fifth of the rise. Grudges fade 2 a game day. From 50 their agents offer you no contracts. The ledger's Standing & law page lists the grudges.
- **The papers** print the sea crimes with the ship, her owners, the dead (inflated with Fame) and what was taken (`data/newspapers.json`; `ReportFiled` carries the crime's details).
- **Wrecks** (`sim/wrecks.ts`, `state.wrecks`). Every ship that goes down, and your own when you abandon her, is recorded where she lies (chart, and zone meters when she went down in one), with her class, owner, how she went, the drowned and her cargo for plan 11's salvage, and a line for the ledger. The chart marks them; the ledger lists the latest. The last 40 are kept. No mast in the world yet.
- **Abandon ship** (decision 2; `gameplay/abandon.ts`, `sim/shipyard/abandon.ts`). Holed to nothing she founders: the HUD says "She's going down: F abandon ship (45 s)" and she goes under on her own when it runs out (alongside a pier she holds on her lines and the clock waits). She's lost with her cargo, powder and guns; her wreck lies where she went down. After 6–18 hours in the boat you're landed at the nearest port with a shipyard, where the yard lets you have a worn T1 (60% hull, 65% rigging) for 40% of a new one: from your purse, then your strongboxes by word (the messenger's fee and delay), then worked off at $25 a day. If the master who picked you up knows your face (the recognition roll by Fame), he adds a witness to your open crimes of the last two days. A screen tells it, and "Aboard her" puts you alongside the yard's pier. The danger snapshot now covers a foundering ship (`kind: 'foundering'`), so closing the tab while she founders lands you back in it.
- **The combat log** is the logbook: each sea crime, the dead, the wrecks and the abandonment get a line.
- **Dev.** `__glpSeaLaw` (`incidents`, `wrecks`, `closeAll`, `crimes`, `reports`, `grudges`) and `__glpAbandon` (`founder`, `abandon`, `leave`, `leftS`, `open`, `landed`, `docked`). Saves gain optional `player.grudges`, `wrecks` and an open crime's `company`, `details` and `pending`; no version bump.
- **For Jared.** The grudge numbers, the 20% hull floor, the rescue hours and the worn hull's price are first guesses.
### 14.13 Piece G as built: combat audio (2026-11-09)

Plan 15 §19 has the whole of it. The guns are heard near from your own deck and far across the water, the round in flight goes by with its pitch dropping, and where it lands is a splash, wood or canvas; the boiler bursts, the grapple goes over (`ShipGrappled`, a new event raised as F opens a boarding), the boarding panel has its vignette (defiance, the melee, your crew's cheer), and a ship that strikes has her crew calling out and a stinger. The chase layer of the music comes in as targets are alerted and goes to full with gunfire or a ship running close, and settles once she strikes. The law's own guns stay with piece H's sounds; piece F should keep only one of `CutterFired` and `WeaponFired` sounding when it puts the *Morrill* on the ballistics. For Jared: the levels and the chase's thresholds want a listen in the game.

---

## Changelog
- v0.4.6: §14.12 piece F as built: sea crimes and their witnesses, the robbed crew's late report, sinking's spread, firing on the law, the Morrill's real gun, company grudges, the papers, wrecks and abandoning ship.
- v0.4.7: §14.13 piece G as built: combat audio (plan 15 §19).
- v0.4.5: §14.11 piece B as built: aim mode, the arc preview, firing on the roll, the rippled broadside, smoke and splinters, the aim HUD and the target card.
- v0.4.4: §14.10 piece E built (fences, the shady shipwright, powder and shot, more than one smuggler).
- v0.4.2: §14.8 piece A as built: guns and shot data, ballistics, hull boxes, damage pools, sinking and the boiler, save v8.
- v0.4.3: §14.9 piece C as built: combat stats, the morale meter and captain, tow lines, collisions, and the interface for pieces A, B and D.
- v0.4.4: §14.10 piece D as built: the boarding check and panel, looting, the aftermath with its weather check, robbed and sunk ships in the traffic slice, and water landings reaching the captains.
- v0.4.1: Jared's calls on §14.6 (back-room fences at night, simple abandon ship, rivals later) and the Siskiwit Bay smuggler (§14.6.1).
- v0.4: §14 Phase 6 scope proposal: what Phases 3–5 changed, deliverables, exit criteria, eight work pieces, smaller calls and three decisions for Jared.
- v0.3: Gap review: T3 has a single bow swivel (stern swivel removed).
- v0.2: Decisions: steering freeze, boarding death chance, boiler explosions, passenger steamers targetable, copycat rivals (none at start, max 2–3); removed company guards and decoys.
- v0.1: Initial combat plan: weapons and ammo, tier loadouts, aim mode and solo handicap, ballistics, hit locations, damage pools, lethality accounting, morale/surrender/flee AI, the boarding check, looting with time pressure, aftermath choices, target roster, rival pirates, ramming and tow lines, death and injury rules, data/state, Phase 6 acceptance.
