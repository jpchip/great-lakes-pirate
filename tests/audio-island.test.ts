import { describe, expect, it } from 'vitest';
import { CaptionFeed } from '../src/audio/captions';
import { IslandSounds, ISLAND_SOUND, tierOf } from '../src/audio/island-audio';
import {
  ENDING_DELAY_S,
  SPADE_STRIKES_S,
  animalCue,
  callGain,
  caveDripGapS,
  caveRoomLevel,
  dripVariant,
  islandBeds,
  seasonOf,
  surgeGain,
  woodpeckerGapS,
} from '../src/audio/island-mix';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import {
  ENDING_DRONE,
  bearGrowl,
  bearHuff,
  caveDrip,
  caveRoom,
  caveSurge,
  creek,
  deerBound,
  deerSnort,
  endingAir,
  grappleCast,
  grappleHaul,
  islandBirds,
  spade,
  surf,
  woodpecker,
  wolfHowl,
} from '../tools/audio/lib/synth-island';
import { peak, seeded } from '../tools/audio/lib/synth';

const RATE = 48000;

describe('the seasons', () => {
  it('reads the months: winter is December to February', () => {
    expect(seasonOf(11)).toBe('winter');
    expect(seasonOf(0)).toBe('winter');
    expect(seasonOf(1)).toBe('winter');
    expect(seasonOf(2)).toBe('spring');
    expect(seasonOf(4)).toBe('spring');
    expect(seasonOf(5)).toBe('summer');
    expect(seasonOf(7)).toBe('summer');
    expect(seasonOf(8)).toBe('autumn');
    expect(seasonOf(10)).toBe('autumn');
  });
});

describe('the island beds', () => {
  const day = { windKn: 4, daylight01: 1, inside: false };

  it('sings in a hero island wood in summer, and not in winter', () => {
    const summer = islandBeds({ season: 'summer', tier: 'hero', ...day });
    expect(summer.birds).toBeGreaterThan(0.6);
    const winter = islandBeds({ season: 'winter', tier: 'hero', ...day });
    expect(winter.birds).toBe(0);
    expect(winter.creek).toBe(0);
  });

  it('has a creek on the bigger islands, swollen at the thaw and frozen in winter', () => {
    const thaw = islandBeds({ season: 'spring', tier: 'hero', ...day }).creek;
    const summer = islandBeds({ season: 'summer', tier: 'hero', ...day }).creek;
    expect(thaw).toBeGreaterThan(summer);
    expect(islandBeds({ season: 'summer', tier: 'minor', ...day }).creek).toBe(0);
  });

  it('gives a rock island its surf and few singers, a hero island hardly any surf', () => {
    const rock = islandBeds({
      season: 'summer',
      tier: 'minor',
      windKn: 18,
      daylight01: 1,
      inside: false,
    });
    const hero = islandBeds({
      season: 'summer',
      tier: 'hero',
      windKn: 18,
      daylight01: 1,
      inside: false,
    });
    expect(rock.surf).toBeGreaterThan(0.5);
    expect(hero.surf).toBeLessThan(0.2);
    expect(rock.birds).toBeLessThan(hero.birds);
  });

  it('quiets the birds at night and in a stiff wind, and the surf rises with the wind', () => {
    const noon = islandBeds({ season: 'spring', tier: 'hero', ...day }).birds;
    const night = islandBeds({
      season: 'spring',
      tier: 'hero',
      windKn: 4,
      daylight01: 0,
      inside: false,
    }).birds;
    const gale = islandBeds({
      season: 'spring',
      tier: 'hero',
      windKn: 30,
      daylight01: 1,
      inside: false,
    }).birds;
    expect(night).toBeLessThan(noon * 0.2);
    expect(gale).toBe(0);
    const calm = islandBeds({
      season: 'autumn',
      tier: 'minor',
      windKn: 2,
      daylight01: 1,
      inside: false,
    }).surf;
    const blow = islandBeds({
      season: 'autumn',
      tier: 'minor',
      windKn: 22,
      daylight01: 1,
      inside: false,
    }).surf;
    expect(blow).toBeGreaterThan(calm);
  });

  it('comes through quieter under a roof', () => {
    const out = islandBeds({ season: 'summer', tier: 'hero', ...day });
    const inside = islandBeds({ season: 'summer', tier: 'hero', ...day, inside: true });
    expect(inside.birds).toBeCloseTo(out.birds * 0.4, 5);
  });

  it('keeps every level within 0 and 1', () => {
    for (const season of ['winter', 'spring', 'summer', 'autumn'] as const)
      for (const tier of ['hero', 'standard', 'minor'] as const)
        for (const windKn of [0, 12, 40]) {
          const b = islandBeds({ season, tier, windKn, daylight01: 1, inside: false });
          for (const v of [b.birds, b.creek, b.surf]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        }
  });

  it('tiers the islands by their data, a standard island if unset', () => {
    expect(tierOf('no-such-island')).toBe('standard');
  });
});

describe('the woodpecker', () => {
  it('drums in spring and summer by day on a wooded island, and nowhere else', () => {
    const random = seeded(3);
    const gap = woodpeckerGapS(random, { season: 'spring', tier: 'hero', daylight01: 1 });
    expect(gap).toBeGreaterThanOrEqual(40);
    expect(gap).toBeLessThanOrEqual(110);
    expect(
      woodpeckerGapS(random, { season: 'winter', tier: 'hero', daylight01: 1 }),
    ).toBeUndefined();
    expect(
      woodpeckerGapS(random, { season: 'autumn', tier: 'hero', daylight01: 1 }),
    ).toBeUndefined();
    expect(
      woodpeckerGapS(random, { season: 'summer', tier: 'minor', daylight01: 1 }),
    ).toBeUndefined();
    expect(
      woodpeckerGapS(random, { season: 'summer', tier: 'hero', daylight01: 0 }),
    ).toBeUndefined();
  });
});

describe('the sea cave', () => {
  it('drips every few seconds, and alternates its two drips', () => {
    const gaps = [0, 0.25, 0.5, 0.75, 1].map((r) => caveDripGapS(() => r));
    for (const g of gaps) {
      expect(g).toBeGreaterThanOrEqual(2.5);
      expect(g).toBeLessThanOrEqual(7);
    }
    expect(dripVariant(() => 0.1)).toBe(1);
    expect(dripVariant(() => 0.9)).toBe(2);
  });

  it('has its hush only inside the roof', () => {
    expect(caveRoomLevel(true)).toBeGreaterThan(0.5);
    expect(caveRoomLevel(false)).toBe(0);
  });

  it('surges by the swell, never silent and never over full', () => {
    expect(surgeGain(0)).toBe(0.3);
    expect(surgeGain(1)).toBeCloseTo(0.5, 5);
    expect(surgeGain(9)).toBe(1);
  });
});

describe('the animals', () => {
  it('lets a deer snort and bound when it bolts, and no more', () => {
    const cue = animalCue('deer', 'bolt');
    expect(cue.sounds).toEqual([ISLAND_SOUND.deerSnort, ISLAND_SOUND.deerBound]);
    expect(cue.delayS[0]).toBe(0);
    expect(cue.delayS[1]).toBeGreaterThan(0);
    expect(animalCue('deer', 'wary').sounds).toEqual([]);
  });

  it('has a bear huff when it stands up and growl when it charges', () => {
    expect(animalCue('bear', 'threaten').sounds).toEqual([ISLAND_SOUND.bearHuff]);
    expect(animalCue('bear', 'attack').sounds).toEqual([ISLAND_SOUND.bearGrowl]);
    expect(animalCue('bear', 'wary').sounds).toEqual([]);
    expect(animalCue('bear', 'flee').sounds).toEqual([]);
  });

  it('howls the wolves from the trees, and the nearer pack answers with the second', () => {
    expect(animalCue('wolf', 'wary', 0).sounds).toEqual([ISLAND_SOUND.wolfHowls[0]]);
    expect(animalCue('wolf', 'wary', 1).sounds).toEqual([ISLAND_SOUND.wolfHowls[1]]);
    expect(animalCue('wolf', 'threaten').sounds).toEqual([ISLAND_SOUND.wolfHowls[1]]);
    expect(animalCue('wolf', 'attack').sounds).toEqual([]);
  });

  it('carries a call from close by to nothing by 300 m', () => {
    expect(callGain(0)).toBe(1);
    expect(callGain(10)).toBe(1);
    expect(callGain(150)).toBeGreaterThan(callGain(250));
    expect(callGain(300)).toBe(0);
    expect(callGain(Infinity)).toBe(0);
  });

  it('has the spade strike three times over a dig', () => {
    expect(SPADE_STRIKES_S.length).toBe(3);
    expect(SPADE_STRIKES_S[0]).toBe(0);
  });

  it('plays the ending a second after the run is over', () => {
    expect(ENDING_DELAY_S).toBe(1);
  });
});

describe('the island sounds', () => {
  function rig(): { mixer: AudioMixer; shots: OneShot[]; sounds: IslandSounds } {
    const shots: OneShot[] = [];
    const mixer = {
      ctx: {},
      buses: {},
      play(shot: OneShot) {
        shots.push(shot);
        return undefined;
      },
    } as unknown as AudioMixer;
    const buffer = { duration: 4 } as unknown as AudioBuffer;
    const bank = new Map<string, AudioBuffer>(
      Object.values(ISLAND_SOUND)
        .flat()
        .map((id) => [id, buffer]),
    );
    const sounds = new IslandSounds(
      mixer,
      { get: (id: string) => bank.get(id) } as never,
      () => 0.5,
    );
    return { mixer, shots, sounds };
  }

  const frame = {
    listener: { x: 0, y: 1.7, z: 0 },
    nowS: 10,
    player: { x: 0, y: 0, z: 0 },
    island: 'island.devils',
    inside: false,
    month0: 6,
    windKn: 5,
    daylight01: 1,
  };

  it('digs with three spade strikes alternating their variants, once ashore', () => {
    const { shots, sounds } = rig();
    sounds.update(frame, 0.016, 10);
    sounds.dig();
    const spades = shots.filter((s) => s.buffer !== undefined);
    expect(spades.length).toBeGreaterThanOrEqual(3);
    expect(sounds.levels.last).toBe('dig');
  });

  it('plays a grapple cast and haul from the boat too', () => {
    const { shots, sounds } = rig();
    sounds.update(undefined, 0.016, 10);
    sounds.grappleCast();
    sounds.grappleHaul();
    expect(shots.length).toBe(2);
    expect(sounds.levels.last).toBe(ISLAND_SOUND.grappleHaul);
  });

  it('calls an animal only when you are ashore, and captions it', () => {
    const { shots, sounds } = rig();
    const captions = new CaptionFeed();
    sounds.captions = captions;
    sounds.animal('wolf', 'wary', { x: 40, y: 0, z: 0 }, 40);
    expect(shots.length).toBe(0);
    sounds.update(frame, 0.016, 10);
    sounds.animal('wolf', 'wary', { x: 40, y: 0, z: 0 }, 40);
    expect(shots.length).toBe(1);
    expect(captions.visible(10, { x: 0, z: 0 }, { x: 0, z: -1 }).length).toBeGreaterThan(0);
    sounds.animal('bear', 'wary', { x: 900, y: 0, z: 0 }, 900);
    expect(shots.length).toBe(1);
  });

  it('starts its cave hush and drips on entering, and stops on leaving', () => {
    const { shots, sounds } = rig();
    sounds.enterCave('cave.devils', false);
    sounds.update(undefined, 5, 15);
    expect(sounds.levels.cave).toBeGreaterThan(0);
    expect(sounds.levels.drips).toBeGreaterThan(0);
    const drips = shots.length;
    sounds.leaveCave();
    sounds.update(undefined, 5, 20);
    expect(sounds.levels.cave).toBe(0);
    expect(shots.length).toBe(drips);
  });

  it('booms the surge once and then waits before the next', () => {
    const { shots, sounds } = rig();
    sounds.update(frame, 0.016, 10);
    sounds.surge(2);
    sounds.surge(2);
    expect(shots.length).toBe(1);
  });

  it('stops its beds when you are off the islands', () => {
    const { sounds } = rig();
    sounds.update(frame, 0.016, 10);
    sounds.stop();
    expect(sounds.levels.birds).toBe(0);
    expect(sounds.levels.cave).toBe(0);
  });
});

describe('the synthesis', () => {
  const loops: [string, () => Float32Array, number][] = [
    ['birds', () => islandBirds(RATE, 6), 6],
    ['creek', () => creek(RATE, 4), 4],
    ['surf', () => surf(RATE, 4), 4],
    ['cave room', () => caveRoom(RATE, 4), 4],
  ];
  for (const [name, make, seconds] of loops) {
    it(`renders a ${name} loop of its length, finite and audible`, () => {
      const x = make();
      // Each loop gives back its 1.5 s crossfade, so it runs a little short of its length.
      expect(x.length).toBeGreaterThan((seconds - 1.6) * RATE);
      expect(x.length).toBeLessThanOrEqual(seconds * RATE + 1);
      expect(x.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(x)).toBeGreaterThan(0.01);
    });
  }

  const shots: [string, Float32Array][] = [
    ['woodpecker', woodpecker(RATE, seeded(9901))],
    ['cave drip', caveDrip(1, RATE)],
    ['cave surge', caveSurge(RATE)],
    ['deer snort', deerSnort(RATE)],
    ['deer bound', deerBound(RATE)],
    ['bear huff', bearHuff(RATE)],
    ['bear growl', bearGrowl(RATE)],
    ['wolf howl', wolfHowl(1, RATE)],
    ['grapple cast', grappleCast(RATE)],
    ['grapple haul', grappleHaul(RATE)],
    ['spade', spade(1, RATE)],
  ];
  for (const [name, x] of shots) {
    it(`renders the ${name} finite and audible`, () => {
      expect(x.length).toBeGreaterThan(0);
      expect(x.every((v) => Number.isFinite(v))).toBe(true);
      expect(peak(x)).toBeGreaterThan(0.01);
    });
  }

  it('renders the ending air with its drone in D and a melody of a little under a minute', () => {
    const { notes, bpm } = endingAir();
    expect(ENDING_DRONE).toEqual(['D3', 'A3']);
    expect(notes.length).toBeGreaterThan(20);
    const beats = notes.reduce((sum, [, b]) => sum + b, 0);
    const seconds = (beats * 60) / bpm;
    expect(seconds).toBeGreaterThan(40);
    expect(seconds).toBeLessThan(70);
  });
});
