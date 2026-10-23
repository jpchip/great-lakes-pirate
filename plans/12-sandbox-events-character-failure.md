# 12 — Sandbox Goals, Events, Character Creation & Failure

Status: DRAFT v0.3 (decisions made; gap review applied)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan: custom pirate inspired by Seavey; name, appearance and background with perks; open sandbox; the legit path supported; permadeath always on; nothing carries over; jail, bail and jailbreak; execution only at the top tier
- [02](02-arcade-sailing.md): shipless play
- [04](04-water-weather-seasons.md): calendar, Mataafa event
- [05](05-ports-economy-trading.md): Standing, contracts, rumors
- [06](06-fame-wanted-law-lighthouses.md): crimes, Fame, newspapers, capture
- [07 §8.1](07-combat-boarding-targets.md): copycat rivals
- [08 §9](08-docks-district-stealth.md): jailbreak
- [09](09-hideouts-building-crafting.md), [10](10-ship-upgrades-customization.md), [11](11-exploration-islands-secrets.md): legends, curios
Feeds: 13 (creation UI, newspaper and journal UI, end screen), 15 (event audio), 16 (run lifecycle), 17 (playtesting goals)

## Purpose

Define the **run** from start to finish:
- character creation and backgrounds
- the starting scenario and onboarding
- optional goals (Ambitions) and voluntary endings
- the sandbox event system
- newspapers and the nickname the papers give you
- copycat rival templates
- jail details, death causes, and the end-of-run summary

---

## 1. Goals

1. **The player writes the story.** No forced plot. The world reacts, the papers tell the tale, and the journal records it.
2. **Gentle direction:** optional Ambitions and a first-week checklist keep new players moving without railroading.
3. **Seavey's spirit:** his exploits become repeatable *opportunities* (the whiskey hijack, moon cussing, poaching runs, a fish-company feud), not scripted missions.
4. **Failure is meaningful and fair:** permadeath is always on, but deaths are telegraphed, and capture below the top tier means jail, not death.
5. **Every run ends with a story:** a front-page obituary (or retirement notice) plus a run summary.

---

## 2. Character Creation

### 2.1 Steps
1. **Name:** first and last name. (Your **nickname** is earned later from the newspapers; §6.3.)
2. **Appearance:** stylized presets: body type, face, skin tone, hair and beard, hat, coat and clothing palette. It uses the shared character base ([08 §13](08-docks-district-stealth.md)).
3. **Background** (§2.2): sets starting money, cargo and two perks.
4. **Name your schooner** (the starting T1).
5. **Run seed:** shown and editable (random by default), for sharing or replaying a world layout ([11 §9](11-exploration-islands-secrets.md)).
6. A **permadeath notice** (always on; nothing carries over), confirmed once.

### 2.2 Backgrounds (6)
| Background | Start money & cargo | Perk 1 | Perk 2 | **Starting hideout → starting port** |
|---|---|---|---|---|
| **Deckhand** | $150; rope and canvas | Faster sail changes (−25% time; big when solo) | Wider manual-trim sweet spot; +5% speed when trimmed | Stockton Island bay → **Bayfield** |
| **Fisherman** | $100; salted fish | Knows fish prices in every port; Apostles reefs pre-charted | Better weather forecast (barometer and sky reading) | Outer Island fish camp → **Bayfield** |
| **Lumberjack / Teamster** | $120; lumber | Carry crates faster on foot; carry 1 extra CU in the rowboat | −15% building material costs; faster construction | Siskiwit Bay logging camp → **Washburn** |
| **Saloon Keeper** | $180; whiskey | Bribes cost −25%; better rumors | Whiskey trick works faster and on bigger crews | Minnesota Point lighthouse → **Duluth** |
| **Ex-Navy** | $130; powder and shot | +Cannon and swivel accuracy, faster swivel reload | +Intimidation in the boarding check | North Shore cove → **Two Harbors** |
| **Poacher / Trapper** | $100; furs | Tracking, trap yields, faster carcass carrying; slower warmth loss | A lockpick hidden in your boot (jailbreak start), quieter on foot | Devils Island sea caves → **Bayfield** |

**Decided:** each background starts with its **own hideout** (and the nearest suitable port). That gives different openings, regions and early strategies per background. The remaining site (Hermit Island quarry) is never a starting hideout; it's a discoverable early claim (and tied to the Quarryman's Payroll legend).

- A starting hideout comes **pre-built with a strongbox and basic storage** ([09 §2.2](09-hideouts-building-crafting.md)).
- **In the MVP** (2 sites), the Lumberjack starts at the Siskiwit logging camp and every other background starts at Stockton Island bay. Each background's own site arrives with the full 7 sites.

Perks are modest. They shape the early game and playstyle but never decide a run.

---

## 3. Starting Scenario & Onboarding

- **When and where:** the week of **May 7, 1900** ([04 §3.3](04-water-weather-seasons.md)), at dawn in your background's **starting port** (§2.2: Bayfield, Washburn, Duluth or Two Harbors). You own a T1 schooner (named by you), your background's cash and cargo, and a claim on your background's **starting hideout** ([09 §2](09-hideouts-building-crafting.md)).
- **"Captain's First Week" checklist** (optional, skippable, in the journal). It adapts to the starting port and hideout and teaches by doing:
  1. Sell your cargo in your starting port (trade screen).
  2. Take a freight contract to a nearby port (sailing, docking).
  3. Stash goods at your hideout (hideout storage).
  4. Visit the saloon and hear a rumor.
  5. Plot a chart voyage (chart mode).
  6. *Optional, flagged as crime:* "A warehouse here looks poorly watched..." (introduces night stealth and heat).
- **Onboarding note:** Duluth (Saloon Keeper) and Two Harbors (Ex-Navy) are busier, more policed starts, so the background picker labels them as "harder starts."
- **Contextual tips** on first encounters (first fog, first gale, first wanted tier, first ice), plus a guide section in the journal. They can be turned off.
- No forced tutorial island. You learn in the real world.

---

## 4. Ambitions (optional goals) & Voluntary Endings

### 4.1 Ambitions
- A catalog of optional goals. The player can **pin up to 3** to track on the HUD and in the journal. Completing one gives a small reward (money, a curio, Fame) plus a newspaper mention.

| Category | Examples |
|---|---|
| **Wealth** | Hold $1,000 / $10,000 / $50,000 across your hideouts |
| **Infamy** | Reach Fame tier 3 / 4; be Most Wanted in a region and survive a week; escape the *Morrill* 3 times |
| **Trade** | Max Standing in 3 ports; complete 25 contracts on time; "first boat in" at Duluth after ice-out |
| **Seamanship** | Duluth → Bayfield in under a set time; ride out a November gale at sea; sail through a whole winter |
| **Builder** | Claim all 7 hideout sites; build a hideout with 500+ pieces; build a schooner on a slipway |
| **Explorer** | Complete all legends; set foot on all 22 islands; salvage a deep wreck |
| **Seavey homages** | *Moon-Cusser:* wreck a ship with a false light · *The Nellie Johnson:* loot a crew drunk on your whiskey · *Venison King:* sell 50 CU of venison · *Won It at Poker:* win a cargo in a card game (§5.3) |

### 4.2 Voluntary endings (decided)
There's no win condition, but a run can end on your terms:
- **Retire:** available when you hold enough wealth and no region is at tier 3+. You choose a retirement (a farm in Peshtigo, a saloon in Duluth, a quiet island cabin). Epilogue newspaper plus run summary.
- **Turn Lawman** (Seavey homage; he later became a US Marshal): offered when **Fame is high, every region is at Wanted tier ≤ 1, and Standing is good**. You accept a deputy marshal's badge. The epilogue headline is ironic. The run ends.
- Both are optional. You can keep playing indefinitely, and permadeath still lurks.

---

## 5. Sandbox Event System

### 5.1 Structure
- **Data-driven events** (`events.json`): triggers (date, season, location, region, Fame, Wanted, Standing, flags, weather), weight, cooldown, prerequisites, and outcomes.
- **Delivery channels:**
  - rumors (saloons)
  - newspapers
  - **letters** waiting at harbor masters' offices (a simple mail system)
  - chart encounters ([03 §6](03-world-scale-chart-travel.md))
  - on-site scenes (dialog vignettes with choices)
- Events create **opportunities and threats** inside the simulation (spawning a special voyage, raising prices, moving the cutter). They aren't separate mini-games.

### 5.2 Event catalog (draft)
| Type | Event | Notes |
|---|---|---|
| **Opportunity** | **Payroll run**: a steamer carries a mining or lumber payroll on a known day | Rumor-timed special target ([07 §8](07-combat-boarding-targets.md)) |
| | **Storm-bound fleet**: a gale fills a harbor with waiting ships | Docks heist bonanza ([04 §5.4](04-water-weather-seasons.md)) |
| | **Wreck survivors**: a lifeboat adrift | Rescue (Standing, Fame), rob, or ignore |
| | **The whiskey hijack**: a crew with a captain ashore is idling in port (Seavey) | The whiskey trick, set up ([08 §6.2](08-docks-district-stealth.md)) |
| | **Moon-cussing night**: a new moon plus a storm plus a laden freighter due past a light | Wrecking setup ([06 §6.2](06-fame-wanted-law-lighthouses.md)) |
| | **Camp demand**: lumber camps pay a premium for venison or whiskey | Poaching or smuggling run |
| | **"First boat in"**: an ice-out race to Duluth for premium prices | Seasonal ([05](05-ports-economy-trading.md)) |
| | **Poker night** (§5.3) | Win or lose cargo, money, or a contract |
| **Feud chain** | **Hollister Fish & Packing feud**: the packer undercuts your fish sales and turns away your catch. Escalation is the player's choice (sabotage their sheds, rob their tugs, or out-trade them). | Echoes Seavey vs. Booth. Economic and crime only (companies don't arm up; [05 §8.2](05-ports-economy-trading.md)) |
| **Threat** | The *Morrill* arrives in the region · an informant sells you out · a marshal posse lands on your island · storm warning raised | From 06 and 04 |
| **Market** | Mill fire, herring run, grain glut, coal shortage | [05 §4.1](05-ports-economy-trading.md) |
| **Rival** | A copycat strikes your lane · a rival proposes a parley (§7) | From 07 |
| **Historical flavor** | Newspaper national news (1900 election, etc.) · the **Mataafa Storm, Nov 27–28, 1905** for long runs | [04 §5.3](04-water-weather-seasons.md) |
| **Trade-only communities** | Seasonal notices: wild rice in at Bad River, maple sugar at Red Cliff | Trading only ([R1 §5](R1-western-superior-1900-research.md)) |

### 5.3 Poker night (Seavey: "won the *Nellie Johnson* in a poker game")
- A short, abstract card game in saloons (e.g., simplified five-card draw against 2–3 NPCs) with stakes: money, cargo, a **freight contract**, a cache map, or an IOU.
- You can't win a ship (decided: always your own ship), but you can win **a ship's cargo**.
- Cheating option (a sleight check): if caught, there's a brawl or assault heat.
- **Decided: included.** Poker night is in.

---

## 6. Newspapers

### 6.1 Papers (fictional names, real towns)
| Paper | Town | Character |
|---|---|---|
| *The Duluth Daily Lantern* | Duluth | Big-city yellow journalism; the biggest Fame multiplier |
| *The Superior Courier-Ledger* | Superior | Rival to Duluth; loves to blame Minnesota |
| *The Ashland Ore & Lumber Gazette* | Ashland | Business and shipping focus |
| *The Bayfield Fishermen's Weekly* | Bayfield | Local gossip, fish, the weather |

Fictional names avoid misrepresenting real period papers (many real ones existed). Issue cadence: **a new edition each game day** (one calendar week), readable in ports for a few cents.

### 6.2 Contents
- **Headlines** from events with news value ([06 §9](06-fame-wanted-law-lighthouses.md)), using templates and **exaggerated by Fame** (yellow journalism; the bonus Fame and extra heat from 06 §4.1).
- **WANTED notices:** your description, ship profile and bounty by region (the tier 5 "DEAD OR ALIVE" page).
- **Shipping news:** arrivals and departures, which are **targets and intel**.
- **Market prices** (stale by the edition date), the **weather outlook** and storm signals.
- **Local color and period ads** (flavor), plus rival copycat stories and legend sightings (hooks).

### 6.3 Your nickname
- **Decided:** once your Fame reaches tier 1, the papers **coin a nickname** from your record. The most frequent or most notorious deeds and your haunts pick from template pools: *"Roaring"*, *"Black-Sail"*, *"Gentleman"* (non-lethal), *"Bloody"* (killings), *"the Moon-Cusser"* (wrecking), *"the Whiskey Pirate"*, *"of Devils Island"* (a hideout or haunt).
- The nickname appears in headlines, posters and the epilogue. It may **change** as your record changes. The player can't pick it, but can **reroll once** via a "letter to the editor."

---

## 7. Copycat Rivals (templates; from [07 §8.1](07-combat-boarding-targets.md))

| Field | Content |
|---|---|
| Name | A period first and last name plus a nickname coined by the papers |
| Personality | **Brute** (violent, high heat), **Sly** (stealthy thief), **Showman** (chases headlines), **Smuggler** (avoids fights, deals contraband) |
| Ship | Tier scaled to the player's (−1 to +0) |
| Base | Their own camp on an island or cove (never one of the player's 7 sites) holding their stash |
| Methods | Mimics the player's top methods (it's copycat behavior), which causes **blame confusion** |
| Lanes | Preferred region and target types |

**Lifecycle:**
- The first emerges at Fame tier 2. Up to 3 active at tiers 3–4.
- They leave by being defeated by you, captured or hanged by the law (a headline), retiring if your Fame drops, or lost in a storm.
- New ones may appear later while Fame stays high.

**Interactions:**
- They compete for prizes and raid "your" lanes.
- **Blame:** crimes are attributed by method similarity, so you might get heat for theirs, or they for yours.
- **Parley (proposal):** a rival may meet you in a saloon to propose a truce or region split. They may honor it, or betray you.
- Defeating one: Fame plus their stash location (a legend chain, [11 §8](11-exploration-islands-secrets.md)).
- **Never raids hideouts** (decided).

---

## 8. Capture, Jail & Death

### 8.1 Jail details (implements [06 §8](06-fame-wanted-law-lighthouses.md) and [08 §9](08-docks-district-stealth.md))
| Region tier at capture | Sentence | Bail (draft) |
|---|---|---|
| 0–1 | A fine or 1 week | $10–40 |
| 2 | 2–3 weeks | $60–150 |
| 3 | 4–6 weeks | $200–500 |
| 4 | 8–12 weeks | $600–1,500 |
| 5 | **Execution** (one jailbreak attempt) | — |

- **On capture:** cargo and cash on hand are confiscated. The ship is impounded. Hideouts are untouched.
- **Bail payment:** from a hideout stash via "send word" (a messenger fee plus a delay), or from a trusted fence (cost plus favor).
- **MVP:** prisoners are held in Bayfield's lockup ([08 §9](08-docks-district-stealth.md)).
- **Serving time:** a time skip (1 game day per week of sentence, run as a batch fast-forward; [01 §3.3](01-tech-architecture.md)) with a **"While you were inside..." summary** on release: prices, the cutter's location, rival activity, weather and season, your hideouts' production. Region heat resets to tier 1. Pay the impound fee to get the ship back, or steal it from the impound yard ([08 §8](08-docks-district-stealth.md)).
- **Jailbreak:** [08 §9](08-docks-district-stealth.md). Success adds +60 heat.

### 8.2 Death causes (permadeath)
Sinking with a failed survival check · drowning · combat (boarding at bad odds, on-foot fights) · cold exposure · thin ice · wildlife · falls · being too close to a boiler explosion · **execution**. Every cause is telegraphed in advance (warnings, risk ratings, "ONE CHANCE" banners).

---

## 9. Run End

1. **On death:** the save is deleted first ([01 §4.7](01-tech-architecture.md)), then the end screen appears.
2. **End screen:** a **front-page story** from the most relevant paper, using your nickname, e.g., *"ROARING JACK HANGED AT DULUTH"*, *"THE MOON-CUSSER LOST WITH HIS SCHOONER OFF OUTER ISLAND"*, or for voluntary endings, *"NOTORIOUS PIRATE PINS ON A MARSHAL'S STAR"*.
3. **Run summary:** days and seasons survived, money earned, peak Fame and nickname, ships robbed or sunk, lives taken (or "never killed a soul"), legends completed, hideouts built, Ambitions achieved, and how it ended.
4. **Logbook export:** download the journal as a text or markdown file (your story).
5. **Hall of Captains (decided):** a local list of past runs (name, nickname, summary, epitaph). **Records only, with no gameplay carry-over** (it respects "nothing carries over").

---

## 10. Data & State

**Data:** `backgrounds.json`, `appearance.json`, `ambitions.json`, `events.json`, `newspapers.json` (papers, headline templates, nickname pools), `rival_templates.json`, `jail.json` (sentences, bail), `endings.json`, `tips.json`.

**WorldState:**
- `player.character {name, appearance, background, nickname, nicknameRerolled}`
- `ambitions {pinned[], completed[]}`
- `events {active[], cooldowns, flags}`
- `mail[]`
- `newspapers {editions: last N per paper}`
- `rivals[]`
- `feuds {hollister: stage}`
- `jail?`
- `stats` (the run summary counters)

**Local (outside the save):** `hallOfCaptains[]`.

**Events:** `CharacterCreated`, `AmbitionPinned/Completed`, `EventTriggered/Resolved`, `LetterReceived`, `EditionPublished`, `NicknameCoined/Changed`, `RivalEmerged/Defeated/Captured`, `ParleyOffered`, `PokerPlayed`, `Sentenced`, `Released`, `RunRetired`, `RunEnded {cause}`.

---

## 11. Phasing
- **Phase 4:** character creation (name, appearance presets, background), starting scenario, First Week checklist (trade parts). Starting hideouts attach in Phase 8, when hideouts exist.
- **Phase 5:** jail, bail, the release summary; newspapers v1 (headlines, WANTED); death and end screen plus run summary.
- **Phase 8:** the event system with the first ~10 events, letters, Ambitions.
- **Phase 9:** the full event catalog, the Hollister feud, copycat rivals, nickname generation, poker, the Mataafa event, voluntary endings, Hall of Captains.

---

## 12. Cut List
1. Rival parley.
2. Nickname reroll.
3. Letters / mail system (rumors and papers only).
4. Poker cheating (keep honest poker).

*Not cuttable:* character creation with backgrounds and **per-background starting hideouts** (full game; the MVP uses its 2 sites), Ambitions, the event system, newspapers with nicknames, copycat rivals, jail/bail/jailbreak, **poker night**, **both voluntary endings (Retire and Turn Lawman)**, the end-of-run front page and summary, the **Hall of Captains**.

---

## 13. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Newspapers **coin your nickname** from your deeds (one reroll). |
| 2026-10-21 | Optional endings: **Retire** and **Turn Lawman**. |
| 2026-10-21 | **Poker night** included. |
| 2026-10-21 | **Each background has its own starting hideout** (and starting port); Hermit Island is a discoverable claim. |
| 2026-10-21 | **Hall of Captains:** records of past runs, no gameplay carry-over. |
| 2026-10-22 | Starting hideouts come pre-built with a strongbox and storage. MVP starts: Lumberjack at Siskiwit, everyone else at Stockton. MVP prisoners go to Bayfield's lockup. |

---

## Changelog
- v0.3: Gap review: pre-built starting hideouts, MVP starting sites, Bayfield lockup, batch time skip for sentences.
- v0.2: Decisions: newspaper nicknames, Retire and Lawman endings, poker, per-background starting hideouts and ports (with an adaptive First Week), Hall of Captains.
- v0.1: Initial sandbox plan: character creation and 6 backgrounds with perks, the starting scenario and First Week onboarding, Ambitions, voluntary endings, the data-driven event system and catalog (Seavey-inspired opportunities, Hollister feud, poker), newspapers and nickname generation, copycat rival templates and lifecycle, jail sentences and bail, release summary, death causes, end-of-run front page and summary, data/state, phasing.
