/**
 * Phase 9 piece J (plan 11 §18.4 row J; plan 15 §4.1, §4.5, §4.6, §11 Phase 9): stage 1's
 * sounds. The saloon's piano and fiddle by night ("The Late Boat Waltz"); cards and chips
 * at the poker table (a shuffle, a card dealt, chips set down, the pot raked in, a check
 * knocked on the baize, a hand folded, hands shown); a lighthouse station on foot (the
 * lamp's clockwork turning the lens, the keeper winding it, the lamp put out and lit, a can
 * of kerosene from the oil house and its slosh as it's carried, the iron stair, a keeper
 * asleep and a keeper's greeting); the harbor master's counter (his desk bell, a letter
 * opened, an answer folded and sealed); a copycat rival's stinger; and a ship going
 * aground (the hull on the rocks, her crew and her bell). Synthesized like the earlier
 * sets, pure functions over Float32Array, seeded; original, so CC BY 4.0 like the repo's
 * other assets.
 */

import { clang, thud } from './synth-harbor.ts';
import { drumHit, reedChord, shipBell, trimTail } from './synth-chart.ts';
import { bowedNote } from './synth-combat.ts';
import { creak, syllable, type Syllable } from './synth-law.ts';
import {
  bandpass,
  fiddleDrone,
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

/** Band-passed noise under a hump: a swish, a slide, a breath. */
function swish(
  rate: number,
  random: Random,
  seconds: number,
  hz: number,
  q: number,
  riseS: number,
): Float32Array {
  const n = secs(seconds, rate);
  const out = bandpass(noise(n, random), hz, q, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    out[i] =
      (out[i] as number) *
      smooth(t / riseS) *
      smooth((seconds - t) / Math.max(0.01, seconds - riseS));
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

/** Folds what rings past the loop's end back onto its start, so the loop is seamless. */
function folded(x: Float32Array, loopS: number, rate: number): Float32Array {
  const n = secs(loopS, rate);
  const out = x.slice(0, n);
  for (let i = n; i < x.length; i++) {
    out[(i - n) % n] = (out[(i - n) % n] as number) + (x[i] as number);
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
  ee: [300, 2250, 3000],
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

// ---------------------------------------------------------------------------------------
// The saloon by night: "The Late Boat Waltz"

/**
 * An upright piano's note: three strings a few cents apart (a saloon piano, a little out),
 * stretched partials (a real string's stiffness), brighter the harder it's struck, a fast
 * then slow decay, a hammer's thump, and the damper at the end.
 */
export function pianoNote(
  hz: number,
  seconds: number,
  rate: number,
  random: Random,
  velocity = 0.7,
): Float32Array {
  const release = 0.18;
  const ring = Math.min(seconds, 3.5);
  const n = secs(ring + release, rate);
  const out = new Float32Array(n);
  const inharm = 0.00035 * (hz / 260) ** 0.5;
  const maxH = Math.max(1, Math.min(16, Math.floor(7000 / hz)));
  const detunes = [-3.5, 0.5, 4.5];
  for (let h = 1; h <= maxH; h++) {
    const fh = hz * h * Math.sqrt(1 + inharm * h * h);
    // Brighter strokes keep their high partials; each partial dies faster the higher it is.
    const amp = (1 / h ** (1.35 - 0.45 * velocity)) * (h === 1 ? 0.8 : 1);
    const fastS = 0.35 / (1 + 0.25 * h) / (hz / 260) ** 0.3;
    const slowS = 2.2 / (1 + 0.18 * h) / (hz / 260) ** 0.35;
    for (const cents of detunes) {
      const f = fh * 2 ** (cents / 1200);
      const p0 = random() * TAU;
      const w = (TAU * f) / rate;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const e = 0.55 * Math.exp(-t / fastS) + 0.45 * Math.exp(-t / slowS);
        if (e < 1e-4) break;
        out[i] = (out[i] as number) + (amp * e * Math.sin(p0 + w * i)) / detunes.length;
      }
    }
  }
  const thump = lowpass(burst(rate, random, 0.05, 220, 0.8, 0.012), 900, rate);
  mixInto(out, thump, 0, 0.6 * velocity);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const damper = 1 - smooth((t - ring) / release);
    out[i] = (out[i] as number) * damper * Math.min(1, t / 0.002) * velocity * 0.35;
  }
  return out;
}

/** A fiddle's melody note: the bowed string through the fiddle's body. */
export function fiddleNote(
  hz: number,
  seconds: number,
  rate: number,
  random: Random,
): Float32Array {
  const raw = bowedNote(hz, seconds, rate, random, seconds > 0.4);
  const out = new Float32Array(raw.length);
  for (const [f, q, g] of [
    [290, 2, 0.8],
    [470, 2.5, 0.8],
    [1000, 1.5, 0.6],
    [2800, 1.2, 0.5],
  ] as const) {
    mixInto(out, bandpass(raw, f, q, rate), 0, g);
  }
  // The bow's swell over a long note.
  for (let i = 0; i < out.length; i++) {
    const t = i / rate;
    out[i] = (out[i] as number) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, t / seconds)));
  }
  return out;
}

export const NIGHT_WALTZ = { bpm: 104, bars: 24, beatsPerBar: 3 } as const;
export const NIGHT_WALTZ_S = (NIGHT_WALTZ.bars * NIGHT_WALTZ.beatsPerBar * 60) / NIGHT_WALTZ.bpm;

/** The fiddle's tune, in D: two eight-bar strains and the first again, turned for home. */
const WALTZ_A: readonly Note[] = [
  ['F#5', 2],
  ['E5', 1],
  ['D5', 2],
  ['A4', 1],
  ['B4', 1],
  ['D5', 1],
  ['G5', 1],
  ['F#5', 3],
  ['F#5', 1],
  ['E5', 1],
  ['D5', 1],
  ['B4', 2],
  ['E5', 1],
  ['C#5', 1],
  ['E5', 1],
  ['A5', 1],
  ['G5', 2],
  ['E5', 1],
];
const WALTZ_B: readonly Note[] = [
  ['D5', 1],
  ['G5', 1],
  ['B5', 1],
  ['A5', 2],
  ['G5', 1],
  ['F#5', 2],
  ['A5', 1],
  ['F#5', 2],
  ['D5', 1],
  ['E5', 1],
  ['G5', 1],
  ['B5', 1],
  ['A5', 1],
  ['G5', 1],
  ['E5', 1],
  ['F#5', 2],
  ['E5', 1],
  ['D5', 2],
  ['E5', 1],
];
const WALTZ_A2: readonly Note[] = [
  ['F#5', 2],
  ['E5', 1],
  ['D5', 2],
  ['A4', 1],
  ['B4', 1],
  ['D5', 1],
  ['G5', 1],
  ['F#5', 2],
  ['A5', 1],
  ['B5', 2],
  ['G5', 1],
  ['E5', 1],
  ['F#5', 1],
  ['G5', 1],
  ['E5', 2],
  ['C#5', 1],
  ['D5', 3],
];
const WALTZ_CHORDS = [
  ...['D', 'D', 'G', 'D', 'Bm', 'Em', 'A', 'A7'],
  ...['G', 'G', 'D', 'Bm', 'Em', 'A', 'D', 'D'],
  ...['D', 'D', 'G', 'D', 'G', 'A7', 'A', 'D'],
] as const;

/** The piano's left hand: a bass note on one, the chord on two and three. */
const PIANO_CHORDS: Record<(typeof WALTZ_CHORDS)[number], { bass: string[]; tones: string[] }> = {
  D: { bass: ['D2', 'D3'], tones: ['F#3', 'A3', 'D4'] },
  G: { bass: ['G2', 'G3'], tones: ['G3', 'B3', 'D4'] },
  A: { bass: ['A2', 'A3'], tones: ['E3', 'A3', 'C#4'] },
  A7: { bass: ['A2', 'A3'], tones: ['G3', 'C#4', 'E4'] },
  Bm: { bass: ['B2', 'B3'], tones: ['F#3', 'B3', 'D4'] },
  Em: { bass: ['E2', 'E3'], tones: ['G3', 'B3', 'E4'] },
};

export function nightWaltzForm(): { melody: Note[]; chords: string[] } {
  return { melody: [...WALTZ_A, ...WALTZ_B, ...WALTZ_A2], chords: [...WALTZ_CHORDS] };
}

/**
 * "The Late Boat Waltz": the saloon's piano and a fiddle after dark, twenty-four bars of
 * 3/4 in D that loop. The piano keeps the oom-pah-pah (a little out of tune, a little
 * late), the fiddle has the tune; mixed close and plain like the polka, so the street's
 * low-pass and the room make it sound where it is.
 */
export function nightWaltz(rate: number, seed = 9100): Float32Array {
  const random = seeded(seed);
  const { bpm, beatsPerBar } = NIGHT_WALTZ;
  const beatS = 60 / bpm;
  const out = new Float32Array(secs(NIGHT_WALTZ_S + 3.5, rate));
  const { melody, chords } = nightWaltzForm();
  renderMelody(
    out,
    melody,
    bpm,
    0,
    rate,
    (hz, s) => fiddleNote(hz, s * 0.95, rate, random),
    0.38,
    random,
  );
  chords.forEach((name, bar) => {
    const c = PIANO_CHORDS[name as (typeof WALTZ_CHORDS)[number]];
    for (let beat = 0; beat < beatsPerBar; beat++) {
      const at = (bar * beatsPerBar + beat) * beatS + (random() - 0.5) * 0.018;
      if (beat === 0) {
        for (const b of c.bass) {
          mixInto(out, pianoNote(noteHz(b), beatS * 0.95, rate, random, 0.75), secs(at, rate), 0.8);
        }
      } else {
        c.tones.forEach((tone, k) =>
          mixInto(
            out,
            pianoNote(noteHz(tone), beatS * 0.6, rate, random, beat === 1 ? 0.55 : 0.45),
            secs(at + k * 0.004, rate),
            0.55,
          ),
        );
      }
    }
  });
  // An upper-register answer on the piano under the fiddle's long notes, now and then.
  for (const [bar, notes] of [
    [3, ['A5', 'F#5', 'D5']],
    [11, ['D6', 'A5', 'F#5']],
    [19, ['A5', 'F#5', 'D5']],
  ] as const) {
    notes.forEach((note, k) =>
      mixInto(
        out,
        pianoNote(noteHz(note), beatS * 0.9, rate, random, 0.5),
        secs((bar * beatsPerBar + k) * beatS + 0.01, rate),
        0.35,
      ),
    );
  }
  return folded(reverb(out, rate, 0.16, 0.62, 0.5), NIGHT_WALTZ_S, rate);
}

// ---------------------------------------------------------------------------------------
// Cards and chips

/** One card's edge snapping past the thumb. */
function cardTick(rate: number, random: Random, level = 1): Float32Array {
  const out = burst(rate, random, 0.012, 3600 + 1800 * random(), 1.2, 0.0018);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * level;
  return out;
}

/**
 * A riffle shuffle and a bridge: the two halves riffled together (card edges snapping
 * past the thumbs, faster then slower), the bridge's purr as they fall flat, and the
 * deck squared on the table, twice.
 */
export function shuffle(rate: number, seed = 9200): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.9, rate));
  // Twice: riffle, bridge.
  for (const [start, cards] of [
    [0.05, 46],
    [0.95, 40],
  ] as const) {
    let t = start;
    for (let k = 0; k < cards; k++) {
      const u = k / cards;
      mixInto(out, cardTick(rate, random, 0.5 + 0.5 * random()), secs(t, rate), 0.6);
      t += 0.006 + 0.008 * (1 - Math.sin(Math.PI * u)) + 0.003 * random();
    }
    mixInto(out, swish(rate, random, 0.22, 2600, 0.8, 0.05), secs(t, rate), 0.5);
    mixInto(out, thud(rate, random, 0.12, 210), secs(t + 0.24, rate), 0.25);
  }
  // Squared: two taps on edge.
  for (const at of [1.65, 1.76]) {
    mixInto(out, lowpass(thud(rate, random, 0.1, 260), 2500, rate), secs(at, rate), 0.35);
    mixInto(out, burst(rate, random, 0.03, 1800, 1, 0.006), secs(at, rate), 0.25);
  }
  return out;
}

/** A card dealt across the baize: the flick off the deck, the slide, the stop. */
export function cardDealt(variant: number, rate: number): Float32Array {
  const random = seeded(9210 + variant);
  const out = new Float32Array(secs(0.3, rate));
  mixInto(out, cardTick(rate, random, 1), 0, 0.6);
  const slide = 0.1 + 0.05 * random();
  mixInto(
    out,
    swish(rate, random, slide, 2200 + 900 * random(), 0.9, slide * 0.3),
    secs(0.01, rate),
    0.45,
  );
  mixInto(
    out,
    lowpass(thud(rate, random, 0.06, 300 + 80 * random()), 1800, rate),
    secs(slide, rate),
    0.3,
  );
  return out;
}

/** One clay chip striking another: a short, bright, slightly hollow click. */
function chipClick(rate: number, random: Random): Float32Array {
  const n = secs(0.05, rate);
  const out = new Float32Array(n);
  const f = 2900 + 1400 * random();
  for (const [ratio, g, d] of [
    [1, 1, 0.006],
    [1.63, 0.6, 0.004],
    [2.41, 0.35, 0.003],
  ] as const) {
    mixInto(out, ping(rate, f * ratio, d, 0.05), 0, g);
  }
  mixInto(out, burst(rate, random, 0.01, 5000, 1, 0.0015), 0, 0.5);
  return out;
}

/** A few chips set down on the pile: they click onto it and settle. */
export function chipsDown(variant: number, rate: number): Float32Array {
  const random = seeded(9220 + variant);
  const out = new Float32Array(secs(0.45, rate));
  const count = 3 + variant;
  let t = 0;
  for (let k = 0; k < count; k++) {
    mixInto(out, chipClick(rate, random), secs(t, rate), 0.9 - 0.08 * k);
    t += 0.018 + 0.035 * random();
  }
  // One rolls a little and lies down.
  for (let k = 0; k < 3; k++) {
    mixInto(
      out,
      chipClick(rate, random),
      secs(t + 0.05 + k * (0.05 - 0.012 * k), rate),
      0.3 / (k + 1),
    );
  }
  mixInto(out, lowpass(thud(rate, random, 0.06, 240), 1200, rate), 0, 0.15);
  return out;
}

/** The pot raked in: an armful of chips dragged across the baize and stacked. */
export function potRaked(rate: number, seed = 9230): Float32Array {
  const random = seeded(seed);
  const seconds = 1.6;
  const out = new Float32Array(secs(seconds, rate));
  mixInto(out, swish(rate, random, 0.8, 1400, 0.6, 0.25), secs(0.02, rate), 0.35);
  for (let t = 0.02; t < 0.8; t += 0.008 + 0.03 * random()) {
    mixInto(out, chipClick(rate, random), secs(t, rate), 0.25 + 0.35 * random());
  }
  // Stacked: quick clicks in threes.
  for (let s = 0; s < 3; s++) {
    for (let k = 0; k < 4; k++) {
      mixInto(out, chipClick(rate, random), secs(0.95 + s * 0.17 + k * 0.03, rate), 0.6);
    }
  }
  return out;
}

/** A check: two knuckle raps on the baize-covered table. */
export function tableKnock(rate: number, seed = 9240): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.45, rate));
  for (const [at, g] of [
    [0, 1],
    [0.13, 0.8],
  ] as const) {
    mixInto(
      out,
      lowpass(thud(rate, random, 0.16, 150 + 30 * random()), 1400, rate),
      secs(at, rate),
      g,
    );
    mixInto(
      out,
      lowpass(burst(rate, random, 0.03, 700, 1, 0.006), 1500, rate),
      secs(at, rate),
      0.4 * g,
    );
  }
  return out;
}

/** A hand folded: the cards gathered up and tossed face down onto the pile. */
export function cardsFolded(rate: number, seed = 9250): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.55, rate));
  mixInto(out, swish(rate, random, 0.12, 2400, 0.8, 0.04), 0, 0.4);
  const at = 0.16;
  for (let k = 0; k < 5; k++)
    mixInto(out, cardTick(rate, random, 0.6), secs(at + k * 0.006, rate), 0.6);
  mixInto(out, swish(rate, random, 0.09, 1900, 0.8, 0.02), secs(at, rate), 0.6);
  mixInto(out, lowpass(thud(rate, random, 0.08, 230), 1500, rate), secs(at + 0.02, rate), 0.35);
  return out;
}

/** Hands shown: five cards turned up one after another and laid flat. */
export function cardsShown(rate: number, seed = 9260): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.8, rate));
  for (let k = 0; k < 5; k++) {
    const t = 0.02 + k * (0.1 + 0.03 * random());
    mixInto(out, swish(rate, random, 0.05, 3000, 1, 0.015), secs(t, rate), 0.35);
    mixInto(out, cardTick(rate, random, 1), secs(t + 0.045, rate), 0.7);
    mixInto(out, lowpass(thud(rate, random, 0.05, 320), 1600, rate), secs(t + 0.045, rate), 0.2);
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// The lighthouse station

export const CLOCKWORK_LOOP_S = 6;
/** The escapement's beat: tick and tock, a whole number to the loop. */
export const CLOCKWORK_BEAT_S = 0.5;

/**
 * The lamp's clockwork (looped): the escapement's tick and tock, the gear train's whir,
 * the lens carriage rumbling round on its chariot wheels, and now and then a clink as a
 * weight chain moves on its sprocket. Heard in the lantern room and, dull, down the tower.
 */
export function clockwork(rate: number, seed = 9300): Float32Array {
  const random = seeded(seed);
  const seconds = CLOCKWORK_LOOP_S + 1;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  // The rumble: low noise, with the wheels' slow flutter.
  const rumble = lowpass(lowpass(noise(n, random), 90, rate), 90, rate);
  const flutter = wander(n, 1.3, rate, random);
  // The whir: a gear's tooth rate in band-passed noise, gently modulated.
  const whir = bandpass(noise(n, random), 1150, 4, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const teeth = 0.6 + 0.4 * Math.sin(TAU * 23 * t);
    out[i] =
      3.2 * (rumble[i] as number) * (0.8 + 0.2 * (flutter[i] as number)) +
      0.08 * (whir[i] as number) * teeth;
  }
  // The escapement: tick (higher) and tock, each a little metallic click with a ring.
  const beats = Math.round(seconds / CLOCKWORK_BEAT_S);
  for (let b = 0; b < beats; b++) {
    const tick = b % 2 === 0;
    const at = b * CLOCKWORK_BEAT_S;
    const f = tick ? 3100 : 2500;
    mixInto(out, burst(rate, random, 0.02, f, 3, 0.0025), secs(at, rate), 0.55);
    mixInto(out, ping(rate, f * 0.52, 0.012, 0.06), secs(at, rate), 0.22);
    mixInto(out, ping(rate, 640, 0.02, 0.1), secs(at + 0.002, rate), 0.08);
  }
  // A chain link over its sprocket.
  for (const at of [1.7, 4.6]) {
    mixInto(out, clang(rate, random, 1300, 0.25).slice(0, secs(0.2, rate)), secs(at, rate), 0.25);
  }
  return folded(reverb(out, rate, 0.25, 0.75, 0.45), CLOCKWORK_LOOP_S, rate);
}

/**
 * The keeper winding the clockwork: the crank's ratchet clicking round, the drum taking
 * up the weight's cable, the iron groaning under it, the crank let go.
 */
export function clockworkWound(rate: number, seed = 9310): Float32Array {
  const random = seeded(seed);
  const seconds = 3.6;
  const out = new Float32Array(secs(seconds, rate));
  let t = 0.05;
  let k = 0;
  while (t < 2.9) {
    // The crank turns in strokes: clicks bunch on the push.
    const phase = (t / 0.85) % 1;
    const level = 0.45 + 0.4 * Math.sin(Math.PI * phase);
    mixInto(out, burst(rate, random, 0.02, 2300 + 300 * (k % 2), 4, 0.003), secs(t, rate), level);
    mixInto(out, ping(rate, 900 + 40 * (k % 3), 0.01, 0.05), secs(t, rate), 0.15 * level);
    t += 0.07 + 0.05 * (1 - Math.sin(Math.PI * phase)) + 0.01 * random();
    k++;
  }
  mixInto(out, creak(rate, random, 2.6, 60, 140), secs(0.2, rate), 0.25);
  const drum = lowpass(
    lowpass(lowpass(noise(secs(2.8, rate), random), 160, rate), 160, rate),
    160,
    rate,
  );
  mixInto(out, drum, secs(0.05, rate), 2.5);
  mixInto(out, clang(rate, random, 520, 0.6).slice(0, secs(0.5, rate)), secs(3, rate), 0.35);
  return trimTail(reverb(out, rate, 0.25, 0.75, 0.45), rate);
}

/** Low-passed noise under a hump (a flame, a breath). */
function hush(rate: number, random: Random, seconds: number, hz: number, riseS: number) {
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

/** A small glass ring: the lamp's chimney touched or set down. */
function glassTink(rate: number, random: Random, hz = 2600): Float32Array {
  const out = new Float32Array(secs(0.6, rate));
  for (const [ratio, g, d] of [
    [1, 1, 0.12],
    [2.32, 0.5, 0.07],
    [4.1, 0.25, 0.04],
  ] as const) {
    mixInto(out, ping(rate, hz * ratio * (1 + 0.01 * random()), d, 0.6), 0, g);
  }
  return out;
}

/**
 * The lamp put out: the wick's brass screw turned down, the flame guttering and gone with
 * a soft puff, the chimney glass ticking as it cools, the clockwork's tick slowing out.
 */
export function lampDoused(rate: number, seed = 9320): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.4, rate));
  for (let k = 0; k < 6; k++) {
    mixInto(out, burst(rate, random, 0.02, 3400, 5, 0.004), secs(0.05 + k * 0.07, rate), 0.35);
  }
  // Guttering: the flame's roar with gaps, then the puff.
  const flame = hush(rate, random, 0.6, 500, 0.05);
  const gutter = wander(flame.length, 14, rate, random);
  for (let i = 0; i < flame.length; i++) {
    flame[i] = (flame[i] as number) * Math.max(0, 0.4 + 0.8 * (gutter[i] as number));
  }
  mixInto(out, flame, secs(0.3, rate), 1.4);
  mixInto(out, hush(rate, random, 0.25, 900, 0.02), secs(0.88, rate), 2.4);
  mixInto(out, glassTink(rate, random, 2900), secs(1.5, rate), 0.15);
  // The escapement runs down: ticks spacing out.
  let t = 0.9;
  let gap = 0.35;
  for (let k = 0; k < 5; k++) {
    mixInto(
      out,
      burst(rate, random, 0.02, k % 2 ? 2500 : 3100, 3, 0.0025),
      secs(t, rate),
      0.3 - 0.05 * k,
    );
    t += gap;
    gap *= 1.25;
  }
  return trimTail(reverb(out, rate, 0.25, 0.75, 0.45), rate);
}

/**
 * The lamp lit: a match struck and flaring, the wick catching with a soft whoomp, the
 * flame drawing up the chimney, the glass set down on its gallery.
 */
export function lampLit(rate: number, seed = 9330): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(2.6, rate));
  // The match: a scratch, then the flare's hiss.
  mixInto(out, swish(rate, random, 0.14, 3800, 1.2, 0.03), secs(0.05, rate), 0.9);
  const flare = swish(rate, random, 0.5, 5200, 0.7, 0.02);
  for (let i = 0; i < flare.length; i++)
    flare[i] = (flare[i] as number) * Math.exp(-i / rate / 0.15);
  mixInto(out, flare, secs(0.18, rate), 0.7);
  // The wick takes: a low whoomp, then the flame's steady draw.
  mixInto(out, hush(rate, random, 0.4, 260, 0.08), secs(0.85, rate), 2.6);
  const draw = hush(rate, random, 1.4, 600, 0.3);
  mixInto(out, draw, secs(1, rate), 0.9);
  mixInto(out, glassTink(rate, random, 2400), secs(1.9, rate), 0.4);
  mixInto(out, lowpass(thud(rate, random, 0.08, 420), 2400, rate), secs(1.9, rate), 0.2);
  return trimTail(reverb(out, rate, 0.25, 0.75, 0.45), rate);
}

/** Kerosene moving in a tin can: band-passed gurgles and small bubbles. */
function slosh(rate: number, random: Random, seconds: number): Float32Array {
  const n = secs(seconds, rate);
  const out = bandpass(noise(n, random), 520, 1.4, rate);
  const wave = wander(n, 6, rate, random);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const env = Math.sin(Math.PI * Math.min(1, t / seconds));
    out[i] = (out[i] as number) * env * Math.max(0, 0.3 + 0.9 * (wave[i] as number));
  }
  for (let t = 0.03; t < seconds - 0.05; t += 0.04 + 0.08 * random()) {
    const len = 0.02 + 0.03 * random();
    const m = secs(len, rate);
    const b = new Float32Array(m);
    const f0 = 380 + 500 * random();
    let phase = 0;
    for (let i = 0; i < m; i++) {
      const u = i / m;
      phase += (TAU * f0 * (1 + 0.8 * u)) / rate;
      b[i] = Math.sin(phase) * Math.sin(Math.PI * u);
    }
    mixInto(out, b, secs(t, rate), 0.12 * random());
  }
  return out;
}

/** A tin can's thin ring as it's knocked: the oil house's five-gallon can. */
function tinKnock(rate: number, random: Random, hz = 740, level = 1): Float32Array {
  const out = new Float32Array(secs(0.5, rate));
  for (const [ratio, g, d] of [
    [1, 1, 0.08],
    [1.47, 0.6, 0.06],
    [2.31, 0.45, 0.04],
    [3.6, 0.25, 0.025],
  ] as const) {
    mixInto(out, ping(rate, hz * ratio * (1 + 0.02 * random()), d, 0.5), 0, g * level);
  }
  mixInto(out, burst(rate, random, 0.03, 2500, 0.8, 0.004), 0, 0.6 * level);
  return out;
}

/**
 * A can of kerosene taken from the oil house: the can lifted off the stack with a tinny
 * knock, the oil sloshing in it, the bail handle clinking as it swings.
 */
export function oilCan(rate: number, seed = 9340): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.7, rate));
  mixInto(out, tinKnock(rate, random, 680), 0, 0.8);
  mixInto(out, lowpass(thud(rate, random, 0.12, 180), 1200, rate), 0, 0.3);
  mixInto(out, slosh(rate, random, 0.9), secs(0.18, rate), 1);
  for (const at of [0.25, 0.62, 1.05]) {
    mixInto(out, ping(rate, 3300 + 400 * random(), 0.02, 0.1), secs(at, rate), 0.2);
  }
  mixInto(out, tinKnock(rate, random, 700, 0.4), secs(1.2, rate), 0.4);
  return out;
}

/** The can carried: one slosh as you stride, the bail clinking. */
export function oilSlosh(rate: number, seed = 9350): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(0.6, rate));
  mixInto(out, slosh(rate, random, 0.5), 0, 0.9);
  mixInto(out, ping(rate, 3500, 0.02, 0.1), secs(0.08, rate), 0.18);
  return out;
}

/**
 * The tower's stair climbed: iron treads ringing underfoot in the tall brick tube, the
 * handrail ticking, a dozen steps.
 */
export function towerStair(rate: number, seed = 9360): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(3.2, rate));
  for (let k = 0; k < 12; k++) {
    const t = 0.04 + k * (0.22 + 0.03 * random());
    const g = 0.6 + 0.4 * random();
    mixInto(
      out,
      clang(rate, random, 330 + 60 * random(), 0.5).slice(0, secs(0.4, rate)),
      secs(t, rate),
      0.35 * g,
    );
    mixInto(out, thud(rate, random, 0.12, 130 + 30 * random()), secs(t, rate), 0.6 * g);
    if (k % 3 === 1)
      mixInto(out, ping(rate, 1900 + 300 * random(), 0.03, 0.15), secs(t + 0.08, rate), 0.15);
  }
  return trimTail(reverb(out, rate, 0.4, 0.85, 0.35), rate);
}

export const SNORE_LOOP_S = 7;

/**
 * A keeper asleep in the house (looped): two slow breaths in the loop, each a rasping
 * snore in and a soft breath out, through the bedroom wall.
 */
export function keeperSnore(rate: number, seed = 9370): Float32Array {
  const random = seeded(seed);
  const n = secs(SNORE_LOOP_S + 0.5, rate);
  const out = new Float32Array(n);
  for (const at of [0.2, 3.7]) {
    // In: a rasp, the soft palate fluttering at about 30 Hz through the throat's formants.
    const inS = 1.3;
    const m = secs(inS, rate);
    const rasp = new Float32Array(m);
    const base = noise(m, random);
    let phase = random() * TAU;
    for (let i = 0; i < m; i++) {
      const t = i / rate;
      phase += (TAU * (26 + 8 * Math.sin(Math.PI * (t / inS)))) / rate;
      const flap = 0.5 + 0.5 * Math.sin(phase);
      rasp[i] = (base[i] as number) * flap ** 3 * Math.sin(Math.PI * (t / inS)) ** 0.8;
    }
    const voiced = new Float32Array(m);
    for (const [f, q, g] of [
      [420, 3, 1],
      [950, 4, 0.5],
      [180, 2, 0.8],
    ] as const) {
      mixInto(voiced, bandpass(rasp, f, q, rate), 0, g);
    }
    mixInto(out, voiced, secs(at, rate), 1);
    // Out: a breath through the nose.
    const outBreath = bandpass(hush(rate, random, 1.1, 2600, 0.2), 1400, 0.8, rate);
    mixInto(out, outBreath, secs(at + 1.6, rate), 0.6);
  }
  return folded(lowpass(out, 2400, rate), SNORE_LOOP_S, rate);
}

/**
 * A keeper's greeting at his door, by day: a friendly call and a "well, now" (formant
 * syllables in a weathered man's voice, no words).
 */
export function keeperGreeting(rate: number, seed = 9380): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.8, rate));
  const parts: Syllable[] = [
    say(0.02, 0.22, 128, 'uh', 'ah', 1.05, true),
    say(0.28, 0.44, 138, 'oh', 'ay', 0.86),
    say(0.98, 0.24, 112, 'eh', 'eh', 0.98),
    say(1.26, 0.38, 118, 'uh', 'aw', 0.82),
  ];
  for (const s of parts) mixInto(out, syllable(s, rate, random), secs(s.atS, rate));
  return trimTail(reverb(out, rate, 0.12, 0.5), rate);
}

// ---------------------------------------------------------------------------------------
// The harbor master's counter and the letters

/**
 * The harbor master's desk bell (a brass dome struck once with the plunger): a bright
 * inharmonic ding that rings out.
 */
export function deskBell(rate: number, seed = 9400): Float32Array {
  const random = seeded(seed);
  const n = secs(2.6, rate);
  const out = new Float32Array(n);
  const f0 = 2180;
  for (const [ratio, g, d] of [
    [1, 1, 1.1],
    [1.008, 0.7, 1.05],
    [2.76, 0.4, 0.45],
    [5.4, 0.18, 0.2],
    [0.52, 0.12, 0.6],
  ] as const) {
    mixInto(out, ping(rate, f0 * ratio, d, 2.6), 0, g);
  }
  mixInto(out, burst(rate, random, 0.02, 5200, 1, 0.003), 0, 0.5);
  mixInto(out, lowpass(thud(rate, random, 0.05, 400), 2000, rate), 0, 0.15);
  return out;
}

/** Paper crackling: short, high crinkles. */
function crinkle(rate: number, random: Random, seconds: number, density: number): Float32Array {
  const out = new Float32Array(secs(seconds, rate));
  for (let t = 0; t < seconds; t += (0.5 + random()) / density) {
    mixInto(
      out,
      burst(rate, random, 0.012, 2500 + 4000 * random(), 1.4, 0.002),
      secs(t, rate),
      0.3 + 0.5 * random(),
    );
  }
  return out;
}

/**
 * A letter opened: the envelope's flap torn along its edge, the folded sheet drawn out and
 * opened in two crackling turns.
 */
export function letterOpened(rate: number, seed = 9410): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.6, rate));
  // The tear: rough, granular, rising a little as the finger runs along.
  const tear = new Float32Array(secs(0.32, rate));
  for (let t = 0; t < 0.3; t += 0.003 + 0.006 * random()) {
    mixInto(
      tear,
      burst(rate, random, 0.01, 1500 + 2500 * (t / 0.3) + 800 * random(), 1, 0.0025),
      secs(t, rate),
      0.4 + 0.5 * random(),
    );
  }
  mixInto(out, tear, secs(0.02, rate), 0.9);
  // Drawn out: a slide of paper on paper.
  mixInto(out, swish(rate, random, 0.3, 3000, 0.8, 0.1), secs(0.45, rate), 0.6);
  // Opened: two turns of the folds.
  for (const at of [0.85, 1.15]) {
    mixInto(out, swish(rate, random, 0.16, 2200, 0.7, 0.04), secs(at, rate), 0.7);
    mixInto(out, crinkle(rate, random, 0.16, 70), secs(at, rate), 0.6);
  }
  return out;
}

/**
 * An answer folded and sealed for the harbor master to send: the sheet creased twice,
 * slid into its envelope, the flap pressed down under the palm.
 */
export function letterSealed(rate: number, seed = 9420): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(1.5, rate));
  for (const at of [0.02, 0.34]) {
    mixInto(out, swish(rate, random, 0.18, 2600, 0.8, 0.05), secs(at, rate), 0.6);
    // The crease: a quick run of crackles under the thumbnail.
    mixInto(out, crinkle(rate, random, 0.08, 180), secs(at + 0.14, rate), 0.6);
  }
  mixInto(out, swish(rate, random, 0.32, 1900, 0.7, 0.12), secs(0.68, rate), 0.55);
  mixInto(out, lowpass(thud(rate, random, 0.12, 170), 1200, rate), secs(1.12, rate), 0.6);
  mixInto(out, swish(rate, random, 0.15, 1200, 0.7, 0.03), secs(1.1, rate), 0.3);
  return out;
}

// ---------------------------------------------------------------------------------------
// A copycat rival

/**
 * A copycat rival heard of or sighted: the fiddle plays a bold little figure and the
 * concertina mocks it back a half step flat, over a muffled drum and a low drone, ending
 * on a question. A cousin of the encounter stingers, in the same voices.
 */
export function rivalStinger(rate: number, seed = 9500): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(5, rate));
  const bpm = 132;
  const beatS = 60 / bpm;
  mixInto(out, drumHit(rate, random, 0.9, 78), 0);
  mixInto(out, drumHit(rate, random, 0.55, 78), secs(beatS * 0.5, rate));
  // The figure: a swaggering run up a D major arpeggio.
  const figure: Note[] = [
    ['D5', 0.5],
    ['F#5', 0.5],
    ['A5', 0.5],
    ['D6', 1],
  ];
  renderMelody(out, figure, bpm, 0, rate, (hz, s) => fiddleNote(hz, s, rate, random), 0.55, random);
  // The mockery: the same shape, a half step flat, on the concertina.
  const echo: Note[] = [
    ['C#5', 0.5],
    ['F5', 0.5],
    ['G#5', 0.5],
    ['C#6', 1.5],
  ];
  renderMelody(out, echo, bpm, 3, rate, (hz, s) => reedNote(hz, s, rate, random), 0.5, random);
  mixInto(out, drumHit(rate, random, 0.8, 70), secs(3 * beatS, rate));
  mixInto(out, drumHit(rate, random, 0.6, 70), secs(5 * beatS, rate));
  // Under it all, the open question: a low fifth on D with the tritone's bite at the end.
  mixInto(out, fiddleDrone(['D3', 'A3'], 2.2, rate, random, 0.4), 0, 0.45);
  mixInto(out, reedChord(['D4', 'G#4', 'C#5'], 1.2, rate, random), secs(5.4 * beatS, rate), 0.5);
  return trimTail(reverb(out, rate, 0.22, 0.82, 0.4), rate);
}

// ---------------------------------------------------------------------------------------
// A ship aground

/**
 * A ship going aground: the forefoot striking with a deep boom through the hull, the keel
 * dragging over rock and gravel and slowing, the timbers groaning, a plank cracking, and
 * the long groan as she settles.
 */
export function shipAground(rate: number, seed = 9600): Float32Array {
  const random = seeded(seed);
  const seconds = 5.5;
  const n = secs(seconds, rate);
  const out = new Float32Array(n);
  // The strike: a deep boom and the hull's shudder.
  mixInto(out, thud(rate, random, 0.9, 48), 0, 1.4);
  mixInto(out, lowpass(burst(rate, random, 0.4, 300, 0.6, 0.08), 900, rate), 0, 1.1);
  // The drag: low rumbling noise with rock grains, the scrape slowing to a stop.
  const dragS = 3.4;
  const m = secs(dragS, rate);
  const rumble = lowpass(lowpass(noise(m, random), 140, rate), 140, rate);
  const scrape = bandpass(noise(m, random), 700, 0.8, rate);
  const drag = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const u = i / m;
    const speed = (1 - u) ** 1.4;
    drag[i] =
      (4 * (rumble[i] as number) + 0.35 * (scrape[i] as number) * speed) *
      smooth(u / 0.05) *
      (1 - smooth((u - 0.8) / 0.2));
  }
  mixInto(out, drag, secs(0.1, rate), 1);
  for (let t = 0.12; t < 0.12 + dragS * 0.85;) {
    const u = (t - 0.12) / dragS;
    mixInto(
      out,
      burst(rate, random, 0.03, 600 + 1400 * random(), 2, 0.006),
      secs(t, rate),
      (0.25 + 0.4 * random()) * (1 - u),
    );
    t += 0.01 + 0.08 * u + 0.02 * random();
  }
  // The timbers: groans and a plank giving.
  mixInto(out, creak(rate, random, 1.6, 45, 110), secs(0.5, rate), 0.35);
  mixInto(out, burst(rate, random, 0.35, 1800, 0.6, 0.05), secs(1.6, rate), 0.8);
  mixInto(out, thud(rate, random, 0.3, 120), secs(1.6, rate), 0.6);
  mixInto(out, creak(rate, random, 2, 35, 80), secs(3.3, rate), 0.35);
  return trimTail(reverb(lowpass(out, 6000, rate), rate, 0.18, 0.8, 0.4), rate);
}

/**
 * Her crew as she strikes: men shouting the alarm across her deck and the ship's bell rung
 * hard and fast, a few strokes.
 */
export function agroundCrew(rate: number, seed = 9610): Float32Array {
  const random = seeded(seed);
  const out = new Float32Array(secs(4.2, rate));
  const v: Vowel[] = ['ah', 'aw', 'oh', 'eh', 'ay'];
  for (let man = 0; man < 4; man++) {
    const pitch = 150 + 70 * random();
    let t = 0.1 + 0.3 * man + 0.2 * random();
    for (let k = 0; k < 3 && t < 3.4; k++) {
      const len = 0.25 + 0.25 * random();
      const a = v[Math.floor(random() * v.length)] as Vowel;
      const b = v[Math.floor(random() * v.length)] as Vowel;
      mixInto(
        out,
        syllable(
          say(0, len, pitch * (1 + 0.15 * random()), a, b, 0.8 + 0.3 * random(), k === 0),
          rate,
          random,
        ),
        secs(t, rate),
        0.35 + 0.2 * random(),
      );
      t += len + 0.15 + 0.4 * random();
    }
  }
  for (let k = 0; k < 7; k++) {
    mixInto(out, shipBell(rate, random, 640, 1.2), secs(0.35 + k * 0.33, rate), 0.35);
  }
  return trimTail(reverb(out, rate, 0.15, 0.7, 0.5), rate);
}
