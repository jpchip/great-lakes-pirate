# 08 — Docks District Stealth (Night)

Status: DRAFT v0.4 (decisions made; gap review applied; spike S5 written up)
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
- WASD move · **Shift** run · **C** crouch (sneak; not Ctrl, see §19) · **Space** vault or climb (at marked spots: crates, fences, low roofs, ladders) · **F** interact · **Q/E** lean or peek · **LMB** use the selected tool · **RMB** aim a throw · **1–6** tool belt · **Tab** inventory · **M** district sketch map · **Esc** pause.
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
- **Characters:** one stylized low-poly humanoid base with a shared skeleton and animation set (walk, sneak, run, carry, climb, idle, knockout, search, alarmed). Variety comes from palette swaps and accessories (hats, coats, lanterns). The player model takes appearance options from character creation.

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

---

## 19. Spike S5: On-Foot Controller (results, 2026-10-23)

**Question** ([01 §11.2](01-tech-architecture.md)): is a hand-rolled capsule controller on a heightmap island chunk plus box/cylinder props, with a pointer-lock camera, good enough without Rapier?

**Answer: yes.** Keep the hand-rolled controller for docks, islands and hideouts. Rapier stays a fallback we don't expect to need.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Heightfield | `src/gameplay/onfoot/heightfield.ts` | Bilinear height, gradient and slope over a regular grid. It takes the 1 m on-foot tiles from S3 as they are. |
| Colliders | `src/gameplay/onfoot/colliders.ts` | Yawed boxes, vertical cylinders and an occupancy grid for gridded buildings (plan 09), all as footprints extruded between `minY` and `maxY`. A 4 m spatial hash keeps queries local. |
| Controller | `src/gameplay/onfoot/controller.ts` | A capsule (r 0.3 m, 1.75 m standing, 1.15 m crouched). Sub-stepped moves (never more than r/2 per step), push-out from footprints, step-up to 0.4 m, ground snap 0.45 m, a 42° slope limit with sliding, gravity, and swimming in water deeper than 1.3 m. No three.js, so it unit-tests in Node. |
| Camera | `src/gameplay/onfoot/camera.ts`, `src/core/pointer-look.ts` | Third-person over the right shoulder with pointer-lock yaw and pitch. The boom marches against terrain and props, snaps in, then eases out. |
| Mode | `src/modes/on-foot.ts` | The `onFoot` mode: the clock at **R = 6**, the `onFoot` input context, and the controller on the fixed tick with render interpolation. It isn't wired into the main boot yet. |
| Test scene | `onfoot-spike.html`, `src/debug/onfoot-spike/` | A dev-only page (`npm run dev`, then `/onfoot-spike.html`) that isn't part of the production build. It's a seeded 128 m island at 1 m resolution with a cliff band and one walkable gully, a pier over deep water, 140 trees and 50 boulders, plus a test yard (stairs, a 0.6 m ledge, a crouch-only overhang, crates, a 0.8 m alley and a gridded L-shaped building with a door). `?props=2000` adds stress props and `?hz=30` changes the tick. The HUD shows frame time, draw calls, controller cost, gait, slope and the clock. |

### Results
| Check | Result |
|---|---|
| Walk, run, sneak speeds (2.4 / 5.2 / 1.3 m/s) | Feel right at a third-person distance. Tune them with guards in Phase 7. |
| Stairs (0.25 m rises), low crates (0.35 m) | Walked up smoothly with no vault. |
| 0.6 m ledge, waist-high crates, walls | Block, and you slide along them. These are the "vault at marked spots" cases (§3.1). |
| Crouch-only overhang (1.3 m clearance) | You can't pass standing. You can crouch under, and you can't stand up beneath it. |
| 0.8 m alley | Passable. Corners and rotated boxes don't snag. |
| Terrain over 42° | Blocks uphill movement and slides you down. The gully is walkable, so cliffs become barriers with authored paths, as plan 11 §3.1 wants. |
| Pier and water | Run along the deck, drop off, swim (head above water), swim under the deck between pilings, and walk out up the beach. |
| Tunneling | None, even through a 5 cm wall at a 10 Hz tick (unit-tested). |
| Determinism | Same inputs give the same state (unit-tested), which keeps replays and tests honest. |
| Controller cost | About **0.004 ms per tick** with 232 colliders and **0.008 ms** with 2,232 (headless Chromium in a cloud container, 6,000 ticks). The 3 ms tick budget ([01 §5](01-tech-architecture.md)) leaves room for 12 guards running the same controller. **Re-check on the dev laptop** with the HUD. |
| Draw calls | 6 for the whole chunk, because props are two instanced meshes. Rendering, not collision, will set the docks budget. |

### Findings for later phases
1. **Crouch must not be Ctrl.** Ctrl+W (crouching while walking forward) closes the browser tab, and pointer lock doesn't stop it. The default binding is now **C** only.
2. **Interact key mismatch:** §3.1 says **F**, but the input map's `onFoot` context has `Interact` on **E**, which §3.1 gives to lean/peek. Settle this when lean lands.
3. **Vault and climb** (Space at marked spots) and **ladders** were out of scope. They fit the same model: a marked collider tags its top as a target and a short scripted move carries you up.
4. **Camera close mode indoors:** the boom collision works but gets very close under low roofs. Add the planned close mode (shorter boom, lower shoulder) when interiors land.
5. **Fall damage** (plan 11 §3.2) only needs the landing speed, which the controller already has at the moment it lands.
6. **Noise and surfaces** (§3.2): the gait (`sneak`/`walk`/`run`/`swim`) plus the collider underfoot is enough to look up surface noise. Tag colliders with a surface when the kit lands.
7. **Navmesh:** guards can share this controller for collision; their paths still come from the baked navmesh ([01 §4.5](01-tech-architecture.md)).

---

## Changelog
- v0.4: Spike S5 written up (§19): the hand-rolled controller is good enough without Rapier; crouch moved off Ctrl.
- v0.3: Gap review: Bayfield lockup for MVP jail and jailbreaks, rifle added to on-foot tools, disguises removed, scent removed from the changelog.
- v0.2: Decisions: day-walkable districts, third-person, lethal weapons on foot, swimming, hold-to-pick, no dogs (snow tracks remain).
- v0.1: Initial docks stealth plan: district structure and MVP list, day/night modes, controls, movement and noise, perception (sight, light, hearing, recognition), NPC types and FSM, tools and the whiskey trick, loot and carrying, heist targets, the jailbreak scenario, escape and capture, time/light/weather, HUD, the modular kit and shared layout editor, budgets, data/state, Phase 7 acceptance.
