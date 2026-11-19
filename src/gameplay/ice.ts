import type { Chart } from '../core/coords';
import type { Contact } from '../sim/chart/traffic';
import type { EconomyDefs } from '../sim/economy/defs';
import { shockMarket } from '../sim/economy/market';
import { firstArrivalAfter } from '../sim/ice/first-boat';
import {
  closesHull,
  ICE,
  lakeIceFor,
  stopCmFor,
  hullInIce,
  type IcePicture,
  type IceSample,
  type LakeIce,
} from '../sim/ice/ice';
import { calendarMs } from '../sim/ice/season';
import { freshIceState, type IceState } from '../sim/ice/state';
import { mataafa } from '../sim/weather/weather';
import type { GameContext } from '../modes/context';

/**
 * The year turning in the game (plan 04 §8, plan 11 §18.4 piece K): the run's ice where the
 * player is, and what the turning of the year says and does as it happens.
 *
 * - **Freeze-up and ice-out** at each harbor `ice.json` names are seen on the world tick:
 *   the bus hears `HarborFrozen` and `HarborOpened`, and Duluth's and Bayfield's go in the
 *   papers and the saloons (the scripted `event.freeze_up` and `event.ice_out`).
 * - **The first boat in.** After Duluth's ice-out, the first ship to tie up there wins the
 *   race: by the traffic's timetable, or you, if you dock first. Yours goes in the papers
 *   (the `firstBoat` feat) and Duluth's market pays the premium for what it has gone
 *   without all winter.
 * - **The Mataafa storm.** A run that reaches November 1905 meets the storm on its date (the
 *   weather raises it); the papers and the saloons tell of it as it breaks.
 * - **Frozen in.** A port's harbor closed by the ice keeps a ship in or out of it until its
 *   ice-out: `harborClosed` and `openAgainAt` answer the berths and the harbor master.
 */
export interface GameIce {
  readonly ice: LakeIce;
  /** The ice at a point on the chart (the chart geography's frame). */
  at(p: Chart): IceSample;
  /** A port's harbor is frozen in now. */
  harborClosed(port: string): boolean;
  /** When a frozen port opens again (its ice-out), game seconds; undefined when open. */
  openAgainAt(port: string): number | undefined;
  /** Ice at a chart point closes it to the player's ship (the ice bow takes more). */
  closesHere(p: Chart): boolean;
  /** When the ice holding a chart point goes out, if it's closed to her now. */
  openAgainAtPoint(p: Chart): number | undefined;
  /** The player's ship carries the ice-strengthened bow. */
  iceBow(): boolean;
  /** The chart's picture of the ice now, worked out once a calendar day. */
  picture(): IcePicture;
  /** What the ice does to her speed at a chart point (1 in open water). */
  drag(p: Chart): number;
  readonly state: IceState;
  /** Run the world tick's checks now (tests and the dev hook). */
  check(): void;
  dispose(): void;
}

export interface IceOptions {
  ctx: GameContext;
  /** The run's seed (`run-<noiseSeed>`), shared with the traffic and the weather. */
  seed: string;
  /** The traffic, for the first-boat race. */
  contacts(): readonly Contact[];
  economy: EconomyDefs;
  /** Fires a scripted sandbox event at a port (the papers and the saloons). */
  fire?(id: string, port: string): void;
}

/** Freeze-up and ice-out at these ports go in the papers and the saloons. */
const NEWS_PORTS = ['port.duluth', 'port.bayfield'] as const;

export const ICE_BOW_UPGRADE = 'upgrade.ice_bow';

export function attachIce(opts: IceOptions): GameIce {
  const { ctx } = opts;
  const ice = lakeIceFor(opts.seed);
  const now = (): number => ctx.state.environment.clock.gameSeconds;
  const st = (): IceState => (ctx.state.ice ??= freshIceState());
  const iceBow = (): boolean => !!ctx.state.player.ship?.upgrades.includes(ICE_BOW_UPGRADE);
  const race = ICE.firstBoat.port;

  const yearOf = (t: number): string => String(new Date(calendarMs(t)).getUTCFullYear());

  const settleNpcRace = (t: number): void => {
    // The traffic beat you to it: the first ship by the timetable takes it.
    const season = ice.harborSeason(race, t);
    if (season.openAt === undefined || t < season.openAt) return;
    const year = yearOf(season.openAt);
    if (st().firstBoat[year]) return;
    const first = firstArrivalAfter(opts.contacts(), race, season.openAt, t);
    if (!first) return;
    st().firstBoat[year] = { ship: first.ship, you: false, at: first.at };
    ctx.events.emit('FirstBoatIn', { port: race, you: false, ship: first.ship });
  };

  const check = (): void => {
    const t = now();
    const s = st();
    for (const port of Object.keys(ICE.harbors)) {
      const closed = ice.harborClosed(port, t);
      const was = s.frozen.includes(port);
      if (closed === was) continue;
      if (closed) {
        s.frozen.push(port);
        ctx.events.emit('HarborFrozen', { port });
      } else {
        s.frozen = s.frozen.filter((p) => p !== port);
        ctx.events.emit('HarborOpened', { port });
      }
      if ((NEWS_PORTS as readonly string[]).includes(port)) {
        opts.fire?.(closed ? 'event.freeze_up' : 'event.ice_out', port);
      }
    }
    settleNpcRace(t);
    const storm = mataafa();
    if (
      s.mataafaAt === undefined &&
      t >= storm.peakAt - 3 * 3600 &&
      t < storm.peakAt + 2 * 86_400
    ) {
      s.mataafaAt = t;
      opts.fire?.('event.mataafa', 'port.duluth');
    }
  };

  // A run from before the ice (or a new one) takes the harbors as they stand, unannounced.
  if (!ctx.state.ice) {
    const t = now();
    st().frozen = Object.keys(ICE.harbors).filter((p) => ice.harborClosed(p, t));
  }

  const offs = [
    ctx.events.on('WorldTick', check),
    ctx.events.on('PortVisited', ({ port }) => {
      if (port !== race) return;
      const t = now();
      const season = ice.harborSeason(race, t);
      if (season.openAt === undefined || t < season.openAt) return;
      const year = yearOf(season.openAt);
      if (st().firstBoat[year]) return;
      const first = firstArrivalAfter(opts.contacts(), race, season.openAt, t);
      if (first && first.at <= t) {
        settleNpcRace(t);
        return;
      }
      const ship = ctx.state.player.captain.shipName;
      st().firstBoat[year] = { ship, you: true, at: t };
      // A winter's want: everything Duluth takes in is dearer for the first boat's cargo.
      const pm = opts.economy.markets.get(race);
      const factor = (1 / ICE.firstBoat.premium) ** (1 / opts.economy.rules.elasticity);
      for (const [good, mg] of pm?.goods ?? []) {
        if (mg.role !== 'import') continue;
        const shock = shockMarket(
          opts.economy,
          ctx.state.markets,
          race,
          good,
          factor,
          'firstBoat',
          t,
        );
        if (shock) ctx.events.emit('PriceShock', shock);
      }
      ctx.events.emit('FirstBoatIn', { port: race, you: true, ship });
    }),
  ];
  check();

  let pic: IcePicture | undefined;
  return {
    ice,
    picture() {
      const day = Math.floor(calendarMs(now()) / 86_400_000);
      if (!pic || !pic.key.endsWith(`|${day}`)) pic = ice.picture(now());
      return pic;
    },
    drag: (p) => hullInIce(ice.at(p, now()), iceBow()).drag,
    at: (p) => ice.at(p, now()),
    harborClosed: (port) => ice.harborClosed(port, now()),
    openAgainAt: (port) => ice.openAgainAt(port, now()),
    closesHere: (p) => closesHull(ice.at(p, now()), stopCmFor(iceBow())),
    openAgainAtPoint: (p) => ice.openAgainAtPoint(p, now(), stopCmFor(iceBow())),
    iceBow,
    get state() {
      return st();
    },
    check,
    dispose: () => offs.forEach((off) => off()),
  };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "about April 21", for when the ice goes out. */
export function aboutDate(gameSeconds: number | undefined): string {
  if (gameSeconds === undefined) return 'in the spring';
  const d = new Date(calendarMs(gameSeconds));
  return `about ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
