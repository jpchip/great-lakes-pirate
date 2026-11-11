import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { SkyLight } from '../../sim/law/perception';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import type { DistrictModel } from '../district/district';
import { DEFAULT_CONTROLLER, type CharacterState } from './controller';
import { conduct as judge, isNight, layoutConductMap, type Conduct } from './conduct';
import {
  districtLamps,
  lightLamps,
  planDistrictWatch,
  type SuspectContext,
} from './district-guards';
import { createFootLaw, type FootLaw, type FootLawHooks } from './foot-law';
import { gameNpcs, rosterForTier, type NpcDefs } from './guards';
import { ambientLight01, LampSet } from './light';
import type { NavQuery } from './nav';
import { fogOnFoot01 } from './perception';
import { createStealth, type Stealth, type StealthEvent, type StealthReadout } from './stealth';
import {
  createTools,
  gameTools,
  type Offer,
  type OnFootTools,
  type Pockets,
  type ToolContext,
  type ToolEvent,
} from './tools';
import { footToolsHud, type FootToolsSnapshot } from '../../ui/hud/foot-tools-model';
import type { HeistTarget } from '../../../data/schemas/heist';
import type { DistrictWorld } from '../../sim/world-state';
import type { ControllerParams } from './controller';
import { createHeist, type Heist, type HeistEvent, type HeistHooks } from './heist';

/**
 * The night watch in a district you've gone ashore in (plan 08 §5, §10; Phase 7): piece D's
 * guards and perception on the district's real navmesh, lamps and colliders, stepped with
 * the on-foot tick. The game's clock, moon, cloud, fog and rain light the scene; the
 * region's Wanted tier sizes the roster and Fame how fast a face is known.
 *
 * A capture is handed back once (`onCaptured`); the ashore mode takes you off your feet and
 * the jail (Phase 5) takes it from there. Everything else the guards do goes out as their
 * `StealthEvent`s, which piece I (barks) listens to.
 *
 * Piece E: conduct (`conduct.ts`) says when being seen is suspicious, from the district's
 * buildings and their hours; with `pockets`, the tool belt (`tools.ts`) acts on the guards
 * through F; with `law`, what the guards and tools do becomes crimes (`foot-law.ts`).
 * Part two: with `heist`, the district's targets lock at night and their crates, cash
 * boxes and papers can be taken (`heist.ts`); F does, in order, what a tool can do to a man
 * in reach, then a lock, a crate or the gangway, then the ashore prompt, then a throw.
 */

export interface WatchConditions {
  gameSeconds: number;
  cloud01: number;
  fogM: number;
  rain01: number;
  /** The region's Wanted tier now. */
  wantedTier: number;
  /** Plan 06's recognition: Fame's tier as 0 unknown … 1 legendary. */
  fame01: number;
}

export interface WatchOptions {
  model: DistrictModel;
  nav: NavQuery;
  /** Read each tick. */
  conditions(): WatchConditions;
  /** The tier the roster is drawn for (the region's when you landed). */
  tier: number;
  seed: string;
  defs?: NpcDefs;
  /** Overrides conduct when it returns a value (the dev hook `__glpFoot.suspect`). */
  suspect?(c: SuspectContext): boolean | undefined;
  /** The purse and stores the tool belt spends (the player's). Absent, no tools. */
  pockets?: Pockets;
  /** The law the crimes on foot go to (the game's), with where this district is. */
  law?: FootLawHooks & { region(): string; port?: string };
  /** A guard laid hands on you: `by` is their npc type. */
  onCaptured(by: string, guard: string): void;
  /** The ship's weapon is aboard (the rifle on the belt). */
  hasWeapon?(id: string): boolean;
  /** The locks and loot (part two): the targets, the save's record and where crates go. */
  heist?: { targets: readonly HeistTarget[]; world: DistrictWorld; hooks: HeistHooks };
}

export interface Watch {
  readonly stealth: Stealth;
  readonly tier: number;
  /** A guard is chasing you (no autosave, the danger snapshot). */
  readonly pursued: boolean;
  /** A guard is searching for you. */
  readonly searched: boolean;
  step(dt: number, player: CharacterState): void;
  readout(): StealthReadout;
  on(fn: (e: StealthEvent) => void): () => void;
  /** The tool belt, if there are pockets. */
  readonly tools: OnFootTools | undefined;
  readonly footLaw: FootLaw | undefined;
  /** Conduct at the last step. */
  readonly conduct: Conduct | undefined;
  /** What F would do to a guard now, if anything. */
  offer(player: CharacterState): Offer | undefined;
  /**
   * F this tick, held and pressed: true when a tool or the heist took it (the ashore prompt
   * waits). A held use (tying a man up, picking a lock) fills while F is down. With
   * `otherPrompt`, the ashore mode has something for F to do, so a throw gives way to it.
   */
  interact(
    dt: number,
    player: CharacterState,
    down: boolean,
    pressed: boolean,
    otherPrompt?: boolean,
  ): boolean;
  /** The locks and loot, with `heist`. */
  readonly heist: Heist | undefined;
  /** The controller's params with your arms full (a crate is slow). */
  params(base: ControllerParams): ControllerParams;
  onHeist(fn: (e: HeistEvent) => void): () => void;
  /** The belt, the conduct line and the prompt for the HUD (`otherPrompt`: as `interact`). */
  toolsHud(player: CharacterState, otherPrompt?: boolean): FootToolsSnapshot | undefined;
  onTool(fn: (e: ToolEvent) => void): () => void;
}

export function skyAt(gameSeconds: number, cloud01: number): SkyLight {
  const sun = sunAt(gameSeconds);
  const moon = moonAt(gameSeconds);
  return {
    sunElevationRad: sun.elevationRad,
    moonElevationRad: moon.elevationRad,
    moonIllumination01: moon.illumination01,
    cloud01,
  };
}

export function createWatch(opts: WatchOptions): Watch {
  const { model, nav } = opts;
  const defs = opts.defs ?? gameNpcs();
  const plan = planDistrictWatch(model, nav);
  const lamps = districtLamps(model);
  const lampSet = new LampSet(lamps);
  const stealth = createStealth(
    {
      zone: model,
      nav,
      lamps: lampSet,
      rng: Rng.fromSeed(`${opts.seed}:watch:${model.layout.id}`),
      ...(plan.lawPost ? { lawPost: plan.lawPost } : {}),
    },
    defs,
    rosterForTier(defs, plan.base, plan.spareBeats, opts.tier),
    opts.tier,
  );
  // Stand each guard on the floor at their start (a pier deck, not the lake bed under it).
  for (const g of stealth.guards) {
    const p = g.body.position;
    p.y = model.floorAt(p.x, p.z);
    g.previous.y = p.y;
  }
  const conductMap = layoutConductMap(model.layout, gameTools().file);
  let lastConduct: Conduct | undefined;
  const tools = opts.pockets
    ? createTools(
        stealth,
        opts.pockets,
        model,
        Rng.fromSeed(`${opts.seed}:tools:${model.layout.id}`),
        gameTools(),
        {
          ...(opts.hasWeapon ? { hasWeapon: opts.hasWeapon } : {}),
          handsFull: () => heist?.carrying !== undefined,
        },
      )
    : undefined;
  const heist: Heist | undefined =
    opts.heist && opts.pockets
      ? createHeist({
          model,
          targets: opts.heist.targets,
          world: opts.heist.world,
          stealth,
          tools,
          pockets: opts.pockets,
          hooks: opts.heist.hooks,
          seed: opts.seed,
        })
      : undefined;
  const footLaw = opts.law
    ? createFootLaw(
        stealth,
        tools,
        opts.law,
        {
          get region() {
            return opts.law?.region() ?? '';
          },
          ...(opts.law.port ? { port: opts.law.port } : {}),
        },
        () => lastConduct?.reason,
        heist && {
          heist,
          now: () => opts.conditions().gameSeconds,
          buildingName: (id) => model.layout.buildings.find((b) => b.id === id)?.name,
        },
      )
    : undefined;
  let holdS = -1;
  const toolContext = (player: CharacterState): ToolContext => {
    const c = opts.conditions();
    return {
      player,
      gameSeconds: c.gameSeconds,
      wantedTier: c.wantedTier,
      fame01: c.fame01,
      light01: stealth.readout().light.level01,
    };
  };
  let told = false;
  stealth.on((e) => {
    if (e.type !== 'Captured' || told) return;
    told = true;
    opts.onCaptured(e.by, e.npc);
  });

  return {
    stealth,
    tier: opts.tier,
    get pursued() {
      return stealth.guards.some((g) => g.state === 'alerted' && g.type.pursues);
    },
    get searched() {
      return stealth.guards.some((g) => g.state === 'search');
    },
    step(dt, player) {
      const c = opts.conditions();
      const sky = skyAt(c.gameSeconds, c.cloud01);
      lightLamps(lamps, ambientLight01(sky, fogOnFoot01(c.fogM)));
      const p = player.position;
      const { hour } = dayAndHour(c.gameSeconds);
      const carrying = tools?.carrying !== undefined;
      heist?.step({ player, gameSeconds: c.gameSeconds });
      lastConduct = judge(conductMap, {
        at: p,
        gait: player.gait,
        crouching: player.crouching,
        swimming: player.swimming,
        hour,
        night: isNight(sky),
        carryingBody: carrying,
        carryingLoot: heist?.carrying !== undefined,
        armed: tools?.armed() ?? false,
      });
      const forced = opts.suspect?.({ model, player, hour, carrying });
      stealth.step(dt, {
        player,
        playerParams: DEFAULT_CONTROLLER,
        surface: model.surfaceAt(p.x, p.z, p.y),
        sky,
        fogM: c.fogM,
        rain01: c.rain01,
        gameSeconds: c.gameSeconds,
        carrying: carrying || heist?.carrying !== undefined,
        suspect: forced ?? lastConduct.suspect,
        fame01: c.fame01,
        wantedTier: c.wantedTier,
      });
      tools?.step(toolContext(player));
    },
    readout: () => stealth.readout(),
    on: (fn) => stealth.on(fn),
    tools,
    footLaw,
    get conduct() {
      return lastConduct;
    },
    offer: (player) => tools?.offer(toolContext(player)),
    heist,
    params: (base) => heist?.params(base) ?? base,
    onHeist: (fn) => heist?.on(fn) ?? (() => undefined),
    interact(dt, player, down, pressed, otherPrompt = false) {
      if (!tools || stealth.captured) return false;
      let o = tools.offer(toolContext(player));
      // A man in reach first; then a lock, a crate or the gangway; a throw last of all.
      if (!o || tools.lowPriority(o)) {
        const at = { player, gameSeconds: opts.conditions().gameSeconds };
        if (heist?.offer(at)) {
          holdS = -1;
          heist.interact(at, dt, down, pressed);
          return true;
        }
        if (o && otherPrompt) o = undefined;
      }
      if (!o) {
        holdS = -1;
        return false;
      }
      if (pressed) {
        if (o.holdS > 0) holdS = 0;
        else tools.use(toolContext(player));
        return true;
      }
      if (holdS >= 0) {
        if (!down || !o.ok || o.holdS <= 0) holdS = -1;
        else if ((holdS += dt) >= o.holdS) {
          tools.use(toolContext(player));
          holdS = -1;
        }
      }
      return true;
    },
    toolsHud(player, otherPrompt = false) {
      if (!tools || !opts.pockets) return undefined;
      let o = tools.offer(toolContext(player));
      const at = { player, gameSeconds: opts.conditions().gameSeconds };
      const h = !o || tools.lowPriority(o) ? heist?.offer(at) : undefined;
      if (o && tools.lowPriority(o) && (h || otherPrompt)) o = undefined;
      const hold01 = o && o.holdS > 0 && holdS >= 0 ? holdS / o.holdS : 0;
      const crate = heist?.carrying;
      return footToolsHud(
        tools,
        lastConduct ?? { suspect: false, reason: undefined, words: '', area: undefined },
        o,
        hold01,
        opts.pockets.purse,
        heist && {
          prompt: h && {
            key: 'F',
            label: h.label,
            ok: h.ok,
            why: h.why ?? '',
            hold01: h.holdS > 0 ? heist.hold01(at) : 0,
          },
          load: crate
            ? `Carrying a crate of ${crate.good.replace(/^good\./, '').replace(/_/g, ' ')}`
            : '',
        },
      );
    },
    onTool: (fn) => tools?.on(fn) ?? (() => undefined),
  };
}
