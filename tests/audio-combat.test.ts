import { describe, expect, it } from 'vitest';
import { CaptionFeed } from '../src/audio/captions';
import {
  CHASE_STEMS,
  COMBAT_SOUND,
  CombatSounds,
  FIGHT_OUTCOME_S,
  type CombatFrame,
} from '../src/audio/combat-audio';
import {
  CHASE_RULES,
  ChaseState,
  FLYBY,
  GUN_SOUNDS,
  OWN_FLYBY,
  chaseLevelFor,
  closestApproach,
  flybyFor,
  gunKindOf,
  impactFor,
  impactKindOf,
  reportFor,
  stemGains,
} from '../src/audio/combat-mix';
import { LAW_SOUND } from '../src/audio/law-audio';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { SOUND_MS } from '../src/audio/world-mix';
import { peak } from '../tools/audio/lib/synth';
import {
  CHASE,
  CHASE_CHORDS,
  CHASE_LOOP_S,
  CHASE_TUNE,
  FLYBY_PASS_S,
  ZIP_PASS_S,
  ballSplash,
  ballZip,
  boardingFight,
  boilerBlast,
  cannonGun,
  chaseStem,
  crewCheer,
  crewDefiant,
  crewStrike,
  grapple,
  hitCanvas,
  hitWood,
  rifleNear,
  shotFlyby,
  struckStinger,
  swivelGun,
} from '../tools/audio/lib/synth-combat';

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
    ...Object.values(COMBAT_SOUND),
    ...Object.values(CHASE_STEMS),
    LAW_SOUND.gun,
    LAW_SOUND.rifle,
    LAW_SOUND.splash,
    LAW_SOUND.riggingHit,
  ];
  // The buffer's id rides along as its duration's tag, so a test can tell them apart.
  return new Map(ids.map((id) => [id, { duration: 3, id } as unknown as AudioBuffer]));
}

const idOf = (s: OneShot): string => (s.buffer as unknown as { id: string }).id;

const frame = (over: Partial<CombatFrame> = {}): CombatFrame => ({
  listener: { x: 0, y: 3, z: 0 },
  nowS: 10,
  damping: 1,
  shots: [],
  targets: [],
  lawPursuitM: undefined,
  ...over,
});

function setup(): { sounds: CombatSounds; shots: OneShot[]; captions: CaptionFeed } {
  const { mixer, shots } = fakeMixer();
  const sounds = new CombatSounds(mixer, fakeBank());
  const captions = new CaptionFeed();
  sounds.captions = captions;
  sounds.update(frame(), 0.016);
  return { sounds, shots, captions };
}

describe('combat sound rules (Phase 6 piece G)', () => {
  it('hears a gun close to from the deck, and its far report across the water', () => {
    const near = reportFor('broadside', 20);
    expect(near?.soundId).toBe(GUN_SOUNDS.broadside.near);
    expect(near?.gain).toBeCloseTo(1);
    const far = reportFor('broadside', 2000);
    expect(far?.soundId).toBe(LAW_SOUND.gun);
    expect(far?.delayS).toBeCloseTo(2000 / SOUND_MS);
    expect(far?.gain ?? 1).toBeLessThan(0.2);
    expect(reportFor('broadside', 9000)).toBeUndefined();
    // A rifle carries less far than a swivel, a swivel less than a cannon.
    expect(reportFor('small_arms', 3000)).toBeUndefined();
    expect(reportFor('swivel', 3000)).toBeDefined();
    // Fog dulls it.
    expect(reportFor('swivel', 1000, 0.3)?.lowpassHz ?? 0).toBeLessThan(
      reportFor('swivel', 1000, 1)?.lowpassHz ?? 0,
    );
  });

  it("knows a weapon's kind, or guesses it from the id", () => {
    expect(gunKindOf('weapon.swivel', 'swivel')).toBe('swivel');
    expect(gunKindOf('weapon.rifle')).toBe('small_arms');
    expect(gunKindOf('weapon.morrill_bow_gun')).toBe('broadside');
  });

  it('times a fly-by so the pass falls at the closest approach', () => {
    // A ball 100 m off coming straight past 10 m abeam at 100 m/s: closest in 1 s.
    const shot = { pos: { x: -100, y: 3, z: 10 }, vel: { x: 100, y: 0, z: 0 }, ammo: 'ammo.round' };
    const c = closestApproach(shot.pos, shot.vel, { x: 0, y: 3, z: 0 });
    expect(c.tS).toBeCloseTo(1);
    expect(c.missM).toBeCloseTo(10);
    // 1.2 s off is too soon to start (the pass is 0.9 s into the buffer)...
    expect(
      flybyFor({ ...shot, pos: { x: -120, y: 3, z: 10 } }, { x: 0, y: 3, z: 0 }),
    ).toBeUndefined();
    // ...a frame later it starts, lined up on the pass.
    const later = { ...shot, pos: { x: -92, y: 3, z: 10 } };
    const f = flybyFor(later, { x: 0, y: 3, z: 0 });
    expect(f?.soundId).toBe(FLYBY.round.soundId);
    expect((f?.delayS ?? 0) + FLYBY.round.passS - (f?.offsetS ?? 0)).toBeCloseTo(0.92);
    // Wide of the listener, or already gone by: nothing.
    expect(flybyFor({ ...later, pos: { x: -92, y: 3, z: 200 } }, { x: 0, y: 3, z: 0 })).toBe(
      undefined,
    );
    expect(flybyFor({ ...later, pos: { x: 50, y: 3, z: 10 } }, { x: 0, y: 3, z: 0 })).toBe(
      undefined,
    );
    // A rifle ball zips, and only close.
    const ball = { pos: { x: -10, y: 3, z: 5 }, vel: { x: 140, y: 0, z: 0 }, ammo: 'ammo.ball' };
    expect(flybyFor(ball, { x: 0, y: 3, z: 0 })?.soundId).toBe(FLYBY.ball.soundId);
    expect(flybyFor({ ...ball, pos: { x: -10, y: 3, z: 30 } }, { x: 0, y: 3, z: 0 })).toBe(
      undefined,
    );
  });

  it('lands in water, wood or canvas, a rifle ball smaller', () => {
    expect(impactKindOf('water')).toBe('water');
    expect(impactKindOf('rigging')).toBe('canvas');
    expect(impactKindOf('waterline')).toBe('wood');
    expect(impactKindOf('deck')).toBe('wood');
    expect(impactFor('water', 'ammo.round', 50)?.soundId).toBe(LAW_SOUND.splash);
    expect(impactFor('water', 'ammo.ball', 50)?.soundId).toBe('sfx.combat.splash-ball');
    expect(impactFor('wood', 'ammo.round', 50)?.soundId).toBe(COMBAT_SOUND.hitWood);
    expect(impactFor('canvas', 'ammo.round', 50)?.soundId).toBe(COMBAT_SOUND.hitCanvas);
    // Chain shot parts a stay.
    expect(impactFor('canvas', 'ammo.chain', 50)?.soundId).toBe(LAW_SOUND.riggingHit);
    const ball = impactFor('wood', 'ammo.ball', 20);
    const round = impactFor('wood', 'ammo.round', 20);
    expect(ball?.gain ?? 1).toBeLessThan(round?.gain ?? 0);
    expect(ball?.rate).toBeGreaterThan(1);
    expect(impactFor('water', 'ammo.ball', 800)).toBeUndefined();
  });

  it('plays the chase at full tilt with gunfire or a ship running close, tension further off', () => {
    const quiet = { sinceGunfireS: Infinity, targets: [], lawPursuitM: undefined };
    expect(chaseLevelFor(quiet)).toBe(0);
    expect(chaseLevelFor({ ...quiet, sinceGunfireS: 3 })).toBe(2);
    expect(chaseLevelFor({ ...quiet, sinceGunfireS: CHASE_RULES.gunfireS + 1 })).toBe(0);
    expect(chaseLevelFor({ ...quiet, targets: [{ phase: 'fleeing', distanceM: 600 }] })).toBe(2);
    expect(chaseLevelFor({ ...quiet, targets: [{ phase: 'fleeing', distanceM: 2000 }] })).toBe(1);
    expect(chaseLevelFor({ ...quiet, targets: [{ phase: 'alert', distanceM: 600 }] })).toBe(1);
    expect(chaseLevelFor({ ...quiet, targets: [{ phase: 'struck', distanceM: 100 }] })).toBe(0);
    expect(chaseLevelFor({ ...quiet, targets: [{ phase: 'transit', distanceM: 100 }] })).toBe(0);
    // The law after you: close is a chase, out of sight still tension.
    expect(chaseLevelFor({ ...quiet, lawPursuitM: 800 })).toBe(2);
    expect(chaseLevelFor({ ...quiet, lawPursuitM: Infinity })).toBe(1);
  });

  it('rises at once and falls only after the hold', () => {
    const c = new ChaseState();
    expect(c.update(2, 0.1)).toBe(2);
    expect(c.update(0, CHASE_RULES.holdS / 2)).toBe(2);
    expect(c.update(0, CHASE_RULES.holdS / 2)).toBe(0);
    expect(stemGains(0)).toEqual({ drums: 0, fiddle: 0 });
    expect(stemGains(1).fiddle).toBe(0);
    expect(stemGains(1).drums).toBeGreaterThan(0);
    expect(stemGains(2).fiddle).toBeGreaterThan(0);
  });
});

describe('combat playback (Phase 6 piece G)', () => {
  it('fires your own swivel close to, with its round whistling away; no caption', () => {
    const { sounds, shots, captions } = setup();
    sounds.fired(
      {
        by: 'ship.player',
        kind: 'swivel',
        ammo: 'ammo.round',
        at: { x: 0, z: -10 },
        y: 3,
        bearing: 0,
      },
      true,
    );
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.swivel, COMBAT_SOUND.flyby]);
    expect(shots[0]?.bus).toBe('sfx');
    expect(shots[1]?.offset).toBe(FLYBY.round.passS);
    expect(shots[1]?.gain).toBe(OWN_FLYBY.gain);
    expect(captions.visible(10, { x: 0, z: 0 }, { x: 0, z: -1 })).toEqual([]);
    expect(sounds.lastCue).toBe('swivel');
  });

  it("hears another ship's gun late across the water, captioned; a rifle has no whistle", () => {
    const { sounds, shots, captions } = setup();
    sounds.fired(
      { by: 'ship.x', kind: 'broadside', ammo: 'ammo.round', at: { x: 0, z: -1029 }, bearing: 0 },
      false,
    );
    expect(shots.map(idOf)).toEqual([LAW_SOUND.gun]);
    expect(shots[0]?.delay).toBeCloseTo(3, 1);
    // The caption shows once the sound has arrived.
    expect(captions.visible(13.5, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe('gunfire');
    shots.length = 0;
    sounds.fired(
      { by: 'ship.player', kind: 'small_arms', ammo: 'ammo.ball', at: { x: 0, z: 0 }, bearing: 0 },
      true,
    );
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.rifle]);
  });

  it('whistles each round going by once, not your own', () => {
    const { sounds, shots } = setup();
    const shot = {
      id: 7,
      shooter: 'law.morrill',
      ammo: 'ammo.round',
      pos: { x: -60, y: 3, z: 8 },
      vel: { x: 100, y: 0, z: 0 },
    };
    sounds.update(frame({ shots: [shot, { ...shot, id: 8, shooter: 'ship.player' }] }), 0.016);
    sounds.update(frame({ shots: [{ ...shot, pos: { x: -58, y: 3, z: 8 } }] }), 0.016);
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.flyby]);
    expect(sounds.flybys).toBe(1);
  });

  it('a boiler bursting is heard across the zone and captioned', () => {
    const { sounds, shots, captions } = setup();
    sounds.boiler({ x: 0, z: -3430 });
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.boiler]);
    expect(shots[0]?.delay).toBeCloseTo(10, 0);
    expect(captions.visible(21, { x: 0, z: 0 }, { x: 0, z: -1 })[0]?.text).toBe(
      'a boiler explodes',
    );
  });

  it('she strikes: her crew shouts from her deck, and the stinger plays', () => {
    const { sounds, shots } = setup();
    sounds.struck({ x: 0, z: -200 });
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.strike, COMBAT_SOUND.struck]);
    expect(shots[0]?.bus).toBe('voice');
    expect(shots[1]?.bus).toBe('music');
    // Far off it's someone else's business: no stinger, and past earshot no shout.
    shots.length = 0;
    sounds.struck({ x: 0, z: -5000 });
    expect(shots).toEqual([]);
  });

  it('grapples, and plays the boarding vignette with its outcome after the melee', () => {
    const { sounds, shots } = setup();
    sounds.grappled();
    sounds.intimidated(false);
    sounds.fight(true);
    expect(shots.map(idOf)).toEqual([
      COMBAT_SOUND.grapple,
      COMBAT_SOUND.defiant,
      COMBAT_SOUND.fight,
      COMBAT_SOUND.cheer,
    ]);
    expect(shots[3]?.delay).toBe(FIGHT_OUTCOME_S);
    shots.length = 0;
    sounds.fight(false);
    expect(shots.map(idOf)).toEqual([COMBAT_SOUND.fight, COMBAT_SOUND.defiant]);
    expect(sounds.lastCue).toBe('fight lost');
  });

  it('a gun heard starts the chase, which settles after she strikes and the hold runs out', () => {
    const { sounds } = setup();
    sounds.fired(
      { by: 'ship.player', kind: 'swivel', ammo: 'ammo.warning', at: { x: 0, z: 0 }, bearing: 0 },
      true,
    );
    sounds.update(frame({ nowS: 10.1 }), 0.1);
    expect(sounds.chase).toBe(2);
    sounds.struck({ x: 0, z: -100 });
    sounds.update(frame({ nowS: 11 }), 1);
    expect(sounds.chase).toBe(2);
    sounds.update(frame({ nowS: 11 + CHASE_RULES.holdS }), CHASE_RULES.holdS);
    expect(sounds.chase).toBe(0);
    sounds.forceChase(1);
    sounds.update(frame({ nowS: 30 }), 0.1);
    expect(sounds.chase).toBe(1);
  });
});

describe('combat synthesis (Phase 6 piece G)', () => {
  const RATE = 16000;
  const rms = (x: Float32Array, from: number, to: number): number => {
    let s = 0;
    const a = Math.round(from * RATE);
    const b = Math.min(x.length, Math.round(to * RATE));
    for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
    return Math.sqrt(s / Math.max(1, b - a));
  };
  const ok = (x: Float32Array): void => {
    expect(Number.isFinite(peak(x))).toBe(true);
    expect(peak(x)).toBeGreaterThan(0);
  };

  it('the guns bang first and die away, the cannon deepest and longest', () => {
    const swivel = swivelGun(RATE);
    const cannon = cannonGun(RATE);
    const rifle = rifleNear(RATE);
    for (const x of [swivel, cannon, rifle]) ok(x);
    expect(rms(swivel, 0, 0.1)).toBeGreaterThan(6 * rms(swivel, 1.2, 1.7));
    expect(cannon.length).toBeGreaterThan(swivel.length);
    // The rifle's lever is worked after the shot has died away.
    expect(rms(rifle, 0.775, 0.81)).toBeGreaterThan(2 * rms(rifle, 0.6, 0.7));
  });

  it('a round going by is loudest at its pass, a ball zips past quickly', () => {
    const fly = shotFlyby(RATE);
    expect(rms(fly, FLYBY_PASS_S - 0.1, FLYBY_PASS_S + 0.1)).toBeGreaterThan(3 * rms(fly, 0, 0.2));
    expect(FLYBY.round.passS).toBe(FLYBY_PASS_S);
    const zip = ballZip(RATE);
    expect(FLYBY.ball.passS).toBe(ZIP_PASS_S);
    expect(zip.length / RATE).toBeLessThan(0.6);
    ok(zip);
  });

  it('renders the impacts, the boiler, the grapple and the boarding voices', () => {
    for (const x of [
      ballSplash(RATE),
      hitWood(RATE),
      hitCanvas(RATE),
      grapple(RATE),
      boardingFight(RATE),
      crewCheer(RATE),
      crewStrike(RATE),
      crewDefiant(RATE),
      struckStinger(RATE),
    ]) {
      ok(x);
    }
    const boiler = boilerBlast(RATE);
    ok(boiler);
    // The steam goes on roaring well after the blast.
    expect(rms(boiler, 2, 3)).toBeGreaterThan(0.05 * rms(boiler, 0, 0.3));
    // The hulls come together after the hook bites.
    const g = grapple(RATE);
    expect(rms(g, 2.4, 2.6)).toBeGreaterThan(2 * rms(g, 1.8, 2.1));
  });

  it('the chase tune fills its bars, and both stems are one seamless loop long', () => {
    const eighths = CHASE_TUNE.reduce((n, [, e]) => n + e, 0);
    expect(eighths).toBe(CHASE.bars * 8);
    expect(CHASE_CHORDS.length).toBe(CHASE.bars);
    const drums = chaseStem('drums', RATE);
    const fiddle = chaseStem('fiddle', RATE);
    expect(drums.length).toBe(Math.round(CHASE_LOOP_S * RATE));
    expect(fiddle.length).toBe(drums.length);
    ok(drums);
    ok(fiddle);
    // No step at the seam: the end runs on into the start.
    for (const x of [drums, fiddle]) {
      const jump = Math.abs((x[0] as number) - (x[x.length - 1] as number));
      expect(jump).toBeLessThan(0.25 * peak(x));
    }
  }, 60_000);
});
