/**
 * Offline synthesis for the sounds no free library had (plan 15 §3.1: "simple synthesized
 * sounds" and procedural layers as the fallback): the lighthouse fog whistle and fog bell,
 * and open-water music v1, an original folk waltz and a slow air played by synthesized
 * concertina, guitar, tin whistle and fiddle drone. Pure functions over Float32Array at a
 * given rate, seeded so a rebuild gives the same file. tools/audio/synth.ts writes the
 * results as raw sources for the normal pipeline.
 */

export type Random = () => number;

/** mulberry32: small, fast and seedable. */
export function seeded(seed: number): Random {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;

/** Equal-tempered frequency of a note name like "F#4" or "Bb3" (A4 = 440 Hz). */
export function noteHz(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  const steps: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const accidental = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const semis = (steps[m[1] as string] as number) + accidental + (Number(m[3]) - 4) * 12;
  return 440 * 2 ** (semis / 12);
}

/** A one-pole low-pass, in place. */
export function lowpass(x: Float32Array, hz: number, rate: number): Float32Array {
  const a = 1 - Math.exp((-TAU * hz) / rate);
  let y = 0;
  for (let i = 0; i < x.length; i++) {
    y += a * ((x[i] as number) - y);
    x[i] = y;
  }
  return x;
}

/** RBJ band-pass (constant 0 dB peak), returning a new array. */
export function bandpass(x: Float32Array, hz: number, q: number, rate: number): Float32Array {
  const w = (TAU * hz) / rate;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i] as number;
    const yi = b0 * xi + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Smooth random wander in about ±1, changing at roughly `hz` (value noise, cosine-eased). */
export function wander(length: number, hz: number, rate: number, random: Random): Float32Array {
  const out = new Float32Array(length);
  const step = rate / hz;
  let a = random() * 2 - 1;
  let b = random() * 2 - 1;
  let next = step;
  for (let i = 0; i < length; i++) {
    if (i >= next) {
      a = b;
      b = random() * 2 - 1;
      next += step;
    }
    const t = 1 - (next - i) / step;
    out[i] = a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * t));
  }
  return out;
}

/** Adds `src` into `dst` from sample `at`, scaled. */
export function mixInto(dst: Float32Array, src: Float32Array, at: number, gain = 1): void {
  const start = Math.max(0, at);
  const end = Math.min(dst.length, at + src.length);
  for (let i = start; i < end; i++) dst[i] = (dst[i] as number) + (src[i - at] as number) * gain;
}

export function peak(x: Float32Array): number {
  let p = 0;
  for (const s of x) p = Math.max(p, Math.abs(s));
  return p;
}

/**
 * A lighthouse steam fog whistle (plan 15 §4.3): a deep bell whistle that sags in on the
 * steam, holds with a slight waver, and dies away when the valve shuts, with breathy
 * steam all through. `seconds` long; the blast's release starts `releaseS` before the end.
 */
export function fogWhistle(rate: number, seconds = 7, seed = 1): Float32Array {
  const random = seeded(seed);
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const f0 = 196;
  const attackS = 0.45;
  const releaseS = 0.7;
  const waver = wander(n, 5, rate, random);
  const drift = wander(n, 0.7, rate, random);
  const env = new Float32Array(n);
  const pitch = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const rise = Math.min(1, t / attackS);
    const fall = Math.min(1, Math.max(0, (seconds - t) / releaseS));
    env[i] = Math.sin((rise * Math.PI) / 2) ** 2 * fall ** 1.5;
    // Pressure builds as it opens and drops as it closes: the pitch follows it.
    pitch[i] =
      f0 *
      (0.86 + 0.14 * Math.sqrt(rise)) *
      (0.93 + 0.07 * fall) *
      (1 + 0.004 * (waver[i] as number) + 0.003 * (drift[i] as number));
  }
  const harmonics = [1, 0.62, 0.42, 0.24, 0.16, 0.09, 0.06, 0.035];
  const phases = harmonics.map(() => random() * TAU);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += (TAU * (pitch[i] as number)) / rate;
    let s = 0;
    for (let h = 0; h < harmonics.length; h++) {
      s += (harmonics[h] as number) * Math.sin((h + 1) * phase + (phases[h] as number));
    }
    out[i] = s * (env[i] as number);
  }
  // Steam: hiss shaped around the lower harmonics, louder at the start and the end.
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const breath = bandpass(white, f0 * 2, 1.2, rate);
  const hiss = bandpass(white, 3200, 0.7, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // The valve's last gasp tapers off over the final 0.15 s.
    const edge =
      Math.exp(-t / 0.25) + Math.exp(-(seconds - t) / 0.3) * Math.min(1, (seconds - t) / 0.15);
    const e = env[i] as number;
    out[i] =
      (out[i] as number) +
      1.4 * (breath[i] as number) * e +
      0.5 * (hiss[i] as number) * (0.25 * e + 0.6 * edge * Math.min(1, t / 0.05));
  }
  return lowpass(out, 6000, rate);
}

/** A steam whistle's voice (plan 15 §4.3): one bell, or a chime of several bells in one. */
export interface ShipWhistleVoice {
  /** The bells' fundamentals, Hz: one for a plain whistle, three or five for a chime. */
  notesHz: readonly number[];
  /** How fast the valve opens and shuts, seconds. */
  attackS: number;
  releaseS: number;
  /** Harmonic weights of each bell: more upper harmonics for a shriller whistle. */
  harmonics: readonly number[];
  /** Steam breath and hiss, relative to the tone. */
  steam: number;
  /** How far the pitch sags while the pressure comes up (0.14 for a big lighthouse whistle). */
  sag: number;
  /** A slow two-tone warble, cents (0 for none): the cutter's own sound. */
  warbleCents?: number;
  warbleHz?: number;
}

/**
 * A ship's steam whistle, one blast `seconds` long (cut shorter at runtime), built like
 * the lighthouse whistle: each bell an additive tone whose pitch follows the steam
 * pressure, a chime's bells a few cents apart and off in phase, and breathy steam over it.
 */
export function shipWhistle(
  rate: number,
  voice: ShipWhistleVoice,
  seconds = 5,
  seed = 3,
): Float32Array {
  const random = seeded(seed);
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const waver = wander(n, 5, rate, random);
  const drift = wander(n, 0.7, rate, random);
  const env = new Float32Array(n);
  const press = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const rise = Math.min(1, t / voice.attackS);
    const fall = Math.min(1, Math.max(0, (seconds - t) / voice.releaseS));
    env[i] = Math.sin((rise * Math.PI) / 2) ** 2 * fall ** 1.5;
    press[i] =
      (1 - voice.sag + voice.sag * Math.sqrt(rise)) * (1 - voice.sag / 2 + (voice.sag / 2) * fall);
  }
  const warble = voice.warbleCents ?? 0;
  const warbleHz = voice.warbleHz ?? 0;
  voice.notesHz.forEach((f0, b) => {
    const detune = 2 ** (((random() - 0.5) * 6) / 1200);
    const phases = voice.harmonics.map(() => random() * TAU);
    const bellGain = 1 / Math.sqrt(voice.notesHz.length);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const w = warble === 0 ? 1 : 2 ** ((warble * Math.sin(TAU * warbleHz * t + b)) / 1200);
      const hz =
        f0 *
        detune *
        (press[i] as number) *
        w *
        (1 + 0.004 * (waver[i] as number) + 0.003 * (drift[i] as number));
      phase += (TAU * hz) / rate;
      let s = 0;
      for (let h = 0; h < voice.harmonics.length; h++) {
        s += (voice.harmonics[h] as number) * Math.sin((h + 1) * phase + (phases[h] as number));
      }
      out[i] = (out[i] as number) + s * bellGain * (env[i] as number);
    }
  });
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const breath = bandpass(white, (voice.notesHz[0] as number) * 2, 1.2, rate);
  const hiss = bandpass(white, 3600, 0.7, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const edge =
      Math.exp(-t / 0.2) + Math.exp(-(seconds - t) / 0.25) * Math.min(1, (seconds - t) / 0.12);
    const e = env[i] as number;
    out[i] =
      (out[i] as number) +
      voice.steam *
        (1.2 * (breath[i] as number) * e +
          0.5 * (hiss[i] as number) * (0.25 * e + 0.6 * edge * Math.min(1, t / 0.05)));
  }
  return lowpass(out, 7000, rate);
}

/** The NPC classes' whistles (Phase 3 piece J). Pitches are by ear, not from records. */
export const SHIP_WHISTLES = {
  /** A big ore carrier: one deep bell, slow to open, lots of steam. */
  freighter: {
    notesHz: [138],
    attackS: 0.6,
    releaseS: 0.8,
    harmonics: [1, 0.7, 0.45, 0.3, 0.18, 0.1, 0.06, 0.04],
    steam: 1.3,
    sag: 0.12,
  },
  /** A package steamer's three-bell chime, a minor triad: the passenger boats' sound. */
  chime: {
    notesHz: [262, 311, 392],
    attackS: 0.35,
    releaseS: 0.5,
    harmonics: [1, 0.5, 0.3, 0.16, 0.08, 0.04],
    steam: 0.9,
    sag: 0.08,
  },
  /** A fish tug: a small, shrill bell that opens fast. */
  tug: {
    notesHz: [587],
    attackS: 0.12,
    releaseS: 0.25,
    harmonics: [1, 0.55, 0.42, 0.3, 0.2, 0.12],
    steam: 0.8,
    sag: 0.06,
  },
  /** The revenue cutter *Morrill*: a two-bell whistle with a slow warble, unlike any other. */
  cutter: {
    notesHz: [349, 415],
    attackS: 0.25,
    releaseS: 0.4,
    harmonics: [1, 0.55, 0.35, 0.2, 0.1, 0.05],
    steam: 0.8,
    sag: 0.08,
    warbleCents: 40,
    warbleHz: 2.2,
  },
} as const satisfies Record<string, ShipWhistleVoice>;

/**
 * A sailing vessel's fog horn (plan 15 §4.3): a hand-pumped reed horn, buzzy and nasal,
 * swelling as the bellows push and fading as they run out. One blast, `seconds` long.
 */
export function foghorn(rate: number, seconds = 3, seed = 4): Float32Array {
  const random = seeded(seed);
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const f0 = 233;
  const waver = wander(n, 3, rate, random);
  const maxH = Math.floor(6000 / f0);
  const offs = Array.from({ length: maxH }, () => random() * TAU);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const rise = Math.min(1, t / 0.18);
    const fall = Math.min(1, Math.max(0, (seconds - t) / 0.35));
    // The bellows: a swell through the push, a little unsteady.
    const push = (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, t / seconds))) * rise * fall ** 1.3;
    const hz = f0 * (0.97 + 0.03 * rise) * (1 + 0.006 * (waver[i] as number));
    phase += (TAU * hz) / rate;
    let s = 0;
    for (let h = 1; h <= maxH; h++) {
      const f = hz * h;
      const formant =
        1 + 1.6 * Math.exp(-(((f - 900) / 450) ** 2)) + 0.6 * Math.exp(-(((f - 2400) / 600) ** 2));
      s += (formant / h ** 0.9) * Math.sin(h * phase + (offs[h - 1] as number));
    }
    out[i] = s * push * 0.25;
  }
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const air = bandpass(white, 1400, 0.9, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const e = Math.min(1, t / 0.1) * Math.min(1, Math.max(0, (seconds - t) / 0.3));
    out[i] = (out[i] as number) + 0.12 * (air[i] as number) * e;
  }
  return lowpass(out, 5000, rate);
}

/**
 * A fog bell struck once (plan 15 §4.3): the partials of a cast bronze bell (hum, prime,
 * minor-third tierce, quint, nominal and the upper partials), each with its own decay,
 * over a short clang from the clapper.
 */
export function fogBell(rate: number, seconds = 6, seed = 2): Float32Array {
  const random = seeded(seed);
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const prime = 247;
  // [ratio to the prime, level, decay seconds]
  const partials: [number, number, number][] = [
    [0.5, 0.55, 5.5],
    [1, 0.8, 3.6],
    [1.183, 0.6, 2.6],
    [1.506, 0.32, 2],
    [2, 0.7, 1.9],
    [2.51, 0.3, 1.2],
    [2.66, 0.22, 1.1],
    [3.01, 0.25, 0.9],
    [4.07, 0.14, 0.55],
    [5.43, 0.08, 0.35],
  ];
  for (const [ratio, level, decay] of partials) {
    // A pair a few cents apart gives the slow beat a real bell has.
    const f = prime * ratio;
    const beat = 0.6 + random() * 1.2;
    const p1 = random() * TAU;
    const p2 = random() * TAU;
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const e = level * Math.exp(-t / decay);
      if (e < 1e-5) break;
      out[i] =
        (out[i] as number) +
        e * 0.5 * (Math.sin(TAU * f * t + p1) + Math.sin(TAU * (f + beat) * t + p2));
    }
  }
  // The clapper: a click of bright noise in the first few milliseconds.
  const clang = Math.round(0.03 * rate);
  const white = Float32Array.from({ length: clang }, () => random() * 2 - 1);
  const bright = bandpass(white, 2800, 1.5, rate);
  for (let i = 0; i < clang; i++) {
    out[i] = (out[i] as number) + 1.2 * (bright[i] as number) * Math.exp(-i / (0.006 * rate));
  }
  // Soften the very first sample's step.
  const attack = Math.round(0.002 * rate);
  for (let i = 0; i < attack; i++) out[i] = (out[i] as number) * (i / attack);
  return out;
}

// ---------------------------------------------------------------------------------------
// Music v1: instruments

/** A note in a part: a pitch name (or "R" for a rest) and its length in beats. */
export type Note = readonly [pitch: string, beats: number];

function envelopeAR(n: number, attack: number, release: number): Float32Array {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.min(1, i / Math.max(1, attack));
    const r = Math.min(1, (n - 1 - i) / Math.max(1, release));
    e[i] = Math.min(a, r);
  }
  return e;
}

/**
 * A free-reed note (concertina): two reeds a few cents apart, a buzzy spectrum with a
 * bump around 1.2 kHz, and the bellows' soft attack and swell. `seconds` sounding.
 */
export function reedNote(hz: number, seconds: number, rate: number, random: Random): Float32Array {
  const release = 0.07;
  const n = Math.round((seconds + release) * rate);
  const out = new Float32Array(n);
  const env = envelopeAR(n, 0.035 * rate, release * rate);
  const swell = 0.85 + 0.15 * Math.min(1, seconds / 0.6);
  const maxH = Math.max(1, Math.floor(7000 / hz));
  const amps: number[] = [];
  for (let h = 1; h <= maxH; h++) {
    const f = hz * h;
    const formant = 1 + 0.9 * Math.exp(-(((f - 1200) / 700) ** 2));
    amps.push((formant * (h % 2 === 1 ? 1 : 0.75)) / h ** 1.05);
  }
  for (const detune of [-2.5, 2.5]) {
    const f = hz * 2 ** (detune / 1200);
    const offs = amps.map(() => random() * TAU);
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      let s = 0;
      for (let h = 0; h < amps.length; h++) {
        s += (amps[h] as number) * Math.sin(TAU * f * (h + 1) * t + (offs[h] as number));
      }
      out[i] = (out[i] as number) + 0.5 * s;
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // The bellows push a little harder through a long note.
    const push =
      swell * (0.92 + 0.08 * Math.sin(Math.min(1, t / Math.max(seconds, 0.1)) * Math.PI));
    out[i] = (out[i] as number) * (env[i] as number) * push * 0.18;
  }
  return out;
}

/** A plucked steel string (guitar), Karplus–Strong with a damped, slightly bright loop. */
export function pluckNote(
  hz: number,
  seconds: number,
  rate: number,
  random: Random,
  bright = 0.5,
): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  // The loop delays by its length, less the interpolation toward the next sample, plus half
  // a sample for the averaging filter: pick both so that totals one period.
  const period = rate / hz;
  const len = Math.max(2, Math.ceil(period - 0.5));
  const frac = len + 0.5 - period;
  const line = new Float32Array(len);
  // A pick: noise low-passed by how bright the stroke is.
  let lp = 0;
  for (let i = 0; i < line.length; i++) {
    lp += (0.25 + 0.6 * bright) * (random() * 2 - 1 - lp);
    line[i] = lp;
  }
  let idx = 0;
  let prev = 0;
  const damping = 0.996;
  for (let i = 0; i < n; i++) {
    const a = line[idx] as number;
    const b = line[(idx + 1) % line.length] as number;
    // Fractional delay for tuning, then the two-point average that dulls the string.
    const v = a + (b - a) * frac;
    const next = damping * 0.5 * (v + prev);
    prev = v;
    out[i] = v;
    line[idx] = next;
    idx = (idx + 1) % line.length;
  }
  const fade = Math.round(0.05 * rate);
  for (let i = 0; i < fade && i < n; i++) out[n - 1 - i] = (out[n - 1 - i] as number) * (i / fade);
  return out;
}

/**
 * A tin whistle note: a nearly pure tone with a touch of second harmonic, breath noise,
 * and vibrato that comes in late on long notes.
 */
export function whistleNote(
  hz: number,
  seconds: number,
  rate: number,
  random: Random,
): Float32Array {
  const release = 0.09;
  const n = Math.round((seconds + release) * rate);
  const out = new Float32Array(n);
  const env = envelopeAR(n, 0.025 * rate, release * rate);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const breath = bandpass(white, hz * 1.5, 2, rate);
  let phase = random() * TAU;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const vibDepth = 0.006 * Math.min(1, Math.max(0, (t - 0.45) / 0.5));
    const f = hz * (1 + vibDepth * Math.sin(TAU * 5.4 * t));
    phase += (TAU * f) / rate;
    const chiff = Math.exp(-t / 0.03);
    const s =
      Math.sin(phase) +
      0.12 * Math.sin(2 * phase) +
      0.04 * Math.sin(3 * phase) +
      (0.05 + 0.5 * chiff) * (breath[i] as number) * 3;
    out[i] = s * (env[i] as number) * 0.3;
  }
  return out;
}

/**
 * A bowed fiddle drone: a sawtooth-like string through a few body resonances, with slow
 * bow pressure swells and a little vibrato. Fades in over `fadeS` and out over the same.
 */
export function fiddleDrone(
  notes: readonly string[],
  seconds: number,
  rate: number,
  random: Random,
  fadeS = 3,
): Float32Array {
  const n = Math.round(seconds * rate);
  const raw = new Float32Array(n);
  for (const name of notes) {
    const hz = noteHz(name);
    const maxH = Math.max(1, Math.floor(6000 / hz));
    const vib = wander(n, 1.2, rate, random);
    let phase = random() * TAU;
    for (let i = 0; i < n; i++) {
      phase += (TAU * hz * (1 + 0.0015 * (vib[i] as number))) / rate;
      let s = 0;
      for (let h = 1; h <= maxH; h++) s += Math.sin(h * phase) / h;
      raw[i] = (raw[i] as number) + s;
    }
  }
  // Body resonances of a fiddle, roughly.
  const body = new Float32Array(n);
  for (const [hz, q, g] of [
    [290, 2, 1],
    [470, 2.5, 0.8],
    [1000, 1.5, 0.5],
    [2800, 1.2, 0.45],
  ] as const) {
    mixInto(body, bandpass(raw, hz, q, rate), 0, g);
  }
  const bow = wander(n, 0.25, rate, random);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const scratch = bandpass(white, 3000, 1, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / fadeS, (seconds - t) / fadeS);
    const pressure = 0.8 + 0.2 * (bow[i] as number);
    body[i] =
      ((body[i] as number) + 0.03 * (scratch[i] as number)) * Math.max(0, fade) * pressure * 0.12;
  }
  return body;
}

/** A Freeverb-style mono reverb (eight combs into four all-passes), mixed `wet`. */
export function reverb(
  x: Float32Array,
  rate: number,
  wet = 0.2,
  room = 0.8,
  damp = 0.35,
): Float32Array {
  const scale = rate / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => Math.round(d * scale));
  const alls = [556, 441, 341, 225].map((d) => Math.round(d * scale));
  const tail = Math.round(2.5 * rate);
  const out = new Float32Array(x.length + tail);
  const wetBuf = new Float32Array(out.length);
  for (const d of combs) {
    const buf = new Float32Array(d);
    let idx = 0;
    let store = 0;
    for (let i = 0; i < out.length; i++) {
      const input = i < x.length ? (x[i] as number) * 0.015 : 0;
      const y = buf[idx] as number;
      store = y * (1 - damp) + store * damp;
      buf[idx] = input + store * room;
      idx = (idx + 1) % d;
      wetBuf[i] = (wetBuf[i] as number) + y;
    }
  }
  for (const d of alls) {
    const buf = new Float32Array(d);
    let idx = 0;
    for (let i = 0; i < out.length; i++) {
      const b = buf[idx] as number;
      const input = wetBuf[i] as number;
      wetBuf[i] = b - input;
      buf[idx] = input + b * 0.5;
      idx = (idx + 1) % d;
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = (i < x.length ? (x[i] as number) * (1 - wet) : 0) + (wetBuf[i] as number) * wet * 3;
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Music v1: the tunes. Both are original (written for this game), so they carry the repo's
// CC BY 4.0 license; the traditional-song motifs of plan 15 §2 wait for R1's check of
// which melodies are public domain.

/** Plays a melody with `voice` at `bpm`, from `startBeat`. Notes slur into each other a little. */
export function renderMelody(
  dst: Float32Array,
  notes: readonly Note[],
  bpm: number,
  startBeat: number,
  rate: number,
  voice: (hz: number, seconds: number) => Float32Array,
  gain = 1,
  humanize?: Random,
): number {
  const beatS = 60 / bpm;
  let beat = startBeat;
  for (const [pitch, beats] of notes) {
    if (pitch !== 'R') {
      const late = humanize ? (humanize() - 0.5) * 0.02 : 0;
      const at = Math.round((beat * beatS + late) * rate);
      const sound = voice(noteHz(pitch), beats * beatS * 0.97);
      mixInto(dst, sound, at, gain);
    }
    beat += beats;
  }
  return beat;
}

/** "The Chequamegon Waltz": 3/4, in D with a mixolydian turn in the B part. */
export const WALTZ = {
  bpm: 104,
  beatsPerBar: 3,
  a1: [
    ['D4', 1],
    ['F#4', 1],
    ['A4', 1],
    ['B4', 2],
    ['A4', 1],
    ['F#4', 1],
    ['A4', 1],
    ['D5', 1],
    ['E5', 2],
    ['F#5', 1],
    ['D5', 1],
    ['B4', 1],
    ['A4', 1],
    ['F#4', 2],
    ['E4', 1],
    ['D4', 1],
    ['E4', 1],
    ['F#4', 1],
    ['E4', 3],
  ] as Note[],
  a2End: [
    ['E4', 1],
    ['F#4', 1],
    ['E4', 1],
    ['D4', 3],
  ] as Note[],
  b1: [
    ['A4', 1],
    ['D5', 1],
    ['E5', 1],
    ['F#5', 2],
    ['E5', 1],
    ['D5', 1],
    ['B4', 1],
    ['A4', 1],
    ['B4', 3],
    ['G4', 1],
    ['B4', 1],
    ['D5', 1],
    ['E5', 2],
    ['D5', 1],
    ['C5', 1],
    ['B4', 1],
    ['A4', 1],
    ['A4', 3],
  ] as Note[],
  b2End: [
    ['A4', 1],
    ['F#4', 1],
    ['E4', 1],
    ['D4', 3],
  ] as Note[],
  /** One chord per bar: [bass, chord tones]. */
  chordsA: ['D', 'G', 'D', 'A', 'Bm', 'D', 'G', 'A'],
  chordsAEnd: ['A', 'D'],
  chordsB: ['D', 'D', 'G', 'G', 'G', 'Em', 'C', 'A'],
  chordsBEnd: ['A', 'D'],
} as const;

export const CHORDS: Record<string, { bass: string; tones: string[] }> = {
  D: { bass: 'D3', tones: ['A3', 'D4', 'F#4'] },
  G: { bass: 'G2', tones: ['B3', 'D4', 'G4'] },
  A: { bass: 'A2', tones: ['A3', 'C#4', 'E4'] },
  Bm: { bass: 'B2', tones: ['B3', 'D4', 'F#4'] },
  Em: { bass: 'E3', tones: ['B3', 'E4', 'G4'] },
  C: { bass: 'C3', tones: ['C4', 'E4', 'G4'] },
};

/** The waltz's bar-by-bar melody and chords, intro to final chord. */
export function waltzForm(): { melody: Note[]; chords: string[]; introBars: number } {
  const w = WALTZ;
  const aFirst = w.a1;
  const aSecond = [...w.a1.slice(0, -4), ...w.a2End];
  const bFirst = w.b1;
  const bSecond = [...w.b1.slice(0, -6), ...w.b2End];
  const chordsA1 = [...w.chordsA];
  const chordsA2 = [...w.chordsA.slice(0, 6), ...w.chordsAEnd];
  const chordsB1 = [...w.chordsB];
  const chordsB2 = [...w.chordsB.slice(0, 6), ...w.chordsBEnd];
  const introBars = 2;
  const melody: Note[] = [
    ['R', introBars * w.beatsPerBar],
    ...aFirst,
    ...aSecond,
    ...bFirst,
    ...bSecond,
    ...aFirst,
    ...aSecond,
  ];
  const chords = [
    'D',
    'A',
    ...chordsA1,
    ...chordsA2,
    ...chordsB1,
    ...chordsB2,
    ...chordsA1,
    ...chordsA2,
  ];
  return { melody, chords, introBars };
}

/** "Devils Island Air": slow, E aeolian, for the night. Beats at 58 bpm. */
export const AIR = {
  bpm: 58,
  phrases: [
    [
      ['E5', 2],
      ['G5', 1],
      ['A5', 1],
      ['B5', 3],
      ['A5', 1],
      ['G5', 1.5],
      ['F#5', 0.5],
      ['E5', 1],
      ['D5', 1],
      ['E5', 4],
    ],
    [
      ['G5', 2],
      ['A5', 1],
      ['B5', 1],
      ['D6', 2],
      ['B5', 2],
      ['A5', 1],
      ['G5', 1],
      ['A5', 1],
      ['B5', 1],
      ['A5', 4],
    ],
    [
      ['B5', 2],
      ['A5', 1],
      ['G5', 1],
      ['E5', 3],
      ['D5', 1],
      ['E5', 1],
      ['G5', 1],
      ['F#5', 1],
      ['D5', 1],
      ['E5', 4],
    ],
  ] as Note[][],
} as const;

export function airForm(): Note[] {
  const [p1, p2, p3] = AIR.phrases as [Note[], Note[], Note[]];
  return [['R', 6], ...p1, ...p2, ...p3, ['R', 8], ...p1, ...p3, ['R', 6]];
}
