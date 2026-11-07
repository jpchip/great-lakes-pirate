import { describe, expect, it } from 'vitest';
import { CaptionFeed } from '../src/audio/captions';
import { LAW_SOUND, LAW_WHISTLE, LawSounds, type LawFrame } from '../src/audio/law-audio';
import {
  ALARM_STROKES,
  ENGINE_RANGE_M,
  HALF_HOUR_S,
  SHELL_MS,
  WANTED_STINGER_GAP_S,
  bellDue,
  bellPattern,
  engineLevel,
  hailKind,
  hailPattern,
  shipsBells,
  shotLevel,
  shotTiming,
  stingerAllowed,
  wantedStingerFor,
} from '../src/audio/law-mix';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { SOUND_MS } from '../src/audio/world-mix';
import { peak } from '../tools/audio/lib/synth';
import {
  ENGINE,
  ENGINE_REV_S,
  WANTED_STINGERS,
  bowGun,
  cutterEngine,
  lockupDoor,
  lockupRelease,
  newsboyCall,
  riggingHit,
  rifleShot,
  shotSplash,
  wantedStinger,
} from '../tools/audio/lib/synth-law';

/** A mixer that records what it's asked to play (no Web Audio, so no engine beds). */
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

/** A bank where every law sound (and the two whistles) is a buffer of `seconds`. */
function fakeBank(seconds = 3): Map<string, AudioBuffer> {
  const ids = [
    ...Object.values(LAW_SOUND.stinger),
    LAW_SOUND.engine,
    LAW_SOUND.bell,
    LAW_SOUND.gun,
    LAW_SOUND.splash,
    LAW_SOUND.riggingHit,
    LAW_SOUND.rifle,
    LAW_SOUND.door,
    LAW_SOUND.release,
    LAW_WHISTLE['law.morrill'].soundId,
    LAW_WHISTLE['law.chartered_tug'].soundId,
  ];
  return new Map(ids.map((id) => [id, { duration: seconds } as AudioBuffer]));
}

/** The value, or a failed test when it's missing. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('missing');
  return v;
}

const morrill = { id: 'law.morrill', key: 'cutter', x: 0, z: -686, speedKn: 10 } as const;
const tug = { id: 'law.chartered_tug', key: 'tug', x: 0, z: -343, speedKn: 9 } as const;

function frame(over: Partial<LawFrame> = {}): LawFrame {
  return {
    listener: { x: 0, y: 4, z: 0 },
    nowS: 10,
    gameSeconds: 1000,
    damping: 1,
    ships: [morrill],
    ...over,
  };
}

describe('Wanted stingers (Phase 5 piece H)', () => {
  it('picks the stinger by the highest tier reached, anywhere', () => {
    expect(wantedStingerFor([{ region: 'a', from: 0, to: 1 }], 'b')).toBe('rise');
    expect(wantedStingerFor([{ region: 'a', from: 1, to: 2 }], 'a')).toBe('rise');
    expect(wantedStingerFor([{ region: 'a', from: 2, to: 3 }], 'b')).toBe('hunted');
    expect(wantedStingerFor([{ region: 'a', from: 3, to: 4 }], 'a')).toBe('hunted');
    expect(wantedStingerFor([{ region: 'a', from: 4, to: 5 }], 'a')).toBe('most');
    expect(
      wantedStingerFor(
        [
          { region: 'a', from: 0, to: 1 },
          { region: 'b', from: 4, to: 5 },
          { region: 'c', from: 2, to: 1 },
        ],
        'c',
      ),
    ).toBe('most');
  });

  it('plays a fall only in the region you are in', () => {
    expect(wantedStingerFor([{ region: 'a', from: 2, to: 1 }], 'a')).toBe('cool');
    expect(wantedStingerFor([{ region: 'a', from: 2, to: 1 }], 'b')).toBeUndefined();
    expect(wantedStingerFor([{ region: 'a', from: 2, to: 1 }], undefined)).toBeUndefined();
    expect(wantedStingerFor([], 'a')).toBeUndefined();
  });

  it('keeps a quiet spell after a stinger that only a sharper one breaks', () => {
    expect(stingerAllowed('rise', undefined, 0)).toBe(true);
    expect(stingerAllowed('rise', 1, 2)).toBe(false);
    expect(stingerAllowed('cool', 1, 2)).toBe(false);
    expect(stingerAllowed('hunted', 1, 2)).toBe(true);
    expect(stingerAllowed('rise', 3, WANTED_STINGER_GAP_S)).toBe(true);
  });

  it('flushes one stinger a frame on the music bus, and none from the lockup', () => {
    const { mixer, shots } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    let ducked = 0;
    law.duckChart = (s) => (ducked = s);
    law.tierChanged({ region: 'a', from: 0, to: 1 });
    law.tierChanged({ region: 'a', from: 1, to: 3 });
    law.flush(1, 'a');
    expect(shots).toHaveLength(1);
    expect(shots[0]?.bus).toBe('music');
    expect(law.lastStinger).toBe('hunted');
    expect(law.ducking).toBe(true);
    expect(ducked).toBe(3);
    // Too soon for a milder one, and nothing pending plays twice.
    law.tierChanged({ region: 'a', from: 3, to: 2 });
    law.flush(2, 'a');
    law.flush(3, 'a');
    expect(shots).toHaveLength(1);
    // Serving a sentence: the world ticks on, the tiers fall, and nothing plays.
    law.tierChanged({ region: 'a', from: 3, to: 2 });
    law.flush(30, 'a', true);
    expect(shots).toHaveLength(1);
    // Let out: the release has its own cue, so the falls that came with it are dropped.
    law.tierChanged({ region: 'a', from: 2, to: 1 });
    law.released();
    law.flush(40, 'a');
    expect(shots.map((s) => s.bus)).toEqual(['music', 'ui']);
  });

  it('shuts the door, and tolls the bell for the gallows', () => {
    const { mixer, shots } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    law.jailed(false);
    expect(shots.map((s) => s.buffer)).toHaveLength(1);
    expect(shots[0]?.bus).toBe('ui');
    law.jailed(true);
    expect(shots).toHaveLength(3);
    expect(shots[2]?.bus).toBe('music');
    expect(shots[2]?.delay).toBeGreaterThan(2);
    expect(law.lastStinger).toBe('most');
  });

  it('lets you out to the chart stinger "clear" once the door is open', () => {
    const { mixer } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    const played: [string, number][] = [];
    law.chartStinger = (id, delay) => played.push([id, delay]);
    law.released();
    expect(played).toEqual([['clear', 2.4]]);
    expect(law.lastCue).toBe('release');
  });
});

describe("the cutter's whistle and bell (Phase 5 piece H)", () => {
  it('hails with a pattern per intent', () => {
    expect(hailKind({ intent: 'inspect', arrest: false })).toBe('inspect');
    expect(hailKind({ intent: 'pursue', arrest: false })).toBe('pursue');
    expect(hailKind({ intent: 'pursue', arrest: true })).toBe('arrest');
    expect(hailPattern('inspect')).toHaveLength(2);
    expect(hailPattern('pursue')).toHaveLength(5);
    expect(hailPattern('arrest')).toEqual([[0, 3]]);
    for (const [, len] of hailPattern('pursue')) expect(len).toBeLessThan(1);
  });

  it('plays her whistle from her funnel at the speed of sound, with a caption', () => {
    const { mixer, shots } = fakeMixer();
    const bank = fakeBank();
    const law = new LawSounds(mixer, bank);
    const captions = new CaptionFeed();
    law.captions = captions;
    law.update(frame(), 0.016);
    law.hailed(morrill, { intent: 'pursue', arrest: false });
    expect(shots).toHaveLength(5);
    const travel = Math.hypot(686, 10) / SOUND_MS;
    expect(shots[0]?.delay).toBeCloseTo(travel, 2);
    expect(shots[0]?.at).toEqual({ x: 0, y: 14, z: -686 });
    expect(shots[0]?.buffer).toBe(bank.get(LAW_WHISTLE['law.morrill'].soundId));
    expect(captions.visible(10, { x: 0, z: 0 }, { x: 0, z: -1 })).toEqual([]);
    const seen = captions.visible(10 + travel + 0.1, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(seen[0]?.text).toBe('Revenue cutter Morrill: whistle, five short blasts (heave to!)');
    expect(seen[0]?.arrow).toBe('↑');
  });

  it("strikes the ship's time in pairs, one to eight bells a watch", () => {
    expect(shipsBells(0.5)).toBe(1);
    expect(shipsBells(1)).toBe(2);
    expect(shipsBells(3.5)).toBe(7);
    expect(shipsBells(4)).toBe(8);
    expect(shipsBells(0)).toBe(8);
    expect(shipsBells(12.5)).toBe(1);
    expect(shipsBells(20)).toBe(8);
    const p = bellPattern(5);
    expect(p).toHaveLength(5);
    expect(must(p[1]) - must(p[0])).toBeLessThan(must(p[2]) - must(p[1]));
  });

  it('rings on the half hour, not when the clock jumps', () => {
    expect(bellDue(HALF_HOUR_S - 10, HALF_HOUR_S + 10)).toBe(HALF_HOUR_S);
    expect(bellDue(HALF_HOUR_S + 10, HALF_HOUR_S + 20)).toBeUndefined();
    expect(bellDue(100, 3 * HALF_HOUR_S + 5)).toBeUndefined();
    const { mixer, shots } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    law.update(frame({ gameSeconds: 4 * HALF_HOUR_S - 12 }), 0.5); // 01:59:48
    expect(shots).toHaveLength(0);
    law.update(frame({ gameSeconds: 4 * HALF_HOUR_S + 12 }), 0.5); // 02:00:12: four bells
    expect(shots).toHaveLength(4);
    expect(law.levels.bells).toBe(1);
    // Out of earshot, nothing.
    law.update(
      frame({ gameSeconds: 5 * HALF_HOUR_S + 12, ships: [{ ...morrill, z: -5000 }] }),
      0.5,
    );
    expect(shots).toHaveLength(4);
  });

  it('rings the alarm as she starts after you', () => {
    const { mixer, shots } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    law.update(frame(), 0.016);
    law.pursuit(morrill);
    expect(shots).toHaveLength(ALARM_STROKES.length);
    expect(law.lastCue).toBe('alarm');
  });
});

describe("the cutter's engine (Phase 5 piece H)", () => {
  it('is louder close aboard and with way on her, and quiet past its range', () => {
    const near = must(engineLevel(100, 10));
    const far = must(engineLevel(800, 10));
    const stopped = must(engineLevel(100, 0));
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(near.lowpassHz).toBeGreaterThan(far.lowpassHz);
    expect(near.gain).toBeGreaterThan(stopped.gain);
    expect(stopped.gain).toBeGreaterThan(0);
    expect(near.rate).toBeGreaterThan(stopped.rate);
    expect(engineLevel(ENGINE_RANGE_M, 10)).toBeUndefined();
    expect(must(engineLevel(800, 10, 0.3)).lowpassHz).toBeLessThan(far.lowpassHz);
    // The tug's smaller engine runs faster.
    expect(must(engineLevel(100, 10, 1, true)).rate).toBeGreaterThan(near.rate);
  });
});

describe("the cutter's gun (Phase 5 piece H)", () => {
  it('hears the report at the speed of sound and the round after its flight', () => {
    const t = shotTiming({ x: 0, z: -686 }, { x: 0, z: -80 }, { x: 0, z: 0 });
    expect(t.reportS).toBeCloseTo(686 / SOUND_MS, 5);
    expect(t.fallS).toBeCloseTo(606 / SHELL_MS + 80 / SOUND_MS, 5);
    expect(shotTiming({ x: 0, z: 0 }, undefined, { x: 10, z: 0 }).fallS).toBeUndefined();
    expect(must(shotLevel(100, 1000, 40)).gain).toBeGreaterThan(
      must(shotLevel(600, 1000, 40)).gain,
    );
    expect(shotLevel(1000, 1000, 40)).toBeUndefined();
  });

  it('fires a warning shot: the splash ahead of you, then the report from her', () => {
    const { mixer, shots } = fakeMixer();
    const law = new LawSounds(mixer, fakeBank());
    const captions = new CaptionFeed();
    law.captions = captions;
    law.update(frame(), 0.016);
    law.fired(morrill, { kind: 'warning', hit: false, at: { x: 0, z: -80 } });
    expect(shots.map((s) => s.buffer)).toHaveLength(2);
    expect(shots[0]?.at).toEqual({ x: 0, y: 4, z: -686 });
    expect(shots[1]?.at).toEqual({ x: 0, y: 1, z: -80 });
    // The round outruns its own report: the water goes up before the bang reaches you.
    expect(must(shots[1]?.delay)).toBeLessThan(must(shots[0]?.delay));
    expect(law.lastCue).toBe('warning shot');
    const seen = captions.visible(13, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(seen[0]?.text).toBe('Revenue cutter Morrill: gun, a shot across your bow');
  });

  it('tears the rigging on a hit, splashes on a miss', () => {
    const { mixer, shots } = fakeMixer();
    const bank = fakeBank();
    const law = new LawSounds(mixer, bank);
    law.update(frame(), 0.016);
    law.fired(morrill, { kind: 'rigging', hit: true, at: { x: 0, z: 0 } });
    expect(shots[1]?.buffer).toBe(bank.get(LAW_SOUND.riggingHit));
    law.fired(morrill, { kind: 'rigging', hit: false, at: { x: 30, z: 20 } });
    expect(shots[3]?.buffer).toBe(bank.get(LAW_SOUND.splash));
    expect(law.lastCue).toBe('gun, miss');
  });

  it("gives the tug's deputies rifles, not a gun", () => {
    const { mixer, shots } = fakeMixer();
    const bank = fakeBank();
    const law = new LawSounds(mixer, bank);
    law.update(frame({ ships: [tug] }), 0.016);
    law.fired(tug, { kind: 'rigging', hit: false });
    expect(shots).toHaveLength(3);
    for (const s of shots) expect(s.buffer).toBe(bank.get(LAW_SOUND.rifle));
    law.fired(tug, { kind: 'warning', hit: false });
    expect(shots).toHaveLength(4);
  });
});

describe('law synthesis (Phase 5 piece H)', () => {
  const RATE = 16000;
  const rms = (x: Float32Array, from: number, to: number): number => {
    let s = 0;
    const a = Math.round(from * RATE);
    const b = Math.min(x.length, Math.round(to * RATE));
    for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
    return Math.sqrt(s / Math.max(1, b - a));
  };

  it.each(WANTED_STINGERS)('renders the %s stinger, a few seconds long', (name) => {
    const x = wantedStinger(name, RATE);
    expect(x.length / RATE).toBeGreaterThan(2.5);
    expect(x.length / RATE).toBeLessThan(8);
    expect(Number.isFinite(peak(x))).toBe(true);
    expect(peak(x)).toBeGreaterThan(0);
  });

  it('renders the engine as whole revolutions plus the loop crossfade, beating once a rev', () => {
    const x = cutterEngine(RATE);
    expect(x.length).toBe(Math.round((ENGINE.revs * ENGINE_REV_S + ENGINE.crossfadeS) * RATE));
    // The thud at the top of each revolution stands over the middle of the revolution.
    expect(rms(x, ENGINE_REV_S, ENGINE_REV_S + 0.06)).toBeGreaterThan(
      rms(x, ENGINE_REV_S * 1.4, ENGINE_REV_S * 1.4 + 0.06),
    );
  });

  it('the gun cracks first and rolls away; the rifle is shorter', () => {
    const gun = bowGun(RATE);
    expect(rms(gun, 0, 0.1)).toBeGreaterThan(4 * rms(gun, 2.5, 3.5));
    const rifle = rifleShot(RATE);
    expect(rifle.length).toBeLessThan(gun.length);
    expect(rms(rifle, 0, 0.05)).toBeGreaterThan(4 * rms(rifle, 0.6, 1.2));
  });

  it('renders the splash, the rigging hit and both lockup sounds', () => {
    for (const x of [shotSplash(RATE), riggingHit(RATE), lockupDoor(RATE), lockupRelease(RATE)]) {
      expect(Number.isFinite(peak(x))).toBe(true);
      expect(peak(x)).toBeGreaterThan(0);
    }
    // The paper boy calls twice, with a breath between.
    const boy = newsboyCall(RATE);
    expect(rms(boy, 0.2, 0.6)).toBeGreaterThan(4 * rms(boy, 1.3, 1.5));
    expect(rms(boy, 1.7, 2.1)).toBeGreaterThan(4 * rms(boy, 1.3, 1.5));
    // The door bangs home after the hinge's creak.
    const door = lockupDoor(RATE);
    expect(rms(door, 0.85, 1.05)).toBeGreaterThan(2 * rms(door, 0.2, 0.6));
  });
});
