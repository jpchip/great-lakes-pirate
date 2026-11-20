# 12 — Sandbox Goals, Events, Character Creation & Failure

Status: DRAFT v0.7 (decisions made; gap review applied; Phase 5 built as 0.5.0; Phase 7's parts in 0.7.0)
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
- **Logbook marks (decided):** finished goals are not a separate badge tray. Each completed Ambition (and onboarding milestones like the Captain's First Week) earns a **themed mark** in the journal, same ink-and-paper voice as the ledger: a bank draft for wealth, a WANTED clipping for infamy, a freight agent's seal for trade, and so on. The player can clear a mark from the ledger; the deed stays in the daily logbook. Pinned Ambitions on the HUD are unchanged.

| Category | Examples |
|---|---|
| **Wealth** | Hold $1,000 / $10,000 / $50,000 across your hideouts |
| **Infamy** | Reach Fame tier 3 / 4; be Most Wanted in a region and survive a week; escape the *Morrill* 3 times |
| **Trade** | Max Standing in 3 ports; complete 25 contracts on time; "first boat in" at Duluth after ice-out |
| **Seamanship** | Duluth → Bayfield in under a set time; ride out a November gale at sea; sail through a whole winter |
| **Builder** | Claim all 7 hideout sites; build a hideout with 500+ pieces; build a schooner on a slipway |
| **Explorer** | Complete all legends; set foot on all 22 islands; salvage a deep wreck |
| **Seavey homages** | *Moon-Cusser:* wreck a ship with a false light · *The Nellie Johnson:* loot a crew drunk on your whiskey · *Venison King:* sell 50 CU of venison · *Won It at Poker:* win a cargo in a card game (§5.3) |

**As built (Phase 8 piece H, 2026-11-16):** `data/ambitions.json` holds 14 goals that the MVP can meet: three of wealth (cash across your hideouts: $1,000, $10,000, $50,000), four of infamy (Fame tier 3 and 4, escape the *Morrill* three times, a week at large while Most Wanted), two of trade (25 contracts on time, Standing 90 in three ports), two of seamanship (three record runs, making port through a November gale with the storm signal up) and three builder goals (both hideout sites, a hideout of 500 pieces, a schooner launched from your slipway). The journal's ledger has an **Ambitions** tab to pin up to three; the pinned ones sit on the HUD under the First Week, with a meter each, and fold to a line. A goal met is done whether pinned or not: it pays its reward (cash, some Fame), writes a logbook line, leaves its category's mark in the ledger (a bank draft, a WANTED clipping, a freight agent's seal, a pilot's chit, a surveyor's plat), clearable, and the papers print a story for it (`stories.ambition` in `newspapers.json`). Counters come from the bus by name: `ContractCompleted`, the papers' new `FeatAccomplished` (escape, record run, gale run, first boat), and `ShipLaunched` for piece G to raise. The builder goals read `hideouts[id].pieces` as an array (piece A). The "Duluth → Bayfield in a set time" example became the record-run goal, which the papers already judge; ice-out, winter and the explorer and Seavey goals wait for Phase 9's content. Saved as an optional `ambitions` slice, so no version bump.

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
| **Trade-only communities** | Seasonal notices: wild rice in at Bad River, maple sugar at Red Cliff | Trading only ([R1 §5](R1-western-superior-1900-research.md)). **Red Cliff:** in-season saloon rumors in the Apostles/Chequamegon/Ashland regions ([05 §26.5](05-ports-economy-trading.md)); Bad River still out. |

### 5.3 Poker night (Seavey: "won the *Nellie Johnson* in a poker game")
- A short, abstract card game in saloons (e.g., simplified five-card draw against 2–3 NPCs) with stakes: money, cargo, a **freight contract**, a cache map, or an IOU.
- You can't win a ship (decided: always your own ship), but you can win **a ship's cargo**.
- Cheating option (a sleight check): if caught, there's a brawl or assault heat.
- **Decided: included.** Poker night is in.

**Result:** built, as [11 §18.4](11-exploration-islands-secrets.md)'s piece C (exit criterion 5), from `data/poker.json`:
- **The table:** after supper (19:00–01:00) at every port with a saloon, a Card table tab; in Bayfield a table (`shop.card_table`) in the saloon you walk up to. Two or three of nine fictional captains who sit in that port, drawn from the run's seed for the port and night, with stacks in antes. Ten hands a night; a captain short of 14 antes goes up to bed.
- **The game:** five-card draw, limit betting (a bet is 2 antes before the draw, 4 after, a bet and one raise a round), one draw of up to three (four keeping an ace). You act first; each captain bets on his hand's place among all hands, by his style (tight, loose, bold, cagey), with a little noise and a chance to bluff. A strong or weak hand shows his tell, true at his honesty, else the other one.
- **Stakes:** cash in the pot; and a captain's marker (a cargo lot sized to your hold, a contract off the port's board, or a map to an unfound cache), offered on 30% of nights and every poker night, matched with cash, a lot of yours or a contract of yours worth 80% of it. The two of you settle it at the showdown; folding forfeits it. A lost contract passes to him without a mark against your name. A map is a true rumor in the ledger naming the cairn: piece O can turn it into a lead.
- **Cheating:** palm a card at the draw (the best card left in the deck swaps in). Unseen at 90% less 12% for each eye still in the hand (by its sharpness) and 15% for each card palmed at the table that night, between 10% and 90%. Seen: take your licking (pot and stake lost, a tenth of your purse) or swing first (your money back, `crime.assault` witnessed by the saloon). Barred a game day (a week) and Standing −6 at the port either way.
- **Poker night** (`event.poker_night`): rumor and paper, in the afternoon at a port with a saloon; that night's ante doubles and a marker is certain.
- **Won It at Poker:** a trade Ambition, the `pokerCargoes` counter, from `PokerPlayed` with a cargo or contract won; it has its line in the papers.
- Screenshots are in the project files (`poker-night/`).

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
- **Phase 4:** character creation (name, appearance presets, background), starting scenario, First Week checklist (trade parts). Starting hideouts attach in Phase 8, when hideouts exist. **Built 2026-11-02 (Phase 4 piece C, [05 §19](05-ports-economy-trading.md)):** `data/backgrounds.json` and eight portrait presets; a new run opens docked at the background's starting pier at sunrise on May 7, 1900; the Deckhand's and Fisherman's perks wired (the Saloon Keeper's rumors by piece K), the rest stored for their phases; the First Week's five steps in the journal and on a HUD tracker. The run seed is on the creation screen; the permadeath notice waits for Phase 5.
- **Phase 5:** jail, bail, the release summary; newspapers v1 (headlines, WANTED); death and end screen plus run summary. **Built 2026-11-07 (Phase 5 piece D, [06 §14.9](06-fame-wanted-law-lighthouses.md)):** `data/jail.json`, the cell, gallows and release screens, bail by sending word, the jailbreak stubbed, the end screen's front page, summary and logbook export, `stats` and the logbook. No permadeath notice: Jared dropped it. **Newspapers v1 built 2026-11-08 (piece F, [06 §14.12](06-fame-wanted-law-lighthouses.md)):** `data/newspapers.json`, the four papers' daily editions with templated headlines exaggerated by Fame, the WANTED column, cutter sightings, the weather outlook and storm signals, sold at the port screen; nicknames, shipping news and prices wait. **Checked in the Phase 5 playtest (2026-11-08, [06 §14.14](06-fame-wanted-law-lighthouses.md)):** capture below tier 5, bail from the Stockton strongbox and the gallows to the end screen pass end to end in `e2e/capture.spec.ts`; a month of crime with a full logbook saves in 8.8 KB. Bail also clears heat to tier 1 from 2026-11-08 (Jared's decision); the end screen's look is still open.
- **Phase 7 (built as 0.7.0, [08 §20](08-docks-district-stealth.md)):** the First Week's optional sixth step ("A warehouse in Bayfield looks poorly watched…", ticked by a burglary ashore, never needed for the mark); the Poacher's boot pick (never runs out, a quarter quicker, and the only pick that opens a cell door) and quiet feet, and the Lumberjack's faster carrying; a capture on foot into the same jail, with a fine and no confiscation for the small things at tiers 0–1; and the jail screen's **Break out**, the lockup scenario of 08 §9, which at tier 5 is the one chance before the gallows and the run's end.
- **Phase 8:** Ambitions, and starting hideouts attached (the Lumberjack at Siskiwit Bay). **Built as Phase 8 piece H** (§4.1). The event system and letters moved to Phase 9 (Jared, 2026-11-16, [09 §16.6](09-hideouts-building-crafting.md) decision 1): they're mostly content and belong with the full catalog and the rivals.
- **Phase 9:** the event system with the first ~10 events and letters, then the full event catalog, the Hollister feud, copycat rivals, nickname generation, poker, the Mataafa event, voluntary endings, Hall of Captains. Scoped in [11 §18](11-exploration-islands-secrets.md) (stage 1, pieces A–E, and the Mataafa storm in piece K). **The Hollister feud built 2026-11-18 (piece D):** `data/feuds.json` and `feuds` in the save; quiet until three fish sales at Bayfield inside three game days, then Hollister's undercut (60%), its refusal (after two more sales or two game days; its contracts shunned too), terms by letter every few game days (taken, 85% for good), and pressure by the sheds (sabotage, a new crime at the packing house's brine barrels, and burglary), the tugs (piracy, firing on, sinking, stolen contracts) and trade (fish sold elsewhere, Standing won in Bayfield), counted whether named or not; a $100 reward (heat) at 50 from crime, and at 100 Hollister gives by the leading method (115% after, Fame 6, its own letter and front page). Each beat is a `feud` event in `events.json` with `draw: false`.

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
| 2026-11-08 | Ambitions and milestones use **logbook marks** in the journal (not a generic achievement UI); the First Week is the first mark. |

---

## Changelog
- v0.12: The nickname (§6.3), the voluntary endings (§4.2) and the Hall of Captains (§9) built as Phase 9 piece B ([11 §18.9](11-exploration-islands-secrets.md)).
- v0.11: §11's Phase 8 row is Ambitions only; the event system and letters move to Phase 9, matching the master plan (09 §16.6 decision 1).
- v0.10: Ambitions as built (§4.1; Phase 8 piece H): 14 goals, pinning up to three on the HUD, themed marks in the ledger, rewards and the papers' stories.
- v0.9: Phase 7 as built (§11): the First Week's sixth step, the on-foot perks, minor arrests and the jailbreak.
- v0.8: Ambitions shown as themed logbook marks in the journal; the First Week collapses to one clearable mark (Jared, 2026-11-08).
- v0.7: Bail brings the region down to tier 1, as time served does (Jared, 2026-11-08).
- v0.6: Phase 5 playtest (§11): jail, bail and the end screen checked; bail and heat and the end screen's look left for Jared.
- v0.5: Phase 5 piece D built (§11): jail, bail, release and the end screen. The permadeath notice was dropped at Jared's request.
- v0.4: Phase 4 piece C built (§11): character creation, backgrounds, the new run and the First Week.
- v0.3: Gap review: pre-built starting hideouts, MVP starting sites, Bayfield lockup, batch time skip for sentences.
- v0.2: Decisions: newspaper nicknames, Retire and Lawman endings, poker, per-background starting hideouts and ports (with an adaptive First Week), Hall of Captains.
- v0.1: Initial sandbox plan: character creation and 6 backgrounds with perks, the starting scenario and First Week onboarding, Ambitions, voluntary endings, the data-driven event system and catalog (Seavey-inspired opportunities, Hollister feud, poker), newspapers and nickname generation, copycat rival templates and lifecycle, jail sentences and bail, release summary, death causes, end-of-run front page and summary, data/state, phasing.
