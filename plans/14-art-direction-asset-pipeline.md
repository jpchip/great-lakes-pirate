# 14 — Art Direction & AI Asset Pipeline

Status: DRAFT v0.4 (style picked in S4: B, toon with per-object outlines)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan: stylized art; AI-generated 3D; period authenticity; the `references/` photos
- [01](01-tech-architecture.md): budgets, GLB/meshopt/KTX2, gltf-transform pipeline, Git LFS, MIT + CC BY licensing, the S1/S4 spikes, the iGPU baseline
- [04](04-water-weather-seasons.md): water, sky, lighting LUTs, seasons
- [08](08-docks-district-stealth.md) and [09](09-hideouts-building-crafting.md): kits, the character base
- [10](10-ship-upgrades-customization.md): attachments, cosmetics
- [11](11-exploration-islands-secrets.md): POI kits, animals
- [13](13-ui-ux.md): UI motifs, fonts
- [R1 §6](R1-western-superior-1900-research.md): visual references
Feeds: 15 (audiovisual cohesion), 17 (asset validation in CI)

## Purpose

Define how the game looks and how its assets get made:
- the art pillars, palette and mood
- the **style test** that picks the final look
- the unified stylized material that makes mixed-source assets cohesive
- which source to use per asset type (procedural and CC0 first, AI generation fills the gaps, hand-built last)
- AI tool and license rules for an open-source project
- the automated asset pipeline, budgets, animation and VFX style, and the MVP asset list

---

## 1. Art Pillars

1. **Moody Superior, storybook clarity.** Cold, atmospheric lake moods (fog, gales, dusk, ice) rendered with clean, readable stylized shapes.
2. **Readable silhouettes.** Ships, lighthouses and people read at a glance, even at night and in fog. That matters for gameplay (identification, stealth).
3. **Period-authentic.** 1900 ships, buildings, clothing and signage. No anachronisms that jump out.
4. **One look from many sources.** AI, CC0 and procedural assets must look like they belong together. A shared material and palette are mandatory.
5. **Cheap by design.** Flat or banded shading, small textures, instancing, and fog as a feature ([01 §5](01-tech-architecture.md)).

---

## 2. Mood & Palette

### 2.1 Core palette
| Element | Colors |
|---|---|
| Lake | Cold slate blue, deep navy offshore, teal/amber over sandstone shallows ([04 §7](04-water-weather-seasons.md)) |
| Cliffs and shores | **Red-brown Apostle sandstone**, pale sand beaches, dark wet rock |
| Forest | Deep pine green, **white birch** trunks, fall gold and red maple |
| Human-made | Weathered gray wood, **brownstone** red-brown, white lighthouse towers, red-brick light stations (Two Harbors), black steamer hulls, rust |
| Light | Warm amber lanterns and lighthouse beams against a blue night; a pale sun in fog |
| UI | Sepia ink, parchment, brass ([13 §2](13-ui-ux.md)) |

### 2.2 Palette reference (decided): photochroms
The **Detroit Publishing Company photochroms** (colorized photo prints around 1900, Library of Congress, public domain) show *exactly* our era and region (Great Lakes ships, Duluth, lighthouses) in a soft, limited, slightly unreal color palette. That's a perfect, historically grounded **color reference** for a stylized look. A mood board built from photochroms plus the `references/` photos guides palette ramps and lighting LUTs.

### 2.3 Time-of-day & season palettes
- **Lighting LUTs** per sun elevation × weather ([04 §9](04-water-weather-seasons.md)): dawn rose-gray, day cool blue-white, golden dusk, blue night, green-gray storm, white-gray fog.
- **Season tints:** spring (raw gray-green, lingering snow patches), summer (saturated greens and blues), **fall** (birch and maple gold and red; the most colorful season, and also the gale season), **winter** (white, blue shadows, ice teal).

---

## 3. The Style Test (spike S4, Phase 0)

### 3.1 Candidates (decided: narrowed to A and B; painterly dropped)
| | **A. Low-poly flat** | **B. Toon/cel + outlines** |
|---|---|---|
| Look | Faceted shapes, flat colors per face, crisp | Smooth shapes, 2–3 band lighting, ink outlines |
| AI-mesh tolerance | High (decimate hard, flat-shade hides noise) | High (bands and outlines unify) |
| Night and fog readability | Good | **Very good** (outlines help silhouettes) |
| iGPU cost | **Lowest** | Low–medium (an outline pass or inverted hull) |
| Production speed | **Fastest** | Fast |

Both suit the **fully scripted pipeline** (§7): they tolerate rough, auto-cleaned AI meshes well.

### 3.2 Test scene (same for both)
**Shrunk (decided 2026-10-22):** the T1 schooner (from the AI pipeline), water, fog on and off, and **one lighthouse beam**, rendered at **dusk** and at **night**. No island slice or character; those are judged later against the chosen style.

### 3.3 Scoring
Readability (silhouettes, night, fog) · cohesion of mixed-source assets · fit to the Superior mood · **GPU frame time on the baseline laptop** (Ryzen 7 7730U iGPU, [01 §13](01-tech-architecture.md)) · production effort per asset. The developer picks; the result is recorded in this plan.

**Decided (2026-10-25, S4): B, toon with per-object outlines.** Three light bands plus inverted-hull ink outlines on hero objects (ships, lighthouses, characters), with 1 px edge lines on open surfaces such as sails. On the baseline laptop this costs nothing measurable over flat shading (§3.4). The screen-space edge pass is dropped: it cost +0.5 ms on Medium and +1.5 ms on High for little visible gain.

### 3.4 Spike S4 progress (2026-10-25)
**Built, pick pending.** `/bench/s4/` (`npm run dev`) renders the §3.2 scene in four variants: **A** (flat, face normals from screen-space derivatives), **B0** (toon bands, no outline, to isolate the outline's cost), **B** (toon plus inverted-hull outlines on the schooner and light station, 1 px edge lines on the sails) and **B-edge** (toon plus a screen-space depth-edge pass). `?bench` times each variant × dusk/night × fog on/off × preset and prints a table to paste here. The hull pipeline (§7) runs end to end: `npm run assets:hull -- raw-assets/ships/schooner-t1`, steps in `tools/assets/README.md`. Meshy and nano-banana terms are in `assets/LICENSES.json`.

**Cloud check (software renderer, not a GPU):** at Medium 1280×720 under SwiftShader, A, B0 and B were within noise of each other (≈ 57–65 ms per frame), and B-edge cost about +35% (≈ +22–26 ms) for its full-screen pass and half-float target. B adds 10 draw calls and ~620 triangles (outline shells) to the scene's 17 calls and 24.3k triangles. Only the ratios mean anything; the laptop run decides.

**Seen in the renders:** the outlines do most for the sails and spars against a bright dusk sky; at night the moonlit sails already read in all variants, and the lamp, beam and glare carry the light station in fog. The edge pass also inks the light station and islet, but leaves a few stray lines on near wave crests.

**Baseline laptop (2026-10-25)**, Chrome 156 on Linux, ANGLE on OpenGL 4.6 (radeonsi renoir), placeholder hull. Buffers: Low 1440×816, Medium 1920×1088, High 1920×1088 with MSAA. Frame ms, median of batched frames, with the difference from A in brackets:

| Preset | Time | Fog | A flat | B no outline | B hull outline | B edge pass |
|---|---|---|---|---|---|---|
| low | dusk | off | 1.22 | 0.88 (−0.34) | 0.94 (−0.28) | 1.20 (−0.02) |
| low | dusk | on | 0.89 | 0.95 (+0.06) | 0.89 (+0.00) | 1.15 (+0.26) |
| low | night | off | 0.92 | 0.86 (−0.05) | 0.94 (+0.03) | 1.19 (+0.28) |
| low | night | on | 0.95 | 0.91 (−0.04) | 0.87 (−0.08) | 1.18 (+0.23) |
| medium | dusk | off | 1.90 | 1.96 (+0.06) | 2.13 (+0.23) | 2.42 (+0.52) |
| medium | dusk | on | 2.03 | 1.96 (−0.07) | 1.92 (−0.11) | 2.57 (+0.53) |
| medium | night | off | 1.93 | 1.98 (+0.04) | 2.09 (+0.16) | 2.41 (+0.48) |
| medium | night | on | 2.10 | 1.87 (−0.22) | 2.00 (−0.10) | 2.59 (+0.49) |
| high | dusk | off | 2.67 | 2.86 (+0.19) | 2.69 (+0.02) | 4.20 (+1.53) |
| high | dusk | on | 2.76 | 2.67 (−0.08) | 2.72 (−0.03) | 4.27 (+1.52) |
| high | night | off | 2.70 | 2.75 (+0.05) | 2.70 (−0.00) | 4.21 (+1.51) |
| high | night | on | 2.66 | 2.68 (+0.02) | 2.92 (+0.27) | 4.19 (+1.53) |

Draw calls and triangles per variant: A, B0 17 calls; B (hull outline) 27 calls and +620 triangles; B-edge 18 calls. CPU submit 0.11–0.20 ms everywhere.

**Findings:** (1) Toon banding costs nothing over flat shading: A vs. B0 is within noise (±0.2 ms) on every preset. (2) Inverted-hull outlines are also within noise: at most +0.27 ms, usually ±0.1, for 10 extra draw calls. (3) The screen-space edge pass is the only real cost: about +0.25 ms on Low, +0.5 ms on Medium and +1.5 ms on High, where the half-float target plus the MSAA resolve at full size dominate. It would use up most of Medium's post-processing budget (01 §5: "bloom or outlines"). (4) Every variant is far inside budget on this small scene (≤ 3 ms on High), so the pick can be made on looks.

**Pick:** B with per-object outlines (§16). The Meshy hull was not made: ships are built in code instead (§5, decided 2026-10-25), so it is no longer needed. The hull pipeline (`npm run assets:hull`) stays for any AI-made organic one-off.

---

## 4. Unified Stylized Material

One custom GLSL material (spike S1 picked `WebGLRenderer` + GLSL; [01 §14](01-tech-architecture.md)) is used by **every** mesh except water, sky and UI:

| Feature | Purpose |
|---|---|
| **Palette texture** (a shared color-ramp atlas) sampled by UV or vertex color | Forces every asset into the master palette, which gives cohesion |
| Banded (toon) diffuse, three bands (style B, §3) | Consistent lighting response |
| Optional small detail texture (wood grain, stone) at low contrast | Surface interest without realism |
| Rim light (subtle) | Silhouette readability at night |
| Emissive mask | Lanterns, windows, lighthouse lamps |
| Fog integration | Matches [04 §10](04-water-weather-seasons.md) |
| **Season and weather uniforms** | Snow cover on up-facing surfaces, wetness darkening, fall tint on foliage ([04 §11](04-water-weather-seasons.md)) |
| Palette-indexed **cosmetic colors** | Ship paint, sails and trim are cheap swaps ([10 §10](10-ship-upgrades-customization.md)) |
| Instancing support (per-instance color variant) | Kit pieces, vegetation, props |

**Palette-ization** (pipeline step, §7): AI-generated textures are **quantized and remapped to the master palette** (or replaced with palette UVs or vertex colors). This single step does the most to make AI assets look like part of the same game.

---

## 5. Asset Sources by Type

**Sourcing order (decided 2026-10-22):** procedural or CC0 first; **AI-generated assets fill the gaps** (Meshy for image-to-3D, nano-banana for images); hand-built only when neither works.

| Asset type | Primary source | Why / notes |
|---|---|---|
| **Player ships** (T1–T3 + variants) | **Procedural parametric hull generator** (decided 2026-10-25): hull lines from per-class parameters (length, beam, sheer, draft, stem and transom shape) plus deckhouse and hatch parts, an upgrade of the S2 placeholder schooner. Reference: `references/schooner.png` and the R1 photos | **Masts, spars and sails are procedural** (generated from per-class parameters: mast count, heights, sail plan, per-level sail shapes; [02 §13](02-arcade-sailing.md)). **Rigging lines are procedural** too. Attachment points come from a **per-class template** in data, so no manual placement is needed. |
| | **Built 2026-10-26 (T1, Phase 1 piece H):** `src/render/ships/` (`schooner-lines.ts` per-class record, `schooner-hull.ts`, `schooner.ts`). About 2.6k triangles and 16 meshes with every sail set, before outlines; outline shells on the hull, spars and furled canvas, 1 px edge lines on the sails, rigging as ink lines. The shell now sits 0.15 m behind the surface along the view ray (`outline.ts uDepthOffset`), which hides flipped slivers on thin or flared faces that otherwise showed as black streaks on the hull. | |
| **NPC ships** (package and bulk freighters, whaleback, sidewheel steamer, tug, fishing boats, cutter, schooner-barge) | **The same parametric generator**, with steamer parts (stacks, pilothouses, paddle boxes) | Lower budgets; reuse parts (deckhouses, stacks). Mostly boxy shapes, which suit code |
| **Characters** | One **CC0 base humanoid** (e.g., Quaternius-style) with period clothing variants (AI-generated accessories: hats, coats) | Shared skeleton for all ([08 §13](08-docks-district-stealth.md)) |
| **Animations** | **CC0 animation libraries** (e.g., Quaternius Universal Animation Library) plus a few custom ones | Avoid Mixamo-style terms that restrict redistributing raw files in a public repo |
| **Animals** (deer, bear, wolf) | CC0 packs, or AI plus auto-rig | Low poly |
| **Building kits** (hideout grid pieces, docks-district kit) | **Procedural/parametric or simple hand-modeled** pieces (exact 2 m / 3 m dimensions, [09 §4](09-hideouts-building-crafting.md)) | Grid pieces need precise dimensions and clean seams. AI is for decorative variants only. |
| **Props** (crates, barrels, nets, lanterns, carts, furniture) | **CC0 packs** (Kenney, Quaternius, CC0 subset of Poly Pizza) plus AI | Quick, consistent after palette-ization |
| **Vegetation** (pines, birch, maple, shrubs, rocks) | Simple procedural or CC0, plus **generated impostors** | Huge instance counts, so they must be tiny |
| **Terrain** | Geo pipeline heightmaps ([03 §8](03-world-scale-chart-travel.md)) plus a **shader** (slope and height bands: red sandstone cliffs, beach, forest floor, snow) | No painted textures |
| **Water, sky, weather** | Shaders ([04](04-water-weather-seasons.md)) | — |
| **Lighthouses** | A modular **lighthouse station kit** plus per-light variants (tower height and shape, brick vs. white, from R1 photos) | Recognizable real lights |
| **Figureheads, curios, trophies** | CC0 where one fits; otherwise **Meshy (optional)** through the hull pipeline; otherwise simplify or cut | Unique organic objects that are hard to build in code |
| **Sea caves** | **Procedural** (scripted cave meshes carved from noise or SDF shapes along the cliff line) plus AI rock props | Few; hero spots; no hand sculpting |
| **UI art** ([13](13-ui-ux.md)) | **Public-domain period engravings and ads** (pre-1929 sources) for newspapers and decorations; hand-made SVG icons; AI image generation for parchment and texture plates | Authentic and license-safe |
| **Concept art and orthographic references** | AI image generation: **the nano-banana (Gemini) skill is available and approved** for this | Inputs for image-to-3D (front, side and top orthographic sheets), mood boards, UI texture plates |

---

## 6. AI Tooling & Licensing (open-source rules)

- **Image-to-3D (decided 2026-10-22, narrowed 2026-10-25): Meshy, optional, for organic one-offs only** (figureheads, curios, trophies, maybe animals). Ships are procedural. S4 records its current terms in `assets/LICENSES.json`. Tripo and Rodin/Hyper3D are fallbacks only if Meshy's terms or results fail.
- **Image generation** (concepts, orthographic sheets, textures, UI plates): **nano-banana (Gemini CLI skill) approved for this open-source project, including shipped outputs** (decided 2026-10-22). Provenance records still apply to every shipped image.
- **License gate (mandatory before adopting a tool):**
  1. Outputs may be **publicly redistributed** in an open-source repo (we're not selling, but the repo is public and assets are CC BY 4.0).
  2. Check whether the free tier requires attribution, restricts ownership, or limits use. Record the terms (date checked plus a link) in `assets/LICENSES.json`.
  3. If the terms are incompatible, use that tool only for **concepts** (not shipped), or don't use it.
- **Provenance:** every shipped asset has a sidecar record: source (tool, CC0 pack, procedural, hand-made), author or tool, prompt or reference used, date, license, and modifications. CI fails if any asset lacks one ([§7](#7-asset-pipeline-toolsassets)).
- **CC0 and public domain** sources are preferred whenever they fit. They're the simplest for open source.

---

## 7. Asset Pipeline (`tools/assets/`)

**Decided: as fully scripted as possible.** Manual Blender work is a last resort, not a pipeline step. The project accepts somewhat rougher assets, compensated by the forgiving style (A/B), palette-ization and procedural parts.

```
raw-assets/<category>/<name>/   (Git LFS; source files + provenance.json + asset.yaml)
        │   asset.yaml = per-asset hints: category, target size (m), up/forward axis
        │   if known, waterline height (ships), attachment template id, LOD budget
        ▼
  npm run assets:clean  (scripted, headless Blender via bpy, no manual steps)
        │   - import AI output; delete loose/tiny junk islands; merge by distance
        │   - voxel/quad remesh when topology is bad (auto-detected), recompute normals
        │   - auto-orient (PCA on the bounding box + hints) and scale to the target size
        │   - pivot at base / waterline (from hints); bake to palette UVs or vertex colors
        │   - ships: strip anything above the deck line; attach procedural masts,
        │     sails and rigging from class parameters; place attachment empties from template
        ▼
  npm run assets  (scripted, gltf-transform + custom steps)
   1. Validate naming, scale, required nodes (attachments, LOD hints)
   2. Material remap → stylized material slots
   3. Palette-ize / resize textures (≤ 512 px typical, ≤ 1024 hero)
   4. Simplify → LOD0 / LOD1 / LOD2 (meshoptimizer) to category budgets
   5. Generate impostors for vegetation & far ships
   6. Compress: meshopt geometry, KTX2 textures (ETC1S or UASTC)
   7. Budget check (tris, textures, materials) → fail on violation
   8. Provenance/license check → fail if missing
   9. Write public/assets/<category>/<name>.glb + manifest entry
  10. Update CREDITS.md / assets/LICENSES.json
```
- **One command** rebuilds everything that changed (content-hash cache).
- **CI** runs steps 1, 7 and 8 on every push ([01 §10](01-tech-architecture.md)).
- **Regenerate, don't repair:** if the scripted clean step produces an unusable result, tweak the prompt or hints and regenerate, swap in a CC0 asset, or simplify the design. Manual Blender fixes are only for a handful of hero assets, and only if nothing else works.
- **Headless Blender** (`blender -b -P tools/assets/blender/clean.py`) is a dev dependency that runs **locally only**. CI never runs Blender; it validates the committed outputs and their provenance.
- **Preview sheet:** the pipeline renders a contact sheet (thumbnails of all processed assets in the stylized material) so the developer can review results at a glance and flag regenerations.

---

## 8. Budgets by Category (Medium preset; LOD0 / LOD1 / LOD2 triangles)

| Category | LOD0 | LOD1 | LOD2 / far | Textures | Notes |
|---|---|---|---|---|---|
| Player ship (incl. attachments) | ≤ 12k | 5k | 1.5k | 1× 1024 + palette | [01 §5](01-tech-architecture.md) |
| NPC ship | ≤ 8k | 3k | impostor | 512 + palette | |
| Character | 3–5k | 1.5k | 500 | Palette only | Shared skeleton |
| Animal | 2–3k | 1k | 300 | Palette only | |
| Kit piece (grid, docks) | 100–800 | (instanced) | merged proxy | Palette plus shared detail atlas | [09 §10](09-hideouts-building-crafting.md) |
| Prop | 50–1,500 | 50% | culled | Palette | |
| Tree | 300–800 | 150 | impostor | Palette plus a small leaf card atlas | Alpha-tested (no blending) |
| Lighthouse station | 3–5k | 1.5k | 400 | Palette | |
| Figurehead / curio | 1–3k | — | — | 512 | |

**Texture memory** per preset follows [01 §5](01-tech-architecture.md) (Low 128 MB, Medium 256 MB, High 512 MB).

---

## 9. Animation

- **One humanoid skeleton** for the player and all NPCs. GPU skinning, animation LOD ([08 §14](08-docks-district-stealth.md)).
- **Required clips (MVP):** idle, walk, sneak, run, carry (crate), vault/climb, ladder, swim, row, hold-interact (pick lock, dig, grapple), knockout (giving and receiving), tie-up, knife attack, pistol and rifle aim and fire, hit react, fall, death, search/look around, alerted point and shout, drink, sit, poker idle, helm steering, haul line.
- **Animals:** idle, walk, run, threaten, attack, flee, die (deer, bear, wolf).
- **Ships:** no skeletal animation. Flags use a vertex shader; sails are **static shapes per sail level** (no billow shader, [02 §13](02-arcade-sailing.md)). The rudder and wheel are simple transforms.
- **Diving suit:** a heavy-walk variant of the walk clip ([11 §6.2](11-exploration-islands-secrets.md)).

---

## 10. VFX Style

Stylized, few particles, matched to the palette. Sizes and counts scale by preset.

| Effect | Approach |
|---|---|
| Bow wave and wake | Ribbon mesh plus foam decal ([02 §13](02-arcade-sailing.md)) |
| Spray | A few billboard puffs |
| Cannon fire | Toon smoke puffs plus a muzzle flash sprite |
| Splash and hits | Stylized water columns and wood splinters |
| Boiler explosion | A big toon fireball, smoke column, debris (rare and dramatic) |
| Fire and smoke | Chimneys, distillery, burning wrecks; low particle count |
| Rain and snow | [04 §11](04-water-weather-seasons.md) |
| Lantern glow and lighthouse beam | Sprites plus a cone shader ([01 §4.3](01-tech-architecture.md)) |
| Aurora, lightning | Sky shaders ([04 §9](04-water-weather-seasons.md)) |

---

## 11. MVP Asset List (estimate)

| Category | Count (MVP) | Main source |
|---|---|---|
| Player ships | 3 hulls (+3 variants MVP+) plus attachments (~15) | Procedural hulls and rigging |
| NPC ships | ~9 classes | Procedural (shared generator) |
| Characters | 1 base + ~25 clothing and accessory variants | CC0 base + AI accessories |
| Animals | 3 | CC0 / AI |
| Hideout grid pieces | ~120 incl. variants ([09 §5](09-hideouts-building-crafting.md)) | Procedural / hand |
| Docks-district kit | ~60 pieces plus facades | Procedural / hand + CC0 |
| POI kits (lighthouse, quarry, fish camp, farm, cabin, caves) | ~50 pieces | Mixed |
| Props | ~80 | CC0 + AI |
| Vegetation | ~10 types plus impostors | Procedural / CC0 |
| Curios, figureheads, trophies | ~30 | AI |
| UI art | Icons ~150, paper plates, ~40 period engravings | SVG + public domain + AI plates |

This is a lot for one developer, which is why the pipeline is automated, kits are reused, CC0 is preferred, and the time box applies.

---

## 12. Historical Visual References
- `references/` photos (schooner, freighters, ferry); the **photochroms** (palette and scenes); **Sanborn maps** (docks layouts, [08 §2.2](08-docks-district-stealth.md)); NPS and USCG lighthouse photos (per-light variants); period clothing references (workwear, oilskins, bowler and slouch hats); period signage and type (for the UI and painted signs).
- **Avoid:** modern breakwaters (pre-1900 harbor corrections, [03 §8.1](03-world-scale-chart-travel.md)), the Duluth aerial bridge (1905), and the concrete ore docks of 1907+.

---

## 13. Phasing
| Phase | Art scope |
|---|---|
| **0** | **S4 style test** (pick A or B, shrunk scene §3.2), the T1 schooner through the full pipeline, the unified material v1, palette v1, the license gate for the chosen tools |
| 1 | Placeholder-plus ship, water and sky look, sail meshes and shader |
| 2 | Terrain shader (sandstone, beach, forest), vegetation plus impostors (built, §17), the lighthouse kit, lighting LUTs |
| 4–6 | NPC ships, character base plus animations, props |
| 7 | Docks-district kit, characters' period variants |
| 8 | Hideout grid pieces (all materials), crafting stations |
| 9 | POI kits, caves, animals, curios, season palettes, aurora and VFX polish |
| 11 | Art polish pass, consistency review |

---

## 14. Risks
| Risk | Mitigation |
|---|---|
| AI meshes are messy (merged sails and rigging, bad topology) | Generate hulls only; procedural masts, sails and rigging; scripted remesh; regenerate or replace |
| Fully scripted cleanup gives rough results | Forgiving style (A/B), palette-ization, LOD and fog; contact-sheet review; CC0 fallback |
| Inconsistent look across sources | Palette-ization plus the unified material, enforced in the pipeline |
| AI tool terms change or forbid redistribution | The license gate, provenance records, CC0 fallbacks |
| Art workload overwhelms a solo developer | Kits, CC0-first, automation, the cut list |
| Outlines (style B) too costly on the iGPU | Inverted-hull outlines on hero objects only, or outlines on High only |

---

## 15. Cut List
1. Hull variants' unique meshes (recolor plus small attachment changes only).
2. Painterly detail textures.
3. Character clothing variety (fewer variants).
4. Animated rudder and wheel.
5. Per-light unique lighthouse towers (two or three shared tower styles).
6. Season foliage color changes (keep only snow).

---

## 16. Open Questions

All resolved. The final A-vs-B pick happens in spike S4 (shrunk scene).

### Decisions
| Date | Decision |
|---|---|
| 2026-10-21 | **Photochroms** (Detroit Publishing Co., public domain) are the main color and mood reference. |
| 2026-10-21 | **AI image generation** approved for concepts, orthographic sheets and UI plates; **nano-banana (Gemini)** may be used (license-gated for shipped outputs). |
| 2026-10-21 | **Public-domain period engravings and ads** for newspapers and UI. |
| 2026-10-21 | **Fully scripted pipeline** (headless Blender clean step; procedural masts, sails, rigging and caves; regenerate rather than repair). |
| 2026-10-21 | **Style test narrowed to A (low-poly flat) vs. B (toon with outlines).** |
| 2026-10-22 | **Sourcing order:** procedural/CC0 first, AI-generated assets fill gaps. |
| 2026-10-22 | **Meshy** is the image-to-3D tool; **nano-banana** approved for shipped outputs in this open-source project. |
| 2026-10-22 | **S4 scene shrunk** to schooner, water, fog and one lighthouse beam at dusk and night. |
| 2026-10-22 | **Blender runs locally only**, never in CI. |
| 2026-10-22 | **Static sails** (no billow shader); flags keep a vertex shader. |
| 2026-10-25 | **Ships are procedural** (a parametric hull generator for player and NPC ships); **Meshy is optional, for organic one-offs only** (figureheads, curios, trophies). |
| 2026-10-25 | **Style B picked (S4):** toon bands plus inverted-hull outlines on hero objects; no screen-space edge pass. Laptop cost within noise of flat shading (§3.4). |

---

## 17. Phase 2 Piece C: Terrain Look and Vegetation (2026-10-29)

**Scope** (Phase 2 scope doc, piece C; §13 Phase 2 row): the style B terrain shader (sandstone, beach, forest floor, slope rock), a vegetation density map from slope and height, instanced pines, birches and rocks with impostors far away, density and distance by preset, and the shelter maps rebaked with a +15 m canopy on forest ([03 §14.4](03-world-scale-chart-travel.md)).

| Part | Where | How it works |
|---|---|---|
| Density map | `src/sim/terrain/vegetation.ts` | Pure functions of height, upness (the normal's y over 8 m, so it doesn't depend on a tile's stride) and seeded value noise. Forest rises from nothing at 1.6 m above the lake to full at 5 m, thins past about 37° and is gone past 52°, and has clearings (two noise octaves at 420 m and 130 m; never below 12% density, for 1900's logging and burns). Birch comes in stands and along the shore; rocks sit on the shore ledges, thickest under steep bluffs. No imports, so the geo tools load the same file and the runtime, the shader and the bake can't drift apart. |
| Planting | `plantTile` in the same file, run in the terrain tile worker | One candidate per 8 m cell for trees and per 12 m cell for rocks, each hashed from its zone position, so tiles join with no seam and the same tile always grows the same trees. Instances carry position, scale, yaw, kind, tint and a rank, and are sorted by rank: a preset's density draws the prefix with rank below it, so thinning never moves a tree. Set-piece footprints (plus their blend margin) stay clear for the harbors (piece G). The Apostles plant about 250k trees and 3.6k rocks at full density, 5 ms a tile in the worker. |
| Terrain shader | `src/render/terrain/terrain-material.ts` | No textures. Beach sand on low gentle ground (top edge wandering 0.95–1.7 m, darker where wet); red sandstone on steep ground near the lake in beds about 3 m thick, over dark wave-washed rock at the waterline, turning to gray rock above 18–30 m; meadow in clearings and a darker forest floor under the trees (the mesh's per-vertex `forest` attribute); shoals and seabed under the water. World-space value noise (an arithmetic hash, no `sin`) makes the band edges wander; its fine octave fades out past 300–900 m so it doesn't shimmer. Past the impostors' reach, forest takes the canopy color, so far islands still read as wooded. Lit with the unified material's toon bands, wrapped a little (`STYLE_WRAP`) so a hillside turned from the sun takes the mid band instead of going dark. No outlines on terrain (§14). |
| Tree meshes | `src/render/vegetation/plant-models.ts` | Procedural: a pine of three stacked seven-sided cones on a trunk (about 14 m, 52 triangles), a birch of a white trunk and two faceted leaf clumps (about 11.5 m, 52 triangles), and a squashed jittered icosahedron rock (20 triangles). Palette vertex colors, per-instance scale and tint. Far under the §8 tree budget (300–800), which leaves room for more kinds. |
| Impostors | `src/render/vegetation/impostors.ts` | Baked at load: each tree kind is drawn from the side into a 128 × 256 atlas cell, color (sRGB) in one target and normals in another. Far trees are quads turning about the vertical only, lit through the baked normals with the same toon bands, so the hand-over doesn't flash at dusk. A tile's planting array is the instance buffer as it is (interleaved, no copy). Alpha-tested at 0.4 with mipmaps. |
| LOD and hand-over | `src/render/vegetation/vegetation.ts` | Near: one instanced mesh per kind (three draw calls), refilled from the tiles' plantings when the camera has moved 24 m. Far: one instanced impostor draw per tile in reach, culled with the tile's box. Meshes and impostors dither across a band (the last quarter of the mesh distance) with complementary tests on the same per-pixel threshold, so each pixel is drawn exactly once; impostors dither out over the last quarter of the far distance onto the canopy color. Rocks have no impostor and fade out at 80% of the mesh distance. |
| Unified material | `src/render/style/stylized-material.ts` | Now handles instancing (instance matrices and colors), a distance fade, and exports its lighting (`STYLE_LIGHT_GLSL`) and dither (`DITHER_GLSL`) chunks for the terrain and impostor shaders. |
| Presets | `src/render/quality.ts` | Density, mesh distance, far distance: Low 0.4, 110 m, 1.2 km; Medium 0.5, 200 m, 1.8 km; High 0.85, 280 m, 2.6 km. |

**Budget (computed over the whole zone on a 512 m grid, before frustum culling; `tests/vegetation.test.ts`):** at its worst spot, Medium's vegetation is 24 draw calls and 237k triangles, Low's 15 and 130k. With terrain's 40-call ceiling that leaves Medium well inside 150 calls; the triangle worst case sits deep in the mainland forest, and from the water about half of it is culled. In the cloud renderer (SwiftShader, so only the counts mean anything) the spawn view on Medium was 46 calls and 222k triangles for the whole frame.

**Laptop bench still due.** The water bench (`?bench=water`, or **Measure water** in the dev overlay) now also times the terrain and the vegetation by hiding each; Jared's run on the baseline laptop decides whether Medium's density or distances need to come down, and reruns the water numbers plan 04 §23 asked for once trees arrived.

**Shelter with the canopy.** `npm run geo:canopy` raised forested land by 15 m and rebaked the lee in place from the published tiles: shelter rose in 16% of the Apostles' water cells, by 0.26 on average where it did. A full `npm run geo:build` now bakes the canopy in too (`withCanopy` in `tools/geo/lib/wind.ts`). The canopy follows the density map, so changing the map needs a full rebake; the in-place tool only ever raises shelter.

**Seen in the renders:** the red bluffs read from across the channel, and the pines on the skyline give the islands their ragged tops. Set-piece footprints show as flat clear ground with a steep cut behind Bayfield until piece G builds the towns.

**Left for later:**
1. **Wind sway** for the near trees (a vertex shader nudge by wind speed) and fall colors are not in; plan 14 cut #6 keeps only snow for seasons.
2. **Maples and shrubs** (§5 lists about ten vegetation kinds): the atlas has a cell per kind, so each is a model and a share in the density map.
3. **Jared's look sign-off** on the shader colors and tree density, after a sail around the zone.

---

## Changelog
- v0.6: Phase 2 piece C (§17): the style B terrain shader, the vegetation density map, procedural pines, birches and rocks with baked impostors and a dithered hand-over, density and distance by preset, and the canopy in the shelter bake. Palette v1 gains the land colors.
- v0.5: The procedural T1 schooner is built (§5) in style B; outline shells get a small depth offset.
- v0.4: S4 results (§3.4): scene, benchmark on the baseline laptop, style B with per-object outlines picked. Ships move to a procedural hull generator; Meshy becomes optional for organic one-offs.
- v0.3: Gap review: sourcing order (procedural/CC0 first, AI fills gaps), Meshy chosen, nano-banana approved for shipped outputs, shrunk S4 scene, Blender local only, static sails, A-or-B wording fixed.
- v0.2: Decisions: photochrom reference, AI image gen (nano-banana) approved, public-domain engravings, fully scripted pipeline (headless Blender clean, procedural ship rigs and caves, contact-sheet review), style test narrowed to A/B.
- v0.1: Initial art plan: pillars, palette and mood (photochrom reference), time and season palettes, style test (candidates, scene, scoring), the unified stylized material and palette-ization, sources by asset type, AI tooling and the license gate, the automated pipeline, budgets, animation list, VFX style, MVP asset list, historical references, phasing, risks.
