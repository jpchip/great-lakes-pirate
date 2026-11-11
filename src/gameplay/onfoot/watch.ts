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
   * F this tick, held and pressed: true when a tool took it (the ashore prompt waits). A
   * held use (tying a man up) fills while F is down.
   */
  interact(dt: number, player: CharacterState, down: boolean, pressed: boolean): boolean;
  /** The belt, the conduct line and the prompt for the HUD. */
  toolsHud(player: CharacterState): FootToolsSnapshot | undefined;
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
      )
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
      lastConduct = judge(conductMap, {
        at: p,
        gait: player.gait,
        crouching: player.crouching,
        swimming: player.swimming,
        hour,
        night: isNight(sky),
        carryingBody: carrying,
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
        carrying,
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
    interact(dt, player, down, pressed) {
      if (!tools || stealth.captured) return false;
      const o = tools.offer(toolContext(player));
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
    toolsHud(player) {
      if (!tools || !opts.pockets) return undefined;
      const o = tools.offer(toolContext(player));
      const hold01 = o && o.holdS > 0 && holdS >= 0 ? holdS / o.holdS : 0;
      return footToolsHud(
        tools,
        lastConduct ?? { suspect: false, reason: undefined, words: '', area: undefined },
        o,
        hold01,
        opts.pockets.purse,
      );
    },
    onTool: (fn) => tools?.on(fn) ?? (() => undefined),
  };
}
