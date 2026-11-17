import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import {
  SPOTTED_GAP_S,
  VOICE_REACH_M,
  WHISTLE_REACH_M,
  barkFor,
  heardAt,
  landGain,
  placeMix,
  shiverEveryS,
  stepSound,
  tension01,
  tensionGain,
  voiceRate,
  type BarkId,
  type GuardHeard,
  type PlaceMix,
} from './foot-mix';
import { LAW_SOUND } from './law-audio';
import { PRIORITY, type AudioMixer, type AudioPoint } from './mixer';
import { PORT_SOUND } from './port-audio';
import { SOUND } from './sailing-audio';
import type { BusId } from './settings';
import type { Gait } from '../gameplay/onfoot/controller';
import type { HeistEvent } from '../gameplay/onfoot/heist';
import type { JailbreakEvent } from '../gameplay/onfoot/jailbreak';
import type { Surface } from '../gameplay/onfoot/noise';
import type { GuardState, StealthEvent } from '../gameplay/onfoot/stealth';
import type { ToolEvent } from '../gameplay/onfoot/tools';

/**
 * The captain ashore, heard (Phase 7 piece I; plan 08 §20.4 row I, plan 15 §4.5, §6.1,
 * §11 Phase 7): footsteps by what's underfoot and how you move, as loud as the guards hear
 * them; a landing, the lake closing over you, strokes and a shivering breath; the
 * burglar's kit at work; the watch's voices and whistle, placed where the man stands and
 * captioned; the stealth layer rising with their suspicion and a stinger when you're seen;
 * and the beds of the place: the docks at night, the saloon from the street and from
 * inside, the island's woods, crickets on a summer night. `foot-mix.ts` has the rules.
 */

export const FOOT_AUDIO_BUNDLE = 'foot-audio';

export const FOOT_SOUND = {
  land: 'sfx.foot.land',
  splash: 'sfx.foot.swim-splash',
  stroke: ['sfx.foot.swim-stroke-1', 'sfx.foot.swim-stroke-2'],
  shiver: 'voice.foot.shiver',
  lockPick: 'sfx.foot.lock-pick',
  lockClick: 'sfx.foot.lock-click',
  lockOpen: 'sfx.foot.lock-open',
  pickSnap: 'sfx.foot.pick-snap',
  crowbar: 'sfx.foot.crowbar',
  door: 'sfx.foot.door',
  crateLift: 'sfx.foot.crate-lift',
  crateDown: 'sfx.foot.crate-down',
  rope: 'sfx.foot.rope',
  cosh: 'sfx.foot.cosh',
  knife: 'sfx.foot.knife',
  bottle: 'sfx.foot.bottle',
  stone: 'sfx.foot.stone',
  keys: 'sfx.foot.keys',
  bars: 'sfx.foot.bars',
  bark: {
    hm: 'voice.foot.bark-hm',
    who: 'voice.foot.bark-who',
    hey: 'voice.foot.bark-hey',
    mutter: 'voice.foot.bark-mutter',
    giveup: 'voice.foot.bark-giveup',
  } satisfies Record<BarkId, string>,
  whistle: 'sfx.foot.whistle',
  tension: 'music.foot.tension',
  spotted: 'music.stinger.spotted',
  docks: 'amb.foot.docks-night',
  room: 'amb.foot.saloon-room',
  tune: 'music.foot.saloon',
  forest: 'amb.foot.forest',
  crickets: 'amb.foot.crickets',
} as const;

/** A guard as the sounds need him, zone meters. */
export interface FootGuard {
  id: string;
  name: string;
  type: string;
  state: GuardState;
  meter: number;
  x: number;
  y: number;
  z: number;
}

/** What the sounds ashore read each frame. */
export interface FootFrame {
  listener: AudioPoint;
  nowS: number;
  /** Where you stand, zone meters. */
  player: AudioPoint;
  swimming: boolean;
  waterC: number;
  guards: readonly FootGuard[];
  place: 'district' | 'island' | 'shore';
  /** Under a roof. */
  inside: boolean;
  sunElevationDeg: number;
  month0: number;
  windKn: number;
  rain01: number;
  /** The saloon's door, zone meters; open at this hour; you inside it. */
  saloon: { x: number; z: number; open: boolean; within: boolean } | undefined;
  /** F held on a lock with a pick: how far it's got, 0–1. Undefined otherwise. */
  picking: number | undefined;
  /** Stills with a batch running in the zone, zone meters (Phase 8 piece I). */
  stills?: readonly AudioPoint[];
}

type BedId = 'docks' | 'forest' | 'crickets' | 'room' | 'tune' | 'tension';

interface Bed {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  silentS: number;
}

const BEDS: Record<BedId, { sound: string; bus: BusId; level: number }> = {
  docks: { sound: FOOT_SOUND.docks, bus: 'ambience', level: 1 },
  forest: { sound: FOOT_SOUND.forest, bus: 'ambience', level: 1 },
  crickets: { sound: FOOT_SOUND.crickets, bus: 'ambience', level: 0.5 },
  room: { sound: FOOT_SOUND.room, bus: 'ambience', level: 1 },
  // Encoded as beds (RMS −24 dB), so brought up to sit where music does.
  tune: { sound: FOOT_SOUND.tune, bus: 'music', level: 1.8 },
  tension: { sound: FOOT_SOUND.tension, bus: 'music', level: 2 },
};

const BED_TAU_S = 0.6;
const BED_IDLE_S = 4;
/** Overall level of the player's own footsteps against everything else. */
const STEP_GAIN = 0.55;
/** The pick's scrapes come about this often while it works, per second. */
const PICK_PER_S = 1.6;

export class FootSounds {
  captions: CaptionFeed | undefined;
  /** The latest readout, for the dev panel and the tests. */
  readonly levels = {
    steps: 0,
    lastStep: '',
    last: '',
    tension: 0,
    beds: { docks: 0, forest: 0, crickets: 0, room: 0, tune: 0, tension: 0 } as Record<
      BedId,
      number
    >,
    barks: 0,
  };
  private readonly beds = new Map<BedId, Bed>();
  private frame: FootFrame | undefined;
  private active = false;
  private wasSwimming = false;
  private strokeS = 0;
  private shiverS = 2;
  private pickS = 0;
  private lastPick = 0;
  private spottedAtS = -Infinity;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
    private readonly random: () => number = Math.random,
  ) {}

  /** Ashore or not: leaving your feet stops the beds. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!active) {
      this.frame = undefined;
      this.wasSwimming = false;
      for (const id of [...this.beds.keys()]) this.dispose(id);
      for (const k of Object.keys(this.levels.beds) as BedId[]) this.levels.beds[k] = 0;
      this.levels.tension = 0;
    }
  }

  // -------------------------------------------------------------------------------------
  // The body

  /** A stride: the surface, the gait and the radius the guards hear it at. */
  step(surface: Surface | 'water', gait: Gait, radiusM: number): void {
    if (gait === 'swim') {
      this.stroke();
      return;
    }
    const s = stepSound(surface, gait, radiusM, this.random());
    if (!s) return;
    this.levels.steps++;
    this.levels.lastStep = `${s.id} ${s.gain.toFixed(2)}`;
    this.play(s.id, 'sfx', s.gain * STEP_GAIN, {
      rate: s.rate,
      lowpassHz: s.lowpassHz,
      priority: PRIORITY.detail,
    });
  }

  /** You came down at `speed` m/s, on the ground or into the lake. */
  landed(speed: number, inWater: boolean): void {
    if (inWater) {
      this.splash(0.5 + 0.5 * Math.min(1, speed / 8));
      return;
    }
    const gain = landGain(speed);
    if (gain > 0) this.cue(FOOT_SOUND.land, gain, { rate: 0.95 + 0.1 * this.random() });
  }

  private splash(gain: number): void {
    this.cue(FOOT_SOUND.splash, gain);
    this.caption('foot.splash', 'A splash', this.frame?.player);
  }

  private stroke(): void {
    const id = FOOT_SOUND.stroke[Math.floor(this.random() * FOOT_SOUND.stroke.length)] as string;
    this.play(id, 'sfx', 0.45, { rate: 0.92 + 0.16 * this.random(), priority: PRIORITY.detail });
    this.levels.last = id;
  }

  // -------------------------------------------------------------------------------------
  // The watch

  stealth(e: StealthEvent): void {
    switch (e.type) {
      case 'NpcStateChanged': {
        const g = this.guard(e.npc);
        if (!g) return;
        const b = barkFor(e.from, e.to, g.name);
        if (b) this.bark(g, b.bark, b.caption);
        return;
      }
      case 'NoiseMade': {
        const n = e.noise;
        if (n.source === 'player') return;
        const g = this.guard(n.source);
        if (!g) return;
        if (n.kind === 'whistle') this.whistle(g);
        return;
      }
      case 'PlayerSpotted': {
        const now = this.frame?.nowS ?? 0;
        if (now - this.spottedAtS < SPOTTED_GAP_S) return;
        this.spottedAtS = now;
        this.play(FOOT_SOUND.spotted, 'music', 0.9, { priority: PRIORITY.critical });
        this.levels.last = FOOT_SOUND.spotted;
        return;
      }
      case 'BodyFound': {
        const g = this.guard(e.finder);
        if (g) this.bark(g, 'hey', `${g.name} has found ${e.dead ? 'a body' : 'a man down'}`);
        return;
      }
      default:
        return;
    }
  }

  private bark(g: FootGuard, bark: BarkId, caption: string): void {
    const f = this.frame;
    if (!f) return;
    const d = Math.hypot(g.x - f.player.x, g.z - f.player.z);
    const h = heardAt(d, VOICE_REACH_M[bark]);
    if (!h) return;
    this.levels.barks++;
    this.levels.last = `${FOOT_SOUND.bark[bark]} (${g.id})`;
    this.play(FOOT_SOUND.bark[bark], 'voice', h.gain, {
      rate: voiceRate(g.type, g.id),
      lowpassHz: h.lowpassHz,
      at: { x: g.x, y: g.y + 1.6, z: g.z },
      priority: PRIORITY.critical,
    });
    this.caption(`foot.guard.${g.id}`, caption, g);
  }

  private whistle(g: FootGuard): void {
    const f = this.frame;
    if (!f) return;
    const h = heardAt(Math.hypot(g.x - f.player.x, g.z - f.player.z), WHISTLE_REACH_M);
    if (!h) return;
    this.levels.last = `${FOOT_SOUND.whistle} (${g.id})`;
    this.play(FOOT_SOUND.whistle, 'sfx', 0.9 * h.gain, {
      lowpassHz: h.lowpassHz,
      at: { x: g.x, y: g.y + 1.6, z: g.z },
      delay: 0.5,
      priority: PRIORITY.critical,
    });
    this.caption(`foot.whistle.${g.id}`, 'A police whistle', g, 0.5);
  }

  // -------------------------------------------------------------------------------------
  // The kit

  /** `at`: where a thrown stone came down, zone meters. */
  tool(e: ToolEvent, at?: AudioPoint): void {
    switch (e.type) {
      case 'KnockedOut':
        this.cue(FOOT_SOUND.cosh, 0.8);
        return;
      case 'Killed':
        this.cue(FOOT_SOUND.knife, 0.8);
        return;
      case 'Bound':
        this.cue(FOOT_SOUND.rope, 0.6);
        return;
      case 'BribePaid':
        this.coins(e.cents >= 2000 ? 2 : 1);
        return;
      case 'WhiskeyTaken':
        this.cue(FOOT_SOUND.bottle, 0.6);
        return;
      case 'BodyLifted':
        this.cue(FOOT_SOUND.crateLift, 0.4, { rate: 0.8 });
        return;
      case 'BodyDropped':
        if (e.sunk) this.splash(0.9);
        else this.cue(FOOT_SOUND.land, 0.5, { rate: 0.8 });
        return;
      case 'StoneThrown': {
        const f = this.frame;
        const d = at && f ? Math.hypot(at.x - f.player.x, at.z - f.player.z) : 0;
        const h = heardAt(d, 60) ?? { gain: 0.1, lowpassHz: 1500 };
        // The stone is in the air a moment before it lands.
        this.play(FOOT_SOUND.stone, 'sfx', 0.8 * h.gain, {
          lowpassHz: h.lowpassHz,
          delay: 0.35 + d / 30,
          ...(at ? { at } : {}),
        });
        this.levels.last = FOOT_SOUND.stone;
        if (at) this.caption('foot.stone', 'A stone lands', at, 0.35 + d / 30);
        return;
      }
      case 'Shot':
        // The pistol is the rifle's report pitched up: a smaller charge, a shorter barrel.
        this.cue(LAW_SOUND.rifle, 1, { rate: e.tool === 'tool.pistol' ? 1.35 : 1 });
        return;
      default:
        return;
    }
  }

  heist(e: HeistEvent): void {
    switch (e.type) {
      case 'LockClicked':
        this.cue(FOOT_SOUND.lockClick, 0.7, { rate: 0.95 + 0.1 * this.random() });
        return;
      case 'LockPicked':
        this.cue(FOOT_SOUND.lockOpen, 0.6);
        this.cue(FOOT_SOUND.door, 0.35, { delay: 0.5 });
        return;
      case 'LockForced':
        this.cue(FOOT_SOUND.crowbar, 0.95);
        this.cue(FOOT_SOUND.door, 0.4, { delay: 1.2 });
        return;
      case 'PickBroken':
        this.cue(FOOT_SOUND.pickSnap, 0.7);
        return;
      case 'CrateLifted':
        this.cue(FOOT_SOUND.crateLift, 0.6);
        return;
      case 'CrateStowed':
        this.cue(FOOT_SOUND.crateDown, 0.6);
        return;
      case 'CrateDropped':
        if (e.sunk) this.splash(0.8);
        else this.cue(FOOT_SOUND.crateDown, 0.75);
        return;
      case 'ItemStolen':
        if (e.cashCents) this.coins(e.cashCents >= 5000 ? 3 : 2);
        if (e.documents) this.cue(PORT_SOUND.open, 0.5, { delay: e.cashCents ? 0.4 : 0 }, 'ui');
        return;
      default:
        return;
    }
  }

  jail(e: JailbreakEvent): void {
    switch (e.type) {
      case 'IronsSlipped': {
        const id = SOUND.chain[Math.floor(this.random() * SOUND.chain.length)] as string;
        this.cue(id, 0.5, { rate: 1.3 });
        return;
      }
      case 'KeysLifted':
        this.cue(FOOT_SOUND.keys, 0.35);
        return;
      case 'CellOpened':
        if (e.how === 'pick') this.cue(FOOT_SOUND.lockOpen, 0.6);
        else this.cue(FOOT_SOUND.keys, 0.6);
        this.cue(FOOT_SOUND.door, 0.5, { delay: 0.5, rate: 0.85 });
        return;
      case 'CellLocked':
        this.cue(FOOT_SOUND.door, 0.4, { rate: 0.85 });
        this.cue(FOOT_SOUND.lockClick, 0.7, { delay: 1, rate: 0.7 });
        return;
      case 'BarsBanged':
        this.cue(FOOT_SOUND.bars, 0.9);
        return;
      case 'Promised':
        return;
      default:
        return;
    }
  }

  private coins(handfuls: number): void {
    for (let k = 0; k < handfuls; k++) {
      const id = PORT_SOUND.coins[Math.floor(this.random() * PORT_SOUND.coins.length)] as string;
      this.cue(id, 0.6, { delay: k * 0.22 }, 'ui');
    }
  }

  // -------------------------------------------------------------------------------------
  // Each frame

  update(f: FootFrame, dt: number): void {
    this.frame = f;
    if (!this.active || dt <= 0) return;

    // Into the lake some other way than a fall (off a ladder, wading out).
    if (f.swimming && !this.wasSwimming) this.splash(0.5);
    this.wasSwimming = f.swimming;
    if (f.swimming) {
      const every = shiverEveryS(f.waterC);
      this.shiverS -= dt;
      if (every !== undefined && this.shiverS <= 0) {
        this.shiverS = every * (0.8 + 0.4 * this.random());
        this.play(FOOT_SOUND.shiver, 'voice', 0.5, { priority: PRIORITY.detail });
        this.levels.last = FOOT_SOUND.shiver;
      }
    } else {
      this.shiverS = 2;
    }

    // The pick at work while F is held and the lock isn't open yet.
    if (f.picking !== undefined && f.picking > this.lastPick && f.picking < 1) {
      this.pickS -= dt;
      if (this.pickS <= 0) {
        this.pickS = (0.6 + 0.8 * this.random()) / PICK_PER_S;
        const buffer = this.bank.get(FOOT_SOUND.lockPick);
        if (buffer) {
          const length = 0.35 + 0.3 * this.random();
          this.mixer.play({
            buffer,
            bus: 'sfx',
            gain: 0.4,
            offset: this.random() * Math.max(0, buffer.duration - length),
            duration: length,
            rate: 0.95 + 0.1 * this.random(),
            priority: PRIORITY.detail,
          });
          this.levels.last = FOOT_SOUND.lockPick;
        }
      }
    } else {
      this.pickS = 0;
    }
    this.lastPick = f.picking ?? 0;

    const heard: GuardHeard[] = f.guards.map((g) => ({
      state: g.state,
      meter: g.meter,
      distanceM: Math.hypot(g.x - f.player.x, g.z - f.player.z),
    }));
    const tension = tension01(heard);
    this.levels.tension = tension;

    const saloon = f.saloon && {
      distanceM: Math.hypot(f.saloon.x - f.player.x, f.saloon.z - f.player.z),
      open: f.saloon.open,
      within: f.saloon.within,
    };
    const mix: PlaceMix = placeMix({
      place: f.place,
      inside: f.inside,
      sunElevationDeg: f.sunElevationDeg,
      month0: f.month0,
      windKn: f.windKn,
      rain01: f.rain01,
      saloon,
      swimming: f.swimming,
    });
    this.bed('docks', mix.docks, mix.docksLowpassHz, dt);
    this.bed('forest', mix.forest, f.inside ? 1200 : 12000, dt);
    this.bed('crickets', mix.crickets, f.inside ? 2500 : 12000, dt);
    this.bed('room', mix.room, mix.saloonLowpassHz, dt);
    // The tune gives way to the stealth layer when the night turns.
    this.bed('tune', mix.tune * (1 - 0.6 * tension), mix.saloonLowpassHz, dt);
    this.bed('tension', tensionGain(tension), 12000, dt);
  }

  /** True while the stealth layer plays: the open-water music has no place under it. */
  get tense(): boolean {
    return this.levels.beds.tension > 0.02;
  }

  /** The dev panel: one of the sounds, once, wherever you are. */
  audition(id: string): void {
    const buffer = this.bank.get(id);
    if (!buffer) return;
    const bus: BusId = id.startsWith('voice.')
      ? 'voice'
      : id.startsWith('music.')
        ? 'music'
        : 'sfx';
    this.levels.last = id;
    this.mixer.play({ buffer, bus, gain: 0.8, priority: PRIORITY.critical });
  }

  // -------------------------------------------------------------------------------------

  private guard(id: string): FootGuard | undefined {
    return this.frame?.guards.find((g) => g.id === id);
  }

  private caption(
    key: string,
    text: string,
    at: { x: number; z: number } | undefined,
    delay = 0,
  ): void {
    const f = this.frame;
    if (!f || !at) return;
    this.captions?.push({ key, text, at: { x: at.x, z: at.z } }, f.nowS, delay, 1);
  }

  /** One of your own sounds, at the listener. */
  private cue(
    id: string,
    gain: number,
    o: { rate?: number; delay?: number } = {},
    bus: BusId = 'sfx',
  ): void {
    this.levels.last = id;
    this.play(id, bus, gain, o);
  }

  private play(
    id: string,
    bus: BusId,
    gain: number,
    o: {
      rate?: number;
      delay?: number;
      lowpassHz?: number | undefined;
      at?: AudioPoint;
      priority?: number;
    } = {},
  ): void {
    if (!this.active) return;
    const buffer = this.bank.get(id);
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain,
      ...(o.rate !== undefined ? { rate: o.rate } : {}),
      ...(o.delay !== undefined ? { delay: o.delay } : {}),
      ...(o.lowpassHz !== undefined ? { lowpassHz: o.lowpassHz } : {}),
      ...(o.at ? { at: o.at } : {}),
      priority: o.priority ?? PRIORITY.sfx,
    });
  }

  private bed(id: BedId, want: number, lowpassHz: number, dt: number): void {
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
      // The tune and the layer from the top; the beds from anywhere, so they never line up.
      const musical = id === 'tune' || id === 'tension';
      source.start(ctx.currentTime, musical ? 0 : this.random() * buffer.duration);
      bed = { source, filter, gain, silentS: 0 };
      this.beds.set(id, bed);
    }
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
    this.beds.delete(id);
  }
}
