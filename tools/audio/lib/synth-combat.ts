/**
 * Phase 6 piece G (plan 07 §14.4 row G; plan 15 §4.4, §6.1 "Chase / combat", §11 Phase 6):
 * the combat sounds. The guns heard from your own deck (the bow swivel, the light cannon
 * with its carriage running back, the rifle and its lever), the round in flight (a ball
 * passing, a rifle ball's zip), where it lands (a small splash for a rifle ball, timber
 * stove in, canvas punched through and torn), a steamer's boiler bursting, the grapple and
 * the boarding vignette (the melee, your crew's cheer, her crew's defiance and her crew
 * calling out as she strikes), the chase layer for the music in two stems that loop
 * together (the drums and low strings, then the fiddle and concertina) and the stinger for
 * a ship that strikes. No free recording of a period gun, a boiler or a crowd at sea turned
 * up, so all are synthesized like the law's (tools/audio/lib/synth-law.ts); the voices are
 * formant shouts, so no words, as plan 15 §2 wants. Pure functions over Float32Array,
 * seeded; original, so CC BY 4.0 like the repo's other assets.
 */

import { clang, thud } from './synth-harbor.ts';
import { drumHit, drumRoll, reedChord, shipBell, trimTail } from './synth-chart.ts';
import { rifleShot, syllable, type Syllable } from './synth-law.ts';
import {
  bandpass,
  lowpass,
  mixInto,
  noteHz,
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

// ---------------------------------------------------------------------------------------
// The guns, from your own deck

/**
 * A gun's report close to: a crack, a boom whose pitch falls, the powder's body and a
 * slap back off the water. `boomHz` and the decays set the gun's size.
 */
function report(
  rate: number,
  random: Random,
  seconds: number,
  o: { boomHz: number; boomS: number; bodyHz: number; bodyS: number; crackHz: number },
): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const body = lowpass(lowpass(Float32Array.from(white), o.bodyHz, rate), o.bodyHz, rate);
  const crack = bandpass(white, o.crackHz, 0.5, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * o.boomHz * (1 + 2 * Math.exp(-t / 0.025))) / rate;
    const attack = Math.min(1, t / 0.0006);
    out[i] =
      attack *
      (1.2 * Math.sin(phase) * Math.exp(-t / o.boomS) +
        5 * (body[i] as number) * Math.exp(-t / o.bodyS) +
        1.8 * (crack[i] as number) * Math.exp(-t / 0.01));
  }
  // The smoke rolling out: a soft, low roar after the bang.
  const roll = lowpass(lowpass(Float32Array.from(white), 260, rate), 260, rate);
  const grumble = wander(n, 5, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = smooth((t - 0.05) / 0.15) * Math.exp(-Math.max(0, t - 0.2) / (o.bodyS * 2.2));
    out[i] =
      (out[i] as number) + 3 * env * (roll[i] as number) * (0.6 + 0.4 * (grumble[i] as number));
  }
  // The slap back off the water close by.
  mixInto(out, bandpass(out.slice(0, secs(0.08, rate)), 1400, 0.7, rate), secs(0.07, rate), 0.3);
  return out;
}

/** The bow swivel, from the deck: a sharp, fairly small bang. */
export function swivelGun(rate: number, seed = 1910): Float32Array {
  const random = seeded(seed);
  return report(rate, random, 1.8, {
    boomHz: 78,
    boomS: 0.11,
    bodyHz: 800,
    bodyS: 0.15,
    crackHz: 3400,
  });
}

/**
 * The light cannon, from her own deck: a deep bang, and the carriage running back on its
 * trucks until the breeching rope brings it up short.
 */
export function cannonGun(rate: number, seed = 1911): Float32Array {
  const random = seeded(seed);
  const out = report(rate, random, 3.2, {
    boomHz: 44,
    boomS: 0.28,
    bodyHz: 480,
    bodyS: 0.38,
    crackHz: 2600,
  });
  // The carriage's trucks rumbling back across the deck.
  const n = secs(0.6, rate);
  const rumble = lowpass(noise(n, random), 180, rate);
  const rattle = wander(n, 28, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    rumble[i] =
      (rumble[i] as number) *
      smooth(t / 0.05) *
      (1 - smooth((t - 0.4) / 0.2)) *
      (0.6 + 0.4 * (rattle[i] as number));
  }
  mixInto(out, rumble, secs(0.06, rate), 3);
  // Brought up short by the breeching: a creak of rope and a thump.
  mixInto(out, thud(rate, random, 0.4, 62), secs(0.62, rate), 0.6);
  mixInto(out, ropeCreak(rate, random, 0.3), secs(0.6, rate), 0.25);
  return out;
}

/** A rifle shot close to, then the lever worked: the empty case flicked out, a round in. */
export function rifleNear(rate: number, seed = 1912): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.7, rate));
  mixInto(out, rifleShot(rate, seed), 0, 1);
  const crack = bandpass(noise(secs(0.02, rate), random), 4200, 0.8, rate);
  for (let i = 0; i < crack.length; i++)
    crack[i] = (crack[i] as number) * Math.exp(-i / (0.002 * rate));
  mixInto(out, crack, 0, 1.2);
  // The lever: down (a clack and the case ringing off the deck), then up and locked.
  mixInto(out, tick(rate, random, 2600, 0.5), secs(0.78, rate), 0.8);
  mixInto(out, tick(rate, random, 5200, 0.3), secs(0.86, rate), 0.3);
  mixInto(out, tick(rate, random, 2100, 0.6), secs(1.0, rate), 0.9);
  return out;
}

/** A short metallic tick: a damped tone at `hz` with a click of noise. */
function tick(rate: number, random: Random, hz: number, level = 1): Float32Array {
  const n = secs(0.04, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] =
      level *
      (Math.sin(TAU * hz * t) * Math.exp(-t / 0.005) +
        0.6 * (random() * 2 - 1) * Math.exp(-t / 0.0015));
  }
  return out;
}

/** A rope coming taut and groaning through a block. */
function ropeCreak(rate: number, random: Random, seconds: number): Float32Array {
  const n = secs(seconds, rate);
  const pulses = new Float32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      pulses[i] = 1;
      const hz = 140 + 90 * Math.sin((Math.PI * i) / n);
      next = i + Math.max(1, Math.round((rate / hz) * (0.85 + 0.3 * random())));
    }
  }
  const out = new Float32Array(n);
  mixInto(out, bandpass(pulses, 520, 4, rate), 0, 1);
  mixInto(out, bandpass(pulses, 1150, 5, rate), 0, 0.5);
  for (let i = 0; i < n; i++) out[i] = (out[i] as number) * Math.sin((Math.PI * i) / n);
  return out;
}

// ---------------------------------------------------------------------------------------
// The round in flight

/** Where a fly-by passes closest, seconds into its buffer (the game lines it up). */
export const FLYBY_PASS_S = 0.9;
export const ZIP_PASS_S = 0.12;

/**
 * A round shot passing: a rushing, warbling whistle that swells as it comes, drops in
 * pitch as it goes by (`FLYBY_PASS_S` in) and fades as it goes away.
 */
export function shotFlyby(rate: number, seed = 1913): Float32Array {
  const random = seeded(seed);
  const seconds = 2;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  // The air torn by the ball: two bands whose center falls through the pass.
  const hi = new Float32Array(n);
  const lo = new Float32Array(n);
  const step = secs(0.01, rate);
  for (let i0 = 0; i0 < n; i0 += step) {
    const t = i0 / rate;
    const doppler = 1 + 0.35 * Math.tanh((FLYBY_PASS_S - t) / 0.12);
    const chunk = white.slice(Math.max(0, i0 - 256), Math.min(n, i0 + step));
    const a = bandpass(chunk, 1100 * doppler, 1.6, rate);
    const b = bandpass(chunk, 420 * doppler, 1.1, rate);
    const off = Math.min(256, i0);
    for (let k = 0; k < step && i0 + k < n; k++) {
      hi[i0 + k] = a[off + k] as number;
      lo[i0 + k] = b[off + k] as number;
    }
  }
  // A round ball tumbles: the whistle warbles.
  const warble = wander(n, 9, rate, random);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const d = t - FLYBY_PASS_S;
    const near = 1 / (1 + (d / (d < 0 ? 0.22 : 0.3)) ** 2);
    const doppler = 1 + 0.35 * Math.tanh(-d / 0.12);
    phase += (TAU * 520 * doppler * (1 + 0.03 * (warble[i] as number))) / rate;
    out[i] =
      near *
      (0.9 * (hi[i] as number) + 1.4 * (lo[i] as number) + 0.18 * Math.sin(phase)) *
      (0.8 + 0.2 * (warble[i] as number));
  }
  return out;
}

/** A rifle ball going by close: a short, sharp zip. */
export function ballZip(rate: number, seed = 1914): Float32Array {
  const random = seeded(seed);
  const n = secs(0.45, rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const a = bandpass(white, 3200, 2, rate);
  const b = bandpass(white, 1700, 2, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const d = t - ZIP_PASS_S;
    const env = 1 / (1 + (d / (d < 0 ? 0.035 : 0.06)) ** 2);
    const mix = smooth((t - ZIP_PASS_S + 0.02) / 0.04);
    out[i] = env * ((1 - mix) * (a[i] as number) + mix * (b[i] as number));
  }
  // The snap as it passes.
  mixInto(out, tick(rate, random, 3800, 0.6), secs(ZIP_PASS_S - 0.004, rate), 0.25);
  return out;
}

// ---------------------------------------------------------------------------------------
// Where it lands

/** A rifle ball into the lake: a plip and a little spray. */
export function ballSplash(rate: number, seed = 1915): Float32Array {
  const random = seeded(seed);
  const n = secs(0.7, rate);
  const out = new Float32Array(n);
  const spray = bandpass(noise(n, random), 2600, 1, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = 0.8 * (spray[i] as number) * smooth(t / 0.005) * Math.exp(-t / 0.06);
  }
  // The plip: a quick rising bubble tone.
  let phase = 0;
  for (let i = 0; i < secs(0.08, rate); i++) {
    const t = i / rate;
    phase += (TAU * 900 * (1 + 6 * t)) / rate;
    out[i] = (out[i] as number) + 0.6 * Math.sin(phase) * Math.exp(-t / 0.02);
  }
  for (let t = 0.1; t < 0.5; t += 0.03 + 0.06 * random()) {
    mixInto(out, drip(rate, random), secs(t, rate), 0.15 * Math.exp(-(t - 0.1) / 0.2));
  }
  return out;
}

function drip(rate: number, random: Random): Float32Array {
  const n = secs(0.03, rate);
  const out = new Float32Array(n);
  const f0 = 1100 + 1400 * random();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * f0 * (1 + 5 * t)) / rate;
    out[i] = Math.sin(phase) * Math.exp(-t / 0.008);
  }
  return out;
}

/**
 * A round into her side or her deck: the planking stove in with a deep crunch, timber
 * splitting, splinters flying and bits of her pattering down on deck.
 */
export function hitWood(rate: number, seed = 1916): Float32Array {
  const random = seeded(seed);
  const seconds = 2.1;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  mixInto(out, thud(rate, random, 0.7, 58), 0, 1.1);
  mixInto(out, thud(rate, random, 0.5, 96), secs(0.012, rate), 0.6);
  // Timber splitting: crackle through the wood's resonance, dense then thinning.
  const crackle = new Float32Array(secs(0.5, rate));
  for (let t = 0; t < 0.45; t += 0.0015 + 0.012 * random() * (t / 0.45)) {
    crackle[secs(t, rate)] = (1 - t / 0.5) * (0.5 + 0.5 * random()) * (random() < 0.5 ? -1 : 1);
  }
  mixInto(out, bandpass(crackle, 1100, 1.2, rate), 0, 3);
  mixInto(out, bandpass(crackle, 2400, 1.5, rate), 0, 2);
  // Splinters, and then bits of her coming down.
  for (let t = 0; t < 0.3; t += 0.003 + 0.02 * random()) {
    mixInto(out, splinter(rate, random), secs(t, rate), 0.5 * Math.exp(-t / 0.12));
  }
  for (let t = 0.35; t < 1.6; t += 0.05 + 0.18 * random()) {
    const knock = thud(rate, random, 0.12, 140 + 160 * random());
    mixInto(out, knock, secs(t, rate), 0.14 * Math.exp(-(t - 0.35) / 0.5) * (0.4 + random()));
  }
  return out;
}

function splinter(rate: number, random: Random): Float32Array {
  const n = secs(0.014, rate);
  const f = bandpass(noise(n, random), 1800 + 2800 * random(), 1.2, rate);
  for (let i = 0; i < n; i++) f[i] = (f[i] as number) * Math.exp(-i / (0.003 * rate));
  return f;
}

/**
 * A round through her canvas: a dull punch, the cloth ripping, and the torn sail
 * flogging for a moment in the wind.
 */
export function hitCanvas(rate: number, seed = 1917): Float32Array {
  const random = seeded(seed);
  const seconds = 1.6;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const punch = lowpass(lowpass(Float32Array.from(white), 500, rate), 500, rate);
  const rip = bandpass(white, 1500, 0.8, rate);
  const rough = wander(n, 60, rate, random);
  const flog = bandpass(white, 700, 0.7, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const ripEnv = smooth((t - 0.015) / 0.02) * (1 - smooth((t - 0.2) / 0.25));
    const flap = Math.max(0, Math.sin(TAU * 7.5 * t)) ** 3;
    const flogEnv = smooth((t - 0.25) / 0.1) * Math.exp(-Math.max(0, t - 0.35) / 0.35);
    out[i] =
      5 * (punch[i] as number) * Math.exp(-t / 0.03) +
      1.1 * ripEnv * (rip[i] as number) * Math.max(0, rough[i] as number) +
      0.8 * flogEnv * flap * (flog[i] as number);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The boiler

/**
 * A steamer's boiler bursting (plan 07 §9): a huge, deep blast, the roar of escaping steam
 * that goes on and dies away, iron ringing as it comes apart, wreckage splashing down all
 * round, and the blast rolling back off the shore.
 */
export function boilerBlast(rate: number, seed = 1918): Float32Array {
  const random = seeded(seed);
  const seconds = 7.5;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const white = noise(n, random);
  const body = lowpass(lowpass(Float32Array.from(white), 320, rate), 320, rate);
  const crack = bandpass(white, 2200, 0.5, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * 32 * (1 + 2.4 * Math.exp(-t / 0.05))) / rate;
    const attack = Math.min(1, t / 0.001);
    out[i] =
      attack *
      (1.4 * Math.sin(phase) * Math.exp(-t / 0.5) +
        6 * (body[i] as number) * Math.exp(-t / 0.7) +
        1.6 * (crack[i] as number) * Math.exp(-t / 0.03));
  }
  // Steam: a roar that blows hard and dies away over several seconds, wavering.
  const hiss = bandpass(white, 2600, 0.5, rate);
  const roar = bandpass(white, 900, 0.6, rate);
  const gust = wander(n, 3, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = smooth((t - 0.05) / 0.25) * Math.exp(-Math.max(0, t - 0.6) / 1.9);
    const g = 0.75 + 0.25 * (gust[i] as number);
    out[i] =
      (out[i] as number) + env * g * (0.55 * (hiss[i] as number) + 0.7 * (roar[i] as number));
  }
  // Iron coming apart, and the stack going over.
  for (const [s, hz, g] of [
    [0.08, 140, 0.6],
    [0.3, 260, 0.4],
    [0.55, 95, 0.5],
    [1.4, 210, 0.3],
  ] as const) {
    mixInto(out, clang(rate, random, hz, 1), secs(s, rate), g);
  }
  // Wreckage falling back into the lake.
  for (let t = 1.1; t < 4.8; t += 0.06 + 0.35 * random()) {
    const big = random() < 0.25;
    const sp = big ? debrisSplash(rate, random, 0.5) : debrisSplash(rate, random, 0.2);
    mixInto(out, sp, secs(t, rate), (big ? 0.35 : 0.18) * Math.exp(-(t - 1.1) / 2.2));
  }
  // The blast coming back off the shore.
  for (const [s, g] of [
    [0.6, 0.3],
    [1.3, 0.18],
    [2.2, 0.1],
  ] as const) {
    mixInto(out, lowpass(out.slice(0, secs(0.8, rate)), 500, rate), secs(s, rate), g);
  }
  return out;
}

/** A piece of wreckage hitting the water: a thump and a burst of spray. */
function debrisSplash(rate: number, random: Random, seconds: number): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const spray = bandpass(noise(n, random), 1200 + 800 * random(), 0.8, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = (spray[i] as number) * smooth(t / 0.01) * Math.exp(-t / (seconds / 3));
  }
  mixInto(out, thud(rate, random, Math.min(0.3, seconds), 70 + 60 * random()), 0, 0.4);
  return out;
}

// ---------------------------------------------------------------------------------------
// Alongside: the grapple and the boarding vignette

/**
 * The grapple: the hook whirled and thrown, iron biting on her rail, the line hauled taut
 * through a block, and the two hulls grinding together.
 */
export function grapple(rate: number, seed = 1919): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.6, rate));
  const at = (s: number): number => secs(s, rate);
  // Two swings of the hook and the throw.
  const swingN = at(0.9);
  const swing = bandpass(noise(swingN, random), 700, 1.2, rate);
  for (let i = 0; i < swingN; i++) {
    const t = i / rate;
    swing[i] = (swing[i] as number) * Math.max(0, Math.sin(TAU * 3.2 * t)) ** 2 * smooth(t / 0.1);
  }
  mixInto(out, swing, 0, 0.5);
  // It bites: iron on wood and iron.
  mixInto(out, clang(rate, random, 520, 0.7).slice(0, at(0.5)), at(1.05), 0.6);
  mixInto(out, thud(rate, random, 0.3, 120), at(1.05), 0.5);
  // Hauled taut.
  mixInto(out, ropeCreak(rate, random, 0.7), at(1.5), 0.45);
  mixInto(out, ropeCreak(rate, random, 0.5), at(2.15), 0.35);
  // The hulls come together: two bumps and a grinding of wood.
  mixInto(out, thud(rate, random, 0.6, 52), at(2.4), 1);
  mixInto(out, thud(rate, random, 0.5, 60), at(2.95), 0.7);
  const grindN = at(0.9);
  const grind = bandpass(noise(grindN, random), 350, 1, rate);
  const judder = wander(grindN, 22, rate, random);
  for (let i = 0; i < grindN; i++) {
    const t = i / rate;
    grind[i] =
      (grind[i] as number) * Math.sin((Math.PI * t) / 0.9) * (0.5 + 0.5 * (judder[i] as number));
  }
  mixInto(out, grind, at(2.45), 0.9);
  return out;
}

/** Formants of a man's shouted vowels, Hz. */
const VOWEL = {
  ah: [730, 1090, 2440],
  aw: [570, 840, 2410],
  oh: [500, 900, 2400],
  uh: [640, 1190, 2390],
  eh: [530, 1840, 2480],
  oo: [380, 950, 2300],
  ay: [480, 2000, 2600],
} as const satisfies Record<string, readonly number[]>;
type Vowel = keyof typeof VOWEL;

/** A shout by one man: one or two syllables on `pitch`, from `from` to `to`. */
function shout(
  atS: number,
  seconds: number,
  pitch: number,
  from: Vowel,
  to: Vowel,
  glide = 1,
  burst = false,
): Syllable {
  return {
    atS,
    seconds,
    f0: [pitch, pitch * glide],
    formants: [VOWEL[from], VOWEL[to]],
    burst,
  };
}

/** Renders shouts into `out`, each its own voice, at `gain`. */
function voices(
  out: Float32Array,
  shouts: readonly Syllable[],
  rate: number,
  random: Random,
  gain: number,
): void {
  for (const s of shouts) {
    mixInto(out, syllable(s, rate, random), secs(s.atS, rate), gain * (0.7 + 0.3 * random()));
  }
}

/**
 * The boarding fight, as the panel's vignette: men shouting, wood and iron (handspikes,
 * cutlasses, belaying pins) clashing, a pistol or two, feet on the deck.
 */
export function boardingFight(rate: number, seed = 1920): Float32Array {
  const random = seeded(seed);
  const seconds = 4.6;
  const out = new Float32Array(secs(seconds, rate));
  const vowels: Vowel[] = ['ah', 'aw', 'uh', 'eh', 'oh'];
  const pick = (): Vowel => vowels[Math.floor(random() * vowels.length)] as Vowel;
  const shouts: Syllable[] = [];
  for (let t = 0; t < seconds - 0.6; t += 0.08 + 0.22 * random()) {
    const pitch = 115 + 90 * random();
    shouts.push(
      shout(t, 0.2 + 0.35 * random(), pitch, pick(), pick(), 0.8 + 0.35 * random(), random() < 0.3),
    );
  }
  voices(out, shouts, rate, random, 0.35);
  // Blows: handspikes and pins on wood, and steel.
  for (let t = 0.2; t < seconds - 0.5; t += 0.12 + 0.3 * random()) {
    if (random() < 0.45) {
      mixInto(
        out,
        clang(rate, random, 700 + 600 * random(), 0.6).slice(0, secs(0.25, rate)),
        secs(t, rate),
        0.3,
      );
    } else {
      mixInto(out, thud(rate, random, 0.15, 150 + 150 * random()), secs(t, rate), 0.4);
    }
  }
  // Feet on the deck.
  for (let t = 0; t < seconds - 0.3; t += 0.09 + 0.12 * random()) {
    mixInto(out, thud(rate, random, 0.1, 80 + 40 * random()), secs(t, rate), 0.12 + 0.1 * random());
  }
  // Pistols.
  for (const [s, r] of [
    [0.9, 1.1],
    [2.6, 1.25],
  ] as const) {
    mixInto(out, stretched(rifleShot(rate, 1880 + Math.round(s * 10)), r), secs(s, rate), 0.6);
  }
  fade(out, rate, 0.15, 0.6);
  return out;
}

/**
 * Your crew's cheer as her deck is carried or her master gives in: "Huzzah!" three
 * times, ragged, a dozen voices.
 */
export function crewCheer(rate: number, seed = 1921): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.2, rate));
  const shouts: Syllable[] = [];
  for (const [t0, lift] of [
    [0, 1],
    [0.9, 1.04],
    [1.8, 1.08],
  ] as const) {
    for (let v = 0; v < 7; v++) {
      const at = t0 + 0.07 * random();
      const pitch = (130 + 70 * random()) * lift;
      shouts.push(shout(at, 0.12, pitch * 0.9, 'uh', 'uh', 1.05));
      shouts.push(shout(at + 0.15, 0.42 + 0.15 * random(), pitch * 1.15, 'ah', 'aw', 0.9));
    }
  }
  voices(out, shouts, rate, random, 0.3);
  return trimTail(reverb(out, rate, 0.12, 0.5), rate);
}

/**
 * Her crew as she strikes: men calling out to hold fire, one after another, and her bell
 * rung fast (plan 15 §4.4's surrender bell or hail).
 */
export function crewStrike(rate: number, seed = 1922): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.4, rate));
  const shouts: Syllable[] = [];
  // "Hold! Hold!", "Avast!": long falling calls, overlapping.
  for (const [t, pitch, a, b] of [
    [0, 175, 'oh', 'oh'],
    [0.45, 150, 'oh', 'oo'],
    [0.7, 205, 'ah', 'ah'],
    [1.15, 165, 'oh', 'oh'],
    [1.5, 140, 'ay', 'eh'],
    [1.9, 190, 'oh', 'oo'],
  ] as const) {
    shouts.push(shout(t, 0.45 + 0.2 * random(), pitch, a, b, 0.78));
  }
  voices(out, shouts, rate, random, 0.45);
  for (let k = 0; k < 7; k++) {
    mixInto(out, shipBell(rate, random, 880, 1.2), secs(0.3 + k * 0.22, rate), 0.22);
  }
  return out;
}

/**
 * Her crew won't strike: a rough shout of defiance together, twice, and handspikes rapped
 * on the rail.
 */
export function crewDefiant(rate: number, seed = 1923): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.6, rate));
  const shouts: Syllable[] = [];
  for (const t0 of [0.1, 1.05]) {
    for (let v = 0; v < 6; v++) {
      shouts.push(shout(t0 + 0.05 * random(), 0.38, 95 + 45 * random(), 'ah', 'uh', 0.85, true));
    }
  }
  voices(out, shouts, rate, random, 0.35);
  for (let t = 0.55; t < 2.3; t += 0.16 + 0.06 * random()) {
    mixInto(out, thud(rate, random, 0.12, 170 + 60 * random()), secs(t, rate), 0.45);
  }
  return out;
}

/** A buffer played faster (and higher) by `ratio`, linear interpolation. */
function stretched(x: Float32Array, ratio: number): Float32Array {
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const k = Math.floor(p);
    const f = p - k;
    out[i] = (x[k] as number) * (1 - f) + ((x[k + 1] ?? 0) as number) * f;
  }
  return out;
}

function fade(x: Float32Array, rate: number, inS: number, outS: number): void {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    x[i] = (x[i] as number) * smooth(t / inS) * smooth((n / rate - t) / outS);
  }
}

// ---------------------------------------------------------------------------------------
// The chase layer (plan 15 §6.1 "Chase / combat": urgent percussion and fiddle)

/**
 * "Hard Alee": a 16-bar loop in D dorian, 4/4 at 138, rendered as two stems the game loops
 * together. The drums stem (frame drum, a low drum, low strings pulsing on the root) is the
 * tension layer; the fiddle stem (a reel-like fiddle tune with concertina stabs on the
 * off-beats) comes in on top when the guns are going.
 */
export const CHASE = { bpm: 138, bars: 16, beatsPerBar: 4 } as const;

/** The chords, bar by bar; the last bar's A leads back round to the first. */
export const CHASE_CHORDS = [
  'Dm',
  'Dm',
  'C',
  'C',
  'Dm',
  'Dm',
  'Bb',
  'A',
  'Dm',
  'Dm',
  'C',
  'C',
  'Bb',
  'C',
  'Dm',
  'A',
] as const;

const CHORD_NOTES: Record<(typeof CHASE_CHORDS)[number], { root: string; tones: string[] }> = {
  Dm: { root: 'D2', tones: ['D4', 'F4', 'A4'] },
  C: { root: 'C2', tones: ['C4', 'E4', 'G4'] },
  Bb: { root: 'Bb1', tones: ['Bb3', 'D4', 'F4'] },
  A: { root: 'A1', tones: ['A3', 'C#4', 'E4'] },
};

/** The fiddle's tune, in eighth notes ([pitch, eighths]), eight to a bar. */
export const CHASE_TUNE: readonly Note[] = [
  // A: up and driving.
  ['A4', 1],
  ['D5', 1],
  ['D5', 1],
  ['E5', 1],
  ['F5', 1],
  ['E5', 1],
  ['D5', 1],
  ['C5', 1],
  ['A4', 1],
  ['D5', 1],
  ['D5', 1],
  ['E5', 1],
  ['F5', 1],
  ['G5', 1],
  ['A5', 1],
  ['F5', 1],
  ['G5', 1],
  ['E5', 1],
  ['C5', 1],
  ['E5', 1],
  ['G5', 1],
  ['E5', 1],
  ['C5', 1],
  ['E5', 1],
  ['G5', 1],
  ['A5', 1],
  ['G5', 1],
  ['F5', 1],
  ['E5', 1],
  ['C5', 1],
  ['D5', 1],
  ['E5', 1],
  ['F5', 1],
  ['D5', 1],
  ['A4', 1],
  ['D5', 1],
  ['F5', 1],
  ['D5', 1],
  ['A4', 1],
  ['D5', 1],
  ['F5', 1],
  ['G5', 1],
  ['A5', 1],
  ['G5', 1],
  ['F5', 1],
  ['E5', 1],
  ['D5', 1],
  ['F5', 1],
  ['F5', 1],
  ['D5', 1],
  ['Bb4', 1],
  ['D5', 1],
  ['F5', 1],
  ['D5', 1],
  ['Bb4', 1],
  ['D5', 1],
  ['E5', 1],
  ['C#5', 1],
  ['A4', 1],
  ['C#5', 1],
  ['E5', 1],
  ['F5', 1],
  ['E5', 1],
  ['C#5', 1],
  // B: higher, then running home.
  ['D5', 2],
  ['A5', 2],
  ['F5', 1],
  ['E5', 1],
  ['D5', 1],
  ['C5', 1],
  ['D5', 1],
  ['E5', 1],
  ['F5', 1],
  ['G5', 1],
  ['A5', 2],
  ['D6', 2],
  ['C6', 2],
  ['G5', 1],
  ['E5', 1],
  ['C5', 1],
  ['E5', 1],
  ['G5', 2],
  ['A5', 1],
  ['G5', 1],
  ['E5', 1],
  ['G5', 1],
  ['C6', 2],
  ['G5', 2],
  ['F5', 1],
  ['D5', 1],
  ['Bb4', 1],
  ['D5', 1],
  ['F5', 1],
  ['Bb5', 1],
  ['A5', 1],
  ['G5', 1],
  ['E5', 1],
  ['C5', 1],
  ['G4', 1],
  ['C5', 1],
  ['E5', 1],
  ['G5', 1],
  ['F5', 1],
  ['E5', 1],
  ['D5', 1],
  ['F5', 1],
  ['A5', 1],
  ['F5', 1],
  ['D5', 1],
  ['A4', 1],
  ['D5', 1],
  ['E5', 1],
  ['C#5', 1],
  ['E5', 1],
  ['A5', 2],
  ['G5', 1],
  ['F5', 1],
  ['E5', 1],
  ['C#5', 1],
];

/** Seconds of one pass of the loop. */
export const CHASE_LOOP_S = (CHASE.bars * CHASE.beatsPerBar * 60) / CHASE.bpm;

/**
 * A bowed string note (fiddle, or low strings an octave or two down): a bright sawtooth
 * with a quick bite, vibrato on longer notes, a little bow noise. Unfiltered: the body's
 * resonances go on the whole stem at once (`stringBody`).
 */
export function bowedNote(
  hz: number,
  seconds: number,
  rate: number,
  random: Random,
  vibrato = true,
): Float32Array {
  const release = 0.06;
  const n = secs(seconds + release, rate);
  const out = new Float32Array(n);
  const maxH = Math.max(1, Math.floor(7000 / hz));
  let phase = random() * TAU;
  const vibHz = 5.6 + random() * 0.6;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const vib = vibrato ? 0.005 * smooth((t - 0.12) / 0.15) * Math.sin(TAU * vibHz * t) : 0;
    phase += (TAU * hz * (1 + vib)) / rate;
    let s = 0;
    for (let h = 1; h <= maxH; h++) s += Math.sin(h * phase) / h;
    const attack = smooth(t / 0.012);
    const bite = 1 + 0.5 * Math.exp(-t / 0.03);
    const rel = 1 - smooth((t - seconds) / release);
    out[i] =
      s * attack * bite * rel * (0.85 + 0.15 * Math.exp(-t / 0.2)) +
      0.04 * (random() * 2 - 1) * attack * rel;
  }
  return out;
}

/** A string body over a raw stem: a few resonances (lower for the low strings). */
function stringBody(raw: Float32Array, rate: number, low = false): Float32Array {
  const out = new Float32Array(raw.length);
  const bands: readonly (readonly [number, number, number])[] = low
    ? [
        [110, 1.5, 1],
        [220, 2, 0.8],
        [520, 1.5, 0.5],
        [1400, 1.2, 0.25],
      ]
    : [
        [290, 2, 0.8],
        [470, 2.5, 0.8],
        [1000, 1.5, 0.6],
        [2800, 1.2, 0.5],
      ];
  for (const [hz, q, g] of bands) mixInto(out, bandpass(raw, hz, q, rate), 0, g);
  return out;
}

/** Folds what rings past the loop's end back onto its start, so the loop is seamless. */
function wrapLoop(x: Float32Array, loopN: number): Float32Array {
  const out = x.slice(0, loopN);
  for (let i = loopN; i < x.length; i++) {
    const j = (i - loopN) % loopN;
    out[j] = (out[j] as number) + (x[i] as number);
  }
  return out;
}

export type ChaseStem = 'drums' | 'fiddle';

/** One stem of the chase loop, exactly `CHASE_LOOP_S` long and seamless. */
export function chaseStem(stem: ChaseStem, rate: number, seed = 1934): Float32Array {
  const random = seeded(seed + (stem === 'drums' ? 0 : 1));
  const beatS = 60 / CHASE.bpm;
  const eighthS = beatS / 2;
  const barS = beatS * CHASE.beatsPerBar;
  const loopN = secs(CHASE_LOOP_S, rate);
  const out = new Float32Array(loopN + secs(3.5, rate));
  const at = (s: number): number => secs(s, rate);
  if (stem === 'drums') {
    // The frame drum: eighths, accents on one and three and the off-beats of two and four,
    // a triplet on four every other bar, and a roll into the turn at bars 8 and 16.
    const accents = [1, 0.35, 0.5, 0.75, 0.9, 0.35, 0.5, 0.75];
    const lowDrum = [0, 3, 4];
    CHASE_CHORDS.forEach((_, bar) => {
      const t0 = bar * barS;
      const turn = bar === 7 || bar === 15;
      for (let k = 0; k < 8; k++) {
        if (turn && k >= 4) break;
        const late = (random() - 0.5) * 0.008;
        const level = (accents[k] as number) * (0.85 + 0.15 * random());
        const pitch = k % 2 === 0 ? 96 : 118;
        if (k === 6 && bar % 2 === 1) {
          for (let s = 0; s < 3; s++) {
            mixInto(
              out,
              drumHit(rate, random, 0.45, 120),
              at(t0 + k * eighthS + (s * eighthS * 2) / 3 + late),
              0.7,
            );
          }
          continue;
        }
        mixInto(out, drumHit(rate, random, level, pitch), at(t0 + k * eighthS + late), 0.7);
      }
      for (const k of lowDrum) {
        mixInto(out, drumHit(rate, random, 1, 58), at(t0 + k * eighthS), 0.9);
      }
      if (turn) {
        mixInto(
          out,
          drumRoll(rate, random, 2 * beatS, eighthS / 3, (t) => 0.4 + 0.6 * t, 104),
          at(t0 + 2 * beatS),
          0.6,
        );
      }
    });
    // Low strings: the root pulsing in eighths, pushing on the last two of each bar.
    const raw = new Float32Array(out.length);
    CHASE_CHORDS.forEach((name, bar) => {
      const root = noteHz(CHORD_NOTES[name].root);
      for (let k = 0; k < 8; k++) {
        const hz = k >= 6 ? root * 2 : root;
        const note = bowedNote(hz, eighthS * 0.7, rate, random, false);
        mixInto(raw, note, at(bar * barS + k * eighthS), k % 4 === 0 ? 1 : 0.7);
      }
    });
    mixInto(out, lowpass(stringBody(raw, rate, true), 1800, rate), 0, 0.5);
    return wrapLoop(reverb(out, rate, 0.12, 0.6), loopN);
  }
  // The fiddle: the tune, eighth notes at twice the tempo.
  const raw = new Float32Array(out.length);
  renderMelody(
    raw,
    CHASE_TUNE,
    CHASE.bpm * 2,
    0,
    rate,
    (hz, s) => bowedNote(hz, s * 0.92, rate, random, s > eighthS * 1.5),
    1,
    random,
  );
  mixInto(out, stringBody(raw, rate), 0, 0.35);
  // Concertina stabs on two and four.
  CHASE_CHORDS.forEach((name, bar) => {
    for (const beat of [1, 3]) {
      mixInto(
        out,
        reedChord(CHORD_NOTES[name].tones, eighthS * 0.8, rate, random),
        at(bar * barS + beat * beatS),
        0.55,
      );
    }
  });
  return wrapLoop(reverb(out, rate, 0.15, 0.65), loopN);
}

/**
 * She strikes: the chase's tune runs up and resolves onto a bright D major (a Picardy
 * third after all that minor), the drum's last stroke, a held chord.
 */
export function struckStinger(rate: number, seed = 1935): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(5, rate));
  const beatS = 60 / CHASE.bpm;
  const raw = new Float32Array(out.length);
  const run: Note[] = [
    ['A4', 1],
    ['D5', 1],
    ['E5', 1],
    ['F#5', 1],
    ['A5', 2],
    ['D6', 8],
  ];
  renderMelody(
    raw,
    run,
    CHASE.bpm * 2,
    0,
    rate,
    (hz, s) => bowedNote(hz, s * 0.95, rate, random, s > beatS),
    1,
    random,
  );
  mixInto(out, stringBody(raw, rate), 0, 0.35);
  mixInto(out, drumHit(rate, random, 1, 58), secs(3 * beatS, rate), 0.9);
  mixInto(out, drumHit(rate, random, 0.8, 96), secs(3 * beatS, rate), 0.6);
  mixInto(out, reedChord(['D4', 'F#4', 'A4', 'D5'], 2.4, rate, random), secs(3 * beatS, rate), 0.8);
  mixInto(out, reedNote(noteHz('D3'), 2.4, rate, random), secs(3 * beatS, rate), 0.5);
  return trimTail(reverb(out, rate, 0.25, 0.78), rate);
}
