# 15 — Audio

Status: DRAFT v1.5 (decisions made; Phase 1 sailing audio, Phase 2 weather and harbor audio, Phase 3 ship whistles and chart music, Phase 4 harbor work and trade sounds, Phase 5 law audio, Phase 6 combat audio, Phase 7 on-foot audio and Phase 8 build and craft audio built and checked)
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
| **Song tradition (decided)** | Arrangements of **traditional Great Lakes and lumberjack songs** (public-domain melodies) as motifs, e.g., *"Red Iron Ore"* (an ore-boat song from this very trade), *"The Bigler"*, *"The Persian's Crew"*, *"The Shanty-Man's Life"*. All four are printed with their melodies in Franz Rickaby, *Ballads and Songs of the Shanty-Boy* (1926), public domain in the US and abroad (Rickaby died in 1925); arrange from that book, not from Lomax's 1938 recordings or Walton's *Windjammers* (2002), which are protected. Sources and the full shortlist: §25. |
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
| Initial audio download | ≤ 8 MB decoded up front (raised from 5 MB in Phase 8, §21); the music streams on top |
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
3. ~~**Music:** the synthesized tunes are placeholders, and the *Red Iron Ore* motif waits for R1 to confirm which Great Lakes melodies are public domain (§2).~~ *Red Iron Ore* is the day cue now (§25); the night air is still a placeholder.
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

## 20. Phase 7 Piece I: On-Foot Audio (2026-11-15)

**Scope** (plan 08 §20.4 row I; §4.5, §6.1 "Stealth", §11 Phase 7 row): footsteps per surface and gait at the gameplay noise radius, locks, doors, crates, coins, rope, the cosh, guard barks and whistles, swimming, the stealth layer and its stinger, Bayfield's docks at night, the saloon's room and music, the island's forest, and every file in `CREDITS.md`. Built the way §18 and §19 are: pure rules in `src/audio/foot-mix.ts`, playback in `src/audio/foot-audio.ts` (`FootSounds`), wired in `game-audio.ts` and `main.ts`.

| Part | Where | What it does |
|---|---|---|
| Footsteps | `foot-mix.ts` (`stepSound`, `stepGain`), `gameplay/ashore.ts` (`deps.sounds`) | Ashore counts your strides with the same `Footsteps` and `footstepRadiusM` the guards hear by, everywhere you can walk (a district, an island, a plain shore), and each stride plays the ground's sound at a gain set by that radius: a sneak on grass (under a meter) is barely there, a run on planks (18 m) is full. Six grounds, two variants each, pitched a little differently every step: wood (interior boards duller), dirt (sand and sawdust from it), gravel, grass, stone (rock lower), snow. A sneak is lower and muffled, a run sharper. |
| The body | `foot-audio.ts` (`landed`, `update`) | A landing above 3 m/s thumps, harder the faster. Into the lake is a splash, captioned; each swimming stride is a stroke; in water under 18 °C a shivering breath comes every 3 to 9 s, oftener the colder. |
| The kit | `foot-audio.ts` (`tool`, `heist`, `jail`) | From the on-foot events: the cosh, the knife, rope tied, a bottle taken, a bribe counted out (the port's coins), a body or a crate into the lake or onto the planks, a thrown stone landing where it fell after its flight (placed, captioned), the rifle (the law's) and the pistol (the same report pitched up). A lock's loud click, the lock giving and the door after it, the crowbar, a snapped pick, and while F is held on a lock that's making progress, slices of a pick at work. A crate up and down, a cash box counted, papers rustled. In the lockup: irons (the anchor chain, pitched up), keys, the cell door, the bars. |
| The watch | `foot-mix.ts` (`barkFor`, `voiceRate`, `heardAt`), `foot-audio.ts` (`stealth`) | Each guard's change of state speaks, wordless (§2), from where he stands, with a caption: a hum as he grows suspicious ("Hm?"), a challenge when a noise draws him ("Who's there?"), a shout when he's sure ("Hey! Stop!"), a mutter as he searches, a grunt as he gives up, a cry over a body. Each man has his own pitch, marshals lower, sailors higher. A constable's alarm (the stealth sim's `whistle` noise) is a pea whistle heard across the district, captioned. Voices fade and dull with distance and stop at their reach (12 to 45 m). |
| The stealth layer | `foot-mix.ts` (`tension01`, `tensionGain`), `foot-audio.ts` | A looped bed on the music bus: a low open fifth on strings and a muffled heartbeat drum. Its level follows the worst guard near you: a filling meter brings it in, a search raises it, a chase is full; distance thins all but the chase. Being seen (`PlayerSpotted`) plays the **spotted** stinger, at most once in 12 s. The open-water music stays out of town and out from under the layer. |
| Places | `foot-mix.ts` (`placeMix`), `foot-audio.ts` (beds) | Looped beds with a low-pass each, eased over about half a second and dropped after 4 s of silence. **Docks:** the lake at the piles in a district, more after dark, faint and dull under a roof. **Saloon:** while it keeps its hours, "The Booth Street Polka" and the room's talk from the bar's position: a muffled tune from up to 38 m down the street, opening up as you step inside; the tune gives way as the stealth layer rises. **Woods:** wind in the trees on an island or a wild shore, with the wind's speed. **Crickets:** June to September, after dark, not in rain. |
| The weather | `game-audio.ts` (`updateAshore`) | On foot the world soundscape stays on, heard from where you stand: rain (less under a roof), thunder, the fog's hush, fog signals, gulls and loons, the shore, and the harbors at work. |
| Sounds | `tools/audio/lib/synth-foot.ts`, `raw-assets/audio/foot/` | 45 synthesized files in bundle `foot-audio` (1.35 MB), decoded up front. Voices are formant syllables like the combat crowds'. The stealth layer and the saloon's tune are encoded as beds (64 kbps) to fit the budget and played on the music bus. `node tools/audio/synth.ts foot` renders only these. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play → "Ashore: sound" picks any of the 45 and plays it. `data-foot-steps`, `data-foot-step`, `data-foot-cue` and `data-foot-beds` on the body read what's sounding. |

**Download:** the decoded bundles are now 4.96 MB of the 5 MB (plan 15 §8); the pipeline test holds the foot bundle under 1.5 MB. Phase 8's build and UI sounds will need room: streaming the saloon's tune and the chase stems is the first place to find it.

**Checked:** the rules and the playback by unit tests (`tests/audio-foot.test.ts`, 42: the gain against the gameplay radius, every surface, the barks per state change, reach and walls, the layer's levels, the places, the kit's events, the synthesis and its loop seams), the bundle and credits by the pipeline tests, and in the game with Playwright (`e2e/foot-audio.spec.ts`): planks underfoot on Bayfield's pier, the docks at night, the room and tune inside the saloon, the cosh, a captioned shout or whistle and the layer coming up.

**Calls made here.** Your own sounds play at the listener, not in the world; only the watch and a landing stone are placed. Footsteps are counted by the ashore mode, not taken from the stealth sim's noise events, so they sound where there is no watch. A guard's sailor-type "shout" alarm has no separate sound; his alerted bark covers it. Walls don't yet muffle a voice (`heardAt` takes `walled`, nothing passes it).

### Still to do

1. **Jailbreak sounds, to revisit later** (Jared, 2026-11-15, after the first escape): the sounds during a jailbreak came out odd. Not urgent; look at them once the crowd and the 0.7.1 work are done.
1. **A listen in the game** (row I: "Listen by ear"): none of this has been heard by a person. The balance of footsteps against the beds, the voices' reach, the layer's thresholds and whether the synthesized steps read as their grounds are for the Phase 7 playtest.
2. **Not built from §4.5:** ice and puddles underfoot, bears, wolves and deer, teeth chattering and gusts as warmth drops (Phase 9 with the islands' wildlife and winter), the rowboat's oars, occlusion and reverb by room.
3. **Music:** the layer, the stinger and the polka are synthesized placeholders (§16 item 1).

---

## 21. Phase 8 Piece I: Build and Craft Audio (2026-11-17)

**Scope** (plan 09 §16.4 row I; §4.6, §11 Phase 8 row): saw, hammer, stone set, placed, refused and deconstructed; the work session's bed; the forge, the cooperage and the still; the UI set; the decoded budget raised to 8 MB here and in the pipeline test; every file in `CREDITS.md`. Built the way §19 and §20 are: pure rules in `src/audio/hideout-mix.ts`, playback in `src/audio/hideout-audio.ts` (`HideoutSounds`, `UiCues`), wired in `game-audio.ts`, `build-mode.ts` and `main.ts`.

| Part | Where | What it does |
|---|---|---|
| Build mode | `build-mode.ts` (`deps.sounds`, `BuildSounds`), `hideout-audio.ts` | Opening and closing build mode is the logbook's paper (the port screen's open and close); a new palette category turns a page. A piece laid out in the plan knocks, lower for stone and a touch higher for iron (`familyOf`: brownstone and flagstone are stone, cloth, tarpaper and turf soft, the rest wood); a placement, a removal or a Build that can't be done is a dull, muffled thud. Undo and redo knock softly. A built piece taken down is pried off (the bar, the boards groaning, a nail squealing out, the boards clattering onto the pile); a plan only cleared knocks. |
| The work session | `hideout-mix.ts` (`workVignette`) | Build runs the clock on by hours or days in an instant, so it's heard as a vignette: the yard at work (a looped bed of saws and hammers a little way off) for 2.5 s, longer for longer work up to 7 s for a few days, and over it a beat about every 1.1 s for the pieces put up in order: a saw and a hammer in turn for wood, the stone set (and now and then a heavy hammer) for stone, a hammer pitched up for iron, a light hammer for tarpaper, cloth or turf. A stone wall sounds of stone, a plank room of saws and hammers. |
| The stations | `hideout-mix.ts` (`craftCues`), `stash.ts` (`ItemCrafted` now carries `station` and `seconds`) | A craft plays its station: the smithy's forge (the bellows twice, heavy-tap-tap on the anvil three times, the quench), the cooper driving hoops round a barrel and sounding its head, the still loaded (mash poured, the copper cap seated, a match and the fire, the first bubbles), and at the workbench a saw, the plane and a hammer. Work of four hours or more plays the station a second time, softer. |
| The still at work | `hideouts.ts` (`runningStills`), `FootFrame.stills`, `HideoutSounds.update` | Ashore, a built distillery with a batch still running simmers and drips where it stands (a looped bed placed at the pot, on the ambience bus): full beside it, duller and fainter further off, gone past 28 m. Off your feet it stops. |
| Salvage | `game-audio.ts` (`SalvageTaken`) | A load of brownstone set down in the stores or the hold is the stone set, pitched down; lumber is the on-foot crate set down. |
| The UI set | `UiCues` | Plan §4.6's rest: a contract taken (`ContractAccepted`) is a rubber stamp, a paper bought (`NewspaperBought`) is shaken open, price news heard (`RumorHeard` of kind `price`) comes over a telegraph sounder, a still's batch run off (`ProductionCompleted`) rings a soft hand bell, and an Ambition met or a contract delivered a counter bell twice. Bells come no closer than 2 s, so a night of batches rings once. On the UI bus, not placed. Paper, the ledger's pen and coins were already here (§17). |
| Sounds | `tools/audio/lib/synth-hideout.ts`, `raw-assets/audio/hideout/`, `raw-assets/audio/ui/` | 13 files in bundle `hideout-audio` (318 KB) and 6 in `ui-audio` (71 KB), all decoded up front. Synthesized like the rest: the saw is high band-passed noise chopped at the rate the teeth cross the cut over the board's ring, push louder than pull; the hammer a crack, the nail's ring rising blow to blow and a thud, the last blow dull as the head seats; the anvil the harbor's struck-plate clang pitched up with a long ring; the still's bubbles short rising sines. The yard and the still are beds (64 kbps) looped with a 1 s crossfade. `node tools/audio/synth.ts hideout` and `... ui` render only these. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play → "Hideout: sound" picks any of them and plays it. `data-hideout-cue`, `data-hideout-still` and `data-ui-cue` on the body read what's sounding. |

**Download:** the decoded bundles are now 5.22 MB; the budget is **8 MB** (plan 08 §20.8.3 decision 4's recommendation, taken as plan 09 §16.5 assumed it). The pipeline test holds the hideout bundle under 512 KB, the UI bundle under 128 KB and all the decoded bundles under 8 MB.

**Checked:** the rules and the playback by unit tests (`tests/audio-hideout.test.ts`, 32: every material in `structures.json` heard as a family, the knock's pitch, the vignette's length and beats by material, every station in `stations.json` with a sound, the still's level, the build mode cues, the yard under Build, salvage, the bells' gap, and the synthesis finite and audible with the beds a crossfade longer than their loops), the bundles and credits by the pipeline tests, and in the game with Playwright (`e2e/hideout-audio.spec.ts`): at Stockton the build mode's paper, a wall on bare ground refused, foundations placed, Build's beats, a piece pried down and the paper closing; in the workshop the bench ending on the hammer, the cooperage, the still loaded and its bell a day later. An 80-second preview (`hideout-audio/preview-80s.mp3` in the project files, raised 4 dB overall) runs build mode opening, a page, three knocks, a refusal, an undo, a day of plank work and a day of stone, a piece pried down and a plan cleared, the paper closing; the workbench, the forge, the cooperage (a long job, twice) and the still loaded; walking up to a still at work; salvage set down; and the stamp, the paper, the telegraph and both bells, at the game's bus volumes.

**Calls made here.** The work session is a vignette of a few seconds rather than a bed held while the clock runs, since Build passes the hours in one step. Build mode's own cues (knock, thud) are on the UI bus and the work on the SFX bus, so turning the Interface slider down leaves the building heard. The still at work is heard only on foot, not from the build camera or the deck. No bell for notices in general: most of the game's notices are refusals, and a bell on each would nag.

### Still to do

1. **A listen in the game** (row I: "Listen by ear"): none of this has been heard by a person. The yard's level under the beats, the knock against the thud, and whether the forge and the cooperage read as what they are, are for the Phase 8 playtest (piece J).
2. **Not built from §4.6:** the chart unrolling. ~~Notification chimes per priority~~: built in the polish pass (§26).
3. ~~**The slipway (piece G):** a ship's launch and work on the ways have no sounds yet~~: built in the polish pass (§26).

## 22. Phase 9 Piece J: Stage 1 Audio (2026-11-19)

**Scope** (plan 11 §18.4 row J; §4.1, §4.5, §4.6, §11 Phase 9): the saloon's piano and fiddle by night, cards and chips at the poker table (piece C), the lighthouse station on foot (the lamp's clockwork, the oil house, the keeper; piece H), letters and the harbor master (piece A), a copycat rival's stinger (for piece E, built in parallel), and a ship going aground (piece I). Built the way §20 and §21 are: pure rules in `src/audio/sandbox-mix.ts`, playback in `src/audio/sandbox-audio.ts` (`SandboxSounds`), wired in `game-audio.ts`, `foot-audio.ts`, `main.ts` and `ui/mount.tsx`.

| Part | Where | What it does |
|---|---|---|
| The saloon by night | `sandbox-mix.ts` (`saloonNight`), `foot-audio.ts` (bed `nightTune`), `SandboxSounds.update` | From 7 PM to 5 AM "The Late Boat Waltz" (24 bars of 3/4 in D: an upright piano a little out of tune keeping the oom-pah-pah, a fiddle on the tune) replaces "The Booth Street Polka", heard from the street and in the room as the polka was (§20). At a port screen, the saloon tab or the card table plays the room's talk and the tune of the hour, since most ports have no district to walk into; ashore the district's own beds play instead. |
| The card table | `sim/poker/table.ts` (`HandState.beats`), `gameplay/poker.ts` (`PokerBeats`), `pokerCues` | The table records each move as a beat (the deal with its antes, check, call, bet, raise, fold, each draw, the hands shown, the pot taken), and after each of your moves the beats since are heard in order about half a second apart: the antes in and a riffle shuffle and bridge, a card dealt round for each, two knuckle raps for a check, chips onto the pile (two handfuls for a bet, three for a raise), the cards tossed in for a fold, the discards in and a card for each drawn (a rap for standing pat), the hands turned up, and the pot raked in, louder when it's yours. A long round of raises is played quicker, never cut (at most 9 s). A palmed card seen scatters the chips and lands the blow (`PokerCheatCaught`). |
| The lighthouse station | `station-watch.ts` (`hooks.sound`, `StationOnFoot.sound`), `clockworkLevel`, `snoreLevel`, `stationCues` | While the lamp burns at night its clockwork turns (a looped bed placed at the lamp: the escapement's tick and tock, the gear train's whir, the lens carriage rumbling round, a chain link): full in the lantern room, a dull tick from the ground that's gone by 30 m. A keeper asleep in the house snores through the wall at its door (within 9 m, more of them louder). Put out, the wick's screwed down, the flame gutters out and the clockwork runs down; lit, a match flares, the wick takes and the weight is wound up again (the crank's ratchet). The tower's stair rings under a dozen iron treads each way; the oil house's can knocks and sloshes, sloshes again every 1.6 m you carry it and as it goes into the boat; a keeper by day greets you (wordless, §2); the rope, the tin box and the logbook use the on-foot and port sets. |
| The harbor master | `mount.tsx` (`onPortTab`), `events.ts` (`LetterRead`, `LetterAnswered`) | His tab opening rings his desk bell; a letter opened for the first time is torn open and unfolded; an answer is written (the ledger's pen) and folded and sealed. |
| A rival's stinger | `RivalStinger` on the bus, `SandboxSounds.rival` | For piece E to raise with `{ rival, why }`: the fiddle plays a swaggering run up D major and the concertina mocks it a half step flat, over a drum and a low drone, ending on a tritone. News of a rival plays it softer, a rival beaten a little lower and slower; never closer than 20 s to the last; the chart's theme dips under it. `__glpAudio.rival(why)` plays it under `?debug`. |
| A ship aground | `wrecking.ts` (`ShipStranded`), `agroundHeard`, `groundingGain` | A ship put on a wrecking mark's shoal is heard from where she struck, up to 3 km across the water: the forefoot's boom, the keel dragging over rock and slowing, the timbers groaning and a plank giving, then her crew shouting and her bell rung hard; further off quieter and duller, and fog dulls it more. Captioned with its bearing ("A ship aground", "…, breaking up"). Your own ship touching bottom (`ShipGrounded`, over 1.5 kn or hard) plays the hull's part, harder the faster. |
| Sounds | `tools/audio/lib/synth-sandbox.ts`, `raw-assets/audio/sandbox/` | 25 synthesized files in bundle `sandbox-audio` (0.93 MB), decoded up front. New voices: an additive piano (three detuned strings, stretched partials, a hammer's thump, the damper), a fiddle melody note (the combat set's bowed note through the fiddle's body), clay chips, the riffle, a kerosene slosh, the tin can, a snore, the desk bell. The waltz, the clockwork and the snore are beds (64 kbps), their tails folded onto their heads. `node tools/audio/synth.ts sandbox` renders only these. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play → "Stage 1: sound" plays any of the 25. `data-sandbox-cue`, `data-sandbox-cues`, `data-sandbox-beds` and `data-sandbox-tune` on the body read what's sounding; `__glpAudio.sandbox()` the levels. |

**Download:** the decoded bundles are now **6.13 MB** of the 8 MB (§8): 5.22 MB before and 0.93 MB here, 0.43 MB of it the waltz. The pipeline test holds the stage 1 bundle under 1 MB. The streamed music is unchanged.

**Checked:** the rules and the playback by unit tests (`tests/audio-sandbox.test.ts`, 18), the bundle and credits by the pipeline tests, and in the game with Playwright (`e2e/stage1-audio.spec.ts`): at Washburn at 9 PM the saloon tab's room and waltz, a hand dealt and played to the pot raked in, the harbor master's bell; on Raspberry's gallery at 11 PM the clockwork, and the rival's stinger from its hook; a ship stranded at a mark heard going aground. A 135-second preview (`stage1-audio/preview-135s.mp3` in the project files, with its spectrogram) runs the saloon at night and then from the street; a hand of cards; the clockwork from the ground, the stair, the clockwork on the gallery, the lamp put out, lit and wound; the oil can carried; a keeper snoring and one greeting; the harbor bell, a letter opened and an answer sealed; the rival's stinger; a ship aground near, then 2.5 km off, then your own ship touching bottom.

**Calls made here.** The night tune is a second bed that takes over at 7 PM, so the change is a short crossfade between tunes. The port screen's saloon plays only while its tab or the card table is shown, over the paused game. Every lighthouse lamp is heard as turning clockwork, though a fixed light had none: the data doesn't yet say which lenses revolved. Poker's beats live on the hand in memory, not in the save. The rival's stinger is an event on the bus, so piece E needs no audio import: `ctx.events.emit('RivalStinger', { rival, why })`.

### Still to do

1. **A listen in the game** (row J: "Listen by ear"): none of this has been heard by a person. The waltz against the room, the clockwork's level from the ground, the card table's pacing, and whether the stranding reads at 2 to 3 km are for the stage 1 playtest.
2. **Piece E** raises `RivalStinger` (sighted, in the papers, at the parley, beaten); until it lands only the dev hook does.
3. **Not built:** a fixed light's lamp without clockwork (needs a lens type in `lighthouses.json`), the keeper's own steps on the stair and his winding round on watch, a letter's arrival heard, the moon-cussing night's own music.

## 23. Phase 9 Piece N: Winter Audio (2026-11-20)

**Scope** (plan 11 §18.4 row N; §4.1, §4.5, §11 Phase 9): ice cracking and groaning, snow underfoot, winter wind, a sled, teeth chattering and gusts as warmth drops, and frozen-in harbor nights, hooked to piece M's thin ice, warmth and sled (plan 11 §18.15) and piece K's ice (plan 04 §26). Built the way §21 and §22 are: pure rules in `src/audio/winter-mix.ts`, playback in `src/audio/winter-audio.ts` (`WinterSounds`), wired in `game-audio.ts`, `ashore.ts` and `main.ts`.

| Part | Where | What it does |
|---|---|---|
| Thin ice | `IceGave` (piece M), `thinIceSound`, `WinterSounds.iceGave` | At 25% stress the ice cracks underfoot (a snap, the sheet settling, and the crack running off as lake ice's falling "pew"). After that, smaller cracks come closer together as the stress builds, and slower when you stand still. At 60% it groans (a low rising moan, stick-slip, a deep pew), and groans keep coming over the cracks. At 100% it gives way: a big crack, plates knocking, shards, the plunge, then the on-foot splash. Each warning is captioned ("The ice cracks", "The ice groans", "The ice gives way"). In the hole, `IceClimbed` (new) plays the haul out (wet wool dragged up, a grunt, water pouring off) or, if the edge breaks away, a crack and a splash. |
| Underfoot | `winterStep`, `ashore.ts` (`winterGround`), `deps.sounds.step(…, ground)` | In winter a stride says what it's on: bare lake ice, snow over the ice, or snow lying on the ground (not planks, stone or under a roof). Bare ice is a heel tick, a scuff and a hollow knock. Snow is the on-foot set's crunch, a little brighter over ice. Below −10 °C snow squeaks. Gain comes from the same guards' radius as every step (`stepGain`). The gameplay noise radius is unchanged. |
| The sled | `SledHandled` (new), `runnerLevel` | Putting the sled down, loading, unloading, selling, stowing and taking up or dropping the rope each has a sound (the load is a thump and the rope drawn tight). While it's hitched, a looped bed of the runners follows its speed (worked out from its position each frame): silent standing, a hiss at a walk, fuller with a load, brighter and a touch higher on bare ice. |
| The cold in you | `gustEveryS`, `chatterEveryS`, `shiverEveryS`, `WarmthCritical` | On foot (not in the water, not under a roof), gusts swell past you more often and harder as warmth drops: about every 26 s warm, down to every 5 s freezing, more often in a strong wind. A shivering breath comes from chilled on. Teeth chatter from cold (about every 7 s) and freezing (about every 3.5 s). Falling a stage (`WarmthCritical`) brings a gust, and from cold a bout of chattering. |
| The winter wind | `winterness`, `winterWind` | A dry, hollow bed with a moan in it and snow hissing along the surface in the stronger breaths. It comes in with freezing air (full by −8 °C) or ice on the water, only in November to April (half in October and May). Its level and brightness follow the wind. Through a wall it's a muffled moan. Afloat it's a little lower, under the ship's own wind. |
| A frozen harbor at night | `frozenHarbor`, `iceBoomEveryS`, `snowShare` | Wherever the ice has closed over the water (`iceCover01` from piece K), the water's sounds stop: no lapping at the docks, gulls and loons nearly gone. Near a harbor, at night, a still bed comes up: still air, a ship's timbers ticking in the ice, a rope's end on a mast, the ice far off. It is strongest in a calm, and only a trace by day. Over a closed sheet, the lake's ice booms now and then from 0.4 to 2.5 km off (a deep thump and a long falling pew, placed and dulled with distance), more often on cold nights. Snow falling turns the rain bed down (all snow by −2 °C), so snowfall is silent. |
| Sounds | `tools/audio/lib/synth-winter.ts`, `raw-assets/audio/winter/` | 18 synthesized files in bundle `winter-audio` (0.46 MB), decoded up front. The ice's voice is `chirp`: a sine falling fastest at first, because a crack's high frequencies outrun its low ones across the sheet. The wind, the frozen night and the runners are beds (the wind and the night at 64 kbps; the night's tail is folded onto its head). `node tools/audio/synth.ts winter` renders only these. |
| Dev panel | `src/debug/audio-panel.ts` | Audio → Play → "Winter: sound" plays any of the 18. `data-winter-cue`, `data-winter-cues` and `data-winter-beds` on the body show what's sounding. `__glpAudio.winter()` gives the levels and counters. |

**Download:** the decoded bundles are now **6.59 MB** of the 8 MB (§8): 6.13 MB before and 0.46 MB here, 0.24 MB of that the two beds. The pipeline test holds the winter bundle under 640 KB. The streamed music is unchanged.

**Checked:** the rules and the playback by unit tests (`tests/audio-winter.test.ts`, 25: the season, the wind, gusts and chattering by stage, thin ice's stages and repeats, the steps by ground and frost at the guards' gain, the runners, the frozen harbor and the booms, silence out of season, and the synthesis: finite, audible, loop lengths, a falling chirp). The pipeline tests check the bundle and credits. In the game, Playwright (`e2e/winter-audio.spec.ts`) checks this frozen in at Bayfield in February, on the ice road: the wind bed, the sled put down and loaded, the runners and winter steps as you haul it, thin ice cracking, groaning and giving way, the haul out, and teeth chattering as warmth runs down. A 78-second preview (`winter-audio/preview-78s.mp3` in the project files, with its spectrogram) plays, in order: the winter wind and two gusts, snow steps and then squeaking snow, the sled put down and loaded, the sled hauled over bare ice, thin ice from the first crack through the groans to giving way and the haul out, the cold in you (gusts, chattering, a shiver), and a frozen harbor's night with the ice booming far off.

**Calls made here.** Winter steps change only the sound, not the gameplay noise radius: snow and ice keep the radius of the ground the scene says is there, which is piece M's to change. The ice road's cleared lane sounds like any ice. The runners play at the listener, not where the sled is, since it's 2.6 m behind you. Whether a harbor is frozen in is read from the ice cover where you are within about 1.3 km of a harbor, not from each port's `harborClosed`, so a frozen anchorage off a harbor sounds the same. The air for the wind and the squeak is `weather.airAt` (the zone's air, not per point). Gusts and chattering are on foot only. Aboard, the galley stove keeps you warm (piece M).

### Still to do

1. **A listen in the game** (row N: "Listen by ear"): none of this has been heard by a person yet. Still to judge in the stage 2 playtest: whether the crack's pew reads as lake ice, how the groan sits against the wind, how often the gusts and chattering come, and whether the frozen night is too empty.
2. **Not built:** a wind through bare rigging aboard a frozen-in ship, shore-ice ridges heaving, sled dogs, skates. ~~The ice grinding on a hull under way~~: built in the polish pass (§26).

## 24. Phase 9 Piece Y: Islands Audio (2026-11-21)

**Scope** (plan 11 §18.4 row Y; §4.1, §4.5, §11 Phase 9): the birds, creek and surf of an island by its tier and the season, the woodpecker, a sea cave's hush, drips and surge, the deer, the bear and the wolves, the grapple going down and coming up, a dig, and the ending's air. Built the way §23 is: pure rules in `src/audio/island-mix.ts`, playback in `src/audio/island-audio.ts` (`IslandSounds`), wired in `game-audio.ts`, with the animal cue hook in `gameplay/onfoot/wildlife.ts` and `AnimalCue` in `modes/context.ts`. The sounds are synthesized in `tools/audio/lib/synth-island.ts`, rendered by `tools/audio/synth.ts`, in bundle `island-audio`, and the ending air in `ending-audio`.

| Part | Where | What it does |
|---|---|---|
| Beds | `island-mix.ts` (`islandBeds`, `seasonOf`) | Birds by season (spring and summer full, autumn a quarter, winter none), by tier (hero, standard, rock), by day and wind, and quieter under a roof. A creek on hero and standard islands, swollen in spring, frozen in winter. Surf on rock islands by the wind. |
| Woodpecker | `island-mix.ts` (`woodpeckerGapS`) | Spring and summer, by day, on a wooded island, every 40–110 s. |
| Sea cave | `island-audio.ts` (`enterCave`, `leaveCave`, `surge`) | The hush while you're inside (from the boat or on foot), a drip every 2.5–7 s from one of two, the surge at the mouth once per 6 s. |
| Animals | `island-mix.ts` (`animalCue`, `callGain`), `island-audio.ts` (`animal`) | A deer's snort and bound on a bolt; a bear's huff on a threat and its growl on a charge; the wolves' howl from the trees, the nearer pack's second. Placed where the animal is, quieter with distance (full within 10 m, gone by 300 m), captioned. |
| Grapple and dig | `island-audio.ts` (`grappleCast`, `grappleHaul`, `dig`) | The line whirrs out at `GrappleCast` and comes up at `WreckWorked`; a dig (`Dug`) plays three spade strikes. |
| Ending | `game-audio.ts` (`RunEnded`) | A stream of the ending air, about 55 s, after one second. |

**Calls made here.** The loops are crossfaded in the synthesis and not again by the pipeline (their loop crossfade is 0). The ending is a stream, so it doesn't count toward the decoded 8 MB; it has a 7 MB ceiling of its own. The animal cue carries 300 m, a guess to be checked by ear. The surge's size is a fixed swell of 2 m, since `CaveSurge` doesn't carry one.

### Still to do

1. **A listen in the game** (row Y: "Listen by ear"): none of this has been heard by a person yet. Judge the birds and the creek against the forest bed, the wolves' and the bear's levels and their reach, the cave's drips and surge, the spade and the grapple, and the length of the ending air.
2. **Not built:** a separate wolf growl. ~~The diving suit's sounds~~: its descent is built in Phase 10 ([11 §19](11-exploration-islands-secrets.md)). ~~A bear's crash off through the brush~~: built in the polish pass (§26). ~~Stopping the ending air when a new run starts~~: checked 2026-11-24, it can't carry over. The end screen's only way on is the main menu, which reloads the page (`onEndMenu` in `ui/mount.tsx`), and the reload stops every sound.

## 25. Great Lakes Song Motifs: Red Iron Ore (2026-11-24)

**Scope** (§2 "Song tradition", §6.1 "Open water (day)"): find which Great Lakes songs are public domain and where their melodies are printed, then put the first one, *Red Iron Ore*, into the game.

**The sources.** Every melody is arranged from a book printed before 1931, never from a recording or a modern songbook:

| Song | Printed melody | Fits |
|---|---|---|
| *Red Iron Ore* (Laws D9) | Rickaby 1926, no. 45, p. 161 | Open water by day (built here) |
| *The Bigler's Crew* (Laws D8) | Rickaby no. 47, p. 168; Colcord, *Roll and Go* (1924), p. 109 | Chart travel (built, §25.1) |
| *The Persian's Crew* (Laws D4) | Rickaby no. 46, p. 164 (two tunes); Colcord p. 111 (a third) | Night, fog, a wreck, the death ending (night built, §25.1) |
| *The Shanty-Man's Life* | Rickaby no. 9, p. 43 | Port by day in the lumber towns; the Duluth saloon by day (built, §25.2) |
| *The Little Brown Bulls* | Rickaby no. 13, p. 65 (a variant of *Red Iron Ore*'s tune) | The saloon (built, §25.1) |
| *Michigan-I-O* | Rickaby no. 8, p. 41 | The saloon at night, winter; the Duluth saloon at night (built, §25.2) |
| *The Jam on Gerry's Rocks* | Rickaby no. 2, p. 11 (A), p. 15 (B, "Geary's Rock") | A death or gallows stinger; the ending air (built, §25.1) |
| *Lost on the Lady Elgin* | Henry Clay Work's sheet music (1861) | Saloon piano late at night, an ending; night at sea off Duluth (built, §25.2) |
| *En roulant ma boule* | Gagnon, *Chansons populaires du Canada* (1865), p. 12 | Rowing ashore, La Pointe; day at sea in the Apostles (built, §25.2) |

Rickaby (Harvard University Press, 1926) is on the Internet Archive (`31761034948356`) and IMSLP. Protected, though the songs are not: Alan Lomax's 1938 Michigan recordings at the Library of Congress (pre-1972 sound recordings), Walton and Grimm's *Windjammers* (2002), *Pinery Boys* (2017), Fowke (1970), Beck (1941 on), and all modern recordings and arrangements. Colcord died in 1960, so her editing is protected in life-plus-70 countries until 2030; Rickaby prints the same two songs, so arrange from him.

| Part | Where | What it does |
|---|---|---|
| The tune | `tools/audio/lib/synth-songs.ts` (`RED_IRON_ORE`) | Rickaby's melody note for note: 6/8, E aeolian, a one-eighth pickup and ten bars with the "Derry down" refrain. The book's fermatas are kept in time except the last. |
| The arrangement | `synth-songs.ts` (`redIronOreForm`, `redIronOre`) | At a dotted quarter of 68: two bars of guitar, the verse on concertina, again on tin whistle an octave up over an E and B fiddle drone, and once more on concertina, over a 6/8 boom-chick in E minor (Em, D, G, C). 63.7 s. |
| The cue | `music/open-water-day` | Replaces "The Chequamegon Waltz"; the music director and the cue id are unchanged. |

**Calls made here.** The waltz is removed rather than kept beside the song, since the day state plays one cue; it is in git history. The chords are a plain guess at period accompaniment, not from the book, which prints the tune alone.

### Still to do

1. **A listen:** nobody has heard the arrangement yet. Judge the tempo, the whistle's octave and the drone's level.
2. **The other songs** in the table above, one cue at a time (four more done in §25.1).

### 25.1 The rest of the shortlist (2026-11-25)

Four more songs replace the original placeholder tunes, each from Rickaby's page, note for note, with the book's held notes kept in time:

| Part | Where | What it does |
|---|---|---|
| Chart travel | `synth-songs.ts` (`BIGLER`, `biglerForm`, `bigler`), `music/chart-voyage` | *The Bigler's Crew* (no. 47, p. 168): 6/8 in D mixolydian, a 16-bar verse and a 15-bar chorus, at a dotted quarter of 70. Two bars of guitar, verse and chorus on concertina, then the chorus again on tin whistle an octave up over a D and A fiddle drone, all over a boom-chick. 91.2 s. Replaces "The Long Reach". |
| Night at sea | `synth-songs.ts` (`PERSIANS_CREW`, `persiansCrew`), `music/open-water-night` | *The Persian's Crew* (no. 46, tune A, p. 164): 15 bars in F, slow (eighth at 132). Tin whistle an octave up, then concertina, over an F and C drone, no guitar. 95.1 s. Replaces "Devils Island Air". |
| The saloon by day | `synth-songs.ts` (`LITTLE_BROWN_BULLS`, `littleBrownBullsForm`, `littleBrownBullsGuitar`), `synth-foot.ts` (`saloonTune`), `foot/saloon-tune` | *The Little Brown Bulls* (no. 13, p. 65): ten bars of 6/8, played twice at a quick pace with the pickup moved to the end so the loop is seamless, guitar on half-bar chords (Em, D, G). 26.1 s loop. Replaces "The Booth Street Polka"; "The Late Boat Waltz" still plays at night. |
| The ending | `synth-songs.ts` (`GERRYS_ROCKS`, `transpose`), `synth-island.ts` (`endingAir`), `music/ending-air` | *The Jam on Gerry's Rocks* (no. 2, tune B, p. 15): 16 bars of cut time, raised a tone to D to sit on the existing D and A drone, slow (quarter at 63). 64 s. Replaces the original ending air. |

**Calls made here.** The chords are again a guess, since Rickaby prints the tunes alone. Tune B of *Gerry's Rocks* was picked over A because it fits the drone and reads as a lament. The replaced tunes are in git history.

**Not done here.** The last four songs had no cue of their own; §25.2 adds them as alternates by place.

### Still to do (§25.1)

1. **A listen** to all four new cues, as for *Red Iron Ore*.
2. **New cues** for the four songs above (done in §25.2).

### 25.2 The alternates: a song by place (2026-11-25)

**Scope** (Jared, 2026-11-25: "use them as alternatives, e.g. one plays in one saloon not the other, plays in different zones"): the last four songs of the table, each played in a place of its own instead of that place's usual tune.

| Where | Song | Source | Cue |
|---|---|---|---|
| Open water by day, the Apostle Islands (`region.apostles`) | *En roulant ma boule*, the voyageurs' paddling song, for La Pointe's fur-trade canoes | Gagnon 1865, p. 12: 6/8 in C, the refrain, the verse twice, "Trois beaux canards" and the refrain (the book's dal segno), 20 bars | `music.open-water.day-apostles`: two bars of guitar, once on concertina, once on tin whistle with the concertina back low for the last refrain, oom-pah-pah guitar, dotted quarter 84. 66 s. |
| Open water at night off Duluth and the North Shore (`region.duluth`, `region.north_shore`) | *Lost on the Lady Elgin*, the 1860 Lake Michigan wreck | Work 1861, pp. 46–48, the voice part: 4/4 in A, a 12-bar verse and the 6-bar chorus | `music.open-water.night-duluth`: the verse on tin whistle an octave up, the chorus low on concertina, over an A and E drone, quarter at 72 (the book's Lento). 68 s. |
| The Duluth saloon by day (`district.duluth`) | *The Shanty-Man's Life* | Rickaby no. 9 (A), p. 43: 2/4 in D minor with the raised seventh, 28 bars | `music.saloon.day-duluth`: concertina an octave up over a 2/4 boom-chick, quarter at 104, the pickup moved to the end. 32.3 s loop. |
| The Duluth saloon at night | *Michigan-I-O* | Rickaby no. 8, p. 41: 6/8 in C, 16 bars | `music.saloon.night-duluth`: fiddle an octave up over the upright piano (the voices of "The Late Boat Waltz"), dotted quarter at 64. 30 s loop. |

Everywhere else is as before: *Red Iron Ore* and *The Persian's Crew* at sea, *The Little Brown Bulls* and "The Late Boat Waltz" in the Bayfield saloon (and any saloon without its own).

| Part | Where | What it does |
|---|---|---|
| Open-water choice | `world-mix.ts` (`MUSIC_ALTERNATES`, `musicAlternate`), `music.ts` (`alternate`), `game-audio.ts` | When a cue starts, the director asks for the region's own song (the Wanted region you're in) and plays it in place of the mood's cue; ducking, quiet and the gaps follow whichever plays. A cue already playing finishes when you sail into another region. |
| Saloon choice | `foot-mix.ts` (`SALOON_TUNES`, `saloonTunes`), `foot-audio.ts`, `ashore.ts` (`saloon.district`) | The ashore frame names the saloon's district; the tune and night-tune beds play that saloon's songs, starting over when the town changes. |
| The sounds | `tools/audio/lib/synth-songs.ts` (`EN_ROULANT`, `LADY_ELGIN`, `SHANTY_MANS_LIFE`, `MICHIGAN_I_O` and their renderers), `tools/audio/synth.ts songs`, `public/assets/audio/songs/` | The open-water pair streams with `music-open-water`; the saloon pair is a new decoded bundle, `saloon-music` (650 KB), since the foot bundle is near its 1.5 MB ceiling. Decoded audio about 7.8 MB of 8 MB; streamed music 6.8 MB of 7 MB. |

**Calls made here.** The places are a guess at fit, easy to move in the two tables: the voyageur song where the canoes ran, the wreck song on the open lake by Duluth, the lumber songs in the bigger lumber port. Two transcription calls: *Michigan-I-O* twice holds a note under a fermata in a bar of seven eighths, shortened here to six; *Lost on the Lady Elgin* is the voice part only, with the piano part left out. The chords are a guess again. The Duluth tunes are not in the stage 1 sandbox bundle, which stays under its 1 MB ceiling.

### Still to do (§25.2)

1. **A listen** to the four alternates, in place: the Apostles by day, off Duluth at night, the Duluth saloon by day and at night.

### 25.3 The day songs swap places (2026-11-25)

Jared asked for the Apostle Islands song and the other daytime song to switch. *En roulant ma boule* is now open-water music by day everywhere (`music.open-water.day`), and *Red Iron Ore* plays by day among the Apostle Islands (`music.open-water.day-apostles`). Cue ids, the region table and the arrangements are unchanged; only which recording each cue holds.

## 26. Polish: The Last Gaps and a Loudness Pass (2026-11-24)

**Scope:** what §21, §23 and §24 left as "not built" that the 1.0 audit kept in 1.0 ([00 §7.2](00-master-plan.md)): notification chimes per priority, the ice grinding on a hull, a bear crashing off, and the slipway; plus the measured half of the mix and loudness pass (§11 Phase 10).

| Part | Where | What it does |
|---|---|---|
| Notice chimes | `hideout-mix.ts` (`NOTICE_CHIMES`), `UiCues` (`alarm`), `game-audio.ts` | Plan 13 §7's priorities, by event rather than by notice text: **critical** (a report filed, your own ship foundering, a hideout spotted) is the alarm, the bright bell struck twice a fourth down and 0.32 s apart; **important** (a letter, a lead opened, a clue, a rival emerging) the soft bell, and a legend completed the bright one. Events with a sound of their own (a tier's stinger, the ice giving, the pursuit's music, a contract's bell) aren't in the table, so nothing rings twice. The 2 s gap still holds, but an alarm cuts in on a bell. |
| Hull in the ice | `winter-mix.ts` (`grindLevel`), `WinterSounds.grinding`, `main.ts` (`IceGrinding` now emitted) | Forcing ice, her hull grinds: a looped bed (`sfx.ice.grind`, 5 s) by the hull HP a second she's losing, lower and duller at a crawl and fuller and brighter driven hard (full at 1.2 HP/s), with a floe's knock or a crack running off every 1–2.6 s. Afloat only, your own ship only. |
| Bear running off | `island-mix.ts` (`animalCue` for `flee`) | A bear that runs huffs and crashes off through the brush (`sfx.bear.crash`): a gallop of heavy footfalls in threes, branches snapping, going away over three seconds. Captioned. |
| The slipway | `HideoutSounds.onTheWays`, `launched` | A repair or an upgrade fitted on the ways is heard like Build's work (the yard with saws and hammers, iron for fittings) by the hours it took; `UpgradeInstalled` gains `how: 'slipway'` to tell it from a chandlery's. A ship of your own building is the days on the ways, then the launch (`sfx.slipway.launch`): the dog-shores knocked out, the cradle groaning, the rumble down the greased ways, the splash and the wash. |
| Sounds | `synth-winter.ts` (`hullGrind`), `synth-island.ts` (`bearCrash`), `synth-hideout.ts` (`shipLaunch`) | Synthesized like the rest, CC BY 4.0, credited. 105 KB more in their bundles. |

**The loudness pass, measured.** Every shipped sound run through ffmpeg's EBU R128 meter (integrated loudness and true peak):

- **Music** sits where §9 asks: the cues at −17.5 to −18 LUFS, the stingers −15 to −20.
- **Ambience** beds have a median of −23.7 LUFS against the −24 target. The outlier was the island's birds at **−15.5**: sparse calls over silence, which the build's RMS levelling leaves about 8 LU hot. Their bed level drops from 1 to 0.45 (`island-audio.ts`). The clockwork (−28.9) and the frozen night (−27.6) were already brought up at runtime (×1.4, ×1.3).
- **SFX** are peak-levelled, so their loudness spreads (−8 to −20 LUFS) by design. Two encode a hair over 0 dBTP after Opus (`poker/deal-2` +0.6, `sled-runners` +0.3); every bus plays them well under unity, so nothing clips at the output.

### Still to do

1. **The by-ear half of the pass** (§11 Phase 10: "Mix polish, loudness pass, captions review"): the meter can't judge balance in play. Listen to a run end to end for anything that pokes out or vanishes: the grind under the wind and the wash, the alarm against the stingers, the birds at their new level, and the launch.

## Changelog
- v2.5: The diving suit's descent (`sfx.salvage.dive`, Phase 10).
- v2.4: The day songs swap places (§25.3): *En roulant ma boule* by day everywhere, *Red Iron Ore* among the Apostle Islands.
- v2.3: The alternates (§25.2): *En roulant ma boule* by day among the Apostle Islands and *Lost on the Lady Elgin* by night off Duluth and the North Shore at sea, and *The Shanty-Man's Life* and *Michigan-I-O* in the Duluth saloon, chosen by region and by district.
- v2.2: The rest of the song shortlist (§25.1): *The Bigler's Crew* for chart travel, *The Persian's Crew* for night at sea, *The Little Brown Bulls* for the saloon by day and *The Jam on Gerry's Rocks* for the ending, all from Rickaby (1926), replacing the original placeholder tunes.
- v2.1: The polish pass (§26): notification chimes by priority, the ice grinding on a hull, a bear crashing off, the slipway's work and launch, and a measured loudness pass (the island birds brought down 7 dB).
- v2.0: Great Lakes song motifs (§25): the public-domain sources for the songs of §2, and *Red Iron Ore* from Rickaby (1926) as the open-water day cue in place of the waltz.
- v1.9: The ending air can't play into a new run (§24): the way from the end screen reloads the page.
- v1.8: Phase 9 piece Y built (§24): the islands' birds, creek and surf by tier and season, the woodpecker, a sea cave's hush, drips and surge, the deer, bear and wolves, the grapple, a dig and the ending air.
- v1.7: Phase 9 piece N built (§23): thin ice cracking, groaning and giving way and the haul out, footsteps on ice and squeaking snow, the sled's runners and load, gusts, a shivering breath and chattering teeth as warmth drops, the winter wind, a frozen harbor's still night with the ice booming far off, and snowfall silent. Decoded audio 6.59 MB of 8 MB.
- v1.6: Phase 9 piece J built (§22): the saloon's piano and fiddle by night, cards and chips at the poker table, the lighthouse station's clockwork, lamp, stair, oil and keepers, the harbor master's bell and the letters, a rival's stinger for piece E, and a ship aground. Decoded audio 6.13 MB of 8 MB.
- v1.5: Phase 8 piece I built (§21): build mode's knock, thud and paper, the work session heard by material, a piece pried down, the forge, the cooperage, the still loaded and at work, salvage set down, and the UI set (stamp, newspaper, telegraph, page, two bells). The decoded budget raised to 8 MB (§8).
- v1.4: The Phase 7 playtest's listen is on the laptop route ([08 §20.8](08-docks-district-stealth.md)); the decoded audio is at 4.96 MB of the 5 MB budget, a decision for Jared there.
- v1.3: Phase 7 piece I built (§20): footsteps at the gameplay radius, the burglar's kit, the watch's voices and whistle, the stealth layer and the spotted stinger, the docks at night, the saloon and the island's woods.
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
