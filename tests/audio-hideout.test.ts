import { describe, expect, it } from 'vitest';
import { FOOT_SOUND } from '../src/audio/foot-audio';
import { HIDEOUT_SOUND, HideoutSounds, UI_SOUND, UiCues } from '../src/audio/hideout-audio';
import {
  CHIME_GAP_S,
  STILL_REACH_M,
  WORK_MAX_S,
  WORK_MIN_S,
  craftCues,
  familyOf,
  mainFamily,
  placeCue,
  stationSound,
  stillLevel,
  workVignette,
} from '../src/audio/hideout-mix';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { PORT_SOUND } from '../src/audio/port-audio';
import { peak } from '../tools/audio/lib/synth';
import {
  STILL_LOOP_S,
  WORK_LOOP_S,
  chimeBright,
  chimeSoft,
  cooperage,
  forge,
  hammerNail,
  handSaw,
  newspaperShake,
  pageTurn,
  placeKnock,
  planeStrokes,
  pryDown,
  refusedThud,
  stampThunk,
  stillAtWork,
  stillLoad,
  stoneSet,
  telegraph,
  workYard,
} from '../tools/audio/lib/synth-hideout';
import STRUCTURES from '../data/structures.json';
import STATIONS from '../data/stations.json';

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

/** A bank with a stand-in buffer for every id, named so the shots can be read back. */
function fakeBank(): Map<string, AudioBuffer> {
  const ids = [
    ...Object.values(HIDEOUT_SOUND).flat(),
    ...Object.values(UI_SOUND),
    PORT_SOUND.open,
    PORT_SOUND.close,
    FOOT_SOUND.crateDown,
  ];
  return new Map(ids.map((id) => [id, { id, duration: 8 } as unknown as AudioBuffer]));
}

const idOf = (s: OneShot): string => (s.buffer as unknown as { id: string }).id;

describe('the rules (Phase 8 piece I)', () => {
  it('hears every material in structures.json as one of four families', () => {
    const materials = new Set(
      (STRUCTURES as { variants: { material: string }[] }[]).flatMap((p) =>
        p.variants.map((v) => v.material),
      ),
    );
    expect(familyOf('brownstone')).toBe('stone');
    expect(familyOf('flagstone')).toBe('stone');
    expect(familyOf('iron')).toBe('iron');
    expect(familyOf('tarpaper')).toBe('soft');
    expect(familyOf('plank')).toBe('wood');
    for (const m of materials) expect(['wood', 'stone', 'iron', 'soft']).toContain(familyOf(m));
    expect(mainFamily(['plank', 'brownstone', 'brownstone'])).toBe('stone');
    expect(mainFamily([])).toBe('wood');
  });

  it('knocks lower for stone than for wood', () => {
    expect(placeCue('stone').rate).toBeLessThan(placeCue('wood').rate);
    expect(placeCue('wood').id).toBe('place');
  });

  it('plays the yard longer for longer work, within its bounds', () => {
    const r = (): number => 0.5;
    const hour = workVignette(['plank'], 3600, r);
    const day = workVignette(Array(30).fill('plank'), 30 * 3600, r);
    const week = workVignette(Array(30).fill('plank'), 200 * 3600, r);
    expect(workVignette([], 0, r).bedS).toBe(WORK_MIN_S);
    expect(day.bedS).toBeGreaterThan(hour.bedS);
    expect(week.bedS).toBe(WORK_MAX_S);
    // Never more beats than pieces, and every beat lands before the bed fades.
    expect(hour.cues).toHaveLength(1);
    for (const c of week.cues) expect(c.delay).toBeLessThan(week.bedS - 0.5);
  });

  it('sounds a stone wall of stone and a plank room of saws and hammers', () => {
    const r = (): number => 0.3;
    const stone = workVignette(Array(10).fill('brownstone'), 20 * 3600, r);
    expect(stone.cues.filter((c) => c.id === 'stone').length).toBeGreaterThan(0);
    expect(stone.cues.some((c) => c.id === 'saw')).toBe(false);
    const wood = workVignette(Array(10).fill('plank'), 20 * 3600, r);
    expect(new Set(wood.cues.map((c) => c.id))).toEqual(new Set(['saw', 'hammer']));
    // Half stone, half plank: both heard.
    const mixed = workVignette(
      [...Array(5).fill('brownstone'), ...Array(5).fill('plank')],
      20 * 3600,
      r,
    );
    const ids = new Set(mixed.cues.map((c) => c.id));
    expect(ids.has('stone') && (ids.has('saw') || ids.has('hammer'))).toBe(true);
  });

  it('gives every station in stations.json a sound, and long jobs a second one', () => {
    for (const s of STATIONS as { id: string }[]) {
      expect(craftCues(stationSound(s.id), 3600).length).toBeGreaterThan(0);
    }
    expect(craftCues('smithy', 3600)[0]?.id).toBe('forge');
    expect(craftCues('cooperage', 3600)[0]?.id).toBe('cooperage');
    expect(craftCues('distillery', 0)).toEqual([{ id: 'stillLoad', delay: 0, gain: 0.8, rate: 1 }]);
    expect(craftCues('workbench', 3600).map((c) => c.id)).toEqual(['saw', 'plane', 'hammer']);
    expect(craftCues('smithy', 6 * 3600)).toHaveLength(2);
    expect(stationSound(undefined)).toBe('workbench');
  });

  it('hears a still at work close by, duller and fainter further off, gone past its reach', () => {
    const near = stillLevel(2);
    const mid = stillLevel(15);
    expect(near.gain).toBe(1);
    expect(mid.gain).toBeLessThan(near.gain);
    expect(mid.lowpassHz).toBeLessThan(near.lowpassHz);
    expect(stillLevel(STILL_REACH_M).gain).toBe(0);
    expect(stillLevel(Infinity).gain).toBe(0);
  });
});

describe('the playback', () => {
  it('opens and closes build mode with paper and turns a page per category', () => {
    const { mixer, shots } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    s.opened();
    s.page();
    s.closed();
    expect(shots.map(idOf)).toEqual([PORT_SOUND.open, UI_SOUND.page, PORT_SOUND.close]);
    expect(shots.every((x) => x.bus === 'ui')).toBe(true);
  });

  it('knocks a placement, thuds a refusal, pries a built piece and knocks a cleared plan', () => {
    const { mixer, shots } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    s.placed(['brownstone']);
    s.refused();
    s.removed(['plank'], true);
    s.removed(['plank'], false);
    expect(shots.map(idOf)).toEqual([
      HIDEOUT_SOUND.place,
      HIDEOUT_SOUND.refused,
      HIDEOUT_SOUND.pry,
      HIDEOUT_SOUND.place,
    ]);
    expect(shots[0]?.rate).toBeLessThan(1);
    expect(shots[1]?.bus).toBe('ui');
    expect(shots[2]?.bus).toBe('sfx');
  });

  it('plays the yard under the work when Build runs, cut to the vignette', () => {
    const { mixer, shots } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    s.built(Array(8).fill('plank'), 12 * 3600);
    const bed = shots.find((x) => idOf(x) === HIDEOUT_SOUND.work);
    expect(bed?.bus).toBe('ambience');
    expect(bed?.duration).toBeCloseTo(s.levels.workBedS);
    const beats = shots.filter((x) => idOf(x) !== HIDEOUT_SOUND.work);
    expect(beats.length).toBeGreaterThan(1);
    expect(beats.some((x) => idOf(x) === HIDEOUT_SOUND.saw)).toBe(true);
    expect(beats.some((x) => (HIDEOUT_SOUND.hammer as readonly string[]).includes(idOf(x)))).toBe(
      true,
    );
  });

  it('plays the station a craft was made at', () => {
    const { mixer, shots } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    s.crafted('station.smithy', 2 * 3600);
    s.crafted('station.cooperage', 3600);
    s.crafted('station.distillery', 0);
    expect(shots.map(idOf)).toEqual([
      HIDEOUT_SOUND.forge,
      HIDEOUT_SOUND.cooperage,
      HIDEOUT_SOUND.stillLoad,
    ]);
  });

  it('sets salvage down as stone or as a load of lumber', () => {
    const { mixer, shots } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    s.salvage('good.brownstone');
    s.salvage('good.lumber');
    expect(shots.map(idOf)).toEqual([HIDEOUT_SOUND.stone, FOOT_SOUND.crateDown]);
  });

  it('reads the nearest running still and lets it go off your feet', () => {
    const { mixer } = fakeMixer();
    const s = new HideoutSounds(mixer, fakeBank(), () => 0.5);
    const listener = { x: 0, y: 1.7, z: 0 };
    s.update(
      listener,
      [
        { x: 40, y: 1, z: 0 },
        { x: 3, y: 1.7, z: 0 },
      ],
      0.016,
    );
    expect(s.levels.still).toBeCloseTo(stillLevel(3).gain);
    s.update(listener, [], 0.016);
    expect(s.levels.still).toBe(0);
    s.update(listener, [{ x: 2, y: 1.7, z: 0 }], 0.016);
    s.stop();
    expect(s.levels.still).toBe(0);
  });

  it('stamps, shakes the paper, taps the telegraph, and rings a bell at most once in the gap', () => {
    const { mixer, shots } = fakeMixer();
    let t = 0;
    const ui = new UiCues(mixer, fakeBank(), () => t);
    ui.play('stamp');
    ui.play('newspaper');
    ui.play('telegraph');
    ui.play('chimeSoft');
    ui.play('chimeSoft');
    t += CHIME_GAP_S + 0.1;
    ui.play('chimeBright');
    expect(shots.map(idOf)).toEqual([
      UI_SOUND.stamp,
      UI_SOUND.newspaper,
      UI_SOUND.telegraph,
      UI_SOUND.chimeSoft,
      UI_SOUND.chimeBright,
    ]);
    expect(shots.every((x) => x.bus === 'ui')).toBe(true);
  });
});

describe('the synthesis', () => {
  const RATE = 48000;
  const sounds: [string, Float32Array][] = [
    ['saw', handSaw(RATE)],
    ['hammer-1', hammerNail(1, RATE)],
    ['hammer-2', hammerNail(2, RATE)],
    ['stone', stoneSet(RATE)],
    ['plane', planeStrokes(RATE)],
    ['pry', pryDown(RATE)],
    ['knock', placeKnock(RATE)],
    ['thud', refusedThud(RATE)],
    ['forge', forge(RATE)],
    ['cooperage', cooperage(RATE)],
    ['still-load', stillLoad(RATE)],
    ['stamp', stampThunk(RATE)],
    ['newspaper', newspaperShake(RATE)],
    ['telegraph', telegraph(RATE)],
    ['page', pageTurn(RATE)],
    ['chime-soft', chimeSoft(RATE)],
    ['chime-bright', chimeBright(RATE)],
  ];

  it.each(sounds)('%s is finite, audible and short', (_, x) => {
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.05);
    expect(x.length / RATE).toBeLessThan(6);
  });

  it('renders the beds a crossfade longer than their loops, and the same samples twice', () => {
    expect(workYard(RATE).length).toBe(Math.round((WORK_LOOP_S + 1) * RATE));
    expect(stillAtWork(RATE).length).toBe(Math.round((STILL_LOOP_S + 1) * RATE));
    expect(handSaw(RATE)).toEqual(handSaw(RATE));
  });

  it('ends a refusal dull: little above 1 kHz', () => {
    const x = refusedThud(RATE);
    // A crude high-pass: the sample-to-sample difference stays small next to the level.
    let diff = 0;
    for (let i = 1; i < x.length; i++)
      diff = Math.max(diff, Math.abs((x[i] as number) - (x[i - 1] as number)));
    expect(diff / peak(x)).toBeLessThan(0.1);
  });
});
