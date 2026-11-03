/**
 * Phase 4 piece J (plan 15 §4.1 "Docks at day", §11): the harbor work sounds no free
 * library had. A steam sawmill's head saw taking one cut through a log, and an ore car
 * dumping into an ore dock's pocket. Pure functions over Float32Array, seeded like the
 * rest of tools/audio/lib/synth.ts; original, so CC BY 4.0 like the repo's other assets.
 * The hammering, the coins and the ledger are CC0 recordings instead (CREDITS.md).
 */

import { bandpass, lowpass, mixInto, seeded, wander, type Random } from './synth.ts';

const TAU = Math.PI * 2;

const smooth = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/** The head saw's tooth-passing frequency at full speed, Hz (a 60-inch saw, ~700 rpm). */
export const SAW_TOOTH_HZ = 560;

/** The phases of one cut, seconds from the start of the sound. */
export const SAW_CUT = { biteS: 0.9, throughS: 5.2, dropS: 6.1, seconds: 7.5 } as const;

/**
 * One cut of a steam sawmill's circular head saw, as heard across the water: the blade
 * idling with a thin whine, the log carriage feeding it in (the whine sags in pitch under
 * load and a harsh scream of sawdust and teeth comes up), the saw running free again as
 * the board falls away, and the slab dropping onto the rolls.
 */
export function millSaw(rate: number, seed = 1880): Float32Array {
  const random = seeded(seed);
  const { biteS, throughS, dropS, seconds } = SAW_CUT;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const scream = bandpass(white, 2600, 1.4, rate);
  const grind = bandpass(white, 900, 0.8, rate);
  const flutter = wander(n, 9, rate, random);
  const drift = wander(n, 0.7, rate, random);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // Load: 0 idling, 1 deep in the log.
    const load = smooth((t - biteS) / 0.35) * (1 - smooth((t - throughS) / 0.5));
    // Steam governor: the saw slows about 12% in the cut and picks up again after.
    const speed = 1 - 0.12 * load + 0.01 * (drift[i] as number);
    phase += (TAU * SAW_TOOTH_HZ * speed) / rate;
    const whine =
      Math.sin(phase) + 0.5 * Math.sin(2 * phase + 0.4) + 0.25 * Math.sin(3 * phase + 1.1);
    const fade = smooth(t / 0.3) * (1 - smooth((t - (seconds - 0.8)) / 0.8));
    const wobble = 1 + 0.25 * load * (flutter[i] as number);
    out[i] =
      fade *
      (0.12 * (1 + 1.6 * load) * whine * wobble +
        0.55 * load * wobble * (scream[i] as number) +
        0.35 * load * (grind[i] as number));
  }
  mixInto(out, thud(rate, random, 0.5, 70), Math.round(dropS * rate), 0.7);
  return out;
}

/** A heavy wooden thud: a low knock that dies fast, with a little splintery noise. */
function thud(rate: number, random: Random, seconds: number, hz: number): Float32Array {
  const n = Math.round(seconds * rate);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const knock = bandpass(white, 400, 1, rate);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    phase += (TAU * hz * (1 + 0.5 * Math.exp(-t / 0.02))) / rate;
    out[i] =
      Math.sin(phase) * Math.exp(-t / 0.09) + 0.6 * (knock[i] as number) * Math.exp(-t / 0.03);
  }
  return out;
}

/** Inharmonic partials of a struck steel plate: ratio to the lowest, and decay seconds. */
const PLATE: readonly [number, number, number][] = [
  [1, 1, 0.7],
  [2.27, 0.7, 0.5],
  [3.81, 0.5, 0.35],
  [6.2, 0.35, 0.22],
  [8.9, 0.2, 0.15],
];

/** The clang of an ore car's hopper door swinging open or banging shut. */
export function clang(rate: number, random: Random, baseHz = 180, level = 1): Float32Array {
  const seconds = 1.2;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const hit = bandpass(white, 3000, 0.7, rate);
  for (const [ratio, amp, decay] of PLATE) {
    const f = baseHz * ratio * (1 + (random() - 0.5) * 0.02);
    const p0 = random() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      out[i] = (out[i] as number) + amp * Math.sin(p0 + TAU * f * t) * Math.exp(-t / decay);
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = level * (0.4 * (out[i] as number) + 0.8 * (hit[i] as number) * Math.exp(-t / 0.01));
  }
  return out;
}

/** The phases of one dump, seconds from the start. */
export const ORE_DUMP = { rushS: 0.25, holdS: 2.8, shutS: 5.1, seconds: 6.5 } as const;

/**
 * An ore car dumping into an ore dock's pocket: the hopper door clangs open, the ore
 * rushes and rattles down into the pocket (a dense rain of rock on steel over a deep roar
 * of the trestle taking the load), trails off, and the door is banged shut.
 */
export function oreDump(rate: number, seed = 1892): Float32Array {
  const random = seeded(seed);
  const { rushS, holdS, shutS, seconds } = ORE_DUMP;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  mixInto(out, clang(rate, random, 175, 1), 0, 0.8);

  // The rush: brown-ish noise for the roar, band-passed noise for the rattle.
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const roar = lowpass(Float32Array.from(white), 140, rate);
  const rattle = bandpass(white, 1800, 0.6, rate);
  const surge = wander(n, 3, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = smooth((t - rushS) / 0.35) * (1 - smooth((t - holdS) / 1.8));
    const s = 1 + 0.3 * (surge[i] as number);
    out[i] =
      (out[i] as number) + env * s * (6 * (roar[i] as number) + 0.35 * (rattle[i] as number));
  }
  // Rocks: short bright ticks, thick in the rush and thinning as it trails off.
  for (let t = rushS; t < holdS + 1.6;) {
    const env = smooth((t - rushS) / 0.35) * (1 - smooth((t - holdS) / 1.6));
    t += 0.004 + 0.03 * random() * (1.2 - env);
    mixInto(out, rock(rate, random), Math.round(t * rate), 0.25 * env * (0.4 + random()));
  }
  mixInto(out, clang(rate, random, 168, 0.9), Math.round(shutS * rate), 0.8);
  return out;
}

/** One lump of ore striking steel: a short damped ping. */
function rock(rate: number, random: Random): Float32Array {
  const n = Math.round(0.03 * rate);
  const out = new Float32Array(n);
  const f = 1200 + 2600 * random();
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] =
      Math.sin(TAU * f * t) * Math.exp(-t / 0.006) + (random() * 2 - 1) * Math.exp(-t / 0.002);
  }
  return out;
}
