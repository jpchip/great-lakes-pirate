# 15 — Audio

Status: DRAFT v0.5 (decisions made; Phase 1 sailing audio and Phase 2 weather and harbor audio built)
Parent: [00-master-plan.md](00-master-plan.md)
Inputs:
- Master plan: AI-generated audio
- [01](01-tech-architecture.md): three.js Audio/PositionalAudio plus a thin mixer, OGG/Opus, MIT + CC BY licensing, provenance rules
- Audio cues named in [02](02-arcade-sailing.md), [04](04-water-weather-seasons.md), [06](06-fame-wanted-law-lighthouses.md), [07](07-combat-boarding-targets.md), [08](08-docks-district-stealth.md), [11](11-exploration-islands-secrets.md), [12](12-sandbox-events-character-failure.md)
- [13 §9](13-ui-ux.md): captions
- [14 §6](14-art-direction-asset-pipeline.md): license gate and provenance
Feeds: 17 (audio performance tests)

## Purpose

Define the soundscape and music:
- style and sources (AI-generated, CC0 fallback, public-domain melodies)
- the license gate for an open-source repo
- the sound list by system, and audio as gameplay information (foghorns, footsteps, detection)
- the dynamic music system, mixing and spatialization
- the audio pipeline and budgets for a browser game

---

## 1. Goals

1. **Superior you can hear:** wind and rigging, waves on the hull, gulls and loons, distant steam whistles, foghorns in the murk, ice groaning in winter.
2. **Audio is information.** Foghorns help you navigate, footsteps reveal surfaces and noise, and guards' alert sounds and detection stingers tell you where you stand.
3. **Period music:** folk instrumentation and real **Great Lakes song traditions**, never modern-sounding.
4. **License-clean** for a public open-source repo.
5. **Light:** a small initial download, streamed music, and a capped voice count for the Web Audio budget.

---

## 2. Style

| Layer | Direction |
|---|---|
| **Music** | Period folk ensemble: **fiddle, concertina/accordion, acoustic guitar, tin whistle, upright piano (saloons), hand percussion**, sparse low strings or a drone for tension. Moody and modal on the water, lively in saloons, sparse and tense at night. |
| **Song tradition (decided)** | Arrangements of **traditional Great Lakes and lumberjack songs** (public-domain melodies) as motifs, e.g., *"Red Iron Ore"* (an ore-boat song from this very trade), *"The Bigler"*, *"The Persian's Crew"*, *"The Shanty-Man's Life"*. Verify public-domain status and origins in R1 before use. |
| **Ambience** | Naturalistic, slightly heightened (stylized clarity over realism) |
| **SFX** | Punchy and readable: wood, rope, canvas, iron, steam, black powder |
| **Voice (decided)** | **No spoken dialogue.** All dialog is text ([13 §5](13-ui-ux.md)). Guards and crews only get **short shouts and whistles** as gameplay alerts ("Hey!", a police whistle, grunts). |

---

## 3. Sources & Licensing

### 3.1 Sources (in order of preference by type)
| Type | Primary | Fallback |
|---|---|---|
| Music | **AI music generation** (tracks and stems) from prompts specifying the ensemble, mood and tempo, plus arrangements built from public-domain melodies | CC0 or CC BY tracks |
| SFX (decided: **free libraries first**) | **CC0 libraries** (e.g., CC0-licensed sounds on Freesound, other CC0 packs) | **AI SFX generation** to fill gaps (license-gated); simple synthesized sounds for UI ticks and clicks |
| Ambience beds | CC0 field recordings first, looped | AI generation for gaps; layered procedural wind and wave noise |
| Shouts & whistles | CC0 recordings first | AI voice for a few short shouts (license-gated); otherwise non-verbal only |

### 3.2 License gate (same rules as art, [14 §6](14-art-direction-asset-pipeline.md))
- An AI audio tool is usable **only if its terms allow public redistribution** of outputs (the repo is public and assets are CC BY 4.0). Many free tiers of music generators **restrict** this (the service keeps ownership, or non-commercial only, or no redistribution), so check carefully and record the terms (link plus date) in `assets/LICENSES.json`.
- Avoid **non-commercial (NC)** and **no-derivatives (ND)** licenses, and royalty-free bundles that forbid redistributing raw files (a public repo exposes the raw files).
- **Public-domain melodies:** the arrangement or performance is our own (AI-performed or synthesized); document the source melody.
- Every audio file gets a **provenance** record (source, tool, prompt, license); CI fails without one.

---

## 4. Sound List by System (MVP)

### 4.1 Ambience
| Bed / emitter | Driven by |
|---|---|
| Open-water wind (intensity layers) | Wind speed and shelter ([04 §5.1](04-water-weather-seasons.md), [02 §11](02-arcade-sailing.md)) |
| Waves on the hull, lapping at the shore | Sea state, speed |
| Rain and snow, thunder (delayed by distance) | Weather ([04 §5.3](04-water-weather-seasons.md)) |
| **Ice:** groaning, cracking, booming, floes knocking | Season and ice ([04 §8](04-water-weather-seasons.md)) |
| Wildlife: **gulls, common loons (night calls)**, crows, wind in pines, insects (summer) | Zone, time, season |
| Forest and island: rustling birch, woodpecker, creek | On foot on islands |
| Docks at day: hammering, crates, gulls, chatter, steam winches | Docks district (day) |
| Docks at night: water against pilings, distant dog *bark* (ambience only, no dog AI), creaking moored hulls, a distant saloon | Docks district (night) |
| Saloon interior: crowd murmur, glasses, **diegetic piano or fiddle** | Saloon scenes |
| Caves: drips, echoing surf | Sea caves |
| Underwater (diving suit): muffled, pump hiss, bubbles, creaking helmet | [11 §6.2](11-exploration-islands-secrets.md) |

### 4.2 Sailing ([02 §9](02-arcade-sailing.md))
Luffing canvas · sail hoist and lower (blocks and rope) · rigging creak scaled by **strain** · hull slap by speed and waves · rudder and wheel · anchor chain run-out and windlass · **grounding scrape**, a rock crunch · ship-to-ship collision thud · knockdown lurch (water rush, gear tumbling) · sweeps (oars) · bow spray · the lead line splash.

### 4.3 Navigation & world cues (gameplay-critical)
| Cue | Gameplay role |
|---|---|
| **Lighthouse fog signals** (horns, bells, whistles; distinct per station) | **Navigation in fog**: directional, so the player can locate the light ([04 §10](04-water-weather-seasons.md)) |
| Steam whistles (freighters, the cutter's distinctive whistle) | Unseen traffic in fog, the cutter approaching |
| Ship's bell (anchored ships in fog) | Hazard awareness |
| Storm signal cannon or bell at ports (optional) | Storm warning raised ([04 §5.4](04-water-weather-seasons.md)) |

### 4.4 Combat ([07](07-combat-boarding-targets.md))
Cannon (near and far variants), swivel gun, rifle, pistol · shot whistle · splash · wood impact and splinters · rigging snap · crew shouts and screams (restrained) · **boiler explosion** (big, rare) · surrender bell or hail · boarding grapples · the cutter's bow gun.

### 4.5 On foot & stealth ([08](08-docks-district-stealth.md), [11](11-exploration-islands-secrets.md))
- **Footsteps per surface:** wood planks, dirt, gravel, grass and forest floor, snow (crunch), ice, interior floor, puddles. Variants by movement (sneak, walk, run). Volume matches **gameplay noise radius**.
- Lockpick (a hold loop plus a "click" noise chance plus a break), crowbar, doors creaking, crates lifted and set down, coins and pocketables, tying rope, a knockout thud, a knife.
- **Guard barks and whistles:** suspicious ("Hm?", "Who's there?"), alerted ("Hey! Stop!", a police whistle), searching mutters, giving up.
- Swimming (entry splash, strokes, a shivering breath when cold).
- Wildlife: **bear huffs and growls, wolf howls** (directional; [11 §3.2](11-exploration-islands-secrets.md)), deer bounding.
- Cold: teeth chattering, wind gusts as warmth drops.

### 4.6 UI ([13](13-ui-ux.md))
Paper rustle (journal, chart unrolling), ledger pen scratch (trade), coin clinks, stamp thunk (contract accepted), newspaper shake (new edition), telegraph clicks (price news), notification chimes per priority (a subtle period bell), a build placement knock, and invalid placement (a dull thud).

---

## 5. Audio as Gameplay (rules)
- **Gameplay noise is separate from audio**, but they must agree: when the sim emits a `NoiseMade` event with a radius ([08 §4.2](08-docks-district-stealth.md)), the audio plays at a matching volume, so what players hear is what guards hear.
- **Detection stingers:** a short musical stinger when an NPC becomes *suspicious* and a sharper one when *alerted*. A release cue when the search ends.
- **Directional cues get captions** with a direction arrow ([13 §9](13-ui-ux.md)): foghorns, whistles, shouts, growls, gunshots.
- **Report in progress** ([06 §2.4](06-fame-wanted-law-lighthouses.md)): a subtle recurring tick on the HUD eye icon (optional).

---

## 6. Dynamic Music

### 6.1 States
| State | Context | Character |
|---|---|---|
| **Open water (day)** | Sailing, calm or moderate | Fiddle and concertina themes, the *Red Iron Ore* motif; season variants |
| **Open water (night)** | Sailing at night | Sparse guitar and whistle, drone |
| **Fog** | Low visibility | Minimal; the music thins out to let foghorns lead |
| **Storm** | Gale or storm | Driving low strings and percussion |
| **Port (day)** | Docks district by day | Lively folk |
| **Saloon** | Saloon interior | **Diegetic** piano or fiddle (positional), **instrumental only, no lyrics** (decided); Great Lakes song tunes played as instrumentals |
| **Stealth** | On foot at night, undetected | Low, tense pulse; layers rise with nearby suspicion |
| **Chase / combat** | Pursuit, cannon fight, alerted guards | Urgent percussion and fiddle |
| **Exploration / island** | On foot on islands by day | Pastoral, sparse |
| **Winter** | Season variant | Thin, cold timbres; sleigh-bell hints |
| **Chart travel** | Chart mode | A calm traveling theme |
| **Stingers** | Legend found, ship surrendered, tier up, **tier 5**, Fame tier up, death | Short motifs |
| **Endings** | Death, Retire, Turn Lawman | End-screen pieces |

### 6.2 Technique
- **Vertical layering** (stems: base, tension, percussion, melody) for stealth, chase and storm intensity, plus **horizontal crossfades** between states at phrase-friendly points (no strict tempo sync, to keep it simple).
- Music state is driven by gameplay events: detection levels, pursuit, weather, mode changes.
- **Ducking:** music dips under critical alerts and fog signals.
- Silence is allowed: long stretches of pure ambience at sea are part of the mood.

---

## 7. Mixing & Spatialization

| Bus | Contents |
|---|---|
| Master | — |
| Music | All music, including diegetic (saloon) through a 3D send |
| Ambience | Beds and emitters |
| SFX | World and gameplay sounds |
| Voice | Barks and shouts |
| UI | Interface sounds |

- **Settings:** per-bus volume ([13 §5](13-ui-ux.md)) stored in settings, outside the run save; on the settings screen's Sound tab since Phase 2 (§14).
- **3D:** three.js PositionalAudio (HRTF optional on High; equal-power panning by default) with distance attenuation curves per category.
- **Cheap occlusion:** a low-pass filter when the source is behind walls or the player is indoors (from the same occlusion raycasts as perception, [08 §4.1](08-docks-district-stealth.md)), and when underwater.
- **Reverb presets** (a few shared convolver impulse responses): open water (none), forest, interior wood, saloon, cave, underwater. Switched by zone or volume.
- **Fog and snow damping:** a subtle high-frequency roll-off on distant sources (atmosphere, and it makes foghorns stand out).

---

## 8. Budgets (browser and iGPU laptop)

| Item | Budget |
|---|---|
| Simultaneous voices | ≤ 24 (priority system: gameplay-critical cues > nearby SFX > ambience details) |
| Ambience beds active | ≤ 4 (crossfaded) |
| Music | Streamed (media element or chunked) and not fully decoded into memory; ≤ 2 tracks crossfading plus stems |
| Decoded SFX memory | ≤ 40 MB |
| Initial audio download | ≤ 5 MB (core UI, sailing, ambience); the rest streams per zone/mode |
| Audio CPU | ≤ 0.5 ms main-thread per frame (Web Audio does mixing off-thread) |

- **Format:** Opus in OGG/WebM (with a fallback only if a target browser needs it; [01 §4.9](01-tech-architecture.md)).
- **Autoplay policy:** audio unlocks on the first user interaction (the main menu click). Handle it gracefully.

---

## 9. Audio Pipeline (`tools/audio/`)

```
raw-assets/audio/<category>/<name>.(wav|flac) + provenance.json
   → trim silence, fade edges
   → loudness normalize (music ≈ −18 LUFS integrated; ambience ≈ −24; SFX peak-normalized per category)
   → set loop points (ambience, music stems) & verify seamless loops
   → encode Opus (bitrate by category: music 96–128 kbps, ambience 64, SFX 48–64 mono)
   → validate provenance/license → fail if missing
   → write public/assets/audio/... + audio manifest
   → update CREDITS.md / assets/LICENSES.json
```
- One command (`npm run audio`), cached by content hash. CI checks provenance and licenses.
- A dev **audio browser** page (listen to every sound with its metadata) for quick review, the counterpart to the art contact sheet ([14 §7](14-art-direction-asset-pipeline.md)).

---

## 10. Data & State
- `audio.json`: maps **game events** to sound banks (with variations, random pitch and volume ranges, priority, bus, attenuation, caption text).
- `music.json`: states, stems, transition rules, stingers, season variants.
- `reverb.json`: zone presets.
- No audio state in the run save beyond what's derivable. Volumes and caption settings live in settings ([13 §11](13-ui-ux.md)).

---

## 11. Phasing
| Phase | Audio scope |
|---|---|
| 1 | Sailing ambience (wind, waves, rigging, luffing), sail and anchor SFX, a basic mixer and buses, the autoplay unlock |
| 2 | Weather ambience (rain, thunder, fog), lighthouse fog signals (directional), gulls and loons, open-water music v1 |
| 3 | Chart music, steam whistles, encounter stingers |
| 5 | Wanted and tier stingers, cutter whistle |
| 6 | Combat SFX, boiler explosion, the chase music layer |
| 7 | Footsteps per surface, stealth layers and stingers, guard barks, docks ambience day and night, occlusion and reverb |
| 8 | Build and craft sounds, UI sound set |
| 9 | Island, cave and winter ambience, ice sounds, wildlife, diving audio, saloon diegetic music, season variants, ending music |
| 11 | Mix polish, loudness pass, captions review |

---

## 12. Cut List
1. AI voice shouts (non-verbal whistles and grunts only).
2. HRTF spatialization.
3. Season music variants (one set).
4. Per-station unique fog signals (2–3 shared types).
5. Reverb presets beyond interior and cave.

*Not cuttable:* directional fog signals, footsteps matched to gameplay noise, detection stingers, weather and wind ambience, captions for directional cues, license-clean sourcing, the period folk score with Great Lakes song motifs.

---

## 13. Open Questions

All resolved.

### Decisions
| Date | Decision |
|---|---|
| 2026-10-22 | **Traditional Great Lakes songs** (public-domain melodies) arranged as motifs. |
| 2026-10-22 | **No spoken dialogue**; only short shouts and whistles as gameplay alerts. |
| 2026-10-22 | Saloon music: **piano or fiddle, instrumental only, no lyrics**. |
| 2026-10-22 | SFX and ambience: **free CC0 libraries first**, AI generation to fill gaps. |
| 2026-10-22 | **Period folk** score style. |
| 2026-10-22 | **Plan 15 wins on sourcing:** CC0 first for SFX, ambience and shouts, AI generation fills gaps. The master plan now matches. |
| 2026-10-30 | **Phase 2 sources** (§14): rain, thunder and gulls are CC0 from OpenGameArt; loons are public domain (US Fish and Wildlife Service, via Wikimedia Commons; the Yellowstone loon recordings were rate-limited from the cloud machine). No free fog signal recordings were found, so the **fog whistle and fog bell are synthesized**, and with no AI music tool reachable, **open-water music v1 is two original tunes rendered by a synthesizer** in `tools/audio/synth.ts`. Both are CC BY 4.0 placeholders to replace with recordings or license-checked AI generation (§3.1) once a source is chosen. |
| 2026-10-25 | **Phase 1 sailing audio:** 14 CC0 clips from OpenGameArt (hull wash, slaps, breaking sea, creak, luff, sail fill, halyard and anchor sounds), all in `CREDITS.md`. The **wind, rigging whistle and swell beds are procedural** (filtered noise, §3.1's fallback): the one CC0 wind recording found had bag rustle in it, and noise follows wind and gusts smoothly at zero download. Freesound needs an account, so it wasn't used yet. Pipeline in `tools/audio/`, runtime in `src/audio/`. |

---

## 14. Phase 2 Piece H: Weather and Harbor Audio (2026-10-30)

**Scope** (Phase 2 scope doc, piece H; §11 Phase 2 row): rain, thunder (delayed by distance) and fog ambience, directional fog signals at the lights, gulls and loons, open-water music v1, volume sliders on the settings screen, and every file in `CREDITS.md`.

| Part | Where | What it does |
|---|---|---|
| Rules | `src/audio/world-mix.ts` | Pure functions from the weather, the sky and the ship's place to levels and rates, tested without Web Audio: rain level and brightness, how foggy it sounds, thunder delay and level, fog signal reach and timing, gull and loon call rates, and the music mood. |
| Rain | `world-audio.ts` | The CC0 rain loop, louder and brighter with `rainAt`, a little more in a thunderstorm. |
| Thunder | `world-audio.ts`, `src/main.ts` | Each lightning strike (piece E's listener) plays a clap and long rumble inside 2.5 km or a distant roll beyond, placed at the strike's bearing and `distance / 343` s late (about 3 s a kilometer), quieter and duller with distance, softer for strikes that stay in the cloud. |
| Fog | `world-audio.ts` | Once fog visibility drops under 4 km: a low procedural hush and drips off the rigging (fewer in a breeze), and the §7 damping: every distant cue (signals, thunder, birds) loses top end in thick air. |
| Fog signals | `data/lighthouses.json` (`fogSignal`), `world-audio.ts` | Two shared sounds (§12 cut #4) with a rhythm per station: Outer Island's steam whistle, one 5 s blast every 30 s, carrying 7 km; Raspberry Island's bell, two strokes every 20 s, and La Pointe's, one every 15 s, carrying 2.5 km. A keeper sounds the signal when fog visibility is under 3 km or a fog bank covers the station. Each blast is placed at the top of the tower, panned from the camera, and arrives at the speed of sound, so the direction you hear it from is the direction of the light. R1 doesn't record 1900 fog signals, so all three are marked as assumptions in the data, and Devils Island stays silent to keep its 1900 coverage gap. |
| Gulls | `world-audio.ts` | Five CC0 calls. A few over open water, more within about 700 m of shore and most within 1.5 km of the Bayfield and Ashland piers, by day and in fair weather; placed toward the shore, 30–220 m off and in the air. |
| Loons | `world-audio.ts` | Four public-domain calls. At dusk, through the night and at dawn, on calm water, from May to September (fewer in October, almost none in November); a call or a short series from 400–1800 m off across the water. |
| Music v1 | `src/audio/music.ts`, `tools/audio/synth.ts` | "The Chequamegon Waltz" (concertina and guitar, day) and "Devils Island Air" (tin whistle over a fiddle drone, night), both original. A cue plays whole after 20–45 s at sea, then 90–240 s of silence. Fog under 2.5 km, a thunderstorm, heavy rain or 28 kn of wind fade it out (§6.1: the music thins so the foghorns lead); it ducks to 30% under a fog signal. The cues stream from media elements (§8) and are not decoded up front. |
| Positional sound | `src/audio/mixer.ts` | One-shots can carry a world position: an equal-power panner per voice (§7), with distance handled by the caller since the zone is compressed. The listener follows the camera each frame (or the ship without a renderer). |
| Beds budget | `world-audio.ts` | The rain and fog beds start only when audible and stop after 3 s of silence, so with the four sailing beds the usual count stays at four to five (§8 asks for four; a foggy drizzle briefly runs six). |
| Settings | `src/ui/settings/SettingsMenu.tsx` | A Sound tab: Master, Music, Weather & wildlife (ambience bus), Ship & signals (SFX bus), and Mute. Voice and UI join when those sounds exist. |
| Synthesis | `tools/audio/synth.ts`, `tools/audio/lib/synth.ts` | `npm run audio:synth` renders the fog whistle (additive bell whistle with pressure-following pitch and steam noise), the fog bell (bronze bell partials with a clapper click) and both tunes (additive free reed, Karplus–Strong guitar, tin whistle, bowed drone, a Freeverb-style room) into `raw-assets/audio/` with procedural provenance; `npm run audio` then encodes them like any other source. |
| Pipeline | `tools/audio/` | Two new hints: `highpassHz` (gull wind rumble, the loon recording's hum) and `fadeOutS` (clips cut mid-sound). |

**Download:** the sailing and world bundles that load up front are about 0.8 MB; the two music cues add 3.0 MB, streamed. **Dev panel:** Audio → Play has thunder at 1.2 and 5 km, the nearest fog signal, a gull, a loon, and each music cue; Audio → Mix shows rain, fog, call rates, stations heard and the music state.

**Checked:** the rules and the music scheduling by unit tests, the bank (28 sounds) and the sliders' persistence by the smoke tests, and a 78-second preview rendered offline through the real soundscapes (harbor by day with the waltz, a thunderstorm, fog with Outer's whistle at 1.6 km and Raspberry's bell at 500 m, then night with loons and the air). Levels are set by measurement and need a listen in the game.

### Not covered yet

1. **Captions for directional cues** (§5): the fog signals have no caption or arrow yet. They belong with the UI captions of plan 13 §9.
2. **Fog signal history:** which Apostles stations had signals in 1900, and their codes, need R1 sources; the data marks all three as assumptions.
3. **Music:** the synthesized tunes are placeholders, and the *Red Iron Ore* motif waits for R1 to confirm which Great Lakes melodies are public domain (§2).
4. **Storm music and harbor work sounds** (hammering, the sawmill) are later phases (§11).

---

## Changelog
- v0.5: Phase 2 piece H built (§14): rain, thunder after the lightning, fog hush and damping, directional fog signals with a rhythm per station, gulls and loons, open-water music v1, the Sound tab. Decision row for the Phase 2 sources.
- v0.4: Phase 1 sailing audio built (piece I): pipeline, mixer and buses, autoplay unlock, the sailing soundscape. Decision row for procedural wind beds.
- v0.3: Gap review: master plan aligned to this plan's sourcing order; no content change here.
- v0.2: Decisions: traditional song motifs, no spoken dialogue, instrumental saloon music, CC0-first SFX, period folk style.
- v0.1: Initial audio plan: goals, style (period folk, Great Lakes song tradition), sources and license gate, sound list by system, audio-as-gameplay rules, dynamic music states and technique, buses and spatialization, budgets, pipeline, data/state, phasing.
