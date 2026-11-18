# 08 — Docks District Stealth (Night)

Status: DRAFT v0.13 (decisions made; gap review applied; spike S5 written up; Phase 7 built, pieces A–J, and checked in the container for 0.7.0)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan: compact docks-district scenes, no full towns; lockpicks, distractions, bribes, the whiskey trick; carry limits
- [01](01-tech-architecture.md): hand-rolled on-foot controller, navmesh, ≤ 12 full-AI NPCs, docks draw-call budget
- [03](03-world-scale-chart-travel.md): harbor set pieces, slowed clock on foot (R_foot ≈ 6), transitions
- [04](04-water-weather-seasons.md): night length, moon, fog, rain, snow tracks
- [05](05-ports-economy-trading.md): fences, warehouses, hot goods, market stock
- [06](06-fame-wanted-law-lighthouses.md): detection model, witnesses and reports, tiers, capture and jail
- [07](07-combat-boarding-targets.md): small arms, the whiskey trick, injury
Feeds: 09 (shared grid/kit editor, crafted tools), 11 (on-foot systems reused on islands), 12 (jailbreak, events), 13 (stealth HUD), 14 (character and kit art)

## Purpose

Define the on-foot night game in port docks districts:
- the district structure and the reusable kit
- player movement and tools
- the perception and guard AI
- theft and carrying loot back to the ship
- escapes
- the jailbreak scenario
- how it all plugs into Wanted, Fame and the economy

The on-foot systems here (controller, perception, AI) are reused for islands (plan 11).

---

## 1. Goals

1. **Tense, readable stealth.** Light and shadow, sound and sightlines. The player always understands why they were seen. (A simpler cousin of *Thief*/*Dishonored*.)
2. **Short heists:** 5–15 real minutes from going ashore to casting off.
3. **Non-lethal is the natural path.** Knockouts, ties, whiskey, bribes and distractions are all better than killing, which is a heat disaster.
4. **Plan by day, steal by night.** Scouting pays off.
5. **Solo-developer friendly.** One modular kit, data-driven layouts, a small number of NPC types.
6. **Cheap.** Fits the docks budget on the integrated GPU.

---

## 2. District Structure

### 2.1 What a docks district is
A compact, hand-assembled waterfront scene (~150–250 m across) attached to a port's harbor set piece ([03 §3.4](03-world-scale-chart-travel.md)). It's built from one **modular kit** and stored as a placement list (JSON). The town beyond is a backdrop: facades and silhouettes, not explorable.

**Typical contents:**
- Wharves and piers, with **moored ships** (decks and holds boardable)
- **Warehouses** (simple interiors, one or two levels)
- Fish sheds and a packing house, coal/ore/lumber yards (exterior only)
- A **saloon** (social hub; the fence's back room)
- Harbor master's office, chandlery, police station and lockup (in jail ports)
- Streets, alleys, fences, rail sidings (Superior, Two Harbors)
- Gas lamps and lanterns (pools of light), crates, barrels, carts (cover)

Interiors are part of the same scene (no load); roofs fade when the player is inside.

### 2.2 MVP districts
| District | Size | Phase | Character |
|---|---|---|---|
| **Bayfield** | Small–medium | **7 (first)** | Fish docks, Hollister packing house and cooperage, saloon, small police presence, and the **lockup** that holds MVP prisoners and hosts jailbreaks (§9) |
| Ashland | Medium | 8+ | Ore and lumber docks, rail, brownstone buildings |
| Washburn | Medium | 8+ | Lumber and coal docks |
| **Duluth** | Large | 9+ | Busy waterfront, canal construction site, many police, the best fence, a jail |
| Superior | Large | 9+ | Shipyard (impound yard), coal and grain docks, a jail |
| Two Harbors | Small | 9+ | Ore dock, rail yard, rough saloon |
| La Pointe | Tiny | 9+ | Village pier and a trading post |

Layouts draw on **Sanborn fire insurance maps** and period photos where available ([R1 §6](R1-western-superior-1900-research.md)), simplified for gameplay.

### 2.3 Day vs. night
- **Night (the core):** the full stealth simulation.
- **Day (decided: walkable, light simulation):** the same scene with ambient crowds and open shops. Trading still uses menus (fast), but walking the district lets you:
  - **scout**: see warehouse doors and lock types, learn guard posts, peek at what's being loaded
  - talk in the saloon and buy whiskey or tools
  - **set up** schemes (befriend a ship's crew for the whiskey trick)
- Crime by day is possible but very risky (witnesses everywhere).
- Not cuttable (decided). Day mode uses a lighter simulation (ambient crowd loops and a few shopkeeper NPCs) to stay within budget.

---

## 3. Player On Foot

### 3.1 Camera & controls (mouse and keyboard)
- **Third-person** over-the-shoulder camera (decided; pointer lock), with collision and a close mode indoors.
- WASD move · **Shift** run · **C** crouch (sneak; not Ctrl, see §19) · **Space** hop (about 0.45 m), or vault or climb at marked spots (crates, fences, low roofs, ladders) · **F** interact · **Q/E** lean or peek · **LMB** use the selected tool · **RMB** aim a throw · **1–6** tool belt · **Tab** inventory · **M** district sketch map · **Esc** pause.
- Bindings go through the input action map ([01 §4.8](01-tech-architecture.md)).

### 3.2 Movement & noise
| Movement | Speed | Noise | Visibility |
|---|---|---|---|
| Crouch-sneak | Slow | Very low | Low profile |
| Walk | Normal | Low (louder on wooden planks) | Normal |
| Run | Fast | High (planks: very high) | High |
| Carrying a crate | Slow | Medium | High (no crouch) |
| Swimming | Slow | Splash on entry; quiet afterward | Very low (head only) |

**Surfaces matter:** wooden piers are louder than dirt alleys, and snow crunches (and leaves **tracks** that guards can follow, per [04 §11](04-water-weather-seasons.md)).

**Swimming (decided):** short swims in the harbor as an escape route or a way around a guarded pier. **Cold water** drains health over time (spring and fall are dangerous; winter is mostly ice, and falling through means a deadly check). This connects to the rowboat and moored ship escape.

### 3.3 Health
Simple HP. Wounds from fights or falls heal over game days or at a doctor. No regeneration during combat ([07 §9](07-combat-boarding-targets.md)). Death is permadeath.

---

## 4. Perception (uses the shared detection model, [06 §7](06-fame-wanted-law-lighthouses.md))

### 4.1 Seeing
- **Vision cone** per NPC type (range and angle), reduced by fog and rain ([04](04-water-weather-seasons.md)) and boosted by a carried lantern within its radius.
- **Light level at the player:**
  - Moonlight (phase and clouds) as the global base.
  - Plus pools from gas lamps, windows and lanterns. Each light has a radius and intensity, and the player's light level is computed from the nearest few. It's cheap, and it doesn't need real shadow maps.
- **Visibility** = light level × movement × posture × silhouette (backlit against a lamp or the sky is worse) × cover (partial occlusion via a few raycasts against simple colliders).
- A **detection meter** per NPC fills based on visibility × distance × attention state.

### 4.2 Hearing
**Noise events** with a radius: footsteps (by movement and surface), knocking things over, forcing a lock, breaking glass, splashes, gunshots (the whole district), and thrown distractions. NPCs within the radius (attenuated by walls) investigate.

### 4.3 Tracks
**No watchdogs (decided).** The only "trail" mechanic is **snow footprints** in winter: guards who find fresh tracks follow them (a decaying breadcrumb trail of player positions, only on snow).

### 4.4 Recognition
Being **seen clearly** (close, lit, for long enough) **identifies you**, scaled by Fame ([06 §4.2](06-fame-wanted-law-lighthouses.md)). Seen at a distance or in the dark, you're only "someone." There are no disguise items (decided 2026-10-22).

---

## 5. NPCs & AI

### 5.1 Types
| NPC | Role | Notes |
|---|---|---|
| **Night watchman** | Guards a warehouse or yard; carries a lantern; may take bribes | Most common |
| **Constable** | City police; patrols streets and wharves; **reports instantly** | Number scales with Wanted tier |
| **Dock worker / sailor** (night shift, drunk) | Witnesses, not fighters; they shout for help | Some are on watch aboard moored ships |
| **Saloon patrons / barkeep** | Social hub; witnesses | Ambient AI |
| **Fence** | Trades hot goods ([05 §6.2](05-ports-economy-trading.md)) | Night, back room |
| **Marshal / bounty hunter** | Tier 4+ searchers; armed and persistent | [06 §5.3](06-fame-wanted-law-lighthouses.md) |

Budget: **≤ 12 full-AI NPCs** at once ([01 §5](01-tech-architecture.md)). Others are ambient (scripted loops, simplified perception) or spawned only near the player.

### 5.2 Behavior (FSM)
```
Patrol/Idle ──(noise / glimpse)──► Suspicious ──(confirm)──► Alerted/Pursue
     ▲              │ (nothing found)          │ (lost you)
     │              ▼                           ▼
     └──────── Return ◄────────────────── Search (last known pos, navmesh sweep, calls others)

Side states: Distracted (thrown object) · Drunk (whiskey) · Unconscious · Bound · Bribed · Dead
```
- **Patrol** routes and schedules (waypoints, idle spots, lantern relights, shift changes at midnight).
- **Suspicious:** turns, looks, approaches the stimulus. The meter decays if nothing more is seen.
- **Search:** sweeps around the last known position on the navmesh for a time. It recruits nearby NPCs.
- **Alerted/Pursue:** whistle or shout (an alert noise), chase, try to **subdue** (capture). A constable files a **report immediately**. A watchman runs for a constable.
- **Unconscious** NPCs wake after a while (sooner if found) and report "assaulted by someone" (identified only if they saw you).
- **Bodies** (if killed) found by others start an alert and a **murder investigation** (big heat). They can be dragged into hiding (water, shadows, crates).
- **Wanted-tier scaling:** more constables, tighter routes, more lanterns, faster search escalation, and marshals at tier 4+.

### 5.3 Navigation
Navmesh per district, **baked offline** (recast-navigation-js tooling) from the kit layout. Doors are simple open/closed links. No physics-driven obstacles.

---

## 6. Player Tools & Actions

| Tool / action | Use | Noise | Heat if discovered | Source |
|---|---|---|---|---|
| **Lockpicks** | Open locks (doors, chests, strongboxes); lock tiers 1–3 | Low | Burglary | Chandlery (shady), crafted (09), fences |
| **Crowbar** | Force doors and crates fast | **High** | Burglary plus evidence | Chandlery |
| **Throwables** (stones, bottles) | Distract (a noise at the impact point) | Medium at impact | None | Found or free |
| **Whiskey bottle** | Give or leave for NPCs → **Drunk** (slower perception, then passes out) | None | None (it's a gift) | Saloon, distilled (09) |
| **Cosh / blackjack** | Knock out from behind (non-lethal) | Low | Assault (30) if reported | Chandlery |
| **Rope** | Tie up an unconscious NPC (stays out much longer; found = alert) | None | Assault | Chandlery, crafted |
| **Knife** | Lethal takedown | Low | **Killing (150)** | Any |
| **Pistol** | Lethal ranged; **a gunshot alerts the whole district** | Very high | Killing / assault | Chandlery (Fame-gated) |
| **Rifle** | Long-range lethal shots; slow to aim and can't be used while carrying. The same rifle is used at sea ([07 §2](07-combat-boarding-targets.md)) and on islands for hunting and wildlife ([11 §3.2](11-exploration-islands-secrets.md)) | Very high (alerts the district) | Killing / assault | Chandlery |
| **Bribe** | Pay a watchman or constable to look away (refusal → suspicion) | None | Small, if it's reported | Cash on hand |
| **Extinguish lamp** | Darken an area (guards notice and relight) | Low | None | — |
| **Player lantern** | See in dark interiors (and be seen) | None | — | Default |

### 6.1 Lockpicking (decided: hold-to-pick)
**Hold F** at a lock. A progress ring fills over a time set by lock tier (e.g., tier 1 ≈ 2 s, tier 2 ≈ 4 s, tier 3 ≈ 7 s real), with a per-second chance of a **noise click** and a small chance of **breaking a pick**. Releasing early pauses progress (it isn't lost). Better picks and the relevant background perks shorten the time and reduce noise. While picking you're stationary and exposed, so lighting and guard timing are the skill.

### 6.2 The whiskey trick (Seavey's *Nellie Johnson* move)
1. **By day or evening:** go aboard a moored ship (friendly visit, Standing or Fame dependent) or join the crew in the saloon, and share whiskey (costs bottles, takes time).
2. The crew gets **Drunk** and later passes out.
3. **At night:** loot their hold with little resistance. You can't take the ship ([decided](00-master-plan.md)).
4. They wake confused. The report is delayed and the identification is weak ("a friendly fellow with whiskey"). It's non-lethal, and the classic Seavey move.

---

## 7. Loot & Carrying

| Loot type | Carry | Examples |
|---|---|---|
| **Pocketables** (small, high value) | Pockets (generous, weight-limited) | Cash box, tobacco tins, jewelry, a captain's purse, a pocket watch |
| **Documents** | Pockets | Shipping schedules (**rumor intel**: departures and cargo), ledgers (who owes whom), letters and maps (**secret leads**, plan 11), keys |
| **Crates / barrels / sacks** (cargo, 1 CU each) | **One at a time, in your arms** (slow, can't crouch, noisy) | Company-marked goods (traceable), whiskey, furs, powder |
| **Handcart** (proposal) | Up to 4 CU; **loud wheels**; it follows only paths | Bulk theft |

**Getting loot to the ship:** carry it to the **moored schooner** (if berthed in this harbor) or to the **rowboat** at a pier ladder (when anchored out). Each trip is a risk, and the dawn deadline limits how much you can take. Loot taken is **hot** ([05 §6.1](05-ports-economy-trading.md)).

**Economy link:** stealing from a warehouse **removes goods from that port's market stock** (prices rise), and the owning company's **grudge** rises (legit effects only; [05 §8.2](05-ports-economy-trading.md)).

---

## 8. Heist Targets (per district, mixed by port)

| Target | Contents | Security |
|---|---|---|
| Company warehouse | Marked goods (bulk) | Watchman, tier 1–2 locks, lamps |
| Moored ship holds | Cargo of that ship; the captain's cabin (cash, documents) | A deck watch (often drowsy or drinkable) |
| Hollister fish shed / packing house | Salted fish, salt, the cooperage tools | Watchman, night-shift workers |
| Chandlery storeroom | Powder and shot, rope, canvas, tools | Tier 2 lock |
| Harbor master's office | Strongbox (fees), **shipping schedules** | Tier 2–3 lock; near a constable route |
| Saloon safe | Cash | Tier 3; barkeep sleeps upstairs |
| **Impound yard** (Superior, Duluth) | **Your impounded ship** (after a jailbreak; [06 §8.2](06-fame-wanted-law-lighthouses.md)) | Watchmen and constables |
| Police station / lockup | **Jailbreak** (§9), evidence lockers | Constables |

Contents and security are data (`districts.json`) and vary with season ([05](05-ports-economy-trading.md) flows, so warehouses are fuller in fall and stockpiled in winter when ships are laid up).

---

## 9. Jailbreak Scenario

Set in a police lockup. **In the MVP this is Bayfield's lockup**, the only district (decided 2026-10-22). The Duluth, Superior and Ashland lockups arrive with their districts (Phase 8+).

- **Regular jailbreak** (tiers 0–4, an alternative to serving time or paying bail): start in a cell with nothing (cargo and cash confiscated).
  - **Ways out:** a pick hidden in your boot (*Poacher* perk or a crafted item), stealing the guard's keys at a shift change, a distraction (bang the bars) plus a lure, or bribing a guard with a promise of stashed money (a debt you must pay or face heat).
  - Then **escape the district**, reach the impound yard (your ship; in the MVP, Bayfield's wharf) or a rowboat, and get out.
  - Success → free, +60 heat ([06 §2.2](06-fame-wanted-law-lighthouses.md)). Failure → recaptured, more time added.
- **Execution jailbreak** (tier 5, **one attempt only**, decided): the same structure, harder. You're in irons (it takes time to slip them), there are more constables and a marshal, and fewer routes. Fail = execution (the run ends).
- **Always readable:** a clear "ONE CHANCE" banner, and the guard routines are learnable by observing from the cell before acting.

---

## 10. Escape & Capture

- **Break line of sight** and hide (shadows, under piers, crates, interiors, water). The search timer runs out, and NPCs return to patrol at a higher alertness.
- **Reach your ship and cast off.** Sailing pursuit begins (harbor launches in big ports, [06 §5.2](06-fame-wanted-law-lighthouses.md)), and the chart is locked while you're detected ([03 §5.4](03-world-scale-chart-travel.md)).
- **Swim** out to an anchored schooner or rowboat (cold water risk).
- **Capture:** if an alerted NPC reaches you and you don't fight or flee, you're subdued, leading to [06 §8](06-fame-wanted-law-lighthouses.md) (jail or execution by tier). Fighting back is possible (cosh, knife, pistol) with the matching heat.

---

## 11. Time, Light & Weather

- **Clock on foot:** R_foot ≈ 6 ([03 §3.3](03-world-scale-chart-travel.md)). **Dawn is the deadline:** workers arrive and the district switches to day mode. A HUD dawn countdown is shown when ashore at night.
- **Night length** by season ([04 §3.4](04-water-weather-seasons.md)): short summer nights (~6–7 game h ≈ 60–70 real min on foot) and long winter nights.
- **Moon phase:** a new moon is darkest (best). A full moon makes open ground risky.
- **Fog:** vision ranges collapse, so it's ideal for theft (sounds carry, though).
- **Rain:** masks noise, reduces vision, and fewer people are out.
- **Snow:** tracks and crunching. Guards follow footprints.
- **Winter:** frozen harbor, laid-up ships with skeleton watches, and warehouses full of stockpiles. Prime heist season.

---

## 12. HUD (plan 13 owns the look)
- **Light meter** (classic stealth "light gem"): how visible you are right now.
- **Noise ring** pulse when you make noise.
- **Detection indicators:** eye icons over NPCs (filling = suspicion; red = alerted), plus off-screen directional markers.
- Interaction prompts, carry/weight, tool belt.
- Clock plus dawn countdown, Wanted tier, report-in-progress icon ([06 §2.4](06-fame-wanted-law-lighthouses.md)).

---

## 13. Content Pipeline: the Modular Kit

- **Kit pieces (MVP):** pier and wharf sections (straight, corner, ladder, pilings), warehouse walls, doors, windows, roofs (2–3 styles), shed, saloon front and interior set, office interior set, crates, barrels, sacks, carts, lamps (gas lamp, lantern hook), fences and gates, rail and siding, crane or derrick, lumber piles, coal heaps, facade backdrop pieces, and moored-ship decks (reusing ship models with walkable deck colliders).
- **Layout authoring:** a **dev-only layout editor** that **reuses the hideout grid-building system** from plan 09 (the same snapping, placement and save format) plus free-placed props. One tool serves two features.
- Pieces come from AI generation, CC0 packs or simple procedural models, run through the asset pipeline ([01 §4.9](01-tech-architecture.md)) with the unified stylized material.
- **Characters:** one stylized low-poly humanoid base with a shared skeleton and animation set (walk, sneak, run, carry, climb, idle, knockout, search, alarmed). Variety comes from palette swaps and accessories (hats, coats, lanterns). The player model takes appearance options from character creation. **Built in Phase 7 piece B** ([14 §20](14-art-direction-asset-pipeline.md)).

---

## 14. Performance (docks budget, Medium preset)
| Item | Budget |
|---|---|
| Draw calls | ≤ 200 (instanced props; merged static kit per block) |
| Animated characters | ≤ 12 full-AI plus a few ambient; GPU skinning; animation LOD (lower update rate when far) |
| Dynamic lights | ≤ 4 real lights near the player. All other lamps are emissive plus fake light pools (decals or vertex tint) |
| Shadows | Blob shadows (Low/Medium); one near cascade on High |
| Perception cost | ≤ 1 ms per tick (light lookup from nearest lamps, ≤ 3 occlusion raycasts per NPC per check, checks staggered across ticks) |
| Navmesh | Baked; path queries amortized |

---

## 15. Data & State

**Data:** `districts.json` (layout ref, targets, security, NPC rosters by tier and season, lamp list, exits), `kit.json`, `npc_types.json` (vision, hearing, behavior params, bribe chance), `locks.json`, `tools.json`, `loot_tables.json`.

**WorldState (per district):**
- `alertness` (decays over days)
- `evidence[]` (broken locks, missing goods), discovered at dawn → unwitnessed crime reports
- `bodies[]`
- `bound/unconscious NPCs` (until they wake or are found)
- `warehouseStock` (linked to market stock)
- `debts[]` (bribe promises)

Lamp and patrol states reset at dawn.

**Events:** `WentAshore`, `NoiseMade`, `NpcSuspicious/Alerted/Searching`, `PlayerSpotted {identified}`, `NpcKnockedOut/Bound/Killed`, `BodyFound`, `LockPicked/Forced`, `ItemStolen`, `BribePaid/Refused`, `CrewDrunk`, `JailbreakStarted/Succeeded/Failed`, `DawnArrived`.

---

## 16. Phase 7 Deliverables & Acceptance (Bayfield district)

**Build:** the on-foot controller (shared with islands), third-person camera, perception (sight, hearing, light), guard FSM with patrol/search/pursue, 3 NPC types (watchman, constable, sailor), lockpicking, cosh, rope, throwables and whiskey, carrying crates to the ship or rowboat, the Bayfield district from the kit, the dawn deadline, capture into jail, the stealth HUD, plus the shared layout editor (with plan 09).

**Acceptance:**
- A full non-lethal warehouse heist is possible and takes 5–15 real minutes.
- Players can always tell why they were spotted (light meter, noise ring, eye indicators).
- A moonless, foggy night is noticeably easier than a full-moon clear night.
- The whiskey trick works end to end.
- A knocked-out guard wakes and reports. A killed guard's body causes an alert and a murder investigation.
- Within the docks budget on the baseline laptop.

---

## 17. Cut List
1. Handcart.
2. Lean/peek.
3. Lamp extinguishing.
4. Two-level interiors (single floor only).
5. Snow-track following.

*Not cuttable:* light and shadow stealth, noise, guards with search behavior, non-lethal options (cosh, rope, whiskey), lethal options (knife, pistol), carrying loot to the ship, the jailbreak, the dawn deadline, day-time walkable districts, swimming.

---

## 18. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Districts are **walkable by day** (scouting and scheming; trading stays in menus). |
| 2026-10-21 | **Third-person** over-the-shoulder camera on foot. |
| 2026-10-21 | **Lethal weapons** (knife, pistol) available on foot, with murder heat. |
| 2026-10-21 | **Swimming** allowed (cold-water danger). |
| 2026-10-21 | Lockpicking is **hold-to-pick** (no minigame). |
| 2026-10-21 | **No watchdogs.** |
| 2026-10-22 | MVP jail and jailbreaks use **Bayfield's lockup**. |
| 2026-10-22 | The **rifle** is an on-foot weapon too (alongside knife and pistol). |
| 2026-10-22 | **No disguise items.** |
| 2026-10-23 | Spike S5: the **hand-rolled controller is good enough**; Rapier is not needed (§19). Crouch is **C** only, because Ctrl+W closes the browser tab. |
| 2026-10-23 | **Space hops** (about 0.45 m) where there's no marked vault spot, so rough ground never traps you. Waist-high crates and walls still need a vault spot. |

---

## 19. Spike S5: On-Foot Controller (results, 2026-10-23)

**Question** ([01 §11.2](01-tech-architecture.md)): is a hand-rolled capsule controller on a heightmap island chunk plus box/cylinder props, with a pointer-lock camera, good enough without Rapier?

**Answer: yes.** Keep the hand-rolled controller for docks, islands and hideouts. Rapier stays a fallback we don't expect to need.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Heightfield | `src/gameplay/onfoot/heightfield.ts` | Bilinear height, gradient and slope over a regular grid. It takes the 1 m on-foot tiles from S3 as they are. |
| Colliders | `src/gameplay/onfoot/colliders.ts` | Yawed boxes, vertical cylinders and an occupancy grid for gridded buildings (plan 09), all as footprints extruded between `minY` and `maxY`. A 4 m spatial hash keeps queries local. |
| Controller | `src/gameplay/onfoot/controller.ts` | A capsule (r 0.3 m, 1.75 m standing, 1.15 m crouched). Sub-stepped moves (never more than r/2 per step), push-out from footprints, step-up to 0.4 m, ground snap 0.45 m, a 42° slope limit (measured over 1 m) with sliding, gravity, a 0.45 m hop on Space, and swimming in water deeper than 1.3 m. No three.js, so it unit-tests in Node. |
| Camera | `src/gameplay/onfoot/camera.ts`, `src/core/pointer-look.ts` | Third-person over the right shoulder with pointer-lock yaw and pitch. The boom marches against terrain and props, snaps in, then eases out. |
| Mode | `src/modes/on-foot.ts` | The `onFoot` mode: the clock at **R = 6**, the `onFoot` input context, and the controller on the fixed tick with render interpolation. It isn't wired into the main boot yet. |
| Test scene | `onfoot-spike.html`, `src/debug/onfoot-spike/` | A dev-only page (`npm run dev`, then `/onfoot-spike.html`) that isn't part of the production build. It's a seeded 128 m island at 1 m resolution with a cliff band and one walkable gully, a pier over deep water, 140 trees and 50 boulders, plus a test yard (stairs, a 0.6 m ledge, a crouch-only overhang, crates, a 0.8 m alley and a gridded L-shaped building with a door). `?props=2000` adds stress props and `?hz=30` changes the tick. The HUD shows frame time, draw calls, controller cost, gait, slope and the clock. |

### Results
| Check | Result |
|---|---|
| Walk, run, sneak speeds (2.4 / 5.2 / 1.3 m/s) | Feel right at a third-person distance. Tune them with guards in Phase 7. |
| Stairs (0.25 m rises), low crates (0.35 m) | Walked up smoothly with no vault. |
| 0.6 m ledge, waist-high crates, walls | Block, and you slide along them. A hop gets you up the 0.6 m ledge; 0.9 m crates and walls still need a vault spot (§3.1). |
| Crouch-only overhang (1.3 m clearance) | You can't pass standing. You can crouch under, and you can't stand up beneath it. |
| 0.8 m alley | Passable. Corners and rotated boxes don't snag. |
| Terrain over 42° | Blocks uphill movement and slides you down. The gully is walkable, so cliffs become barriers with authored paths, as plan 11 §3.1 wants. |
| Getting stuck (first playtest) | The dev reported getting stuck a few times. 246 random 20-second wanders found no spot you can't walk out of, so these were snags, not traps: the 1 m cells give diagonal cliffs a sawtooth that caught you as you walked along them, and on a too-steep patch you had almost no control. Fixes: the slope is measured over 1 m (about 25% more progress walking along a cliff base), you keep full control on a steep patch except uphill, and Space hops. |
| Pier and water | Run along the deck, drop off, swim (head above water), swim under the deck between pilings, and walk out up the beach. |
| Tunneling | None, even through a 5 cm wall at a 10 Hz tick (unit-tested). |
| Determinism | Same inputs give the same state (unit-tested), which keeps replays and tests honest. |
| Controller cost | About **0.004 ms per tick** with 232 colliders and **0.008 ms** with 2,232 (headless Chromium in a cloud container, 6,000 ticks). The 3 ms tick budget ([01 §5](01-tech-architecture.md)) leaves room for 12 guards running the same controller. **Re-check on the dev laptop** with the HUD. |
| Draw calls | 6 for the whole chunk, because props are two instanced meshes. Rendering, not collision, will set the docks budget. |

### Findings for later phases
1. **Crouch must not be Ctrl.** Ctrl+W (crouching while walking forward) closes the browser tab, and pointer lock doesn't stop it. The default binding is now **C** only.
2. **Interact key mismatch:** §3.1 says **F**, but the input map's `onFoot` context has `Interact` on **E**, which §3.1 gives to lean/peek. Settle this when lean lands.
3. **Vault and climb** at marked spots and **ladders** were out of scope (Space hops elsewhere). They fit the same model: a marked collider tags its top as a target and a short scripted move carries you up.
4. **Camera close mode indoors:** the boom collision works but gets very close under low roofs. Add the planned close mode (shorter boom, lower shoulder) when interiors land.
5. **Fall damage** (plan 11 §3.2) only needs the landing speed, which the controller already has at the moment it lands.
6. **Noise and surfaces** (§3.2): the gait (`sneak`/`walk`/`run`/`swim`) plus the collider underfoot is enough to look up surface noise. Tag colliders with a surface when the kit lands.
7. **Navmesh:** guards can share this controller for collision; their paths still come from the baked navmesh ([01 §4.5](01-tech-architecture.md)).

---

## 20. Phase 7 Scope: On Foot, Docks & Islands (2026-11-10)

Phase 7 is the **On Foot: Docks & Islands** build (version 0.7.0), with one goal from the [00 §7](00-master-plan.md) roadmap: **"the night loop + island exploration."** Phases 4–6 built a captain who trades, is hunted and robs ships, all from the helm and the port screen. Phase 7 puts them on their feet: tie up at Bayfield's fish pier on a new moon, walk past the packing house with the lamps behind you, pick the Hollister warehouse's padlock while the watchman's lantern swings away down the wharf, and carry a crate of salted fish back aboard before dawn. Or row ashore at Stockton Island and walk up to the old quarry.

The scope comes from §16 above and [11 §15](11-exploration-islands-secrets.md)'s Phase 7 row, plus what earlier phases left for it: going ashore and the rowboat ([03 §7](03-world-scale-chart-travel.md), [02 §6.5](02-arcade-sailing.md), [07 §14.6](07-combat-boarding-targets.md) decision 2), the walkable back room that replaces the port-screen tab ([07 §14.6](07-combat-boarding-targets.md) decision 1), constables, marshals and the jailbreak that Phase 5 stubbed ([06 §14](06-fame-wanted-law-lighthouses.md)), the captain's body ([05 §16.5](05-ports-economy-trading.md)), the First Week's sixth step ([12 §3](12-sandbox-events-character-failure.md)), the on-foot HUD ([13 §4.2](13-ui-ux.md)) and the docks and stealth sounds ([15 §4.5, §11](15-audio.md)).

This section is the phase's scope, approved by Jared on 2026-11-10 with the recommended calls in §20.5 and §20.6. Its exit criteria (§20.3) are the phase's acceptance checklist, and the playtest piece checks them.

### 20.1 What Phases 4–6 change or put at risk

| Finding | Source | Effect on Phase 7 |
|---|---|---|
| **The on-foot mode exists but isn't wired in.** Spike S5's controller, camera and `onFoot` mode (R = 6) run only in `onfoot-spike.html` | §19, `src/modes/on-foot.ts` | Piece A brings it into the game's mode machine, saves and transitions. The controller itself is done. |
| **There's no character.** Plan 14 put the base humanoid and its animations in Phases 4–6; nothing was built, and the captain is a portrait preset | 14 §13, 05 §16.5 | Piece B, the phase's biggest art risk. Pieces A, C and D use a capsule stand-in until it lands. |
| **No navmesh tooling yet.** §5.3 bakes recast-navigation-js navmeshes offline | §5.3, 01 §4.5 | Piece C bakes it with the district; piece D's guards use it. |
| **The layout editor was to reuse plan 09's grid,** which is Phase 8 | §13, 09 §11 | Piece C builds a small dev-only placement editor on a grid format that plan 09's builder takes over in Phase 8. |
| **The back room is a port-screen tab** at Bayfield and Duluth, by design until now | 07 §14.10 | Piece F walks Bayfield's; Duluth's stays a tab until its district (9+). Same fence and shipwright data. |
| **Jail has a "not yet" jailbreak button,** and the tier-5 gallows ends the run | `src/ui/jail/JailScreen.tsx`, 06 §14.9 | Piece G replaces the button with the lockup scenario. `crime.jailbreak` is already in `crimes.json`. |
| **Abandon ship lands you at a port by rescue;** the rowable boat was left for going ashore | 07 §14.12, 02 §6.5 | Decision 2. |
| **Plans disagree on what Phase 7 holds.** 06 puts lighthouse raids, harbor launches and the Twin Ports waterfront in Phase 7; §2.2 and 11 §15 put the Duluth, Superior and Ashland districts in 8+ and lighthouse stations on foot in Phase 9 | 06 §14.2, §14.5, 05 §16.5 | §20.5 keeps them out of Phase 7, with their districts and Phase 9. |
| **The interact key:** §3.1 says F, the input map's `onFoot` context has E (lean in §3.1) | §19 finding 2 | F, as at the helm. Piece A. |
| **The 1 m island tiles are baked** for all 22 islands (Stockton 6 × 4 tiles, Hermit 2 × 2) | `public/world/apostles/islands/` | The island needs no geo work, only dressing (piece H). |
| **Crimes on foot are already in the data:** trespass, petty theft, burglary, assault, killing, jailbreak | `data/crimes.json` | Piece E wires them to on-foot events; heat values come from Phase 5. |

### 20.2 What Phase 7 delivers

| Area | Deliverable | Plan |
|---|---|---|
| On foot in the game | Going ashore from a berth into the district, or at anchor by rowboat onto an island, each a separate scene load behind a period transition; back aboard and cast off. The S5 controller with vault and climb spots, ladders, fall damage, swimming with cold-water drain, surfaces under foot, health on foot, R = 6 | §3, 03 §7, 11 §3 |
| The captain's body | One CC0 base humanoid in the toon-and-outline style, one shared skeleton and the §13 animation set, GPU skinning and animation LOD; the player dressed from the portrait preset, NPC variants by palette and accessories | §13, 14 |
| Bayfield on foot | The modular kit, a dev placement editor, the Bayfield district from Sanborn maps and photos attached to the harbor set piece (fish pier, Hollister packing house and cooperage, warehouses, saloon, harbor master, chandlery, the lockup), single-floor interiors with roof fade, lamp light pools, a baked navmesh, `districts.json`; by day, an ambient crowd and open shops whose doors open their port-screen tabs | §2, §13, §14 |
| Stealth | Light level from the moon and the nearest lamps, the visibility formula, detection meters, noise events, recognition by Fame; the guard FSM with its side states; watchman, constable and sailor, a marshal variant from tier 4; Wanted-tier scaling; capture into Phase 5's jail | §4, §5 |
| Theft and tools | Hold-to-pick locks in three tiers, the crowbar, throwables, the cosh, rope, whiskey, bribes, knife and pistol, the rifle you already own; pockets, documents and crates carried one at a time to the schooner or rowboat; hot goods with the owner's marks, stock taken out of Bayfield's market, company grudges; evidence found at dawn; knockouts that wake and report; bodies and a murder investigation | §6, §7, §8, §10 |
| The saloon and the back room | The walkable saloon and its back room with the fence and the shady shipwright (the 0.6.0 data), the whiskey trick end to end, moored ships' holds and deck watches | §6.2, 05 §6.2 |
| The lockup | The regular jailbreak (tiers 0–4) and the tier-5 ONE CHANCE in Bayfield's lockup, the impounded ship to steal back from the wharf | §9, 06 §8 |
| One island | Stockton or Hermit (decision 1) walkable end to end: a landing, instanced forest, the quarry POI kit, one seeded cache, the Stockton stash reached on foot | 11 §2, §15 |
| HUD | The light gem, noise ring, eye indicators and off-screen markers, the dawn countdown, prompts with hold rings, carry load, the tool belt, health | §12, 13 §4.2 |
| Audio | Footsteps per surface at the noise radius, locks, doors, crates, the cosh, guard barks and whistles, swimming, the stealth music layer and detection stingers, Bayfield's docks at night, the saloon inside, the island by day | 15 §4.5, §5 |
| Saves | The district's world state (§15), where you are ashore and the rowboat, in save v9 with a v8 migration; no autosave while detected (the danger snapshot covers it) | 16 |
| Onboarding | The First Week's optional step 6 ("A warehouse here looks poorly watched…"); the Poacher's boot pick and quiet feet, the Lumberjack's faster carrying | 12 §2–3 |

**Out of scope:** the Ashland, Washburn, Duluth, Superior, Two Harbors and La Pointe districts (§2.2: 8+ and 9+), with their lockups, harbor launches and the Twin Ports waterfront; lighthouse stations on foot, raids and dousing (Phase 9, 11 §15); the other 21 islands, wildlife, hunting and trapping, caves, salvage, legends and clues (Phase 9); hideout building and the Siskiwit Bay zone (Phase 8); snow tracks and winter (Phase 9); bounty hunters (06 cut list #1); and §17's cuts #1 (handcart) and #4 (two-level interiors).

### 20.3 Exit criteria

Phase 7 is done when these pass on the baseline laptop and Jared signs off the playtest. The first five are §16's acceptance; the rest come from 11 §15, Phases 4–6 and plan 17's definition of done.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | A full non-lethal warehouse heist in Bayfield takes 5–15 real minutes from going ashore to casting off | A playtest route; an e2e test through dev hooks |
| 2 | You can always tell why you were seen: the light gem, the noise ring and the eye over the guard agree with what the sim did | Unit tests on the perception inputs; a playtest |
| 3 | A moonless, foggy night is noticeably easier than a clear full moon | A sim test: time to detection on the same route, both nights |
| 4 | The whiskey trick works end to end: drinks by evening, a sleeping deck watch, her hold looted, a late and vague report | An e2e test; a playtest |
| 5 | A knocked-out guard wakes and reports; a killed guard's body raises the alarm and a murder investigation | Unit tests on the FSM and the crime pipeline |
| 6 | Stolen crates are hot with the owner's marks, leave Bayfield's market stock, raise the company's grudge, and unwitnessed theft is reported at dawn from the evidence | Unit tests |
| 7 | Caught on foot, you go to Phase 5's jail; the jailbreak frees you at tiers 0–4 (+60 heat, your ship to steal back) and the tier-5 attempt is one chance, failing to the gallows | Unit tests; an e2e test of each |
| 8 | Bayfield's fence and shipwright sell from the walkable back room at night, on the same data and prices as 0.6.0's tab | A unit test against the 0.6.0 fixtures |
| 9 | The island: row ashore, walk to the quarry and the cache, open the stash on foot, row back | An e2e test; a playtest |
| 10 | Budgets hold: the district at ≤ 200 draw calls with 12 guards awake and perception ≤ 1 ms a tick; the island at ≤ 150; a p95 frame ≤ 16.7 ms on Medium | `bench.docks`, `bench.island` (17); the laptop |
| 11 | A 0.6.0 save loads into 0.7.0 aboard at its saved place; a save made ashore reloads ashore (or, if detected, at the danger snapshot); the save stays in the plan 16 budget | `tests/save-migrations.test.ts` with a v8 fixture; an e2e test |
| 12 | A night in Bayfield is tense and readable, and the careful way through is the non-lethal one | Jared decides |
| 13 | Plans 03, 06, 08, 11, 12, 13, 14, 15 and 16 record what was built, CI is green, and 0.7.0 is tagged | The release PR |

### 20.4 Work pieces

Ten pieces, each sized to be one thread. Four can start at once (A, B, C and D). The playtest (J) closes the phase.

| Stage | Pieces |
|---|---|
| 1, start now | A going ashore, B the captain's body, C the kit and Bayfield, D perception and the guards |
| 2 | E theft and tools (after D), H the island (after A) |
| 3 | F the saloon, back room and whiskey (after C, E), G the lockup and jailbreak (after C, D), I on-foot audio (after D, E) |
| 4 | J playtest |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | Going ashore | The `onFoot` mode in the mode machine and boot. "Go ashore" at a berth (into the district) and at anchor (the rowboat, by decision 2, onto an island landing); back aboard and cast off; scene loads behind a transition with the zone kept or reloaded (03 §7). The S5 controller with vault and climb spots and ladders, fall damage, swimming with the cold-water drain, surface tags, health on foot, F to interact, the indoor close camera. Abandon ship by decision 2. `player.ashore` and the rowboat in save v9 with the v8 migration; autosave on going ashore and coming aboard, none while detected. Dev hooks (`__glpFoot`) to land, teleport and set the hour. A capsule stand-in until B lands | — | — |
| B | The captain's body | A CC0 base humanoid (Quaternius-style) through the asset pipeline into style B with ink outlines; one skeleton and the §13 set (idle, walk, sneak, run, carry, climb, swim, knockout, search, alarmed, drink, pick); GPU skinning and animation LOD; the player dressed from the portrait preset (skin, hair, beard, hat, coat); watchman, constable, sailor, marshal and townsfolk variants by palette and accessories. Every file in `CREDITS.md` | — | The look |
| C | The kit and Bayfield | The kit pieces of §13, instanced and merged per block; the dev placement editor (grid snap plus free props, a JSON format plan 09 takes over); the Bayfield district from Sanborn maps and photos joined to the harbor set piece; single-floor interiors with roof fade; lamps as emissive plus fake pools with ≤ 4 real lights; colliders with surfaces; the navmesh baked offline; `districts.json`, `kit.json`; day dressing with the ambient crowd and shop doors that open their port tabs (decision 3); `bench.docks` | — | Layout |
| D | Perception and the guards | Pure sim first, in the spike greybox: the light level at the player (moon phase and cloud from plan 04, the nearest lamps, a carried lantern), visibility, detection meters, noise events through walls, recognition by Fame; the §5.2 FSM with distracted, drunk, unconscious, bound, bribed and dead; navmesh paths; watchman, constable and sailor with `npc_types.json`, the marshal variant from tier 4; scaling by Wanted tier; constables report at once, watchmen run for one; capture into Phase 5's jail. The stealth HUD (light gem, noise ring, eyes, off-screen markers, dawn countdown). ≤ 1 ms a tick with 12 guards | — (C's navmesh; a greybox until it lands) | — |
| E | Theft and tools | `tools.json`, `locks.json`, `loot_tables.json`. Hold-to-pick (§6.1), the crowbar, throwables, cosh, rope, knife, pistol (chandlery, Fame-gated) and the rifle on foot; bribes; lean and peek (Q/E) and dousing a lamp if they fit, else §17's cuts #2–3. Pockets, documents (shipping schedules as rumors), crates one at a time to the ship or rowboat. Hot goods, market stock, grudges, evidence at dawn, wake-and-report, bodies and the murder investigation through `crimes.json`. The tool belt, prompts, carry load | D | — |
| F | The saloon, back room and whiskey | The walkable saloon and back room in Bayfield; the fence and shipwright from the 0.6.0 data with the tab retired there at night; buying whiskey; the whiskey trick (§6.2) with crews in the saloon and on moored ships; moored ships' holds, captain's cabins and deck watches; the First Week's step 6 | C, E | — |
| G | The lockup and jailbreak | Bayfield's lockup as a playable cell: confiscation as today, the ways out (the boot pick, keys at a shift change, banging the bars, a bribe on a promised debt), guards learnable from the cell, escape to the impounded ship at the wharf or the rowboat; the tier-5 ONE CHANCE in irons with a marshal; success and failure through Phase 5's jail and the gallows. Replaces the stub in `JailScreen.tsx` | C, D | — |
| H | The island | The island by decision 1 as its own scene from the baked 1 m tiles; a landing and the rowboat; instanced pines and birches from slope and density; the quarry POI kit (cut ledges, derrick, office shack, block piles); one seeded cache; the stash opened on foot (Stockton); a marshal posse searching at tier 4+; `islands.json` and `pois.json` grown for on foot; `bench.island` | A | — |
| I | On-foot audio | Footsteps per surface and gait at the gameplay noise radius (15 §5), locks, doors, crates, coins, rope, the cosh, guard barks and whistles, swimming, the stealth layer and detection stingers, Bayfield's docks at night, the saloon's room and music, the island's forest. Every file in `CREDITS.md` | D, E | Listen by ear |
| J | Phase 7 playtest | The §20.3 scenarios, the benches, plans updated, tag 0.7.0 | All | Playtest, sign-off |

### 20.5 Smaller calls assumed (Jared can override)

- **Districts, lighthouses and launches stay where §2.2 and 11 §15 put them.** Phase 7 is Bayfield and one island. Harbor launches and the Twin Ports waterfront come with their districts (8+ and 9+), and lighthouse stations on foot (raids, dousing, the keeper's logbook) with Phase 9. Plan 06's Phase 7 mentions are corrected to match.
- **Duluth's back room stays a port-screen tab** until its district. Bayfield's tab gives way to the walkable room after dark, with a "Go ashore" link from the port screen.
- **Three guard types plus a marshal.** The marshal is a constable variant with a rifle, a lantern and a longer search, posted from tier 4 in the district and landing on the island. Bounty hunters stay cut.
- **§17's cuts #1 (handcart) and #4 (two-level interiors) are taken now;** lean, peek and lamp-dousing are piece E's stretch; snow tracks wait for winter.
- **The pistol is the chandlery's, Fame-gated at Known; the knife comes with every background.** The rifle is the one in `weapons.json` from Phase 6.
- **The captain's look comes from the portrait preset.** No new creation screen; saves from 0.6.0 keep their preset and get its body.
- **Nobody lives on the island in Phase 7** but a marshal posse at tier 4+; keepers, fishermen and wildlife come with Phase 9.
- **Saves:** autosave on going ashore and coming back aboard, never while a guard is searching or pursuing; the danger snapshot from Phase 5 covers closing the tab.

### 20.6 Decisions for Jared

1. **Which island is the walkable one?** **Decided 2026-11-10: Stockton** (Jared). 11 §15 says Stockton or Hermit.
   - **Stockton (recommended):** the Phase 4 stash is already there, it's a Phase 8 hideout, and its old brownstone quarry is the POI. About 1.5 × 1 km of game ground (24 baked tiles), so most of it is forest to dress, with the quarry and the stash bay as the walked parts.
   - **Hermit:** about 500 m across (4 tiles), its own abandoned quarry and derrick, and the payroll legend's site for Phase 9. Much less to dress, but nothing there yet to come back for.
2. **What does the rowboat do?** **Decided 2026-11-10: row ashore and abandon into it** (Jared). Going ashore at anchor needs a boat; 02 §6.5 wants abandon ship to put you in it.
   - **Row ashore and abandon into it (recommended):** at anchor, you row a short way to the landing (2–3 kn, zone only, swamped in a sea); abandoning a foundering ship near land in moderate weather puts you in it to row for the nearest landing or port, and the 0.6.0 rescue stays for far offshore.
   - **A cutaway only:** "Go ashore" fades to the landing and back. Abandon ship stays the rescue. Least work.
   - **All of 02 §6.5:** the rowable boat as above plus buying passage between ports and fishing from the boat. More than the island needs.
3. **When you dock at Bayfield, where do you land?** **Decided 2026-11-10: the port screen, with "Go ashore"** (Jared). §2.3 keeps trading in menus but makes the district walkable by day.
   - **The port screen, with "Go ashore" (recommended):** as today, so a quick sale stays quick; going ashore walks you into the district, where shop doors open their tabs, and at night it's the only way to the back room.
   - **On foot first:** you step off onto the wharf and walk to each shop. More atmosphere, slower trading every visit.
   - **The port screen by day, on foot by night:** docking after dark puts you ashore. Neat, but no daytime scouting unless you choose it from a menu anyway.

### 20.7 Housekeeping found along the way

- Phase 6's two tuning calls are in already (`28a2592`): the package steamer's forced draught is 11.5 kn and the WANTED page waits for the arena to end. Jared's Phase 6 playtest passed and the white flag is good enough (2026-11-10), recorded in [07 §14.14.4](07-combat-boarding-targets.md).
- The master plan's Phase 7 row should gain the jailbreak, the walkable back room and the rowboat once this scope is approved. 00 §4.4 says the other districts come in "Phase 8+", which §2.2 already splits into 8+ and 9+.
- Plan 06 §14.2 and §14.5 and plan 05 §16.5 send harbor launches, lighthouse raids and the Twin Ports waterfront to Phase 7; their next edits should point at the phases in §20.5.
- Plan 14's roadmap put the character base in Phases 4–6; piece B builds it now.
- Plan 17 wants a tracking issue per phase with the acceptance checklist; §20.3 can become it once approved.

### 20.8 Piece J: playtest and release (2026-11-15)

**Goal** (§20.4, piece J): check the §20.3 exit criteria with pieces A–I merged, run the benches, write the laptop route, bring the plans up to date, and prepare 0.7.0. As for Phases 5 and 6 ([06 §14.14](06-fame-wanted-law-lighthouses.md), [07 §14.14](07-combat-boarding-targets.md)), the phase is done when the criteria pass on the baseline laptop and Jared signs off the playtest; this section holds what the cloud container could check and what's left for the laptop.

**Added for the playtest:**

- `tests/heist-playtest.test.ts` works criterion 1's time out from the district as built, since nobody can hold a stopwatch here: the walked distance on the baked navmesh from the fish pier's gangway to each of Hollister's two stacks, sneaking in with empty hands (1.3 m/s) and walking out loaded (70% of a walk), a lift each trip and the padlock. This stocking's eight crates take **5.4 minutes** with no waiting at all; a careful player waiting on the watchman's back each trip adds a few more, and four crates is a short night.
- `tests/save-size.test.ts` checks a burglar's season (below), and `tests/district-watch.test.ts` prints what perception costs on the real district.
- **Fixed: a marshal chasing you on Stockton wasn't danger.** `ashore.pursued` asked only the district's watch, so with the island posse after you the game still autosaved and the chart still opened. The posse now reports its chase (`IslandPosse.pursued`), so it's the danger snapshot and a locked chart there too, as criterion 11 says. `tests/island-posse.test.ts` has the check.
- The changelog had no entry for piece B (the captain's body) and still called the captain a stand-in; both are put right in 0.7.0's section.

#### 20.8.1 Checked in the cloud container

Typecheck, lint, Prettier, 1,823 unit tests (one skipped) and all 61 e2e tests pass on the release branch. Headless Chromium renders on SwiftShader (one to two frames a second in the district), so frame times here say nothing about the laptop.

| # | Criterion | Result here | Still needs |
|---|---|---|---|
| 1 | A full non-lethal warehouse heist takes 5–15 real minutes | `e2e/ashore.spec.ts` (ashore at the fish pier at night, the padlock picked, a crate carried aboard hot) and the worked time above: 5.4 minutes of walking, picking and carrying for the whole stocking of eight crates, before any waiting. Likely 7–12 minutes played carefully. Pass on paper | A stopwatch on the laptop (step 2) |
| 2 | You can always tell why you were seen | `tests/stealth.test.ts`: the gem's words follow the same light the guards' sight uses (hidden crouched in the dark, exposed walking under a lamp), the ring is the footstep radius they hear, and the eyes follow each guard's meter and state, pinned to the edge off screen; `tests/foot-tools.test.ts` for the conduct line. In the real renderer the gem read Lit beside a lamp on the pier and at the warehouse door. Pass | Jared's eye on a night's play |
| 3 | A moonless, foggy night is noticeably easier | `tests/stealth.test.ts` "the same route on two nights": the same crouched walk past the yard watchman and the constable raises the alarm under a clear full moon and is never noticed on a new moon in 120 m fog. Pass | — |
| 4 | The whiskey trick end to end | `e2e/whiskey.spec.ts` (her crew stood whiskey in the saloon, the deck watch asleep at her gangway, her hold looted) and `tests/foot-tools.test.ts` (a sailor sleeps it off and wakes with nothing to report). Pass | The route by hand (step 4) |
| 5 | A knocked-out guard wakes and reports; a body raises the alarm and a murder investigation | `tests/stealth.test.ts` (the FSM) and `tests/foot-tools.test.ts` (unseen, he wakes and reports "someone"; a body found is a murder, tied to a face the guards learned that night). Pass | — |
| 6 | Crates hot with the owner's marks, out of the market's stock, a grudge, unwitnessed theft reported at dawn | `tests/heist.test.ts`: stowed hot with Hollister's marks, the stock down by one, one burglary per building found at dawn as done by an unknown hand, and a guard who sees you with the crates names you. Pass | — |
| 7 | Caught on foot, Phase 5's jail; the jailbreak at tiers 0–4 and the one chance at tier 5 | `tests/jail.test.ts`, `tests/jailbreak.test.ts` (21 tests: the four ways out, +60 heat, a longer sentence retaken, the rope at tier 5) and `e2e/jailbreak.spec.ts` (a promise to the jailer and away aboard from the city dock; a reload mid-attempt loses it; at tier 5 the irons, and dawn is the rope); `e2e/ashore.spec.ts` for the constable taking you to the lockup. Pass | The cell by hand (step 5) |
| 8 | The back room sells on 0.6.0's data and prices | `tests/shops.test.ts` "the back room walked into": the same lots, rates and gear as 0.6.0's tab and the same money from the fence; `e2e/shops.spec.ts`. Pass | — |
| 9 | The island: row ashore, the quarry and the cache, the stash on foot, row back | `e2e/island.spec.ts` (the quarry wharf, the cache in its cairn, the stash at its strongbox) and `e2e/island-posse.spec.ts`. Pass | The row and the walk by hand (step 6) |
| 10 | Budgets: district ≤ 200 draw calls with 12 guards, perception ≤ 1 ms a tick; island ≤ 150; p95 frame ≤ 16.7 ms on Medium | `npm run bench:docks` (the district alone, 23:00, 12 guards): **72** draw calls at most, 251k triangles, a path query 1.7 ms. **In the game** on Medium at 22:00 at Wanted tier 5 (12 guards), with the lake, the sky and your ship drawn too, nine views from the pier to the lockup: **61–179** draw calls and 350–610k triangles; the most is from the west end looking east along the whole waterfront. Under 200, with little to spare. Perception on the real district: **0.065 ms** a tick for the tier-5 watch (the test's limit is 1 ms). `npm run bench:island`: **60** draw calls walking Stockton's shore, 220k triangles. Pass for the counts | Frame times on the laptop (step 8) |
| 11 | A 0.6.0 save loads aboard; a save ashore reloads ashore, or at the danger snapshot; the save budget | `tests/save-migrations.test.ts` (the v8 fixture loads aboard at its saved place, at full health, the boat stowed; a v9 save made ashore keeps where you stood, the boat on the beach and your wounds); `e2e/ashore.spec.ts` (the save remembers the pier). The danger rule covered the district's watch but **not the island's posse until the fix above**. A burglar's season (five districts with 40 containers emptied, 24 doors and 6 crews each, 22 caches searched, a jailer's debt, ashore at anchor with the boat beached) saves at **4.8 KB** compressed, against 250 KB. Pass | — |
| 12 | A night in Bayfield is tense and readable, and the careful way is the non-lethal one | — | Jared |
| 13 | Plans updated, CI green, 0.7.0 tagged | Plans 00, 03, 06, 11, 12, 13, 14, 15 and 16 record what was built; version 0.7.0, the changelog and the README are in the release PR | CI on the PR; the tag on the merge (Jared) |

**Scope that didn't make it** (§20.2 against the code): the ambient crowd by day (decision 1 below); lean, peek and dousing a lamp (piece E's stretch, per §20.5); a posse that searches the island for you (decision 2). Everything else in §20.2 is in.

#### 20.8.2 For Jared on the laptop

Start a **New run as a Poacher** (Bayfield, the boot pick and quiet feet), or use any run with picks from the chandlery. `?debug` gives the overlay's Time folder for the hour, the Law folder for a Wanted tier, and the Audio folder to hear any sound on its own. In the console, `__glpFoot.hour(22)` sets the night and `__glpFoot.restock()` and `__glpFoot.restockBurglar()` fill your pockets (a cosh, rope and whiskey; picks, a crowbar and the pistol). Take a stopwatch to step 2.

1. **Go ashore by day.** Tie up at Bayfield's fish pier and press G (or **Go ashore** on the port screen). Walk the waterfront: F at the counters of Booth & Sons, the chandlery and the harbor office, a drink at the saloon's bar. **Does the captain look right, and does the town feel too empty by day?** (decision 1).
2. **The Hollister warehouse at night** (criteria 1, 2, 12). After 7 p.m., from the fish pier: watch the watchman's lantern go round, C to crouch, pick the padlock (hold F; letting go keeps the work), lift a crate, and carry it down to the gangway. Repeat until the stack is empty or your nerve is. Watch the gem, the ring and the eyes: **when a guard notices you, can you tell why?** Time it from G to casting off.
3. **Tools** (criterion 5). A stone thrown past a guard, a bribe, the cosh from behind and rope after it; then let one wake, and see the Harbor tab and the papers next day. Try it again on a foggy night with no moon (the overlay's Cloud and Visibility) for criterion 3.
4. **The whiskey trick** (criterion 4). With a ship lying at the fish pier, find her crew at their table in the saloon between 4 p.m. and 1 a.m., stand them whiskey (a bottle for every four hands), and within the hour walk aboard past her sleeping deck watch for her hold and the captain's cabin. Sell the lot at the fence's table in the back room.
5. **The lockup** (criterion 7). Let a constable take you with a crate in your arms, and on the jail screen choose **Break out**. Learn the jailer's round from the cell and try the keys from his belt, then banging the bars, then a promise of money; your ship lies at the city dock. With the Law folder at tier 5, see the one chance in irons.
6. **Stockton** (criterion 9). Anchor off the south shore west of the stash, G for the boat, row in and beach her, walk up the quarry steps, search the cairns, open the stash, and row back. At tier 4 the marshals are there: **is a posse that only walks the quarry enough?** (decision 2).
7. **A listen** (piece I, [15 §20](15-audio.md)). Footsteps on planks, dirt, gravel and grass at a sneak, a walk and a run; the pick and its click; the cosh; a guard's "Hm?", "Who's there?" and "Hey! Stop!" with the whistle after; the stealth layer coming up as a meter fills and going full in a chase; the docks at night, the saloon from the street and from inside, and Stockton's woods. **Are the levels right, do the steps sound like their ground, and are the voices bearable?** (decision 3).
8. **Frame times** (criterion 10). On Medium at `?harbor=bayfield&hour=22&debug`, go ashore and stand at the west end of the waterfront looking east (the heaviest view here, 179 draw calls), then walk the district; and walk Stockton's quarry by day. The budget is a p95 frame of at most 16.7 ms.
9. **Criterion 12:** is a night in Bayfield tense and readable, and is the careful way through the non-lethal one?

#### 20.8.3 Open decisions for Jared

1. **Bayfield by day has no crowd.** **Decided 2026-11-15 by Jared: tag 0.7.0 as it stands, and build the crowd next** as its own piece (a dozen townsfolk and dockhands on loops by day, none of them perceiving you), to ship as 0.7.1. The text below is what was recommended. §2.3 calls the day district walkable "with ambient crowds" and not cuttable; what's built by day is the shops with a keeper at each counter and the watch on its beats. Recommended: tag 0.7.0 as it stands and build the crowd as the next small piece (a dozen townsfolk and dockhands on loops by day, nobody who perceives), as 0.7.1. Or hold the tag for it.
2. **Should the island posse search for you?** The marshals walk beats round the quarry and hunt by sight and hearing; land on the far shore and they never come. Recommended: leave it for Phase 9 with the rest of the island's life, since a tier-4 captain has reason enough to stay off Stockton's quarry. Or have them walk to where the boat is beached.
3. **On-foot audio levels and voices** (piece I): a listen in the game (step 7). Recommended: keep them unless the listen says otherwise.
4. **The audio budget.** The decoded sounds stand at 4.96 MB of [15](15-audio.md)'s 5 MB after the on-foot set. Recommended: raise the budget to 8 MB when the next sounds come (Phase 8's building and crafting), since the laptop's memory isn't near its limit; the other way is shorter loops.
5. **The district's draw calls** stand at 179 in the heaviest view against 200. Recommended: keep the budget and merge the pier's props when the crowd goes in, so the crowd's dozen figures fit.

#### 20.8.4 Results

To be filled in when Jared has played it.

### 20.9 Follow-up: lean, peek and putting out lamps (2026-11-15)

Piece E's stretch (§20.4 row E, §20.5), which missed 0.7.0 (§20.8 "Scope that didn't make it"): §17's cuts #2 (lean/peek) and #3 (lamp extinguishing) are taken back and built. Built alongside the daytime crowd (0.7.1) and independent of it.

| Part | Where | What it does |
|---|---|---|
| Lean and peek | `onfoot/lean.ts`, `ashore.ts`, `core/input.ts` (`LeanLeft` Q, `LeanRight` E) | Standing still with your hands free, Q and E lean to the left and right of where you look: the head goes out up to 0.6 m, eased in about a fifth of a second, and stops short of a wall (a short march against the colliders at head height). Moving, swimming, a ladder, a vault, a crate or a man over your shoulder straightens you. The camera's pivot goes out with the head, and the captain's figure tips toward it. |
| Lean in perception | `perception.ts` (`Figure.leanX/leanZ`, `coverSeen`), `stealth.ts` (`StealthInputs.lean`) | The three sight lines go to the head at the full lean, the chest at half and the hips over the feet, so peeking round a corner shows a guard one third of you. The light is read where your head is, so leaning out of a shadow into a lamp's pool lights you. |
| Putting out a lamp | `onfoot/douse.ts`, `watch.ts` (`douseOffer`, `douseLamp`, F after a lock, crate or gangway), `light.ts` (`Lamp.doused`), `district-guards.ts` (`lightLamps`) | After dark, F held at the foot of a lit lamp (1.3 m from the post, the flame no more than 4 m above your feet): 1.5 s to turn down a gas lamp's cock, 0.8 s to blow out a lantern on a post or a hook. It's out of the light gem, the guards' sight and backlighting at once. A small noise (`douse`, 2.5 m), and any guard who sees you at it grows wary and comes to look. It stays out until it's relit; at dawn every lamp goes out and the doused ones are forgotten. Not saved: a reload ashore finds them all lit. |
| Guards relight it | `stealth.ts` (`noticeDoused`, `relighting`, `NOTICE_DOUSED_M` 25 m, `RELIGHT_S` 3 s, the `LampRelit` event) | A guard on his round (patrol or return) who has a doused lamp in his sight, inside 25 m and with nothing in the way, goes over in the `distracted` state, uneasy (his meter at half of suspicious) but not alarmed. He stands at the post three seconds and lights it, then looks round as after any distraction and goes back to his round. One guard per lamp; a thrown stone, an alarm or anything else that takes him off it frees the lamp for the next. Sailors on deck watch stay at their gangways. |
| Drawn | `render/district/district-view.ts`, `kit-meshes.ts` (`dousedGlassGeometry`), `foot-view.ts` | A doused lamp gives no pool, and its glass is covered by dark glass, one small mesh rebuilt only when the set changes (one draw call at most). |
| Dev | `main.ts` (`__glpFoot.lamps()`, `douse(k)`, `lean()`) | Read the lamps and the lean; put a lamp out as F would. |

**Checked:** `tests/lean-douse.test.ts` (the lean's reach, a wall stopping it, peeking round a corner shows a third of you; the douse prompt's reach and hold times; a doused lamp dark through the night and forgotten at dawn; a watchman relights one in the greybox, a sailor doesn't), `tests/district-watch.test.ts` (on the real district, the packing house's watchman sees the Front Street gas lamp out and lights it again, about 16 s in), and `e2e/lean-douse.spec.ts` (E leans in the game; F held at a gas lamp turns it down). Screenshots in the project's `lean-douse/` folder.

**Found on the way:** with no clouds under a bright moon the sky's light is over `LAMPS_LIT_BELOW` (0.3), so the district's lamps aren't lit at all on those nights (as the guards' lanterns aren't). It's the old "moonlight schedule" some towns kept, so it's left as it is, but it means there's nothing to douse on a clear full-moon night. `lineBlocked` doesn't honor a collider's `blocksSight: false`; the relight's sight line ends just this side of the lamp's own post to get round it.

**Not done:** the lean has no sound and no animation beyond the figure's tilt (the captain is still the capsule in the game); putting out a lamp has no sound of its own, since the audio is at 4.96 MB of the 5 MB budget (§20.8.3 decision 4); a lit window can't be doused; doused lamps aren't saved.

---

### 20.10 Phase 9 piece F: the island posse searches (2026-11-17)

**Result:** built, from [11 §18](11-exploration-islands-secrets.md)'s piece F. It settles §20.8.3 decision 2 and the gap [09 §16.10](09-hideouts-building-crafting.md) left ("the island posse on foot doesn't break off at the build bounds").

| Piece | Where | Notes |
|---|---|---|
| Landing | `island-posse.ts` `land`, `landingNear` | At tier 4+ the marshals put in 45 s after you set foot on any walkable island that isn't the mainland (25 s from tier 5), on the dry ground nearest your boat: the beached rowboat, or the ship at her anchorage. Never on a pier or a ledge, and only where a walk leads inland. The tier is read when they land, so heat earned ashore counts. Notice: "A marshal has put in by your boat" |
| The sweep | `sweepRoutes` | Arcs at 18, 40, 65 and 95 m round the landing, a stop every 22 m with a 3 s look about, walked back and forth outward. Two marshals split the circle, a half each. Stops in the water, the hideouts' bounds or out of walking reach drop out. Sight and hearing are the watch's own (`createStealth`) |
| Giving up | `giveUp`, `GIVE_UP_S` | After 4 minutes with nobody suspicious of anything (6 from tier 5), or the sweep walked to its end, they walk back to the landing and put off ("The marshals' boat puts off"); they're gone for that landing. Seen on the way back, the search is on again |
| The hideout's bounds | `closeSanctuaries`, `StealthInputs.unseen`, `Stealth.breakOff` | The bounds are cut out of the posse's grid, so they never set foot there. With you inside them they neither see nor hear you, and a chase, a search or suspicion breaks off ("The marshals break off: you're home"; `PursuitEndedAtHideout` by `npc.marshal`). A marshal who had you in sight as you went in spots the place (06 §5.4): "Seen by the marshals" in the build palette, and the week's talk |
| Wiring | `ashore.ts`, `main.ts` | `deps.posse` gets where your boat lies; the posse's voices go to `audio.foot` through `posse.on`. `Stealth.reroute` gives a guard a new beat |
| Dev | `__glpFoot.posse()` (phase, landing, clock, guards placed), `posseLand()`, `posseGiveUp()` | |
| Tests | `tests/island-posse.test.ts`, `e2e/island-posse.spec.ts` | Count by tier; nobody before the time's up; the landing by the boat; the sweep outward in two sectors; giving up and putting off; the chase as danger; breaking off at a hideout's box, never stepping in it, and seeing you go in. The e2e lands one at Stockton, sees him sweep, has none come when clean, and runs from him into the Presque Isle bounds |

**Not in piece F:** tracks in snow (piece M); a posse on the mainland camp pad (still none, as Phase 8 decided). Screenshots are in the project files (`posse-search/`).

## Changelog
- v0.16: Phase 9 piece F (2026-11-17): the island posse searches (§20.10). The marshals land by your boat, sweep outward, give up and put off, and break off at a hideout's build bounds without setting foot in them.
- v0.15.1: 0.7.2 (2026-11-16), from Jared's play of 0.7.1: `render/district/signs.ts` hangs a painted board (a canvas texture, one material per building) over each building's first door, on the wall that door is set in and clear of its battens. It says the building's `name`, or else its use by kind. A false front's blank board (kit-meshes `roofGeometry`) gets the words instead. The salt sacks at (-27, 0) and the net reel at (-74, 0) moved off the track to z = 2, and the navmesh was rebaked. Parked at Jared's call: a soft disc on the ground that follows the player by day, cause not yet found.
- v0.15: Lean, peek and putting out lamps (§20.9): §17's cuts #2 and #3 taken back.
- v0.14: Piece K (2026-11-16, 0.7.1): the daytime crowd. `crowd.ts` puts three townsfolk and dockhands at each `crowd` mark of the district, strolling on the navmesh by day and gone at dusk; they are scenery, outside the stealth layer and perception, and drawn as the watch's figures (§2.3). Together with the dev Ashore jump, the crowd is the last of the 0.7.0 playtest's open calls.
- v0.13.1: Jared's decision on piece J's first call (2026-11-15): 0.7.0 is tagged as it stands and the daytime crowd comes next as 0.7.1. The dev Jump to menu gains an Ashore folder: Bayfield (the fish pier, on foot) and Stockton (anchored off the quarry, landed on the wharf), through `?ashore=bayfield|stockton`.
- v0.13: Piece J (2026-11-15): the playtest and release (§20.8). Each exit criterion as checked in the container, the benches (72 draw calls for the district alone, 61–179 in the game with twelve guards, 60 on the island, perception 0.065 ms a tick), a worked heist time and a burglar's season's save size, the island posse's chase counted as danger, the laptop route and five decisions for Jared.
- v0.10: Piece F, part one (2026-11-14): the counters you trade at on foot. `shop` marks in the district layout (`data/districts/bayfield.json`, with an `opens` of their own: a port tab or `saloon`) at the general store, the chandlery, the harbor office desk, the saloon's bar and the table in its back room; `shops.ts` gives the prompt in the building's hours (`tools.json` `conduct.hours`) and the port control's `openShop` shows the screen with that one tab under the shop's name, with no arrival, wait, go ashore or cast off (decision 3's shop doors, built as counters since the buildings are walked into). The back room's table is the 0.6.0 fence and shipwright after dark on the same snapshot and actions (§20.3 #8, `tests/shops.test.ts` against the tab), Bayfield's port-screen tab is retired (`walkInBackRoom`) for a line in the saloon, and Duluth keeps its tab (§20.5). The keeper sells `store.whiskey` at the bar. Keepers are drawn behind open counters and a lantern hangs in the back room (the navmesh rebaked for the layout's hash; no collider changed). The First Week's step 6 is an optional line ticked by `crime.burglary`. Calls made: you trade from wherever you stand inside the shop within 2.4 m of the mark, not at the door; shops don't serve while a guard is after you; the saloon's bar keeps the building's hours (9 to 1) and the fence his own (dark, and before the saloon shuts). The whiskey trick with crews in the saloon and on moored ships, their holds, cabins and deck watches are part two.
- v0.10.1: Piece F, part two (2026-11-15): moored ships and the whiskey trick (§6.2). `moored.ts` sets the traffic's berthed ships (`GameTraffic.berthed()`, at most two, by id) down in the district: the pier side with dry deck, a gangway there, a hold forward and a cabin aft of it, a hull collider, and a `npc.sailor` deck watch added to the district's base guards. Hold and cabin are extra heist containers keyed `ship.<id>` (`HeistOptions.extra`, live only while she's alongside), so a ship is a building to the foot law and her burglary is one incident. `crew` marks in the saloon seat her crew in `whiskey.trick.saloonHours`; `Watch.standCrew` spends `bottlesFor(crew)` (one per `crewPerBottle`, halved by `perk.whiskey_trick`), makes her watch drunk through the existing `makeDrunk`, and records `{night, passOutAt}` in the district's world state (`crews`) so a reload or a trip aboard the same night finds him as he was. `crewEvidence` replaces the dawn evidence witness for a ship: her mate at dawn sober, her crew `lateReportH` after dawn and `unknown` drunk. Tuning is all in `data/tools.json` `whiskey.trick`. Calls made: the deck watch stands on the pier, not aboard, so nothing needs a walkable deck; the cabin is reached from the pier behind a lock rather than through an interior; the friendly visit by day is the tool belt's whiskey offer to the watch, not a separate scene. Not done: her manifest at sea isn't reduced by what you take, and crates still draw on the port's stock (`takeStock`).
- v0.11: Piece G (2026-11-15): the lockup and the jailbreak (§9). `data/jail.json` gains a `jailbreak` block (start and dawn hours, the cell door and its lock tier, the jailer's round, the keys' lift time and reach, the bang's radius and cooldown, the promise's price by tier, due days and heat, the irons, the tier-5 extra guard); `sim/law/jail.ts` gains the rules (`breakoutRefusal`, `beginBreakout`, `recapture`, `escapeJail`, `owePromise`, `settleDebt`) and the save a `jail.breakout {attempts, active}` and an optional `jailDebt`, both defaulted, so no save version change. `onfoot/jailbreak.ts` is the scene: `jail` marks in the district layout place the cell, the jailer's three stops and the tier-5 posts; the jailer is a constable added to the district's base guards on a looped round; the cell door is a bars leaf that blocks walking and not sight, so he sees you and you see him. `capture.ts` drives it from the jail screen (`actions.jailbreak`), through `ashore.breakOut`, to `jailbroke` (free, `crime.jailbreak` committed with the constables as witness at dawn) or `recaptured`/dawn (`recaptureWeeks` more, or the gallows on the one chance). Calls made: the attempt always starts at night (the clock runs on to `startHour`); the Wanted tier is treated as 0 for the watch while you're still in the cell, so sitting in it isn't a crime; "a shift change" became the jailer's stop at the bars with his back turned, which reads from the cell without a second jailer; the lure is the bang itself, he comes to the door and opens it, because guards walk the navmesh and the cell isn't on it; the promise is settled from the purse on its due day, not carried to him; a regular prisoner may try again another night, a tier-5 one once; a reload mid-attempt is a loss. Not done: the rowboat way out (the district is only landed at from its piers), a crafted pick, and an impound yard apart from the city dock. The gap table's `JailScreen.tsx` row is closed by this.
- v0.12: Piece I (2026-11-15): on-foot audio, written up in [15 §20](15-audio.md). `ashore.ts` counts strides for the sounds (`deps.sounds.step`, `landed`) and gives the audio a per-frame readout (`sound()`: where you stand in zone meters, swimming, the water's temperature, the place, under a roof or not, the saloon and its hours, the guards, a pick's progress). `main.ts` subscribes the watch's, the tools', the heist's, the jailbreak's and the island posse's events to `audio.foot`. Not done: the rowboat's oars, walls muffling voices, and the wildlife and cold sounds, which go with Phase 9.
- v0.9.1: Piece H, part two (2026-11-12): the marshal posse on the island (`island-posse.ts`, marshals from the tier's roster on the quarry's beats, navigated on a grid over the island's built scene) and `bench.island` (`bench/island`, 62 draw calls at the median on the laptop). Done with the island's walk and its posse; the playtest is piece J.
- v0.9: Piece H, part one (2026-11-11): Stockton built whole on its 1 m tiles when you land on it (`island-ashore.ts`, `loadIslandGround`), with the 4 m terrain around them; trunks and shore rocks as colliders on every landing, from the renderer's own planting and clearings (`zoneClearings`, `plantColliders`) at the preset's density; the quarry prefab (`pois.json`: spoil wharf with a ladder, two cut ledges, derrick, blocks, office shack) placed by `islands.json` on the drawn ground and drawn as one merged mesh (`poi-view.ts`); the quarrymen's cache in one of three cairns by the run's seed (`rollCache`, `caches` in the save); F at the stash strongbox opens its storage. The marshal posse and `bench.island` are part two.
- v0.8: Piece E, part two (2026-11-11): locks, loot and carrying (`heist.ts`, `locks.json`, `loot_tables.json`, `targets` in `districts.json`). The Hollister warehouse, packing house, dock warehouse, chandlery and harbor master's office lock in their hours behind a door leaf you can't pass or see through; hold-to-pick keeps its progress, clicks and snapped picks by tier, the crowbar forces in a second or two at 14–18 m of noise, and the bolt slips from inside. Containers at the loot marks roll their crates, cash and papers per stocking (two game days, by season) and remember what's gone in the save's `districts` record. Crates go one at a time in your arms (70% walking speed, no crouching, carrying noise, the `loot` conduct), out of Bayfield's market stock, to the gangway and into the hold hot with the owner's marks. Papers are a sure shipment rumor. Each building robbed or forced is one `crime.burglary` (now with a grudge of 10) reported at dawn by its owner, by "someone", unless a guard who saw your crates adds himself as a witness and names you. The crowbar, a stone (a distraction where it lands, last in F's order), the pistol (the chandlery's at Known) and the rifle (the ship's) join the belt, keys 1–9. Calls made: the grudge rises when the burglary is named to you, as piracy's does; the pistol has no ammunition count; lean, peek and dousing lamps stay §17's cuts.
- v0.7: Piece E, part one (2026-11-11): conduct (`conduct.ts`: trespass by building and shop hours from `tools.json`, after-hours areas, skulking, running and swimming at night, a weapon in hand, carrying a man), the cosh, rope, knife, whiskey and bribes on a tool belt (`tools.ts`, `tools.json`), carrying and sinking bodies, and their crimes (`foot-law.ts`: one crime per incident, a woken man's assault report, the murder investigation tied to a face learned tonight, `crime.bribery`). Strikes reach 1.7–1.8 m, past the 1.2 m where a guard feels you behind him. Locks, the crowbar, throwables, the pistol and rifle on foot, loot, carrying crates, evidence and stock are part two.
- v0.6: Phase 7 scope (§20), approved 2026-11-10 with Stockton, the rowable boat and the port screen first: what Phases 4–6 change, deliverables, exit criteria, ten work pieces, smaller calls and three decisions.
- v0.5: S5 playtest: a hop on Space, smoother slope measurement and control on steep patches, so rough ground doesn't snag you.
- v0.4: Spike S5 written up (§19): the hand-rolled controller is good enough without Rapier; crouch moved off Ctrl.
- v0.3: Gap review: Bayfield lockup for MVP jail and jailbreaks, rifle added to on-foot tools, disguises removed, scent removed from the changelog.
- v0.2: Decisions: day-walkable districts, third-person, lethal weapons on foot, swimming, hold-to-pick, no dogs (snow tracks remain).
- v0.1: Initial docks stealth plan: district structure and MVP list, day/night modes, controls, movement and noise, perception (sight, light, hearing, recognition), NPC types and FSM, tools and the whiskey trick, loot and carrying, heist targets, the jailbreak scenario, escape and capture, time/light/weather, HUD, the modular kit and shared layout editor, budgets, data/state, Phase 7 acceptance.
