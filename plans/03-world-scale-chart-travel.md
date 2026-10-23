# 03 — World, Hybrid Scale, Chart Travel & Streaming

Status: DRAFT v0.4 (decisions made; gap review applied; S3 done; tuning pending spike S7)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs: [01 tech/architecture](01-tech-architecture.md) (coordinate spaces, simulation LOD, budgets), [R1](R1-western-superior-1900-research.md) and [R1a gazetteer](R1a-western-superior-gazetteer.md) (distances, places, regions)
Feeds: 02 (sailing speeds), 04 (clock, weather on chart), 05 (traffic/routes), 06 (Wanted regions, pursuit), 08/11 (on-foot areas), 14 (terrain look)

## Purpose

Define how a ~350-mile lake fits into a browser game on an integrated GPU while still feeling big, real and recognizable:
- the scale model (space and time)
- the coastal zones
- chart travel and encounters
- transitions between modes
- terrain data and streaming

---

## 1. Goals

1. **Feels big:** voyages take planning, the lake has moods, and distant places are a commitment.
2. **Never tedious:** no 20-minute stretches of empty water. Open water happens on the chart unless something interesting happens.
3. **Recognizable:** someone who knows the Apostles should recognize the island shapes, channels and relative positions.
4. **Consistent:** time, distance and speed agree, so "sail through the night to reach Ashland by dawn" works.
5. **Cheap:** fits the [01 §5](01-tech-architecture.md) budgets on the baseline laptop.
6. **Expandable:** the same system scales to all five lakes later.

---

## 2. The Layers of the World

```
WORLD (geo, lat/lon) ─ authoring truth for everything
  │
  ├─ CHART (2D strategic map of the lakes) ─ always available representation
  │     voyages, encounters, fog of war, rumors, weather fronts, ice
  │
  ├─ COASTAL ZONES (3D, real-time, compressed geography)
  │     Twin Ports · Two Harbors · Siskiwit Bay · Apostles & Chequamegon Bay
  │       ├─ Harbor set pieces (hand-authored, 1:1 scale, embedded in a zone)
  │       ├─ Walkable islands (on-foot scenes loaded from a zone)
  │       └─ Mainland hideout pads (small on-foot build areas; 09 §2.1)
  │
  ├─ OPEN-WATER ARENAS (3D, generated on demand for chart encounters)
  │
  └─ DOCKS DISTRICTS (3D on-foot scenes, separate, per port)
```

---

## 3. Scale Model

### 3.1 Principles
- **Geography is compressed; things are not.** Coastlines, islands and water distances shrink by a factor **C**. Ships, people, buildings, docks and props stay at **1:1** (or near it), because a half-size schooner or shrunken person looks wrong immediately.
- **Heights are not compressed.** Cliffs, hills and lake depth stay 1:1 (cliffs may be exaggerated ×1.0–1.5 for drama). Compressing height would flatten the red sandstone cliffs and turn shoals into nonsense.
- **Time is matched to compressed distance**, so the game clock stays consistent with "real" travel times (see §3.3).

### 3.2 Choosing C (horizontal compression)

| C | Apostles span (22 nm real) | Bayfield–Ashland (13 nm) | Madeline Island (~14 mi long) | Typical channel between islands (1–3 nm) | Verdict |
|---|---|---|---|---|---|
| 1 | 41 km | 24 km | 22 km | 1.9–5.6 km | Way too big |
| 6 | 6.8 km | 4.0 km | 3.8 km | 310–930 m | Very roomy; more content per island |
| **8** | **5.1 km** | **3.0 km** | **2.8 km** | **230–700 m** | **Recommended start** |
| 10 | 4.1 km | 2.4 km | 2.3 km | 185–560 m | Tight; islands become small walks |
| 12 | 3.4 km | 2.0 km | 1.9 km | 155–460 m | Cramped; channels start feeling like rivers |

Why **C = 8**:
- Channels stay comfortably wider than a schooner's turning circle (the schooner is ~30–40 m).
- The largest islands stay at 1–3 km walks, which is about right for **solo-developer content density**. A real-size Stockton Island would be miles of empty forest.
- The Apostles zone becomes ~7 × 7 km, which streams well in tiles.

C is a **per-zone parameter** (`zones.json`), but all MVP zones should share one value so speeds feel the same everywhere. **Spike S7** (§11) validates it with a greybox.

### 3.3 Time and speed

Three linked numbers:
- **C**: horizontal compression (8)
- **R**: game-clock rate (game seconds per real second while in a zone)
- **v₃ᴅ**: the speed the ship actually moves in the 3D scene

To keep the clock honest: `v₃ᴅ = v_game × R / C`

| Setting | Value (proposal) | Result |
|---|---|---|
| C | 8 | — |
| R | **24** (1 real minute = 24 game minutes; **one full day ≈ 60 real minutes**) | Day ≈ 35 min and night ≈ 25 min in summer (varies by season) |
| Schooner cruising (game speed) | 7–8 kn | v₃ᴅ ≈ 11–12 m/s on screen, about 22–24 visual knots. Brisk but readable for arcade. |
| Crossing the Apostles (22 nm) | ~2.9 game hours | ~7 real minutes |
| Bayfield → Ashland (13 nm) | ~1.7 game hours | ~4 real minutes |
| Bayfield → La Pointe (2 nm) | ~15 game minutes | ~40 real seconds |

- Faster ships or a good wind raise `v_game`, and v₃ᴅ follows automatically. The arcade sailing model in plan 02 works in **game knots** and converts at the boundary.
- **On foot, the clock slows down (decided).** Proposed **R_foot = 6** (1 real minute = 6 game minutes), so a 10-minute docks heist ≈ 1 game hour, and a full night (~6–9 game hours) gives ~60–90 real minutes of on-foot time. The value is tunable in S7 and plan 08.
  - The switch happens on "Go ashore" and "Return aboard," with a small HUD clock-speed indicator.
  - Abstract world simulation keeps ticking at the slower rate (ships move less while you're ashore), which stays consistent because R only changes how fast game time passes.
- **"Wait/sleep"** (at a hideout, in port, or moored) fast-forwards the clock, for example to dusk or dawn.
- The visual speed is a bit fast for a real schooner. That's the arcade compromise, softened by exaggerated wake and spray and a camera that frames scale well. If it feels wrong in S7, lower R (e.g., 20 → day ≈ 72 minutes) rather than raising C.

### 3.4 Exceptions: where 1:1 objects meet compressed land

Compressing geography breaks a few places. These get **hand-authored set pieces** at 1:1, blended into the compressed terrain:

| Problem at C = 8 | Example | Solution |
|---|---|---|
| Narrow man-made channels become impossibly thin | Duluth Ship Canal (~300 ft wide → 11 m) | **Harbor set piece**: canal, piers and lights authored at 1:1, with a "lens" region of locally uncompressed space |
| Docks and waterfronts become too short for 1:1 ships | An ore dock (~2,000 ft → 76 m) vs. a 300-ft freighter | Waterfronts authored at 1:1 inside the set piece. The town around them is stylized and smaller. |
| River mouths and harbor entrances | Superior Entry, Agate Bay, Bad River mouth | Set piece or local widening |
| Overhangs that heightmaps can't represent | **Sea caves** (Devils Island, Sand Island, mainland) | Authored cave meshes embedded in the terrain |

A **set piece** is a hand-built region (1:1 inside, typically 0.5–1.5 km) placed at the port's compressed location. The terrain around its edge is warped or blended to meet it. Every port gets one, and it doubles as the area where the schooner moors before switching to the docks district.

### 3.5 Ship scale
- Player schooners and small craft: 1:1.
- **Big freighters are shrunk (decided): 0.75–1.0×**, with the exact factor tuned in S7. A 1:1 steel ore boat (~400 ft) is huge in a compressed bay. A slight shrink keeps encounters readable without looking wrong next to the schooner. Scale applies per ship class (`ships.json` → `displayScale`).

---

## 4. Coastal Zones (MVP)

Derived from the [R1a distances](R1a-western-superior-gazetteer.md#distances-estimated). Sizes are at C = 8.

| Zone ID | Covers | Real extent (approx.) | Compressed size | Set pieces | Walkable islands | Wanted region(s) |
|---|---|---|---|---|---|---|
| `zone.twin_ports` | Duluth–Superior harbor, Minnesota and Wisconsin Points, both entries | ~10 × 8 nm | ~2.3 × 1.9 km | Duluth canal & waterfront; Superior Entry & shipyard; Minnesota Point (abandoned light) | Minnesota Point hideout pad | **Duluth** / **Superior** (split by the harbor/state line) |
| `zone.two_harbors` | Agate Bay and nearby North Shore | ~5 × 4 nm | ~1.2 × 0.9 km | Ore docks & lighthouse | North Shore cove hideout pad | North Shore |
| `zone.siskiwit` | Siskiwit Bay, sea-cave shoreline | ~8 × 5 nm | ~1.9 × 1.2 km | Logging landing | Logging-camp hideout pad (mainland sea caves by boat) | South Shore West |
| `zone.apostles` | All Apostle Islands, Bayfield, Washburn, Ashland, La Pointe, Red Cliff, Chequamegon Bay, Long Island, approach to Bad River | ~30 × 30 nm | ~7 × 7 km (tiled) | Bayfield, Washburn, Ashland, La Pointe, Red Cliff landing, Bad River landing | **All 22 islands** by Beta (the MVP has one hero island; [11 §15](11-exploration-islands-secrets.md)) | **Apostle Islands**, **Chequamegon Bay** and **Ashland** ([06 §3.1](06-fame-wanted-law-lighthouses.md)) |

- **Mainland on-foot exception (decided 2026-10-22):** the mainland isn't walkable except docks districts and the **build pads of the three mainland hideout sites** ([09 §2.1](09-hideouts-building-crafting.md)). A pad is the site's build bounds plus a small margin, loaded like an island.
- **The Apostles is the main playground** (start area, most content). It's large enough that it streams by tile rather than being a single loaded scene.
- **Zone edges** are soft: the water continues ~1 km past the authored area, fog thickens, and a "Take to the chart" prompt appears. There are no invisible walls except at the very edge.

### 4.1 Ojibwe community access
- Red Cliff: a landing set piece on the Bayfield peninsula coast north of Bayfield. Trade only (no crime interactions available).
- Bad River (Odanah is inland): a **landing at the river mouth** set piece. Trading happens there (a small boat or landing). Whether the schooner can go upriver is ❓ in R1. The default is no.

### 4.2 Madeline Island
- Settled (La Pointe village), and the largest island (~2.8 km compressed).
- The village waterfront is a set piece (a small docks area). The rest of the island is walkable like other islands, with farms and woods instead of wilderness. Details are for plan 11.

---

## 5. Chart Mode

### 5.1 What it is
A 2D strategic map in a **period nautical-chart style** (parchment, soundings, compass rose; it can borrow from historical US Lake Survey charts per R1 §6). It's rendered with an orthographic three.js camera or 2D canvas. Plan 13 sets the look.

### 5.2 What it shows
- Coastlines and depth shading of the playable lakes. For the MVP, western Superior is fully charted, and the rest is greyed out as "beyond your charts."
- Ports, lighthouses (with light-tier rings at night), zone boundaries and Wanted regions (colored by your heat).
- **Fog of war**: unvisited coves, wrecks and secrets are hidden until discovered or learned through rumors and maps.
- Your ship, your plotted course, an ETA (game time), and provisions/condition warnings.
- **Rumored positions** (the *Morrill* "coaling at Duluth, two days ago"), with an age and uncertainty circle.
- Weather fronts, fog banks, storm cells and seasonal ice.
- Known traffic lanes (from the route graph), but not individual ships unless spotted.

### 5.3 Plotting and sailing a voyage
1. Leave a zone (cross the soft edge) or select "Chart" when in open water.
2. Click waypoints or a destination (port, zone entry or point). The course is validated against the chart land mask and known shoals; unknown shoals are a risk in fog or at night.
3. **Voyage simulation:** the ship moves along the course at `v_game`, derived from ship stats, wind (plan 04), sail upgrades, damage and cargo load. **Time compression on the chart:** default ~1 game hour per 2–3 real seconds, so Duluth → Bayfield (~9 game hours) takes ~20–30 seconds plus any encounters.
4. **The world ticks normally** during the voyage (economy, traffic, weather, Wanted decay). The chart is not a pause.
5. **Arrival:** reaching a zone boundary loads the zone and places the ship at the matching edge point and heading.

### 5.4 Restrictions (to prevent cheap escapes)
- **No chart travel while pursued (decided).** If a hostile (the cutter, an armed ship, harbor police) has you detected within a threat radius, the chart option is locked. You have to break line of sight first (fog, night, islands, distance).
- No chart travel from inside a harbor set piece. You have to sail out.
- In winter, chart routes through ice fields carry hull-damage risk, or are blocked when the ice is solid.

---

## 6. Encounters

### 6.1 Encounters come from the simulation, not dice
Per [01 §3.4](01-tech-architecture.md), ships always exist abstractly on the route graph. During a voyage, the chart checks **real abstract entities** near the player's track:
- **Ships** (freighters, schooner-barges, fishing tugs, steamers, the *Morrill*, rare rival pirates) within spotting range. Range depends on weather, time of day, and both ships' visibility.
- **Static points of interest** passed nearby: wrecks, derelicts, uncharted islands or reefs (if hidden).
- **Weather events:** a storm cell crossing the track, a fog bank, an ice field.
- A small layer of **scripted or random events** (a lifeboat with survivors, a burning ship, a smuggler's signal light) feeds plan 12's sandbox events.

### 6.2 Encounter flow
```
Spotted something (or something spotted you)
   ├─ Info: type, size, heading, flag/markings (more detail with spyglass/Fame/daylight)
   └─ Choice:
        • Engage / Investigate → drop into an Open-Water Arena
        • Avoid → stealth/speed check (night, fog, your visibility, their speed)
        • Ignore (non-threatening, out of range) → continue voyage
   Forced: hostile that detects you and is faster/closer → arena (you must evade or fight)
```

### 6.3 Open-water arenas
- A generated 3D scene, about **3 × 3 km** (compressed space), centered on the encounter point.
- Contents: water with current weather, sky and time of day, and **distant coastline silhouettes** generated from the chart (low-poly from the land mask) if land is within view distance. Any participants are materialized from their abstract state.
- Leave by sailing out of the arena edge (if not pursued) or by resolving the encounter. You return to the chart at the same point and resume the voyage.
- Cheap by design: no terrain tiles, just water plus a few ships, so it's the lightest mode to render.

### 6.4 Encounter pacing (tuning targets)
- Average **0–2 meaningful encounters per typical voyage**, scaled by traffic density on that route and season. Fall is busy; winter is near empty.
- **Lookout setting (decided):** the player chooses *report everything* / *threats and prizes only* / *threats only*. Forced encounters (a hostile that detects you) always interrupt regardless of the setting. The setting is saved in `voyage.lookoutPref`, and its default is *threats and prizes*.

---

## 7. Transitions

| From → To | Trigger | Load behavior |
|---|---|---|
| Zone → Chart | Cross the soft zone edge and confirm (or auto-prompt) | Unload zone tiles (keep the core cached briefly in case of an immediate return) |
| Chart → Zone | Course reaches a zone boundary, or the destination is inside a zone | Loading screen (≤ 8 s); ship placed at the matching edge point and heading |
| Chart → Arena | Engage, or forced encounter | Fast (≤ 2 s; water and ships only) |
| Arena → Chart | Leave arena edge / encounter resolved | Instant |
| Zone ↔ Walkable island or hideout pad | Anchor near the island → "Go ashore" (rowboat cutaway) | **Separate scene load** (decided 2026-10-22): the 1 m tiles, props and navmesh load behind a short transition; the schooner stays anchored as an entity |
| Zone ↔ Docks district | Moor in the harbor set piece → "Go ashore" | Separate scene load (the docks district); the zone stays in memory if the budget allows, otherwise it's reloaded on return |
| Any → Jail / GameOver | Captured / killed | Flow from plans 06 and 12 |

**Loading:** every transition, zone ↔ island included, uses a short load hidden behind a period-style transition (a chart unrolling, a newspaper page, a fade to fog).

---

## 8. Terrain & Data Pipeline (spike S3 detail)

### 8.1 Sources (US government, public domain, compatible with the open-source license)
| Data | Source | Use |
|---|---|---|
| Lake Superior bathymetry | **NOAA NCEI Great Lakes Bathymetry** (Lake Superior grid) | Depth: water color, shoals, hazards, anchorage |
| Land elevation | **USGS 3DEP** DEM (1/3 arc-second ≈ 10 m) | Islands, cliffs, shoreline relief |
| Shoreline | NOAA shoreline vectors (or derived from the DEM/bathymetry zero contour) | Land/water mask, shoreline distance field (foam, AI avoidance) |
| Historical charts (reference only) | NOAA Office of Coast Survey historical charts; US Lake Survey around 1900 | Hand-corrections for 1900 harbors (modern breakwaters, fills, dredged channels differ) |

### 8.2 Pipeline (`tools/geo/`, GDAL plus Node scripts)
1. **Reproject** to ~~**UTM zone 15N**~~ the game's chart projection (the local equirectangular projection in `src/core/coords.ts`), so baked samples line up with `geoToChart()` at runtime (S3, §14).
2. **Merge** DEM and bathymetry into one elevation surface (land positive, lake bottom negative relative to the lake level, ~602 ft / 183.5 m).
3. **Clip** per zone (geo bounds from `zones.json`) with a margin.
4. **Compress horizontally by C**: resample to the zone grid, where 1 m of game space = C m of real space. ~~Heights stay 1:1 (with an optional cliff exaggeration curve).~~ Land heights go through a configurable curve, because 1:1 heights make slopes C times steeper; water depth stays 1:1 (S3, §14.3; the curve is pending a decision).
5. **Resample resolution:**
   - **Sailing tiles:** ~4 m/sample of game space (Apostles ≈ 1,750² samples, ~6 MB at 16-bit).
   - **On-foot island tiles:** ~1 m/sample, generated for **all 22 island** footprints plus a beach margin, and for the three mainland hideout pads.
6. **Derive:** land/water mask, **shoreline signed distance field**, depth bands, slope (for vegetation and walkability), a vegetation density map (from slope plus elevation; hand-paintable override), **wind shelter maps** for 16 wind directions, and **channel funneling maps** (S3 bakes these; see [02 §11](02-arcade-sailing.md#11-wind-interface-contract-with-plan-04)).
7. **Hand-edit layer:** set-piece footprints (flatten or warp), 1900-era harbor corrections, sea-cave insertion points. Edits are stored as vector or mask data, so re-running the pipeline is repeatable.
8. **Tile and encode:** e.g., 256×256-sample tiles as 16-bit PNG or raw plus fflate compression, with a tile manifest. Output to `public/world/<zone>/` (Git LFS).
9. **Chart data:** a simplified coastline polygon set and depth shading for the whole lake (low resolution) for chart mode and arena silhouettes.

### 8.3 Runtime terrain
- **Streaming:** tiles load by distance from the camera. A low-res whole-zone base mesh is always loaded, so distant islands show as silhouettes in fog.
- **LOD:** geomipmapped tiles (or CDLOD) with skirts. The Medium preset aims for ≤ 40 terrain draw calls.
- **Water depth** comes from the same height data (the shader samples a depth texture for color bands and shoals).
- **Vegetation:** instanced stylized pines, birches and rocks from the density map, with distance-culled LOD and impostor billboards far away. Vegetation is the biggest draw-call and fill-rate risk on the iGPU, so the presets scale its density.
- **Collision:**
  - Ship vs. terrain: depth query (aground when depth < draft) plus a shoreline SDF for "push back" and damage.
  - On foot: heightmap ground plus prop primitives ([01 §2.2](01-tech-architecture.md)).

### 8.4 Memory estimate (Apostles, Medium preset)
| Item | Estimate |
|---|---|
| Sailing heightmap (whole zone, 4 m) | ~6 MB |
| Derived masks (SDF, vegetation, depth bands) | ~10 MB |
| Active on-foot island tiles (1 m) | ~4–16 MB |
| Vegetation instance buffers (visible set) | ~10–20 MB |
| **Total terrain** | **~30–50 MB**, well within budget |

---

## 9. World Data Model (additions to `data/` and `WorldState`)

**Static data:**
- `zones.json`: id, geo bounds, C, origin, tile manifest path, set pieces[], walkable islands[], entry points[], region mapping.
- `setpieces.json`: id, zone, 1:1 footprint, placement, linked port and docks district.
- `islands.json`: id, name, zone, footprint, landing points, POIs (filled by plan 11).
- `routes.json`: route graph nodes (ports, zone entries, waypoints) and edges (lanes) with traffic weights by season.
- `chart.json`: chart extents, projection, charted vs. uncharted areas.

**WorldState slices:**
- `player.location`: `{mode, zoneId?, arena?, chartPos?, islandId?, districtId?}` plus position and heading.
- `voyage`: `{course[], progress, startedAt, lookoutPref}` while in chart mode.
- `discovery`: discovered POIs, charted coves and wrecks, known rumors (with timestamps).
- Abstract entities (ships, cutter) live in the traffic slice (plan 05).

**Events:** `ZoneEntered`, `ZoneExited`, `VoyageStarted`, `VoyageArrived`, `EncounterSpotted`, `EncounterEngaged`, `EncounterAvoided`, `WentAshore`, `ReturnedAboard`, `Discovered`.

---

## 10. Expanding Beyond the MVP

- **More Superior:** add zones (Keweenaw, Isle Royale, Marquette, the Soo) and extend the chart. The pipeline is the same, with a new UTM zone per area (16N east of −90°). The coords module handles multiple projections per zone.
- **Other lakes:** each lake gets a chart region plus zones. The **Soo Locks** (St. Marys River) become a special transition zone between Superior and Huron/Michigan, a natural gate with heavy law presence.
- C stays the same everywhere so ship speeds feel consistent across the whole game.

---

## 11. Spikes & Prototypes

| ID | Spike | Question | Exit criteria |
|---|---|---|---|
| **S3** | Geo pipeline (Apostles) | Can we produce compressed heightmap tiles plus an SDF from NOAA/USGS data reproducibly? | One command builds `public/world/apostles/` (with shelter, fetch and funneling maps, and 1 m tiles for all 22 islands); islands are recognizable compared with a real map |
| **S7** | **Scale-feel greybox** (new) | Do C = 8 and R = 24 feel right? Visual speed, channel widths, island walk sizes, freighter scale | Greybox Apostles zone with a placeholder schooner and a dev panel to vary C (6/8/10), R and freighter scale live. Pick values. |
| **S8** | Chart mode prototype (new) | Is plotting plus a compressed voyage plus encounter interrupts fun and readable? | Chart with western Superior, course plotting, a time-compressed voyage, a fake encounter popping into an empty arena and back |

S7 and S8 are **Phase 0** prototypes (decided 2026-10-22; [01 §11](01-tech-architecture.md)). S7 should follow S2 (water) and can reuse the S3 output. A flat-mask fallback is fine if S3 isn't done.

---

## 12. Cut List (if scope or performance demands)
1. Distant coastline silhouettes in arenas: use fog only.
2. Per-tile vegetation variety: one or two tree types.
3. Chart fog of war: show everything.
4. Siskiwit Bay zone: merge it into the chart as a point of interest with a small arena. If used, the logging-camp hideout pad stays reachable from that arena, so the site and the Lumberjack start survive.

---

## 13. Open Questions

Remaining tuning (not decisions) happens in S7: the exact freighter scale and the exact R_foot.

- ❓ **Land height curve** (S3, §14.3): keep heights 1:1, halve them, or a soft knee at 20 m (proposed). The pipeline bakes the soft knee until this is decided.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | Horizontal compression **C = 8** (geography only). |
| 2026-10-21 | **~60-minute real day** while sailing (R = 24). |
| 2026-10-21 | **No chart travel while a hostile has you detected.** |
| 2026-10-21 | Big freighters are **shrunk** (~0.75–1.0×) for readability. |
| 2026-10-21 | **Lookout setting** filters encounter interruptions; forced encounters always interrupt. |
| 2026-10-21 | **Clock slows on foot** (proposed R_foot = 6; tune in S7/plan 08). |
| 2026-10-22 | Zone ↔ island uses a **separate scene load** (old cut #2 applied). |
| 2026-10-22 | All 22 islands get 1 m on-foot tiles; the MVP ships one hero island. |
| 2026-10-22 | The three mainland hideout sites get small on-foot build pads, the only mainland on-foot areas besides docks districts. |
| 2026-10-22 | The Apostles zone spans three Wanted regions: Apostle Islands, Chequamegon Bay, Ashland. |
| 2026-10-22 | S7 and S8 are Phase 0 prototypes; S3 bakes funneling maps. |

---

## 14. Spike S3 Results: Geo Pipeline (2026-10-23)

**Question** (§11): can we produce compressed heightmap tiles plus an SDF from NOAA/USGS data reproducibly?

**Answer: yes.** `npm run geo:build` bakes `public/world/apostles/` from public-domain sources in one command: about 35 s from cache and about 1.5 minutes from scratch on the cloud dev box (the first run downloads ~100 MB of bathymetry and reads the DEM blocks it needs). The output is **9.6 MB**: sailing tiles 2.3 MB, SDF and wind maps 1.1 MB, and 1 m tiles for all 22 islands 6.2 MB. That's under the §8.4 estimate (~6 MB for the sailing heightmap alone). Code, format and usage are in [`tools/geo/README.md`](../tools/geo/README.md); the bake report with per-island numbers is [`tools/geo/reports/apostles.md`](../tools/geo/reports/apostles.md).

### 14.1 What was built
| Piece | Result |
|---|---|
| Sources | NOAA NCEI Lake Superior bathymetry, 3″ (~90 m, includes nearshore land), and USGS 3DEP 1/3″ (~10 m) read in place from the cloud-optimized tiles, so only the zone's blocks download |
| Zone grid | Centered at 46.835°N 90.72°W: **7.17 × 8.19 km game** (57.3 × 65.5 km real), 7 × 8 tiles. It covers Eagle Island to Outer Island, Devils Island to Ashland and the Bad River mouth |
| Merge | Land from the DEM (lake hydroflattened, so ≤ 0.5 m above lake level counts as water), depth from the bathymetry, 0 = 183.5 m. Where the coarse bathymetry still reads as land, water is clamped to −0.3 m (reads as a shallow shelf) |
| Sailing heightmap | 4 m samples, 1793 × 2049, as 56 tiles of 257² (256 plus a shared edge row and column) |
| Shoreline SDF | Exact Euclidean distance transform on the 4 m grid, 0.25 m steps, positive over water |
| Shelter, fetch, funneling | 16 directions × 224 × 256 cells of 32 m. Rays that leave the zone continue on a 1 km lake-wide grid, so fetch from the open lake is real (up to ~400 km for an east-north-east wind, down the length of Superior) |
| Islands | Each island's land component is found from its center point; **20 of 22** match directly. Long Island is joined to the mainland in the data and uses a clip box. **Gull Island** (a ~1 ha rock) is below the land threshold and gets an empty 256 m tile: a job for the hand-edit layer |
| Decoder | `src/core/terrain-grid.ts` (`decodeGrid`), shared by every baked grid, with round-trip tests |

### 14.2 Decisions made in the spike
- **Projection: the game's chart projection, not UTM 15N.** `coords.ts` already defines chart space as a local equirectangular projection, and every runtime position goes through it. Baking in the same projection (as a PROJ string for GDAL) means a port's lat/lon lands on the right terrain sample with no reprojection at runtime. The cost is ~1.3% east-west scale error at the Apostles (the projection's reference latitude is 47.5°N), which is invisible at C = 8. A test checks the two projections agree.
- **Format: raw 16-bit, row-delta, byte planes, deflate** (fflate decodes it). Heights in 1/64 m steps from −512 m. On the sailing tiles it's 8% smaller than 16-bit PNG and 46% smaller than plain deflate, and it avoids the browser's 8-bit canvas when decoding PNGs. Coarser 1/16 m steps would save another ~30%, but they terrace gentle 1 m on-foot slopes.
- **Resolution: kept at 4 m (sailing) and 1 m (on foot).** The DEM is ~10 m real = 1.25 m game, so 1 m tiles are lightly upsampled; finer detail comes from authored props. Bathymetry is ~11 m game, so seabed detail is smooth: fine for color bands and depth checks.
- **Lee length is measured in game meters** (15 × obstacle height). In real meters the lee behind a 30 m island would be ~60 m game, about two ship lengths at C = 8, which isn't a usable refuge. In game meters it's ~450 m, which matches what the player sees, because heights aren't compressed. Fetch and channel width stay in real meters, because the weather sim (04) works in real geography.
- **Islands are recognizable:** baked land areas are within ~5% of the published figures (Stockton 39.4 km² vs 40.7, Outer 31.2 vs 32.4, Oak 20.3 vs 20.6, Sand 11.5 vs 11.9, Madeline 58.2 vs 62.2), and every island's OpenStreetMap center point falls on its baked land. Preview: [`tools/geo/reports/apostles-relief.png`](../tools/geo/reports/apostles-relief.png).

### 14.3 Finding: 1:1 heights make the islands too steep to walk
Squeezing 8× sideways while keeping heights 1:1 makes every slope 8× steeper (S7 hit this too). With 1:1 heights, **35% of Oak Island** and 17% of Basswood are steeper than the 42° walk limit (11 §4). The pipeline now has a `landCurve` setting; water depth always stays 1:1.

| Land heights | Oak over 42° | Basswood | Devils | Madeline | Oak summit |
|---|---|---|---|---|---|
| 1:1 (old §8.2) | 35.5% | 16.6% | 10.7% | 7.4% | 148 m |
| Linear × 0.5 | 12.3% | 7.4% | 6.5% | 3.3% | 74 m |
| **Soft knee at 20 m** (proposed, baked) | **7.6%** | 8.1% | 8.6% | 4.0% | 43 m |

The soft knee (`h' = 20·ln(1 + h/20)`) keeps low ground near full height, so beaches, shore cliffs and sea caves still read right from the water, and flattens high ground the most. Lower land also shortens the lee. **Decision pending** (§13).

### 14.4 Not done (follow-ups)
- `zones.json` in `data/` (the zone config lives in `tools/geo/zones/` for now), `islands.json`, and the three mainland hideout pads, whose sites aren't placed yet (09).
- Hand-edit layer (step 7): set-piece footprints, 1900 harbor corrections, sea caves, Gull Island.
- Vegetation density and depth-band maps: both are cheap to derive from the height tiles at runtime or in a later bake, once the terrain shader exists (14).
- Chart data (step 9): the lake-wide grid the bake already builds is a starting point for S8.
- Shelter maps ignore trees; the DEM is bare earth. A flat +15 m canopy on forested land would lengthen the lee.

---

## Changelog
- v0.4: Spike S3 results (§14): pipeline in `tools/geo/`, chart projection instead of UTM, 16-bit delta + deflate tiles, lee in game meters, land height curve proposed (pending).
- v0.3: Gap review: separate island scene loads, 1 m tiles for all 22 islands, mainland hideout pads, three Wanted regions in the Apostles zone, S7/S8 in Phase 0, Siskiwit cut keeps its hideout reachable.
- v0.2: Decisions recorded: C = 8, 60-minute day, no chart escape when detected, shrunk freighters, lookout setting, slower on-foot clock (R_foot = 6 proposed).
- v0.1: Initial world-scale plan: compression model (C = 8), time/speed linkage (R = 24), 1:1 set-piece exceptions, MVP zones, chart mode, simulation-driven encounters, arenas, transitions, terrain pipeline, data model, spikes S3/S7/S8.
