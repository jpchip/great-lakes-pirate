import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import { FOOT_SOUND } from './foot-audio';
import { PRIORITY, type AudioMixer, type AudioPoint } from './mixer';
import type { BusId } from './settings';
import {
  grindLevel,
  chatterEveryS,
  chatterGain,
  frozenHarbor,
  gustEveryS,
  gustGain,
  iceBoomEveryS,
  iceBoomHeard,
  nightOf,
  runnerLevel,
  shiverEveryS,
  thinIceSound,
  winterStep,
  winterWind,
  winterness,
  type ThinMarks,
  type WinterGround,
} from './winter-mix';
import type { Gait } from '../gameplay/onfoot/controller';
import type { ThinStage } from '../sim/cold/footing';
import type { WarmthStage } from '../sim/cold/warmth';

/**
 * Winter's sounds (Phase 9 piece N; plan 11 §18.4 row N, plan 15 §4.1, §4.5):
 *
 * - **Thin ice** (piece M's stages, `IceGave`): a crack underfoot at a quarter of the way to
 *   breaking and more of them, closer together, as it builds; a groan at 60% and groans
 *   over the cracks from then; the ice giving way, and the haul out over the edge
 *   (`IceClimbed`), or the edge breaking away under you.
 * - **Underfoot:** bare lake ice ticks and scuffs; snow crunches, and below −10 °C squeaks.
 * - **The sled** (`SledHandled`): the runners hissing behind you by its speed and load, a
 *   load thumped down and lashed.
 * - **The cold** (`player.warmth`): a shivering breath from chilled, teeth chattering at cold
 *   and oftener freezing, and gusts of wind that come oftener and harder as warmth drops.
 * - **The winter wind:** a dry, hollow bed by the season, the air's cold, the ice cover and
 *   the wind's speed, ashore and afloat.
 * - **A harbor frozen in, at night:** the lapping and the gulls stilled where the ice has
 *   closed (the frame's `hush01`, for the world and the docks), a still night's bed near the
 *   harbor, and now and then the lake's ice booming far off.
 *
 * `winter-mix.ts` has the rules.
 */

export const WINTER_AUDIO_BUNDLE = 'winter-audio';

export const WINTER_SOUND = {
  crack: ['sfx.ice.crack-1', 'sfx.ice.crack-2'],
  groan: 'sfx.ice.groan',
  break: 'sfx.ice.break',
  haul: 'sfx.ice.haul',
  sing: ['amb.ice.sing-1', 'amb.ice.sing-2'],
  stepIce: ['sfx.foot.step-ice-1', 'sfx.foot.step-ice-2'],
  stepSqueak: ['sfx.foot.step-squeak-1', 'sfx.foot.step-squeak-2'],
  runners: 'sfx.sled.runners',
  grind: 'sfx.ice.grind',
  load: 'sfx.sled.load',
  chatter: 'voice.cold.chatter',
  gust: ['amb.winter.gust-1', 'amb.winter.gust-2'],
  wind: 'amb.winter.wind',
  night: 'amb.winter.frozen-night',
} as const;

/** What the player's body is up to in the winter, on foot (from piece M's readout). */
export interface WinterBody {
  stage: WarmthStage;
  onIce: boolean;
  /** Thin ice under you: its stage and stress, 0–1. */
  thin: ThinStage;
  stress: number;
  /** Walking or running (not standing). */
  moving: boolean;
  /** Snow lying where you are. */
  snowLies: boolean;
  /** The sled out on the ice (scene meters, only its speed matters), and its load. */
  sled: { x: number; z: number; hitched: boolean; cu: number } | undefined;
}

/** What winter's sounds read each frame. */
export interface WinterFrame {
  nowS: number;
  /** Where your ears are, zone meters. */
  listener: AudioPoint;
  airC: number;
  windKn: number;
  month0: number;
  sunElevationDeg: number;
  /** The lake's ice cover where you are, 0–1. */
  iceCover01: number;
  harborDistanceM: number;
  inside: boolean;
  swimming: boolean;
  /** On foot: the body. Undefined afloat. */
  body: WinterBody | undefined;
}

export type SledAct = 'down' | 'loaded' | 'unloaded' | 'stowed' | 'sold' | 'hitched' | 'dropped';

type BedId = 'wind' | 'night' | 'runners' | 'grind';

const BEDS: Record<BedId, { sound: string; bus: BusId; level: number }> = {
  // Encoded as beds (RMS −24 dB), brought up where they need to sit.
  wind: { sound: WINTER_SOUND.wind, bus: 'ambience', level: 1.1 },
  night: { sound: WINTER_SOUND.night, bus: 'ambience', level: 1.3 },
  // A one-shot level (peak −1 dB) looped.
  runners: { sound: WINTER_SOUND.runners, bus: 'sfx', level: 0.45 },
  // The player's own hull in the ice: a one-shot level looped, under the sailing set.
  grind: { sound: WINTER_SOUND.grind, bus: 'sfx', level: 0.6 },
};

const BED_TAU_S = 0.5;
const BED_IDLE_S = 4;
/** The player's own winter footsteps against everything else (as the on-foot set's). */
const STEP_GAIN = 0.55;

interface Bed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  silentS: number;
}

export class WinterSounds {
  captions: CaptionFeed | undefined;
  /** The latest readout, for the dev panel and the tests. */
  readonly levels = {
    last: '',
    cues: 0,
    winter: 0,
    hush: 0,
    beds: { wind: 0, night: 0, runners: 0, grind: 0 } as Record<BedId, number>,
    gusts: 0,
    chatters: 0,
    booms: 0,
    steps: 0,
    /** Thin ice's cracks, groans and breaks, and the sled's handling, heard. */
    ice: 0,
    sled: 0,
  };
  private readonly beds = new Map<BedId, Bed>();
  private frame: WinterFrame | undefined;
  private crackS = 0;
  private groanS = 0;
  private gustS = 6;
  private chatterS = 2;
  private shiverS = 5;
  private boomS = 20;
  private sledAt: { x: number; z: number } | undefined;
  private sledSpeed = 0;
  /** Hull HP the ice took from her since the last frame, and the rate it's going at. */
  private grindHp = 0;
  private grindRate = 0;
  private knockS = 1;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly marks: ThinMarks,
    private readonly random: () => number = Math.random,
  ) {}

  /** 0–1: how much the water's own sounds are stilled by the ice now (for the world). */
  get hush(): number {
    return this.levels.hush;
  }

  // --- Thin ice --------------------------------------------------------------------------

  /** Piece M's thin ice moved a stage: the warning, or through. */
  iceGave(stage: 'cracking' | 'groaning' | 'broken'): void {
    this.levels.ice++;
    if (stage === 'cracking') {
      this.play(this.pick(WINTER_SOUND.crack), 'sfx', 0.9, { rate: 0.95 + 0.1 * this.random() });
      this.caption('winter.ice', 'The ice cracks');
      this.crackS = 1.5;
    } else if (stage === 'groaning') {
      this.play(WINTER_SOUND.groan, 'sfx', 1);
      this.play(this.pick(WINTER_SOUND.crack), 'sfx', 0.7, { delay: 0.6, rate: 0.85 });
      this.caption('winter.ice', 'The ice groans');
      this.crackS = 1.2;
      this.groanS = 3;
    } else {
      this.play(WINTER_SOUND.break, 'sfx', 1, { priority: PRIORITY.critical });
      this.caption('winter.ice', 'The ice gives way');
    }
  }

  /** In the hole: hauled out onto the ice, or the edge broke away under you. */
  climbed(result: 'out' | 'slipped'): void {
    if (result === 'out') {
      this.play(WINTER_SOUND.haul, 'sfx', 0.85);
    } else {
      this.play(this.pick(WINTER_SOUND.crack), 'sfx', 0.85, { rate: 0.8 });
      this.play(FOOT_SOUND.splash, 'sfx', 0.55, { delay: 0.15 });
    }
  }

  // --- The hull in the ice ---------------------------------------------------------------

  /** The ice took `damage` hull HP from the player's ship this tick (`IceGrinding`). */
  grinding(damage: number): void {
    if (damage > 0) this.grindHp += damage;
  }

  // --- The sled --------------------------------------------------------------------------

  /** The sled put down, loaded, unloaded, stowed, sold from, or its rope taken or dropped. */
  sled(act: SledAct): void {
    this.levels.sled++;
    switch (act) {
      case 'loaded':
      case 'unloaded':
        this.play(WINTER_SOUND.load, 'sfx', 0.7, { rate: act === 'unloaded' ? 1.1 : 1 });
        return;
      case 'sold':
        this.play(WINTER_SOUND.load, 'sfx', 0.55, { rate: 1.15 });
        return;
      case 'down':
        this.play(FOOT_SOUND.crateDown, 'sfx', 0.55, { rate: 0.9 });
        return;
      case 'stowed':
        this.play(FOOT_SOUND.crateLift, 'sfx', 0.5);
        return;
      case 'hitched':
      case 'dropped':
        this.play(FOOT_SOUND.rope, 'sfx', 0.3, { rate: 1.2 });
        return;
    }
  }

  // --- The body --------------------------------------------------------------------------

  /** A stride on winter's ground, at the radius the guards hear it by. */
  step(ground: WinterGround, gait: Gait, radiusM: number): void {
    const airC = this.frame?.airC ?? 0;
    const s = winterStep(ground, gait, radiusM, airC, this.random());
    if (!s) return;
    this.levels.steps++;
    this.play(s.id, 'sfx', s.gain * STEP_GAIN, {
      rate: s.rate,
      ...(s.lowpassHz !== undefined ? { lowpassHz: s.lowpassHz } : {}),
      priority: PRIORITY.detail,
    });
  }

  /** Warmth fell a stage on foot: a gust takes you, and a breath. */
  warmthFell(stage: WarmthStage): void {
    const windKn = this.frame?.windKn ?? 10;
    this.gust(gustGain(stage, windKn) * 1.1);
    if (stage !== 'chilled') {
      this.play(WINTER_SOUND.chatter, 'voice', chatterGain(stage), { delay: 1.2 });
      this.levels.chatters++;
    }
    this.gustS = Math.max(this.gustS, 4);
  }

  // --- Each frame ------------------------------------------------------------------------

  update(f: WinterFrame, dt: number): void {
    this.frame = f;
    if (dt <= 0) return;
    const winter01 = winterness(f.airC, f.iceCover01, f.month0);
    const harbor = frozenHarbor(f.harborDistanceM, f.iceCover01, f.sunElevationDeg, f.windKn);
    this.levels.winter = winter01;
    this.levels.hush = harbor.hush01;

    // The wind: a little lower afloat, where the ship's own wind is heard too.
    const wind = winterWind(f.windKn, winter01, f.inside);
    this.bed('wind', wind.gain * (f.body ? 1 : 0.7), wind.lowpassHz, dt);
    // A frozen harbor's night: the wind gives way to it in a calm.
    this.bed('night', harbor.gain * winter01, f.inside ? 900 : 12000, dt);

    // The ice far off.
    const every = iceBoomEveryS(f.iceCover01, f.airC, nightOf(f.sunElevationDeg));
    if (every !== undefined && winter01 > 0.2) {
      this.boomS -= dt;
      if (this.boomS <= 0) {
        this.boomS = every * (0.6 + 0.8 * this.random());
        this.boom(f);
      }
    } else {
      this.boomS = Math.min(Math.max(this.boomS, 8), 30);
    }

    // Her hull forcing the ice: the rate eases in and out over a few tenths of a second.
    const hpPerS = f.body ? 0 : this.grindHp / dt;
    this.grindHp = 0;
    this.grindRate += (hpPerS - this.grindRate) * Math.min(1, dt / 0.3);
    const grind = grindLevel(this.grindRate);
    this.bed('grind', grind.gain, grind.lowpassHz, dt, grind.rate);
    if (grind.knockEveryS !== undefined) {
      this.knockS -= dt;
      if (this.knockS <= 0) {
        this.knockS = grind.knockEveryS * (0.6 + 0.8 * this.random());
        this.levels.ice++;
        this.play(this.pick(WINTER_SOUND.crack), 'sfx', 0.35 + 0.35 * grind.gain, {
          rate: 0.7 + 0.2 * this.random(),
          lowpassHz: grind.lowpassHz,
        });
      }
    } else {
      this.knockS = 0.4;
    }

    const b = f.body;
    if (!b) {
      this.bed('runners', 0, 4000, dt);
      this.sledAt = undefined;
      return;
    }

    // Thin ice keeps talking while it holds.
    const thin = b.onIce ? thinIceSound(b.thin, b.stress, b.moving, this.marks) : undefined;
    if (thin && !f.swimming) {
      this.crackS -= dt;
      if (this.crackS <= 0) {
        this.crackS = thin.crackEveryS * (0.75 + 0.5 * this.random());
        this.play(this.pick(WINTER_SOUND.crack), 'sfx', thin.crackGain, {
          rate: 0.85 + 0.3 * this.random(),
        });
      }
      if (thin.groanEveryS !== undefined) {
        this.groanS -= dt;
        if (this.groanS <= 0) {
          this.groanS = thin.groanEveryS * (0.8 + 0.4 * this.random());
          this.play(WINTER_SOUND.groan, 'sfx', thin.groanGain, {
            rate: 0.9 + 0.2 * this.random(),
          });
        }
      }
    } else {
      this.crackS = Math.max(this.crackS, 1);
      this.groanS = Math.max(this.groanS, 2);
    }

    // The cold in you: gusts, a shivering breath, chattering teeth. Not in the water (the
    // on-foot set's own shivers are there), and not under a roof.
    const gustEvery = f.swimming ? undefined : gustEveryS(b.stage, f.windKn, winter01, f.inside);
    if (gustEvery !== undefined) {
      this.gustS -= dt;
      if (this.gustS <= 0) {
        this.gustS = gustEvery * (0.7 + 0.6 * this.random());
        this.gust(gustGain(b.stage, f.windKn));
      }
    }
    const chatterEvery = f.swimming ? undefined : chatterEveryS(b.stage);
    if (chatterEvery !== undefined) {
      this.chatterS -= dt;
      if (this.chatterS <= 0) {
        this.chatterS = chatterEvery * (0.75 + 0.5 * this.random());
        this.levels.chatters++;
        this.play(WINTER_SOUND.chatter, 'voice', chatterGain(b.stage), {
          rate: 0.92 + 0.16 * this.random(),
        });
      }
    } else {
      this.chatterS = 2;
    }
    const shiverEvery = f.swimming ? undefined : shiverEveryS(b.stage);
    if (shiverEvery !== undefined) {
      this.shiverS -= dt;
      if (this.shiverS <= 0) {
        this.shiverS = shiverEvery * (0.8 + 0.4 * this.random());
        this.play(FOOT_SOUND.shiver, 'voice', 0.32, { rate: 0.95 + 0.1 * this.random() });
      }
    } else {
      this.shiverS = 5;
    }

    // The sled's runners, by how fast she's coming along.
    const sl = b.sled;
    if (sl && sl.hitched) {
      const from = this.sledAt;
      const v = from ? Math.hypot(sl.x - from.x, sl.z - from.z) / dt : 0;
      this.sledSpeed += (Math.min(v, 6) - this.sledSpeed) * Math.min(1, dt / 0.25);
      this.sledAt = { x: sl.x, z: sl.z };
    } else {
      this.sledSpeed = 0;
      this.sledAt = undefined;
    }
    const run = runnerLevel(this.sledSpeed, sl?.cu ?? 0, b.onIce && !b.snowLies);
    this.bed('runners', sl?.hitched ? run.gain : 0, run.lowpassHz, dt, run.rate);
  }

  /** Off your feet and out of the world (a port screen, the chart): everything stops. */
  stop(): void {
    for (const id of [...this.beds.keys()]) this.dispose(id);
    for (const k of Object.keys(this.levels.beds) as BedId[]) this.levels.beds[k] = 0;
    this.sledAt = undefined;
    this.sledSpeed = 0;
  }

  /** The dev panel: one of the sounds, once. */
  audition(id: string): void {
    const bus: BusId = id.startsWith('voice.')
      ? 'voice'
      : id.startsWith('amb.')
        ? 'ambience'
        : 'sfx';
    this.play(id, bus, 0.8, { priority: PRIORITY.critical });
  }

  // ---------------------------------------------------------------------------------------

  private gust(gain: number): void {
    this.levels.gusts++;
    const f = this.frame;
    // From upwind-ish: somewhere round you, a little way off, so it sweeps past.
    const a = this.random() * Math.PI * 2;
    const at = f
      ? { x: f.listener.x + Math.sin(a) * 20, y: f.listener.y, z: f.listener.z - Math.cos(a) * 20 }
      : undefined;
    this.play(this.pick(WINTER_SOUND.gust), 'ambience', gain, {
      rate: 0.9 + 0.2 * this.random(),
      ...(at ? { at } : {}),
    });
  }

  private boom(f: WinterFrame): void {
    const a = this.random() * Math.PI * 2;
    const d = 400 + 2100 * this.random();
    const h = iceBoomHeard(d);
    this.levels.booms++;
    this.play(this.pick(WINTER_SOUND.sing), 'ambience', h.gain, {
      lowpassHz: h.lowpassHz,
      rate: 0.85 + 0.3 * this.random(),
      at: { x: f.listener.x + Math.sin(a) * d, y: 0, z: f.listener.z - Math.cos(a) * d },
      priority: PRIORITY.detail,
    });
  }

  private caption(key: string, text: string): void {
    const f = this.frame;
    if (!f) return;
    this.captions?.push({ key, text, at: { x: f.listener.x, z: f.listener.z } }, f.nowS, 0, 1);
  }

  private pick(ids: readonly string[]): string {
    return ids[Math.floor(this.random() * ids.length)] ?? (ids[0] as string);
  }

  private play(
    id: string,
    bus: BusId,
    gain: number,
    o: {
      rate?: number;
      delay?: number;
      lowpassHz?: number;
      at?: AudioPoint;
      priority?: number;
    } = {},
  ): void {
    this.levels.last = id;
    this.levels.cues++;
    const buffer = this.bank.get(id);
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain,
      ...(o.rate !== undefined && o.rate !== 1 ? { rate: o.rate } : {}),
      ...(o.delay ? { delay: o.delay } : {}),
      ...(o.lowpassHz !== undefined ? { lowpassHz: o.lowpassHz } : {}),
      ...(o.at ? { at: o.at } : {}),
      priority: o.priority ?? PRIORITY.sfx,
    });
  }

  private bed(id: BedId, want: number, lowpassHz: number, dt: number, rate = 1): void {
    const def = BEDS[id];
    const ctx = this.mixer.ctx;
    this.levels.beds[id] = want;
    if (typeof ctx.createBufferSource !== 'function') return;
    let bed = this.beds.get(id);
    if (!bed) {
      if (want <= 0.001) return;
      const buffer = this.bank.get(def.sound);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpassHz;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.mixer.buses[def.bus]);
      source.start(ctx.currentTime, this.random() * buffer.duration);
      bed = { source, filter, gain, silentS: 0 };
      this.beds.set(id, bed);
    }
    const now = ctx.currentTime;
    bed.gain.gain.setTargetAtTime(want * def.level, now, BED_TAU_S);
    bed.filter.frequency.setTargetAtTime(lowpassHz, now, BED_TAU_S);
    if (rate !== 1 || bed.source.playbackRate.value !== 1) {
      bed.source.playbackRate.setTargetAtTime(rate, now, BED_TAU_S);
    }
    bed.silentS = want <= 0.001 ? bed.silentS + dt : 0;
    if (bed.silentS > BED_IDLE_S) this.dispose(id);
  }

  private dispose(id: BedId): void {
    const bed = this.beds.get(id);
    if (!bed) return;
    bed.source.stop();
    bed.source.disconnect();
    bed.filter.disconnect();
    bed.gain.disconnect();
    this.beds.delete(id);
  }
}
