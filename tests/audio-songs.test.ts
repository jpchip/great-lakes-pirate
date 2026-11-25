import { describe, expect, it } from 'vitest';
import {
  RED_IRON_ORE,
  RED_IRON_ORE_INTRO_BARS,
  RED_IRON_ORE_VERSES,
  redIronOre,
  redIronOreForm,
} from '../tools/audio/lib/synth-songs';
import { peak } from '../tools/audio/lib/synth';

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
