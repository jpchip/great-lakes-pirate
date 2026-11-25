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
