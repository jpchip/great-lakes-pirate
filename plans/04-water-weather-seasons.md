# 04 — Water, Weather, Seasons & Day/Night

Status: DRAFT v0.7 (decisions confirmed; gap review applied; spike S2 and prototype S9 done; moving-camera wave fix; Phase 1 wind, waves and sky built; Phase 1 water look and speed cues built; Phase 2 water budget cuts)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- [01 tech/architecture](01-tech-architecture.md): layers, budgets, the shared wave function, the iGPU baseline
- [02 sailing](02-arcade-sailing.md): the environment query contract, wind shadow
- [03 world scale](03-world-scale-chart-travel.md): clock rates, chart, zones
- [R1 §2.7](R1-western-superior-1900-research.md): season, ice, fog and storm findings
Feeds: 02 (wind/waves/ice), 05 (seasonal markets and traffic), 06 (visibility, moonlight, storms vs. patrols), 08/11 (night, ice on foot), 13 (HUD instruments), 14 (look), 15 (audio)

## Purpose

Define the **environment**: calendar and clock, seasons, the weather simulation, wind, waves, fog, precipitation, ice, sky, lighting, and water rendering. All of it must matter to gameplay and stay cheap on the integrated GPU.

---

## 1. Goals

1. **Superior's moods.** Cold blue-gray water, sudden fog, violent November gales, ice. The lake should feel alive and dangerous.
2. **Weather is gameplay**, not a backdrop. It drives speed, stealth, danger, traffic, prices and opportunity.
3. **Readable and forecastable.** Skilled players read the barometer, the sky and port signals to anticipate weather. Surprise exists, but isn't random cruelty.
4. **One source of truth.** The simulation produces an environment state; sailing, AI, rendering and audio all query it.
5. **Cheap and deterministic.** Seeded, testable, and within [01 §5](01-tech-architecture.md) budgets.

---

## 2. Architecture

```
SIM (pure TS, world tick)                    QUERIES (gameplay tick)              PRESENTATION (three.js)
┌────────────────────────────┐               ┌───────────────────────────┐        ┌──────────────────────────┐
│ Calendar & clock           │──────────────►│ Environment service       │───────►│ Sky, sun, moon, stars    │
│ Climate normals (by date)  │               │  windAt(pos,t)            │        │ Water shader & mesh      │
│ Weather systems (lows/highs│──────────────►│  waveParams(pos,t)        │───────►│ Fog (global + banks)     │
│   moving across the chart) │               │  visibilityAt(pos,t)      │        │ Clouds, rain/snow, light-│
│ Fog banks                  │──────────────►│  iceAt(pos,t)             │───────►│   ning, aurora           │
│ Ice coverage (per zone)    │               │  lightAt(t) (sun/moon/amb)│        │ Ice surface & floes      │
│ Seeded RNG stream          │               │  pressureAt(pos,t)        │        │ Lighting presets/LUTs    │
└────────────────────────────┘               └───────────────────────────┘        └──────────────────────────┘
          ▲  state saved in WorldState.environment          ▲ shelter/fetch maps (baked per zone, 02 §11 / 03 §8)
```

- **Sim** updates on the world tick (every ~10 game minutes) and is cheap: a handful of weather systems, fog banks and a coarse ice grid.
- **Environment service** answers per-position queries quickly (interpolating sim state plus baked maps) for gameplay and rendering.
- **Presentation** reads the service each frame and drives shader uniforms, so it never owns any weather logic.

---

## 3. Calendar & Clock

### 3.1 Time rates (from 03)
| Context | Rate |
|---|---|
| Sailing in a zone or arena | R = 24 (1 real min = 24 game min; day ≈ 60 real min) |
| On foot | R_foot ≈ 6 |
| Chart voyage | ~1 game hour per 2–3 real s |
| Wait/sleep, jail | Skip to a chosen time / sentence end |

### 3.2 The year-length problem
At a 60-minute real day, **one calendar day per game day would make a year about 365 real hours**. Seasons would barely change in a normal playthrough, which defeats the season design.

**Proposal: decouple the season calendar from the day/night clock.**
- The **day/night clock** runs as above (sunrise, sunset, the night heist rhythm).
- The **season calendar** advances **7 calendar days per game day** (one week per day). The date shown is "Week of May 14, 1900."
- A full year ≈ **52 game days**. With sleep, chart travel and waiting, that's roughly **35–50 real hours**, so a player sees every season in a typical run. Each season lasts ~13 game days.
- Prices, traffic and events key off the calendar (weeks and months). Weather systems run on the day clock (a storm lasts game hours, not weeks).
- **Moon phase** follows the calendar: a synodic month (29.5 days) ≈ **4.2 game days**, so a new moon (darkest nights, the best heist and wrecking nights) comes around every few days. That's very gameplay-friendly, and it ties into "moon cussing."
- Sentences, contracts and rumors are expressed in weeks, which maps cleanly to game days.

Alternatives (for the decision): 1 day = 1 day (year ≈ 365 h; seasons effectively static), or 1 day = 3 days (year ≈ 120 h). **Recommendation: 7.**

### 3.3 Start date
- **Proposal: Monday, May 7, 1900 (the "Week of May 7").** The shipping season has just opened (per R1, first boats late April to early May), there's still drifting ice in places, fog season is starting, and traffic is rising. It's a natural tutorial season.

### 3.4 Sun & moon
- Sun position from date, time and latitude (~46.8° N) with a standard low-cost solar formula.
  - Day length ranges from ~15.5 h (June) to ~8.7 h (December). Long summer days are tough for thieves; long winter nights are good for them.
- Moon position and phase from date (synodic cycle). The phase sets moonlight intensity, which matters for stealth (plan 06).
- Twilight (civil and nautical) phases give dusk and dawn windows: the classic sneak-into-port times.
- Unit-tested against known sunrise/sunset tables and historical moon phases for 1900.

---

## 4. Seasons & Climate

### 4.1 Climate normals (data, interpolated by date)
`data/climate.json` holds monthly normals for western Lake Superior (approximate; refine from NOAA climate normals in R1 later):

| Month | Air (°C, day) | Water surface (°C) | Mean wind | Prevailing wind | Storm prob. (per day) | Fog prob. | Ice |
|---|---|---|---|---|---|---|---|
| Jan–Feb | −10 | 1 | Strong | NW/W | Medium | Low | Bays frozen; open lake partial |
| Mar | −3 | 1 | Strong | NW | Medium | Low | Thick; ice road usable |
| Apr | 5 | 2 | Moderate | Variable/NE | Medium | Medium | **Ice-out** (random mid-Apr ± 2 weeks) |
| May–Jun | 13–19 | 4–8 | Moderate | Variable/SW | Low | **High** (advection fog) | Floes early May |
| Jul–Aug | 23 | 12–16 | Light–moderate | SW | Low (thunderstorms) | Medium | — |
| Sep–Oct | 17–11 | 13–9 | Moderate–strong | W/NW | Rising | Medium (radiation fog at dawn) | — |
| **Nov** | 3 | 6 | **Strong** | NW (and dangerous NE) | **High (gale peak, first half)** | Low | — |
| Dec | −6 | 3 | Strong | NW | High | Low | Bays begin freezing |

❓ marks in R1 apply. The table is the design intent; the numbers the game runs on are in `data/climate.json`, checked against NOAA normals and observations in §23 (2026-10-29).

### 4.2 Year-to-year variation
At each new year (and at game start), roll seeded variation: ice-out date, freeze-up date, a winter severity index (ice extent, ice road reliability), and a fall storm intensity index. Every year feels a little different.

### 4.3 Seasonal effects (summary; owned by other plans)
| System | Seasonal effect |
|---|---|
| Traffic (05) | Spring opening rush ("first boat in" bonus), steady summer, **fall ore and grain peak**, winter near zero |
| Markets (05) | Fish runs, wild rice (fall), maple sugar (spring), furs (winter), fuel and food scarcity in winter |
| Law (06) | The cutter is laid up for the winter (✅ the *Morrill* was based at Milwaukee and "laid up during the winter months"; [USCG history](https://www.history.uscg.mil/Browse-by-Topic/Assets/Water/All/Article/2518666/morrill-lot-m-morrill-1889/)). Winter policing is local only. |
| Sailing (02) | Ice, cold-water survival, gales |
| On foot (08, 11) | Snow tracks (stealth), cold exposure, walkable ice |

---

## 5. Weather Simulation

### 5.1 Weather systems (large scale)
- The chart holds a small set (**≤ 6**) of moving **pressure systems**: lows (storms, fronts, rain or snow) and highs (fair, light winds, fog risk).
- Each has a position, velocity (mostly west → east, with seasonal tracks), radius, intensity (pressure anomaly) and lifecycle (spawn → deepen → fill → dissipate).
- Spawning is seeded and weighted by climate normals (more and deeper lows in November).
- **Wind at a point** = seasonal prevailing wind + circulation from nearby systems (counter-clockwise around lows, clockwise around highs, with strength falling off by distance) + slow noise. Then local modifiers: **shelter and funneling maps** ([02 §11](02-arcade-sailing.md)) and **gusts** (noise with intensity from the system type).
- A zone (~7 km compressed) sits inside one system's influence, so wind is nearly uniform across a zone apart from shelter and gusts, which is cheap.
- **Pressure at a point** drives the **barometer** instrument (falling fast = a storm coming).

### 5.2 Fog
- **Fog banks** are entities (position, radius, density, drift with the wind, lifetime), spawned by rules:
  - **Advection fog:** warm air over cold water (May–July especially) with light-to-moderate wind, so drifting banks over open water.
  - **Radiation fog:** clear, calm nights in late summer and fall, so dawn fog in bays and near shores that burns off by mid-morning.
  - Fog near shores and islands persists longer in the lee.
- `visibilityAt(pos)` = min(daylight/moon factor, precipitation factor, fog factor from banks plus global haze).

### 5.3 Precipitation & storms
- Rain or snow comes from lows (snow when air < ~0 °C). Intensity scales with system strength and position (fronts).
- **Thunderstorms** in summer: short, local, with gust spikes and lightning (brief illumination that reveals you at night).
- **Gales and storms** (deep lows): high wind, big waves, low visibility, cold.
- **Scripted historical storm (proposal):** if a run reaches late November 1905, the **Mataafa Storm (Nov 27–28, 1905)** happens as a guaranteed event, with newspaper foreshadowing. An Easter egg for long runs.

### 5.4 Forecasting & signs (player-facing)
| Source | What it tells you |
|---|---|
| **Barometer** (HUD instrument) | Pressure and trend: steady, falling, falling fast |
| **Sky** | Cirrus "mares' tails," halos, a darkening western sky, wind backing |
| **Port storm signals** | Ports fly **storm warning flags** when a big low approaches (✅ the storm signal used on the Great Lakes since 1871 was a red flag with a black square by day and a red light at night; wind flags were added in the mid-1890s; [NWS heritage](https://vlab.noaa.gov/web/nws-heritage/-/a-brief-history-of-signal-flags). Which ports flew which flags in 1900 is ❓) |
| Saloon rumors, newspapers | General outlook ("old-timers say a blow is coming") |
| **Chart** | Known fronts and storm cells shown with uncertainty that grows with distance and age |

**Storms are opportunities:** the cutter and freighters seek shelter in gales, harbors are full of storm-bound ships (docks heists), and wrecks happen. Wrecking (moon cussing) is most effective in storms and dark nights, and most dangerous to the player.

---

## 6. Waves

### 6.1 From weather to wave parameters
- **Significant wave height** at a point = f(wind speed, **fetch** in the wind direction, **duration** the wind has blown), minus **shelter** reduction, plus **swell** from distant strong systems.
- Fetch maps are baked alongside the shelter maps (16 directions per zone, the same pipeline step). Short fetch near the upwind shore means a calm sea; a long fetch across the open lake means big seas.
- **Duration:** wave height lags behind wind changes (it builds over ~1–3 game hours), so a sea keeps running after the wind drops. That's realistic, and readable.
- **Lake character:** Great Lakes waves are **shorter and steeper** than ocean waves for the same height. Use shorter wavelengths and higher steepness caps than an ocean preset. Real lake sailors fear the short, steep chop.

### 6.2 Gerstner set (shared GPU/CPU)
- The wave height and direction spread map to a **set of N Gerstner waves** (amplitude, wavelength, direction, steepness, phase speed).
  - N by preset: **Low 4, Medium 6, High 8**.
  - Gameplay (buoyancy) always uses the first 4 so that physics is identical on every preset.
- Parameters are uploaded as a small uniform array. The CPU uses the same array ([01 §4.1](01-tech-architecture.md), [02 §5.1](02-arcade-sailing.md)).
- Steepness is capped to avoid loops. Storms raise amplitude and steepness, and add crest foam.

---

## 7. Water Rendering (stylized, cheap)

| Element | Approach | Cost notes |
|---|---|---|
| Mesh | Camera-centered radial or concentric LOD grid (dense near, sparse far), with Gerstner vertex displacement | One draw call (two with a far ring) |
| Normals | Analytic from the Gerstner set, plus one scrolling detail normal map (Medium+) | Cheap |
| Color | **Depth bands** from the zone depth texture: shallow over sand or red sandstone → teal/amber; deep → dark slate blue. Toon-banded per the art style. | One texture lookup |
| Foam | Shoreline foam from the **shoreline SDF**, crest foam from wave steepness (Medium+), wake foam from a ribbon/decal | Fill-rate aware |
| Specular | Stylized sun and moon glint path (banded) | Cheap |
| Reflections | **Sky color/gradient only.** No planar or screen-space reflections (iGPU budget). A High-only low-res option is on the cut list. | — |
| Transparency | **Opaque water** (fake depth through color bands), so there's no refraction or transparency overdraw | Big iGPU saving |
| Horizon | Blends into the fog color; distance fog hides mesh edges | — |
| Rain | Darker, rougher water (uniforms); ripple rings on High only | — |

**GPU budget (water):** ≤ 3 ms on the Medium preset on the baseline laptop at the target resolution. Measured in spike S2.

---

## 8. Ice

### 8.1 Simulation
- **Coarse ice grid per zone** (e.g., 64×64 cells across a zone) with coverage (0–1) and thickness (cm).
- Updated daily (per game day): growth from **freezing degree-days** (air temperature from climate plus the year's severity), starting in shallow bays and near shore and spreading outward. Melt and breakup from thawing degree-days, plus wind-driven breakup at the ice edge in spring.
- Chequamegon Bay (sheltered, shallow) freezes reliably. The open lake beyond the islands rarely freezes completely (per R1).
- **Ice-out** produces drifting **floes** for ~1–2 weeks: a floe field entity on the chart, plus instanced floes in zones.

### 8.2 Gameplay outputs
- `iceAt(pos)` → `{coverage, thickness}` for:
  - **Sailing:** drag, damage and blockage (02 §5.2).
  - **Walkable ice (proposal):** where thickness exceeds a safe threshold, the frozen surface becomes walkable in on-foot mode. That enables the **Bayfield ↔ La Pointe ice road**, walking to islands in winter, and ice-road smuggling (pull a sled with goods). **Thin ice** danger: cracking audio and visual warnings; falling through is deadly in winter (permadeath, with a brief chance to climb out).
  - Frozen harbors: ships are locked in for the winter, so winter docks heists target the stockpiles and laid-up ships.

### 8.3 Rendering
- Ice sheet: a masked surface layer over the water using the coverage grid (a texture), with stylized white/blue tones, snow drift noise and cracks.
- Floes: instanced low-poly meshes (≤ a few hundred visible), bobbing via the wave function.
- Shore ice and ice ridges: decals or simple meshes along the shoreline SDF (Medium+).

---

## 9. Sky, Lighting & Atmosphere

| Element | Approach |
|---|---|
| Sky | A stylized gradient dome shader driven by sun elevation and weather (cloud cover darkens and desaturates) |
| Sun / moon | A directional light that swaps between sun and moon, with intensity from elevation, phase and cloud cover. Moon disc with phase. |
| Stars | A star texture or point field fading in at night with clear skies |
| Clouds | 2–3 scrolling cloud layers on the dome (cover, density and speed from weather). Storm clouds are darker and lower. No volumetrics. |
| Ambient | Hemisphere light colors from **lighting LUTs** keyed by sun elevation × weather type, so the stylized palette is controlled by the art direction |
| Lightning | Flash (a brief ambient and directional spike) plus a bolt sprite, with thunder delay based on distance (audio) |
| **Aurora** | An occasional fall/winter clear-night event: a cheap animated ribbon shader on the sky dome. Pure atmosphere, very Lake Superior. |
| Night lights | Lanterns, windows and lighthouses as emissive plus a few real lights near the player. Lighthouse beams per [01 §4.3](01-tech-architecture.md). |
| Shadows | Per preset (Low: blob shadows; Medium: one near cascade) |

**Night readability:** nights must be dark enough for stealth but still playable. Use a moonlight floor, a slight blue tint, lanterns, and an optional brightness/gamma setting. A new moon in fog is the darkest it gets, by design.

---

## 10. Fog Rendering

- **Global fog** (exponential-squared) with color matched to the sky. Density follows `visibilityAt(camera)`, so inside a fog bank it's thick and in clear weather it's light haze. Distance fog doubles as the draw-distance limiter.
- **Fog banks seen from outside** (Medium+): a few large soft slabs or billboards with depth fade, so a fog wall is visible approaching across the water. On Low: global density only, with a smooth density blend as you approach a bank.
- **Audio in fog:** lighthouse **fog signals** (horns, bells, whistles; Two Harbors had a fog signal per R1) become navigation aids. Their sound direction helps locate the light.

---

## 11. Precipitation

- GPU particles around the camera (rain streaks and snowflakes), counts by preset (e.g., Low 1k, Medium 4k, High 10k), using the wind direction for slant.
- A material **wetness** uniform (darker, glossier surfaces) and **snow cover** (white blend on upward-facing terrain and props by season and accumulation; a cheap shader term).
- Snow on the ground also enables **footprint tracks** on foot (plan 08/11 stealth risk).

---

## 12. Chart Representation

- Pressure systems as stylized swirl symbols with a "barometer" readout on hover. Fronts as period-style hand-drawn lines. *Built in Phase 3 ([03 §28](03-world-scale-chart-travel.md)) as L and H with their pressure and tracks, isobars every 0.02 inHg, and warm and cold fronts; the hover readout is still to do.*
- Fog banks as shaded patches. Ice extent as a hatched overlay. Storm warning flags at port icons.
- **Uncertainty:** known positions are stale (from rumors and signals) unless observed. The forecast cone grows over time. A barometer upgrade or a *Fisherman* background perk improves it.

---

## 13. Data & State

**Static data:**
- `climate.json`: monthly normals (§4.1).
- `weather_rules.json`: system spawn weights by month, intensity ranges, fog rules, precipitation thresholds.
- `wave_presets.json`: wind/fetch/duration → Gerstner set mapping tables.
- `lighting_luts/`: palette ramps per sun elevation × weather (art-owned).
- Baked per zone: shelter maps, **fetch maps**, depth texture, shoreline SDF (from 03's pipeline).

**WorldState.environment:**
- `calendar`: date (day, week, year), time of day, this year's rolls (ice-out, freeze-up, severity).
- `systems[]`: pressure systems.
- `fogBanks[]`.
- `ice`: per-zone coarse grids (coverage, thickness). Compact and compressible.
- `seaState`: per-zone wave build-up memory (for duration lag).
- `rngState` for the weather stream.

**Events:** `DayPhaseChanged` (dawn, day, dusk, night), `WeekChanged`, `MonthChanged`, `SeasonChanged`, `StormWarningRaised/Lowered {region}`, `FogRolledIn/Out {zone}`, `IceOut {zone}`, `FreezeUp {zone}`, `LightningStrike {pos}`, `AuroraStarted`.

---

## 14. Performance Budget Summary (Medium preset, baseline laptop)

| Item | Budget |
|---|---|
| Water (mesh plus shader) | ≤ 3 ms GPU, 1–2 draw calls |
| Sky plus clouds plus stars | ≤ 0.7 ms GPU, 1 draw call |
| Precipitation | ≤ 1 ms GPU (particle count by preset) |
| Fog banks (visual slabs) | ≤ 0.5 ms; off on Low |
| Ice floes | Instanced; ≤ 2 draw calls |
| Weather sim (world tick) | ≤ 0.2 ms amortized |
| Environment queries | ≤ 0.1 ms per gameplay tick total |

---

## 15. Phasing

| Phase | Environment scope |
|---|---|
| **1 (Sailing prototype)** | Water mesh and shader, Gerstner waves (shared CPU/GPU), dev-panel wind and wave control, baked shelter and fetch for the test bay, basic day/night (sun and moon, sky gradient), global fog |
| **2 (Superior slice)** | Calendar and clock, sun/moon from date, weather systems v1 (wind from systems), fog banks, rain, clouds, barometer, lighting LUTs |
| **3 (Hybrid travel)** | Weather on the chart, forecasts with uncertainty, encounters with storm cells and fog banks. *Built (Phase 3 piece E, [03 §28](03-world-scale-chart-travel.md)): the sim drives the chart's wind; isobars, fronts, rain, fog banks, squalls and wind drawn; a forecast to 24 h; squalls (`squallAt`, with cold squalls in a gale's rain) and fog banks met from the sim.* |
| **5 (Law)** | Visibility feeds stealth and detection, moon phase, storm warnings at ports |
| **9 (Seasons & secrets)** | Full seasonal cycle, ice sim and rendering, walkable ice, snow, aurora, year variation, the Mataafa event |

**The MVP ends at freeze-up (decided 2026-10-22).** Until Phase 9 ships winter, a run that reaches the first freeze-up reaches the end of MVP content: the game says winter arrives in a later build and the run stops there. Spring at the start (May 7) has no ice; floes come with the Phase 9 ice sim.

---

## 16. Spikes & Tests

| ID | Spike / test | Question |
|---|---|---|
| **S2** (existing) | Water and buoyancy | The shared Gerstner set looks good with depth bands, shore foam **and crest foam** at ≤ 3 ms GPU on Medium on the baseline laptop; a 4-wave CPU buoyancy matches the visuals |
| **S9** (Phase 0, done: §20) | Weather sim on the chart | A few moving systems produce believable, varied wind and pressure over a simulated month; a barometer trend predicts storms; fog banks spawn plausibly |
| Unit tests | Sun and moon vs. 1900 tables, climate interpolation, wave parameter mapping, ice growth and melt curves, determinism (same seed → same weather) | |

---

## 17. Cut List
1. Visible fog-bank slabs (global fog only).
2. Crest foam (shore foam only).
3. Aurora.
4. Shore ice ridges and decals.
5. Snow footprints.
6. Rain ripple rings and wetness.
7. Mataafa scripted storm.
8. Year-to-year variation (fixed climate every year).

*Not cuttable:* wind from weather, fog, storms, ice blocking navigation, day/night, moon phase, seasons.

---

## 18. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | 1 game day = 1 calendar week (a year is ~52 game days). |
| 2026-10-21 | Start the week of May 7, 1900. |
| 2026-10-21 | Walkable ice in winter (ice road, sled smuggling, thin-ice danger). |
| 2026-10-21 | Port storm warning flags as a forecasting aid. |
| 2026-10-21 | Mataafa Storm (November 1905) and aurora Easter eggs (both stay on the cut list). |
| 2026-10-22 | The MVP ends at the first freeze-up; winter rules arrive in Phase 9. |
| 2026-10-22 | S2 measures the water budget with crest foam on. S9 is a Phase 0 prototype. |
| 2026-10-23 | S2 passed: water 1.0 ms on Medium with crest foam on the baseline laptop. The shared 4/6/8-wave Gerstner set, the polar-grid mesh and six-point buoyancy are kept for Phase 1 (§19). |
| 2026-10-23 | S9 passed (§20): wind comes from the pressure field (geostrophic, slowed and turned by friction), the barometer trend is reconstructed by running systems backwards, and weather rates are per game day. *Proposed, pending review:* barometer classes at ±1 and ±3 hPa per 3 game hours. |

---

## 19. Spike S2 Results: Water and Buoyancy (2026-10-23)

**Question** ([01 §11.2](01-tech-architecture.md)): can a shared Gerstner wave set (≤ 4 waves on Low) look good and drive a bobbing hull within the Low and Medium budgets, measured on Medium with crest foam on?

**Answer: yes.** On the baseline laptop the water costs **1.0 ms on Medium with crest foam on** (budget ≤ 3 ms) and 0.5 ms on Low. The full test scene runs at 60 fps on Medium at full resolution.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Shared wave set (CPU half) | `src/sim/weather/waves.ts` | Up to 8 Gerstner waves. Each has amplitude, wavelength, compass direction, steepness share and phase. Deep-water dispersion (ω = √(g·k)). The summed steepness is capped at 0.9, so crests never loop. One packed array feeds both the CPU and the shader uniforms (`writeWaveUniforms`). |
| Water height query | `heightAt()` | Gerstner points move sideways, so the height at a fixed spot needs the rest position first. Three Newton steps on the 2×2 Jacobian keep the error ≤ 4 mm even at 2.5× the test sea; plain fixed-point iteration was off by up to 7 cm after three steps. Unit tests check that it lands on the query point. |
| Water shader (GPU half) | `src/render/water/water-material.ts` | The same loop in GLSL: displacement, analytic normals, three toon diffuse bands, banded sky tint at grazing angles, banded sun glint, crest foam where Σ steepness·sin θ passes a threshold (broken up by value noise). Opaque, with no reflections or refraction. Short waves fade out with distance so the coarse outer rings don't alias. |
| Water mesh | `src/render/water/water.ts` | A camera-centered polar grid, one draw call. Rings grow geometrically from 0.5 m at the camera to 2.5 km, past the fog. It snaps to 4 m steps so vertices don't swim. Low 56 × 96 (~11k tris), Medium 80 × 144 (~23k), High 112 × 192 (~43k). |
| Buoyancy | `src/gameplay/buoyancy.ts` | Six hull samples (bow, stern, and port and starboard pairs at ±L/4) on the **first 4 waves only**, so ship motion is identical on every preset. Heave is the mean; pitch is the fore trio vs. the aft trio; roll is port vs. starboard. Three damped springs chase the targets. |
| Test sea | `testBaySea(scale)` | A moderate northwest chop: 34, 22, 15 and 9 m gameplay waves, plus 6.2, 4.4, 3.1 and 2.3 m detail waves for Medium and High. Short and steep for a lake (§6.1). A "Sea state" slider in the dev overlay scales it from 0 to 2.5. |

### Findings
1. **Looks:** with 4 waves on Low the sea already reads as a lake chop rather than a sine wave, because the four gameplay waves cross at 50° and differ in length. The detail waves on Medium and High mostly add sparkle near the camera. Crest foam reads well at a threshold of 0.5. With 4 waves Low has fewer steep crests to foam, but Low has crest foam off anyway. Depth bands and shore foam wait for the S3 depth texture and shoreline field.
2. **CPU cost is negligible:** one `heightAt` (4 waves, 3 Newton steps) is ~0.6 µs, and buoyancy for **8 ships** is **~31 µs per tick** (Node 22 on a 2.1 GHz cloud Xeon; expect the same order on the 7730U). That is a small fraction of the 0.1 ms environment-query budget (§14).
3. **The CPU and the GPU agree where it matters.** Near the ship the shader runs the same formula on the same packed array. The only gap is the detail waves 5–8, worth at most ±0.21 m on High, and averaging over the hull hides them. No hull clipping showed in the test renders.
4. **Motion feel:** with the schooner tuning (heave 3.2 s, pitch 3.8 s, roll 4.6 s, damping 0.55) the hull rolls and pitches a few degrees in the test chop and lags the water slightly, which reads as weight. All values live in `schoonerBuoyancy()` for the Phase 1 tuning pass. Heel from wind is still to be added on top (02 §5.1).
5. **Draw calls:** the whole test scene is 4 (sky, water, hull and spars, sails), so the water's "1–2 draw calls" budget holds.

### GPU timing on the baseline laptop (2026-10-23)
Measured with `?bench=water` on a production build (`npm run preview`) on the Ryzen 7 7730U: Chrome 156 on Linux, ANGLE on OpenGL 4.6 (radeonsi, Mesa), MSAA off, device pixel ratio 1. Each value is the median over 150 frames, timed around render plus a 1-pixel `readPixels`. Chrome rounds `performance.now()` to 0.1 ms, so treat each value as ±0.1 ms.

| Preset | Buffer | Waves | Frame ms | Water ms | Crest foam ms | No water ms | Triangles | Draw calls |
|---|---|---|---|---|---|---|---|---|
| Low | 1190×816 | 4 | 1.2 | 0.5 | 0.1 | 0.7 | 11,590 | 4 |
| Medium | 1587×1088 | 6 | 2.0 | 1.0 | 0.2 | 1.0 | 23,830 | 4 |
| High | 1587×1088 | 8 | 2.0 | 0.9 | 0.2 | 1.1 | 43,750 | 4 |

**Result:** Medium with crest foam on is at **1.0 ms, a third of the 3 ms budget**, and crest foam costs about 0.2 ms. Low is far above its 30 fps floor. High matches Medium here because the display's pixel ratio is 1, so High renders the same buffer; its extra waves and denser grid add nothing measurable. The GPU timer in the overlay agreed (about 1.0 ms per frame on Medium in normal play).

**Headroom:** the water leaves roughly 13 ms of the 16.7 ms Medium frame for terrain, ships, sky and post-processing. The water's quality settings don't need cutting. If the budget gets tight later, the cheapest levers are still fewer water rings, then 4 shader waves on Medium.

**Caveats:** this is one machine on one browser, with MSAA off (High with MSAA needs `&quality=high` at load) and no Firefox run yet. Rerun the benchmark once depth bands and shore foam are added in Phase 1.

### Moving-camera fix (2026-10-24, from the S7 playtest)
Sailing in the S7 greybox, the dev saw the waves stutter. The polar grid's vertices are too far apart past about 50 m (Medium) to sample the 4–9 m waves, so those waves aliased into blocky shapes. Each 4 m snap of the grid to the moving camera resampled them, and the shapes jumped. The test scene never showed it because the ship held still. The fix:
- **Geometry** displaces only with waves the grid samples at least 2.5 times per wavelength where each vertex sits (`uGridOffset` and `uGridGrowth` come from `createPolarGrid`).
- **Shading** computes the wave normals and crest foam per pixel at the rest position, faded by the pixel's footprint, so the chop stays but no longer depends on where the grid vertices are.
- **Result:** in a frozen-time test that moves the camera 0.5 m per frame, the frame-to-frame change no longer spikes at each snap (before, it was about 2.5× normal every 4 m; after, it's flat). The bands now have smooth edges instead of triangle facets, which S4's style test can revisit.
- **Cost (baseline laptop, Chrome 156, ANGLE on OpenGL 4.6, radeonsi, 2026-10-25):** the same `?bench=water` run on a production build as the S2 table above, but at a larger buffer (1920×1088, about 21% more pixels than 1587×1088).

| Preset | Buffer | Waves | Frame ms | Water ms | Crest foam ms | No water ms | Triangles | Draw calls |
|---|---|---|---|---|---|---|---|---|
| Low | 1440×816 | 4 | 1.8 | 0.8 | 0.0 | 1.0 | 11,590 | 4 |
| Medium | 1920×1088 | 6 | 3.1 | 2.0 | 0.5 | 1.1 | 23,830 | 4 |
| High | 1920×1088 | 8 | 3.4 | 2.3 | 0.3 | 1.1 | 43,750 | 4 |

  **Result:** water on Medium with crest foam is **2.0 ms, still inside the 3 ms budget** but with about 1 ms of headroom instead of 2. Scaled to S2's buffer size, the old shader would be about 1.2 ms here, so the per-pixel waves cost roughly 0.8 ms. The whole frame is 3.1 ms of 16.7. If the budget gets tight, the levers are: shade only the detail waves (5–8) per pixel and keep vertex normals for the gameplay waves, or drop Medium to 4 per-pixel waves. A Firefox run gave the same picture with whole-millisecond timings (Medium about 2 ms). If it gets tight, the cheapest lever is per-pixel shading of the detail waves only (5–8) on Low.

### Decisions
- Keep the shared Gerstner set as designed: 4/6/8 waves by preset, buoyancy on the first 4, a steepness cap of 0.9.
- A camera-centered polar grid is the water mesh for Phase 1 (no far ring needed so far).
- Six hull samples plus damped springs is enough; no rigid-body solver (01 §5).

## 20. Prototype S9 Results: Weather Sim (2026-10-23)

**Question** ([01 §11.2](01-tech-architecture.md), §16): do a few moving pressure systems give believable, varied wind and pressure, a barometer that predicts storms, and plausible fog?

**Answer: yes.** Over the MVP season (May 7 to early December, 30 game days, 16 seeds) the sim gives calm summers and stormy Novembers, wind that backs and veers as systems pass, and fog that peaks in spring and early summer. A barometer falling 3 hPa or more in 3 game hours came before 92% of storms, with a median warning of about 9 game hours (about 22 real minutes at R = 24). The whole sim costs about 11 µs per world tick, against a 0.2 ms budget.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Climate normals | `src/sim/weather/climate.ts` | The §4.1 table as mid-month numbers, interpolated by calendar date (wind as a vector, so it turns the short way round). Adds rates per game day for lows and highs, the share of lows that become gales, storm-track weights, and fog weights. These are tuning placeholders and move to `data/climate.json` in Phase 2. |
| Pressure systems | `src/sim/weather/weather.ts` | At most 6 lows and highs on the true-scale chart. Each has a Gaussian pressure dip or bump, a straight-line track and a lifecycle (deepen, hold, fill). Lows come on three tracks: **Alberta clippers** from the northwest (fast), **Colorado ("panhandle") lows** from the southwest (the November northeasters), and **Pacific lows** from the west. Highs settle in from the northwest. |
| Wind | `windAt()` | Computed from the **pressure field itself**: geostrophic wind from the gradient, then slowed to 70% and turned 15° toward low pressure by surface friction. That gives counter-clockwise flow around lows and clockwise flow around highs for free, and the barometer and the wind can never disagree. A small seasonal background flow (3–6 kn) and a slow ±12° / ±15% drift sit on top. `gust01` rises in lows and when cold air crosses warm water in the fall. |
| Barometer | `barometerAt()`, `pressureTendency()` | Pressure plus the 3-hour change and a trend class (rising fast, rising, steady, falling, falling fast at ±1 and ±3 hPa per 3 h). Systems move in straight lines, so the past is rebuilt exactly by running each system backwards; no history buffer is saved, and the trend works at any point on the chart, not only where the player has been. |
| Fog banks | `spawnFog()`, `updateFog()` | Up to 12 banks. **Advection fog** forms over open water when the air is warmer than the lake, the wind is 3–16 kn, and the flow is from the south (moist). Banks are 10–35 km across, drift with the wind, and break up in strong wind, rain or cold air. **Radiation fog** forms in five bays (Chequamegon Bay, the Bayfield–La Pointe channel, Siskiwit Bay, the Duluth–Superior harbor and Agate Bay) on clear, calm nights and burns off between 8 and 11 in the morning. |
| Rain, visibility, air temperature | `precipitationAt()`, `visibilityAt()`, `airTempAt()` | Rain or snow sits ahead of deep lows. Visibility is the worst of 25 km haze, precipitation and fog. Air temperature is the normal plus a day/night swing plus warm or cold air carried by the wind. |
| Geography | `src/sim/weather/geography.ts` | A hand-placed outline of western Superior (cut at 90° W) for fog, the radiation-fog bays, and five probe points. It stands in until S3 bakes the real shoreline. |
| Chart page | `weather-sim.html`, `src/debug/weather-sim/` | Dev-only (`npm run dev`, then `/weather-sim.html`). A synoptic chart with isobars, systems and wind; western Superior with wind, rain and fog; a season strip to scrub; and the instruments at a probe. `?seed=` and `?day=` pick the run and moment. |
| Season report | `bench/s9/`, `npm run bench:weather` | Runs 16 seeds through the season, reads the instruments at the probes on every tick, and prints the tables below. `tests/weather.test.ts` guards the rules and the season shape in CI. |

### Wind and storms (Bayfield, mean of 16 seeds)
A game day is a calendar week (§3.2), so each calendar month below is about 4.3 game days. "Gales" counts how often the wind rose to 34 kn or more after at least 3 hours below it.

| Month | Mean wind | 90th percentile | Strongest | Time ≥ 28 kn | Time ≥ 34 kn | Gales | Lowest pressure |
|---|---|---|---|---|---|---|---|
| May | 10.8 kn | 21 kn | 47 kn | 5.7% | 2.4% | 0.3 | 979 hPa |
| Jun | 10.8 | 21 | 49 | 2.7% | 1.2% | 0.2 | 980 |
| Jul | 7.9 | 15 | 44 | 1.6% | 0.9% | 0.1 | 978 |
| Aug | 7.9 | 15 | 29 | 0.1% | 0.0% | 0.0 | 989 |
| Sep | 11.2 | 22 | 56 | 5.1% | 2.5% | 0.4 | 976 |
| Oct | 11.7 | 23 | 47 | 6.2% | 2.6% | 0.6 | 973 |
| **Nov** | **15.6** | **30** | **58** | **14.5%** | **7.8%** | **1.5** | **967** |

- **Direction:** summer winds come mostly from the south and southwest; by October and November the northwest and north lead, with real northeasters when a panhandle low passes south of the lake. Winds swing through 90–180° as a system passes, and that variety is what makes tacking and lee shelter matter (02 §11).
- **The whole western arm shares one weather.** Wind at Bayfield and at Duluth (about 100 km apart) correlates at r = 0.97. A low is 700–1,000 km across, so a zone can take one wind sample plus its shelter map, as §5.1 assumed. Local differences come from fog, shelter and a storm reaching Duluth an hour or two before the Apostles.
- **Overlap guard:** when two or three lows crowd together their dips would add up to pressures Superior never sees, so the combined dip is squeezed smoothly past 32 hPa, and sustained wind past 45 kn is squeezed toward 60 kn. The worst season-long readings were 967 hPa and 58 kn, close to the great November storms (the 1905 Mataafa Storm and the 1913 Big Blow had 50–60 kn sustained).

### Does the barometer predict storms? (Bayfield, 16 seeds)
A storm here is wind of 28 kn or more ("reef now", 02 §3.5) after at least 3 hours below it.

| Warning | Storms warned | Median warning before onset | Warnings followed by a storm within 18 h |
|---|---|---|---|
| Falling ≥ 1 hPa / 3 h | 76 / 77 | 13.8 game h | 50 / 241 (21%) |
| Falling ≥ 2 hPa / 3 h | 75 / 77 | 12.5 game h | 53 / 202 (26%) |
| **Falling ≥ 3 hPa / 3 h ("falling fast")** | **71 / 77 (92%)** | **8.8 game h** | **55 / 165 (33%)** |

What each reading is followed by in the next 12 game hours:

| Reading | Share of time | Mean strongest wind | Chance of a storm |
|---|---|---|---|
| Rising fast | 14.5% | 17.3 kn | 14.8% |
| Rising | 19.2% | 12.9 kn | 6.9% |
| Steady | 31.4% | 12.7 kn | 7.4% |
| Falling | 20.3% | 15.5 kn | 9.2% |
| **Falling fast** | 14.5% | **24.4 kn** | **34.0%** |

- **Readable, not a guarantee.** "Falling fast" makes a storm about five times as likely as "steady", and almost every storm gives one. Two out of three alarms bring only a stiff breeze, because many lows pass far enough away. That matches §1 goal 3: surprise exists, but it isn't random cruelty.
- **The rise after a low can blow too.** "Rising fast" carries a 15% storm chance: the northwest or north gale on the back of a deep low (screenshot 3). Sailors said "first rise after low foretells a stronger blow", so it fits the period and is a good thing for a saloon rumor to teach.
- **Lead time:** about 9 game hours is about 22 real minutes while sailing, enough to run for a harbor in a zone or to reroute on the chart. Port storm flags (§5.4) can fire on the same rule at their own position.

### Fog (16 seeds)
| Month | Bayfield time under 1 km | Bayfield time under 400 m | Days with thick fog (< 400 m), Bayfield | Same, all five probes |
|---|---|---|---|---|
| May | 1.7% | 1.0% | 16% | 16% |
| Jun | 2.2% | 1.3% | 25% | 25% |
| Jul | 2.5% | 1.4% | 16% | 19% |
| Aug | 2.7% | 1.7% | 20% | 20% |
| Sep | 1.0% | 0.6% | 10% | 10% |
| Oct | 1.0% | 0.5% | 6% | 8% |
| Nov | 7.9% (mostly rain and snow) | 0.1% | 1% | 1% |

- Spring and early summer fog is **advection fog**: wide banks drifting in on a southerly over cold water. Late summer and fall fog is **radiation fog**: dawn fog in the bays under a high, gone by mid-morning. November visibility drops in rain and snow, not fog. That's the seasonal pattern in R1 §2.7.
- **Frequency:** a game day is a full day/night cycle, so "thick fog on 16–25% of game days" in May–August is a little above the modern Duluth average (3–4 thick-fog days a month, about 12% of days). That's a deliberate lean toward gameplay: fog is a stealth tool (06) and a hazard, so it should show up most sessions in fog season. The rates are one constant each (`ADVECTION_PER_HOUR`, `RADIATION_PER_HOUR`).

### Cost (cloud container, Node 22)
| Item | Result | Budget |
|---|---|---|
| World tick, average | **11 µs** | ≤ 0.2 ms (§14) |
| Batch fast-forward, 12 game days (1,728 ticks) | **21 ms** | — (S6 measured 59 ms for everything else) |
| One `windAt` + `visibilityAt` + `pressureTendency` query | ~5 µs | ≤ 0.1 ms per gameplay tick for all queries |
| Saved state (`WorldState.environment.weather`) | ≤ 2.8 KB raw, ≤ 1.3 KB compressed | — |

The laptop should be in the same range; `npm run bench:weather` reruns it there.

### Screenshots (seed `s9-1`)
1. **Nov 12, 01:00, Bayfield:** 1027 hPa and **falling fast** (−4.3 hPa / 3 h), wind ESE 9 kn. A panhandle low is coming up from the southwest.
2. **Nov 15, 10:48:** nine game hours later two lows have deepened just west of the lake: 998 hPa, still falling fast, **S 40 kn** with rain.
3. **Nov 24, 18:00:** the back of a three-low cluster: 977 hPa and **rising fast**, **N 55 kn**, −7.6 °C. The worst blow of the season comes on a rising barometer.
4. **Jun 15, 07:50:** a weak Pacific low; advection fog banks over the lake, 264 m at Bayfield in a light SSW wind.
5. **Aug 28, 03:50:** under a high, calm and clear, radiation fog has pooled in the bays: 224 m at Bayfield, and banks at Two Harbors, Siskiwit and Chequamegon.

### Not covered yet (for Phase 2)
1. **Wiring into the game.** The weather state isn't in `WorldState` yet; adding it is a save-schema change with a migration (16 §7). The query functions take chart meters, so a zone converts with `zoneToChart` first.
2. **Shelter and fetch maps** (02 §11, §6.1) come from S3. Without them the wind is the same everywhere in a zone.
3. **Summer thunderstorms** (§5.3), drawn **fronts**, and lake-effect snow are not modeled. Thunderstorms would be small, short cells spawned in the warm sector of summer lows.
4. **Fog banks are round.** Stretching them along the wind would look better on the chart and in a zone.
5. **Clusters of lows** are soft-limited rather than merged. If merged super-lows read oddly on the chart, merge two lows that come within half a radius.
6. **Climate numbers are placeholders**, as §4.1 says. Check them against NOAA normals before the Phase 2 tuning pass.

## 21. Phase 1 Piece D: Wind, Waves and Sky (2026-10-25)

**Scope** (Phase 1 scope doc, piece D; §15 Phase 1 row): a `windAt` that meets the [02 §11](02-arcade-sailing.md) contract from dev-panel wind with drift, gusts and shelter; `waveParams` scaled by wind, fetch and shelter; a scripted gale; basic sun, moon and sky gradient; global fog.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Phase 1 weather | `src/sim/weather/local-weather.ts` | `createLocalWeather()` on `GameContext.weather`. Answers `windAt`, `waveParams`, `iceAt` (always clear) and `visibilityAt` per 02 §11. `windAt` returns the S9 `Wind` shape (`fromRad`, `speedKn`, `gust01`, `toKn`), so Phase 2 swaps the source without touching sailing. Time is game seconds, as in S9. |
| Wind | `windAt()` | Panel direction and speed, plus S9's drift (±`driftDeg` over a few game hours, ±`surge` in speed) and gusts (a few real seconds each, none in a calm). Shelter cuts speed by up to 85% (`SHELTER_WIND_LOSS`); funneling strength 0–1 adds up to 30% (`FUNNEL_GAIN`); the lee's edge gets extra gust. Gusts are **not** in `speedKn`: the sailing controller adds them (agreed with piece C). |
| Presets and gale | `WEATHER_PRESETS`, `GALE_SCRIPT` | Calm, light, moderate, fresh, strong and gale across the 02 §3.5 bands. The scripted gale is a November blow: ESE 14 kn backs NE and passes 38 kn within 3 real minutes, holds 44 kn, veers NW on the back side and eases to 20 kn by 11 real minutes, with cloud and visibility to match. It hands back to the panel when it ends. |
| Wind to waves | `src/sim/weather/sea-state.ts` | Fetch-limited JONSWAP fits capped at a fully developed sea give Hs and the peak period; the peak wavelength is the deep-water one × 0.85 (lake chop, §6.1). Eight waves keep the S2 test sea's ratios relative to the peak, so the first 4 always carry the motion. Steepness is 2.6 × k·A per wave (cap 0.32, total 0.9). The sea eases toward the wind with a 45 game-minute lag (§6.1 duration), direction twice as fast. |
| No-jump retuning | `retuneSea()` | Every change of k, ω or direction re-solves each wave's phase so the surface at the player doesn't move. Far away the pattern slides a little per change, which slow per-tick easing keeps invisible. |
| Local sea scale | `SeaScaleGrid` in `waves.ts`, `bakeSeaScale()` | One global wave set (shared GPU/CPU) times a local scale: √(fetch / reference fetch), clamped 0.15–1.25, then up to 80% off at full shelter. A byte grid of at most 256 cells a side over the shelter field's bounds, sampled bilinearly on the CPU (`heightAt`, `hullTargets`) and as an R8 texture in the water shader (one fetch per vertex and per pixel). The reference fetch is the 90th percentile over the zone. Rebaked 16 rows per tick when the wind turns 4°. |
| Shelter source | `src/sim/weather/shelter.ts` | The `ShelterField` interface piece B's terrain loader satisfies (shelter 0–1, fetch in real meters, funneling strength 0–1, 16 directions blended). Until it lands, `stubIslandShelter()` gives round islands a lee 15 heights long, and the test scene draws one greybox island 780 m northeast of the start. |
| Sun and moon | `src/sim/weather/celestial.ts` | Cooper's declination and the standard elevation and azimuth formula at 46.8° N, local solar time = the game-day hour, season from the compressed calendar. The moon's phase is from the synodic month (checked against May 1900 tables); its path is the sun's, trailing by the phase angle with the declination of half a year on at full. |
| Sky, light and fog | `src/render/sky.ts`, `src/render/environment.ts` | The dome adds a sun disc and low-sun glow, a phased moon disc lit toward the sun, and hashed stars on clear nights. A palette keyed by sun elevation (night, nautical twilight, sunset, golden hour, day) drives the dome, the hemisphere light and fog color; cloud grays and darkens it. One directional light swaps between sun and moon, with a moonlight floor at night. Fog is exp² from the visibility (2% at V), floored at 1.8 km so the 2.5 km water disc edge stays hidden. The water's colors scale with the light, and its crest foam threshold falls from 0.6 to 0.3 between 12 and 40 kn. |
| Dev panel | `src/debug/overlay.ts` | Wind and sea (preset, gale, direction, speed, drift, surge, gustiness, sea × wind, sea lag, visibility, cloud), Time (hour), and a readout of the wind, lee, local Hs and sun at the ship. URL switches for playtests: `?weather=gale`, `?gale`, `?wind=63`, `?knots=30`, `?day=0&hour=19.5`. |

### Numbers
| Wind | Fetch | Hs | Peak period | Peak wavelength |
|---|---|---|---|---|
| 14 kn (moderate) | 60 km | 0.9 m | 4.7 s | 30 m |
| 20 kn (fresh) | 60 km | 1.3 m | 5.3 s | 37 m |
| 36 kn (gale preset) | 60 km | 2.3 m | 6.5 s | 55 m |
| 45 kn | 200 km | 5.3 m | 10.4 s | 144 m |

The stub's open fetch is 60 km; drift moves these by ±15%. The S2 test sea that S2 and S7 tuned on was about Hs 2 m with a 34 m peak, which is steeper than any physical wind sea here; if Phase 1 sailing feels too tame, raise "Sea × wind" rather than the wind.

In the stub lee (wind from 63°, the ship 560 m behind the island's shore) the wind falls from 14 to about 9.5 kn and the sea to 0.11 of open water, mostly from the short fetch. A schooner there heaves less than half as much as in open water (unit test).

Cost in the cloud container: a weather tick 1.2 µs (p50), `windAt` 0.3 µs, a full 256-row scale bake 12 ms with the stub (spread over 16 ticks at under 1 ms each). On the baseline laptop (AMD Radeon Renoir, Chrome 156, MSAA off, 2026-10-25, with the Apostles test bay and the sea-scale texture), the water bench gives:

| Preset | Waves | Frame ms | Water ms | Crest foam ms | No water ms |
|---|---|---|---|---|---|
| Low | 4 | 1.70 | 0.80 | 0.00 | 0.90 |
| Medium | 6 | 2.90 | 1.30 | 0.40 | 1.60 |
| High | 8 | 3.30 | 1.60 | 0.30 | 1.70 |

Medium water is 1.3 ms of its 3 ms budget, so the extra texture fetch fits. It is below the 2.0 ms recorded in §19 after the stutter fix, but that run was on a different scene, so don't read it as a speed-up. Piece F's rerun with shore foam and depth bands is still due.

### Screenshots
`/mnt/project-files/wind-sky/` in the project: day, dusk, night, gale, the lee behind the stub island, and the moon's phases.

### Not covered yet
1. **Real shelter maps.** Swap `ctx.weather.shelter` for piece B's loaded terrain and call `invalidate()`. Fetch from the bake is real meters; the scale only cares about ratios.
2. **Swell** from distant systems (§6.1) and **fetch-dependent wavelength** across the zone: the wavelength is global, only amplitude and steepness vary locally.
3. **Fog banks, rain, clouds and lightning** stay Phase 2, as does wind from the S9 sim and the save-schema change it needs.
4. **The palette is a stand-in** until the art style test (piece A) picks a look and plan 14's lighting LUTs replace it. The moon is drawn four times life size so it reads on screen.
5. **The moon's path** is approximate (no inclination or libration); fine for light and phase, not for navigation.

## 22. Phase 1 Piece F: Water Look and Speed Cues (2026-10-25)

**Scope** (Phase 1 scope doc, piece F): depth bands and shore foam from the S3 bake, a far-water LOD ([03 §15](03-world-scale-chart-travel.md) S7 finding 3), bow wave, wake ribbon, spray, wind streaks and cat's-paws ([02 §8–9](02-arcade-sailing.md)), and a rerun of the water bench.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Shore texture | `src/render/water/shore.ts`, `LoadedZone.seabed` / `.shoreline` | One RG8 texture over the **whole zone** at 8 m (897 × 1025, 1.8 MB), so the bands and foam reach the far islands, not just the 3 km slice. R is √(depth / 32 m), which keeps the shallow bands sharp; G is the distance to shore from −16 to 112 m. The loader keeps every second height and SDF sample of the zone while it reads the tiles. The outer texels are open deep water and the texture clamps to them. One texture fetch per pixel. |
| Depth bands | `water-material.ts` | Toon steps on top of the S2 shading: deep slate past 9 m, two teal steps at 9 m and 4 m, and amber sand under 1.5 m (plan 14 §2 "Lake"), with one-pixel antialiased edges. The colors scale with the light like the rest of the water. |
| Shore foam | `water-material.ts` | A wash line on the beach whose width follows the surf, and lines of surf running in to it every 6 m, out to 5–20 m from shore. Surf strength is the significant wave height (0.15–1.5 m) times the local sea scale, so a lee shore is quieter than a weather shore. The surf lines fade out where a pixel covers more than a meter or so, so they don't shimmer far away. |
| Far water | `water.ts` `WATER_FAR_RADIUS_M` | The polar grid keeps adding rings at the same growth past 2.5 km out to **10 km**: 14 more rings on Medium (about 4k triangles), still one draw call. Waves have faded by then, so the far rings are flat. The clear-air fog floor moves from 1.8 km to **6 km** (`MAX_FOG_VISIBILITY_M`), which leaves under 0.1% of the color at 10 km, and the camera's far plane goes to 10.5 km. On a clear day the islands across the zone now show over open water. |
| Bow wave and wake | `src/render/water/wake.ts` | Per ship, three ribbons in one draw call (about 300 triangles): the two arms of the bow wave from the bow's shoulders, spreading at 24° (real Kelvin waves are 19.5°, widened so 24 visual knots read), and the churned wake from the stern, widening to 2.2 beams over 9 s. Points are laid every 2.5 m or more (at most 48 per ribbon) and stay where they were laid, so the wake marks the track. The vertex shader floats them on the same waves as the water with the same grid fade (`wave-glsl.ts`, shared uniforms), so they don't sink into the swell. Opaque with a dissolve edge: white foam over a band of churned lighter water, no blending. The hull's waterline is measured from the model's vertices near y = 0, so it fits piece H's hull without changes. Strength follows scene speed, full at 10 m/s (about 20 visual knots), none astern. |
| Spray | `src/render/water/spray.ts` | Toon puffs thrown off the bow: up to 10 a second at full speed, up to 4× that when the bow drops into a wave (pitch rate). Ballistic with drag, 0.8–1.4 s each. One point-sprite draw call for every ship; the pool is a preset setting (`sprayParticles`: Low 24, Medium 64, High 128). |
| Cat's-paws | `src/render/water/wind-cues.ts`, `water-material.ts` | Darker patches with fine ripples where a gust is coming. `windAt`'s gusts are a function of time, so each frame the CPU samples the gust at the ship for the next 16 real seconds, and the shader draws, at a spot the air takes s seconds to carry to the ship, the gust that arrives in s seconds. The patches drift downwind at the wind's scene speed (v × R / C, like ships), so a patch reaches the ship with its gust: a skilled player sees a gust 100–300 m upwind and can reef before it hits. From 4 kn, full from 10 kn. |
| Wind streaks | `water-material.ts` | Short, slightly wavy foam streaks along the wind, from 14 kn and full at 32 kn, weaker in a lee. |
| Water bench | `src/debug/water-bench.ts` | Now times each feature on its own: crest foam, shore (depth bands and shore foam), wind cues, and wake plus spray, and the water's total with the wake and spray hidden too. If the ship isn't moving it first sets full sail and sails 20 s so there is a wake to draw. |

### Cost
Baseline laptop (AMD Radeon Renoir, Chrome 156, MSAA off, 2026-10-29, `?bench=water` on a production build, ship under full sail so the wake and spray are drawn). Each feature column is the frame time minus the median with that feature off; Chrome rounds to 0.1 ms, so treat a column as ±0.2 ms and a negative value as zero.

| Preset | Buffer | Frame ms | Water ms | Crest foam ms | Shore ms | Wind cues ms | Wake ms | No water ms | Triangles | Draw calls |
|---|---|---|---|---|---|---|---|---|---|---|
| Low | 1416×784 | 2.70 | 1.30 | 0.60 | 0.30 | 1.50 | 0.10 | 1.40 | 82,952 | 11 |
| Medium | 1888×1046 | 4.70 | 2.70 | 0.30 | −0.10 | 0.80 | −0.10 | 2.00 | 160,954 | 11 |
| High | 1888×1046 | 5.50 | 3.40 | 0.30 | −0.20 | 0.40 | 0.00 | 2.10 | 433,622 | 11 |

**Result:** water with everything on is **2.7 ms on Medium, inside the 3 ms budget** (§21 had 1.3 ms before piece F), and the whole frame is 4.7 ms of 16.7. Low's frame is 2.7 ms against a 33 ms floor. High's 3.4 ms is a little over the Medium budget, which only binds Medium. The triangle counts are the whole test bay, so they're far above §21's water-only counts.

**Where the 1.4 ms went:** the wind cues are the one real cost, about 0.8 ms on Medium (the cat's-paw and streak noise runs per pixel over the whole disc). Shore (one texture fetch plus a few steps) and the wake and spray (about 300 triangles and one point draw) are under the noise floor. Low's 1.5 ms for the cues is larger than its whole water cost of 1.3 ms, so it is run-to-run noise, not a measurement; rerun if Low needs a number. The remaining ~0.3 ms is crest foam and the far rings.

**If the budget gets tight:** the cheapest lever is cat's-paws to one noise octave, then off on Low, ahead of the §19 levers.

### Screenshots
`/mnt/project-files/water-cues/` in the project: the bay from above (depth bands, shore foam, wake), the chase view, the far islands over open water, a dusk view, and a gale.

### Not covered yet
1. **Firefox and a MSAA-on High run** are still unmeasured.
2. **A slightly lower FOV at speed** (02 §8) belongs to the camera (piece G).
3. **Rocks and shoals breaking:** surf only follows the shoreline SDF, so a submerged rock shows as a sand band with no foam.
4. **Wake on other ships** works the same way but is untested until NPC ships exist.
5. **Waves don't shoal:** they keep their open-water length and height into the shallows; the sea scale already calms lees and short fetch.

## 23. Phase 2 Piece A: Water Back in Budget (2026-10-29)

**Scope** (Phase 2 scope doc, piece A): the Phase 1 playtest ([02 §14](02-arcade-sailing.md)) read water on Medium at 3.3–4.9 ms against its 3 ms budget, up from 2.7 ms at §22, and Phase 2's terrain shader and vegetation will add load. Apply the §22 levers (cat's-paws to one noise octave, then off on Low, then the §19 levers) until water is at most 3 ms on Medium, and rerun the bench.

### What changed
| Change | Where | Effect on the look |
|---|---|---|
| **Water drawn after the land and ships** | `water.ts` (`renderOrder` 0.5) | None. The disc is centered on the camera, so three.js sorted it first among the opaque objects and the water shader ran on every pixel the land and hull later covered. Drawn after them (and before the wake, at 1), the depth test skips those pixels. The saving grows with how much land is on screen, so it matters more as the whole zone and its trees arrive. |
| **Cat's-paws to one noise octave** (the first §22 lever) | `water-material.ts` | The patches have smoother edges. A new threshold curve, `1 − g(0.2 + 0.27g)`, keeps the patch coverage of the old two-octave sum at every gust strength (fitted on 400k samples), so a gust shows as much dark water as before. |
| **Gust lookup in two taps** | `water-material.ts` `gustAhead` | None: the same linear interpolation between the two nearest of the 16 samples, instead of a 16-step loop per pixel. |
| **Cat's-paws off on Low** (the second §22 lever) | `quality.ts` `catsPaws`, `wind-cues.ts` | No cat's-paws on Low. Wind streaks stay on every preset, since they read the wind in a blow. |
| **Noise only where it can show** | `water-material.ts` | None. Ripples are only computed inside a paw, streaks only from 14 kn, and crest foam noise only where the crest is within the noise's ±0.125 of the threshold. Before, every pixel paid for all of them. |
| **Arithmetic hash** | `wave-glsl.ts` `hash` | Same character, different pattern. Value noise used `fract(sin(…))` at each of its four corners; it now uses an arithmetic hash (Dave Hoskins' hash12), with no `sin`, which is cheaper on iGPUs and keeps its precision 10 km from the origin. The wake shares it. |

The §19 levers (per-pixel shading of the detail waves only, or 4 per-pixel waves on Medium) aren't used yet. They're next if the laptop still reads over 3 ms.

Before and after (left old, right new, the same frame on Medium): `/mnt/project-files/water-budget/` in the project, cat's-paws at a building gust and wind streaks in a blow.

### Cost
**Cloud container (SwiftShader, CPU only, 2026-10-29), `?bench=water` on a production build at 960×540:** water on Medium went from 143.5 ms to 90.2 ms (−37%), and the wind cues from 44.9 ms to 4.3 ms. SwiftShader is a CPU rasterizer, its run-to-run spread is ±20 ms, and its cost balance isn't an iGPU's (smaller buffers in daylight showed only −10% to +3%), so these say the direction, not the laptop's number.

**Per pixel, by instruction count:** before, every Medium water pixel ran the wave loop (6 waves), the 16-step gust loop, five value noises for the wind cues (20 `sin` hashes) and two for crest foam (8 more), about 1,000 ALU operations. Now a typical pixel in a moderate breeze runs the wave loop, the two-tap gust and one arithmetic noise: about 450. The wind cues, measured at 0.8 ms on the laptop at §22, should drop to around 0.1–0.2 ms.

**Baseline laptop** (AMD Radeon Renoir, Chrome 156, ANGLE on OpenGL 4.6, MSAA off, 2026-10-29, `?bench=water` on a production build, run by Jared). Columns as in §22; treat each as ±0.2 ms.

| Preset | Buffer | Frame ms | Water ms | Crest foam ms | Shore ms | Wind cues ms | Wake ms | No water ms | Triangles | Draw calls |
|---|---|---|---|---|---|---|---|---|---|---|
| Low | 1440×816 | 2.10 | 1.10 | 0.10 | 0.00 | 0.00 | 0.00 | 1.00 | 90,162 | 35 |
| Medium | 1920×1088 | 4.10 | 2.20 | 0.00 | 0.00 | 0.30 | 0.10 | 1.90 | 177,982 | 35 |
| High | 1920×1088 | 4.80 | 2.60 | 0.00 | 0.00 | 0.30 | 0.10 | 2.20 | 489,230 | 35 |

**Result:** water on Medium is **2.2 ms, back inside the 3 ms budget** with 0.8 ms of headroom (3.3–4.9 ms at the Phase 1 playtest, 2.7 ms at §22). The wind cues fell from 0.8 ms to 0.3 ms, and crest foam from 0.3 ms to under the noise floor. High is at 2.6 ms, also under 3 ms now. Low's water is 1.1 ms with the cat's-paws off. The §19 levers stay in reserve for when piece C's terrain shader and trees arrive; rerun this bench then. *(Piece C landed, [14 §17](14-art-direction-asset-pipeline.md); the bench now also has terrain and vegetation columns, and the laptop rerun read Medium water at 2.5 ms with the land and trees drawn, still inside 3 ms.)*

## 24. Phase 2 Piece D: Weather v1 in the Game (2026-10-29)

**Scope** (Phase 2 scope doc, piece D; §15 Phase 2 row): the S9 systems drive `windAt` and `visibilityAt` behind the Phase 1 contract, `WorldState.environment` carries the weather with a save migration from v1, the climate numbers are checked against NOAA normals and moved to `data/climate.json`, a barometer goes on the HUD, and the dev panel stays as an override.

### What was built
| Piece | Where | Notes |
|---|---|---|
| Climate data | `data/climate.json`, `data/schemas/climate.ts` | Twelve mid-month entries. Air highs and lows and the lake temperature are measurements; an `observed` block holds the measured wind for checking; a `sim` block holds the sim's tuning (prevailing flow, lows and highs per game day, gale share, track and fog weights). Validated with the other data files in CI. `src/sim/weather/climate.ts` now reads it. |
| Air temperature | `airTempAt()` | The day swings between the normal low (03:00) and high (15:00) instead of a fixed ±4 °C around a "day" value, plus warm or cold air carried by the wind. |
| Weather in the zone | `createLocalWeather(…, sim)` in `local-weather.ts` | Given the saved `WeatherState` and the zone's frame (from the bake's manifest, with `defFrame()` from `data/zones.json` as the fallback), the wind, gustiness, visibility and cloud come from the sim, sampled once per tick at the player through `zoneToChart`. The whole zone shares that sample (§20: r = 0.97 between Bayfield and Duluth); the baked shelter, fetch and funneling maps still make the lees and channels. The sim's own drift replaces the panel's. Sailing, the sea, audio and rendering didn't change: they still call the 02 §11 queries. |
| The world tick | `advanceWeather()` | `weather.tick()` runs the sim forward a world tick at a time whenever 10 game minutes have passed, so a load, a migrated save or a `?day=` jump catches up the same way. |
| Cloud | `cloudAt()` in `weather.ts` | A stand-in until piece E: a deck spreading past a low's rain shield, broken cloud on an ordinary day, clear under a high. |
| Save v2 | `src/sim/world-state.ts`, `src/core/save/migrations/index.ts` | `environment.weather` (the S9 state, about 1–3 KB) is in the WorldState schema. The v1 → v2 migration gives a Phase 1 save an empty sky set 48 game hours in the past, with its own random stream derived from the run's (the run's stream is untouched); the game runs those 288 ticks on load (a few ms), as a new run's spin-up does. Fixture `tests/fixtures/saves/v2.json`. |
| Barometer | `src/ui/hud/` | Top left under the clock: inches of mercury, as a 1900 Great Lakes barometer read (29.92 is standard), and an arrow for the 3-hour trend (⬆ ↗ → ↘ ⬇ at ±1 and ±3 hPa). It turns red when falling fast. The hover title gives hPa. It's always shown for now; plan 13's "if owned" comes with the ship's instruments. |
| Dev panel override | `src/debug/overlay.ts`, URL switches | While the sim drives, the wind sliders follow it live. A preset, the scripted gale, a wind slider or `?weather=`, `?gale`, `?wind=`, `?knots=` takes the weather off the sim; **Use sim weather** hands it back. The sim keeps running underneath, and the barometer hides while the panel drives (the panel has no pressure field). The readout shows the source (`[sim]`, `[panel]`, `[gale]`) and the barometer in hPa. |
| NOAA check | `bench/s9/` (`npm run bench:weather`), `tests/climate.test.ts` | The report adds a sim-against-observed table. CI runs 8 seeds and checks each month's mean wind is within 2.5 kn of observed and gale time stays under 6× observed + 1 point. `S9_SEEDS=48 npm run bench:weather` gives the table below. |

### Sources
- **Air:** NOAA NCEI 1991–2020 monthly normals for **Madeline Island, WI** (USC00474953), in the middle of the zone. Daily highs run −5.5 °C (Jan) to 24.9 °C (Jul); lows −14.1 °C to 13.3 °C.
- **Lake surface:** the GLERL long-term daily mean surface temperature of Lake Superior (ERDDAP `glerlLTAvgTemp`) on the 15th of each month: 2.8, 1.3, 1.0, 1.4, 2.6, 5.4, 11.0, 15.8, 14.0, 9.7, 6.4, 4.2 °C. This is a whole-lake mean; Chequamegon Bay warms earlier.
- **Wind:** hourly NDBC observations at **Devils Island** (C-MAN station DISW3), 2012–2023: mean, 90th percentile, share of hours at 28 kn and 34 kn or more, and the vector mean. NDBC buoy 45006 (30 nm northeast of Outer Island, May–Nov) reads 1–3 kn lighter, as a 4 m anemometer should.
- These are modern normals. Around 1900 the region ran about 1 °C cooler; not applied.

### What the check found
| | Placeholder | Measured | Effect |
|---|---|---|---|
| Winter air | Jan −10 °C as a "day" value | high −5.5, low −14.1 | The old model's day swing was ±4 °C around a too-cold mean. Now high and low come straight from the normals. |
| Spring water | May 4 °C, Jun 8 °C | 2.6 and 5.4 °C | The lake is colder than assumed into June, so spring advection fog has more contrast. |
| Late-summer water | Aug 15 °C | 15.8 °C | Close. |
| May wind | from the SW | from the **NE** (vector mean 2.3 kn from 58°; NE is the most common sector, 27%) | The cold lake and lows passing south make May a northeaster month. Prevailing flow now 4 kn from 50°, more panhandle lows. |
| Summer–fall storms | 2–3% of May and Sep time at 34 kn or more | 0.1% | Gales were 10–20× too common outside fall. `deepShare` cut in May–Sep. |
| November | 7.8% of time at 34 kn or more, mean 15.6 kn | 0.95%, mean 14.0 kn | Cut to 4.4% (deepShare 0.55 → 0.22, more lows instead). |

### Result: the sim at Bayfield against Devils Island (48 seeds)
| Month | Mean wind sim / obs | 90th pct | ≥ 28 kn | ≥ 34 kn | Vector-mean wind sim / obs |
|---|---|---|---|---|---|
| May | 10.2 / 10.1 kn | 19.5 / 18.9 | 3.0% / 1.0% | 1.6% / 0.1% | 3.8 kn from 74° / 2.3 kn from 58° |
| Jun | 8.5 / 8.8 | 17.2 / 15.9 | 1.4% / 0.2% | 0.3% / 0.1% | 2.6 from 154° / 0.7 from 165° |
| Jul | 8.4 / 9.0 | 16.0 / 15.7 | 1.1% / 0.2% | 0.4% / 0.0% | 2.9 from 208° / 2.5 from 229° |
| Aug | 8.8 / 9.5 | 16.7 / 16.3 | 1.4% / 0.3% | 0.5% / 0.0% | 3.4 from 220° / 2.2 from 231° |
| Sep | 9.6 / 10.7 | 18.4 / 18.9 | 2.6% / 1.1% | 0.9% / 0.1% | 2.6 from 201° / 0.9 from 228° |
| Oct | 12.1 / 13.2 | 23.0 / 23.1 | 5.3% / 3.1% | 2.4% / 0.9% | 4.4 from 262° / 2.7 from 292° |
| **Nov** | **14.0 / 14.0** | 26.4 / 24.1 | 9.5% / 3.9% | **4.4% / 0.9%** | 4.8 from 254° / 5.8 from 275° |

- **Mean wind is within 1.1 kn** of observed in every month, and the direction of the vector mean within about 30° where it is more than 2 kn.
- **Storms lean deliberately stormy:** time at gale force is 2–5× observed. November gales are the season's signature (§4.1, §5.3), and a game November is only about 4 game days, so at the observed rate most players would never meet one. November still has the most gales (0.8 per seed), and July and August the fewest. The lever is `sim.deepShare` per month in `data/climate.json`.
- **The barometer still warns:** a fall of 3 hPa or more in 3 game hours came before 87% of storms (162 of 187), about 9 game hours ahead. "Falling fast" carries a 27% chance of a storm in the next 12 game hours, against 4.6% for "steady".
- **Fog** barely moved: thick fog on 14–25% of game days from May to August, and almost none in November.
- **Cost:** 16 µs per world tick, 22 ms to fast-forward 12 game days.

### Screenshots
`/mnt/project-files/weather-v1/` in the project: a November gale on the HUD (barometer red and falling), the same with the dev panel showing `[sim]` and the barometer readout, and a May noon.

### Not covered yet
1. **Fog banks you can see coming, rain, cloud layers and thunderstorms** are piece E. Visibility already drops inside a bank and in rain, so piece E draws what the sim already has.
2. **Port storm flags** (§5.4) are Phase 5.
3. **Fast falls can be extreme:** two lows closing in can drop the barometer more than 10 hPa in 3 game hours, more than Superior's worst storms. It reads as a clear warning, but if it looks odd, cap the tendency or merge close lows (§20, item 5).
4. **Year-to-year variation** (§4.2) isn't wired. The **chart's weather** is (Phase 3, [03 §28](03-world-scale-chart-travel.md)).
5. **Lake temperature is one number** for the whole zone; Chequamegon Bay warms weeks before the open lake.

---

## 25. Phase 2 Piece E: Sky and Atmosphere (2026-10-30)

**Scope** (Phase 2 scope doc, piece E): lighting LUTs from the photochrom palette, 2–3 cloud layers, fog bank slabs on Medium and up, rain and wetness, summer thunderstorms with lightning, all driven by the weather sim (§24).

### What was built

| Part | Where | How it works |
|---|---|---|
| Lighting LUTs | `src/render/style/lighting-luts.ts` | Four columns (clear, overcast, storm, fog) by six sun-elevation rows (−18° to 45°), each with zenith, horizon, hemisphere sky and ground colors and the ambient intensity. `sampleLighting` blends clear toward overcast by cloud cover (nothing until 20%, full at 100%), then toward storm by the storm amount, then toward fog by 80% of the fog amount, so thick fog keeps a hint of the hour. The old palette in `environment.ts` is gone; the sky, hemisphere light and scene fog all read this one table. |
| Clouds | `src/render/sky.ts` | Two scrolling layers on the dome (a thin high deck and a lower, larger-scaled layer), shaded in a lit band and a shadow body. Cover sets the threshold, a storm lowers and darkens the low layer, and the layers drift with the wind (0.0004 noise units per knot per real second). Low draws one layer at two noise octaves; Medium and High draw two at three. |
| Fog banks from outside | `src/render/atmosphere/fog-banks.ts` | One open cylinder per living bank (twelve at most, one geometry, one material each) standing where the sim's fog is half strength (three-quarters of the bank's radius): about 150 m tall for advection fog with a billowy top, 30 m for radiation fog. The wall softens toward its silhouette, fades out once the camera is well inside (the scene fog takes over), shades from gray at the water to bright at the top, and is dimmed at night. Not drawn on Low, which has the global fog only. |
| Rain | `src/render/atmosphere/rain.ts` | Up to 8,000 line-segment streaks in one draw, wrapped in a 56 × 40 × 56 m box around the camera in the vertex shader (no per-frame CPU work). They fall at 11 m/s, slant with the wind, and thin by prefix as the rain eases. Low 900, Medium 3,500, High 8,000. |
| Wetness | `stylized-material.ts`, `atmosphere.ts` | A `uWet` uniform darkens every toon-lit surface by up to 22%. It rises over 20 s of rain and dries over 150 s. |
| Thunderstorms | `thunderstormAt` in `src/sim/weather/weather.ts` | A sim query: warm air (mean high from 14 to 22 °C), real rain, and noise cells of about 25 km that drift east, so storms are summer cells inside a low's rain and not a winter event. January has none. |
| Lightning | `src/render/atmosphere/lightning.ts` | A seeded scheduler (a strike every 5–25 s, sooner the stronger the storm). Each strike picks a bearing and a distance of 0.9–6.5 km, flashes the hemisphere light and lights the clouds from that bearing (a strong stroke, then a weaker return inside 0.8 s), and 60% of strikes draw a forked bolt to the water. Listeners get the bearing, the distance and whether it reached the water, so thunder (piece H) can wait `distance / 343` seconds. |
| Sim to renderer | `src/sim/weather/local-weather.ts` | `LocalWeather.rainAt`, `stormAt` and `fogBanks` (zone meters). The panel presets and the scripted gale carry `rain01` (the gale's rain reaches 0.9). |
| Switches | `src/main.ts`, overlay | `?rain=`, `?storm=`, `?fog=` (meters), `?cloud=`, `?seed=` and `?fogbank=<m>` (`?fogkind=radiation`) put the weather where you want it for a look; the dev panel has Rain and Thunderstorm sliders and a line showing banks, streaks, wetness and strikes. |

### Cost

On the software renderer, only counts mean anything: Medium draws 43–45 calls and 146k triangles with banks, rain and sky on, about 2 draws for banks plus 1 for rain plus 1 for a bolt. The bolt and the walls are alpha-blended and fill-light, but the laptop rerun of the water bench is the real check (budget: 150 calls, 600k triangles).

### Notes

- Clear and overcast days look right; a thunderstorm goes dark green-gray with rain, and the lightning lights the clouds from the strike's bearing. The flash lights the sky and the hemisphere term but barely moves the toon-lit water, which reads as lightning far off.
- A fog wall is the color of the haze behind it at midday, so it reads as a pale band against the sky rather than a hard edge. It reads best at dusk and at dawn.

### Not covered yet

1. **Moon path on the water:** the moon is a lit disc with a phase; a reflected moon path is not drawn.
2. **Thunder and rain audio** and **fog signals** are piece H, which will use the strike listener.
3. **Snow and the aurora** are Phase 6 (§8, §11).
4. **Storm warnings** to the player (falling glass, the lightning-ahead cue) wait for the forecast UI.

---

## Changelog
- v0.11: Phase 3 piece E ([03 §28](03-world-scale-chart-travel.md)): `squallAt` (summer thunder and cold squalls in a gale's rain), the climate normals cached per game time, and the chart's weather built from §12 and §15.
- v0.10: Phase 2 piece E (§25): lighting LUTs (clear, overcast, storm, fog), two cloud layers, fog bank walls, rain streaks and wetness, summer thunderstorms and lightning, all from the weather sim; Rain and Thunderstorm in the dev panel.
- v0.9: Phase 2 piece D (§24): the S9 sim drives the zone's wind, visibility and cloud; weather in the save (v2, with a migration from v1); climate in `data/climate.json`, checked against NOAA normals and Devils Island wind and retuned; a barometer on the HUD; the dev panel as an override.
- v0.8: Phase 2 piece A (§23): water drawn after the land, cat's-paws to one noise octave and off on Low, a two-tap gust lookup, noise only where it can show, and an arithmetic hash. Water on Medium is 2.2 ms on the baseline laptop.
- v0.7: Phase 1 piece F (§22): depth bands and shore foam from a whole-zone shore texture, far water to 10 km with the fog floor at 6 km, bow wave and wake ribbons, bow spray, cat's-paws that show gusts before they arrive, wind streaks, and a per-feature water bench.
- v0.6: Phase 1 piece D (§21): dev-panel wind with drift, gusts, lee and funneling behind the 02 §11 contract; fetch-limited wind seas with lag and a local shelter and fetch scale shared by the CPU and the water shader; a scripted November gale; sun, moon, stars, a sky palette by sun elevation, and exp² fog from visibility.
- v0.5: Moving-camera wave stutter fixed (§19): geometry keeps only waves the grid can sample, shading is per pixel. Prototype S9 write-up (§20): pressure-gradient wind on three storm tracks, a barometer trend rebuilt from system tracks (92% of storms warned, about 9 game hours ahead), advection and radiation fog, and an 11 µs world tick.
- v0.4: Spike S2 write-up (§19): shared Gerstner set, water shader and mesh, buoyancy, CPU timings, and baseline-laptop GPU timings (water 1.0 ms on Medium with crest foam).
- v0.3: Gap review: MVP ends at freeze-up, S2 measures with crest foam, S9 in Phase 0, cutter winter lay-up and 1900 storm signals researched, §18 rewritten as decisions.
- v0.2: Decisions confirmed: 1 game day = 1 week, May 7, 1900 start, walkable ice, port storm flags, Mataafa and aurora.
- v0.1: Initial environment plan: architecture, calendar (with a decoupled season-calendar proposal), sun/moon, climate normals, weather systems, fog, storms, forecasting, waves (fetch, duration, lake character), stylized water rendering, ice sim and walkable-ice proposal, sky/lighting, fog and precipitation rendering, chart display, data and state, budgets, phasing, spikes, cut list.
