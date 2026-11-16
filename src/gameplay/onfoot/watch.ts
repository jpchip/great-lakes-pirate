import { Rng } from '../../core/rng';
import { dayAndHour } from '../../core/time';
import type { SkyLight } from '../../sim/law/perception';
import { moonAt, sunAt } from '../../sim/weather/celestial';
import type { DistrictModel } from '../district/district';
import { DEFAULT_CONTROLLER, type CharacterState } from './controller';
import {
  conduct as judge,
  isNight,
  layoutConductMap,
  type Conduct,
  type ConductReason,
} from './conduct';
import {
  districtLamps,
  lightLamps,
  planDistrictWatch,
  type SuspectContext,
} from './district-guards';
import { createFootLaw, nextDawn, type FootLaw, type FootLawHooks } from './foot-law';
import { gameNpcs, rosterForTier, type NpcDefs } from './guards';
import { ambientLight01, LampSet, type Lamp } from './light';
import { douse, douseOffer, type DouseOffer } from './douse';
import { isDown } from './stealth';
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
import {
  createHeist,
  gameHeist,
  nightOf,
  type Heist,
  type HeistContainer,
  type HeistEvent,
  type HeistHooks,
} from './heist';
import {
  bottlesFor,
  cabinTable,
  crewEvidence,
  crewInSaloon,
  crewTables,
  deckWatch,
  holdTable,
  placeMoored,
  shipWords,
  type CrewDrunk,
  type MooredInput,
  type MooredShip,
} from './moored';
import type { DistrictMark } from '../../../data/schemas/districts';
import type { JailbreakRules } from '../../../data/schemas/jail';
import { createJailbreak, jailGuards, type Jailbreak, type JailbreakEvent } from './jailbreak';

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
  /**
   * The ships lying at the district's piers when you landed (piece F, part two), in its
   * local meters: each gets a deck watch, and a hold and cabin to rob. `present` says
   * whether one is still alongside; `crews` is the save's record of crews stood whiskey.
   */
  moored?: {
    ships: readonly MooredInput[];
    present(id: string): boolean;
    crews: Record<string, CrewDrunk>;
  };
  /**
   * A jailbreak (piece G): you start in the lockup's cell, the jailer is on his round, and
   * out of the cell anyone who sees you knows what you are. `on` hears how it goes.
   */
  jailbreak?: {
    rules: JailbreakRules;
    /** Tier 5's one chance: irons, more of the law, no promises. */
    execution: boolean;
    promiseCents: number | undefined;
    /** Game seconds the attempt is over. */
    dawnAt: number;
    on(e: JailbreakEvent): void;
  };
}

/** A moored ship's crew at its table in the saloon, for the prompt and the figures. */
export interface CrewAtTable {
  mark: DistrictMark;
  ship: MooredShip;
  /** Bottles they'd want. */
  bottles: number;
  /** They've had your whiskey tonight. */
  stood: boolean;
}

export interface Watch {
  readonly stealth: Stealth;
  readonly tier: number;
  /** A guard is chasing you (no autosave, the danger snapshot). */
  readonly pursued: boolean;
  /** A guard is searching for you. */
  readonly searched: boolean;
  /** `lean`: the head's offset while leaning (Q/E), meters. */
  step(dt: number, player: CharacterState, lean?: { x: number; z: number }): void;
  readout(): StealthReadout;
  on(fn: (e: StealthEvent) => void): () => void;
  /** The tool belt, if there are pockets. */
  readonly tools: OnFootTools | undefined;
  readonly footLaw: FootLaw | undefined;
  /** Conduct at the last step. */
  readonly conduct: Conduct | undefined;
  /**
   * What an arrest would be for: the conduct a guard spotted you at (a body or loot beating
   * a weapon or a trespass), or what it is now. Undefined when nothing was amiss.
   */
  arrestReason(): ConductReason | undefined;
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
  /** The jailbreak under way, if this landing is one (piece G). */
  readonly jailbreak: Jailbreak | undefined;
  /** The ships moored in the district this landing, still alongside or not. */
  readonly moored: readonly MooredShip[];
  /** Whether a moored ship is still alongside. */
  alongside(ship: MooredShip): boolean;
  /** The crews in the saloon at this hour: none once they've gone back aboard to sleep. */
  crews(): CrewAtTable[];
  /**
   * Stands a crew whiskey (plan 08 §6.2): spends the bottles, and a bottle goes aboard for
   * the deck watch, who's asleep within the hour. What came of it, in a line.
   */
  standCrew(ship: MooredShip): string;
  /** The controller's params with your arms full (a crate is slow). */
  params(base: ControllerParams): ControllerParams;
  onHeist(fn: (e: HeistEvent) => void): () => void;
  /** The belt, the conduct line and the prompt for the HUD (`otherPrompt`: as `interact`). */
  toolsHud(player: CharacterState, otherPrompt?: boolean): FootToolsSnapshot | undefined;
  onTool(fn: (e: ToolEvent) => void): () => void;
  /** The district's lamps as the guards see them, in the model's order (doused or not). */
  readonly lamps: readonly Lamp[];
  /** What F would put out from here, if a lit lamp is in reach (plan 08 §6). */
  douseOffer(player: CharacterState): DouseOffer | undefined;
  /** Puts a lamp out as F would (the dev hook): the noise, and any guard watching grows wary. */
  douseLamp(k: number, player: CharacterState): void;
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

/** Nothing amiss: the conduct before the first step, and in the cell. */
const QUIET: Conduct = { suspect: false, reason: undefined, words: '', area: undefined };

export function createWatch(opts: WatchOptions): Watch {
  const { model, nav } = opts;
  const defs = opts.defs ?? gameNpcs();
  const plan = planDistrictWatch(model, nav);
  // Moored ships (piece F): solid hulls, and a sailor at each gangway ahead of the tier's extras.
  const moored = opts.moored ? placeMoored(model, nav, opts.moored.ships) : [];
  const gone = new Set<string>();
  for (const s of moored) {
    model.colliders.add(s.hull);
    plan.base.push(deckWatch(s));
  }
  // The lockup's own guards on the night of a jailbreak (piece G).
  if (opts.jailbreak) {
    plan.base.push(...jailGuards(model, opts.jailbreak.rules, opts.jailbreak.execution));
  }
  const rules = gameTools().file;
  const trick = rules.whiskey.trick;
  const perk = (): boolean => opts.heist?.hooks.perk?.(trick.perk) ?? false;
  const alongside = (s: MooredShip): boolean => !gone.has(s.id);
  const drunkTonight = (s: MooredShip, t: number): CrewDrunk | undefined => {
    const r = opts.moored?.crews[s.key];
    return r && r.night === nightOf(t) ? r : undefined;
  };
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
          ...(opts.jailbreak ? { emptyHanded: () => true } : {}),
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
          extra: moored.flatMap((s): HeistContainer[] => [
            {
              mark: `${s.key}.hold`,
              building: s.key,
              owner: s.owner,
              table: holdTable(s, rules),
              lock: undefined,
              ...s.hold,
              live: () => alongside(s),
            },
            {
              mark: `${s.key}.cabin`,
              building: s.key,
              owner: s.owner,
              table: cabinTable(s, rules),
              lock: trick.cabinLock,
              ...s.cabin,
              live: () => alongside(s),
            },
          ]),
        })
      : undefined;
  const jailbreak = opts.jailbreak
    ? createJailbreak({
        model,
        stealth,
        rules: opts.jailbreak.rules,
        locks: gameHeist().locks,
        execution: opts.jailbreak.execution,
        promiseCents: opts.jailbreak.promiseCents,
        bootPick: opts.heist?.hooks.perk?.(gameHeist().locks.bootPick.perk) ?? false,
        dawnAt: opts.jailbreak.dawnAt,
        rng: Rng.fromSeed(`${opts.seed}:jailbreak:${opts.jailbreak.dawnAt}`),
        ...(opts.heist?.hooks.notice ? { notice: opts.heist.hooks.notice } : {}),
      })
    : undefined;
  if (jailbreak && opts.jailbreak) jailbreak.on(opts.jailbreak.on);
  // A crew stood whiskey earlier tonight (a reload ashore): the watch is drunk, or asleep.
  {
    const t0 = opts.conditions().gameSeconds;
    for (const s of moored) {
      const r = drunkTonight(s, t0);
      if (r && stealth.guard(s.watch)) {
        stealth.makeDrunk(s.watch, t0, Math.max(0, r.passOutAt - t0), nextDawn(r.passOutAt));
      }
    }
  }
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
          buildingName: (id) =>
            moored.find((s) => s.key === id)?.name ??
            model.layout.buildings.find((b) => b.id === id)?.name,
          // A ship's burglary is her crew's to report: late and vague if they drank.
          evidence: (id, t) => {
            const s = moored.find((k) => k.key === id);
            return s && crewEvidence(s, t, drunkTonight(s, t) !== undefined, rules);
          },
        },
      )
    : undefined;
  let holdS = -1;
  let douseS = -1;
  const offerDouse = (player: CharacterState): DouseOffer | undefined =>
    jailbreak?.inCell || heist?.carrying || tools?.carrying
      ? undefined
      : douseOffer(lamps, model.lamps, player.position);
  const putOut = (k: number, player: CharacterState): void => {
    const l = lamps[k];
    if (!l) return;
    douse(l);
    stealth.noiseAt('douse', {
      x: l.x,
      y: player.position.y,
      z: l.z,
    });
    // Seen at it, you're someone up to something: they come over to look.
    for (const g of stealth.guards) {
      if (isDown(g.state) || g.state === 'bribed' || !g.glimpse?.seen) continue;
      stealth.wary(g.id);
    }
  };
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
  /** The worst conduct a guard spotted you at tonight: a body or loot over the rest. */
  let spottedFor: ConductReason | undefined;
  const noteReason = (r: ConductReason | undefined): void => {
    if (!r) return;
    const severe = (x: ConductReason): boolean => x === 'body' || x === 'loot';
    if (!spottedFor || (severe(r) && !severe(spottedFor))) spottedFor = r;
  };
  let told = false;
  stealth.on((e) => {
    if (e.type === 'PlayerSpotted') noteReason(lastConduct?.reason);
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
    step(dt, player, lean) {
      const c = opts.conditions();
      const sky = skyAt(c.gameSeconds, c.cloud01);
      lightLamps(lamps, ambientLight01(sky, fogOnFoot01(c.fogM)));
      const p = player.position;
      const { hour } = dayAndHour(c.gameSeconds);
      const carrying = tools?.carrying !== undefined;
      // A ship that's sailed is gone for this landing: no hull, no hold.
      for (const s of moored) {
        if (!gone.has(s.id) && opts.moored && !opts.moored.present(s.id)) {
          gone.add(s.id);
          s.hull.disabled = true;
        }
      }
      heist?.step({ player, gameSeconds: c.gameSeconds });
      jailbreak?.step({ player, gameSeconds: c.gameSeconds }, dt);
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
        // A prisoner in his cell is where he should be, whatever he's wanted for; out of it
        // he's an escaped man to anyone who sees him.
        suspect: forced ?? jailbreak?.suspect() ?? lastConduct.suspect,
        fame01: c.fame01,
        wantedTier: jailbreak?.inCell ? 0 : c.wantedTier,
        ...(lean ? { lean } : {}),
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
    arrestReason() {
      noteReason(lastConduct?.reason);
      return spottedFor;
    },
    offer: (player) => tools?.offer(toolContext(player)),
    heist,
    jailbreak,
    moored,
    alongside,
    crews() {
      const t = opts.conditions().gameSeconds;
      if (!crewInSaloon(dayAndHour(t).hour, rules)) return [];
      return crewTables(model.marks, moored)
        .filter(({ ship }) => {
          const r = drunkTonight(ship, t);
          return alongside(ship) && !(r && t >= r.passOutAt);
        })
        .map(({ mark, ship }) => ({
          mark,
          ship,
          bottles: bottlesFor(ship.crew, rules, perk()),
          stood: drunkTonight(ship, t) !== undefined,
        }));
    },
    standCrew(ship) {
      const t = opts.conditions().gameSeconds;
      const pockets = opts.pockets;
      const record = opts.moored?.crews;
      if (!pockets || !record || !alongside(ship)) return 'Not now';
      if (drunkTonight(ship, t)) return "They've had your whiskey already";
      const need = bottlesFor(ship.crew, rules, perk());
      const have = pockets.stores['store.whiskey'] ?? 0;
      if (have < need) {
        return `They'd want ${need} bottle${need === 1 ? '' : 's'}: you've ${have || 'none'}`;
      }
      pockets.stores['store.whiskey'] = have - need;
      const [lo, hi] = rules.whiskey.passOutMin;
      const rng = Rng.fromSeed(`${opts.seed}:trick:${ship.key}:${nightOf(t)}`);
      const passOutS = (rng.range(lo, hi) * 60) / (perk() ? trick.perkSpeed : 1);
      record[ship.key] = { night: nightOf(t), passOutAt: t + passOutS };
      if (stealth.guard(ship.watch)) {
        stealth.makeDrunk(ship.watch, t, passOutS, nextDawn(t + passOutS));
      }
      return `They drink your health, and a bottle goes aboard ${shipWords(ship)} for the man on watch`;
    },
    params: (base) => {
      const laden = heist?.params(base) ?? base;
      return jailbreak?.params(laden) ?? laden;
    },
    onHeist: (fn) => heist?.on(fn) ?? (() => undefined),
    interact(dt, player, down, pressed, otherPrompt = false) {
      if (stealth.captured) return false;
      // In the cell F is the jailbreak's: the irons, his keys, the door, the bars.
      if (
        jailbreak?.interact(
          { player, gameSeconds: opts.conditions().gameSeconds },
          dt,
          down,
          pressed,
        )
      ) {
        holdS = -1;
        return true;
      }
      if (!tools) return false;
      let o = tools.offer(toolContext(player));
      // A man in reach first; then a lock, a crate or the gangway; a throw last of all.
      if (!o || tools.lowPriority(o)) {
        const at = { player, gameSeconds: opts.conditions().gameSeconds };
        if (heist?.offer(at)) {
          holdS = -1;
          douseS = -1;
          heist.interact(at, dt, down, pressed);
          return true;
        }
        // A lit lamp in reach: hold F to put it out.
        const d = offerDouse(player);
        if (d) {
          holdS = -1;
          if (pressed) douseS = 0;
          else if (douseS >= 0) {
            if (!down) douseS = -1;
            else if ((douseS += dt) >= d.holdS) {
              putOut(d.lamp, player);
              douseS = -1;
            }
          }
          return true;
        }
        douseS = -1;
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
      const d = !h && (!o || tools.lowPriority(o)) ? offerDouse(player) : undefined;
      if (o && tools.lowPriority(o) && (h || d || otherPrompt)) o = undefined;
      const hold01 = o && o.holdS > 0 && holdS >= 0 ? holdS / o.holdS : 0;
      const crate = heist?.carrying;
      const j = jailbreak?.offer(at);
      if (j) {
        return footToolsHud(tools, QUIET, undefined, 0, opts.pockets.purse, {
          prompt: {
            key: 'F',
            label: j.label,
            ok: j.ok,
            why: j.why ?? '',
            hold01: j.holdS > 0 ? Math.max(j.done01, jailbreak?.hold01() ?? 0) : 0,
          },
          load: '',
        });
      }
      return footToolsHud(
        tools,
        lastConduct ?? QUIET,
        o,
        hold01,
        opts.pockets.purse,
        heist && {
          prompt: h
            ? {
                key: 'F',
                label: h.label,
                ok: h.ok,
                why: h.why ?? '',
                hold01: h.holdS > 0 ? heist.hold01(at) : 0,
              }
            : d && {
                key: 'F',
                label: d.label,
                ok: true,
                why: '',
                hold01: douseS >= 0 ? Math.min(1, douseS / d.holdS) : 0,
              },
          load: crate
            ? `Carrying a crate of ${crate.good.replace(/^good\./, '').replace(/_/g, ' ')}`
            : '',
        },
      );
    },
    onTool: (fn) => tools?.on(fn) ?? (() => undefined),
    lamps,
    douseOffer: offerDouse,
    douseLamp: putOut,
  };
}
