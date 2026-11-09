import type { SoundBank } from './bank';
import type { CaptionFeed } from './captions';
import {
  BOILER,
  CHASE_RULES,
  COMBAT_CAPTIONS,
  ChaseState,
  OWN_FLYBY,
  FLYBY,
  STRIKE_SHOUT,
  STRUCK_STINGER_M,
  chaseLevelFor,
  flybyFor,
  impactFor,
  isBall,
  reportFor,
  stemGains,
  type ChaseLevel,
  type GunKind,
  type ImpactKind,
  type Placed,
  type Vec3,
} from './combat-mix';
import { shotLevel } from './law-mix';
import { PRIORITY, type AudioMixer, type AudioPoint } from './mixer';
import { SOUND_MS } from './world-mix';

/**
 * Combat audio (Phase 6 piece G; plan 07 §14.4 row G, plan 15 §4.4, §6.1, §11 Phase 6):
 * the swivel, the cannon and the rifle (close to from your own deck, rolling across the
 * water from further off), the round in flight going by, where it lands (the lake, her
 * planking, her canvas), a boiler bursting, the grapple and the boarding vignette (the
 * melee, your crew's cheer, her crew's defiance), her crew calling out as she strikes with
 * a stinger, and the chase layer of the music: two stems looping together, the drums and
 * low strings for tension and the fiddle on top once the guns are going.
 */

export const COMBAT_AUDIO_BUNDLE = 'combat-audio';
export const COMBAT_MUSIC_BUNDLE = 'combat-music';

export const COMBAT_SOUND = {
  swivel: 'sfx.combat.swivel',
  cannon: 'sfx.combat.cannon',
  rifle: 'sfx.combat.rifle',
  flyby: 'sfx.combat.flyby',
  zip: 'sfx.combat.zip',
  splashBall: 'sfx.combat.splash-ball',
  hitWood: 'sfx.combat.hit-wood',
  hitCanvas: 'sfx.combat.hit-canvas',
  boiler: 'sfx.combat.boiler',
  grapple: 'sfx.combat.grapple',
  fight: 'sfx.combat.boarding-fight',
  cheer: 'voice.combat.cheer',
  strike: 'voice.combat.strike',
  defiant: 'voice.combat.defiant',
  struck: 'music.stinger.struck',
} as const;

export const CHASE_STEMS = {
  drums: 'music.chase.drums',
  fiddle: 'music.chase.fiddle',
} as const;

/** A round in the air, as the combat core holds it. */
export interface ShotView {
  id: number;
  shooter: string;
  ammo: string;
  pos: Vec3;
  vel: Vec3;
}

export interface CombatFrame {
  listener: AudioPoint;
  nowS: number;
  /** Fog's damping of distant highs (world-mix `fogMix`), 1 in clear air. */
  damping: number;
  /** The shots in the air now. */
  shots: readonly ShotView[];
  /** The targets about: their captain's phase and how far off they are. */
  targets: readonly { phase: string; distanceM: number }[];
  /** How far off a law ship chasing you is, meters; undefined when none is. */
  lawPursuitM: number | undefined;
}

/** A gun going off, as `WeaponFired` has it, with its kind looked up. */
export interface GunFired {
  by: string;
  kind: GunKind;
  ammo: string;
  at: { x: number; z: number };
  y?: number | undefined;
  /** Radians from north. */
  bearing: number;
}

/** Seconds into the melee before your crew cheers or hers drives you back. */
export const FIGHT_OUTCOME_S = 3.9;
/** The chase's stems fade in and out over these time constants, seconds. */
const STEM_RISE_TAU_S = 0.6;
const STEM_FALL_TAU_S = 1.6;
/** Silent this long, the stems stop. */
const STEMS_IDLE_S = 8;
/** The chase's level under a stinger. */
const STINGER_DUCK = 0.3;

interface Stems {
  drums: { source: AudioBufferSourceNode; gain: GainNode };
  fiddle: { source: AudioBufferSourceNode; gain: GainNode };
  silentS: number;
}

export class CombatSounds {
  captions: CaptionFeed | undefined;
  /** The last cue played, for the dev panel and the tests. */
  lastCue = '';
  /** Fly-bys heard so far, for the dev panel. */
  flybys = 0;

  private frame: CombatFrame | undefined;
  private nowS = 0;
  private lastGunfireS = -Infinity;
  private readonly chaseState = new ChaseState();
  /** Force the chase to a level (the dev panel), or undefined to follow the game. */
  private forced: ChaseLevel | undefined;
  private duckUntilS = 0;
  private readonly heard = new Set<number>();
  private stems: Stems | undefined;

  constructor(
    private readonly mixer: AudioMixer,
    private readonly bank: SoundBank,
  ) {}

  /** The chase layer's level now: 0 none, 1 tension, 2 the chase. */
  get chase(): ChaseLevel {
    return this.chaseState.level;
  }

  // -- Guns -------------------------------------------------------------------------------

  /**
   * A gun went off: its report from where it stands (close to, or the far report rolling
   * across the water), arriving at the speed of sound; your own round's whistle going away.
   */
  fired(e: GunFired, own: boolean): void {
    const f = this.frame;
    if (!f) return;
    const at = { x: e.at.x, y: e.y ?? 3, z: e.at.z };
    const d = dist(at, f.listener);
    if (d < CHASE_RULES.gunfireHeardM) this.lastGunfireS = f.nowS;
    const report = reportFor(e.kind, d, f.damping);
    if (!report) return;
    // Each gun of a ripple a little different.
    this.place(report, at, 'sfx', PRIORITY.critical, 0.97 + 0.06 * Math.random());
    if (own && !isBall(e.ammo)) {
      const buffer = this.bank.get(FLYBY.round.soundId);
      if (buffer) {
        this.mixer.play({
          buffer,
          bus: 'sfx',
          gain: OWN_FLYBY.gain,
          offset: FLYBY.round.passS,
          delay: OWN_FLYBY.delayS,
          priority: PRIORITY.sfx,
          at: {
            x: at.x + 40 * Math.sin(e.bearing),
            y: at.y,
            z: at.z - 40 * Math.cos(e.bearing),
          },
        });
      }
    }
    if (!own) {
      this.captions?.push(
        {
          key: `${e.by}:gun`,
          text: e.kind === 'small_arms' ? COMBAT_CAPTIONS.rifle : COMBAT_CAPTIONS.gun,
          at,
        },
        f.nowS,
        report.delayS,
        1,
      );
    }
    this.lastCue = `${e.kind === 'small_arms' ? 'rifle' : e.kind}${own ? '' : ' (heard)'}`;
  }

  /** A shot landed: a splash in the lake, or wood or canvas struck. */
  landed(kind: ImpactKind, ammo: string, at: Vec3): void {
    const f = this.frame;
    if (!f) return;
    const placed = impactFor(kind, ammo, dist(at, f.listener), f.damping);
    if (!placed) return;
    this.place(placed, at, 'sfx', PRIORITY.sfx, 0.95 + 0.1 * Math.random());
    this.lastCue = `impact ${kind}`;
  }

  /** A steamer's boiler burst at `at` (zone meters). */
  boiler(at: { x: number; z: number }): void {
    const f = this.frame;
    if (!f) return;
    const p = { x: at.x, y: 3, z: at.z };
    const d = dist(p, f.listener);
    const level = shotLevel(d, BOILER.rangeM, BOILER.refM, f.damping);
    if (!level) return;
    this.lastGunfireS = f.nowS;
    this.place(
      { soundId: BOILER.soundId, ...level, rate: 1, delayS: d / SOUND_MS },
      p,
      'sfx',
      PRIORITY.critical,
    );
    this.captions?.push(
      { key: 'boiler', text: COMBAT_CAPTIONS.boiler, at: p },
      f.nowS,
      d / SOUND_MS,
      3,
    );
    this.lastCue = 'boiler';
  }

  // -- She strikes, and boarding --------------------------------------------------------

  /** She struck her colors: her crew calling out from her deck, and the struck stinger. */
  struck(at: { x: number; z: number }): void {
    const f = this.frame;
    if (!f) return;
    const p = { x: at.x, y: 4, z: at.z };
    const d = dist(p, f.listener);
    const level = shotLevel(d, STRIKE_SHOUT.rangeM, STRIKE_SHOUT.refM, f.damping);
    if (level) {
      this.place(
        { soundId: STRIKE_SHOUT.soundId, ...level, rate: 1, delayS: d / SOUND_MS },
        p,
        'voice',
        PRIORITY.critical,
      );
      this.captions?.push(
        { key: 'strike', text: COMBAT_CAPTIONS.strike, at: p },
        f.nowS,
        d / SOUND_MS,
        2,
      );
    }
    if (d < STRUCK_STINGER_M) this.stinger(0.6);
    // The guns can rest: the chase settles once its hold runs out.
    this.lastGunfireS = -Infinity;
    this.lastCue = 'struck';
  }

  /** The struck stinger, with the chase ducked under it. */
  stinger(delay = 0): void {
    const buffer = this.bank.get(COMBAT_SOUND.struck);
    if (!buffer) return;
    this.duckUntilS = this.nowS + delay + buffer.duration;
    this.mixer.play({ buffer, bus: 'music', delay, priority: PRIORITY.critical });
  }

  /** F alongside: the grapple thrown and the hulls brought together. */
  grappled(): void {
    this.ui(COMBAT_SOUND.grapple, 'sfx', 0.9);
    this.lastCue = 'grapple';
  }

  /** Intimidate tried: her crew gives in (calling out) or won't (a shout of defiance). */
  intimidated(ok: boolean): void {
    if (ok) this.ui(COMBAT_SOUND.strike, 'voice', 0.8, 0.2);
    else this.ui(COMBAT_SOUND.defiant, 'voice', 0.85, 0.2);
    this.lastCue = ok ? 'intimidated' : 'defiant';
  }

  /** The boarding fight, then your crew's cheer or hers as you're driven back. */
  fight(won: boolean): void {
    this.ui(COMBAT_SOUND.fight, 'sfx', 0.9);
    if (won) this.ui(COMBAT_SOUND.cheer, 'voice', 0.85, FIGHT_OUTCOME_S);
    else this.ui(COMBAT_SOUND.defiant, 'voice', 0.9, FIGHT_OUTCOME_S);
    this.lastCue = won ? 'fight won' : 'fight lost';
  }

  // -- Every frame ------------------------------------------------------------------------

  /** Each sailing frame: rounds going by, and the chase layer. */
  update(f: CombatFrame, dt: number): void {
    this.frame = f;
    this.nowS = f.nowS;
    const live = new Set<number>();
    for (const s of f.shots) {
      live.add(s.id);
      if (this.heard.has(s.id) || s.shooter === 'ship.player') continue;
      const fly = flybyFor(s, f.listener);
      if (!fly) continue;
      const buffer = this.bank.get(fly.soundId);
      if (!buffer) continue;
      this.heard.add(s.id);
      this.flybys++;
      this.mixer.play({
        buffer,
        bus: 'sfx',
        gain: fly.gain,
        offset: fly.offsetS,
        delay: fly.delayS,
        priority: PRIORITY.critical,
        at: fly.at,
      });
      this.lastCue = 'flyby';
    }
    for (const id of [...this.heard]) if (!live.has(id)) this.heard.delete(id);

    const target =
      this.forced ??
      chaseLevelFor({
        sinceGunfireS: f.nowS - this.lastGunfireS,
        targets: f.targets,
        lawPursuitM: f.lawPursuitM,
      });
    const level = this.forced ?? this.chaseState.update(target, dt);
    if (this.forced !== undefined) this.chaseState.level = this.forced;
    this.playStems(level, dt);
  }

  /** Leaving the helm: the chase stops, the shots heard are forgotten. */
  stop(): void {
    this.frame = undefined;
    this.chaseState.reset();
    this.heard.clear();
    this.lastGunfireS = -Infinity;
    this.disposeStems();
  }

  /** Holds the chase at a level (the dev panel), or lets the game drive it again. */
  forceChase(level: ChaseLevel | undefined): void {
    this.forced = level;
  }

  /** The dev panel: a gun of `kind` fired `m` meters off on the listener's right. */
  gunNow(kind: GunKind, m: number): void {
    const f = this.frame;
    if (!f) return;
    this.fired(
      {
        by: 'dev',
        kind,
        ammo: kind === 'small_arms' ? 'ammo.ball' : 'ammo.round',
        at: { x: f.listener.x + m, z: f.listener.z },
        bearing: -Math.PI / 2,
      },
      m < 30,
    );
  }

  /** The dev panel: a round landing 40 m off. */
  impactNow(kind: ImpactKind): void {
    const f = this.frame;
    if (f) this.landed(kind, 'ammo.round', { x: f.listener.x + 40, y: 1, z: f.listener.z });
  }

  /** The dev panel: a round flying past close aboard. */
  flybyNow(ball = false): void {
    const f = this.frame;
    const buffer = this.bank.get(ball ? FLYBY.ball.soundId : FLYBY.round.soundId);
    if (!f || !buffer) return;
    this.mixer.play({
      buffer,
      bus: 'sfx',
      priority: PRIORITY.critical,
      at: { x: f.listener.x + 10, y: f.listener.y, z: f.listener.z },
    });
    this.lastCue = 'flyby';
  }

  /** The dev panel: a boiler 600 m off, and a ship striking 200 m off. */
  boilerNow(): void {
    const f = this.frame;
    if (f) this.boiler({ x: f.listener.x + 600, z: f.listener.z });
  }

  struckNow(): void {
    const f = this.frame;
    if (f) this.struck({ x: f.listener.x + 200, z: f.listener.z });
  }

  private playStems(level: ChaseLevel, dt: number): void {
    const ctx = this.mixer.ctx;
    if (typeof ctx.createBufferSource !== 'function') return;
    const gains = stemGains(level);
    if (!this.stems) {
      if (level === 0) return;
      const drums = this.bank.get(CHASE_STEMS.drums);
      const fiddle = this.bank.get(CHASE_STEMS.fiddle);
      if (!drums || !fiddle) return;
      // Both from the top at the same instant, so they stay together loop after loop.
      const startAt = ctx.currentTime + 0.05;
      const stem = (buffer: AudioBuffer): { source: AudioBufferSourceNode; gain: GainNode } => {
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(gain).connect(this.mixer.buses.music);
        source.start(startAt);
        return { source, gain };
      };
      this.stems = { drums: stem(drums), fiddle: stem(fiddle), silentS: 0 };
    }
    const s = this.stems;
    const now = ctx.currentTime;
    const duck = this.nowS < this.duckUntilS ? STINGER_DUCK : 1;
    for (const k of ['drums', 'fiddle'] as const) {
      const g = s[k].gain.gain;
      const want = gains[k] * duck;
      g.setTargetAtTime(want, now, want > g.value ? STEM_RISE_TAU_S : STEM_FALL_TAU_S);
    }
    s.silentS = level === 0 ? s.silentS + dt : 0;
    if (s.silentS > STEMS_IDLE_S) this.disposeStems();
  }

  private disposeStems(): void {
    const s = this.stems;
    if (!s) return;
    for (const k of ['drums', 'fiddle'] as const) {
      s[k].source.stop();
      s[k].source.disconnect();
      s[k].gain.disconnect();
    }
    this.stems = undefined;
  }

  private place(
    p: Placed,
    at: AudioPoint,
    bus: 'sfx' | 'voice',
    priority: number,
    jitter = 1,
  ): void {
    const buffer = this.bank.get(p.soundId);
    if (!buffer) return;
    this.mixer.play({
      buffer,
      bus,
      gain: p.gain,
      lowpassHz: p.lowpassHz,
      rate: p.rate * jitter,
      delay: p.delayS,
      priority,
      at,
    });
  }

  private ui(id: string, bus: 'sfx' | 'voice', gain: number, delay = 0): void {
    const buffer = this.bank.get(id);
    if (buffer) this.mixer.play({ buffer, bus, gain, delay, priority: PRIORITY.critical });
  }
}

function dist(a: AudioPoint, b: AudioPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
