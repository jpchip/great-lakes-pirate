/**
 * Traditional Great Lakes song motifs (plan 15 §2 "Song tradition"): public-domain melodies,
 * transcribed note for note from a printed source and arranged here for the game's own
 * synthesized instruments. The arrangement is original (CC BY 4.0 like the rest of the repo);
 * the melody's source is named beside each tune so the credit can say where it came from.
 *
 * Sources must be printed before 1931 and come from the book itself, never from a modern
 * songbook or a recording (see the "Great Lakes song motifs" research, plan 15 §2).
 */

import {
  CHORDS,
  fiddleDrone,
  mixInto,
  noteHz,
  pluckNote,
  reedNote,
  renderMelody,
  reverb,
  seeded,
  whistleNote,
  type Note,
} from './synth.ts';

/**
 * "Red Iron Ore" (Laws D9, Roud 2233), the ore-boat ballad of the schooner E. C. Roberts:
 * Chicago to Escanaba for iron ore and down the lakes to Cleveland. Melody as printed in
 * Franz Rickaby, *Ballads and Songs of the Shanty-Boy* (Harvard University Press, 1926),
 * no. 45, p. 161, "sung by Mr. M. C. Dean, Virginia, Minnesota". 6/8, one sharp, ending on
 * E: E aeolian. Beats are eighth notes.
 *
 * The book's fermatas (on "go", "shore", the refrain's second "down" and the last note) are
 * sung holds; an instrumental keeps strict time through all but the last.
 */
export const RED_IRON_ORE = {
  source:
    'Franz Rickaby, Ballads and Songs of the Shanty-Boy (Harvard University Press, 1926), no. 45 "Red Iron Ore", p. 161',
  /** Eighth notes a minute: a dotted quarter at 68, a sailing pace. */
  bpm: 204,
  beatsPerBar: 6,
  /** "Come" */
  pickup: [['E4', 1]] as Note[],
  /** The verse from the first downbeat; the last bar is short by the next pickup. */
  verse: [
    // all ye bold sail-ors that
    ['E4', 1],
    ['B4', 1],
    ['B4', 1],
    ['B4', 1],
    ['A4', 1],
    ['B4', 1],
    // fol-low the Lakes On an
    ['G4', 1],
    ['A4', 1.5],
    ['G4', 0.5],
    ['F#4', 2],
    ['E4', 0.5],
    ['F#4', 0.5],
    // i-ron ore ves-sel your
    ['G4', 1],
    ['F#4', 1],
    ['G4', 1],
    ['A4', 1],
    ['G4', 1],
    ['A4', 1],
    // liv-ing to make. I
    ['B4', 1],
    ['A4', 1.5],
    ['B4', 0.5],
    ['B4', 2],
    ['B4', 1],
    // shipp'd in Chi-ca-go, bid a-
    ['B4', 1],
    ['A4', 1],
    ['B4', 1],
    ['E5', 1],
    ['E5', 1],
    ['E5', 0.5],
    ['E5', 0.5],
    // -dieu to the shore, Bound a-
    ['D5', 1],
    ['B4', 1],
    ['A4', 1],
    ['B4', 1],
    ['B4', 1.5],
    ['C5', 0.5],
    // -way to Es-ca-na-ba for
    ['D5', 1],
    ['B4', 1],
    ['B4', 0.5],
    ['B4', 0.5],
    ['B4', 1],
    ['A4', 1],
    ['B4', 1],
    // red i-ron ore. Der-ry
    ['G4', 1],
    ['A4', 1],
    ['G4', 1],
    ['E4', 2],
    ['E4', 0.5],
    ['D4', 0.5],
    // down, down,
    ['E4', 3],
    ['B4', 3],
    // down der-ry down.
    ['G4', 1],
    ['E4', 1],
    ['F#4', 1],
    ['E4', 2],
  ] as Note[],
  /** One chord per half bar (dotted quarter), from the first downbeat. */
  chords: [
    ['Em', 'Em'],
    ['Em', 'D'],
    ['Em', 'D'],
    ['G', 'Em'],
    ['Em', 'C'],
    ['G', 'Em'],
    ['G', 'Em'],
    ['C', 'Em'],
    ['Em', 'G'],
    ['Em', 'Em'],
  ] as [string, string][],
} as const;

/** Verses through the tune: concertina, tin whistle an octave up, concertina. */
export const RED_IRON_ORE_VERSES = 3;
/** Bars of guitar before the first pickup. */
export const RED_IRON_ORE_INTRO_BARS = 2;

const up = (notes: readonly Note[]): Note[] =>
  notes.map(([p, b]) => [p === 'R' ? p : p.replace(/\d/, (d) => String(Number(d) + 1)), b]);

const beatsOf = (notes: readonly Note[]): number => notes.reduce((s, [, b]) => s + b, 0);

/**
 * The arrangement laid out in eighth notes from the start: the concertina's and the
 * whistle's parts (rests where the other plays) and one chord per half bar.
 */
export function redIronOreForm(): { concertina: Note[]; whistle: Note[]; chords: string[] } {
  const r = RED_IRON_ORE;
  const verse: Note[] = [...r.pickup, ...r.verse];
  const lastVerse: Note[] = [...r.pickup, ...r.verse.slice(0, -1), ['E4', 6]];
  const verseBeats = beatsOf(verse);
  const lead: Note[] = [['R', RED_IRON_ORE_INTRO_BARS * r.beatsPerBar - beatsOf(r.pickup)]];
  const rest: Note[] = [['R', verseBeats]];
  const concertina = [...lead, ...verse, ...rest, ...lastVerse];
  const whistle = [...lead, ...rest, ...up(verse)];
  const intro = Array.from({ length: RED_IRON_ORE_INTRO_BARS * 2 }, () => 'Em');
  const tune = r.chords.flat();
  const chords = [...intro, ...tune, ...tune, ...tune, 'Em', 'Em'];
  return { concertina, whistle, chords };
}

/**
 * Open-water music by day: "Red Iron Ore" on concertina, then the tin whistle with a low
 * fiddle drone, then the concertina again, over a guitar's 6/8 boom-chick in E minor.
 */
export function redIronOre(rate: number, seed = 1871): Float32Array {
  const random = seeded(seed);
  const r = RED_IRON_ORE;
  const { concertina, whistle, chords } = redIronOreForm();
  const beatS = 60 / r.bpm;
  const halfS = 3 * beatS;
  const seconds = chords.length * halfS + 3;
  const out = new Float32Array(Math.round(seconds * rate));
  renderMelody(
    out,
    concertina,
    r.bpm,
    0,
    rate,
    (hz, s) => reedNote(hz, s, rate, random),
    1,
    random,
  );
  renderMelody(
    out,
    whistle,
    r.bpm,
    0,
    rate,
    (hz, s) => whistleNote(hz, s, rate, random),
    0.6,
    random,
  );
  // A fiddle drone on E and B under the whistle's verse.
  const verseS = beatsOf([...r.pickup, ...r.verse]) * beatS;
  const whistleAt = (RED_IRON_ORE_INTRO_BARS * r.beatsPerBar - 1 + verseS / beatS) * beatS;
  mixInto(
    out,
    fiddleDrone(['E3', 'B3'], verseS + halfS, rate, random, 2),
    Math.round(whistleAt * rate),
    0.4,
  );
  // Guitar: the bass on each dotted quarter, the chord on the two eighths after it.
  chords.forEach((name, half) => {
    const chord = CHORDS[name];
    if (!chord) throw new Error(`chord ${name}`);
    const at = half * halfS;
    const last = half === chords.length - 1;
    mixInto(
      out,
      pluckNote(noteHz(chord.bass), last ? 3 : halfS, rate, random, 0.35),
      Math.round((at + (random() - 0.5) * 0.01) * rate),
      0.5,
    );
    const strums = last ? [0.03] : [beatS, 2 * beatS];
    for (const s of strums) {
      chord.tones.forEach((tone, k) => {
        const t = at + s + k * 0.012 + (random() - 0.5) * 0.008;
        const len = last ? 3 : beatS * 0.9;
        mixInto(out, pluckNote(noteHz(tone), len, rate, random, 0.6), Math.round(t * rate), 0.2);
      });
    }
  });
  return reverb(out, rate, 0.22, 0.78);
}

// ---------------------------------------------------------------------------------------
// The rest of the shortlist (plan 15 §25). Each tune below is the book's melody note for
// note; durations are in the tune's own beat (eighths for 6/8, quarters for cut time).

const RICKABY =
  'Franz Rickaby, Ballads and Songs of the Shanty-Boy (Harvard University Press, 1926)';

/** The chords the arrangements use: the open-water set plus a few more. */
const SONG_CHORDS: Record<string, { bass: string; tones: string[] }> = {
  ...CHORDS,
  Am: { bass: 'A2', tones: ['A3', 'C4', 'E4'] },
};

/** Every note an octave (or `n` octaves) higher. */
export function octave(notes: readonly Note[], n = 1): Note[] {
  return notes.map(([p, b]) => [
    p === 'R' ? p : p.replace(/-?\d$/, (d) => String(Number(d) + n)),
    b,
  ]);
}

/**
 * A guitar under a tune: one chord per `unit` beats, the bass string on the first beat and
 * the chord on each beat after it (6/8 "oom-pah-pah" with a unit of 3, "boom-chick" with
 * a unit of 6 strums only beat 4). The last chord rings.
 */
function guitar(
  out: Float32Array,
  chords: readonly string[],
  unit: number,
  strumAt: readonly number[],
  bpm: number,
  startBeat: number,
  rate: number,
  random: () => number,
  gain = 1,
): void {
  const beatS = 60 / bpm;
  chords.forEach((name, k) => {
    const chord = SONG_CHORDS[name];
    if (!chord) throw new Error(`chord ${name}`);
    const at = (startBeat + k * unit) * beatS;
    const last = k === chords.length - 1;
    const bassLen = last ? 3 : unit * beatS;
    mixInto(
      out,
      pluckNote(noteHz(chord.bass), bassLen, rate, random, 0.35),
      Math.round((at + (random() - 0.5) * 0.01) * rate),
      0.5 * gain,
    );
    for (const s of last ? [0.03 / beatS] : strumAt) {
      chord.tones.forEach((tone, i) => {
        const t = at + s * beatS + i * 0.012 + (random() - 0.5) * 0.008;
        const len = last ? 3 : beatS * 0.9;
        mixInto(
          out,
          pluckNote(noteHz(tone), len, rate, random, 0.6),
          Math.round(t * rate),
          0.2 * gain,
        );
      });
    }
  });
}

const beatsOfNotes = (notes: readonly Note[]): number => notes.reduce((s, [, b]) => s + b, 0);

/**
 * "The Bigler's Crew" (Laws D8), the schooner John Bigler's trip from Milwaukee to Buffalo:
 * Rickaby no. 47, p. 168, "sung by Mr. M. C. Dean, Virginia, Minnesota". 6/8 with no key
 * signature, an F sharp in the third bar of each half, ending on D: D mixolydian. Eighths.
 * The book's chorus starts on its own line with "Watch her, catch her"; the verse's last
 * bar is a held D and a rest, filled here with the chorus's pickup.
 */
export const BIGLER = {
  source: `${RICKABY}, no. 47 "The Bigler's Crew", p. 168`,
  /** Eighths a minute: a dotted quarter at 70, an easy sailing pace. */
  bpm: 210,
  beatsPerBar: 6,
  pickup: [['D4', 1]] as Note[],
  verse: [
    // all my boys and | list-en, a | song I'll sing to | you. It's
    ['D4', 2],
    ['A4', 1],
    ['A4', 2],
    ['A4', 1],
    ['A4', 1],
    ['A4', 2],
    ['A4', 2],
    ['G4', 1],
    ['G4', 2],
    ['A4', 1],
    ['G4', 2],
    ['E4', 1],
    ['C4', 5],
    ['E4', 1],
    // all a-bout the | Big-ler, and | of her jol-ly | crew. In
    ['G4', 2],
    ['G4', 1],
    ['G4', 2],
    ['E4', 1],
    ['G4', 1],
    ['G4', 4],
    ['E4', 1],
    ['D4', 2],
    ['D4', 1],
    ['E4', 2],
    ['G4', 1],
    ['A4', 5],
    ['A4', 0.5],
    ['A4', 0.5],
    // Mil-wau-kee last Oc- | -to-ber I | chanc'd to get a | sight In the
    ['D4', 2],
    ['D4', 1],
    ['F#4', 2],
    ['G4', 1],
    ['A4', 1],
    ['D5', 4],
    ['E5', 1],
    ['D5', 2],
    ['C5', 1],
    ['A4', 2],
    ['C5', 1],
    ['C5', 5],
    ['E4', 0.5],
    ['E4', 0.5],
    // schoon-er call'd the | Big-ler be- | -long-ing to De- | -troit. (Watch)
    ['E4', 2],
    ['F4', 1],
    ['E4', 2],
    ['D4', 1],
    ['D4', 1],
    ['A4', 4],
    ['G4', 1],
    ['A4', 2],
    ['A4', 1],
    ['G4', 2],
    ['E4', 1],
    ['D4', 5],
    ['A4', 1],
  ] as Note[],
  /** The chorus from its first downbeat, without its last bar. */
  chorus: [
    // her, catch | her, jump | up on her jub-er- | -ju,
    ['D4', 5],
    ['A4', 1],
    ['D4', 5],
    ['E4', 1],
    ['G4', 1],
    ['G4', 1],
    ['G4', 1],
    ['G4', 2],
    ['E4', 1],
    ['C4', 5],
    ['R', 1],
    // Give her the sheet and | let her slide, The | boys will push her | through. You
    ['G4', 1],
    ['G4', 1],
    ['G4', 1],
    ['G4', 2],
    ['E4', 1],
    ['G4', 2],
    ['G4', 1],
    ['G4', 2],
    ['E4', 1],
    ['D4', 2],
    ['D4', 1],
    ['D4', 2],
    ['G4', 1],
    ['A4', 5],
    ['D4', 1],
    // ought to seen us | howl-ing, The | winds were blow-ing | free, On our
    ['D4', 2],
    ['E4', 1],
    ['F#4', 2],
    ['G4', 1],
    ['A4', 1],
    ['D5', 4],
    ['E5', 1],
    ['D5', 2],
    ['C5', 1],
    ['A4', 2],
    ['C5', 1],
    ['C5', 5],
    ['E4', 0.5],
    ['E4', 0.5],
    // pas-sage down to | Buf-fa-lo.. from | Mil-wau- | (kee.)
    ['E4', 2],
    ['F4', 1],
    ['E4', 2],
    ['D4', 1],
    ['D4', 0.5],
    ['D4', 0.5],
    ['A4', 4],
    ['G4', 1],
    ['A4', 3],
    ['D4', 3],
  ] as Note[],
  /** The chorus's last bar going round again (with the pickup), and to finish. */
  chorusAgain: [
    ['D4', 5],
    ['A4', 1],
  ] as Note[],
  chorusEnd: [['D4', 6]] as Note[],
  /** One chord a bar for the verse and the chorus (sixteen each). */
  verseChords: ['D', 'D', 'C', 'C', 'G', 'C', 'D', 'D', 'D', 'D', 'Am', 'C', 'C', 'D', 'Am', 'D'],
  chorusChords: ['D', 'D', 'C', 'C', 'C', 'C', 'D', 'D', 'D', 'D', 'Am', 'C', 'C', 'D', 'D', 'D'],
} as const;

/** The chart's arrangement in eighths: concertina verse and chorus, the whistle's chorus. */
export function biglerForm(): { concertina: Note[]; whistle: Note[]; chords: string[] } {
  const b = BIGLER;
  const intro: Note[] = [['R', 2 * b.beatsPerBar - 1]];
  const sung: Note[] = [...b.pickup, ...b.verse, ...b.chorus, ...b.chorusAgain];
  const concertina: Note[] = [...intro, ...sung, ['R', 16 * b.beatsPerBar]];
  const whistle: Note[] = [
    ['R', beatsOfNotes(intro) + beatsOfNotes(sung)],
    ...octave([...b.chorus, ...b.chorusEnd]),
  ];
  const chords = ['D', 'D', ...b.verseChords, ...b.chorusChords, ...b.chorusChords];
  return { concertina, whistle, chords };
}

/**
 * Chart music: "The Bigler's Crew". Two bars of guitar, the verse and chorus on concertina,
 * then the chorus again on tin whistle an octave up over a D and A fiddle drone, all over
 * a 6/8 boom-chick.
 */
export function bigler(rate: number, seed = 1866): Float32Array {
  const random = seeded(seed);
  const b = BIGLER;
  const { concertina, whistle, chords } = biglerForm();
  const beatS = 60 / b.bpm;
  const out = new Float32Array(Math.round((chords.length * b.beatsPerBar * beatS + 3) * rate));
  renderMelody(
    out,
    concertina,
    b.bpm,
    0,
    rate,
    (hz, s) => reedNote(hz, s, rate, random),
    0.9,
    random,
  );
  renderMelody(
    out,
    whistle,
    b.bpm,
    0,
    rate,
    (hz, s) => whistleNote(hz, s, rate, random),
    0.55,
    random,
  );
  const whistleBars = 16;
  const droneAt = (chords.length - whistleBars) * b.beatsPerBar * beatS;
  mixInto(
    out,
    fiddleDrone(['D3', 'A3'], whistleBars * b.beatsPerBar * beatS, rate, random, 2.5),
    Math.round(droneAt * rate),
    0.4,
  );
  guitar(out, chords, b.beatsPerBar, [3], b.bpm, 0, rate, random);
  return reverb(out, rate, 0.22, 0.8);
}

/**
 * "The Persian's Crew" (Laws D4), an elegy for a schooner lost with all hands on Lake
 * Huron: Rickaby no. 46, version A, p. 164, "sung by Mr. M. C. Dean, Virginia, Minnesota"
 * (Rickaby notes this melody is Billy Allen's "Driving Saw-Logs on the Plover"). 6/8, one
 * flat: F major. Eighths. The book's opening pickup is printed in brackets.
 */
export const PERSIANS_CREW = {
  source: `${RICKABY}, no. 46 "The Persian's Crew" (A), p. 164`,
  /** Eighths a minute: a dotted quarter at 44, slow, for the night. */
  bpm: 132,
  beatsPerBar: 6,
  pickup: [['F4', 1]] as Note[],
  verse: [
    // and dis-mal is | the sto-ry that | I will tell to | you. A-
    ['F4', 2],
    ['G4', 1],
    ['A4', 2],
    ['A4', 1],
    ['G4', 1.5],
    ['F4', 0.5],
    ['D4', 1],
    ['G4', 1],
    ['F4', 1.5],
    ['D4', 0.5],
    ['C4', 2],
    ['D4', 1],
    ['F4', 2],
    ['F4', 1],
    ['F4', 5],
    ['A4', 1],
    // -bout the schoon-er | Per-sian, her | of-fi-cers and | crew. They
    ['A4', 1.5],
    ['G4', 0.5],
    ['A4', 1],
    ['C5', 2],
    ['C5', 1],
    ['D5', 3],
    ['C5', 2],
    ['D5', 1],
    ['F4', 2],
    ['F4', 1],
    ['G4', 1.5],
    ['F4', 0.5],
    ['D4', 1],
    ['D4', 3],
    ['R', 2],
    ['A4', 1],
    // sank be-neath the | wa-ters deep, in | life to rise no | more. Where
    ['A4', 1.5],
    ['G4', 0.5],
    ['A4', 1],
    ['C5', 2],
    ['C5', 1],
    ['D5', 2],
    ['D5', 1],
    ['C5', 2],
    ['D5', 1],
    ['F4', 2],
    ['F4', 1],
    ['G4', 1.5],
    ['F4', 0.5],
    ['D4', 1],
    ['D4', 3],
    ['R', 2],
    ['F4', 1],
    // the last line, to its end
    ['A4', 2],
    ['A4', 1],
    ['G4', 1.5],
    ['F4', 0.5],
    ['D4', 1],
    ['G4', 2],
    ['F4', 1],
    ['D4', 2],
    ['D4', 1],
    ['C4', 1],
    ['D4', 1],
    ['E4', 1],
    ['F4', 2],
    ['F4', 1],
  ] as Note[],
  /** The held last note: going round again, and to finish. */
  again: [['F4', 5]] as Note[],
  end: [['F4', 6]] as Note[],
} as const;

/**
 * Open-water music at night: "The Persian's Crew" on tin whistle an octave up, then low on
 * the concertina, over a fiddle drone on F and C.
 */
export function persiansCrew(rate: number, seed = 1868): Float32Array {
  const random = seeded(seed);
  const p = PERSIANS_CREW;
  const beatS = 60 / p.bpm;
  const lead = 2;
  const first: Note[] = [...p.pickup, ...p.verse, ...p.again];
  const second: Note[] = [...p.pickup, ...p.verse, ...p.end];
  const firstBeats = beatsOfNotes(first);
  const seconds = (lead + firstBeats + beatsOfNotes(second)) * beatS + 4;
  const out = new Float32Array(Math.round(seconds * rate));
  mixInto(out, fiddleDrone(['F3', 'C4'], seconds - 1, rate, random, 4), 0, 1);
  renderMelody(
    out,
    octave(first),
    p.bpm,
    lead,
    rate,
    (hz, s) => whistleNote(hz, s, rate, random),
    0.8,
    random,
  );
  renderMelody(
    out,
    second,
    p.bpm,
    lead + firstBeats,
    rate,
    (hz, s) => reedNote(hz, s, rate, random),
    0.7,
    random,
  );
  return reverb(out, rate, 0.3, 0.85);
}

/**
 * "The Little Brown Bulls", the Wisconsin logging song of a skidding match between two ox
 * teams: Rickaby no. 13, p. 65. 6/8, one sharp, ending on E: E aeolian, a variant of Red
 * Iron Ore's tune. Eighths. The book's opening pickup (two sixteenths on D) is moved to
 * the end of the last bar so the tune loops, and the chorus's held E gives it room.
 */
export const LITTLE_BROWN_BULLS = {
  source: `${RICKABY}, no. 13 "The Little Brown Bulls", p. 65`,
  beatsPerBar: 6,
  tune: [
    // thing on the riv-er | Mc-Clus-key did | fear When
    ['E4', 1],
    ['D4', 1],
    ['E4', 1],
    ['B4', 1],
    ['A4', 1],
    ['B4', 1],
    ['G4', 1],
    ['E4', 1],
    ['F#4', 1],
    ['E4', 2],
    ['D4', 1],
    ['E4', 1],
    ['D4', 1],
    ['E4', 1],
    ['G4', 1],
    ['G4', 1.5],
    ['G4', 0.5],
    ['A4', 1],
    ['G4', 1],
    ['A4', 1],
    ['B4', 2],
    ['D4', 0.5],
    ['D4', 0.5],
    ['E4', 1.5],
    ['D4', 0.5],
    ['E4', 1],
    ['G4', 2],
    ['G4', 0.5],
    ['G4', 0.5],
    ['A4', 1],
    ['G4', 1],
    ['A4', 1],
    ['B4', 2],
    ['D5', 0.5],
    ['D5', 0.5],
    ['B4', 1],
    ['B4', 1],
    ['B4', 1],
    ['B4', 1],
    ['A4', 1],
    ['G4', 0.5],
    ['G4', 0.5],
    ['G4', 1.5],
    ['B4', 0.5],
    ['G4', 1],
    ['F#4', 1],
    ['E4', 1],
    ['D4', 1],
    // Chorus: Der-ry down, down, | down der-ry down.
    ['E4', 3],
    ['B4', 3],
    ['A4', 1],
    ['G4', 1],
    ['F#4', 1],
    ['E4', 2],
    ['D4', 0.5],
    ['D4', 0.5],
  ] as Note[],
  /** One chord a half bar. */
  chords: [
    'Em',
    'Em',
    'Em',
    'D',
    'Em',
    'G',
    'D',
    'Em',
    'Em',
    'G',
    'D',
    'Em',
    'G',
    'D',
    'G',
    'D',
    'Em',
    'Em',
    'D',
    'Em',
  ],
} as const;

/**
 * "The Booth Street Polka" (the original placeholder) is gone; the saloon's day tune is
 * The Little Brown Bulls twice through on concertina, an octave up, over a guitar's
 * oom-pah-pah. See `saloonTune` in synth-foot.ts for the loop.
 */
export function littleBrownBullsForm(): { melody: Note[]; chords: string[] } {
  const t = LITTLE_BROWN_BULLS;
  return {
    melody: octave([...t.tune, ...t.tune]),
    chords: [...t.chords, ...t.chords],
  };
}

/** The saloon guitar for The Little Brown Bulls: a chord a half bar, played from `startBeat`. */
export function littleBrownBullsGuitar(
  out: Float32Array,
  bpm: number,
  rate: number,
  random: () => number,
): void {
  const { chords } = littleBrownBullsForm();
  guitar(out, [...chords, chords[0] as string], 3, [1, 2], bpm, 0, rate, random, 0.8);
}

/**
 * "Gerry's Rocks" (Laws C1, "The Jam on Gerry's Rocks"), the foreman killed breaking a log
 * jam: Rickaby no. 2, version B ("Geary's Rock"), p. 15, "sung by Mr. C. D. Donaldson, Eau
 * Claire, Wisconsin". Cut time, no key signature, ending on C. Quarters.
 */
export const GERRYS_ROCKS = {
  source: `${RICKABY}, no. 2 "Gerry's Rocks" (B, "Geary's Rock"), p. 15`,
  beatsPerBar: 4,
  pickup: [['G4', 1]] as Note[],
  tune: [
    // all you jol-ly | fel-lows wher- | -ev-er you may | be, I
    ['C4', 1],
    ['C4', 1],
    ['E4', 1],
    ['G4', 1],
    ['F4', 1],
    ['A4', 2],
    ['A4', 1],
    ['G4', 1],
    ['C4', 1],
    ['D4', 1],
    ['B3', 1],
    ['C4', 3],
    ['G4', 1],
    // hope you'll pay at- | -ten-tion and list- | -en un-to | me. It's
    ['G4', 1.5],
    ['E4', 0.5],
    ['G4', 1],
    ['A4', 0.5],
    ['B4', 0.5],
    ['C5', 1.5],
    ['B4', 0.5],
    ['C5', 1],
    ['E4', 1],
    ['F4', 1.5],
    ['G4', 0.5],
    ['A4', 1],
    ['C5', 1],
    ['G4', 3],
    ['G4', 1],
    // all a-bout some | shan-ty-boys, so | man-ly and so | brave. 'Twas
    ['G4', 1.5],
    ['E4', 0.5],
    ['G4', 1],
    ['A4', 0.5],
    ['B4', 0.5],
    ['C5', 1.5],
    ['B4', 0.5],
    ['C5', 1],
    ['E4', 1],
    ['F4', 1.5],
    ['G4', 0.5],
    ['A4', 1],
    ['C5', 1],
    ['G4', 3],
    ['G4', 1],
    // on the jam on | Gear-y's Rock where they | met their wa-ter-y | grave.
    ['C4', 1],
    ['C4', 1],
    ['E4', 1],
    ['G4', 1],
    ['F4', 1],
    ['F4', 1],
    ['A4', 1],
    ['A4', 0.5],
    ['A4', 0.5],
    ['G4', 1],
    ['C4', 1],
    ['D4', 1],
    ['C4', 0.5],
    ['C4', 0.5],
    ['C4', 3],
  ] as Note[],
} as const;

/** Moves every note by `semis` semitones (sharps only, which suits D major). */
export function transpose(notes: readonly Note[], semis: number): Note[] {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return notes.map(([p, b]) => {
    if (p === 'R') return [p, b];
    const m = /^([A-G][#b]?)(-?\d)$/.exec(p);
    if (!m) throw new Error(`bad note ${p}`);
    const flat: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
    const idx = names.indexOf(flat[m[1] as string] ?? (m[1] as string));
    const n = Number(m[2]) * 12 + idx + semis;
    return [`${names[((n % 12) + 12) % 12]}${Math.floor(n / 12)}`, b];
  });
}
