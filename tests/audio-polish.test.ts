import { describe, expect, it } from 'vitest';
import { HIDEOUT_SOUND, HideoutSounds, UI_SOUND, UiCues } from '../src/audio/hideout-audio';
import { ALARM_STROKE_S, CHIME_GAP_S, NOTICE_CHIMES } from '../src/audio/hideout-mix';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { WINTER_SOUND, WinterSounds, type WinterFrame } from '../src/audio/winter-audio';
import { GRIND_FULL_HP_S, grindLevel } from '../src/audio/winter-mix';
import { COLD } from '../src/sim/cold/footing';
import { peak } from '../tools/audio/lib/synth';
import { shipLaunch } from '../tools/audio/lib/synth-hideout';
import { bearCrash } from '../tools/audio/lib/synth-island';
import { GRIND_LOOP_S, hullGrind } from '../tools/audio/lib/synth-winter';

/**
 * Plan 15's gaps closed in the polish pass: notification chimes by priority (plan 13 §7),
 * the ice grinding on a hull, a bear crashing off, and the slipway's work and launch.
 */

const RATE = 48000;

function fakeMixer(): { mixer: AudioMixer; shots: OneShot[] } {
  const shots: OneShot[] = [];
  const mixer = {
    ctx: {},
    buses: {},
    play(shot: OneShot) {
      shots.push(shot);
      return undefined;
    },
  } as unknown as AudioMixer;
  return { mixer, shots };
}

function bank(ids: readonly string[]): Map<string, AudioBuffer> {
  return new Map(ids.map((id) => [id, { id, duration: 5 } as unknown as AudioBuffer]));
}

const idOf = (s: OneShot): string => (s.buffer as unknown as { id: string }).id;

describe('notification chimes by priority', () => {
  it('rings critical news as the alarm, important news as the soft bell, nothing for the rest', () => {
    expect(NOTICE_CHIMES.ReportFiled).toBe('alarm');
    expect(NOTICE_CHIMES.ShipFoundering).toBe('alarm');
    expect(NOTICE_CHIMES.HideoutSpotted).toBe('alarm');
    expect(NOTICE_CHIMES.LetterReceived).toBe('chimeSoft');
    // Events with a sound of their own aren't here, so nothing rings twice.
    expect(Object.keys(NOTICE_CHIMES)).not.toContain('WantedTierChanged');
    expect(Object.keys(NOTICE_CHIMES)).not.toContain('ProductionCompleted');
  });

  it('strikes the alarm twice, low and close, and lets it cut in on a bell but not the reverse', () => {
    const { mixer, shots } = fakeMixer();
    let t = 0;
    const ui = new UiCues(mixer, bank(Object.values(UI_SOUND)), () => t);
    ui.play('chimeSoft');
    ui.play('alarm');
    ui.play('chimeSoft');
    expect(shots.map(idOf)).toEqual([
      UI_SOUND.chimeSoft,
      UI_SOUND.chimeBright,
      UI_SOUND.chimeBright,
    ]);
    expect(shots[1]?.rate).toBeLessThan(1);
    expect(shots[2]?.delay).toBeCloseTo(ALARM_STROKE_S);
    ui.play('alarm');
    expect(shots).toHaveLength(3);
    t += CHIME_GAP_S + 0.1;
    ui.play('alarm');
    expect(shots).toHaveLength(5);
  });
});

describe('the ice grinding on her hull', () => {
  it('is silent with no damage and grows fuller, brighter and quicker the harder she is driven', () => {
    expect(grindLevel(0).gain).toBe(0);
    const crawl = grindLevel(0.1);
    const hard = grindLevel(GRIND_FULL_HP_S);
    expect(crawl.gain).toBeGreaterThan(0);
    expect(hard.gain).toBeGreaterThan(crawl.gain);
    expect(hard.lowpassHz).toBeGreaterThan(crawl.lowpassHz);
    expect(hard.knockEveryS ?? Infinity).toBeLessThan(crawl.knockEveryS ?? 0);
  });

  it('plays the grind bed and knocks while afloat and grinding, and lets them go when she stops', () => {
    const { mixer, shots } = fakeMixer();
    const s = new WinterSounds(
      mixer,
      bank(Object.values(WINTER_SOUND).flat()),
      COLD.thin,
      () => 0.5,
    );
    const f: WinterFrame = {
      nowS: 0,
      listener: { x: 0, y: 2, z: 0 },
      airC: -8,
      windKn: 10,
      month0: 0,
      sunElevationDeg: 10,
      iceCover01: 0.8,
      harborDistanceM: 5000,
      inside: false,
      swimming: false,
      body: undefined,
    };
    const dt = 1 / 30;
    for (let t = 0; t < 4; t += dt) {
      s.grinding(0.8 * dt);
      s.update(f, dt);
    }
    expect(s.levels.beds.grind).toBeGreaterThan(0.5);
    const knocks = shots.filter((x) => WINTER_SOUND.crack.includes(idOf(x) as never)).length;
    expect(knocks).toBeGreaterThanOrEqual(2);
    for (let t = 0; t < 3; t += dt) s.update(f, dt);
    expect(s.levels.beds.grind).toBe(0);
  });
});

describe('the slipway', () => {
  it('hears work on the ways as the yard, and a launch after the days of building', () => {
    const { mixer, shots } = fakeMixer();
    const ids = [...Object.values(HIDEOUT_SOUND).flat()];
    const h = new HideoutSounds(mixer, bank(ids), () => 0.5);
    h.onTheWays('repair', 6 * 3600);
    expect(shots.some((x) => idOf(x) === HIDEOUT_SOUND.work)).toBe(true);
    expect(shots.some((x) => idOf(x) === HIDEOUT_SOUND.saw)).toBe(true);
    shots.length = 0;
    h.launched(7 * 86_400);
    const launch = shots.find((x) => idOf(x) === HIDEOUT_SOUND.launch);
    expect(launch).toBeDefined();
    expect(launch?.delay ?? 0).toBeGreaterThan(h.levels.workBedS);
    expect(h.levels.launches).toBe(1);
  });
});

describe('the synthesis', () => {
  it.each([
    ['hull grind', hullGrind(RATE)],
    ['bear crash', bearCrash(RATE)],
    ['launch', shipLaunch(RATE)],
  ])('%s is finite and audible', (_, x) => {
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.05);
  });

  it('folds the grind to its loop length, and renders the same samples twice', () => {
    expect(hullGrind(RATE).length).toBe(Math.round(GRIND_LOOP_S * RATE));
    expect(bearCrash(RATE)).toEqual(bearCrash(RATE));
  });
});
