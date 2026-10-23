# 16 — Save & Persistence

Status: DRAFT v0.4 (decisions made; S6 measured)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- [01 §4.7](01-tech-architecture.md): single slot per run, IndexedDB, compressed JSON, autosave triggers, delete on death, migrations, spike S6
- Master plan: permadeath always on, autosave only, nothing carries over
- [07 §10](07-combat-boarding-targets.md): avoid saving mid-combat
- [12 §9](12-sandbox-events-character-failure.md): run end, logbook export, Hall of Captains
- [13 §11](13-ui-ux.md): settings stored separately
- WorldState slices from every system plan
Feeds: 17 (save tests, browser compatibility)

## Purpose

Define how runs and settings persist in the browser:
- the run lifecycle and autosave rules
- **anti-save-scum rules that keep permadeath honest**
- the save format and envelope, atomic writes and corruption recovery
- migrations, performance, browser storage pitfalls
- the separate stores for settings and the Hall of Captains

---

## 1. Goals

1. **Never lose a run to a bug.** Atomic writes, checksums, a backup copy, and migrations.
2. **Never let a reload undo a death.** Permadeath means closing the tab can't escape danger.
3. **Invisible:** autosave without hitches (≤ 4 ms main-thread cost) and no save menu.
4. **Future-proof:** saves survive game updates through versioned migrations.
5. **Simple:** one run slot plus a settings store plus a Hall of Captains store. No backend.

---

## 2. Stores (IndexedDB database `glp`)

| Store | Key(s) | Contents | Survives death? |
|---|---|---|---|
| `run` | `current`, `backup`, `danger` | The active run (envelope + compressed WorldState), the previous good save, and the danger snapshot (§4) | **No**: deleted on run end |
| `lastRun` | `summary` | The ended run's front page, summary and **logbook text** (for export on the end screen) | Until a new run starts |
| `settings` | `v1` | Graphics, audio, controls and rebinding, accessibility, UI, tips seen | Yes |
| `hall` | auto ids | Hall of Captains records ([12 §9](12-sandbox-events-character-failure.md)) | Yes |
| `meta` | `install` | Schema versions of the stores, first-run flags, storage-persistence status | Yes |

`localStorage` is only used as a tiny fallback for settings if IndexedDB is unavailable.

---

## 3. Run Lifecycle

```
New Run ──► create runId + seed ──► initial save
   │
   ▼
Playing ──(autosave triggers, §4)──► run/current (old current → run/backup)
   │
   ├─ Pause → "Save & Quit" (immediate save if safe; see §4.3) → Main Menu → Continue
   │
   └─ Run ends: death · execution · Retire · Turn Lawman · Abandon
         1. Build end summary + logbook text → lastRun/summary
         2. DELETE run/current, run/backup, run/danger   (before showing anything)
         3. Append Hall of Captains record
         4. Show end screen (front page, summary, logbook export)
```
- **Continue** is only shown when `run/current` exists. There is one run at a time.
- **Abandon run** (pause menu, confirmed) ends the run as "Abandoned" in the Hall of Captains (decided).

---

## 4. Autosave & Anti-Save-Scum Rules

### 4.1 Autosave triggers (from [01 §4.7](01-tech-architecture.md))
- Mode or zone transitions (entering or leaving a zone, going ashore or aboard, chart departure and arrival)
- After trades, crafting and build sessions, sleeping and waiting
- Contract, legend or Ambition milestones
- A periodic timer (**every ~2 real minutes**, decided) while in a **safe state**
- `visibilitychange` (tab hidden) and `pagehide` (best-effort quick save, if safe)

### 4.2 Safe vs. danger states
A **danger state** is any of:
- detected or pursued by a hostile (chart lock active, [03 §5.4](03-world-scale-chart-travel.md))
- in combat or mid-boarding
- foundering (sinking)
- alerted guards hunting you on foot
- in jail awaiting a jailbreak
- warmth critical
- falling through ice
- a wildlife attack in progress

**Regular autosaves are suspended during danger states.**

### 4.3 The danger snapshot (decided: prevents reload escapes)
- When a danger state **begins**, a **danger snapshot** is written to `run/danger`. It's the full state at that moment, plus the threat (pursuer positions, combat participants, alerted NPCs).
- When the danger **ends** safely, `run/danger` is cleared and a normal autosave follows.
- **If the game loads and `run/danger` exists** (the tab was closed or crashed mid-danger), the run **resumes from the danger snapshot, with the threat still present**: the cutter still on your tail, the guards still alerted, the ship still foundering. Closing the tab can't escape danger, and a crash doesn't cheat you of progress either.
- "Save & Quit" during danger is allowed, but it resumes into the same danger.

### 4.4 Other integrity rules
- **One slot**, no manual saves, no in-game reload.
- The run's **seed and RNG state** are saved, so a reload continues the same random sequence (no re-rolling outcomes by reloading).
- **Single tab:** the Web Locks API (or BroadcastChannel) prevents two tabs running the same run. A second tab shows "Game already open in another tab."
- **Not tamper-proof:** browser devtools can always copy IndexedDB. That's out of scope (honor system), since it's a single-player open-source game.

---

## 5. Save Format

### 5.1 Envelope
```
{
  magic: "GLP1",
  saveVersion: <int>,          // schema version of WorldState
  gameVersion: "<semver>",
  runId: "<uuid>",
  seed: "<string>",
  createdAt, savedAt,          // ISO timestamps
  playTimeMs,
  kind: "current" | "backup" | "danger",
  checksum: "<crc32/xxhash of payload>",
  payload: <Uint8Array>        // fflate-compressed JSON of WorldState
}
```

### 5.2 WorldState (what's saved)
Everything persistent lives in `WorldState` ([01 §3.1](01-tech-architecture.md)); each slice is owned by its plan:

| Slice | Owner plan |
|---|---|
| `player` (character, location, ship, purse, cargo, standing, injury, warmth) | 02, 05, 10, 11, 12 |
| `environment` (calendar, systems, fog, ice, sea state, RNG) | 04 |
| `voyage`, `discovery` | 03, 11 |
| `markets`, `traffic`, `companies`, `contracts`, `knowledge`, `fences` | 05 |
| `wanted`, `fame`, `profiles`, `reports`, `lighthouses`, `law`, `investigations`, `jail` | 06 |
| `wrecks`, `rivals` | 07, 12 |
| `districts` (alertness, evidence, bodies, stock link, debts) | 08 |
| `hideouts`, `player.blueprints` | 09 |
| `leads`, `legends`, `caches`, `traps`, `curios` | 11 |
| `ambitions`, `events`, `mail`, `newspapers` (last N editions), `feuds`, `stats` | 12 |
| `logbook` (auto entries plus notes) | 13 |

### 5.3 What's not saved
Render objects, physics and collision caches, navmeshes, audio state, UI state. **Materialized entities collapse to their abstract form before saving** ([01 §3.4](01-tech-architecture.md)). The exception is the danger snapshot, which also stores the active threat's detailed state.

### 5.4 Size targets (validated in S6)
| Content | Estimate |
|---|---|
| Hideouts (7 × up to 1,500 pieces) | ~125 KB raw ([09 §10](09-hideouts-building-crafting.md)) |
| Markets, traffic (~100–200 voyages), knowledge | ~100–300 KB raw |
| Environment (ice grids, systems) | ~50 KB raw |
| Logbook, newspapers, events, misc. | ~100–300 KB raw |
| **Total** | **~0.5–1 MB raw → ~100–250 KB compressed** |

S6 measured a worst case of **839 KB raw → 244 KB compressed** with packed hideout pieces; see [§15](#15-spike-s6-results-2026-10-23).

---

## 6. Writing & Reading

### 6.1 Atomic writes
- **One IndexedDB transaction** writes the new `current` and moves the old `current` to `backup`. IDB transactions are atomic, so a crash mid-write leaves the previous pair intact.
- The danger snapshot is written in its own transaction.

### 6.2 Serialization off the main thread
- The main thread takes a **structured clone of WorldState** (plain data, fast), then posts it to a **save worker**. The worker stringifies, compresses (fflate), checksums and writes to IndexedDB.
- **Budget: ≤ 4 ms main-thread per autosave** (measured in S6). If the clone is too slow, fall back to **dirty-slice tracking** (only clone slices changed since the last save, merged in the worker).

### 6.3 Loading & recovery
1. Read `run/danger` if present, otherwise `run/current`.
2. Verify the magic and the checksum. **On failure, try `run/backup`** and tell the player ("Recovered your last good save").
3. Run **migrations** if `saveVersion` is older (§7).
4. Validate (zod schemas for critical slices). On validation failure, try backup. If that also fails, show an apologetic error with a "Download raw save for bug report" button. The run isn't silently deleted.

---

## 7. Migrations
- `saveVersion` increments on **any** WorldState schema change.
- Migrations are an ordered list: `migrate[n](state) → state(n+1)`, run in sequence on load.
- **Every version keeps a fixture save** in `tests/fixtures/saves/vN.json`. CI loads every fixture through all migrations to the current version and validates it ([01 §9](01-tech-architecture.md)).
- Content data changes (new goods, new pieces) use **stable string IDs** ([01 §8](01-tech-architecture.md)). Removed IDs are mapped or refunded by a migration.
- **Breaking-change policy (decided: migrations only):** every release must migrate every older save. No old builds are kept online. If a migration is ever truly impossible, the last resort is to end the run gracefully with a Hall record ("Lost to the Great Update"), announced in the changelog. Design changes to avoid this.

---

## 8. Browser Storage Pitfalls

| Issue | Handling |
|---|---|
| **Eviction** under storage pressure | Call `navigator.storage.persist()` on the first New Run. Show a small note if it's denied (runs might be cleared by the browser). |
| Quota | `navigator.storage.estimate()` check. Saves are small (§5.4), so warn only when very low. |
| **Private/incognito windows** | Detect if possible and warn: "Your run will be lost when this window closes." |
| User clears site data | Lost run (unavoidable). Mentioned in the FAQ. |
| **Different origins = different saves** | The droplet site and the itch.io embed are **separate origins**, so their runs, settings and Hall don't share. Noted on the itch.io page and FAQ. |
| IndexedDB unavailable (rare) | Session-only play with a warning, plus settings in localStorage |
| Safari storage policies (inactive-site data cleanup) | Documented. Persistence request helps. |

---

## 9. Player-Facing Save Export (decided)
- **Export run** (pause menu): downloads the current save, to move to another computer or browser or to guard against browser data loss.
- **Import run** (main menu): only allowed when **no run is active**. The imported run is **marked "Transferred"** (shown in its Hall of Captains record).
- This makes save-scumming *possible* with effort. The honor-system label keeps things honest without complex anti-cheat.
- **Export is blocked during danger states** (§4.2). You can only export from a safe state, so the export can't be used to snapshot a fight.
- The export file is the envelope (§5.1) with its checksum. Import validates it, migrates it if it's from an older version, and rejects corrupt files.
- Exporting also helps bridge the separate droplet and itch.io origins (§8): move a run between them via export and import.

---

## 10. Dev Tools
- Dev-build menu: export/import any save, **save inspector** (pretty JSON per slice, sizes), force migration, simulate corruption (bit-flip and truncate) to test recovery, force a danger snapshot, "jump to date/season," and edit slices (debug only).
- Save-timing overlay: last save time, duration (main thread vs. worker), compressed size.

---

## 11. Testing (feeds 17)
- Round trip: `save(load(save(state))) === save(state)` for generated states (property-based tests).
- Migration fixtures for every version (§7).
- Corruption fuzzing: random byte flips or truncation leads to backup recovery with no crash.
- Crash-mid-write simulation (abort the transaction) leaves the previous save intact.
- Danger-snapshot flow: enter danger, kill the page, reload: the threat is present.
- Death flow: the save is deleted before the end screen, the Hall record is written, and the logbook is exportable.
- Performance: S6 large-state benchmark (≤ 4 ms main thread, compressed size within target).
- Browsers: Chrome and Firefox on Linux (baseline), plus Safari and Edge smoke tests.

---

## 12. Phasing
| Phase | Scope |
|---|---|
| 0 | IndexedDB wrapper, envelope plus checksum, save worker, `saveVersion: 1`, round-trip test, S6 benchmark |
| 1 | Settings store (graphics presets, key rebinding) |
| 3–4 | Autosave triggers, Continue, backup rotation, economy and voyage slices, first migrations and fixtures |
| 5 | Permadeath deletion flow, `lastRun` and the end screen, the danger snapshot, the single-tab lock |
| 8 | Hideout slices (largest), dirty-slice optimization if needed |
| 9 | Hall of Captains store, logbook export, all remaining slices |
| 11 | Hardening: corruption fuzzing, browser matrix, storage-persistence UX, player export/import |

---

## 13. Cut List
1. Dirty-slice tracking (full clone only, if S6 shows it's fast enough).
2. Incognito detection (generic warning text only).
3. Raw-save bug-report download.

*Not cuttable:* single-slot autosave (~2 min plus triggers), deletion before the end screen, the danger snapshot (anti-scum), atomic writes plus backup plus checksum, migrations with fixtures, the separate settings and Hall stores, the single-tab lock, **player export/import ("Transferred" label)**, **Abandon run**.

---

## 14. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-22 | **Danger snapshot:** closing the tab or crashing mid-danger resumes in that danger with the threat present. |
| 2026-10-22 | **Player export/import** included; imported runs labeled "Transferred"; export blocked during danger. |
| 2026-10-22 | **Abandon run** ends the run, recorded as "Abandoned" in the Hall of Captains. |
| 2026-10-22 | **Autosave every ~2 real minutes** (plus event triggers) while safe. |
| 2026-10-22 | **Player export/import ships** (§9); it is no longer optional. |

---

## 15. Spike S6 Results (2026-10-23)

**Question:** with a worst-case `WorldState`, what is the compressed size, how long does a save take, does it hitch a frame, and how long does a 12-game-day batch fast-forward take ([01 §11.2](01-tech-architecture.md))?

**Answer:** it fits, with one change: **hideout pieces must be stored packed**, not as one JSON object per piece. With packed pieces the save is 244 KB compressed and costs ~2.6 ms on the main thread (p95 4.0 ms), inside the §6.2 budget. Dirty-slice tracking is not needed and stays on the cut list.

### Setup
- Code: `bench/s6/` (`npm run bench:save` runs it in Chromium and writes `bench/s6/last-run.json`). `tests/save-size.test.ts` guards the worst-case size in CI.
- The state is generated from a seed: 7 hideouts × 1,500 pieces, 200 abstract ships, 16 ports × 30 goods with 52 weeks of price history, 400 knowledge entries, 150 reports, 1,200 logbook entries, 40 newspaper editions, 6 zones of 64×64 ice grids (coverage and thickness), weather systems and fog banks. Values are random, which is the compression worst case (real ice and price fields are smoother).
- It runs the real save code from PR #6: the save worker, fflate level 6, CRC-32 and the atomic IndexedDB write. 3 warm-up runs, then 20 measured runs.
- **Machine:** these numbers come from headless Chromium 156 in the cloud dev container (4 vCPU Intel Xeon at 2.1 GHz), not the baseline laptop. The Ryzen 7 7730U should be about as fast or faster per core. Re-run `npm run bench:save` there to confirm.

### Size
| | Raw JSON | Compressed |
|---|---|---|
| **Packed pieces** (whole state) | 839 KB | **244 KB** |
| Objects per piece (whole state) | 1,522 KB | 278 KB (over target) |
| Hideouts only, packed | 177 KB (16.8 B per piece) | 55 KB |
| Hideouts only, objects | 860 KB (82 B per piece) | 87 KB |

Biggest slices (packed, compressed): markets 67 KB (the 52-week price history is most of it), hideouts 55 KB, environment 54 KB (almost all ice grids), logbook 33 KB, traffic 11 KB. Everything else is under 10 KB each.

Compression level, whole packed state: level 1 → 278 KB in 22 ms; level 3 → 262 KB in 32 ms; **level 6 → 244 KB in 84 ms**; level 9 → 242 KB in 104 ms. Level 6 stays: it runs in the worker, so the extra time is free, and level 9 gains almost nothing.

### Speed (median / p95, ms)
| Step | Packed | Objects |
|---|---|---|
| **Main thread: `postMessage` to the worker (structured clone)** | **2.6 / 4.0** | 6.8 / 13.9 |
| Worker round trip (stringify, compress, checksum, transfer back) | 105 / 130 | 135 / 170 |
| IndexedDB atomic write (`current` + `backup`) | 5.9 / 11.1 | 4.5 / 11.1 |
| Whole save, request to committed | 110 / 137 | 139 / 175 |
| Load: checksum, inflate and parse (before zod) | 23 / 33 | 21 / 25 |
| For reference, inline encode with no worker | 93 / 150 | 107 / 142 |

- **Frame hitch:** no long tasks (> 50 ms) during 20 saves, and frame gaps stayed at 16.7 ms. Headless Chromium's frame clock is coarse, so treat this as "no big hitch" and recheck with the dev overlay's frame graph on the laptop.
- The ~6 ms IndexedDB write is async; most of its cost is off the main thread.
- Without the worker a save would block for ~90 ms, so the worker path is required, not an optimization.

### Batch fast-forward (12 game days = 1,728 world ticks)
The real world tick doesn't exist yet, so `bench/s6/world-tick.ts` stands in for it with heavier-than-planned work on the worst-case state: every market drifts and restocks, every ship moves and trades, weather systems move, Wanted decays, and every ice cell grows or melts.

| Ice update cadence | 12 game days |
|---|---|
| Every world tick (10 game minutes) | 2,256 ms |
| **Once per game day** | **80 ms** |

Per-cell grid updates dominate. Everything else (480 markets, 200 ships) costs under 50 µs per tick. Updating ice daily turns a jail sentence into a sub-0.1 s batch, so the progress screen is a nicety rather than a necessity. S9 should still time the real weather sim.

### Recommendations for the owner plans
1. **Hideouts ([09 §10](09-hideouts-building-crafting.md)):** save pieces as a per-hideout palette of piece ids plus one flat integer array (7 numbers per piece). Objects per piece break both the size target and the 4 ms budget.
2. **Markets ([05](05-ports-economy-trading.md)):** keep price history short (e.g. 12 weeks) or store it as deltas; at 52 weeks it is the largest slice.
3. **Environment ([04](04-water-weather-seasons.md)):** store grids as integer arrays (0–100 coverage, whole cm), and update per-cell grids on a coarse cadence (daily, or hourly at most), not every world tick.
4. **Save path:** keep the worker, full structured clone and fflate level 6. Dirty-slice tracking stays cut unless a later slice pushes the clone past 4 ms on the laptop.

---

## Changelog
- v0.4: Spike S6 results (§15): worst case 244 KB compressed, ~2.6 ms main thread with packed hideout pieces; ice updates daily in fast-forward.
- v0.3: Gap review: export/import is a committed Phase 11 feature, not optional.
- v0.2: Decisions: danger snapshot, player export/import (Transferred label, blocked during danger), Abandon run, 2-minute autosave.
- v0.1: Initial persistence plan: stores, run lifecycle, autosave triggers, safe vs. danger states, the danger snapshot anti-scum rule, integrity rules, envelope and WorldState slice ownership, size targets, atomic writes, worker serialization, recovery, migrations, browser storage pitfalls, optional export/import, dev tools, tests, phasing.
