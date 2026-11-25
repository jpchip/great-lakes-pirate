/**
 * Phase 8 piece I (plan 09 §16.4 row I; plan 15 §4.6, §11 Phase 8): the sounds of building
 * and crafting at a hideout, and the rest of the UI set. A hand saw, a hammer driving nails,
 * a stone block set in mortar, a plane, the knock of a piece placed and the dull thud of one
 * refused, a piece pried down; the yard at work (the work session's bed); the smithy's
 * forge and anvil, the cooper driving hoops, the still loaded and the still at work; and
 * for the screens a rubber stamp, a newspaper shaken open, a telegraph sounder, a page
 * turned and two small bells. Synthesized like the on-foot set (no free recordings in one
 * consistent voice), pure functions over Float32Array, seeded; original, so CC BY 4.0 like
 * the repo's other assets.
 */

import { clang, thud } from './synth-harbor.ts';
import { trimTail } from './synth-chart.ts';
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
    out[i] = (out[i] as number) * Math.min(1, t / 0.001) * Math.exp(-t / decayS);
  }
  return out;
}

/** Low-passed noise under a hump. */
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

/** A damped sine. */
function ping(rate: number, hz: number, decayS: number, seconds = decayS * 6): Float32Array {
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] = Math.sin(TAU * hz * t) * Math.exp(-t / decayS) * Math.min(1, t / 0.0005);
  }
  return out;
}

/** A bubble: a short sine rising in pitch as it rises and breaks. */
function bubble(rate: number, random: Random, lowHz: number, highHz: number): Float32Array {
  const seconds = 0.03 + 0.06 * random();
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const f0 = lowHz + (highHz - lowHz) * random();
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    phase += (TAU * f0 * (1 + 0.9 * u)) / rate;
    out[i] = Math.sin(phase) * Math.sin(Math.PI * u) ** 2;
  }
  return out;
}

/** A stick-slip creak: wood under strain, as a train of soft knocks. */
function creak(
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

// ---------------------------------------------------------------------------------------
// Building

/**
 * One stroke of a hand saw, `seconds` long: the teeth (high band-passed noise chopped at
 * the rate they cross the cut) over the board's body ringing low. The push cuts, so it's
 * louder and brighter than the pull.
 */
function sawStroke(rate: number, random: Random, seconds: number, push: boolean): Float32Array {
  const n = secs(seconds, rate);
  const grit = bandpass(noise(n, random), push ? 3200 : 2600, 1.1, rate);
  const body = bandpass(noise(n, random), 620, 3, rate);
  const out = new Float32Array(n);
  const teethPerS = push ? 58 : 46;
  let phase = random();
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const u = t / seconds;
    phase += teethPerS / rate;
    const tooth = 0.45 + 0.55 * Math.abs(Math.sin(Math.PI * phase)) ** 3;
    const env = Math.sin(Math.PI * u) ** 0.7;
    out[i] = env * (tooth * (grit[i] as number) * 1.4 + 0.9 * tooth * (body[i] as number));
  }
  return out.map((s) => s * (push ? 1 : 0.55));
}

/** A hand saw through a board: four strokes, push and pull, and the offcut dropping. */
export function handSaw(rate: number, seed = 8100): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.6, rate));
  let t = 0.02;
  for (let k = 0; k < 4; k++) {
    const push = 0.36 + 0.05 * random();
    mixInto(out, sawStroke(rate, random, push, true), secs(t, rate), 1);
    t += push * 0.92;
    const pull = 0.3 + 0.05 * random();
    mixInto(out, sawStroke(rate, random, pull, false), secs(t, rate), 1);
    t += pull * 0.92;
  }
  // The last fibers part with a crack and the offcut hits the ground.
  mixInto(out, burst(rate, random, 0.05, 1800, 1.5, 0.008), secs(t, rate), 0.6);
  mixInto(out, thud(rate, random, 0.3, 190), secs(t + 0.16, rate), 0.7);
  mixInto(out, thud(rate, random, 0.2, 260), secs(t + 0.3, rate), 0.3);
  return out;
}

/** One hammer blow on a nail: steel on steel, then the board taking it. */
function hammerBlow(rate: number, random: Random, nailHz: number, seat: number): Float32Array {
  const out = new Float32Array(secs(0.35, rate));
  mixInto(out, burst(rate, random, 0.03, 4200, 1.2, 0.003), 0, 0.9);
  mixInto(out, ping(rate, nailHz, 0.03 * (1 - 0.6 * seat)), 0, 0.55 * (1 - 0.5 * seat));
  mixInto(out, ping(rate, nailHz * 2.7, 0.012), 0, 0.2);
  mixInto(out, thud(rate, random, 0.3, 170 + 40 * seat), 0, 0.6 + 0.5 * seat);
  mixInto(out, burst(rate, random, 0.1, 900, 1.5, 0.02), 0, 0.4);
  return out;
}

/**
 * Driving a nail: a tap to start it, then blows ringing higher as it goes in, the last one
 * dull as the head seats. Variant 2 is a longer spike and a heavier hand.
 */
export function hammerNail(variant: number, rate: number): Float32Array {
  const random = seeded(8110 + variant);
  const blows = variant === 1 ? 4 : 5;
  const out = new Float32Array(secs(0.4 + 0.42 * blows, rate));
  let t = 0.01;
  // A light tap to set it.
  mixInto(out, hammerBlow(rate, random, 1900, 0), secs(t, rate), 0.35);
  t += 0.3 + 0.05 * random();
  for (let k = 0; k < blows; k++) {
    const u = k / (blows - 1);
    const seat = k === blows - 1 ? 1 : 0;
    const hz = (variant === 1 ? 1650 : 1350) * (1 + 0.25 * u);
    mixInto(out, hammerBlow(rate, random, hz, seat), secs(t, rate), 0.8 + 0.2 * random());
    t += 0.34 + 0.08 * random();
  }
  return trimTail(out, rate);
}

/**
 * A dressed stone set in mortar: the block slides on the bed with grit under it, settles
 * with a low knock, and two taps of a mallet bring it to the line.
 */
export function stoneSet(rate: number, seed = 8120): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.5, rate));
  const slideS = 0.45;
  const scrape = bandpass(hush(rate, random, slideS, 5000, 0.08), 1300, 0.9, rate);
  mixInto(out, scrape, 0, 1.4);
  for (let k = 0; k < 14; k++) {
    mixInto(
      out,
      burst(rate, random, 0.02, 2200 + 2500 * random(), 2, 0.003),
      secs(slideS * random(), rate),
      0.25 * random(),
    );
  }
  mixInto(out, thud(rate, random, 0.4, 85), secs(slideS - 0.02, rate), 1);
  mixInto(out, burst(rate, random, 0.08, 700, 2, 0.015), secs(slideS - 0.02, rate), 0.5);
  // A wooden mallet on stone: a hard click with the block's short ring under it.
  for (const at of [0.82, 1.08]) {
    mixInto(out, burst(rate, random, 0.05, 1500, 2.5, 0.006), secs(at, rate), 0.7);
    mixInto(out, ping(rate, 880 + 60 * random(), 0.018), secs(at, rate), 0.35);
    mixInto(out, thud(rate, random, 0.12, 210), secs(at, rate), 0.35);
  }
  return out;
}

/** A plane taking two shavings off a board: a long curling hiss and the iron's chatter. */
export function planeStrokes(rate: number, seed = 8130): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.7, rate));
  for (const at of [0.02, 0.85]) {
    const seconds = 0.62 + 0.06 * random();
    const n = secs(seconds, rate);
    const hiss = bandpass(noise(n, random), 4200, 0.9, rate);
    const rasp = bandpass(noise(n, random), 950, 2, rate);
    const flutter = wander(n, 28, rate, random);
    const stroke = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const env = smooth(u / 0.08) * smooth((1 - u) / 0.25);
      const f = 0.65 + 0.35 * (flutter[i] as number);
      stroke[i] = env * (1.2 * f * (hiss[i] as number) + 0.7 * (rasp[i] as number));
    }
    mixInto(out, stroke, secs(at, rate), 1);
    // The plane's sole set down on the board at the end of the stroke.
    mixInto(out, thud(rate, random, 0.1, 240), secs(at + seconds - 0.04, rate), 0.25);
  }
  return out;
}

/** A piece placed in the plan: a short wooden knock, as on a drafting board. */
export function placeKnock(rate: number, seed = 8140): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.25, rate));
  mixInto(out, thud(rate, random, 0.2, 260), 0, 0.8);
  mixInto(out, burst(rate, random, 0.05, 1400, 2.5, 0.008), 0, 0.8);
  mixInto(out, ping(rate, 720, 0.02), 0, 0.3);
  return out;
}

/** A piece refused: a dull, low, muffled thud with nothing ringing after it. */
export function refusedThud(rate: number, seed = 8141): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.32, rate));
  mixInto(out, thud(rate, random, 0.3, 105), 0, 1);
  mixInto(out, thud(rate, random, 0.2, 80), secs(0.07, rate), 0.6);
  return lowpass(lowpass(out, 520, rate), 520, rate);
}

/**
 * A piece taken down: the bar bites, the boards groan, a nail squeals out, the board
 * cracks free and clatters onto the pile.
 */
export function pryDown(rate: number, seed = 8150): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.1, rate));
  // The bar set under the board.
  mixInto(out, clang(rate, random, 620, 0.5).slice(0, secs(0.3, rate)), 0, 0.5);
  mixInto(out, creak(rate, random, 0.6, 650, 30, 70), secs(0.12, rate), 0.9);
  // The nail drawn: a squeal rising through the wood.
  const squealS = 0.32;
  const n = secs(squealS, rate);
  const squeal = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const hz = 1700 + 900 * u + 120 * Math.sin(TAU * 31 * u);
    phase += (TAU * hz) / rate;
    squeal[i] = Math.sin(phase) * Math.sin(Math.PI * u) ** 0.5 * (0.6 + 0.4 * random());
  }
  mixInto(out, bandpass(squeal, 2100, 1.2, rate), secs(0.62, rate), 0.35);
  mixInto(out, burst(rate, random, 0.08, 1600, 1.2, 0.012), secs(0.95, rate), 0.9);
  // Boards down on the pile, bouncing.
  let t = 1.12;
  let level = 1;
  for (let k = 0; k < 4; k++) {
    mixInto(out, thud(rate, random, 0.3, 150 + 120 * random()), secs(t, rate), level);
    mixInto(out, burst(rate, random, 0.06, 900, 2, 0.01), secs(t, rate), 0.5 * level);
    t += 0.12 + 0.1 * random();
    level *= 0.55;
  }
  return out;
}

export const WORK_LOOP_S = 8;

/**
 * The yard at work, the work session's bed (looped, the pipeline crossfades its seam): the
 * crew a little way off, saws and hammers going in turn, a mallet, a board thrown down,
 * under the open air.
 */
export function workYard(rate: number, seed = 8160): Float32Array {
  const random = seeded(seed);
  const seconds = WORK_LOOP_S + 1;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const air = lowpass(lowpass(noise(n, random), 700, rate), 700, rate);
  const swell = wander(n, 0.3, rate, random);
  for (let i = 0; i < n; i++)
    out[i] = 0.5 * (0.7 + 0.3 * (swell[i] as number)) * (air[i] as number);
  const dry = new Float32Array(n);
  // A saw on one side, two hammers on the other, a mallet now and then.
  for (let t = 0.3; t < seconds - 1.2; t += 2.4 + 1.2 * random()) {
    for (let k = 0; k < 3; k++) {
      const s = 0.34;
      mixInto(dry, sawStroke(rate, random, s, true), secs(t + k * 0.62, rate), 0.35);
      mixInto(dry, sawStroke(rate, random, 0.28, false), secs(t + k * 0.62 + 0.32, rate), 0.35);
    }
  }
  for (const hz of [1500, 1250]) {
    for (let t = 0.1 + random(); t < seconds - 0.4;) {
      const blows = 2 + Math.floor(random() * 4);
      for (let k = 0; k < blows && t < seconds - 0.4; k++) {
        mixInto(dry, hammerBlow(rate, random, hz, k === blows - 1 ? 1 : 0), secs(t, rate), 0.45);
        t += 0.35 + 0.1 * random();
      }
      t += 0.8 + 1.6 * random();
    }
  }
  for (let t = 1 + random(); t < seconds - 0.5; t += 2.5 + 2 * random()) {
    mixInto(dry, thud(rate, random, 0.25, 140 + 60 * random()), secs(t, rate), 0.4);
    mixInto(dry, burst(rate, random, 0.05, 1100, 2, 0.01), secs(t, rate), 0.25);
  }
  const far = lowpass(dry, 3200, rate);
  mixInto(out, reverb(far, rate, 0.25, 0.5, 0.35).slice(0, n), 0, 1);
  return out;
}

// ---------------------------------------------------------------------------------------
// The stations at work

/** An anvil struck: a bright, long ring over the hammer's crack. */
function anvil(rate: number, random: Random, level: number): Float32Array {
  const out = new Float32Array(secs(0.9, rate));
  mixInto(out, clang(rate, random, 1020, 1).slice(0, out.length), 0, 0.9 * level);
  mixInto(out, ping(rate, 2310, 0.18, 0.9), 0, 0.25 * level);
  mixInto(out, burst(rate, random, 0.04, 3500, 1, 0.004), 0, 0.8 * level);
  return out;
}

/**
 * The smithy at work: the bellows breathing on the fire twice, the iron on the anvil (a
 * heavy blow and two light taps, three times over), and the quench hissing in the tub.
 */
export function forge(rate: number, seed = 8200): Float32Array {
  const random = seeded(seed);
  const seconds = 5.2;
  const n = secs(seconds, rate);
  const dry = new Float32Array(n);
  // The fire under it all: a low roar and a crackle.
  const roar = lowpass(lowpass(noise(n, random), 260, rate), 260, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    dry[i] = 0.9 * (roar[i] as number) * smooth(t / 0.3) * smooth((seconds - t) / 0.6);
  }
  for (let k = 0; k < 24; k++) {
    mixInto(
      dry,
      burst(rate, random, 0.015, 2500 + 2500 * random(), 2, 0.002),
      secs((seconds - 0.4) * random(), rate),
      0.2 * random(),
    );
  }
  // The bellows: two long breaths that brighten the fire.
  for (const at of [0, 0.75]) {
    mixInto(dry, hush(rate, random, 0.6, 900, 0.25), secs(at, rate), 1.6);
    mixInto(dry, creak(rate, random, 0.3, 420, 18, 10), secs(at + 0.3, rate), 0.25);
  }
  // Heavy, tap, tap: the smith's rhythm.
  let t = 1.6;
  for (let r = 0; r < 3; r++) {
    mixInto(dry, anvil(rate, random, 1), secs(t, rate), 0.9);
    mixInto(dry, thud(rate, random, 0.15, 120), secs(t, rate), 0.6);
    mixInto(dry, anvil(rate, random, 0.45), secs(t + 0.24, rate), 0.5);
    mixInto(dry, anvil(rate, random, 0.4), secs(t + 0.42, rate), 0.45);
    t += 0.66;
  }
  // The quench: a hard hiss that dies into a simmer.
  const q = secs(1.1, rate);
  const hiss = bandpass(noise(q, random), 5200, 0.7, rate);
  for (let i = 0; i < q; i++) {
    const tt = i / rate;
    hiss[i] = (hiss[i] as number) * Math.min(1, tt / 0.01) * Math.exp(-tt / 0.35);
  }
  mixInto(dry, hiss, secs(t + 0.15, rate), 1.4);
  for (let k = 0; k < 10; k++) {
    mixInto(dry, bubble(rate, random, 300, 900), secs(t + 0.3 + 0.7 * random(), rate), 0.25);
  }
  return trimTail(reverb(dry, rate, 0.2, 0.4, 0.25), rate);
}

/**
 * The cooperage at work: the hoop driver walked round a barrel under the mallet (wood on
 * iron, the hoop tightening and ringing higher), then the barrel's head struck to hear it
 * sound, hollow and tight.
 */
export function cooperage(rate: number, seed = 8210): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.6, rate));
  let t = 0.02;
  for (let k = 0; k < 8; k++) {
    const u = k / 7;
    mixInto(out, thud(rate, random, 0.25, 150), secs(t, rate), 0.7);
    mixInto(
      out,
      clang(rate, random, 760 + 260 * u, 0.5).slice(0, secs(0.35, rate)),
      secs(t, rate),
      0.45,
    );
    mixInto(out, burst(rate, random, 0.04, 1200, 2, 0.006), secs(t, rate), 0.5);
    t += k % 2 ? 0.3 : 0.24;
  }
  // The head struck: a hollow drum boom.
  const boomS = 0.8;
  const n = secs(boomS, rate);
  const boom = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const tt = i / rate;
    phase += (TAU * 118 * (1 + 0.25 * Math.exp(-tt / 0.02))) / rate;
    boom[i] =
      Math.sin(phase) * Math.exp(-tt / 0.22) + 0.3 * Math.sin(phase * 2.3) * Math.exp(-tt / 0.08);
  }
  mixInto(out, boom, secs(t + 0.25, rate), 1);
  mixInto(out, burst(rate, random, 0.05, 700, 2, 0.01), secs(t + 0.25, rate), 0.6);
  return out;
}

/**
 * The still loaded: mash poured into the pot (a pour with glugs), the copper cap set on
 * with a ring, the fire lit under it, and the first bubbles.
 */
export function stillLoad(rate: number, seed = 8220): Float32Array {
  const random = seeded(seed);
  const seconds = 4.4;
  const out = new Float32Array(secs(seconds, rate));
  const pourS = 1.7;
  const pn = secs(pourS, rate);
  const pour = bandpass(noise(pn, random), 750, 0.8, rate);
  const flow = wander(pn, 6, rate, random);
  for (let i = 0; i < pn; i++) {
    const u = i / pn;
    pour[i] =
      (pour[i] as number) *
      smooth(u / 0.1) *
      smooth((1 - u) / 0.2) *
      (0.6 + 0.4 * (flow[i] as number));
  }
  mixInto(out, pour, 0, 1.1);
  for (let tt = 0.05; tt < pourS - 0.1; tt += 0.07 + 0.08 * random()) {
    mixInto(out, bubble(rate, random, 180, 420), secs(tt, rate), 0.5);
  }
  // The copper cap seated.
  mixInto(out, clang(rate, random, 540, 0.6).slice(0, secs(0.9, rate)), secs(1.85, rate), 0.6);
  mixInto(out, thud(rate, random, 0.15, 200), secs(1.85, rate), 0.4);
  // A match struck and the fire taking.
  mixInto(out, burst(rate, random, 0.15, 3000, 1, 0.05), secs(2.6, rate), 0.5);
  mixInto(out, hush(rate, random, 1.6, 320, 0.5), secs(2.75, rate), 1.2);
  for (let tt = 3.4; tt < seconds - 0.1; tt += 0.08 + 0.15 * random()) {
    mixInto(out, bubble(rate, random, 220, 600), secs(tt, rate), 0.3);
  }
  return out;
}

export const STILL_LOOP_S = 6;

/**
 * A still at work, looped and placed at the still while a batch runs: the pot simmering,
 * the fire under it, the worm's run dripping into a jug.
 */
export function stillAtWork(rate: number, seed = 8230): Float32Array {
  const random = seeded(seed);
  const seconds = STILL_LOOP_S + 1;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  const roar = lowpass(lowpass(noise(n, random), 300, rate), 300, rate);
  const swell = wander(n, 0.5, rate, random);
  for (let i = 0; i < n; i++)
    out[i] = 0.9 * (0.75 + 0.25 * (swell[i] as number)) * (roar[i] as number);
  for (let t = 0; t < seconds - 0.1; t += 0.03 + 0.12 * random()) {
    mixInto(out, bubble(rate, random, 160, 520), secs(t, rate), 0.18 + 0.12 * random());
  }
  // The run into the jug: a drip and its little plink, about every 1.4 s.
  for (let t = 0.5; t < seconds - 0.3; t += 1.2 + 0.4 * random()) {
    mixInto(out, ping(rate, 1250 + 200 * random(), 0.03), secs(t, rate), 0.25);
    mixInto(out, bubble(rate, random, 700, 1100), secs(t + 0.01, rate), 0.2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The screens (plan 15 §4.6)

/** A rubber stamp on a contract: the thump of the pad through paper onto the desk. */
export function stampThunk(rate: number, seed = 8300): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.4, rate));
  mixInto(out, thud(rate, random, 0.3, 125), 0, 1);
  mixInto(out, burst(rate, random, 0.04, 2200, 1, 0.006), 0, 0.6);
  mixInto(out, thud(rate, random, 0.2, 240), secs(0.008, rate), 0.4);
  // The stamp lifted off the paper.
  mixInto(out, burst(rate, random, 0.05, 3400, 1.5, 0.01), secs(0.2, rate), 0.15);
  return out;
}

/** A newspaper shaken open: crackling sheets in two shakes and a snap straight. */
export function newspaperShake(rate: number, seed = 8310): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1, rate));
  for (const [at, len] of [
    [0, 0.3],
    [0.36, 0.25],
  ] as const) {
    mixInto(
      out,
      bandpass(hush(rate, random, len, 7000, 0.06), 2600, 0.6, rate),
      secs(at, rate),
      0.9,
    );
    for (let k = 0; k < 26; k++) {
      mixInto(
        out,
        burst(rate, random, 0.02, 2000 + 5000 * random(), 1.5, 0.003),
        secs(at + len * random(), rate),
        0.5 * random(),
      );
    }
  }
  mixInto(out, burst(rate, random, 0.08, 1400, 0.9, 0.012), secs(0.7, rate), 1);
  mixInto(out, thud(rate, random, 0.08, 300), secs(0.7, rate), 0.2);
  return out;
}

/**
 * A telegraph sounder taking a short message: each mark a brass click down and a duller
 * one up, dots and dashes at a key's pace.
 */
export function telegraph(rate: number, seed = 8320): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.9, rate));
  const click = (at: number, down: boolean): void => {
    mixInto(
      out,
      burst(rate, random, 0.03, down ? 2600 : 1700, 3, 0.004),
      secs(at, rate),
      down ? 0.9 : 0.55,
    );
    mixInto(out, ping(rate, down ? 1180 : 860, 0.01), secs(at, rate), down ? 0.4 : 0.25);
  };
  // "-.-. .-" and a little more: the shape, not the words.
  const marks = '-.-. .- ..-. ..';
  const dot = 0.075;
  let t = 0.02;
  for (const c of marks) {
    if (c === ' ') {
      t += dot * 2;
      continue;
    }
    click(t, true);
    t += c === '-' ? dot * 3 : dot;
    click(t, false);
    t += dot;
  }
  return trimTail(out, rate);
}

/** A page of the logbook turned: a soft sweep and the flick of the edge. */
export function pageTurn(rate: number, seed = 8330): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.45, rate));
  mixInto(out, bandpass(hush(rate, random, 0.32, 6000, 0.12), 2400, 0.7, rate), 0, 0.9);
  mixInto(out, burst(rate, random, 0.05, 3200, 1.5, 0.008), secs(0.3, rate), 0.6);
  return out;
}

/** Partials of a small brass hand bell: ratio, amplitude, decay seconds. */
const HANDBELL: readonly [number, number, number][] = [
  [1, 1, 0.9],
  [2.01, 0.45, 0.6],
  [2.74, 0.3, 0.4],
  [5.42, 0.15, 0.22],
  [8.93, 0.08, 0.12],
];

function bellStroke(rate: number, random: Random, hz: number, level: number): Float32Array {
  const out = new Float32Array(secs(1.4, rate));
  for (const [ratio, amp, decay] of HANDBELL) {
    const f = hz * ratio;
    const p0 = random() * TAU;
    for (let i = 0; i < out.length; i++) {
      const t = i / rate;
      out[i] =
        (out[i] as number) +
        level * amp * Math.sin(p0 + TAU * f * t) * Math.exp(-t / decay) * Math.min(1, t / 0.002);
    }
  }
  mixInto(out, burst(rate, random, 0.01, 5000, 2, 0.002), 0, 0.3 * level);
  return out;
}

/** A small bell, once and soft: something's done (a still's batch ready). */
export function chimeSoft(rate: number, seed = 8340): Float32Array {
  const random = seeded(seed);
  return trimTail(bellStroke(rate, random, 1320, 1), rate);
}

/** A counter bell struck twice, the second a fourth higher: something worth a look. */
export function chimeBright(rate: number, seed = 8341): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.7, rate));
  mixInto(out, bellStroke(rate, random, 1175, 1), 0, 1);
  mixInto(out, bellStroke(rate, random, 1568, 0.9), secs(0.17, rate), 1);
  return trimTail(out, rate);
}

// ---------------------------------------------------------------------------------------
// The slipway (Phase 8 piece G; polish)

/**
 * A ship launched from the slipway: two mallet blows knocking out the dog-shores, the
 * cradle groaning as she takes her weight, the long rumble of the hull running down the
 * greased ways and gathering speed, the stern taking the water in a great splash, and the
 * wash running back up the shore.
 */
export function shipLaunch(rate: number, seed = 8400): Float32Array {
  const random = seeded(seed);
  const seconds = 8;
  const out = new Float32Array(secs(seconds, rate));
  // The dog-shores knocked out.
  mixInto(out, thud(rate, random, 0.3, 140), secs(0.1, rate), 0.9);
  mixInto(out, burst(rate, random, 0.05, 1800, 1.3, 0.01), secs(0.1, rate), 0.5);
  mixInto(out, thud(rate, random, 0.3, 150), secs(0.75, rate), 1);
  mixInto(out, burst(rate, random, 0.05, 1700, 1.3, 0.01), secs(0.75, rate), 0.55);
  // The cradle groaning as she takes her weight.
  mixInto(out, creak(rate, random, 1.4, 120, 6, 18), secs(1.1, rate), 0.35);
  mixInto(out, creak(rate, random, 1.0, 180, 10, 26), secs(1.6, rate), 0.25);
  // Down the ways: a rumble and a hiss of tallow, rising as she gathers way.
  const runS = 3.2;
  const n = secs(runS, rate);
  const rumble = lowpass(lowpass(noise(n, random), 110, rate), 110, rate);
  const hiss = bandpass(noise(n, random), 1300, 0.6, rate);
  const judder = wander(n, 9, rate, random);
  const run = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const swell = smooth(u / 0.7) * (u < 0.92 ? 1 : (1 - u) / 0.08);
    const j = 0.75 + 0.25 * Math.abs(judder[i] as number);
    run[i] =
      swell * j * (2.6 * (rumble[i] as number) + 0.35 * (0.3 + 0.7 * u) * (hiss[i] as number));
  }
  mixInto(out, run, secs(2.0, rate), 1);
  // The stern takes the water.
  const at = 2.0 + runS - 0.25;
  const splashS = 2.6;
  const m = secs(splashS, rate);
  const crash = bandpass(noise(m, random), 900, 0.4, rate);
  const body = lowpass(noise(m, random), 260, rate);
  const spray = bandpass(noise(m, random), 4200, 0.8, rate);
  const splash = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const t = i / rate;
    const hit = Math.min(1, t / 0.03) * Math.exp(-t / 0.55);
    const fall = smooth((t - 0.25) / 0.4) * Math.exp(-(t - 0.25) / 0.9);
    splash[i] =
      hit * (1.1 * (crash[i] as number) + 1.6 * (body[i] as number)) +
      0.45 * Math.max(0, fall) * (spray[i] as number);
  }
  mixInto(out, splash, secs(at, rate), 1);
  mixInto(out, thud(rate, random, 0.6, 60), secs(at, rate), 0.8);
  // The wash running back up the shore.
  mixInto(out, hush(rate, random, 1.6, 900, 0.5), secs(at + 1.6, rate), 0.35);
  return trimTail(reverb(out, rate, 0.2, 0.5, 0.35), rate);
}
