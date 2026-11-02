#!/usr/bin/env node
// Renders the synthesized raw sounds (tools/audio/lib/synth.ts) into raw-assets/audio/ as
// FLAC sources with their sound.json and provenance.json, ready for `npm run audio`:
// the lighthouse fog whistle and fog bell, the two open-water music v1 cues, and the NPC
// ships' whistles and the schooner-barge's fog horn (Phase 3 piece J), and the chart's
// traveling theme, the encounter stingers and the fade-to-fog sound (piece J, part 2),
// and the harbors' mill saw and ore dump (Phase 4 piece J). The package steamer's chime
// whistle is a recording since Phase 4 (raw-assets/audio/ships/whistle-chime), so it is
// no longer rendered here.
//
//   npm run audio:synth            # render all, then run `npm run audio`
//   npm run audio:synth -- ships   # render one category only (ships, chart, music, ...)
//
// Needs ffmpeg on the PATH (or FFMPEG=...), like the pipeline. Seeded, so a rerun writes
// the same samples.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_RATE, type SoundHints } from './lib/audio.ts';
import {
  AIR,
  CHORDS,
  WALTZ,
  airForm,
  fiddleDrone,
  fogBell,
  fogWhistle,
  foghorn,
  mixInto,
  noteHz,
  peak,
  pluckNote,
  reedNote,
  renderMelody,
  reverb,
  seeded,
  SHIP_WHISTLES,
  shipWhistle,
  waltzForm,
  whistleNote,
} from './lib/synth.ts';
import { chartTheme, fogFade, stinger, STINGERS, type StingerName } from './lib/synth-chart.ts';
import { millSaw, oreDump } from './lib/synth-harbor.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const RAW = join(ROOT, 'raw-assets', 'audio');
const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';
const RATE = SAMPLE_RATE;
const TODAY = '2026-10-30';
const TODAY_J = '2026-10-31';
const TODAY_J2 = '2026-11-01';
const TODAY_P4J = '2026-11-01';
/** Render only this category (e.g. `ships`), leaving the other sources untouched. */
const ONLY = process.argv[2];

function writeSound(
  category: string,
  hints: Omit<SoundHints, 'source' | 'trimStartS' | 'loopCrossfadeS'>,
  samples: Float32Array,
  how: string,
  date = TODAY,
): void {
  if (ONLY && category !== ONLY) return;
  const dir = join(RAW, category, hints.name);
  mkdirSync(dir, { recursive: true });
  const p = peak(samples);
  const scaled = p > 0.9 ? samples.map((s) => (s / p) * 0.9) : samples;
  const run = spawnSync(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'f32le',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-i',
      '-',
      '-c:a',
      'flac',
      join(dir, 'source.flac'),
    ],
    { input: Buffer.from(scaled.buffer, scaled.byteOffset, scaled.byteLength), maxBuffer: 1 << 30 },
  );
  if (run.status !== 0) throw new Error(`ffmpeg: ${run.stderr.toString()}`);
  writeFileSync(
    join(dir, 'sound.json'),
    JSON.stringify({ ...hints, source: 'source.flac' }, null, 2) + '\n',
  );
  writeFileSync(
    join(dir, 'provenance.json'),
    JSON.stringify(
      {
        source: 'procedural',
        tool: 'tools/audio/synth.ts (tools/audio/lib/synth.ts)',
        author: 'Great Lakes Pirate contributors',
        reference: how,
        date,
        license: 'CC BY 4.0',
        attribution: 'Great Lakes Pirate contributors',
        modifications: [],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`synth: ${category}/${hints.name} (${(samples.length / RATE).toFixed(1)} s)`);
}

function renderWaltz(): Float32Array {
  const random = seeded(1900);
  const { melody, chords } = waltzForm();
  const beatS = 60 / WALTZ.bpm;
  const totalBeats = melody.reduce((sum, [, b]) => sum + b, 0) + 3;
  const out = new Float32Array(Math.round((totalBeats * beatS + 2) * RATE));
  // Concertina melody.
  renderMelody(
    out,
    melody,
    WALTZ.bpm,
    0,
    RATE,
    (hz, s) => reedNote(hz, s, RATE, random),
    1,
    random,
  );
  // Guitar: bass on the one, chord strums on two and three ("oom-pah-pah").
  chords.forEach((name, bar) => {
    const chord = CHORDS[name];
    if (!chord) throw new Error(`chord ${name}`);
    const barStart = bar * 3 * beatS;
    const bassAt = Math.round((barStart + (random() - 0.5) * 0.01) * RATE);
    mixInto(out, pluckNote(noteHz(chord.bass), 3 * beatS, RATE, random, 0.35), bassAt, 0.55);
    for (const beat of [1, 2]) {
      chord.tones.forEach((tone, k) => {
        const at = Math.round(
          (barStart + beat * beatS + k * 0.012 + (random() - 0.5) * 0.008) * RATE,
        );
        mixInto(out, pluckNote(noteHz(tone), beatS * 0.9, RATE, random, 0.6), at, 0.22);
      });
    }
  });
  // The last chord rings.
  const end = chords.length * 3 * beatS;
  const last = CHORDS['D'] as { bass: string; tones: string[] };
  mixInto(out, pluckNote(noteHz(last.bass), 3, RATE, random, 0.35), Math.round(end * RATE), 0.5);
  last.tones.forEach((tone, k) =>
    mixInto(
      out,
      pluckNote(noteHz(tone), 3, RATE, random, 0.5),
      Math.round((end + k * 0.03) * RATE),
      0.25,
    ),
  );
  return reverb(out, RATE, 0.22, 0.78);
}

function renderAir(): Float32Array {
  const random = seeded(1874);
  const notes = airForm();
  const beatS = 60 / AIR.bpm;
  const beats = notes.reduce((sum, [, b]) => sum + b, 0);
  const seconds = beats * beatS + 3;
  const out = new Float32Array(Math.round(seconds * RATE));
  mixInto(out, fiddleDrone(['E3', 'B3'], seconds - 1, RATE, random, 4), 0, 1);
  renderMelody(
    out,
    notes,
    AIR.bpm,
    0,
    RATE,
    (hz, s) => whistleNote(hz, s, RATE, random),
    0.8,
    random,
  );
  return reverb(out, RATE, 0.3, 0.85);
}

function main(): void {
  writeSound(
    'signals',
    {
      id: 'sfx.signal.fog-whistle',
      name: 'fog-whistle',
      description: 'Lighthouse steam fog whistle, one long blast (cut short at runtime)',
      kind: 'oneshot',
      bus: 'sfx',
      bundles: ['world-audio'],
    },
    fogWhistle(RATE, 7),
    'Additive steam bell whistle at 196 Hz with pressure-following pitch and band-passed steam noise',
  );
  writeSound(
    'signals',
    {
      id: 'sfx.signal.fog-bell',
      name: 'fog-bell',
      description: 'Lighthouse fog bell, one stroke',
      kind: 'oneshot',
      bus: 'sfx',
      bundles: ['world-audio'],
    },
    fogBell(RATE, 6),
    'Additive bronze bell partials (hum, prime, tierce, quint, nominal and up) on a 247 Hz prime, with a clapper click',
  );
  writeSound(
    'music',
    {
      id: 'music.open-water.day',
      name: 'open-water-day',
      description: 'Open-water music v1, day: "The Chequamegon Waltz" on concertina and guitar',
      kind: 'oneshot',
      bus: 'music',
      bundles: ['music-open-water'],
    },
    renderWaltz(),
    'Original tune; synthesized free-reed concertina (additive), Karplus-Strong guitar, Freeverb-style reverb',
  );
  writeSound(
    'music',
    {
      id: 'music.open-water.night',
      name: 'open-water-night',
      description:
        'Open-water music v1, night: "Devils Island Air" on tin whistle over a fiddle drone',
      kind: 'oneshot',
      bus: 'music',
      bundles: ['music-open-water'],
    },
    renderAir(),
    'Original tune; synthesized tin whistle and bowed fiddle drone (additive with body resonances), Freeverb-style reverb',
  );
  const whistles: [keyof typeof SHIP_WHISTLES, string, string][] = [
    ['freighter', 'Steam ore freighter whistle: one deep bell, one long blast', 'One 138 Hz bell'],
    ['tug', 'Fish tug whistle: a small shrill bell, one long blast', 'One 587 Hz bell, fast valve'],
    [
      'cutter',
      "Revenue cutter Morrill's whistle: two bells with a slow warble, one long blast",
      'Two bells at 349 and 415 Hz with a 40-cent warble at 2.2 Hz',
    ],
  ];
  whistles.forEach(([name, description, how], k) => {
    writeSound(
      'ships',
      {
        id: `sfx.ship.whistle-${name}`,
        name: `whistle-${name}`,
        description: `${description} (cut short at runtime)`,
        kind: 'oneshot',
        bus: 'sfx',
        bundles: ['world-audio'],
      },
      // Seeds as when the chime (now a recording) was second in this list.
      shipWhistle(RATE, SHIP_WHISTLES[name], 5, 10 + (k === 0 ? 0 : k + 1)),
      `Additive steam whistle: ${how}, pressure-following pitch, band-passed steam noise`,
      TODAY_J,
    );
  });
  writeSound(
    'ships',
    {
      id: 'sfx.ship.foghorn',
      name: 'foghorn',
      description: "A sailing vessel's hand-pumped fog horn, one blast (cut short at runtime)",
      kind: 'oneshot',
      bus: 'sfx',
      bundles: ['world-audio'],
    },
    foghorn(RATE, 3),
    'Additive reed horn at 233 Hz with nasal formants, bellows swell and breath noise',
    TODAY_J,
  );
  writeSound(
    'music',
    {
      id: 'music.chart.voyage',
      name: 'chart-voyage',
      description:
        'Chart music: "The Long Reach", a 6/8 traveling tune on concertina, guitar and tin whistle',
      kind: 'oneshot',
      bus: 'music',
      bundles: ['music-chart'],
    },
    chartTheme(RATE),
    'Original tune; synthesized free-reed concertina, Karplus-Strong guitar, tin whistle and fiddle drone, Freeverb-style reverb',
    TODAY_J2,
  );
  const stingers: Record<StingerName, string> = {
    sail: 'Encounter stinger, a sail or smoke sighted: a rising concertina figure onto G',
    threat:
      'Encounter stinger, the cutter sighted: a low drone and a whistle leaning on a minor second',
    hunted: 'Encounter stinger, the cutter has seen you: drum strokes, a falling minor run, a roll',
    squall: 'Encounter stinger, a squall line: a swelling drum roll over a dark drone',
    derelict: "Encounter stinger, a derelict: a far ship's bell and an unresolved whistle phrase",
    clear: 'Encounter stinger, slipped away: a falling concertina phrase home to G',
  };
  for (const name of STINGERS) {
    writeSound(
      'chart',
      {
        id: `music.stinger.${name}`,
        name: `stinger-${name}`,
        description: stingers[name],
        kind: 'oneshot',
        bus: 'music',
        bundles: ['chart-audio'],
      },
      stinger(name, RATE),
      'Original motif; synthesized concertina, guitar, tin whistle, fiddle drone, frame drum and bell, Freeverb-style reverb',
      TODAY_J2,
    );
  }
  writeSound(
    'chart',
    {
      id: 'ui.transition.fog',
      name: 'fog-fade',
      description:
        "The loading screen's fade to fog: a swell of wind and sea with two strokes of a ship's bell",
      kind: 'oneshot',
      bus: 'ui',
      bundles: ['chart-audio'],
    },
    fogFade(RATE),
    "Low-passed and band-passed noise under a swell envelope, two additive ship's bell strokes, Freeverb-style reverb",
    TODAY_J2,
  );
  writeSound(
    'harbor',
    {
      id: 'amb.harbor.mill-saw',
      name: 'mill-saw',
      description: "A steam sawmill's head saw taking one cut through a log, and the slab dropping",
      kind: 'oneshot',
      bus: 'ambience',
      bundles: ['harbor-audio'],
    },
    millSaw(RATE),
    'Additive saw whine at a 560 Hz tooth rate that sags under load, band-passed noise for the cut, a low thud',
    TODAY_P4J,
  );
  writeSound(
    'harbor',
    {
      id: 'amb.harbor.ore-dump',
      name: 'ore-dump',
      description:
        "An ore car dumping into an ore dock's pocket: door clang, the ore rushing down, door shut",
      kind: 'oneshot',
      bus: 'ambience',
      bundles: ['harbor-audio'],
    },
    oreDump(RATE),
    'Modal steel-plate clangs, low-passed and band-passed noise for the rush, dense short rock pings',
    TODAY_P4J,
  );
}

main();
