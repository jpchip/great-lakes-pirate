import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import {
  ALARM_STROKES,
  BELL_RANGE_M,
  FIRE_CAPTIONS,
  GUN_RANGE,
  HAIL_CAPTIONS,
  WANTED_STINGER_RANK,
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
  type TierChange,
  type WantedStingerId,
} from './law-mix';
import { PRIORITY, setPosition, type AudioMixer, type AudioPoint } from './mixer';
import { whistleLevel } from './ship-whistle-mix';
import { SOUND_MS } from './world-mix';

/**
 * The law's sounds (Phase 5 piece H; plan 06 §14.4 row H): a stinger as a region's
 * Wanted tier changes, and the revenue cutter (and the tier-5 tug) heard at close
 * quarters: her whistle as she hails, her engine, her bell striking the ship's time and
 * ringing the alarm as she starts after you, her bow gun and the round falling (the tug's
 * deputies fire rifles), and the lockup's door going shut and opening again.
 */

export const LAW_AUDIO_BUNDLE = 'law-audio';

export const LAW_SOUND = {
  stinger: {
    rise: 'music.stinger.wanted-rise',
    hunted: 'music.stinger.wanted-hunted',
    most: 'music.stinger.wanted-most',
    cool: 'music.stinger.wanted-cool',
  } satisfies Record<WantedStingerId, string>,
  engine: 'sfx.law.engine',
  bell: 'sfx.law.bell',
  gun: 'sfx.law.gun',
  splash: 'sfx.law.splash',
  riggingHit: 'sfx.law.rigging-hit',
  rifle: 'sfx.law.rifle',
  door: 'ui.jail.door',
  release: 'ui.jail.release',
} as const;

/** Her whistle (Phase 3's, in the world bundle) and the tug's. */
export const LAW_WHISTLE = {
  'law.morrill': { soundId: 'sfx.ship.whistle-cutter', rangeM: 5500 },
  'law.chartered_tug': { soundId: 'sfx.ship.whistle-tug', rangeM: 3000 },
} as const;

export type LawShipId = keyof typeof LAW_WHISTLE;

export const LAW_NAMES: Readonly<Record<LawShipId, string>> = {
  'law.morrill': 'Revenue cutter Morrill',
  'law.chartered_tug': 'Chartered tug',
};

/** A law ship this frame: where she is (zone meters) and how fast she's going. */
export interface LawShipView {
  id: LawShipId;
  /** The entity's own id, which keys her engine. */
  key: string;
  x: number;
  z: number;
  speedKn: number;
}

export interface LawFrame {
  listener: AudioPoint;
  nowS: number;
  gameSeconds: number;
  /** Fog's damping of distant highs (world-mix `fogMix`), 1 in clear air. */
  damping: number;
  ships: readonly LawShipView[];
}

/** Heights above the water the sounds leave from, meters. */
const WHISTLE_Y = 14;
const BELL_Y = 7;
const DECK_Y = 4;
const ENGINE_Y = 2;
/** Seconds the bed takes to follow a change, and to fade before it stops. */
const ENGINE_TAU_S = 0.4;
const ENGINE_IDLE_S = 3;
/** The release cue, then the "clear" chart stinger once the door is open. */
const RELEASE_STINGER_DELAY_S = 2.4;
/** The tolling bell after the door, for the gallows. */
const GALLOWS_STINGER_DELAY_S = 2.8;

interface EngineBed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode;
  silentS: number;
}

export class LawSounds {
  /** False hides the captions (the Settings toggle lives on the feed). */
  captions: CaptionFeed | undefined;
  /** Plays a chart stinger (piece J's), for the release; set by game-audio. */
  chartStinger: ((id: 'clear', delay: number) => void) | undefined;
  /** Ducks the chart's theme under a stinger; set by game-audio. */
  duckChart: ((seconds: number) => void) | undefined;
  /** The last stinger and cue played, for the dev panel and the tests. */
  lastStinger: WantedStingerId | undefined;
  lastCue = '';
  /** Engines heard now, for the dev panel. */
  readonly levels = { engines: 0, bells: 0 };

  private pending: TierChange[] = [];
  private lastRank: number | undefined;
  private lastStingerAtS = -Infinity;
  private stingerUntilS = 0;
  private nowS = 0;
  private lastGameS: number | undefined;
  private frame: LawFrame | undefined;
  private readonly engines = new Map<string, EngineBed>();

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
  ) {}

  /** True while a Wanted stinger plays, so the open-water music ducks under it. */
  get ducking(): boolean {
    return this.nowS < this.stingerUntilS;
  }

  // -- Wanted -----------------------------------------------------------------------------

  /** A region's tier changed; heard at the next `flush` with whatever came with it. */
  tierChanged(change: TierChange): void {
    this.pending.push(change);
  }

  /** Forget changes that came with going to jail or being let out: those have their cues. */
  dropPending(): void {
    this.pending = [];
  }

  /**
   * Once a frame: the tier changes since the last one earn at most one stinger, unless one
   * just played (a sharper one may still cut in). `suppress` (in the lockup) drops them.
   */
  flush(nowS: number, playerRegion: string | undefined, suppress = false): void {
    this.nowS = nowS;
    if (this.pending.length === 0) return;
    const changes = this.pending;
    this.pending = [];
    if (suppress) return;
    const id = wantedStingerFor(changes, playerRegion);
    if (!id) return;
    if (!stingerAllowed(id, this.lastRank, nowS - this.lastStingerAtS)) return;
    this.stinger(id, nowS);
  }

  /** Plays a Wanted stinger on the music bus now. */
  stinger(id: WantedStingerId, nowS = this.nowS, delay = 0): void {
    const buffer = this.bank.get(LAW_SOUND.stinger[id]);
    if (!buffer) return;
    this.lastStinger = id;
    this.lastRank = WANTED_STINGER_RANK[id];
    this.lastStingerAtS = nowS;
    this.stingerUntilS = Math.max(this.stingerUntilS, nowS + delay + buffer.duration);
    this.duckChart?.(delay + buffer.duration);
    this.mixer.play({ buffer, bus: 'music', delay, priority: PRIORITY.critical });
  }

  // -- The lockup -------------------------------------------------------------------------

  /** The cell door shuts; for the gallows, the bell tolls after it. */
  jailed(execution: boolean): void {
    this.pending = [];
    this.ui(LAW_SOUND.door, 0.9);
    this.lastCue = 'door';
    if (execution) this.stinger('most', this.nowS, GALLOWS_STINGER_DELAY_S);
  }

  /** Let out: the door opens, and the chart's "clear" phrase plays you out. */
  released(): void {
    this.pending = [];
    this.ui(LAW_SOUND.release, 0.85);
    this.lastCue = 'release';
    this.chartStinger?.('clear', RELEASE_STINGER_DELAY_S);
  }

  // -- At close quarters ------------------------------------------------------------------

  /** She hails: her whistle, placed at her and arriving at the speed of sound. */
  hailed(
    ship: LawShipView,
    e: { intent: 'inspect' | 'pursue'; arrest: boolean },
    force = false,
  ): void {
    const f = this.frame;
    if (!f) return;
    const whistle = LAW_WHISTLE[ship.id];
    const buffer = this.bank.get(whistle.soundId);
    if (!buffer) return;
    const at = { x: ship.x, y: WHISTLE_Y, z: ship.z };
    const d = dist(at, f.listener);
    const level =
      whistleLevel('steam', whistle.rangeM, d, f.damping) ??
      (force ? { gain: 0.05, lowpassHz: 800 } : undefined);
    if (!level) return;
    const kind = hailKind(e);
    const travel = d / SOUND_MS;
    const pattern = hailPattern(kind);
    for (const [startS, lengthS] of pattern) {
      this.mixer.play({
        buffer,
        bus: 'sfx',
        gain: level.gain,
        lowpassHz: level.lowpassHz,
        delay: travel + startS,
        duration: Math.min(lengthS, buffer.duration),
        fadeOutS: lengthS < 1 ? 0.15 : 0.35,
        priority: PRIORITY.critical,
        at,
      });
    }
    const [lastAt, lastLength] = pattern[pattern.length - 1] ?? [0, 1];
    this.captions?.push(
      { key: ship.id, text: `${LAW_NAMES[ship.id]}: ${HAIL_CAPTIONS[kind]}`, at },
      f.nowS,
      travel,
      lastAt + lastLength,
    );
    this.lastCue = `hail ${kind}`;
  }

  /**
   * She fires: the cutter's bow gun (a warning shot or at the rigging), the round falling
   * where it fell (`fell`, zone meters: a splash, or the rigging torn on a hit), or the
   * tug's deputies' rifles.
   */
  fired(
    ship: LawShipView,
    e: { kind: 'warning' | 'rigging'; hit: boolean; at?: { x: number; z: number } },
  ): void {
    const f = this.frame;
    if (!f) return;
    const gunAt = { x: ship.x, y: DECK_Y, z: ship.z };
    const d = dist(gunAt, f.listener);
    if (ship.id === 'law.chartered_tug') {
      const level = shotLevel(d, ...GUN_RANGE.rifle, f.damping);
      const buffer = this.bank.get(LAW_SOUND.rifle);
      if (!level || !buffer) return;
      const shots = e.kind === 'warning' ? [0] : [0, 0.55, 1.3];
      for (const s of shots) {
        this.mixer.play({
          buffer,
          bus: 'sfx',
          gain: level.gain * 0.9,
          lowpassHz: level.lowpassHz,
          delay: d / SOUND_MS + s,
          rate: 0.95 + 0.1 * ((s * 7) % 1),
          priority: PRIORITY.critical,
          at: gunAt,
        });
      }
      this.captions?.push(
        {
          key: `${ship.id}:fire`,
          text: `${LAW_NAMES[ship.id]}: ${FIRE_CAPTIONS.rifle}`,
          at: gunAt,
        },
        f.nowS,
        d / SOUND_MS,
        shots[shots.length - 1] ?? 0,
      );
      this.lastCue = 'rifle';
      return;
    }
    const timing = shotTiming(gunAt, e.at, f.listener);
    const report = shotLevel(d, ...GUN_RANGE.gun, f.damping);
    const gun = this.bank.get(LAW_SOUND.gun);
    if (report && gun) {
      this.mixer.play({
        buffer: gun,
        bus: 'sfx',
        gain: report.gain,
        lowpassHz: report.lowpassHz,
        delay: timing.reportS,
        priority: PRIORITY.critical,
        at: gunAt,
      });
      this.captions?.push(
        {
          key: `${ship.id}:fire`,
          text: `${LAW_NAMES[ship.id]}: ${FIRE_CAPTIONS[e.kind]}`,
          at: gunAt,
        },
        f.nowS,
        timing.reportS,
        1,
      );
    }
    if (e.at && timing.fallS !== undefined) {
      const fellAt = { x: e.at.x, y: 1, z: e.at.z };
      const hit = e.kind === 'rigging' && e.hit;
      const buffer = this.bank.get(hit ? LAW_SOUND.riggingHit : LAW_SOUND.splash);
      const level = hit
        ? { gain: 0.9, lowpassHz: 16000 }
        : shotLevel(dist(fellAt, f.listener), ...GUN_RANGE.splash, f.damping);
      if (buffer && level) {
        this.mixer.play({
          buffer,
          bus: 'sfx',
          gain: level.gain,
          lowpassHz: level.lowpassHz,
          delay: timing.fallS,
          priority: PRIORITY.critical,
          at: hit ? { x: e.at.x, y: 10, z: e.at.z } : fellAt,
        });
      }
    }
    this.lastCue = e.kind === 'warning' ? 'warning shot' : e.hit ? 'gun, hit' : 'gun, miss';
  }

  /** She starts after you: her bell rung hard and fast. */
  pursuit(ship: LawShipView): void {
    const f = this.frame;
    if (!f) return;
    this.ring(ship, ALARM_STROKES, f, 1.15);
    this.lastCue = 'alarm';
  }

  // -- Every frame ------------------------------------------------------------------------

  /**
   * Each sailing frame: her engine follows her (loudness, rate and dullness with distance,
   * speed and fog), and on the half hour she strikes the ship's time.
   */
  update(f: LawFrame, dt: number): void {
    this.frame = f;
    this.nowS = f.nowS;
    const seen = new Set<string>();
    let heard = 0;
    for (const ship of f.ships) {
      seen.add(ship.key);
      const at = { x: ship.x, y: ENGINE_Y, z: ship.z };
      const level = engineLevel(
        dist(at, f.listener),
        ship.speedKn,
        f.damping,
        ship.id === 'law.chartered_tug',
      );
      if (level) heard++;
      this.engine(ship.key, at, level, dt);
    }
    for (const key of [...this.engines.keys()]) {
      if (!seen.has(key)) this.engine(key, undefined, undefined, dt);
    }
    this.levels.engines = heard;

    const prev = this.lastGameS;
    this.lastGameS = f.gameSeconds;
    if (prev === undefined) return;
    const mark = bellDue(prev, f.gameSeconds);
    if (mark === undefined) return;
    const strokes = shipsBells((mark % 86400) / 3600);
    for (const ship of f.ships) {
      if (ship.id !== 'law.morrill') continue;
      if (this.ring(ship, bellPattern(strokes), f, 1)) this.levels.bells++;
    }
  }

  /** Leaving the helm (or the zone): her engine stops being heard. */
  stop(): void {
    for (const key of [...this.engines.keys()]) this.dispose(key);
    this.frame = undefined;
    this.lastGameS = undefined;
  }

  /** The nearest law ship's bell strikes the time now, for the dev panel. */
  bellsNow(): void {
    const f = this.frame;
    const ship = f && nearest(f);
    if (!f || !ship) return;
    this.ring(ship, bellPattern(shipsBells(((f.gameSeconds % 86400) / 3600) | 0)), f, 1, true);
  }

  /** The nearest law ship hails now, for the dev panel. */
  hailNow(kind: 'inspect' | 'pursue' | 'arrest'): void {
    const ship = this.nearestShip();
    if (ship) {
      this.hailed(
        ship,
        { intent: kind === 'pursue' ? 'pursue' : 'inspect', arrest: kind === 'arrest' },
        true,
      );
    }
  }

  /** The nearest law ship fires now, the round falling 60 m off the listener, for the dev panel. */
  fireNow(kind: 'warning' | 'miss' | 'hit'): void {
    const f = this.frame;
    const ship = this.nearestShip();
    if (!f || !ship) return;
    const at = { x: f.listener.x + (kind === 'hit' ? 0 : 60), z: f.listener.z };
    this.fired(ship, { kind: kind === 'warning' ? 'warning' : 'rigging', hit: kind === 'hit', at });
  }

  /** The nearest law ship, for the dev panel's buttons. */
  nearestShip(): LawShipView | undefined {
    return this.frame && nearest(this.frame);
  }

  private ring(
    ship: LawShipView,
    strokes: readonly number[],
    f: LawFrame,
    rate: number,
    force = false,
  ): boolean {
    const buffer = this.bank.get(LAW_SOUND.bell);
    if (!buffer) return false;
    const at = { x: ship.x, y: BELL_Y, z: ship.z };
    const d = dist(at, f.listener);
    const level =
      shotLevel(d, BELL_RANGE_M, 40, f.damping) ??
      (force ? { gain: 0.05, lowpassHz: 800 } : undefined);
    if (!level) return false;
    for (const s of strokes) {
      this.mixer.play({
        buffer,
        bus: 'sfx',
        gain: level.gain * 0.55,
        lowpassHz: level.lowpassHz,
        delay: d / SOUND_MS + s,
        rate,
        priority: PRIORITY.sfx,
        at,
      });
    }
    return true;
  }

  private engine(
    key: string,
    at: AudioPoint | undefined,
    level: { gain: number; lowpassHz: number; rate: number } | undefined,
    dt: number,
  ): void {
    const buffer = this.bank.get(LAW_SOUND.engine);
    const ctx = this.mixer.ctx;
    let bed = this.engines.get(key);
    if (!buffer || typeof ctx.createBufferSource !== 'function') return;
    if (!bed) {
      if (!level) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.rolloffFactor = 0;
      source.connect(filter).connect(gain).connect(panner).connect(this.mixer.buses.sfx);
      source.start(ctx.currentTime, Math.random() * buffer.duration);
      bed = { source, filter, gain, panner, silentS: 0 };
      this.engines.set(key, bed);
    }
    const now = ctx.currentTime;
    if (at) setPosition(bed.panner, at);
    if (level) {
      bed.silentS = 0;
      bed.gain.gain.setTargetAtTime(level.gain, now, ENGINE_TAU_S);
      bed.filter.frequency.setTargetAtTime(level.lowpassHz, now, ENGINE_TAU_S);
      bed.source.playbackRate.setTargetAtTime(level.rate, now, 1.5);
    } else {
      bed.gain.gain.setTargetAtTime(0, now, ENGINE_TAU_S);
      bed.silentS += dt;
      if (bed.silentS > ENGINE_IDLE_S) this.dispose(key);
    }
  }

  private dispose(key: string): void {
    const bed = this.engines.get(key);
    if (!bed) return;
    bed.source.stop();
    bed.source.disconnect();
    bed.filter.disconnect();
    bed.gain.disconnect();
    bed.panner.disconnect();
    this.engines.delete(key);
  }

  private ui(id: string, gain: number): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus: 'ui', gain, priority: PRIORITY.critical });
  }
}

function nearest(f: LawFrame): LawShipView | undefined {
  const l = f.listener;
  return [...f.ships].sort(
    (a, b) => Math.hypot(a.x - l.x, a.z - l.z) - Math.hypot(b.x - l.x, b.z - l.z),
  )[0];
}

function dist(a: AudioPoint, b: AudioPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
