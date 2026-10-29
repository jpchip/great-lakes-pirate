# 02 — Arcade Sailing & Ship Handling

Status: DRAFT v0.6 (decisions made; gap review applied; S2 buoyancy notes; Phase 1 built and playtested; 0.1.0)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- [01 tech/architecture](01-tech-architecture.md): minimal physics, 30–60 Hz tick, budgets, shared wave function
- [03 world scale](03-world-scale-chart-travel.md): C = 8, R = 24, `v₃ᴅ = v_game × R / C`
- Master plan: arcade feel, solo start, invisible crew by tier, weather matters, mouse and keyboard
Feeds: 04 (wind/waves/weather inputs), 06 (pursuit, dark running), 07 (combat platform), 10 (upgrades and tiers), 13 (HUD)

## Purpose

Define how the schooner feels and handles: controls, the wind and speed model, wave motion, weather effects, hazards and damage, mooring, ship tiers, and how NPC ships reuse the same model. Phase 1 ("sailing feels good") is built from this plan.

---

## 1. Feel Goals

1. **Readable wind.** At any moment the player knows where the wind is and how good their angle is, without reading numbers.
2. **Easy to steer, rewarding to master.** Anyone can sail in 30 seconds. Good players are noticeably faster: good angles, clean tacks, smart sail handling, and using shallows and islands.
3. **Weight and momentum.** It's a heavy wooden ship, not a jet ski. Turns and speed changes take a few seconds, which makes positioning (for combat or docking) a skill.
4. **The lake is the opponent.** Wind shifts, fog, storms and ice change how you sail, not just what you see.
5. **Cheap.** No rigid-body physics. Arcade kinematics plus a few wave samples, within [01 §5](01-tech-architecture.md) budgets.

---

## 2. Controls (mouse and keyboard)

| Action | Default | Notes |
|---|---|---|
| Rudder left / right | **A / D** | Analog feel via ramp-up; release to center |
| Raise / lower sail (one step) | **W / S** | Steps: Furled → Reefed → Half → Full (see §3.2) |
| Trim sheets in / out (optional) | **Q / E** | Manual trim (see §3.4); auto-trim by default |
| Drop / weigh anchor | **X** (hold) | Stops the ship over a few seconds when depth allows |
| Sweeps out / in | **R** | Row in a calm (§3.6). Added in Phase 1; plan 02 had no key for it |
| Lantern on / off (dark running) | **L** | Running dark lowers visibility at night (plan 06) |
| Spyglass | **Right mouse (hold)** | Zoomed view; identify ships, flags and lights at range |
| Camera orbit / zoom | Left or middle drag (free cursor) / wheel | See §8. Drag rather than plain mouse move, so the cursor stays free for the HUD (Phase 1) |
| Interact (moor, go ashore, board) | **F** | Context-sensitive |
| Chart | **M** | Locked while detected by a hostile ([03 §5.4](03-world-scale-chart-travel.md)) |
| Combat aim / fire | Reserved: **Tab** aim mode, **LMB** fire | Defined in plan 07 |

All bindings go through the input action map ([01 §4.8](01-tech-architecture.md)), so they can be rebound.

---

## 3. Speed Model

### 3.1 Formula
```
targetSpeed (game knots) =
    hullMaxSpeed
  × sailLevelFactor          (§3.2)
  × polar(apparentWindAngle) (§3.3)
  × windStrengthFactor       (§3.5)
  × trimFactor               (§3.4)
  × riggingCondition         (0.5–1.0, from rigging damage)
  × loadFactor               (1.0 empty → ~0.8 full hold)
  × seaStateFactor           (head seas penalty, §5)
  × iceFactor                (winter, §5)
```
- Actual speed approaches `targetSpeed` with **inertia**: acceleration and deceleration time constants per ship (heavier = slower; ~4–8 s to reach 63% of the target).
- Speeds are tuned and authored in **game knots** (data fields end in `Kn`); the data loader converts them to m/s for the sim ([01 §8](01-tech-architecture.md)). The render layer converts game speed to 3D meters per second with `v₃ᴅ = v_game × R / C` (with C = 8 and R = 24, ×3 → 8 kn ≈ 12.3 m/s on screen).
- The wind angle used is the **true wind relative to the heading** (arcade simplification; no apparent-wind math).

### 3.2 Sail levels
| Level | Factor | Use | Change time (T1 solo / T2 / T3) |
|---|---|---|---|
| Furled | 0.0 (drift only) | Anchoring, docking, hiding | — |
| Reefed | 0.45 | Storms, maneuvering in tight water | 4 s / 3 s / 2 s per step |
| Half | 0.75 | General sailing, strong wind | |
| Full | 1.0 | Best speed in light-to-moderate wind; risky in strong wind | |

**Solo handling (T1):** sail changes are slower because one person is doing everything. That's the main "no crew" penalty, and it's felt without any crew management. Larger tiers (with an invisible crew) change sails faster.

### 3.3 Points of sail (polar curve)
A fore-and-aft rigged schooner points relatively well upwind and is fastest on a broad reach.

| Wind angle off the bow | Name | Polar factor (draft) |
|---|---|---|
| 0–40° | **In irons (no-go zone)** | 0 → the ship slows to a stop; sails luff (flap) |
| 45° | Close-hauled | 0.60 |
| 60° | Close reach | 0.80 |
| 90° | Beam reach | 0.95 |
| 120–135° | **Broad reach** | **1.00** (fastest) |
| 150° | Deep broad reach | 0.90 |
| 180° | Running (dead downwind) | 0.75 |

- The curve is a smooth spline (`ships.json` → `polar[]`) so it can be tuned per ship class.
- **Leeway (light):** close-hauled, the ship slips slightly sideways (a few degrees). Purely a feel detail; cut if it confuses players.

### 3.4 Trim
- **Auto-trim (default):** sheets are always set "good enough," with trimFactor = 0.92.
- **Manual trim (optional skill):** Q/E move the trim. A **sweet-spot band** shown on the HUD wind gauge gives trimFactor up to **1.0**; being off gives as low as 0.7. The band shifts as the wind angle changes, so it needs attention.
- Manual trim gives skilled players ~8% more speed, which is enough to matter in chases without being mandatory. The toggle is in settings (and a perk hook for the *Deckhand* background).
- **Decided:** auto-trim is the default; manual trim is an option in settings.

### 3.5 Wind strength
Wind speed comes from the weather system (plan 04) via `windAt(position, time)`.

| Wind (kn, game) | Condition | windStrengthFactor | Notes |
|---|---|---|---|
| 0–3 | Calm | 0.0–0.2 | Becalmed. **Sweeps** (long oars) give ~1.5 kn on T1/T2 (§3.6) |
| 4–9 | Light | 0.4–0.8 | Full sail is best |
| 10–18 | Moderate | 0.9–1.0 | Ideal sailing |
| 19–27 | Strong | 1.0 (capped) | **Overpressed** at Full sail: rigging stress and heel; reefing is wise |
| 28–40 | Gale | 1.0 at Reefed only | Full or Half sail risks **rigging damage** and a **knockdown** (§6.4). Big waves. |
| 40+ | Storm | — | Survival: reef, run before it or shelter in the lee of land |

**Overpressing:** carrying too much sail for the wind builds a "strain" meter. Past a threshold, rigging takes damage (sails tear, which reduces riggingCondition). The HUD warns early (creaking audio, a flashing sail icon).

### 3.6 Sweeps (calm-weather oars)
- **Decided:** T1 and T2 can use **sweeps** in a calm: ~1–1.5 kn, slow turning. Historically plausible for small craft, and it prevents frustrating dead stops. Sweeps also work in the lee of an island where the wind is blocked (§11).
- T3 is too big; it relies on the wind. **Decided:** T3 can hire a **harbor tug tow** in calms to get in or out of a harbor ([05 §7](05-ports-economy-trading.md)); there's no tow at sea.

---

## 4. Turning, Tacking & Momentum

- **Turn rate depends on speed** (rudder needs water flow): low at near zero speed, best at moderate speed, slightly reduced at top speed. A heavier ship turns more slowly.
- **Tacking** (turning the bow through the wind):
  - Speed bleeds while crossing the no-go zone.
  - If the ship enters irons below a minimum speed, it **stalls** and drifts backward until it falls off one side. This is a classic sailing mistake and teaches the player to build speed before tacking.
  - A clean tack with good speed takes ~6–10 s and loses ~30–40% of speed.
- **Jibing** (turning the stern through the wind): fast, with little speed loss. In **strong wind or above** at Full or Half sail, an uncontrolled jibe deals rigging damage. Reefing first avoids it.
- **Momentum:** dropping sail doesn't stop the ship instantly. Coasting distance matters for docking and shallow-water escapes.

---

## 5. Waves, Motion & Weather Effects

### 5.1 Wave motion (cheap buoyancy)
- One **shared wave function** (a sum of Gerstner waves; the parameters come from the weather state) is evaluated on the GPU for visuals and on the CPU for gameplay ([01 §4.1](01-tech-architecture.md)).
- The player ship samples **4–6 hull points** (bow, stern, port and starboard pairs) each tick. Heave = average height; pitch and roll = differences. Damped springs smooth them.
- **Heel** is added on top: the lean from wind pressure × sail level × wind strength, which makes strong wind visible. It's visual, plus a cannon-accuracy modifier in plan 07.
- NPC ships: full sampling only when near the camera. Distant ones use a single height sample. Abstract ones use none.
- **Spike S2 (2026-10-23):** built in `src/gameplay/buoyancy.ts`. Six samples (bow, stern, port and starboard pairs at ±L/4) on the first 4 waves; heave is the mean, pitch is the fore trio vs. the aft trio, roll is port vs. starboard. Schooner starting values: sample span 26 m × 6.5 m, natural periods heave 3.2 s, pitch 3.8 s, roll 4.6 s, damping 0.55. About 4 µs per ship per tick. Full write-up in [04 §19](04-water-weather-seasons.md).

### 5.2 Weather effects on sailing
| Weather | Sailing effect | Other effect |
|---|---|---|
| Wind shifts and gusts | Direction varies slowly; gusts spike strength for a few seconds | Gusts can overpress the ship suddenly; a reason to reef |
| **Head seas** (big waves on the bow) | seaStateFactor down to ~0.8; pitching | Spray, green water on deck in gales |
| Following seas | Slight surfing boost on crests (arcade fun) | Risk of broaching in a storm at Full sail |
| **Fog** | None directly | Visibility drops sharply (stealth and navigation; plan 06). The lead line and depth readout matter. |
| Rain / snow | None | Visibility down; night stealth up |
| **Storm** | Big waves, strong gusts, rigging strain | Hull stress damage over time if beam-on to big seas; lightning flashes reveal you at night |
| **Ice (winter)** | iceFactor (drag) in slush and floes; **floe collisions** damage the hull (less with an **ice-strengthened bow** upgrade) | Frozen harbors and bays are impassable; ice that shifts with the wind can trap the ship |
| Calm | Becalmed; sweeps only | Fog is likely |

---

## 6. Hazards, Damage & Sinking

### 6.1 Damage pools
| Pool | Effect when damaged | Repaired by |
|---|---|---|
| **Hull** | Leaks (water in the hold → slower, lower in the water); at 0 → sinking | At-sea patch (uses lumber and pitch from cargo; partial only) · shipyard or hideout drydock (full) |
| **Rigging/sails** | Lower riggingCondition (speed), slower sail changes | At-sea mend (canvas and rope; partial) · chandlery or shipyard (full) |
| *(Weapons and other systems)* | Plan 07 | |

### 6.2 Depth & grounding
- Each ship has a **draft** (by tier, plus cargo load).
- Depth comes from the terrain data ([03 §8](03-world-scale-chart-travel.md)). **Aground** when depth < draft:
  - At low speed: stuck, minor damage. Refloat by weighing anchor and kedging (a small minigame: drop anchor ahead and haul), waiting for a wind change, or **jettisoning cargo** to reduce draft.
  - At high speed: stuck plus hull damage scaled by speed.
- **Rocks and the shoreline** (shoreline SDF ≈ 0 with steep slope): hard collision, push back, heavy hull damage.
- **The depth readout** (a lead-line icon) warns when depth < 2× draft. Fog and night make this a key instrument.
- **Shallow-draft advantage:** smaller schooners can slip over bars and into bays where deep-draft freighters and the cutter can't follow. This is a core escape tactic (Seavey-style) and the reason T1 stays useful.

### 6.3 Ship-vs-ship collisions
- Each hull is a **2D oriented capsule** on the water plane. Overlap is resolved by pushing apart according to mass. Damage scales with relative speed and angle.
- **Ramming** is possible but hurts both ships. Detailed combat ramming is in plan 07.

### 6.4 Knockdown (instead of capsizing)
- No full capsize simulation. In a **gale or storm at Full or Half sail** with high strain, or broaching in following seas, a **knockdown** event fires:
  - Heavy rigging damage, some hull damage, and a chance of **losing cargo overboard**.
  - The camera shakes, the ship lurches far over, then recovers.
- It's dramatic, punishing and cheap, and it never sinks the ship by itself.

### 6.5 Sinking & permadeath
- When hull reaches 0, the ship **founders over ~20–40 seconds** (it settles, lists, then goes under).
- **Decided: abandon ship in the rowboat.** While foundering, press **F** to take to the rowboat:
  - **Survival check:** distance to the nearest land or friendly or neutral vessel, sea state, season (winter water is deadly), and night or fog. Nearby land in moderate weather is nearly certain survival. Far offshore in a storm or winter ice is very likely death. The HUD shows a clear risk rating before you commit.
  - On success, the **ship and all its cargo are lost**. The player ends up in the rowboat near the wreck (or is picked up by a passing vessel, which may recognize a wanted pirate).
  - Staying aboard, or failing the survival check, means **death**: the run ends (permadeath).
  - The wreck stays in the world as a **salvage site** (some cargo recoverable later by diving or grappling; plan 11).
- **Decided: play continues without a ship.** Being shipless or stranded is a setback, not game over.
  - **The rowboat** is a minimal vessel: rowed slowly (~2–3 kn), within a coastal zone only (no chart travel), easily swamped in waves, tiny cargo (a few crates). In the compact Apostles it can reach nearby islands and towns.
  - **Buy passage** on a steamer or ferry between ports (a paid fast-travel between zones, abstracted through the chart; plan 05 sets prices). There's a risk of being recognized if Wanted is high.
  - **Ways to earn without a ship** (plans 05, 08, 12): sell goods stored at hideouts, docks labor and odd jobs, docks-district theft, poaching and trapping on islands, fishing from the rowboat.
  - **Hideout storage matters here:** goods and gold stashed at hideouts become the recovery fund. This rewards the logistics play from the per-hideout storage decision.
  - When you can afford it, buy a new T1 (or better) schooner at a shipyard, or build a T1 from materials at a hideout slipway ([09 §7.4](09-hideouts-building-crafting.md), [10 §9](10-ship-upgrades-customization.md)).

---

## 7. Mooring, Anchoring & Going Ashore

- **Anchoring:** hold **X** where depth ≤ anchor rode (~30 m game-depth for T1). The ship swings to the wind. Anchoring in a gale may **drag** (an anchor-holding check), which risks grounding.
- **Docking:** approach a berth in a harbor set piece slowly (< 2 kn) inside the berth zone and press **F**. An **auto-dock** animation brings the ship alongside (arcade assist; no fiddly line handling).
- **Going ashore:** from a berth (docks district) or at anchor near an island (**rowboat cutaway**, then on-foot mode). The schooner stays as a world entity and can be noticed by watchers (plan 06).
- **Leaving:** "Cast off" from a berth gives a small push away from the dock.

---

## 8. Camera

| Mode | Description |
|---|---|
| **Chase/orbit (default)** | A third-person camera behind and above. The mouse orbits freely and the wheel zooms (close deck shot → wide tactical view). It eases back behind the ship after a few seconds of no input (toggleable). |
| **Spyglass** | Hold right mouse: a narrow FOV from the deck in the cursor's direction, with a vignette and slight sway. Used to identify ships, flags and lighthouse keepers. |
| **Tactical (zoomed out)** | The max zoom-out shows a wide area for maneuvering in combat and channels (it fades fog slightly for readability, within the rules). |
| **Cinematic** | Optional photo or idle camera (cut list). |

- **The camera does not roll with the ship** by default (reduces motion sickness). An optional "roll with ship" setting is available.
- The camera collides with terrain (it stays above the water and outside cliffs).
- **Scale tricks** that make 24-knot visual speed feel natural rather than speedboat-fast: exaggerated bow wave and wake, spray particles, sail and rigging creak audio, and a slightly lower FOV at speed.

---

## 9. Feedback, HUD & Audio Cues

**HUD (minimal, period-styled; plan 13 owns the look):**
- **Wind gauge:** a ring around a ship icon showing the wind direction, the no-go zone (red), and the best-angle band (gold). With manual trim on, it also shows the trim sweet spot.
- Speed (game knots), sail level, compass heading.
- Hull and rigging bars. A strain meter appears when overpressed.
- A depth (lead-line) indicator that turns active in shallow water.
- Clock, season, and the lantern on/off icon.
- Region Wanted indicator (plan 06).

**In-world cues:**
- Masthead **pennant** and **telltales** show the wind.
- **Luffing sails** in irons, flapping noise.
- **Wind streaks and cat's-paws** on the water show gusts approaching (lets skilled players reef ahead of a gust).
- Heel angle shows wind strength.

**Audio:** wind intensity, rigging creak scaled by strain, hull slap scaled by speed and waves, luffing canvas, grounding scrape, the anchor chain, a distant foghorn in fog.

---

## 10. Player Ship Tiers (draft; plan 10 owns progression and costs)

Lengths and characteristics are loosely based on Great Lakes schooners around 1900 (two-masters ~60–100 ft; three-masters ~120–180 ft). The game values are for tuning.

| | **T1 Small schooner** | **T2 Schooner** | **T3 Large/fast three-master** |
|---|---|---|---|
| Masts | 2 | 2–3 | 3 |
| Length | ~65 ft | ~100 ft | ~140 ft |
| Crew (invisible) | **0 (solo)** | ~4 | ~8 |
| Hull max speed (game kn) | 8.0 | 9.0 | 10.0 |
| Acceleration | Quick | Medium | Slow |
| Turn rate | High | Medium | Low |
| Draft (empty → full) | 1.5 → 2.0 m | 2.5 → 3.2 m | 3.5 → 4.5 m |
| Cargo | Small | Medium | Large |
| Hull / rigging HP | Low | Medium | High |
| Sail change time | Slow (solo) | Medium | Fast |
| Sweeps | Yes | Yes | No |
| Weapons (plan 07) | Swivel gun, small arms | Swivel plus a light broadside (1–2 per side) | Swivel plus a broadside (3–4 per side) |
| Boarding (master plan) | **Only surrendered ships** | Weak resisting crews | Most freighter crews |
| Visibility (stealth) | Low | Medium | High |

**Design intent:** a bigger ship isn't strictly better. T1 is stealthier, shallower, nimbler and faster to accelerate. T3 is a fast, powerful cargo hauler that can't hide or slip over bars. The player may keep wanting a nimble ship for some jobs (but owns only one ship at a time, per the decision).

### 10.1 NPC ships (same model, different inputs)
- **Sailing NPCs** (schooners, schooner-barges under tow) use the identical model, driven by AI inputs instead of the keyboard.
- **Steamers** (freighters, whalebacks, tugs, passenger steamers, the cutter *Morrill*) use an **engine mode**: constant thrust independent of wind, slower turning, and a big draft for freighters. Draft data matches the ship class.
  - Strategic consequence: **the cutter is faster than you in light wind and calms. You win on a broad reach in good wind, in shallows, in fog, or by breaking line of sight around islands.** That gives plan 06's chases their shape.
- **Schooner-barges under tow** are linked to their steamer by a tow constraint (a simple distance spring). Cutting the tow line is a tactic (plan 07).

---

## 11. Wind Interface (contract with plan 04)

Sailing needs only:
```
windAt(position, gameTime) → { directionRad, speedKn, gust01 }
waveParams(position, gameTime) → shared Gerstner parameter set
iceAt(position, gameTime) → { coverage01, thickness }
visibilityAt(position, gameTime) → meters (fog, rain, night)
```
- Wind is a global direction and speed plus slow drift plus local gust noise.
- **Wind shadow and lee shelter (decided: core feature).** Islands, high shores and cliffs block wind, and that mattered greatly to real Great Lakes sailors (sheltering in the lee, being becalmed under a headland, gusts funneling through channels).
  - **Precomputed shelter maps:** the geo pipeline ([03 §8.2](03-world-scale-chart-travel.md)) adds a step that ray-marches the heightmap upwind for **16 wind directions** per zone, producing a low-res texture per direction (e.g., 32 m game-space cells). Each cell gets a shelter factor (0 = full wind, 1 = fully blocked) based on obstacle height and distance (the lee extends roughly 10–20× the obstacle height downwind). S3 bakes 15×, measured in game meters, so the lee matches the uncompressed heights the player sees ([03 §14.2](03-world-scale-chart-travel.md)).
  - **Runtime:** `windAt()` samples the two nearest direction maps and blends them, so the cost is a texture lookup. `speedKn × (1 − shelter × k)`, plus extra gust turbulence at the shelter edge.
  - **Funneling:** narrow channels aligned with the wind get a speed-up factor (also precomputed: where shelter is low and channel width is small).
  - **Waves are calmer in the lee:** the same shelter factor reduces wave amplitude (`waveParams` scales by fetch and shelter). This makes lee anchorages a real refuge in storms, and a sheltered shore is visibly calmer.
  - **Gameplay uses:** storm shelter and anchorages, ambushes from a becalmed lee (risky), escaping a steam cutter by threading wind-funneling channels, and being becalmed under cliffs (sweeps help).
  - **AI awareness:** NPC sailing ships route around shelter (or use it); the cutter ignores wind but still benefits from calmer lee water.
  - Memory: 16 maps × e.g., 220×220 cells × 1 byte ≈ 0.8 MB for the Apostles. Negligible.
- **Phase 1 (2026-10-25):** `ctx.weather` (`src/sim/weather/local-weather.ts`) implements these queries from dev-panel wind. `windAt(position, gameSeconds)` returns the S9 `Wind` shape (`fromRad`, sustained `speedKn` after shelter and funneling, `gust01`); the controller adds the gust on top. `waveParams` gives the shared set plus the local scale, and `hullTargets` applies that scale. Details and tuning constants in [04 §21](04-water-weather-seasons.md).

---

## 12. Data (`data/ships.json` fields, sailing-related)

`id, name, tier, propulsion (sail|steam), lengthM, displayScale (03 §3.5), hullMaxSpeedKn, accelTau, decelTau, turnRateCurve[], polar[] (sail only), sailChangeTimeS, engineSpeedKn (steam only), draftEmptyM, draftFullM, cargoCapacity, hullHP, riggingHP, sweeps (bool), sweepsKn, sweepsTurnDegS, anchorRodeM, buoyancy, visibilityProfile, modelId, LODs[]`

- **Built in Phase 1** (`data/schemas/ships.ts`). Curves are `[x, y]` pairs: `polar` is `[degrees off the bow, factor]` and `turnRateCurve` is `[knots, degrees per second]`. `buoyancy` replaces `buoyancySamples[]` with the S2 sampler's spans and spring periods (`length, beam, heavePeriod, pitchPeriod, rollPeriod, damping`), since §5.1 samples fixed points from those spans. `cargoCapacity` is m³ until plan 05 picks the unit.
- Rules shared by every sailing ship (sail factors, the wind-strength curve, trim, stall, heel, leeway, head seas) are not per class. They live in `src/sim/sailing/handling.ts` and go into tuning presets alongside the ship record.

Weapons, crew size for boarding and upgrade slots belong to plans 07 and 10 but live in the same record.

---

## 13. Simulation & Performance

- Runs in the **gameplay tick** (30 Hz fixed is fine, with render interpolation; [01 §3.3](01-tech-architecture.md)).
- Per player ship per tick: about 6 wave evaluations, one wind query, one depth query, a few curve lookups. Well under 0.1 ms.
- At most 8 materialized ships ([01 §5](01-tech-architecture.md)). Distant ones use simplified motion.
- **Sails rendering:**
  - Sail meshes with per-level shape states (furled, reefed, half, full).
  - **Static sail shapes per level (decided 2026-10-22: no billow shader).** Luffing in irons swaps to a slack-sail shape, plus the flapping audio.
  - Opaque or alpha-tested canvas to avoid transparency overdraw on the iGPU.
- Wake and spray: a GPU particle budget per preset, plus a trailing decal/ribbon wake mesh (cheap). **Built in Phase 1 (piece F):** bow-wave and stern ribbons per ship, spray puffs from a preset-sized pool, and cat's-paws on the water that show gusts before they arrive ([04 §22](04-water-weather-seasons.md)).

---

## 14. Phase 1 — Sailing Prototype (deliverables & acceptance)

**Build:**
1. A test bay: a flat or simple-heightmap bay with a few islands, shoals and a dock (greybox or S3 output).
2. Water with shared waves (from S2), wind with direction drift and gusts, **wind shadow from the test bay's islands** (a shelter map baked from the test heightmap), and a dev panel to set the wind and wave state plus a shelter-map debug overlay.
3. A placeholder T1 schooner (box hull plus sail planes) with the full control set from §2.
4. The speed model, polar curve, sail levels, trim (auto and manual), inertia, turning, tacking/jibing, stall in irons.
5. Buoyancy and heel, the camera modes (chase plus spyglass), the HUD wind gauge, the depth indicator.
6. Grounding plus rock collision, hull and rigging damage, overpressing strain, knockdown.
7. Anchoring and auto-docking.
8. A tuning panel exposing every curve and constant, with save/load of tuning presets to JSON.
9. Quality presets plus dynamic resolution (from 01).

**Controller (built 2026-10-25, Phase 1 piece C).** `src/sim/sailing/` is the pure sim (no three.js, no ECS): `stepSailing(state, command, class, wind, headSeaM, scale, dt)`. `gameplay/sailing.ts` runs it per ship before buoyancy and adds heel to the buoyancy roll after; NPCs get the same model through `commandFor`. Notes on how it reads this plan:
- **Wind** comes in as the S9 `Wind` shape (`fromRad`, `speedKn` with shelter already applied, `gust01`); the controller adds gusts as `speedKn × (1 + 0.4 × gust01)`. Until the weather piece lands, the game page uses a dev-panel wind.
- **Sails** are ordered instantly and set at one step per `sailChangeTimeS`, so W three times from Furled is 12 s to Full on the T1.
- **Irons** is the polar's zero stretch (0–40°). Inside it the speed decays with a slower `ironsDecelTau` (14 s) so a tack keeps way; below 1.5 kn the ship stalls, makes sternway and its bow falls off at 4°/s to the side the wind is already on. With the rudder reversed in sternway, the player can also back the bow round.
- **Manual trim:** the ideal sheet runs from hauled in at the no-go edge to eased right out dead downwind. Within ±0.06 of it trimFactor is 1.0, falling to 0.7 at 0.36 off.
- **Head seas:** the summed amplitude of the gameplay waves running against the bow, times the local wave scale, gives up to a 20% loss at 1.5 m.
- **Leeway** up to 4° close-hauled at Full sail, none from a beam reach onward. **Heel** up to 14° at Full on a beam reach in 20 kn or more, scaled by the square of the wind below that; none while luffing.
- **Tack and jibe events** go out on the event bus (`ShipTacked`, `ShipJibed` with `uncontrolled` for strong wind at Half or Full) for hazards and audio to use. The controller deals no damage itself (piece E).
- **Starting T1 values** (`data/ships.json`): hull 8 kn, accelTau 4 s, decelTau 7 s, turn rate 1.5°/s stopped, 8 at 2 kn, 12.5 at 4 kn, 13.5 at 6 kn, 12 at 8 kn, sweeps 1.5 kn and 3°/s, 20 m long. The buoyancy spans are the S2 values scaled to 20 m (17 × 5 m, periods 2.6 / 3.1 / 3.8 s). With these, in 14 kn a tack from 50–55° takes 8.4–9 s and loses 34–37% of the speed, inside §4's 6–10 s and 30–40% (unit tested). Steady speeds in 14 kn at Full with auto-trim: 4.3 kn at 45°, 6.9 at 90°, 7.2 at 120–135°, 5.4 dead downwind.
- **Tuning panel:** the dev overlay's Sailing folder (dev builds or `?debug`) shows the §3.1 factors live, sets the dev wind, edits every ship and handling number, and saves or loads presets as JSON (`sailing-tuning` v1, the same record shape as ships.json).

**Hazards and mooring (built 2026-10-25, Phase 1 piece E).** `src/sim/sailing/hazards.ts` is pure sim like the controller: `stepHazards` runs right after `stepSailing` on the same ship and corrects where it ended up; `gameplay/hazards.ts` runs it per ship before buoyancy, and the mode puts its events on the bus (`ShipGrounded`, `ShipStruck`, `ShipKnockedDown`, `AnchorDragging`, `ShipDocked` and the rest) for the HUD and audio. The shared rules live in `src/sim/sailing/hazard-rules.ts`; the per-class numbers are the existing ships.json fields (draft, hull and rigging HP, anchor rode, length). Notes on how it reads §6–7:
- **Touching bottom.** Three keel probes (bow, midships, stern at ±0.45 L) read `depthAt`. Where the shallowest is under the draft, the bottom slope there decides: at **0.35 m per m** or steeper it is **rock or a steep shore**, so the ship is pushed back toward deep water, loses the speed it had into the bottom (with 20% coming back as sternway) and takes **10 HP per knot** of that impact; gentler, it **runs aground** and sticks (pose held, speed 0) with 2 HP below 2 kn or **5 HP per knot** above. The S3 shelter SDF isn't needed: depth and its slope separate the two cases. On the test bay about a third of shore contacts at T1 draft are rock, the rest groundings.
- **Kedging (simplified, cut #4's middle ground):** holding X while aground hauls the ship toward deeper water (the depth gradient, else astern) at 0.4 kn; it floats free once every probe has the draft plus 0.2 m. Waiting for wind and jettisoning cargo come with cargo (plan 05).
- **Piers** are hard obstacles from the dock's footprint (bow 0.3, midships 1.0, stern 0.7 half-beams of clearance), 3 HP per knot.
- **Damage effects:** water in the hold drops `loadFactor` to 0.7 at 0 hull and adds 0.4 m of draft; `riggingCondition` runs 0.5–1.0 with rigging HP, and sail changes take up to twice as long (`sailChangeScale` on the controller state). Hull at 0 raises `ShipFoundering` once; sinking and the rowboat are a later phase. Uncontrolled jibes cost 8 rigging HP.
- **Strain:** each sail level has a safe wind (Reefed 40, Half 27, Full 19 kn, including the gust). The load is the wind × (0.7 + 0.3 × sin of the wind angle), so running eases it and luffing carries none. Strain heads for (load − safe) / 8 kn, rising over 10 s and falling over 6 s; above 0.6 the rigging tears at up to 3 HP/s. At Full that means a warning in 22 kn, damage from about 24 kn.
- **Knockdown:** strain at 0.95 or more in 28 kn or more with Half or Full set. It takes 30% of the rigging and 10% of the hull, keeps 30% of the speed, lurches 55° over in under a second and recovers over 6 s, and can't repeat for 30 s. Unit tested: 32 kn on a beam reach knocks down a ship at Full within 30 s and leaves one at Reefed untouched; 30 kn gusting knocks one down at Half. Cargo overboard waits for cargo.
- **Anchoring:** X held 0.5 s drops it within the rode (30 m for the T1) or refuses (`AnchorRefused`); held again it weighs over 6 s. At anchor the ship brings up over about 3 s, swings head to wind at 8°/s and lies 14 m downwind of the anchor. **Drag:** the anchor holds 30 kn of load in shallow ground, falling to 21 kn at the end of its rode; the load is the wind × (1 + 0.6 × the sail factor). Over that it drags downwind at up to 1.2 kn, which can put the ship aground. A 34 kn gale drags it in 20 m of open water; the same anchor holds in a lee at 15 kn (unit tested).
- **Docking:** F within 12 m of a berth's zone at under 2 kn starts a 5 s eased auto-dock to the berth pose and furls the sails; any other press says why not (`DockRefused`: no berth, too fast, anchored, aground). F at the berth casts off: 1 kn ahead and a 3 m shove away from the pier over 3 s. Tested on the real Bayfield berths.
- **Dev overlay:** a Hazards folder shows hull, rigging, strain, depth and draft, anchor holding and load, the berth and the last hazard event, with a repair button and every rule live. Damage isn't saved yet (plan 16 adds it with the ship record).

**Camera (built 2026-10-25, Phase 1 piece G).** `gameplay/camera/ship-camera.ts` is the pure camera math, like the on-foot camera; `render/camera-rig.ts` feeds it the mouse and copies it into three.js, replacing the Phase 0 OrbitControls. Notes on how it reads §8:
- **Chase/orbit:** a boom from 4 m above the waterline, 70 m long at start, 22–900 m with the wheel (18% per notch, eased). Left or middle drag orbits; it swings back behind the ship after 3 s without input (setting). The camera never rolls unless "roll with ship" is on. The FOV drops from 50° by up to 4° at hull speed.
- **Terrain collision:** 12 samples along the boom against the terrain height (or 0.8 m over the water) plus 1.5 m of clearance; the boom snaps shorter and grows back at 30 m/s.
- **Tactical view:** from 220 m out the look-down floor rises to about 54° by 900 m, and the fog density thins by up to 40%.
- **Spyglass:** hold right mouse (or toggle, a setting): an 8° FOV from 4.5 m above the deck, aimed where the cursor met the water in the chase view (or along the ray above the horizon), with a slow sway, a round vignette, and the player's own ship hidden so the rig doesn't fill the glass. Dragging pans it.

**Schooner and sails (built 2026-10-26, Phase 1 piece H).** `src/render/ships/schooner.ts` builds the T1 in code from one lines record (`schooner-lines.ts`: 20 × 5.6 m, 1.6 m draft, two raked masts with topmasts, a 7.5 m bowsprit), in style B. `/bench/ship/` is a contact sheet of every level and point of sail. Notes on how it reads this plan:
- **Sail plan per level** (§3.2): Furled stows everything (canvas gathered on the booms and at the foot of the stays); Reefed sets the fore and main reefed to 60% of the luff plus the fore staysail; Half shakes the reefs out; Full adds the jib and both gaff topsails.
- **Sail changes animate from `sailSetting`**, which the controller already eases one step per `sailChangeTimeS`: gaffs climb the masts, headsails run up their stays, topsails rise up the topmasts. Settled, each level is one static shape (§13); a sail is rebuilt only when its hoist, its leeward side or luffing changes.
- **Booms** swing to the sheet: the auto-trim ideal, or the player's trim with manual trim on, 7° hauled in to 78° eased out, to leeward. A tack brings them across at about 60°/s; a jibe slams them over at about 170°/s. Headsails sheet a little closer than the foresail.
- **Luffing** (in irons, or under 1 kn of wind) swaps to the slack shape: little belly, ripples running to the leech, booms on the centerline working a few degrees either side.
- **Pennant and telltales** (§9) stream along the apparent wind (true wind plus the ship's own way), stand straight out from about 8 kn, hang in a calm, and flutter faster as the wind rises: a 4.2 m red pennant at the main truck and a wool telltale on each side's middle shrouds. They are one CPU-updated mesh, not a vertex shader, since a few dozen vertices cost nothing.

**Acceptance criteria:**
- A first-time player can sail around the bay and dock within **2 minutes** without instructions beyond the key list.
- Beating upwind to a target by tacking is clearly slower than reaching, and a skilled run is ≥ 15% faster than a novice run on the same course.
- In a scripted gale, reefing visibly matters: not reefing causes strain damage or a knockdown.
- Sailing into an island's lee noticeably drops wind and waves. Sheltering there in a gale is a viable tactic.
- Frame time stays within the Medium budget on the baseline laptop (60 fps target; never below 30 on Low).
- It's fun to just sail for 10 minutes (subjective gate; the developer decides).

**Playtest (2026-10-29): passed, signed off by Jared; tagged 0.1.0.** Every acceptance criterion above and the full feature walk-through were checked on the baseline laptop (AMD Radeon Renoir, Chrome 156, MSAA off) against a production build. The sailing audio mix, whose levels were set from measurements, passed a listen by ear with no changes. Course times for the skilled and novice beats weren't written down; the criterion was judged passed in play. Frame times from the water bench at the playtest (2026-10-29, full Phase 1 scene with the procedural schooner):

| Preset | Frame ms | Water ms | No water ms |
|---|---|---|---|
| Low | 3.0–4.4 | 2.0 | 1.0–2.4 |
| Medium | 5.1–7.6 | 3.3–4.9 | 1.8–2.7 |
| High | 5.9–8.3 | 4.0–5.2 | 1.9–3.1 |

The ranges are two runs, at 02:22 and 11:10 UTC. Every frame is far inside the 16.7 ms Medium and 33 ms Low gates, but water on Medium now reads 3.3–4.9 ms against its 3 ms budget (2.7 ms at [04 §22](04-water-weather-seasons.md)): worth a look in Phase 2 before the terrain shader adds load. In the scripted gale at its peak on Medium (`?gale&quality=medium&debug`), the worst frame the overlay showed was 16.8 ms. The S7 greybox and S8 arena keep their stand-in helms until Phase 2 (decided 2026-10-29).

---

## 15. Cut List
1. Leeway.
2. Jibe damage.
3. Channel wind funneling (keep basic shelter). S3 bakes the funneling maps either way, so cutting it later only drops the runtime use.
4. Kedging minigame (replace with "wait or jettison" options).
5. Following-seas surfing boost.
6. Rescue pickup by a passing vessel after abandoning ship (rowboat only).

*Not cuttable (decided features):* manual trim option, sweeps, wind shadow/lee shelter, the abandon-ship rowboat, shipless play.

---

## 16. Open Questions

All resolved. Follow-ups for other plans: passage prices and shipless earning (05, 12), wreck salvage (11).

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Abandon ship in a rowboat when sinking; a survival check based on distance, weather and season; failure or staying aboard means death. |
| 2026-10-21 | Play continues without a ship: rowboat within a zone, paid passage between ports, earn on foot until you can buy a new schooner. |
| 2026-10-21 | Auto-trim default; manual trim optional. |
| 2026-10-21 | Sweeps (long oars) for T1 and T2 in calms. |
| 2026-10-21 | Wind shadow and lee shelter behind islands and cliffs is a core feature (precomputed shelter maps; calmer waves in the lee). |
| 2026-10-22 | No sail billow shader: static sail shapes per sail level (cut #5 applied). |
| 2026-10-22 | S3 bakes the channel funneling maps. |
| 2026-10-22 | T3 can hire a harbor tug tow in calms (05 §7). |
| 2026-10-22 | Speeds are authored in knots and converted to m/s for the sim (01 §8). |

---

## Changelog
- v0.8: Phase 1 playtest passed (§14): results, bench numbers, helm swap moved to Phase 2.
- v0.7: Phase 1 camera built (§14): drag to orbit (§2), boom, collision, tactical and spyglass numbers.
- v0.6: Phase 1 hazards and mooring built (§14): rock vs. grounding by bottom slope, simplified kedging, damage effects, strain and knockdown thresholds, anchor holding and drag, auto-dock and cast off.
- v0.5: Phase 1 controller built (§14): sweeps key (R), the ships.json fields as built (§12), how the controller reads §3–5, starting T1 values.
- v0.4: §5.1 records the spike S2 buoyancy model and starting tuning values.
- v0.3: Gap review: static sail shapes (no billow), funneling baked in S3, T3 harbor tug tow, knots-in-data/SI-in-sim, shipless slipway building cross-referenced.
- v0.2: Decisions: rowboat abandon-ship with survival check, shipless play continues (rowboat, passage, on-foot earning), auto-trim default, sweeps, wind shadow promoted to core with a shelter-map design and calmer lee waves.
- v0.1: Initial sailing plan: controls, speed model (sail levels, polar, trim, wind strength), turning and tacking, buoyancy and weather effects, damage, grounding, knockdown, sinking proposal, mooring, camera, HUD, tiers, NPC steam model, wind interface, data fields, Phase 1 deliverables and acceptance criteria.
