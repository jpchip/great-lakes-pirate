import type { PointerLook } from '../core/pointer-look';
import { calendarDate, dayAndHour } from '../core/time';
import { Rng } from '../core/rng';
import {
  COLD,
  freshClimbOut,
  freshThinIce,
  iceThicknessUnderfoot,
  iceUnderfoot,
  stepClimbOut,
  stepThinIce,
  weakness,
  type ClimbOut,
} from '../sim/cold/footing';
import {
  coldHealthDrainS,
  freshWarmth,
  stepWarmth,
  warmAboard,
  warmthStage,
  WARMTH_WARNINGS,
  type Warmth,
  type WarmthStage,
} from '../sim/cold/warmth';
import {
  loadSled,
  sledFree,
  sledKg,
  sledSpeedMul,
  sledUsed,
  towSled,
  unloadSled,
  type Sled,
} from '../sim/cold/sled';
import { TrackLog } from '../sim/cold/tracks';
import { roadDistance } from '../sim/cold/road';
import { holeReach, iceGround, punchHole, type AshoreWinter } from './cold';
import type { GameContext } from '../modes/context';
import type { WinterGround } from '../audio/winter-mix';
import type { Mode } from '../modes/machine';
import { tickOnFootClock } from '../modes/on-foot';
import type { SailingView } from '../modes/sailing';
import type { FootFrame, GuardFrame } from '../render/onfoot/foot-view';
import {
  BADLY_HURT,
  coldDrainPerS,
  coldWord,
  fallDamage,
  heal,
  MAX_HEALTH,
  secondsToDrown,
} from '../sim/ashore/body';
import {
  bowPoint,
  createRowboat,
  launchRefusal,
  ROWBOAT,
  stepRowboat,
  swamped,
  type RowboatState,
} from '../sim/ashore/rowboat';
import type { HarborLayout, PlacedPier } from '../sim/harbors';
import type { MooringBerth } from '../sim/sailing/hazards';
import type { Pose } from '../sim/terrain/test-bay';
import type { ZoneTerrain } from '../sim/terrain/zone-terrain';
import { climateAt } from '../sim/weather/climate';
import type { AshoreState, RowboatSave, WorldState } from '../sim/world-state';
import type { DistrictDef, DistrictMark } from '../../data/schemas/districts';
import type { IslandAshore } from './island-ashore';
import type { Caves } from './caves';
import type { GameLegends } from './legends';
import { cavesIn } from '../sim/caves/caves';
import { CaveGround } from './onfoot/cave-ground';
import type { IslandPosse } from './island-posse';
import type { PlacedStation } from '../sim/light-stations';
import type { PlacedIsland } from '../sim/islands/on-foot';
import type { StationSoundView } from './onfoot/station-watch';
import type { XZ } from './onfoot/nav';
import {
  districtBerthPiers,
  districtForHarbor,
  insideDistrict,
  landInDistrict,
  loadDistrictAssets,
  shipCollider,
  type DistrictLanding,
} from './district/district-ashore';
import type { DistrictFrame } from './district/ground';
import { bobSystem, snapshotTransforms, type Entity, type Transform } from './ecs';
import { buoyancySystem } from './buoyancy';
import {
  ASHORE_HALF_M,
  beachStep,
  rockStep,
  buildAshoreScene,
  gangwayAt,
  type AshoreScene,
} from './onfoot/ashore-scene';
import { FollowCamera, ROWING_CAMERA, roofOver } from './onfoot/camera';
import { createLean, leaning, resetLean, stepLean, type Lean } from './onfoot/lean';
import { footprintDistance, type Collider, type Push } from './onfoot/colliders';
import type { Watch } from './onfoot/watch';
import { cardPlayers, keeperSpot, keeperType } from './onfoot/shops';
import { crewFigures, shipWords } from './onfoot/moored';
import type { FootToolsSnapshot } from '../ui/hud/foot-tools-model';
import type { GuardReadout, StealthReadout } from './onfoot/stealth';
import { Footsteps, type Surface } from './onfoot/noise';
import type { IslandWildlife } from './onfoot/wildlife';
import { WILDLIFE } from '../sim/wildlife/defs';
import type { Gait } from './onfoot/controller';
import { withinHours } from './onfoot/conduct';
import { gameTools } from './onfoot/tools';
import {
  type ControllerParams,
  climbDownLadder,
  createCharacter,
  DEFAULT_CONTROLLER,
  grabLadder,
  ladderTopNear,
  placeCharacter,
  stepCharacter,
  type CharacterState,
} from './onfoot/controller';

/**
 * Going ashore (plan 03 §7, plan 08 §20.4 piece A; Phase 7). G at a berth puts you on
 * the pier by the gangway; G at anchor puts the boat over the side and you in it, to row
 * the short way to a beach (decision 2). On foot it's the S5 controller with ladders,
 * vaults and climbs, falls that hurt, and swimming in cold water that drains health.
 * F interacts: go aboard at the gangway or alongside, step ashore from a beached boat,
 * shove off, climb in, climb a ladder down. Coming back aboard leaves you at the helm,
 * still alongside or at anchor, with the boat hoisted in.
 *
 * The world runs on at R = 6 behind you; the schooner rides at her berth or anchor.
 */

export interface AshoreDeps {
  ctx: GameContext;
  /** The player's schooner: her transform, hazards (mooring) and sailing state. */
  ship: Entity;
  /** Her hull for the on-foot scene: length, beam, deck height. */
  hull: { lengthM: number; beamM: number; deckM: number };
  terrain(): ZoneTerrain | undefined;
  harbors(): readonly HarborLayout[];
  /** Every berth in the zone, free or taken. */
  berths(): readonly MooringBerth[];
  /** True inside a harbor set piece's footprint. */
  inTown(x: number, z: number): boolean;
  /** Significant wave height at a point, m. */
  hsAt(x: number, z: number): number;
  /** Another reason you can't go ashore now (an arena, a hunt, a screen open), or none. */
  blocked(): string | undefined;
  /** The fade to fog with a line, with `work` done under it. */
  fade(title: string, line: string, work: () => void): Promise<void>;
  /** Enters the on-foot mode, or back to the helm. */
  transition(to: 'onFoot' | 'sailing'): void;
  notice(text: string): void;
  /** An autosave (plan 16 §4.1); skipped by the saver while in danger. */
  save(): Promise<void>;
  /** Your health ran out on foot: the run ends. */
  died(cause: FootDeath): void;
  /**
   * Winter on foot (Phase 9 piece M): the ice to walk on, the cold, the sled and the ice
   * road. Absent, the lake never freezes underfoot and the cold never bites.
   */
  winter?: AshoreWinter | undefined;
  /** Cast away from a lost ship (decision 2), you've reached dry land. */
  castawayLanded?(): void;
  look: PointerLook;
  /**
   * Where a docks district sits in this zone (Phase 7): its frame from the harbor's set
   * piece. Without it, every landing is piece A's stand-in scene.
   */
  districtFrame?(def: DistrictDef): DistrictFrame | undefined;
  /** The night watch for a district you've landed in (piece D's guards), if any. */
  watch?(
    landing: DistrictLanding,
    onCaptured: (by: string) => void,
    jailbreak?: JailbreakStart,
  ): Watch | undefined;
  /** Out of the lockup and aboard your ship (piece G): you're off your feet at the helm. */
  jailbroke?(): void;
  /**
   * A guard took you on foot: `by` is their npc type, `conduct` what he caught you at (a
   * `ConductReason`, if anything was amiss) and `charge` the gravest crime the watch has
   * on you tonight (`crime.killing`), if any. You're already off your feet.
   */
  captured?(by: string, conduct?: string, charge?: string): void;
  /**
   * The walkable islands (plan 08 §20.4 piece H): a landing on one builds it whole on its
   * 1 m tiles with its quarry, and F searches its cairns and opens the stash's strongbox.
   */
  island?: IslandAshore | undefined;
  /**
   * The marshal posse on a walkable island, at Wanted tier 4 and up (piece H): `boat` is
   * where yours lies now (the rowboat, or the ship), scene meters, for them to land by.
   */
  posse?(island: string, scene: AshoreScene, boat: () => XZ): IslandPosse | undefined;
  /**
   * A lighthouse station's keepers on its pad (plan 11 §18.4 piece H), answering the
   * district watch's shape so the tool belt and the HUD work there.
   */
  stationWatch?(
    station: PlacedStation,
    scene: AshoreScene,
    island?: PlacedIsland,
  ): Watch | undefined;
  /**
   * An island's residents where it has no light station (plan 11 §18.4 piece Q): Madeline's
   * farmers and villagers, Hermit's and Basswood's people, on the same shape.
   */
  islandWatch?(island: PlacedIsland, scene: AshoreScene): Watch | undefined;
  /**
   * The island's animals and the hunt (plan 11 §18.4 piece V): deer, a bear or wolves about
   * on this landing, the rifle, dressing and carrying a carcass, the sign and the traps.
   * `hurt` is a bite or a mauling; `noise` a shot, for the island's people to hear.
   */
  wildlife?(
    island: PlacedIsland,
    scene: AshoreScene,
    landing: XZ,
    hooks: { hurt(amount: number): void; shot(at: { x: number; y: number; z: number }): void },
  ): IslandWildlife | undefined;
  /**
   * The trees and shore rocks the renderer plants over a rectangle (zone meters), and the
   * share the quality preset draws: they get trunks you walk around.
   */
  plants?(box: {
    minX: number;
    minZ: number;
    maxX: number;
    maxZ: number;
  }): { trees: Float32Array; rocks: Float32Array; density: number } | undefined;
  /**
   * A counter in a district you can trade at now (piece F's `shop` marks): the prompt and
   * what F does there, or undefined when it's shut or there's nobody to deal with.
   */
  shop?(district: DistrictLanding, mark: DistrictMark): { text: string; act(): void } | undefined;
  /**
   * The zone's sea caves (Phase 9 piece S): their rock solid and their floors walked in the
   * scene, rowing in only in a calm, the surge, an ice cave's ice, and their caches.
   */
  caves?: Caves | undefined;
  /** Clues and legends (Phase 9 piece T): marks read and spots dug, on foot in the zone. */
  legends?: Pick<GameLegends, 'prompt'> | undefined;
  /** The view drawn each frame; its `foot` is set while you're ashore. */
  view?: (SailingView & { foot: FootFrame | undefined }) | undefined;
  /** Your own body, heard (piece I): each stride, and each time you come down. */
  sounds?: {
    /**
     * A stride on `surface` at a gait, with the radius the guards hear it at, meters; in
     * winter, `ground` says it was on snow, bare lake ice or snow over the ice (piece N).
     */
    step(surface: Surface | 'water', gait: Gait, radiusM: number, ground?: WinterGround): void;
    /** You landed at `speed` m/s, on the ground or into the lake. */
    landed(speed: number, inWater: boolean): void;
  };
}

/** What ends a run on foot. */
export type FootDeath = 'drowned' | 'fell' | 'froze' | 'through_ice' | 'mauled';

/** What the winter readout shows (piece M), for the HUD and the dev hooks. */
export interface WinterSnapshot {
  warmth: number;
  wet: number;
  stage: WarmthStage;
  /** Standing on the lake's ice, and how thick it is under you, cm. */
  onIce: boolean;
  thicknessCm: number | undefined;
  /** Thin ice working toward breaking, 0–1, and its stage. */
  stress: number;
  thin: string;
  /** In the water through the ice: seconds left to haul out. */
  climbLeftS: number | undefined;
  /** The holes broken this landing, and the scene's ground under you (debugging). */
  holes: { x: number; z: number }[];
  ground: number | undefined;
  sled:
    | { x: number; z: number; hitched: boolean; cu: number; load: { good: string; qty: number }[] }
    | undefined;
  prints: number;
  /** On the ice road's lane (within 10 m), how far along it, 0–1. */
  road: number | undefined;
}

/** What the sounds ashore read of where you are (piece I), zone meters. */
export interface AshoreSound {
  player: { x: number; y: number; z: number };
  swimming: boolean;
  waterC: number;
  place: 'district' | 'island' | 'shore';
  /** The island walked, by its id in `islands.json` (piece Y). */
  island?: string | undefined;
  /** Under a roof. */
  inside: boolean;
  /** The saloon's bar, whether it keeps its hours now, and whether you're in the room. */
  saloon: { x: number; z: number; open: boolean; within: boolean } | undefined;
  guards: GuardReadout[];
  /** F held on a lock with a pick: how far it's got, 0–1. */
  picking: number | undefined;
  /** A lighthouse station's lamp and house, offsets from you (Phase 9 piece J). */
  station?: StationSoundView | undefined;
  /** Winter in you and under you: warmth, thin ice, snow, the sled (Phase 9 piece N). */
  winter?:
    | {
        stage: WarmthStage;
        onIce: boolean;
        thin: 'sound' | 'cracking' | 'groaning' | 'broken';
        stress: number;
        moving: boolean;
        snowLies: boolean;
        sled: { x: number; z: number; hitched: boolean; cu: number } | undefined;
      }
    | undefined;
}

/** A jailbreak begun (piece G): what the lockup's night is made with. */
export interface JailbreakStart {
  /** Tier 5's one chance. */
  execution: boolean;
  /** What the jailer would take as a promise, cents, if he'd hear one. */
  promiseCents: number | undefined;
  /** Game seconds the attempt is over. */
  dawnAt: number;
  /** Where your ship lies, as the fade says it: "the city dock". */
  dock?: string;
}

/** Where F would act, and what it would do. */
interface Prompt {
  text: string;
  /** Held this long to act, s (a dig, piece T); absent, a press. */
  holdS?: number;
  act(): void;
}

export interface GameAshore {
  readonly mode: Mode;
  /** Ashore: on foot, swimming or in the boat. */
  readonly active: boolean;
  readonly inBoat: boolean;
  readonly character: CharacterState;
  /** Leaning (Q/E): how far, and the head's offset in the scene's meters. */
  readonly lean: Readonly<Lean>;
  readonly boat: RowboatState | undefined;
  readonly boatState: RowboatSave['state'];
  readonly scene: AshoreScene | undefined;
  readonly from: AshoreState['from'] | undefined;
  /** Why you can't go ashore here now, or undefined if G would take you. */
  refusal(): string | undefined;
  /** True when a built on-foot area exists at the current berth or anchor. */
  landingHere(): boolean;
  /** G: ashore from a berth, or into the boat at anchor. The refusal, if not. */
  goAshore(): Promise<string | undefined>;
  /**
   * Into the lockup's cell for a jailbreak (piece G), the ship lying impounded at her
   * berth: the refusal if there's no district to play it in.
   */
  breakOut(start: JailbreakStart): Promise<string | undefined>;
  /** A jailbreak is under way: no save keeps you ashore, and the gangway is the way out. */
  readonly jailbreak: JailbreakStart | undefined;
  /** Back aboard, however you are: ends ashore at the helm. */
  goAboard(): Promise<void>;
  /** From a beached boat onto the beach. */
  stepAshore(): Promise<string | undefined>;
  /** Off your feet and back to the helm at once, behind someone else's fade. */
  leave(): void;
  /** Why the boat can't take you off a foundering ship here (no land near, too much sea). */
  castawayRefusal(): string | undefined;
  /**
   * Abandon ship into the boat (plan 08 §20.6 decision 2): she's gone, and you row for the
   * nearest land. False if the boat can't be got away here.
   */
  castAway(): boolean;
  /**
   * Shipless (Phase 8 piece G): on foot at a zone point with no ship to go back to, as a
   * castaway is, but already landed. `anchor` is where her hull lies hidden, kept for a
   * reload. Leaving (a launch, the yard) goes back to the helm.
   */
  landShipless(
    at: { x: number; z: number; heading: number },
    anchor?: { x: number; z: number },
  ): void;
  /** The F prompt now, for the HUD. */
  prompt(): string | undefined;
  /** The HUD's body readout. */
  hud(): FootHudSnapshot;
  /** Writes where you are into the state, just before a save. */
  record(state: WorldState): void;
  /** Back ashore as the save left you (the ship already moored as it was). */
  resume(saved: AshoreState): void;
  /** For the dev hooks: where to put you, zone meters. */
  teleport(x: number, z: number, y?: number): void;
  /**
   * Rebuilds the walked scene where you are (Phase 8 piece C): a hideout's pieces were
   * built or taken down, so its solids changed. Nothing in a district.
   */
  refreshScene(): void;
  /**
   * The build camera (Phase 8 piece C): while set, the view looks from where it says
   * (zone meters) instead of from behind you.
   */
  cameraOverride:
    | (() => {
        position: { x: number; y: number; z: number };
        target: { x: number; y: number; z: number };
      })
    | undefined;
  /** For the dev hooks and screenshots: face a zone bearing, the camera behind you. */
  face(bearing: number, pitch?: number): void;
  /** The docks district you're walking, if this landing has one (Bayfield). */
  readonly district: DistrictLanding | undefined;
  /** The walkable island the scene is built on (its 1 m tiles), if any. */
  readonly island: string | undefined;
  /** The marshal posse on the island you're on, if any (piece H). */
  readonly posse: IslandPosse | undefined;
  /** The animals about on the island you're on, and the hunt (piece V). */
  readonly wildlife: IslandWildlife | undefined;
  /** Its night watch: piece E's tools act on `watch.stealth`. */
  readonly watch: Watch | undefined;
  /** A guard is chasing you ashore: the danger snapshot, no autosave. */
  readonly pursued: boolean;
  /** Where you stand, zone meters (the district's local frame turned out). */
  zoneAt(): { x: number; y: number; z: number; heading: number };
  /**
   * The captain and the rowboat, zone meters, for a look at the chart from on foot;
   * undefined off your feet. No boat once you're ashore of it (hoisted, or never taken).
   */
  chartPositions(): { captain: Pose; boat?: Pose } | undefined;
  /** The watch's readout with the guards placed in zone meters, for the stealth HUD. */
  stealthReadout(): StealthReadout | undefined;
  /** The tool belt, conduct and the F prompt (piece E), when the watch has tools. */
  toolsHud(): FootToolsSnapshot | undefined;
  /** Where a crate is stowed aboard (the gangway of the berth she lies at), scene meters. */
  stowPoints(): { x: number; y: number; z: number }[];
  /** A scene point (a district's local meters) in zone meters. */
  toZone(x: number, z: number): { x: number; z: number };
  /** What the sounds ashore read (piece I): undefined off your feet or at the oars. */
  sound(): AshoreSound | undefined;
  /** Winter on foot (piece M): warmth, the ice under you, the sled, your tracks. */
  winter(): WinterSnapshot;
  /** For the dev hooks: down onto the ice road from wherever you stand (piece M). */
  iceRoad(): Promise<string | undefined>;
  /** The prints you've left (zone meters), for the dev hooks and the view. */
  readonly tracks: TrackLog;
}

/** What the on-foot HUD shows (plan 13 §4.2's minimum for piece A). */
export interface FootHudSnapshot {
  health: number;
  /** In the water: how cold it is and roughly how long you'd last. */
  cold: { word: ReturnType<typeof coldWord>; waterC: number; lastS: number } | undefined;
  hurt: boolean;
  prompt: string | undefined;
  inBoat: boolean;
  swimming: boolean;
  gait: string;
  /** A jailbreak under way (piece G): the line that stands on the HUD. */
  banner: { text: string; oneChance: boolean } | undefined;
  /** The warmth meter (piece M), when the cold has a say. */
  warmth: { value: number; stage: WarmthStage; wet: boolean } | undefined;
}

/** You can reach the gangway, the boat or a ladder from this far. */
const REACH_M = 2.2;
/** You can deal across a shop's counter from this far. */
const SHOP_REACH_M = 2.4;
/** In the boat, this close to the schooner's side you can climb aboard. */
const ALONGSIDE_M = 3.5;
/** Abandoning ship, the boat is got away only this close to land, zone m (plan 08 §20.6). */
export const CASTAWAY_SHORE_M = 1500;
/** Shown when only the zone stand-in exists (no district or hero island). */
export const NO_WALKABLE_ASHORE = 'Nothing ashore here to walk';
/** The scene is rebuilt around the boat when she comes this close to its edge. */
const REBUILD_MARGIN_M = 60;

export function attachAshore(deps: AshoreDeps): GameAshore {
  const { ctx } = deps;
  const input = ctx.input;
  const state = ctx.state;
  const character = createCharacter({ x: 0, y: 0, z: 0 });
  // Q/E: the head and the camera out to one side, the feet where they are (plan 08 §3.1).
  const lean = createLean();
  const previous: Transform = { position: { x: 0, y: 0, z: 0 }, heading: 0 };
  const walkCamera = new FollowCamera();
  const rowCamera = new FollowCamera(ROWING_CAMERA);
  let active = false;
  let from: AshoreState['from'] | undefined;
  let berthId: string | undefined;
  let anchor: { x: number; z: number } | undefined;
  let scene: AshoreScene | undefined;
  let inBoat = false;
  let boat: RowboatState | undefined;
  let boatPrev = { x: 0, z: 0, heading: 0 };
  let boatState: RowboatSave['state'] = state.player.rowboat.state;
  let prompt: Prompt | undefined;
  let busy = false;
  let lastHurt: FootDeath = 'drowned';
  let elapsed = 0;
  let lastDt = 1 / 60;
  let dead = false;
  /** Cast away: told main once you're on dry land. */
  let landedTold = false;
  /** Your strides, counted for the footstep sounds (piece I). */
  const strides = new Footsteps();
  /** This tick's stride, its footstep radius (0 between strides): for the animals' ears. */
  let strideM = 0;
  const strideFrom = { x: 0, z: 0, fresh: false };
  let underRoof = false;
  /** The docks district this landing walks (local meters), or none (zone meters). */
  let district: DistrictLanding | undefined;
  let cameraOverride: GameAshore['cameraOverride'];
  let watch: Watch | undefined;
  /** Taken by a guard: the fade to the lockup is under way. */
  let taken = false;
  /** The jailbreak this landing is (piece G), if it is one. */
  let jailbreak: JailbreakStart | undefined;
  /** The walkable island the scene is built on, if any. */
  let sceneIsland: string | undefined;
  /** The marshal posse on the island the scene is built on, if any. */
  let posse: IslandPosse | undefined;
  /** The island's animals on this landing (piece V). */
  let wild: IslandWildlife | undefined;

  // --- Winter on foot (piece M) ----------------------------------------------------------
  const winter = deps.winter;
  const seedNum = winter ? Rng.fromSeed(`${winter.seed}:ice`).int(0, 1 << 30) : 0;
  const warm = (): Warmth => (state.player.warmth ??= freshWarmth());
  /** The scene's lake bed, before the ice was laid over it (scene meters). */
  let bedAt: ((x: number, z: number) => number) | undefined;
  let thin = freshThinIce();
  /** Through the ice: hauling out, and where the hole is (zone meters). */
  let climb: ClimbOut | undefined;
  /** F held on a held prompt (piece T's dig): which, and how long. */
  let holding: { text: string; s: number } | undefined;
  let hole: { x: number; z: number } | undefined;
  /** Holes broken this landing, zone meters: still open when the scene is rebuilt. */
  const holes: { x: number; z: number }[] = [];
  let iceNow: { thicknessCm: number } | undefined;
  /** Your prints in the snow, zone meters. */
  const tracks = new TrackLog();
  let lastClock = state.environment.clock.gameSeconds;
  let followS = 0;
  const followed = new Map<string, number>();
  /** The sled's on your rope. She lies in `state.player.sled` (zone meters) while out. */
  let hitched = false;
  const sled = (): Sled | undefined => state.player.sled;
  const weightOf = (g: string): number => winter?.weightOf(g) ?? 1;

  // The scene's frame: a district's local meters, or the zone's own.
  const toScene = (p: { x: number; z: number }): { x: number; z: number } =>
    district ? district.frame.toLocal(p) : { x: p.x, z: p.z };
  const toZone = (x: number, z: number): { x: number; z: number } =>
    district ? district.frame.toZone(x, z) : { x, z };
  const headingToZone = (h: number): number => (district ? district.frame.headingToZone(h) : h);
  const headingToScene = (h: number): number => (district ? district.frame.headingToLocal(h) : h);

  const hazards = (): NonNullable<Entity['hazards']> => {
    const h = deps.ship.hazards;
    if (!h) throw new Error('ashore: the ship has no hazards');
    return h;
  };
  const shipPose = (): Pose => {
    const t = deps.ship.transform;
    return { x: t?.position.x ?? 0, z: t?.position.z ?? 0, heading: t?.heading ?? 0 };
  };
  const waterC = (): number => climateAt(calendarDate(state.environment.clock.gameSeconds)).waterC;

  /** The pier a berth lies at. */
  const pierOf = (id: string | undefined): PlacedPier | undefined => {
    const dockId = deps.berths().find((b) => b.id === id)?.dockId;
    if (!dockId) return undefined;
    for (const l of deps.harbors()) {
      const p = l.piers.find((x) => x.id === dockId);
      if (p) return p;
    }
    return undefined;
  };

  /**
   * The district to land in from this pier (Bayfield), loaded: only where the gangway
   * lies inside it. Undefined means piece A's stand-in scene.
   */
  const districtLanding = async (pier: PlacedPier): Promise<DistrictLanding | undefined> => {
    if (!deps.districtFrame) return undefined;
    const harbor = deps.harbors().find((l) => l.piers.includes(pier));
    const def = harbor && districtForHarbor(harbor.def.id);
    const frame = def && deps.districtFrame(def);
    if (!def || !frame) return undefined;
    const assets = await loadDistrictAssets(def);
    if (!assets) return undefined;
    const gang = frame.toLocal(gangwayAt(pier, shipPose()));
    const landing = landInDistrict(assets, frame, shipCollider(frame, shipPose(), deps.hull));
    return insideDistrict(landing.model, gang.x, gang.z) ? landing : undefined;
  };

  /**
   * The gangway in the scene's frame. In a district the kit's pier can sit a little off the
   * harbor kit's (they're drawn from the same plan, a cell apart at most), so it's the
   * nearest deck to where the harbor kit puts it.
   */
  const gangway = (pier: PlacedPier): { x: number; y: number; z: number } => {
    const at = gangwayAt(pier, shipPose());
    if (!district) return at;
    const m = district.model;
    const l = toScene(at);
    const dry = (x: number, z: number): boolean => m.floorAt(x, z) > m.waterLevel + 0.6;
    if (!dry(l.x, l.z)) {
      search: for (let r = 0.5; r <= 4; r += 0.5) {
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = l.x + Math.sin(a) * r;
          const z = l.z - Math.cos(a) * r;
          if (dry(x, z)) {
            l.x = x;
            l.z = z;
            break search;
          }
        }
      }
    }
    return { x: l.x, y: m.floorAt(l.x, l.z), z: l.z };
  };

  /** Into a district: its scene, and its watch on duty. */
  const enterDistrict = (landing: DistrictLanding, breaking?: JailbreakStart): void => {
    posse = undefined;
    wild = undefined;
    district = landing;
    scene = landing.scene;
    taken = false;
    jailbreak = breaking;
    watch = deps.watch?.(landing, (by) => takenBy(by), breaking);
  };

  /** A guard has you: off your feet behind the fade, and the jail takes it from there. */
  const takenBy = (by: string): void => {
    if (taken) return;
    taken = true;
    const who =
      by === 'npc.watchman'
        ? 'The watchman'
        : by === 'npc.marshal'
          ? 'The marshal'
          : 'The constable';
    const conduct = watch?.arrestReason();
    // He has your face now: tonight's crimes go to your name, the gravest the charge.
    const charge = watch?.footLaw?.arrest({
      id: `captor.${by}`,
      kind: by === 'npc.watchman' ? 'watchman' : 'constable',
      name: who.charAt(0).toLowerCase() + who.slice(1),
      identification: 'person',
    });
    const line = jailbreak ? `${who} has you: back to the cell` : `${who} takes you in hand`;
    void deps.fade(jailbreak ? 'Recaptured' : 'Taken', line, () => {
      leave();
      deps.captured?.(by, conduct, charge);
    });
  };

  /** A box to build the next scene over instead of a square (the ice road's whole length). */
  let roadBox: { minX: number; minZ: number; maxX: number; maxZ: number } | undefined;
  const build = (center: { x: number; z: number }): AshoreScene | undefined => {
    // A district is the whole scene: nothing to rebuild around you.
    if (district) return district.scene;
    const terrain = deps.terrain();
    if (!terrain) return undefined;
    const g = terrain.height;
    // A walkable island is built whole on its 1 m tiles; elsewhere a square of the 4 m.
    const island = deps.island?.sceneFor(center);
    sceneIsland = island?.island;
    const box = island?.box ?? {
      minX: center.x - ASHORE_HALF_M,
      minZ: center.z - ASHORE_HALF_M,
      maxX: center.x + ASHORE_HALF_M,
      maxZ: center.z + ASHORE_HALF_M,
    };
    const bed = island?.ground ?? {
      heightAt: (x: number, z: number) => terrain.heightAt(x, z),
      x0: g.x0,
      z0: g.z0,
      step: g.step,
    };
    bedAt = (x, z) => bed.heightAt(x, z);
    const built = buildAshoreScene({
      // In winter the lake's ice lies over its water (piece M).
      ground: winter ? iceGround(bed, winter) : bed,
      center,
      box: roadBox ?? box,
      piers: deps.harbors().flatMap((l) => l.piers),
      buildings: deps.harbors().flatMap((l) => l.buildings),
      // Cast away, she's gone: nothing to bump into or climb aboard.
      ship: from === 'wreck' ? undefined : { pose: shipPose(), ...deps.hull },
      inTown: deps.inTown,
      extra: island?.extra,
      ladders: island?.ladders,
      plants: deps.plants?.(box),
      caves: deps.caves && cavesIn(deps.caves.list(), roadBox ?? box),
      caveIce: deps.caves?.iceTop,
    });
    if (winter) {
      for (const h of holes) punchHole(built.ground, h.x, h.z, COLD.thin.holeM);
    }
    roadBox = undefined;
    posse =
      island && deps.posse
        ? deps.posse(island.island, built, () => {
            const at = boat ?? shipPose();
            return { x: at.x, z: at.z };
          })
        : undefined;
    // A lighthouse station's keepers (plan 11 §18.4 piece H) and the island's residents
    // (piece Q): the tools work on them, and they see and report.
    watch?.footLaw?.dispose();
    watch =
      island?.station && deps.stationWatch
        ? deps.stationWatch(island.station, built, island.placed)
        : island?.placed?.residents.length && deps.islandWatch
          ? deps.islandWatch(island.placed, built)
          : undefined;
    // The island's animals (piece V): a rebuild for a hideout's pieces keeps those about.
    if (!island?.placed || wild?.island !== island.placed.id) {
      wild =
        island?.placed && deps.wildlife
          ? deps.wildlife(island.placed, built, center, {
              hurt: (amount) => hurt(amount, 'mauled'),
              shot: (at) =>
                watch?.stealth.noise({
                  kind: 'gunshot',
                  x: at.x,
                  y: at.y,
                  z: at.z,
                  radiusM: WILDLIFE.hunt.noiseM,
                  source: 'player',
                }),
            })
          : undefined;
    }
    return built;
  };

  // --- Going ashore and back -----------------------------------------------------------

  /** Where the boat goes over the side at anchor (same as `overTheSide`). */
  const boatLaunchAt = (): { x: number; z: number } => {
    const p = shipPose();
    const terrain = deps.terrain();
    const off = deps.hull.beamM / 2 + ROWBOAT.beamM;
    const side = [1, -1]
      .map((s) => {
        const x = p.x + Math.cos(p.heading) * off * s;
        const z = p.z + Math.sin(p.heading) * off * s;
        return { x, z, d: terrain?.shoreDistanceAt(x, z) ?? 0 };
      })
      .sort((a, b) => a.d - b.d)[0];
    return { x: side?.x ?? p.x, z: side?.z ?? p.z };
  };

  /**
   * A pier with no docks district whose gangway lies on a walkable island or pad (the
   * Stockton landing, the Siskiwit camp's dock): you step off onto it and walk.
   */
  const islandPier = (pier: PlacedPier): boolean => {
    if (!deps.island) return false;
    const harbor = deps.harbors().find((l) => l.piers.includes(pier));
    if (harbor && districtForHarbor(harbor.def.id)) return false;
    return deps.island.walkableAt(gangwayAt(pier, shipPose()));
  };

  /** A pier of a docks district (Bayfield's): going ashore there is into the district. */
  const districtLandingPier = (pier: PlacedPier): boolean => {
    const harbor = deps.harbors().find((l) => l.piers.includes(pier));
    const def = harbor && districtForHarbor(harbor.def.id);
    return !!def && !!deps.districtFrame?.(def) && districtBerthPiers(def).has(pier.id);
  };

  const landingHere = (): boolean => {
    if (!deps.terrain()) return false;
    const h = hazards().state;
    if (h.mooring === 'docked') {
      const pier = pierOf(h.berthId);
      if (!pier) return false;
      // A hideout's landing (Stockton's, the Siskiwit camp's dock): down onto the pier
      // and the walkable ground it reaches, no boat needed.
      if (islandPier(pier)) return true;
      const harbor = deps.harbors().find((l) => l.piers.includes(pier));
      const def = harbor && districtForHarbor(harbor.def.id);
      // Frozen in at a pier with no district (piece M): down onto the ice beside her.
      if (!def || !deps.districtFrame) return iceBySide();
      if (!deps.districtFrame(def)) return false;
      return districtBerthPiers(def).has(pier.id);
    }
    if (h.mooring !== 'free' || h.anchor !== 'down' || h.dragging) return false;
    const at = boatLaunchAt();
    return !!deps.island?.walkableAt(at) || iceBySide();
  };

  /** The lake's ice lies by her side, there to step down onto (piece M). */
  const iceBySide = (): boolean => {
    if (!winter) return false;
    const at = boatLaunchAt();
    if ((deps.terrain()?.heightAt(at.x, at.z) ?? 1) > 0) return false;
    return iceUnderfoot(winter.iceAt(at.x, at.z));
  };

  /** Down her side onto the ice (piece M): no boat, you walk from where she lies. */
  const ontoTheIce = (h: ReturnType<typeof hazards>['state']): void => {
    const docked = h.mooring === 'docked';
    from = docked ? 'berth' : 'anchor';
    berthId = docked ? h.berthId : undefined;
    anchor = docked ? undefined : { x: h.anchorX, z: h.anchorZ };
    district = undefined;
    watch = undefined;
    jailbreak = undefined;
    inBoat = false;
    boat = undefined;
    boatState = 'stowed';
    const at = boatLaunchAt();
    scene = build(at);
    placeCharacter(character, { x: at.x, y: COLD.ice.topM, z: at.z }, shipPose().heading);
    copyPrevious();
    tracks.lift();
    enter();
  };

  const refusal = (): string | undefined => {
    if (active) return 'Already ashore';
    const other = deps.blocked();
    if (other) return other;
    const h = hazards().state;
    if (h.foundering) return 'She is going down: F to abandon ship';
    if (!deps.terrain()) return 'No shore here';
    if (h.mooring === 'docked' && pierOf(h.berthId)) {
      return landingHere() ? undefined : NO_WALKABLE_ASHORE;
    }
    if (h.mooring !== 'free') return 'Wait until she is alongside';
    if (h.anchor !== 'down' || h.dragging) return 'Anchor or tie up first (X, or F at a berth)';
    if (!landingHere()) return NO_WALKABLE_ASHORE;
    if (iceBySide()) return undefined;
    const at = shipPose();
    return launchRefusal(deps.hsAt(at.x, at.z));
  };

  const enter = (): void => {
    active = true;
    dead = false;
    walkCamera.yaw = character.heading;
    walkCamera.pitch = 0.25;
    rowCamera.yaw = boat?.heading ?? character.heading;
    rowCamera.pitch = 0.3;
    deps.transition('onFoot');
  };

  const goAshore = async (): Promise<string | undefined> => {
    const why = refusal();
    if (why) return why;
    if (busy) return undefined;
    busy = true;
    const h = hazards().state;
    try {
      if (h.mooring === 'docked') {
        const pier = pierOf(h.berthId) as PlacedPier;
        if (islandPier(pier)) {
          await deps.fade('Ashore', `Down the gangway onto the ${pier.name}`, () => {
            from = 'berth';
            berthId = h.berthId;
            anchor = undefined;
            district = undefined;
            watch = undefined;
            jailbreak = undefined;
            inBoat = false;
            boat = undefined;
            boatState = 'stowed';
            const at = gangwayAt(pier, shipPose());
            scene = build(at);
            // Face along the pier toward the shore.
            placeCharacter(character, at, pier.bearing + Math.PI);
            copyPrevious();
            enter();
          });
        } else if (!districtLandingPier(pier) && iceBySide()) {
          await deps.fade('Onto the ice', 'Down her side onto the ice', () => ontoTheIce(h));
        } else {
          const landing = await districtLanding(pier);
          if (!landing) {
            return NO_WALKABLE_ASHORE;
          }
          await deps.fade('Ashore', `Down the gangway onto the ${pier.name}`, () => {
            from = 'berth';
            berthId = h.berthId;
            anchor = undefined;
            district = undefined;
            watch = undefined;
            inBoat = false;
            enterDistrict(landing);
            // Face along the pier toward the town.
            placeCharacter(character, gangway(pier), headingToScene(pier.bearing + Math.PI));
            copyPrevious();
            enter();
          });
        }
      } else if (iceBySide()) {
        await deps.fade('Onto the ice', 'Down her side onto the ice', () => ontoTheIce(h));
      } else {
        await deps.fade('Into the boat', 'The boat goes over the side', () => {
          from = 'anchor';
          berthId = undefined;
          anchor = { x: h.anchorX, z: h.anchorZ };
          overTheSide();
        });
      }
    } finally {
      busy = false;
    }
    await deps.save();
    return undefined;
  };

  const breakOut = async (start: JailbreakStart): Promise<string | undefined> => {
    if (active) return 'Already ashore';
    if (busy) return 'Not now';
    const h = hazards().state;
    const pier = h.mooring === 'docked' ? pierOf(h.berthId) : undefined;
    if (!pier) return 'The ship is not at her pier';
    busy = true;
    try {
      const landing = await districtLanding(pier);
      if (!landing) return NO_WALKABLE_ASHORE;
      let refused: string | undefined;
      await deps.fade(
        start.execution ? 'One chance' : 'The lockup, that night',
        start.execution
          ? 'In irons, the night before the rope'
          : `The jailer on his round, and your ship at ${start.dock ?? 'the dock'}`,
        () => {
          from = 'berth';
          berthId = h.berthId;
          anchor = undefined;
          district = undefined;
          watch = undefined;
          inBoat = false;
          enterDistrict(landing, start);
          const cell = (watch as Watch | undefined)?.jailbreak?.cell;
          if (!cell) {
            refused = 'There is no cell to break out of here';
            district = undefined;
            scene = undefined;
            watch = undefined;
            jailbreak = undefined;
            from = undefined;
            berthId = undefined;
            return;
          }
          const at = cell.spawn;
          placeCharacter(
            character,
            { x: at.x, y: landing.model.floorAt(at.x, at.z), z: at.z },
            at.heading,
          );
          copyPrevious();
          enter();
        },
      );
      return refused;
    } finally {
      busy = false;
    }
  };

  /** Aboard and away from the lockup's pier: the jailbreak is made. */
  const makeBreak = async (): Promise<void> => {
    if (!active || busy) return;
    busy = true;
    try {
      await deps.fade('Aboard', 'Up the side, and cast off before the alarm', () => {
        leave();
        deps.jailbroke?.();
      });
    } finally {
      busy = false;
    }
  };

  /** The boat over the side nearer the shore, pointing at it, and you at the oars. */
  const overTheSide = (): void => {
    const p = shipPose();
    const launch = boatLaunchAt();
    const off = deps.hull.beamM / 2 + ROWBOAT.beamM;
    const sideSign =
      [1, -1].find((s) => {
        const x = p.x + Math.cos(p.heading) * off * s;
        const z = p.z + Math.sin(p.heading) * off * s;
        return Math.hypot(x - launch.x, z - launch.z) < 0.01;
      }) ?? 1;
    boat = createRowboat(launch.x, launch.z, p.heading + (sideSign * Math.PI) / 2);
    boatState = 'afloat';
    inBoat = true;
    scene = build(boat);
    seatInBoat();
    copyPrevious();
    enter();
  };

  const castawayRefusal = (): string | undefined => {
    if (active) return 'Already ashore';
    const terrain = deps.terrain();
    if (!terrain) return 'No land in reach';
    const p = shipPose();
    if (terrain.shoreDistanceAt(p.x, p.z) > CASTAWAY_SHORE_M) return 'No land in reach';
    return launchRefusal(deps.hsAt(p.x, p.z));
  };

  const castAway = (): boolean => {
    if (busy || castawayRefusal()) return false;
    busy = true;
    from = 'wreck';
    berthId = undefined;
    anchor = undefined;
    landedTold = false;
    void deps
      .fade('Abandon ship', 'Into the boat, and pull clear before she goes', overTheSide)
      .finally(() => {
        busy = false;
        deps.notice('She is gone. Row for the shore.');
      });
    return true;
  };

  const landShipless = (
    at: { x: number; z: number; heading: number },
    hull?: { x: number; z: number },
  ): void => {
    from = 'wreck';
    landedTold = true;
    berthId = undefined;
    anchor = hull ? { ...hull } : undefined;
    district = undefined;
    watch = undefined;
    jailbreak = undefined;
    inBoat = false;
    boat = undefined;
    boatState = 'stowed';
    scene = build(at);
    const ground = scene?.ground.heightAt(at.x, at.z) ?? deps.terrain()?.heightAt(at.x, at.z) ?? 0;
    placeCharacter(character, { x: at.x, y: Math.max(ground, 0) + 0.6, z: at.z }, at.heading);
    copyPrevious();
    if (!active) enter();
  };

  const leave = (): void => {
    // Back aboard by her side, the sled comes aboard with you, her load into the hold.
    const sl = sled();
    const ship = shipPose();
    if (winter && sl && from !== 'wreck' && Math.hypot(sl.x - ship.x, sl.z - ship.z) < 40) {
      unloadSled(sl, winter.hold());
      winter.holdChanged();
      state.player.sled = undefined;
    }
    // A carcass over your shoulders comes aboard with you, into the hold (piece V).
    if (wild?.carrying && from !== 'wreck' && !taken) wild.boatPrompt()?.act();
    wild = undefined;
    hitched = false;
    climb = undefined;
    hole = undefined;
    holes.length = 0;
    deps.caves?.tick({ x: ship.x, y: 0, z: ship.z }, undefined);
    thin = freshThinIce();
    tracks.lift();
    active = false;
    posse = undefined;
    scene = undefined;
    district = undefined;
    watch = undefined;
    jailbreak = undefined;
    inBoat = false;
    boat = undefined;
    boatState = 'stowed';
    prompt = undefined;
    from = undefined;
    berthId = undefined;
    anchor = undefined;
    landedTold = false;
    if (deps.view) deps.view.foot = undefined;
    deps.look.detachListeners();
    deps.transition('sailing');
  };

  const goAboard = async (): Promise<void> => {
    if (!active || busy) return;
    busy = true;
    try {
      await deps.fade(
        'Back aboard',
        inBoat ? 'The boat hoisted in' : 'Up the side and aboard',
        leave,
      );
    } finally {
      busy = false;
    }
    await deps.save();
  };

  const stepAshore = async (): Promise<string | undefined> => {
    if (!active || !inBoat || !boat || busy) return 'Not in the boat';
    const terrain = deps.terrain();
    // Over the bow first; grounded broadside or stern-on, over whichever side is dry. In a
    // sea cave (piece S) the beach is the cave's own, under the cliff.
    const heightAt = (x: number, z: number): number =>
      deps.caves?.floorAt(x, z) ?? terrain?.heightAt(x, z) ?? -100;
    let step = terrain && beachStep(heightAt, bowPoint(boat), boat.heading);
    for (const turn of [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
      if (step || !terrain) break;
      step = beachStep(heightAt, boat, boat.heading + (turn * Math.PI) / 2);
    }
    // No beach: climb out onto the rock if it's low enough (piece R; Gull Island).
    for (const turn of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
      if (step || !terrain) break;
      step = rockStep(heightAt, turn ? boat : bowPoint(boat), boat.heading + (turn * Math.PI) / 2);
    }
    if (!step) return 'No place to step ashore here';
    busy = true;
    const b = boat;
    try {
      await deps.fade('Ashore', 'The boat drawn up on the beach', () => {
        b.speed = 0;
        b.turn = 0;
        boatState = 'beached';
        inBoat = false;
        scene = build(step);
        placeCharacter(character, step, b.heading);
        copyPrevious();
        walkCamera.yaw = b.heading;
      });
    } finally {
      busy = false;
    }
    await deps.save();
    return undefined;
  };

  const shoveOff = (): void => {
    if (!boat) return;
    inBoat = true;
    boatState = 'afloat';
    // Push her off stern first, a boat's length back into the water.
    boat.x -= Math.sin(boat.heading) * 1.2;
    boat.z += Math.cos(boat.heading) * 1.2;
    boat.speed = -0.6;
    seatInBoat();
    rowCamera.yaw = boat.heading;
  };

  const climbIn = (): void => {
    if (!boat) return;
    if (swamped(deps.hsAt(boat.x, boat.z))) {
      deps.notice('Too much sea to bail her out');
      return;
    }
    inBoat = true;
    boatState = 'afloat';
    seatInBoat();
    rowCamera.yaw = boat.heading;
  };

  /** Out of the boat onto a ladder beside her: she stays afloat where she is. */
  const boatToLadder = (k: number): void => {
    if (!scene || !boat) return;
    inBoat = false;
    boatState = 'afloat';
    boat.speed = 0;
    character.position.y = scene.waterLevel - DEFAULT_CONTROLLER.swimDepth + 0.6;
    grabLadder(character, scene, k);
    walkCamera.yaw = character.heading;
  };

  const seatInBoat = (): void => {
    if (!boat) return;
    placeCharacter(character, { x: boat.x, y: ROWBOAT.freeboardM - 0.4, z: boat.z }, boat.heading);
  };

  const copyPrevious = (): void => {
    previous.position.x = character.position.x;
    previous.position.y = character.position.y;
    previous.position.z = character.position.z;
    previous.heading = character.heading;
    if (boat) boatPrev = { x: boat.x, z: boat.z, heading: boat.heading };
  };

  // --- Prompts --------------------------------------------------------------------------

  const near: Collider[] = [];
  const push: Push = { nx: 0, nz: 0 };
  /** Distance from a point to the schooner's hull, m (negative inside). */
  const toHull = (x: number, z: number): number => {
    const hull = scene?.ship;
    return hull ? footprintDistance(hull, x, z, push) : Number.POSITIVE_INFINITY;
  };

  const findPrompt = (): Prompt | undefined => {
    if (!scene) return undefined;
    const c = character;
    if (inBoat && boat) {
      const b = boat;
      if (toHull(b.x, b.z) < ROWBOAT.beamM / 2 + ALONGSIDE_M) {
        return { text: 'Go aboard', act: () => void goAboard() };
      }
      if (b.beached) return { text: 'Step ashore', act: () => void stepAshore() };
      const k = ladderNear(b.x, b.z, REACH_M + ROWBOAT.beamM / 2);
      if (k !== undefined) return { text: 'Climb the ladder', act: () => boatToLadder(k) };
      return undefined;
    }
    if (climb) return { text: 'Haul yourself out (hold F)', act: () => undefined };
    if (c.ladder !== undefined || c.move) return undefined;
    // At the gangway, or swimming alongside her, you go aboard.
    if (from === 'berth' && berthId) {
      const pier = pierOf(berthId);
      if (pier && c.grounded) {
        const g = gangway(pier);
        if (
          Math.hypot(c.position.x - g.x, c.position.z - g.z) < REACH_M &&
          Math.abs(c.position.y - g.y) < 1
        ) {
          if (jailbreak) return { text: 'Go aboard and cast off', act: () => void makeBreak() };
          return { text: 'Go aboard', act: () => void goAboard() };
        }
      }
    }
    if (c.swimming && toHull(c.position.x, c.position.z) < DEFAULT_CONTROLLER.radius + 1.2) {
      if (jailbreak) return { text: 'Climb aboard and cast off', act: () => void makeBreak() };
      return { text: 'Climb aboard', act: () => void goAboard() };
    }
    if (boat && Math.hypot(c.position.x - boat.x, c.position.z - boat.z) < REACH_M + 0.8) {
      // A load of salvage in your arms goes in the boat first (Phase 8 piece F).
      const load =
        !district && !c.swimming
          ? (wild?.boatPrompt() ?? deps.island?.boatPrompt() ?? watch?.station?.boatPrompt())
          : undefined;
      if (load) return load;
      if (boatState === 'beached' && !c.swimming) return { text: 'Shove off', act: shoveOff };
      if (boatState !== 'beached') return { text: 'Climb into the boat', act: climbIn };
    }
    // An island's cairns and the stash's strongbox (zone meters: never in a district).
    if (!district && c.grounded && !c.swimming) {
      // A carcass on your shoulders: the only thing to do with it is put it down (piece V).
      if (wild?.carrying) return wild.prompt(c);
      const found =
        deps.legends?.prompt(c.position) ??
        deps.island?.prompt(c.position) ??
        wild?.prompt(c) ??
        deps.caves?.prompt(c.position, false);
      if (found) return found;
      const cold = winterPrompt();
      if (cold) return cold;
    }
    // Bayfield's city dock, frozen in: down its ladder onto the ice road (piece M).
    if (district && winter && c.grounded && !c.swimming && !watch?.pursued && !jailbreak) {
      const road = winter.road();
      const head = road && toScene(road.fromHead);
      if (road && head && Math.hypot(c.position.x - head.x, c.position.z - head.z) < 5) {
        if (iceUnderfoot(winter.iceAt(road.from.x, road.from.z))) {
          return { text: 'Down onto the ice road to La Pointe', act: () => void goIceRoad() };
        }
      }
    }
    // A shop's counter, the saloon's bar or the back room's table (piece F): only from
    // inside the building it stands in, so a wall between you and it is no way to trade.
    if (district && deps.shop && c.grounded && !c.swimming && !watch?.pursued) {
      const m = district.model;
      const inside = m.buildingAt(c.position.x, c.position.y, c.position.z)?.def.id;
      for (const mark of m.marks) {
        if (mark.kind !== 'shop' || !mark.opens) continue;
        if (mark.ref !== undefined && mark.ref !== inside) continue;
        if (Math.hypot(c.position.x - mark.x, c.position.z - mark.z) > SHOP_REACH_M) continue;
        const found = deps.shop(district, mark);
        if (found) return found;
      }
    }
    // A moored ship's crew at its table in the saloon (piece F): stand them whiskey.
    if (district && watch && c.grounded && !c.swimming && !watch.pursued) {
      const inside = district.model.buildingAt(c.position.x, c.position.y, c.position.z)?.def.id;
      for (const crew of watch.crews()) {
        const { mark, ship } = crew;
        if (crew.stood || (mark.ref !== undefined && mark.ref !== inside)) continue;
        if (Math.hypot(c.position.x - mark.x, c.position.z - mark.z) > SHOP_REACH_M) continue;
        const n = crew.bottles;
        return {
          text: `Stand ${shipWords(ship)}'s crew whiskey (${n} bottle${n === 1 ? '' : 's'})`,
          act: () => deps.notice(watch?.standCrew(ship) ?? 'Not now'),
        };
      }
    }
    const top = ladderTopNear(c, scene);
    if (top !== undefined) {
      return { text: 'Climb down', act: () => scene && climbDownLadder(c, scene, top) };
    }
    return undefined;
  };

  /**
   * The men behind the counters that are open now (piece F): the keeper at the bar, the
   * shopkeepers, and the fence at his table after dark. Figures only, zone meters.
   */
  const keepers = (): GuardFrame[] => {
    if (!district) return [];
    const m = district.model;
    const out: GuardFrame[] = [];
    // A moored ship's hands round their table in the saloon, of an evening.
    for (const crew of watch?.crews() ?? []) {
      for (const f of crewFigures(crew.mark, crew.ship)) {
        const w = toZone(f.x, f.z);
        out.push({
          id: f.id,
          type: 'npc.sailor',
          state: crew.stood ? 'drunk' : 'idle',
          x: w.x,
          y: m.floorAt(f.x, f.z),
          z: w.z,
          heading: headingToZone(f.heading),
          crouching: false,
          lantern: false,
        });
      }
    }
    // The daytime crowd (0.7.1): townsfolk and dockhands who walk by, and never see you.
    for (const f of watch?.crowd() ?? []) {
      const w = toZone(f.x, f.z);
      out.push({
        id: f.id,
        type: f.type,
        state: 'idle',
        x: w.x,
        y: f.y,
        z: w.z,
        heading: headingToZone(f.heading),
        crouching: false,
        lantern: false,
      });
    }
    if (!deps.shop) return out;
    for (const mark of m.marks) {
      if (mark.kind !== 'shop' || !deps.shop(district, mark)) continue;
      if (mark.opens === 'cards') {
        // The captains round the card table after supper (Phase 9 piece C).
        for (const f of cardPlayers(mark)) {
          const w = toZone(f.x, f.z);
          out.push({
            id: f.id,
            type: 'npc.townsman',
            state: 'idle',
            x: w.x,
            y: m.floorAt(f.x, f.z),
            z: w.z,
            heading: headingToZone(f.heading),
            crouching: false,
            lantern: false,
          });
        }
        continue;
      }
      const spot = keeperSpot(mark);
      const w = toZone(spot.x, spot.z);
      out.push({
        id: `keeper:${mark.id}`,
        type: keeperType(mark),
        state: 'idle',
        x: w.x,
        y: m.floorAt(spot.x, spot.z),
        z: w.z,
        heading: headingToZone(spot.heading),
        crouching: false,
        lantern: false,
      });
    }
    return out;
  };

  const ladderNear = (x: number, z: number, reach: number): number | undefined => {
    const ladders = scene?.ladders ?? [];
    for (let k = 0; k < ladders.length; k++) {
      const l = ladders[k];
      if (l && Math.hypot(l.x - x, l.z - z) < reach) return k;
    }
    return undefined;
  };

  // --- Winter on foot (piece M) --------------------------------------------------------

  /** Your speed hauling the sled: slower with a load, and no running with one. */
  const hauling = (p: ControllerParams): ControllerParams => {
    const sl = sled();
    if (!hitched || !sl || district) return p;
    const mul = sledSpeedMul(sl, weightOf);
    const walk = p.walkSpeed * mul;
    return { ...p, walkSpeed: walk, runSpeed: sl.load.length ? walk : p.runSpeed * mul };
  };

  /** The fires at the ice road's two ends (a fish-house stove's barrel), zone meters. */
  const roadFires = (): { x: number; z: number }[] => {
    const road = winter?.road();
    if (!road || !winter || !iceUnderfoot(winter.iceAt(road.from.x, road.from.z))) return [];
    return [road.from, road.to].map((e) => ({ x: e.x + 3, z: e.z + 3 }));
  };

  /** The warmth meter, a real second at a time: on foot, in the water or at the oars. */
  const warmthTick = (dt: number): void => {
    if (!winter || !scene) return;
    const air = winter.air();
    const c = character;
    const at = toZone(c.position.x, c.position.z);
    const nearFire = roadFires().some(
      (f) => Math.hypot(at.x - f.x, at.z - f.z) < COLD.warmth.heatRadiusM,
    );
    const indoors = underRoof && !inBoat;
    const w = warm();
    const fell = stepWarmth(
      w,
      {
        airC: air.airC,
        windKn: air.windKn,
        precip01: air.precip01,
        swimming: !inBoat && c.swimming,
        waterC: waterC(),
        heat: indoors || nearFire,
        indoors,
        running: !inBoat && c.gait === 'run',
      },
      dt,
    );
    if (fell && fell !== 'warm') {
      ctx.events.emit('WarmthCritical', { stage: fell });
      deps.notice(WARMTH_WARNINGS[fell]);
    }
    hurt(coldHealthDrainS(w) * dt, 'froze');
  };

  /** Through the ice: the hole opens under you, and the cold's clock starts. */
  const breakThrough = (): void => {
    if (!scene || !bedAt) return;
    const p = character.position;
    hole = { x: p.x, z: p.z };
    holes.push({ ...hole });
    punchHole(scene.ground, p.x, p.z, COLD.thin.holeM);
    character.grounded = false;
    character.velocity.y = -2;
    climb = freshClimbOut();
    thin = freshThinIce();
    warm().wet = 1;
    hitched = false;
    deps.notice('Through the ice! Hold F to haul yourself out');
  };

  /** In the hole: kept at it (the ice is over the rest), hauling out against the cold. */
  const climbTick = (dt: number): void => {
    const c = climb;
    const h = hole;
    if (!c || !h || !winter) return;
    const p = character.position;
    const d = Math.hypot(p.x - h.x, p.z - h.z);
    const room = COLD.thin.holeM - 0.6;
    if (d > room) {
      p.x = h.x + ((p.x - h.x) / d) * room;
      p.z = h.z + ((p.z - h.z) / d) * room;
    }
    const edge = winter.iceAt(h.x, h.z).thicknessCm * weakness(h.x, h.z, seedNum);
    const roll = Rng.fromSeed(
      `${winter.seed}:edge:${Math.round(h.x)}:${Math.round(h.z)}:${c.slips}`,
    ).next();
    const r = stepClimbOut(c, input.isDown('Interact'), edge, roll, dt);
    if (r === 'out') {
      const a = character.heading;
      // Clear of the hole as the ground grid has it (its cells reach past the radius).
      const cell = scene?.ground.cellSize ?? 1;
      const out = holeReach(COLD.thin.holeM, cell) + cell + 0.5;
      placeCharacter(
        character,
        { x: h.x + Math.sin(a) * out, y: COLD.ice.topM + 0.05, z: h.z - Math.cos(a) * out },
        a,
      );
      copyPrevious();
      climb = undefined;
      hole = undefined;
      ctx.events.emit('IceClimbed', { result: 'out' });
      deps.notice('Out on the ice, soaked through: get to a fire');
    } else if (r === 'slipped') {
      ctx.events.emit('IceClimbed', { result: 'slipped' });
      deps.notice('The edge breaks away under you');
    } else if (r === 'lost') {
      climb = undefined;
      lastHurt = 'through_ice';
      state.player.health = 0;
    }
  };

  /** Each real second on your feet in the winter: warmth, the ice, tracks, the sled. */
  const winterOnFoot = (dt: number): void => {
    if (!winter || !scene) return;
    const now = state.environment.clock.gameSeconds;
    const dGame = Math.max(0, now - lastClock);
    lastClock = now;
    const air = winter.air();
    if (air.airC < 0.5) tracks.snow(air.precip01, dGame);
    warmthTick(dt);
    const c = character;
    const p = c.position;
    const road = winter.road();
    iceNow = undefined;
    const bed = !district && bedAt ? bedAt(p.x, p.z) : 1;
    if (!c.swimming && c.grounded && bed < 0 && p.y < COLD.ice.topM + 0.15) {
      const onRoad = !!road && roadDistance(road, p).d < COLD.ice.roadClearM;
      const thickness = iceThicknessUnderfoot(winter.iceAt(p.x, p.z), p.x, p.z, seedNum, onRoad);
      if (thickness !== undefined) iceNow = { thicknessCm: thickness };
    }
    const sl = sled();
    if (climb) {
      climbTick(dt);
    } else {
      const loadKg = hitched && sl ? sledKg(sl, weightOf) : 0;
      const up = stepThinIce(thin, { thicknessCm: iceNow?.thicknessCm, loadKg, gait: c.gait }, dt);
      if (up && up !== 'sound') {
        ctx.events.emit('IceGave', { stage: up });
        if (up === 'cracking') deps.notice('The ice cracks underfoot');
        else if (up === 'groaning') deps.notice('The ice groans under you: get off it!');
        else breakThrough();
      }
    }
    // Your prints in the snow, and the sled's runners.
    const at = toZone(p.x, p.z);
    if (!c.swimming && c.grounded) {
      const onSnow = winter.snow() && !underRoof && c.surface !== 'wood' && c.surface !== 'stone';
      tracks.step(at.x, at.z, headingToZone(c.heading), now, onSnow, {
        sled: hitched && !!sl,
        suspect: district ? (watch?.conduct?.suspect ?? false) : true,
      });
    } else {
      tracks.lift();
    }
    if (sl && hitched && !district) towSled(sl, p.x, p.z);
    followS += dt;
    if (followS >= 0.5) {
      followS = 0;
      tracks.prune(now);
      followTracks(now);
    }
  };

  /** A guard who comes on your prints goes to look where they lead (piece M). */
  const followTracks = (now: number): void => {
    for (const st of [watch?.stealth, posse?.stealth]) {
      if (!st) continue;
      for (const g of st.guards) {
        const gp = toZone(g.body.position.x, g.body.position.z);
        const lead = tracks.lead(gp.x, gp.z, now, !!district);
        const print = lead && tracks.prints[lead.index];
        if (!lead || !print || (followed.get(g.id) ?? -1) >= print.at) continue;
        if (st.follow(g.id, toScene(lead))) followed.set(g.id, print.at);
      }
    }
  };

  /** Down onto the ice road (from Bayfield's city dock, or the dev hook), its length built. */
  const goIceRoad = async (): Promise<string | undefined> => {
    const road = winter?.road();
    if (!winter || !road) return 'No ice road here';
    if (!active) return 'Not ashore';
    if (!iceUnderfoot(winter.iceAt(road.from.x, road.from.z))) return 'The ice is not in yet';
    if (busy) return 'Not now';
    busy = true;
    try {
      await deps.fade(
        'The ice road',
        'Down the ladder onto the ice, boughs marking the way',
        () => {
          watch?.footLaw?.dispose();
          district = undefined;
          watch = undefined;
          posse = undefined;
          inBoat = false;
          const m = 140;
          roadBox = {
            minX: Math.min(road.from.x, road.to.x) - m,
            minZ: Math.min(road.from.z, road.to.z) - m,
            maxX: Math.max(road.from.x, road.to.x) + m,
            maxZ: Math.max(road.from.z, road.to.z) + m,
          };
          scene = build(road.from);
          const h = Math.atan2(road.to.x - road.from.x, -(road.to.z - road.from.z));
          placeCharacter(character, { x: road.from.x, y: COLD.ice.topM, z: road.from.z }, h);
          walkCamera.yaw = h;
          copyPrevious();
          tracks.lift();
        },
      );
    } finally {
      busy = false;
    }
    return undefined;
  };

  /** Up the city dock's ladder into Bayfield from the road's end. */
  const upIntoTown = async (): Promise<void> => {
    const road = winter?.road();
    const pier =
      winter &&
      deps
        .harbors()
        .flatMap((l) => l.piers)
        .find((p) => p.id === winter.roadPier);
    if (!road || !pier || busy) return;
    busy = true;
    try {
      const landing = await districtLanding(pier);
      if (!landing) {
        deps.notice('No way up into the town here');
        return;
      }
      await deps.fade('Bayfield', 'Up the ladder onto the city dock', () => {
        hitched = false;
        enterDistrict(landing);
        const m = landing.model;
        const l = landing.frame.toLocal(road.fromHead);
        // The kit's pier can sit a step off the harbor's: the nearest dry deck.
        let at = { x: l.x, z: l.z };
        search: for (let r = 0; r <= 8; r += 0.5) {
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            const x = l.x + Math.sin(a) * r;
            const z = l.z - Math.cos(a) * r;
            if (m.floorAt(x, z) > m.waterLevel + 0.6) {
              at = { x, z };
              break search;
            }
          }
        }
        placeCharacter(character, { x: at.x, y: m.floorAt(at.x, at.z), z: at.z });
        copyPrevious();
        tracks.lift();
      });
    } finally {
      busy = false;
    }
  };

  /**
   * Up La Pointe's village dock from the road's far end (piece Q): Madeline is walked whole
   * now, so the road lands you in the village, the sled left on the ice below.
   */
  const upOntoTheIsland = async (): Promise<void> => {
    const road = winter?.road();
    if (!road || busy) return;
    busy = true;
    try {
      await deps.fade('La Pointe', 'Up the ladder onto the village dock', () => {
        hitched = false;
        watch?.footLaw?.dispose();
        watch = undefined;
        posse = undefined;
        scene = build(road.toHead);
        const h = Math.atan2(road.toHead.x - road.from.x, -(road.toHead.z - road.from.z));
        placeCharacter(
          character,
          { x: road.toHead.x, y: road.toHead.y + 0.05, z: road.toHead.z },
          h,
        );
        walkCamera.yaw = h;
        copyPrevious();
        tracks.lift();
      });
    } finally {
      busy = false;
    }
  };

  /**
   * What a stride is on in winter, for its sound (piece N): bare lake ice, snow over it, or
   * snow lying on the ground (not on planks, stone or under a roof). Undefined otherwise.
   */
  const winterGround = (surface: Surface | 'water'): WinterGround | undefined => {
    if (!winter || surface === 'water') return undefined;
    const snow = winter.snow() && !underRoof;
    if (iceNow !== undefined) return snow ? 'snowIce' : 'ice';
    if (snow && surface !== 'wood' && surface !== 'stone' && surface !== 'interior') return 'snow';
    return undefined;
  };

  /** The F prompt on the ice and in the snow: the sled, the road's ends. */
  const winterPrompt = (): Prompt | undefined => {
    if (!winter || !scene || district) return undefined;
    const c = character.position;
    const road = winter.road();
    const iced = !!road && iceUnderfoot(winter.iceAt(road.from.x, road.from.z));
    const sl = sled();
    if (road && iced) {
      const end = COLD.road.endM;
      if (Math.hypot(c.x - road.to.x, c.z - road.to.z) < end && sl?.load.length) {
        return {
          text: "Sell the sled's load at La Pointe's trading post",
          act: () => {
            const r = winter.sell(winter.roadPort, sl.load);
            sl.load = r.left;
            ctx.events.emit('SledHandled', { act: 'sold' });
            deps.notice(r.line);
          },
        };
      }
      if (Math.hypot(c.x - road.from.x, c.z - road.from.z) < end) {
        return { text: 'Up the ladder into Bayfield', act: () => void upIntoTown() };
      }
      // Off the road's own scene, onto Madeline's at La Pointe (piece Q).
      if (
        !sceneIsland &&
        Math.hypot(c.x - road.to.x, c.z - road.to.z) < end &&
        deps.island?.walkableAt(road.toHead)
      ) {
        return { text: "Up the ladder onto La Pointe's dock", act: () => void upOntoTheIsland() };
      }
    }
    const nearShip = !!scene.ship && toHull(c.x, c.z) < 4 && (bedAt?.(c.x, c.z) ?? 1) < 0;
    if (nearShip && !sl) {
      return {
        text: 'Put the hand sled down on the ice',
        act: () => {
          const h = character.heading;
          state.player.sled = {
            x: c.x - Math.sin(h) * COLD.sled.ropeM,
            z: c.z + Math.cos(h) * COLD.sled.ropeM,
            heading: h,
            load: [],
          };
          hitched = true;
          ctx.events.emit('SledHandled', { act: 'down' });
        },
      };
    }
    if (sl && nearShip && Math.hypot(sl.x - c.x, sl.z - c.z) < COLD.sled.ropeM + 3) {
      const hold = winter.hold();
      const movable = hold.filter((h) => !h.contract).reduce((n, h) => n + h.qty, 0);
      if (movable > 0 && sledFree(sl) > 0) {
        return {
          text: `Load the sled from the hold (${Math.min(movable, sledFree(sl))} CU)`,
          act: () => {
            const n = loadSled(sl, hold, (g) => winter.valueOf(g));
            winter.holdChanged();
            ctx.events.emit('SledHandled', { act: 'loaded' });
            deps.notice(`${n} CU onto the sled`);
          },
        };
      }
      if (sl.load.length) {
        return {
          text: 'Unload the sled into the hold',
          act: () => {
            unloadSled(sl, hold);
            winter.holdChanged();
            ctx.events.emit('SledHandled', { act: 'unloaded' });
          },
        };
      }
      return {
        text: 'Stow the sled aboard',
        act: () => {
          state.player.sled = undefined;
          hitched = false;
          ctx.events.emit('SledHandled', { act: 'stowed' });
        },
      };
    }
    if (sl && !hitched && Math.hypot(sl.x - c.x, sl.z - c.z) < 2.5) {
      return {
        text: "Take up the sled's rope",
        act: () => {
          hitched = true;
          ctx.events.emit('SledHandled', { act: 'hitched' });
        },
      };
    }
    if (sl && hitched && character.gait === 'idle') {
      return {
        text: "Drop the sled's rope",
        act: () => {
          hitched = false;
          ctx.events.emit('SledHandled', { act: 'dropped' });
        },
      };
    }
    return undefined;
  };

  // --- The tick -------------------------------------------------------------------------

  const hurt = (amount: number, cause: FootDeath): void => {
    if (amount <= 0) return;
    state.player.health = Math.max(0, state.player.health - amount);
    lastHurt = cause;
  };

  const rowEnv = {
    // A sea cave's water has the cave's own bottom (piece S): the drawn cliff is cut away.
    depthAt: (x: number, z: number): number =>
      deps.caves?.depthAt(x, z) ?? -(deps.terrain()?.heightAt(x, z) ?? -100),
    blocked: (x: number, z: number, r: number) => {
      if (!scene) return undefined;
      const sea = deps.caves?.rowBlocked(x, z, r);
      if (sea) return sea;
      scene.colliders.query(x, z, r, near);
      for (const c of near) {
        // Only what stands in the water at the boat's height: piles, cribs, hulls.
        if (c.minY > 0.3 || c.maxY < 0) continue;
        const d = footprintDistance(c, x, z, push);
        if (d < r) return { nx: push.nx, nz: push.nz, depth: r - d + 1e-3 };
      }
      return undefined;
    },
  };

  const stepAshoreTick = (dt: number): void => {
    if (!scene || busy) return;
    // Under a sea cave's roof or on the cliff over it: the ground answers for your height.
    if (scene.ground instanceof CaveGround) {
      scene.ground.ref = inBoat ? 0 : character.position.y;
    }
    const ahead = (input.isDown('MoveForward') ? 1 : 0) - (input.isDown('MoveBack') ? 1 : 0);
    const side = (input.isDown('MoveRight') ? 1 : 0) - (input.isDown('MoveLeft') ? 1 : 0);
    if (inBoat && boat) {
      resetLean(lean);
      warmthTick(dt);
      boatPrev = { x: boat.x, z: boat.z, heading: boat.heading };
      stepRowboat(boat, { pull: ahead, turn: side }, rowEnv, dt);
      if (swamped(deps.hsAt(boat.x, boat.z))) {
        // A sea fills her: you're in the water beside her.
        inBoat = false;
        boatState = 'swamped';
        boat.speed = 0;
        placeCharacter(
          character,
          {
            x: boat.x + Math.cos(boat.heading) * 1.2,
            y: -DEFAULT_CONTROLLER.swimDepth,
            z: boat.z + Math.sin(boat.heading) * 1.2,
          },
          boat.heading,
        );
        deps.notice('A sea filled the boat. Swim for it!');
      } else {
        seatInBoat();
        deps.caves?.tick({ x: boat.x, y: 0, z: boat.z }, 'boat');
        const b = scene.bounds;
        if (sceneIsland && from !== 'wreck') {
          boat.x = Math.min(Math.max(boat.x, b.minX + REBUILD_MARGIN_M), b.maxX - REBUILD_MARGIN_M);
          boat.z = Math.min(Math.max(boat.z, b.minZ + REBUILD_MARGIN_M), b.maxZ - REBUILD_MARGIN_M);
        } else if (
          boat.x < b.minX + REBUILD_MARGIN_M ||
          boat.x > b.maxX - REBUILD_MARGIN_M ||
          boat.z < b.minZ + REBUILD_MARGIN_M ||
          boat.z > b.maxZ - REBUILD_MARGIN_M
        ) {
          scene = build(boat) ?? scene;
        }
      }
    } else {
      stepCharacter(
        character,
        {
          forward: ahead,
          right: side,
          run: input.isDown('Sprint'),
          // Arms full of a crate, you can't stoop (plan 08 §7).
          crouch:
            input.isDown('Crouch') &&
            !watch?.heist?.carrying &&
            !watch?.station?.carrying &&
            !deps.island?.carrying() &&
            !wild?.carrying,
          jump: input.pressed('Jump'),
        },
        walkCamera.yaw,
        scene,
        dt,
        hauling(
          (wild?.params ?? ((p: ControllerParams) => p))(
            watch
              ? watch.params(DEFAULT_CONTROLLER)
              : (deps.island?.params(DEFAULT_CONTROLLER) ?? DEFAULT_CONTROLLER),
          ),
        ),
      );
      // Q/E: lean round a corner, standing still with your hands free.
      stepLean(
        lean,
        (input.isDown('LeanRight') ? 1 : 0) - (input.isDown('LeanLeft') ? 1 : 0),
        character,
        ahead !== 0 || side !== 0,
        !watch?.heist?.carrying && !watch?.tools?.carrying && !watch?.station?.carrying,
        walkCamera.yaw,
        scene,
        character.crouching ? DEFAULT_CONTROLLER.crouchHeight : DEFAULT_CONTROLLER.standHeight,
        dt,
      );
      // Out on the ice (piece M), the scene is built on round you as you walk.
      const pc = character.position;
      const eb = scene.bounds;
      if (
        winter &&
        !district &&
        !sceneIsland &&
        !climb &&
        (bedAt?.(pc.x, pc.z) ?? 1) < 0 &&
        (pc.x < eb.minX + REBUILD_MARGIN_M ||
          pc.x > eb.maxX - REBUILD_MARGIN_M ||
          pc.z < eb.minZ + REBUILD_MARGIN_M ||
          pc.z > eb.maxZ - REBUILD_MARGIN_M)
      ) {
        scene = build(pc) ?? scene;
      }
      // The edge of what's built: the rest of the shore is for another day.
      const b = scene.bounds;
      const pad = 4;
      const cx = Math.min(Math.max(character.position.x, b.minX + pad), b.maxX - pad);
      const cz = Math.min(Math.max(character.position.z, b.minZ + pad), b.maxZ - pad);
      if (cx !== character.position.x || cz !== character.position.z) {
        character.position.x = cx;
        character.position.z = cz;
        character.velocity.x = character.velocity.z = 0;
      }
      if (deps.sounds || wild) {
        const p = character.position;
        const moved = strideFrom.fresh ? Math.hypot(p.x - strideFrom.x, p.z - strideFrom.z) : 0;
        strideFrom.x = p.x;
        strideFrom.z = p.z;
        strideFrom.fresh = true;
        // A teleport or a fade is not a stride.
        if (moved < 2) {
          const surface = character.swimming ? 'water' : character.surface;
          const carrying =
            watch?.heist?.carrying !== undefined || watch?.station?.carrying !== undefined;
          const r = strides.step(
            moved,
            character.gait,
            surface === 'water' ? 'dirt' : surface,
            carrying,
          );
          if (r > 0) deps.sounds?.step(surface, character.gait, r, winterGround(surface));
          strideM = r;
        }
        if (character.landedSpeed > 0) {
          deps.sounds?.landed(character.landedSpeed, character.landedInWater);
        }
      }
      if (character.landedSpeed > 0) {
        hurt(fallDamage(character.landedSpeed, character.landedInWater), 'fell');
        if (
          fallDamage(character.landedSpeed, character.landedInWater) > 0 &&
          state.player.health > 0
        ) {
          deps.notice(
            state.player.health < BADLY_HURT ? 'A bad fall: you are badly hurt' : 'A hard landing',
          );
        }
      }
      if (character.swimming) hurt(coldDrainPerS(waterC()) * dt, 'drowned');
      // In a sea cave (piece S): coming in and going out, and the surge on a swimmer.
      if (deps.caves) {
        const surge = deps.caves.tick(character.position, character.swimming ? 'swimming' : 'foot');
        hurt(surge * dt, 'drowned');
      }
      winterOnFoot(dt);
      // Cast away, the first dry footing (a beach, a pier) is landfall.
      if (
        from === 'wreck' &&
        !landedTold &&
        character.grounded &&
        !character.swimming &&
        character.position.y > 0
      ) {
        landedTold = true;
        deps.castawayLanded?.();
      }
    }

    // Draw the tool before the watch looks, so a cosh in hand is what they see this frame.
    if (active && !taken && watch?.tools) {
      const belt = watch.tools;
      (
        ['Tool1', 'Tool2', 'Tool3', 'Tool4', 'Tool5', 'Tool6', 'Tool7', 'Tool8', 'Tool9'] as const
      ).forEach((a, n) => {
        if (input.pressed(a)) belt.selectSlot(n);
      });
    }

    // The night watch looks and listens after you've moved (plan 08 §4–5).
    const leanNow = leaning(lean) ? { x: lean.offsetX, z: lean.offsetZ } : undefined;
    if (watch && !taken) watch.step(dt, character, leanNow);
    // The marshal posse on the island (piece H): wanted men are hunted on the island.
    if (posse && !taken && !inBoat && scene) {
      const p = character.position;
      posse.step(dt, character, true, scene.surfaceAt?.(p.x, p.z), leanNow);
      if (posse.captured) takenBy('npc.marshal');
    }
    // The island's animals look, listen and sniff after you've moved (piece V).
    if (wild && !taken) {
      wild.step(dt, character, {
        strideM,
        interactDown: input.isDown('Interact'),
        beyond: inBoat || character.swimming,
      });
    }
    strideM = 0;
    if (!active || taken) return;

    // F is the tool's when a guard is in reach of it (or a man who's down), else the
    // ashore prompt's. The belt itself was taken up before the watch looked.
    const own = findPrompt();
    const toolTookF =
      !inBoat &&
      !!watch?.interact(
        dt,
        character,
        input.isDown('Interact'),
        input.pressed('Interact'),
        own !== undefined,
      );
    prompt = toolTookF ? undefined : own;
    // A held prompt (a dig) acts once F has been held its time on the same prompt.
    if (!toolTookF && prompt?.holdS !== undefined) {
      if (input.isDown('Interact') && holding?.text === prompt.text) {
        holding.s += dt;
      } else {
        holding = input.pressed('Interact') ? { text: prompt.text, s: 0 } : undefined;
      }
      if (holding && holding.s >= prompt.holdS) {
        holding = undefined;
        prompt.act();
      }
    } else {
      holding = undefined;
      if (!toolTookF && input.pressed('Interact') && prompt) prompt.act();
    }

    if (state.player.health <= 0 && !dead) {
      dead = true;
      deps.died(lastHurt);
    }
  };

  // Wounds heal on the world clock while you're dry (plan 08 §3.3).
  ctx.events.on('WorldTick', () => {
    // Aboard, the galley stove warms and dries you (piece M).
    if (!active && state.player.warmth) warmAboard(state.player.warmth, 600);
    if (active && character.swimming) return;
    if (state.player.health < MAX_HEALTH) state.player.health = heal(state.player.health, 600);
  });

  /** What the view draws of the winter (piece M): the sled, your prints, the road, its fires. */
  const winterFrame = (): FootFrame['winter'] => {
    if (!winter || !scene) return undefined;
    const now = state.environment.clock.gameSeconds;
    const groundY = (x: number, z: number): number => {
      const l = toScene({ x, z });
      return district ? district.model.floorAt(l.x, l.z) : (scene?.ground.heightAt(l.x, l.z) ?? 0);
    };
    const me = toZone(character.position.x, character.position.z);
    const prints: number[] = [];
    for (let i = tracks.prints.length - 1; i >= 0 && prints.length < 5 * 400; i--) {
      const p = tracks.prints[i];
      if (!p || !tracks.visible(p, now)) continue;
      if (Math.hypot(p.x - me.x, p.z - me.z) > 120) continue;
      prints.push(p.x, groundY(p.x, p.z), p.z, p.heading, p.sled ? 1 : 0);
    }
    const sl = sled();
    const road = winter.road();
    const iced = !!road && iceUnderfoot(winter.iceAt(road.from.x, road.from.z));
    return {
      sled: sl && {
        x: sl.x,
        y: groundY(sl.x, sl.z),
        z: sl.z,
        heading: sl.heading,
        cu: sledUsed(sl),
      },
      prints,
      markers: iced && road ? road.markers.map((m) => ({ ...m, y: COLD.ice.topM })) : [],
      fires: roadFires().map((f) => ({ ...f, y: COLD.ice.topM })),
    };
  };

  const mode: Mode = {
    id: 'onFoot',
    enter() {
      input.context = 'onFoot';
      deps.look.attach();
    },
    exit() {
      deps.look.detachListeners();
    },
    update(dt) {
      lastDt = dt;
      elapsed += dt;
      snapshotTransforms(ctx.world);
      ctx.sea.time += dt;
      tickOnFootClock(ctx, dt);
      const here = toZone(character.position.x, character.position.z);
      ctx.weather.tick(state.environment.clock.gameSeconds, here, ctx.sea);
      bobSystem(ctx.world, elapsed);
      buoyancySystem(ctx.world, ctx.sea, dt);
      if (!inBoat) copyPrevious();
      stepAshoreTick(dt);
    },
    render(alpha, frameSeconds) {
      const view = deps.view;
      if (!view || !scene) {
        view?.render(alpha, ctx.sea.time, frameSeconds);
        return;
      }
      const { dx, dy } = deps.look.consume();
      const cam = inBoat ? rowCamera : walkCamera;
      cam.look(dx, dy);
      const p = character.position;
      const pr = previous.position;
      const x = pr.x + (p.x - pr.x) * alpha;
      const y = pr.y + (p.y - pr.y) * alpha;
      const z = pr.z + (p.z - pr.z) * alpha;
      const dh = Math.atan2(
        Math.sin(character.heading - previous.heading),
        Math.cos(character.heading - previous.heading),
      );
      const heading = previous.heading + dh * alpha;
      let boatFrame: FootFrame['boat'];
      if (boat) {
        const bh = Math.atan2(
          Math.sin(boat.heading - boatPrev.heading),
          Math.cos(boat.heading - boatPrev.heading),
        );
        boatFrame = {
          x: boatPrev.x + (boat.x - boatPrev.x) * alpha,
          z: boatPrev.z + (boat.z - boatPrev.z) * alpha,
          heading: boatPrev.heading + bh * alpha,
          beached: boatState === 'beached',
          manned: inBoat,
        };
      }
      const feet = inBoat && boatFrame ? { x: boatFrame.x, y: 0, z: boatFrame.z } : { x, y, z };
      const head =
        y +
        (character.crouching ? DEFAULT_CONTROLLER.crouchHeight : DEFAULT_CONTROLLER.standHeight);
      const indoors =
        !inBoat &&
        (district ? !!district.model.buildingAt(x, head - 0.3, z) : roofOver(scene, x, head, z));
      underRoof = indoors;
      // Leaning, the camera's pivot goes out with your head.
      const pivot = inBoat ? feet : { x: x + lean.offsetX, y, z: z + lean.offsetZ };
      cam.update(pivot, character.crouching || character.swimming, scene, frameSeconds, indoors);
      // The scene's frame out to the zone's, where the world is drawn.
      const out = (p: { x: number; y: number; z: number }): { x: number; y: number; z: number } => {
        const q = toZone(p.x, p.z);
        return { x: q.x, y: p.y, z: q.z };
      };
      const at = out({ x, y, z });
      view.foot = {
        camera: cameraOverride?.() ?? { position: out(cam.position), target: out(cam.target) },
        district: district && {
          harbor: district.def.harbor,
          model: district.model,
          frame: district.frame,
          focus: { x, y: head, z },
          doused: watch ? watch.lamps.flatMap((l, k) => (l.doused ? [k] : [])) : [],
          // A target's doors are locked in its hours (the leaf's collider is on): drawn shut.
          shut: watch?.heist?.doors.flatMap((d) => (d.leaf.disabled ? [] : [d.id])) ?? [],
        },
        guards: [
          ...keepers(),
          ...[...(watch?.stealth.guards ?? []), ...(posse?.stealth.guards ?? [])].map((g) => {
            const p = g.body.position;
            const q = g.previous;
            const gx = q.x + (p.x - q.x) * alpha;
            const gz = q.z + (p.z - q.z) * alpha;
            const w = toZone(gx, gz);
            const dg = Math.atan2(
              Math.sin(g.body.heading - q.heading),
              Math.cos(g.body.heading - q.heading),
            );
            return {
              id: g.id,
              type: g.type.id,
              state: g.state,
              x: w.x,
              y: q.y + (p.y - q.y) * alpha,
              z: w.z,
              heading: headingToZone(q.heading + dg * alpha),
              crouching: g.body.crouching,
              lantern: !!g.lantern?.lit,
            };
          }),
        ],
        captain: {
          x: at.x,
          y,
          z: at.z,
          heading: headingToZone(heading),
          crouching: character.crouching,
          swimming: character.swimming,
          visible: !inBoat,
          // The head's offset in the zone's frame, for the lean of the figure.
          lean: (() => {
            const h = out({ x: x + lean.offsetX, y, z: z + lean.offsetZ });
            return { x: h.x - at.x, z: h.z - at.z };
          })(),
        },
        boat: boatFrame,
        shipGone: from === 'wreck',
        winter: winterFrame(),
        wildlife: wild?.frame(),
      };
      view.render(alpha, ctx.sea.time - (1 - alpha) * lastDt, frameSeconds);
    },
  };

  return {
    mode,
    get active() {
      return active;
    },
    get inBoat() {
      return inBoat;
    },
    character,
    lean,
    get boat() {
      return boat;
    },
    get boatState() {
      return boatState;
    },
    get scene() {
      return scene;
    },
    get from() {
      return from;
    },
    refusal,
    landingHere,
    goAshore,
    goAboard,
    stepAshore,
    castawayRefusal,
    castAway,
    landShipless,
    leave,
    prompt: () => prompt?.text,
    hud(): FootHudSnapshot {
      const swimming = !inBoat && character.swimming;
      const w = waterC();
      return {
        health: state.player.health,
        cold: swimming
          ? { word: coldWord(w), waterC: w, lastS: secondsToDrown(state.player.health, w) }
          : undefined,
        hurt: state.player.health < BADLY_HURT,
        prompt:
          prompt?.holdS !== undefined
            ? holding
              ? `${prompt.text} … ${Math.min(99, Math.round((100 * holding.s) / prompt.holdS))}%`
              : `${prompt.text} (hold F)`
            : prompt?.text,
        inBoat,
        swimming,
        gait: inBoat ? 'rowing' : character.gait,
        warmth:
          winter && (warm().value < 100 || warm().wet > 0.05)
            ? {
                value: warm().value,
                stage: warmthStage(warm().value),
                wet: warm().wet > 0.3,
              }
            : undefined,
        banner: climb
          ? {
              oneChance: true,
              text: `Through the ice: hold F to haul yourself out (${Math.max(
                0,
                Math.ceil(COLD.thin.windowS - climb.inS),
              )} s)`,
            }
          : jailbreak
            ? {
                oneChance: jailbreak.execution,
                text: watch?.jailbreak?.inIrons
                  ? 'Slip the irons, get past the jailer, and reach your ship at the city dock before dawn'
                  : watch?.jailbreak?.inCell
                    ? 'Get out of the cell, and reach your ship at the city dock before dawn'
                    : 'Reach your ship at the city dock before dawn',
              }
            : undefined,
      };
    },
    record(s) {
      s.player.rowboat =
        boat && boatState !== 'stowed'
          ? { state: boatState, pose: { x: boat.x, z: boat.z, heading: boat.heading } }
          : { state: 'stowed' };
      // A jailbreak isn't kept: a reload finds you in the lockup, the attempt lost.
      if (!active || !from || jailbreak) {
        s.player.ashore = null;
        return;
      }
      const c = character.position;
      const z = toZone(c.x, c.z);
      s.player.ashore = {
        from,
        at: { x: z.x, y: c.y, z: z.z, heading: headingToZone(character.heading) },
        inBoat,
        ...(berthId ? { berthId } : {}),
        ...(anchor ? { anchor: { ...anchor } } : {}),
      };
    },
    resume(saved) {
      // Back into a district (Bayfield) once it has loaded; else the stand-in at once.
      const pier = saved.from === 'berth' ? pierOf(saved.berthId) : undefined;
      if (pier && deps.districtFrame) {
        void districtLanding(pier).then((landing) => resumeIn(saved, landing));
        return;
      }
      resumeIn(saved, undefined);
    },
    teleport(x, z, y) {
      if (!active) return;
      if (district && !inBoat) {
        const l = district.frame.toLocal({ x, z });
        placeCharacter(character, { x: l.x, y: y ?? district.model.floorAt(l.x, l.z), z: l.z });
        copyPrevious();
        return;
      }
      teleportZone(x, z, y);
    },
    refreshScene,
    get cameraOverride() {
      return cameraOverride;
    },
    set cameraOverride(fn) {
      cameraOverride = fn;
    },
    face(bearing, pitch) {
      const h = headingToScene(bearing);
      if (inBoat && boat) {
        boat.heading = h;
        rowCamera.yaw = h;
        seatInBoat();
      }
      character.heading = h;
      walkCamera.yaw = h;
      if (pitch !== undefined) walkCamera.pitch = pitch;
      copyPrevious();
    },
    get island() {
      return district ? undefined : sceneIsland;
    },
    get wildlife() {
      return wild;
    },
    get posse() {
      return posse;
    },
    get district() {
      return district;
    },
    get watch() {
      return watch;
    },
    stowPoints() {
      if (from !== 'berth' || !berthId) return [];
      const pier = pierOf(berthId);
      return pier ? [gangway(pier)] : [];
    },
    get pursued() {
      return active && (!!watch?.pursued || !!posse?.pursued);
    },
    breakOut,
    get jailbreak() {
      return active ? jailbreak : undefined;
    },
    zoneAt() {
      const c = character.position;
      const z = toZone(c.x, c.z);
      return { x: z.x, y: c.y, z: z.z, heading: headingToZone(character.heading) };
    },
    chartPositions() {
      if (!active) return undefined;
      const c = character.position;
      const cz = toZone(c.x, c.z);
      const captain: Pose = { x: cz.x, z: cz.z, heading: headingToZone(character.heading) };
      if (!boat) return { captain };
      const bz = toZone(boat.x, boat.z);
      return { captain, boat: { x: bz.x, z: bz.z, heading: headingToZone(boat.heading) } };
    },
    toolsHud() {
      return watch && active && !inBoat
        ? watch.toolsHud(character, findPrompt() !== undefined)
        : undefined;
    },
    toZone,
    tracks,
    iceRoad: () => goIceRoad(),
    winter(): WinterSnapshot {
      const w = warm();
      const sl = sled();
      const road = winter?.road();
      const c = character.position;
      const onRoad = road && !district ? roadDistance(road, c) : undefined;
      return {
        warmth: w.value,
        wet: w.wet,
        stage: warmthStage(w.value),
        onIce: iceNow !== undefined,
        thicknessCm: iceNow?.thicknessCm,
        stress: thin.stress,
        thin: thin.stage,
        climbLeftS: climb ? Math.max(0, COLD.thin.windowS - climb.inS) : undefined,
        holes: holes.map((h) => ({ ...h })),
        ground: scene?.ground.heightAt(c.x, c.z),
        sled: sl && {
          x: sl.x,
          z: sl.z,
          hitched,
          cu: sledUsed(sl),
          load: sl.load.map((l) => ({ good: l.good, qty: l.qty })),
        },
        prints: tracks.prints.length,
        road: onRoad && onRoad.d < COLD.ice.roadClearM ? onRoad.t : undefined,
      };
    },
    sound() {
      if (!active || inBoat || !scene) return undefined;
      const c = character.position;
      const at = toZone(c.x, c.z);
      const zoned = (g: GuardReadout): GuardReadout => {
        const z = toZone(g.x, g.z);
        return { ...g, x: z.x, z: z.z };
      };
      const guards = [
        ...(watch?.readout().guards ?? []),
        ...(posse?.stealth.readout().guards ?? []),
      ].map(zoned);
      let saloon: AshoreSound['saloon'];
      if (district) {
        const bar = district.model.layout.marks.find((m) => m.opens === 'saloon');
        if (bar) {
          const { hour } = dayAndHour(state.environment.clock.gameSeconds);
          const hours = gameTools().file.conduct.hours['saloon'];
          const z = toZone(bar.x, bar.z);
          saloon = {
            x: z.x,
            z: z.z,
            open: !hours || withinHours(hour, hours),
            within: district.model.buildingAt(c.x, c.y + 1, c.z)?.def.id === bar.ref,
          };
        }
      }
      const prompt = watch?.toolsHud(character)?.prompt;
      return {
        player: { x: at.x, y: c.y, z: at.z },
        swimming: character.swimming,
        waterC: waterC(),
        place: district ? 'district' : sceneIsland ? 'island' : 'shore',
        island: district ? undefined : sceneIsland,
        inside: underRoof,
        saloon,
        guards,
        picking:
          prompt && prompt.label.startsWith('Pick') && prompt.hold01 > 0
            ? prompt.hold01
            : undefined,
        station: watch?.station?.sound(character),
        winter: winter && {
          stage: warmthStage(warm().value),
          onIce: iceNow !== undefined,
          thin: thin.stage,
          stress: thin.stress,
          moving: character.gait !== 'idle',
          snowLies: winter.snow() && !underRoof,
          sled: ((sl) => sl && { x: sl.x, z: sl.z, hitched, cu: sledUsed(sl) })(sled()),
        },
      };
    },
    stealthReadout() {
      if (!watch || !active) return undefined;
      const r = watch.readout();
      return {
        ...r,
        guards: r.guards.map((g) => {
          const z = toZone(g.x, g.z);
          return { ...g, x: z.x, z: z.z };
        }),
      };
    },
  };

  function resumeIn(saved: AshoreState, landing: DistrictLanding | undefined): void {
    hitched = false;
    tracks.lift();
    from = saved.from;
    landedTold = false;
    berthId = saved.berthId;
    anchor = saved.anchor;
    district = undefined;
    watch = undefined;
    const rb = state.player.rowboat;
    boat = rb.pose ? createRowboat(rb.pose.x, rb.pose.z, rb.pose.heading) : undefined;
    boatState = boat ? rb.state : 'stowed';
    inBoat = saved.inBoat && !!boat;
    if (boat && boatState === 'beached') boat.beached = true;
    if (landing) {
      enterDistrict(landing);
      const l = toScene(saved.at);
      placeCharacter(
        character,
        { x: l.x, y: saved.at.y, z: l.z },
        headingToScene(saved.at.heading),
      );
    } else {
      scene = build(inBoat && boat ? boat : saved.at);
      if (inBoat) seatInBoat();
      else placeCharacter(character, saved.at, saved.at.heading);
    }
    copyPrevious();
    enter();
  }

  function refreshScene(): void {
    if (!active || district || !scene) return;
    const at = inBoat && boat ? boat : character.position;
    scene = build({ x: at.x, z: at.z }) ?? scene;
  }

  function teleportZone(x: number, z: number, y?: number): void {
    if (
      !scene ||
      x < scene.bounds.minX + 20 ||
      x > scene.bounds.maxX - 20 ||
      z < scene.bounds.minZ + 20 ||
      z > scene.bounds.maxZ - 20
    ) {
      scene = build({ x, z }) ?? scene;
    }
    if (inBoat && boat) {
      boat.x = x;
      boat.z = z;
      seatInBoat();
    } else {
      // The scene's own ground (an island's 1 m tiles), else the zone's.
      const ground = scene?.ground.heightAt(x, z) ?? deps.terrain()?.heightAt(x, z) ?? 0;
      placeCharacter(character, {
        x,
        y: y ?? Math.max(ground, -DEFAULT_CONTROLLER.swimDepth),
        z,
      });
    }
    copyPrevious();
  }
}

export { ASHORE_HALF_M };
