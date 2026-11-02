import type { FogSignal } from '../../data/schemas/lighthouses';
import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import { PRIORITY, type AudioMixer, type AudioPoint, type OneShot } from './mixer';
import { createNoiseBuffer } from './noise';
import { RandomTrigger } from './sailing-mix';
import {
  SIGNAL_FOG_M,
  SOUND_MS,
  birdLevel,
  blastsBetween,
  fogMix,
  gullRate,
  loonRate,
  rainMix,
  signalLevel,
  signalPhase,
  thunderShot,
  type FogLevels,
} from './world-mix';

/**
 * The world around the ship (plan 15 §4.1, §4.3; Phase 2 piece H): rain, thunder after
 * the lightning, the hush and drips of fog, the lights' fog signals, and gulls and loons.
 * Signals, thunder and birds are placed in the world and panned from the listener (the
 * camera); the beds are around the ship. The beds only run while they're audible, to
 * stay inside the plan 15 §8 bed budget alongside the sailing beds.
 */

export const WORLD_SOUND = {
  rain: 'amb.weather.rain',
  thunderNear: 'sfx.weather.thunder-near',
  thunderFar: 'sfx.weather.thunder-far',
  whistle: 'sfx.signal.fog-whistle',
  bell: 'sfx.signal.fog-bell',
  gulls: [
    'amb.wildlife.gull-1',
    'amb.wildlife.gull-2',
    'amb.wildlife.gull-3',
    'amb.wildlife.gull-4',
    'amb.wildlife.gull-5',
  ],
  loons: [
    'amb.wildlife.loon-1',
    'amb.wildlife.loon-2',
    'amb.wildlife.loon-3',
    'amb.wildlife.loon-4',
  ],
} as const;

/** A light with a fog signal, placed in the zone. */
export interface SignalStation {
  id: string;
  name: string;
  signal: FogSignal;
  /** Where the sound comes from: the tower's top, zone meters. */
  at: AudioPoint;
}

/** What the world soundscape reads each frame. */
export interface WorldAudioFrame {
  /** The listener (camera) and the ship, zone meters. */
  listener: AudioPoint;
  ship: { x: number; z: number };
  /** Real seconds since start: the fog signals' clock. */
  nowS: number;
  windKn: number;
  rain01: number;
  storm01: number;
  /** Fog and haze visibility at the ship, meters (not the night). */
  fogVisibilityM: number;
  /** Fog banks around, zone meters, for whether a station is in fog. */
  fogBanks: readonly { x: number; z: number; radiusM: number; strength: number }[];
  sunElevationDeg: number;
  month0: number;
  /** Signed shore distance at the ship (positive over water) and the way to the shore. */
  shoreDistanceM: number;
  towardShore: { x: number; z: number };
  harborDistanceM: number;
}

/** How far ahead fog signal blasts are scheduled, seconds. */
const LOOKAHEAD_S = 0.25;
/** Seconds for bed levels to follow the mix. */
const BED_TAU_S = 0.6;
/** A bed silent this long stops its source. */
const BED_IDLE_S = 3;

class Bed {
  private source: AudioBufferSourceNode | undefined;
  private readonly filter: BiquadFilterNode;
  private readonly gain: GainNode;
  private silentS = 0;
  level = 0;

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly buffer: AudioBuffer | undefined,
    out: AudioNode,
    cutoffHz: number,
  ) {
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = cutoffHz;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.filter.connect(this.gain).connect(out);
  }

  get running(): boolean {
    return this.source !== undefined;
  }

  set(gain: number, cutoffHz: number | undefined, dt: number): void {
    if (!this.buffer) return;
    const now = this.ctx.currentTime;
    this.level = gain;
    if (gain > 1e-3) {
      this.silentS = 0;
      if (!this.source) {
        const source = this.ctx.createBufferSource();
        source.buffer = this.buffer;
        source.loop = true;
        source.connect(this.filter);
        source.start(now, Math.random() * this.buffer.duration);
        this.source = source;
      }
    } else if (this.source) {
      this.silentS += dt;
      if (this.silentS > BED_IDLE_S) {
        this.source.stop();
        this.source.disconnect();
        this.source = undefined;
      }
    }
    this.gain.gain.setTargetAtTime(gain, now, BED_TAU_S);
    if (cutoffHz !== undefined) this.filter.frequency.setTargetAtTime(cutoffHz, now, BED_TAU_S);
  }

  dispose(): void {
    this.source?.stop();
    this.source?.disconnect();
    this.filter.disconnect();
    this.gain.disconnect();
  }
}

/** A drop off the rigging: a short tone that rises as the bubble closes. */
function createDrips(ctx: BaseAudioContext, random: () => number): AudioBuffer[] {
  const out: AudioBuffer[] = [];
  for (let k = 0; k < 4; k++) {
    const seconds = 0.09;
    const n = Math.round(seconds * ctx.sampleRate);
    const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = new Float32Array(n);
    const f0 = 900 + 700 * random();
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate;
      phase += (2 * Math.PI * f0 * (1 + (3 * t) / seconds)) / ctx.sampleRate;
      data[i] = Math.sin(phase) * Math.exp(-t / 0.018) * Math.min(1, i / 24);
    }
    buffer.copyToChannel(data, 0);
    out.push(buffer);
  }
  return out;
}

export class WorldSoundscape {
  /** The latest levels, for the dev panel. */
  readonly levels = { rain: 0, hush: 0, gullsPerS: 0, loonsPerS: 0, signalsHeard: 0, thunder: 0 };
  /** True while a fog signal is sounding within earshot (the music ducks under it). */
  signalHeard = false;
  /** Where the fog signals' captions go (plan 15 §5); none when unset. */
  captions: CaptionFeed | undefined;
  private readonly ctx: BaseAudioContext;
  private readonly out: GainNode;
  private readonly rain: Bed;
  private readonly hush: Bed;
  private readonly drips: AudioBuffer[];
  private readonly dripT: RandomTrigger;
  private readonly gullT: RandomTrigger;
  private readonly loonT: RandomTrigger;
  /** Per station: the signal-clock time scheduled up to. */
  private readonly scheduledTo = new Map<string, number>();
  /** Real seconds a signal stays "heard" for the duck after its last blast started. */
  private heardUntilS = 0;
  private fog: FogLevels = { hushGain: 0, dripsPerS: 0, damping: 1 };
  private last: WorldAudioFrame | undefined;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private stations: readonly SignalStation[] = [],
    private readonly random: () => number = Math.random,
  ) {
    this.ctx = mixer.ctx as BaseAudioContext;
    const ctx = this.ctx;
    this.out = ctx.createGain();
    this.out.connect(mixer.buses.ambience);
    this.rain = new Bed(ctx, bank.get(WORLD_SOUND.rain), this.out, 6000);
    this.hush = new Bed(ctx, createNoiseBuffer(ctx, 5, 'brown'), this.out, 380);
    this.drips = createDrips(ctx, random);
    this.dripT = new RandomTrigger(random, 0.15);
    this.gullT = new RandomTrigger(random, 2.5);
    this.loonT = new RandomTrigger(random, 8);
  }
  /** The zone's lights changed (Phase 3 piece A); the old ones fall silent. */
  setStations(stations: readonly SignalStation[]): void {
    this.stations = stations;
    this.scheduledTo.clear();
  }

  /** Fades the world in or out with sailing mode. */
  setActive(active: boolean): void {
    this.out.gain.setTargetAtTime(active ? 1 : 0, this.ctx.currentTime, 0.3);
  }

  update(f: WorldAudioFrame, dt: number): void {
    if (dt <= 0) return;
    this.last = f;
    const rain = rainMix(f.rain01, f.storm01);
    this.rain.set(rain.gain, rain.cutoffHz, dt);
    this.fog = fogMix(f.fogVisibilityM, f.windKn);
    this.hush.set(this.fog.hushGain, undefined, dt);
    this.levels.rain = rain.gain;
    this.levels.hush = this.fog.hushGain;

    if (this.dripT.tick(dt, this.fog.dripsPerS)) this.drip();
    this.signals(f);
    this.wildlife(f, dt);
  }

  /**
   * Lightning struck `distanceM` away on `bearingRad` (clockwise from north, from the
   * listener): the thunder follows at the speed of sound.
   */
  thunder(bearingRad: number, distanceM: number, toWater: boolean): void {
    const shot = thunderShot(distanceM, toWater, this.fog.damping);
    const id = shot.near ? WORLD_SOUND.thunderNear : WORLD_SOUND.thunderFar;
    const l = this.last?.listener ?? { x: 0, y: 0, z: 0 };
    this.levels.thunder = shot.gain;
    this.play(id, 'ambience', {
      gain: shot.gain,
      lowpassHz: shot.lowpassHz,
      delay: shot.delayS,
      rate: shot.near ? this.between(0.92, 1.05) : this.between(0.8, 1),
      priority: PRIORITY.sfx,
      at: {
        x: l.x + Math.sin(bearingRad) * distanceM,
        y: 400,
        z: l.z - Math.cos(bearingRad) * distanceM,
      },
    });
  }

  /** Plays one call of a gull or a loon now, for the dev panel. */
  callNow(kind: 'gull' | 'loon'): void {
    const f = this.last;
    if (!f) return;
    if (kind === 'gull') this.gull(f);
    else this.loonSeries(f);
  }

  /** Sounds the nearest station's signal once now, for the dev panel. */
  signalNow(): void {
    const f = this.last;
    if (!f) return;
    const near = [...this.stations].sort(
      (a, b) => dist(a.at, f.listener) - dist(b.at, f.listener),
    )[0];
    const first = near?.signal.pattern[0];
    if (near && first) this.blast(near, f, first[1], 0, true);
  }

  dispose(): void {
    this.rain.dispose();
    this.hush.dispose();
    this.out.disconnect();
  }

  private drip(): void {
    const buffer = this.drips[Math.floor(this.random() * this.drips.length)];
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus: 'ambience',
      gain: this.between(0.04, 0.12),
      rate: this.between(0.85, 1.2),
      priority: PRIORITY.detail,
    });
  }

  /** Schedules each sounding station's blasts that reach the listener soon. */
  private signals(f: WorldAudioFrame): void {
    let heard = 0;
    for (const station of this.stations) {
      const d = dist(station.at, f.listener);
      const level = signalLevel(station.signal.kind, d, this.fog.damping);
      const sounding = level !== undefined && this.inFog(station, f);
      // The listener hears now what the station sent `d / 343` seconds ago.
      const travel = d / SOUND_MS;
      const from = this.scheduledTo.get(station.id) ?? f.nowS - travel;
      const to = f.nowS + LOOKAHEAD_S - travel;
      this.scheduledTo.set(station.id, Math.max(from, to));
      if (!sounding || !level) continue;
      heard++;
      const phase = signalPhase(station.id, station.signal.periodS);
      for (const b of blastsBetween(station.signal, phase, from, to)) {
        this.blast(station, f, b.lengthS, Math.max(0, b.startS + travel - f.nowS), false);
      }
    }
    this.levels.signalsHeard = heard;
    this.signalHeard = f.nowS < this.heardUntilS;
  }

  private inFog(station: SignalStation, f: WorldAudioFrame): boolean {
    if (f.fogVisibilityM < SIGNAL_FOG_M) return true;
    return f.fogBanks.some(
      (b) => b.strength > 0.3 && Math.hypot(station.at.x - b.x, station.at.z - b.z) < b.radiusM,
    );
  }

  private blast(
    station: SignalStation,
    f: WorldAudioFrame,
    lengthS: number,
    delay: number,
    force: boolean,
  ): void {
    const d = dist(station.at, f.listener);
    const level =
      signalLevel(station.signal.kind, d, this.fog.damping) ??
      (force ? { gain: 0.05, lowpassHz: 800 } : undefined);
    if (!level) return;
    const whistle = station.signal.kind === 'whistle';
    const id = whistle ? WORLD_SOUND.whistle : WORLD_SOUND.bell;
    const buffer = this.bank.get(id);
    if (!buffer) return;
    this.heardUntilS = Math.max(this.heardUntilS, f.nowS + delay + (whistle ? lengthS : 3) + 0.5);
    this.captions?.push(
      {
        key: station.id,
        text: `${station.name}: fog ${whistle ? 'whistle' : 'bell'}`,
        at: station.at,
      },
      f.nowS,
      delay,
      whistle ? lengthS : 2,
    );
    this.mixer.play({
      buffer,
      bus: 'sfx',
      gain: level.gain * (whistle ? 1 : 0.8),
      lowpassHz: level.lowpassHz,
      delay,
      ...(whistle ? { duration: Math.min(lengthS, buffer.duration), fadeOutS: 0.6 } : {}),
      priority: PRIORITY.critical,
      at: station.at,
    });
  }

  private wildlife(f: WorldAudioFrame, dt: number): void {
    const gullsPerS = gullRate({
      sunElevationDeg: f.sunElevationDeg,
      shoreDistanceM: f.shoreDistanceM,
      harborDistanceM: f.harborDistanceM,
      windKn: f.windKn,
      rain01: f.rain01,
      storm01: f.storm01,
    });
    const loonsPerS = loonRate({
      sunElevationDeg: f.sunElevationDeg,
      month0: f.month0,
      shoreDistanceM: f.shoreDistanceM,
      windKn: f.windKn,
      rain01: f.rain01,
      storm01: f.storm01,
    });
    this.levels.gullsPerS = gullsPerS;
    this.levels.loonsPerS = loonsPerS;
    if (this.gullT.tick(dt, gullsPerS)) this.gull(f);
    if (this.loonT.tick(dt, loonsPerS)) this.loonSeries(f);
  }

  /** A gull overhead or along the shore, 30–220 m off, often a pair calling. */
  private gull(f: WorldAudioFrame): void {
    const shoreward = f.shoreDistanceM < 800 && (f.towardShore.x !== 0 || f.towardShore.z !== 0);
    const base = shoreward
      ? Math.atan2(f.towardShore.x, -f.towardShore.z)
      : this.random() * Math.PI * 2;
    const calls = this.random() < 0.3 ? 2 : 1;
    for (let c = 0; c < calls; c++) {
      const bearing = base + (this.random() - 0.5) * (shoreward ? 2.2 : Math.PI * 2);
      const d = this.between(30, 220);
      const at = {
        x: f.ship.x + Math.sin(bearing) * d,
        y: this.between(10, 40),
        z: f.ship.z - Math.cos(bearing) * d,
      };
      const level = birdLevel(dist(at, f.listener), 40, this.fog.damping);
      this.play(this.pick(WORLD_SOUND.gulls), 'ambience', {
        gain: 0.55 * level.gain * this.between(0.6, 1),
        lowpassHz: level.lowpassHz,
        rate: this.between(0.9, 1.12),
        delay: c * this.between(0.4, 1.6),
        priority: PRIORITY.detail,
        at,
      });
    }
  }

  /** A loon far across the water: a call, sometimes answered or repeated. */
  private loonSeries(f: WorldAudioFrame): void {
    const bearing = this.random() * Math.PI * 2;
    const d = this.between(400, 1800);
    const at = { x: f.ship.x + Math.sin(bearing) * d, y: 0, z: f.ship.z - Math.cos(bearing) * d };
    const level = birdLevel(dist(at, f.listener), 400, this.fog.damping);
    const calls = 1 + Math.floor(this.random() * 3);
    let t = 0;
    for (let c = 0; c < calls; c++) {
      this.play(this.pick(WORLD_SOUND.loons), 'ambience', {
        gain: 0.7 * level.gain,
        lowpassHz: level.lowpassHz,
        rate: this.between(0.94, 1.04),
        delay: t + d / SOUND_MS,
        priority: PRIORITY.detail,
        at,
      });
      t += this.between(1.8, 4.5);
    }
  }

  private play(id: string, bus: OneShot['bus'], shot: Omit<OneShot, 'buffer' | 'bus'>): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus, ...shot });
  }

  private pick(ids: readonly string[]): string {
    return ids[Math.floor(this.random() * ids.length)] ?? (ids[0] as string);
  }

  private between(lo: number, hi: number): number {
    return lo + (hi - lo) * this.random();
  }
}

function dist(
  a: { x: number; z: number; y?: number },
  b: { x: number; z: number; y?: number },
): number {
  return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
}
