# 04 — Water, Weather, Seasons & Day/Night

Status: DRAFT v0.4 (decisions confirmed; gap review applied; spike S2 write-up added, GPU timings pending)
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

❓ marks in R1 apply. These numbers are tuning placeholders until checked against NOAA normals.

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

- Pressure systems as stylized swirl symbols with a "barometer" readout on hover. Fronts as period-style hand-drawn lines.
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
| **3 (Hybrid travel)** | Weather on the chart, forecasts with uncertainty, encounters with storm cells and fog banks |
| **5 (Law)** | Visibility feeds stealth and detection, moon phase, storm warnings at ports |
| **9 (Seasons & secrets)** | Full seasonal cycle, ice sim and rendering, walkable ice, snow, aurora, year variation, the Mataafa event |

**The MVP ends at freeze-up (decided 2026-10-22).** Until Phase 9 ships winter, a run that reaches the first freeze-up reaches the end of MVP content: the game says winter arrives in a later build and the run stops there. Spring at the start (May 7) has no ice; floes come with the Phase 9 ice sim.

---

## 16. Spikes & Tests

| ID | Spike / test | Question |
|---|---|---|
| **S2** (existing) | Water and buoyancy | The shared Gerstner set looks good with depth bands, shore foam **and crest foam** at ≤ 3 ms GPU on Medium on the baseline laptop; a 4-wave CPU buoyancy matches the visuals |
| **S9** (Phase 0) | Weather sim on the chart | A few moving systems produce believable, varied wind and pressure over a simulated month; a barometer trend predicts storms; fog banks spawn plausibly |
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

---

## 19. Spike S2 Results: Water and Buoyancy (2026-10-23)

**Question** ([01 §11.2](01-tech-architecture.md)): can a shared Gerstner wave set (≤ 4 waves on Low) look good and drive a bobbing hull within the Low and Medium budgets, measured on Medium with crest foam on?

**Status:** built and working; **the GPU timings on the baseline laptop are still to be run** (see "How to measure" below). Everything else is answered.

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

### GPU timing (to run on the baseline laptop)
**How to measure:** `npm run build && npm run preview`, then open `http://localhost:4173/?bench=water` in Chrome (and Firefox) on the Ryzen 7 7730U at the usual window size. The benchmark starts after 3 seconds and runs for under a minute. For each preset it times full frames with the water, with crest foam off, and with the water hidden; the difference is the water's cost. It then prints a Markdown table to the console and the overlay ("Copy results" copies it). Paste the table here. Open the page with `&quality=high` to measure High with MSAA on, since MSAA is fixed when the context is created.

**Pass criteria:** water ≤ 3 ms on Medium with crest foam on (§7, §14), and Low holding 30 fps.

**Sanity run (not the baseline):** the cloud container's software renderer (SwiftShader, CPU-emulated) produced these numbers. They only show that the benchmark works and the relative cost: water scales with the grid and the wave count, and crest foam costs little next to the vertex work.

| Preset | Buffer | Waves | Frame ms | Water ms | Crest foam ms |
|---|---|---|---|---|---|
| Low | 960×540 | 4 | 21.4 | 12.1 | 0.3 |
| Medium | 1280×720 | 6 | 40.2 | 24.5 | 1.0 |
| High | 1280×720 | 8 | 54.6 | 39.6 | 0.4 |

**If Medium is over budget on the laptop,** the cheapest levers, in order: fewer water rings on Medium (the vertex loop dominates), 4 shader waves on Medium too, then a lower Medium resolution floor. Crest foam stays unless it is the cause.

### Decisions this spike proposes (confirm after the laptop run)
- Keep the shared Gerstner set as designed: 4/6/8 waves by preset, buoyancy on the first 4, a steepness cap of 0.9.
- A camera-centered polar grid is the water mesh for Phase 1 (no far ring needed so far).
- Six hull samples plus damped springs is enough; no rigid-body solver (01 §5).

---

## Changelog
- v0.4: Spike S2 write-up (§19): shared Gerstner set, water shader and mesh, buoyancy, CPU timings; GPU timings on the baseline laptop pending.
- v0.3: Gap review: MVP ends at freeze-up, S2 measures with crest foam, S9 in Phase 0, cutter winter lay-up and 1900 storm signals researched, §18 rewritten as decisions.
- v0.2: Decisions confirmed: 1 game day = 1 week, May 7, 1900 start, walkable ice, port storm flags, Mataafa and aurora.
- v0.1: Initial environment plan: architecture, calendar (with a decoupled season-calendar proposal), sun/moon, climate normals, weather systems, fog, storms, forecasting, waves (fetch, duration, lake character), stylized water rendering, ice sim and walkable-ice proposal, sky/lighting, fog and precipitation rendering, chart display, data and state, budgets, phasing, spikes, cut list.
