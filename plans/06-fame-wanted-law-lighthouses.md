# 06 — Fame, Wanted, Law Enforcement & Lighthouses

Status: DRAFT v0.6 (decisions made; gap review applied; Phase 5 scope proposed; piece A built)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs: master plan decisions (separate Fame/Wanted, regional Wanted, execution only at the top tier, jail/bail/jailbreak, Fame fades, sparse patrols), [R1 §2.1–2.2](R1-western-superior-1900-research.md) (lights, the *Morrill*), [R1a](R1a-western-superior-gazetteer.md) (regions), [02](02-arcade-sailing.md) (dark running, shallows), [03](03-world-scale-chart-travel.md) (no chart escape), [04](04-water-weather-seasons.md) (visibility, moon, storms), [05](05-ports-economy-trading.md) (hot goods, grudges, Standing)
Feeds: 07 (lethality, surrender), 08 (docks guards, perception), 11 (lighthouse raids), 12 (capture, jail, execution, newspapers), 13 (HUD indicators)

## Purpose

Define how the world notices and responds to the player:
- crimes, witnesses and reports
- per-region Wanted
- global Fame (and its link to Standing)
- law-enforcement actors (the one roaming cutter, local police, marshals)
- lighthouses as watchers and wrecking targets
- the shared detection model
- the capture flow

---

## 1. Goals

1. **Heat is earned through witnesses.** Unseen crimes stay unseen. Most of the game is about not being seen or not being identified.
2. **Readable consequences.** The player always knows their Wanted tier per region, when a report is in progress, and when capture means death.
3. **Escapable but sticky.** Heat decays, can be bribed down or outrun to another region, but notorious acts linger.
4. **Fame is the reward and the risk.** It opens doors and makes people recognize you.
5. **Sparse law, many eyes.** One cutter (historically accurate), but lighthouse keepers, surfmen, guards, crews and townsfolk all watch.

---

## 2. Crimes, Witnesses & Reports

### 2.1 Crime pipeline
```
Crime committed ──► Witnessed? ──no──► (nothing, unless evidence is found later, e.g., a wreck investigation)
                        │yes
                        ▼
                 Identified? (who/what was seen: nobody · a schooner · YOUR schooner · YOU)
                        │
                        ▼
                 Report travels to authority (delay depends on witness & distance)
                        │   ◄── player can intervene: catch/intimidate/bribe the witness,
                        │       or prevent arrival (lethal options = new, worse crime)
                        ▼
                 Region Wanted += heat × identification factor; ship/person profile updated
```

### 2.2 Crime severity (heat points, draft)
| Crime | Base heat | Notes |
|---|---|---|
| Trespass / suspicious behavior (caught sneaking) | 5 | Docks at night |
| Petty theft (a crate, a till) | 10 | |
| Warehouse burglary / cargo theft from a moored ship | 25 | |
| Selling hot goods (detected) | 15 | [05 §6](05-ports-economy-trading.md) |
| Smuggling (caught with contraband) | 20 | Plus confiscation |
| Stealing contract cargo | 40 | Always traced to you |
| Assault (non-lethal: knocking out a guard, tying up a keeper) | 30 | |
| Piracy: forcing a surrender and looting at sea | 50 | |
| Dousing a lighthouse / placing false lights | 40 | Plus consequences if a wreck results |
| **Sinking a ship** (crew survived) | 90 | |
| **Killing** (each death, including deaths caused by a wreck) | 150 | Murder; with multiple deaths, heat compounds |
| Attacking a revenue cutter or law officer | 200 | Instant high tier |
| Jailbreak | 60 | |

### 2.3 Identification
| Level | Meaning | Factor |
|---|---|---|
| Unknown | "Someone" did it | 0.25 (raises regional alertness only) |
| A schooner | Vague vessel description | 0.5 |
| **Your ship** | Matches your ship's **profile** (silhouette, paint, sails, name) | 1.0 → it goes on the ship's record |
| **You** | Face, name or known identity | 1.0 → it goes on your personal record |

- Identification depends on observation quality: distance, light, fog, spyglass, how long you were seen.
- **Ship profile (decided: no disguise).** The law tracks your ship's appearance and name. **Repainting, renaming and swapping sails don't shed heat.** Cosmetic customization is cosmetic only. Heat tied to your ship stays until it decays, is bribed down, or you serve time. The only way to "lose" an old ship profile is to genuinely **replace the ship** (buy a new hull, or lose the old one). Reports about the old ship then no longer match, but the personal record stays.
- **Personal identity** grows with Fame (people recognize a famous pirate on sight in ports). **No disguise items (decided 2026-10-22):** on-foot recognition depends on Fame, light, distance and how long you're seen.

### 2.4 Report delay (the intervention window)
| Witness | Report method | Delay (game time) |
|---|---|---|
| Docks guard / watchman | Runs or whistles for police | Seconds to minutes (immediate if a constable is nearby) |
| Townsperson | Tells the police | ~30–60 min |
| Lighthouse keeper | Signal lamp or flag if it's visible from town; otherwise rows to town at dawn | ~1–8 h (by distance; R1 light data) |
| Freighter / ship crew | Reports on arrival at its next port | Hours to days (voyage time) |
| Life-Saving surfmen | Telephone from the Duluth station (✅ the station on Minnesota Point was built in 1894 and manned in 1895; the telephone is a game assumption ❓) | ~15–30 min |
| Rescued or released crew | On reaching shore | Varies |

The HUD shows a **"report in progress" indicator** (an eye icon with a timer) when a known witness is carrying a report, which gives the player a chance to react. Silencing witnesses lethally is a far worse crime if discovered.

---

## 3. Wanted (per region)

### 3.1 Regions
From [R1a](R1a-western-superior-gazetteer.md), with the Apostles region split in two and Ashland on its own (decided 2026-10-22). **Seven regions:** **Duluth**, **Superior**, **North Shore**, **South Shore West**, **Apostle Islands** (the islands, including La Pointe on Madeline Island), **Chequamegon Bay** (Bayfield, Washburn and the bay's western shore) and **Ashland** (Ashland and the head of the bay). Red Cliff and Bad River are trade-only zones (no crime possible, so no Wanted there).

### 3.2 Tiers
| Tier | Name | Heat range (draft) | World response |
|---|---|---|---|
| 0 | Clean | 0–19 | Normal |
| 1 | Suspicious | 20–59 | Guards are more alert at night; **the cutter and harbor launches may now inspect your cargo** (never at tier 0) |
| 2 | Wanted | 60–149 | Constables look for you in port; your ship is checked when docking; posters go up |
| 3 | Hunted | 150–299 | The cutter prioritizes this region; harbor launches patrol; fences get nervous; bounty posted |
| 4 | Notorious | 300–499 | Marshals and bounty hunters search docks and islands; news spreads to neighboring regions |
| **5** | **Most Wanted** | 500+ | Shoot-on-sight posses, an extra temporary vessel joins the hunt, **capture = execution** |

- **Tier 5 warning UX:** a distinctive skull or noose icon on the regional indicator and the chart, a one-time full-screen newspaper ("WANTED: DEAD OR ALIVE"), and a confirmation prompt before entering a tier-5 region's harbor.

### 3.3 Decay & reduction
- **Passive decay** per game hour, faster when you're **absent** from the region and not committing crimes. Higher tiers decay more slowly. Tier 4+ won't drop below tier 3 by decay alone (it needs a reduction action).
- **Bribes:** pay a constable or harbor master (in that region's port) to reduce heat by a chunk. The cost scales with heat. Not possible at tier 5 (too notorious). A *Saloon Keeper* perk lowers costs.
- **Fines:** at tier 1–2, pay a fine at the police station to clear it (legal-ish, no jail).
- **Lay low:** sleeping at a hideout located **in that region** accelerates decay.
- **Replacing the ship:** a genuinely new hull no longer matches old ship reports (no cosmetic disguise; see §2.3).
- **Witness intervention** (before the report lands).

### 3.4 Spread (news travels)
- **Decided:** crimes of severity ≥ "sinking a ship" generate **news** that spreads a fraction (~30%) of that heat to **neighboring regions** after a delay (newspapers, telegraph). The fraction is higher at higher Fame.
- So mass violence can't be contained to one region, but petty crime stays local. That makes fleeing to another region an effective escape for small crimes, as designed.

---

## 4. Fame (global)

### 4.1 Meter & tiers
| Tier | Name | Fame |
|---|---|---|
| 0 | Unknown | 0–49 |
| 1 | Rumored | 50–149 |
| 2 | Known | 150–349 |
| 3 | Infamous | 350–699 |
| 4 | Legendary | 700+ |

- **Gains:** notable deeds, scaled by audacity and newspaper coverage: big hauls, escaping the cutter, wrecking, rival pirate defeats, record voyages, daring heists. Yellow journalism **exaggerates**: a headline gives a Fame bonus (and ~10% extra heat in that region).
- **Decay (decided):** Fame fades slowly when you do nothing notable (e.g., −2% per game day after a grace period). Legends fade more slowly.

### 4.2 Effects
| Benefit | Cost |
|---|---|
| Fences unlock and pay better ([05 §6.2](05-ports-economy-trading.md)) | **Recognition:** people in ports recognize you (personal identification) |
| Ships surrender faster (intimidation, plan 07) | Bounty hunters seek you out at high Fame plus high Wanted |
| Better rumors; smugglers and special jobs offered | Companies take notice (grudge builds faster) |
| **Copycat rival pirates** appear as your Fame grows (max 2–3 active; [07 §8.1](07-combat-boarding-targets.md)) | The cutter's commander takes it personally (it prioritizes you) |

### 4.3 Standing (legit reputation)
Defined in [05 §5.2](05-ports-economy-trading.md): per port and company. Crimes **identified to you** lower Standing with the victims and in that port. A legit player builds Standing, not Fame. **Respectable Captain (decided 2026-10-22):** newspaper stories about honest feats (rescues, record runs, "first boat in" after ice-out) give a small Fame gain, so a legit captain can reach Fame tier 1–2 without crime.

---

## 5. Law Enforcement Actors

### 5.1 The revenue cutter *Morrill* (the one real threat at sea)
- **Always exists** abstractly ([01 §3.4](01-tech-architecture.md)) with a schedule across Lakes Michigan and Superior (Michigan is off-map in the MVP, so it simply "leaves" via the east chart edge for weeks at a time).
- **Presence weighting:** it spends more time in regions with high Wanted (tier 3+ in a region strongly attracts it) and coals at Duluth periodically (a known rumor pattern). It goes to **winter quarters** when ice closes the lake ([04 §4.3](04-water-weather-seasons.md)).
- **When present in a zone:** patrols the lanes, **inspects** vessels (pulls alongside and checks cargo for hot goods and contraband; hidden compartments help), pursues known ships. **Decided: it never inspects the player at Wanted tier 0** in that region. A clean captain sails unbothered.
- **Capabilities:** steam (fast in calms, wind-independent), armed (a bow gun), deep draft (**can't follow into shallows**), seeks **shelter in gales** (storms are windows of opportunity).
- **Pursuit behavior:** hail, then warning shot, then disabling fire (rigging and hull). It never sinks you deliberately unless you've fired on it. It demands surrender. Surrendering means capture (§7).
- **Escalation at tier 5:** a **temporary second vessel** (a chartered tug with armed deputies) joins in that region for a few weeks.

### 5.2 Harbor & port law
- **Constables / city police:** present in docks districts (plan 08 guards) and town waterfronts. Numbers by port size and tier.
- **Harbor launches:** small steam launches in **Duluth, Superior and Ashland** harbors only. Short range (inside harbor set pieces), fast, inspect and chase within the harbor.
- **Jail / police station** in Duluth, Superior and Ashland. Smaller ports have a constable with a lockup (prisoners are transferred).

### 5.3 Marshals & bounty hunters (tier 4+)
- **US Marshal posse / county sheriff:** on-foot searchers in docks districts and **islands** (they can land on islands to search hideout areas, but **can't raid hideouts**, per the decision; hideouts remain safe zones).
- **Bounty hunters:** independent armed men who appear at tier 4+ and high Fame, sometimes in a hired boat. They're beatable, but killing them adds heat.

### 5.4 Hideouts end pursuit (decided 2026-10-22)
- Reaching your hideout's boundary **ends any pursuit**: the cutter, harbor launches, constables, marshals and bounty hunters break off, and the chart lock lifts ([09 §3](09-hideouts-building-crafting.md)).
- The cost is being seen: pursuers who watch you reach it mark the hideout as **spotted** ([09 §8](09-hideouts-building-crafting.md)), so rumors name the place and the cutter patrols nearby more.

### 5.5 Watchers (non-combatant eyes)
- **Lighthouse keepers** (§6), **Life-Saving surfmen** (Duluth station: witnesses, and they rescue wreck survivors, who then testify), **ship crews** (freighters, tugs, fishing boats), **townsfolk** at day.

---

## 6. Lighthouses

### 6.1 As detection nodes
Each lighthouse (from [R1 §2.1](R1-western-superior-1900-research.md)) has:

| Property | Source / meaning |
|---|---|
| **Light tier** | Strong (3rd/3½-order), medium (4th), weak (5th / temporary) → lit radius at night |
| **Characteristic** | Fixed (a constant glow over its radius) vs. flashing/revolving (a sweeping beam; a direct hit = instant spot within range). From [R1 §2.1](R1-western-superior-1900-research.md): ✅ Raspberry and Outer Island flash white every 90 s, Sand Island is fixed white, Devils Island shows a temporary fixed red; ❓ for the rest |
| **Keeper(s)** | 1–3; a watch schedule (vigilance varies by hour; a keeper might doze before dawn) |
| **Reporting speed** | Signal visible from town = fast; remote = rows at dawn ([2.4](#24-report-delay-the-intervention-window)) |
| **Fog signal** | Horn or bell in fog (audio nav aid; [04 §10](04-water-weather-seasons.md)) |

- **Built (Phase 2 piece F, [14 §18](14-art-direction-asset-pipeline.md)):** `data/lighthouses.json` holds the seven Apostles lights with the tier, characteristic, keepers and reporting speed above, and `src/sim/lighthouses.ts` has the fixed and flashing lights, tier ranges (strong 6 km, medium 4.5 km, weak 3 km in the zone) and the lamp schedule. They are visual only until Phase 5 adds keepers and detection.
- **Keepers watch (Phase 5 piece B):** all ten kept, lit stations in `lighthouses.json` (seven in the Apostles, the two Twin Ports pierheads, Two Harbors) are observers from their galleries, with the vigilance and dozing of §7.1's notes; the dark Minnesota Point tower has no keeper.
- At **day**, a keeper is a normal observer with a high vantage point (long sight range in clear weather).
- **Vigilance scales with regional Wanted:** at tier 3+ keepers watch more and signal faster.
- **Devils Island in 1900** has a weak temporary light ([R1a snapshot](R1a-western-superior-gazetteer.md)), a historical blind spot.

### 6.2 As targets (raids & wrecking)
- **Raid:** land on foot and steal kerosene, supplies or the keeper's valuables. Options: sneak (no witness), tie up the keeper (assault, non-lethal, a witness later), bribe (a keeper with a weak loyalty trait), or kill (murder).
- **Douse the light:** extinguish the lamp (requires reaching the lantern room). The keeper relights after a delay if free. A dark light changes how NPC ships navigate (they slow down, or misjudge the channel in bad weather).
- **False lights (moon cussing):** a crafted **false-light rig** placed on a headland or shoal edge mimics a light, and **NPC ships navigate by lights** (their route-following uses known light positions as references). A misplaced light in darkness, fog or storm leads them onto shoals, where they **ground or wreck**, ready for salvage.
- **Consequences:**
  - The crime is only known if witnessed (keeper, crew survivors).
  - Deaths in the wreck count as killings.
  - **Pattern detection:** several suspicious wrecks near the same light within a few weeks triggers an **investigation**: region heat increases and the cutter is assigned there, even without witnesses.

---

## 7. Detection Model (shared with stealth)

One perception module serves keepers, guards, crews, the cutter lookout and marshals.

### 7.1 Ship detection (at sea)
`detectability = baseVisibility(ship tier) × lanternFactor (lit / dark running) × lightLevel (day / moonlight by phase / dark) × weatherVisibility (fog, rain, snow) × silhouette (against bright sky or a lighthouse beam vs. against a dark shore) × sailFactor (sails up are more visible)`

- Each observer has a sight range (with or without a spyglass, from a vantage point) and accumulates a **detection meter**. Then come **spotted** (a vessel is there) and **identified** (profile match, which needs closer range, better light or longer observation).
- The cutter or another hostile that has spotted you **locks chart travel** ([03 §5.4](03-world-scale-chart-travel.md)) until line of sight is broken (islands, fog, distance, night plus dark running).
- **Built (Phase 5 piece B, 2026-11-04):** `src/sim/law/perception.ts` works the product as ranges in zone meters. The hull is made out to `ambient sight × tier × sails × silhouette × vantage × glass`, capped by fog and thinned by rain: 5 km by day, 300 m on a moonless night, about 2 km under a full moon, ×0.55 furled, ×1.2 for the T2, ×0.55–0.85 against a dark shore, ×1.6 in a light's glow, up to ×1.5 from a tower's gallery and ×1.6 with the cutter's glass. A lit lantern shows on its own out to 3 km once it's dark (less under a bright moon, and through fog only a little further than a hull), and lights her own deck (+30% on the hull at night). The meter fills to **spotted** in 4 s alongside at full alertness (about 30 s at the edge of sight), and on to **identified** only inside 40% of the hull range, over 6 s more; out of sight it falls back over about 40 s. A lantern seen alone is a light, not a schooner (identification `unknown`). Islands block the line of sight. `npm run bench:detection` prints the table across the moon's phases: past Raspberry light a dark T1 on a moonless night is seen from 430 m (never, 1 km off), lit under a full moon from 3.7 km.
- **Observers** (`src/sim/law/observers.ts`, `src/gameplay/detection.ts`): every kept, lit light's keepers (vigilance 0.5 by day; at night 0.6–0.85 by the station's keepers, and a lone keeper dozes from 2 to 5 at 0.3 of that; ×1.35 at Wanted tier 3+), the crews of the zone's and arena's ships (0.35 at night, 0.55 by day, eye by class), and the *Morrill*'s lookout (0.9–1 with a glass). Raspberry's and Outer Island's flashing beams spot a ship at once when they sweep across her within 60% of their range. The smuggler's crew doesn't watch. Detection runs four times a second, about 0.02 ms a look.
- **Witnesses for the law core:** `src/sim/law/witness.ts` is the seam with piece A: a `Witness` (kind, name, identification, a keeper's reporting speed, distance) and a `WitnessSource` that lists whoever has the ship in sight at spotted or better. Events `PlayerSpotted`, `PlayerIdentified` and `PlayerLostSight` carry them; the HUD's eye chip says "Watched by…", "Seen by…" or "Known to…" with the watcher's name.

### 7.2 On-foot detection
Plan 08 details it: vision cones × light level (lamplight vs. shadow) × movement (crouch, walk, run) × noise events × snow tracks (winter). Recognition (personal identification) uses Fame, light and distance.

---

## 8. Capture

### 8.1 How capture happens
- **At sea:** you surrender to the cutter, a launch or the posse vessel when ordered and outgunned (a choice), or you're disabled and boarded.
- **On foot:** guards subdue you (stealth fails and you can't escape a chase), or you surrender.
- **Hot-goods sale or inspection** at tier 2+ can also end in arrest if you don't flee.

### 8.2 Outcomes
| Region Wanted at capture | Result |
|---|---|
| Tier 0–4 | **Jail**: **current cargo confiscated** (and cash on hand), **time passes** (sentence in weeks, by heat; 1 game day = 1 week, so a 3-week sentence = 3 game days skipped). The ship is impounded and returned on release (fee). Region heat is reset to tier 1 after serving. |
| | **Bail:** pay (scaling with heat) to leave immediately, from a hideout stash via "send word" (a messenger fee plus a delay) or through a trusted fence ([12 §8.1](12-sandbox-events-character-failure.md)). |
| | **Jailbreak:** a short stealth/escape scenario (plan 12). Success → free, +60 heat, and the ship is still impounded (steal it back from the harbor impound: a mini-heist). Failure → more time added. |
| **Tier 5** | **Execution** → the run ends (permadeath). **Decided:** exactly **one hard jailbreak attempt** before the hanging. Success means escape (still tier 5, ship impounded). Failure means execution. |

**MVP holding cell:** the MVP has one docks district (Bayfield), so captures in any region are held in **Bayfield's lockup**, and jailbreaks run there ([08 §9](08-docks-district-stealth.md)). The Duluth, Superior and Ashland lockups arrive with their districts.

---

## 9. Newspapers (system hook)

- Events with news value generate **headlines** in regional papers (Duluth, Superior, Ashland, Bayfield) after a delay. They're templated and exaggerated by Fame (yellow journalism).
- Papers are readable in ports (rumors, prices, weather outlook, cutter movements, the "WANTED" section). They feed Fame gains and heat spread. Plan 12 owns content and plan 13 the look.

---

## 10. Data & State

**Data:** `crimes.json` (severity, heat, flags), `wanted_tiers.json`, `fame_tiers.json`, `lighthouses.json` (tier, characteristic, keepers, report method), `law_actors.json` (cutter stats and schedule weights, launch ports, posse rules), `regions.json`.

**WorldState:**
- `wanted[regionId] = {heat, lastCrimeAt, lastSeenAt}`
- `fame = {value, lastNotableAt}`
- `profiles.ship = {silhouette, paint, sails, name, flag, recordHeat}`
- `profiles.person = {recognition}`
- `reports.inProgress[]` (witness, crime, ETA, identification)
- `lighthouses[id] = {lit, keeperState, vigilance}`
- `law.cutter` (abstract position and plan)
- `law.posses[]`
- `investigations[]`
- `jail` (when incarcerated)

**Events:** `CrimeCommitted`, `Witnessed`, `ReportFiled`, `ReportIntercepted`, `WantedTierChanged {region}`, `FameChanged`, `ProfileChanged`, `InspectionStarted/Passed/Failed`, `PursuitStarted/Ended`, `PlayerCaptured`, `Jailed`, `Released`, `JailbreakSucceeded/Failed`, `Executed`, `LightDoused/Relit`, `FalseLightPlaced`, `ShipWrecked {cause}`, `InvestigationOpened`.

---

## 11. Phase 5 Deliverables & Acceptance

**Build:** the crime pipeline with witnesses and report delays, regional Wanted with tiers, decay, bribes and fines, the Fame meter with decay and effects stubbed, the ship profile (no disguise), the cutter (abstract schedule plus materialized patrol, inspect and pursue), lighthouse keepers as detection nodes, the detection model at sea, capture into jail/bail (jailbreak stubbed), the tier-5 warning UX, the HUD regional Wanted indicator and report-in-progress icon.

**Acceptance:**
- A crime with no witnesses produces no Wanted.
- The same crime in view of a keeper produces a delayed report, and intercepting it prevents the heat.
- Fleeing to another region escapes petty heat, but not mass violence (spread).
- Running dark on a moonless night past a lighthouse is noticeably safer than with a lantern under a full moon.
- The cutter can't follow into shallows, and is beatable on a broad reach in good wind.
- The tier-5 state is unmistakable before capture can happen.

---

## 12. Cut List
1. Bounty hunters (marshal posses only).
2. Keeper bribery and loyalty traits.
3. Investigations from wreck patterns.
4. Heat spread via newspapers (strictly regional).
5. Harbor impound mini-heist (pay a fee to recover the ship).

---

## 13. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Six Wanted tiers (0–5); execution only at tier 5. |
| 2026-10-21 | Serious crimes (sinking, killing) partly spread heat to neighboring regions via the news. |
| 2026-10-21 | The cutter and launches **never inspect the player at tier 0** in that region. |
| 2026-10-21 | **No ship disguise:** repainting, renaming and new sails don't shed heat; only replacing the ship breaks the old ship profile. |
| 2026-10-21 | One hard jailbreak attempt before execution. |
| 2026-10-21 | Rival pirates appear as Fame grows (copycats), max 2–3 active (see 07). |
| 2026-10-22 | Seven Wanted regions: the Apostles region splits into **Apostle Islands** and **Chequamegon Bay**, and **Ashland** is its own region. |
| 2026-10-22 | **Respectable Captain** Fame from honest feats is in. |
| 2026-10-22 | **No disguise items**; recognition depends on Fame, light and distance. |
| 2026-10-22 | Reaching a hideout **ends pursuit** (pursuers break off; the hideout may be spotted). |
| 2026-10-22 | In the MVP, captures are held in Bayfield's lockup. |
| 2026-11-04 | Sailing speed: raise both schooners about +35% now, with strong wind past 1.0, and tune in the playtest (§14.6). |
| 2026-11-04 | Phase 5's crimes are the smuggling life: smuggler deals, contraband, hot goods offered to merchants and contract theft; piracy joins the same pipeline in Phase 6 (§14.6). |

---

## 14. Phase 5 Scope: Law, Fame & Wanted (2026-11-04)

Phase 5 is the **Law, Fame & Wanted** build (version 0.5.0), with one goal from the [00 §7](00-master-plan.md) roadmap: **"heat has teeth."** Phase 4 built the honest front and the first of the hidden life behind it: the Stockton stash, the island smuggler, receivers who ask no questions, and contract cargo that can walk off. Every one of those raises an event that nothing listens to yet (`HotGoodsDetected`, `ContractStolen`). Phase 5 makes them cost something: a keeper on Raspberry Island sees your lantern alongside the smuggler at midnight, a report rows to Bayfield at dawn, the region goes Suspicious, and the next time the *Morrill* steams through the islands she pulls alongside and opens your hold.

The scope comes from §11 above, the Phase 5 rows in plans 12 §11 (jail, bail, release summary, newspapers v1, death and the end screen), 13 §12 (Wanted indicator, report eye, tier-5 warning, jail screens, newspaper reader v1, end-of-run screen), 15 (Wanted and tier stingers, the cutter's whistle) and 16 §12 (the permadeath flow, `lastRun` and the end screen, the danger snapshot, the single-tab lock), plus what Phases 3 and 4 left for it (03 §20 piece F, 04 §5.4 storm flags, 05 §16.5 and §23.4) and Jared's doubts about sailing speed (05 §25.3).

This section is the scope proposal. Like Phase 4's, its exit criteria (§14.3) become the phase's acceptance checklist once Jared approves them, and the playtest piece checks them.

### 14.1 What Phases 3 and 4 change or put at risk

| Finding | Source | Effect on Phase 5 |
|---|---|---|
| **There are almost no crimes to commit yet.** Piracy at sea is Phase 6 and theft on foot is Phase 7. Today the only crimes are smuggling (contraband or hot goods offered to a merchant, `HotGoodsDetected`) and stealing contract cargo (`ContractStolen`), and hot goods only exist through a dev command | 05 §22–23, 00 §7 | Phase 5 builds the law around **the smuggling life Phase 4 made**: dealing with the smuggler and carrying contraband become crimes a witness can see (decision 1, §14.6). Piracy plugs into the same pipeline in Phase 6. |
| **The T1 can never outrun the *Morrill*.** The T1's `hullMaxSpeedKn` is 8 (T2: 9), `windStrengthFactor` is capped at 1.0, so 8 kn is the most she ever makes (about 8.6 with manual trim). The cutter steams at 12 kn in every wind. Plan 02 §10.1 and §11's acceptance both promise she's beatable on a broad reach in good wind | `data/ships.json`, 02 §3.5, 02 §10.1, §11 here | Sailing speed stops being a feel question and becomes a Phase 5 blocker. Piece G retunes it (decision 2), and it can start now. |
| The *Morrill* already patrols the route graph, shows in arenas, and can hunt and "catch" you, but only behind `?cutter=hunt`. Caught ends the voyage with a "Boarded" notice and she lets you go | 03 §20 piece F, `src/sim/arena/encounter.ts` | Piece C swaps the dev flag for Wanted and real detection, and caught becomes an inspection or a capture (piece D). |
| The lighthouses are built from `data/lighthouses.json` with tiers, characteristics, keepers and reporting speed, and `src/sim/lighthouses.ts` has the lamp schedule and the flash. They're visual only | §6.1, 14 §18 | Piece B gives the keepers eyes using the data that's already there. |
| The Lantern key (L) is bound but does nothing, and the chandlery already sells lamp oil "for later" | `src/core/input.ts`, 05 §18.2 | Piece B wires the lantern: your own light, dark running, and lamp oil burned while it's lit. |
| `ports.json` already gives each port a `wantedRegion`, but there's no `regions.json` and nothing for the zones' open water | `data/ports.json` | Piece A adds `regions.json` with the seven regions of §3.1 and maps zone areas and chart cells to them, so a crime at sea lands in the right region. |
| Receivers take hot goods "with no law" and the smuggler's informant hint waits for Wanted | 05 §23.2, §23.4 | Piece E adds the informant risk: at tier 2+ a receiver may turn you in, and the smuggler's screen shows the risk. |
| Nothing can kill the captain, so the permadeath notice, the end screen and the danger snapshot were left out | 05 §19.4, 12 §11 | Tier-5 capture means execution, so piece D builds death, the end screen and `lastRun`, and the danger snapshot (16 §4.3). |
| Port storm flags were deferred here | 04 §5.4, 03 §28 | Small and on the same news rule as the forecast; folded into piece F with the papers. |
| Marshals, posses on foot and the Bayfield lockup's jailbreak all need on-foot play | §5.3, §8.2, 08 §9 | Stubbed, as §11 already says: no marshals until Phase 7, jailbreak offered as "not yet" with the sentence instead. |

### 14.2 What Phase 5 delivers

Run whiskey out of the islands with your lantern doused on a moonless night and nobody's the wiser. Do it under a full moon in sight of Raspberry light, and the keeper's report lands in Bayfield at dawn; Chequamegon Bay goes Suspicious, a fine at the harbor master clears it, or you sail for Duluth until it cools. Push it, and the *Morrill* comes looking: she hails, fires a warning shot, and you either run for the shallows off Long Island on a broad reach, or heave to and lose the cargo and a few weeks in the Bayfield lockup. At the top tier the papers print WANTED, DEAD OR ALIVE, and capture means the rope.

| Area | Deliverable | Plan |
|---|---|---|
| Law core | `crimes.json`, `wanted_tiers.json`, `fame_tiers.json`, `regions.json`, `law_actors.json`. The crime pipeline (crime, witness, identification, a report that travels, heat). Regional Wanted with tiers and decay. Fame with decay. The ship profile (no disguise). Standing hits for identified crimes | §2–4, §10 |
| Detection at sea | One perception module: detectability from the ship, the lantern, daylight and the moon, fog and rain, silhouette and sails; observers with sight ranges and detection meters (keepers, ship crews, the cutter's lookout); spotted vs. identified | §7.1 |
| Lighthouses watch | Keepers with watch schedules and vigilance by tier, their reports by `lighthouses.json`'s reporting speed | §6.1 |
| Lantern and dark running | L toggles your lantern, lamp oil burns while it's lit, and dark running at night lowers detection (and risks collision with traffic, a warning only) | 02 §2, §7.1 |
| The *Morrill* | Her abstract schedule weighted by Wanted, coaling at Duluth, her patrol in zones and arenas, inspections (never at tier 0), pursuit (hail, warning shot, disabling fire on the rigging), the shallows she can't follow, shelter in gales. The tier-5 chartered tug as a second hunter | §5.1 |
| Port law | Bribes and fines at a harbor master's tab on the port screen, the docking check at tier 2+, posters, receivers who can inform | §3.3, §5.2 |
| Capture | Surrender at sea, jail (cargo and cash confiscated, the sentence skips time, the ship impounded with a fee), bail from the stash by "send word", execution at tier 5 with the jailbreak stubbed | §8 |
| Death and the run's end | The end screen with a front page and run summary, `lastRun`, deleting the run, the danger snapshot, the single-tab lock, the permadeath notice on character creation | 12 §11, 16 §4, §12 |
| UI | Regional Wanted indicator, the report eye with its timer, the tier-5 warning (icon, full-screen front page, a confirm before entering the harbor), jail and release screens, the Fame tier in the ledger | 13 §12 |
| Newspapers v1 | Templated headlines from events in the four papers, readable at the port, the WANTED column, cutter sightings, Respectable Captain Fame, port storm flags | §9, 12 §11, 04 §5.4 |
| Sailing speed | A tuning pass so the schooners are quick enough to feel good and to beat the cutter on a broad reach in good wind | 02 §3, §10.1 |
| Audio | Wanted tier stingers, the cutter's whistle and engine, the bow gun, the lockup | 15 |
| Saves | Law, Fame, report and jail slices in save v7, a v6 migration (0.4.0 saves are v6) | 16 §12 |

**Out of scope:** cannons, boarding, surrender of other ships, sinking and fences beyond the smuggler (Phase 6); on foot, the docks district, constables on foot, marshals and posses, the jailbreak scenario and lighthouse raids or dousing (Phase 7); false lights, wrecking and wreck investigations (Phase 9); harbor launches (§14.5); and §12's cut list as it stands (bounty hunters, keeper bribery, investigations, the impound mini-heist), with heat spread kept in (§14.5).

### 14.3 Exit criteria (proposed)

Phase 5 is done when these pass on the baseline laptop and Jared signs off the playtest. The first six are §11's acceptance; the last two come from plan 17's definition of done.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | A crime with no witnesses produces no Wanted | A pipeline unit test; dealing with the smuggler on a moonless night, dark, away from any light |
| 2 | The same crime in view of a keeper produces a delayed report with the eye and its timer showing, and intercepting it (overtaking the keeper's boat before it reaches town) prevents the heat | A unit test on report ETAs; a playtest route at Raspberry light |
| 3 | Fleeing to another region escapes petty heat, but not the heaviest crimes (spread) | A unit test with crimes of each size; Phase 5's heaviest crime is the stand-in until Phase 6 adds sinking |
| 4 | Running dark on a moonless night past a lighthouse is noticeably safer than with a lantern under a full moon | A detection bench across the moon's phases, lantern on and off; by eye |
| 5 | The cutter can't follow into shallows, and the T1 can beat her on a broad reach in good wind | The sailing bench after piece G; an arena chase with `?encounter=cutter` |
| 6 | The tier-5 state is unmistakable before capture can happen | The tier-5 warning shows on the HUD, the chart and a full-screen front page, and the harbor asks first |
| 7 | The cutter never inspects you at tier 0, and inspects at tier 1+ with contraband found and confiscated by the hidden-compartment odds | A unit test; a playtest route |
| 8 | Captured below tier 5: cargo and cash taken, the sentence skips game days, the ship comes back for a fee, heat drops to tier 1. Bail from the stash gets you out early. Captured at tier 5: the end screen, and the run is gone | An e2e test through the dev hooks for each; a save inspection |
| 9 | Closing the tab mid-chase doesn't escape it: the reload lands on the danger snapshot | An e2e test |
| 10 | Bribes and fines clear heat as §3.3 says, and decay brings petty heat back to Clean over a few game weeks away from the region | A unit test; the ledger in play |
| 11 | Newspapers print headlines from what happened (your crimes, your honest feats, cutter sightings) and Fame moves with them | A unit test on the templates; read in port |
| 12 | A 0.4.0 save loads into 0.5.0 Clean everywhere at its saved place, and the save stays under the plan 16 budget | `tests/save-migrations.test.ts` with a v6 fixture; the S6 bench |
| 13 | Detection and the law tick stay inside the frame and tick budgets with traffic in every zone (Phase 4's numbers) | `/bench/stream/` per zone; a sim bench |
| 14 | Smuggling has real risk and the law feels fair: you can see why you were caught | Jared decides |
| 15 | Plans 02, 06, 12, 13, 15 and 16 record what was built, CI is green, and 0.5.0 is tagged | The release PR |

### 14.4 Work pieces

Nine pieces, each sized to be one thread. Three can start at once (A, B and G). The playtest (I) closes the phase.

| Stage | Pieces |
|---|---|
| 1, start now | A law core, B detection and the lantern, G sailing speed |
| 2 | C the *Morrill* (after A, B, G), D capture, jail and death (after A), E port law and the Wanted HUD (after A) |
| 3 | F newspapers and Fame (after A, E), H law audio (after C, D) |
| 4 | I playtest |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | Law core | `crimes.json` (heat, flags), `wanted_tiers.json`, `fame_tiers.json`, `regions.json` (the seven regions with zone areas and chart cells), `law_actors.json`. The `wanted`, `fame`, `profiles`, `reports` and `jail` slices of §10 in save v7 with a v6 migration. The pipeline of §2.1: `CrimeCommitted`, witnesses, identification by observation quality, reports with ETAs by witness kind (§2.4), `ReportFiled` adding heat × identification. Decay by tier and absence, spread at the top crimes (§3.4). `HotGoodsDetected` and `ContractStolen` become crimes, plus the decision 1 crimes. Identified crimes lower Standing. A dev panel to commit, witness and file crimes and set tiers | — | — |
| B | Detection at sea and the lantern | The perception module of §7.1 as pure functions with a bench: detectability from ship tier, lantern, light level (sun and the moon's phase), weather visibility, silhouette and sails; observers accumulate a meter to spotted, then identified. Keepers as observers from `lighthouses.json` (watch hours, dozing before dawn, vigilance by tier); ship crews in traffic as observers; the cutter's lookout. L toggles your lantern with a light on the ship and the HUD icon (02 §2), burning lamp oil. Feeds A's witnesses through an interface so B can start now | — (A's witness interface) | Night feel |
| C | The *Morrill* | Her schedule weighted by regional Wanted on the route graph (§5.1), coaling at Duluth, sheltering in gales. Encounters forced by Wanted and detection in place of `?cutter=hunt`. In zones and arenas: patrol, inspection (pull alongside at tier 1+, search the hold, confiscate contraband and hot goods; hidden compartments lower the odds), pursuit (hail, warning shot, disabling fire on rigging only, no sinking unless fired on), the shallows she won't enter by draft, breaking line of sight by islands and fog, the chart lock from real detection. Surrender hands off to D. The tier-5 chartered tug with deputies | A, B, G | Chase feel |
| D | Capture, jail and the run's end | Surrender and capture at sea. The jail screen: confiscation, a sentence by heat in weeks skipped as game days, the impound fee, heat reset to tier 1, the release summary (12 §8). Bail from the stash by "send word" (a fee and a delay). The jailbreak offered as stubbed. Execution at tier 5. Death and the end screen with a front page, run summary and logbook export; `lastRun`; deleting the run (16 §3). The danger snapshot and the single-tab lock (16 §4). The permadeath notice on character creation | A | End screen look |
| E | Port law and the Wanted HUD | A harbor master tab on the port screen: fines at tiers 1–2, bribes by heat (not at tier 5; the Saloon Keeper's perk lowers them). At tier 2+ docking means a check of the hold. WANTED posters on the port screen. Receivers may inform at tier 2+ and the smuggler shows the risk (05 §23.4). The HUD's regional Wanted indicator, the report eye with its timer, the tier-5 warning (HUD, chart, a confirm before the harbor). Fame in the ledger | A | Indicator look |
| F | Newspapers v1 and Fame | The four papers' headlines templated from events, exaggerated by Fame, a few days late; the paper on the port screen with the WANTED column, cutter sightings and the weather outlook. Fame gains from headlines (and Respectable Captain feats), decay after a grace period, the extra ~10% heat. Port storm flags on the forecast rule (04 §5.4). The tier-5 full-screen front page | A, E | Paper look |
| G | Sailing speed | Measure first: top speeds by point of sail and wind on the sailing bench, crossing times across each zone and on the chart, against the cutter's 12 kn and traffic's speeds. Then raise it (decision 2, decided): about +35% on `hullMaxSpeedKn` for the T1 and T2 and a `windStrengthFactor` above 1.0 in strong wind, so the T1 on a broad reach in good wind beats the cutter's 12 kn; the playtest tunes it. Re-check what depends on speed: chart voyage times, the encounter budget, arena sizes, docking. Plan 02 updated | — | Feel, sign-off on the numbers |
| H | Law audio | Tier change stingers, the cutter's whistle, engine and bell, the warning shot and bow gun, the lockup door and the release, the paper boy's shout in port. Every file in `CREDITS.md` | C, D | Listen by ear |
| I | Phase 5 playtest | The §14.3 scenarios, the benches, plans updated, tag 0.5.0 | All | Playtest, sign-off |

### 14.5 Smaller calls assumed (Jared can override)

- **No harbor launches in Phase 5.** §5.2 puts them in Duluth, Superior and Ashland; the cutter is the law at sea for now, and launches come with those docks districts in Phase 7.
- **Heat spread stays in** (§3.4, against cut list item 4). It's small once the papers exist, and criterion 3 needs it.
- **Marshals, constables on foot and the jailbreak are stubbed** until Phase 7. Port law is the harbor master's tab and the docking check.
- **Running dark is not itself a crime** (the 1900 rules of the road did require lights, but a ticket for it would punish the stealth the game is built on). It only lowers what watchers see and raises the risk of collision in traffic, with a warning when a ship is close.
- **The cutter only shoots rigging,** and never sinks you unless you fire on her, which you can't until Phase 6.
- **Jail time is game days skipped,** so a three-week sentence passes while the world ticks (prices, traffic, decay), shown on the release screen.
- **The hold search uses the existing contraband detection odds** (05 §23), raised by tier, so smuggling's numbers stay tuned in one place.

### 14.6 Decisions for Jared

1. **What crimes can you commit in Phase 5?** **Decided 2026-11-04: the smuggling life.** Plan 06 assumed piracy, theft and lighthouse raids to watch for, and none of them exist until Phases 6–7.
   - **The smuggling life (recommended):** dealing with the smuggler, carrying contraband in view of the cutter, offering hot goods to a merchant and stealing contract cargo are the crimes. Keepers, crews and the cutter witness the first two at sea; merchants and the freight agent the others. Hot goods stay a dev command until Phase 6. Phase 5 is complete on its own and Phase 6's piracy drops into the same pipeline.
   - **Also pull one piracy crime forward:** add a no-guns hold-up (run down a fish tug or a barge, demand her cargo, she gives it up under the threat). More crimes to see now, but it's a slice of Phase 6's surrender rules built early and rebuilt there.
   - **Swap Phases 5 and 6:** piracy first, so the law arrives with real crimes. The cutter's chase and Wanted wait another phase.
2. **How should the sailing speed pass go?** **Decided 2026-11-04: just raise it now** (about +35% on both schooners' `hullMaxSpeedKn`, strong wind past 1.0, tuned in the playtest). The T1 tops out at 8 kn and the cutter steams at 12.
   - **Measure, then tune with sliders (recommended):** piece G benches what she does now, proposes faster numbers (around 11 kn for the T1 and 12–13 for the T2 on a broad reach in a strong breeze, the cutter a steady 10–11 with 12 only in a flat calm), and gives you dev sliders to try in play before anything's committed.
   - **Just raise it now:** about +35% on `hullMaxSpeedKn` for both schooners and let strong wind push past 1.0, then tune in the playtest.
   - **Slow the cutter instead:** leave the schooners as they are and drop the *Morrill* to about 8–9 kn so she's beatable. Doesn't touch your doubts about how sailing feels.

### 14.7 Housekeeping found along the way

- The 0.4.0 tag is on GitHub, on the sign-off merge (`ee05aae`), so nothing is left to push for it. Wait in port and at anchor (PR #73) is merged.
- The master plan's §11 Next Steps still lists Phase 0 work (noted in 05 §16.7 too).
- `encounter.ts`'s dev ships hard-code their speeds (the cutter's 12 kn among them) beside `data/ships.json`; piece G should read them from the data so a retune lands everywhere.
- Plan 17 wants a tracking issue per phase with the acceptance checklist; §14.3 can become it once approved.

### 14.8 Built: piece A, the law core (2026-11-04)

- **Data:** `crimes.json` (§2.2's table with each crime's phase; the Phase 5 crimes are `crime.smuggler_deal`, `crime.contraband`, `crime.hot_goods` and `crime.contract_theft`, plus `traced`, `news`, Standing and Fame per crime), `wanted_tiers.json` (§3.2's tiers with decay per game hour, the identification factors, the grace period and spread rules), `fame_tiers.json`, `law_actors.json` (report delays by witness kind and keeper `reporting`, the cutter's coaling port and tiers, the tier-5 tug) and `regions.json` (the seven regions, each with lon/lat areas, an anchor, a seat port and its neighbors). Ashland moved to `region.ashland` in `ports.json`, as §3.1 decided. South Shore West has no port yet, so its reports have no seat.
- **Regions at sea:** a point belongs to the first region whose area holds it, in file order, or else the region whose anchor is nearest, so open lake always has a region. The areas split Bayfield's shore (Chequamegon Bay) from Madeline Island (Apostle Islands) down the channel at 90.803° W. This one lookup serves zone poses, chart positions and the player's place (`src/sim/law/regions.ts`), so "chart cells" (§14.4) weren't needed.
- **The pipeline** (`src/sim/law/law.ts`): `commitCrime` with no witnesses raises `CrimeCommitted` and nothing else. Each witness carries its own report with an ETA by kind (a slow keeper waits for dawn after 20:00, the cutter files at once), seeded by the run so a reload gives the same delays. A filed report adds heat × its identification factor less what earlier reports on the same crime added, so two witnesses never count a crime twice; "someone did it" only raises the region's `alert`. A report on a hull you've since replaced only describes "a schooner". The first report that names you (ship or person) costs Standing in the port (or the region's seat) and brings the crime's Fame. `interceptReport` stops one on its way.
- **Over time** (the world tick): reports land, a newsworthy crime's news reaches the neighbors 12 game hours after it's filed at 30% (+5% per Fame tier), heat decays by tier, a quarter as fast while you're in the region and not at all for 12 game hours after heat lands, and a region that reached tier 4 won't decay below tier 3. Fame fades 2% a game day after three quiet days (1% for legends). Petty heat (up to tier 1) is Clean again after about two game days away.
- **Phase 4's crimes:** a merchant who finds out a hot lot (`HotGoodsDetected`) is selling hot goods, a contraband lot is smuggling, both named to you and reported within the hour. `ContractStolen` is always traced through the freight agent and is Phase 5's crime that spreads (the company's agents up and down the lake hear of it), standing in for sinking until Phase 6. `SmugglerDealt` is one crime a night at her anchorage's region, seen by whoever the witness source returns. A shipyard purchase is a new hull: the heat tied to the old ship goes.
- **The seam with piece B:** `src/sim/law/witness.ts` holds `Witness`, `WitnessKind`, `Identification` and `WitnessSource`. The game's law has `witnesses: WitnessSource`, which `main.ts` sets to piece B's detection, so a smuggler deal is seen by the keepers, crews and lookouts watching at that moment. Piece C commits `crime.contraband` through the same `commit` when her hold search finds it.
- **Save v7** adds the top-level `wanted`, `fame`, `profiles` (the ship's hull number, class and name), `reports` (`inProgress` and the open crimes they're about) and `jail` (null; piece D fills it). A 0.4.0 save loads Clean everywhere where it was saved.
- **Dev:** the overlay's Law folder shows heat and tier per region, Fame, the reports on their way and the last law event, and commits a crime with a chosen witness, files every report now, intercepts the next one and sets a region's tier. `__glpLaw` does the same from the console.
- **Not in piece A:** personal recognition is worked out from Fame rather than stored; the per-region alert has no effect until pieces B and C read it; bribes and fines (piece E) and jail (piece D) will use `setHeat`, which also resets the tier-4 floor.

### 14.9 Built: piece D, capture, jail and the run's end (2026-11-07)

- **The seam with piece C:** the cutter raises `PlayerCaptured { by, region, how: surrender | boarded, at }` once, before her arena ends with `caught`, and `PursuitChanged { pursued, by }` as a hunt starts and ends (`src/modes/context.ts`). Piece D takes over once the arena has gone: the captain is jailed (or bound for the rope), the voyage is over and the jail screen is up. `__glpCapture.capture(region)` raises it from the console until piece C lands.
- **Data:** `data/jail.json` holds the lockup (Bayfield, `pier.bayfield_city`), 12 §8.1's sentences and bail by tier (low end at the tier's least heat, high end at the next tier's), execution from tier 5, release to tier 1, the impound fee ($15 + $5 a week, worked off at $3 a day when nobody can pay) and "send word" ($5 and 12–30 game hours).
- **Jail** (`src/sim/law/jail.ts`, `src/gameplay/capture.ts`): cargo and cash on hand are confiscated, hideouts untouched. Serving the sentence runs the world ticks for its weeks (a game day each), pays the impound fee from the richest strongbox or adds the days to work it off, and brings the region's heat down to tier 1. The release screen says what changed while you were inside: the date, Bayfield prices that moved 10% or more, where the *Morrill* was last seen and regions that cooled. Then the ship is alongside Bayfield's city dock and the port screen opens.
- **Bail** by sending word to a strongbox takes bail, the impound fee and the messenger's fee together, and you're out when the money comes (seeded by the run, so a reload doesn't change it). **Smaller call (Jared can override):** bail lets you out early but doesn't clear your name; only time served brings heat down to tier 1. The trusted-fence route waits for fences in Phase 6.
- **The jailbreak** is a button that says it's not built yet, in the cell and as the tier-5 "ONE CHANCE". At tier 5 the gallows screen leads to the end of the run.
- **The run's end** (`src/sim/run/run-end.ts`): a front page from the Bayfield weekly (the Duluth paper once you're Known), the run summary (weeks and seasons, money earned and left, peak Fame and Wanted, crimes, contracts, captures, "never killed a soul", how it ended) and the logbook as Markdown to download. Per 16 §3, `lastRun` is written and every run slot deleted in one transaction before the end screen shows, then a Hall of Captains record is added. The main menu shows the last run's front page until a new captain starts. **Abandon run** is on the pause menu, with a confirm.
- **The record:** the optional `stats` and `logbook` slices (no version bump) are written from the bus (`src/gameplay/record.ts`): ports made, trades, contracts, the smuggler, word reaching the law, tier changes, capture and release. The logbook keeps its last 400 lines.
- **Danger and the tab** (16 §4): see 16 §12.
- **Permadeath notice** on character creation, ticked once and remembered (12 §2.1 step 6).

---

## Changelog
- v0.7: Phase 5 piece D built (§14.9): capture, jail, bail, the rope and the run's end.
- v0.6: Phase 5 piece A built (§14.8): crimes, tiers, regions and law actors data, the crime pipeline, save v7.
- v0.5: Phase 5 scope proposal (§14): what Phases 3–4 change, deliverables, exit criteria, nine pieces, smaller calls and two decisions (what crimes exist, the sailing speed pass).
- v0.4: Phase 2 piece F: lights built from `data/lighthouses.json` ([14 §18](14-art-direction-asset-pipeline.md)); visual only.
- v0.3: Gap review: seven Wanted regions, Respectable Captain Fame, no disguise items, hideouts end pursuit, bail source from 12, MVP lockup at Bayfield, light characteristics and the Duluth life-saving station researched.
- v0.2: Decisions: six tiers, heat spread, no inspections at tier 0, no ship disguise (only replacing the ship), one jailbreak before execution, copycat rivals; removed company guards and the bank freeze.
- v0.1: Initial law plan: crime pipeline, severity, identification and ship profiles, report delays, regional tiers, decay and reduction, heat spread, Fame tiers and effects, Standing link, cutter behavior, harbor law, marshals, lighthouses (detection, raids, false lights, investigations), the detection model, capture outcomes, newspapers, data/state, Phase 5 acceptance.
