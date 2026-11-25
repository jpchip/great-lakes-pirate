import { describe, expect, it } from 'vitest';
import {
  EN_ROULANT,
  LADY_ELGIN,
  MICHIGAN_I_O,
  MICHIGAN_I_O_S,
  SHANTY_MANS_LIFE,
  SHANTY_MANS_LIFE_S,
  enRoulant,
  enRoulantForm,
  ladyElgin,
  michiganIO,
  notes,
  shantyMansLife,
  BIGLER,
  GERRYS_ROCKS,
  LITTLE_BROWN_BULLS,
  PERSIANS_CREW,
  bigler,
  biglerForm,
  littleBrownBullsForm,
  persiansCrew,
  transpose,
  RED_IRON_ORE,
  RED_IRON_ORE_INTRO_BARS,
  RED_IRON_ORE_VERSES,
  redIronOre,
  redIronOreForm,
} from '../tools/audio/lib/synth-songs';
import { peak } from '../tools/audio/lib/synth';
import { SALOON_TUNE } from '../tools/audio/lib/synth-foot';
import { endingAir } from '../tools/audio/lib/synth-island';

const RATE = 22_050;
type Notes = readonly (readonly [string, number])[];
const beats = (notes: Notes): number => notes.reduce((s, [, b]) => s + b, 0);

describe('Red Iron Ore (Rickaby 1926, no. 45)', () => {
  it('keeps the printed tune: ten bars of 6/8 after a one-eighth pickup', () => {
    const r = RED_IRON_ORE;
    expect(beats(r.pickup)).toBe(1);
    // The last bar is short by the pickup, so a verse is a whole number of bars.
    expect(beats([...r.pickup, ...r.verse])).toBe(10 * r.beatsPerBar);
    expect(r.chords).toHaveLength(10);
    // E aeolian from D4 to E5, opening and closing on E.
    expect(r.pickup[0]?.[0]).toBe('E4');
    expect(r.verse.at(-1)?.[0]).toBe('E4');
    const pitches = new Set(r.verse.map(([p]) => p));
    expect([...pitches].sort()).toEqual(['A4', 'B4', 'C5', 'D4', 'D5', 'E4', 'E5', 'F#4', 'G4']);
    expect(r.source).toMatch(/Rickaby.*1926.*no\. 45/);
  });

  it('lines the parts up with one chord per half bar', () => {
    const { concertina, whistle, chords } = redIronOreForm();
    const r = RED_IRON_ORE;
    const verse = beats([...r.pickup, ...r.verse]);
    const lead = RED_IRON_ORE_INTRO_BARS * r.beatsPerBar - 1;
    // Concertina, whistle, concertina; the last note held a bar.
    expect(beats(concertina)).toBe(lead + RED_IRON_ORE_VERSES * verse + 4);
    expect(beats(whistle)).toBe(lead + 2 * verse);
    // Intro, three verses and a ringing chord.
    expect(chords).toHaveLength(2 * RED_IRON_ORE_INTRO_BARS + RED_IRON_ORE_VERSES * 20 + 2);
    expect(chords.length * 3).toBeGreaterThanOrEqual(beats(concertina));
  });

  it('renders about a minute of music', () => {
    const music = redIronOre(RATE);
    const seconds = music.length / RATE;
    expect(seconds).toBeGreaterThan(55);
    expect(seconds).toBeLessThan(75);
    expect(peak(music)).toBeGreaterThan(0.05);
  }, 60_000);
});

const sumOf = (notes: Notes): number => notes.reduce((s, [, b]) => s + b, 0);
/** Every bar line falls between notes: no note crosses one. */
function wholeBars(notes: Notes, perBar: number): number {
  let acc = 0;
  let bars = 0;
  for (const [, b] of notes) {
    acc += b;
    expect(acc).toBeLessThanOrEqual(perBar + 1e-9);
    if (Math.abs(acc - perBar) < 1e-9) {
      acc = 0;
      bars++;
    }
  }
  expect(acc).toBe(0);
  return bars;
}

describe('the rest of the shortlist (plan 15 §25)', () => {
  it('keeps each printed tune in whole bars and names its page in Rickaby', () => {
    expect(wholeBars(BIGLER.verse, 6)).toBe(16);
    expect(wholeBars([...BIGLER.chorus, ...BIGLER.chorusEnd], 6)).toBe(16);
    expect(wholeBars([...PERSIANS_CREW.verse, ['F4', 6]], 6)).toBe(16);
    expect(wholeBars(LITTLE_BROWN_BULLS.tune, 6)).toBe(10);
    expect(wholeBars([...GERRYS_ROCKS.pickup, ...GERRYS_ROCKS.tune], 4)).toBe(16);
    expect(BIGLER.source).toMatch(/Rickaby.*1926.*no\. 47.*p\. 168/);
    expect(PERSIANS_CREW.source).toMatch(/no\. 46.*p\. 164/);
    expect(LITTLE_BROWN_BULLS.source).toMatch(/no\. 13.*p\. 65/);
    expect(GERRYS_ROCKS.source).toMatch(/no\. 2.*p\. 15/);
  });

  it('lines the chart arrangement up with a chord a bar', () => {
    const { concertina, whistle, chords } = biglerForm();
    expect(chords).toHaveLength(50);
    expect(sumOf(concertina)).toBe(50 * 6);
    expect(sumOf(whistle)).toBe(50 * 6);
  });

  it('loops the saloon tune in twenty bars with a chord a half bar', () => {
    const { melody, chords } = littleBrownBullsForm();
    expect(sumOf(melody)).toBe(SALOON_TUNE.bars * SALOON_TUNE.beatsPerBar);
    expect(chords).toHaveLength(SALOON_TUNE.bars * 2);
  });

  it("moves Gerry's Rocks up a tone into D for the ending", () => {
    expect(
      transpose(
        [
          ['C4', 1],
          ['B3', 1],
          ['F4', 1],
          ['C5', 1],
        ],
        2,
      ),
    ).toEqual([
      ['D4', 1],
      ['C#4', 1],
      ['G4', 1],
      ['D5', 1],
    ]);
    const { notes } = endingAir();
    expect(notes[0]).toEqual(['A4', 1]);
    expect(notes.at(-1)).toEqual(['D4', 3]);
  });

  it('renders the chart and night cues to about a minute and a half', () => {
    for (const [name, x] of [
      ['bigler', bigler(RATE)],
      ['persian', persiansCrew(RATE)],
    ] as const) {
      expect(x.length / RATE, name).toBeGreaterThan(80);
      expect(x.length / RATE, name).toBeLessThan(105);
      expect(peak(x), name).toBeGreaterThan(0.05);
    }
  }, 60_000);
});

describe('the alternates (plan 15 §25.2)', () => {
  it('reads "pitch:beats" words, bar lines ignored', () => {
    expect(notes('E4:1 | G4:0.5 R:2')).toEqual([
      ['E4', 1],
      ['G4', 0.5],
      ['R', 2],
    ]);
    expect(() => notes('E4')).toThrow();
  });

  it('keeps every tune to whole bars', () => {
    // En roulant: refrain, verse twice, the ducks, refrain, the closing rest: twenty bars.
    expect(beats(enRoulantForm())).toBe(20 * EN_ROULANT.beatsPerBar);
    expect(EN_ROULANT.chords).toHaveLength(40);
    expect(beats(LADY_ELGIN.verse)).toBe(12 * LADY_ELGIN.beatsPerBar);
    expect(beats(LADY_ELGIN.chorus)).toBe(6 * LADY_ELGIN.beatsPerBar);
    expect(beats(SHANTY_MANS_LIFE.tune)).toBe(28 * SHANTY_MANS_LIFE.beatsPerBar);
    expect(SHANTY_MANS_LIFE.chords).toHaveLength(28);
    expect(beats(MICHIGAN_I_O.tune)).toBe(16 * MICHIGAN_I_O.beatsPerBar);
    expect(MICHIGAN_I_O.chords).toHaveLength(32);
  });

  it('names each printed source', () => {
    expect(EN_ROULANT.source).toMatch(/Gagnon.*1865.*p\. 12/);
    expect(LADY_ELGIN.source).toMatch(/Work.*1861/);
    expect(SHANTY_MANS_LIFE.source).toMatch(/no\. 9.*p\. 43/);
    expect(MICHIGAN_I_O.source).toMatch(/no\. 8.*p\. 41/);
  });

  it('renders the open-water cues to about a minute', () => {
    for (const [name, x] of [
      ['roulant', enRoulant(RATE)],
      ['elgin', ladyElgin(RATE)],
    ] as const) {
      expect(x.length / RATE, name).toBeGreaterThan(55);
      expect(x.length / RATE, name).toBeLessThan(75);
      expect(peak(x), name).toBeGreaterThan(0.05);
    }
  }, 60_000);

  it('renders the saloon loops to exactly one time through', () => {
    for (const [name, x, s] of [
      ['shanty', shantyMansLife(RATE), SHANTY_MANS_LIFE_S],
      ['michigan', michiganIO(RATE), MICHIGAN_I_O_S],
    ] as const) {
      expect(x.length, name).toBe(Math.round(s * RATE));
      expect(peak(x), name).toBeGreaterThan(0.05);
    }
  }, 60_000);
});
