import type { Transform } from '../gameplay/ecs';
import type { SailingState } from '../sim/sailing/controller';
import type { SailingClass } from '../sim/sailing/ship-class';
import type { SoundBank } from './bank';
import { PRIORITY, type AudioMixer } from './mixer';
import { createNoiseBuffer } from './noise';
import {
  RandomTrigger,
  findOnsets,
  luffAmount,
  sailingMix,
  type SailingMixLevels,
} from './sailing-mix';

/**
 * The Phase 1 sailing soundscape (plan 15 §4.2, §11): wind, the hull in the water,
 * rigging creak, luffing canvas, sail handling and the anchor, all driven by the player
 * ship's sailing state. Everything is on the ship, so nothing is positional yet.
 *
 * Beds: procedural wind and rigging whistle, a low swell rumble, and the CC0 hull-wash
 * loop. One-shots: creak, luff flaps, hull slaps and breaking seas at random rates the
 * mix sets; hoist, fill, tack, jibe and anchor sounds on events.
 */

export const SOUND = {
  wash: 'amb.hull.wash',
  creak: 'sfx.ship.creak',
  luff: 'sfx.sail.luff',
  fill: 'sfx.sail.fill',
  hoist: 'sfx.sail.hoist',
  windlass: 'sfx.anchor.windlass',
  chain: ['sfx.anchor.chain-1', 'sfx.anchor.chain-2', 'sfx.anchor.chain-3'],
  anchorSplash: 'sfx.anchor.splash',
  slap: ['sfx.hull.slap-1', 'sfx.hull.slap-2', 'sfx.hull.slap-3'],
  waveBreak: 'sfx.sea.wave-break',
} as const;

/** What the soundscape reads each frame. */
export interface SailingAudioFrame {
  state: SailingState;
  cls: SailingClass;
  transform: Transform;
  /** Wave amplitude against the bow, meters (`headSeaAmplitude`). */
  headSeaM: number;
  gust01: number;
  /** The overpressing meter, 0–1, once piece E provides it. */
  strain01?: number | undefined;
}

/** Seconds for bed levels to follow the mix. */
const BED_TAU_S = 0.25;

type FullContext = BaseAudioContext;

interface Bed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

export class SailingSoundscape {
  /** The latest mix, for the dev panel. */
  levels: SailingMixLevels | undefined;

  private readonly ctx: FullContext;
  private readonly out: GainNode;
  private readonly wind: Bed;
  private readonly whistle: Bed;
  private readonly swell: Bed;
  private readonly wash: Bed | undefined;
  private readonly luffFlaps: number[];
  private readonly creakT: RandomTrigger;
  private readonly luffT: RandomTrigger;
  private readonly slapT: RandomTrigger;
  private readonly breakT: RandomTrigger;
  private lastLevel: number | undefined;
  private lastSetting = 0;
  private lastPitch: number | undefined;
  private lastRoll = 0;
  private motion = 0;
  /** A slow random wander on the wind so a steady breeze still breathes. */
  private wobble = 1;
  private wobbleTarget = 1;
  private wobbleTimer = 0;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {
    this.ctx = mixer.ctx as FullContext;
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.connect(mixer.buses.ambience);

    const pink = createNoiseBuffer(ctx, 6, 'pink');
    const brown = createNoiseBuffer(ctx, 5, 'brown');
    this.wind = this.bed(pink, 'lowpass', 600, 0.7, 0);
    this.whistle = this.bed(pink, 'bandpass', 900, 14, 2.7);
    this.swell = this.bed(brown, 'lowpass', 320, 0.7, 0);
    const wash = bank.get(SOUND.wash);
    this.wash = wash ? this.bed(wash, 'lowpass', 2000, 0.7, 0) : undefined;

    const luff = bank.get(SOUND.luff);
    this.luffFlaps = luff ? findOnsets(luff.getChannelData(0), luff.sampleRate) : [];
    if (this.luffFlaps.length === 0) this.luffFlaps.push(0);

    this.creakT = new RandomTrigger(random, 0.35);
    this.luffT = new RandomTrigger(random, 0.12);
    this.slapT = new RandomTrigger(random, 0.18);
    this.breakT = new RandomTrigger(random, 3);
  }

  /** Fades the beds in or out, e.g. when sailing mode is entered or left. */
  setActive(active: boolean): void {
    this.out.gain.setTargetAtTime(active ? 1 : 0, this.ctx.currentTime, 0.3);
  }

  update(frame: SailingAudioFrame, dt: number): void {
    if (dt <= 0) return;
    const { state: s, cls: c, transform } = frame;

    // How hard the hull works in the waves, from buoyancy's pitch and roll.
    const pitch = transform.pitch ?? 0;
    const roll = transform.roll ?? 0;
    if (this.lastPitch !== undefined) {
      const rate = (Math.abs(pitch - this.lastPitch) + Math.abs(roll - this.lastRoll)) / dt;
      this.motion += (Math.min(rate, 2) - this.motion) * Math.min(1, dt / 0.5);
    }
    this.lastPitch = pitch;
    this.lastRoll = roll;

    const m = sailingMix({
      windKn: s.windKn,
      gust01: frame.gust01,
      speed01: c.hullMaxSpeed > 0 ? s.speed / c.hullMaxSpeed : 0,
      sailSetting: s.sailSetting,
      luff01: luffAmount(s, c),
      heel01: c.heelMax > 0 ? Math.abs(s.heel) / c.heelMax : 0,
      motion: this.motion,
      headSeaM: frame.headSeaM,
      strain01: frame.strain01,
    });
    this.levels = m;

    this.wobbleTimer -= dt;
    if (this.wobbleTimer <= 0) {
      this.wobbleTarget = 0.8 + 0.4 * this.random();
      this.wobbleTimer = 1.5 + 2.5 * this.random();
    }
    this.wobble += (this.wobbleTarget - this.wobble) * Math.min(1, dt / 1.2);

    this.set(this.wind, m.windGain * this.wobble, m.windCutoffHz * (0.9 + 0.1 * this.wobble));
    this.set(this.whistle, m.whistleGain * this.wobble ** 2, m.whistleHz * this.wobble ** 0.3);
    this.set(this.swell, m.swellGain);
    if (this.wash) {
      this.set(this.wash, m.washGain, m.washCutoffHz);
      this.wash.source.playbackRate.setTargetAtTime(m.washRate, this.ctx.currentTime, BED_TAU_S);
    }

    if (this.creakT.tick(dt, m.creakPerS)) this.creak(m.creakGain);
    if (this.luffT.tick(dt, m.luffPerS)) this.flap(m.luffGain);
    if (this.slapT.tick(dt, m.slapPerS)) {
      this.play(this.pick(SOUND.slap), {
        gain: m.slapGain * this.between(0.6, 1),
        rate: this.between(0.8, 1.15),
        lowpassHz: 1800 + 3000 * Math.min(1, Math.abs(s.speed) / Math.max(c.hullMaxSpeed, 1e-6)),
      });
    }
    if (this.breakT.tick(dt, m.breakPerS)) {
      this.play(SOUND.waveBreak, { gain: 0.7, rate: this.between(0.85, 1.05), lowpassHz: 3500 });
    }

    this.sailEvents(s);
  }

  /** The bow crossed the wind: the sails flog, then fill on the new tack. */
  tacked(): void {
    this.flap(0.6);
    this.play(SOUND.fill, { gain: 0.45, rate: 1.25, delay: 0.5, lowpassHz: 2000 });
    this.creak(0.6);
  }

  /** The stern crossed the wind: the boom slams across, hard when uncontrolled. */
  jibed(uncontrolled: boolean): void {
    this.play(SOUND.fill, {
      gain: uncontrolled ? 1 : 0.6,
      rate: uncontrolled ? 0.9 : 1.15,
      lowpassHz: uncontrolled ? 5000 : 2500,
      priority: uncontrolled ? PRIORITY.critical : PRIORITY.sfx,
    });
    this.creak(uncontrolled ? 1 : 0.6, 0.1);
    if (uncontrolled) this.creak(0.8, 0.35);
  }

  /**
   * Let go the anchor: a splash, then chain rattling out through the hawse. More water
   * under the keel, a longer run.
   */
  anchorDropped(depthM = 10): void {
    this.play(SOUND.anchorSplash, { gain: 0.8, rate: this.between(0.9, 1.05), delay: 0.15 });
    const runS = Math.min(6, 1.5 + depthM / 6);
    let t = 0;
    while (t < runS) {
      const slowing = t / runS;
      this.play(this.pick(SOUND.chain), {
        gain: this.between(0.45, 0.8) * (1 - 0.5 * slowing),
        rate: this.between(0.9, 1.2),
        delay: t,
      });
      t += this.between(0.07, 0.12) * (1 + 2 * slowing);
    }
  }

  /** Weigh anchor: the windlass ratchets the chain back in. */
  anchorWeighed(depthM = 10): void {
    const buffer = this.bank.get(SOUND.windlass);
    if (!buffer) return;
    const repeats = Math.max(1, Math.min(4, Math.round(depthM / 8)));
    for (let i = 0; i < repeats; i++) {
      this.play(SOUND.windlass, {
        gain: 0.7,
        rate: this.between(0.95, 1.05),
        delay: i * buffer.duration * 0.95,
      });
    }
    this.play(this.pick(SOUND.chain), { gain: 0.6, delay: repeats * buffer.duration * 0.95 });
  }

  dispose(): void {
    for (const bed of [this.wind, this.whistle, this.swell, this.wash]) {
      if (!bed) continue;
      bed.source.stop();
      bed.source.disconnect();
      bed.filter.disconnect();
      bed.gain.disconnect();
    }
    this.out.disconnect();
  }

  /** Halyard work when an order is given, and the canvas filling once it's set. */
  private sailEvents(s: SailingState): void {
    if (this.lastLevel !== undefined && s.sailLevel !== this.lastLevel) {
      const raising = s.sailLevel > this.lastLevel;
      this.play(SOUND.hoist, {
        gain: raising ? 0.55 : 0.45,
        rate: (raising ? 1.05 : 0.88) * this.between(0.97, 1.03),
      });
    }
    const settled = Math.abs(s.sailSetting - s.sailLevel) < 1e-6;
    const wasMoving = Math.abs(this.lastSetting - s.sailLevel) >= 1e-6;
    if (settled && wasMoving && s.sailLevel > 0 && !s.inIrons && s.sailSetting > this.lastSetting) {
      this.play(SOUND.fill, { gain: 0.3 + 0.15 * s.sailLevel, rate: 1.3, lowpassHz: 1800 });
    }
    this.lastLevel = s.sailLevel;
    this.lastSetting = s.sailSetting;
  }

  private creak(gain: number, delay = 0): void {
    const buffer = this.bank.get(SOUND.creak);
    if (!buffer) return;
    const duration = this.between(0.35, 1.2);
    this.play(SOUND.creak, {
      gain: gain * this.between(0.6, 1),
      rate: this.between(0.85, 1.15),
      offset: this.random() * Math.max(0, buffer.duration - duration),
      duration,
      delay,
      lowpassHz: 3500,
      priority: PRIORITY.detail,
    });
  }

  private flap(gain: number): void {
    const start = this.luffFlaps[Math.floor(this.random() * this.luffFlaps.length)] ?? 0;
    this.play(SOUND.luff, {
      gain: gain * this.between(0.7, 1),
      // Canvas is lighter than the wings in the recording: play it up.
      rate: this.between(1.2, 1.6),
      offset: Math.max(0, start - 0.02),
      duration: this.between(0.25, 0.45),
      priority: PRIORITY.detail,
    });
  }

  private play(id: string, shot: Omit<Parameters<AudioMixer['play']>[0], 'buffer' | 'bus'>): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus: 'sfx', ...shot });
  }

  private bed(
    buffer: AudioBuffer,
    type: BiquadFilterType,
    frequency: number,
    q: number,
    offset: number,
  ): Bed {
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.out);
    source.start(ctx.currentTime, offset % buffer.duration);
    return { source, filter, gain };
  }

  private set(bed: Bed, gain: number, frequency?: number): void {
    const now = this.ctx.currentTime;
    bed.gain.gain.setTargetAtTime(gain, now, BED_TAU_S);
    if (frequency !== undefined) bed.filter.frequency.setTargetAtTime(frequency, now, BED_TAU_S);
  }

  private pick(ids: readonly string[]): string {
    return ids[Math.floor(this.random() * ids.length)] ?? (ids[0] as string);
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }
}
