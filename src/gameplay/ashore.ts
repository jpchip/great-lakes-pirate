import type { PointerLook } from '../core/pointer-look';
import { calendarDate } from '../core/time';
import type { GameContext } from '../modes/context';
import type { Mode } from '../modes/machine';
import { tickOnFootClock } from '../modes/on-foot';
import type { SailingView } from '../modes/sailing';
import type { FootFrame } from '../render/onfoot/foot-view';
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
import { bobSystem, snapshotTransforms, type Entity, type Transform } from './ecs';
import { buoyancySystem } from './buoyancy';
import {
  ASHORE_HALF_M,
  beachStep,
  buildAshoreScene,
  gangwayAt,
  type AshoreScene,
} from './onfoot/ashore-scene';
import { FollowCamera, ROWING_CAMERA, roofOver } from './onfoot/camera';
import { footprintDistance, type Collider, type Push } from './onfoot/colliders';
import {
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
  died(cause: 'drowned' | 'fell'): void;
  look: PointerLook;
  /** The view drawn each frame; its `foot` is set while you're ashore. */
  view?: (SailingView & { foot: FootFrame | undefined }) | undefined;
}

/** Where F would act, and what it would do. */
interface Prompt {
  text: string;
  act(): void;
}

export interface GameAshore {
  readonly mode: Mode;
  /** Ashore: on foot, swimming or in the boat. */
  readonly active: boolean;
  readonly inBoat: boolean;
  readonly character: CharacterState;
  readonly boat: RowboatState | undefined;
  readonly boatState: RowboatSave['state'];
  readonly scene: AshoreScene | undefined;
  readonly from: AshoreState['from'] | undefined;
  /** Why you can't go ashore here now, or undefined if G would take you. */
  refusal(): string | undefined;
  /** G: ashore from a berth, or into the boat at anchor. The refusal, if not. */
  goAshore(): Promise<string | undefined>;
  /** Back aboard, however you are: ends ashore at the helm. */
  goAboard(): Promise<void>;
  /** From a beached boat onto the beach. */
  stepAshore(): Promise<string | undefined>;
  /** The F prompt now, for the HUD. */
  prompt(): string | undefined;
  /** The HUD's body readout. */
  hud(): FootHudSnapshot;
  /** Writes where you are into the state, just before a save. */
  record(state: WorldState): void;
  /** Back ashore as the save left you (the ship already moored as it was). */
  resume(saved: AshoreState): void;
  /** For the dev hooks: where to put you. */
  teleport(x: number, z: number, y?: number): void;
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
}

/** You can reach the gangway, the boat or a ladder from this far. */
const REACH_M = 2.2;
/** In the boat, this close to the schooner's side you can climb aboard. */
const ALONGSIDE_M = 3.5;
/** The scene is rebuilt around the boat when she comes this close to its edge. */
const REBUILD_MARGIN_M = 60;

export function attachAshore(deps: AshoreDeps): GameAshore {
  const { ctx } = deps;
  const input = ctx.input;
  const state = ctx.state;
  const character = createCharacter({ x: 0, y: 0, z: 0 });
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
  let lastHurt: 'drowned' | 'fell' = 'drowned';
  let elapsed = 0;
  let lastDt = 1 / 60;
  let dead = false;

  const hazards = (): NonNullable<Entity['hazards']> => {
    const h = deps.ship.hazards;
    if (!h) throw new Error('ashore: the ship has no hazards');
    return h;
  };
  const shipPose = (): Pose => {
    const t = deps.ship.transform;
    return { x: t?.position.x ?? 0, z: t?.position.z ?? 0, heading: t?.heading ?? 0 };
  };
  const waterC = (): number =>
    climateAt(calendarDate(state.environment.clock.gameSeconds)).waterC;

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

  const build = (center: { x: number; z: number }): AshoreScene | undefined => {
    const terrain = deps.terrain();
    if (!terrain) return undefined;
    const g = terrain.height;
    return buildAshoreScene({
      ground: { heightAt: (x, z) => terrain.heightAt(x, z), x0: g.x0, z0: g.z0, step: g.step },
      center,
      piers: deps.harbors().flatMap((l) => l.piers),
      buildings: deps.harbors().flatMap((l) => l.buildings),
      ship: { pose: shipPose(), ...deps.hull },
      inTown: deps.inTown,
    });
  };

  // --- Going ashore and back -----------------------------------------------------------

  const refusal = (): string | undefined => {
    if (active) return 'Already ashore';
    const other = deps.blocked();
    if (other) return other;
    const h = hazards().state;
    if (h.foundering) return 'She is going down: F to abandon ship';
    if (!deps.terrain()) return 'No shore here';
    if (h.mooring === 'docked' && pierOf(h.berthId)) return undefined;
    if (h.mooring !== 'free') return 'Wait until she is alongside';
    if (h.anchor !== 'down' || h.dragging) return 'Anchor or tie up first (X, or F at a berth)';
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
        await deps.fade('Ashore', `Down the gangway onto the ${pier.name}`, () => {
          from = 'berth';
          berthId = h.berthId;
          anchor = undefined;
          const at = gangwayAt(pier, shipPose());
          scene = build(at);
          inBoat = false;
          // Face along the pier toward the town.
          placeCharacter(character, at, pier.bearing + Math.PI);
          copyPrevious();
          enter();
        });
      } else {
        await deps.fade('Into the boat', 'The boat goes over the side', () => {
          from = 'anchor';
          berthId = undefined;
          anchor = { x: h.anchorX, z: h.anchorZ };
          const p = shipPose();
          // Over the side nearer the shore, pointing at it.
          const terrain = deps.terrain();
          const off = deps.hull.beamM / 2 + ROWBOAT.beamM;
          const side = [1, -1]
            .map((s) => {
              const x = p.x + Math.cos(p.heading) * off * s;
              const z = p.z + Math.sin(p.heading) * off * s;
              return { s, x, z, d: terrain?.shoreDistanceAt(x, z) ?? 0 };
            })
            .sort((a, b) => a.d - b.d)[0] as { s: number; x: number; z: number };
          boat = createRowboat(side.x, side.z, p.heading + (side.s * Math.PI) / 2);
          boatState = 'afloat';
          inBoat = true;
          scene = build(boat);
          seatInBoat();
          copyPrevious();
          enter();
        });
      }
    } finally {
      busy = false;
    }
    await deps.save();
    return undefined;
  };

  const leave = (): void => {
    active = false;
    scene = undefined;
    inBoat = false;
    boat = undefined;
    boatState = 'stowed';
    prompt = undefined;
    from = undefined;
    berthId = undefined;
    anchor = undefined;
    if (deps.view) deps.view.foot = undefined;
    deps.look.detachListeners();
    deps.transition('sailing');
  };

  const goAboard = async (): Promise<void> => {
    if (!active || busy) return;
    busy = true;
    try {
      await deps.fade('Back aboard', inBoat ? 'The boat hoisted in' : 'Up the side and aboard', leave);
    } finally {
      busy = false;
    }
    await deps.save();
  };

  const stepAshore = async (): Promise<string | undefined> => {
    if (!active || !inBoat || !boat || busy) return 'Not in the boat';
    const terrain = deps.terrain();
    const step = terrain && beachStep((x, z) => terrain.heightAt(x, z), bowPoint(boat), boat.heading);
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
    placeCharacter(
      character,
      { x: boat.x, y: ROWBOAT.freeboardM - 0.4, z: boat.z },
      boat.heading,
    );
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
    if (c.ladder !== undefined || c.move) return undefined;
    // At the gangway, or swimming alongside her, you go aboard.
    if (from === 'berth' && berthId) {
      const pier = pierOf(berthId);
      if (pier && c.grounded) {
        const g = gangwayAt(pier, shipPose());
        if (Math.hypot(c.position.x - g.x, c.position.z - g.z) < REACH_M && Math.abs(c.position.y - g.y) < 1) {
          return { text: 'Go aboard', act: () => void goAboard() };
        }
      }
    }
    if (c.swimming && toHull(c.position.x, c.position.z) < DEFAULT_CONTROLLER.radius + 1.2) {
      return { text: 'Climb aboard', act: () => void goAboard() };
    }
    if (boat && Math.hypot(c.position.x - boat.x, c.position.z - boat.z) < REACH_M + 0.8) {
      if (boatState === 'beached' && !c.swimming) return { text: 'Shove off', act: shoveOff };
      if (boatState !== 'beached') return { text: 'Climb into the boat', act: climbIn };
    }
    const top = ladderTopNear(c, scene);
    if (top !== undefined) {
      return { text: 'Climb down', act: () => scene && climbDownLadder(c, scene, top) };
    }
    return undefined;
  };

  const ladderNear = (x: number, z: number, reach: number): number | undefined => {
    const ladders = scene?.ladders ?? [];
    for (let k = 0; k < ladders.length; k++) {
      const l = ladders[k];
      if (l && Math.hypot(l.x - x, l.z - z) < reach) return k;
    }
    return undefined;
  };

  // --- The tick -------------------------------------------------------------------------

  const hurt = (amount: number, cause: 'drowned' | 'fell'): void => {
    if (amount <= 0) return;
    state.player.health = Math.max(0, state.player.health - amount);
    lastHurt = cause;
  };

  const rowEnv = {
    depthAt: (x: number, z: number): number => -(deps.terrain()?.heightAt(x, z) ?? -100),
    blocked: (x: number, z: number, r: number) => {
      if (!scene) return undefined;
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
    const ahead = (input.isDown('MoveForward') ? 1 : 0) - (input.isDown('MoveBack') ? 1 : 0);
    const side = (input.isDown('MoveRight') ? 1 : 0) - (input.isDown('MoveLeft') ? 1 : 0);
    if (inBoat && boat) {
      boatPrev = { x: boat.x, z: boat.z, heading: boat.heading };
      stepRowboat(boat, { pull: ahead, turn: side }, rowEnv, dt);
      if (swamped(deps.hsAt(boat.x, boat.z))) {
        // A sea fills her: you're in the water beside her.
        inBoat = false;
        boatState = 'swamped';
        boat.speed = 0;
        placeCharacter(
          character,
          { x: boat.x + Math.cos(boat.heading) * 1.2, y: -DEFAULT_CONTROLLER.swimDepth, z: boat.z + Math.sin(boat.heading) * 1.2 },
          boat.heading,
        );
        deps.notice('A sea filled the boat. Swim for it!');
      } else {
        seatInBoat();
        const b = scene.bounds;
        if (
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
        { forward: ahead, right: side, run: input.isDown('Sprint'), crouch: input.isDown('Crouch'), jump: input.pressed('Jump') },
        walkCamera.yaw,
        scene,
        dt,
      );
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
      if (character.landedSpeed > 0) {
        hurt(fallDamage(character.landedSpeed, character.landedInWater), 'fell');
        if (fallDamage(character.landedSpeed, character.landedInWater) > 0 && state.player.health > 0) {
          deps.notice(state.player.health < BADLY_HURT ? 'A bad fall: you are badly hurt' : 'A hard landing');
        }
      }
      if (character.swimming) hurt(coldDrainPerS(waterC()) * dt, 'drowned');
    }

    prompt = findPrompt();
    if (input.pressed('Interact') && prompt) prompt.act();

    if (state.player.health <= 0 && !dead) {
      dead = true;
      deps.died(lastHurt);
    }
  };

  // Wounds heal on the world clock while you're dry (plan 08 §3.3).
  ctx.events.on('WorldTick', () => {
    if (active && character.swimming) return;
    if (state.player.health < MAX_HEALTH) state.player.health = heal(state.player.health, 600);
  });

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
      ctx.weather.tick(state.environment.clock.gameSeconds, character.position, ctx.sea);
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
        const bh = Math.atan2(Math.sin(boat.heading - boatPrev.heading), Math.cos(boat.heading - boatPrev.heading));
        boatFrame = {
          x: boatPrev.x + (boat.x - boatPrev.x) * alpha,
          z: boatPrev.z + (boat.z - boatPrev.z) * alpha,
          heading: boatPrev.heading + bh * alpha,
          beached: boatState === 'beached',
          manned: inBoat,
        };
      }
      const feet = inBoat && boatFrame ? { x: boatFrame.x, y: 0, z: boatFrame.z } : { x, y, z };
      const head = y + (character.crouching ? DEFAULT_CONTROLLER.crouchHeight : DEFAULT_CONTROLLER.standHeight);
      const indoors = !inBoat && roofOver(scene, x, head, z);
      cam.update(feet, character.crouching || character.swimming, scene, frameSeconds, indoors);
      view.foot = {
        camera: { position: cam.position, target: cam.target },
        captain: {
          x,
          y,
          z,
          heading,
          crouching: character.crouching,
          swimming: character.swimming,
          visible: !inBoat,
        },
        boat: boatFrame,
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
    goAshore,
    goAboard,
    stepAshore,
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
        prompt: prompt?.text,
        inBoat,
        swimming,
        gait: inBoat ? 'rowing' : character.gait,
      };
    },
    record(s) {
      s.player.rowboat =
        boat && boatState !== 'stowed'
          ? { state: boatState, pose: { x: boat.x, z: boat.z, heading: boat.heading } }
          : { state: 'stowed' };
      if (!active || !from) {
        s.player.ashore = null;
        return;
      }
      const c = character.position;
      s.player.ashore = {
        from,
        at: { x: c.x, y: c.y, z: c.z, heading: character.heading },
        inBoat,
        ...(berthId ? { berthId } : {}),
        ...(anchor ? { anchor: { ...anchor } } : {}),
      };
    },
    resume(saved) {
      from = saved.from;
      berthId = saved.berthId;
      anchor = saved.anchor;
      const rb = state.player.rowboat;
      boat = rb.pose ? createRowboat(rb.pose.x, rb.pose.z, rb.pose.heading) : undefined;
      boatState = boat ? rb.state : 'stowed';
      inBoat = saved.inBoat && !!boat;
      if (boat && boatState === 'beached') boat.beached = true;
      scene = build(inBoat && boat ? boat : saved.at);
      if (inBoat) seatInBoat();
      else placeCharacter(character, saved.at, saved.at.heading);
      copyPrevious();
      enter();
    },
    teleport(x, z, y) {
      if (!active) return;
      if (inBoat && boat) {
        boat.x = x;
        boat.z = z;
        seatInBoat();
      } else {
        const ground = deps.terrain()?.heightAt(x, z) ?? 0;
        placeCharacter(character, { x, y: y ?? Math.max(ground, -DEFAULT_CONTROLLER.swimDepth), z });
      }
      if (!scene || x < scene.bounds.minX + 20 || x > scene.bounds.maxX - 20 || z < scene.bounds.minZ + 20 || z > scene.bounds.maxZ - 20) {
        scene = build({ x, z }) ?? scene;
      }
      copyPrevious();
    },
  };
}

export { ASHORE_HALF_M };
