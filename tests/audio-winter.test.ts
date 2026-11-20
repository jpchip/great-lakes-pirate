import { describe, expect, it } from 'vitest';
import { CaptionFeed } from '../src/audio/captions';
import { FOOT_SOUND } from '../src/audio/foot-audio';
import { stepGain } from '../src/audio/foot-mix';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import {
  WINTER_SOUND,
  WinterSounds,
  type WinterBody,
  type WinterFrame,
} from '../src/audio/winter-audio';
import {
  SQUEAK_BELOW_C,
  chatterEveryS,
  frozenHarbor,
  gustEveryS,
  gustGain,
  iceBoomEveryS,
  iceBoomHeard,
  runnerLevel,
  shiverEveryS,
  snowShare,
  thinIceSound,
  winterStep,
  winterWind,
  winterness,
} from '../src/audio/winter-mix';
import { COLD } from '../src/sim/cold/footing';
import { peak } from '../tools/audio/lib/synth';
import {
  FROZEN_NIGHT_S,
  RUNNERS_LOOP_S,
  WINTER_WIND_S,
  chirp,
  frozenNight,
  iceBreak,
  iceCrack,
  iceGroan,
  iceHaul,
  iceSing,
  sledLoad,
  sledRunners,
  stepIce,
  stepSqueak,
  teethChatter,
  winterGust,
  winterWind as winterWindBed,
} from '../tools/audio/lib/synth-winter';
import { seeded } from '../tools/audio/lib/synth';

const RATE = 48000;
const random = (): number => 0.5;

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

function fakeBank(): Map<string, AudioBuffer> {
  const ids = [
    ...Object.values(WINTER_SOUND).flat(),
    'sfx.foot.step-snow-1',
    'sfx.foot.step-snow-2',
    FOOT_SOUND.shiver,
    FOOT_SOUND.splash,
    FOOT_SOUND.rope,
    FOOT_SOUND.crateDown,
    FOOT_SOUND.crateLift,
  ];
  return new Map(ids.map((id) => [id, { id, duration: 5 } as unknown as AudioBuffer]));
}

const idOf = (s: OneShot): string => (s.buffer as unknown as { id: string }).id;

function sounds(): { s: WinterSounds; shots: OneShot[]; captions: CaptionFeed } {
  const { mixer, shots } = fakeMixer();
  const s = new WinterSounds(mixer, fakeBank(), COLD.thin, random);
  const captions = new CaptionFeed();
  s.captions = captions;
  return { s, shots, captions };
}

const body = (o: Partial<WinterBody> = {}): WinterBody => ({
  stage: 'warm',
  onIce: false,
  thin: 'sound',
  stress: 0,
  moving: true,
  snowLies: true,
  sled: undefined,
  ...o,
});

const frame = (o: Partial<WinterFrame> = {}): WinterFrame => ({
  nowS: 0,
  listener: { x: 0, y: 1.7, z: 0 },
  airC: -12,
  windKn: 15,
  month0: 0,
  sunElevationDeg: 20,
  iceCover01: 1,
  harborDistanceM: 5000,
  inside: false,
  swimming: false,
  body: body(),
  ...o,
});

/** Runs `seconds` of frames at 30 fps. */
function run(s: WinterSounds, seconds: number, f: (t: number) => WinterFrame): void {
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) s.update(f(t), dt);
}

describe('the season and the wind (Phase 9 piece N)', () => {
  it('is winter with cold air or ice about, and never in summer', () => {
    expect(winterness(-10, 0, 0)).toBeCloseTo(1);
    expect(winterness(5, 0.9, 2)).toBeCloseTo(0.9);
    expect(winterness(5, 0, 1)).toBe(0);
    expect(winterness(-10, 1, 6)).toBe(0);
    expect(winterness(-10, 1, 9)).toBeCloseTo(0.5);
  });

  it('lets snow fall without a sound and rain patter', () => {
    expect(snowShare(5)).toBe(0);
    expect(snowShare(-5)).toBe(1);
    expect(snowShare(0)).toBeGreaterThan(0);
    expect(snowShare(0)).toBeLessThan(1);
  });

  it('blows harder with the wind, and only a moan through a wall', () => {
    const calm = winterWind(2, 1, false);
    const gale = winterWind(35, 1, false);
    expect(gale.gain).toBeGreaterThan(calm.gain);
    expect(gale.lowpassHz).toBeGreaterThan(calm.lowpassHz);
    expect(calm.gain).toBeGreaterThan(0.1);
    const inside = winterWind(35, 1, true);
    expect(inside.gain).toBeLessThan(gale.gain * 0.5);
    expect(inside.lowpassHz).toBeLessThan(1000);
    expect(winterWind(35, 0, false).gain).toBe(0);
  });
});

describe('the cold in you', () => {
  it('brings gusts oftener and harder as warmth drops', () => {
    const at = (s: Parameters<typeof gustEveryS>[0]) => gustEveryS(s, 15, 1, false) as number;
    expect(at('chilled')).toBeLessThan(at('warm'));
    expect(at('cold')).toBeLessThan(at('chilled'));
    expect(at('freezing')).toBeLessThan(at('cold'));
    expect(gustGain('freezing', 15)).toBeGreaterThan(gustGain('warm', 15));
    expect(gustEveryS('freezing', 15, 1, true)).toBeUndefined();
    expect(gustEveryS('freezing', 15, 0.1, false)).toBeUndefined();
    expect(gustEveryS('cold', 30, 1, false) as number).toBeLessThan(
      gustEveryS('cold', 2, 1, false) as number,
    );
  });

  it('chatters the teeth at cold and freezing, never warmer', () => {
    expect(chatterEveryS('warm')).toBeUndefined();
    expect(chatterEveryS('chilled')).toBeUndefined();
    expect(chatterEveryS('freezing') as number).toBeLessThan(chatterEveryS('cold') as number);
    expect(shiverEveryS('warm')).toBeUndefined();
    expect(shiverEveryS('chilled')).toBeDefined();
  });

  it('plays chattering teeth and gusts on foot as you freeze', () => {
    const { s, shots } = sounds();
    run(s, 30, (t) => frame({ nowS: t, body: body({ stage: 'freezing' }) }));
    const ids = shots.map(idOf);
    expect(ids.filter((id) => id === WINTER_SOUND.chatter).length).toBeGreaterThanOrEqual(5);
    expect(
      ids.filter((id) => (WINTER_SOUND.gust as readonly string[]).includes(id)).length,
    ).toBeGreaterThanOrEqual(3);
    expect(ids).toContain(FOOT_SOUND.shiver);
  });

  it('keeps quiet in you when warm, swimming or afloat', () => {
    for (const f of [
      (t: number) => frame({ nowS: t, body: body({ stage: 'warm' }), windKn: 0 }),
      (t: number) => frame({ nowS: t, body: body({ stage: 'freezing' }), swimming: true }),
      (t: number) => frame({ nowS: t, body: undefined }),
    ]) {
      const { s, shots } = sounds();
      run(s, 20, f);
      expect(shots.map(idOf)).not.toContain(WINTER_SOUND.chatter);
    }
  });

  it('gusts as warmth falls a stage', () => {
    const { s, shots } = sounds();
    s.update(frame(), 1 / 30);
    s.warmthFell('cold');
    const ids = shots.map(idOf);
    expect(ids.some((id) => (WINTER_SOUND.gust as readonly string[]).includes(id))).toBe(true);
    expect(ids).toContain(WINTER_SOUND.chatter);
  });
});

describe('thin ice', () => {
  it("says nothing on sound ice and more as it's stressed", () => {
    expect(thinIceSound('sound', 0.1, true, COLD.thin)).toBeUndefined();
    expect(thinIceSound('broken', 1, true, COLD.thin)).toBeUndefined();
    const a = thinIceSound('cracking', 0.3, true, COLD.thin);
    const b = thinIceSound('cracking', 0.55, true, COLD.thin);
    expect(b?.crackEveryS).toBeLessThan(a?.crackEveryS as number);
    expect(a?.groanEveryS).toBeUndefined();
    const g = thinIceSound('groaning', 0.8, true, COLD.thin);
    expect(g?.groanEveryS).toBeDefined();
    expect(g?.crackEveryS).toBeLessThan(b?.crackEveryS as number);
    const still = thinIceSound('groaning', 0.8, false, COLD.thin);
    expect(still?.crackEveryS).toBeGreaterThan(g?.crackEveryS as number);
  });

  it("plays piece M's stages with captions: crack, groan, give way", () => {
    const { s, shots, captions } = sounds();
    s.update(frame(), 1 / 30);
    s.iceGave('cracking');
    expect((WINTER_SOUND.crack as readonly string[]).includes(idOf(shots[0] as OneShot))).toBe(
      true,
    );
    s.iceGave('groaning');
    expect(shots.map(idOf)).toContain(WINTER_SOUND.groan);
    s.iceGave('broken');
    expect(shots.map(idOf)).toContain(WINTER_SOUND.break);
    const lines = captions.visible(0.1, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(lines.map((l) => l.text)).toContain('The ice gives way');
  });

  it('keeps cracking and groaning while it holds you', () => {
    const { s, shots } = sounds();
    run(s, 10, (t) =>
      frame({ nowS: t, body: body({ onIce: true, thin: 'groaning', stress: 0.8 }) }),
    );
    const ids = shots.map(idOf);
    expect(ids.filter((id) => id === WINTER_SOUND.groan).length).toBeGreaterThanOrEqual(2);
    expect(
      ids.filter((id) => (WINTER_SOUND.crack as readonly string[]).includes(id)).length,
    ).toBeGreaterThanOrEqual(5);
  });

  it('hauls you out, or breaks away under you', () => {
    const { s, shots } = sounds();
    s.climbed('out');
    expect(idOf(shots[0] as OneShot)).toBe(WINTER_SOUND.haul);
    s.climbed('slipped');
    expect(shots.map(idOf)).toContain(FOOT_SOUND.splash);
  });
});

describe('underfoot', () => {
  it('ticks on bare ice, crunches on snow and squeaks at hard frost', () => {
    expect(winterStep('ice', 'walk', 6, -5, 0.2)?.id).toMatch(/^sfx\.foot\.step-ice-[12]$/);
    expect(winterStep('snow', 'walk', 6, -5, 0.2)?.id).toMatch(/^sfx\.foot\.step-snow-[12]$/);
    expect(winterStep('snow', 'walk', 6, SQUEAK_BELOW_C - 1, 0.2)?.id).toMatch(
      /^sfx\.foot\.step-squeak-[12]$/,
    );
    expect(winterStep('snowIce', 'walk', 6, -5, 0.2)?.rate).toBeGreaterThan(
      winterStep('snow', 'walk', 6, -5, 0.2)?.rate as number,
    );
    expect(winterStep('ice', 'idle', 6, -5, 0.2)).toBeUndefined();
    expect(winterStep('ice', 'swim', 6, -5, 0.2)).toBeUndefined();
  });

  it('is as loud as the guards hear it', () => {
    expect(winterStep('ice', 'run', 12, -5, 0.3)?.gain).toBeCloseTo(stepGain(12));
    expect(winterStep('snow', 'sneak', 1, -5, 0.3)?.gain).toBeCloseTo(stepGain(1));
    expect(winterStep('snow', 'sneak', 1, -5, 0.3)?.lowpassHz).toBeDefined();
  });

  it('plays a stride with the air the frame last said', () => {
    const { s, shots } = sounds();
    s.update(frame({ airC: -20 }), 1 / 30);
    s.step('snow', 'walk', 6);
    expect(idOf(shots.at(-1) as OneShot)).toMatch(/squeak/);
  });
});

describe('the sled', () => {
  it('hisses by its speed, fuller with a load, brighter on bare ice', () => {
    expect(runnerLevel(0, 3, false).gain).toBe(0);
    const walk = runnerLevel(1.4, 0, false);
    const loaded = runnerLevel(1.4, 3, false);
    expect(loaded.gain).toBeGreaterThan(walk.gain);
    expect(runnerLevel(1.4, 0, true).lowpassHz).toBeGreaterThan(walk.lowpassHz);
    expect(runnerLevel(2.5, 0, false).rate).toBeGreaterThan(walk.rate);
  });

  it('follows the sled along on its rope, and lets it fall silent when dropped', () => {
    const { s } = sounds();
    run(s, 2, (t) =>
      frame({ nowS: t, body: body({ sled: { x: 1.4 * t, z: 0, hitched: true, cu: 2 } }) }),
    );
    expect(s.levels.beds.runners).toBeGreaterThan(0.3);
    run(s, 1, (t) =>
      frame({ nowS: t, body: body({ sled: { x: 0, z: 0, hitched: false, cu: 2 } }) }),
    );
    expect(s.levels.beds.runners).toBe(0);
  });

  it('thumps a load down and lashes it', () => {
    const { s, shots } = sounds();
    s.sled('loaded');
    s.sled('down');
    s.sled('hitched');
    expect(shots.map(idOf)).toEqual([WINTER_SOUND.load, FOOT_SOUND.crateDown, FOOT_SOUND.rope]);
  });
});

describe('a frozen harbor at night', () => {
  it('goes still near a frozen harbor at night, most in a calm', () => {
    const night = frozenHarbor(200, 1, -15, 2);
    const day = frozenHarbor(200, 1, 30, 2);
    const windy = frozenHarbor(200, 1, -15, 25);
    const far = frozenHarbor(4000, 1, -15, 2);
    const open = frozenHarbor(200, 0.2, -15, 2);
    expect(night.gain).toBeGreaterThan(0.8);
    expect(day.gain).toBeLessThan(night.gain * 0.5);
    expect(windy.gain).toBeLessThan(night.gain);
    expect(far.gain).toBe(0);
    expect(open.gain).toBe(0);
    expect(night.hush01).toBe(1);
    expect(open.hush01).toBe(0);
  });

  it('booms far off over a closed sheet, oftener on a cold night', () => {
    expect(iceBoomEveryS(0.2, -20, 1)).toBeUndefined();
    const coldNight = iceBoomEveryS(1, -25, 1) as number;
    const mildDay = iceBoomEveryS(1, -1, 0) as number;
    expect(coldNight).toBeLessThan(mildDay);
    expect(iceBoomHeard(400).gain).toBeGreaterThan(iceBoomHeard(2500).gain);
    expect(iceBoomHeard(400).lowpassHz).toBeGreaterThan(iceBoomHeard(2500).lowpassHz);
  });

  it('brings up the still night and the ice afloat, and stills the water', () => {
    const { s, shots } = sounds();
    run(s, 120, (t) =>
      frame({
        nowS: t,
        body: undefined,
        harborDistanceM: 150,
        sunElevationDeg: -20,
        windKn: 3,
        airC: -22,
      }),
    );
    expect(s.levels.beds.night).toBeGreaterThan(0.5);
    expect(s.levels.beds.wind).toBeGreaterThan(0);
    expect(s.hush).toBe(1);
    expect(
      shots.map(idOf).some((id) => (WINTER_SOUND.sing as readonly string[]).includes(id)),
    ).toBe(true);
    expect(s.levels.booms).toBeGreaterThanOrEqual(2);
  });

  it('is silent out of season', () => {
    const { s, shots } = sounds();
    run(s, 60, (t) =>
      frame({ nowS: t, month0: 6, airC: 18, iceCover01: 0, body: body({ stage: 'warm' }) }),
    );
    expect(s.levels.beds.wind).toBe(0);
    expect(s.levels.beds.night).toBe(0);
    expect(shots).toHaveLength(0);
  });
});

describe('the synthesis', () => {
  const audible = (x: Float32Array): void => {
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.01);
  };

  it('renders every one-shot finite and audible', () => {
    for (const x of [
      iceCrack(1, RATE),
      iceCrack(2, RATE),
      iceGroan(RATE),
      iceBreak(RATE),
      iceHaul(RATE),
      iceSing(1, RATE),
      iceSing(2, RATE),
      stepIce(1, RATE),
      stepSqueak(2, RATE),
      sledLoad(RATE),
      teethChatter(RATE),
      winterGust(1, RATE),
    ]) {
      audible(x);
    }
  });

  it('renders the beds to their loop lengths', () => {
    const runners = sledRunners(RATE);
    const wind = winterWindBed(RATE);
    const night = frozenNight(RATE);
    audible(runners);
    audible(wind);
    audible(night);
    expect(runners.length).toBe(RUNNERS_LOOP_S * RATE);
    expect(wind.length).toBe(WINTER_WIND_S * RATE);
    expect(night.length).toBe(FROZEN_NIGHT_S * RATE);
  });

  it("makes the ice's chirp fall", () => {
    const x = chirp(RATE, seeded(1), 0.5, 2000, 200);
    // Zero crossings in the first tenth outnumber those in the last: the pitch falls.
    const crossings = (a: number, b: number): number => {
      let n = 0;
      for (let i = a + 1; i < b; i++)
        if (Math.sign(x[i] as number) !== Math.sign(x[i - 1] as number)) n++;
      return n;
    };
    const tenth = Math.floor(x.length / 10);
    expect(crossings(0, tenth)).toBeGreaterThan(crossings(x.length - tenth, x.length) * 2);
  });
});
