import type { Smuggler } from '../../data/schemas/smuggler';
import { ChartProjection, chartToZone, type Zone, type ZoneFrame } from '../core/coords';
import type { GameContext } from '../modes/context';
import type { EconomyDefs } from '../sim/economy/defs';
import {
  buyFromSmuggler,
  fenceToSmuggler,
  freshContrabandState,
  gameSmuggler,
  knowsAnchorage,
  restock,
  smugglerAbout,
  type ContrabandState,
  type SmugglerRefusal,
  type SmugglerResult,
} from '../sim/economy/smuggler';
import { formatCents } from '../sim/economy/knowledge';
import { SHIP_RECORDS } from '../sim/sailing/ships';
import { sunAt } from '../sim/weather/celestial';
import type { SmugglerActions } from '../ui/port/SmugglerScreen';
import { smugglerSnapshot, type SmugglerSnapshot } from '../ui/port/smuggler-model';
import { cloneTransform, type Entity } from './ecs';
import type { GameEconomy } from './economy';
import { createNpcShipEntity } from './npc-ships';

/**
 * The island smuggler in the running game (plan 05 §6.2; Phase 4 piece H). After dark she
 * lies to her anchor in Oak Island's lee whenever the Apostles zone is loaded; by day she
 * is gone (out of sight, she doesn't sail anywhere). Come alongside her slowly and F
 * opens her screen over the paused game. Whether you know where she lies is a background,
 * a rumor (piece K) or the dev command; it puts her anchorage on the chart.
 */

/** Her entity's id in the world. */
export const SMUGGLER_ENTITY_ID = 'npc.smuggler';
/** Alongside: hull centers this close, meters (her length and ours, with a fender's width). */
export const ALONGSIDE_M = 70;
/** And slow: at most this many knots through the water. */
export const ALONGSIDE_KN = 2.5;
/** At dawn she slips away only once you're this far off, or once the sun is up. */
const SLIP_AWAY_M = 500;

export interface SmugglerControl {
  readonly def: Smuggler;
  /** Her boat is in the zone now. */
  readonly present: boolean;
  readonly open: boolean;
  /** Her anchorage in the loaded zone's meters, if it's her zone. */
  readonly anchorage: Zone | undefined;
  /** The loaded zone; undefined in an arena or on the chart. */
  setZone(zone: { id: string; frame: ZoneFrame } | undefined): void;
  /** Brings her in after dark and sends her off at dawn; `player` is our ship. */
  step(player: { x: number; z: number }): void;
  isSmuggler(entityId: string | undefined): boolean;
  /** F near her: opens her screen, or says why not. */
  comeAlongside(player: { x: number; z: number }, speedKn: number): string | undefined;
  /** HUD chip for her, if she's in hail. */
  chip(player: { x: number; z: number }, speedKn: number): string | undefined;
  close(): void;
  known(): boolean;
  /** Where she lies becomes known (a background is known from the start). */
  learn(source: string): void;
  actions: SmugglerActions;
  dispose(): void;
}

export interface SmugglerControlOptions {
  ctx: GameContext;
  economy: GameEconomy;
  show(snapshot: SmugglerSnapshot | undefined): void;
  /** The screen opened or closed: pause and take the keys. */
  onOpen(open: boolean): void;
  /** Piece K's answer: has the captain heard the rumor of her anchorage? */
  heardOf?: () => boolean;
  def?: Smuggler;
}

const REFUSALS: Record<SmugglerRefusal, string> = {
  gone: 'She has gone.',
  badQty: 'Choose how many CU.',
  noStock: "She hasn't that much left this week.",
  noRoom: 'There is no room in the hold.',
  noMoney: "You haven't the money.",
  noCash: "She hasn't the cash left for that this week.",
  clean: 'Clean goods: she says take them to a merchant.',
  contract: "A company's freight: she won't touch it.",
  hers: 'She has barrels enough of her own.',
  unknown: "She doesn't deal in that.",
  badLot: 'That lot is gone.',
};

const projection = new ChartProjection();

export function attachSmuggler(opts: SmugglerControlOptions): SmugglerControl {
  const { ctx, economy } = opts;
  const def = opts.def ?? gameSmuggler();
  const defs: EconomyDefs = economy.defs;
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const contraband = (): ContrabandState => (ctx.state.contraband ??= freshContrabandState(now()));
  const record = SHIP_RECORDS.find((r) => r.id === def.classId);
  if (!record) throw new Error(`No ship class ${def.classId}`);

  let anchorage: Zone | undefined;
  let entity: Entity | undefined;
  let open = false;

  const hide = (): void => {
    if (entity) ctx.world.remove(entity);
    entity = undefined;
  };
  const showBoat = (): void => {
    if (entity || !anchorage) return;
    const heading = (def.anchorage.headingDeg * Math.PI) / 180;
    entity = createNpcShipEntity(record, anchorage.x, anchorage.z, heading, 0);
    entity.id = SMUGGLER_ENTITY_ID;
    if (entity.transform) entity.previousTransform = cloneTransform(entity.transform);
    ctx.world.add(entity);
  };
  const distance = (p: { x: number; z: number }): number =>
    anchorage ? Math.hypot(p.x - anchorage.x, p.z - anchorage.z) : Infinity;

  const refresh = (): void => {
    if (!open) return;
    const c = contraband();
    restock(c.smuggler, now(), def);
    opts.show(smugglerSnapshot(defs, def, c.smuggler, ctx.state.player, economy.capacity, now()));
  };
  const settle = (r: SmugglerResult): string | undefined => {
    if (!r.ok) return REFUSALS[r.reason];
    economy.syncLoad();
    ctx.events.emit('SmugglerDealt', r.event);
    refresh();
    const name = defs.goods.get(r.event.good)?.name.toLowerCase() ?? 'goods';
    return r.event.side === 'buy'
      ? `${r.event.qty} CU of ${name} handed down for ${formatCents(r.event.totalCents)}.`
      : `${r.event.qty} CU of ${name} swung across; she counts out ${formatCents(r.event.totalCents)}.`;
  };
  const close = (): void => {
    if (!open) return;
    open = false;
    opts.show(undefined);
    opts.onOpen(false);
  };

  const control: SmugglerControl = {
    def,
    get present() {
      return !!entity;
    },
    get open() {
      return open;
    },
    get anchorage() {
      return anchorage;
    },
    setZone(zone) {
      hide();
      anchorage =
        zone && zone.id === def.anchorage.zone
          ? chartToZone(projection.geoToChart(def.anchorage.at), zone.frame)
          : undefined;
    },
    step(player) {
      if (!anchorage) return;
      const t = now();
      if (smugglerAbout(t, def)) {
        showBoat();
      } else if (entity && !open) {
        const sunUp = sunAt(t).elevationRad > 0;
        if (sunUp || distance(player) > SLIP_AWAY_M) hide();
      }
    },
    isSmuggler: (id) => id === SMUGGLER_ENTITY_ID,
    comeAlongside(player, speedKn) {
      if (!entity) return 'She has gone.';
      if (distance(player) > ALONGSIDE_M || speedKn > ALONGSIDE_KN) {
        return `Come alongside the ${def.boatName} slowly`;
      }
      if (!smugglerAbout(now(), def)) return 'She is weighing anchor. Come back after dark.';
      if (!open) {
        open = true;
        opts.onOpen(true);
      }
      refresh();
      return undefined;
    },
    chip(player, speedKn) {
      if (!entity) return undefined;
      const d = distance(player);
      if (d > 400) return undefined;
      return d <= ALONGSIDE_M && speedKn <= ALONGSIDE_KN
        ? `F trade with the ${def.boatName}`
        : `The ${def.boatName}: come alongside slowly`;
    },
    close,
    known: () =>
      knowsAnchorage(
        ctx.state.contraband,
        ctx.state.player.captain.background,
        opts.heardOf?.() ?? false,
        def,
      ),
    learn(source) {
      const c = contraband();
      if (c.known) return;
      c.known = true;
      ctx.events.emit('SmugglerLearned', { anchorage: def.anchorage.id, source });
    },
    actions: {
      buy: (good, qty) =>
        settle(
          buyFromSmuggler(
            defs,
            contraband().smuggler,
            ctx.state.player,
            economy.capacity,
            good,
            qty,
            now(),
            def,
          ),
        ),
      fence: (index, qty) =>
        settle(
          fenceToSmuggler(defs, contraband().smuggler, ctx.state.player, index, qty, now(), def),
        ),
      close,
    },
    dispose() {
      close();
      hide();
    },
  };
  return control;
}
