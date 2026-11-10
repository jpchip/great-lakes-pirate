# 15 — Audio

Status: DRAFT v1.1 (decisions made; Phase 1 sailing audio, Phase 2 weather and harbor audio, Phase 3 ship whistles and chart music, Phase 4 harbor work and trade sounds, Phase 5 law audio and Phase 6 combat audio built and checked)
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
| 4 | Harbor work sounds at the ports, trade sounds, captions for the fog signals and whistles (§17) |
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
| Settings | `src/ui/settings/SettingsMenu.tsx` | A Sound tab: Master, Music, Weather & wildlife (ambience bus), Ship & signals (SFX bus), and Mute. Voice and UI join when those sounds exist (UI did in §16). |
| Synthesis | `tools/audio/synth.ts`, `tools/audio/lib/synth.ts` | `npm run audio:synth` renders the fog whistle (additive bell whistle with pressure-following pitch and steam noise), the fog bell (bronze bell partials with a clapper click) and both tunes (additive free reed, Karplus–Strong guitar, tin whistle, bowed drone, a Freeverb-style room) into `raw-assets/audio/` with procedural provenance; `npm run audio` then encodes them like any other source. |
| Pipeline | `tools/audio/` | Two new hints: `highpassHz` (gull wind rumble, the loon recording's hum) and `fadeOutS` (clips cut mid-sound). |

**Download:** the sailing and world bundles that load up front are about 0.8 MB; the two music cues add 3.0 MB, streamed. **Dev panel:** Audio → Play has thunder at 1.2 and 5 km, the nearest fog signal, a gull, a loon, and each music cue; Audio → Mix shows rain, fog, call rates, stations heard and the music state.

**Checked:** the rules and the music scheduling by unit tests, the bank (28 sounds) and the sliders' persistence by the smoke tests, and a 78-second preview rendered offline through the real soundscapes (harbor by day with the waltz, a thunderstorm, fog with Outer's whistle at 1.6 km and Raspberry's bell at 500 m, then night with loons and the air). Levels are set by measurement and need a listen in the game.

### Not covered yet

1. ~~**Captions for directional cues** (§5): the fog signals have no caption or arrow yet. They belong with the UI captions of plan 13 §9.~~ Done (§17).
2. **Fog signal history:** which Apostles stations had signals in 1900, and their codes, need R1 sources; the data marks all three as assumptions.
3. **Music:** the synthesized tunes are placeholders, and the *Red Iron Ore* motif waits for R1 to confirm which Great Lakes melodies are public domain (§2).
4. **Storm music** is a later phase (§11); ~~harbor work sounds~~ came in Phase 4 (§17).

## 15. Phase 3 Piece J, Part 1: Ship Whistles (2026-10-31)

**Scope** (plan 03 §20.4 piece J; §11 Phase 3 row; §4.3): steam whistles for the NPC ships, and the cutter's own, that carry in fog. Piece J also holds chart music, encounter stingers and the loading-screen sound. Those need piece D's chart mode and encounter card, which isn't merged yet, so they are part 2. The whistles need only piece H's ships, which is.

| Part | Where | What it does |
|---|---|---|
| Sounds | `tools/audio/lib/synth.ts` (`shipWhistle`, `SHIP_WHISTLES`, `foghorn`), `raw-assets/audio/ships/` | Five synthesized sounds, built like the lighthouse whistle (additive bells whose pitch follows the steam pressure, with breathy steam): the ore freighter's deep single bell (138 Hz, slow valve, lots of steam), the package steamer's three-bell chime (a minor triad, the passenger boats' sound), the fish tug's small shrill bell (587 Hz, fast valve), and the *Morrill*'s two bells with a slow warble that no other ship has. The schooner-barge has no steam, so it gets a hand-pumped reed fog horn. `npm run audio:synth -- ships` renders just these. All in the world bundle (+5 sounds, 33 in the bank, about 200 KB). |
| Data | `data/ships.json`, `data/schemas/ships.ts` | Each NPC class has `whistle: { soundId, kind, rangeM }`: the freighter carries 6 km, the cutter 5.5, the steamer 5, the tug 3 and the barge's horn 2. The schema refuses a steam whistle on a sailing vessel and a horn on a steamer. |
| Rules | `src/audio/ship-whistle-mix.ts` | Pure functions, unit-tested. **Fog signals** from the Great Lakes rules (Act of 8 February 1895, in force on the lakes in 1900): a steamer under way sounds three distinct blasts at intervals of not more than a minute (every 50 s here; the lakes used three, where the international rules had one prolonged blast); a sailing vessel sounds her fog horn once on the starboard tack, twice on the port tack and three times with the wind abaft the beam, read from the sim's wind; a ship lying stopped rings her bell for about five seconds a minute. **Passing signals:** a steamer meeting you in sight (you within 35° of her bow, within 1.5 km, courses more than 110° apart) gives one short blast to pass port to port, or two for starboard to starboard if you're well on her starboard bow; once per meeting, never in fog, never from sail. **Level:** the same shape as a lighthouse signal, so a freighter in fog sits under Outer Island's whistle. |
| Playback | `src/audio/ship-whistles.ts`, `game-audio.ts` | Each frame the NPC ships hand over their place, heading and speed. A ship sounds its fog signal when the fog at the listener is under 3 km or a fog bank covers the ship, on the same clock and scheduling as the lights' signals, with its own phase. Each blast leaves the funnel top and arrives at the speed of sound, panned from the camera and dulled by the fog, so the direction you hear it from is where the ship is. Music ducks under a whistle as under a fog signal. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play: "Nearest ship's fog signal" and "Nearest ship: passing blast". Audio → Mix: ships sounding and the last signal heard. |

**Checked:** the rules (cases, patterns, ranges, meetings) and the synthesis pitches by unit tests; every class's sound in the bundle with a credit by the pipeline tests; and in the game with Playwright: `?npcs&fog=600` played the freighter, steamer, tug and cutter's three blasts and the barge's two (port tack) at the speed of sound, and `?npcs=meet` in clear air gave one steamer's passing signal and nothing from the barge. A 78-second preview (`ship-whistles/preview-78s.mp3` in the project files) runs through an unseen freighter closing, the steamer's chime, the tug, the barge's horn, a ship's bell, the *Morrill*, and a passing blast as the fog lifts. Levels are set by measurement and need a listen in the game.

### Still to do

1. ~~**Part 2, after piece D:** chart music, encounter stingers, and the loading-screen transition sound.~~ Done (§16).
2. ~~**Captions** (§5): whistles, like the fog signals, have no caption or direction arrow yet (plan 13 §9).~~ Done (§17).
3. **R1 checks:** the 1895 rule for sailing vessels' fog horns (the tack code here is the international one), whether a stopped steamer rang her bell, and what the *Morrill*'s whistle actually sounded like. The pitches are by ear.
4. **Piece G's arenas** use the same `game.world` NPC entities, so their ships whistle with no more work; a steamer that turns to pass should then also give the passing signal at the turn.

## 16. Phase 3 Piece J, Part 2: Chart Music, Stingers and the Fade to Fog (2026-11-01)

**Scope** (plan 03 §20.4 piece J; §6.1 "Chart travel" and "Stingers"; §11 Phase 3 row): the rest of piece J now that piece D's chart mode and encounter card are in: a calm traveling theme on the chart, a stinger for each kind of lookout report, and the sound under the loading screen's fade to fog.

| Part | Where | What it does |
|---|---|---|
| Chart theme | `tools/audio/lib/synth-chart.ts` (`chartTheme`, `REACH`), `music/chart-voyage` | "The Long Reach", an original 6/8 tune in G at a walking pace (dotted quarter 60): concertina over a guitar boom-chick, A A B B, then the tin whistle takes the A an octave up over a low fiddle drone. 89 s, streamed like the open-water cues (bundle `music-chart`, 1.4 MB). |
| Playback | `src/audio/chart-audio.ts` (`ChartMusic`), `game-audio.ts` | Starts once the chart has been open 1.5 s, so a quick look at the helm stays quiet; fades in over 2.5 s and loops while the chart is up (the media element's own loop); fades over 1.5 s when the chart closes or the loading fog comes up, and the open-water director takes over at the helm as before. |
| Stingers | `synth-chart.ts` (`stinger`), `chart/stinger-*` | Six motifs of 3.5–5 s: **sail** (a rising concertina figure onto G, a strum: freighter, steamer, tug), **threat** (a low drone and the whistle leaning on a minor second: the cutter seen first), **hunted** (two hard drum strokes, a falling minor run, a diminished stab and a roll: the cutter closing, no way out, or an Avoid that failed), **squall** (a swelling drum roll over a dark drone), **derelict** (a far ship's bell and an unresolved whistle phrase), and **clear** (a falling phrase home to G, when Avoid gets away). `stingerFor` picks one from the `EncounterSpotted` event, which now carries the contact's `kind` and `hostile`. They play on the music bus at critical priority and the theme dips to 20% under them. |
| Fade to fog | `synth-chart.ts` (`fogFade`), `chart/fog-fade` | 4 s: a swell of muffled wind and sea that peaks as the screen fogs over and dies away, with two strokes of a ship's bell in it. It plays on the rising edge of the `loading` overlay (`ModeMachine.hasOverlay`), so every zone change and arena entry or exit gets it, and the boot load, which has no fade, doesn't. On the UI bus, which now has its slider on the Sound tab ("Interface"). |
| New voices | `synth-chart.ts` | A frame drum stroke (a skin tone dropping in pitch with a slap of noise), a drum roll built from it, and a small ship's bell (brighter partials than the lighthouse fog bell). |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play: each stinger and the fade to fog. Audio → Mix: whether the chart theme is playing (and ducked), and the last stinger. |

**Download:** the stingers and the fade decode up front with the sailing and world sounds (bundle `chart-audio`, 0.4 MB, so 1.4 MB in all); the theme streams. The budget test now holds what §8 asks, the decoded bundles under 5 MB, and gives the streamed music its own ceiling (6 MB; 4.5 MB now) instead of counting the streamed cues against the initial download.

**Checked:** the stinger choice, the theme's start delay, loop, ducking and fade by unit tests, and the synthesis (whole bars, lengths, the drum's decay, the fade's swell) by tests over the generators. In the game with Playwright (`e2e/smoke.spec.ts`): taking to the chart starts the theme, a freighter report plays the sail stinger, engaging plays the fade to fog into the arena with the theme off, leaving plays it again back onto the chart where the theme resumes, and the hunting cutter plays the hunted stinger. A 72-second preview (`chart-audio/preview-72s.mp3` in the project files) runs the fade, the theme, each stinger over it in turn, and the fade again. Levels are set by measurement and need a listen in the game.

### Still to do

1. **Music:** like v1, the theme and stingers are synthesized placeholders, to replace with recordings or license-checked generation (§3.1) once a source is chosen, and the *Red Iron Ore* motif still waits on R1.
2. **Arena music:** the arenas are the sailing mode, so they get the open-water director (quiet in fog and storm); a chase layer for the cutter is Phase 6 (§11).
3. **Captions** (§5) for the stingers aren't needed (they aren't directional), but the encounter card is what says what was seen.

## 17. Phase 4 Piece J: Harbor Work, Trade Sounds and Captions (2026-11-01)

**Scope** (plan 05 §16.4 piece J; §4.1 "Docks at day", §4.6, §5): harbor work sounds at the ports (hammering, the mill saw, ore cars at the docks), trade sounds (coins, the ledger), captions for the fog signals (a 0.3.0 known limitation), another search for real recordings or a reachable music tool to replace the placeholders, and every file in `CREDITS.md`.

| Part | Where | What it does |
|---|---|---|
| Work sites | `src/audio/harbor-mix.ts` (`workSites`, `BUILDING_WORK`, `PIER_WORK`) | Read off the zone's harbor layouts, no new data: a **sawmill** building is a head saw, the **shipShed** caulking mallets, the **cooperage** a hammer on hoops, a **depot** the railroad switching, an **ore** pier dumps cars along its trestle (55% out, on the deck) and switches them ashore, and a **coal** pier switches. Bayfield has its mill, cooper and depot; Ashland a mill, the ore dock and the depot; Washburn two mills, the coal dock and the depot; Superior its mill and shipyard; Duluth the coal dock and Union Depot; Two Harbors the ore dock and the depot. La Pointe stays quiet but for its gulls (a test holds it to that). |
| Rules | `harbor-mix.ts` (`WORK`, `workActivity`, `workLevel`) | Pure, unit-tested. The 1900 waterfront's hours: the mills 6–18 through the sawing season (May–November), the shipyard and the cooper 7–17:30 with an hour off at noon, the ore docks around the clock in the shipping season under their lamps, the railroad 5–22 all year. Outdoor work (caulking, the yard) stops in a downpour or a storm; the mill does not. Each kind carries its own way: the ore dock 2.3 km, the saw's whine 1.9 km, the yard 1.6 km, caulking 900 m, the cooper 700 m, duller with distance and in fog (the §7 damping). Each game day is a calendar week, so there is no Sunday rule. |
| Playback | `src/audio/harbor-audio.ts` (`HarborWorks`), `game-audio.ts` | Each site at work and in range fires on its own random clock (a cut every ~14 s, a burst of blows every 7–9 s, a car every ~35 s, a switching move every ~55 s), placed at the site and arriving at the speed of sound. Hammering plays a 1.5–4 s slice of its recording; an ore car is a coupling bang as the car is spotted, then the dump; switching is 3–7 bangs rippling down the train, each softer. Ambience bus, detail priority, so it gives way to signals and the ship. It runs while the port screen is up (the game is paused, the harbor isn't). |
| Trade sounds | `src/audio/port-audio.ts` (`TradeCues`) | On the UI bus. The port screen or the journal opening and closing rustles paper; `TradeCompleted` and `StoresBought` count coins (1–4 handfuls by the sum, a poured heap from $100) and then a short stroke of the pen writes it into the ledger. |
| Captions | `src/audio/captions.ts` (`CaptionFeed`), `src/ui/hud/Captions.tsx` | Every fog signal blast from a light, and every ship's fog signal or passing signal, pushes a caption keyed by its source when it is scheduled; the line shows from the moment the sound arrives (so a far whistle's caption comes late, like the sound) and lingers 4 s after. The HUD shows up to three, newest first, bottom center at any HUD density, with an arrow (eight ways) toward the source from where the camera looks and "close by" or "far off". The text says what the signal means: "Outer Island Light: fog whistle", "Schooner-barge: fog horn, two blasts (port tack)", "Package steamer: one short blast (passing port to port)". Settings → Sound has "Captions for fog signals and whistles", on by default (`ui.captions`). |
| Sounds | `raw-assets/audio/harbor/`, `raw-assets/audio/port/` | 12 new files, 340 KB, decoded up front (bundles `harbor-audio` and `port-audio`). CC0 from OpenGameArt: bart's workshop recordings for the wooden and iron hammering, rubberduck's metal slam for a car coupling and his coins, a pen on paper (NachtmahrTV, packed by AntumDeluge), and Spring Spring's map open and close for the paper. No free mill saw or ore dock recording was found, so both are **synthesized** (`tools/audio/lib/synth-harbor.ts`): the saw is an additive whine at a 560 Hz tooth rate that sags 12% under load with a band-passed scream of the cut and the slab's thud; the ore dump is a modal steel-plate clang, a low roar and a dense rain of rock pings, and the door banged shut. |
| A real whistle | `raw-assets/audio/ships/whistle-chime/` | The package steamer's chime is now a recording: a multi-bell ship whistle put up at the Kennedy foundry in Owen Sound, Ontario around 1940, recorded in 2016 for radio aporee and marked Public Domain Mark 1.0 by its recordist (via the Internet Archive). One 10.8 s blast, cut at runtime like the synthesized ones. `npm run audio:synth` no longer renders the chime. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play: each kind of harbor work at its nearest site, three trade payments and the ledger opening. Audio → Mix: sites at work and heard, and the last one. `?debug` also puts `__glpAudio.fogSignal()` on the page for the e2e test. |

**The search for real recordings:** OpenGameArt's CC0 packs had the hammering, coins, pen and paper, but no sawmill, ore dock, steam whistle or fog signal. Wikimedia Commons' API is still rate-limited from the cloud machine. The Internet Archive's search, filtered to public-domain and CC0 licenses, turned up the Owen Sound whistle and a few modern foghorns (electric horns, not 1900 diaphones or steam); its "Red Library", "SSE Library" and similar uploads are commercial libraries re-posted with a CC0 claim, so they were left alone. No music generator was reachable without an account and terms to check, so the open-water cues, the chart theme and the stingers stay synthesized placeholders; that wants Jared's pick of a tool (§3.2's license gate) or a recorded performance.

**Checked:** the rules, the sites, the playback (delays, slices, quiet after hours), the trade cues and the captions by unit tests (`tests/audio-harbor.test.ts`), the bundles and credits by the pipeline tests, and in the game with Playwright (`e2e/smoke.spec.ts`): Bayfield has its work sites, docking rustles paper, a sale counts coins, closing rustles again, and a fog signal gets a caption with an arrow. A 60-second preview (`port-audio/preview-60s.mp3` in the project files) runs the Bayfield mill, cooper and yard from the water, an Ashland ore car, a sale with the pen, a big sale's heap, and the new chime whistle. Levels are set by measurement and need a listen in the game.

### Still to do

1. **Music** is still synthesized (§16 item 1); the *Red Iron Ore* motif still waits on R1.
2. **The whistle's license:** the Owen Sound recording's Public Domain Mark is the recordist's own choice on radio aporee; if Jared would rather not lean on that, the synthesized chime is in git history and `audio:synth` can bring it back.
3. **Docks at night and saloon interiors** belong with going ashore (Phase 7, §11); ore docks working at night are the one night sound in Phase 4.
4. **Stamp thunk** for an accepted contract (§4.6) waits on piece F's contracts.

## 18. Phase 5 Piece H: Law Audio (2026-11-07)

**Scope** (plan 06 §14.4 row H; §4.4, §6.1 "Stingers", §11 Phase 5 row): a stinger when a region's Wanted tier changes, the revenue cutter heard at close quarters (her whistle, engine and bell), the warning shot and the bow gun, the lockup's door and the release, and every file in `CREDITS.md`. The paper boy's shout in port waits on piece F's newspapers.

| Part | Where | What it does |
|---|---|---|
| Wanted stingers | `src/audio/law-mix.ts` (`wantedStingerFor`, `stingerAllowed`), `law-audio.ts` | The tier changes that land in one frame earn at most one stinger. A rise anywhere is news (word reaching the law in another region is still word about you): the highest tier reached picks **rise** (tiers 1–2: a drum stroke and a concertina chord that sours into a diminished seventh), **hunted** (3–4: the drum marches in, a falling minor run, a held A minor over a low drone and a roll) or **most** (5: a deep bell tolls three times over a muffled roll). A fall plays **cool** (a soft phrase settling on G) only for the region you're in, so paying a fine or sailing it out is heard and other regions cool quietly. After one, an 8 s quiet spell that only a sharper stinger breaks. Music bus, critical priority; the chart theme and the open-water music duck under it. Nothing plays while you're in the lockup (the world ticks on through the sentence) or for the falls that come with being let out. |
| Her whistle | `law-mix.ts` (`hailPattern`), `law-audio.ts` (`hailed`) | `CutterHailed` sounds her whistle (Phase 3's two-bell `whistle-cutter`; the tug's own small one) from her funnel, at the speed of sound: heave to for inspection is a long and a short blast, a pursuit hail five short and rapid ones (the 1895 lakes rules' alarm, "several short and rapid blasts"; how a cutter actually called a ship to heave to isn't in R1, so it's an assumption), and an arrest one long blast. Captioned with an arrow: "Revenue cutter Morrill: whistle, five short blasts (heave to!)". |
| Her engine | `law-mix.ts` (`engineLevel`), `law-audio.ts` | A looped bed per law ship within 1.2 km, placed on her and following her each frame: louder and faster with way on her (the loop's rate follows her speed, 0.7–1.05), duller with distance and fog. The tug's smaller engine runs a third faster. It stops when you leave the helm or she goes out of earshot. |
| Her bell | `law-mix.ts` (`shipsBells`, `bellPattern`, `bellDue`, `ALARM_STROKES`) | Within 1.6 km she strikes the ship's time on each game half hour (one to eight bells a watch, in pairs), about every 75 real seconds at sea; a clock that jumps (waiting, the chart, jail) doesn't ring. `PursuitChanged` to pursued rings it hard and fast, twelve strokes, as she sets off after you. |
| Her gun | `law-mix.ts` (`shotTiming`, `shotLevel`), `law-audio.ts` (`fired`) | `CutterFired` now carries where the round fell (`at`: the column of water across the bow, close aboard on a miss, the player's ship on a hit). The report leaves her deck at the speed of sound and carries 8 km; the round flies at 520 m/s, so close in the water goes up before the bang reaches you, as it would. A miss is a splash where it fell, a hit tears the rigging (wood splintering, a stay parting, canvas ripping). The tug's deputies fire rifles: one shot over the bow, three at the ship. Captioned: "gun, a shot across your bow", "gun, firing on your rigging", "rifle shots". |
| The lockup | `law-audio.ts` (`jailed`, `released`) | `Jailed` shuts the cell door (the hinge's creak, the iron door banging home in a stone room, the bolt and the key); for the gallows the tier-5 bell tolls after it. `Released` turns the key, draws the bolt and swings the door open on a long creak, then the chart's **clear** phrase plays you out. UI bus. |
| The harbor master | `game-audio.ts` | `HarborMasterPaid` counts the coins like a trade (piece E's "piece H's coin"). |
| Sounds | `tools/audio/lib/synth-law.ts`, `raw-assets/audio/law/` | 13 synthesized files, 500 KB, decoded up front (bundle `law-audio`), the paper boy's call among them. No free recording of a steam engine across water, a period gun or a cell door turned up, so all are **synthesized** like the mill saw: the engine is low-passed noise beating with each of the screw's four blades at 96 rpm, a low thud each revolution and three crossheads' knocks (a marine engine exhausts into its condenser, so no chuff), rendered as eight whole revolutions so the pipeline's crossfade loops it seamlessly; the bell is the chart's ship's-bell voice on a 690 Hz prime; the gun a band-passed crack, a 48 Hz boom falling in pitch and echoes off the shore; the hinge stick-slip pulses through the iron's resonances; the paper boy's "Pa-per! Pa-per!" is formant synthesis (a pulse train through three moving resonances on a boy's pitch, sung down a third), so it reads as a shout rather than words, as §2's no-dialogue rule wants. `npm run audio:synth -- law` renders them. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play: each Wanted stinger, the door, the gallows and the release, and with the cutter or tug in the zone each hail, a warning shot, a miss, a hit, the alarm and the ship's bells. Audio → Mix: law engines heard and the last law cue. |

**Download:** the decoded bundles are now 2.2 MB of the 5 MB (plan 15 §8); the pipeline test holds the law bundle under 512 KB.

**Checked:** the rules (which stinger, the quiet spell, the lockup's silence, the patterns, the bells and their clock, the engine and shot levels, the timings) and the playback (buses, placement, delays, captions) by unit tests (`tests/audio-law.test.ts`, 23), the synthesis by tests over the generators, and the bundle and credits by the pipeline tests. In the game with Playwright (`e2e/smoke.spec.ts`): raising the tiers to 1 plays **rise** and then to 3 **hunted**, a hunting cutter's arena has her engine heard and her whistle or bell; and taken at sea the door shuts, and serving the sentence opens it with the **clear** phrase after. A 74-second preview (`law-audio/preview-74s.mp3` in the project files) runs both rising stingers, the Morrill closing with her engine growing, her pursuit whistle, the alarm bell, a warning shot, a miss, a hit, four bells, the tug's rifles, Most Wanted, the door, the release and a region cooling. Levels are set by measurement and need a listen in the game.

### Still to do

1. ~~**The paper boy's shout** in port waits on piece F's newspapers.~~ **Done:** piece F raises `PaperCried` as a port screen opens with an edition unbought, and his call plays on the voice bus (louder for a story about you). The Phase 5 playtest added an e2e test that hears it at Bayfield ([06 §14.14](06-fame-wanted-law-lighthouses.md)); a listen on the laptop is in the route.
2. **Music:** like the chart's, the stingers are synthesized placeholders (§16 item 1).
3. **R1 checks:** how a revenue cutter signaled a ship to heave to in 1900, and whether the *Morrill* struck the ship's bell where a passing schooner could hear it.

## 19. Phase 6 Piece G: Combat Audio (2026-11-09)

**Scope** (plan 07 §14.4 row G; §4.4, §6.1 "Chase / combat", §11 Phase 6 row): the swivel, the cannon and the rifle, the round in flight, landing in water, wood or canvas, the boiler, the grapple and the boarding vignette, the crew's shouts when she strikes, a chase layer for the music, and every file in `CREDITS.md`. Built the way §18's law audio is: pure rules in `src/audio/combat-mix.ts`, playback in `src/audio/combat-audio.ts`, the sounds synthesized in `tools/audio/lib/synth-combat.ts`.

| Part | Where | What it does |
|---|---|---|
| The guns | `combat-mix.ts` (`GUN_SOUNDS`, `reportFor`), `combat-audio.ts` (`fired`) | Every `WeaponFired` plays its gun's report from the muzzle at the speed of sound, one per gun of a rippled broadside, each a touch different. Close to (under 400 m for the swivel, 500 m for a cannon, 150 m for a rifle) it's the near sound: the swivel's sharp bang, the light cannon's deep one with its carriage rumbling back until the breeching brings it up, the rifle's crack and its lever worked after. Further off it's the law's rolling bow gun (played faster for a swivel) and rifle, so there's one far report for every gun on the lake. Carries 6 km (swivel), 8 km (cannon), 2.5 km (rifle), duller with distance and fog. Another ship's gun is captioned with an arrow ("gunfire", "rifle shot"); your own isn't. The weapon's kind comes from `weapons.json`; an unknown id (a law gun) is guessed from its name. |
| The round in flight | `combat-mix.ts` (`closestApproach`, `flybyFor`), `combat-audio.ts` (`update`) | Each frame the shots in the air (`combat.shots()`) are looked at a second ahead along their flight: one that will pass within 70 m (a rifle ball, 18 m) gets a fly-by, started so the buffer's pass (0.9 s in; 0.12 s for the zip) falls on its closest approach, louder the closer, placed where it passes. Each shot once; your own never (you hear your round going away instead: the fly-by's tail just after the bang, quieter, out along the bearing). |
| Where it lands | `combat-mix.ts` (`impactFor`), `game-audio.ts` | `ShotLanded` in the water: the law's splash for a round, a plip for a rifle ball. In a ship: `ShipHit`'s location, read once the ball's hit is resolved (a hit that takes nothing off still sounds): the rigging is canvas punched and torn (chain shot parts a stay, the law's rigging hit), anywhere else planking stove in with splinters and bits coming down; a rifle ball is a small knock. Heard from where it struck, after its sound's travel. |
| The boiler | `combat-audio.ts` (`boiler`) | `BoilerExploded`: a deep blast, roaring steam that dies over several seconds, iron coming apart and wreckage splashing down, the blast rolling back off the shore. Heard across the zone (9 km, full within 250 m), captioned. |
| She strikes | `combat-audio.ts` (`struck`) | `MoraleBroken`: her crew calling out to hold fire from her deck, her bell rung fast (the voice bus, 1.5 km), captioned; and inside 3 km the **struck** stinger: the chase's tune runs up and resolves on D major. The chase layer ducks under it and settles once its hold runs out. |
| Alongside | `gameplay/boarding.ts` (`ShipGrappled`, new), `combat-audio.ts` | F that opens the boarding session raises `ShipGrappled`: the hook swung and thrown, biting on her rail, the line hauled taut, the hulls grinding together. The panel's vignette (§6.2 of plan 07): Intimidate that works has her crew calling out; one that doesn't, a rough shout of defiance with handspikes on the rail. Fight is the melee (shouts, handspikes and steel, feet on deck, a pistol or two), then 3.9 s in your crew's three huzzahs or hers as you're driven back. The outcome is read from the events that follow the attempt in the same call. A fight that kills you is left to the end screen. |
| The chase layer | `combat-mix.ts` (`chaseLevelFor`, `ChaseState`, `stemGains`), `combat-audio.ts` | "Hard Alee", an original 16-bar tune in D dorian at 138 (27.8 s), rendered as two stems that loop together sample for sample (decoded, both started on the same instant): **drums** (frame drum on a reel rhythm, a low drum, low strings pulsing on the root) and **fiddle** (the tune, with concertina stabs on two and four). Level 1, the drums alone, when a target is on the alert, or running or turning on you, within 2.5 km, or the law is after you anywhere; level 2, the fiddle on top, for 20 s after any gun within 2 km, a target running or turning on you within 1.5 km, or the law within 1.5 km. It rises at once and falls after 8 s at a lower level. While it plays the open-water music treats the mood as quiet (§6.2's horizontal crossfade); stems silent 8 s are stopped. |
| Sounds | `tools/audio/lib/synth-combat.ts`, `raw-assets/audio/combat/` | 17 files: 15 in `combat-audio` (340 KB) and the two stems in `combat-music` (1.03 MB), all decoded up front. No free recordings of period guns, a boiler, or crowds at sea turned up, so all are synthesized like the law's: guns are a band-passed crack, a sine boom falling in pitch, low-passed noise for the powder's body and the smoke rolling out, and a slap back off the water; the fly-by two noise bands and a warbling tone whose pitch drops through the pass; the voices are formant shouts (the paper boy's synthesis, `syllable`, with men's vowels and pitches), so no words, as §2 wants; the stems' tails are folded back onto their heads so each loops seamlessly. `npm run audio:synth -- combat` renders them. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play: your swivel, cannon and rifle, a cannon at 1.5 km and a rifle at 300 m, a round going by and a ball's zip, the three impacts, the boiler, the grapple, the four boarding outcomes, a ship striking, and the chase layer held at 0, 1 or 2. Audio → Mix: the chase level, the fly-bys heard and the last combat cue. |

**Download:** the decoded bundles are now 3.5 MB of the 5 MB (plan 15 §8); the pipeline test holds the combat bundle under 512 KB and the stems under 1.25 MB. Decoded, the stems take about 11 MB of the 40 MB budget.

**Checked:** the rules (reports near and far, fly-by timing, impacts, the chase levels and their hold) and the playback (sounds, buses, delays, captions, the boarding outcomes) by unit tests (`tests/audio-combat.test.ts`, 17), the synthesis by tests over the generators (the stems one exact loop long with no step at the seam), and the bundles and credits by the pipeline tests. In the game with Playwright (`e2e/combat-audio.spec.ts`): a warning shot from the swivel starts the chase at level 2 and splashes; warning shots until the tug strikes play her crew's call; boarding her plays the grapple. A 76-second preview (`combat-audio/preview-76s.mp3` in the project files) runs the chase coming in, two warning shots from the swivel, the rifle, a T2's broadside into wood and canvas, a gun 700 m off with its round going close past and splashing, rifle shots with a zip and a plip, a boiler 600 m off, a tug striking with the stinger, the grapple, her crew's defiance, the fight and the cheer, at the game's bus volumes. Levels are set by measurement and need a listen in the game.

**Calls made here.** The law's ships keep their own sounds: a `WeaponFired` or `ShotLanded` by the cutter or the tug isn't played here, since §18's `CutterFired` already plays her gun and where the round fell; piece F, which puts the *Morrill* on piece A's ballistics, should keep one of the two. Her rounds still whistle past. Gunfire from your own deck counts toward the chase as much as anyone's. The chase layer replaces the open-water music rather than layering over it, since the waltz and the air are in other keys and tempos.

### Still to do

1. **Music:** like the stingers, "Hard Alee" is a synthesized placeholder (§16 item 1).
2. **A listen in the game** (plan 07 §14.4 row G: "Listen by ear"): the stems' balance against the guns, the gun levels from the deck at each camera place, and the chase's thresholds and hold. It's step 7 of the Phase 6 laptop route and decision 2 there ([07 §14.14](07-combat-boarding-targets.md)).

---

## Changelog
- v1.2: The Phase 6 playtest's listen is on the laptop route (§19).
- v1.1: Phase 6 piece G built (§19): the guns near and far, the round in flight, impacts in water, wood and canvas, the boiler, the grapple and the boarding vignette, her crew as she strikes with a stinger, and the chase layer.
- v1.0: The paper boy's call wired to piece F's papers and checked in the Phase 5 playtest (§18).
- v0.9: Phase 5 piece H built (§18): Wanted stingers, the cutter's whistle hails, engine, bell and bow gun, the deputies' rifles, the lockup's door and release.
- v0.8: Phase 4 piece J built (§17): harbor work sounds at the ports, trade sounds, captions for fog signals and ship whistles, and a recorded chime whistle.
- v0.7: Phase 3 piece J part 2 built (§16): the chart's traveling theme, six encounter stingers, the fade-to-fog sound and the Interface slider.
- v0.6: Phase 3 piece J part 1 built (§15): the NPC ships' steam whistles and the schooner-barge's fog horn, fog signals from the 1895 Great Lakes rules, passing signals, and a whistle per class in `ships.json`.
- v0.5: Phase 2 piece H built (§14): rain, thunder after the lightning, fog hush and damping, directional fog signals with a rhythm per station, gulls and loons, open-water music v1, the Sound tab. Decision row for the Phase 2 sources.
- v0.4: Phase 1 sailing audio built (piece I): pipeline, mixer and buses, autoplay unlock, the sailing soundscape. Decision row for procedural wind beds.
- v0.3: Gap review: master plan aligned to this plan's sourcing order; no content change here.
- v0.2: Decisions: traditional song motifs, no spoken dialogue, instrumental saloon music, CC0-first SFX, period folk style.
- v0.1: Initial audio plan: goals, style (period folk, Great Lakes song tradition), sources and license gate, sound list by system, audio-as-gameplay rules, dynamic music states and technique, buses and spatialization, budgets, pipeline, data/state, phasing.
