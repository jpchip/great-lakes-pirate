/**
 * Phase 3 piece J, part 2 (plan 15 §6.1, §11): the chart's traveling theme, the encounter
 * stingers, and the fade-to-fog transition sound, synthesized with the same instruments
 * as open-water music v1 (tools/audio/lib/synth.ts) plus a frame drum and a ship's bell.
 * Everything here is original, so it carries the repo's CC BY 4.0 license like v1.
 */

import {
  bandpass,
  CHORDS,
  fiddleDrone,
  lowpass,
  mixInto,
  noteHz,
  peak,
  pluckNote,
  reedNote,
  renderMelody,
  reverb,
  seeded,
  wander,
  whistleNote,
  type Note,
  type Random,
} from './synth.ts';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------
// Two more voices

/**
 * A frame drum (bodhrán) stroke: a skin tone that drops in pitch as it rings down, with a
 * soft slap of filtered noise on top. `level` 0–1 scales how hard it is struck.
 */
export function drumHit(rate: number, random: Random, level = 1, pitchHz = 92): Float32Array {
  const seconds = 0.6;
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  let phase = random() * 0.2;
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const slap = bandpass(white, 900, 0.9, rate);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = pitchHz * (0.72 + 0.6 * Math.exp(-t / 0.04));
    phase += (TAU * f) / rate;
    const body = Math.exp(-t / (0.12 + 0.12 * level));
    const attack = Math.min(1, t / 0.0015);
    out[i] =
      attack *
      level *
      (body * (Math.sin(phase) + 0.25 * Math.sin(2.3 * phase)) +
        0.5 * (slap[i] as number) * Math.exp(-t / 0.018));
  }
  return out;
}

/** A soft drum roll: strokes `everyS` apart for `seconds`, swelling by `shape(t01)`. */
export function drumRoll(
  rate: number,
  random: Random,
  seconds: number,
  everyS: number,
  shape: (t01: number) => number,
  pitchHz = 80,
): Float32Array {
  const out = new Float32Array(Math.round((seconds + 0.6) * rate));
  for (let t = 0; t < seconds; t += everyS * (0.9 + 0.2 * random())) {
    const hit = drumHit(rate, random, shape(t / seconds) * (0.75 + 0.25 * random()), pitchHz);
    mixInto(out, hit, Math.round(t * rate));
  }
  return out;
}

/**
 * A ship's bell, one stroke: the partials of a small bronze bell (smaller and brighter
 * than the lighthouse fog bell) with a clapper click.
 */
export function shipBell(rate: number, random: Random, primeHz = 620, seconds = 3): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  // [ratio to the prime, level, decay seconds]
  const partials: [number, number, number][] = [
    [0.5, 0.35, 2.6],
    [1, 0.8, 1.8],
    [1.19, 0.5, 1.3],
    [1.5, 0.25, 1],
    [2, 0.55, 0.9],
    [2.52, 0.22, 0.6],
    [3.01, 0.15, 0.45],
    [4.1, 0.08, 0.25],
  ];
  for (const [ratio, level, decay] of partials) {
    const f = primeHz * ratio;
    const beat = 0.8 + random() * 1.5;
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
  const clang = Math.round(0.02 * rate);
  const white = Float32Array.from({ length: clang }, () => random() * 2 - 1);
  const bright = bandpass(white, 4200, 1.5, rate);
  for (let i = 0; i < clang; i++) {
    out[i] = (out[i] as number) + (bright[i] as number) * Math.exp(-i / (0.004 * rate));
  }
  const attack = Math.round(0.002 * rate);
  for (let i = 0; i < attack; i++) out[i] = (out[i] as number) * (i / attack);
  return out;
}

/** A chord on the concertina: all its notes at once, held `seconds`. */
function reedChord(
  notes: readonly string[],
  seconds: number,
  rate: number,
  random: Random,
): Float32Array {
  const out = new Float32Array(Math.round((seconds + 0.1) * rate));
  for (const name of notes) mixInto(out, reedNote(noteHz(name), seconds, rate, random), 0, 0.6);
  return out;
}

/** A guitar strum across a chord's tones (and its bass), `spreadS` between strings. */
function strum(
  dst: Float32Array,
  chordName: string,
  atS: number,
  seconds: number,
  rate: number,
  random: Random,
  gain = 0.22,
  spreadS = 0.014,
): void {
  const chord = chordOf(chordName);
  mixInto(
    dst,
    pluckNote(noteHz(chord.bass), seconds, rate, random, 0.4),
    Math.round(atS * rate),
    gain * 2,
  );
  chord.tones.forEach((tone, k) =>
    mixInto(
      dst,
      pluckNote(noteHz(tone), seconds, rate, random, 0.55),
      Math.round((atS + (k + 1) * spreadS) * rate),
      gain,
    ),
  );
}

// ---------------------------------------------------------------------------------------
// The chart's traveling theme: "The Long Reach"

/**
 * "The Long Reach": a calm 6/8 traveling tune in G for chart mode (plan 15 §6.1), the
 * concertina over a guitar's boom-chick, the tin whistle taking the last A part. Beats
 * are eighth notes; two bars of guitar lead in.
 */
export const REACH = {
  /** Eighth notes a minute: a dotted quarter at 60, a slow walk. */
  bpm: 180,
  beatsPerBar: 6,
  a: [
    ['D4', 2],
    ['G4', 1],
    ['B4', 2],
    ['G4', 1],
    ['A4', 2],
    ['B4', 1],
    ['C5', 2],
    ['A4', 1],
    ['B4', 3],
    ['D5', 3],
    ['C5', 2],
    ['B4', 1],
    ['A4', 3],
    ['G4', 2],
    ['B4', 1],
    ['D5', 2],
    ['B4', 1],
    ['C5', 2],
    ['E5', 1],
    ['D5', 2],
    ['B4', 1],
    ['A4', 2],
    ['G4', 1],
    ['F#4', 2],
    ['A4', 1],
  ] as Note[],
  aFirst: [
    ['A4', 3],
    ['D4', 3],
  ] as Note[],
  aSecond: [['G4', 6]] as Note[],
  b: [
    ['E5', 2],
    ['D5', 1],
    ['B4', 2],
    ['D5', 1],
    ['E5', 2],
    ['F#5', 1],
    ['G5', 3],
    ['D5', 2],
    ['B4', 1],
    ['G4', 2],
    ['B4', 1],
    ['A4', 2],
    ['B4', 1],
    ['C5', 2],
    ['D5', 1],
    ['E5', 2],
    ['D5', 1],
    ['B4', 2],
    ['D5', 1],
    ['G5', 2],
    ['F#5', 1],
    ['E5', 2],
    ['D5', 1],
    ['B4', 2],
    ['A4', 1],
    ['G4', 2],
    ['A4', 1],
  ] as Note[],
  bFirst: [
    ['B4', 3],
    ['A4', 3],
  ] as Note[],
  bSecond: [['G4', 6]] as Note[],
  /** One chord a bar. */
  chordsA: ['G', 'Am', 'G', 'D', 'G', 'C', 'D'],
  chordsAFirst: 'D',
  chordsASecond: 'G',
  chordsB: ['Em', 'Em', 'G', 'D', 'Em', 'C', 'D'],
  chordsBFirst: 'D',
  chordsBSecond: 'G',
} as const;

/** Chords the waltz didn't need. */
const MORE_CHORDS: Record<string, { bass: string; tones: string[] }> = {
  Am: { bass: 'A2', tones: ['A3', 'C4', 'E4'] },
};
function chordOf(name: string): { bass: string; tones: string[] } {
  const chord = CHORDS[name] ?? MORE_CHORDS[name];
  if (!chord) throw new Error(`chord ${name}`);
  return chord;
}

/** The tune bar by bar: [melody, chords, which bars the whistle plays]. */
export function reachForm(): { concertina: Note[]; whistle: Note[]; chords: string[] } {
  const r = REACH;
  const intro: Note[] = [['R', 2 * r.beatsPerBar]];
  const a1 = [...r.a, ...r.aFirst];
  const a2 = [...r.a, ...r.aSecond];
  const b1 = [...r.b, ...r.bFirst];
  const b2 = [...r.b, ...r.bSecond];
  const bars = (notes: Note[]): number => notes.reduce((s, [, b]) => s + b, 0) / r.beatsPerBar;
  const rest = (notes: Note[]): Note[] => [['R', bars(notes) * r.beatsPerBar]];
  // Concertina: A A B B, then rests while the whistle has the last A.
  const concertina = [...intro, ...a1, ...a2, ...b1, ...b2];
  // Whistle: an octave up, the last A part with the second ending.
  const up = (notes: Note[]): Note[] =>
    notes.map(([p, b]) => [p === 'R' ? p : p.replace(/\d/, (d) => String(Number(d) + 1)), b]);
  const whistle = [...rest(concertina), ...up(a2)];
  const ca1 = [...r.chordsA, r.chordsAFirst];
  const ca2 = [...r.chordsA, r.chordsASecond];
  const cb1 = [...r.chordsB, r.chordsBFirst];
  const cb2 = [...r.chordsB, r.chordsBSecond];
  const chords = ['G', 'D', ...ca1, ...ca2, ...cb1, ...cb2, ...ca2];
  return { concertina, whistle, chords };
}

export function chartTheme(rate: number, seed = 1679): Float32Array {
  const random = seeded(seed);
  const { concertina, whistle, chords } = reachForm();
  const beatS = 60 / REACH.bpm;
  const barS = REACH.beatsPerBar * beatS;
  const seconds = chords.length * barS + 3;
  const out = new Float32Array(Math.round(seconds * rate));
  renderMelody(
    out,
    concertina,
    REACH.bpm,
    0,
    rate,
    (hz, s) => reedNote(hz, s, rate, random),
    0.9,
    random,
  );
  renderMelody(
    out,
    whistle,
    REACH.bpm,
    0,
    rate,
    (hz, s) => whistleNote(hz, s, rate, random),
    0.55,
    random,
  );
  // Guitar: the bass on one, the chord on four (a 6/8 boom-chick), the last chord ringing.
  chords.forEach((name, bar) => {
    const chord = chordOf(name);
    const at = bar * barS;
    const last = bar === chords.length - 1;
    mixInto(
      out,
      pluckNote(noteHz(chord.bass), last ? 3 : 3 * beatS, rate, random, 0.35),
      Math.round((at + (random() - 0.5) * 0.01) * rate),
      0.5,
    );
    if (last) strum(out, name, at + 0.02, 3, rate, random, 0.24, 0.03);
    else strum(out, name, at + 3 * beatS, 2.6 * beatS, rate, random, 0.17);
  });
  // A low fiddle drone under the whistle's A, to lift the last time through.
  const whistleStart = (chords.length - 8) * barS;
  mixInto(
    out,
    fiddleDrone(['G3', 'D4'], 8 * barS, rate, random, 2.5),
    Math.round(whistleStart * rate),
    0.45,
  );
  return reverb(out, rate, 0.22, 0.8);
}

// ---------------------------------------------------------------------------------------
// Encounter stingers (plan 15 §6.1 "Stingers": short motifs)

export const STINGERS = ['sail', 'threat', 'hunted', 'squall', 'derelict', 'clear'] as const;
export type StingerName = (typeof STINGERS)[number];

/** Renders one stinger, a few seconds long with its reverb tail. */
export function stinger(name: StingerName, rate: number): Float32Array {
  const random = seeded(2000 + STINGERS.indexOf(name));
  const out = new Float32Array(Math.round(5 * rate));
  const at = (s: number): number => Math.round(s * rate);
  switch (name) {
    case 'sail': {
      // "Sail ho": a quick rising concertina figure onto a held G, the guitar strummed under it.
      const notes: Note[] = [
        ['D4', 1],
        ['G4', 1],
        ['B4', 1],
        ['D5', 1],
        ['G5', 6],
      ];
      renderMelody(out, notes, 400, 0, rate, (hz, s) => reedNote(hz, s, rate, random), 1, random);
      strum(out, 'G', 0.6, 2.4, rate, random, 0.3, 0.02);
      break;
    }
    case 'threat': {
      // Smoke on the horizon: a low drone swelling in, the whistle leaning on a minor second.
      mixInto(out, fiddleDrone(['E3', 'B3'], 4.2, rate, random, 1.2), 0, 0.9);
      mixInto(out, drumHit(rate, random, 0.7, 70), 0);
      const notes: Note[] = [
        ['R', 1],
        ['B4', 1.5],
        ['C5', 2.5],
        ['B4', 1],
        ['G4', 3],
      ];
      renderMelody(
        out,
        notes,
        140,
        0,
        rate,
        (hz, s) => whistleNote(hz, s, rate, random),
        0.7,
        random,
      );
      break;
    }
    case 'hunted': {
      // She has seen you: two hard drum strokes, a falling minor run, a diminished stab, a roll.
      mixInto(out, drumHit(rate, random, 1, 95), 0);
      mixInto(out, drumHit(rate, random, 1, 95), at(0.22));
      const run: Note[] = [
        ['R', 2],
        ['E5', 1],
        ['D5', 1],
        ['C5', 1],
        ['B4', 1],
      ];
      renderMelody(out, run, 480, 0, rate, (hz, s) => reedNote(hz, s, rate, random), 1, random);
      mixInto(out, reedChord(['B3', 'D4', 'F4', 'G#4'], 1.4, rate, random), at(1.0), 1.1);
      mixInto(out, drumHit(rate, random, 1, 95), at(1.0));
      mixInto(
        out,
        drumRoll(rate, random, 1.3, 0.07, (t) => 0.35 + 0.5 * t),
        at(1.25),
        0.8,
      );
      mixInto(out, drumHit(rate, random, 1, 85), at(2.6));
      break;
    }
    case 'squall': {
      // Black to windward: a rolling drum swelling and a drone with a dark minor third.
      mixInto(
        out,
        drumRoll(
          rate,
          random,
          3.4,
          0.06,
          (t) => Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.8,
          62,
        ),
        0,
      );
      mixInto(out, fiddleDrone(['D3', 'A3', 'F4'], 4.2, rate, random, 1.4), 0, 0.9);
      break;
    }
    case 'derelict': {
      // A hulk on the swell: one far ship's bell, and a slow whistle that doesn't resolve.
      mixInto(out, shipBell(rate, random, 520, 3.5), 0, 0.5);
      mixInto(out, fiddleDrone(['A3'], 4.4, rate, random, 1.5), 0, 0.5);
      const notes: Note[] = [
        ['R', 1.5],
        ['A4', 1.5],
        ['C5', 1.5],
        ['B4', 3],
      ];
      renderMelody(
        out,
        notes,
        100,
        0,
        rate,
        (hz, s) => whistleNote(hz, s, rate, random),
        0.7,
        random,
      );
      break;
    }
    case 'clear': {
      // Slipped away: a falling concertina phrase that comes home on G.
      const notes: Note[] = [
        ['D5', 1],
        ['C5', 1],
        ['B4', 1],
        ['A4', 1],
        ['G4', 5],
      ];
      renderMelody(out, notes, 200, 0, rate, (hz, s) => reedNote(hz, s, rate, random), 0.9, random);
      strum(out, 'D', 0, 1.2, rate, random, 0.18, 0.025);
      strum(out, 'G', 1.2, 2.6, rate, random, 0.22, 0.03);
      break;
    }
  }
  return trimTail(reverb(out, rate, 0.25, 0.78), rate);
}

/** Cuts trailing near-silence so a stinger doesn't carry dead air. */
function trimTail(x: Float32Array, rate: number): Float32Array {
  let end = x.length;
  const floor = 1e-3 * peak(x);
  while (end > 0 && Math.abs(x[end - 1] as number) < floor) end--;
  return x.slice(0, Math.min(x.length, end + Math.round(0.05 * rate)));
}

// ---------------------------------------------------------------------------------------
// The loading screen's fade to fog (plan 03 §7)

/**
 * The fade to fog: a breath of wind and sea that swells as the screen fogs over and
 * dies away, with two strokes of a ship's bell somewhere in it (a pair, as the watch
 * bell is struck).
 */
export function fogFade(rate: number, seconds = 4, seed = 1903): Float32Array {
  const random = seeded(seed);
  const n = Math.round(seconds * rate);
  const white = Float32Array.from({ length: n }, () => random() * 2 - 1);
  const sea = lowpass(Float32Array.from(white), 700, rate);
  const air = bandpass(white, 1400, 0.8, rate);
  const gust = wander(n, 1.5, rate, random);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    // In over 1.1 s, out over the rest.
    const swell = t < 1.1 ? Math.sin(((t / 1.1) * Math.PI) / 2) ** 2 : Math.exp(-(t - 1.1) / 0.9);
    const g = 0.85 + 0.15 * (gust[i] as number);
    out[i] = swell * g * (1.6 * (sea[i] as number) + 0.35 * (air[i] as number));
  }
  // Soft, not hissy: the fog muffles the top end.
  lowpass(lowpass(out, 2200, rate), 2200, rate);
  mixInto(out, shipBell(rate, random, 640, 2.6), Math.round(0.55 * rate), 0.28);
  mixInto(out, shipBell(rate, random, 640, 2.6), Math.round(0.85 * rate), 0.22);
  const tail = Math.round(0.3 * rate);
  for (let i = 0; i < tail; i++) out[n - 1 - i] = (out[n - 1 - i] as number) * (i / tail);
  return reverb(out, rate, 0.18, 0.75).slice(0, n);
}
