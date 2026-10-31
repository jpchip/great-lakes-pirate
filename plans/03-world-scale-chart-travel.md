# 03 — World, Hybrid Scale, Chart Travel & Streaming

Status: DRAFT v0.7 (decisions made; gap review applied; S3 done; S7 done: C = 8, R = 24, R_foot = 6, freighters 0.85×)
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
- **On foot, the clock slows down (decided).** **R_foot = 6** (confirmed in S7) (1 real minute = 6 game minutes), so a 10-minute docks heist ≈ 1 game hour, and a full night (~6–9 game hours) gives ~60–90 real minutes of on-foot time. Plan 08 can still retune it.
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
- **Big freighters are shrunk (decided): 0.85× for big freighters** (S7; the allowed range was 0.75–1.0×). A 1:1 steel ore boat (~400 ft) is huge in a compressed bay. A slight shrink keeps encounters readable without looking wrong next to the schooner. Scale applies per ship class (`ships.json` → `displayScale`).

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
- **Zone edges** are soft: the water continues ~1 km past the authored area, fog thickens, and a "Take to the chart" prompt appears. There are no invisible walls except at the very edge. *Built in Phase 2 (§17):* the bake has no water past its edge, so its last 1 km plays that part; a "Zone edge" chip stands in for the chart prompt until Phase 3.

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
4. **Compress horizontally by C**: resample to the zone grid, where 1 m of game space = C m of real space. ~~Heights stay 1:1 (with an optional cliff exaggeration curve).~~ Land heights go through a configurable curve, because 1:1 heights make slopes C times steeper; water depth stays 1:1. Decided: a soft knee at 20 m (S3, §14.3).
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
- **Vegetation:** instanced stylized pines, birches and rocks from the density map, with distance-culled LOD and impostor billboards far away. Vegetation is the biggest draw-call and fill-rate risk on the iGPU, so the presets scale its density. **Built in Phase 2 (piece C, [14 §17](14-art-direction-asset-pipeline.md)):** the density map is derived from the height tiles at runtime (`src/sim/terrain/vegetation.ts`), each tile is planted in the terrain worker, near trees are three instanced draws and far trees one impostor draw per tile, and the style B terrain shader colors the ground from the same map. Medium's vegetation is at most 24 draw calls anywhere in the zone.
- **Collision:**
  - Ship vs. terrain: depth query (aground when depth < draft) plus a shoreline SDF for "push back" and damage.
  - On foot: heightmap ground plus prop primitives ([01 §2.2](01-tech-architecture.md)).
- **Phase 1 runtime (built for the test bay, 2026-10-25):** `src/sim/terrain/` loads one slice of a baked zone up front: its sailing tiles at 4 m, the SDF and the 16-direction wind maps cropped to it, and a 32 m backdrop of the whole zone so land past the slice still shows in the fog. `ZoneTerrain` answers `heightAt`, `depthAt`, `shoreDistanceAt`, `shoreNormalAt`, and `shelterAt` / `fetchAt` / `funnelAt` (two nearest directions blended, land cells ignored). `src/render/terrain/` draws one mesh per tile at the preset's stride (16 m Low, 8 m Medium, 4 m High) with skirts, skips cells more than 12 m deep, and colors by height and slope until the art style pick. The test bay is tiles 2–4 × 3–5 of the Apostles (Bayfield, the North Channel, Red Cliff, Basswood, Hermit and Madeline; [02 §14](02-arcade-sailing.md)), with a greybox Bayfield pier and two berths. Streaming and geomipmapping stay Phase 2 work.
- **Phase 2 runtime (whole zone, 2026-10-29; §17):** the loader reads every tile of the zone, so gameplay can query anywhere with no loading while sailing. Tile *meshes* stream: each tile within the preset's stream radius gets a geomipmapped mesh whose stride doubles with distance, built in a worker and cached, with skirts over the cracks; everything else is the 32 m backdrop, which leaves out the cells under drawn tiles. Medium draws at most 24 terrain meshes anywhere in the Apostles, against the 40 budget.

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
- `zones.json`: id, geo bounds, C, origin, tile manifest path, set pieces[], walkable islands[], entry points[], region mapping. *Built (§17):* id, name, world folder, C, center (the bake rounds it to the origin), the bake settings, the soft edge, the spawn, and set pieces with their footprints. Entry points come with chart travel (Phase 3) and the region mapping with plan 06.
- `setpieces.json`: id, zone, 1:1 footprint, placement, linked port and docks district.
- `islands.json`: id, name, zone, footprint, landing points, POIs (filled by plan 11). *Built (§17):* id, name, zone, center point, and the hand edits (Long Island's clip box, Gull Island's rock). The footprint the bake found is in the zone manifest; landings and POIs come with plan 11.
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
| **S8** | Chart mode prototype (new) | Is plotting plus a compressed voyage plus encounter interrupts fun and readable? | Chart with western Superior, course plotting, a time-compressed voyage, a fake encounter popping into an empty arena and back. **Built; results in §16.** |

S7 and S8 are **Phase 0** prototypes (decided 2026-10-22; [01 §11](01-tech-architecture.md)). S7 should follow S2 (water) and can reuse the S3 output. A flat-mask fallback is fine if S3 isn't done.

---

## 12. Cut List (if scope or performance demands)
1. Distant coastline silhouettes in arenas: use fog only.
2. Per-tile vegetation variety: one or two tree types.
3. Chart fog of war: show everything.
4. Siskiwit Bay zone: merge it into the chart as a point of interest with a small arena. If used, the logging-camp hideout pad stays reachable from that arena, so the site and the Lumberjack start survive.

---

## 13. Open Questions

All resolved. S7 settled the freighter scale (0.85×) and R_foot (6). S3 handles terrain steepness with the soft knee (§14.3).

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
| 2026-10-23 | Land heights use a **soft knee at 20 m** (`h' = 20·ln(1 + h/20)`), not 1:1, so compressed islands stay walkable; water depth stays 1:1 (S3, §14.3). |
| 2026-10-24 | Spike S7 confirmed by playtest: **C = 8**, **R = 24**, **R_foot = 6**, big freighters' `displayScale` **0.85** (§15). |

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
| **Soft knee at 20 m** (decided) | **7.6%** | 8.1% | 8.6% | 4.0% | 43 m |

The soft knee (`h' = 20·ln(1 + h/20)`) keeps low ground near full height, so beaches, shore cliffs and sea caves still read right from the water, and flattens high ground the most. Lower land also shortens the lee. **Decided 2026-10-23: soft knee at 20 m** (§13).

### 14.4 Not done (follow-ups)
- ~~`zones.json` in `data/` (the zone config lives in `tools/geo/zones/` for now), `islands.json`,~~ (done in Phase 2, §17) and the three mainland hideout pads, whose sites aren't placed yet (09).
- Hand-edit layer (step 7): ~~set-piece footprints~~, 1900 harbor corrections, sea caves, ~~Gull Island~~. Footprints and Gull Island are done (§17).
- ~~Vegetation density~~ (derived at runtime, Phase 2 piece C) and depth-band maps (the water's shore texture does the depth bands, [04 §22](04-water-weather-seasons.md)).
- Chart data (step 9): the lake-wide grid the bake already builds is a starting point for S8.
- ~~Shelter maps ignore trees; the DEM is bare earth. A flat +15 m canopy on forested land would lengthen the lee.~~ Done in Phase 2 piece C: the bake adds +15 m on forest from the density map, and `npm run geo:canopy` applied it to the published Apostles maps (shelter up in 16% of water cells; [14 §17](14-art-direction-asset-pipeline.md)).

---

## 15. Spike S7: Scale-Feel Greybox (results, 2026-10-23)

**Question** (§11): do C = 8, R = 24 and the freighter scale feel right? That covers visual speed, channel widths, island walk sizes and freighter scale.

**Answer: yes. Keep C = 8 and R = 24, with freighters at 0.85× and R_foot = 6.** The numbers below supported these values, and the dev confirmed them on the laptop on 2026-10-24 ("feels good, takes a bit of time to get places but not crazy"). The one problem found was the wave stutter while sailing, now fixed in plan 04 §19.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Page | `scale-greybox.html`, `src/debug/scale-greybox/` | Dev-only like the S5 page: `npm run dev`, then `/scale-greybox.html`. It isn't part of the production build. `?c=8&r=24&rfoot=6&freighter=0.85` set the starting values. |
| Geography | `geography.ts` | Hand-placed stand-in for S3: all 22 islands as ellipses and the mainland (Bayfield peninsula, Chequamegon Bay, south shore) as one polygon, from approximate public coordinates. The R1a legs come out close: Bayfield–La Pointe 2.3 nm (R1a: 2), Bayfield–Ashland 13.4 nm (13), Sand–Outer 21.8 nm (22). Coastline shapes are rough, so treat the channel widths below as indicative. |
| Terrain | `terrain.ts`, `scene.ts` | One 125 m grid in true-scale chart meters (457 × 497 samples), built once in about 0.4 s. Every C shares it: the mesh is scaled by 1/C horizontally, and the on-foot and grounding heightfield is the same heights with a cell of 125/C m. Heights stay 1:1 (§3.1). Ground too steep to walk at the current C (over 42°, plan 08 §19) is drawn red. |
| Helm | `helm.ts` | A stand-in for plan 02: the four sail levels on a steady beam reach (Full = 7.65 game kn for the T2 hull), 6 s inertia, a best turn rate of 6°/s that falls off at low speed, grounding at a 3 m draft, and sweeps astern to back off. The ship moves at v₃ᴅ = v × R / C. **Replaced in Phase 2 (2026-10-29):** the greybox now sails the T1 on the plan 02 controller and hazards in a steady test wind (`?wind=315&windkn=12`, a Wind folder, and the full sailing tuning panel), and `helm.ts` is gone. The legs readout uses the T1's beam-reach speed in that wind (6.6 kn in 12 kn), so Bayfield–Ashland reads about 5:03 real rather than 4:23. At C = 8 the bluff shores are steep enough that the hazards treat them as rock, not a shoal. |
| 1:1 references | `setpieces.ts`, `trees.ts`, `freighters.ts` | The S2 schooner (30 m), conifers 10–20 m tall within 1.4 km of the camera, five towns with piers (Ashland gets a 560 m ore dock), six 1900 lighthouses at their real heights, three 122 m ore boats steaming at 9 kn on two lanes, and the S5 capsule (1.75 m) on foot. |
| On foot | `main.ts` | **F** goes ashore at the nearest walkable shore and back aboard, with the S5 controller and camera and the clock at R_foot. |
| Dev panel | lil-gui | C from 4 to 12 (with 6/8/10 buttons), R, R_foot, freighter scale, hull speed, wind factor, turn rate, inertia, visibility, FOV, and teleports (channels, Chequamegon Bay, Outer Island, and ashore on Stockton, Oak, Madeline and Raspberry). |
| HUD | `main.ts` | Game speed and on-screen speed, turning circle, the channel width abeam (on screen and in real nm), distance and ETA to the nearest places, freighter size and distance, the R1a legs in real minutes, island size and walk times on foot, and a trip timer on **T** (real time, game time, distance). |
| Tests | `tests/scale-greybox.test.ts` | R1a distances, places near land, steamer lanes in deep water, one height grid for every C, v₃ᴅ, real time independent of C, grounding, freighter speed. |

### Results

**What C does and doesn't change.** Real travel time is chart distance / (v × R), so **C cancels out**: Bayfield to Ashland at Full takes 4:23 real at any C, and only R sets trip times. The ratio of a channel's width to the turning circle cancels C too, because both shrink by 1/C at a fixed R. So C doesn't make the helm harder. What C does change is how big the 1:1 things (ships, towns, trees, people) look against the land, how fast the water slides by, how long island walks take, and how steep the terrain gets (finding 1).

**Visual speed and turning (R = 24, best turn rate 6°/s)**

| C | Full (7.65 kn) on screen | Reefed (3.4 kn) on screen | Turning circle at Full | At Reefed |
|---|---|---|---|---|
| 6 | 15.7 m/s (31 visual kn) | 7.1 m/s | 324 m | 135 m |
| **8** | **11.8 m/s (23 visual kn)** | **5.3 m/s** | **243 m (8 ship lengths)** | **101 m** |
| 10 | 9.4 m/s (18 visual kn) | 4.3 m/s | 195 m | 81 m |

**Channel widths (narrowest water deeper than 3 m, greybox geography)**

| Channel | Real | C = 6 | **C = 8** | C = 10 |
|---|---|---|---|---|
| North Channel (Bayfield–Madeline) | 1.5 nm | 455 m | **341 m** | 273 m |
| Basswood–Red Cliff | 1.1 nm | 353 m | **265 m** | 212 m |
| Chequamegon Bay mouth | 2.8 nm | 853 m | **640 m** | 512 m |
| Manitou–Stockton | 2.2 nm | 677 m | **508 m** | 406 m |
| Rocky–South Twin | 1.0 nm | 320 m | **240 m** | 192 m |
| Bear–Devils | 0.5 nm | 147 m | **110 m** | 88 m |

At C = 8 the tightest gaps are still about 4 schooner lengths, and the channels the freighters use are 2.5 freighter lengths or more. At C = 10 the Bear–Devils gap (88 m) is shorter than a freighter.

**Island walks (end to end, S5 speeds: walk 2.4 m/s, run 5.2 m/s)**

| Island (real length) | C = 6 | **C = 8** | C = 10 |
|---|---|---|---|
| Madeline (22 km) | 3.7 km: 25 min walk | **2.8 km: 19 min walk, 9 min run** | 2.2 km: 15 min walk |
| Stockton (9.5 km) | 1.6 km: 11 min | **1.2 km: 8 min walk, 4 min run** | 950 m: 7 min |
| Oak (4.8 km) | 800 m: 6 min | **600 m: 4 min** | 480 m: 3 min |
| Sand (4.2 km) | 700 m: 5 min | **525 m: 3.6 min** | 420 m: 3 min |
| Raspberry (1.8 km) | 300 m: 2 min | **225 m: 1.6 min** | 180 m: 1.3 min |

At R_foot = 6, walking Stockton end to end is 49 game minutes, so a 10-minute visit is about an hour of game time, as §3.3 intends.

**R options at C = 8**

| R | Full on screen | Bayfield → Ashland | Day length |
|---|---|---|---|
| 18 | 8.9 m/s | 5.8 min | 80 min |
| 20 | 9.8 m/s | 5.3 min | 72 min |
| **24** | **11.8 m/s** | **4.4 min** | **60 min** |
| 30 | 14.8 m/s | 3.5 min | 48 min |

**Freighter scale.** At 0.85× a laker is 104 m, 3.5× the schooner. In the C = 8 North Channel (341 m) it takes up 30% of the width; at 1.0× (122 m) it's 36%, and at 0.75× (92 m) it starts to look stubby beside the schooner. **0.85 is the proposal**, and it's the value that most needs the eye test.

**Picked (confirmed in the feel check):** keep **C = 8** and **R = 24** (fall back to R = 20 before touching C, as §3.3 says), set big freighters' `displayScale` to **0.85**, and keep **R_foot = 6**. C = 6 makes Madeline a 25-minute walk and puts 1:1 ships in very roomy water; C = 10 shrinks small islands to one-minute walks, squeezes freighters out of the tighter gaps, and steepens terrain further.

### Findings for later work
1. **Terrain gets C times steeper.** Heights stay 1:1 over ground compressed by C, so a 5° real hillside becomes 35° at C = 8 and 41° at C = 10, close to the 42° walking limit. The greybox already shows red (unwalkable) patches inside Oak and Madeline at C = 8. S3 should handle it for the on-foot tiles, for example by keeping shore cliffs at full height but scaling relief above the bluff by about 0.5, or by capping slopes outside authored cliffs. That would amend §3.1 ("heights are not compressed"), so it's a decision for the dev.
2. **1:1 waterfronts swamp compressed bays.** Ashland's 560 m ore dock reaches about two-thirds of the way across the greybox bay (about 830 m at C = 8). This confirms §3.4: the Ashland set piece needs its local lens of uncompressed space.
3. **Water has to reach the zone's far side.** The S2 water disc ends 2.5 km out, but at C = 8 the Apostles zone is about 7 km across and islands 5 km away are clearly visible. The greybox lays a flat sheet under the disc; plan 04 should add a proper far-water LOD.
4. **Speed cues are missing.** The greybox has no wake, spray or sound, which plan 02 §7 relies on to make 23 visual knots feel natural, so judge speed knowing it may read slower here than in the game.
5. **Performance isn't measured.** The page draws about 1M triangles in about 25 calls, mostly trees, and was only run in headless SwiftShader. It isn't a budget test.

### Feel check on the dev laptop (done)
With `npm run dev` running, open `/scale-greybox.html`, then:
1. Sail Bayfield → La Pointe and around Madeline at C = 8, R = 24, timing with **T**. Does 12 m/s on screen feel brisk but readable? If it's too fast, try R = 20.
2. At "Sail: west of Oak" and "Sail: Raspberry–Oak", switch C between 6, 8 and 10. Which looks right for the channels and island sizes?
3. Go to "Sail: Chequamegon Bay" and sit beside a passing freighter at 0.75, 0.85 and 1.0.
4. "Ashore: Stockton", then walk or run end to end. Is R_foot = 6 right?
5. "Ashore: Oak (summit)" and walk down. Do the red slopes block too much?

Done on 2026-10-24: all four values confirmed, and the stutter fixed (plan 04 §19). Finding 1 (terrain steepness) was settled by S3 with the soft knee at 20 m (§14.3).

---

## 16. Prototype S8: Chart Mode (results, 2026-10-23)

**Question** (§11): is plotting plus a compressed voyage plus encounter interrupts fun and readable?

**Answer: yes, it reads clearly and it's fun.** The dev's playtest (2026-10-24) found it fun, with encounters coming up at a good rhythm. Every exit criterion works end to end: a western Superior chart, course plotting with land checks, a time-compressed voyage that keeps an honest clock, and encounters that drop into an open-water arena and back. The headless checks below cover readability and pacing. Two tuning changes came out of it: a **pacing guard** and a **6 nm daytime lookout range**.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Chart data | `data/chart.json`, `data/schemas/chart.ts` | Western Superior: the lake outline, 17 Apostle Islands, 10 ports, 10 lights as they stood in spring 1900 (Minnesota Point dark, Devils Island on its temporary light, no Split Rock), the four MVP zones, and the charted bounds. **Hand-traced by eye at about 1 km accuracy** until S3 step 9 bakes the real coastline. It is zod-validated like the other data files. |
| Geography | `src/sim/chart/geography.ts` | Projects the data to chart meters (equirectangular around 47° N, 91° W) and answers the land-mask questions: is this water, where does this leg first touch land (exact edge intersection, so thin spits count), and where does a leg enter a zone. |
| Voyage | `src/sim/chart/voyage.ts` | Plots a course from the ship through the waypoints, refuses legs that run aground, and **stops the sailed course where it enters the destination zone**, since the zone takes over there (§5.3 step 5). Speed comes from a point-of-sail table (fastest on a beam reach, upwind folds tacking into the made-good speed) and a wind-strength table, on a 7.5 kn schooner. |
| Traffic and encounters | `src/sim/chart/traffic.ts` | Eight abstract contacts on hand-placed lanes, each checked against the land mask in tests: two ore and grain freighters, a package steamer, two fishing tugs, the *Morrill*, a derelict scow and a drifting squall. The lookout check runs on each world tick: day 6 nm and night 3 nm, scaled by how conspicuous the contact is (smoke 1.3, a tug 0.8) and halved inside a squall. The cutter **forces** an encounter when it spots you first (you're 0.75 as conspicuous). Ships you've lost sight of stay on the chart as grey ghosts with their age and a "could be anywhere in here" circle. |
| Chart mode | `src/modes/chart.ts` | The `chart` mode. The clock holds while you plot. Under way it runs at **1 game hour per 2.5 real seconds**, the world ticks normally, and the wind drifts until S9's weather sim drives it. An encounter stops the clock until you choose, and the lookout setting filters what interrupts you. It emits `VoyageStarted`, `VoyageArrived`, `EncounterSpotted`, `EncounterEngaged` and `EncounterAvoided`. |
| Chart renderer | `src/render/chart/chart-view.ts` | A 2D canvas in the plan 13 period style: parchment grain, ink coastlines with shore shading, illustrative soundings in fathoms, a graticule, a compass rose, a scale bar, dashed zone edges, hatched "beyond your charts", and night shading with light-tier rings. Every contact type has its own shape (plan 13 §2.2). |
| Arena | `src/debug/chart-spike/arena*.ts` | An empty 3 × 3 km arena with the S2 water and sky at R = 24. The schooner was a kinematic stand-in (A/D steer, W/S trim, speed from the same wind model as the chart); since Phase 2 (2026-10-29) it is the T1 on the plan 02 controller and hazards in the chart's wind, arriving under full sail at the speed its heading gives. Box-built freighters and steamers, a listing hulk and a storm sea with 26 kn of wind and close fog stand in for the contacts. Hold F near a ship to deal with it. The cutter chases you, locks the chart while it's within 900 m, and ends the voyage if it gets alongside. Sail off the edge, or press M when nothing is chasing you, to go back to the chart. |
| Test page | `chart-spike.html`, `src/debug/chart-spike/` | Dev-only (`npm run dev`, then `/chart-spike.html`), not in the production build. Click to add waypoints (they snap to ports), drag to move them, right-click to delete, Shift-click to insert, drag empty chart to pan and use the wheel to zoom. Enter sets sail. There are also a lookout setting, a time-compression picker, departure points for each zone, a "show all traffic" toggle and an event log. `?hour=21` starts at night and `?seed=` reseeds the traffic. |

### Results
| Check | Result |
|---|---|
| Duluth → the Apostles zone edge (43 nm on the chart) | **About 21 real seconds** at the default compression, plus stops, which lands inside the 20–30 s target (§5.3). Two Harbors → Apostles takes 13 s and Duluth → Two Harbors 7 s. |
| Honest clock | Chart distance per real second equals speed × compression exactly (unit-tested). The ETA from the plotted course matches the sailed time whatever the step size. |
| Course checks | A leg across the Bayfield peninsula is refused with a red cross where it grounds. A course to the zone you're already in is refused ("sail there in 3D"). The final leg is cut at the zone edge and the rest is drawn faint. |
| Encounter pacing, first pass | Three to four interruptions per Duluth → Apostles crossing with the default lookout, well over the 0–2 target (§6.4). Every contact interrupts once per voyage, and the Duluth corridor has four prize ships on it. |
| Encounter pacing, tuned | A **pacing guard** (after a report, only a hostile can interrupt for 2 game hours) plus a **6 nm daytime range** (was 8) bring it to an average of **2.1–2.3** on the Apostles crossings, **1.3** to Siskiwit Bay and **0.7** to Two Harbors. Report everything gives 2.4–2.7 and threats only gives 1.0–1.3. That's 100 seeded runs per route at all hours and random winds, now in `tests/chart-pacing.test.ts`. |
| Cutter | It forces an encounter on **0.3 to 0.5 of Apostles crossings**, more often than before the guard, because the guard holds back the early sighting that would have let you avoid it. Night raises your odds of slipping it from about 45% to about 75%. In the arena, steam at 6.5 kn beats the schooner upwind and loses to it on a reach in a working breeze, so the point of sail decides the chase. |
| Readability | In the screenshots, ports, lights, zones, the course, the ship and each contact type read at the full-lake zoom. Encounter cards sit low so the contact stays visible. At night the chart darkens and the lights show their rings, and a running light makes a ship visible in the arena before its hull. |
| Cost | A full chart redraw takes **5.2 ms median and 8.1 ms p95 at 1920×1080** (headless Chromium, software canvas, cloud container). Replotting a course takes under 0.1 ms. **Re-check on the dev laptop**, where the canvas is GPU-backed. |

### Findings for later phases
1. **Pacing feels right (playtest, 2026-10-24).** Keep about 2 stops per Apostles run as the baseline. The knobs, if later content changes it, are `ENCOUNTER_QUIET_S`, `DAY_SPOT_NM`/`NIGHT_SPOT_NM`, each contact's conspicuity, and traffic density (plan 05).
2. **Pacing belongs to the encounter director, not just the lookouts.** Once-per-voyage plus a quiet spell works, but the right model is probably a per-voyage budget weighted by route traffic and season (§6.4). Plan 05's traffic slice should feed it.
3. **The cutter needs Wanted gating.** In the prototype it always hunts you. With plan 06 it should only force an encounter when your Wanted in that region is high enough, which also brings the forced rate down.
4. **"Steer clear" has no cost yet.** Avoiding a squall or a ship takes no extra time. A detour should cost time (and a squall avoided late could still clip you), or Avoid becomes the obvious choice.
5. **Zones the course passes through** (Siskiwit Bay on the way to the Apostles) don't stop you. That seems right for open-water transits, but it should be a decision: the alternative is that every zone edge you cross offers "enter the zone?".
6. **The chart clock holds while you plot.** It's simple and readable, but it means pulling up the chart mid-zone pauses the world. Plan 13 should decide whether the chart is a pause from a zone (M) and only a voyage runs time.
7. **The arena return point.** You come back to the chart where you left it, even after sailing 1.5 km of compressed space (12 km real). That's fine at chart scale, but say so in the plan.
8. **Chart data from S3** must keep the islands as separate rings and close the lake ring along the charted edge. Then `buildGeography` and the land checks work unchanged. Real soundings replace the illustrative ones.
9. **Rendering:** cache the coast, soundings and graticule in an offscreen layer while the view isn't moving, if the laptop shows the 5 ms redraw matters.
10. **Not built:** saving the voyage (`player.location`, `voyage`), shoals, fog of war, ice, rumor markers from plan 05, the real sailing controller and arena coastline silhouettes. The arena drops into the `sailing` mode as plan 01 intends, so the plan 02 controller slots in later.

---

## 17. Phase 2 Piece B: Whole-Zone Streaming (2026-10-29)

**Goal** (Phase 2 scope, piece B): sail the whole Apostles zone, Bayfield to Ashland and out to Outer Island, with no loading screen and no streaming hitch over 33 ms on Medium, in at most 40 terrain draw calls.

**Result:** built. The game now loads all 56 tiles and spawns in the North Channel as before; the whole map is sailable, terrain meshes stream around the camera, and fog closes in at the zone edge. The laptop load and hitch check is still to do (below).

### 17.1 What was built
| Piece | Where | Notes |
|---|---|---|
| Zone data | `data/zones.json`, `data/islands.json`, `data/schemas/zones.ts`, `islands.ts` | The bake config moved out of `tools/geo/zones/`. A zone has its world folder, C, center, bake settings, soft edge, spawn and set pieces; an island has its center point and optional hand edits. zod-validated with the other data files, plus cross-checks (every port, island and set piece points at a known zone or port). Ashland's port now names `zone.apostles`, as §4 has it. |
| Hand-edit layer | `tools/geo/lib/edits.ts` | Step 7 of §8.2, applied to the 1 m grid right after the merge, so the sailing tiles, SDF, wind maps and island tiles all agree. **Gull Island** is raised as a 40 × 24 m rock up to 6 m (it was below the land threshold), and now has land in its on-foot tile. **Long Island** keeps its clip box, now in `islands.json`. **Set-piece footprints** for Bayfield and Ashland: a rectangle anchored on the shore, facing the water, whose land is flattened to a ground height with a soft blend back to the real terrain; water is left alone. The manifest lists the edits and the report counts the samples each changed. |
| Whole-zone loader | `src/sim/terrain/load.ts` | Reads every tile, the full SDF and the full wind maps; `ZoneTerrain` covers the whole zone. 3.5 MB on the wire, about 50 MB decoded (4 m heights and SDF 15 MB each, wind maps 11 MB, the 8 m water grids 7 MB, the backdrop under 1 MB), plus a 15 MB copy of the heights in the tile worker. |
| LOD and streaming | `src/render/terrain/lod.ts`, `terrain-mesh.ts` | Each tile within the preset's stream radius gets its own mesh; its stride doubles every `terrainLodM` meters from the camera, with 64 m of hysteresis, and a tile whose stride would reach the backdrop's 32 m is left to the backdrop. Skirts hide the cracks between strides. The backdrop is one mesh whose index buffer holds each tile's cells as a run, so drawing a tile just drops its run. Meshes stay cached (40 tiles, least recently used out) so turning back is free. |
| Tile worker | `src/render/terrain/tile-worker.ts`, `tile-mesh.ts` | Tiles build off the main thread, nearest first, three in flight; at most two finished tiles go on screen per frame to spread the GPU uploads. The tiles around the spawn build on the main thread behind the load, so the first frame has no holes. Without workers (tests) tiles build on the main thread within a 4 ms budget. |
| Presets | `src/render/quality.ts` | Low: 16 m within 1.2 km. Medium: 8 m to 1 km, 16 m to 2 km. High: 4 m to 0.8 km, 8 m to 1.6 km, 16 m to 2.4 km. Past that, the backdrop. |
| Soft zone edge | `src/sim/terrain/zone-edge.ts`, `gameplay/sailing.ts`, `test-scene.ts`, `ui/hud/model.ts` | Over the last 1 km of the bake, visibility falls geometrically to 350 m; a "Zone edge" chip shows over the outer half; at the very edge (20 m in) the ship is held. Chart travel takes over there in Phase 3. |
| Dev tools | `src/debug/overlay.ts`, `src/main.ts`, `bench/stream/` | The overlay shows tiles by stride, tiles waiting, builds and the slowest build and update. `?spawn=x,z,heading` starts anywhere in the zone. `/bench/stream/` (and `npm run bench:stream` in Chromium) flies the schooner along the exit-criteria route and reports frame times, streaming time and hitches. |
| Tests | `tests/zone-streaming.test.ts`, `geo.test.ts`, `terrain.test.ts`, `data-validation.test.ts`, `hud.test.ts` | LOD and hysteresis, streaming and the backdrop on a synthetic zone, the draw-call budget on the real bake from every point of the zone, the soft edge, the hand edits, the whole-zone load, and the data cross-references. |

### 17.2 Results
**Draw calls.** Worst case anywhere in the zone, from a chase camera 15 m up, before frustum culling, counting the backdrop: **Low 13, Medium 24, High 30** (budget 40 on Medium). All-deep tiles draw nothing, which is most of the open lake. The full scene at the spawn on Medium is 34 calls and 163k triangles with the water, ship and sky.

**Streaming cost** (`npm run bench:stream`, Medium, flying the route at 8× Full sail, about 94 m/s, in headless Chromium on the cloud box):

| Measure | Result |
|---|---|
| Zone load (fetch and decode) | 0.7–1.1 s |
| Scene build (backdrop and the spawn's tiles) | 0.3–0.4 s |
| Main-thread streaming per frame | p50 0.1 ms, p99 0.8 ms, **max 6 ms** |
| Tile build in the worker | 2.3 ms for an 8 m tile and 15 ms for a 4 m (High) tile uncontended; up to 23 ms here, sharing the CPU with SwiftShader |
| Tile meshes built over the route | 104 |
| Most terrain draw calls on the route | 23 |

Before the worker, building on the main thread cost up to 18 ms in one frame on this box. Headless Chromium renders with SwiftShader on the CPU, so its frame times (about 200 ms) say nothing about the laptop.

### 17.3 Decisions made in the piece
- **Tile data is all resident; meshes stream.** The whole zone's data is 3.5 MB on the wire and the backdrop needs every tile anyway, so streaming the files by distance would save nothing. Gameplay gets the whole map at once (grounding, wind, the HUD's depth), and the loading cost that matters, mesh building, is what streams.
- **Geomipmapping with skirts, not CDLOD.** One mesh per 1 km tile at one stride keeps draw calls low and fits the cached, worker-built approach; skirts were already in place. CDLOD's morphing would hide the pop between strides, which may matter once the terrain shader lands (piece C).
- **The bake's last kilometer is the soft edge.** The baked terrain ends at the zone edge, so the fog fade runs inside it rather than past it.
- **Set-piece footprints live in `zones.json`.** Piece G builds on them; the numbers (Bayfield 360 × 120 m flattened to 1.8 m, Ashland 640 × 160 m to 2.5 m, with 200 m and 600 m of water in front) are first guesses for piece G to adjust and rebake. The flattening cuts into the bluff behind Bayfield's waterfront, which is how the real town sits.
- **Gull Island is 40 × 24 m game** (320 × 190 m real), a little bigger than the real rock, so it reads from the water and has a walkable top.

### 17.4 Still to do
- ~~**Laptop load and hitch check (Jared)**~~ **Passed 2026-10-29** on the baseline laptop (`/bench/stream/`, Medium, 8× Full sail): zone load 0.33 s and scene build 0.12 s; frame time p50 16.7 ms, p95 16.8 ms, max 16.8 ms over 6,493 frames, **no frame over 33 ms**; main-thread streaming p99 0.3 ms, max 1.2 ms; 104 tiles built, the slowest 12.5 ms in the worker; at most 23 terrain draw calls.
- A "Take to the chart" prompt at the edge (Phase 3, with chart travel) and entry points in `zones.json`.
- The Wanted region mapping in `zones.json` (plan 06).
- The other four set pieces in the Apostles (Washburn, La Pointe, Red Cliff, Bad River) get footprints when they're built (Phase 4).

## 18. Phase 2 Piece G: Harbors (2026-10-30)

Bayfield and Ashland built as 1:1 set pieces on the §17 footprints. Exit criterion met: the T1 docks at every pier in both towns (`tests/harbors.test.ts`, on the real zone through the plan 02 hazards).

### 18.1 What was built
- **`data/harbors.json`** (schema `data/schemas/harbors.ts`): per harbor, its set piece, piers (kind, position along and inland of the footprint anchor, optional bearing, length, width, deck height), named buildings, and a seeded town (house count, area, highest ground). Positions are in the footprint's own frame, so moving a footprint moves its town.
- **`src/sim/harbors.ts`:** pure, deterministic layout. Each pier walks out from its inland start to the waterline and bites 6 m into the bank, so it meets the shore wherever the bake put it. Buildings sit on the highest ground under their corners with a foundation down to the lowest; houses only go on dry, fairly level ground, clear of each other and of the pier roots. The placed piers are plan 02 `Dock`s: the berths you auto-dock at and the footprints you can hit are the piers you see. `harborClearings` keeps trees off the buildings and pier roots.
- **Meshes** (`src/render/harbors/`, shared box, gable and frustum parts moved to `render/style/parts.ts`): plank piers on piles down to the bottom with bollards, fish houses and lumber piles; Bayfield's fish packing house with cupola, cooperage, fish sheds, warehouses, false-front store, depot, sawmill with stack, sawdust burner and log ladder, and church; Ashland's ore dock (pocket body on bents, rails, an approach trestle climbing from the land, chutes on both sides), sawmill, freight house, depot, hotel and stores; and the houses. Windows are split into dark glass and lit panes; the lit panes glow amber with the lighthouse `lampLevel` from dusk. Both towns are four draw calls (a body and a window mesh each), no outlines.
- **`?harbor=bayfield`** (or `ashland`, and `,1` / `,2` for the other piers) starts the ship 120 m off a pier's end, bow toward it. The greybox test-bay pier mesh is deleted; the greybox `TEST_BAY` dock is only used without the zone.

### 18.2 Decisions made in the piece
- **The Ashland "lens" is the open water, not a rebake.** The Soo Line ore dock is 1:1 (520 m deck plus a 140 m approach) on bearing 10°, out into the kilometer of bay the §17 footprint left in front of the town. That keeps it at 1:1 without carving a locally uncompressed region into the terrain. If it crowds the bay once freighters are in (Phase 4), the real lens is a GDAL rebake that widens the bay locally.
- **Piers carry their own bearings.** Ashland's footprint bearing doesn't match the shore that faces the ore dock, so its piers set theirs and the houses are filtered onto dry ground rather than laid out on the footprint grid.
- **Bayfield's mill end moved inland.** East of the city dock the shore recedes 60–80 m from the footprint's line, so the mill dock, sawmill and lumber shed start further back.

### 18.3 Still to do
- Ashland's water off the city and lumber docks is 3–6 m deep, enough for the T1 (draft about 2 m) but not for the bigger classes. Check the T2/T3 drafts when they're built.
- Docks district transitions ("Go ashore") come with plan 11.

## 19. Phase 2 Exit Criteria and Playtest (2026-10-31)

Phase 2 (the Superior Slice) is pieces A–I of the Phase 2 scope doc: water budget (04 §23), whole-zone streaming (§17), terrain look (14 §17), weather v1 (04 §24), sky and atmosphere (04 §25), lighthouses (14 §18), harbors (§18), weather and harbor audio (15 §14) and the helm swap (§15–16). No plan had Phase 2 acceptance criteria, so the scope doc proposed these; piece J checks them, and Phase 2 is done when they pass on the baseline laptop and Jared signs off the playtest.

| # | Criterion | How it's checked |
|---|---|---|
| 1 | Sail from Bayfield to Ashland and out to Outer Island without a loading screen, with no streaming hitch over 33 ms on Medium | `/bench/stream/` on the laptop (passed at piece B, §17.4; rerun with trees, harbors and lights) |
| 2 | The zone loads in 8 s or less on a warm cache (01 §5) | The same bench's zone load time, and a reload of the game |
| 3 | The main islands, Bayfield and Chequamegon Bay are recognizable from the water by their shapes | Jared, by eye |
| 4 | Over a game week the weather changes on its own, and the barometer falls before a gale arrives | `?timewarp=60` from late October; the sim's own check is 04 §24 (a 3 hPa fall in 3 game hours before 87% of storms) |
| 5 | A fog bank can be seen coming across the water on Medium, and visibility drops inside it | `?fogbank=<km>`, then sailing into it |
| 6 | At night every lighthouse shows its 1900 characteristic | `?light=<name>&hour=23` for each; `tests/lighthouses.test.ts` |
| 7 | Docking works at Bayfield and at Ashland | `?harbor=` for each pier; `tests/harbors.test.ts` docks at every pier on the real zone |
| 8 | Save and reload keeps the time, date and weather, and a Phase 1 save migrates | Dev panel Save and reload; `tests/save-migrations.test.ts` with the v1 fixture |
| 9 | Full zone with terrain and trees: Medium p95 frame at most 16.7 ms, water at most 3 ms, at most 150 draw calls; Low never below 30 fps | `?bench=water` on Medium and Low on the laptop |
| 10 | The S7 greybox and S8 arena use the plan 02 controller | Done in the helm swap (§15–16); the stand-in helms are deleted |
| 11 | It feels like the Apostles | Jared decides |
| 12 | Plans 03, 04, 14 and 15 record what was built, CI is green, and 0.2.0 is tagged | §17–19, 04 §23–25, 14 §17–18, 15 §14; the release PR |

**Added for the playtest:** `?timewarp=<n>` (and Clock speed in the dev panel's Time folder) runs the game clock and the weather up to 120× faster without changing the ship's speed, so criterion 4 takes minutes instead of seven real hours.

### 19.1 Results

Filled in from the playtest.

---

## Changelog
- v0.13: Phase 2 exit criteria and playtest (§19), and `?timewarp=` for the week-of-weather check.
- v0.12: Phase 2 piece G: Bayfield and Ashland harbors (§18), the Ashland ore dock at 1:1 in open water in place of a rebaked lens.
- v0.11: Phase 2 piece C: vegetation density and planting built (§8.3), and the canopy in the shelter maps (§14.4); details in [14 §17](14-art-direction-asset-pipeline.md).
- v0.10: Phase 2 helm swap: the S7 greybox and the S8 arena sail on the plan 02 controller; the stand-in helms are deleted (§15, §16).
- v0.9: Phase 2 piece B (§17): the whole Apostles zone loaded, terrain meshes streamed with geomipmapped LOD in a worker, soft zone edges, `zones.json` and `islands.json` in `data/`, and the hand-edit layer (Gull Island, Long Island's clip, set-piece footprints).
- v0.8: Phase 1 runtime terrain for the test bay (§8.3): slice loader, terrain queries, tile meshes with a whole-zone backdrop.
- v0.7: Restored the S7 write-up (§15: what was built, the speed, channel, walk and R tables, findings, feel check), which a merge had dropped; S8 renumbered to §16.
- v0.5: Prototype S8 written up (§14) and playtested as fun: chart mode with plotting, compressed voyages and encounter arenas works; pacing guard and 6 nm day lookout range added.
- v0.4: Spike S3 results (§14): pipeline in `tools/geo/`, chart projection instead of UTM, 16-bit delta + deflate tiles, lee in game meters, land height curve (soft knee at 20 m, decided).
- v0.3: Gap review: separate island scene loads, 1 m tiles for all 22 islands, mainland hideout pads, three Wanted regions in the Apostles zone, S7/S8 in Phase 0, Siskiwit cut keeps its hideout reachable.
- v0.2: Decisions recorded: C = 8, 60-minute day, no chart escape when detected, shrunk freighters, lookout setting, slower on-foot clock (R_foot = 6 proposed).
- v0.1: Initial world-scale plan: compression model (C = 8), time/speed linkage (R = 24), 1:1 set-piece exceptions, MVP zones, chart mode, simulation-driven encounters, arenas, transitions, terrain pipeline, data model, spikes S3/S7/S8.
