# 17 — Testing, Performance & Release

Status: DRAFT v0.3 (decisions made)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- [01](01-tech-architecture.md): testing strategy, budgets, CI, droplet and itch.io hosting, Git LFS, MIT + CC BY, the baseline machine
- Budgets and acceptance criteria in every system plan (02–16)
- [14 §7](14-art-direction-asset-pipeline.md) and [15 §9](15-audio.md): asset and audio validation
- [16 §11](16-save-persistence.md): save tests
- [R1 §5](R1-western-superior-1900-research.md): Ojibwe cultural review
Feeds: every phase's definition of done

## Purpose

Define how the game is verified, kept fast, and shipped:
- test layers and CI gates
- simulation and balance harnesses
- performance methodology on the baseline laptop
- the browser matrix and playtesting
- versioning and milestones
- the release pipeline (droplet and itch.io)
- the pre-release checklist (licensing, cultural review)
- post-release support

---

## 1. Goals

1. **Every phase ends playable and verified.** Each plan's acceptance criteria become a checklist.
2. **CI catches the boring breakages:** types, data schemas, saves, budgets, licenses.
3. **Performance is measured, not guessed,** on the real baseline laptop, every phase.
4. **Balance is tested by simulation,** not only by feel. No money loops, sane progression pacing.
5. **Shipping is one command,** with instant rollback.
6. **Respectful and license-clean** at release.

---

## 2. Test Layers

| Layer | Tool | What | Runs |
|---|---|---|---|
| **Unit** | Vitest | `sim/` logic: economy formulas, Wanted and Fame math, calendar and sun/moon, wave parameter mapping, ice growth, grid validity rules, boarding odds, morale, recipes, coordinate conversions | CI, every push |
| **Property-based** | Vitest + fast-check | Save round trip, grid placement invariants, coordinate round trips, market price bounds | CI |
| **Data** | zod schemas | All `data/*.json` validated; cross-references (IDs exist, recipes reference real goods, sites reference real zones) | CI |
| **Save** | Vitest | Migration fixtures for every version, corruption fuzzing, the danger-snapshot flow, the deletion-on-death flow ([16 §11](16-save-persistence.md)) | CI |
| **Simulation harness** | Node, headless `sim/` | Multi-year runs of economy, traffic, weather and law with scripted or bot players (§3) | CI (short), nightly/local (long) |
| **Smoke / E2E** | Playwright (Chromium) | Boot with a **null renderer** (no WebGL in CI), New Run, run the sim for N seconds, open each major screen, autosave, reload and Continue, no console errors | CI |
| **Visual** | Playwright screenshots | Key scenes at fixed seeds and times (loose diff threshold; stylized art tolerates small changes) | **Locally only** for now; no screenshot diffs in CI |
| **Asset/audio validation** | Pipeline scripts | Budgets (triangles, textures), provenance and license present, naming ([14 §7](14-art-direction-asset-pipeline.md), [15 §9](15-audio.md)) | CI |
| **Performance** | Benchmark scenes (§4) | Frame-time distribution, memory, load times on the **baseline laptop** | Locally, each phase, and before releases |
| **Manual playtest** | Checklists (§6) | Feel, fun, clarity, acceptance criteria | Each phase |

**CI note:** GitHub Actions runners have no real GPU, so CI **does not run WebGL** and checks correctness, not rendering or frame rates. Performance and visuals are checked locally on the baseline machine. **Blender and GDAL run locally only**; CI validates their committed outputs.

---

## 3. Simulation & Balance Harness

The pure `sim/` layer ([01 §3.1](01-tech-architecture.md)) runs headless in Node at high speed.

| Harness | Checks |
|---|---|
| **Economy soak** (5–10 game years) | Prices stay within bounds; stocks never go negative; flows deliver; seasonal patterns appear; no runaway inflation or deflation |
| **Money-loop hunter** | A bot repeatedly buys and sells, crafts and resells, and cycles contracts. It must not exceed a profit ceiling per game day without risk ([05 §13](05-ports-economy-trading.md)) |
| **Progression pacing bots** | A "legit trader" bot and a "pirate" bot (simplified decisions). They measure the game days or estimated real hours to afford T2 and T3 against the targets (legit 8–12 h / 20–30 h; piracy 3–5 h / 8–12 h; [05 §5.3](05-ports-economy-trading.md)) |
| **Law dynamics** | Heat decay, spread and tier transitions over time; the cutter's presence distribution follows the Wanted weighting; no region stuck at a tier forever |
| **Weather and seasons** | Storm frequency by month matches climate rules; ice-out and freeze-up distributions; fog frequency; determinism (same seed gives the same weather) |
| **Traffic** | Encounter rates per route and season within targets ([03 §6.4](03-world-scale-chart-travel.md)); voyage counts within budget |
| **Determinism** | The same seed plus the same scripted inputs give an identical WorldState hash after N days |

Outputs go to JSON plus simple charts (a dev page) so tuning changes can be compared run to run.

---

## 4. Performance Methodology

### 4.1 Baseline & targets
- **Baseline:** Ryzen 7 7730U, integrated Radeon graphics, 28 GB RAM, Linux, Chrome and Firefox ([01 §13](01-tech-architecture.md)).
- **Targets:** 60 fps on Medium, never below 30 fps on Low ([01 §5](01-tech-architecture.md)), plus each plan's budget table.

### 4.2 Benchmark scenes (scripted camera paths, fixed seed)
| Scene | Stresses |
|---|---|
| `bench.sailing` | Apostles zone, 8 materialized ships, waves, fog bank, dusk |
| `bench.storm` | Gale, rain, max waves, lightning |
| `bench.docks` | Duluth docks district at night, 12 NPCs, lamps |
| `bench.island` | Hero island on foot, dense vegetation, wildlife |
| `bench.hideout` | 1,500-piece hideout plus a distillery and smoke |
| `bench.combat` | 4 ships firing, splashes, a boiler explosion |
| `bench.winter` | Ice sheet, floes, snow, aurora |
| `bench.chart` | Chart with all layers, a long voyage at max time compression |

- `npm run bench` launches each scene in the browser, records frame times (p50, p95, p99), draw calls and triangles (`renderer.info`), JS heap, and GPU time where available. It writes `bench/results/<date>-<commit>.json`.
- **Bench history** is committed, so regressions are visible commit to commit (a simple chart page).
- Tools: Chrome DevTools Performance, the three.js renderer stats, Spector.js (frame capture), and the in-game dev overlay ([01 §11](01-tech-architecture.md)).

### 4.3 Other performance checks
- **Leak test:** load and unload zones 50× in a row (sailing, docks, island, chart). Heap and GPU memory must return to baseline (±10%).
- **Load times:** first playable ≤ the [01 §5](01-tech-architecture.md) target on a throttled connection (simulate ~10 Mbps); zone loads ≤ 8 s warm.
- **Autosave cost:** ≤ 4 ms main thread ([16 §6.2](16-save-persistence.md)).
- **Dynamic resolution** stays stable (no oscillation) in the storm bench.

### 4.4 Performance gate
A phase isn't done if any bench's p95 frame time on Medium exceeds 16.7 ms, or Low exceeds 33 ms, on the baseline laptop. Fix it or cut per the plan's cut list.

---

## 5. Browser & Platform Matrix

| Browser | OS | Level |
|---|---|---|
| Chrome (current) | **Linux (baseline)** | Full: benches, playtests |
| Firefox (current) | **Linux (baseline)** | Full |
| Chrome / Edge (current) | Windows | Smoke plus a short playtest per milestone |
| Firefox (current) | Windows | Smoke |
| Safari (current) | macOS | Smoke (WebGL2, audio unlock, IndexedDB persistence quirks) |
| Inside **itch.io** iframe | Chrome/Firefox | Smoke (relative paths, storage, fullscreen, pointer lock) |

S1 picked `WebGLRenderer` ([01 §14](01-tech-architecture.md)); WebGL2 is the minimum and the only renderer. It was benched in Chrome and Firefox on the baseline laptop.

---

## 6. Playtesting

### 6.1 Phase playtests
Each phase ends with a playtest against **that phase's acceptance criteria** (from plans 02–16), as a checklist in the phase's tracking issue.

### 6.2 External testers (decided)
- From the **MVP** on, invite a small group (friends, interested players) to play builds on the droplet.
- **Feedback:** GitHub Issues (templates: bug, balance, idea) plus an in-game **"Report a problem"** button that downloads a **bug bundle** (current save via export, settings, the last 200 log lines, browser and GPU info, a screenshot). The tester attaches it to an issue. No backend is needed.
- **Structured questions** per milestone: Is sailing fun? Did you understand why you were spotted? Did you know when capture meant death? Was the legit path viable? Where did you get bored or lost?

### 6.3 Telemetry
- **No network telemetry** (privacy-first; no backend). Nothing is ever sent anywhere.
- **Opt-in local stats summary (confirmed by Jared, 2026-10-22):** the game keeps an anonymous play summary locally (session lengths, deaths and causes, where time is spent, bench-like frame-time stats, settings preset). The tester can **choose to include it** in a bug bundle, and it's shown before download.

---

## 7. Versioning & Milestones

### 7.1 Versioning
- **Semver (fixed 2026-10-22):** `0.<phase>.<patch>` for Phases 0–9 (e.g., `0.1.0` = Phase 1 sailing prototype). **`0.8.x` = MVP/Alpha** (Phase 8 done) and **`0.9.x` = Beta** (Phase 9 done). Phase 10 expansion builds are **`0.10.x`** (Phase 10 comes before polish, decided 2026-10-23), and Phase 11 polish builds are **`0.11.x`** release candidates, ending at **1.0.0**.
- `gameVersion` is in saves ([16 §5.1](16-save-persistence.md)). `saveVersion` is separate.
- `CHANGELOG.md` (Keep a Changelog style) is updated with every release.

### 7.2 Milestones
| Milestone | Definition | Audience |
|---|---|---|
| **Phase builds** (0.0–0.7) | Each phase's playable goal ([00 §7](00-master-plan.md)) | Developer (+ optional friends) |
| **MVP / Alpha** | The master plan MVP definition: western Superior, sailing with weather, hybrid travel, trading, Fame/Wanted with the cutter and lighthouses, freighter piracy, one docks district, 1–2 hideouts, at least summer and fall | **Private:** invited external testers only (unlisted URL, optional basic auth) |
| **Beta** | All MVP-region systems and content complete (Phase 9 done): all docks districts, islands, legends, seasons including winter, rivals, endings | **First public release:** itch.io "in development" plus a public droplet URL |
| **Expansions** (0.10) | Lake Michigan (Seavey's home waters), then the other lakes ([00 §7](00-master-plan.md) Phase 10) | Public (Beta) |
| **1.0** | Polish (Phase 11), full checklist (§9) | Public release |

---

## 8. Release Pipeline

### 8.1 Builds & CI (GitHub Actions)
```
push / PR ──► lint · typecheck · unit · data · save fixtures · sim (short) ·
              asset & audio validation · build · Playwright smoke
tag vX.Y.Z ──► all of the above ──► production build ──► deploy (droplet) ──► (optional) butler push (itch.io)
```
- **Not yet (decided 2026-10-22):** builds are local only for now. No tagged deploys, and the droplet (domain, size, provisioning) isn't planned until testers need it. The tag and deploy steps above are the target, not Phase 0 work.
- Git LFS checkout **with cache** ([01 §10](01-tech-architecture.md)).
- Build artifacts: hashed filenames, `index.html` short-cache, assets immutable-cache.

### 8.2 Droplet deploy
- `rsync` over SSH to `/srv/glp/releases/<version>/`, then **atomically switch** the `current` symlink and reload Caddy. Keep the last 5 releases.
- **Rollback:** re-point the symlink to the previous release (a one-line script or a manual workflow trigger).
- **No version-pinned old builds (decided):** compatibility relies on **save migrations only** ([16 §7](16-save-persistence.md)). Every release must migrate every older save.
- **Private until Beta (decided):** once hosting exists, the pre-Beta build is unlisted (a non-indexed URL, `robots.txt` disallow, optional HTTP basic auth via Caddy) and shared only with invited testers. The GitHub repo can stay public (open source) regardless.
- A basic **uptime check** (a free external monitor, or a cron curl on another host) alerts by email.

### 8.3 itch.io
- `butler push dist/ <user>/great-lakes-pirate:html5 --userversion X.Y.Z` from CI on release tags (credentials in repo secrets).
- Verify itch.io's HTML5 zip size and file-count limits at that time. Zone streaming keeps the initial bundle small. If limits block streaming, the itch page links to the droplet build as the full version.
- The itch page notes that saves are separate from the droplet site and explains export/import ([16 §9](16-save-persistence.md)).

---

## 9. Pre-Release Checklist (Beta and 1.0)

**Quality**
- [ ] All phase acceptance criteria met (plans 02–16)
- [ ] Bench gate passed on the baseline laptop (§4.4); the leak test passes
- [ ] The browser matrix smoke passes (§5)
- [ ] Simulation harness: no money loops; pacing within targets; determinism holds
- [ ] Save: migrations from every released version; corruption recovery; danger snapshot; export/import
- [ ] Accessibility pass ([13 §9](13-ui-ux.md)): captions, colorblind modes, plain font, reduce motion, rebinding

**Licensing**
- [ ] `LICENSE` (MIT, code) and the asset license (CC BY 4.0, original assets and data)
- [ ] `CREDITS.md` and `assets/LICENSES.json` complete: every asset and sound has provenance, and tool terms were re-checked at release
- [ ] Fonts OFL-listed; public-domain sources (photochroms, engravings, melodies) documented
- [ ] No NC/ND or non-redistributable material in the repo

**Content & respect**
- [ ] **Ojibwe content reviewed (decided, budgeted):** contact Red Cliff and Bad River cultural or historic preservation offices (or a paid Ojibwe sensitivity reviewer) **well before Beta** ([R1 §5](R1-western-superior-1900-research.md)). Apply their feedback. Credit reviewers if they wish.
- [ ] Trade-only rule enforced (no crime interactions available at Red Cliff and Bad River)
- [ ] Fictional company and newspaper names checked against real historical firms and papers ([05 §10](05-ports-economy-trading.md), [12 §6.1](12-sandbox-events-character-failure.md))
- [ ] Historical deviations log reviewed ([R1 §8](R1-western-superior-1900-research.md)); an in-game "History notes" page (optional)
- [ ] Content advisory on store pages: violence (optional), period themes, alcohol and smuggling

**Ops**
- [ ] Droplet hardened (SSH keys only, firewall, unattended upgrades), HTTPS valid, MIME types and caching verified
- [ ] Rollback tested
- [ ] itch.io page, screenshots, description, and the save-separation note
- [ ] `CHANGELOG.md`, README (play link, build instructions, contribution notes)

---

## 10. Post-Release Support
- **Patch cadence:** fixes as needed (patch versions); balance updates batched.
- **Save compatibility is sacred:** every release ships its migrations and fixtures.
- **Issue triage:** labels (bug, balance, content, perf, accessibility, history), with a crash or save-loss bug as the top priority.
- **Community contributions** (MIT/CC BY): a CONTRIBUTING guide covering data-file mods, new legends and asset submissions with provenance.
- **Expansion planning:** Lake Michigan research plan (R2) and zone work reuse the full pipeline ([03 §10](03-world-scale-chart-travel.md)).

---

## 11. Phase "Definition of Done" (applies to every phase)
1. The phase's playable goal is achieved ([00 §7](00-master-plan.md)).
2. The relevant plans' acceptance criteria are checked off.
3. CI is green (all layers in §2 that apply).
4. The bench gate passes for the scenes that exist so far.
5. Saves from the previous phase build migrate (once saves exist).
6. Plans are updated: status, decisions, changelog, and spike write-ups.
7. A tagged build is deployed to the droplet (**deferred** until hosting exists; until then, a local production build runs).

---

## 12. Cut List
1. Visual screenshot diffs (already local only; cut entirely if they cost time).
2. Pacing bots (manual playtest pacing only).
3. itch.io mirror (droplet only).
4. Opt-in local stats summary.

*Not cuttable:* unit, data and save tests in CI, the money-loop hunter, the bench gate on the baseline laptop, the leak test, licensing and provenance checks, the Ojibwe cultural review, rollback-capable deploys, external testers from the MVP, the in-game bug-bundle button.

---

## 13. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-22 | **External testers from the MVP**; feedback via GitHub Issues plus the in-game bug bundle. |
| 2026-10-22 | **No network telemetry**; an **opt-in local stats summary** can be attached to bug bundles. Explicitly confirmed by Jared over removing telemetry entirely. |
| 2026-10-22 | **Private until Beta** (unlisted droplet build for invited testers); public on itch.io and the droplet at Beta. |
| 2026-10-22 | **Ojibwe cultural review budgeted** before Beta. |
| 2026-10-22 | **Save migrations only**; no version-pinned old builds. |
| 2026-10-22 | **CI runs no WebGL:** Playwright smoke uses a null renderer; screenshot diffs are local only. Blender and GDAL are local only. |
| 2026-10-22 | **Version scheme:** 0.8 = MVP/Alpha, 0.9 = Beta, 0.10 = Phase 10 expansions, 0.11 = Phase 11 polish, then 1.0. |
| 2026-10-22 | **No hosting yet:** local builds only; droplet, domain and tagged deploys deferred. Unlisted with optional basic auth until Beta once it exists. |
| 2026-10-23 | **Phase 10 (expansions) comes before Phase 11 (polish)**, so the other lakes ship before 1.0. |

---

## Changelog

- v0.4: Telemetry decision explicitly confirmed: keep the opt-in local stats summary (not removed).
- v0.3: Gap review: CI without WebGL (null-renderer smoke, local screenshot diffs), Blender/GDAL local, version scheme fixed (0.8 MVP, 0.9 Beta, 0.10 expansions, 0.11 polish, then 1.0), hosting deferred, DoD #7 deferred.
- v0.2: Decisions: MVP external testers, no network telemetry plus an opt-in local stats summary, private until Beta, cultural review budgeted, migrations only (old-build paths removed).
- v0.1: Initial testing and release plan: test layers, CI gates, simulation and balance harness, performance methodology and benches, the bench gate, browser matrix, playtesting and bug bundles, telemetry stance, versioning and milestones, CI/CD to the droplet and itch.io, the pre-release checklist (quality, licensing, cultural review, ops), post-release support, phase definition of done.
