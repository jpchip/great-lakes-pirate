import type { SoundBank } from './bank';
import {
  CHIME_GAP_S,
  craftCues,
  mainFamily,
  placeCue,
  stationSound,
  stillLevel,
  workVignette,
  type Cue,
  type HideoutCueId,
} from './hideout-mix';
import { PRIORITY, setPosition, type AudioMixer, type AudioPoint } from './mixer';
import { FOOT_SOUND } from './foot-audio';
import { PORT_SOUND } from './port-audio';
import type { BusId } from './settings';

/**
 * Building and crafting at a hideout, heard (Phase 8 piece I; plan 09 §16.4 row I, plan 15
 * §4.6, §11 Phase 8): build mode opens and closes with the logbook's paper and turns a page
 * for each category; a piece placed knocks (lower for stone), one refused thuds; a piece
 * taken down is pried off and clatters; Build plays the yard at work for a few seconds with
 * a saw, a hammer or a stone set for each kind of piece put up. A craft plays its station:
 * the forge and anvil, the cooper's hoops, the still loaded, or the workbench's saw, plane
 * and hammer. Ashore, a still with a batch running simmers and drips where it stands.
 *
 * The rest of the UI set is here too (`UiCues`): the stamp on a contract taken, a paper
 * shaken open, the telegraph for price news, and two small bells for things done.
 */

export const HIDEOUT_AUDIO_BUNDLE = 'hideout-audio';
export const UI_AUDIO_BUNDLE = 'ui-audio';

export const HIDEOUT_SOUND = {
  saw: 'sfx.build.saw',
  hammer: ['sfx.build.hammer-1', 'sfx.build.hammer-2'],
  stone: 'sfx.build.stone',
  plane: 'sfx.build.plane',
  pry: 'sfx.build.pry',
  work: 'amb.build.work',
  forge: 'sfx.craft.forge',
  cooperage: 'sfx.craft.cooperage',
  stillLoad: 'sfx.craft.still-load',
  still: 'amb.craft.still',
  place: 'ui.build.place',
  refused: 'ui.build.refused',
} as const;

export const UI_SOUND = {
  stamp: 'ui.stamp',
  newspaper: 'ui.newspaper',
  telegraph: 'ui.telegraph',
  page: 'ui.page',
  chimeSoft: 'ui.chime.soft',
  chimeBright: 'ui.chime.bright',
} as const;

/** Each cue's sound and bus. */
const CUE_SOUND: Record<HideoutCueId, { id: string | readonly string[]; bus: BusId }> = {
  saw: { id: HIDEOUT_SOUND.saw, bus: 'sfx' },
  hammer: { id: HIDEOUT_SOUND.hammer, bus: 'sfx' },
  stone: { id: HIDEOUT_SOUND.stone, bus: 'sfx' },
  plane: { id: HIDEOUT_SOUND.plane, bus: 'sfx' },
  pry: { id: HIDEOUT_SOUND.pry, bus: 'sfx' },
  forge: { id: HIDEOUT_SOUND.forge, bus: 'sfx' },
  cooperage: { id: HIDEOUT_SOUND.cooperage, bus: 'sfx' },
  stillLoad: { id: HIDEOUT_SOUND.stillLoad, bus: 'sfx' },
  place: { id: HIDEOUT_SOUND.place, bus: 'ui' },
  refused: { id: HIDEOUT_SOUND.refused, bus: 'ui' },
};

/** The yard's bed sits under the beats; encoded as a bed (RMS −24 dB), so brought up. */
const WORK_BED_LEVEL = 1.6;
/** The still's bed level at full (beside it). */
const STILL_BED_LEVEL = 1.2;
const BED_TAU_S = 0.4;
const STILL_IDLE_S = 3;

interface StillBed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode | undefined;
  silentS: number;
}

export class HideoutSounds {
  /** The latest readout, for the dev panel and the tests. */
  readonly levels = { last: '', cues: 0, still: 0, workBedS: 0 };
  private still: StillBed | undefined;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  // --- Build mode ------------------------------------------------------------------------

  /** Build mode opened or closed: the logbook's paper. */
  opened(): void {
    this.sound(PORT_SOUND.open, 'ui', 0.55);
  }

  closed(): void {
    this.sound(PORT_SOUND.close, 'ui', 0.5);
  }

  /** A category of the palette picked: a page turned. */
  page(): void {
    this.sound(UI_SOUND.page, 'ui', 0.45, 0.95 + 0.1 * this.random());
  }

  /** Pieces laid out in the plan, by material. */
  placed(materials: readonly string[]): void {
    this.cues([placeCue(mainFamily(materials))]);
  }

  /** A placement, a removal or a Build that couldn't be done. */
  refused(): void {
    this.cues([{ id: 'refused', delay: 0, gain: 0.7, rate: 1 }]);
  }

  /**
   * A piece and what stood on it taken off the site: built ones pried down, a plan only
   * cleared with a knock.
   */
  removed(materials: readonly string[], built: boolean): void {
    if (!built) {
      this.cues([{ ...placeCue(mainFamily(materials)), gain: 0.4, rate: 0.7 }]);
      return;
    }
    const rate = mainFamily(materials) === 'stone' ? 0.8 : 0.95 + 0.1 * this.random();
    this.cues([{ id: 'pry', delay: 0, gain: 0.8, rate }]);
  }

  /** Undo or redo: a softer knock. */
  undone(): void {
    this.cues([{ id: 'place', delay: 0, gain: 0.35, rate: 0.9 }]);
  }

  /** Build pressed: the pieces put up and the game seconds the work took. */
  built(materials: readonly string[], seconds: number): void {
    const v = workVignette(materials, seconds, this.random);
    this.levels.workBedS = v.bedS;
    const bed = this.bank.get(HIDEOUT_SOUND.work);
    if (bed) {
      const length = Math.min(bed.duration, v.bedS);
      this.mixer.play({
        buffer: bed,
        bus: 'ambience',
        gain: WORK_BED_LEVEL,
        offset: this.random() * Math.max(0, bed.duration - length),
        duration: length,
        fadeOutS: 0.9,
        priority: PRIORITY.sfx,
      });
    }
    this.cues(v.cues);
  }

  // --- Crafting --------------------------------------------------------------------------

  /** A craft done (or the still loaded) at a station, after `seconds` of work. */
  crafted(stationId: string | undefined, seconds: number): void {
    this.cues(craftCues(stationSound(stationId), seconds, this.random));
  }

  /**
   * A load of salvage set down in the stores or the hold (piece F): dressed stone set
   * down heavily, lumber as a crate does.
   */
  salvage(good: string): void {
    if (good === 'good.brownstone') {
      this.sound(HIDEOUT_SOUND.stone, 'sfx', 0.6, 0.85);
    } else {
      this.sound(FOOT_SOUND.crateDown, 'sfx', 0.6, 0.9 + 0.1 * this.random());
    }
  }

  // --- Ashore ----------------------------------------------------------------------------

  /**
   * Each frame ashore: the nearest still with a batch running simmers where it stands.
   * `stills` empty (or off your feet) lets it die away.
   */
  update(listener: AudioPoint | undefined, stills: readonly AudioPoint[], dt: number): void {
    let near: AudioPoint | undefined;
    let best = Infinity;
    if (listener) {
      for (const s of stills) {
        const d = Math.hypot(s.x - listener.x, s.y - listener.y, s.z - listener.z);
        if (d < best) {
          best = d;
          near = s;
        }
      }
    }
    const level = near ? stillLevel(best) : { gain: 0, lowpassHz: 800 };
    this.levels.still = level.gain;
    this.stillBed(level.gain, level.lowpassHz, near, dt);
  }

  /** Off your feet: the still stops at once. */
  stop(): void {
    this.levels.still = 0;
    this.disposeStill();
  }

  /** The dev panel: one of the sounds, once. */
  audition(id: string): void {
    const bus: BusId = id.startsWith('ui.') ? 'ui' : id.startsWith('amb.') ? 'ambience' : 'sfx';
    this.sound(id, bus, 0.8);
  }

  // ---------------------------------------------------------------------------------------

  private cues(cues: readonly Cue[]): void {
    for (const c of cues) {
      const def = CUE_SOUND[c.id];
      const id =
        typeof def.id === 'string'
          ? def.id
          : (def.id[Math.floor(this.random() * def.id.length)] ?? def.id[0]);
      if (!id) continue;
      this.levels.cues++;
      this.sound(id, def.bus, c.gain, c.rate, c.delay);
    }
  }

  private sound(id: string, bus: BusId, gain: number, rate = 1, delay = 0): void {
    const buffer = this.bank.get(id);
    this.levels.last = id;
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain,
      ...(rate !== 1 ? { rate } : {}),
      ...(delay > 0 ? { delay } : {}),
      priority: PRIORITY.sfx,
    });
  }

  private stillBed(want: number, lowpassHz: number, at: AudioPoint | undefined, dt: number): void {
    const ctx = this.mixer.ctx;
    if (typeof ctx.createBufferSource !== 'function') return;
    let bed = this.still;
    if (!bed) {
      if (want <= 0.001) return;
      const buffer = this.bank.get(HIDEOUT_SOUND.still);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = lowpassHz;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let panner: PannerNode | undefined;
      if (typeof ctx.createPanner === 'function') {
        panner = ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'linear';
        panner.rolloffFactor = 0;
        source.connect(filter).connect(gain).connect(panner).connect(this.mixer.buses.ambience);
      } else {
        source.connect(filter).connect(gain).connect(this.mixer.buses.ambience);
      }
      source.start(ctx.currentTime, this.random() * buffer.duration);
      bed = { source, filter, gain, panner, silentS: 0 };
      this.still = bed;
    }
    if (at && bed.panner) setPosition(bed.panner, at);
    const now = ctx.currentTime;
    bed.gain.gain.setTargetAtTime(want * STILL_BED_LEVEL, now, BED_TAU_S);
    bed.filter.frequency.setTargetAtTime(lowpassHz, now, BED_TAU_S);
    bed.silentS = want <= 0.001 ? bed.silentS + dt : 0;
    if (bed.silentS > STILL_IDLE_S) this.disposeStill();
  }

  private disposeStill(): void {
    const bed = this.still;
    if (!bed) return;
    bed.source.stop();
    bed.source.disconnect();
    bed.filter.disconnect();
    bed.gain.disconnect();
    bed.panner?.disconnect();
    this.still = undefined;
  }
}

/** Which UI cue an event plays. */
export type UiCue = 'stamp' | 'newspaper' | 'telegraph' | 'chimeSoft' | 'chimeBright';

/**
 * The rest of plan 15 §4.6's UI set, on the UI bus and not placed: a contract taken is
 * stamped, a paper bought is shaken open, price news comes over the telegraph, and two
 * small bells: a soft one when something's done on its own (a still's batch), a brighter
 * one for something earned (an Ambition, a contract delivered). Bells come no closer than
 * `CHIME_GAP_S`, so a night of batches rings once.
 */
export class UiCues {
  last = '';
  private chimedAt = -Infinity;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly now: () => number,
  ) {}

  play(cue: UiCue): void {
    if (cue === 'chimeSoft' || cue === 'chimeBright') {
      const t = this.now();
      if (t - this.chimedAt < CHIME_GAP_S) return;
      this.chimedAt = t;
    }
    const gain = { stamp: 0.75, newspaper: 0.6, telegraph: 0.5, chimeSoft: 0.4, chimeBright: 0.5 }[
      cue
    ];
    this.last = cue;
    const buffer = this.bank.get(UI_SOUND[cue]);
    if (buffer) this.mixer.play({ buffer, bus: 'ui', gain, priority: PRIORITY.sfx });
  }
}
