import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import { FOOT_SOUND } from './foot-audio';
import { PRIORITY, setPosition, type AudioMixer, type AudioPoint } from './mixer';
import { PORT_SOUND } from './port-audio';
import {
  SLOSH_EVERY_M,
  agroundHeard,
  clockworkLevel,
  groundingGain,
  pokerCues,
  saloonNight,
  snoreLevel,
  stationCues,
  type Cue,
  type SandboxCueId,
} from './sandbox-mix';
import type { BusId } from './settings';
import type { StationCue, StationSoundView } from '../gameplay/onfoot/station-watch';
import type { PokerBeat } from '../sim/poker/table';

/**
 * Stage 1's sounds (Phase 9 piece J; plan 11 §18.4 row J, plan 15 §4, §11 Phase 9):
 *
 * - **The saloon by night:** "The Late Boat Waltz" on the piano and a fiddle replaces the
 *   polka from supper till the small hours (`FootSounds` plays it ashore), and at a port
 *   screen the saloon's room and its tune play while its tab or the card table is open.
 * - **The card table:** each move's beats (`PokerBeats`) as cards and chips, in order.
 * - **A lighthouse station on foot:** the lamp's clockwork turning while it burns at night
 *   (full on the gallery, a dull tick from the ground), a keeper asleep heard at the house,
 *   the lamp put out or lit, the stair, kerosene from the oil house sloshing as you carry it,
 *   a keeper's greeting, the rope, the tin box and the log.
 * - **The harbor master:** his desk bell as his tab opens, a letter opened and an answer
 *   sealed.
 * - **A copycat rival:** a stinger for piece E to raise (`RivalStinger`).
 * - **A ship aground:** a misled ship striking a wrecking mark's shoal, heard and captioned
 *   from up to 3 km off, and your own ship touching bottom.
 */

export const SANDBOX_AUDIO_BUNDLE = 'sandbox-audio';

export const SANDBOX_SOUND = {
  nightTune: 'music.saloon.night',
  shuffle: 'sfx.poker.shuffle',
  deal: ['sfx.poker.deal-1', 'sfx.poker.deal-2'],
  chips: ['sfx.poker.chips-1', 'sfx.poker.chips-2'],
  rake: 'sfx.poker.rake',
  knock: 'sfx.poker.knock',
  fold: 'sfx.poker.fold',
  show: 'sfx.poker.show',
  clockwork: 'amb.station.clockwork',
  wind: 'sfx.station.wind',
  douse: 'sfx.station.douse',
  light: 'sfx.station.light',
  oil: 'sfx.station.oil-can',
  slosh: 'sfx.station.slosh',
  stair: 'sfx.station.stair',
  snore: 'voice.station.snore',
  greeting: 'voice.station.greeting',
  harborBell: 'ui.harbor.bell',
  letterOpen: 'ui.letter.open',
  letterSeal: 'ui.letter.seal',
  rival: 'music.stinger.rival',
  aground: 'sfx.ship.aground',
  agroundCrew: 'voice.ship.aground-crew',
} as const;

const CUE_SOUND: Record<SandboxCueId, { id: string | readonly string[]; bus: BusId }> = {
  shuffle: { id: SANDBOX_SOUND.shuffle, bus: 'sfx' },
  deal: { id: SANDBOX_SOUND.deal, bus: 'sfx' },
  chips: { id: SANDBOX_SOUND.chips, bus: 'sfx' },
  rake: { id: SANDBOX_SOUND.rake, bus: 'sfx' },
  knock: { id: SANDBOX_SOUND.knock, bus: 'sfx' },
  fold: { id: SANDBOX_SOUND.fold, bus: 'sfx' },
  show: { id: SANDBOX_SOUND.show, bus: 'sfx' },
  wind: { id: SANDBOX_SOUND.wind, bus: 'sfx' },
  douse: { id: SANDBOX_SOUND.douse, bus: 'sfx' },
  light: { id: SANDBOX_SOUND.light, bus: 'sfx' },
  oil: { id: SANDBOX_SOUND.oil, bus: 'sfx' },
  slosh: { id: SANDBOX_SOUND.slosh, bus: 'sfx' },
  stair: { id: SANDBOX_SOUND.stair, bus: 'sfx' },
  greeting: { id: SANDBOX_SOUND.greeting, bus: 'voice' },
  rope: { id: FOOT_SOUND.rope, bus: 'sfx' },
  cashbox: { id: PORT_SOUND.coins, bus: 'sfx' },
  paper: { id: PORT_SOUND.open, bus: 'ui' },
  crateDown: { id: FOOT_SOUND.crateDown, bus: 'sfx' },
};

type BedId = 'clockwork' | 'snore' | 'room' | 'tune';

const BEDS: Record<BedId, { bus: BusId; level: number }> = {
  // Encoded as beds (RMS −24 dB), so brought up where they need to sit.
  clockwork: { bus: 'ambience', level: 1.4 },
  snore: { bus: 'ambience', level: 1.2 },
  room: { bus: 'ambience', level: 0.8 },
  tune: { bus: 'music', level: 1.3 },
};

const BED_TAU_S = 0.5;
const BED_IDLE_S = 3;
/** A stinger comes no closer than this to the last one, seconds. */
export const RIVAL_GAP_S = 20;

interface Bed {
  sound: string;
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  panner: PannerNode | undefined;
  silentS: number;
}

/** What stage 1's sounds read each frame. */
export interface SandboxFrame {
  nowS: number;
  /** Where your ears are, zone meters. */
  listener: AudioPoint | undefined;
  /** Where you stand on foot, zone meters (undefined afloat). */
  player: AudioPoint | undefined;
  /** A lighthouse station you're walking (undefined elsewhere). */
  station: StationSoundView | undefined;
  /** The hour of the day, 0–23. */
  hour: number;
  /** On foot (the district's saloon has its own beds then). */
  ashore: boolean;
  /** Fog's damping now, 0–1. */
  damping: number;
}

export class SandboxSounds {
  captions: CaptionFeed | undefined;
  /** The latest readout, for the dev panel and the tests. */
  readonly levels = {
    last: '',
    cues: 0,
    beds: { clockwork: 0, snore: 0, room: 0, tune: 0 } as Record<BedId, number>,
    tune: '',
    stingers: 0,
    aground: 0,
  };
  private readonly beds = new Map<BedId, Bed>();
  private frame: SandboxFrame | undefined;
  /** The port screen's tab, while it's open. */
  private tab: string | undefined;
  private sloshFrom: AudioPoint | undefined;
  private rivalAtS = -Infinity;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  // --- The card table --------------------------------------------------------------------

  /** A move at the card table: what was done, heard in order. */
  poker(beats: readonly PokerBeat[]): void {
    this.cues(pokerCues(beats, this.random));
  }

  /** A palmed card seen: the chair going over and the chips scattering. */
  pokerCaught(how: 'licking' | 'swing'): void {
    this.cues([
      { id: 'chips', delay: 0, gain: 0.8, rate: 0.85 },
      { id: 'chips', delay: 0.08, gain: 0.7, rate: 1.1 },
    ]);
    this.sound(FOOT_SOUND.cosh, 'sfx', how === 'swing' ? 0.8 : 0.6, 1, 0.35);
  }

  // --- The port screen -------------------------------------------------------------------

  /** The port screen's tab now (undefined: closed), and whether it's the harbor master's. */
  portTab(tab: string | undefined, audible = true): void {
    if (tab === this.tab) return;
    this.tab = tab;
    if (tab === 'harbor' && audible) this.sound(SANDBOX_SOUND.harborBell, 'ui', 0.45, 1, 0.1);
  }

  /** A letter at the harbor master's opened for the first time. */
  letterRead(): void {
    this.sound(SANDBOX_SOUND.letterOpen, 'ui', 0.6);
  }

  /** An answer given: the pen, then folded and sealed for the mail. */
  letterAnswered(): void {
    this.sound(PORT_SOUND.pen, 'ui', 0.45);
    this.sound(SANDBOX_SOUND.letterSeal, 'ui', 0.6, 1, 0.7);
  }

  // --- A rival and a ship aground --------------------------------------------------------

  /** A copycat rival heard of, sighted, met or beaten: his stinger, not too often. */
  rival(why: 'news' | 'sighted' | 'parley' | 'beaten' = 'sighted'): boolean {
    const now = this.frame?.nowS ?? 0;
    if (now - this.rivalAtS < RIVAL_GAP_S) return false;
    this.rivalAtS = now;
    this.levels.stingers++;
    // News is a softer echo; beaten, a touch lower and slower, the swagger gone.
    const gain = why === 'news' ? 0.55 : 0.85;
    const rate = why === 'beaten' ? 0.89 : 1;
    this.sound(SANDBOX_SOUND.rival, 'music', gain, rate);
    return true;
  }

  /** A ship put on a shoal at `at` (zone meters), heard from where you are. */
  stranded(e: { name: string; x: number; z: number; broken: boolean }): void {
    const f = this.frame;
    const ears = f?.listener;
    if (!f || !ears) return;
    const h = agroundHeard(Math.hypot(e.x - ears.x, e.z - ears.z), f.damping);
    if (!h) return;
    const at = { x: e.x, y: 2, z: e.z };
    this.levels.aground++;
    this.place(SANDBOX_SOUND.aground, 'sfx', h.gain, h.lowpassHz, at, e.broken ? 0.85 : 1);
    this.place(SANDBOX_SOUND.agroundCrew, 'voice', h.gain * 0.8, h.lowpassHz, at, 1, 0.6);
    this.captions?.push(
      { key: 'sandbox.aground', text: `A ship aground${e.broken ? ', breaking up' : ''}`, at },
      f.nowS,
      0,
      4,
    );
  }

  /** Your own ship touching bottom. */
  grounded(speedKn: number, hard: boolean): void {
    this.levels.aground++;
    this.sound(SANDBOX_SOUND.aground, 'sfx', groundingGain(speedKn, hard), hard ? 0.95 : 1.15);
  }

  // --- The lighthouse station ------------------------------------------------------------

  /** Something done at the station. */
  station(cue: StationCue): void {
    this.cues(stationCues(cue));
  }

  /** Each frame: the station's beds, the can's slosh, and the port screen's saloon. */
  update(f: SandboxFrame, dt: number): void {
    this.frame = f;
    const st = f.station;
    let clock = { gain: 0, lowpassHz: 800 };
    let snore = { gain: 0, lowpassHz: 1200 };
    let lampAt: AudioPoint | undefined;
    let houseAt: AudioPoint | undefined;
    if (st && f.player) {
      const p = f.player;
      const d = Math.hypot(st.lamp.dx, st.lamp.dy, st.lamp.dz);
      clock = clockworkLevel(d, st.aloft, st.turning);
      snore = snoreLevel(Math.hypot(st.house.dx, st.house.dz), st.sleepers);
      lampAt = { x: p.x + st.lamp.dx, y: p.y + st.lamp.dy, z: p.z + st.lamp.dz };
      houseAt = { x: p.x + st.house.dx, y: p.y + st.house.dy + 1, z: p.z + st.house.dz };
      // The can sloshes every stride or so.
      if (st.carrying) {
        const from = (this.sloshFrom ??= { ...p });
        if (Math.hypot(p.x - from.x, p.z - from.z) >= SLOSH_EVERY_M) {
          this.sloshFrom = { ...p };
          this.cues([{ id: 'slosh', delay: 0, gain: 0.35, rate: 0.9 + 0.2 * this.random() }]);
        }
      } else {
        this.sloshFrom = undefined;
      }
    } else {
      this.sloshFrom = undefined;
    }
    this.bed('clockwork', SANDBOX_SOUND.clockwork, clock.gain, clock.lowpassHz, lampAt, dt);
    this.bed('snore', SANDBOX_SOUND.snore, snore.gain, snore.lowpassHz, houseAt, dt);
    // At a port screen's saloon or card table (not ashore, where the room has its own beds).
    const saloon = !f.ashore && (this.tab === 'saloon' || this.tab === 'cards');
    const night = saloonNight(f.hour);
    const tune = night ? SANDBOX_SOUND.nightTune : FOOT_SOUND.tune;
    this.levels.tune = saloon ? tune : '';
    this.bed('room', FOOT_SOUND.room, saloon ? 0.7 : 0, 12000, undefined, dt);
    this.bed('tune', tune, saloon ? 0.55 : 0, 9000, undefined, dt);
  }

  /** Off the station and away from the screen: everything stops. */
  stop(): void {
    for (const id of [...this.beds.keys()]) this.dispose(id);
    for (const k of Object.keys(this.levels.beds) as BedId[]) this.levels.beds[k] = 0;
    this.sloshFrom = undefined;
  }

  /** The dev panel: one of the sounds, once. */
  audition(id: string): void {
    const bus: BusId = id.startsWith('ui.')
      ? 'ui'
      : id.startsWith('music.')
        ? 'music'
        : id.startsWith('voice.')
          ? 'voice'
          : id.startsWith('amb.')
            ? 'ambience'
            : 'sfx';
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
    this.levels.last = id;
    const buffer = this.bank.get(id);
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

  private place(
    id: string,
    bus: BusId,
    gain: number,
    lowpassHz: number,
    at: AudioPoint,
    rate = 1,
    delay = 0,
  ): void {
    this.levels.last = id;
    const buffer = this.bank.get(id);
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain,
      lowpassHz,
      at,
      ...(rate !== 1 ? { rate } : {}),
      ...(delay > 0 ? { delay } : {}),
      priority: PRIORITY.critical,
    });
  }

  private bed(
    id: BedId,
    sound: string,
    want: number,
    lowpassHz: number,
    at: AudioPoint | undefined,
    dt: number,
  ): void {
    const def = BEDS[id];
    const ctx = this.mixer.ctx;
    this.levels.beds[id] = want;
    if (typeof ctx.createBufferSource !== 'function') return;
    let bed = this.beds.get(id);
    // The tune changed (the evening came on): the old one gives way at once.
    if (bed && bed.sound !== sound) {
      this.dispose(id);
      bed = undefined;
    }
    if (!bed) {
      if (want <= 0.001) return;
      const buffer = this.bank.get(sound);
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
      if (at && typeof ctx.createPanner === 'function') {
        panner = ctx.createPanner();
        panner.panningModel = 'equalpower';
        panner.distanceModel = 'linear';
        panner.rolloffFactor = 0;
        source.connect(filter).connect(gain).connect(panner).connect(this.mixer.buses[def.bus]);
      } else {
        source.connect(filter).connect(gain).connect(this.mixer.buses[def.bus]);
      }
      // The tune from the top; the others from anywhere.
      source.start(ctx.currentTime, id === 'tune' ? 0 : this.random() * buffer.duration);
      bed = { sound, source, filter, gain, panner, silentS: 0 };
      this.beds.set(id, bed);
    }
    if (at && bed.panner) setPosition(bed.panner, at);
    const now = ctx.currentTime;
    bed.gain.gain.setTargetAtTime(want * def.level, now, BED_TAU_S);
    bed.filter.frequency.setTargetAtTime(lowpassHz, now, BED_TAU_S);
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
    bed.panner?.disconnect();
    this.beds.delete(id);
  }
}
