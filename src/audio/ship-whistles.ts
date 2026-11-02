import type { ShipRecord } from '../../data/schemas/ships';
import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import { PRIORITY, type AudioMixer, type AudioPoint } from './mixer';
import {
  SHORT_BLAST_S,
  fogSignalCase,
  fogSignalPattern,
  passingPattern,
  passingSignal,
  whistleLevel,
  type FogSignalCase,
} from './ship-whistle-mix';
import { SIGNAL_FOG_M, SOUND_MS, blastsBetween, signalPhase } from './world-mix';
import { WORLD_SOUND } from './world-audio';

/**
 * The NPC ships' whistles (plan 15 §4.3, §11 Phase 3; Phase 3 piece J): in fog each ship
 * sounds its fog signal from the 1895 Great Lakes rules (ship-whistle-mix.ts), so you hear
 * traffic you can't see, and in clear weather a ship meeting you gives the passing signal
 * once. Each blast leaves the ship's funnel and reaches the listener at the speed of
 * sound, panned from the camera, so the direction you hear it from is where the ship is.
 */

/** A ship that can sound, as the game hands it over each frame. */
export interface WhistleShip {
  id: string;
  record: ShipRecord;
  x: number;
  z: number;
  headingRad: number;
  speedKn: number;
}

export interface WhistleFrame {
  listener: AudioPoint;
  /** The player's ship, for the passing signal. */
  player: { x: number; z: number; headingRad: number };
  /** Real seconds since start: the signals' clock. */
  nowS: number;
  /** Where the wind comes from, radians clockwise from north (a sailing vessel's tack). */
  windFromRad: number;
  /** Fog visibility, meters, and the fog banks around (zone meters). */
  fogVisibilityM: number;
  fogBanks: readonly { x: number; z: number; radiusM: number; strength: number }[];
  /** The roll-off on distant sounds in fog (world-mix `fogMix().damping`). */
  damping: number;
}

/** How far ahead blasts are scheduled, seconds. */
const LOOKAHEAD_S = 0.25;
/** Where on the ship the whistle is: up on the funnel, meters. */
const WHISTLE_HEIGHT_M = 14;
/** A ship that has given the passing signal won't again until it's this far off, meters. */
const PASSING_RESET_M = 2500;

interface ShipState {
  scheduledTo: number;
  case: FogSignalCase | undefined;
  passed: boolean;
}

/** What each kind of signal says, for its caption (plan 15 §5). */
export const SIGNAL_CAPTIONS: Readonly<Record<FogSignalCase, string>> = {
  'steam-under-way': 'whistle, three blasts (under way in fog)',
  'starboard-tack': 'fog horn, one blast (starboard tack)',
  'port-tack': 'fog horn, two blasts (port tack)',
  running: 'fog horn, three blasts (wind abaft the beam)',
  'at-anchor': "ship's bell (lying stopped)",
};

/** The passing signal's caption: one short blast, or two. */
export function passingCaption(n: 1 | 2): string {
  return n === 1
    ? 'one short blast (passing port to port)'
    : 'two short blasts (passing starboard to starboard)';
}

export class ShipWhistles {
  /** The latest readout, for the dev panel. */
  readonly levels = { shipsSounding: 0, lastSignal: '' };
  /** True while a ship's whistle is sounding within earshot (the music ducks under it). */
  heard = false;
  /** Where the signals' captions go (plan 15 §5); none when unset. */
  captions: CaptionFeed | undefined;
  private readonly ships = new Map<string, ShipState>();
  private heardUntilS = 0;
  private last: { frame: WhistleFrame; ships: readonly WhistleShip[] } | undefined;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
  ) {}

  update(f: WhistleFrame, ships: readonly WhistleShip[]): void {
    this.last = { frame: f, ships };
    let sounding = 0;
    const seen = new Set<string>();
    for (const ship of ships) {
      const whistle = ship.record.whistle;
      if (!whistle) continue;
      seen.add(ship.id);
      const at = { x: ship.x, y: WHISTLE_HEIGHT_M, z: ship.z };
      const d = dist(at, f.listener);
      const travel = d / SOUND_MS;
      let state = this.ships.get(ship.id);
      if (!state) {
        state = { scheduledTo: f.nowS - travel, case: undefined, passed: false };
        this.ships.set(ship.id, state);
      }
      const from = state.scheduledTo;
      const to = f.nowS + LOOKAHEAD_S - travel;
      state.scheduledTo = Math.max(from, to);

      if (this.inFog(ship, f)) {
        const c = fogSignalCase(whistle.kind, ship.speedKn, ship.headingRad, f.windFromRad);
        state.case = c;
        const level = this.level(ship, d, f.damping, c);
        if (!level) continue;
        sounding++;
        const signal = fogSignalPattern(c);
        const phase = signalPhase(ship.id, signal.periodS);
        for (const b of blastsBetween(signal, phase, from, to)) {
          this.sound(ship, c, at, b.lengthS, Math.max(0, b.startS + travel - f.nowS), level, f);
        }
        continue;
      }
      state.case = undefined;

      // In sight: the passing signal, once per meeting. Only steamers give it; a sailing
      // vessel holds her course and stays silent.
      if (whistle.kind !== 'steam') continue;
      const meetDist = Math.hypot(f.player.x - ship.x, f.player.z - ship.z);
      if (state.passed) {
        if (meetDist > PASSING_RESET_M) state.passed = false;
        continue;
      }
      const n = passingSignal({
        ship: { x: ship.x, z: ship.z, headingRad: ship.headingRad, speedKn: ship.speedKn },
        other: f.player,
        visibilityM: f.fogVisibilityM,
      });
      if (n === undefined) continue;
      state.passed = true;
      this.passing(ship, n, f);
    }
    for (const id of [...this.ships.keys()]) if (!seen.has(id)) this.ships.delete(id);
    this.levels.shipsSounding = sounding;
    this.heard = f.nowS < this.heardUntilS;
  }

  /** The nearest ship sounds its fog signal once now, for the dev panel. */
  fogSignalNow(): void {
    const near = this.nearest();
    if (!near) return;
    const { ship, frame: f } = near;
    const whistle = ship.record.whistle;
    if (!whistle) return;
    const c = fogSignalCase(whistle.kind, ship.speedKn, ship.headingRad, f.windFromRad);
    const at = { x: ship.x, y: WHISTLE_HEIGHT_M, z: ship.z };
    const travel = dist(at, f.listener) / SOUND_MS;
    const level = this.level(ship, dist(at, f.listener), f.damping, c) ?? {
      gain: 0.05,
      lowpassHz: 800,
    };
    for (const [startS, lengthS] of fogSignalPattern(c).pattern) {
      this.sound(ship, c, at, lengthS, startS + travel, level, f);
    }
  }

  /** The nearest ship gives one short blast now, for the dev panel. */
  passingNow(): void {
    const near = this.nearest();
    if (near) this.passing(near.ship, 1, near.frame, true);
  }

  private nearest(): { ship: WhistleShip; frame: WhistleFrame } | undefined {
    const last = this.last;
    if (!last) return undefined;
    const l = last.frame.listener;
    const ship = [...last.ships]
      .filter((s) => s.record.whistle)
      .sort((a, b) => Math.hypot(a.x - l.x, a.z - l.z) - Math.hypot(b.x - l.x, b.z - l.z))[0];
    return ship && { ship, frame: last.frame };
  }

  private inFog(ship: WhistleShip, f: WhistleFrame): boolean {
    if (f.fogVisibilityM < SIGNAL_FOG_M) return true;
    return f.fogBanks.some(
      (b) => b.strength > 0.3 && Math.hypot(ship.x - b.x, ship.z - b.z) < b.radiusM,
    );
  }

  private level(
    ship: WhistleShip,
    d: number,
    damping: number,
    c: FogSignalCase | 'passing',
  ): { gain: number; lowpassHz: number } | undefined {
    const whistle = ship.record.whistle;
    if (!whistle) return undefined;
    // A ship's bell is a small sound next to her whistle.
    if (c === 'at-anchor') {
      const bell = whistleLevel('horn', Math.min(1500, whistle.rangeM), d, damping);
      return bell && { gain: bell.gain * 0.8, lowpassHz: bell.lowpassHz };
    }
    return whistleLevel(whistle.kind, whistle.rangeM, d, damping);
  }

  private passing(ship: WhistleShip, n: 1 | 2, f: WhistleFrame, force = false): void {
    const at = { x: ship.x, y: WHISTLE_HEIGHT_M, z: ship.z };
    const d = dist(at, f.listener);
    const level =
      this.level(ship, d, f.damping, 'passing') ??
      (force ? { gain: 0.05, lowpassHz: 800 } : undefined);
    if (!level) return;
    const pattern = passingPattern(n);
    for (const [startS, lengthS] of pattern) {
      this.sound(ship, 'passing', at, lengthS, startS + d / SOUND_MS, level, f);
    }
    const [lastAt, lastLength] = pattern[pattern.length - 1] ?? [0, 1];
    this.captions?.push(
      { key: ship.id, text: `${ship.record.name}: ${passingCaption(n)}`, at },
      f.nowS,
      d / SOUND_MS,
      lastAt + lastLength,
    );
  }

  private sound(
    ship: WhistleShip,
    c: FogSignalCase | 'passing',
    at: AudioPoint,
    lengthS: number,
    delay: number,
    level: { gain: number; lowpassHz: number },
    f: WhistleFrame,
  ): void {
    const whistle = ship.record.whistle;
    if (!whistle) return;
    const bell = c === 'at-anchor';
    const buffer = this.bank.get(bell ? WORLD_SOUND.bell : whistle.soundId);
    if (!buffer) return;
    this.levels.lastSignal = `${ship.record.name}: ${c}`;
    if (c !== 'passing') {
      this.captions?.push(
        { key: ship.id, text: `${ship.record.name}: ${SIGNAL_CAPTIONS[c]}`, at },
        f.nowS,
        delay,
        bell ? 2 : lengthS,
      );
    }
    this.heardUntilS = Math.max(this.heardUntilS, f.nowS + delay + (bell ? 2 : lengthS) + 0.5);
    this.mixer.play({
      buffer,
      bus: 'sfx',
      gain: level.gain,
      lowpassHz: level.lowpassHz,
      delay,
      // A ship's bell is smaller and higher than a lighthouse's fog bell.
      ...(bell
        ? { rate: 1.6, duration: 1.2, fadeOutS: 0.4 }
        : {
            duration: Math.min(lengthS, buffer.duration),
            fadeOutS: lengthS <= SHORT_BLAST_S ? 0.2 : 0.35,
          }),
      priority: PRIORITY.critical,
      at,
    });
  }
}

function dist(a: AudioPoint, b: AudioPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
