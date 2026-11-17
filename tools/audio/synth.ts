#!/usr/bin/env node
// Renders the synthesized raw sounds (tools/audio/lib/synth.ts) into raw-assets/audio/ as
// FLAC sources with their sound.json and provenance.json, ready for `npm run audio`:
// the lighthouse fog whistle and fog bell, the two open-water music v1 cues, and the NPC
// ships' whistles and the schooner-barge's fog horn (Phase 3 piece J), and the chart's
// traveling theme, the encounter stingers and the fade-to-fog sound (piece J, part 2),
// and the harbors' mill saw and ore dump (Phase 4 piece J), and the law's sounds (Phase 5
// piece H: Wanted stingers, the cutter's engine, bell and gun, the lockup's door), and the
// combat sounds and the chase layer (Phase 6 piece G). The package steamer's chime
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
import {
  bowGun,
  cutterBell,
  cutterEngine,
  ENGINE,
  lockupDoor,
  lockupRelease,
  newsboyCall,
  riggingHit,
  rifleShot,
  shotSplash,
  wantedStinger,
  WANTED_STINGERS,
  type WantedStingerName,
} from './lib/synth-law.ts';
import {
  BARKS,
  SALOON_TUNE,
  SALOON_TUNE_S,
  STEP_GROUNDS,
  STEP_VARIANTS,
  TENSION,
  TENSION_LOOP_S,
  barsBang,
  bottle,
  coshBlow,
  crateDown,
  crateLift,
  crickets,
  crowbar,
  docksNight,
  doorCreak,
  footstep,
  forestWind,
  guardBark,
  keys,
  knifeBlow,
  landing,
  lockClick,
  lockOpen,
  lockPick,
  pickSnap,
  policeWhistle,
  ropeTie,
  saloonRoom,
  saloonTune,
  shiver,
  spottedStinger,
  stoneLand,
  swimSplash,
  swimStroke,
  tensionLoop,
  type BarkName,
  type StepGround,
} from './lib/synth-foot.ts';
import {
  CHASE,
  CHASE_LOOP_S,
  ballSplash,
  ballZip,
  boardingFight,
  boilerBlast,
  cannonGun,
  chaseStem,
  crewCheer,
  crewDefiant,
  crewStrike,
  grapple,
  hitCanvas,
  hitWood,
  rifleNear,
  shotFlyby,
  struckStinger,
  swivelGun,
} from './lib/synth-combat.ts';
import {
  STILL_LOOP_S,
  WORK_LOOP_S,
  chimeBright,
  chimeSoft,
  cooperage,
  forge,
  hammerNail,
  handSaw,
  newspaperShake,
  pageTurn,
  placeKnock,
  planeStrokes,
  pryDown,
  refusedThud,
  stampThunk,
  stillAtWork,
  stillLoad,
  stoneSet,
  telegraph,
  workYard,
} from './lib/synth-hideout.ts';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
const RAW = join(ROOT, 'raw-assets', 'audio');
const FFMPEG = process.env['FFMPEG'] ?? 'ffmpeg';
const RATE = SAMPLE_RATE;
const TODAY = '2026-10-30';
const TODAY_J = '2026-10-31';
const TODAY_J2 = '2026-11-01';
const TODAY_P4J = '2026-11-01';
const TODAY_P5H = '2026-11-07';
const TODAY_P6G = '2026-11-09';
const TODAY_P7I = '2026-11-15';
const TODAY_P8I = '2026-11-17';
/** Render only this category (e.g. `ships`), leaving the other sources untouched. */
const ONLY = process.argv[2];

function writeSound(
  category: string,
  hints: Omit<SoundHints, 'source' | 'trimStartS' | 'loopCrossfadeS'> & {
    loopCrossfadeS?: number;
  },
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
  renderLaw();
  renderCombat();
  renderFoot();
  renderHideout();
}

function renderLaw(): void {
  const law = (
    hints: Omit<SoundHints, 'source' | 'trimStartS' | 'loopCrossfadeS' | 'bundles'> & {
      loopCrossfadeS?: number;
    },
    samples: Float32Array,
    how: string,
  ): void => writeSound('law', { ...hints, bundles: ['law-audio'] }, samples, how, TODAY_P5H);
  const stingers: Record<WantedStingerName, string> = {
    rise: 'Wanted stinger, word has reached the law (tiers 1-2): a drum stroke, a chord that sours',
    hunted:
      'Wanted stinger, hunted (tiers 3-4): the drum marches, a falling minor run, a held A minor',
    most: 'Wanted stinger, most wanted (tier 5): a deep bell tolls three times over a muffled roll',
    cool: 'Wanted stinger, a region has cooled off: a soft falling phrase that settles on G',
  };
  for (const name of WANTED_STINGERS) {
    law(
      {
        id: `music.stinger.wanted-${name}`,
        name: `stinger-wanted-${name}`,
        description: stingers[name],
        kind: 'oneshot',
        bus: 'music',
      },
      wantedStinger(name, RATE),
      'Original motif; synthesized concertina, guitar, fiddle drone, frame drum and bell, Freeverb-style reverb',
    );
  }
  law(
    {
      id: 'sfx.law.engine',
      name: 'cutter-engine',
      description: `The revenue cutter's engine across the water: the screw's beat, the engine's thud, crosshead knocks, the blower (${ENGINE.revs} revolutions at ${ENGINE.rpm} rpm, looped)`,
      kind: 'loop',
      bus: 'sfx',
      loopCrossfadeS: ENGINE.crossfadeS,
    },
    cutterEngine(RATE),
    'Low-passed noise beating at the blade rate, low thuds, short damped metal knocks, a 118 Hz hum',
  );
  law(
    {
      id: 'sfx.law.bell',
      name: 'cutter-bell',
      description: "The revenue cutter's bell, one stroke",
      kind: 'oneshot',
      bus: 'sfx',
    },
    cutterBell(RATE),
    "Additive ship's bell partials on a 690 Hz prime, with a clapper click",
  );
  law(
    {
      id: 'sfx.law.gun',
      name: 'bow-gun',
      description:
        "The cutter's bow gun, one round: a crack, a falling boom, the report rolling back",
      kind: 'oneshot',
      bus: 'sfx',
    },
    bowGun(RATE),
    'Band-passed noise crack, a pitch-dropping 48 Hz sine and low-passed noise body, delayed low-passed echoes',
  );
  law(
    {
      id: 'sfx.law.splash',
      name: 'shot-splash',
      description:
        'A round landing in the water: a thump, the column thrown up, the water falling back',
      kind: 'oneshot',
      bus: 'sfx',
    },
    shotSplash(RATE),
    'Low-passed thump, band-passed noise whoosh and fizz, a patter of short rising blips',
  );
  law(
    {
      id: 'sfx.law.rigging-hit',
      name: 'rigging-hit',
      description: 'A round through the rigging: wood splintering, a stay parting, canvas tearing',
      kind: 'oneshot',
      bus: 'sfx',
    },
    riggingHit(RATE),
    'Dense band-passed noise crackle, a pitch-dropping harmonic twang, rough band-passed noise',
  );
  law(
    {
      id: 'sfx.law.rifle',
      name: 'rifle',
      description: "A deputy's rifle shot, with a short slap back off the water",
      kind: 'oneshot',
      bus: 'sfx',
    },
    rifleShot(RATE),
    'Band-passed noise crack, low-passed noise body and tail, one band-passed echo',
  );
  law(
    {
      id: 'ui.jail.door',
      name: 'lockup-door',
      description:
        "The lockup's cell door going shut: a creak, the iron door banging home, bolt and key",
      kind: 'oneshot',
      bus: 'ui',
    },
    lockupDoor(RATE),
    'Stick-slip pulses through resonant band-passes for the hinge, modal iron clangs, thuds, a stone-room reverb',
  );
  law(
    {
      id: 'ui.jail.release',
      name: 'lockup-release',
      description: 'Let out of the lockup: the key turned, the bolt drawn, the door creaking open',
      kind: 'oneshot',
      bus: 'ui',
    },
    lockupRelease(RATE),
    'Clicks and a clang for the lock, band-passed noise for the bolt, a long stick-slip creak, a stone-room reverb',
  );
  law(
    {
      id: 'voice.port.newsboy',
      name: 'newsboy',
      description: 'A paper boy crying the new edition down the street: "Pa-per! Pa-per!"',
      kind: 'oneshot',
      bus: 'voice',
    },
    newsboyCall(RATE),
    "Formant synthesis: a band-limited pulse train through three moving resonances on a boy's pitch, a street slap-back",
  );
}

function renderCombat(): void {
  type Hints = Omit<SoundHints, 'source' | 'trimStartS' | 'loopCrossfadeS' | 'bundles'> & {
    loopCrossfadeS?: number;
  };
  const combat = (
    hints: Hints,
    samples: Float32Array,
    how: string,
    bundle = 'combat-audio',
  ): void => writeSound('combat', { ...hints, bundles: [bundle] }, samples, how, TODAY_P6G);
  const sfx = (
    id: string,
    name: string,
    description: string,
    samples: Float32Array,
    how: string,
    bus: SoundHints['bus'] = 'sfx',
  ): void => combat({ id, name, description, kind: 'oneshot', bus }, samples, how);

  sfx(
    'sfx.combat.swivel',
    'swivel',
    'The bow swivel fired, heard from the deck: a sharp bang and the slap back off the water',
    swivelGun(RATE),
    'Band-passed noise crack, a pitch-dropping 78 Hz sine, low-passed noise body and smoke roll, a band-passed slap-back',
  );
  sfx(
    'sfx.combat.cannon',
    'cannon',
    'The light cannon fired from her own deck: a deep bang, the carriage running back and brought up by its breeching',
    cannonGun(RATE),
    'Band-passed noise crack, a pitch-dropping 44 Hz sine, low-passed noise body, a rumble for the trucks, a thud and a stick-slip rope creak',
  );
  sfx(
    'sfx.combat.rifle',
    'rifle',
    'A rifle fired close to, then the lever worked',
    rifleNear(RATE),
    "The deputies' rifle (synth-law) with a sharper crack, and damped metallic ticks for the lever",
  );
  sfx(
    'sfx.combat.flyby',
    'shot-flyby',
    'A round shot going by: a rushing, warbling whistle that drops in pitch as it passes',
    shotFlyby(RATE),
    'Two band-passed noise bands and a faint warbling tone, their pitch falling through the pass (Doppler)',
  );
  sfx(
    'sfx.combat.zip',
    'ball-zip',
    'A rifle ball going by close: a short zip',
    ballZip(RATE),
    'Band-passed noise sliding from 3.2 to 1.7 kHz around a sharp tick',
  );
  sfx(
    'sfx.combat.splash-ball',
    'ball-splash',
    'A rifle ball into the water: a plip and a little spray',
    ballSplash(RATE),
    'A rising sine blip, band-passed noise spray, short rising drips',
  );
  sfx(
    'sfx.combat.hit-wood',
    'hit-wood',
    'A round into her side or deck: planking stove in, timber splitting, splinters, bits coming down',
    hitWood(RATE),
    'Two low thuds, band-passed impulse crackle, noise-burst splinters and small knocks',
  );
  sfx(
    'sfx.combat.hit-canvas',
    'hit-canvas',
    'A round through a sail: a dull punch, the cloth ripping, the torn canvas flogging',
    hitCanvas(RATE),
    'Low-passed noise punch, rough band-passed noise rip, a flapping band-passed noise burst',
  );
  sfx(
    'sfx.combat.boiler',
    'boiler',
    "A steamer's boiler bursting: a huge blast, steam roaring out, iron ringing, wreckage falling into the lake",
    boilerBlast(RATE),
    'A pitch-dropping 32 Hz sine and low-passed noise body, wavering band-passed steam noise, struck-plate clangs, splashes, low-passed echoes',
  );
  sfx(
    'sfx.combat.grapple',
    'grapple',
    'The grapple: the hook swung and thrown, biting on her rail, the line hauled taut, the hulls grinding together',
    grapple(RATE),
    'Swinging band-passed noise, a struck-plate clang and thuds, stick-slip rope creaks, juddering band-passed noise',
  );
  sfx(
    'sfx.combat.boarding-fight',
    'boarding-fight',
    'The boarding fight: men shouting, handspikes and steel clashing, feet on the deck, a pistol or two',
    boardingFight(RATE),
    'Formant-synthesized shouts (no words), struck-plate clangs and thuds, two pitched-up rifle shots',
  );
  sfx(
    'voice.combat.cheer',
    'crew-cheer',
    "Your crew's cheer: three ragged huzzahs",
    crewCheer(RATE),
    'Formant-synthesized shouts in a dozen voices, a little reverb',
    'voice',
  );
  sfx(
    'voice.combat.strike',
    'crew-strike',
    'Her crew calling out to hold fire as she strikes, and her bell rung fast',
    crewStrike(RATE),
    "Formant-synthesized falling calls, additive ship's bell strokes on an 880 Hz prime",
    'voice',
  );
  sfx(
    'voice.combat.defiant',
    'crew-defiant',
    "Her crew won't strike: a rough shout together, twice, and handspikes rapped on the rail",
    crewDefiant(RATE),
    'Formant-synthesized shouts in unison, short wooden thuds',
    'voice',
  );
  sfx(
    'music.stinger.struck',
    'stinger-struck',
    'She strikes: the chase tune runs up and resolves onto D major',
    struckStinger(RATE),
    'Original motif; synthesized fiddle, concertina and frame drum, Freeverb-style reverb',
    'music',
  );
  const stems = {
    drums: 'the frame drum and a low drum on a reel rhythm, low strings pulsing on the root',
    fiddle: 'a reel-like fiddle tune and concertina stabs on the off-beats',
  } as const;
  for (const stem of ['drums', 'fiddle'] as const) {
    combat(
      {
        id: `music.chase.${stem}`,
        name: `chase-${stem}`,
        description: `"Hard Alee", the chase layer (${CHASE.bars} bars in D dorian at ${CHASE.bpm}, ${CHASE_LOOP_S.toFixed(2)} s, looped with the other stem): ${stems[stem]}`,
        kind: 'loop',
        bus: 'music',
        loopCrossfadeS: 0,
      },
      chaseStem(stem, RATE),
      'Original tune; synthesized frame drum, bowed strings (sawtooth through body resonances) and concertina, Freeverb-style reverb, the tail folded onto the head for a seamless loop',
      'combat-music',
    );
  }
}

/** Phase 7 piece I: the captain ashore (plan 15 §4.5, §11 Phase 7). */
function renderFoot(): void {
  const foot = (
    id: string,
    name: string,
    description: string,
    samples: Float32Array,
    how: string,
    bus: SoundHints['bus'] = 'sfx',
    loopCrossfadeS?: number,
  ): void =>
    writeSound(
      'foot',
      {
        id,
        name,
        description,
        kind: loopCrossfadeS === undefined ? 'oneshot' : 'loop',
        bus,
        ...(loopCrossfadeS === undefined ? {} : { loopCrossfadeS }),
        bundles: ['foot-audio'],
      },
      samples,
      how,
      TODAY_P7I,
    );
  const grounds: Record<StepGround, [string, string]> = {
    wood: [
      'A footstep on planks: a hollow knock, heel and toe',
      'Two pitch-dropping sine knocks and a band-passed noise resonance',
    ],
    dirt: [
      'A footstep on dirt or sand: a soft thump and a scuff',
      'Low-passed noise thumps and a short band-passed scuff',
    ],
    gravel: [
      'A footstep on gravel: a thump under a scatter of stones',
      'A low-passed noise thump and sixteen short band-passed noise grains',
    ],
    grass: [
      'A footstep in grass: a swish and a soft thump',
      'Band-passed noise under a hump, a low-passed noise thump',
    ],
    stone: [
      'A footstep on stone: a hard tap, heel and toe',
      'Short band-passed noise clicks and a damped low sine',
    ],
    snow: [
      'A footstep in snow: a squeaking crunch',
      'Band-passed noise broken up by fast value noise, a low-passed thump',
    ],
  };
  for (const ground of STEP_GROUNDS) {
    for (let v = 1; v <= STEP_VARIANTS; v++) {
      foot(
        `sfx.foot.step-${ground}-${v}`,
        `step-${ground}-${v}`,
        `${grounds[ground][0]} (variant ${v})`,
        footstep(ground, v, RATE),
        grounds[ground][1],
      );
    }
  }
  foot(
    'sfx.foot.land',
    'land',
    'Landing from a height: both boots and the breath knocked out',
    landing(RATE),
    'Two pitch-dropping sine thuds, low-passed and band-passed noise',
  );
  foot(
    'sfx.foot.swim-splash',
    'swim-splash',
    'Going into the lake: the slap, the water closing over, drips',
    swimSplash(RATE),
    'Band-passed and low-passed noise bursts, rising sine drips',
  );
  for (const v of [1, 2]) {
    foot(
      `sfx.foot.swim-stroke-${v}`,
      `swim-stroke-${v}`,
      `A swimming stroke: an arm through the water and the water running off (variant ${v})`,
      swimStroke(v, RATE),
      'Band-passed noise under a hump, low-passed noise, rising sine drips',
    );
  }
  foot(
    'voice.foot.shiver',
    'shiver',
    'A shivering breath in cold water: in through the teeth in jerks, and out',
    shiver(RATE),
    'Band-passed noise gated at 13 Hz on the way in, smooth on the way out',
    'voice',
  );
  foot(
    'sfx.foot.lock-pick',
    'lock-pick',
    'A pick and a tension wrench at work in a lock: small scrapes and ticks',
    lockPick(RATE),
    'Short damped high sines and band-passed noise rasps at random',
  );
  foot(
    'sfx.foot.lock-click',
    'lock-click',
    'A pin set too hard: the click that carries',
    lockClick(RATE),
    'A band-passed noise click and two damped sines',
  );
  foot(
    'sfx.foot.lock-open',
    'lock-open',
    'A lock giving: the bolt drawn and the hasp dropping',
    lockOpen(RATE),
    'The lock click, a wooden thud and a short struck-plate clang',
  );
  foot(
    'sfx.foot.pick-snap',
    'pick-snap',
    'A lockpick snapping in the lock',
    pickSnap(RATE),
    'A band-passed noise crack and damped high sines',
  );
  foot(
    'sfx.foot.crowbar',
    'crowbar',
    'A lock forced with the crowbar: the wood groaning, the hasp tearing out, the lock on the floor',
    crowbar(RATE),
    'Stick-slip band-passed noise knocks, a noise crack, thuds and struck-plate clangs',
  );
  foot(
    'sfx.foot.door',
    'door',
    'A door swung on dry hinges',
    doorCreak(RATE),
    'A wandering sawtooth through two band-pass resonances, a soft thud',
  );
  foot(
    'sfx.foot.crate-lift',
    'crate-lift',
    'A crate taken up: it scrapes off the stack and its boards take the strain',
    crateLift(RATE),
    'Band-passed noise scrape, stick-slip knocks, a thud',
  );
  foot(
    'sfx.foot.crate-down',
    'crate-down',
    'A crate set down: a heavy wooden knock and what is inside settling',
    crateDown(RATE),
    'Pitch-dropping sine thuds and band-passed noise',
  );
  foot(
    'sfx.foot.rope',
    'rope',
    'A man tied up: rope drawn through and hauled tight, twice',
    ropeTie(RATE),
    'Band-passed noise draws and stick-slip knocks',
  );
  foot(
    'sfx.foot.cosh',
    'cosh',
    'The cosh: a dull crack, the breath going out of him, and he folds',
    coshBlow(RATE),
    'A thud and a band-passed noise crack, a low-passed formant grunt, a low thud',
  );
  foot(
    'sfx.foot.knife',
    'knife',
    'The knife: steel out, a short blow, a breath, a fall',
    knifeBlow(RATE),
    'Band-passed noise, a damped sine, low-passed noise, a low-passed formant breath, a thud',
  );
  foot(
    'sfx.foot.bottle',
    'bottle',
    'A bottle of whiskey passed over: the cork, and a long pull at it',
    bottle(RATE),
    'Stick-slip squeak, a damped 620 Hz sine pop, rising sine glugs',
  );
  foot(
    'sfx.foot.stone',
    'stone',
    'A thrown stone coming down: it cracks on something and skitters',
    stoneLand(RATE),
    'Band-passed noise clicks and damped sines at shortening gaps',
  );
  foot(
    'sfx.foot.keys',
    'keys',
    'A ring of keys lifted or turned',
    keys(RATE),
    'Fourteen damped high sines at random',
  );
  foot(
    'sfx.foot.bars',
    'bars',
    'Cell bars rattled and banged: iron ringing in a small room',
    barsBang(RATE),
    'Struck-plate clangs and thuds, Freeverb-style reverb',
  );
  const barks: Record<BarkName, string> = {
    hm: 'A guard grown suspicious: a short questioning hum',
    who: 'A guard challenging: two rising syllables, no words',
    hey: 'A guard raising the alarm: a sharp shout and a second, harder',
    mutter: 'A guard searching: a low grumble',
    giveup: 'A guard letting it go: a falling grunt',
  };
  for (const name of BARKS) {
    foot(
      `voice.foot.bark-${name}`,
      `bark-${name}`,
      barks[name],
      guardBark(name, RATE),
      'Formant-synthesized syllables (no words)',
      'voice',
    );
  }
  foot(
    'sfx.foot.whistle',
    'police-whistle',
    "A constable's pea whistle: two long shrill blasts",
    policeWhistle(RATE),
    'A 2.85 kHz tone chopped at 41 Hz by the pea, band-passed air noise, a little reverb',
  );
  foot(
    'music.foot.tension',
    'tension',
    `The stealth layer (${TENSION.beats} beats at ${TENSION.bpm}, ${TENSION_LOOP_S.toFixed(2)} s, looped): a low open fifth on bowed strings, a heartbeat on a muffled drum, one high held note now and then`,
    tensionLoop(RATE),
    'Original; synthesized fiddle drone and low-passed frame drum, Freeverb-style reverb, the tail folded onto the head for a seamless loop',
    // Encoded as a bed (64 kbps) to keep the download small; it plays on the music bus.
    'ambience',
    0,
  );
  foot(
    'music.stinger.spotted',
    'stinger-spotted',
    'Seen by the watch: a drum stroke, a diminished stab on the concertina, the line climbing',
    spottedStinger(RATE),
    'Original motif; synthesized frame drum, concertina and fiddle drone, Freeverb-style reverb',
    'music',
  );
  foot(
    'amb.foot.docks-night',
    'docks-night',
    'The docks at night: the lake lapping at the piles, a hull easing on her lines',
    docksNight(RATE),
    'Low-passed and band-passed noise under slow value-noise swells, sine drips, far stick-slip creaks',
    'ambience',
    1.5,
  );
  foot(
    'amb.foot.saloon-room',
    'saloon-room',
    "The saloon's room: men talking low, a laugh, glasses, a chair",
    saloonRoom(RATE),
    'Formant-synthesized syllables in eight voices (no words), damped sine pings, low-passed, reverb',
    'ambience',
    0,
  );
  foot(
    'music.foot.saloon',
    'saloon-tune',
    `"The Booth Street Polka" (${SALOON_TUNE.bars} bars in G at ${SALOON_TUNE.bpm}, ${SALOON_TUNE_S.toFixed(2)} s, looped): the saloon's concertina over a vamping guitar`,
    saloonTune(RATE),
    'Original tune; synthesized concertina and plucked guitar, a little reverb, the tail folded onto the head for a seamless loop',
    // Encoded as a bed (64 kbps) to keep the download small; it plays on the music bus.
    'ambience',
    0,
  );
  foot(
    'amb.foot.forest',
    'forest',
    "The island's woods: wind moving through leaves and needles, coming and going",
    forestWind(RATE),
    'Band-passed and low-passed noise under slow value-noise gusts',
    'ambience',
    2,
  );
  foot(
    'amb.foot.crickets',
    'crickets',
    'Crickets on a summer night: three of them, each at its own pitch and pace',
    crickets(RATE),
    'Three pulsed sines (3.9 to 4.75 kHz), three pulses to a chirp, a whole number of chirps to the loop',
    'ambience',
    0,
  );
}

/** Phase 8 piece I: building and crafting at a hideout, and the UI set (plan 15 §4.6). */
function renderHideout(): void {
  const sound = (
    category: 'hideout' | 'ui',
    id: string,
    name: string,
    description: string,
    samples: Float32Array,
    how: string,
    bus: SoundHints['bus'],
    loopCrossfadeS?: number,
  ): void =>
    writeSound(
      category,
      {
        id,
        name,
        description,
        kind: loopCrossfadeS === undefined ? 'oneshot' : 'loop',
        bus,
        ...(loopCrossfadeS === undefined ? {} : { loopCrossfadeS }),
        bundles: [category === 'ui' ? 'ui-audio' : 'hideout-audio'],
      },
      samples,
      how,
      TODAY_P8I,
    );
  const hideout = (
    id: string,
    name: string,
    description: string,
    samples: Float32Array,
    how: string,
    bus: SoundHints['bus'] = 'sfx',
    loopCrossfadeS?: number,
  ): void => sound('hideout', id, name, description, samples, how, bus, loopCrossfadeS);
  const ui = (
    id: string,
    name: string,
    description: string,
    samples: Float32Array,
    how: string,
  ): void => sound('ui', id, name, description, samples, how, 'ui');

  hideout(
    'sfx.build.saw',
    'saw',
    'A hand saw through a board: four strokes, push and pull, and the offcut dropping',
    handSaw(RATE),
    'Band-passed noise chopped at the teeth rate over a 620 Hz body resonance, a noise crack and sine thuds',
  );
  for (const v of [1, 2]) {
    hideout(
      `sfx.build.hammer-${v}`,
      `hammer-${v}`,
      `Driving a nail: a tap to set it, blows ringing higher as it goes in, the last one seating it (variant ${v})`,
      hammerNail(v, RATE),
      'Band-passed noise cracks, damped sines rising blow to blow, pitch-dropping sine thuds',
    );
  }
  hideout(
    'sfx.build.stone',
    'stone-set',
    'A dressed stone set in mortar: it slides on the bed, settles, and a mallet taps it to the line',
    stoneSet(RATE),
    'Band-passed noise scrape with grit grains, a low sine thud, noise clicks and short damped sines',
  );
  hideout(
    'sfx.build.plane',
    'plane',
    'A plane taking two shavings off a board',
    planeStrokes(RATE),
    'High band-passed noise under value-noise flutter, a 950 Hz rasp, small thuds',
  );
  hideout(
    'sfx.build.pry',
    'pry-down',
    'A piece taken down: the bar bites, the boards groan, a nail squeals out, the boards clatter onto the pile',
    pryDown(RATE),
    'A struck-plate clang, stick-slip knocks, a wobbling rising sine squeal, noise cracks and sine thuds',
  );
  hideout(
    'amb.build.work',
    'work-yard',
    `The yard at work, the work session's bed (${WORK_LOOP_S} s, looped): saws and hammers going in turn a little way off, a board thrown down, the open air`,
    workYard(RATE),
    'The saw and hammer generators low-passed and reverberated over low-passed noise air',
    'ambience',
    1,
  );
  hideout(
    'sfx.craft.forge',
    'forge',
    'The smithy at work: the bellows on the fire, heavy-tap-tap on the anvil three times, the quench hissing',
    forge(RATE),
    'Low-passed noise fire and bellows, struck-plate anvil rings with damped sines, high band-passed noise hiss, sine bubbles, reverb',
  );
  hideout(
    'sfx.craft.cooperage',
    'cooperage',
    'The cooperage at work: the hoop driver walked round a barrel under the mallet, and the head struck to sound it',
    cooperage(RATE),
    'Sine thuds under struck-plate clangs rising in pitch, a pitch-dropping sine boom',
  );
  hideout(
    'sfx.craft.still-load',
    'still-load',
    'The still loaded: mash poured in, the copper cap seated, a match and the fire taking, the first bubbles',
    stillLoad(RATE),
    'Band-passed noise pour with rising-sine glugs, a struck-plate clang, a noise burst, low-passed noise fire',
  );
  hideout(
    'amb.craft.still',
    'still-at-work',
    `A still at work (${STILL_LOOP_S} s, looped): the pot simmering, the fire under it, the run dripping into a jug`,
    stillAtWork(RATE),
    'Low-passed noise fire, rising-sine bubbles, damped sine plinks',
    'ambience',
    1,
  );
  hideout(
    'ui.build.place',
    'place-knock',
    'A piece placed in the plan: a short wooden knock',
    placeKnock(RATE),
    'A pitch-dropping sine thud, band-passed noise and a short damped sine',
    'ui',
  );
  hideout(
    'ui.build.refused',
    'refused-thud',
    'A piece refused: a dull, muffled thud',
    refusedThud(RATE),
    'Two low pitch-dropping sine thuds, low-passed',
    'ui',
  );
  ui(
    'ui.stamp',
    'stamp',
    'A rubber stamp on a contract: the pad through paper onto the desk',
    stampThunk(RATE),
    'Sine thuds and band-passed noise',
  );
  ui(
    'ui.newspaper',
    'newspaper',
    'A newspaper shaken open: crackling sheets and a snap',
    newspaperShake(RATE),
    'Band-passed noise sweeps under short high noise crackles, a noise snap',
  );
  ui(
    'ui.telegraph',
    'telegraph',
    'A telegraph sounder taking a short message: brass clicks down and up',
    telegraph(RATE),
    'Band-passed noise clicks and damped sines on a dot-and-dash pattern',
  );
  ui(
    'ui.page',
    'page',
    'A page of the logbook turned',
    pageTurn(RATE),
    'Band-passed noise sweep and a flick',
  );
  ui(
    'ui.chime.soft',
    'chime-soft',
    'A small hand bell, once and soft',
    chimeSoft(RATE),
    'Five inharmonic hand-bell partials on 1.32 kHz',
  );
  ui(
    'ui.chime.bright',
    'chime-bright',
    'A counter bell struck twice, the second a fourth higher',
    chimeBright(RATE),
    'Five inharmonic hand-bell partials on 1.18 and 1.57 kHz',
  );
}

main();
