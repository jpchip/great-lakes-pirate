# 06 — Fame, Wanted, Law Enforcement & Lighthouses

Status: DRAFT v0.3 (decisions made; gap review applied)
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

---

## Changelog
- v0.3: Gap review: seven Wanted regions, Respectable Captain Fame, no disguise items, hideouts end pursuit, bail source from 12, MVP lockup at Bayfield, light characteristics and the Duluth life-saving station researched.
- v0.2: Decisions: six tiers, heat spread, no inspections at tier 0, no ship disguise (only replacing the ship), one jailbreak before execution, copycat rivals; removed company guards and the bank freeze.
- v0.1: Initial law plan: crime pipeline, severity, identification and ship profiles, report delays, regional tiers, decay and reduction, heat spread, Fame tiers and effects, Standing link, cutter behavior, harbor law, marshals, lighthouses (detection, raids, false lights, investigations), the detection model, capture outcomes, newspapers, data/state, Phase 5 acceptance.
