/**
 * Phase 9 piece N (plan 11 §18.4 row N; plan 15 §4.1, §4.5, §11 Phase 9): winter's sounds.
 * Thin lake ice cracking underfoot, groaning, and giving way, and the haul out over the
 * edge; the lake's ice booming and "singing" far off on a cold night; footsteps on bare ice
 * and on snow cold enough to squeak; a hand sled's runners and a load lashed onto it; teeth
 * chattering; the gusts of a winter wind and its bed; and the stillness of a harbor frozen
 * in at night. Synthesized like the earlier sets, pure functions over Float32Array, seeded;
 * original, so CC BY 4.0 like the repo's other assets.
 *
 * Lake ice has a voice of its own: a crack runs through the sheet as a flexural wave, and
 * since its high frequencies travel faster than its low ones, a crack heard across the ice
 * arrives as a falling chirp ("pew"), longer and lower the further it has come. `chirp`
 * makes that sweep; the crack underfoot is mostly the snap, the far boom mostly the sweep.
 */

import { thud } from './synth-harbor.ts';
import { trimTail } from './synth-chart.ts';
import { creak, syllable } from './synth-law.ts';
import { bandpass, lowpass, mixInto, reverb, seeded, wander, type Random } from './synth.ts';

const TAU = Math.PI * 2;

const smooth = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

const noise = (n: number, random: Random): Float32Array =>
  Float32Array.from({ length: n }, () => random() * 2 - 1);

const secs = (s: number, rate: number): number => Math.round(s * rate);

/** Band-passed noise that dies away. */
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
    out[i] = (out[i] as number) * Math.min(1, t / 0.0008) * Math.exp(-t / decayS);
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
    out[i] =
      (out[i] as number) *
      smooth(t / riseS) *
      smooth((seconds - t) / Math.max(0.01, seconds - riseS));
  }
  return out;
}

/** A damped sine: a ping, a tick. */
function ping(rate: number, hz: number, decayS: number, seconds = decayS * 6): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = Math.sin(TAU * hz * t) * Math.exp(-t / decayS) * Math.min(1, t / 0.0005);
  }
  return out;
}

/**
 * The ice's dispersive "pew": a sine falling from `fromHz` to `toHz` over `seconds`, the
 * fall fastest at first (the highs outrun the lows), under a short swell and a long tail,
 * a little rough with noise so it isn't a pure whistle.
 */
export function chirp(
  rate: number,
  random: Random,
  seconds: number,
  fromHz: number,
  toHz: number,
): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const rough = bandpass(noise(n, random), (fromHz + toHz) / 3, 0.7, rate);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const hz = toHz + (fromHz - toHz) * (1 - u) ** 2.6;
    phase += (TAU * hz) / rate;
    const env = smooth(u / 0.03) * (1 - u) ** 1.6;
    out[i] = env * (Math.sin(phase) + 0.25 * (rough[i] as number));
  }
  return out;
}

/** Folds what rings past the loop's end back onto its start, so the loop is seamless. */
function folded(x: Float32Array, loopS: number, rate: number): Float32Array {
  const n = secs(loopS, rate);
  const out = x.slice(0, n);
  for (let i = n; i < x.length; i++) {
    out[(i - n) % n] = (out[(i - n) % n] as number) + (x[i] as number);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Thin ice

/**
 * The ice cracking underfoot (piece M's first warning, at a quarter of the way to breaking):
 * a sharp snap through the sheet, the thump of it settling, and the crack running away
 * from you as a short falling "pew", with a tick or two of the surface crazing.
 */
export function iceCrack(variant: number, rate: number): Float32Array {
  const random = seeded(9700 + variant);
  const out = new Float32Array(secs(1.4, rate));
  const pitch = variant === 1 ? 1 : 0.84;
  mixInto(out, burst(rate, random, 0.08, 3200 * pitch, 0.7, 0.006), 0, 1.3);
  mixInto(out, burst(rate, random, 0.12, 900 * pitch, 1.1, 0.02), 0, 0.8);
  mixInto(out, thud(rate, random, 0.3, 70 * pitch), 0, 0.5);
  mixInto(out, chirp(rate, random, 0.42, 2600 * pitch, 380 * pitch), secs(0.012, rate), 0.55);
  for (let k = 0; k < 4 + variant; k++) {
    const at = 0.05 + 0.4 * random() ** 1.5;
    mixInto(
      out,
      burst(rate, random, 0.03, 2400 + 3000 * random(), 2, 0.003),
      secs(at, rate),
      0.35 * (0.4 + random()),
    );
  }
  return trimTail(reverb(out, rate, 0.12, 0.55, 0.45), rate);
}

/**
 * The ice groaning under you (the second warning): a long, low, rising moan as the sheet
 * bends, the stick-slip of it, a deep pew running off, and a crack's snap near the end.
 */
export function iceGroan(rate: number, seed = 9710): Float32Array {
  const random = seeded(seed);
  const seconds = 2.8;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  // The bend: a low wavering tone that sags and rises, through a resonance.
  const sway = wander(n, 1.6, rate, random);
  const bend = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const hz = 62 + 28 * u + 10 * (sway[i] as number);
    phase += (TAU * hz) / rate;
    const env = smooth(u / 0.25) * smooth((1 - u) / 0.3);
    bend[i] = env * (Math.sin(phase) + 0.45 * Math.sin(2 * phase) + 0.2 * Math.sin(3.1 * phase));
  }
  mixInto(out, lowpass(bend, 500, rate), 0, 0.9);
  mixInto(out, lowpass(creak(rate, random, 2.4, 30, 70), 1800, rate), secs(0.2, rate), 0.55);
  mixInto(out, lowpass(hush(rate, random, 2.4, 120, 0.6), 200, rate), secs(0.1, rate), 2.4);
  mixInto(out, chirp(rate, random, 1.1, 900, 140), secs(0.9, rate), 0.35);
  mixInto(out, burst(rate, random, 0.08, 2600, 0.8, 0.008), secs(2.15, rate), 0.6);
  mixInto(out, chirp(rate, random, 0.35, 2000, 400), secs(2.16, rate), 0.25);
  return trimTail(reverb(out, rate, 0.18, 0.7, 0.5), rate);
}

/**
 * The ice giving way: a crack louder than the rest, the sheet breaking up round you in
 * plates that knock and tinkle as they tip, and the black water taking you (the on-foot
 * set's splash follows as you go in).
 */
export function iceBreak(rate: number, seed = 9720): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.6, rate));
  mixInto(out, burst(rate, random, 0.12, 2800, 0.6, 0.012), 0, 1.4);
  mixInto(out, burst(rate, random, 0.2, 700, 0.9, 0.04), 0, 1.1);
  mixInto(out, thud(rate, random, 0.5, 52), 0, 1.1);
  mixInto(out, chirp(rate, random, 0.5, 2400, 300), secs(0.01, rate), 0.5);
  // More cracks as it goes in a ring around you.
  for (const at of [0.09, 0.17, 0.24]) {
    mixInto(
      out,
      burst(rate, random, 0.08, 1800 + 1600 * random(), 0.8, 0.008),
      secs(at, rate),
      0.8,
    );
  }
  // Plates tipping and knocking together, the shards tinkling.
  for (let k = 0; k < 9; k++) {
    const at = 0.25 + 0.9 * random();
    mixInto(out, thud(rate, random, 0.2, 110 + 90 * random()), secs(at, rate), 0.35);
  }
  for (let k = 0; k < 40; k++) {
    const at = 0.2 + 1.6 * random() ** 1.3;
    mixInto(out, ping(rate, 3500 + 4500 * random(), 0.01), secs(at, rate), 0.12 * random());
  }
  // The water: a heavy plunge and the slop of it in the hole.
  mixInto(out, hush(rate, random, 0.6, 380, 0.02), secs(0.3, rate), 2.2);
  mixInto(
    out,
    bandpass(hush(rate, random, 1.4, 6000, 0.1), 1800, 0.5, rate),
    secs(0.35, rate),
    0.8,
  );
  return trimTail(reverb(out, rate, 0.12, 0.6, 0.4), rate);
}

/**
 * Hauling out over the edge: sodden wool dragged up onto the ice, a grunt of effort, the
 * water pouring off you, and a knee and a hand coming down on the ice.
 */
export function iceHaul(rate: number, seed = 9730): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.2, rate));
  mixInto(out, bandpass(hush(rate, random, 0.9, 7000, 0.3), 1300, 0.6, rate), 0, 1.4);
  mixInto(
    out,
    syllable(
      {
        atS: 0,
        seconds: 0.45,
        f0: [120, 96],
        formants: [
          [640, 1190, 2390],
          [500, 900, 2400],
        ],
      },
      rate,
      random,
    ),
    secs(0.25, rate),
    0.35,
  );
  // The water off your coat: a pour that thins to drips.
  const pour = bandpass(hush(rate, random, 1.2, 8000, 0.05), 2400, 0.5, rate);
  for (let i = 0; i < pour.length; i++) pour[i] = (pour[i] as number) * Math.exp(-i / rate / 0.45);
  mixInto(out, pour, secs(0.7, rate), 1.2);
  for (let k = 0; k < 14; k++) {
    mixInto(out, ping(rate, 900 + 1200 * random(), 0.012), secs(0.9 + 1.1 * random(), rate), 0.12);
  }
  mixInto(out, thud(rate, random, 0.25, 90), secs(0.95, rate), 0.6);
  mixInto(out, burst(rate, random, 0.05, 2200, 1.2, 0.006), secs(0.96, rate), 0.4);
  mixInto(out, thud(rate, random, 0.25, 105), secs(1.3, rate), 0.5);
  return trimTail(out, rate);
}

/**
 * The lake's ice booming far off on a cold night, as the sheet contracts and cracks for
 * miles: a deep thump, then the long falling "pew" of it coming across the ice, and an echo.
 */
export function iceSing(variant: number, rate: number): Float32Array {
  const random = seeded(9740 + variant);
  const out = new Float32Array(secs(4, rate));
  const low = variant === 1 ? 1 : 0.8;
  mixInto(out, lowpass(thud(rate, random, 0.9, 38 * low), 300, rate), 0, 0.9);
  mixInto(out, chirp(rate, random, 1.3, 1500 * low, 120 * low), secs(0.05, rate), 0.8);
  mixInto(out, chirp(rate, random, 0.9, 1100 * low, 160 * low), secs(0.55, rate), 0.35);
  if (variant === 2) mixInto(out, chirp(rate, random, 1, 1300, 100), secs(1.4, rate), 0.25);
  return trimTail(reverb(lowpass(out, 2500, rate), rate, 0.35, 0.85, 0.5), rate);
}

// ---------------------------------------------------------------------------------------
// Footsteps

/**
 * A footstep on bare lake ice: the boot's heel ticking on it, a little scuff of grit, and
 * the hollow knock of the sheet over the water.
 */
export function stepIce(variant: number, rate: number): Float32Array {
  const random = seeded(9750 + variant);
  const out = new Float32Array(secs(0.4, rate));
  const toe = secs(0.06 + 0.02 * random(), rate);
  mixInto(out, burst(rate, random, 0.05, 2600 + 500 * random(), 1.4, 0.004), 0, 1);
  mixInto(out, ping(rate, 1400 + 300 * random(), 0.006), 0, 0.5);
  mixInto(out, thud(rate, random, 0.2, 130 + 30 * random()), 0, 0.45);
  const scuff = bandpass(hush(rate, random, 0.09, 9000, 0.02), 4200, 0.8, rate);
  mixInto(out, scuff, toe, 0.8);
  mixInto(out, burst(rate, random, 0.04, 3200, 1.5, 0.003), toe, 0.4);
  return out;
}

/**
 * A footstep on snow at hard frost, below about −10 °C, when it squeaks: the crunch, and a
 * short squeal as the crystals slide on each other under the boot.
 */
export function stepSqueak(variant: number, rate: number): Float32Array {
  const random = seeded(9760 + variant);
  const out = new Float32Array(secs(0.42, rate));
  const n = secs(0.22, rate);
  const crunch = bandpass(noise(n, random), 1500 + 300 * random(), 0.9, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    crunch[i] = (crunch[i] as number) * smooth(t / 0.015) * smooth((0.22 - t) / 0.14);
  }
  mixInto(out, crunch, 0, 1);
  mixInto(out, hush(rate, random, 0.1, 180, 0.01), 0, 0.9);
  // The squeal: a stick-slip pulse train sliding up, through a resonance.
  const m = secs(0.14, rate);
  const squeal = new Float32Array(m);
  const f0 = 620 + 160 * random();
  let phase = 0;
  for (let i = 0; i < m; i++) {
    const u = i / m;
    phase += (TAU * f0 * (1 + 0.35 * u)) / rate;
    squeal[i] = (phase % TAU < 0.9 ? 1 : 0) * Math.sin(Math.PI * u) ** 1.5;
  }
  mixInto(out, bandpass(squeal, 1900 + 300 * random(), 3, rate), secs(0.04, rate), 1.4);
  return out;
}

// ---------------------------------------------------------------------------------------
// The sled

export const RUNNERS_LOOP_S = 6;

/**
 * A hand sled's runners hissing over snow and ice behind you (looped): a steady scrape,
 * louder and brighter on the pull, a knock as it rides over a ridge, a creak of the rope.
 */
export function sledRunners(rate: number, seed = 9770): Float32Array {
  const random = seeded(seed);
  const n = secs(RUNNERS_LOOP_S, rate);
  const out = new Float32Array(n);
  const hiss = bandpass(noise(n, random), 2600, 0.45, rate);
  const high = bandpass(noise(n, random), 6200, 0.7, rate);
  const grain = wander(n, 22, rate, random);
  const pull = wander(n, 0.9, rate, random);
  for (let i = 0; i < n; i++) {
    const g = 0.7 + 0.3 * (pull[i] as number);
    const r = 0.6 + 0.4 * Math.abs(grain[i] as number);
    out[i] = g * r * (hiss[i] as number) + 0.5 * g * (high[i] as number);
  }
  const body = lowpass(lowpass(noise(n, random), 160, rate), 160, rate);
  mixInto(out, body, 0, 2.5);
  // Ridges and the rope.
  for (let t = 0.4; t < RUNNERS_LOOP_S - 0.4; t += 0.9 + 1.2 * random()) {
    mixInto(out, thud(rate, random, 0.2, 150 + 60 * random()), secs(t, rate), 0.25);
  }
  mixInto(out, creak(rate, random, 0.5, 140, 320), secs(2.2, rate), 0.12);
  mixInto(out, creak(rate, random, 0.4, 160, 300), secs(4.7, rate), 0.1);
  // Edges eased so the 0.5 s loop crossfade joins smoothly.
  return out;
}

export const GRIND_LOOP_S = 5;

/**
 * A hull forcing her way through lake ice (looped; plan 15 §4.5, piece K's `IceGrinding`):
 * the crunch of the sheet breaking at her stem, plates scraping down the planking, floes
 * knocking on the hull, the timbers creaking under it, and now and then a crack running
 * off across the ice.
 */
export function hullGrind(rate: number, seed = 9830): Float32Array {
  const random = seeded(seed);
  const n = secs(GRIND_LOOP_S, rate);
  const tail = secs(1.5, rate);
  const out = new Float32Array(n + tail);
  // The crunch: mid noise chopped by a fast grain, so it breaks up rather than hisses.
  const crunch = bandpass(noise(n, random), 750, 0.55, rate);
  const grain = wander(n, 28, rate, random);
  const push = wander(n, 0.7, rate, random);
  // The scrape: higher, smoother, the ice sliding along the planks.
  const scrape = bandpass(noise(n, random), 2300, 0.9, rate);
  const slide = wander(n, 1.6, rate, random);
  for (let i = 0; i < n; i++) {
    const p = 0.65 + 0.35 * (push[i] as number);
    const g = Math.max(0, Math.abs(grain[i] as number) - 0.15) * 1.6;
    out[i] =
      p * g * (crunch[i] as number) +
      0.35 * p * (0.5 + 0.5 * (slide[i] as number)) * (scrape[i] as number);
  }
  // The weight of it under the bow.
  mixInto(out, lowpass(lowpass(noise(n, random), 140, rate), 140, rate), 0, 2.2);
  // Floes knocking on the hull.
  for (let t = 0.2; t < GRIND_LOOP_S; t += 0.35 + 0.7 * random()) {
    mixInto(
      out,
      thud(rate, random, 0.25, 95 + 70 * random()),
      secs(t, rate),
      0.3 + 0.25 * random(),
    );
    if (random() < 0.4)
      mixInto(out, burst(rate, random, 0.08, 1400, 1.2, 0.015), secs(t, rate), 0.25);
  }
  // The planking taking it, and a crack running off.
  mixInto(out, creak(rate, random, 0.6, 110, 240), secs(1.3, rate), 0.14);
  mixInto(out, creak(rate, random, 0.5, 130, 260), secs(3.6, rate), 0.12);
  mixInto(out, chirp(rate, random, 0.9, 1900, 380), secs(2.4, rate), 0.12);
  return folded(out, GRIND_LOOP_S, rate);
}

/** A load set down on the sled's slats and lashed: the thump, a slide, the rope drawn tight. */
export function sledLoad(rate: number, seed = 9780): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.8, rate));
  mixInto(out, thud(rate, random, 0.4, 85), 0, 1);
  mixInto(out, burst(rate, random, 0.15, 600, 1, 0.03), 0, 0.6);
  mixInto(
    out,
    bandpass(hush(rate, random, 0.35, 7000, 0.05), 2600, 0.6, rate),
    secs(0.08, rate),
    0.6,
  );
  mixInto(out, thud(rate, random, 0.3, 110), secs(0.45, rate), 0.6);
  mixInto(out, creak(rate, random, 0.45, 180, 380), secs(0.8, rate), 0.35);
  mixInto(out, creak(rate, random, 0.35, 200, 420), secs(1.3, rate), 0.3);
  return trimTail(out, rate);
}

// ---------------------------------------------------------------------------------------
// The cold

/**
 * Teeth chattering, as warmth runs low: rapid clicks in uneven bursts with a shuddering
 * breath through them.
 */
export function teethChatter(rate: number, seed = 9790): Float32Array {
  const random = seeded(seed);
  const seconds = 1.9;
  const out = new Float32Array(secs(seconds, rate));
  let t = 0.03;
  while (t < seconds - 0.15) {
    // A burst of a few clicks at 12–16 a second, then a short catch.
    const clicks = 4 + Math.floor(random() * 6);
    const hz = 12 + 4 * random();
    for (let k = 0; k < clicks && t < seconds - 0.1; k++) {
      mixInto(
        out,
        burst(rate, random, 0.025, 2600 + 900 * random(), 2.5, 0.0025),
        secs(t, rate),
        0.55 + 0.4 * random(),
      );
      mixInto(out, ping(rate, 1100 + 300 * random(), 0.003), secs(t, rate), 0.25);
      t += (1 / hz) * (0.85 + 0.3 * random());
    }
    t += 0.06 + 0.12 * random();
  }
  // The breath: in through clenched teeth in judders, and out.
  const n = out.length;
  const air = bandpass(noise(n, random), 1900, 0.8, rate);
  for (let i = 0; i < n; i++) {
    const tt = i / rate;
    const judder = 0.5 + 0.5 * Math.sign(Math.sin(TAU * 9 * tt));
    const env = smooth(tt / 0.2) * smooth((seconds - tt) / 0.4);
    out[i] = (out[i] as number) + 0.12 * (air[i] as number) * env * judder;
  }
  return lowpass(out, 6000, rate);
}

/**
 * A gust of winter wind (one-shot): it swells over a second, whistling round you with
 * snow blown in it, and falls away.
 */
export function winterGust(variant: number, rate: number): Float32Array {
  const random = seeded(9800 + variant);
  const seconds = 3.6;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const body = lowpass(lowpass(noise(n, random), 500, rate), 500, rate);
  const snow = bandpass(noise(n, random), 5200, 0.6, rate);
  const flutter = wander(n, 7, rate, random);
  const peakAt = variant === 1 ? 0.35 : 0.45;
  // The whistle: a resonance whose pitch rides the gust.
  const pipe = new Float32Array(n);
  const white = noise(n, random);
  const centre = variant === 1 ? 620 : 480;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const swell = u < peakAt ? smooth(u / peakAt) : smooth((1 - u) / (1 - peakAt));
    const hz = centre * (0.8 + 0.5 * swell);
    // A two-pole resonator, retuned each sample.
    const r = 0.997;
    const a1 = -2 * r * Math.cos((TAU * hz) / rate);
    const a2 = r * r;
    const y = (white[i] as number) * 0.02 - a1 * y1 - a2 * y2;
    y2 = y1;
    y1 = y;
    pipe[i] = y * swell * swell;
    const f = 0.85 + 0.15 * (flutter[i] as number);
    out[i] = swell * f * (2.2 * (body[i] as number) + 0.45 * swell * (snow[i] as number));
  }
  mixInto(out, pipe, 0, 0.6);
  return out;
}

export const WINTER_WIND_S = 16;

/**
 * Winter wind (looped): a dry, hollow wind over the ice and the bare shore, a low moan
 * rising and falling in it, and drifting snow hissing along the surface in the stronger
 * breaths.
 */
export function winterWind(rate: number, seed = 9810): Float32Array {
  const random = seeded(seed);
  const n = secs(WINTER_WIND_S, rate);
  const out = new Float32Array(n);
  const gust = wander(n, 0.2, rate, random);
  const body = lowpass(lowpass(noise(n, random), 420, rate), 420, rate);
  const snow = bandpass(noise(n, random), 4800, 0.5, rate);
  const white = noise(n, random);
  const pitch = wander(n, 0.35, rate, random);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const g = 0.5 + 0.5 * (gust[i] as number);
    const hz = 300 + 120 * (pitch[i] as number) + 90 * g;
    const r = 0.996;
    const a1 = -2 * r * Math.cos((TAU * hz) / rate);
    const y = (white[i] as number) * 0.02 - a1 * y1 - r * r * y2;
    y2 = y1;
    y1 = y;
    out[i] =
      (0.55 + 0.45 * g) * 1.8 * (body[i] as number) +
      0.5 * g * g * y +
      0.35 * g ** 3 * (snow[i] as number);
  }
  return out;
}

export const FROZEN_NIGHT_S = 20;

/**
 * A harbor frozen in, at night (looped): almost nothing. Still air just moving, a ship's
 * timbers ticking where the ice holds her, a rope's end tapping a mast, and once, far off,
 * the ice.
 */
export function frozenNight(rate: number, seed = 9820): Float32Array {
  const random = seeded(seed);
  const tail = 3;
  const n = secs(FROZEN_NIGHT_S + tail, rate);
  const out = new Float32Array(n);
  const air = lowpass(lowpass(noise(n, random), 160, rate), 160, rate);
  const breath = wander(n, 0.12, rate, random);
  for (let i = 0; i < n; i++)
    out[i] = 1.4 * (air[i] as number) * (0.6 + 0.4 * (breath[i] as number));
  // The timbers in the ice: a creak now and then, and dry ticks.
  for (const at of [2.5, 9.2, 15.8]) {
    mixInto(
      out,
      lowpass(creak(rate, random, 0.8 + 0.6 * random(), 50, 120), 1400, rate),
      secs(at, rate),
      0.06,
    );
  }
  for (let k = 0; k < 9; k++) {
    mixInto(
      out,
      burst(rate, random, 0.05, 1200 + 800 * random(), 2, 0.005),
      secs(FROZEN_NIGHT_S * random(), rate),
      0.08,
    );
  }
  // A rope's end tapping a mast, twice in a breath of air.
  for (const at of [6.1, 6.9, 13.4]) {
    mixInto(out, ping(rate, 420 + 60 * random(), 0.03), secs(at, rate), 0.05);
  }
  // The ice, far off.
  mixInto(out, lowpass(chirp(rate, random, 1.4, 1100, 110), 1500, rate), secs(11, rate), 0.07);
  return folded(reverb(out, rate, 0.3, 0.85, 0.55), FROZEN_NIGHT_S, rate);
}
