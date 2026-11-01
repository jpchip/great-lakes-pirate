# Audio pipeline

Plan 15 §9. `npm run audio` turns every raw sound under `raw-assets/audio/` into what the game
loads. It needs ffmpeg with libopus (`FFMPEG=/path/to/ffmpeg` if it isn't on the `PATH`) and
runs locally; CI only checks the outputs (`tests/audio-pipeline.test.ts`).

```
raw-assets/audio/<category>/<name>/
  sound.json        hints: manifest id, loop or one-shot, bus, trim, loop crossfade, bundles
  provenance.json   where it came from and under which license (plan 14 §6)
  source.<ext>      the raw file as downloaded or recorded
        │
        ▼  tools/audio/build.ts (ffmpeg + tools/audio/lib/audio.ts)
  decode to mono 48 kHz → trim → edge fades (one-shots) or an equal-power loop crossfade
  → level: ambience RMS ≈ −24 dB, SFX peak −1 dB → Opus in Ogg (ambience 64, SFX 56 kbps)
        │
        ▼
public/assets/audio/<category>/<name>.ogg
public/assets/audio/<category>/<name>.provenance.json   raw provenance plus the steps taken
public/assets/audio/manifest.json                       ids, urls, sizes and bundles
```

`sound.json` can also ask for `highpassHz` (filtered while decoding, for wind rumble or hum) and,
for one-shots, `fadeOutS` (a longer fade for clips cut mid-sound).

Unchanged sounds are skipped (the sidecar keeps a hash of the inputs); `--force` rebuilds all,
and a folder path rebuilds just that one: `npm run audio -- raw-assets/audio/sailing/luff`.

## Adding a sound

1. Only **CC0, CC BY 4.0 or public-domain** sources (plan 15 §3.2): no NC, ND, or packs that
   forbid redistributing the raw files. The build refuses any other license.
2. Make the folder with the three files above. `provenance.json` uses `source: "cc0"`, the pack
   or page as `tool` and `reference`, the author (and the original author if it was re-uploaded),
   the download date, the license, and `originalFile` (the name inside the pack).
3. `npm run audio`, then add a `CREDITS.md` row for the `.ogg`. The tests fail until every shipped
   sound has its sidecar and its credit.

## The sailing set (Phase 1)

All CC0 from OpenGameArt (Freesound downloads need an account). The wind, the rigging whistle and
the low swell are not files: `src/audio/noise.ts` makes them from filtered noise at start-up, so
they follow wind and gusts smoothly and cost nothing to download.

| Sound           | Plays as                                                             |
| --------------- | -------------------------------------------------------------------- |
| `wash`          | Loop: water along the hull, louder, faster and brighter with speed   |
| `slap-1…3`      | Hull slaps, more often with speed and head seas                      |
| `wave-break`    | A breaking sea against the hull in heavy weather                     |
| `creak`         | Random slices of a creaking tree, more often with strain and motion  |
| `luff`          | Single flaps cut from a wing-flap clip, played fast: flogging canvas |
| `fill`          | A sail filling, the boom crossing on a jibe                          |
| `hoist`         | Halyard winch when a sail order is given                             |
| `windlass`      | Anchor windlass ratchet when weighing anchor                         |
| `chain-1…3`     | Anchor chain running out, as a burst of links                        |
| `anchor-splash` | The anchor hitting the water                                         |

## Synthesized sources (Phase 2)

`npm run audio:synth` renders the sounds no free library had into `raw-assets/audio/` as FLAC
sources with `source: "procedural"` provenance (CC BY 4.0, like the repo's other original assets),
then `npm run audio` encodes them as usual. The code is `tools/audio/synth.ts` and the DSP in
`tools/audio/lib/synth.ts`; it is seeded, so a rerun writes the same samples.

| Sound                    | Plays as                                                                 |
| ------------------------ | ------------------------------------------------------------------------ |
| `signals/fog-whistle`    | A lighthouse steam whistle blast, cut to each station's blast length     |
| `signals/fog-bell`       | One stroke of a lighthouse fog bell                                      |
| `music/open-water-day`   | "The Chequamegon Waltz" (concertina, guitar): open-water music v1 by day |
| `music/open-water-night` | "Devils Island Air" (tin whistle, fiddle drone): v1 at night             |
| `ships/whistle-*`        | The NPC ships' steam whistles (freighter, chime, tug, cutter), Phase 3   |
| `ships/foghorn`          | The schooner-barge's hand-pumped fog horn, Phase 3                       |
| `music/chart-voyage`     | "The Long Reach" (concertina, guitar, tin whistle): the chart's theme    |
| `chart/stinger-*`        | Encounter stingers: sail, threat, hunted, squall, derelict, clear        |
| `chart/fog-fade`         | The loading screen's fade to fog: wind and sea with a ship's bell        |

## The weather and wildlife set (Phase 2)

| Sound                  | Source                                                            | Plays as                                           |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| `weather/rain`         | OpenGameArt, CC0                                                  | Loop: rain, louder and brighter as it rains harder |
| `weather/thunder-near` | OpenGameArt, CC0                                                  | A clap and long rumble, for strikes inside 2.5 km  |
| `weather/thunder-far`  | OpenGameArt, CC0                                                  | A distant roll                                     |
| `wildlife/gull-1…5`    | OpenGameArt, CC0                                                  | Gull calls along the shores and at the harbors     |
| `wildlife/loon-1…4`    | US Fish and Wildlife Service via Wikimedia Commons, public domain | Loon calls across the water at dusk and night      |
