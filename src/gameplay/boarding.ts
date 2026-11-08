import type { BoardingRules } from '../../data/schemas/boarding';
import type { ShipRecord } from '../../data/schemas/ships';
import type { GameContext } from '../modes/context';
import {
  AFTERMATH_CHOICES,
  previewAftermath,
  resolveAftermath,
  type AftermathChoice,
  type AftermathConditions,
} from '../sim/boarding/aftermath';
import {
  alongside,
  BOARD_REFUSALS,
  boardingOdds,
  boardRefusal,
  gameBoarding,
  resolveBoarding,
  type BoardedShip,
  type BoardingOdds,
  type BoardingSide,
} from '../sim/boarding/check';
import { createPrize, quickGrab, takeLot, type Prize } from '../sim/boarding/loot';
import { recordLimping, recordLost, recordRobbed, robbedLately } from '../sim/boarding/record';
import { hullGapM } from '../sim/arena/collide';
import { perksOf } from '../sim/character/backgrounds';
import { hash01, monthAt } from '../sim/chart/routes';
import type { ShipDamage } from '../sim/combat/damage';
import { holdUsed } from '../sim/economy/hold';
import { formatCents } from '../sim/economy/knowledge';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import type { Manifest } from '../sim/traffic/cargo';
import type { TrafficState } from '../sim/world-state';
import type { BoardingActions, BoardingSnapshot } from '../ui/boarding/model';
import type { GameCombat } from './combat';
import type { GameEconomy } from './economy';
import type { Entity } from './ecs';
import type { ShipHazards } from './hazards';
import type { Targets } from './targets';

/**
 * Boarding, looting and the aftermath in play (plan 07 §6, §7; Phase 6 piece D). Alongside
 * a target under 2 kn, F grapples: a ship that has struck is only confirmed, and you go
 * straight to her hold; a T2 against a resisting crew gets the boarding panel (Intimidate,
 * Fight, Withdraw) with the odds and the death chance shown first. The looting screen
 * swings her freight across into your hold, hot with her owner's marks, each CU taking
 * game time; then you choose what becomes of her and her crew. The traffic slice records
 * her robbed, sunk or limping in, so the timetable doesn't bring her straight back.
 *
 * The screens pause the game like the port screen; the time looting takes runs the clock.
 */

export interface BoardingDeps {
  ctx: GameContext;
  player: Entity;
  hazards: ShipHazards;
  economy: GameEconomy;
  targets: Targets;
  combat: GameCombat;
  /** The NPC ships on the water now (arena or zone). */
  ships(): readonly Entity[];
  nameOf(id: string): string;
  /** A contact's manifest now (her steamer's for a consort), and her hold with her consort's. */
  manifest(contactId: string): Manifest | undefined;
  holdCu(contactId: string): number | undefined;
  /** The Wanted region she is taken in. */
  region(): string;
  fameTier(): number;
  dark01(): number;
  windKn(x: number, z: number): number;
  /** Her passage to her next port from here, game seconds, if one can be worked out. */
  voyageS(e: Entity): number | undefined;
  /** The player's speed through the water, knots. */
  playerKn(): number;
  /** Runs the clock forward (world ticks and all), as waiting does. */
  passTime(gameSeconds: number): void;
  show(snapshot: BoardingSnapshot | undefined): void;
  /** The screen opened or closed: pause and take the keys. */
  onOpen(open: boolean): void;
  notice(text: string): void;
  /** Killed in a lost fight: the run ends (permadeath). */
  endRun(shipName: string): void;
  /** The traffic slice changed: reread the losses onto the timetable. */
  syncLost(): void;
  /** A company's name for the screens. */
  ownerName?(id: string): string | undefined;
  rules?: BoardingRules;
}

type Stage = 'panel' | 'loot' | 'aftermath';

interface Session {
  entity: Entity;
  shipId: string;
  contactId: string;
  record: ShipRecord;
  name: string;
  owner: string | undefined;
  stage: Stage;
  intimidateTried: boolean;
  message?: string | undefined;
  prize?: Prize;
  quick: boolean;
  passage?: { cycle: number; outbound: boolean };
}

export interface GameBoarding {
  readonly open: boolean;
  /** The nearest target close enough to talk about, and how it lies. */
  near(): { entity: Entity; gapM: number; relKn: number } | undefined;
  /** HUD chip for a target alongside. */
  chip(): string | undefined;
  /**
   * F alongside: opens the panel or the hold, or says why not. Undefined when nothing
   * boardable is near (F means something else then).
   */
  board(): { opened: true } | { opened: false; why: string } | undefined;
  actions: BoardingActions;
  /** The odds against a ship as the panel would show them (tests and the dev hook). */
  oddsAgainst(id: string): BoardingOdds | undefined;
  close(): void;
}

/** A target within this gap, meters, gets a chip (grappling is `rules.alongside.gapM`). */
const CHIP_GAP_M = 120;
const HOUR = 3600;

const contactIdOf = (entityId: string): string => entityId.replace(/\.consort_\d+$/, '');
const recordOf = (classId: string | undefined): ShipRecord | undefined =>
  SHIP_RECORDS.find((r) => r.id === classId);

export function attachBoarding(deps: BoardingDeps): GameBoarding {
  const { ctx, economy } = deps;
  const rules = deps.rules ?? gameBoarding();
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const trafficShips = (): TrafficState['ships'] =>
    (ctx.state.traffic ??= { deliveredTo: now(), ships: {} }).ships;
  let session: Session | undefined;
  /** Ships scuttled from here: their sinking is recorded as a scuttling. */
  const scuttled = new Set<string>();

  const playerRecord = (): ShipRecord | undefined =>
    recordOf(ctx.state.player.ship?.classId ?? 'ship.t1_schooner');
  const tier = (): number => playerRecord()?.tier ?? 1;

  const body = (e: Entity, r: ShipRecord) => {
    const t = e.transform;
    return {
      x: t?.position.x ?? 0,
      z: t?.position.z ?? 0,
      heading: t?.heading ?? 0,
      vx: 0,
      vz: 0,
      halfLengthM: (r.lengthM * r.displayScale) / 2,
      halfBeamM: r.buoyancy.beam / 2,
      mass: 1,
    };
  };

  const near: GameBoarding['near'] = () => {
    const pr = playerRecord();
    const pt = deps.player.transform;
    if (!pr || !pt) return undefined;
    const pb = body(deps.player, pr);
    const pk = deps.playerKn();
    let best: { entity: Entity; gapM: number; relKn: number } | undefined;
    for (const e of deps.ships()) {
      const r = recordOf(e.npc?.classId);
      const t = e.transform;
      if (!r?.combat?.target || !t || !e.id || e.npc?.derelict) continue;
      const gap = hullGapM(pb, body(e, r));
      if (gap > CHIP_GAP_M || (best && gap >= best.gapM)) continue;
      const nk = e.npc?.speedKn ?? 0;
      const rvx = Math.sin(pt.heading) * pk - Math.sin(t.heading) * nk;
      const rvz = Math.cos(pt.heading) * pk - Math.cos(t.heading) * nk;
      best = { entity: e, gapM: gap, relKn: Math.hypot(rvx, rvz) };
    }
    return best;
  };

  const damageOf = (e: Entity): ShipDamage | undefined =>
    e.id ? deps.combat.damageOf(e.id) : undefined;

  const passageOf = (contactId: string): { cycle: number; outbound: boolean } | undefined => {
    const m = deps.manifest(contactId);
    return m ? { cycle: m.cycle, outbound: m.outbound } : undefined;
  };

  const refusalFor = (e: Entity): string | undefined => {
    const id = e.id ?? '';
    const d = damageOf(e);
    const passage = passageOf(contactIdOf(id));
    const why = boardRefusal(tier(), {
      target: !!recordOf(e.npc?.classId)?.combat?.target,
      sinking: !!d && (d.founderingS !== undefined || d.sunk),
      robbed: robbedLately(trafficShips(), id, now(), rules.robbedDays, passage),
      struck: deps.targets.isStruck(id),
    });
    return why && BOARD_REFUSALS[why];
  };

  const yourSide = (): BoardingSide => {
    const weapons = ctx.state.player.ship?.weapons ?? [];
    const kind = (w: string): string | undefined => deps.combat.defs.weapons.get(w)?.kind;
    return {
      tier: tier(),
      swivels: weapons.filter((w) => kind(w.weapon) === 'swivel').length,
      cannon: weapons.filter((w) => kind(w.weapon) === 'broadside').length,
      fameTier: deps.fameTier(),
      perks: perksOf(ctx.state.player.captain).map((p) => p.id),
      dark01: deps.dark01(),
    };
  };

  const herSide = (e: Entity): BoardedShip => {
    const d = damageOf(e);
    const r = recordOf(e.npc?.classId);
    const id = e.id ?? '';
    return {
      crew: d ? d.crew + d.wounded : (r?.combat?.crew ?? 6),
      wounded: d?.wounded ?? 0,
      armed: !!r?.combat?.armed,
      morale: deps.targets.moraleOf(id) ?? r?.combat?.moraleBase ?? 50,
      struck: deps.targets.isStruck(id),
    };
  };

  const oddsFor = (e: Entity): BoardingOdds => boardingOdds(rules, yourSide(), herSide(e));

  const conditions = (s: Session): AftermathConditions => {
    const p = s.entity.transform?.position ?? { x: 0, z: 0 };
    return {
      windKn: deps.windKn(p.x, p.z),
      month: monthAt(now()),
      dark01: deps.dark01(),
      voyageS: deps.voyageS(s.entity),
    };
  };

  // ---- the screens ----

  const hoursText = (s: number | undefined): string => {
    if (s === undefined) return 'Nobody left to tell it';
    const h = s / HOUR;
    if (h < 1.5) return 'Within the hour';
    if (h < 36) return `In about ${Math.round(h)} hours`;
    return `In about ${Math.round(h / 24)} days`;
  };

  const AFTERMATH_TEXT: Record<AftermathChoice, { label: string; text: string }> = {
    letGo: {
      label: 'Let them go',
      text: 'She sails on for her next port, short what you took. Her crew will describe your ship there.',
    },
    disable: {
      label: 'Disable and leave her',
      text: 'Cut her rigging and wreck her engine. She limps in, and the report is slow coming.',
    },
    adrift: {
      label: 'Set them adrift and scuttle her',
      text: 'Her crew takes to the boat and rows for shore; you open her seacocks. A sinking is talked of all round the lake.',
    },
    sinkWithCrew: {
      label: 'Sink her with the crew aboard',
      text: 'Batten them below and scuttle her. Nobody aboard lives to tell it. Murder, if it is ever found out.',
    },
  };

  const snapshot = (): BoardingSnapshot | undefined => {
    const s = session;
    if (!s) return undefined;
    const her = herSide(s.entity);
    const odds = oddsFor(s.entity);
    const owner = s.owner ? (deps.ownerName?.(s.owner) ?? s.owner) : undefined;
    const d = damageOf(s.entity);
    const snap: BoardingSnapshot = {
      stage: s.stage,
      shipId: s.shipId,
      shipName: s.name,
      className: s.record.name,
      ...(owner ? { ownerName: owner } : {}),
      struck: her.struck,
      crew: her.crew,
      wounded: her.wounded,
      killed: d?.killed ?? 0,
      morale: Math.round(her.morale),
      solo: tier() <= 1,
      odds: {
        strength: Math.round(odds.strength * 10) / 10,
        defense: Math.round(odds.defense * 10) / 10,
        intimidate: odds.intimidate,
        fight: odds.fight,
        death: odds.death,
        parts: odds.parts.map((p) => ({ label: p.label, value: Math.round(p.value * 10) / 10 })),
      },
      intimidateTried: s.intimidateTried,
      ...(s.message ? { message: s.message } : {}),
    };
    if (s.stage === 'loot' && s.prize) {
      const cargo = ctx.state.player.cargo;
      snap.loot = {
        lots: s.prize.lots
          .filter((l) => l.qty > 0)
          .map((l) => ({
            key: l.key,
            name: l.name,
            category: l.category,
            qty: l.qty,
            ...(l.cents !== undefined ? { cents: l.cents } : {}),
            minutesPerCu: l.minutesPerCu,
            quick: l.quick,
            unitCents: l.unitCents,
          })),
        usedCu: holdUsed(cargo),
        capacity: economy.capacity,
        purseCents: ctx.state.player.purse,
        minutes: Math.round(s.prize.minutes),
        takenCu: s.prize.taken.reduce((n, l) => n + l.qty, 0),
        takenCents: s.prize.cashCents,
        inSight: inSight(s.entity),
      };
    }
    if (s.stage === 'aftermath') {
      const c = conditions(s);
      snap.aftermath = {
        options: AFTERMATH_CHOICES.map((choice) => {
          const p = previewAftermath(rules, choice, c);
          return {
            choice,
            ...AFTERMATH_TEXT[choice],
            reportText: hoursText(p.reportInS),
            deathChance: p.deathChance,
            allHands: p.allHands,
          };
        }),
        weatherText: weatherText(c),
      };
    }
    return snap;
  };

  const weatherText = (c: AftermathConditions): string => {
    const wind = Math.round(c.windKn);
    const cold = rules.aftermath.adrift.coldMonths.includes(c.month);
    return `Wind ${wind} kn${cold ? ', the water deadly cold' : ''}${c.dark01 >= 0.5 ? ', dark' : ''}.`;
  };

  /** Other ships in sight of her while you work: each is a pair of eyes (piece F's witnesses). */
  const inSight = (e: Entity): number => {
    const p = e.transform?.position;
    if (!p) return 0;
    let n = 0;
    for (const o of deps.ships()) {
      if (o === e || !o.transform || o.npc?.derelict) continue;
      if (o.npc?.towedBy === e.id || e.npc?.towedBy === o.id) continue;
      const d = Math.hypot(o.transform.position.x - p.x, o.transform.position.z - p.z);
      if (d < 2000) n++;
    }
    return n;
  };

  const refresh = (): void => deps.show(snapshot());

  const openSession = (s: Session): void => {
    const was = !!session;
    session = s;
    if (!was) deps.onOpen(true);
    refresh();
  };

  const close = (): void => {
    if (!session) return;
    session = undefined;
    deps.show(undefined);
    deps.onOpen(false);
  };

  // ---- the hold ----

  const startLoot = (s: Session): void => {
    const contactId = s.contactId;
    const m = deps.manifest(contactId);
    let cargo = m?.cargo ?? rules.fallbackCargo[s.record.id] ?? [];
    // Her share of the freight she and her consort carry together.
    const total = m ? deps.holdCu(contactId) : undefined;
    if (m && total && total > 0 && s.record.cargoCapacity < total) {
      const share = s.record.cargoCapacity / total;
      cargo = cargo
        .map((l) => ({ good: l.good, qty: Math.floor(l.qty * share) }))
        .filter((l) => l.qty > 0);
    }
    const [lo, hi] = s.record.combat?.cashCents ?? [0, 0];
    const robbed = robbedLately(trafficShips(), s.shipId, now(), rules.robbedDays);
    const u = hash01(`${s.shipId}:${m?.cycle ?? 0}:${m?.outbound ?? true}:cash`);
    const cashCents = robbed ? 0 : Math.round(lo + (hi - lo) * u);
    s.prize = createPrize(rules, economy.defs, {
      shipId: s.shipId,
      owner: s.owner,
      region: deps.region(),
      now: now(),
      cargo,
      cashCents,
    });
    s.stage = 'loot';
  };

  /** She gave in: the surrender confirmed aboard, and her hold open to you. */
  const taken = (s: Session, how: 'struck' | 'intimidated' | 'fought'): void => {
    if (how !== 'struck')
      deps.targets.strike(
        s.shipId,
        how === 'fought' ? 'her deck carried by boarders' : 'her crew gave in to you',
      );
    ctx.events.emit('ShipSurrendered', { shipId: s.shipId, classId: s.record.id, how });
    ctx.events.emit('BoardingSucceeded', {
      shipId: s.shipId,
      option: how === 'struck' ? 'confirm' : how === 'intimidated' ? 'intimidate' : 'fight',
    });
    startLoot(s);
  };

  const finishLoot = (s: Session, message?: string): void => {
    const prize = s.prize;
    if (!prize) return;
    const valueCents = prize.taken.reduce(
      (n, l) => n + (economy.defs.goods.get(l.good)?.basePriceCents ?? 0) * l.qty,
      prize.cashCents,
    );
    ctx.events.emit('ShipLooted', {
      shipId: s.shipId,
      owner: s.owner,
      region: prize.region,
      goods: prize.taken.map((l) => ({ ...l })),
      cashCents: prize.cashCents,
      valueCents,
      minutes: Math.round(prize.minutes),
      quick: s.quick,
    });
    recordRobbed(trafficShips(), s.shipId, now(), prize.taken, prize.cashCents, s.passage);
    s.stage = 'aftermath';
    s.message = message;
    refresh();
  };

  const LOOT_REFUSALS = {
    gone: 'There is nothing more of that aboard her.',
    noRoom: 'There is no room left in your hold.',
    badQty: 'Choose how many CU.',
  } as const;

  // ---- what becomes of her ----

  const choose = (s: Session, choice: AftermathChoice): void => {
    const e = s.entity;
    const d = damageOf(e);
    const living = d ? d.crew + d.wounded : (s.record.combat?.crew ?? 0);
    const r = resolveAftermath(rules, choice, conditions(s), living, ctx.rng);
    const id = s.shipId;
    switch (choice) {
      case 'letGo':
        deps.targets.release(id);
        deps.notice(`You cast off. ${s.name} makes for port.`);
        break;
      case 'disable': {
        if (d) {
          deps.combat.damage(id, 'rigging', d.rigging);
          if (d.steam) deps.combat.damage(id, 'engine', d.engine);
        }
        if (r.reportInS !== undefined) recordLimping(trafficShips(), id, now(), r.reportInS);
        deps.notice(`Her rigging cut and her engine wrecked, ${s.name} is left wallowing.`);
        break;
      }
      case 'adrift': {
        if (d) {
          // Her hands are in the boat: none go down with her.
          d.crew = 0;
          d.wounded = 0;
        }
        ctx.events.emit('CrewSetAdrift', {
          shipId: id,
          crew: living,
          killed: r.killed,
          deathChance: r.deathChance,
        });
        if (r.killed > 0) casualties(id, r.killed, 'adrift');
        scuttle(s, false);
        deps.notice(
          r.killed > 0
            ? `The boat swamps in the sea running: ${r.killed} of her crew drown. You open her seacocks.`
            : 'Her crew pulls for shore in the boat. You open her seacocks.',
        );
        break;
      }
      case 'sinkWithCrew': {
        if (living > 0) casualties(id, living, 'sunk');
        if (d) {
          d.killed += living;
          d.crew = 0;
          d.wounded = 0;
        }
        scuttle(s, true);
        deps.notice(`You batten her hatches over her crew and open her seacocks.`);
        break;
      }
    }
    ctx.events.emit('AftermathChosen', {
      shipId: id,
      owner: s.owner,
      choice,
      killed: r.killed,
      survivors: r.survivors,
      reportInS: r.reportInS,
    });
    deps.syncLost();
    close();
  };

  const casualties = (
    id: string,
    killed: number,
    cause: 'boarding' | 'adrift' | 'sunk',
    wounded = 0,
  ) =>
    ctx.events.emit('CrewCasualties', {
      shipId: id,
      by: 'ship.player',
      killed,
      wounded,
      cause,
      lethal: killed > 0,
    });

  const scuttle = (s: Session, withCrew: boolean): void => {
    scuttled.add(s.shipId);
    ctx.events.emit('ShipScuttled', { shipId: s.shipId, withCrew });
    const d = damageOf(s.entity);
    if (d) deps.combat.damage(s.shipId, 'hull', d.hull);
  };

  // Every ship that goes down, by your hand or not, is off her timetable a while.
  ctx.events.on('ShipSunk', (e) => {
    const how = scuttled.has(e.shipId) ? 'scuttled' : 'sunk';
    scuttled.delete(e.shipId);
    recordLost(trafficShips(), e.shipId, now(), how, rules.lostDays);
    deps.syncLost();
  });

  // ---- actions ----

  const actions: BoardingActions = {
    intimidate() {
      const s = session;
      if (!s || s.stage !== 'panel' || s.intimidateTried) return;
      const odds = oddsFor(s.entity);
      ctx.events.emit('BoardingAttempted', {
        shipId: s.shipId,
        option: 'intimidate',
        chance: odds.intimidate,
        deathChance: 0,
      });
      const out = resolveBoarding(
        rules,
        'intimidate',
        odds,
        herSide(s.entity),
        playerHull(s),
        ctx.rng,
      );
      if (out.ok) {
        s.message = `Her master looks at your guns and your crew, and gives in.`;
        taken(s, 'intimidated');
      } else {
        s.intimidateTried = true;
        s.message = `They won't strike: her crew stands to the rail with handspikes. Fight, or sheer off.`;
      }
      refresh();
    },
    fight() {
      const s = session;
      if (!s || s.stage !== 'panel') return;
      const her = herSide(s.entity);
      const odds = oddsFor(s.entity);
      ctx.events.emit('BoardingAttempted', {
        shipId: s.shipId,
        option: 'fight',
        chance: odds.fight,
        deathChance: odds.death,
      });
      const out = resolveBoarding(rules, 'fight', odds, her, playerHull(s), ctx.rng);
      if (out.option !== 'fight') return;
      if (out.ok) {
        const d = damageOf(s.entity);
        const hit = out.theirKilled + out.theirWounded;
        if (d && hit > 0) {
          const takenHands = Math.min(hit, d.crew);
          d.crew -= takenHands;
          d.killed += out.theirKilled;
          d.wounded += Math.max(0, takenHands - out.theirKilled);
        }
        if (hit > 0) casualties(s.shipId, out.theirKilled, 'boarding', out.theirWounded);
        const ours = out.oursWounded > 0 ? ` ${out.oursWounded} of your hands are cut up.` : '';
        s.message =
          out.theirKilled > 0
            ? `You carry her deck: ${out.theirKilled} of her crew killed and ${out.theirWounded} wounded.${ours}`
            : `You carry her deck: ${out.theirWounded} of her crew wounded, none killed.${ours}`;
        taken(s, 'fought');
        refresh();
        return;
      }
      deps.hazards.state.hull = Math.max(0, deps.hazards.state.hull - out.hullDamage);
      ctx.events.emit('BoardingRepelled', {
        shipId: s.shipId,
        hullDamage: out.hullDamage,
        killed: out.killed,
      });
      const name = s.name;
      close();
      if (out.killed) {
        deps.endRun(name);
        return;
      }
      deps.notice(`Repelled! Her crew drives you back over the rail and fends you off.`);
    },
    withdraw() {
      const s = session;
      if (!s || s.stage !== 'panel') return;
      close();
      deps.notice(`You sheer off from ${s.name}.`);
    },
    take(key, qty) {
      const s = session;
      if (!s?.prize || s.stage !== 'loot') return undefined;
      const r = takeLot(rules, economy.defs, s.prize, ctx.state.player, economy.capacity, key, qty);
      if (!r.ok) return LOOT_REFUSALS[r.reason];
      economy.syncLoad();
      deps.passTime(r.minutes * 60);
      const lot = s.prize.lots.find((l) => l.key === key);
      s.message =
        key === 'cash'
          ? `Her cash box: ${formatCents(r.cents)}.`
          : `${r.qty} CU of ${(lot?.name ?? key).toLowerCase()} swung across (${Math.round(r.minutes)} min).`;
      refresh();
      return undefined;
    },
    quickGrab() {
      const s = session;
      if (!s?.prize || s.stage !== 'loot') return;
      const got = quickGrab(rules, economy.defs, s.prize, ctx.state.player, economy.capacity);
      economy.syncLoad();
      s.quick = true;
      const said =
        got.length === 0
          ? 'Nothing quick to grab.'
          : `You grab ${got.map((g) => (g.key === 'cash' ? formatCents(g.cents) : `${g.qty} CU`)).join(', ')} and go.`;
      finishLoot(s, said);
    },
    doneLooting() {
      const s = session;
      if (!s || s.stage !== 'loot') return;
      finishLoot(s);
    },
    choose(choice) {
      const s = session;
      if (!s || s.stage !== 'aftermath') return;
      choose(s, choice);
    },
    close() {
      const s = session;
      if (!s) return;
      // Esc: sheer off before boarding, stop looting, or let them go.
      if (s.stage === 'panel') actions.withdraw();
      else if (s.stage === 'loot') finishLoot(s);
      else choose(s, 'letGo');
    },
  };

  const playerHull = (s: Session) => ({
    tier: tier(),
    hull: deps.hazards.state.hull,
    hullMax: deps.hazards.cls.hullHP,
    herHullMax: s.record.hullHP,
  });

  return {
    get open() {
      return !!session;
    },
    near,
    chip() {
      if (session) return undefined;
      const n = near();
      if (!n?.entity.id) return undefined;
      const why = refusalFor(n.entity);
      if (why === BOARD_REFUSALS.notATarget) return undefined;
      const a = alongside(rules, n.gapM, n.relKn);
      if (a === 'notAlongside') {
        return deps.targets.isStruck(n.entity.id)
          ? 'She has struck: come alongside to board'
          : undefined;
      }
      if (why) return why;
      if (a) return BOARD_REFUSALS[a];
      return 'F board her';
    },
    board() {
      if (session) return { opened: true };
      const n = near();
      const e = n?.entity;
      if (!n || !e?.id) return undefined;
      const a = alongside(rules, n.gapM, n.relKn);
      if (a === 'notAlongside') return undefined;
      const why = refusalFor(e) ?? (a ? BOARD_REFUSALS[a] : undefined);
      if (why) return { opened: false, why };
      const record = recordOf(e.npc?.classId);
      if (!record) return undefined;
      const contactId = contactIdOf(e.id);
      const m = deps.manifest(contactId);
      const s: Session = {
        entity: e,
        shipId: e.id,
        contactId,
        record,
        name: deps.nameOf(e.id),
        owner: m?.owner,
        stage: 'panel',
        intimidateTried: false,
        quick: false,
        ...(m ? { passage: { cycle: m.cycle, outbound: m.outbound } } : {}),
      };
      if (deps.targets.isStruck(e.id)) {
        s.message = `Her master meets you at the rail with the ship's papers.`;
        taken(s, 'struck');
      }
      openSession(s);
      return { opened: true };
    },
    actions,
    oddsAgainst(id) {
      const e = deps.ships().find((x) => x.id === id);
      return e ? oddsFor(e) : undefined;
    },
    close,
  };
}
