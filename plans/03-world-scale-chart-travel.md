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
9. **Chart data:** a simplified coastline polygon set and depth shading for the whole lake (low resolution) for chart mode and arena silhouettes. *Built in Phase 3 (§22): `npm run geo:chart` writes `data/chart-coast.json`.*

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
- `zones.json`: id, geo bounds, C, origin, tile manifest path, set pieces[], walkable islands[], entry points[], region mapping. *Built (§17):* id, name, world folder, C, center (the bake rounds it to the origin), the bake settings, the soft edge, the spawn, and set pieces with their footprints. Entry points came with Phase 3 piece A (§21); the region mapping comes with plan 06.
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
| 2026-10-31 | Phase 3: the Twin Ports and Two Harbors get **dockable harbors** (the Duluth canal and Superior Entry at 1:1, piers with berths, the 1900 lights, town silhouettes); full waterfronts come with Phase 4 (§20.6). |

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
- ~~Chart data (step 9): the lake-wide grid the bake already builds is a starting point for S8.~~ Done in Phase 3 (§22).
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
| Chart data | `data/chart.json`, `data/schemas/chart.ts` | Western Superior: the lake outline, 17 Apostle Islands, 10 ports, 10 lights as they stood in spring 1900 (Minnesota Point dark, Devils Island on its temporary light, no Split Rock), the four MVP zones, and the charted bounds. **Hand-traced by eye at about 1 km accuracy** until S3 step 9 bakes the real coastline (done in Phase 3, §22: the outline and islands are now baked). It is zod-validated like the other data files. |
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
8. **Chart data from S3** must keep the islands as separate rings and close the lake ring along the charted edge. Then `buildGeography` and the land checks work unchanged. Real soundings replace the illustrative ones. *Done in Phase 3 (§22).*
9. **Rendering:** cache the coast, soundings and graticule in an offscreen layer while the view isn't moving, if the laptop shows the 5 ms redraw matters. *Done in Phase 3 (§22).*
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

**Passed 2026-10-31**, signed off by Jared on the baseline laptop (Ryzen 7 7730U, Radeon renoir, Chrome 156 on Linux, ANGLE OpenGL, MSAA off). Every criterion was ticked.

| # | Result |
|---|---|
| 1 | `/bench/stream/` on Medium at 8× Full sail: 6,493 frames, p50 16.7 ms, p95 16.8 ms, max 16.8 ms (vsync), **no frame over 33 ms**; main-thread streaming p99 0.2 ms, max 1.1 ms; 105 tiles built, the slowest 9.6 ms in the worker; at most 23 terrain draw calls. |
| 2 | Zone load 0.31 s and scene build 0.27 s, far under 8 s. |
| 3, 11 | Recognizable, and it feels like the Apostles (Jared). |
| 4 | Weather changed on its own over a week at `?timewarp=60`, with the barometer falling ahead of blows. |
| 5 | Checked after `?fogbank` was fixed to stand the bank upwind so the wind brings it in (it had stood dead ahead and drifted away downwind). |
| 6–8 | Lights, docking at all six piers, save and reload: pass. |
| 9 | `?bench=water` (mean ms per frame over the bench; two runs): Medium 5.7–6.1 ms a frame, **water 1.7–2.4 ms**, 55–56 draw calls, 213k triangles; Low 3.2–3.4 ms (far above 30 fps); High 6.6–6.8 ms. Terrain is 0.6–1.0 ms and vegetation 0.7–1.1 ms on Medium. Bayfield at night and a thunderstorm stayed in budget with no hitches. |
| 10 | Done in the helm swap. |
| 12 | Plans updated, CI green; 0.2.0 tagged on the merge. |

## 20. Phase 3 Scope: Hybrid Travel (2026-10-31)

Phase 3 is the **Hybrid Travel** build (version 0.3.0), with one goal from the [00 §7](00-master-plan.md) roadmap: **"big-world feel."** It takes the S8 chart prototype (§16) into the game, adds the Twin Ports and Two Harbors zones, and fills the open water between them with traffic and weather you meet in open-water arenas. The scope comes from the Phase 3 row in the master plan and the Phase 3 rows in plans 04 §15 (weather on the chart), 13 §12 (chart mode, encounter popups, lookout setting), 15 §11 (chart music, steam whistles, encounter stingers) and 16 §12 (voyage slice, autosave triggers, migrations), plus the S8 findings (§16) and the Phase 2 leftovers (§17.4).

This section is the scope proposal. Like Phase 2's, its exit criteria (§20.3) become the phase's acceptance checklist once Jared approves them, and piece K checks them.

### 20.1 What Phase 2 changes or puts at risk

| Finding | Source | Effect on Phase 3 |
|---|---|---|
| The game is hard-wired to one zone: `main.ts` loads the Apostles at boot and spawns in the North Channel every time | `src/main.ts` | Piece A turns zone loading into a load and unload by id, with the ship placed at an entry point or its saved pose. Everything else in the phase sits on it. |
| The player's position isn't saved: `WorldState.player` is still an empty object, so a reload always starts at the spawn | `src/sim/world-state.ts`, 16 §5 | Piece A adds `player.location` and the ship's pose (save v3, migrated from v2). Piece D adds the `voyage` slice. |
| One zone decoded is about 50 MB, plus a 15 MB copy in the tile worker; the heap budget is 300 MB | §17.1, 01 §5 | One zone is resident at a time. The last zone stays cached briefly for a quick turn back (§7), then is freed. A round-trip test checks the memory comes back. |
| The chart's coastline is hand-traced to about 1 km | §16, finding 8 | Fine on the chart, but zone entry points must meet the baked zone edges. Piece B bakes the chart from the same sources as the zones (§8.2 step 9). |
| The weather sim already runs in chart coordinates across the whole lake | `src/sim/weather/local-weather.ts`, 04 §24 | Weather on the chart is wiring, not a new sim. The chart's drifting stand-in wind goes away, and the chart and the zones share one sky. |
| The Duluth Ship Canal is about 11 m wide at C = 8, and Superior Entry is no better | §3.4 | The schooner can't get into the Twin Ports without 1:1 set pieces at both entries. That is the riskiest work in the phase (piece I). |
| Traffic is eight hand-placed contacts, and the cutter always hunts you | §16, findings 2–3 | Piece F puts traffic on a route graph and an encounter director. With no Wanted until Phase 5, the cutter is sighted but doesn't force encounters. |
| NPC ship art is planned for Phases 4–6, and the S8 arena uses box stand-ins | 14 §13 | Piece H brings a first set of NPC hulls forward through the procedural hull generator (14 §5), since every encounter needs them. |
| Trading, Wanted and combat arrive in Phases 4–6 | 00 §7 | A Phase 3 encounter is meeting and watching, not robbing. The arena still has to be worth dropping into: real ships on their courses, weather, the cutter's chase. Engage on a ship is "close and look" until Phase 6. |
| Avoiding costs nothing, and zones on the course don't stop you | §16, findings 4–5 | Piece F makes a detour cost time. Zones you pass through stay pass-through (§20.5). |

### 20.2 What Phase 3 delivers

Sail out of the Apostles onto the chart, plot a course to Duluth, Superior or Two Harbors, meet ships and weather on the way, and arrive in a 3D zone you can dock in, with the run saved wherever you stop.

| Area | Deliverable | Plan |
|---|---|---|
| Zones | The Twin Ports and Two Harbors baked through the geo pipeline, loaded and unloaded by id, with entry points on their edges | §4, §8, §9 |
| Chart in the game | The `chart` mode from S8 in the game: "Take to the chart" at the soft edge, M in open water, plotting, the honest clock, the encounter card, the lookout setting, the pursuit lock, and arrival into a zone | §5, §7, 13 §4.3 |
| Real chart | Coastline, islands and soundings baked from NOAA and USGS for the whole western lake; a cached static layer | §8.2 step 9, 13 §8.1 |
| Weather on the chart | Fronts, fog banks and storm cells from the S9 sim drawn on the chart, wind from the sim, a forecast with uncertainty, and weather encounters from the sim | 04 §15 |
| Traffic | `routes.json` (ports, zone entries, lanes with seasonal weights), abstract ships on it, and an encounter director with a per-voyage budget | §6, 01 §3.4 |
| Arenas | Open-water arenas in the game: the sim's weather at that point, ships materialized from traffic, the coastline in view, back to the chart at the edge | §6.3 |
| NPC ships | Steam ore freighter, schooner-barge, package steamer, fishing tug and the revenue cutter *Morrill*, from the hull generator, with smoke and running lights | 14 §5, §3.5 |
| Harbors | Duluth Ship Canal and Superior Entry at 1:1, berths at Duluth, Superior and Two Harbors, and their 1900 lights (dockable harbors, decided 2026-10-31, §20.6) | §3.4, R1a |
| Saves | Location and voyage saved, autosave on zone and chart transitions, a v2 save migrates | 16 §4.1, §12 |
| Audio | Chart music, steam whistles you can hear in fog, encounter stingers | 15 §11 |

**Out of scope:** markets, cargo and manifests on the traffic (Phase 4), the cutter hunting by Wanted, region heat on the chart and rumor markers (Phases 4–5), weapons and boarding (Phase 6), going ashore (Phase 7), fog of war on the chart (it needs discoveries, Phase 9; cut list #3), ice on the chart (Phase 9), the Siskiwit Bay zone (§20.6), and the four remaining Apostles set pieces (Phase 4).

### 20.3 Exit criteria (proposed)

Phase 3 is done when these pass on the baseline laptop and Jared signs off the playtest. The last three come from plan 17's definition of done (17 §11).

| # | Criterion | How it's checked |
|---|---|---|
| 1 | Sail from Bayfield out of the Apostles, plot a course on the chart and arrive in the Twin Ports, enter through the Duluth Ship Canal and dock at Duluth; then cross to Superior through the harbor and leave by Superior Entry; then reach Two Harbors and dock there | A playtest route; tests dock at every new pier on the real zones, as `tests/harbors.test.ts` does for Phase 2 |
| 2 | Duluth to the Apostles edge takes 20–30 real seconds at the default compression, plus stops, and the ETA matches the time sailed | `tests/chart.test.ts` on the real chart and routes |
| 3 | Chart to zone loads in 8 s or less on a warm cache, chart to arena in 2 s or less, and arena to chart is instant (§7) | A transition bench on the laptop |
| 4 | About 2 meaningful encounters on an Apostles crossing with the default lookout (the S8 baseline), fewer on short hops, more in fall than in spring | `tests/chart-pacing.test.ts` rerun on the route-graph traffic, seeded, per route and season |
| 5 | Every encounter kind can be met in an arena: each NPC ship class, the cutter, a derelict, a squall and a fog bank. Ships sail their courses, and sailing off the edge resumes the voyage | `?encounter=<kind>` for each, then sailing out |
| 6 | One weather everywhere: the chart's wind is the sim's, and a fog bank or storm seen on the chart arrives in the zone or arena where it shows | Plot into a charted fog bank and sail into it; a unit test compares chart and zone wind at the same point and time |
| 7 | The chart is locked while a hostile has you detected inside its threat radius, with the banner showing | `?cutter=hunt` (dev only until Phase 5) |
| 8 | Save and reload keeps the zone, the ship's pose, and the voyage's progress, and a 0.2.0 save migrates | Dev panel Save and reload in each zone and mid-voyage; `tests/save-migrations.test.ts` with a v2 fixture |
| 9 | Each new zone and the arena meet the Phase 2 numbers: Medium p95 frame at most 16.7 ms, water at most 3 ms, at most 150 draw calls; Low never below 30 fps. The chart redraws in at most 8 ms p95. A round trip to another zone and back leaves the heap within 20 MB of where it started | `/bench/stream/` and `?bench=water` per zone, a chart bench, and the heap in the dev overlay |
| 10 | The Twin Ports read as Duluth and Superior from the water (Minnesota Point, the canal, the two entries, St. Louis Bay), and Two Harbors by its ore docks and light | Jared, by eye |
| 11 | It feels big: a voyage takes planning, and the lake has moods | Jared decides |
| 12 | Plans 03, 04, 13, 15 and 16 record what was built, CI is green, and 0.3.0 is tagged | The release PR |

### 20.4 Work pieces

Eleven pieces, each sized to be one thread. Four can start at once (A, B, C, H). The playtest (K) closes the phase.

| Stage | Pieces |
|---|---|
| 1, start now | A zones and location, B real chart, C new zone bakes, H NPC ships |
| 2 | D chart in the game (after A), I harbors (after C) |
| 3 | E weather on the chart, F traffic (both after D) |
| 4 | G arenas (after D, F, H), J audio (after D, H) |
| 5 | K playtest |

| # | Piece | Scope | Needs first | Needs Jared |
|---|---|---|---|---|
| A | Zones by id and location in the save | Turn the boot-time Apostles load in `main.ts` into a zone manager that loads and unloads a zone by id behind a period loading screen, keeping the last zone cached briefly. Entry points in `zones.json`. `player.location` (`{mode, zoneId, chartPos}`) and the ship's pose in `WorldState`, save v3 with a migration from v2 (a v2 save starts at the Apostles spawn). Continue puts you back where you saved. Autosave on transitions (16 §4.1). A memory round-trip test | — | — |
| B | Real chart from the bake | §8.2 step 9: a lake-wide coastline polygon set (islands as separate rings, the lake ring closed along the charted edge), depth shading and real soundings from NOAA bathymetry, replacing the hand-traced `chart.json` geometry so `buildGeography` and the land checks work unchanged (§16, finding 8). Zone outlines on the chart from the baked zone bounds. Cache the coast, soundings and graticule in an offscreen layer while the view is still (finding 9) | — | Chart redraw time on the laptop |
| C | Bake the Twin Ports and Two Harbors | `zone.twin_ports` and `zone.two_harbors` in `zones.json` and through `tools/geo/build.ts`, with set-piece footprints for the Duluth canal, Superior Entry, the Duluth and Superior waterfronts and Agate Bay. Bake reports. Check Minnesota and Wisconsin Points and St. Louis Bay read at C = 8, and that the soft-knee land curve suits the North Shore's bluffs. The spawn, edge and draw-call tests run per zone | — | Recognizability by eye |
| D | Chart mode in the game | Bring `src/modes/chart.ts` into the game's mode machine with its HUD in Preact (13 §4.3): "Take to the chart" at the soft edge (replacing the Zone edge chip), M from open water, no chart from inside a harbor set piece, plotting, ETA, the lookout setting in settings, the encounter card, and the "chart locked" banner. Arrival loads the destination zone at the matching entry point. The `voyage` slice in the save. Retire `chart-spike.html` once the game covers it | A | Plotting feel |
| E | Weather on the chart | The S9 sim drives the chart's wind (the drifting stand-in goes). Fronts, fog banks and storm cells drawn on the chart. A forecast with uncertainty from the barometer and the systems' tracks (04 §15). Squalls and fog banks met on the chart come from the sim, not hand-placed contacts, and slow or hide you as they do in the zone | D | — |
| F | Traffic on the route graph | `data/routes.json` (ports, zone entries, waypoints, lanes with seasonal weights) with a schema and land-mask checks. Abstract ships on lanes as `{leg, progress}` on the world tick (01 §3.4), without manifests (those are Phase 4's). An encounter director with a per-voyage budget by route and season (finding 2). Avoiding costs time on a detour (finding 4). The *Morrill* patrols and can be sighted, but forces nothing until Phase 5 gates it by Wanted (finding 3); a dev flag turns hunting on for criterion 7. Derelicts as static points of interest | D (can start against the spike) | — |
| G | Open-water arenas in the game | The arena as the sailing mode with no terrain tiles: the sim's weather, sky and time at the encounter point, the ships materialized from traffic on their lanes' headings with simple steering and collision avoidance, the coastline in view as low silhouettes from the chart (cut list #1 if it costs too much), the pursuit lock within the threat radius, and back to the chart at the edge (finding 7). `?encounter=<kind>` for checks | D, F, H | Arena feel |
| H | NPC ships v0 | Hulls from the procedural generator (14 §5) for a steam ore freighter (`displayScale` 0.85), a schooner-barge, a package steamer, a fishing tug and the cutter *Morrill*, in style B with outlines. Funnel smoke, running lights at night, wakes. `ships.json` entries with draft, speed and conspicuity. A draw-call budget for five ships in an arena | — | Look sign-off |
| I | Twin Ports and Two Harbors harbors | Dockable harbors (decided 2026-10-31, §20.6): the Duluth Ship Canal and Superior Entry as 1:1 set pieces you can sail through, piers with berths at Duluth, Superior and Two Harbors (Two Harbors' wooden ore docks at 1:1), and the 1900 lights into `lighthouses.json` (the Duluth South Breakwater temporary light, the Superior Entry pierhead light, Two Harbors Light, and Minnesota Point standing dark). Town silhouettes with lit windows from the Phase 2 kit | C | — |
| J | Chart and encounter audio | Chart music, steam whistles for NPC ships (and the cutter's own) that carry in fog, encounter stingers, and the loading-screen transition sound. Every file in `CREDITS.md` | D, H | Listen by ear |
| K | Phase 3 playtest | The §20.3 scenarios, the benches on each zone, the arena and the chart, plans updated, tag 0.3.0 | All | Playtest, sign-off |

### 20.5 Smaller calls assumed (Jared can override)

- **M in a zone opens the chart as a look, not a voyage** (finding 6). The world pauses while you read it in a zone; time runs on the chart only under way.
- **Zones on the course are pass-through** (finding 5). A course stops at a zone only when that zone is its destination.
- **The arena returns you where you left the chart** (finding 7), whatever you sailed inside it.
- **The cutter is sighted but never forces an encounter** until Phase 5's Wanted, so Phase 3 has no unwinnable chases.
- **NPC ships are visual and on their courses only.** Hails, cargo and surrender wait for Phases 4 and 6.
- **No fog of war yet.** The whole western lake is charted until discoveries exist (Phase 9).
- **Siskiwit Bay stays a chart area you pass through.** Its zone is baked with its hideout pad in Phase 8, when the logging-camp hideout needs it; cut list #4 stays available.

### 20.6 Decisions for Jared

1. **How much harbor do the new zones get in Phase 3?** **Decided 2026-10-31: dockable harbors.** The canal and Superior Entry are needed just to get into the Twin Ports (§3.4), so some set piece work is unavoidable.
   - **Dockable harbors (recommended):** the canal and Superior Entry at 1:1, a few piers with berths at Duluth, Superior and Two Harbors, the 1900 lights, and town silhouettes. Full waterfront dressing comes when Phase 4 trading needs it.
   - **Full set pieces like Bayfield and Ashland:** the zones are finished in one pass, but piece I roughly doubles, and Duluth would be the biggest set piece in the game.
   - **Terrain and entries only:** you can sail in but not dock outside the Apostles until Phase 4. The smallest Phase 3, and criterion 1 becomes "arrive in the zone".

### 20.7 Housekeeping found along the way

- The 0.2.0 tag is on GitHub, on the release merge (`51dbedf`), so nothing is left to push for it.
- The master plan's §11 Next Steps still lists Phase 0 work.
- Plan 17 wants a tracking issue per phase with the acceptance checklist. The §20.3 table can become that issue once approved.

## 21. Phase 3 Piece A: Zones by Id and the Saved Location (2026-10-31)

**Goal** (§20.4, piece A): load and unload a zone by id behind a period loading screen, keeping the last zone cached briefly; entry points in `zones.json`; the player's location and the ship's pose in the save, so Continue goes back where you were.

**Result:** built. The game no longer always starts at the North Channel spawn: a reload puts the ship back where the last save left it. Zones load by id through a zone manager, and a zone change fades to fog, swaps the zone out of sight, and saves on the way out and on arrival. The chart (piece D) is what will call it; until then the dev panel and the console do.

### 21.1 What was built
| Piece | Where | Notes |
|---|---|---|
| Entry points | `data/zones.json` `entries`, `data/schemas/zones.ts`, `src/sim/terrain/zones.ts` | Each has an id, a name, what lies off that edge (`toward`), a point in zone meters and a heading in. The Apostles have three, about 600 m inside the open-water edges: **west** (north of Sand Island, toward Duluth), **north** (north of Bear Island, toward Two Harbors) and **east** (south of Michigan Island, toward the Keweenaw); the south edge is land. `nearestEntry` picks the one nearest a chart point, for piece D's arrivals. A test checks each sits in the fog fade but short of the "Zone edge" chip, faces into the zone, and has 1.5 km of water at least 6 m deep ahead. |
| Zone manager | `src/sim/terrain/zone-manager.ts` | `enter(id)` loads a zone's files by id, or takes it from the cache. One zone is resident at a time: `leave()` keeps the last one for 60 s (`ZONE_KEEP_MS`) and `sweep()` frees it after; entering another zone frees the cached one before decoding the new one. Overlapping loads: the later one wins. |
| Location in the save | `src/sim/world-state.ts`, `src/sim/location.ts` | `player.location` is `{mode: 'zone', zoneId, pose?}` or `{mode: 'chart', chartPos, heading, fromZoneId?}`. No pose means the zone's spawn. `resolveStart` turns it into a zone and a pose: the saved pose, the spawn for a new run or a zone the data no longer has, and for a chart location (piece D) the entry nearest its chart position. Each save writes the ship's pose first. |
| Save v3 | `src/core/save/migrations/index.ts`, `tests/fixtures/saves/v3.json` | v2 → v3 adds `player.location` at the Apostles with no pose, so a 0.2.0 run starts at the spawn, as every reload did before. |
| Zone swap | `src/main.ts`, `src/render/test-scene.ts`, `src/audio/` | The scene's zone layer (terrain meshes and their tile worker, trees, lighthouses, harbors, the water's shore texture) is built and disposed as one, and its preset listeners go with it. On a zone change the terrain, the wind maps, the weather's frame, the piers and berths, the fog signals and gull points, and the HUD's edge all follow the new zone; the ship is placed at its pose with way off, keeping its sails, damage and cargo. `ZoneExited` and `ZoneEntered` go on the bus. |
| Loading screen | `src/ui/loading/` | A fade to fog with a logbook card: "Making for / Apostle Islands / Out of the fog, north of Bear Island." The gameplay tick pauses under it (a `loading` overlay) and the keys do nothing. |
| Checks | `?zone=<id>`, `?entry=west` | Start in a zone, or at one of its entries. With `?debug` (or in dev builds), `__glpZones.enter('zone.apostles', 'north')` from the console, and the dev panel's **Zone** folder (zone, entry, "Skip the cache") with a zone line in the readout. |

### 21.2 Results
- **Continue:** saving, reloading and coming back to the same pose is an e2e test, and so is entering a zone at an entry and reloading there.
- **Memory round trip** (criterion 9 at the data level): `tests/zone-manager.test.ts` decodes the real Apostles (about 48 MB), enters a second zone id over the same files, comes back, lets the cache expire, and checks the memory falls back within 20 MB. In headless Chromium with the WebGL build, three uncached reloads of the Apostles left the JS heap at 10–11 MB and array buffers at 59–61 MB, the same as before the first, so nothing from a left zone is kept. The tile worker's copy goes with the worker, which is terminated on dispose.
- **Load time:** 1.5–2.2 s from the fade starting to the ship in the new zone, uncached, in the cloud container on Low (the 0.65 s fade included). The 8 s budget is checked on the laptop in piece K, with the new zones.

### 21.3 Decisions made in the piece
- **The pose lives in `player.location`,** not a separate ship slice: it is where the player is. The ship slice (plan 10) keeps its upgrades and condition.
- **Damage isn't saved yet.** A reload brings back the pose with full hull and rigging, as before; a moored or anchored ship comes back free and stopped. The ship's condition joins the save with plan 10's slice.
- **Entries are 600 m inside the edge,** in the fog but short of the "Zone edge" chip, so arriving never offers to leave.
- **The boot load has no loading screen.** The UI mounts after the first zone; the fade covers every zone change after that.

### 21.4 Still to do
- Piece D calls `enterZone` on arrival from the chart, with `nearestEntry` for the point where the course crosses the zone's outline, and saves `{mode: 'chart'}` while under way.
- The 8 s warm-cache load is measured on the laptop with the Twin Ports and Two Harbors (piece C), and the heap round trip in the dev overlay with two real zones.

---

## 22. Phase 3 Piece B: The Real Chart (2026-10-31)

The chart is now baked from the same NOAA bathymetry and USGS DEM as the zones (§8.2 step 9), replacing the hand-traced S8 geometry (§16, finding 8). `buildGeography` and the land checks work unchanged, and the zone outlines on the chart come from the zones' bake settings, so they meet the baked zone edges exactly.

### 22.1 What was built
| Piece | Where | Notes |
|---|---|---|
| Chart bake | `tools/geo/chart.ts`, `tools/geo/lib/coast.ts`, `npm run geo:chart` | Warps the DEM (average) and the bathymetry (bilinear) onto 50 m cells of the chart projection over 92.35°W–89.9°W, 46.4°N–47.85°N, the charted area plus a margin. Land is the DEM above lake level + 0.5 m (the zones' threshold), water depth is the bathymetry. A flood fill from open water keeps only the lake (inland lakes and cut-off rivers become land) and land under 0.75 ha sinks. Marching squares trace the shoreline with the land on the left, so the lake is the one clockwise ring and every island is counter-clockwise; Douglas–Peucker at 40 m, tightened ring by ring until no two rings cross. Depth contours at 3, 10 and 30 fathoms come from 100 m blocks at 120 m. Soundings sit on a 1 nm grid at least 450 m from shore, each tagged with the coarsest grid (16, 8, 4, 2 or 1 nm) it falls on. The first run reads about 4 minutes of DEM blocks; a cached rebuild takes 5 s. Report: [`tools/geo/reports/chart.md`](../tools/geo/reports/chart.md) |
| Chart data | `data/chart-coast.json` (237 KB), `data/chart.json` | The baked file holds the lake ring (4,262 points), 173 islands (1,537 points; 21 named from `islands.json` plus Minnesota Point), the depth contours and 3,421 soundings, validated by the `chart.json` schema (new `depth` and `soundings` kinds; island names optional). `chart.json` keeps the hand-authored parts: the charted area, ports, lights, and bounds for zones not baked yet |
| Loading | `src/sim/chart/chart-data.ts` | `westernSuperiorChart()` merges the two files and takes each baked zone's outline from `zones.json` (`zoneGeoBounds` in `src/sim/terrain/zones.ts`: the bake's rounded origin plus half the tile grid, times C). Piece C's Twin Ports and Two Harbors outlines replace the hand bounds as soon as they're in `zones.json` |
| Renderer | `src/render/chart/chart-view.ts` | Real soundings, thinned by grid level to about 46 px apart at any zoom. Depth shading: each contour's shallow side gets a teal wash, so the shallows build up darkest, with a dotted line on the contour. Rings are simplified to half a pixel for the zoom and culled to the view. Islands are labeled "Madeline I." in the period style. The graticule no longer prints 60′ |
| Static layer | same | Paper, coast, depths, soundings, graticule, zones and labels go to an offscreen canvas once per view (§16, finding 9). While the view moves (a drag or a wheel zoom), the last layer is shifted and scaled into place; it is redrawn once the view has held still for 120 ms |
| Bench | `bench/chart/`, `npm run bench:chart` | Draws 240 frames per pass at 1920 × 1080: still, panning and a forced full redraw, at the whole-lake zoom and zoomed on the Apostles. Open `/bench/chart/` in `npm run dev` on the laptop for real numbers |
| Tests | `tests/chart-bake.test.ts` | Ring tracing on small grids (lake clockwise, islands counter-clockwise, corner-touching islands apart, ponds filled, specks sunk, simplification without crossings), and the baked chart: Apostle Islands within 6% of their published areas, Minnesota Point an island, every island inside the lake, soundings over water, zones at their bake bounds, every port in its own zone and no zones overlapping |

### 22.2 Results
| Check | Result |
|---|---|
| Island areas | Madeline 59.6 km² (published 62.2), Stockton 39.7 (40.7), Outer 31.5 (32.4), Oak 20.5 (20.6), Sand 11.8 (11.9), the same as the S3 zone bake (§14.2) |
| The Twin Ports | Minnesota Point is an island (the Duluth Ship Canal is two cells wide at 50 m), Wisconsin Point joins the shore at its east end, and St. Louis Bay, Allouez Bay and the Rice's Point slips all show |
| Course checks and pacing | All chart and pacing tests pass on the real coast after moving three test points and two traffic lane points that now touched land. Pacing with the default lookout: **2.0** encounters on Duluth → Apostles, 0.7 to Two Harbors, 1.8 Two Harbors → Apostles and 1.3 to Siskiwit Bay (S8: 2.1–2.3 on the Apostles crossings, 0.7 to Two Harbors and 1.3 to Siskiwit Bay) |
| Redraw, headless Chromium at 1920 × 1080 (software canvas) | Still view **0.8 ms p95**; while dragging **0.7 ms p95** (the shifted layer); the one full redraw when the view settles **78 ms median, 130 ms p95** at the whole-lake zoom and 65 / 98 ms zoomed in. These times include rasterizing the layer, which S8's 5.2 ms did not, so they aren't comparable. **Re-check on the laptop**, where the canvas is GPU-backed |

### 22.3 Findings
1. **The baked Apostles zone is bigger than S8's hand-drawn rectangle.** It reaches 91.10°W (S8 drew 90.99°W) and 47.13°N (47.11°N). That puts Cornucopia on its west edge, so the Siskiwit Bay chart area moved west to 91.30°W–91.10°W to stop the two overlapping, and Duluth → the Apostles edge is shorter: **16.5 real seconds** by the north route at the default compression (S8: 21 s). Criterion 2 asks for 20–30 s. Piece D or K should either slow the chart clock slightly (about 2 s per game hour instead of 2.5) or accept the shorter crossing.
2. **Long Island is fragments.** The Chequamegon Point spit is about 100 m wide, so at 50 m it breaks into pieces with gaps a course can pass through, and the islands.json point for Long Island falls in water. That's close to 1900, when Long Island was cut off from the point, but if it matters, bake Chequamegon Bay at 25 m or add a hand-drawn spit.
3. **A full redraw is expensive with the real coast.** Three wide strokes and a fill of a 4,000-point ring cost far more than the hand outline did, which is why dragging shifts the old layer instead of redrawing. If the laptop shows the settle redraw as a hitch, the next steps are to drop the two-stroke offshore waterline (about a third of the cost) or bake a lower-detail coast for the whole-lake zoom.
4. **The NCEI grid has a straight seam** off Duluth that shows in the 30-fathom contour. It's in the source data; leave it.
5. **Gull Island** is too small for 50 m cells, as it was for the zone bake (§14.1). It stays off the chart.

---

## 23. Phase 3 Piece C: Twin Ports and Two Harbors Zones (2026-10-31)

**Goal** (§20.4, piece C): bake `zone.twin_ports` and `zone.two_harbors` through the geo pipeline, with set-piece footprints for the Duluth canal, Superior Entry, the Duluth and Superior waterfronts and Agate Bay, and check that the places read at C = 8.

**Result:** both zones are baked into `public/world/twin_ports/` and `public/world/two_harbors/` with the Apostles' settings (C = 8, 4 m sailing samples, soft knee at 20 m). Nothing loads them in the game yet: the zone manager (§21) can, once those ids are wired in. Reports: [`tools/geo/reports/twin_ports.md`](../tools/geo/reports/twin_ports.md) and [`two_harbors.md`](../tools/geo/reports/two_harbors.md), with relief previews next to them.

### 23.1 What was built

| Piece | Where | Notes |
|---|---|---|
| Zones | `data/zones.json` | **Twin Ports:** 4 × 4 tiles, 4.1 km game square (32.8 km real), centered at 46.765°N 92.07°W. It covers St. Louis Bay up to Rice's Point, both harbors, Minnesota and Wisconsin Points, the Duluth hillside, and about 2 km of open lake to the north-east. **Two Harbors:** 3 × 3 tiles, 3.1 km game square (24.6 km real), centered on the lake off Agate Bay, so the North Shore crosses it diagonally and half of it is open water. Both have a 600 m fog fade (the Apostles has 1 km) so the harbors sit clear of the edge fog |
| Ports | `data/ports.json` | `port.duluth` (region Duluth), `port.superior` (region Superior, with the shipyard), `port.two_harbors` (region North Shore), as R1a and 06 §3.1 have them |
| Cuts | `data/schemas/zones.ts`, `tools/geo/lib/edits.ts` | A new hand edit: a set piece can carry `cuts`, channels from one geo point to another, `widthM` wide, dredged to at least `depthM`, with banks that blend back over `blendM`. A cut only lowers. It opens the 1:1 entries through compressed land and clears the compressed modern piers the DEM carries (§3.4) |
| Set pieces | `data/zones.json` | **Duluth Ship Canal:** a 90 m (1:1) cut 7.5 m deep through the base of Minnesota Point on bearing 69°, from the harbor basin to the lake. It sits 40 m south-east of the real canal's line so the Canal Park side keeps its strip of land for the north pier's root; Minnesota Point gives up the 90 m instead. **Superior Entry:** a 140 m cut on bearing 35° between the points, plus a narrow cut that clears the modern north breakwater. **Duluth waterfront:** the bayfront by the slips, facing the harbor basin. **Superior waterfront:** the Superior Bay front near Tower Bay, facing the harbor channel. **Agate Bay:** the town ground flattened behind the bay, and a basin cut 150 m wide that widens the bay to the north-west, about 190 × 250 m of water at 8 m, room for a 1:1 ore dock. Lighthouse Point is left alone |
| Tests | `tests/north-zones.test.ts`, `geo.test.ts`, `data-validation.test.ts` | Per zone: size, spawn in deep water clear of the edge fog, open lake at the edge for arrivals, and at most 40 terrain draw calls on Medium anywhere. Twin Ports: the points, the harbor and St. Louis Bay where they belong; both entries dredged their full width and length; both waterfronts flattened with sailable water off them; and a T1 reaches both waterfronts through either entry alone, but not with both closed. Two Harbors: the basin is dredged and reachable, Lighthouse Point stands, the town ground is flat. The cut edit has a unit test |

### 23.2 Results

| Measure | Twin Ports | Two Harbors |
|---|---|---|
| Bake size | 1.08 MB (16 tiles) | 0.52 MB (9 tiles) |
| Land height, highest | 54 m (277 m real) | 56 m (316 m real) |
| Land over 30°, 1:1 heights → soft knee | 20.5% → 3.6% | 18.6% → 1.7% |
| Land over 42°, 1:1 heights → soft knee | 10.3% → 1.1% | 7.4% → 0.6% |

- **They read at C = 8.** From the water and from the tactical camera, Minnesota Point is a long, low wooded spit with the harbor behind it, Wisconsin Point mirrors it past Superior Entry, the Duluth slips line the bayfront under the hillside, and St. Louis Bay opens up west of Rice's Point. Two Harbors reads as the widened Agate Bay beside Burlington Bay under the bluffs. Screenshots are in the project files (`twin-ports-bake/`). Jared's by-eye check (criterion 10) waits for those zone ids to load in the game.
- **The soft knee suits the North Shore.** The Duluth hillside and the bluffs behind Two Harbors rise near 300 m real. At 1:1 heights a tenth of the land would be steeper than 42°; with the knee they're 50–56 m ridges, still the highest ground in the game, and the shore cliffs keep their height.
- **The harbor is deep enough for the T1 without dredging it.** The NCEI grid has the harbor's modern dredged channels (smoothed to 90 m), so the main channel from the canal to Superior Entry along Minnesota Point is 7–12 m deep. St. Louis Bay is mostly under 2.5 m, as it was before the channels were cut upriver; it's sailable only in its deeper patches.
- **The modern harbor shows through.** The DEM is from the 2010s, so the slips, fills and breakwaters are today's. The 1900 corrections are §8.2 step 7 work, and the harbors piece (I) is the place to decide which ones matter.

### 23.3 Decisions made in the piece
- **Zones are tile-sized squares, bigger than §4's estimates.** §4 gave the authored areas (~2.3 × 1.9 km and ~1.2 × 0.9 km). The bakes add room for the soft edge and for open lake to arrive from the chart, and round up to whole 1 km tiles.
- **The 1:1 entries are cuts, not rebaked lenses.** A cut through the compressed land opens the canal and the entry at their real widths at the cost of shortening Minnesota Point by about 90 m (720 m real) and trimming the point tips at Superior Entry. Piece I builds the 1:1 piers along the cuts' sides.
- **Agate Bay is widened, unlike Ashland.** Ashland's ore dock reaches into a kilometer of open bay (§18.2); Agate Bay is about 130 m across at C = 8, too small for a 1:1 dock. The basin is a first guess for piece I to reshape and rebake.

### 23.4 Still to do
- Piece I: piers along the cuts, berths, the 1900 lights, town silhouettes, and the footprint numbers adjusted to fit them. The compressed DEM pier stubs outside the cuts may need more cuts.
- The Minnesota Point and North Shore cove hideout pads (09 §2.1) aren't placed; the zones have no on-foot tiles yet.
- Entry points on the zone edges for Twin Ports and Two Harbors.

---

## 24. Phase 3 Piece D: Chart Mode in the Game (2026-10-31)

**Goal** (§20.4, piece D): bring the S8 chart mode into the game's mode machine with its HUD in Preact, "Take to the chart" at the soft edge, M from open water, no chart in a harbor, plotting, the ETA, the lookout setting, the encounter card and the "chart locked" banner; arrival loads the destination zone at the matching entry; the `voyage` slice in the save.

**Result:** built. Sail out of the Apostles into the west edge's fog, press M (or click **Take to the chart**), lay a course to Duluth, set sail, and the Twin Ports load at their east entry with the ship heading in. A reload mid-voyage comes back on the chart, under way where the save left it.

### 24.1 What was built
| Piece | Where | Notes |
|---|---|---|
| Chart travel | `src/modes/chart-travel.ts` | Wraps `createChartMode` (S8) for the game: the chart canvas in a full-screen layer over the 3D view, plotting on it, the HUD, the keys (Enter sets sail, Backspace takes off the last waypoint, M goes back), arrival, and what goes in the save. The 3D scene isn't drawn while the chart is up |
| Two ways onto the chart | same, `src/main.ts` | **M in a zone opens the chart as a look** (§20.5): the world holds, a course can be laid and its ETA read, but **Set sail** says "Sail out to the zone edge to set out", and M goes back to the helm. **At the soft edge** (past half the fog fade, where Phase 2 showed "Zone edge"), M or the **Take to the chart** button takes the ship onto the chart for a voyage, keeping any course laid on a look. M straight back puts her where she was; if she has sailed, **Into the Apostle Islands** (or whichever zone the ship is in on the chart) brings her in at the nearest entry |
| No chart in a harbor | `setPieceAt` in `src/sim/terrain/zones.ts` | Inside a harbor set piece's footprint, M says "Not in the harbor: put out to open water first" |
| Arrival | `chart-travel.ts`, `enterZone` in `main.ts` | A course into another zone stops where it crosses the zone's outline (S8); the zone loads behind the fade to fog at its entry nearest that point (`nearestEntry`, piece A), and the mode changes to sailing under the fog. The loading overlay now survives a mode change (`ModeMachine`). A course ending in open water leaves the ship hove to on the chart |
| Chart HUD | `src/ui/chart/` | `model.ts` (pure, tested) samples the session at 10 Hz into a logbook card: the date and time, the wind, the lookouts' range, the course or the voyage with an **ETA in game time**, why a course is refused, **Set sail / Undo / Clear** or **Heave to**, the lookout setting, and the way back. `ChartHud.tsx` draws it; `plotting.ts` is S8's click, drag, Shift-click and right-click plotting; `text.ts` moved from the spike |
| Encounter card | `ChartHud.tsx`, `encounterCard` | Engage (or Investigate, Sail through, Close and hail), Avoid with the odds for a hostile or Steer clear for the rest, Ignore for anything that isn't a threat; a forced meeting shows only "Into the arena". Engage or a failed avoid calls `enterArena` (piece G, §25) and leaving the arena returns to the chart; without that hook the meeting is noted and the voyage carries on |
| Chart locked | `ChartLockedBanner` in `src/ui/hud/Hud.tsx` | "Chart locked: you are being pursued" on the sailing HUD and the chart; M, Take to the chart and Set sail are refused while it shows. Nothing pursues yet: piece G's arena sets it, and `__glpChart.setPursued(true)` shows it |
| Lookout setting | `chart.lookout` in `src/core/settings.ts` | In the settings store, so it survives the run (plan 13 §4.3). On the chart card and under **Camera & sailing** in settings |
| Voyage in the save | `voyage` in `src/sim/world-state.ts`, save v4 | `{points, leg, progressM, startedAt}`: the plotted points and how far along. On load the course is planned again from the points (`restoreVoyage`); if it no longer plans (the chart data changed), the ship stays hove to where it was. `player.location` is `{mode: 'chart', chartPos, heading, fromZoneId}` while on the chart. v3 → v4 adds `voyage: null`; `tests/fixtures/saves/v4.json` is a run saved mid-voyage |
| Autosave | `chart-travel.ts` | On taking to the chart, setting sail, heaving to, going back and arriving (with piece A's saves on the zone change), plus the two-minute timer |
| Checks | `__glpChart` with `?debug` | `plot([[lat, lon], …])`, `setSail()`, `secondsPerHour(s)` to hurry a voyage, `setPursued(on)` |

### 24.2 Results
| Check | Result |
|---|---|
| Criterion 2: Duluth → the Apostles edge | **23.1 real seconds** at the new default of 3.5 s per game hour (was 16.5 s at 2.5 s, §22.3), unit-tested at 20–30 s. The ETA is the sailed time at the current wind, from the same speed table |
| The whole trip | An e2e test (`e2e/smoke.spec.ts`) takes to the chart at the Apostles' west edge, goes back and out again, plots to the Twin Ports, saves and reloads mid-voyage, answers the lookouts (a meeting that can't be slipped is left off the arena's edge), and arrives at the Twin Ports' east entry heading west, saved there. Then M is a look with Set sail disabled, and the pursued banner locks the chart |
| Arrival load | 1.3 s from the fade to the ship in the Twin Ports, uncached, with the null renderer in the cloud container. The 8 s budget is checked on the laptop in piece K |
| Chart redraw in the game | 0.3–0.7 ms per frame at 1600 × 900 with the view still (headless Chromium, software canvas), as piece B's bench found |

Screenshots are in the project files (`chart-in-game/`).

### 24.3 Decisions made in the piece
- **The chart clock is 3.5 real seconds per game hour** (`CHART_SECONDS_PER_HOUR`). §22.3 suggested about 2 s, but that shortens the crossing; 3.5 s puts Duluth → Apostles in the middle of 20–30 s. §5.3's "2–3 s" reads as about 3.5 s now.
- **A voyage only sets out from the soft edge.** M anywhere in a zone's open water is a look with the world held (§20.5); plotting is allowed so the course is ready at the edge.
- **The chart and the zones use different projections.** The chart geography is centered at 47° N 91° W, while zone frames, entries, the weather sim and the save use core/coords' default around the middle of the lake. `toWorldChart` and `fromWorldChart` (`src/sim/chart/geography.ts`) convert, and the save keeps world-frame points, so it doesn't depend on the chart's projection.
- **The zone left behind stays loaded** while the ship is on the chart, for the way straight back; arrival swaps it through the zone manager like any zone change. A run saved on the chart loads its `fromZoneId` zone behind the chart.
- **The Twin Ports and Two Harbors offer the chart from just outside their harbors** (playtest, 2026-10-31: sailing out to their edges took too long). Their `edge.chartFromM` in `zones.json` (1,900 m and 1,400 m inside the edge, which takes in the Duluth canal and Agate Bay mouths) offers "Take to the chart" wherever the open lake lies clear ahead toward the zone's nearest edge (`clearToZoneEdge`), so not in the harbor basin behind Minnesota Point. Arrivals at their entries now show the button at once. The Apostles keep the outer half of their fog fade.
- **Contacts aren't saved.** The S8 stand-in traffic is rebuilt from the run's seed on load; piece F's route graph replaces it.

### 24.4 Still to do
- ~~Piece E: the chart's wind from the sim, and weather drawn on the chart.~~ Done (§26).
- Piece F: the route graph traffic and a detour cost for Avoid.
- Piece G is in (§25): engaging or failing to avoid enters its arena, and leaving returns to the chart with the zone reloaded behind it. `chart-spike.html` and `src/debug/chart-spike/` are still to retire.
- Piece J: chart music and the transition sound.
## 25. Phase 3 Piece G: Open-Water Arenas (2026-10-31)

**Goal** (§20.4, piece G): the arena in the game as the sailing mode with no terrain tiles: the sim's weather, sky and time at the encounter point, the ships materialized from traffic on their lanes' headings with simple steering and collision avoidance, the coastline in view as low silhouettes from the chart, the pursuit lock within the threat radius, and back to the chart at the edge. `?encounter=<kind>` for checks.

**Dependencies:** G needs D (chart in the game), F (traffic) and H (NPC ships). H is in. D and F weren't when this piece started, so G is built against a small encounter interface both can plug into, and checked through `?encounter=` without a chart. Two hooks are left for D (below); F only has to fill `ArenaEncounter.ships` from its abstract ships.

**Result:** every encounter kind of §20.3 criterion 5 can be met in the game: `?encounter=freighter`, `barge`, `steamer`, `tug`, `cutter`, `derelict`, `squall`, `fogbank`, and `convoy` (a freighter towing a schooner-barge consort with a tug in company, for the multi-ship budget). Ships hold their courses and give way, the cutter can hunt (`?cutter=hunt`) and locks the chart while it has you, and sailing off the edge ends the arena. Screenshots are in the project files (`arenas/`).

### 25.1 What was built

| Piece | Where | Notes |
|---|---|---|
| Encounter | `src/sim/arena/encounter.ts` | `ArenaEncounter`: the chart contact's id, the kind (`ship`, `cutter`, `derelict`, `squall`, `fogbank`), where the player left the chart, their heading, the bearing to what was met, whether it was forced, whether the cutter hunts, and the ships to materialize (class, name, lane heading, speed, offset). `arenaFromChartEncounter` turns today's S8 `Encounter` into one; `devEncounter` makes the checks |
| Layout | `src/sim/arena/arena.ts` | The arena's own frame: origin at the encounter point, C = 8, so the weather sim is sampled at the right place on the lake. What was met in the middle, the player 650 m off on the bearing it was sighted on (520 m when forced), on the heading they sailed the chart with, under full sail and making way |
| Land | `src/sim/arena/land.ts` | The chart's land mask sampled once into a 25 m grid by scanline (about 3–20 ms). Encounters near a shore are nudged up to a few kilometers into clear water first; land still inside holds the player off like a wall, and the ships steer around it |
| Steering | `src/sim/arena/steering.ts`, `src/gameplay/arena.ts` | Each NPC helm holds its lane's course at its service speed, turns at its class's `turnRateCurve`, and gives way to starboard of anything with a closest approach inside 75 s and the two half-lengths plus 70 m, slowing if it's very close; it holds the avoiding heading 6 s after the danger clears, then comes back to its course. It looks 40 s ahead for land and takes the nearest clear heading in 20° steps. The hunting cutter steers a lead course on the player instead and ignores the give-way rule for them |
| Rules | `src/sim/arena/arena.ts` | Leave past ±1.5 km, or with M, unless pursued. A hunting ship within 900 m locks the chart and holds the player at the edge; within 45 m she's caught. "Close and look" (Phase 3's engage): hold F within 160 m for 1.5 s. A squall is ridden out in 40 s. Results: `left`, `resolved`, `caught` |
| Weather | `src/main.ts` | The sim's weather at the encounter point through the arena frame, over open water (no shelter). A `squall` blows one up on the panel weather (30 kn, rain, thunder, 1.2 km visibility) until piece E brings squalls from the sim, then hands back. A `fogbank` stands a sim fog bank across the bow, 700 m off; the sim drifts it on the wind and mixes it out in 20 kn or more, as it does any bank |
| Coast | `src/sim/arena/coast.ts`, `src/render/arena/coast-view.ts` | The coastline within 6 km (48 km real) resampled every 40 m with its inland side, as one flat-shaded mesh: a beach rising to a crest 22–56 m high on the mainland and 10–26 m on islands, varying along the shore. One draw call. Fog closes in over the last 500 m before the edge |
| Derelict | `src/render/ships/npc-view.ts` | A schooner-barge with no canvas, no lamps and no smoke, listing 14° and lying still |
| Game | `src/main.ts`, `src/modes/sailing.ts`, `src/render/test-scene.ts`, `src/ui/` | `enterArena(enc)` and `leaveArena(result)` behind the same fade as a zone, with a logbook line per kind ("Closing the Hiram R. Dixon."). The sailing mode takes an `arena` hook for the ships, rules and edge hold; the scene a `setArena` for the coast and the edge fog; the HUD a chip list ("Chart locked: the cutter has you", "Hold F to look her over", "Squall: ride it out 32 s", "Sail on for the chart"). Nothing in an arena overwrites the run's saved zone place. `ArenaEntered` and `ArenaExited` events |
| Checks | `tests/arena-game.test.ts`, `e2e/smoke.spec.ts` | 16 unit tests: every kind and every NPC class can be met, the S8 adapter, layout, the land grid agrees with the chart's land test, the nudge clears the arena, coast silhouettes face inland, two steamers meeting end on pass clear and come back to course, a tug gives way to the player, a steamer heading for the North Shore stays off it, the hunting cutter runs down a ship hove to, a derelict lies still, and the exit, look, lock, caught and squall rules. An e2e test drops into a convoy and sails off the edge. `__glpArena` with `?debug`: `enter('cutter', true)`, `state()`, `place(x, z)` |

### 25.2 Results

| Measure | Result |
|---|---|
| Arena set-up (chart cached, land grid, nudge, coast) | Under 50 ms in Node; the first arena also builds the chart (about 40 ms) |
| Chart to arena (criterion 3: 2 s or less) | 0.65 s fade plus set-up; 2.1–3.0 s in headless Chromium on software WebGL, which compiles the NPC ship shaders on first use. Needs the laptop |
| Draw calls, Medium | 37 with one freighter, 39 with the three-ship convoy (budget 150) |
| Heap in an arena | 23 MB |

- **The North Shore is close to most of the Duluth track.** From the default check point (47.05°N 91.3°W) the shore near Castle Danger is inside the gridded square, so land in the arena isn't an edge case. Nudging keeps the play area clear; the silhouettes put the shore on the skyline where it is.
- **NPC ships were steaming about twice as fast as they should.** `createNpcShipEntity` passed knots to `sceneSpeed`, which takes m/s. Fixed: a 10 kn freighter now makes 15.4 m/s on screen, as the schooner does at 10 kn.

### 25.3 Decisions made in the piece
- **An arena is the sailing mode, not a new mode.** No `arena` mode id: the zone is unloaded, the arena's hooks are set, and the HUD, camera, audio and controls are the sailing ones.
- **The arena has its own frame at the encounter point** rather than the last zone's, so weather, fog banks and the coast all line up with the chart. The chart geography is projected about the western lake and the weather sim about the whole lake, so the arena carries its centre across by latitude and longitude (`arenaWeatherFrame`); piece D's `toWorldChart` does the same and can replace it.
- **Land in an arena is a wall, not a shoal.** There's no depth map in an arena; touching chart land stops the ship. Encounters are nudged off shores so it's rare.
- **Engage is "close and look":** hold F alongside, which marks the encounter resolved. Hails and boarding come with Phases 4 and 6.
- **Caught by the cutter ends the arena** with `caught` (dev only; nothing forces it until Phase 5's Wanted).

### 25.4 Hooks for piece D, and still to do
- **Piece D calls `enterArena(arenaFromChartEncounter(enc, chartPos, heading))`** on Engage or a failed avoid, and `arenaHooks.onExit` reloads the zone left behind and returns to chart mode with `resumeFrom(exit.contactId)`. An arena entered from a zone (`?encounter=`) still returns there. The chart-locked banner reads `arena.run.pursued` as well as the dev hook. A hostile that forced the meeting hunts you in the arena; caught, the voyage ends where it stands with a "Boarded" notice (no Wanted until Phase 5, so she lets you go). `chart-spike.html` and `src/debug/chart-spike/` are retired, with the spike-only arena tests; an e2e test engages a freighter from the chart, sails off the edge back onto the voyage, and is caught by a hunting cutter. `__glpChart.meet(kind, forced)` raises an encounter for checks.
- **F fills `ArenaEncounter.ships`** from its abstract ships near the encounter point, with their class, lane heading and speed and an offset each, so a crossing can bring more than one ship.
- **Saving in an arena** keeps the chart voyage when one is under way, so a reload resumes it (§20.5); otherwise the zone place recorded on the way in.
- ~~**Squalls and fog banks from the sim** are piece E's.~~ Done (§26): one met from the chart is the sim's own; the `?encounter=` checks still stand one up.
- The chart-to-arena time on the laptop (criterion 3), and Jared's arena feel check.
- The player can sail through an NPC hull; collisions come with combat (Phase 6).

---

## 26. Phase 3 Piece E: Weather on the Chart (2026-11-01)

**Goal** (§20.4, piece E): the S9 sim drives the chart's wind (the drifting stand-in goes); fronts, fog banks and storm cells drawn on the chart; a forecast with uncertainty from the barometer and the systems' tracks ([04 §15](04-water-weather-seasons.md)); squalls and fog banks met on the chart come from the sim, not hand-placed contacts, and slow or hide you as they do in the zone.

**Result:** built. The chart and the zones share one sky: the run's weather sim runs on the chart's world tick as it does in a zone, the chart reads its wind under the ship, and what it draws, reports and drops you into is the sim's own weather. The hand-placed squall line and the drifting wind are gone. Screenshots are in the project files (`chart-weather/`).

### 26.1 What was built

| Piece | Where | Notes |
|---|---|---|
| One sky | `src/sim/chart/chart-weather.ts`, `readSky` in `src/modes/chart.ts` | The chart asks the sim at `toWorldChart(p)`, as a zone asks at `zoneToChart(p)`, so wind, visibility and pressure agree at the same place and time. Under way, each world tick advances the sim (`advanceWeather`) and reads it again; taking to the chart and Continue read it at once. The session's `sky` holds the run's `WorldState.environment.weather`, so nothing new goes in the save |
| Squalls | `squallAt` in `src/sim/weather/weather.ts`, `findStormCells` | `squallAt` is the summer thunderstorm of piece E (Phase 2), plus a cold squall where a gale's rain (22–32 kn) meets the same drifting storm cells, so November has squalls too, without lightning. The chart samples the sim on a 5 km grid over the western lake and takes connected patches at intensity 0.55 or more as storm cells, a disc of the same area capped at 16 km radius, at most six. A cell keeps its id from tick to tick (`trackCells`), so the lookouts don't report it twice |
| Fog banks | `chartFogBanks` | The sim's banks that reach the charted area, with their wall at three-quarters of the radius, where a zone stands its fog wall (04 §25) |
| Weather contacts | `weatherContacts`, `isWeatherContact` in `traffic.ts` | Squalls (`storm`) and banks (`fog`, new) are contacts on the sky, apart from the traffic: met at their edge, threats under the lookout setting (a squall can't be ignored), "Sail through" or "Sail into it", or steer clear. **Only weather on the course ahead is reported** (within 40 km of the track), and never weather the ship is already in |
| Slow and hide | `sessionWeatherFactor`, `sessionShip` | Lookout range scales with the sim's visibility at the ship (clear air 1, rain about 0.2, a bank's heart a few hundred meters), both ways: the cutter can't see you in fog either. Sail is shortened in a squall (0.6 of the speed) and the lead goes in fog (0.8); the ETA uses the same speed |
| Drawn on the chart | `src/render/chart/weather-layer.ts` | Isobars every 0.02 inHg with labels, L and H with their pressure and a 12-hour track ending in a ring of doubt, a pointer at the edge for a system off the view ("Low 29.28, 150 nm, moving SE"), warm and cold fronts trailing each low deeper than 1007 hPa, rain hatched over a wash, wind arrows feathered by strength (a feather per 10 kn), fog banks shaded with their wall dotted, and squalls as dark cells with a bolt (thunder) or a squall-line mark (cold) |
| Forecast | `forecastAt`, `courseWeather`, `weatherPicture(…, leadHours)` | A weather card top right: the glass and its trend (red when falling fast), an outlook six hours ahead ("wind SE 10–17 kn, rain, thick. A blow may follow."), and the first squall, fog or gale on the laid course or the voyage. **Now / +6 h / +12 h / +24 h** redraws the chart's weather at that hour by running the systems and banks forward on their tracks, with the positions ringed by doubt that grows 4 km an hour and the wind's spread by 2% an hour. The forecast can't know the lows not yet formed |
| Arenas | `metWeatherFrame` in `src/sim/arena/arena.ts`, `ArenaEncounter.weather` | A squall or bank met on the chart carries its centre and radius into the arena, and the arena's weather frame is slid so the sim is read where the meeting happens: a squall's core under the player, a bank's wall 700 m ahead on the bearing it was sighted on. The arena's weather is then the sim's, not the panel's. `?encounter=squall` and `fogbank` (no sim weather to meet) still stand one up as before |
| Checks | `tests/chart-weather.test.ts`, `bench/chart/` | 14 unit tests: chart and zone wind agree (criterion 6), the sim drives the chart wind under way and advances on the world tick, fog hides the ship from the cutter, a bank is reported at its wall and met in an arena with its wall 700 m ahead, a squall slows the ship and is met at its heart, cells keep their ids, November brings cold squalls without thunder, the forecast's spread grows, a forecast picture is the sim at that hour, fog on a course is called, the weather card, and the isobar tracing. The pacing test (`chart-pacing.test.ts`) now sails in the sim's wind and meets its weather. The chart bench draws a November gale and times a weather redraw |

### 26.2 Results

| Check | Result |
|---|---|
| Criterion 6, wind | The chart's wind equals the zone's at the same point and time to 0.001 kn and 0.001 rad (unit test). A squall met from the chart drops into an arena with the sim at storm 0.83, rain 0.33 and 3.6 km visibility (`[sim]` on the dev readout), and a bank stands where the chart drew it |
| Sampling the sim | About 2.3 ms per world tick in Node for the 891-point grid (the climate normals are now cached per game time, which halved it). Under way at the default clock that's about twice a real second |
| Chart redraw (criterion 9), headless Chromium, software canvas, 1920 × 1080 | Still and panning frames are unchanged at 0.2–0.3 ms median, 0.6 ms p95: the weather field (rain, isobars, fronts, wind, systems) is drawn into a copy of the static layer and kept, and only the banks and squalls are drawn live. The field is drawn again when the view settles (48 → 65 ms median on this software canvas) or the weather has moved on half a game hour (about every 1.75 real seconds under way; 20 ms median, 36 ms p95 here). Both need the laptop's GPU canvas in piece K |
| Pacing (criterion 4), 100 seeded runs per route, default lookout | Duluth → Apostles 2.38 encounters (was 1.88 with the fixed 12 kn wind and no weather), Two Harbors → Apostles 1.94, Duluth → Siskiwit Bay 1.68, Duluth → Two Harbors 0.62. About a third of the rise is the weather met (31 fog banks and 3 squalls in 100 crossings, all in May); the rest is longer crossings in lighter wind |

- **The sim's wind makes crossings slower than criterion 2 assumed.** At the default 3.5 s per game hour, Duluth → the Apostles averaged 41.6 real seconds over the 100 pacing runs (all in May), against 23.1 s at a steady 12 kn (§24.2). The May mean wind is about 10 kn, but calms and head winds dominate the time sailed. Criterion 2's unit test still holds at 12 kn. This is for Jared and piece K: speed up the chart clock, set a floor under the chart's speed in a calm, or accept that a calm crossing is slow.
- **Fog banks are the commonest weather met in spring** (most of the weather encounters in May runs), squalls in summer, and November's are cold squalls in a gale's rain.
- **The sim's squalls don't raise the wind.** A summer thunder squall brings rain, dark and lightning but the wind of the low around it (9.7 kn in the arena check); a cold squall is windy because the gale is. Squall gusts are a sim change for later (04 §5.3).

### 26.3 Decisions made in the piece

- **Weather contacts live on the sky, not in the traffic list,** so piece F can replace the traffic without touching the weather, and the sim rebuilds them each world tick.
- **Only weather on the course is reported.** A squall off the beam is drawn and labelled but doesn't stop the clock; one across the next 40 km of the track does.
- **Storm cells are the cores.** The sim's storm patches are tens of kilometers across at low intensity; a cell on the chart is where the squall reaches 0.55, capped at 16 km radius, so a squall is something to sail around.
- **Isobars every 0.02 inHg,** finer than a 1900 continental map's 0.1 in, because the charted area is only 90 nm across.
- **The forecast is the sim run forward,** with uncertainty drawn rather than noise added: what it can't know is the weather not yet formed, which is honest to a forecaster of 1900. A barometer upgrade or the *Fisherman* background (04 §12) can narrow the rings later.
- **The arena slides its weather frame, not the player.** §20.5's "the arena returns you where you left the chart" holds; only where the sim is read moves.

### 26.4 Still to do

- Criterion 2 with the sim's winds (above), for Jared.
- A barometer readout on hover over the chart (04 §12) and port storm flags (Phase 5).
- The chart redraw and the weather sampling on the laptop (piece K).
- Squall gusts in the sim, so a summer squall blows as well as rains.

---

## Changelog
- v0.21: Phase 3 piece E (§26): weather on the chart. The sim drives the chart's wind and runs on its world tick; isobars, fronts, rain, fog banks, squalls and wind arrows drawn; a weather card with the glass, an outlook, weather on the course and forecasts to 24 h with rings of doubt; squalls and fog banks met from the sim, hiding and slowing the ship, and met in arenas where the sim has them.
- v0.20: Piece G wired through: a forced hostile hunts in the arena, caught ends the voyage, the S8 spike page retired.
- v0.19: Phase 3 piece G (§25): open-water arenas in the game, wired to piece D's chart so engaging returns to the voyage; NPC helms with give-way and land avoidance, coast silhouettes, the pursuit lock, `?encounter=` checks, and NPC speeds fixed.
- v0.18: Phase 3 piece D (§24): chart mode in the game, taking to the chart at the soft edge, M as a look, the encounter card and the chart locked banner, arrival at a zone's entry, the voyage in save v4, and the chart clock slowed to 3.5 s per game hour for criterion 2.
- v0.17: Phase 3 piece C (§23): the Twin Ports and Two Harbors zones baked, with set-piece footprints, dredged cuts for the Duluth canal, Superior Entry and Agate Bay, and their ports.
- v0.16: Phase 3 piece B (§22): the chart is baked from NOAA and USGS data (`npm run geo:chart`), zone outlines come from the bake settings, real soundings and depth shading, a cached static layer, and a chart redraw bench. The Siskiwit Bay chart area moved west of the larger baked Apostles zone.
- v0.15: Phase 3 piece A built (§21): zones by id with the last one cached, entry points, `player.location` in save v3, Continue back to the saved pose, and the fade to fog between zones.
- v0.14: Phase 3 scope proposed (§20): what Phase 2 changes, deliverables, exit criteria, eleven work pieces, assumed calls, and the new zones get dockable harbors (decided 2026-10-31).
- v0.13: Phase 2 exit criteria and playtest (§19), passed 2026-10-31; `?timewarp=` for the week-of-weather check.
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
