import { describe, expect, it } from 'vitest';
import { FOOT_SOUND } from '../src/audio/foot-audio';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { PORT_SOUND } from '../src/audio/port-audio';
import { RIVAL_GAP_S, SANDBOX_SOUND, SandboxSounds } from '../src/audio/sandbox-audio';
import {
  AGROUND_REACH_M,
  CLOCKWORK_REACH_M,
  POKER_MAX_S,
  SNORE_REACH_M,
  agroundHeard,
  clockworkLevel,
  groundingGain,
  pokerCues,
  saloonNight,
  snoreLevel,
  stationCues,
} from '../src/audio/sandbox-mix';
import {
  YOU,
  dealHand,
  openTable,
  yourAction,
  yourDraw,
  yourOptions,
  type PokerBeat,
} from '../src/sim/poker/table';
import { peak } from '../tools/audio/lib/synth';
import {
  CLOCKWORK_BEAT_S,
  CLOCKWORK_LOOP_S,
  NIGHT_WALTZ,
  SNORE_LOOP_S,
  agroundCrew,
  cardDealt,
  cardsFolded,
  cardsShown,
  chipsDown,
  clockwork,
  clockworkWound,
  deskBell,
  keeperGreeting,
  keeperSnore,
  lampDoused,
  lampLit,
  letterOpened,
  letterSealed,
  nightWaltzForm,
  oilCan,
  oilSlosh,
  pianoNote,
  potRaked,
  rivalStinger,
  shipAground,
  shuffle,
  tableKnock,
  towerStair,
} from '../tools/audio/lib/synth-sandbox';
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
    ...Object.values(SANDBOX_SOUND).flat(),
    ...PORT_SOUND.coins,
    PORT_SOUND.open,
    PORT_SOUND.pen,
    FOOT_SOUND.rope,
    FOOT_SOUND.crateDown,
    FOOT_SOUND.cosh,
  ];
  return new Map(ids.map((id) => [id, { id, duration: 5 } as unknown as AudioBuffer]));
}

const idOf = (s: OneShot): string => (s.buffer as unknown as { id: string }).id;

function sounds(): { s: SandboxSounds; shots: OneShot[] } {
  const { mixer, shots } = fakeMixer();
  return { s: new SandboxSounds(mixer, fakeBank(), random), shots };
}

const frame = (nowS: number) => ({
  nowS,
  listener: { x: 0, y: 3, z: 0 },
  player: undefined,
  station: undefined,
  hour: 22,
  ashore: false,
  damping: 0,
});

describe('the rules (Phase 9 piece J)', () => {
  it('plays the piano and fiddle from supper till the small hours', () => {
    expect(saloonNight(19)).toBe(true);
    expect(saloonNight(23)).toBe(true);
    expect(saloonNight(2)).toBe(true);
    expect(saloonNight(5)).toBe(false);
    expect(saloonNight(12)).toBe(false);
    expect(saloonNight(18)).toBe(false);
  });

  it('hears a deal as antes, the shuffle and the cards round, in that order', () => {
    const cues = pokerCues([{ kind: 'deal', you: true, cents: 100, cards: 20 }], random);
    expect(cues.map((c) => c.id).slice(0, 3)).toEqual(['chips', 'chips', 'shuffle']);
    const deals = cues.filter((c) => c.id === 'deal');
    expect(deals).toHaveLength(20);
    const shuffleAt = cues.find((c) => c.id === 'shuffle')?.delay ?? 0;
    expect(Math.min(...deals.map((d) => d.delay))).toBeGreaterThan(shuffleAt + 1.5);
  });

  it('hears each move in turn: a check knocks, a raise is more chips, a fold the cards in', () => {
    const beats: PokerBeat[] = [
      { kind: 'check', you: true },
      { kind: 'bet', you: false, cents: 50 },
      { kind: 'raise', you: false, cents: 100 },
      { kind: 'fold', you: false },
      { kind: 'draw', you: false, cards: 0 },
      { kind: 'draw', you: true, cards: 3 },
      { kind: 'show', you: true, cards: 10 },
      { kind: 'won', you: true, cents: 400 },
    ];
    const cues = pokerCues(beats, random);
    const first = (id: string): number => cues.find((c) => c.id === id)?.delay ?? -1;
    expect(first('knock')).toBe(0);
    expect(cues.filter((c) => c.id === 'chips')).toHaveLength(5);
    expect(first('fold')).toBeGreaterThan(first('chips'));
    expect(cues.filter((c) => c.id === 'deal')).toHaveLength(3);
    expect(first('show')).toBeGreaterThan(first('deal'));
    expect(first('rake')).toBeGreaterThan(first('show'));
    // Yours raked in louder than his.
    const theirs = pokerCues([{ kind: 'won', you: false, cents: 400 }], random)[0];
    expect(cues.find((c) => c.id === 'rake')?.gain).toBeGreaterThan(theirs?.gain ?? 1);
  });

  it('quickens a long round rather than letting it drag', () => {
    const beats: PokerBeat[] = Array.from({ length: 30 }, () => ({
      kind: 'raise' as const,
      you: false,
      cents: 100,
    }));
    const cues = pokerCues(beats, random);
    expect(Math.max(...cues.map((c) => c.delay))).toBeLessThanOrEqual(POKER_MAX_S + 1e-9);
    expect(cues).toHaveLength(90);
  });

  it('hears the clockwork full on the gallery, dull from below, and not at all when still', () => {
    expect(clockworkLevel(2, true, true).gain).toBeGreaterThan(0.8);
    const below = clockworkLevel(15, false, true);
    expect(below.gain).toBeGreaterThan(0);
    expect(below.gain).toBeLessThan(0.2);
    expect(below.lowpassHz).toBeLessThan(2000);
    expect(clockworkLevel(CLOCKWORK_REACH_M + 1, false, true).gain).toBe(0);
    expect(clockworkLevel(1, true, false).gain).toBe(0);
  });

  it('hears a sleeping keeper only at the house', () => {
    expect(snoreLevel(1, 1).gain).toBeGreaterThan(0.5);
    expect(snoreLevel(1, 2).gain).toBeGreaterThan(snoreLevel(1, 1).gain);
    expect(snoreLevel(SNORE_REACH_M, 1).gain).toBe(0);
    expect(snoreLevel(1, 0).gain).toBe(0);
  });

  it('has a sound for everything done at a station', () => {
    for (const c of [
      'light',
      'douse',
      'climb',
      'talk',
      'oil',
      'tie',
      'search',
      'logbook',
      'stow',
    ] as const) {
      expect(stationCues(c).length, c).toBeGreaterThan(0);
    }
    expect(stationCues('light').map((c) => c.id)).toEqual(['light', 'wind']);
  });

  it('hears a ship aground across the water, duller with distance and fog, to 3 km', () => {
    const near = agroundHeard(200);
    const far = agroundHeard(2500);
    expect(near && far).toBeTruthy();
    expect(near?.gain).toBeGreaterThan(far?.gain ?? 1);
    expect(near?.lowpassHz).toBeGreaterThan(far?.lowpassHz ?? Infinity);
    expect(agroundHeard(200, 1)?.lowpassHz).toBeLessThan(near?.lowpassHz ?? 0);
    expect(agroundHeard(AGROUND_REACH_M + 1)).toBeUndefined();
    expect(groundingGain(8, true)).toBeGreaterThan(groundingGain(2, false));
  });
});

describe('the table records its beats (piece J)', () => {
  it('beats a deal, your move and the captains after it, the draw and the pot', () => {
    const t = openTable({
      port: 'port.bayfield',
      night: 3,
      seed: 'beats',
      big: false,
      marker: () => undefined,
    });
    const player = { purse: 10_000 };
    const h = dealHand(t, player);
    expect(typeof h).not.toBe('string');
    if (typeof h === 'string') return;
    expect(h.beats?.[0]).toMatchObject({ kind: 'deal', cards: 5 * h.inHand.length });
    // Play it through: check or call, stand pat.
    for (let k = 0; k < 20 && h.phase !== 'done'; k++) {
      if (h.phase === 'draw') yourDraw(t, [], false);
      else {
        const opts = yourOptions(t, player);
        yourAction(t, player, opts.includes('check') ? 'check' : 'call');
      }
    }
    expect(h.phase).toBe('done');
    const kinds = (h.beats ?? []).map((b) => b.kind);
    expect(kinds.filter((k) => k === 'won')).toHaveLength(1);
    expect(kinds.at(-1)).toBe('won');
    expect((h.beats ?? []).some((b) => b.you && b.kind === 'draw')).toBe(h.drew[YOU] !== undefined);
  });
});

describe('the playback (piece J)', () => {
  it('plays a move at the table as cards and chips', () => {
    const { s, shots } = sounds();
    s.poker([
      { kind: 'bet', you: true, cents: 50 },
      { kind: 'won', you: true, cents: 200 },
    ]);
    const ids = shots.map(idOf);
    expect(ids.filter((id) => id.startsWith('sfx.poker.chips'))).toHaveLength(2);
    expect(ids).toContain(SANDBOX_SOUND.rake);
  });

  it("rings the harbor master's bell once as his tab opens", () => {
    const { s, shots } = sounds();
    s.portTab('market');
    s.portTab('harbor');
    s.portTab('harbor');
    s.portTab(undefined);
    expect(shots.map(idOf).filter((id) => id === SANDBOX_SOUND.harborBell)).toHaveLength(1);
    s.letterRead();
    s.letterAnswered();
    expect(shots.map(idOf)).toEqual([
      SANDBOX_SOUND.harborBell,
      SANDBOX_SOUND.letterOpen,
      PORT_SOUND.pen,
      SANDBOX_SOUND.letterSeal,
    ]);
  });

  it('plays the station: the lamp lit and the weight wound, the stair, the oil', () => {
    const { s, shots } = sounds();
    s.station('light');
    s.station('climb');
    s.station('oil');
    expect(shots.map(idOf)).toEqual([
      SANDBOX_SOUND.light,
      SANDBOX_SOUND.wind,
      SANDBOX_SOUND.stair,
      SANDBOX_SOUND.oil,
    ]);
  });

  it('sloshes the can as you carry it', () => {
    const { s, shots } = sounds();
    const station = {
      lamp: { dx: 0, dy: 20, dz: 0 },
      turning: false,
      aloft: false,
      house: { dx: 30, dy: 0, dz: 0 },
      sleepers: 0,
      carrying: true,
    };
    for (let k = 0; k < 10; k++) {
      s.update({ ...frame(k), player: { x: k, y: 0, z: 0 }, station, ashore: true }, 0.1);
    }
    expect(shots.map(idOf).filter((id) => id === SANDBOX_SOUND.slosh).length).toBeGreaterThan(3);
  });

  it("plays a rival's stinger, not twice running", () => {
    const { s, shots } = sounds();
    s.update(frame(0), 0.1);
    expect(s.rival('sighted')).toBe(true);
    expect(s.rival('news')).toBe(false);
    s.update(frame(RIVAL_GAP_S + 1), 0.1);
    expect(s.rival('beaten')).toBe(true);
    expect(shots.filter((x) => idOf(x) === SANDBOX_SOUND.rival)).toHaveLength(2);
    expect(shots[1]?.rate).toBeLessThan(1);
  });

  it('hears a ship aground where she struck, and not beyond its reach', () => {
    const { s, shots } = sounds();
    s.update(frame(0), 0.1);
    s.stranded({ name: 'Ida', x: 800, z: 0, broken: false });
    expect(shots.map(idOf)).toEqual([SANDBOX_SOUND.aground, SANDBOX_SOUND.agroundCrew]);
    expect(shots[0]?.at?.x).toBe(800);
    s.stranded({ name: 'Ida', x: AGROUND_REACH_M + 100, z: 0, broken: true });
    expect(shots).toHaveLength(2);
  });
});

describe('the synthesis (piece J)', () => {
  const audible = (x: Float32Array): void => {
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.01);
  };

  it('renders every one-shot finite and audible', () => {
    for (const x of [
      pianoNote(220, 0.5, RATE, seeded(1)),
      shuffle(RATE),
      cardDealt(1, RATE),
      chipsDown(2, RATE),
      potRaked(RATE),
      tableKnock(RATE),
      cardsFolded(RATE),
      cardsShown(RATE),
      clockworkWound(RATE),
      lampDoused(RATE),
      lampLit(RATE),
      oilCan(RATE),
      oilSlosh(RATE),
      towerStair(RATE),
      keeperGreeting(RATE),
      deskBell(RATE),
      letterOpened(RATE),
      letterSealed(RATE),
      rivalStinger(RATE),
      shipAground(RATE),
      agroundCrew(RATE),
    ]) {
      audible(x);
    }
  });

  it('renders the beds at their loop lengths, the clockwork on the beat', () => {
    const c = clockwork(RATE);
    expect(c.length).toBe(CLOCKWORK_LOOP_S * RATE);
    expect((CLOCKWORK_LOOP_S / CLOCKWORK_BEAT_S) % 2).toBe(0);
    audible(c);
    const z = keeperSnore(RATE);
    expect(z.length).toBe(SNORE_LOOP_S * RATE);
    audible(z);
  });

  it('writes the waltz to fill its bars exactly, in 3/4', () => {
    const { melody, chords } = nightWaltzForm();
    expect(chords).toHaveLength(NIGHT_WALTZ.bars);
    const beats = melody.reduce((n, [, b]) => n + b, 0);
    expect(beats).toBe(NIGHT_WALTZ.bars * NIGHT_WALTZ.beatsPerBar);
  });
});
