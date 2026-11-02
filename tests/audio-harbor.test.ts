import { describe, expect, it } from 'vitest';
import {
  CaptionFeed,
  CAPTION_HOLD_S,
  MAX_CAPTIONS,
  arrowFor,
  distanceWord,
  relativeBearingDeg,
} from '../src/audio/captions';
import {
  BUILDING_WORK,
  PIER_WORK,
  WORK,
  WORK_KINDS,
  workActivity,
  workLevel,
  workSites,
} from '../src/audio/harbor-mix';
import { HarborWorks, HARBOR_SOUND } from '../src/audio/harbor-audio';
import type { AudioMixer, OneShot } from '../src/audio/mixer';
import { PILE_CENTS, TradeCues, PORT_SOUND, coinCount } from '../src/audio/port-audio';
import { SIGNAL_CAPTIONS, passingCaption } from '../src/audio/ship-whistles';
import { HARBORS } from '../src/sim/harbors';
import { peak, seeded } from '../tools/audio/lib/synth';
import { ORE_DUMP, SAW_CUT, millSaw, oreDump } from '../tools/audio/lib/synth-harbor';

/** A mixer that records what it's asked to play. */
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

function fakeBank(ids: readonly string[], seconds = 5): Map<string, AudioBuffer> {
  return new Map(ids.map((id) => [id, { duration: seconds } as AudioBuffer]));
}

describe('harbor work rules (Phase 4 piece J)', () => {
  it('keeps each kind to its hours, its season and its dinner hour', () => {
    // A May morning at the mill; nothing at 3 am or in January.
    expect(workActivity('saw', 9, 4)).toBe(1);
    expect(workActivity('saw', 3, 4)).toBe(0);
    expect(workActivity('saw', 9, 0)).toBe(0);
    // The shipyard knocks off for dinner.
    expect(workActivity('caulking', 10, 5)).toBe(1);
    expect(workActivity('caulking', 12.5, 5)).toBe(0);
    // The ore docks load around the clock in the season.
    expect(workActivity('ore', 2, 6)).toBe(1);
    expect(workActivity('ore', 2, 1)).toBe(0);
  });

  it('stops outdoor work in a downpour but not the mill', () => {
    expect(workActivity('caulking', 10, 5, 1, 0)).toBe(0);
    expect(workActivity('yard', 10, 5, 0, 1)).toBe(0);
    expect(workActivity('saw', 10, 5, 1, 1)).toBe(1);
  });

  it('falls off with distance, dulls in fog, and is gone past its range', () => {
    for (const kind of WORK_KINDS) {
      const near = workLevel(kind, 50) ?? { gain: 0, lowpassHz: 0 };
      const far = workLevel(kind, WORK[kind].rangeM * 0.6) ?? { gain: 1, lowpassHz: 1e9 };
      expect(far.gain, kind).toBeLessThan(near.gain);
      expect(far.lowpassHz).toBeLessThan(near.lowpassHz);
      expect(workLevel(kind, WORK[kind].rangeM * 0.6, 0.45)?.lowpassHz).toBeLessThan(far.lowpassHz);
      expect(workLevel(kind, WORK[kind].rangeM + 1), kind).toBeUndefined();
    }
  });

  it('puts work at mills, the shipyard, the cooperage, the depots and the ore docks', () => {
    const sites = workSites([
      {
        id: 'harbor.test',
        buildings: [
          { kind: 'sawmill', x: 10, z: 20, floorM: 2, heightM: 8 },
          { kind: 'church', x: 0, z: 0, floorM: 2, heightM: 12 },
        ],
        piers: [
          {
            kind: 'ore',
            root: { x: 0, z: 0 },
            bearing: Math.PI / 2,
            shoreM: 20,
            lengthM: 220,
            deckM: 20,
          },
          { kind: 'fish', root: { x: 0, z: 50 }, bearing: 0, shoreM: 5, lengthM: 60, deckM: 1.5 },
        ],
      },
    ]);
    expect(sites.map((s) => s.kind).sort()).toEqual(['ore', 'saw', 'yard']);
    const ore = sites.find((s) => s.kind === 'ore') ?? { x: NaN, y: NaN, z: NaN };
    // Out along the trestle (east), on its deck.
    expect(ore.x).toBeCloseTo(20 + 200 * 0.55);
    expect(ore.z).toBeCloseTo(0);
    expect(ore.y).toBe(20);
  });

  it('gives every working port something to hear (La Pointe stays a quiet fishing town)', () => {
    const working = HARBORS.filter((h) => !h.piers.every((p) => p.kind === 'canal'));
    const quiet = working.filter(
      (h) =>
        !h.buildings.some((b) => BUILDING_WORK[b.kind]) &&
        !h.piers.some((p) => (PIER_WORK[p.kind] ?? []).length > 0),
    );
    expect(quiet.map((h) => h.id)).toEqual(['harbor.la_pointe']);
  });

  it('plays a site when the listener is in range and the work is on', () => {
    const { mixer, shots } = fakeMixer();
    const ids = Object.values(HARBOR_SOUND);
    let r = 0;
    const works = new HarborWorks(mixer, fakeBank(ids), () => (r = (r + 0.37) % 1));
    works.setSites([{ id: 'yard', kind: 'yard', x: 300, y: 5, z: 0 }]);
    const frame = {
      listener: { x: 0, y: 3, z: 0 },
      hour: 10,
      month0: 5,
      rain01: 0,
      storm01: 0,
      damping: 1,
    };
    for (let i = 0; i < 600; i++) works.update(frame, 1);
    expect(shots.length).toBeGreaterThan(3);
    // Every bang leaves the yard and arrives at the speed of sound.
    for (const s of shots) expect(s.delay).toBeGreaterThanOrEqual(300 / 343 - 0.01);
    expect(works.levels.sitesHeard).toBe(1);

    shots.length = 0;
    for (let i = 0; i < 600; i++) works.update({ ...frame, hour: 23.5 }, 1);
    expect(shots).toHaveLength(0);
  });

  it('slices the hammering instead of playing the whole recording', () => {
    const { mixer, shots } = fakeMixer();
    const works = new HarborWorks(mixer, fakeBank(Object.values(HARBOR_SOUND), 9), seeded(3));
    works.setSites([{ id: 'yard', kind: 'caulking', x: 100, y: 5, z: 0 }]);
    works.update(
      { listener: { x: 0, y: 3, z: 0 }, hour: 9, month0: 5, rain01: 0, storm01: 0, damping: 1 },
      0.1,
    );
    works.workNow('caulking');
    const shot = shots[0] ?? ({} as OneShot);
    expect(shot.duration).toBeGreaterThanOrEqual(1.5);
    expect(shot.duration).toBeLessThanOrEqual(4);
    expect((shot.offset ?? 0) + (shot.duration ?? 0)).toBeLessThanOrEqual(9);
  });
});

describe('trade sounds (Phase 4 piece J)', () => {
  it('counts out more coins for more money, and pours a heap past $100', () => {
    expect(coinCount(150)).toEqual({ handfuls: 1, pile: false });
    expect(coinCount(4000).handfuls).toBe(3);
    expect(coinCount(PILE_CENTS).pile).toBe(true);
  });

  it('writes every payment into the ledger after the coins', () => {
    const { mixer, shots } = fakeMixer();
    const ids = [...PORT_SOUND.coins, PORT_SOUND.pile, PORT_SOUND.pen, PORT_SOUND.open];
    const bank = fakeBank(ids, 1.4);
    const cues = new TradeCues(mixer, bank, seeded(7));
    cues.paid(4000);
    const pen = shots.find((s) => s.buffer === bank.get(PORT_SOUND.pen)) ?? ({} as OneShot);
    const coins = shots.filter((s) => s.buffer !== bank.get(PORT_SOUND.pen));
    expect(coins).toHaveLength(3);
    expect(pen.delay).toBeGreaterThan(Math.max(...coins.map((c) => c.delay ?? 0)));
    expect(shots.every((s) => s.bus === 'ui')).toBe(true);
    expect(cues.last).toBe('coins x3');
  });
});

describe('captions for directional cues (Phase 4 piece J)', () => {
  it('reads bearings from where the listener looks', () => {
    const at = { x: 0, z: 0 };
    const north = { x: 0, z: -1 };
    expect(relativeBearingDeg(at, north, { x: 0, z: -100 })).toBeCloseTo(0);
    expect(relativeBearingDeg(at, north, { x: 100, z: 0 })).toBeCloseTo(90);
    expect(relativeBearingDeg(at, north, { x: -100, z: 0 })).toBeCloseTo(-90);
    // Looking east, a sound to the north is on the left.
    expect(relativeBearingDeg(at, { x: 1, z: 0 }, { x: 0, z: -100 })).toBeCloseTo(-90);
    expect(arrowFor(0)).toBe('↑');
    expect(arrowFor(90)).toBe('→');
    expect(arrowFor(-135)).toBe('↙');
    expect(arrowFor(180)).toBe('↓');
    expect(distanceWord(100)).toBe('close by');
    expect(distanceWord(5000)).toBe('far off');
  });

  it('shows a line once the sound arrives and drops it after', () => {
    const feed = new CaptionFeed();
    const src = {
      key: 'light.outer',
      text: 'Outer Island Light: fog whistle',
      at: { x: 0, z: -3000 },
    };
    feed.push(src, 10, 8.7, 5);
    const look = (t: number) => feed.visible(t, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(look(15)).toHaveLength(0);
    expect(look(19)).toEqual([
      { key: 'light.outer', text: src.text, bearingDeg: 0, arrow: '↑', distance: 'far off' },
    ]);
    expect(look(10 + 8.7 + 5 + CAPTION_HOLD_S + 0.1)).toHaveLength(0);
  });

  it('keeps one line per source and a few lines at most', () => {
    const feed = new CaptionFeed();
    for (let k = 0; k < 5; k++) {
      feed.push({ key: `s${k}`, text: `ship ${k}`, at: { x: k * 100, z: 0 } }, k * 0.1);
      feed.push({ key: `s${k}`, text: `ship ${k} again`, at: { x: k * 100, z: 0 } }, k * 0.1 + 1);
    }
    const lines = feed.visible(2, { x: 0, z: 0 }, { x: 0, z: -1 });
    expect(lines).toHaveLength(MAX_CAPTIONS);
    expect(lines[0]?.text).toBe('ship 4 again');
    feed.enabled = false;
    expect(feed.visible(2, { x: 0, z: 0 }, { x: 0, z: -1 })).toHaveLength(0);
  });

  it('says what each ship signal means', () => {
    expect(SIGNAL_CAPTIONS['port-tack']).toContain('two blasts');
    expect(passingCaption(2)).toContain('starboard to starboard');
  });
});

describe('harbor synthesis (Phase 4 piece J)', () => {
  const RATE = 16000;

  it('the saw whines idle, screams in the cut, and drops the slab', () => {
    const x = millSaw(RATE);
    expect(x.length).toBe(Math.round(SAW_CUT.seconds * RATE));
    const rms = (from: number, to: number): number => {
      let s = 0;
      const a = Math.round(from * RATE);
      const b = Math.round(to * RATE);
      for (let i = a; i < b; i++) s += (x[i] as number) ** 2;
      return Math.sqrt(s / (b - a));
    };
    expect(rms(2, 4)).toBeGreaterThan(2 * rms(0.4, 0.8));
    expect(peak(x)).toBeGreaterThan(0);
    expect(Number.isFinite(peak(x))).toBe(true);
  });

  it('the ore dump rushes after the door opens and ends on the door shutting', () => {
    const x = oreDump(RATE);
    expect(x.length).toBe(Math.round(ORE_DUMP.seconds * RATE));
    const window = (t: number): number => {
      let p = 0;
      for (let i = Math.round(t * RATE); i < Math.round((t + 0.2) * RATE); i++) {
        p = Math.max(p, Math.abs(x[i] as number));
      }
      return p;
    };
    expect(window(1.5)).toBeGreaterThan(window(4.6) * 2);
    expect(window(ORE_DUMP.shutS)).toBeGreaterThan(window(4.6));
  });
});
