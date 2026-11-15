import { describe, expect, it } from 'vitest';
import { CaptionFeed } from '../src/audio/captions';
import { FOOT_SOUND, FootSounds, type FootFrame, type FootGuard } from '../src/audio/foot-audio';
import {
  LOUDEST_STEP_M,
  SALOON_REACH_M,
  SPOTTED_GAP_S,
  STEP_GROUNDS,
  STEP_VARIANTS,
  TENSION_REACH_M,
  VOICE_REACH_M,
  barkFor,
  heardAt,
  landGain,
  placeMix,
  shiverEveryS,
  stepGain,
  stepSound,
  stepSoundId,
  tension01,
  tensionGain,
  voiceRate,
  type PlaceInputs,
} from '../src/audio/foot-mix';
import { LAW_SOUND } from '../src/audio/law-audio';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { PORT_SOUND } from '../src/audio/port-audio';
import { SOUND } from '../src/audio/sailing-audio';
import { footstepRadiusM, SURFACE_NOISE, type Surface } from '../src/gameplay/onfoot/noise';
import { peak } from '../tools/audio/lib/synth';
import {
  BARKS,
  SALOON_TUNE_S,
  STEP_GROUNDS as SYNTH_GROUNDS,
  STEP_VARIANTS as SYNTH_VARIANTS,
  TENSION_LOOP_S,
  barsBang,
  bottle,
  coshBlow,
  crateDown,
  crateLift,
  crickets,
  crowbar,
  docksNight,
  doorCreak,
  footstep,
  forestWind,
  guardBark,
  keys,
  knifeBlow,
  landing,
  lockClick,
  lockOpen,
  lockPick,
  pickSnap,
  policeWhistle,
  ropeTie,
  saloonRoom,
  saloonTune,
  shiver,
  spottedStinger,
  stoneLand,
  swimSplash,
  swimStroke,
  tensionLoop,
} from '../tools/audio/lib/synth-foot';

/** A mixer that records what it's asked to play (no Web Audio, so no beds). */
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

/** Every sound the foot layer plays, each a buffer named by its id. */
function fakeBank(): Map<string, AudioBuffer> {
  const ids: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') ids.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(FOOT_SOUND);
  for (const g of STEP_GROUNDS) {
    for (let v = 1; v <= STEP_VARIANTS; v++) ids.push(stepSoundId(g, v));
  }
  ids.push(LAW_SOUND.rifle, ...PORT_SOUND.coins, PORT_SOUND.open, ...SOUND.chain);
  return new Map(ids.map((id) => [id, { duration: 1.4, id } as unknown as AudioBuffer]));
}

const idOf = (shot: OneShot | undefined): string =>
  (shot?.buffer as unknown as { id: string } | undefined)?.id ?? '';

const constable: FootGuard = {
  id: 'constable.1',
  name: 'Constable',
  type: 'npc.constable',
  state: 'patrol',
  meter: 0,
  x: 10,
  y: 0,
  z: 0,
};

function frame(over: Partial<FootFrame> = {}): FootFrame {
  return {
    listener: { x: 0, y: 1.7, z: 0 },
    nowS: 10,
    player: { x: 0, y: 0, z: 0 },
    swimming: false,
    waterC: 12,
    guards: [constable],
    place: 'district',
    inside: false,
    sunElevationDeg: -20,
    month0: 6,
    windKn: 8,
    rain01: 0,
    saloon: undefined,
    picking: undefined,
    ...over,
  };
}

function sounds(random: () => number = () => 0.5): {
  foot: FootSounds;
  shots: OneShot[];
  captions: CaptionFeed;
} {
  const { mixer, shots } = fakeMixer();
  const foot = new FootSounds(mixer, fakeBank(), random);
  const captions = new CaptionFeed();
  foot.captions = captions;
  foot.setActive(true);
  foot.update(frame(), 0.016);
  return { foot, shots, captions };
}

describe('footsteps (Phase 7 piece I)', () => {
  it('are as loud as the guards hear them: the gameplay radius sets the gain', () => {
    const sneakGrass = footstepRadiusM('sneak', 'grass');
    const walkDirt = footstepRadiusM('walk', 'dirt');
    const runWood = footstepRadiusM('run', 'wood');
    expect(runWood).toBe(LOUDEST_STEP_M);
    expect(stepGain(0)).toBe(0);
    expect(stepGain(sneakGrass)).toBeLessThan(0.2);
    expect(stepGain(walkDirt)).toBeGreaterThan(stepGain(sneakGrass));
    expect(stepGain(runWood)).toBeCloseTo(1, 5);
    expect(stepGain(40)).toBe(1);
    // Monotonic in the radius.
    let last = 0;
    for (let r = 0.5; r <= 18; r += 0.5) {
      expect(stepGain(r)).toBeGreaterThan(last);
      last = stepGain(r);
    }
  });

  it('has a sound for every surface the districts and islands use', () => {
    for (const surface of Object.keys(SURFACE_NOISE) as Surface[]) {
      const s = stepSound(surface, 'walk', footstepRadiusM('walk', surface), 0.3);
      expect(s, surface).toBeDefined();
      expect(s?.id).toMatch(/^sfx\.foot\.step-(wood|dirt|gravel|grass|stone|snow)-[12]$/);
    }
    expect(stepSound('wood', 'walk', 7.5, 0)?.id).toBe('sfx.foot.step-wood-1');
    expect(stepSound('rock', 'walk', 5, 0)?.id).toBe('sfx.foot.step-stone-1');
    expect(stepSound('sand', 'walk', 3, 0)?.id).toBe('sfx.foot.step-dirt-1');
    // Indoors the boards are duller.
    expect(stepSound('interior', 'walk', 5, 0)?.lowpassHz).toBeLessThan(3000);
    expect(stepSound('wood', 'walk', 5, 0)?.lowpassHz).toBeUndefined();
  });

  it('varies the variant and the pitch, and a sneak is softer than a run', () => {
    const ids = new Set<string>();
    const rates = new Set<number>();
    for (let k = 0; k < 40; k++) {
      const s = stepSound('wood', 'walk', 7.5, k / 40);
      ids.add(s?.id ?? '');
      rates.add(s?.rate ?? 0);
    }
    expect(ids.size).toBe(STEP_VARIANTS);
    expect(rates.size).toBeGreaterThan(10);
    for (const r of rates) {
      expect(r).toBeGreaterThan(0.9);
      expect(r).toBeLessThan(1.1);
    }
    const sneak = stepSound('wood', 'sneak', footstepRadiusM('sneak', 'wood'), 0.5);
    const run = stepSound('wood', 'run', footstepRadiusM('run', 'wood'), 0.5);
    expect(sneak?.gain).toBeLessThan((run?.gain ?? 0) / 2);
    expect(sneak?.rate).toBeLessThan(run?.rate ?? 0);
    expect(sneak?.lowpassHz).toBeDefined();
  });

  it('makes no footstep swimming, standing or falling', () => {
    expect(stepSound('water', 'swim', 1, 0.5)).toBeUndefined();
    expect(stepSound('wood', 'idle', 0, 0.5)).toBeUndefined();
    expect(stepSound('wood', 'fall', 0, 0.5)).toBeUndefined();
  });

  it('plays a stride on the sfx bus, and a stroke when you swim', () => {
    const { foot, shots } = sounds();
    foot.step('wood', 'walk', 7.5);
    expect(idOf(shots[0])).toMatch(/^sfx\.foot\.step-wood-/);
    expect(shots[0]?.bus).toBe('sfx');
    expect(shots[0]?.at).toBeUndefined();
    expect(foot.levels.steps).toBe(1);
    foot.step('water', 'swim', 1);
    expect(FOOT_SOUND.stroke).toContain(idOf(shots[1]));
    expect(foot.levels.steps).toBe(1);
  });

  it('thumps on a hard landing and splashes into the lake', () => {
    expect(landGain(2)).toBe(0);
    expect(landGain(4)).toBeGreaterThan(0);
    expect(landGain(10)).toBe(1);
    const { foot, shots, captions } = sounds();
    foot.landed(2, false);
    expect(shots).toHaveLength(0);
    foot.landed(7, false);
    expect(idOf(shots[0])).toBe(FOOT_SOUND.land);
    foot.landed(7, true);
    expect(idOf(shots[1])).toBe(FOOT_SOUND.splash);
    expect(captions.visible(11, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe('A splash');
  });

  it('is silent off your feet', () => {
    const { foot, shots } = sounds();
    foot.setActive(false);
    foot.step('wood', 'run', 18);
    foot.landed(9, false);
    expect(shots).toHaveLength(0);
  });
});

describe('sounds from across the district (Phase 7 piece I)', () => {
  it('fade and dull with distance, and stop at their reach', () => {
    const near = heardAt(1, 40);
    const mid = heardAt(20, 40);
    expect(near?.gain).toBeGreaterThan(0.9);
    expect(mid?.gain).toBeLessThan(near?.gain ?? 0);
    expect(mid?.lowpassHz).toBeLessThan(near?.lowpassHz ?? 0);
    expect(heardAt(40, 40)).toBeUndefined();
    expect(heardAt(5, 0)).toBeUndefined();
  });

  it('carry half as far through a wall, muffled', () => {
    expect(heardAt(25, 40, true)).toBeUndefined();
    const open = heardAt(10, 40);
    const walled = heardAt(10, 40, true);
    expect(walled?.gain).toBeLessThan(open?.gain ?? 0);
    expect(walled?.lowpassHz).toBeLessThan((open?.lowpassHz ?? 0) / 2);
  });
});

describe("the watch's voices (Phase 7 piece I)", () => {
  it('says the right thing for each change of mind', () => {
    expect(barkFor('patrol', 'suspicious', 'constable')).toEqual({
      bark: 'hm',
      caption: 'Constable: "Hm?"',
    });
    expect(barkFor('patrol', 'distracted', 'Night watchman')?.caption).toBe(
      'Night watchman: "Who\'s there?"',
    );
    expect(barkFor('suspicious', 'alerted', 'Constable')?.bark).toBe('hey');
    expect(barkFor('alerted', 'search', 'Constable')?.bark).toBe('mutter');
    expect(barkFor('search', 'return', 'Constable')?.bark).toBe('giveup');
  });

  it('says nothing coming down from a chase to a look, or for a man with no say', () => {
    expect(barkFor('alerted', 'suspicious', 'Constable')).toBeUndefined();
    expect(barkFor('search', 'suspicious', 'Constable')).toBeUndefined();
    expect(barkFor('fetch', 'return', 'Constable')).toBeUndefined();
    for (const to of ['patrol', 'drunk', 'unconscious', 'bound', 'bribed', 'dead'] as const) {
      expect(barkFor('patrol', to, 'Constable'), to).toBeUndefined();
    }
  });

  it('gives each man his own voice: marshals low, sailors high, steady by id', () => {
    expect(voiceRate('npc.marshal', 'm')).toBeLessThan(voiceRate('npc.constable', 'm'));
    expect(voiceRate('npc.sailor', 'm')).toBeGreaterThan(voiceRate('npc.constable', 'm'));
    expect(voiceRate('npc.constable', 'a.1')).toBe(voiceRate('npc.constable', 'a.1'));
    expect(voiceRate('npc.constable', 'a.1')).not.toBe(voiceRate('npc.constable', 'b.2'));
    for (const id of ['a', 'constable.jailer', 'watchman.hollister']) {
      const r = voiceRate('npc.constable', id);
      expect(r).toBeGreaterThanOrEqual(0.95);
      expect(r).toBeLessThanOrEqual(1.05);
    }
  });

  it('places a bark where the man stands, on the voice bus, with a caption', () => {
    const { foot, shots, captions } = sounds();
    foot.stealth({ type: 'NpcStateChanged', npc: 'constable.1', from: 'patrol', to: 'alerted' });
    expect(shots).toHaveLength(1);
    expect(idOf(shots[0])).toBe(FOOT_SOUND.bark.hey);
    expect(shots[0]?.bus).toBe('voice');
    expect(shots[0]?.at).toMatchObject({ x: 10, z: 0 });
    const view = captions.visible(10.1, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(view[0]?.text).toBe('Constable: "Hey! Stop!"');
    expect(view[0]?.arrow).toBe('→');
  });

  it('is not heard from beyond its reach, nor from a guard it does not know', () => {
    const { foot, shots } = sounds();
    foot.update(frame({ guards: [{ ...constable, x: VOICE_REACH_M.hm + 5 }] }), 0.016);
    foot.stealth({ type: 'NpcStateChanged', npc: 'constable.1', from: 'patrol', to: 'suspicious' });
    foot.stealth({ type: 'NpcStateChanged', npc: 'nobody', from: 'patrol', to: 'alerted' });
    expect(shots).toHaveLength(0);
  });

  it("blows a guard's whistle from where he is, after he draws breath", () => {
    const { foot, shots, captions } = sounds();
    foot.stealth({
      type: 'NoiseMade',
      noise: { kind: 'whistle', x: 3, y: 0, z: 4, radiusM: 40, source: 'constable.1' },
    });
    expect(idOf(shots[0])).toBe(FOOT_SOUND.whistle);
    expect(shots[0]?.delay).toBeGreaterThan(0);
    expect(shots[0]?.at).toMatchObject({ x: 10, z: 0 });
    expect(captions.visible(11, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe('A police whistle');
    // Your own noises are not played back from the guards' ears.
    foot.stealth({
      type: 'NoiseMade',
      noise: { kind: 'footstep', x: 0, y: 0, z: 0, radiusM: 5, source: 'player' },
    });
    expect(shots).toHaveLength(1);
  });

  it('plays the stinger when you are seen, and not again for a while', () => {
    const { foot, shots } = sounds();
    foot.stealth({ type: 'PlayerSpotted', npc: 'constable.1', identified: false });
    foot.stealth({ type: 'PlayerSpotted', npc: 'constable.1', identified: true });
    expect(shots.map(idOf)).toEqual([FOOT_SOUND.spotted]);
    expect(shots[0]?.bus).toBe('music');
    foot.update(frame({ nowS: 10 + SPOTTED_GAP_S + 1 }), 0.016);
    foot.stealth({ type: 'PlayerSpotted', npc: 'constable.1', identified: true });
    expect(shots).toHaveLength(2);
  });

  it('cries out over a body', () => {
    const { foot, shots, captions } = sounds();
    foot.stealth({
      type: 'BodyFound',
      npc: 'watchman.1',
      finder: 'constable.1',
      dead: true,
      drunk: false,
    });
    expect(idOf(shots[0])).toBe(FOOT_SOUND.bark.hey);
    expect(captions.visible(10.1, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe(
      'Constable has found a body',
    );
  });
});

describe('the stealth layer (Phase 7 piece I)', () => {
  it('is nothing while the watch walks its rounds', () => {
    expect(tension01([])).toBe(0);
    expect(tension01([{ state: 'patrol', meter: 0, distanceM: 5 }])).toBe(0);
    expect(tension01([{ state: 'unconscious', meter: 1, distanceM: 1 }])).toBe(0);
    expect(tensionGain(0)).toBe(0);
  });

  it('rises with a filling meter, a search and a chase', () => {
    const noticing = tension01([{ state: 'patrol', meter: 0.6, distanceM: 8 }]);
    const suspicious = tension01([{ state: 'suspicious', meter: 0.6, distanceM: 8 }]);
    const searching = tension01([{ state: 'search', meter: 1, distanceM: 8 }]);
    const chased = tension01([{ state: 'alerted', meter: 1, distanceM: 8 }]);
    expect(noticing).toBeGreaterThan(0);
    expect(suspicious).toBeGreaterThan(noticing);
    expect(searching).toBeGreaterThan(suspicious);
    expect(chased).toBe(1);
    expect(tensionGain(chased)).toBeGreaterThan(tensionGain(searching));
    expect(tensionGain(searching)).toBeGreaterThan(tensionGain(suspicious));
    expect(tensionGain(suspicious)).toBeGreaterThan(0);
  });

  it('thins with distance, except a chase', () => {
    const far = TENSION_REACH_M + 10;
    expect(tension01([{ state: 'suspicious', meter: 1, distanceM: far }])).toBe(0);
    expect(tension01([{ state: 'search', meter: 1, distanceM: far }])).toBe(0.5);
    expect(tension01([{ state: 'alerted', meter: 1, distanceM: far }])).toBe(1);
    // The worst guard counts, not the sum.
    expect(
      tension01([
        { state: 'suspicious', meter: 0.5, distanceM: 5 },
        { state: 'alerted', meter: 1, distanceM: 30 },
      ]),
    ).toBe(1);
  });

  it('reads the guards around you each frame', () => {
    const { foot } = sounds();
    foot.update(frame({ guards: [{ ...constable, state: 'alerted', meter: 1 }] }), 0.016);
    expect(foot.levels.tension).toBe(1);
    expect(foot.levels.beds.tension).toBeGreaterThan(0.5);
    expect(foot.tense).toBe(true);
    foot.setActive(false);
    expect(foot.tense).toBe(false);
  });
});

describe('the places you walk (Phase 7 piece I)', () => {
  const base: PlaceInputs = {
    place: 'district',
    inside: false,
    sunElevationDeg: -20,
    month0: 6,
    windKn: 8,
    rain01: 0,
    saloon: undefined,
    swimming: false,
  };

  it("plays the docks' water in a district, more at night, less indoors", () => {
    const night = placeMix(base);
    const day = placeMix({ ...base, sunElevationDeg: 40 });
    const indoors = placeMix({ ...base, inside: true });
    expect(night.docks).toBeGreaterThan(day.docks);
    expect(day.docks).toBeGreaterThan(0);
    expect(indoors.docks).toBeLessThan(night.docks);
    expect(indoors.docksLowpassHz).toBeLessThan(night.docksLowpassHz);
    expect(night.forest).toBe(0);
    expect(placeMix({ ...base, place: 'island' }).docks).toBe(0);
  });

  it('plays the woods on an island and a wild shore, with the wind', () => {
    const calm = placeMix({ ...base, place: 'island', windKn: 2 });
    const blowing = placeMix({ ...base, place: 'island', windKn: 20 });
    expect(calm.forest).toBeGreaterThan(0);
    expect(blowing.forest).toBeGreaterThan(calm.forest * 2);
    expect(placeMix({ ...base, place: 'shore', windKn: 20 }).forest).toBe(blowing.forest);
  });

  it('has crickets on summer nights only, and not in the rain', () => {
    const island = { ...base, place: 'island' as const };
    expect(placeMix(island).crickets).toBeGreaterThan(0);
    expect(placeMix({ ...island, sunElevationDeg: 30 }).crickets).toBe(0);
    expect(placeMix({ ...island, month0: 10 }).crickets).toBe(0);
    expect(placeMix({ ...island, month0: 3 }).crickets).toBe(0);
    expect(placeMix({ ...island, rain01: 0.8 }).crickets).toBe(0);
    expect(placeMix(base).crickets).toBeLessThan(placeMix(island).crickets);
  });

  it('hears the saloon from the street, muffled, and opens up inside', () => {
    const at = (distanceM: number, within = false, open = true): ReturnType<typeof placeMix> =>
      placeMix({ ...base, saloon: { distanceM, open, within } });
    expect(at(SALOON_REACH_M + 1).tune).toBe(0);
    expect(at(20).tune).toBeGreaterThan(0);
    expect(at(5).tune).toBeGreaterThan(at(20).tune);
    expect(at(5).saloonLowpassHz).toBeLessThan(2500);
    expect(at(5).saloonLowpassHz).toBeGreaterThan(at(30).saloonLowpassHz);
    const inside = at(3, true);
    expect(inside.tune).toBeGreaterThan(at(1).tune);
    expect(inside.room).toBeGreaterThan(at(1).room);
    expect(inside.saloonLowpassHz).toBeGreaterThan(8000);
    // Shut: nothing.
    expect(at(3, true, false).tune).toBe(0);
    expect(at(3, true, false).room).toBe(0);
    expect(placeMix(base).tune).toBe(0);
  });

  it('sets the beds each frame, and the tune gives way to the stealth layer', () => {
    const { foot } = sounds();
    const saloon = { x: 4, z: 0, open: true, within: true };
    foot.update(frame({ saloon }), 0.016);
    expect(foot.levels.beds.docks).toBeGreaterThan(0);
    expect(foot.levels.beds.room).toBeGreaterThan(0);
    const calm = foot.levels.beds.tune;
    expect(calm).toBeGreaterThan(0);
    foot.update(frame({ saloon, guards: [{ ...constable, state: 'alerted', meter: 1 }] }), 0.016);
    expect(foot.levels.beds.tune).toBeLessThan(calm);
    foot.setActive(false);
    expect(foot.levels.beds.docks).toBe(0);
  });
});

describe('swimming (Phase 7 piece I)', () => {
  it('shivers more often the colder the lake, and not in warm water', () => {
    expect(shiverEveryS(20)).toBeUndefined();
    const cold = shiverEveryS(4) ?? 0;
    const cool = shiverEveryS(15) ?? 0;
    expect(cold).toBeGreaterThan(0);
    expect(cold).toBeLessThan(cool);
  });

  it('splashes as you go in and shivers while you stay', () => {
    const { foot, shots } = sounds();
    foot.update(frame({ swimming: true, waterC: 5 }), 0.016);
    expect(idOf(shots[0])).toBe(FOOT_SOUND.splash);
    for (let t = 0; t < 12; t += 0.25) foot.update(frame({ swimming: true, waterC: 5 }), 0.25);
    const shivers = shots.filter((s) => idOf(s) === FOOT_SOUND.shiver);
    expect(shivers.length).toBeGreaterThanOrEqual(2);
    expect(shivers[0]?.bus).toBe('voice');
    // No second splash while you stay in.
    expect(shots.filter((s) => idOf(s) === FOOT_SOUND.splash)).toHaveLength(1);
  });
});

describe("the burglar's kit (Phase 7 piece I)", () => {
  it('sounds the cosh, the knife, the rope, the bottle and a bribe', () => {
    const { foot, shots } = sounds();
    foot.tool({ type: 'KnockedOut', npc: 'a', seenBy: [] });
    foot.tool({ type: 'Killed', npc: 'a', seenBy: [] });
    foot.tool({ type: 'Bound', npc: 'a' });
    foot.tool({ type: 'WhiskeyTaken', npc: 'a' });
    foot.tool({ type: 'BribePaid', npc: 'a', cents: 500 });
    expect(shots.slice(0, 4).map(idOf)).toEqual([
      FOOT_SOUND.cosh,
      FOOT_SOUND.knife,
      FOOT_SOUND.rope,
      FOOT_SOUND.bottle,
    ]);
    expect(PORT_SOUND.coins).toContain(idOf(shots[4]));
    foot.tool({ type: 'BribeRefused', npc: 'a', reports: false });
    expect(shots).toHaveLength(5);
  });

  it('lands a thrown stone where it fell, a moment after the throw', () => {
    const { foot, shots, captions } = sounds();
    foot.tool({ type: 'StoneThrown', x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -12 });
    expect(idOf(shots[0])).toBe(FOOT_SOUND.stone);
    expect(shots[0]?.at).toEqual({ x: 0, y: 0, z: -12 });
    expect(shots[0]?.delay).toBeGreaterThan(0.3);
    expect(captions.visible(12, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe('A stone lands');
  });

  it('fires the rifle, and the pistol as a smaller report', () => {
    const { foot, shots } = sounds();
    const shot = { type: 'Shot' as const, npc: 'a', hit: true, killed: true, seenBy: [] };
    foot.tool({ ...shot, tool: 'tool.rifle' });
    foot.tool({ ...shot, tool: 'tool.pistol' });
    expect(shots.map(idOf)).toEqual([LAW_SOUND.rifle, LAW_SOUND.rifle]);
    expect(shots[1]?.rate).toBeGreaterThan(shots[0]?.rate ?? 1);
  });

  it('splashes a body or a crate into the lake, and thumps one on the planks', () => {
    const { foot, shots } = sounds();
    foot.tool({ type: 'BodyDropped', npc: 'a', sunk: true, drowned: true });
    foot.tool({ type: 'BodyDropped', npc: 'a', sunk: false, drowned: false });
    foot.heist({ type: 'CrateDropped', good: 'good.fish', sunk: true });
    foot.heist({ type: 'CrateDropped', good: 'good.fish', sunk: false });
    expect(shots.map(idOf)).toEqual([
      FOOT_SOUND.splash,
      FOOT_SOUND.land,
      FOOT_SOUND.splash,
      FOOT_SOUND.crateDown,
    ]);
  });

  it('sounds the locks: a click, the lock giving and the door, the crowbar, a snapped pick', () => {
    const { foot, shots } = sounds();
    foot.heist({ type: 'LockClicked', lock: 'l' });
    foot.heist({ type: 'LockPicked', lock: 'l', building: 'b', tier: 1 });
    foot.heist({ type: 'LockForced', lock: 'l', building: 'b', owner: undefined });
    foot.heist({ type: 'PickBroken', lock: 'l', left: 2 });
    expect(shots.map(idOf)).toEqual([
      FOOT_SOUND.lockClick,
      FOOT_SOUND.lockOpen,
      FOOT_SOUND.door,
      FOOT_SOUND.crowbar,
      FOOT_SOUND.door,
      FOOT_SOUND.pickSnap,
    ]);
    // The door swings after the lock gives.
    expect(shots[2]?.delay).toBeGreaterThan(0);
  });

  it('works the pick while F is held and the lock is not yet open', () => {
    const { foot, shots } = sounds(() => 0.5);
    let hold = 0;
    for (let t = 0; t < 4; t += 0.1) {
      hold += 0.02;
      foot.update(frame({ picking: hold }), 0.1);
    }
    const scrapes = shots.filter((s) => idOf(s) === FOOT_SOUND.lockPick);
    expect(scrapes.length).toBeGreaterThanOrEqual(3);
    expect(scrapes[0]?.duration).toBeLessThan(1);
    // Held but not moving on (out of picks), or let go: quiet.
    const before = shots.length;
    for (let t = 0; t < 3; t += 0.1) foot.update(frame({ picking: hold }), 0.1);
    for (let t = 0; t < 3; t += 0.1) foot.update(frame(), 0.1);
    expect(shots).toHaveLength(before);
  });

  it('lifts and stows a crate, and counts a cash box out', () => {
    const { foot, shots } = sounds();
    foot.heist({ type: 'CrateLifted', good: 'good.fish', building: 'b' });
    foot.heist({ type: 'CrateStowed', good: 'good.fish', owner: undefined });
    foot.heist({
      type: 'ItemStolen',
      building: 'b',
      owner: undefined,
      cashCents: 800,
      documents: true,
    });
    expect(shots.slice(0, 2).map(idOf)).toEqual([FOOT_SOUND.crateLift, FOOT_SOUND.crateDown]);
    const rest = shots.slice(2).map(idOf);
    expect(rest.filter((id) => (PORT_SOUND.coins as readonly string[]).includes(id))).toHaveLength(
      2,
    );
    expect(rest).toContain(PORT_SOUND.open);
  });

  it('sounds the lockup: irons, keys, the cell door and the bars', () => {
    const { foot, shots } = sounds();
    foot.jail({ type: 'IronsSlipped' });
    expect(SOUND.chain).toContain(idOf(shots[0]));
    foot.jail({ type: 'KeysLifted' });
    foot.jail({ type: 'CellOpened', how: 'keys' });
    foot.jail({ type: 'BarsBanged' });
    foot.jail({ type: 'CellLocked' });
    foot.jail({ type: 'Dawn', tried: true });
    expect(shots.slice(1).map(idOf)).toEqual([
      FOOT_SOUND.keys,
      FOOT_SOUND.keys,
      FOOT_SOUND.door,
      FOOT_SOUND.bars,
      FOOT_SOUND.door,
      FOOT_SOUND.lockClick,
    ]);
  });
});

describe('foot synthesis (Phase 7 piece I)', () => {
  // High enough that every band the sounds use sits under half the rate.
  const RATE = 16000;
  const finite = (x: Float32Array): boolean => x.every((s) => Number.isFinite(s));
  /** RMS of a stretch, as a share of the whole's peak. */
  const rms = (x: Float32Array, from: number, to: number): number => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += (x[i] as number) ** 2;
    return Math.sqrt(sum / Math.max(1, to - from));
  };

  it('matches the grounds and variants the mix asks for', () => {
    expect([...SYNTH_GROUNDS]).toEqual([...STEP_GROUNDS]);
    expect(SYNTH_VARIANTS).toBe(STEP_VARIANTS);
  });

  it('renders every footstep short, loud at the start and different by variant', () => {
    for (const ground of SYNTH_GROUNDS) {
      const a = footstep(ground, 1, RATE);
      const b = footstep(ground, 2, RATE);
      expect(finite(a), ground).toBe(true);
      expect(a.length / RATE).toBeLessThan(0.5);
      expect(peak(a), ground).toBeGreaterThan(0.05);
      // The step is over well before the clip is: the tail is near silence.
      const head = rms(a, 0, Math.round(0.15 * RATE));
      const tail = rms(a, Math.round(0.34 * RATE), a.length);
      expect(tail, ground).toBeLessThan(head * 0.2);
      expect(
        a.some((s, i) => Math.abs(s - (b[i] as number)) > 1e-4),
        ground,
      ).toBe(true);
      // Seeded: the same samples every run.
      expect(footstep(ground, 1, RATE)).toEqual(a);
    }
  });

  it('renders the body and the kit', () => {
    const all: [string, Float32Array, number][] = [
      ['landing', landing(RATE), 1],
      ['swimSplash', swimSplash(RATE), 2],
      ['swimStroke', swimStroke(1, RATE), 1.2],
      ['shiver', shiver(RATE), 2],
      ['lockPick', lockPick(RATE), 2],
      ['lockClick', lockClick(RATE), 0.4],
      ['lockOpen', lockOpen(RATE), 1],
      ['pickSnap', pickSnap(RATE), 0.6],
      ['crowbar', crowbar(RATE), 2],
      ['doorCreak', doorCreak(RATE), 1.6],
      ['crateLift', crateLift(RATE), 1.2],
      ['crateDown', crateDown(RATE), 1],
      ['ropeTie', ropeTie(RATE), 2],
      ['coshBlow', coshBlow(RATE), 1.6],
      ['knifeBlow', knifeBlow(RATE), 1.6],
      ['bottle', bottle(RATE), 2.2],
      ['stoneLand', stoneLand(RATE), 1.2],
      ['keys', keys(RATE), 1.2],
      ['barsBang', barsBang(RATE), 4.5],
      ['policeWhistle', policeWhistle(RATE), 5],
      ['spottedStinger', spottedStinger(RATE), 6],
    ];
    for (const [name, x, maxS] of all) {
      expect(finite(x), name).toBe(true);
      expect(peak(x), name).toBeGreaterThan(0.02);
      expect(x.length / RATE, name).toBeLessThanOrEqual(maxS);
    }
    expect(swimStroke(1, RATE)).not.toEqual(swimStroke(2, RATE));
  });

  it('renders a bark for each change of mind, the shout the loudest and longest call', () => {
    const barks = Object.fromEntries(BARKS.map((b) => [b, guardBark(b, RATE)]));
    for (const name of BARKS) {
      const x = barks[name] as Float32Array;
      expect(finite(x), name).toBe(true);
      expect(peak(x), name).toBeGreaterThan(0.02);
      expect(x.length / RATE, name).toBeLessThan(3);
    }
    expect([...BARKS].sort()).toEqual(Object.keys(VOICE_REACH_M).sort());
    expect((barks['hm'] as Float32Array).length).toBeLessThan(
      (barks['hey'] as Float32Array).length,
    );
  });

  it('blows the whistle in two blasts with a breath between', () => {
    const x = policeWhistle(RATE);
    const first = rms(x, Math.round(0.2 * RATE), Math.round(0.6 * RATE));
    const gap = rms(x, Math.round(0.86 * RATE), Math.round(0.93 * RATE));
    const second = rms(x, Math.round(1.2 * RATE), Math.round(1.7 * RATE));
    expect(gap).toBeLessThan(first * 0.5);
    expect(second).toBeGreaterThan(first * 0.5);
  });

  it('renders the loops to their lengths, with no jump at the seam of the folded ones', () => {
    const tension = tensionLoop(RATE);
    expect(tension.length).toBe(Math.round(TENSION_LOOP_S * RATE));
    const tune = saloonTune(RATE);
    expect(tune.length).toBe(Math.round(SALOON_TUNE_S * RATE));
    const room = saloonRoom(RATE);
    expect(room.length).toBe(14 * RATE);
    for (const [name, x] of [
      ['tension', tension],
      ['tune', tune],
      ['room', room],
    ] as const) {
      expect(finite(x), name).toBe(true);
      const p = peak(x);
      expect(p, name).toBeGreaterThan(0.02);
      // The last sample runs into the first no harder than neighbors do elsewhere.
      let step = 0;
      for (let i = 1; i < x.length; i++) {
        step = Math.max(step, Math.abs((x[i] as number) - (x[i - 1] as number)));
      }
      expect(Math.abs((x[0] as number) - (x[x.length - 1] as number)), name).toBeLessThanOrEqual(
        step,
      );
    }
    for (const [name, x, seconds] of [
      ['docks', docksNight(RATE), 16],
      ['forest', forestWind(RATE), 18],
      ['crickets', crickets(RATE), 9],
    ] as const) {
      expect(finite(x), name).toBe(true);
      expect(x.length, name).toBe(seconds * RATE);
      expect(peak(x), name).toBeGreaterThan(0.02);
      // A bed, not an event: sound in every quarter of it.
      const q = x.length / 4;
      for (let k = 0; k < 4; k++) {
        expect(rms(x, Math.round(k * q), Math.round((k + 1) * q)), `${name} ${k}`).toBeGreaterThan(
          0.01 * peak(x),
        );
      }
    }
  });
});
