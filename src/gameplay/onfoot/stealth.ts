import type { NpcType, TierScaling } from '../../../data/schemas/npc_types';
import type { Rng } from '../../core/rng';
import { daylight01, type SkyLight } from '../../sim/law/perception';
import type { Witness } from '../../sim/law/witness';
import {
  createCharacter,
  DEFAULT_CONTROLLER,
  stepCharacter,
  type CharacterState,
  type ControllerParams,
  type OnFootZone,
} from './controller';
import { npcType, tierScaling, type GuardSpawn, type NpcDefs, type Route } from './guards';
import { ambientLight01, lightAt, type Lamp, type LampSet, type LightReading } from './light';
import type { NavQuery, XZ } from './nav';
import {
  Footsteps,
  heard,
  landingRadiusM,
  EVENT_NOISE_M,
  weatherNoiseFactor,
  type NoiseEvent,
  type NoiseKind,
  type Surface,
} from './noise';
import {
  airSightFactor,
  ALERTED,
  DECAY_PER_S,
  exposure,
  EYE_M,
  fogOnFoot01,
  look,
  meterRate,
  recognitionRate,
  SUSPICIOUS,
  type Figure,
  type Glimpse,
} from './perception';
import { lineBlocked, type P3 } from './sightline';

/**
 * The guards (plan 08 §5.2; Phase 7 piece D): perception and the FSM, as one system that
 * the on-foot mode steps every tick.
 *
 * ```
 * Patrol ──(noise / glimpse)──► Suspicious ──(sure)──► Alerted / Pursue
 *    ▲            │ (nothing)                 │ (lost you)
 *    │            ▼                           ▼
 *    └──────── Return ◄─────────────────── Search (last known place; calls others)
 *
 * Side states: Distracted · Drunk · Unconscious · Bound · Bribed · Dead
 * ```
 *
 * Each guard looks ten times a second (staggered, so a dozen guards spread their sight lines
 * across ticks) and walks every tick with the player's own controller, on the district's
 * navigation (the baked navmesh, or the greybox grid until it lands). Everything a guard
 * decides comes out as an event: the HUD's eyes, the law's witnesses and reports, the
 * barks and whistles (piece I) and capture into Phase 5's jail all read the same ones.
 *
 * Piece E's tools (`tools.ts`) act through `knockOut`, `bind`, `kill`, `makeDrunk`, `bribe`,
 * `noise`, and the hands below them: `witnessAct` (who saw you do it), `faceToFace` (a talk
 * shows your face), `wary` (a refusal makes them suspicious), `moveBody` and `sink`.
 */

export type GuardState =
  | 'patrol'
  | 'suspicious'
  | 'alerted'
  | 'search'
  | 'fetch'
  | 'return'
  | 'distracted'
  | 'drunk'
  | 'unconscious'
  | 'bound'
  | 'bribed'
  | 'dead';

/** Down and out of it: they neither see nor hear. */
export function isDown(s: GuardState): boolean {
  return s === 'unconscious' || s === 'bound' || s === 'dead';
}

export interface Guard {
  readonly id: string;
  readonly type: NpcType;
  readonly name: string;
  readonly body: CharacterState;
  /** The previous tick's place, for render interpolation. */
  readonly previous: { x: number; y: number; z: number; heading: number };
  readonly params: ControllerParams;
  readonly route: Route;
  state: GuardState;
  /** Seconds in this state. */
  stateS: number;
  /** The detection meter: 0 … SUSPICIOUS … 1 alerted (plan 08 §4.1). */
  meter: number;
  /** Recognition, 0 … 1 knows your face (plan 08 §4.4). */
  recognition: number;
  identified: boolean;
  /** What drew them: where they're looking or going. */
  stimulus: XZ | undefined;
  /** Where they last saw you, and when (state seconds ago). */
  lastSeen: XZ | undefined;
  lostS: number;
  /** The last look's result, for the HUD and debugging. */
  glimpse: Glimpse | undefined;
  /** Saw you clearly enough to be a witness this episode. */
  witnessed: boolean;
  /** Filed (or ran to file) their report this episode. */
  reported: boolean;
  lantern: Lamp | undefined;
  // Route walking.
  waypoint: number;
  direction: 1 | -1;
  waitS: number;
  path: XZ[] | undefined;
  pathAt: number;
  repathS: number;
  /** Search: seconds left, and the centre swept. */
  searchLeftS: number;
  searchAt: XZ | undefined;
  /** A shout heard: join the search here once the delay's up. */
  recruit: { at: XZ; inS: number } | undefined;
  /** Game seconds: when an unconscious guard wakes, a drunk passes out, a bribe wears off. */
  untilGame: number;
  /** A downed guard someone has found. */
  found: boolean;
  /** Why they're down: a blow (they wake and report it) or drink (they wake sheepish). */
  downBy: 'blow' | 'drink' | undefined;
  /** Close enough to lay hands on you, seconds held. */
  grabS: number;
  /** Stagger: looks happen when this crosses zero. */
  lookInS: number;
  /** Progress check while walking, for getting unstuck. */
  stuck: { x: number; z: number; s: number };
}

export type StealthEvent =
  | { type: 'NoiseMade'; noise: NoiseEvent }
  | { type: 'NpcStateChanged'; npc: string; from: GuardState; to: GuardState }
  | { type: 'PlayerSpotted'; npc: string; identified: boolean }
  | { type: 'PlayerIdentified'; npc: string }
  | {
      type: 'GuardReported';
      npc: string;
      identified: boolean;
      why: 'seen' | 'assault' | 'body';
    }
  | { type: 'BodyFound'; npc: string; finder: string; dead: boolean; drunk: boolean }
  | { type: 'GuardWoke'; npc: string; identified: boolean; drank: boolean }
  | { type: 'Captured'; npc: string; by: string };

/** What the district gives the guards. */
export interface StealthWorld {
  zone: OnFootZone;
  nav: NavQuery;
  lamps: LampSet;
  rng: Rng;
  /** Where a watchman runs to find the law if no constable is out (the lockup's door). */
  lawPost?: XZ;
}

/** The player and the night, each tick. */
export interface StealthInputs {
  player: CharacterState;
  /** The controller's params the player walks with (for their height). */
  playerParams?: ControllerParams;
  carrying?: boolean;
  /** What's underfoot, for the footsteps (piece C tags the kit's colliders). */
  surface?: Surface;
  /** The player's own lantern, lit (plan 08 §6: be seen to see). */
  playerLantern?: Lamp;
  sky: SkyLight;
  /** The weather's fog visibility, meters, and rain 0–1. */
  fogM: number;
  rain01: number;
  gameSeconds: number;
  /**
   * Whether being seen here and now is suspicious: trespassing, out at night where the
   * district's closed, carrying loot (piece E's conduct). By day in the street it isn't.
   */
  suspect: boolean;
  /** Plan 06's recognition: 0 unknown … 1 legendary. */
  fame01: number;
  /** The region's Wanted tier: from 2, a guard who knows your face raises the alarm. */
  wantedTier: number;
}

/** Looks a second (each guard; staggered). */
export const LOOK_HZ = 10;
/** Close enough to grab you, meters, and seconds to hold on to take you. */
export const GRAB_M = 1.1;
export const GRAB_S = 0.9;
/** Out of sight this long while pursuing, they go to search. */
export const LOSE_S = 2.5;
/** Seconds a suspicious guard stands and stares before walking over. */
export const STARE_S = 1.2;
/** A distraction holds them this long at the spot. */
export const DISTRACTED_S = 5;
/** Real seconds a search point is studied. */
const LOOK_AROUND_S = 1.6;
/** A guard who knows your face raises the alarm at once from this Wanted tier. */
export const KNOWN_FACE_TIER = 2;
/** Not suspect, the meter stops short of suspicion: they see you and think nothing of it. */
const INNOCENT_CAP = SUSPICIOUS * 0.85;
/** A noise alone never makes a guard sure: it brings them to look. */
const NOISE_CAP = 0.85;
/** A body is noticed inside this share of the seeing range. */
const BODY_CLOSENESS = 0.15;
/** Game seconds an unconscious guard is out (plan 08 §5.2: wakes after a while). */
export const KNOCKOUT_GAME_S = 2 * 3600;
/** Bound, they're out this much longer. */
export const BOUND_GAME_S = 6 * 3600;
/** Found unconscious, they come round this soon. */
const FOUND_WAKE_GAME_S = 60;
/** Night lanterns are lit below this sky light. */
const LANTERN_BELOW = 0.3;

export interface GuardReadout {
  id: string;
  name: string;
  type: string;
  state: GuardState;
  meter: number;
  identified: boolean;
  x: number;
  y: number;
  z: number;
}

export interface StealthReadout {
  light: LightReading;
  /** The light gem: the player's exposure, 0–1+. */
  exposure01: number;
  /** The largest noise the player made lately, meters, easing back to the footsteps. */
  noiseM: number;
  guards: readonly GuardReadout[];
  /** Someone is after you (chart lock, music). */
  pursued: boolean;
  /** Someone is searching for you. */
  searched: boolean;
  captured: boolean;
}

export interface Stealth {
  readonly guards: readonly Guard[];
  readonly captured: boolean;
  /** Steps every guard `dt` real seconds. */
  step(dt: number, inputs: StealthInputs): void;
  /** A noise from the player or the world (piece E: a lock, a thrown stone, a shot). */
  noise(e: NoiseEvent): void;
  /** Convenience: a one-off noise of a kind at a place, with its standard radius. */
  noiseAt(kind: Exclude<NoiseKind, 'footstep' | 'landing'>, at: P3, source?: string): void;
  on(fn: (e: StealthEvent) => void): () => void;
  readout(): StealthReadout;
  /** Who saw the player and would tell (plan 06 §2.4): alerted by sight, still standing. */
  witnesses(): Witness[];
  guard(id: string): Guard | undefined;
  // Piece E's hands.
  knockOut(id: string, gameSeconds: number, outGameS?: number): void;
  bind(id: string, gameSeconds: number): void;
  kill(id: string): void;
  makeDrunk(id: string, gameSeconds: number, passOutInGameS: number): void;
  bribe(id: string, untilGameSeconds: number): void;
  /**
   * The player just did something nobody could mistake (a blow, a knife): every guard
   * standing who can see them right now is alerted. Returns who saw it (not `except`).
   */
  witnessAct(except?: string): Guard[];
  /** Talking to a guard shows them your face: recognition jumps. Returns whether they know it. */
  faceToFace(id: string, light01: number, fame01: number): boolean;
  /** A refusal: they're suspicious of you and watch you (a bribe or a bottle turned down). */
  wary(id: string): void;
  /** A downed guard carried somewhere (piece E's dragging): moved, still where nobody's seen. */
  moveBody(id: string, at: { x: number; y: number; z: number }): void;
  /** A body put in the lake: gone tonight, never found. */
  sink(id: string): void;
  /** Measured cost of the last step, ms (the ≤ 1 ms budget, plan 08 §20.3 #10). */
  readonly lastStepMs: number;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Heading from a to b, clockwise from north (heading h faces (sin h, −cos h)). */
function headingTo(a: XZ, b: XZ): number {
  return Math.atan2(b.x - a.x, -(b.z - a.z));
}

function dist(a: XZ, b: XZ): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function createStealth(
  world: StealthWorld,
  defs: NpcDefs,
  spawns: readonly GuardSpawn[],
  tier = 0,
): Stealth {
  const scaling: TierScaling = tierScaling(defs, tier);
  const listeners = new Set<(e: StealthEvent) => void>();
  const emit = (e: StealthEvent): void => {
    for (const fn of listeners) fn(e);
  };
  const guards: Guard[] = spawns.map((s, k) => {
    const type = npcType(defs, s.type);
    const start = s.route.points[(s.startAt ?? 0) % s.route.points.length] ?? { x: 0, z: 0 };
    const y = world.zone.ground.heightAt(start.x, start.z);
    const body = createCharacter({ x: start.x, y, z: start.z }, start.face ?? 0);
    const params: ControllerParams = {
      ...DEFAULT_CONTROLLER,
      walkSpeed: type.speed.walk,
      runSpeed: type.speed.run,
    };
    return {
      id: s.id,
      type,
      name: s.name ?? type.name,
      body,
      previous: { x: start.x, y, z: start.z, heading: body.heading },
      params,
      route: s.route,
      state: 'patrol',
      stateS: 0,
      meter: 0,
      recognition: 0,
      identified: false,
      stimulus: undefined,
      lastSeen: undefined,
      lostS: 0,
      glimpse: undefined,
      witnessed: false,
      reported: false,
      lantern: type.lantern
        ? {
            x: start.x,
            y: y + 1.1,
            z: start.z,
            radiusM: type.lantern.radiusM,
            intensity: type.lantern.intensity,
            lit: false,
          }
        : undefined,
      waypoint: (s.startAt ?? 0) % Math.max(1, s.route.points.length),
      direction: 1,
      waitS: start.waitS ?? 0,
      path: undefined,
      pathAt: 0,
      repathS: 0,
      searchLeftS: 0,
      searchAt: undefined,
      recruit: undefined,
      untilGame: 0,
      found: false,
      downBy: undefined,
      grabS: 0,
      lookInS: k / Math.max(1, spawns.length) / LOOK_HZ,
      stuck: { x: start.x, z: start.z, s: 0 },
    };
  });
  const byId = new Map(guards.map((g) => [g.id, g]));

  let captured = false;
  let lastStepMs = 0;
  let noiseM = 0;
  let lastInputs: StealthInputs | undefined;
  let lastLight: LightReading = { level01: 0, ambient01: 0, lamps01: 0, brightest: undefined };
  let lastExposure = 0;
  let weatherNoise = 1;
  let nowGame = 0;

  const carried: Lamp[] = [];
  const footsteps = new Footsteps();
  let prevPlayer: { x: number; z: number; vy: number; grounded: boolean } | undefined;

  /** The player's footsteps and landings, from how far they moved this tick. */
  const playerSounds = (inputs: StealthInputs): void => {
    const pl = inputs.player;
    const p = pl.position;
    const surface = inputs.surface ?? (pl.surface === 'water' ? 'dirt' : (pl.surface ?? 'dirt'));
    if (prevPlayer) {
      const moved = Math.hypot(p.x - prevPlayer.x, p.z - prevPlayer.z);
      const r = footsteps.step(moved, pl.gait, surface, inputs.carrying);
      if (r > 0) raise({ kind: 'footstep', x: p.x, y: p.y, z: p.z, radiusM: r, source: 'player' });
      if (pl.grounded && !prevPlayer.grounded) {
        const land = landingRadiusM(-prevPlayer.vy, surface);
        if (land > 0) {
          raise({ kind: 'landing', x: p.x, y: p.y, z: p.z, radiusM: land, source: 'player' });
        }
      }
      if (pl.swimming && !prevSwimming) {
        raise({
          kind: 'splash',
          x: p.x,
          y: p.y,
          z: p.z,
          radiusM: EVENT_NOISE_M.splash,
          source: 'player',
        });
      }
    }
    prevSwimming = pl.swimming;
    prevPlayer = { x: p.x, z: p.z, vy: pl.velocity.y, grounded: pl.grounded };
  };
  let prevSwimming = false;

  const setState = (g: Guard, to: GuardState): void => {
    if (g.state === to) return;
    const from = g.state;
    g.state = to;
    g.stateS = 0;
    g.path = undefined;
    g.grabS = 0;
    emit({ type: 'NpcStateChanged', npc: g.id, from, to });
  };

  const goTo = (g: Guard, to: XZ): void => {
    g.path = world.nav.findPath(g.body.position, to);
    g.pathAt = 0;
    g.repathS = 0.6;
  };

  const vigilance = (g: Guard, sky: SkyLight): number => {
    const day = daylight01(sky.sunElevationRad) > 0.5;
    let v = (day ? g.type.vigilance.day : g.type.vigilance.night) * scaling.vigilance;
    if (g.state === 'drunk') v *= 0.35;
    if (g.state === 'search') v *= 1.6;
    if (g.state === 'suspicious') v *= 1.3;
    return v;
  };

  /** Raise the alarm: the shout or whistle that brings the others (plan 08 §5.2). */
  const callOut = (g: Guard): void => {
    const kind: NoiseKind = g.type.witness === 'sailor' ? 'shout' : 'whistle';
    raise({
      kind,
      x: g.body.position.x,
      y: g.body.position.y + EYE_M,
      z: g.body.position.z,
      radiusM: EVENT_NOISE_M[kind as 'shout' | 'whistle'],
      source: g.id,
    });
  };

  const fileReport = (g: Guard, why: 'seen' | 'assault' | 'body'): void => {
    g.reported = true;
    emit({ type: 'GuardReported', npc: g.id, identified: g.identified, why });
  };

  const alert = (g: Guard, seen: XZ): void => {
    g.meter = ALERTED;
    g.lastSeen = { x: seen.x, z: seen.z };
    g.lostS = 0;
    if (g.state === 'alerted') return;
    setState(g, 'alerted');
    g.witnessed = true;
    emit({ type: 'PlayerSpotted', npc: g.id, identified: g.identified });
    callOut(g);
    // A constable files at once; a watchman runs for one when the chase is over.
    if (g.type.onAlert === 'report' && !g.reported) fileReport(g, 'seen');
  };

  const startSearch = (g: Guard, at: XZ, s?: number): void => {
    g.searchAt = { x: at.x, z: at.z };
    g.searchLeftS = s ?? g.type.searchS * scaling.search;
    g.waitS = 0;
    setState(g, 'search');
    goTo(g, at);
  };

  /** After a search or a scare: the watchman runs for the law, the rest go back to work. */
  const standDown = (g: Guard): void => {
    g.stimulus = undefined;
    if (g.type.onAlert === 'fetch' && g.witnessed && !g.reported) {
      setState(g, 'fetch');
      return;
    }
    setState(g, 'return');
  };

  /** Whether a guard listens and looks right now. */
  const aware = (g: Guard): boolean => !isDown(g.state);

  // -------------------------------------------------------------------------------------
  // Hearing.

  const raise = (e: NoiseEvent): void => {
    if (e.source === 'player') noiseM = Math.max(noiseM, e.radiusM * weatherNoise);
    emit({ type: 'NoiseMade', noise: e });
    const from: P3 = { x: e.x, y: e.y + 0.8, z: e.z };
    for (const g of guards) {
      if (!aware(g) || g.id === e.source) continue;
      if (g.state === 'bribed' && e.source === 'player' && e.kind !== 'gunshot') continue;
      const ear = g.body.position;
      // Quick reject before the wall check.
      if (dist(ear, e) > e.radiusM * g.type.hearing * weatherNoise) continue;
      const blocked = lineBlocked(world.zone.colliders, from, {
        x: ear.x,
        y: ear.y + EYE_M,
        z: ear.z,
      });
      const strength = heard(e, ear, g.type.hearing, weatherNoise, blocked);
      if (strength <= 0) continue;
      hear(g, e, strength);
    }
  };

  const hear = (g: Guard, e: NoiseEvent, strength: number): void => {
    const at = { x: e.x, z: e.z };
    switch (e.kind) {
      case 'shout':
      case 'whistle':
        // Another guard's alarm: come and help (after the tier's delay).
        if (g.state === 'alerted' || g.state === 'search' || g.state === 'fetch') return;
        if (g.type.witness === 'sailor') return;
        g.recruit = { at, inS: scaling.recruitDelayS * (1 - 0.5 * strength) };
        return;
      case 'gunshot':
        if (g.state === 'alerted') return;
        if (g.type.witness === 'sailor') {
          g.meter = Math.max(g.meter, SUSPICIOUS);
          g.stimulus = at;
          setState(g, 'suspicious');
          return;
        }
        startSearch(g, at);
        return;
      case 'distraction':
        if (g.state === 'patrol' || g.state === 'return' || g.state === 'distracted') {
          g.stimulus = at;
          setState(g, 'distracted');
          goTo(g, at);
        }
        return;
      default: {
        // The player's own sounds: steps, a lock, a crate, a splash.
        if (g.state === 'alerted') {
          if (e.source === 'player' && strength > 0.4) g.lastSeen = at;
          return;
        }
        const suspect = lastInputs?.suspect ?? true;
        if (!suspect && e.kind === 'footstep') return;
        g.meter = Math.min(NOISE_CAP, Math.max(g.meter, 0) + 0.25 + 0.6 * strength);
        g.stimulus = at;
        if (g.state === 'search') {
          g.searchAt = at;
          goTo(g, at);
          return;
        }
        if (g.meter >= SUSPICIOUS && g.state !== 'suspicious' && g.state !== 'fetch') {
          setState(g, 'suspicious');
        }
      }
    }
  };

  // -------------------------------------------------------------------------------------
  // Seeing.

  const eye: P3 = { x: 0, y: 0, z: 0 };

  const figureOf = (inputs: StealthInputs): Figure => {
    const p = inputs.player;
    const params = inputs.playerParams ?? DEFAULT_CONTROLLER;
    return {
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      gait: p.gait,
      crouching: p.crouching,
      swimming: p.swimming,
      carrying: inputs.carrying ?? false,
      height: p.crouching ? params.crouchHeight : params.standHeight,
    };
  };

  const lookFor = (g: Guard, f: Figure, exposure01: number, rangeFactor: number): Glimpse => {
    eye.x = g.body.position.x;
    eye.y = g.body.position.y + (g.body.crouching ? 1 : EYE_M);
    eye.z = g.body.position.z;
    return look({
      eye,
      eyeHeading: g.body.heading,
      sight: g.type.sight,
      rangeFactor,
      figure: f,
      exposure01,
      colliders: world.zone.colliders,
      lamps: world.lamps,
      carried,
      ground: world.zone.ground,
    });
  };

  const perceive = (g: Guard, dt: number, inputs: StealthInputs, air: number): void => {
    const f = figureOf(inputs);
    const drunk = g.state === 'drunk' ? 0.6 : 1;
    if (g.state !== 'bribed') {
      const glimpse = lookFor(g, f, lastExposure, air * drunk);
      g.glimpse = glimpse;
      const at = { x: f.x, z: f.z };
      if (glimpse.seen) {
        // Recognition (plan 08 §4.4).
        if (!g.identified) {
          g.recognition = Math.min(
            1,
            g.recognition + recognitionRate(glimpse, lastLight.level01, inputs.fame01) * dt,
          );
          if (g.recognition >= 1) {
            g.identified = true;
            emit({ type: 'PlayerIdentified', npc: g.id });
          }
        }
        const knownFace =
          g.identified && inputs.wantedTier >= KNOWN_FACE_TIER && g.type.witness !== 'sailor';
        if (g.state === 'alerted') {
          g.lastSeen = at;
          g.lostS = 0;
        } else if (knownFace) {
          alert(g, at);
        } else {
          const rate = meterRate(glimpse, vigilance(g, inputs.sky));
          const cap = inputs.suspect ? ALERTED : INNOCENT_CAP;
          if (g.meter < cap) g.meter = Math.min(cap, g.meter + rate * dt);
          if (g.meter >= ALERTED) {
            alert(g, at);
          } else if (g.meter >= SUSPICIOUS) {
            g.stimulus = at;
            if (g.state === 'search') {
              g.searchAt = at;
            } else if (g.state !== 'suspicious' && g.state !== 'fetch' && g.state !== 'drunk') {
              setState(g, 'suspicious');
            }
          }
        }
      } else if (g.state !== 'alerted') {
        const decay = g.state === 'search' ? DECAY_PER_S * 0.4 : DECAY_PER_S;
        g.meter = Math.max(0, g.meter - decay * dt);
      }
    } else {
      g.glimpse = undefined;
      g.meter = Math.max(0, g.meter - DECAY_PER_S * dt);
    }

    // Bodies and the bound (plan 08 §5.2): a downed guard nobody has found yet.
    for (const o of guards) {
      if (o === g || !isDown(o.state) || o.found) continue;
      const body: Figure = {
        x: o.body.position.x,
        y: o.body.position.y,
        z: o.body.position.z,
        gait: 'idle',
        crouching: true,
        swimming: false,
        carrying: false,
        height: 0.45,
      };
      const lit = lightAt(body.x, body.y, body.z, lastLight.ambient01, world.lamps, carried);
      const seen = lookFor(g, body, exposure(lit.level01, body) * 1.3, air);
      if (!seen.seen || seen.closeness01 < BODY_CLOSENESS) continue;
      findBody(g, o);
    }
  };

  const findBody = (finder: Guard, o: Guard): void => {
    o.found = true;
    const dead = o.state === 'dead';
    const drunk = !dead && o.downBy === 'drink' && o.state === 'unconscious';
    emit({ type: 'BodyFound', npc: o.id, finder: finder.id, dead, drunk });
    if (!dead) o.untilGame = Math.min(o.untilGame, nowGame + FOUND_WAKE_GAME_S);
    // Asleep on watch with a bottle: a shake and a curse, no alarm.
    if (drunk) return;
    if (o.state === 'bound') o.state = 'unconscious';
    // A body means trouble: the finder calls out and searches round it.
    callOut(finder);
    if (finder.type.onAlert === 'report' && dead) fileReport(finder, 'body');
    if (finder.type.witness !== 'sailor') startSearch(finder, o.body.position);
    else {
      finder.stimulus = { x: o.body.position.x, z: o.body.position.z };
      setState(finder, 'suspicious');
    }
  };

  // -------------------------------------------------------------------------------------
  // Walking.

  /** Walks along the current path; true when it's done (arrived, or no path). */
  const walk = (g: Guard, dt: number, run: boolean): boolean => {
    const path = g.path;
    const p = g.body.position;
    let input = { forward: 0, right: 0, run: false, crouch: false };
    let yaw = g.body.heading;
    let done = true;
    if (path && g.pathAt < path.length) {
      let target = path[g.pathAt] as XZ;
      while (dist(p, target) < 0.35 && g.pathAt < path.length - 1) {
        g.pathAt++;
        target = path[g.pathAt] as XZ;
      }
      if (dist(p, target) < 0.35) {
        g.pathAt = path.length;
      } else {
        yaw = headingTo(p, target);
        input = { forward: 1, right: 0, run, crouch: false };
        done = false;
      }
    }
    stepCharacter(g.body, input, yaw, world.zone, dt, g.params);
    // Unstick: if a second of walking hasn't moved them, take the next corner or give up.
    if (!done) {
      g.stuck.s += dt;
      if (g.stuck.s > 1) {
        if (dist(p, g.stuck) < 0.15) {
          if (g.path && g.pathAt < g.path.length - 1) g.pathAt++;
          else {
            g.path = undefined;
            done = true;
          }
        }
        g.stuck = { x: p.x, z: p.z, s: 0 };
      }
    }
    return done;
  };

  /** Turns on the spot toward a heading, radians a second. */
  const turnTo = (g: Guard, heading: number, dt: number, rate = 3): void => {
    const d = wrapAngle(heading - g.body.heading);
    const step = rate * dt;
    g.body.heading = wrapAngle(g.body.heading + Math.max(-step, Math.min(step, d)));
  };

  /** Stand still (gravity and push-out still apply). */
  const stand = (g: Guard, dt: number): void => {
    stepCharacter(
      g.body,
      { forward: 0, right: 0, run: false, crouch: false },
      g.body.heading,
      world.zone,
      dt,
      g.params,
    );
  };

  const patrol = (g: Guard, dt: number): void => {
    const pts = g.route.points;
    if (pts.length === 0) return stand(g, dt);
    const wp = pts[g.waypoint] as (typeof pts)[number];
    if (g.waitS > 0) {
      g.waitS -= dt;
      stand(g, dt);
      // Look about at a stop: the facing, swept ±35°.
      const base = wp.face ?? g.body.heading;
      turnTo(g, base + Math.sin(g.stateS * 0.8) * 0.6, dt, 1.5);
      return;
    }
    if (!g.path) goTo(g, wp);
    if (walk(g, dt, false)) {
      // Arrived: wait, then on to the next.
      g.waitS = wp.waitS ?? 0;
      if (g.route.loop) g.waypoint = (g.waypoint + 1) % pts.length;
      else {
        if (g.waypoint + g.direction < 0 || g.waypoint + g.direction >= pts.length) {
          g.direction = g.direction === 1 ? -1 : 1;
        }
        g.waypoint = Math.max(0, Math.min(pts.length - 1, g.waypoint + g.direction));
      }
      g.path = undefined;
    }
  };

  const nearestWaypoint = (g: Guard): number => {
    let best = 0;
    let bestD = Infinity;
    g.route.points.forEach((w, k) => {
      const d = dist(g.body.position, w);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    return best;
  };

  const capture = (g: Guard, inputs: StealthInputs, dt: number): void => {
    if (!g.type.pursues) return;
    const d = dist(g.body.position, inputs.player.position);
    if (d < GRAB_M) g.grabS += dt;
    else g.grabS = Math.max(0, g.grabS - dt * 2);
    if (g.grabS >= GRAB_S && !captured) {
      captured = true;
      emit({ type: 'Captured', npc: g.id, by: g.type.id });
    }
  };

  const behave = (g: Guard, dt: number, inputs: StealthInputs): void => {
    g.stateS += dt;
    // Shouts heard: join the search once the delay's run out.
    if (g.recruit) {
      g.recruit.inS -= dt;
      if (g.recruit.inS <= 0 && aware(g) && g.state !== 'drunk' && g.state !== 'bribed') {
        const at = g.recruit.at;
        g.recruit = undefined;
        if (g.state !== 'alerted' && g.state !== 'search' && g.state !== 'fetch') {
          startSearch(g, at);
        }
      }
    }
    const player = inputs.player.position;
    switch (g.state) {
      case 'patrol':
        patrol(g, dt);
        return;
      case 'bribed':
        if (nowGame >= g.untilGame) setState(g, 'patrol');
        patrol(g, dt);
        return;
      case 'suspicious': {
        const at = g.stimulus ?? player;
        if (g.stateS < STARE_S) {
          stand(g, dt);
          turnTo(g, headingTo(g.body.position, at), dt, 4);
        } else {
          if (!g.path || g.repathS <= 0) goTo(g, at);
          g.repathS -= dt;
          const arrived = walk(g, dt, false);
          if (arrived) turnTo(g, g.body.heading + 1.2 * dt, dt);
        }
        if (g.meter <= 0.05 || g.stateS > 14) {
          // Nothing there after all.
          g.meter = Math.min(g.meter, 0.1);
          setState(g, 'return');
        }
        return;
      }
      case 'alerted': {
        g.lostS = g.glimpse?.seen ? 0 : g.lostS + dt;
        const target = g.lastSeen ?? player;
        if (!g.type.pursues) {
          // A witness, not a fighter: watch, shout for help, keep clear.
          stand(g, dt);
          turnTo(g, headingTo(g.body.position, target), dt, 4);
          if (g.lostS > LOSE_S * 2) {
            g.meter = SUSPICIOUS;
            setState(g, 'return');
          }
          return;
        }
        g.repathS -= dt;
        if (!g.path || g.repathS <= 0) goTo(g, target);
        walk(g, dt, true);
        if (g.glimpse?.seen) capture(g, inputs, dt);
        if (g.lostS > LOSE_S) startSearch(g, target);
        return;
      }
      case 'search': {
        g.searchLeftS -= dt;
        if (g.searchLeftS <= 0) {
          g.meter = Math.min(g.meter, SUSPICIOUS * 0.6);
          standDown(g);
          return;
        }
        if (g.waitS > 0) {
          g.waitS -= dt;
          stand(g, dt);
          turnTo(g, g.body.heading + 2, dt, 1.8);
          return;
        }
        if (!g.path) {
          const centre = g.searchAt ?? g.body.position;
          const next = world.nav.randomNear(centre, 7, world.rng);
          if (next) goTo(g, next);
        }
        if (walk(g, dt, g.stateS < 4)) {
          g.waitS = LOOK_AROUND_S;
          g.path = undefined;
        }
        return;
      }
      case 'fetch': {
        // Run for the nearest constable standing, or the law's post.
        let target: XZ | undefined = world.lawPost;
        let best = Infinity;
        let constable: Guard | undefined;
        for (const o of guards) {
          if (o === g || o.type.onAlert !== 'report' || !aware(o)) continue;
          const d = dist(g.body.position, o.body.position);
          if (d < best) {
            best = d;
            constable = o;
            target = o.body.position;
          }
        }
        if (!target) {
          fileReport(g, 'seen');
          setState(g, 'return');
          return;
        }
        g.repathS -= dt;
        if (!g.path || g.repathS <= 0) goTo(g, target);
        walk(g, dt, true);
        if (dist(g.body.position, target) < 2.5) {
          fileReport(g, 'seen');
          if (constable && constable.state !== 'alerted') {
            startSearch(constable, g.lastSeen ?? g.body.position);
          }
          setState(g, 'return');
        }
        return;
      }
      case 'distracted': {
        const at = g.stimulus ?? g.body.position;
        if (walk(g, dt, false)) {
          stand(g, dt);
          turnTo(g, g.body.heading + 1.5 * dt, dt);
          if (g.stateS > DISTRACTED_S + 2) setState(g, 'return');
        } else if (dist(g.body.position, at) > 25) {
          setState(g, 'return');
        }
        return;
      }
      case 'return': {
        if (!g.path) {
          g.waypoint = nearestWaypoint(g);
          const wp = g.route.points[g.waypoint];
          if (wp) goTo(g, wp);
        }
        if (walk(g, dt, false)) {
          g.witnessed = false;
          g.reported = false;
          setState(g, 'patrol');
        }
        return;
      }
      case 'drunk':
        stand(g, dt);
        turnTo(g, g.body.heading + Math.sin(g.stateS) * 0.4, dt, 0.6);
        if (nowGame >= g.untilGame) {
          setState(g, 'unconscious');
          g.untilGame = nowGame + KNOCKOUT_GAME_S;
          g.found = false;
          g.downBy = 'drink';
        }
        return;
      case 'unconscious':
      case 'bound':
        stand(g, dt);
        if (nowGame >= g.untilGame) wake(g);
        return;
      case 'dead':
        stand(g, dt);
        return;
    }
  };

  const wake = (g: Guard): void => {
    g.found = true;
    if (g.downBy === 'drink' && g.state === 'unconscious') {
      // Slept it off: back to the beat with a sore head and nothing to tell (plan 08 §6.2).
      g.downBy = undefined;
      g.meter = 0;
      g.witnessed = false;
      emit({ type: 'GuardWoke', npc: g.id, identified: g.identified, drank: true });
      setState(g, 'return');
      return;
    }
    g.downBy = undefined;
    g.meter = SUSPICIOUS;
    emit({ type: 'GuardWoke', npc: g.id, identified: g.identified, drank: false });
    // "Assaulted by someone" (identified only if they saw you), reported as their kind does.
    g.witnessed = true;
    if (g.type.onAlert === 'report') fileReport(g, 'assault');
    if (g.type.witness === 'sailor') {
      fileReport(g, 'assault');
      setState(g, 'return');
      return;
    }
    startSearch(g, g.body.position, g.type.searchS * scaling.search * 0.5);
  };

  const guardOrThrow = (id: string): Guard => {
    const g = byId.get(id);
    if (!g) throw new Error(`No guard ${id}`);
    return g;
  };

  const self: Stealth = {
    guards,
    get captured() {
      return captured;
    },
    get lastStepMs() {
      return lastStepMs;
    },
    step(dt, inputs) {
      const t0 = performance.now();
      lastInputs = inputs;
      nowGame = inputs.gameSeconds;
      const fog01 = fogOnFoot01(inputs.fogM);
      const air = airSightFactor(fog01, inputs.rain01);
      weatherNoise = weatherNoiseFactor(inputs.rain01, fog01);
      const ambient = ambientLight01(inputs.sky, fog01);

      // Lanterns: lit after dark, carried at the guard's hip.
      carried.length = 0;
      for (const g of guards) {
        const l = g.lantern;
        if (!l) continue;
        l.lit = ambient < LANTERN_BELOW && g.state !== 'dead' && g.state !== 'bound';
        l.x = g.body.position.x;
        l.y = g.body.position.y + (isDown(g.state) ? 0.2 : 1.1);
        l.z = g.body.position.z;
        if (l.lit) carried.push(l);
      }
      if (inputs.playerLantern?.lit) carried.push(inputs.playerLantern);

      const p = inputs.player.position;
      lastLight = lightAt(p.x, p.y, p.z, ambient, world.lamps, carried);
      lastExposure = exposure(lastLight.level01, figureOf(inputs));
      if (!captured) playerSounds(inputs);

      for (const g of guards) {
        g.previous.x = g.body.position.x;
        g.previous.y = g.body.position.y;
        g.previous.z = g.body.position.z;
        g.previous.heading = g.body.heading;
        if (captured) continue;
        if (aware(g)) {
          g.lookInS -= dt;
          if (g.lookInS <= 0) {
            const lookDt = 1 / LOOK_HZ - g.lookInS;
            g.lookInS += 1 / LOOK_HZ;
            perceive(g, lookDt, inputs, air);
          }
        }
        behave(g, dt, inputs);
      }
      // The noise ring eases back over about a second.
      noiseM = Math.max(0, noiseM - noiseM * Math.min(1, dt * 1.5) - dt);
      lastStepMs = performance.now() - t0;
    },
    noise(e) {
      raise(e);
    },
    noiseAt(kind, at, source = 'player') {
      raise({ kind, x: at.x, y: at.y, z: at.z, radiusM: EVENT_NOISE_M[kind], source });
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    readout() {
      return {
        light: lastLight,
        exposure01: lastExposure,
        noiseM,
        guards: guards.map((g) => ({
          id: g.id,
          name: g.name,
          type: g.type.id,
          state: g.state,
          meter: g.meter,
          identified: g.identified,
          x: g.body.position.x,
          y: g.body.position.y + (isDown(g.state) ? 0.6 : g.params.standHeight + 0.35),
          z: g.body.position.z,
        })),
        pursued: guards.some((g) => g.state === 'alerted' && g.type.pursues),
        searched: guards.some((g) => g.state === 'search'),
        captured,
      };
    },
    witnesses() {
      const out: Witness[] = [];
      for (const g of guards) {
        if (!g.witnessed || g.state === 'dead') continue;
        out.push({
          id: g.id,
          kind: g.type.witness,
          name: g.name.toLowerCase().startsWith('the ') ? g.name : `the ${g.name.toLowerCase()}`,
          identification: g.identified ? 'person' : 'unknown',
          ...(lastInputs ? { distanceM: dist(g.body.position, lastInputs.player.position) } : {}),
        });
      }
      return out;
    },
    guard(id) {
      return byId.get(id);
    },
    knockOut(id, gameSeconds, outGameS = KNOCKOUT_GAME_S) {
      const g = guardOrThrow(id);
      if (g.state === 'dead') return;
      setState(g, 'unconscious');
      g.untilGame = gameSeconds + outGameS;
      g.found = false;
      g.downBy = 'blow';
      g.meter = 0;
    },
    bind(id, gameSeconds) {
      const g = guardOrThrow(id);
      if (g.state !== 'unconscious') return;
      setState(g, 'bound');
      g.untilGame = Math.max(g.untilGame, gameSeconds + BOUND_GAME_S);
      g.found = false;
    },
    kill(id) {
      const g = guardOrThrow(id);
      setState(g, 'dead');
      g.found = false;
      g.witnessed = false;
    },
    makeDrunk(id, gameSeconds, passOutInGameS) {
      const g = guardOrThrow(id);
      if (isDown(g.state)) return;
      setState(g, 'drunk');
      g.untilGame = gameSeconds + passOutInGameS;
    },
    bribe(id, untilGameSeconds) {
      const g = guardOrThrow(id);
      if (isDown(g.state)) return;
      g.meter = 0;
      g.witnessed = false;
      setState(g, 'bribed');
      g.untilGame = untilGameSeconds;
    },
    witnessAct(except) {
      const p = lastInputs?.player.position;
      const out: Guard[] = [];
      if (!p) return out;
      for (const g of guards) {
        if (g.id === except || !aware(g) || g.state === 'bribed' || !g.glimpse?.seen) continue;
        alert(g, p);
        g.witnessed = true;
        out.push(g);
      }
      return out;
    },
    faceToFace(id, light01, fame01) {
      const g = guardOrThrow(id);
      if (!g.identified) {
        // Close and talking: a lit face is learned at once, a dark one half-way.
        g.recognition = Math.min(1, g.recognition + 0.35 + 0.5 * light01 + 0.3 * fame01);
        if (g.recognition >= 1) {
          g.identified = true;
          emit({ type: 'PlayerIdentified', npc: g.id });
        }
      }
      return g.identified;
    },
    wary(id) {
      const g = guardOrThrow(id);
      if (!aware(g) || g.state === 'alerted') return;
      const p = lastInputs?.player.position;
      g.meter = Math.max(g.meter, SUSPICIOUS + 0.05);
      g.stimulus = p ? { x: p.x, z: p.z } : g.stimulus;
      if (g.state !== 'suspicious') setState(g, 'suspicious');
    },
    moveBody(id, at) {
      const g = guardOrThrow(id);
      if (!isDown(g.state)) return;
      g.body.position.x = at.x;
      g.body.position.y = at.y;
      g.body.position.z = at.z;
      g.body.velocity.x = 0;
      g.body.velocity.y = 0;
      g.body.velocity.z = 0;
      g.previous.x = at.x;
      g.previous.y = at.y;
      g.previous.z = at.z;
    },
    sink(id) {
      const g = guardOrThrow(id);
      if (g.state !== 'dead') setState(g, 'dead');
      g.found = true;
      g.witnessed = false;
    },
  };
  return self;
}
