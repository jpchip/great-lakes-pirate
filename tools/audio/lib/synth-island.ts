/**
 * Phase 9 piece Y (plan 11 §18.4 row Y; plan 15 §4.1, §4.5, §11 Phase 9): the islands' sounds.
 * Songbirds and a woodpecker in spring and summer; a creek over stones on the bigger islands;
 * surf on the rock islands; the drips, the echo and the surge of a sea cave; a deer's snort
 * and its bounds through brush; a bear's huff and growl; a wolf's howl; the grapple going down
 * and coming up; a spade in the ground; and the ending's slow air. Synthesized like the earlier
 * sets: pure functions over Float32Array, seeded, original, so CC BY 4.0 like the repo's other
 * assets.
 */

import {
  bandpass,
  lowpass,
  mixInto,
  peak,
  reverb,
  seeded,
  wander,
  type Note,
  type Random,
} from './synth.ts';

const TAU = Math.PI * 2;

/** Seconds to samples. */
function secs(seconds: number, rate: number): number {
  return Math.round(seconds * rate);
}

/** A sine with its phase kept, frequency given per sample. */
function glide(n: number, hzAt: (t: number) => number, rate: number): Float32Array {
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (TAU * hzAt(i / rate)) / rate;
    out[i] = Math.sin(phase);
  }
  return out;
}

/** An envelope: attack, then exponential decay with time constant `tau`. */
function pluck(n: number, rate: number, attackS: number, tauS: number): Float32Array {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    e[i] = Math.min(1, t / Math.max(attackS, 1e-4)) * Math.exp(-t / tauS);
  }
  return e;
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] as number) * (b[i] as number);
  return out;
}

function whiteNoise(n: number, random: Random): Float32Array {
  return Float32Array.from({ length: n }, () => random() * 2 - 1);
}

/** Crossfade a sample's tail into its head so it loops without a seam. */
function loopable(x: Float32Array, rate: number, crossfadeS: number): Float32Array {
  const f = Math.min(secs(crossfadeS, rate), x.length >> 1);
  const out = Float32Array.from(x);
  for (let i = 0; i < f; i++) {
    const a = i / f;
    const head = out[i] as number;
    const tail = x[x.length - f + i] as number;
    out[i] = head * a + tail * (1 - a);
  }
  return out.subarray(0, x.length - f);
}

// ---------------------------------------------------------------------------------------
// Birds, the creek and the surf: the beds.

/** One songbird phrase: a few notes sweeping up and down a fixed interval. */
function phrase(random: Random, rate: number): Float32Array {
  const notes = 2 + Math.floor(random() * 4);
  const parts: Float32Array[] = [];
  const base = 2300 + random() * 1600;
  for (let k = 0; k < notes; k++) {
    const len = secs(0.05 + random() * 0.07, rate);
    const up = random() < 0.6;
    const hz = base * (0.9 + random() * 0.25) * (k % 2 === 0 ? 1 : up ? 1.2 : 0.85);
    const sweep = (random() - 0.5) * 0.4;
    const s = glide(len, (t) => hz * (1 + sweep * (t / (len / rate))), rate);
    const env = pluck(len, rate, 0.006, 0.05);
    parts.push(multiply(s, env));
    parts.push(new Float32Array(secs(0.02 + random() * 0.05, rate)));
  }
  const n = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Float32Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Songbirds in a birch wood (a 24 s loop): a few singers, each phrase at its own place and
 * time, with long silences between, and a trill or two.
 */
export function islandBirds(rate: number, seconds = 24, seed = 9900): Float32Array {
  const random = seeded(seed);
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const count = 9 + Math.floor(random() * 3);
  for (let i = 0; i < count; i++) {
    const at = Math.floor(random() * (n - secs(1.2, rate)));
    const p = phrase(random, rate);
    const gain = 0.18 + random() * 0.22;
    // A few trills: the same phrase three times over.
    const repeats = random() < 0.3 ? 3 : 1;
    let t = at;
    for (let r = 0; r < repeats; r++) {
      mixInto(out, p, t, gain * (0.85 + random() * 0.3));
      t += p.length + secs(0.08 + random() * 0.1, rate);
    }
  }
  return loopable(reverb(out, rate, 0.12, 0.45, 0.5).subarray(0, n), rate, 1.5);
}

/** A woodpecker drumming on a dead trunk: a fast rattle of knocks, a little ring. */
export function woodpecker(rate: number, random: Random = seeded(9901)): Float32Array {
  const seconds = 2.2;
  const out = new Float32Array(secs(seconds, rate));
  const knocks = 8 + Math.floor(random() * 4);
  const gap = 0.085;
  for (let k = 0; k < knocks; k++) {
    const at = secs(0.1 + k * gap * (0.94 + random() * 0.12), rate);
    const len = secs(0.09, rate);
    const burst = bandpass(whiteNoise(len, random), 2100 + random() * 300, 6, rate);
    const ring = multiply(
      glide(len, () => 2400, rate),
      pluck(len, rate, 0.001, 0.02),
    );
    const hit = new Float32Array(len);
    for (let i = 0; i < len; i++) hit[i] = (burst[i] as number) * 1.4 + (ring[i] as number) * 0.3;
    mixInto(out, hit, at, 0.6 + random() * 0.3);
  }
  return reverb(out, rate, 0.1, 0.3, 0.6);
}

/** A creek over stones (a 20 s loop): the water's wash, and bubbles popping on top. */
export function creek(rate: number, seconds = 20, seed = 9910): Float32Array {
  const random = seeded(seed);
  const n = secs(seconds, rate);
  const wash = bandpass(whiteNoise(n, random), 1700, 0.7, rate);
  const swell = wander(n, 0.31, rate, random);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (wash[i] as number) * (0.55 + 0.25 * (swell[i] as number));
  // Bubbles: a falling chirp each, a few dozen a loop.
  for (let k = 0; k < 40; k++) {
    const len = secs(0.035 + random() * 0.03, rate);
    const top = 900 + random() * 900;
    const b = multiply(
      glide(len, (t) => top * (1 - 0.45 * (t / (len / rate))), rate),
      pluck(len, rate, 0.002, 0.012),
    );
    mixInto(out, b, Math.floor(random() * (n - len)), 0.05 + random() * 0.06);
  }
  return loopable(out, rate, 1.5);
}

/** Surf on a rock island (a 14 s loop): a low wash that swells and drains, a hiss on top. */
export function surf(rate: number, seconds = 14, seed = 9920): Float32Array {
  const random = seeded(seed);
  const n = secs(seconds, rate);
  const body = lowpass(whiteNoise(n, random), 520, rate);
  const hiss = bandpass(whiteNoise(n, random), 3200, 0.6, rate);
  const swell = wander(n, 0.09, rate, random);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = 0.5 + 0.5 * Math.sin((TAU * i) / (n / 2));
    out[i] =
      (body[i] as number) * (0.6 + 0.4 * s) * (1 + 0.5 * (swell[i] as number)) +
      (hiss[i] as number) * 0.08 * s;
  }
  return loopable(out, rate, 1.5);
}

// ---------------------------------------------------------------------------------------
// The sea cave: the room's hush, the drips and the surge.

/** A cave's hush (a 16 s loop): very low air, the echo of the surf far in, the room's ring. */
export function caveRoom(rate: number, seconds = 16, seed = 9930): Float32Array {
  const random = seeded(seed);
  const n = secs(seconds, rate);
  const air = lowpass(whiteNoise(n, random), 260, rate);
  const swell = wander(n, 0.07, rate, random);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (air[i] as number) * (0.35 + 0.2 * (swell[i] as number));
  mixInto(
    out,
    reverb(lowpass(whiteNoise(secs(0.5, rate), random), 700, rate), rate, 0.9, 0.9, 0.3),
    secs(4, rate),
    0.04,
  );
  return loopable(reverb(out, rate, 0.4, 0.9, 0.35).subarray(0, n), rate, 1.5);
}

/** A drip into a pool in a cave: a falling pitch, a ring, and a long echo. */
export function caveDrip(variant: number, rate: number): Float32Array {
  const len = secs(0.5, rate);
  const top = variant === 1 ? 1750 : 1480;
  const body = multiply(
    glide(len, (t) => top * Math.exp(-t * 9), rate),
    pluck(len, rate, 0.002, 0.11),
  );
  const out = new Float32Array(secs(2.2, rate));
  mixInto(out, body, 0, 1);
  mixInto(out, reverb(body, rate, 0.9, 0.95, 0.25), 0, 0.5);
  return trimmed(reverb(out, rate, 0.45, 0.9, 0.3));
}

/** Surf driving into a cave mouth and booming back (5 s): a swell, the boom, the hiss out. */
export function caveSurge(rate: number, seed = 9950): Float32Array {
  const random = seeded(seed);
  const seconds = 5;
  const n = secs(seconds, rate);
  const rumble = lowpass(whiteNoise(n, random), 180, rate);
  const hiss = bandpass(whiteNoise(n, random), 1800, 0.5, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const swell = t < 1.5 ? t / 1.5 : Math.exp(-(t - 1.5) * 0.9);
    out[i] = (rumble[i] as number) * 1.6 * swell + (hiss[i] as number) * 0.12 * swell;
  }
  const boom = multiply(
    glide(secs(1.2, rate), () => 60, rate),
    pluck(secs(1.2, rate), rate, 0.01, 0.4),
  );
  mixInto(out, boom, secs(1.5, rate), 1.1);
  return reverb(out, rate, 0.35, 0.9, 0.3);
}

// ---------------------------------------------------------------------------------------
// The animals.

/** A deer's snort: a sharp breath through the nose, a rough voiced puff, the hiss at its end. */
export function deerSnort(rate: number, seed = 9960): Float32Array {
  const random = seeded(seed);
  const len = secs(0.9, rate);
  const voiced = glide(len, () => 210, rate);
  const grit = bandpass(whiteNoise(len, random), 900, 2.5, rate);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.02) * Math.exp(-t * 3.2);
    out[i] = ((voiced[i] as number) * 0.25 + (grit[i] as number) * 0.9) * env;
  }
  return out;
}

/** A deer bounding off through brush: four heavy landings and the crackle of stems between. */
export function deerBound(rate: number, seed = 9961): Float32Array {
  const random = seeded(seed);
  const seconds = 2.4;
  const out = new Float32Array(secs(seconds, rate));
  const hits = [0, 0.42, 0.78, 1.2];
  for (const at of hits) {
    const len = secs(0.16, rate);
    const crackle = bandpass(whiteNoise(len, random), 700 + random() * 300, 1.5, rate);
    const thump = multiply(
      glide(len, () => 120, rate),
      pluck(len, rate, 0.002, 0.05),
    );
    const hit = new Float32Array(len);
    for (let i = 0; i < len; i++) hit[i] = (crackle[i] as number) * 0.6 + (thump[i] as number);
    mixInto(out, hit, secs(at, rate), 0.7 + random() * 0.3);
  }
  // Leaves and stems in between: brief, quiet, moving away.
  for (let k = 0; k < 14; k++) {
    const len = secs(0.02, rate);
    const tick = bandpass(whiteNoise(len, random), 2400, 1, rate);
    mixInto(out, tick, secs(0.1 + random() * 2.1, rate), 0.04 + random() * 0.04);
  }
  return reverb(out, rate, 0.12, 0.4, 0.5);
}

/**
 * A bear crashing off through the brush (one that runs rather than fights): a gallop of
 * heavy, soft footfalls in threes, branches snapping and the brush thrashing, all of it
 * going away, duller and fainter, over about three seconds.
 */
export function bearCrash(rate: number, seed = 9966): Float32Array {
  const random = seeded(seed);
  const seconds = 3.4;
  const out = new Float32Array(secs(seconds, rate));
  // A bear's gallop: the forefeet close together, then the hind, about 2.5 strides a second.
  const strides = [0, 0.4, 0.8, 1.2, 1.62, 2.05, 2.5];
  strides.forEach((at, s) => {
    const away = s / strides.length;
    for (const [dt, w] of [
      [0, 1],
      [0.07, 0.8],
      [0.19, 0.9],
    ] as const) {
      const len = secs(0.2, rate);
      const thump = multiply(
        glide(len, () => 70 + random() * 20, rate),
        pluck(len, rate, 0.004, 0.07),
      );
      const brush = bandpass(whiteNoise(len, random), 600 + random() * 500, 1.1, rate);
      const hit = new Float32Array(len);
      const lp = 1 - 0.55 * away;
      for (let i = 0; i < len; i++) {
        hit[i] = (thump[i] as number) + (brush[i] as number) * 0.45 * lp;
      }
      mixInto(out, hit, secs(at + dt, rate), w * (1 - 0.7 * away) * (0.8 + 0.2 * random()));
    }
  });
  // The brush thrashing and branches snapping as it goes through.
  for (let k = 0; k < 24; k++) {
    const t = 0.05 + random() * 2.8;
    const away = t / 3;
    const len = secs(0.03 + random() * 0.05, rate);
    const twig = bandpass(whiteNoise(len, random), 1600 + random() * 1800, 1.4, rate);
    for (let i = 0; i < len; i++) twig[i] = (twig[i] as number) * Math.exp((-i / rate) * 60);
    mixInto(out, twig, secs(t, rate), (0.12 + random() * 0.18) * (1 - 0.75 * away));
  }
  for (const t of [0.55, 1.45]) {
    const len = secs(0.06, rate);
    const snap = bandpass(whiteNoise(len, random), 1100, 0.9, rate);
    for (let i = 0; i < len; i++) snap[i] = (snap[i] as number) * Math.exp((-i / rate) * 45);
    mixInto(out, snap, secs(t, rate), 0.6 * (1 - 0.5 * (t / 3)));
  }
  return reverb(lowpass(out, 5200, rate), rate, 0.15, 0.45, 0.5);
}

/** A bear's huff: breath forced out of a big chest, a pop of the jaw, the air sucked back. */
export function bearHuff(rate: number, seed = 9970): Float32Array {
  const random = seeded(seed);
  const len = secs(1.2, rate);
  const voice = lowpass(
    glide(len, (t) => 92 - 14 * t, rate),
    900,
    rate,
  );
  const breath = bandpass(whiteNoise(len, random), 500, 1.2, rate);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.05) * Math.exp(-t * 2.4);
    out[i] = ((voice[i] as number) * 0.7 + (breath[i] as number) * 0.5) * env;
  }
  for (const at of [0.55, 0.62]) {
    const click = bandpass(whiteNoise(secs(0.012, rate), random), 2600, 1.5, rate);
    mixInto(out, click, secs(at, rate), 0.9);
  }
  return out;
}

/** A bear's growl (2.6 s): a low voice rolling with a rattle in it, swelling and dying. */
export function bearGrowl(rate: number, seed = 9971): Float32Array {
  const random = seeded(seed);
  const seconds = 2.6;
  const n = secs(seconds, rate);
  const voice = glide(n, (t) => 78 + 6 * Math.sin(TAU * 6 * t), rate);
  const sawish = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = voice[i] as number;
    sawish[i] = v + 0.5 * Math.sin(2 * Math.asin(Math.max(-1, Math.min(1, v))));
  }
  const rattle = wander(n, 22, rate, random);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.4) * Math.min(1, (seconds - t) / 0.5);
    out[i] = (sawish[i] as number) * env * (0.7 + 0.3 * (rattle[i] as number));
  }
  return lowpass(reverb(out, rate, 0.1, 0.4, 0.5), 1400, rate);
}

/** A wolf's howl (6 s): a long rise, a wavering hold, the fall; a few harmonics and breath. */
export function wolfHowl(variant: number, rate: number, seed = 9980): Float32Array {
  const random = seeded(seed + variant);
  const seconds = 6;
  const n = secs(seconds, rate);
  const top = variant === 1 ? 470 : 395;
  const hz = (t: number): number => {
    const rise = Math.min(1, t / 1.8);
    const fall = t > 4.6 ? 1 - 0.25 * ((t - 4.6) / 1.4) : 1;
    return top * (0.85 + 0.15 * rise) * fall * (1 + 0.012 * Math.sin(TAU * 5.2 * t));
  };
  const out = new Float32Array(n);
  const base = glide(n, hz, rate);
  const h2 = glide(n, (t) => hz(t) * 2.01, rate);
  const h3 = glide(n, (t) => hz(t) * 3.02, rate);
  const breath = bandpass(whiteNoise(n, random), 900, 2, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.6) * Math.min(1, (seconds - t) / 0.9);
    out[i] =
      ((base[i] as number) * 0.6 +
        (h2[i] as number) * 0.25 +
        (h3[i] as number) * 0.1 +
        (breath[i] as number) * 0.05) *
      env;
  }
  return reverb(out, rate, 0.2, 0.75, 0.4);
}

// ---------------------------------------------------------------------------------------
// The grapple and the dig.

/** The grapple going down (3 s): the line whirring out over the rail, the splash at its end. */
export function grappleCast(rate: number, seed = 9990): Float32Array {
  const random = seeded(seed);
  const seconds = 3;
  const n = secs(seconds, rate);
  const hum = bandpass(whiteNoise(n, random), 1100, 3, rate);
  const whirr = glide(n, (t) => 260 + 60 * Math.sin(TAU * 9 * t), rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.05) * Math.max(0, 1 - t / 2.4);
    out[i] = ((hum[i] as number) * 0.8 + (whirr[i] as number) * 0.05) * env;
  }
  const splashAt = secs(2.4, rate);
  const splash = bandpass(whiteNoise(secs(0.5, rate), random), 2400, 0.6, rate);
  for (let i = 0; i < splash.length; i++) {
    const t = i / rate;
    splash[i] = (splash[i] as number) * Math.exp(-t * 7);
  }
  mixInto(out, splash, splashAt, 0.9);
  return out;
}

/** The line coming up taut (3.5 s): a stick-slip creak of wet hemp and iron, a grunt at the end. */
export function grappleHaul(rate: number, seed = 9991): Float32Array {
  const random = seeded(seed);
  const seconds = 3.5;
  const n = secs(seconds, rate);
  const creak = bandpass(whiteNoise(n, random), 520, 6, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // Stick-slip: the grip breaks loose a few times a second as the line comes in.
    const slip = Math.pow(Math.abs(Math.sin(TAU * 2.6 * t)), 6);
    const env = Math.min(1, t / 0.3) * Math.min(1, (seconds - t) / 0.4);
    out[i] = (creak[i] as number) * (0.25 + 0.9 * slip) * env;
  }
  const clank = bandpass(whiteNoise(secs(0.08, rate), random), 3000, 2, rate);
  for (const at of [0.9, 1.6, 2.4]) mixInto(out, clank, secs(at, rate), 0.5);
  return out;
}

/** A spade going into the ground (0.9 s): the bite, the crumb of soil, a thunk of the blade. */
export function spade(variant: number, rate: number): Float32Array {
  const random = seeded(9995 + variant);
  const seconds = 0.9;
  const n = secs(seconds, rate);
  const scrape = bandpass(whiteNoise(n, random), 1400 + variant * 300, 1.2, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.min(1, t / 0.06) * Math.exp(-t * 5);
    out[i] = (scrape[i] as number) * env * 1.2;
  }
  const thunk = multiply(
    glide(secs(0.25, rate), () => 115, rate),
    pluck(secs(0.25, rate), rate, 0.002, 0.05),
  );
  mixInto(out, thunk, secs(0.05, rate), 0.8);
  const crumb = bandpass(whiteNoise(secs(0.2, rate), random), 3800, 1, rate);
  mixInto(out, crumb, secs(0.35, rate), 0.25);
  return out;
}

// ---------------------------------------------------------------------------------------
// The ending.

/** The end of a run: a slow air in D minor, eight bars and a turn home (about 40 s). */
export function endingAir(): { notes: Note[]; bpm: number } {
  const notes: Note[] = [
    ['D4', 2],
    ['F4', 1],
    ['A4', 2],
    ['G4', 1],
    ['F4', 2],
    ['E4', 1],
    ['D4', 1],
    ['C4', 2],
    ['D4', 2],
    ['A3', 2],
    ['C4', 1],
    ['D4', 1],
    ['E4', 2],
    ['F4', 2],
    ['G4', 1],
    ['F4', 1],
    ['E4', 2],
    ['D4', 1],
    ['E4', 1],
    ['D4', 4],
    ['F4', 2],
    ['A4', 1],
    ['G4', 1],
    ['F4', 2],
    ['E4', 2],
    ['D4', 1],
    ['C4', 1],
    ['A3', 2],
    ['B3', 2],
    ['A3', 4],
  ];
  return { notes, bpm: 58 };
}

/** The ending's drone under the air, in D. */
export const ENDING_DRONE: readonly string[] = ['D3', 'A3'];

/** Trim the quiet tail of a sample (a little headroom kept). */
export function trimmed(x: Float32Array): Float32Array {
  const floor = 1e-3 * peak(x);
  let end = x.length;
  while (end > 0 && Math.abs(x[end - 1] as number) < floor) end--;
  return x.subarray(0, Math.min(x.length, end + 256));
}
