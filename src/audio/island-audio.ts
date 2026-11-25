import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import { ISLANDS } from '../sim/islands/on-foot';
import {
  SPADE_STRIKES_S,
  animalCue,
  callGain,
  caveDripGapS,
  caveRoomLevel,
  dripVariant,
  islandBeds,
  seasonOf,
  surgeGain,
  woodpeckerGapS,
  type AnimalCueState,
  type AnimalKind,
  type IslandTier,
} from './island-mix';
import { PRIORITY, type AudioMixer, type AudioPoint } from './mixer';
import type { BusId } from './settings';

/**
 * The islands, heard (Phase 9 piece Y; plan 15 §4.1, §4.5, §11 Phase 9): the birds, the creek
 * and the surf of an island by its tier and the season; a sea cave's hush, its drips and the
 * surge at its mouth; a deer's snort and its bounds, a bear's huff and growl, a wolf's howl
 * from the trees (placed where the animal is, captioned); the grapple going down and coming
 * up; a spade in the ground; and the woodpecker in spring and summer. `island-mix.ts` has the
 * rules. The ending's air is a stream (`ENDING_MUSIC`), played by `game-audio.ts`.
 */

export const ISLAND_AUDIO_BUNDLE = 'island-audio';
export const ENDING_AUDIO_BUNDLE = 'ending-audio';
export const ENDING_MUSIC_CUE = 'music.ending.air';

export const ISLAND_SOUND = {
  birds: 'amb.island.birds',
  creek: 'amb.island.creek',
  surf: 'amb.island.surf',
  woodpecker: 'sfx.island.woodpecker',
  cave: 'amb.cave.room',
  drips: ['sfx.cave.drip-1', 'sfx.cave.drip-2'],
  surge: 'sfx.cave.surge',
  deerSnort: 'voice.deer.snort',
  deerBound: 'sfx.deer.bound',
  bearHuff: 'voice.bear.huff',
  bearCrash: 'sfx.bear.crash',
  bearGrowl: 'voice.bear.growl',
  wolfHowls: ['voice.wolf.howl-1', 'voice.wolf.howl-2'],
  grappleCast: 'sfx.salvage.grapple-cast',
  grappleHaul: 'sfx.salvage.grapple-haul',
  dive: 'sfx.salvage.dive',
  spades: ['sfx.dig.spade-1', 'sfx.dig.spade-2'],
} as const;

/** What the island sounds read each frame, while you're on your feet. */
export interface IslandFrame {
  listener: AudioPoint;
  nowS: number;
  /** Where you stand, zone meters. */
  player: AudioPoint;
  /** The island you're walking, if you're on one (its id in `islands.json`). */
  island: string | undefined;
  /** Under a roof or in a building. */
  inside: boolean;
  month0: number;
  windKn: number;
  /** 0 at night, 1 in full day. */
  daylight01: number;
}

type BedId = 'birds' | 'creek' | 'surf' | 'cave';

interface Bed {
  source: AudioBufferSourceNode;
  gain: GainNode;
  silentS: number;
}

const BED_TAU_S = 1.2;
const BED_IDLE_S = 4;
const BED_BUS: Record<BedId, BusId> = {
  birds: 'ambience',
  creek: 'ambience',
  surf: 'ambience',
  cave: 'ambience',
};
/**
 * The beds' levels. The birds are sparse calls over silence, so the build's RMS levelling
 * leaves them about 8 LU hotter than the other beds (−15.5 LUFS against about −23): the
 * loudness pass (plan 15 §25) brings them down to sit with the creek and the surf.
 */
const BED_LEVEL: Record<BedId, number> = { birds: 0.45, creek: 0.8, surf: 0.9, cave: 0.9 };

/** The tier an island is walked at (`islands.json`); a standard island if it isn't set. */
export function tierOf(islandId: string | undefined): IslandTier {
  const t = ISLANDS.find((i) => i.id === islandId)?.tier;
  return t ?? 'standard';
}

export class IslandSounds {
  captions: CaptionFeed | undefined;
  /** The latest readout, for the dev panel and the tests. */
  readonly levels = {
    /** On an island, on foot, so the beds and the dig are heard. */
    ashore: false,
    birds: 0,
    creek: 0,
    surf: 0,
    cave: 0,
    woodpeckers: 0,
    drips: 0,
    last: '',
  };
  private readonly beds = new Map<BedId, Bed>();
  private frame: IslandFrame | undefined;
  private nowS = 0;
  private inCave: { cave: string; ice: boolean } | undefined;
  private woodpeckerS = 30;
  private dripS = 2;
  private surgeS = 0;
  private spadeVariant = 0;
  private wolfVariant = 0;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  /**
   * Once a frame: the frame ashore on an island (undefined when you're not walking one), the
   * real seconds, and the clock the captions run on. A cave's hush and drips run from the boat
   * too, so this is called every frame.
   */
  update(f: IslandFrame | undefined, dt: number, nowS: number): void {
    this.frame = f;
    this.nowS = nowS;
    this.levels.ashore = f?.island !== undefined;
    if (dt <= 0) return;
    const island = f?.island;
    if (f && island !== undefined) {
      const air = {
        season: seasonOf(f.month0),
        tier: tierOf(island),
        windKn: f.windKn,
        daylight01: f.daylight01,
        inside: f.inside,
      };
      const want = islandBeds(air);
      this.bed('birds', ISLAND_SOUND.birds, want.birds, dt);
      this.bed('creek', ISLAND_SOUND.creek, want.creek, dt);
      this.bed('surf', ISLAND_SOUND.surf, want.surf, dt);
      this.levels.birds = want.birds;
      this.levels.creek = want.creek;
      this.levels.surf = want.surf;
      // The woodpecker, now and again on a summer's day in the wood.
      this.woodpeckerS -= dt;
      if (this.woodpeckerS <= 0) {
        const gap = woodpeckerGapS(this.random, air);
        this.woodpeckerS = gap ?? 20;
        if (gap !== undefined) {
          this.one(ISLAND_SOUND.woodpecker, 0.5, 'ambience', f.player);
          this.levels.woodpeckers++;
          this.levels.last = ISLAND_SOUND.woodpecker;
        }
      }
    } else {
      for (const id of ['birds', 'creek', 'surf'] as BedId[]) this.bed(id, '', 0, dt);
      this.levels.birds = this.levels.creek = this.levels.surf = 0;
    }

    // A sea cave: its hush while you're inside, drips from the roof, the surge at the mouth.
    const caveWant = caveRoomLevel(this.inCave !== undefined);
    this.bed('cave', this.inCave ? ISLAND_SOUND.cave : '', caveWant, dt);
    this.levels.cave = caveWant;
    if (this.inCave) {
      this.dripS -= dt;
      if (this.dripS <= 0) {
        this.dripS = caveDripGapS(this.random);
        const v = dripVariant(this.random);
        const id = ISLAND_SOUND.drips[v - 1] ?? ISLAND_SOUND.drips[0];
        this.one(id, 0.45, 'sfx', undefined, true);
        this.levels.drips++;
        this.levels.last = id;
      }
    }
    this.surgeS = Math.max(0, this.surgeS - dt);
  }

  /** Into a sea cave: its hush starts, and the drips. */
  enterCave(cave: string, ice: boolean): void {
    this.inCave = { cave, ice };
    this.dripS = 1 + this.random() * 2;
  }

  /** Out from under the roof. */
  leaveCave(): void {
    this.inCave = undefined;
  }

  /** Surf driving into the mouth of the cave you're in: a boom, by how big the swell is. */
  surge(swellM = 2): void {
    if (this.surgeS > 0) return;
    this.surgeS = 6;
    this.one(ISLAND_SOUND.surge, 0.9 * surgeGain(swellM), 'sfx', undefined);
    this.levels.last = ISLAND_SOUND.surge;
  }

  /** The spade going in, three strikes over the hold: alternating variants. */
  dig(): void {
    if (!this.frame) return;
    for (const at of SPADE_STRIKES_S) {
      const id = ISLAND_SOUND.spades[this.spadeVariant % 2] ?? ISLAND_SOUND.spades[0];
      this.spadeVariant++;
      this.one(id, 0.8, 'sfx', this.frame.player, false, at);
    }
    this.levels.last = 'dig';
  }

  /** The grapple going down, from where you are on the boat's rail. */
  grappleCast(): void {
    this.one(ISLAND_SOUND.grappleCast, 0.8, 'sfx', undefined);
    this.levels.last = ISLAND_SOUND.grappleCast;
  }

  /** The line coming up taut and the wreck's cargo or papers hauled in. */
  /** Down in the hard-hat suit (Phase 10): the faceplate, the pump, the bubbles. */
  dive(): void {
    this.one(ISLAND_SOUND.dive, 0.8, 'sfx', undefined);
    this.levels.last = ISLAND_SOUND.dive;
  }

  grappleHaul(): void {
    this.one(ISLAND_SOUND.grappleHaul, 0.8, 'sfx', undefined);
    this.levels.last = ISLAND_SOUND.grappleHaul;
  }

  /**
   * An animal's cue (a deer bolting, a bear's huff or charge, the wolves' howl): placed where
   * it is, quieter with distance, and captioned by what it is. `distanceM` is from you.
   */
  animal(kind: AnimalKind, state: AnimalCueState, at: AudioPoint, distanceM: number): void {
    if (!this.frame) return;
    const gain = callGain(distanceM);
    if (gain <= 0) return;
    const variant = this.wolfVariant;
    if (kind === 'wolf') this.wolfVariant++;
    const cue = animalCue(kind, state, variant);
    cue.sounds.forEach((id, i) => {
      // A wolf's howl carries farther than a deer's snort, so it keeps more of its level.
      const level = kind === 'wolf' ? 1.1 : 0.9;
      this.one(id, gain * level, 'sfx', at, false, cue.delayS[i] ?? 0);
    });
    if (cue.caption) {
      this.captions?.push(
        { key: `animal.${kind}`, text: cue.caption, at: { x: at.x, z: at.z } },
        this.nowS,
        0,
        2,
      );
    }
    this.levels.last = cue.sounds[0] ?? '';
  }

  /** Stop the beds. */
  stop(): void {
    this.frame = undefined;
    this.inCave = undefined;
    for (const id of [...this.beds.keys()]) this.dispose(id);
    this.levels.birds = this.levels.creek = this.levels.surf = this.levels.cave = 0;
  }

  private one(
    id: string,
    gain: number,
    bus: BusId,
    at: AudioPoint | undefined,
    lowpass = false,
    delay = 0,
  ): void {
    const buffer = this.bank.get(id);
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain,
      priority: PRIORITY.sfx,
      ...(delay > 0 ? { delay } : {}),
      ...(at ? { at } : {}),
      ...(lowpass ? { lowpassHz: 1800 } : {}),
    });
  }

  private bed(id: BedId, sound: string, want: number, dt: number): void {
    const ctx = this.mixer.ctx;
    if (typeof ctx.createBufferSource !== 'function') return;
    let bed = this.beds.get(id);
    if (!bed) {
      if (want <= 0.001 || !sound) return;
      const buffer = this.bank.get(sound);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.mixer.buses[BED_BUS[id]]);
      source.start(ctx.currentTime, this.random() * buffer.duration);
      bed = { source, gain, silentS: 0 };
      this.beds.set(id, bed);
    }
    bed.gain.gain.setTargetAtTime(want * BED_LEVEL[id], ctx.currentTime, BED_TAU_S);
    bed.silentS = want <= 0.001 ? bed.silentS + dt : 0;
    if (bed.silentS > BED_IDLE_S) this.dispose(id);
  }

  private dispose(id: BedId): void {
    const bed = this.beds.get(id);
    if (!bed) return;
    bed.source.stop();
    bed.source.disconnect();
    bed.gain.disconnect();
    this.beds.delete(id);
  }
}
