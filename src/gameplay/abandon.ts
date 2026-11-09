import type { JailFile } from '../../data/schemas/jail';
import { Rng } from '../core/rng';
import { SECONDS_PER_GAME_DAY } from '../core/time';
import type { GameContext } from '../modes/context';
import { allPorts, gameEconomy, portInfo } from '../sim/economy/defs';
import { formatCents } from '../sim/economy/knowledge';
import { siteDef } from '../sim/hideouts/stash';
import { gameJail, strongboxes } from '../sim/law/jail';
import { recognition } from '../sim/law/law';
import { dateText } from '../sim/run/run-end';
import { log } from '../sim/run/record';
import { loseShip, settleHull, type HullSettlement } from '../sim/shipyard/abandon';
import { hullPriceCents } from '../sim/shipyard/shipyard';
import { sailShipRecord } from '../sim/sailing/ships';
import type { ReleaseSnapshot } from '../ui/jail/model';
import type { GameEconomy } from './economy';
import type { ShipHazards } from './hazards';
import type { GameLaw } from './law';
import type { SeaLaw } from './sea-law';
import type { GameShipyard } from './shipyard';

/**
 * Abandon ship (plan 07 §14.6 decision 2; Phase 6 piece F). At hull 0 your ship founders:
 * the HUD says "F abandon ship", and if you don't she goes under on her own after a
 * while with you in the boat anyway. She's lost with her cargo and guns, and her wreck lies
 * where she went down. A passing vessel lands you at the nearest port with a shipyard;
 * if they know your face (by Fame), their master tells the law what he knows of your
 * latest doings. The yard sells you a worn hull, paid from the purse, the strongboxes by
 * word, and work. A screen tells it, and you're aboard her alongside the yard's town.
 */

/** Real seconds a foundering ship stays afloat before she goes under with you in the boat. */
export const FOUNDER_S = 45;
/** Crimes this recent, still open, are what a rescuer who knows you tells of (game days). */
const RECENT_DAYS = 2;

export interface AbandonDeps {
  ctx: GameContext;
  law: GameLaw;
  seaLaw: SeaLaw;
  hazards: ShipHazards;
  shipyard: GameShipyard;
  economy: GameEconomy;
  seed: string;
  jail?: JailFile;
  /** Where she's going down: on the chart, in lat/lon, and in the zone if she's in one. */
  where():
    | {
        chart: { x: number; y: number };
        geo: { lat: number; lon: number };
        zone?: { id: string; x: number; z: number } | undefined;
      }
    | undefined;
  /** A port's place on the chart. */
  portAt(port: string): { x: number; y: number } | undefined;
  /** The clock runs on (world ticks and all). */
  passTime(gameSeconds: number): void;
  show(snapshot: ReleaseSnapshot | undefined): void;
  onOpen(open: boolean): void;
  /** Puts the new hull alongside the port's pier (the zone loads if it must). */
  landAt(port: string): Promise<void>;
  notice(text: string): void;
}

export interface Abandon {
  /** One sailing tick: a foundering ship goes down in the end. */
  step(dt: number): void;
  /** Seconds she has left afloat, while she founders. */
  readonly leftS: number | undefined;
  /** The HUD chip while she founders. */
  chip(): string | undefined;
  /** Over the side: F while she founders. False if she isn't foundering. */
  abandon(): boolean;
  readonly open: boolean;
  /** Where you were landed last (the dev hook and tests). */
  readonly landed: string | undefined;
  leave(): void;
}

/** Ports with a shipyard (`ports.json` services). */
function yardPorts(): string[] {
  return allPorts()
    .filter((p) => p.services.includes('shipyard'))
    .map((p) => p.id);
}

export function attachAbandon(deps: AbandonDeps): Abandon {
  const { ctx, law, hazards } = deps;
  const jail = deps.jail ?? gameJail();
  const state = ctx.state;
  const now = (): number => state.environment.clock.gameSeconds;
  let leftS: number | undefined;
  let open = false;
  let landed: string | undefined;
  let busy = false;

  const nearestYard = (at: { x: number; y: number } | undefined): string => {
    const ports = yardPorts();
    let best = ports[0] ?? 'port.ashland';
    let bestD = Infinity;
    for (const id of ports) {
      const p = deps.portAt(id);
      if (!p || !at) continue;
      const d = Math.hypot(p.x - at.x, p.y - at.y);
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  };

  /** A rescuer who knows your face tells the law what he's heard of your latest doings. */
  const recognized = (landAt: number): number => {
    const p = recognition(law.defs, state);
    const roll = Rng.fromSeed(`${deps.seed}|rescue|${now()}`).next();
    if (roll >= p) return 0;
    const since = now() - RECENT_DAYS * SECONDS_PER_GAME_DAY;
    let n = 0;
    for (const c of [...state.reports.crimes]) {
      if (c.at < since || c.filed >= 1) continue;
      law.addWitness(c.id, {
        id: 'rescuer',
        kind: 'crew',
        name: 'the master who picked you up',
        identification: 'person',
        reportAt: landAt,
      });
      n++;
    }
    return n;
  };

  const pay = (s: HullSettlement): void => {
    state.player.purse -= s.fromPurse;
    for (const b of s.fromBoxes) {
      const h = state.hideouts?.[b.hideout];
      if (h) h.storage.cash = Math.max(0, h.storage.cash - b.cents);
    }
  };

  const abandon = (): boolean => {
    if (busy || open || !hazards.state.foundering) return false;
    busy = true;
    leftS = undefined;
    const player = state.player;
    const shipName = player.captain.shipName;
    const where = deps.where();
    const region = law.region();
    const regionName = region ? law.defs.regionById.get(region)?.name : undefined;
    const fromClass = player.ship?.classId ?? jail.abandon.hullClass;
    const record = sailShipRecord(fromClass);
    // Her wreck, with whatever was in her hold.
    if (where) {
      deps.seaLaw.wreck({
        shipId: 'ship.player',
        name: shipName,
        classId: fromClass,
        className: record.name,
        how: 'abandoned',
        byPlayer: true,
        at: where.geo,
        zone: where.zone,
        region,
        regionName,
        drowned: 0,
        cargo: player.cargo.map((c) => ({ good: c.good, qty: c.qty })),
      });
    }
    const lost = loseShip(jail, player);
    deps.economy.syncLoad();
    ctx.events.emit('ShipAbandoned', {
      classId: lost.classId,
      region: region ?? '',
      cargo: lost.cargo,
      guns: lost.guns,
    });

    // In the boat until a ship comes by, and landed where she's bound.
    const rng = Rng.fromSeed(`${deps.seed}|abandon|${now()}`);
    const [lo, hi] = jail.abandon.rescueHours;
    const port = nearestYard(where?.chart);
    deps.passTime(rng.range(lo, hi) * 3600);
    const told = recognized(now());

    // The yard's worn hull: purse, strongboxes by word, then work.
    const econ = gameEconomy();
    const price = Math.round(
      hullPriceCents(econ, port, jail.abandon.hullClass) * jail.abandon.wornShare,
    );
    const settled = settleHull(jail, player.purse, strongboxes(state), price);
    pay(settled);
    if (settled.fromBoxes.length > 0) {
      const [wlo, whi] = jail.sendWord.delayHours;
      deps.passTime(rng.range(wlo, whi) * 3600);
    }
    if (settled.workDays > 0) deps.passTime(settled.workDays * SECONDS_PER_GAME_DAY);
    deps.shipyard.refit();
    ctx.events.emit('ShipPurchased', {
      port,
      classId: jail.abandon.hullClass,
      fromClassId: lost.classId,
      priceCents: price,
      tradeInCents: 0,
      autoSold: [],
      autoSoldCents: 0,
      moved: [],
    });
    landed = port;
    log(state, now(), `Abandoned the ${shipName}; landed at ${portInfo(port)?.name ?? port}.`);

    // The screen.
    const portName = portInfo(port)?.name ?? port;
    const goodName = (id: string): string => econ.goods.get(id)?.name.toLowerCase() ?? id;
    const lines: string[] = [];
    if (lost.cargo.length > 0) {
      lines.push(
        `Lost with her: ${lost.cargo.map((c) => `${c.qty} CU of ${goodName(c.good)}`).join(', ')}.`,
      );
    }
    if (lost.guns.length > 0) {
      lines.push(`Her guns went down with her: ${lost.guns.length}.`);
    }
    lines.push(
      `The yard at ${portName} let you have a worn ${sailShipRecord(jail.abandon.hullClass).name.toLowerCase()} for ${formatCents(price)}.`,
    );
    if (settled.fromPurse > 0)
      lines.push(`${formatCents(settled.fromPurse)} of it from your purse.`);
    for (const b of settled.fromBoxes) {
      const site = state.hideouts?.[b.hideout]?.siteId;
      const name = (site && siteDef(site)?.name) ?? 'your strongbox';
      lines.push(`You sent word to ${name}: ${formatCents(b.cents)} came, the messenger paid.`);
    }
    if (settled.workDays > 0) {
      lines.push(
        `${formatCents(settled.owedCents)} more you worked off in the yard: ${settled.workDays} week${settled.workDays === 1 ? '' : 's'}.`,
      );
    }
    if (told > 0) {
      lines.push(
        'The master who picked you up knew your face. He will have told the law what he knows.',
      );
    }
    deps.show({
      kind: 'released',
      title: 'Abandoned ship',
      heading: 'After she went down...',
      lead: `The ${shipName} foundered${regionName ? ` in ${regionName}` : ''} and went down under you. You got away in the boat, and a passing steamer landed you at ${portName}, ${dateText(now())}.`,
      inside: lines,
      ship: `She's sound enough to sail: hull ${Math.round(jail.abandon.wornHull01 * 100)}%, rigging ${Math.round(jail.abandon.wornRigging01 * 100)}%. You named her the ${shipName}.`,
      leaveLabel: 'Aboard her',
    });
    open = true;
    deps.onOpen(true);
    busy = false;
    return true;
  };

  return {
    step(dt) {
      if (open || busy) return;
      // Alongside a pier she's holding on her lines: the yard or the chandler can patch her.
      if (!hazards.state.foundering || hazards.state.mooring !== 'free') {
        leftS = undefined;
        return;
      }
      leftS = (leftS ?? FOUNDER_S) - dt;
      if (leftS <= 0) {
        deps.notice('She goes down under you: you take to the boat.');
        abandon();
      }
    },
    get leftS() {
      return leftS;
    },
    chip() {
      if (open || leftS === undefined) return undefined;
      return `She's going down: F abandon ship (${Math.max(0, Math.ceil(leftS))} s)`;
    },
    abandon,
    get open() {
      return open;
    },
    get landed() {
      return landed;
    },
    leave() {
      if (!open) return;
      open = false;
      deps.show(undefined);
      deps.onOpen(false);
      const port = landed;
      if (port) void deps.landAt(port);
    },
  };
}
