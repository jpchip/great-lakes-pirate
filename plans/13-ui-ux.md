# 13 — UI / UX

Status: DRAFT v0.3 (decisions made)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs: [01](01-tech-architecture.md) (Preact DOM overlay, input action map, budgets), the HUD and screen needs of every system plan (02–12), master plan (mouse and keyboard only, stylized art, period flavor, sepia/newsprint UI idea)
Feeds: 14 (UI art assets, fonts), 15 (UI sounds), 17 (usability testing)

## Purpose

Define the look and behavior of every piece of interface:
- the visual language
- the HUD per game mode
- the full screen list
- interaction patterns and the notification system
- the chart and journal
- accessibility, localization readiness, and UI performance on the integrated GPU

---

## 1. Principles

1. **Period voice, modern clarity.** It looks like 1900 (charts, ledgers, newspapers, engraved icons) but reads instantly. Never sacrifice legibility for flavor.
2. **The world first.** The sailing HUD stays minimal. The lake, sky and ship carry most of the information (pennant, heel, telltales, wind streaks; [02 §9](02-arcade-sailing.md)).
3. **Always explain consequences:** heat, detection, risk of death, invalid placements. The player should never be confused about *why* something happened.
4. **Mouse and keyboard native:** hover tooltips, right-click actions, shift-click for bulk, scroll for quantities, full keyboard shortcuts. No gamepad.
5. **Cheap:** a DOM overlay with no expensive CSS effects; it updates only what changes.

---

## 2. Visual Language

### 2.1 Motifs
| Context | Motif |
|---|---|
| Menus, journal, ledgers | **Logbook and ledger paper**: ruled lines, ink, a pasted-in clipping style |
| Chart mode | **Period nautical chart**: parchment, soundings, compass rose, hand-drawn coastlines |
| Newspapers, end screen, big alerts | **Letterpress newsprint**: woodtype headlines, columns, engravings |
| HUD instruments | **Brass and enamel instruments**: compass, barometer, a lead-line gauge, simplified and flat |
| Trade, shipyard, crafting | **Merchant's ledger** plus stamped labels and crate stencils |

### 2.2 Color tokens (draft; tuned with the art style in plan 14)
| Token | Use |
|---|---|
| `ink` (near-black brown) | Text on paper |
| `paper` (warm parchment) | Panels |
| `brass` (gold) | Highlights, best-angle band, selected items |
| `signal-red` | Danger: Wanted, damage, invalid, lethal choices |
| `lake-teal` | Water and navigation info |
| `fog-gray` | Disabled, stale info (old prices, old rumors) |
| `ember` (orange-red) | **Hot goods** marker ([05 §6.1](05-ports-economy-trading.md)) |

**Colorblind-safe rule:** every color signal also has a **shape or icon** (Wanted tiers, detection states, hot goods, validity).

### 2.3 Typography (decided: period type; open-license fonts only; final picks in plan 14)
- **Display / headlines:** a woodtype-style or bold old-style face (candidates: OFL fonts such as *Rye*, *Abril Fatface*, *Playfair Display*).
- **Body / UI text:** a highly legible serif (candidates: *Libre Caslon Text*, *Old Standard TT*, *IM Fell* for flavor accents only).
- **Numbers on the HUD:** a tabular-figure serif or a plain sans for quick reading.
- **Accessibility option:** swap all period fonts for a plain, high-legibility font.
- All fonts must be OFL or similar and listed in `CREDITS.md` ([01 §10](01-tech-architecture.md)).

---

## 3. UI Architecture

- **Preact + signals** DOM overlay above the canvas ([01 §2.2](01-tech-architecture.md)).
- UI **reads** simulation state through selectors and **dispatches** gameplay actions. It never mutates state directly ([01 §6](01-tech-architecture.md) import rules).
- **Screens and overlays map onto the mode state machine** ([01 §3.2](01-tech-architecture.md)): HUD layers per mode, plus overlay screens (trade, journal, etc.) that pause or slow gameplay as each mode defines.
- **Input focus:** opening any overlay releases pointer lock (on foot) and switches the input context. Closing restores it.
- **Scaling:** a UI scale setting (75–150%). The layout is designed at 1920×1080 and supported down to 1280×720, with safe-area anchoring for 16:10 and ultrawide.
- **Strings** are externalized (i18n keys) from day one, though the MVP ships in English only.

---

## 4. HUD by Mode

### 4.1 Sailing (minimal default)
```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Wk of Jun 4, 1900 · dusk ☾]          ── N ─ NE ─ E ──          [Region ▲▲]│
│ [Barometer ↘]                         (compass strip)          [👁 report]│
│                                                                          │
│                                                                          │
│ [Pinned Ambitions ▸]                                                     │
│                                                                          │
│                                                     ┌────────────┐       │
│ [toasts…]                                           │  WIND RING │ 7.4kn │
│                                                     │  ⛵ + bands │ HALF  │
│ [Hull ▓▓▓▓░] [Rig ▓▓▓░░] [Strain !]  [Depth ▼ 4m]   └────────────┘ 🏮    │
└──────────────────────────────────────────────────────────────────────────┘
```
- **Wind ring** (bottom right): a ship icon, the wind direction, the red no-go zone, the gold best-angle band, and the trim sweet spot when manual trim is on ([02 §9](02-arcade-sailing.md)). Speed and sail level sit beside it.
- **Bottom left:** hull and rigging bars. The **strain** warning appears only when overpressed. **Depth** appears only in shallows.
- **Top:** date, time and moon phase, the compass strip, the **region Wanted indicator** (tier icons with distinct shapes; the tier-5 noose is unmistakable), and the **report-in-progress** eye with a timer ([06 §2.4](06-fame-wanted-law-lighthouses.md)).
- **Contextual:** the barometer (if owned), the lantern state, pinned Ambitions (collapsible), and the toast feed.
- **Aim mode** ([07 §3](07-combat-boarding-targets.md)): the arc preview and splash ring, the selected weapon and ammo, the reload ring per side, and a "steering locked" indicator on T1.
- **Target info** (when a ship is spotted or identified): name, class, flag, estimated cargo class, and a **morale/surrender** flag icon.
- A **HUD density** setting: **Minimal (default, decided)** / Full (always show everything) / Off (screenshots).

### 4.2 On foot ([08 §12](08-docks-district-stealth.md), [11 §3](11-exploration-islands-secrets.md))
- **Light meter** (a "light gem") and **noise ring** (bottom center).
- **Eye indicators** over NPCs (filling = suspicion, red = alerted) plus off-screen directional markers.
- Health. **Warmth** (winter, wet). Carry load. The tool belt (1–6).
- **Dawn countdown** (night ashore), interaction prompts (with hold-progress rings for picking, digging and building), the region Wanted indicator, the report eye.
- **Wildlife warning** cues (growl or howl direction markers) when relevant ([11 §3.2](11-exploration-islands-secrets.md)).

### 4.3 Chart mode ([03 §5](03-world-scale-chart-travel.md))
- A full-screen period chart with these layers:
  - coastlines and soundings
  - ports and lights (with light-tier rings at night)
  - **region heat tint**
  - weather (fronts, fog, ice)
  - rumor markers (the *Morrill*, with age and uncertainty circles)
  - **leads** (search circles)
  - fog of war
- **Course plotting:** click waypoints, drag to adjust, shift-click to insert. Shoal warnings. An ETA in game time, the weather along the route, and the **lookout setting** toggle.
- An **encounter popup** (card style) with the choices Engage / Avoid / Ignore and the odds and info shown.
- A **"chart locked: you are being pursued"** banner when detected.

### 4.4 Build mode ([09 §9](09-hideouts-building-crafting.md))
- A **palette** (left): category tabs, piece tiles (icon plus name), material and paint variants.
- **Cost panel** (right): the selected piece's cost, the total queued cost vs. available materials (hideout plus moored ship), and the estimated build time with the crew multiplier.
- A level indicator, grid toggle, undo/redo, blueprint save/load, and the **Build** button.
- **Validity tooltips** on the ghost ("Needs support below").

### 4.5 Combat & boarding
- The aim HUD (4.1), plus **damage numbers off by default, with a setting to enable them (decided)**, and a **casualty log** strip ("2 killed aboard the *Ada Bell*") ([07 §4.3](07-combat-boarding-targets.md)).
- **Boarding check panel** ([07 §6.2](07-combat-boarding-targets.md)): your strength vs. their defense (bars), with **Intimidate / Fight / Withdraw** choices showing success odds, expected casualties, heat impact, and the **player death risk** in red when present.

---

## 5. Screen List

| Screen | Source plan | Key elements |
|---|---|---|
| **Main menu** | 12, 16 | Continue (single run), New Run, Hall of Captains, Settings, Credits and Licenses |
| **Character creation** | 12 §2 | Name, appearance (live 3D preview), background cards (perks, starting hideout and port, "harder start" tag), ship name, seed, permadeath confirmation |
| **Pause** | — | Resume, Settings, Journal, Save & Quit (autosave), Abandon run (confirm) |
| **Settings** | 01, 02, 03, 08 | Graphics preset and resolution scale, UI scale, HUD density, audio buses, **control rebinding**, gameplay (manual trim, tips, lookout default), accessibility (§9) |
| **Trade** | 05 §12 | Port goods, buy/sell prices, your hold (hot goods marked), last-seen prices elsewhere, capacity bar, quantity slider |
| **Fence** | 05 §6.2 | The rate offered per item, the fence's weekly cash, an informant risk hint |
| **Contracts board** | 05 §5.2 | Available contracts (pay, deadline, deposit, company), Standing per company and port |
| **Shipyard** | 10 §12 | 3D preview, hull comparison, trade-in breakdown, upgrade slots (drag-drop), costs and install time |
| **Cosmetics editor** | 10 §7 | Paint, trim, figurehead, nameboard, flags, sails, with a live preview |
| **Storage transfer** | 09 | Hold ↔ hideout storage (two columns), cash ↔ strongbox, hot-goods cooling timers |
| **Crafting station** | 09 §7 | Recipes (available or missing inputs), queue, passive production status and caps |
| **Journal** | 11 §11, 12 | Tabs: **Logbook** (auto-written story), **Leads & Legends**, **Ambitions**, **Contracts**, **Rumors**, **Prices ledger**, **Discoveries & Curios**, **Guide** |
| **Newspaper reader** | 12 §6 | A front-page layout per paper: headlines, WANTED, shipping news, prices, weather, ads |
| **Dialog / vignette** | 12 §5 | A portrait card plus text plus choices (saloon talk, events, keeper visits, parley) |
| **Poker table** | 12 §5.3 | A simple card table: hand, bets, opponents' tells, cheat action |
| **Looting** | 07 §7.1 | Target manifest ↔ hold, a "valuables first" quick-grab, a time-pressure meter |
| **Aftermath** | 07 §7.2 | Let go / Disable / Set adrift & scuttle / Sink, each with its heat and witness consequences |
| **Abandon ship** | 02 §6.5 | Survival risk rating (shape plus color), confirm |
| **Tier-5 warning** | 06 §3.2 | A full-screen "WANTED: DEAD OR ALIVE" newspaper page, shown once per region |
| **Jail** | 12 §8.1 | Sentence, bail options (send word / fence), jailbreak option ("ONE CHANCE" at tier 5) |
| **While you were inside** | 12 §8.1 | A summary of world changes on release |
| **End of run** | 12 §9 | The front-page obituary or epilogue, run summary, **logbook export**, return to menu |
| **Hall of Captains** | 12 §9 | Past runs: name, nickname, epitaph, summary |
| **Loading** | 03 §7 | Period transitions (a chart unrolling, a newspaper page, a fade to fog) plus tips |
| **First Week checklist** | 12 §3 | A journal page plus a small HUD tracker |

---

## 6. Interaction Patterns

- **Quantities:** a slider plus mouse wheel. **Shift-click** = move all, **Ctrl-click** = move one, **right-click** = context menu (sell, stash, drop, inspect).
- **Tooltips** everywhere, with **stat deltas** and a plain-language effect ("+5% speed at all sail levels").
- **Confirmations only for irreversible or high-stakes actions:** abandoning ship, a Fight with death risk, attacking the cutter or law, killing actions (the first time per run), deconstructing large structures, abandoning the run, the tier-5 jailbreak. Never for routine actions.
- **Esc** closes the top overlay. **Tab** cycles tabs in a screen. Common screens have hotkeys: **J** journal, **M** chart, **B** build, **I** inventory/hold.
- **Lists** are sortable and filterable (trade by profit, journal by type).
- **Hold-to-confirm** for dangerous single-key actions (e.g., hold **F** to scuttle).

---

## 7. Notifications

| Priority | Examples | Presentation |
|---|---|---|
| **Critical** | Wanted tier up, report filed, storm warning, hull critical, warmth critical, ice cracking, pursuit started, tier-5 reached | Banner (center top) plus sound; it persists until acknowledged or the condition clears |
| **Important** | Ship surrendered, contract due soon, legend step complete, rival sighted, production done | A toast (left) with an icon; auto-dismisses; logged |
| **Ambient** | Price seen, rumor added, journal updated | A small journal pip; no toast |

- **Anti-spam:** bundle repeats ("3 rumors added"), throttle per category, and turn tips off once you've seen them.
- Everything important is also written to the **Logbook**.

---

## 8. Chart & Journal Details

### 8.1 Chart rendering
- A 2D canvas (or an orthographic three.js layer) drawing coastline polygons from the chart data ([03 §8.2](03-world-scale-chart-travel.md), step 9), sounding numbers, period labels and icons, over a parchment texture.
- Layers are toggleable. Pan and zoom with mouse drag and the wheel.
- **No minimap (decided).** Navigation uses the world itself (landmarks, lights, compass, depth) and the chart (**M**). That fits the world-first principle and saves a render pass.

### 8.2 Auto-written logbook (decided)
- Events generate **period-voice entries**: *"Wk of June 4, 1900. Took the schooner* Ada Bell *off Sand Island at dusk; her crew set adrift in fair weather. No lives lost."*
- Templates come from event data (§5 of plan 12). Entries are the basis of the **logbook export** at the run's end.
- The player can **add their own notes** (free text).

---

## 9. Accessibility

| Option | Notes |
|---|---|
| UI scale and HUD density | §3, §4.1 |
| **Plain font mode** | Swaps the period fonts |
| **Colorblind modes** | Palette presets; shapes are always paired with color |
| **Captions for audio cues** | Foghorn direction, guard shouts, growls and howls, gunshots (with direction) |
| **Reduce motion** | Camera roll (off by default), screen shake, the knockdown lurch intensity |
| **Photosensitivity** | Limits lightning flash intensity and frequency |
| Brightness / gamma | Night readability ([04 §9](04-water-weather-seasons.md)) |
| **Hold vs. toggle** | Crouch, aim, spyglass, run |
| **Full key rebinding** | Through the input action map |
| Pause anywhere | Except a brief autosave write (instant) |
| Text speed / auto-advance | For dialog vignettes |

---

## 10. UI Performance (integrated GPU)
- **No backdrop blur, heavy shadows or large animated filters.** Paper textures are static images.
- HUD numbers update at **≤ 10 Hz**. Gauges are small SVG elements or one small canvas, using CSS transforms only (no layout thrash).
- **Signals-driven** fine-grained updates; nothing re-renders every frame.
- Overlays mount on demand. Big lists are virtualized (journal, logbook).
- Budget: UI ≤ 1 ms main-thread per frame during gameplay.

---

## 11. Settings Storage
UI and settings preferences are stored **outside the run save** (a separate IndexedDB/localStorage key; [16](16-save-persistence.md)), so they survive permadeath. The Hall of Captains is stored the same way.

---

## 12. Phasing
| Phase | UI scope |
|---|---|
| 1 | Sailing HUD v1 (wind ring, speed, sails, hull/rigging, depth, clock), settings (graphics presets, resolution scale, key rebinding basics), dev overlay |
| 3 | Chart mode, encounter popups, lookout setting |
| 4 | Main menu, character creation, trade, contracts, shipyard, storage transfer, journal v1 |
| 5 | Wanted indicator, report eye, tier-5 warning, jail screens, newspaper reader v1, end-of-run screen |
| 6 | Aim HUD, target info, boarding panel, looting, aftermath |
| 7 | Stealth HUD (light meter, noise, eye indicators, dawn countdown) |
| 8 | Build mode UI, crafting, notifications polish |
| 9 | Full journal (legends, curios), poker, Hall of Captains, logbook export |
| 11 | Accessibility pass, visual polish, usability testing |

---

## 13. Cut List
1. 3D preview in character creation (use 2D portraits).
2. Player-written journal notes.
3. Animated loading transitions (static images).
4. Sortable and filterable lists (fixed sort only).

*Not cuttable:* clear Wanted, detection and risk feedback; boarding odds display; confirmations for lethal and irreversible actions; key rebinding; colorblind-safe shapes; captions; the chart; the journal and logbook; the end-of-run front page.

---

## 14. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | **Period typography** (woodtype and newsprint headlines, a legible serif body, a plain-font accessibility option). |
| 2026-10-21 | **Minimal HUD** by default. |
| 2026-10-21 | **No minimap.** |
| 2026-10-21 | **Auto-written period-voice logbook**, exported at the end of a run. |
| 2026-10-21 | **Damage numbers off by default**, with a setting to enable them. |

---

## Changelog
- v0.3: Gap review: removed the stale minimap mention in §2.1; §11 links to plan 16 directly.
- v0.2: Decisions: period type, minimal HUD default, no minimap, auto-logbook, damage numbers off by default (optional).
- v0.1: Initial UI/UX plan: principles, visual language (motifs, color tokens, open fonts), Preact architecture, HUD per mode (sailing, on foot, chart, build, combat), full screen list, interaction patterns, notification priorities, chart and auto-logbook, accessibility, UI performance budget, settings storage, phasing.
