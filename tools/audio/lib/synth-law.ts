/**
 * Phase 5 piece H (plan 06 §14.4 row H; plan 15 §4.4, §6.1 "Stingers", §11 Phase 5): the
 * law's sounds. Four Wanted stingers in the same synthesized folk instruments as the chart's
 * (tools/audio/lib/synth-chart.ts), the revenue cutter's engine and bell, her bow gun and
 * the shot landing (in the water or in the rigging), the deputies' rifle, and the lockup's
 * door going shut and opening again. Her whistle is Phase 3's (`whistle-cutter`). Pure
 * functions over Float32Array, seeded; original, so CC BY 4.0 like the repo's other assets.
 */

import { clang, thud } from './synth-harbor.ts';
import { drumHit, drumRoll, reedChord, shipBell, strum, trimTail } from './synth-chart.ts';
import {
  bandpass,
  fiddleDrone,
  lowpass,
  mixInto,
  reedNote,
  renderMelody,
  reverb,
  seeded,
  wander,
  type Note,
  type Random,
} from './synth.ts';

const TAU = Math.PI * 2;

const smooth = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

const noise = (n: number, random: Random): Float32Array =>
  Float32Array.from({ length: n }, () => random() * 2 - 1);

// ---------------------------------------------------------------------------------------
// Wanted stingers

export const WANTED_STINGERS = ['rise', 'hunted', 'most', 'cool'] as const;
export type WantedStingerName = (typeof WANTED_STINGERS)[number];

/**
 * One Wanted stinger. `rise`: word has reached the law (tiers 1–2), a drum stroke and a
 * concertina chord that sours. `hunted` (tiers 3–4): the drum marches, a falling minor run
 * and a held A minor over a low drone. `most` (tier 5): a deep bell tolls three times over
 * a muffled roll. `cool`: a region has cooled off, a soft phrase that settles on G.
 */
export function wantedStinger(name: WantedStingerName, rate: number): Float32Array {
  const random = seeded(3000 + WANTED_STINGERS.indexOf(name));
  const out = new Float32Array(Math.round(7 * rate));
  const at = (s: number): number => Math.round(s * rate);
  switch (name) {
    case 'rise': {
      mixInto(out, drumHit(rate, random, 0.9, 72), 0);
      mixInto(out, reedChord(['E4', 'G4', 'B4'], 0.45, rate, random), at(0.05), 0.9);
      // The chord sours: E minor slides to a diminished seventh on D#.
      mixInto(out, reedChord(['D#4', 'F#4', 'A4', 'C5'], 1.5, rate, random), at(0.55), 0.85);
      mixInto(out, fiddleDrone(['E3', 'B3'], 2.6, rate, random, 1), at(0.4), 0.55);
      mixInto(out, drumHit(rate, random, 0.5, 66), at(0.55));
      break;
    }
    case 'hunted': {
      // Dum, dum-dum: the drum marches in.
      mixInto(out, drumHit(rate, random, 1, 90), 0);
      mixInto(out, drumHit(rate, random, 0.8, 90), at(0.42));
      mixInto(out, drumHit(rate, random, 1, 90), at(0.56));
      const run: Note[] = [
        ['R', 2],
        ['E5', 1],
        ['D5', 1],
        ['C5', 1],
        ['B4', 1],
        ['A4', 1],
      ];
      renderMelody(out, run, 330, 0, rate, (hz, s) => reedNote(hz, s, rate, random), 1, random);
      mixInto(out, reedChord(['A3', 'C4', 'E4', 'A4'], 1.6, rate, random), at(1.25), 1);
      strum(out, 'Am', 1.25, 2.2, rate, random, 0.25, 0.02);
      mixInto(out, fiddleDrone(['A2', 'E3'], 3.2, rate, random, 1.2), at(0.9), 0.7);
      mixInto(
        out,
        drumRoll(rate, random, 1.1, 0.07, (t) => 0.3 + 0.5 * t, 84),
        at(1.9),
        0.75,
      );
      mixInto(out, drumHit(rate, random, 1, 80), at(3.05));
      break;
    }
    case 'most': {
      // The bell tolls: a big, low bell, three slow strokes, over a dark drone and roll.
      mixInto(out, fiddleDrone(['D3', 'A3', 'F4'], 5.5, rate, random, 1.6), 0, 0.6);
      mixInto(
        out,
        drumRoll(rate, random, 4.6, 0.08, (t) => 0.25 + 0.35 * Math.sin(Math.PI * t), 58),
        0,
        0.7,
      );
      for (const [s, g] of [
        [0, 0.9],
        [1.7, 0.8],
        [3.4, 0.85],
      ] as const) {
        mixInto(out, shipBell(rate, random, 196, 3.4), at(s), g);
      }
      break;
    }
    case 'cool': {
      // Cooled off: a soft falling phrase over E minor that settles on G.
      const notes: Note[] = [
        ['B4', 1],
        ['A4', 1],
        ['G4', 1],
        ['E4', 1],
        ['G4', 5],
      ];
      renderMelody(out, notes, 170, 0, rate, (hz, s) => reedNote(hz, s, rate, random), 0.7, random);
      strum(out, 'Em', 0, 1.3, rate, random, 0.16, 0.03);
      strum(out, 'G', 1.4, 2.4, rate, random, 0.2, 0.035);
      break;
    }
  }
  return trimTail(reverb(out, rate, 0.25, 0.8), rate);
}

// ---------------------------------------------------------------------------------------
// The cutter: engine, bell, gun

/** The Morrill's engine: revolutions a minute at full ahead, and blades on her screw. */
export const ENGINE = { rpm: 96, blades: 4, cylinders: 3, revs: 8, crossfadeS: 0.5 } as const;

/** Seconds of one revolution. */
export const ENGINE_REV_S = 60 / ENGINE.rpm;

/**
 * The cutter's engine as heard across the water, for a seamless loop: the screw beating
 * the water four times a revolution, the engine's low thud once a revolution, the knock of
 * three crossheads twice each, and the hum of the forced-draft blower. A marine engine
 * exhausts into its condenser, so there is no chuff from the stack. Rendered `revs`
 * revolutions plus the loop crossfade, so after the pipeline's crossfade the loop is a
 * whole number of revolutions.
 */
export function cutterEngine(rate: number, seed = 1889): Float32Array {
  const random = seeded(seed);
  const loopS = ENGINE.revs * ENGINE_REV_S;
  const n = Math.round((loopS + ENGINE.crossfadeS) * rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const wash = lowpass(lowpass(Float32Array.from(white), 260, rate), 260, rate);
  const hiss = bandpass(white, 1100, 0.7, rate);
  const drift = wander(n, 0.5, rate, random);
  const bladeHz = (ENGINE.rpm / 60) * ENGINE.blades;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // The screw: the wash swells with each blade, sharpest just after it passes.
    const blade = (t * bladeHz) % 1;
    const beat = 0.35 + 0.65 * Math.exp(-blade / 0.18);
    const blower = 0.05 * Math.sin(TAU * 118 * t) + 0.025 * Math.sin(TAU * 236 * t + 0.7);
    out[i] =
      2.4 * beat * (wash[i] as number) * (1 + 0.1 * (drift[i] as number)) +
      0.05 * (hiss[i] as number) +
      blower;
  }
  // Once a revolution, the engine's thud; twice a revolution per cylinder, a knock.
  const revs = Math.ceil((loopS + ENGINE.crossfadeS) / ENGINE_REV_S);
  for (let r = 0; r < revs; r++) {
    const start = r * ENGINE_REV_S;
    mixInto(out, thud(rate, random, 0.35, 44), Math.round(start * rate), 0.4);
    for (let k = 0; k < ENGINE.cylinders * 2; k++) {
      const s = start + ((k + 0.5) / (ENGINE.cylinders * 2)) * ENGINE_REV_S;
      mixInto(out, knock(rate, random), Math.round(s * rate), 0.08 + 0.04 * (k % 2));
    }
  }
  return out;
}

/** A crosshead's knock: a short dull metal tick. */
function knock(rate: number, random: Random): Float32Array {
  const n = Math.round(0.05 * rate);
  const out = new Float32Array(n);
  const f = 900 + 300 * random();
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] =
      Math.sin(TAU * f * t) * Math.exp(-t / 0.008) +
      0.4 * Math.sin(TAU * 310 * t) * Math.exp(-t / 0.015);
  }
  return out;
}

/** The cutter's bell, one stroke: a ship's bell a little bigger than a fish tug's. */
export function cutterBell(rate: number, seed = 1898): Float32Array {
  const random = seeded(seed);
  return shipBell(rate, random, 690, 3.2);
}

/**
 * The bow gun, one round: a sharp crack, a deep boom with its pitch falling, and the
 * report rolling back off the shores and islands for a couple of seconds after.
 */
export function bowGun(rate: number, seed = 1876): Float32Array {
  const random = seeded(seed);
  const seconds = 3.8;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const body = lowpass(lowpass(Float32Array.from(white), 420, rate), 420, rate);
  const crack = bandpass(white, 2600, 0.5, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * 48 * (1 + 1.8 * Math.exp(-t / 0.03))) / rate;
    const attack = Math.min(1, t / 0.0008);
    out[i] =
      attack *
      (1.1 * Math.sin(phase) * Math.exp(-t / 0.22) +
        5 * (body[i] as number) * Math.exp(-t / 0.35) +
        1.4 * (crack[i] as number) * Math.exp(-t / 0.012));
  }
  // The echo off the shore: low and late, then a long grumble.
  const tail = lowpass(lowpass(Float32Array.from(white), 220, rate), 220, rate);
  const grumble = wander(n, 6, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = smooth((t - 0.25) / 0.4) * Math.exp(-Math.max(0, t - 0.6) / 0.9);
    out[i] =
      (out[i] as number) + 4 * env * (tail[i] as number) * (0.7 + 0.3 * (grumble[i] as number));
  }
  for (const [s, g] of [
    [0.42, 0.28],
    [0.95, 0.16],
    [1.6, 0.09],
  ] as const) {
    mixInto(out, lowpass(out.slice(0, Math.round(0.6 * rate)), 700, rate), Math.round(s * rate), g);
  }
  return out;
}

/**
 * A round landing in the water: a thump, the column of water thrown up with a hiss, and
 * the water falling back in a patter.
 */
export function shotSplash(rate: number, seed = 1877): Float32Array {
  const random = seeded(seed);
  const seconds = 2.6;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const whoosh = bandpass(white, 900, 0.6, rate);
  const fizz = bandpass(white, 3200, 0.8, rate);
  const low = lowpass(lowpass(Float32Array.from(white), 180, rate), 180, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const rise = smooth(t / 0.06) * Math.exp(-t / 0.35);
    const fall = smooth((t - 0.5) / 0.25) * Math.exp(-Math.max(0, t - 0.75) / 0.55);
    out[i] =
      3.5 * (low[i] as number) * Math.exp(-t / 0.12) +
      1.1 * rise * (whoosh[i] as number) +
      0.6 * fall * (fizz[i] as number);
  }
  // Drops falling back.
  for (let t = 0.55; t < 2.1; t += 0.008 + 0.05 * random() * smooth((t - 0.6) / 1.2)) {
    const env = Math.exp(-Math.max(0, t - 0.8) / 0.5);
    mixInto(out, drop(rate, random), Math.round(t * rate), 0.12 * env * (0.4 + random()));
  }
  mixInto(out, thud(rate, random, 0.3, 60), 0, 0.5);
  return out;
}

/** One drop back into the lake: a tiny rising blip. */
function drop(rate: number, random: Random): Float32Array {
  const n = Math.round(0.04 * rate);
  const out = new Float32Array(n);
  const f0 = 700 + 1300 * random();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * f0 * (1 + 4 * t)) / rate;
    out[i] =
      Math.sin(phase) * Math.exp(-t / 0.01) + 0.3 * (random() * 2 - 1) * Math.exp(-t / 0.003);
  }
  return out;
}

/**
 * A round through the rigging: wood splintering, a stay parting with a twang, and canvas
 * tearing.
 */
export function riggingHit(rate: number, seed = 1878): Float32Array {
  const random = seeded(seed);
  const seconds = 1.8;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  // Splinters: a dense crackle that thins out fast.
  for (let t = 0; t < 0.35; t += 0.002 + 0.02 * random() * (t / 0.35)) {
    const env = Math.exp(-t / 0.1);
    mixInto(out, splinter(rate, random), Math.round(t * rate), env * (0.5 + 0.5 * random()));
  }
  mixInto(out, thud(rate, random, 0.4, 95), 0, 0.6);
  // A stay parting: a low twang dropping in pitch.
  const twang = new Float32Array(Math.round(0.9 * rate));
  let phase = 0;
  for (let i = 0; i < twang.length; i++) {
    const t = i / rate;
    phase += (TAU * 140 * (1 - 0.25 * smooth(t / 0.5))) / rate;
    twang[i] =
      (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase)) *
      Math.exp(-t / 0.22);
  }
  mixInto(out, twang, Math.round(0.08 * rate), 0.35);
  // Canvas tearing: rough noise in bursts.
  const white = noise(n, random);
  const rip = bandpass(white, 1700, 0.9, rate);
  const rough = wander(n, 70, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = smooth((t - 0.12) / 0.05) * (1 - smooth((t - 0.55) / 0.35));
    out[i] = (out[i] as number) + 0.9 * env * (rip[i] as number) * Math.max(0, rough[i] as number);
  }
  return out;
}

function splinter(rate: number, random: Random): Float32Array {
  const n = Math.round(0.012 * rate);
  const out = noise(n, random);
  const f = bandpass(out, 1800 + 2500 * random(), 1.2, rate);
  for (let i = 0; i < n; i++) f[i] = (f[i] as number) * Math.exp(-i / (0.003 * rate));
  return f;
}

/** A deputy's rifle: a sharp crack and a short slap back off the water. */
export function rifleShot(rate: number, seed = 1873): Float32Array {
  const random = seeded(seed);
  const seconds = 1.6;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const crack = bandpass(white, 3000, 0.6, rate);
  const body = lowpass(lowpass(Float32Array.from(white), 900, rate), 900, rate);
  const tail = lowpass(Float32Array.from(white), 500, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] =
      2 * (crack[i] as number) * Math.exp(-t / 0.006) +
      3 * (body[i] as number) * Math.exp(-t / 0.05) +
      0.3 * (tail[i] as number) * smooth((t - 0.1) / 0.15) * Math.exp(-Math.max(0, t - 0.25) / 0.3);
  }
  mixInto(
    out,
    bandpass(out.slice(0, Math.round(0.1 * rate)), 1200, 0.7, rate),
    Math.round(0.33 * rate),
    0.25,
  );
  return out;
}

// ---------------------------------------------------------------------------------------
// The lockup

/**
 * A hinge's creak: stick-slip pulses at a rate that wanders (80–220 a second) through the
 * iron's resonances.
 */
export function creak(
  rate: number,
  random: Random,
  seconds: number,
  lowHz = 80,
  highHz = 220,
): Float32Array {
  const n = Math.round(seconds * rate);
  const pulses = new Float32Array(n);
  const sweep = wander(n, 2.5, rate, random);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      pulses[i] = 1 - 0.4 * random();
      const hz = lowHz + (highHz - lowHz) * (0.5 + 0.5 * (sweep[i] as number));
      next = i + Math.max(1, Math.round((rate / hz) * (0.9 + 0.2 * random())));
    }
  }
  const out = new Float32Array(n);
  for (const [hz, q, g] of [
    [820, 6, 1],
    [1650, 8, 0.7],
    [2900, 10, 0.4],
  ] as const) {
    mixInto(out, bandpass(pulses, hz, q, rate), 0, g);
  }
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = (out[i] as number) * smooth(t / 0.08) * (1 - smooth((t - (seconds - 0.15)) / 0.15));
  }
  return out;
}

/** A key in a big lock: two clicks and the bolt's clunk. */
function keyTurn(rate: number, random: Random): Float32Array {
  const out = new Float32Array(Math.round(0.9 * rate));
  for (const [s, f, g] of [
    [0, 2800, 0.5],
    [0.22, 2200, 0.6],
  ] as const) {
    const n = Math.round(0.03 * rate);
    const tick = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      tick[i] =
        Math.sin(TAU * f * t) * Math.exp(-t / 0.004) +
        0.5 * (random() * 2 - 1) * Math.exp(-t / 0.002);
    }
    mixInto(out, tick, Math.round(s * rate), g);
  }
  mixInto(
    out,
    clang(rate, random, 420, 0.5).slice(0, Math.round(0.4 * rate)),
    Math.round(0.45 * rate),
    0.5,
  );
  return out;
}

/** A bolt shot home or drawn back: iron sliding on iron. */
function boltSlide(rate: number, random: Random, seconds = 0.3): Float32Array {
  const n = Math.round(seconds * rate);
  const scrape = bandpass(noise(n, random), 2400, 1.5, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    scrape[i] = (scrape[i] as number) * Math.sin((Math.PI * t) / seconds);
  }
  return scrape;
}

/**
 * The lockup's cell door going shut on you: the hinge's creak, the iron door banging home
 * in a stone room, the bolt shot and the key turned.
 */
export function lockupDoor(rate: number, seed = 1901): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(4 * rate));
  const at = (s: number): number => Math.round(s * rate);
  mixInto(out, creak(rate, random, 0.9, 110, 260), 0, 0.35);
  mixInto(out, clang(rate, random, 92, 1), at(0.85), 1);
  mixInto(out, thud(rate, random, 0.6, 55), at(0.85), 0.9);
  mixInto(out, boltSlide(rate, random, 0.25), at(1.6), 0.5);
  mixInto(out, clang(rate, random, 380, 0.5).slice(0, at(0.4)), at(1.85), 0.45);
  mixInto(out, keyTurn(rate, random), at(2.3), 0.9);
  return trimTail(reverb(out, rate, 0.32, 0.72, 0.5), rate);
}

/**
 * Let out: the key turned, the bolt drawn back, and the door swinging open on a long,
 * dry creak.
 */
export function lockupRelease(rate: number, seed = 1902): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(Math.round(4.2 * rate));
  const at = (s: number): number => Math.round(s * rate);
  mixInto(out, keyTurn(rate, random), 0, 0.9);
  mixInto(out, boltSlide(rate, random, 0.35), at(0.85), 0.55);
  mixInto(out, clang(rate, random, 360, 0.4).slice(0, at(0.35)), at(1.2), 0.35);
  mixInto(out, creak(rate, random, 1.9, 60, 170), at(1.45), 0.45);
  mixInto(out, thud(rate, random, 0.4, 70), at(3.3), 0.35);
  return trimTail(reverb(out, rate, 0.3, 0.72, 0.5), rate);
}

// ---------------------------------------------------------------------------------------
// The paper boy

/** One syllable of a call: pitch glide (Hz), formants at its start and end (Hz), seconds. */
export interface Syllable {
  atS: number;
  seconds: number;
  f0: readonly [number, number];
  formants: readonly [readonly number[], readonly number[]];
  /** A plosive's burst before the vowel ("p"), seconds of closure first. */
  burst?: boolean;
}

/** Formant bandwidths, Hz, and levels (a boy's voice is bright and thin). */
const FORMANT_BW = [90, 120, 180] as const;
const FORMANT_GAIN = [1, 0.55, 0.3] as const;

/**
 * A paper boy crying the evening edition down the street: "Pa-per! Pa-per!" sung out on a
 * falling third in a boy's voice, the way the newsies called. Formant synthesis (a pulse
 * train through three moving vocal-tract resonances) with a little vibrato and breath, then
 * the street's slap-back, so it reads as a shout, not as words.
 */
export function newsboyCall(rate: number, seed = 1899): Float32Array {
  const random = seeded(seed);
  const seconds = 3.2;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const pay = [720, 2250, 3200] as const;
  const ay = [520, 2500, 3300] as const;
  const er = [520, 1450, 1850] as const;
  const call = (atS: number, pitch: number): Syllable[] => [
    { atS, seconds: 0.34, f0: [pitch, pitch * 1.02], formants: [pay, ay], burst: true },
    {
      atS: atS + 0.42,
      seconds: 0.62,
      f0: [pitch * 0.84, pitch * 0.78],
      formants: [er, er],
      burst: true,
    },
  ];
  const syllables = [...call(0.05, 560), ...call(1.55, 540)];
  for (const s of syllables) mixInto(out, syllable(s, rate, random), Math.round(s.atS * rate));
  // The street: a slap-back off the buildings across the way, and a little room.
  mixInto(
    out,
    lowpass(out.slice(0, n - Math.round(0.11 * rate)), 2500, rate),
    Math.round(0.11 * rate),
    0.25,
  );
  return trimTail(reverb(out, rate, 0.15, 0.6), rate);
}

/** One formant-synthesized syllable (a shout, not words); the combat crowds use it too. */
export function syllable(s: Syllable, rate: number, random: Random): Float32Array {
  const closure = s.burst ? 0.05 : 0;
  const n = Math.round((closure + s.seconds) * rate);
  const out = new Float32Array(n);
  // The voice: a band-limited pulse train (harmonics falling 6 dB an octave: a shout).
  const voice = new Float32Array(n);
  let phase = 0;
  const vib = 5.5 + random();
  for (let i = Math.round(closure * rate); i < n; i++) {
    const t = i / rate - closure;
    const u = t / s.seconds;
    const f0 = (s.f0[0] + (s.f0[1] - s.f0[0]) * u) * (1 + 0.012 * Math.sin(TAU * vib * t));
    phase += (TAU * f0) / rate;
    let v = 0;
    const top = Math.min(30, Math.floor(5000 / f0));
    for (let h = 1; h <= top; h++) v += Math.sin(h * phase) / h;
    // Loud at once, a shout's push in the middle, falling off at the end.
    const env =
      smooth(u / 0.08) * (1 - smooth((u - 0.7) / 0.3)) * (0.85 + 0.15 * Math.sin(Math.PI * u));
    voice[i] = env * (v + 0.08 * (random() * 2 - 1));
  }
  // Three resonators whose centers move from the start formants to the end ones.
  for (let k = 0; k < 3; k++) {
    let y1 = 0;
    let y2 = 0;
    const bw = FORMANT_BW[k] as number;
    const r = Math.exp((-Math.PI * bw) / rate);
    for (let i = 0; i < n; i++) {
      const u = Math.min(1, Math.max(0, (i / rate - closure) / s.seconds));
      const fa = s.formants[0][k] as number;
      const fb = s.formants[1][k] as number;
      const f = fa + (fb - fa) * smooth(u);
      const c = 2 * r * Math.cos((TAU * f) / rate);
      const y = (1 - r * r) * (voice[i] as number) + c * y1 - r * r * y2;
      y2 = y1;
      y1 = y;
      // Scaled so each resonance peaks at about its gain, whatever its frequency.
      out[i] =
        (out[i] as number) + (FORMANT_GAIN[k] as number) * y * 2 * Math.sin((TAU * f) / rate);
    }
  }
  if (s.burst) {
    // "p": a short puff of noise as the lips part.
    const b = Math.round(0.02 * rate);
    const at = Math.round(closure * rate) - Math.round(0.012 * rate);
    for (let i = 0; i < b; i++) {
      const j = at + i;
      if (j >= 0 && j < n)
        out[j] = (out[j] as number) + 0.25 * (random() * 2 - 1) * Math.exp(-i / (0.004 * rate));
    }
  }
  return out;
}
