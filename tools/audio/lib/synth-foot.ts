/**
 * Phase 7 piece I (plan 08 §20.4 row I; plan 15 §4.5, §6.1 "Stealth", §11 Phase 7): the
 * sounds of the captain ashore. Footsteps on six kinds of ground, a landing, swimming and a
 * cold breath; the burglar's kit (a pick working, a lock's click, a lock giving, a pick
 * snapping, the crowbar, a door, a crate up and down, a rope tied, the cosh, the knife, a
 * bottle, a stone landing, keys, cell bars); the watch (wordless barks, a police whistle);
 * the stealth layer and its stinger; and the places: the docks at night, the saloon's room
 * and its tune, the island's woods and its crickets. No free recordings of these in one
 * consistent voice turned up, so all are synthesized like the law's and the combat sounds;
 * the voices are formant syllables, so no words, as plan 15 §2 wants. Pure functions over
 * Float32Array, seeded; original, so CC BY 4.0 like the repo's other assets.
 */

import { clang, thud } from './synth-harbor.ts';
import { drumHit, reedChord, trimTail } from './synth-chart.ts';
import { syllable, type Syllable } from './synth-law.ts';
import { littleBrownBullsForm, littleBrownBullsGuitar } from './synth-songs.ts';
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

const secs = (s: number, rate: number): number => Math.round(s * rate);

/** Band-passed noise that dies away: the grain most of these sounds are built from. */
function burst(
  rate: number,
  random: Random,
  seconds: number,
  hz: number,
  q: number,
  decayS: number,
): Float32Array {
  const n = secs(seconds, rate);
  const out = bandpass(noise(n, random), hz, q, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = (out[i] as number) * Math.min(1, t / 0.001) * Math.exp(-t / decayS);
  }
  return out;
}

/** Low-passed noise under a hump: a soft body, a swish, a breath. */
function hush(
  rate: number,
  random: Random,
  seconds: number,
  hz: number,
  riseS: number,
): Float32Array {
  const n = secs(seconds, rate);
  const out = lowpass(lowpass(noise(n, random), hz, rate), hz, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = (out[i] as number) * smooth(t / riseS) * smooth((seconds - t) / (seconds - riseS));
  }
  return out;
}

/** A damped sine: a ping, a tick, a tap. */
function ping(rate: number, hz: number, decayS: number, seconds = decayS * 6): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = Math.sin(TAU * hz * t) * Math.exp(-t / decayS) * Math.min(1, t / 0.0005);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Footsteps

export const STEP_GROUNDS = ['wood', 'dirt', 'gravel', 'grass', 'stone', 'snow'] as const;
export type StepGround = (typeof STEP_GROUNDS)[number];
export const STEP_VARIANTS = 2;

/**
 * One footstep, heel then toe. Wood: a hollow plank knock. Dirt: a soft thump and a scuff.
 * Gravel: a thump under a scatter of stones. Grass: a swish. Stone: a hard tap. Snow: a
 * squeaking crunch.
 */
export function footstep(ground: StepGround, variant: number, rate: number): Float32Array {
  const random = seeded(7100 + STEP_GROUNDS.indexOf(ground) * 10 + variant);
  const out = new Float32Array(secs(0.42, rate));
  const toe = secs(0.055 + 0.02 * random(), rate);
  switch (ground) {
    case 'wood': {
      const hz = 96 + 22 * random();
      mixInto(out, thud(rate, random, 0.3, hz), 0, 1);
      mixInto(out, thud(rate, random, 0.22, hz * 1.4), toe, 0.55);
      mixInto(out, burst(rate, random, 0.2, 640 + 200 * random(), 3, 0.035), 0, 0.5);
      break;
    }
    case 'dirt': {
      mixInto(out, hush(rate, random, 0.16, 260, 0.01), 0, 2.2);
      mixInto(out, hush(rate, random, 0.12, 320, 0.01), toe, 1.4);
      mixInto(out, burst(rate, random, 0.14, 1500 + 500 * random(), 0.7, 0.03), toe, 0.25);
      break;
    }
    case 'gravel': {
      mixInto(out, hush(rate, random, 0.14, 240, 0.008), 0, 1.6);
      for (let k = 0; k < 16; k++) {
        const at = secs(0.2 * random() ** 1.6, rate);
        mixInto(
          out,
          burst(rate, random, 0.04, 2200 + 3600 * random(), 2.5, 0.004 + 0.006 * random()),
          at,
          0.5 * (0.4 + random()),
        );
      }
      break;
    }
    case 'grass': {
      const swish = bandpass(hush(rate, random, 0.2, 9000, 0.05), 3400 + 800 * random(), 0.6, rate);
      mixInto(out, swish, 0, 1.3);
      mixInto(out, hush(rate, random, 0.12, 200, 0.01), secs(0.02, rate), 1.1);
      break;
    }
    case 'stone': {
      mixInto(out, burst(rate, random, 0.08, 1700 + 500 * random(), 1.2, 0.009), 0, 1);
      mixInto(out, ping(rate, 210 + 40 * random(), 0.018), 0, 0.8);
      mixInto(out, burst(rate, random, 0.06, 2300 + 500 * random(), 1.2, 0.007), toe, 0.5);
      break;
    }
    case 'snow': {
      const n = secs(0.26, rate);
      const crunch = bandpass(noise(n, random), 1300 + 300 * random(), 0.8, rate);
      const grit = wander(n, 90, rate, random);
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const env = smooth(t / 0.02) * smooth((0.26 - t) / 0.16);
        crunch[i] = (crunch[i] as number) * env * (0.35 + 0.65 * Math.abs(grit[i] as number));
      }
      mixInto(out, crunch, 0, 1.4);
      mixInto(out, hush(rate, random, 0.12, 180, 0.01), 0, 1);
      break;
    }
  }
  return out;
}

/** Coming down hard from a height: both boots and a grunt of breath. */
export function landing(rate: number, seed = 7190): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.6, rate));
  mixInto(out, thud(rate, random, 0.4, 70), 0, 1);
  mixInto(out, thud(rate, random, 0.3, 92), secs(0.03, rate), 0.8);
  mixInto(out, hush(rate, random, 0.2, 500, 0.01), 0, 1.5);
  mixInto(out, bandpass(hush(rate, random, 0.3, 4000, 0.04), 900, 0.8, rate), secs(0.1, rate), 0.5);
  return out;
}

// ---------------------------------------------------------------------------------------
// Swimming

/** Rising drips: a sine blip that climbs, as a bubble closes. */
function drip(rate: number, random: Random): Float32Array {
  const seconds = 0.05 + 0.05 * random();
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const f0 = 500 + 900 * random();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (TAU * f0 * (1 + 1.2 * u)) / rate;
    out[i] = Math.sin(phase) * Math.sin(Math.PI * u) ** 2;
  }
  return out;
}

/** Going into the lake: the slap, the water closing over, the drips after. */
export function swimSplash(rate: number, seed = 7200): Float32Array {
  const random = seeded(seed);
  const seconds = 1.6;
  const out = new Float32Array(secs(seconds, rate));
  mixInto(out, burst(rate, random, 0.3, 1500, 0.5, 0.05), 0, 1.2);
  mixInto(out, hush(rate, random, 0.5, 420, 0.02), 0, 2.4);
  const wash = bandpass(hush(rate, random, 1.3, 7000, 0.08), 2600, 0.5, rate);
  mixInto(out, wash, secs(0.05, rate), 0.9);
  for (let k = 0; k < 22; k++) {
    mixInto(out, drip(rate, random), secs(0.15 + 1.2 * random(), rate), 0.25 * random());
  }
  return out;
}

/** One swimming stroke: an arm through the water and the water running off it. */
export function swimStroke(variant: number, rate: number): Float32Array {
  const random = seeded(7210 + variant);
  const seconds = 0.9;
  const out = new Float32Array(secs(seconds, rate));
  const pull = bandpass(hush(rate, random, 0.7, 6000, 0.25), 1100 + 300 * random(), 0.6, rate);
  mixInto(out, pull, 0, 1.2);
  mixInto(out, hush(rate, random, 0.4, 350, 0.1), secs(0.1, rate), 1.2);
  for (let k = 0; k < 9; k++) {
    mixInto(out, drip(rate, random), secs(0.35 + 0.45 * random(), rate), 0.22 * random());
  }
  return out;
}

/** A shivering breath in cold water: in through the teeth in jerks, and out. */
export function shiver(rate: number, seed = 7220): Float32Array {
  const random = seeded(seed);
  const seconds = 1.7;
  const n = secs(seconds, rate);
  const air = bandpass(noise(n, random), 2100, 0.9, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const inhale = smooth(t / 0.1) * smooth((0.75 - t) / 0.2);
    const judder = 0.55 + 0.45 * Math.sign(Math.sin(TAU * 13 * t));
    const exhale = smooth((t - 0.9) / 0.1) * smooth((seconds - t) / 0.5);
    out[i] = (air[i] as number) * (inhale * judder + 0.7 * exhale);
  }
  return lowpass(out, 3800, rate);
}

// ---------------------------------------------------------------------------------------
// Locks, doors and the crowbar

/** A pick and a tension wrench working in a lock: small scrapes and ticks. */
export function lockPick(rate: number, seed = 7300): Float32Array {
  const random = seeded(seed);
  const seconds = 1.4;
  const out = new Float32Array(secs(seconds, rate));
  for (let t = 0.02; t < seconds - 0.2; t += 0.07 + 0.2 * random()) {
    if (random() < 0.55) {
      mixInto(out, ping(rate, 3200 + 2600 * random(), 0.004), secs(t, rate), 0.4 * random());
    } else {
      const rasp = bandpass(hush(rate, random, 0.09, 9000, 0.02), 4200, 2, rate);
      mixInto(out, rasp, secs(t, rate), 0.5 * random());
    }
  }
  return out;
}

/** A pin setting too hard: the click that carries. */
export function lockClick(rate: number, seed = 7301): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.25, rate));
  mixInto(out, burst(rate, random, 0.05, 2600, 2, 0.004), 0, 1);
  mixInto(out, ping(rate, 1450, 0.012), 0, 0.7);
  mixInto(out, ping(rate, 3900, 0.006), secs(0.012, rate), 0.4);
  return out;
}

/** The lock giving: the bolt drawn, the hasp dropping. */
export function lockOpen(rate: number, seed = 7302): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.8, rate));
  mixInto(out, lockClick(rate, seed + 10), 0, 0.7);
  mixInto(out, thud(rate, random, 0.2, 180), secs(0.12, rate), 0.8);
  mixInto(out, clang(rate, random, 900, 0.5).slice(0, secs(0.3, rate)), secs(0.14, rate), 0.5);
  mixInto(out, ping(rate, 2300, 0.03), secs(0.3, rate), 0.25);
  return out;
}

/** A pick snapping in the lock. */
export function pickSnap(rate: number, seed = 7303): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.5, rate));
  mixInto(out, burst(rate, random, 0.03, 5200, 1.5, 0.003), 0, 1);
  mixInto(out, ping(rate, 6100, 0.02), 0, 0.6);
  mixInto(out, ping(rate, 4300, 0.008), secs(0.16, rate), 0.25);
  mixInto(out, ping(rate, 5200, 0.006), secs(0.23, rate), 0.15);
  return out;
}

/** A stick-slip groan: wood or rope under strain, as a train of soft knocks. */
function groan(
  rate: number,
  random: Random,
  seconds: number,
  hz: number,
  fromPerS: number,
  toPerS: number,
): Float32Array {
  const out = new Float32Array(secs(seconds, rate));
  let t = 0;
  while (t < seconds - 0.05) {
    const u = t / seconds;
    mixInto(
      out,
      burst(rate, random, 0.04, hz * (0.9 + 0.2 * random()), 6, 0.006),
      secs(t, rate),
      0.5 + 0.5 * Math.sin(Math.PI * u),
    );
    t += (1 / (fromPerS + (toPerS - fromPerS) * u)) * (0.8 + 0.4 * random());
  }
  return out;
}

/** The crowbar: the wood groaning, the hasp tearing out, the lock on the floor. */
export function crowbar(rate: number, seed = 7304): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.6, rate));
  mixInto(out, groan(rate, random, 0.6, 520, 30, 90), 0, 0.7);
  mixInto(out, burst(rate, random, 0.25, 1900, 0.6, 0.03), secs(0.6, rate), 1.4);
  mixInto(out, thud(rate, random, 0.35, 110), secs(0.6, rate), 1.1);
  mixInto(out, clang(rate, random, 620, 0.7).slice(0, secs(0.5, rate)), secs(0.62, rate), 0.6);
  mixInto(out, clang(rate, random, 1100, 0.4).slice(0, secs(0.3, rate)), secs(0.98, rate), 0.4);
  mixInto(out, thud(rate, random, 0.15, 200), secs(0.98, rate), 0.4);
  return out;
}

/** A door on dry hinges. */
export function doorCreak(rate: number, seed = 7305): Float32Array {
  const random = seeded(seed);
  const seconds = 1.3;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const drift = wander(n, 3, rate, random);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = t / seconds;
    // The hinge sticks and slips: a rough pulse whose rate rises and falls with the swing.
    const f = 150 + 240 * Math.sin(Math.PI * u) + 40 * (drift[i] as number);
    phase += (TAU * f) / rate;
    const saw = 2 * (phase / TAU - Math.floor(phase / TAU + 0.5));
    out[i] = saw * smooth(u / 0.1) * smooth((1 - u) / 0.25) * (0.6 + 0.4 * (drift[i] as number));
  }
  const voiced = bandpass(out, 1250, 2.5, rate);
  mixInto(voiced, bandpass(out, 2700, 3, rate), 0, 0.6);
  mixInto(voiced, thud(rate, random, 0.2, 140), secs(seconds - 0.25, rate), 0.25);
  return voiced;
}

// ---------------------------------------------------------------------------------------
// Crates, rope, the cosh, the knife, a bottle, a stone

/** A crate taken up: it scrapes off the stack and its boards take the strain. */
export function crateLift(rate: number, seed = 7310): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.9, rate));
  const scrape = bandpass(hush(rate, random, 0.4, 6000, 0.1), 900, 0.8, rate);
  mixInto(out, scrape, 0, 1.3);
  mixInto(out, groan(rate, random, 0.35, 700, 40, 20), secs(0.3, rate), 0.5);
  mixInto(out, thud(rate, random, 0.15, 160), secs(0.36, rate), 0.35);
  return out;
}

/** A crate set down: a heavy wooden knock and what's inside settling. */
export function crateDown(rate: number, seed = 7311): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.8, rate));
  mixInto(out, thud(rate, random, 0.4, 84), 0, 1);
  mixInto(out, thud(rate, random, 0.25, 130), secs(0.05, rate), 0.6);
  mixInto(out, burst(rate, random, 0.2, 800, 2, 0.04), 0, 0.6);
  for (let k = 0; k < 5; k++) {
    mixInto(
      out,
      thud(rate, random, 0.08, 240 + 200 * random()),
      secs(0.12 + 0.3 * random(), rate),
      0.15,
    );
  }
  return out;
}

/** A man's wrists tied: rope drawn through and hauled tight, twice. */
export function ropeTie(rate: number, seed = 7312): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.5, rate));
  for (const at of [0, 0.7]) {
    const draw = bandpass(hush(rate, random, 0.4, 8000, 0.15), 2400, 0.7, rate);
    mixInto(out, draw, secs(at, rate), 0.9);
    mixInto(out, groan(rate, random, 0.3, 950, 60, 25), secs(at + 0.32, rate), 0.6);
  }
  return out;
}

const VOWEL = {
  ah: [730, 1090, 2440],
  aw: [570, 840, 2410],
  oh: [500, 900, 2400],
  uh: [640, 1190, 2390],
  eh: [530, 1840, 2480],
  mm: [280, 1000, 2200],
  ay: [480, 2000, 2600],
} as const satisfies Record<string, readonly number[]>;
type Vowel = keyof typeof VOWEL;

const say = (
  atS: number,
  seconds: number,
  pitch: number,
  from: Vowel,
  to: Vowel,
  glide = 1,
  burstFirst = false,
): Syllable => ({
  atS,
  seconds,
  f0: [pitch, pitch * glide],
  formants: [VOWEL[from], VOWEL[to]],
  burst: burstFirst,
});

function speak(rate: number, random: Random, seconds: number, parts: Syllable[]): Float32Array {
  const out = new Float32Array(secs(seconds, rate));
  for (const s of parts) mixInto(out, syllable(s, rate, random), secs(s.atS, rate));
  return out;
}

/** The cosh: a dull crack on the skull, the breath going out of him, and he folds. */
export function coshBlow(rate: number, seed = 7313): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.3, rate));
  mixInto(out, thud(rate, random, 0.2, 150), 0, 1);
  mixInto(out, burst(rate, random, 0.06, 1100, 1, 0.012), 0, 0.9);
  mixInto(
    out,
    lowpass(speak(rate, random, 0.5, [say(0, 0.28, 120, 'uh', 'mm', 0.7)]), 1400, rate),
    secs(0.06, rate),
    0.35,
  );
  mixInto(out, thud(rate, random, 0.4, 62), secs(0.62, rate), 0.7);
  mixInto(out, hush(rate, random, 0.3, 500, 0.02), secs(0.62, rate), 1.2);
  return out;
}

/** The knife: steel out, a short wet blow, a breath. */
export function knifeBlow(rate: number, seed = 7314): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.2, rate));
  const draw = bandpass(hush(rate, random, 0.22, 12000, 0.12), 5200, 2.5, rate);
  mixInto(out, draw, 0, 0.8);
  mixInto(out, ping(rate, 4700, 0.05), secs(0.16, rate), 0.2);
  mixInto(out, hush(rate, random, 0.12, 700, 0.01), secs(0.32, rate), 2);
  mixInto(out, thud(rate, random, 0.15, 120), secs(0.32, rate), 0.6);
  mixInto(
    out,
    lowpass(speak(rate, random, 0.6, [say(0, 0.4, 135, 'ah', 'uh', 0.6)]), 1200, rate),
    secs(0.38, rate),
    0.25,
  );
  mixInto(out, thud(rate, random, 0.4, 60), secs(0.85, rate), 0.5);
  return out;
}

/** A bottle passed over: the cork, and a long pull at it. */
export function bottle(rate: number, seed = 7315): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.8, rate));
  // The cork: a squeak and a hollow pop on the neck's resonance.
  mixInto(out, groan(rate, random, 0.18, 1800, 120, 200), 0, 0.3);
  mixInto(out, ping(rate, 620, 0.03), secs(0.2, rate), 1);
  mixInto(out, burst(rate, random, 0.05, 1400, 1, 0.01), secs(0.2, rate), 0.6);
  // Glugs: the bottle's air note rising as it empties.
  for (let k = 0; k < 6; k++) {
    const at = 0.55 + k * 0.17 + 0.03 * random();
    const n = secs(0.11, rate);
    const glug = new Float32Array(n);
    let phase = 0;
    const f0 = 250 + 28 * k;
    for (let i = 0; i < n; i++) {
      const u = i / n;
      phase += (TAU * f0 * (1 + 0.5 * u)) / rate;
      glug[i] = Math.sin(phase) * Math.sin(Math.PI * u) ** 1.5;
    }
    mixInto(out, glug, secs(at, rate), 0.6);
    mixInto(out, hush(rate, random, 0.1, 900, 0.03), secs(at, rate), 0.6);
  }
  return out;
}

/** A thrown stone coming down: it cracks on something and skitters. */
export function stoneLand(rate: number, seed = 7316): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.9, rate));
  let gap = 0.22;
  let level = 1;
  for (let t = 0; t < 0.7; t += gap) {
    mixInto(
      out,
      burst(rate, random, 0.05, 2100 + 900 * random(), 1.5, 0.006),
      secs(t, rate),
      level,
    );
    mixInto(out, ping(rate, 380 + 200 * random(), 0.012), secs(t, rate), 0.6 * level);
    gap *= 0.55;
    level *= 0.6;
    if (gap < 0.02) break;
  }
  return out;
}

/** A ring of keys lifted or turned: small bright steel, jostling. */
export function keys(rate: number, seed = 7317): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1, rate));
  for (let k = 0; k < 14; k++) {
    const at = 0.7 * random() ** 1.3;
    mixInto(
      out,
      ping(rate, 3400 + 4200 * random(), 0.015 + 0.03 * random()),
      secs(at, rate),
      0.5 * random(),
    );
  }
  return out;
}

/** A tin cup run along cell bars, then a fist on them: iron ringing in a small room. */
export function barsBang(rate: number, seed = 7318): Float32Array {
  const random = seeded(seed);
  const dry = new Float32Array(secs(1.6, rate));
  for (let k = 0; k < 5; k++) {
    mixInto(
      dry,
      clang(rate, random, 520 + 60 * k, 0.6).slice(0, secs(0.4, rate)),
      secs(0.09 * k, rate),
      0.5,
    );
  }
  for (const at of [0.62, 0.86, 1.1]) {
    mixInto(dry, clang(rate, random, 310, 1).slice(0, secs(0.45, rate)), secs(at, rate), 0.9);
    mixInto(dry, thud(rate, random, 0.15, 120), secs(at, rate), 0.5);
  }
  return trimTail(reverb(dry, rate, 0.18, 0.6, 0.4), rate);
}

// ---------------------------------------------------------------------------------------
// The watch

export const BARKS = ['hm', 'who', 'hey', 'mutter', 'giveup'] as const;
export type BarkName = (typeof BARKS)[number];

/**
 * A guard's voice, wordless. `hm`: a short questioning hum. `who`: two rising syllables,
 * a challenge. `hey`: a sharp shout and a second, harder. `mutter`: a low grumble while he
 * looks. `giveup`: a falling grunt as he lets it go.
 */
export function guardBark(name: BarkName, rate: number): Float32Array {
  const random = seeded(7400 + BARKS.indexOf(name));
  switch (name) {
    case 'hm':
      return speak(rate, random, 0.7, [say(0.02, 0.36, 118, 'mm', 'uh', 1.35)]);
    case 'who':
      return speak(rate, random, 1.1, [
        say(0.02, 0.24, 132, 'oh', 'uh', 1.05),
        say(0.34, 0.42, 138, 'eh', 'ay', 1.4),
      ]);
    case 'hey':
      return speak(rate, random, 1.3, [
        say(0.02, 0.34, 190, 'eh', 'ay', 1.12),
        say(0.5, 0.42, 205, 'ah', 'aw', 0.82, true),
      ]);
    case 'mutter': {
      const parts: Syllable[] = [];
      let t = 0.02;
      for (let k = 0; k < 6; k++) {
        const len = 0.1 + 0.12 * random();
        const v: Vowel[] = ['mm', 'uh', 'oh', 'aw'];
        parts.push(
          say(
            t,
            len,
            96 + 16 * random(),
            v[Math.floor(random() * 4)] as Vowel,
            v[Math.floor(random() * 4)] as Vowel,
            0.92 + 0.12 * random(),
          ),
        );
        t += len + 0.04 + 0.1 * random();
      }
      return lowpass(speak(rate, random, t + 0.2, parts), 1600, rate);
    }
    case 'giveup':
      return speak(rate, random, 0.9, [
        say(0.02, 0.2, 124, 'uh', 'mm', 0.95),
        say(0.3, 0.4, 112, 'aw', 'mm', 0.68),
      ]);
  }
}

/** A constable's pea whistle: two long shrill blasts, the pea rattling in them. */
export function policeWhistle(rate: number, seed = 7410): Float32Array {
  const random = seeded(seed);
  const seconds = 2.1;
  const n = secs(seconds, rate);
  const dry = new Float32Array(n);
  const air = bandpass(noise(n, random), 3000, 1.5, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const blast =
      smooth(t / 0.03) * smooth((0.8 - t) / 0.06) +
      smooth((t - 0.95) / 0.03) * smooth((seconds - 0.1 - t) / 0.08);
    // The pea chops the note about forty times a second and bends it a little.
    const pea = Math.sin(TAU * 41 * t);
    const f = 2850 * (1 + 0.012 * pea) * (1 + 0.02 * blast);
    phase += (TAU * f) / rate;
    const tone = Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
    dry[i] = blast * ((0.62 + 0.38 * pea) * tone + 0.5 * (air[i] as number));
  }
  return trimTail(reverb(dry, rate, 0.12, 0.7, 0.3), rate);
}

// ---------------------------------------------------------------------------------------
// The stealth layer (plan 15 §6.1: sparse, held, a pulse under it)

export const TENSION = { bpm: 54, beats: 12 } as const;
export const TENSION_LOOP_S = (TENSION.beats * 60) / TENSION.bpm;

/** Folds whatever runs past `loopS` back onto the head, so the loop has no seam. */
function folded(x: Float32Array, loopS: number, rate: number): Float32Array {
  const n = secs(loopS, rate);
  const out = x.slice(0, n);
  for (let i = n; i < x.length; i++) {
    out[(i - n) % n] = (out[(i - n) % n] as number) + (x[i] as number);
  }
  return out;
}

/**
 * The stealth layer: a low fifth on bowed strings that never resolves, a heartbeat on a
 * muffled drum, and now and then one high held note. Loops; the game brings it up as a
 * guard grows suspicious.
 */
export function tensionLoop(rate: number, seed = 7500): Float32Array {
  const random = seeded(seed);
  const beatS = 60 / TENSION.bpm;
  const out = new Float32Array(secs(TENSION_LOOP_S + 4, rate));
  // The drone, rendered as a ring so it joins itself.
  const drone = fiddleDrone(['D2', 'A2'], TENSION_LOOP_S + 3, rate, random, 3);
  mixInto(out, drone, 0, 0.8);
  for (let b = 0; b < TENSION.beats; b++) {
    const at = b * beatS;
    mixInto(out, lowpass(drumHit(rate, random, 0.8, 58), 300, rate), secs(at, rate), 0.9);
    mixInto(out, lowpass(drumHit(rate, random, 0.5, 54), 260, rate), secs(at + 0.22, rate), 0.6);
  }
  for (const [beat, note] of [
    [2, 'F4'],
    [8, 'E4'],
  ] as const) {
    mixInto(out, fiddleDrone([note], 4 * beatS, rate, random, 1.6), secs(beat * beatS, rate), 0.22);
  }
  return folded(reverb(out, rate, 0.22, 0.85, 0.5), TENSION_LOOP_S, rate);
}

/** Seen: a drum stroke, a diminished stab on the concertina, the strings climbing. */
export function spottedStinger(rate: number, seed = 7510): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.2, rate));
  mixInto(out, drumHit(rate, random, 1, 84), 0);
  mixInto(out, drumHit(rate, random, 0.8, 84), secs(0.16, rate));
  mixInto(out, reedChord(['D4', 'F4', 'G#4', 'B4'], 0.5, rate, random), secs(0.02, rate), 1);
  const climb: Note[] = [
    ['D5', 0.5],
    ['F5', 0.5],
    ['G#5', 0.5],
    ['B5', 2],
  ];
  renderMelody(out, climb, 300, 1, rate, (hz, s) => reedNote(hz, s, rate, random), 0.6, random);
  mixInto(out, fiddleDrone(['D3', 'G#3'], 2.2, rate, random, 0.6), secs(0.2, rate), 0.6);
  return trimTail(reverb(out, rate, 0.2, 0.8, 0.4), rate);
}

// ---------------------------------------------------------------------------------------
// Places

/** Bayfield's docks at night: the lake lapping at the piles, a hull easing on her lines. */
export function docksNight(rate: number, seed = 7600): Float32Array {
  const random = seeded(seed);
  const seconds = 16;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const swell = wander(n, 0.35, rate, random);
  const ripple = wander(n, 2.2, rate, random);
  const low = lowpass(lowpass(noise(n, random), 520, rate), 520, rate);
  const mid = bandpass(noise(n, random), 1300, 0.6, rate);
  for (let i = 0; i < n; i++) {
    const lap = Math.max(0, 0.35 + 0.65 * (swell[i] as number));
    const chop = 0.5 + 0.5 * (ripple[i] as number);
    out[i] = 2.2 * lap * (low[i] as number) + 0.5 * lap * chop * (mid[i] as number);
  }
  // Laps against the piles: little slaps and drips.
  for (let t = 0.4; t < seconds - 1; t += 0.5 + 1.6 * random()) {
    mixInto(out, hush(rate, random, 0.25, 700, 0.03), secs(t, rate), 0.5 * random());
    for (let k = 0; k < 3; k++) {
      mixInto(out, drip(rate, random), secs(t + 0.1 + 0.4 * random(), rate), 0.05 * random());
    }
  }
  // A hawser taking the strain, twice in the loop, far off.
  for (const at of [4.2, 11.5]) {
    mixInto(out, lowpass(groan(rate, random, 1.1, 420, 14, 40), 1800, rate), secs(at, rate), 0.08);
  }
  return out;
}

/** The saloon's room: a dozen men talking low, a laugh, glasses, a chair. */
export function saloonRoom(rate: number, seed = 7610): Float32Array {
  const random = seeded(seed);
  const seconds = 14;
  const out = new Float32Array(secs(seconds, rate));
  const v: Vowel[] = ['ah', 'aw', 'oh', 'uh', 'eh', 'mm', 'ay'];
  const pick = (): Vowel => v[Math.floor(random() * v.length)] as Vowel;
  // Eight talkers, each in phrases with gaps.
  for (let man = 0; man < 8; man++) {
    const pitch = 92 + 60 * random();
    let t = 1.5 * random();
    while (t < seconds - 0.6) {
      const phrase = 3 + Math.floor(6 * random());
      for (let k = 0; k < phrase && t < seconds - 0.4; k++) {
        const len = 0.09 + 0.14 * random();
        const s = say(
          0,
          len,
          pitch * (0.9 + 0.25 * random()),
          pick(),
          pick(),
          0.9 + 0.2 * random(),
        );
        mixInto(out, syllable(s, rate, random), secs(t, rate), 0.25 + 0.2 * random());
        t += len + 0.03 + 0.06 * random();
      }
      t += 0.5 + 2.2 * random();
    }
  }
  // A laugh.
  for (let k = 0; k < 6; k++) {
    const s = say(0, 0.11, 170 - 8 * k, 'ah', 'ah', 0.9, true);
    mixInto(out, syllable(s, rate, random), secs(6.2 + 0.17 * k, rate), 0.4);
  }
  // Glasses and a chair.
  for (const at of [1.8, 5.1, 9.4, 12.2]) {
    mixInto(out, ping(rate, 2600 + 1800 * random(), 0.09), secs(at, rate), 0.25);
    mixInto(out, ping(rate, 3900 + 1500 * random(), 0.06), secs(at + 0.07, rate), 0.15);
  }
  mixInto(out, groan(rate, random, 0.4, 300, 30, 60), secs(8.1, rate), 0.3);
  mixInto(out, thud(rate, random, 0.2, 110), secs(3.4, rate), 0.3);
  return folded(reverb(lowpass(out, 3200, rate), rate, 0.25, 0.7, 0.5), seconds, rate);
}

/** The saloon's day tune: "The Little Brown Bulls" twice through, 6/8 in eighths. */
export const SALOON_TUNE = { bpm: 276, bars: 20, beatsPerBar: 6 } as const;
export const SALOON_TUNE_S = (SALOON_TUNE.bars * SALOON_TUNE.beatsPerBar * 60) / SALOON_TUNE.bpm;

/**
 * The saloon's concertina playing "The Little Brown Bulls" (traditional, Rickaby 1926;
 * tools/audio/lib/synth-songs.ts) with a guitar vamping under it, twenty bars that loop.
 * Heard through the wall from the street, so it's mixed plain and close.
 */
export function saloonTune(rate: number, seed = 7620): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(SALOON_TUNE_S + 3, rate));
  const { bpm } = SALOON_TUNE;
  const { melody } = littleBrownBullsForm();
  renderMelody(
    out,
    melody,
    bpm,
    0,
    rate,
    (hz, s) => reedNote(hz, s * 0.92, rate, random),
    0.5,
    random,
  );
  littleBrownBullsGuitar(out, bpm, rate, random);
  return folded(reverb(out, rate, 0.14, 0.6, 0.5), SALOON_TUNE_S, rate);
}

/** The island's woods: wind moving through leaves and needles, coming and going. */
export function forestWind(rate: number, seed = 7630): Float32Array {
  const random = seeded(seed);
  const seconds = 18;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const gust = wander(n, 0.18, rate, random);
  const flutter = wander(n, 5, rate, random);
  const leaves = bandpass(noise(n, random), 4200, 0.5, rate);
  const needles = bandpass(noise(n, random), 1700, 0.6, rate);
  const body = lowpass(lowpass(noise(n, random), 380, rate), 380, rate);
  for (let i = 0; i < n; i++) {
    const g = 0.45 + 0.55 * (0.5 + 0.5 * (gust[i] as number));
    const f = 0.8 + 0.2 * (flutter[i] as number);
    out[i] =
      g * g * f * (leaves[i] as number) +
      0.8 * g * (needles[i] as number) +
      1.2 * g * (body[i] as number);
  }
  return out;
}

/**
 * Crickets on a summer night: three of them, each at its own pitch and pace, each a whole
 * number of chirps to the loop so it joins itself.
 */
export function crickets(rate: number, seed = 7640): Float32Array {
  const random = seeded(seed);
  const seconds = 9;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  for (const [hz, perS, level] of [
    [4300, 18 / 9, 1],
    [4750, 24 / 9, 0.6],
    [3900, 15 / 9, 0.4],
  ] as const) {
    const chirpS = 1 / perS;
    const offset = random() * chirpS;
    for (let i = 0; i < n; i++) {
      const t = i / rate + offset;
      const inChirp = (t % chirpS) / chirpS;
      // Three quick pulses, then a rest.
      const pulse = inChirp < 0.36 ? Math.sin(Math.PI * (((inChirp / 0.36) * 3) % 1)) ** 2 : 0;
      out[i] = (out[i] as number) + level * pulse * Math.sin(TAU * hz * t);
    }
  }
  return out;
}
