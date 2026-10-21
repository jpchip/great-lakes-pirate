# 01 — Tech Stack, Architecture & Project Setup

Status: DRAFT v0.4 (all open questions resolved)
Parent: [00-master-plan.md](00-master-plan.md)
Feeds: every implementation plan. Phase 0 tasks are defined here.

## Purpose

Define the technology choices, high-level architecture, project layout, conventions and Phase 0 setup tasks so that every later system plan (sailing, world, economy, stealth, building…) slots into one consistent structure.

---

## 1. Constraints (from master plan)

| Constraint | Consequence |
|---|---|
| **Solo developer** | Favor simple, boring, well-documented tools. Avoid custom engines. Keep the architecture small enough to hold in one head. Automate the asset pipeline. |
| **Browser, desktop only, mouse and keyboard** | No mobile performance work, no touch/gamepad input layer. Pointer lock for on-foot camera. |
| **Runs well on limited hardware** (the developer's own machine is the baseline: low-end laptop with integrated graphics assumed) | Conservative render budgets, quality presets, resolution scaling, instancing, LOD, streaming per coastal zone. **Physics stays minimal**: arcade and hand-rolled wherever possible. |
| **Open source, not sold** | Public repo with an open license. Every asset (AI, CC0, audio) must be redistributable in a public repo. |
| **TypeScript + Vite + three.js** | Decided. |
| **Local saves only, no backend** | IndexedDB. Static hosting. |
| **Permadeath, autosave only** | Robust single-slot save with versioning and migration. |
| **Hybrid world (coastal zones + chart travel)** | Load only the active zone. Simulate the rest of the world abstractly. |
| **Islands walkable, docks districts walkable** | Need a character controller, collisions, navmesh AI. |
| **Stylized art, AI-generated assets** | A unifying shader and material approach. Asset processing pipeline. |
| **Long-term: all five lakes** | Data-driven world. Nothing about Lake Superior hard-coded. |

---

## 2. Technology Stack

Versions: **pin exact versions at project setup** (latest stable at that time) and upgrade deliberately. three.js changes APIs between releases.

### 2.1 Core
| Area | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (strict mode) | |
| Build/dev server | **Vite** | Fast HMR. Static build output. |
| Package manager | npm (or pnpm) | Pick one at setup. |
| 3D engine | **three.js** | |
| Renderer | **Spike S1 decides (approved):** `WebGPURenderer` + TSL (node shaders, auto-falls back to WebGL2) **vs.** classic `WebGLRenderer` + GLSL | The deciding test runs **on the developer's limited hardware**. Pick whichever is faster and more stable there. With integrated graphics, the mature WebGLRenderer is a strong default unless WebGPU clearly wins. |

### 2.2 Libraries (proposed; each is optional until a plan needs it)
| Need | Choice | Why |
|---|---|---|
| Ship physics | **Custom arcade model** (no physics engine) | Arcade sailing needs a hand-tuned feel. Buoyancy samples the same wave function as the water shader. |
| On-foot collisions and character controller | **Hand-rolled lightweight controller first**: heightmap ground sampling plus a capsule vs. simple primitives (boxes, cylinders, a grid-cell occupancy map for buildings) | Keeps physics minimal for limited hardware. Islands are heightmaps, and docks and hideouts are mostly boxes on a grid, so a full physics engine is likely unnecessary. **Fallback:** Rapier (`@dimforge/rapier3d-compat`, WASM) only if spike S5 shows the simple approach can't handle it. |
| NPC pathfinding (guards, dogs) | **recast-navigation-js** (navmesh) | Navmeshes for docks districts and islands, baked offline or at load. |
| Entity management | **miniplex** (lightweight ECS over plain TS objects) or a hand-rolled equivalent | Simple, typed, no archetype complexity. Decide in Phase 0. |
| UI (menus, trade, inventory, build palette, chart overlays) | **DOM overlay with Preact + signals** | HTML/CSS is far faster to build than in-canvas UI. Tiny bundle. |
| Data validation | **zod** | Validate JSON definitions at load and in tests. |
| Persistence | **IndexedDB** via a small wrapper (`idb` or `idb-keyval`) | Async, large capacity. |
| Compression (saves, data tiles) | **fflate** | Small and fast. |
| Audio | **three.js Audio/PositionalAudio** (Web Audio) plus a thin mixer layer | Music, ambience, 3D SFX. Volume buses. |
| Debug UI | **lil-gui**, **stats.js** (or three's built-in stats), a custom dev console | Dev builds only. |
| Asset processing (CLI, offline) | **gltf-transform** (meshopt/Draco, KTX2 textures, resize, dedupe) | Scripted pipeline in `tools/`. |
| Geodata processing (offline) | **GDAL** (CLI) plus Node or Python scripts | Bathymetry/DEM → heightmap tiles, shoreline → masks. |
| Testing | **Vitest** (unit/sim), **Playwright** (smoke/e2e, screenshot checks) | Chromium is available for Playwright. |
| Lint/format | ESLint + Prettier | |

**Rule:** a new dependency must be justified in the relevant plan. Prefer fewer, mature libraries.

---

## 3. Architecture Overview

### 3.1 Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ UI (Preact DOM overlay)   HUD · menus · trade · build palette    │
├──────────────────────────────────────────────────────────────────┤
│ PRESENTATION (three.js)   scenes · water · terrain · ships ·     │
│                           characters · VFX · audio · cameras     │
├──────────────────────────────────────────────────────────────────┤
│ GAMEPLAY (active zone)    sailing controller · combat · on-foot  │
│                           controller · stealth AI · build mode   │
├──────────────────────────────────────────────────────────────────┤
│ SIMULATION (whole world)  calendar · weather · economy · traffic │
│   pure TS, no three.js    · law/Wanted · Fame · hideouts · events│
├──────────────────────────────────────────────────────────────────┤
│ CORE                      loop · time · event bus · RNG · assets │
│                           · save/load · data registry · input    │
└──────────────────────────────────────────────────────────────────┘
          DATA (JSON definitions + baked world tiles, read-only)
          STATE (WorldState: one serializable object = the save)
```

- **Simulation never imports three.js.** It is pure, testable TypeScript operating on `WorldState`. Presentation reads state and renders it; Gameplay translates input into state changes and events.
- **Single source of truth:** `WorldState` holds everything that persists. Anything not in it is reconstructible (render objects, physics bodies, caches).
- **Data vs. state:** static definitions (goods, ship types, ports, lights, structures) live in read-only data files. `WorldState` references them by ID.

### 3.2 Game modes (state machine)

```
Boot → MainMenu → CharacterCreation → ┐
                                      ▼
   ┌───────────── IN-GAME (WorldState loaded) ─────────────┐
   │                                                       │
   │   Chart  ⇄  Sailing(zone)  ⇄  OnFoot(island | docks)  │
   │                 │                    │                │
   │                 └──► Build (overlay on OnFoot@hideout)│
   │   Overlays: Trade · Dialog · Inventory · Journal ·    │
   │             Pause · Boarding resolution               │
   │   Interrupts: Encounter (Chart → Sailing) ·           │
   │               Captured → Jail | Execution             │
   └───────────────────────────────────────────────────────┘
                                      ▼
                               GameOver (run deleted)
```

- Each mode implements `enter / exit / update / render` and declares which systems run in it.
- **Overlays** pause or slow gameplay and are UI-only.
- **Transitions** handle loading. Example: Sailing → OnFoot loads the island's walkable scene and fades. The schooner stays as a moored entity.
- The `Chart` mode advances time quickly and runs encounter checks. An encounter drops into `Sailing` at a spawn point in an "open water" mini-zone.

### 3.3 Time & the loop

- **Render loop:** `requestAnimationFrame`, variable dt.
- **Gameplay tick:** fixed timestep (e.g., **60 Hz**; 30 Hz acceptable) for ship physics, the character controller and AI, with render interpolation.
- **World tick ("strategic")**: runs in **game-minutes**, e.g., every 10 game-minutes. It covers economy, off-screen traffic, weather evolution, Wanted decay and Fame decay. In Chart mode, time compression simply runs more world ticks per real second.
- **Game clock:** real-to-game ratio is TBD in plan 04 (e.g., 1 real minute = 30 game minutes while sailing, so a full day takes ~48 real minutes). The calendar starts in spring 1900.
- **Pause** stops both ticks. Overlays may stop the gameplay tick but keep ambient rendering.

### 3.4 Simulation LOD: abstract vs. materialized entities

This is key to a big world on a browser budget.

- **Abstract entities** exist only in `WorldState`: ships on a **route graph** (port ↔ port legs, with position = leg + progress), cutters on patrol plans, weather cells, NPC schedules. They are cheap and updated on the world tick.
- **Materialized entities**: when an abstract ship's position falls inside the **active zone** (or an encounter spawns), it becomes a full entity with a model, physics, AI controller and lights. When it leaves the zone or the zone unloads, it collapses back to abstract state (position, cargo, damage and crew written back).
- The same pattern applies to the revenue cutter *Morrill*. It always exists abstractly somewhere on Lakes Superior/Michigan, which supports "trackable threat" gameplay via rumors.

### 3.5 Event bus

Typed, synchronous publish/subscribe for cross-system communication. Systems don't call each other directly. Examples:

| Event | Producers | Consumers |
|---|---|---|
| `CrimeCommitted {kind, severity, region, witnesses[], lethal}` | combat, stealth, wrecking | Law/Wanted, Fame, Newspaper, NPC reactions |
| `CargoTransferred {from, to, goods}` | trade, boarding, theft | Economy, Inventory, Save |
| `ShipDamaged / ShipSunk` | combat, weather, reefs | Law (if witnessed), Fame, Audio, Save |
| `Witnessed {observer, subject, act}` | lighthouse keepers, guards, ships | Law/Wanted |
| `ZoneEntered / ZoneExited` | world streaming | materialization, audio, music |
| `DayPhaseChanged / SeasonChanged` | calendar | lighting, markets, traffic, ice |
| `PlayerCaptured {region, wantedTier}` | law | Jail or Execution flow |
| `RunEnded {cause}` | death, execution | Save deletion, GameOver |

Events are also the natural hook for the **newspaper** system and for debugging (an event log in the dev console).

### 3.6 Coordinate spaces

| Space | Units | Used for |
|---|---|---|
| **Geo** | lat/lon (WGS84) | Source data, the authoring of ports, lights and islands, route graph nodes |
| **Chart** | projected 2D (e.g., a local equirectangular or UTM 15N/16N projection) | Chart mode map, abstract positions, distances |
| **Zone local** | meters ×1/compression, origin at zone center | 3D gameplay in a coastal zone |
| **Scene/render** | Zone local minus **floating origin** offset | three.js scene graph (keeps float precision near the camera) |

- Each coastal zone defines its geo bounds, compression ratio (plan 03 sets 1:6–1:10) and origin.
- Conversion functions live in one module (`core/coords`). Nothing else does its own projection math.
- **Floating origin:** recenter when the player gets more than ~2 km from the origin (render space only; zone-local values stay authoritative).

---

## 4. Key Subsystem Designs (architecture level; details in system plans)

### 4.1 Water & buoyancy (plans 02, 04)
- A **single wave definition** (a sum of Gerstner/trochoidal waves, parameterized by weather) is implemented **twice from the same parameters**: in the shader (TSL/GLSL) for visuals and in TS for CPU height and normal queries (buoyancy, foam spawns, AI).
- The ship samples ~4–8 hull points for heave, pitch and roll. Arcade damping makes it feel good rather than strictly accurate.
- Stylized look: banded color by depth (from the bathymetry tile), foam at shorelines (shore distance field), fog, toon specular.
- Ice is a separate surface layer (floe instances plus a frozen-surface mask) driven by season.

### 4.2 Terrain & coastal zones (plan 03)
- An **offline pipeline** (`tools/geo/`): NOAA Great Lakes bathymetry plus USGS elevation → clipped per zone → resampled → compressed into **heightmap tiles** (16-bit) and a **shoreline distance field**, output to `public/world/<zone>/`.
- At runtime: chunked terrain meshes per tile with LOD (geomipmapping or CDLOD), plus instanced vegetation (stylized pine forests) with distance culling.
- **Walkable islands:** the same heightmap is used at higher resolution, plus authored props, simple collision primitives for props (the heightmap itself is the ground collision) and a navmesh baked offline.
- **Docks districts:** hand-assembled scenes from a modular kit (piers, warehouses, cranes, crates), stored as a placement list (JSON) rather than a monolithic GLB.

### 4.3 Rendering approach (plan 14 finalizes the style)
- One **stylized material system** (toon or flat shading, shared palette textures/ramps) applied to all assets on import. This hides inconsistencies between AI-generated, CC0 and procedural assets.
- Lighting: one directional sun/moon plus hemisphere ambient driven by time of day. Point lights limited (lanterns use emissive plus a few real lights near the player). Lighthouse beams are a custom volumetric-ish cone shader plus one real spotlight when close.
- Distance fog doubles as an atmosphere tool and a draw-distance limiter. Fog weather tightens it dramatically, which is cheap and atmospheric.
- Post-processing (budgeted): tone mapping, optional outlines (if toon), light bloom for lanterns and lighthouses. No expensive SSR or SSAO by default.
- **Instancing everywhere:** trees, rocks, crates, building pieces, floe ice.

### 4.4 Grid building (plan 09)
- Each hideout has a grid (cell size TBD, e.g., 2 m horizontal and 1 m vertical levels), an origin, and an allowed build area (from the site definition).
- Placement data: `{pieceId, cell(x,y,z), rotation(0–3), variant/paint}` in a list in `WorldState.hideouts[id].pieces`. Compact and save-friendly.
- Rendering: one `InstancedMesh` per piece type/material; rebuilt incrementally on change.
- Collision: derived directly from grid occupancy (walls block cell edges, floors are walkable). No physics engine is needed.
- Validation rules (support, overlap, terrain fit) are pure functions in Simulation, so they can be unit-tested.
- Storage is per hideout: `WorldState.hideouts[id].storage` (separate inventories, as decided).

### 4.5 Stealth & AI (plans 06, 08)
- Perception model: vision cones with light-level modulation (player in lamplight vs. shadow), hearing radius from noise events. A shared module is used by docks guards, lighthouse keepers and ship lookouts.
- Behavior: small finite-state machines or behavior trees (start with FSMs: Patrol → Suspicious → Search → Alert → Pursue). Navmesh movement for on-foot NPCs.
- Ship AI: steering behaviors on the water (seek, avoid, flee, follow route) plus a high-level decision FSM (Transit, Flee, Surrender, Fight, Pursue).

### 4.6 Economy & world simulation (plan 05)
- Markets per port: stock and price per good, updated on the world tick by production/consumption rules, seasonal modifiers and events.
- Traffic generator: spawns abstract voyages from cargo flows (ore Two Harbors → lower lakes, etc.). These are the ships the player meets.
- All of it is deterministic given a seed plus player actions, which helps debugging and balancing. Seeded PRNG in `core/rng`.

### 4.7 Save system (plan 16)
- **One save slot per run**, stored in IndexedDB as compressed JSON: `{ saveVersion, gameVersion, seed, createdAt, WorldState }`.
- **Autosave triggers:** entering or leaving a zone or mode, after trades, sleeping, a periodic timer (e.g., every 2 real minutes) and `visibilitychange`/`pagehide`.
- **Permadeath:** on `RunEnded`, delete the slot *before* showing the GameOver screen. There is no manual save or load.
- **Migrations:** an ordered list of `migrate(vN → vN+1)` functions, run on load. Every `WorldState` schema change increments `saveVersion` and adds a migration plus a test fixture.
- Dev builds: a hidden "export/import save" (to a file) for debugging and testing.

### 4.8 Input
- An action-mapping layer: physical keys/mouse → semantic actions (`TrimSailsIn`, `FirePort`, `Interact`, `Crouch`…), with a context per mode.
- Pointer lock for the on-foot camera. Free mouse for sailing camera orbit and aiming.
- Rebinding is supported by the data model from day one (UI later).

### 4.9 Assets & loading
- Formats: **GLB** (meshopt-compressed), **KTX2** textures, audio as **OGG/Opus** (with an MP3 fallback only if needed).
- An **asset manifest** per zone/mode lists what to load. A loader with ref-counting unloads what the next zone doesn't need.
- A loading screen with progress between zones. In-zone streaming for terrain tiles and vegetation.
- Pipeline (`tools/assets/`): raw AI/CC0 asset → normalize scale and pivot → assign stylized material slots → decimate to budget → compress → write to `public/assets/` plus a manifest entry. One command processes everything.

---

## 5. Performance Budgets (low-end baseline: the developer's limited laptop)

Baseline: Ryzen 7 7730U with integrated Radeon graphics on Linux (see §13). GPU-bound, so these budgets mostly protect the GPU.

**Target:** 60 fps on the "Medium" preset on the developer's machine, with **30 fps as the hard floor** on "Low." If something can't hit that, it gets cut or simplified, not optimized forever.

| Budget | Low preset | Medium preset (baseline) | High |
|---|---|---|---|
| Render resolution | 0.6–0.75× (dynamic scaling) | 0.85–1.0× | 1.0× |
| Draw calls | ≤ 100 | ≤ 150 (≤ 200 docks) | ≤ 300 |
| Visible triangles | ≤ 300k | ≤ 600k | ≤ 1.2 M |
| Shadows | Off (blob shadows) | One cascade, small map, near only | Two cascades |
| Post-processing | Tone mapping only | Plus light bloom or outlines (one of them) | Both |
| Vegetation density / draw distance | 30% / short | 60% / medium | 100% / long |
| Texture memory | ≤ 128 MB | ≤ 256 MB | ≤ 512 MB |

| Budget (all presets) | Target |
|---|---|
| JS heap | ≤ 300 MB |
| Zone load time | ≤ 8 s on a warm cache |
| Initial download (first playable) | ≤ 30 MB; the rest streams per zone |
| Player schooner | ≤ 12k triangles (closest LOD), plus 2 LODs |
| NPC ships | ≤ 8k triangles plus LODs; far ships are impostors or very low poly |
| Materialized ships at once | ≤ 8 |
| Active on-foot NPCs (guards) | ≤ 12 with full AI; others simplified |
| Gameplay tick | ≤ 3 ms CPU at 30–60 Hz (**30 Hz fixed tick is fine**; render interpolates) |
| World tick | ≤ 1 ms per frame (amortized across frames) |

**Physics philosophy (decided):** keep physics simple everywhere.
- Ships use arcade steering plus a few buoyancy samples, with no rigid-body solver.
- Cannonballs are simple ballistic arcs with sphere-vs-hull-box hit tests.
- On foot: heightmap plus primitive collisions.
- Nothing is simulated that the player can't see or feel.

Fog and stylized art are allies here: short, atmospheric draw distances are a feature on Lake Superior.

Track these in the dev overlay from the first prototype onward. **A quality-preset menu and dynamic resolution scaling are Phase 1 features**, not polish.

---

## 6. Project Structure (proposed)

```
great-lakes-pirate/
├─ plans/                     # design & technical plans (this folder)
├─ references/                # source reference material (photos, bio)
├─ src/
│  ├─ main.ts                 # bootstrap
│  ├─ core/                   # loop, time, events, rng, coords, input, assets, save, registry
│  ├─ sim/                    # pure TS world simulation (NO three.js imports)
│  │  ├─ calendar/  weather/  economy/  traffic/  law/  fame/
│  │  ├─ hideouts/  events/   player/   world-state.ts
│  ├─ gameplay/               # active-zone systems
│  │  ├─ sailing/  combat/  boarding/  onfoot/  stealth/  build/  wrecking/
│  ├─ render/                 # three.js presentation
│  │  ├─ water/  terrain/  sky/  ships/  characters/  vfx/  materials/  post/
│  ├─ modes/                  # state machine: chart, sailing, onfoot, build, menus, jail…
│  ├─ ui/                     # Preact components, HUD, screens, styles
│  ├─ audio/
│  └─ debug/                  # dev console, gui panels, overlays (stripped in prod)
├─ data/                      # JSON definitions (goods, ships, weapons, ports, lights,
│                             #   zones, structures, backgrounds, events) + zod schemas
├─ public/
│  ├─ assets/                 # processed GLB/KTX2/audio + manifests
│  └─ world/                  # baked zone tiles (heightmaps, masks, navmeshes)
├─ tools/
│  ├─ assets/                 # gltf-transform pipeline scripts
│  ├─ geo/                    # GDAL/Node scripts: bathymetry/DEM → tiles
│  └─ data/                   # validators, CSV→JSON converters (e.g., from R1 tables)
├─ tests/                     # vitest unit tests + fixtures (incl. save migrations)
├─ e2e/                       # playwright smoke tests
└─ raw-assets/                # (gitignored or LFS) unprocessed AI/CC0 sources
```

**Import rules (enforced by ESLint `no-restricted-imports`):**
- `sim/` may import only `core/` (minus render-related parts) and `data/` types.
- `render/` and `ui/` may read `sim/` state but never mutate it directly. They go through gameplay actions and events.
- `debug/` is excluded from production builds.

---

## 7. Data-Driven Definitions

All content lives in `data/` as JSON, validated by zod schemas. A short list for the MVP:

| File | Contents |
|---|---|
| `goods.json` | id, name, category (legit/contraband), base price, weight/volume, seasonal availability |
| `ships.json` | ship classes: stats, crew size, cargo, weapon slots, model id, light/visibility profile |
| `weapons.json` | cannons, swivel gun, small arms: stats, upgrade tiers |
| `upgrades.json` | ship upgrades and requirements |
| `zones.json` | coastal zones: geo bounds, compression, tiles, spawn points, Wanted region |
| `ports.json` | ports: zone, market profile, services, docks district id, Wanted region |
| `lighthouses.json` | position, light tier, keeper count, reporting speed (from R1 table) |
| `regions.json` | Wanted regions and boundaries (from R1a) |
| `routes.json` | route graph for chart travel and AI traffic |
| `structures.json` | grid building pieces: footprint, cost, function |
| `recipes.json` | crafting recipes |
| `backgrounds.json` | character backgrounds and perks |
| `events.json` | sandbox events and rumor templates |
| `factions.json` | fictionalized companies, law agencies, trade-only communities |

The R1/R1a research tables convert almost directly into `ports.json`, `lighthouses.json`, `regions.json` and `zones.json`.

---

## 8. Conventions

- **Strict TS**, no `any` in `sim/`. Prefer plain data plus functions over class hierarchies for state (serializable by default).
- **IDs are stable strings** (`"port.bayfield"`, `"good.whitefish"`). Saves reference IDs, never array indices.
- **Units:** meters, seconds, radians, knots only at the UI boundary. Money in integer cents.
- **No `Math.random()` in `sim/`.** Use `core/rng` (seeded).
- Each system plan lists its events, state slices and data files.
- Small, frequent commits. A plan's status is updated when its implementation lands.

---

## 9. Testing Strategy

| Layer | How |
|---|---|
| `sim/` (economy, law, Fame, calendar, validation rules) | Vitest unit tests: deterministic seeds, golden-value tests for balance curves |
| Save/load | Round-trip tests, migration tests against stored fixture saves from each version |
| Data | A schema validation test over all `data/*.json` |
| Coordinates | Conversion round-trip tests (geo ↔ chart ↔ zone) |
| Rendering/gameplay | Playwright smoke tests: boot, enter zone, sail for N seconds, no console errors, screenshot diff on key scenes (loose threshold) |
| Performance | A dev-only benchmark scene with a fixed camera path that logs frame times, run before merging heavy changes |

---

## 10. Hosting, Version Control & Tooling

- **Git:** the project isn't a repository yet. Phase 0 starts with `git init` and a `.gitignore` (node_modules, dist).
- **Large files go into git (decided)** using **Git LFS** for binaries: GLB, KTX2/PNG textures, audio, baked world tiles, and raw source assets in `raw-assets/`. Track them via `.gitattributes` from the first commit.
  - *Caveat:* GitHub LFS has free storage and bandwidth quotas. Check the current limits at setup, keep raw assets lean (prune failed AI generations), and **cache LFS objects in CI** so every build doesn't re-download them.
- **Remote:** **public GitHub repo** (open source), with Actions CI (lint, typecheck, unit tests, build).
- **Hosting (decided): a DigitalOcean droplet** as the primary, with an optional **itch.io** mirror. GitHub Pages is not used.
  - **Server:** a small droplet running **Caddy** (automatic HTTPS via Let's Encrypt; simple config) or nginx, serving the static `dist/` build. No backend code is needed (local saves only).
  - **Server config checklist:**
    - Correct MIME types for `.glb`, `.ktx2`, `.wasm`, `.ogg`/`.opus`.
    - Brotli/gzip for JS, JSON and text.
    - **Long-lived cache headers for hashed assets** (`immutable`) and short ones for `index.html`.
    - HTTP/2 or HTTP/3.
    - Optional COOP/COEP headers if `SharedArrayBuffer` or multithreaded WASM is ever needed (it isn't planned).
  - **Deploy:** a GitHub Actions workflow on push to `main` (or on tags): checkout with LFS → build → `rsync` over SSH to the droplet into a versioned release folder → atomically switch a `current` symlink (instant rollback). The deploy SSH key is stored as a repo secret, with a restricted deploy user.
  - **Basic hardening:** SSH keys only, firewall (ports 22/80/443), unattended security updates.
  - **Later, if needed:** put a CDN in front (DigitalOcean Spaces CDN or Cloudflare) if traffic or bandwidth grows. Droplets include a monthly transfer allowance; check the current plan limits.
  - **itch.io mirror:** a separate CI job zips `dist/` and uploads with **butler** (itch.io's CLI). itch.io HTML5 uploads have zip size and file-count limits, so check them when the time comes; zone streaming keeps the initial bundle small.
  - The Vite build stays **path-agnostic** (relative `base`) so the same build works at a domain root on the droplet and inside itch.io's iframe.
- **License (decided: open source).**
  - **MIT** for code (decided).
  - **CC BY 4.0** for original assets and data.
  - A `CREDITS.md` and `assets/LICENSES` manifest recording the source and license of every third-party or AI-generated asset.
  - **AI tool terms must allow public redistribution** of outputs. Some free tiers restrict ownership or require attribution or a paid plan. Check this in spike S4 before choosing a tool, and do the same for AI audio tools (plan 15).
- **Browser support:** current Chrome, Edge, Firefox and Safari on desktop. WebGL2 is the minimum (WebGPU optional, depending on S1).

---

## 11. Phase 0 — Setup & Spikes

### 11.1 Setup tasks
1. `git init`, `.gitignore`, `.gitattributes` (LFS patterns), README, LICENSE (code) plus an asset license note, `CREDITS.md`. Create the public GitHub repo.
2. Scaffold Vite + TS strict + three.js. ESLint/Prettier, Vitest, Playwright.
3. Create the folder structure (§6) and import-rule lint config.
4. Core skeleton: loop (fixed tick plus render), mode state machine, event bus, seeded RNG, coords module, input action map, asset loader, dev overlay (stats plus lil-gui).
5. `WorldState` skeleton plus a save/load round trip to IndexedDB with `saveVersion: 1`.
6. `data/` with zod schemas and two or three sample definitions. A validation test.
7. CI workflow (lint, typecheck, test, build). Provision the droplet (Caddy, deploy user, firewall) and add the deploy workflow (LFS checkout → build → rsync → symlink switch). The itch.io butler job can wait until the first public build.
8. Quality presets (Low/Medium/High) and a dynamic resolution scaling hook in the renderer wrapper.

### 11.2 Spikes (time-boxed experiments; each produces a short write-up appended to the relevant plan)

| ID | Spike | Question answered | Feeds |
|---|---|---|---|
| **S1** | Renderer: WebGPURenderer+TSL vs. WebGLRenderer | Stability and performance **on the developer's machine** (frame time, startup or shader-compile time), plus post-processing availability. Pick one. | 01, 04, 14 |
| **S2** | Water and buoyancy | Can a shared Gerstner wave set (≤ 4 waves on Low) look good and drive a bobbing hull within the Low/Medium budgets? | 02, 04 |
| **S3** | Geo pipeline for the Apostles | Turn NOAA bathymetry and USGS DEM into heightmap tiles plus a shoreline distance field. Choose resolution and compression. | 03 |
| **S4** | AI asset test plus **art style test** | Generate the schooner from `references/schooner.png` with free tiers of 1–2 image-to-3D tools (**check their terms allow open-source redistribution**); run it through the pipeline down to ≤ 12k triangles; render one scene in 2–3 candidate styles (low-poly flat, toon, painterly) and measure their cost on the dev machine. Pick the style. | 14 |
| **S5** | On-foot controller | A **hand-rolled** capsule controller on a heightmap island chunk plus box/cylinder props; pointer-lock camera. Is it good enough without Rapier? | 08, 11 |
| **S6** | Save size and speed | A realistic large `WorldState` (5 hideouts × 500 pieces, 200 abstract ships, markets). Compressed size, save time, no frame hitch. | 16 |

**Phase 0 exit criteria:** the repo builds and deploys a page that boots into a test scene with water, a bobbing placeholder schooner, the dev overlay, and a working autosave round trip. All six spikes are written up, and the renderer and art style are chosen.

---

## 12. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| three.js API churn (especially the WebGPU/TSL path) | Breakage on upgrade | Pin versions; upgrade on purpose; S1 gives a fallback path |
| Scope creep vs. a solo developer | Never shipping | Phase gates; MVP definition; each plan has a "cut list" |
| World scale overwhelms memory | Crashes, long loads | Zone streaming, budgets tracked from day one, compression |
| AI asset inconsistency | Ugly, mismatched visuals | Unifying stylized material; style test (S4); a strict pipeline |
| Physics feel (sailing) takes forever to tune | Core loop unfun | Arcade model, a tuning panel in the dev overlay, Phase 1 dedicated to feel |
| Limited dev hardware can't run the vision | Core loop unplayable | Low/Medium presets from Phase 1; fog-limited draw distance; budgets checked every phase; cut features before optimizing endlessly |
| Git LFS quota (storage/bandwidth) exceeded | Pushes or deploys blocked | Keep raw assets lean; prune failed generations; monitor usage; cache LFS objects in CI |
| Self-hosted droplet goes down or is misconfigured | Game unreachable | Static files only (little to break); versioned releases with symlink rollback; itch.io mirror as backup; basic uptime check |
| AI asset or audio licenses incompatible with open source | Assets must be replaced | Check terms before adopting a tool; record every asset in a license manifest |
| Save corruption under permadeath | Player loses a run unfairly | Atomic writes (write a new key, then swap), validation on load, keep the previous autosave as backup (deleted on death too) |
| Simulation and rendering coupling creeps in | Untestable spaghetti | Lint-enforced import rules; `sim/` has no three.js |

---

## 13. Open Questions

All resolved (see Decisions). No open questions remain for this plan; spike results will append findings.

### Baseline dev machine
| Component | Spec | Implication |
|---|---|---|
| CPU | AMD Ryzen 7 7730U (8 cores / 16 threads, Zen 3, laptop) | Plenty of CPU for the simulation. Could move the world tick or the geo/navmesh loading into a **Web Worker** later if needed. |
| GPU | Integrated AMD Radeon (Vega-based, 8 CUs) | **The GPU is the bottleneck.** Fill rate and shader cost matter most: keep the water shader cheap, limit overdraw (fog, foam, transparent sails), use resolution scaling, and keep shadows minimal. The §5 budgets fit this class of GPU. |
| RAM | 28 GB (shared with the iGPU) | Memory isn't a concern for development, but keep the §5 heap and texture budgets for players with less. |
| OS | Linux | **WebGPU availability on Linux browsers is less mature than on Windows/macOS. Check in S1** (Chrome and Firefox). If it isn't solid, **WebGLRenderer is the default**. Test on both Chrome and Firefox. |

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Spike S1 picks the renderer (WebGPU vs. WebGL), tested on the dev machine. |
| 2026-10-21 | Open source; public GitHub repo; the game won't be sold. |
| 2026-10-21 | ~~Hosting on GitHub Pages~~ (superseded the same day; see below). |
| 2026-10-21 | Hosting on a **DigitalOcean droplet** (static files via Caddy/nginx, deployed by GitHub Actions), with an optional itch.io mirror. No GitHub Pages. |
| 2026-10-21 | Large files committed to git via Git LFS. |
| 2026-10-21 | Limited dev hardware is the performance baseline; physics stays minimal (arcade ships, hand-rolled on-foot collisions, Rapier only as a fallback). |
| 2026-10-21 | Code license: **MIT** (anyone may build on it). Original assets and data: CC BY 4.0. |
| 2026-10-21 | Baseline machine: Ryzen 7 7730U, integrated Radeon graphics, 28 GB RAM, Linux. |

---

## Changelog
- v0.4: Hosting changed from GitHub Pages to a DigitalOcean droplet (Caddy, Actions rsync deploy, versioned releases); itch.io via butler.
- v0.3: MIT license confirmed; recorded the baseline dev machine and its implications (GPU-bound, check WebGPU on Linux).
- v0.2: Resolved open questions: open source plus licensing approach, GitHub Pages via Actions (LFS caveat), itch.io mirror, Git LFS, low-end hardware budgets with quality presets, minimal physics (Rapier demoted to fallback).
- v0.1: Initial tech stack, layered architecture, mode state machine, simulation LOD, event bus, coordinate spaces, subsystem outlines, budgets, project structure, conventions, testing, Phase 0 tasks and spikes.
