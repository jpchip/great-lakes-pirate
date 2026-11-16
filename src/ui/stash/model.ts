import type { EconomyDefs } from '../../sim/economy/defs';
import type { ShipStores } from '../../sim/economy/chandlery';
import { holdUsed, type CargoStack, type Hold } from '../../sim/economy/hold';
import {
  builtStations,
  CRAFT_REFUSALS,
  craftRefusal,
  craftSeconds,
  hasWater,
  isRecrated,
  maxBatches,
  recipesAt,
  STATIONS,
  thingName,
} from '../../sim/hideouts/crafting';
import { materialsOnHand } from '../../sim/hideouts/work';
import {
  hasStrongbox,
  siteDef,
  storageCapacity,
  type HideoutState,
} from '../../sim/hideouts/stash';
import { weekLabel } from '../hud/model';

/**
 * What the stash screen shows (plan 13 §5 "Storage transfer", plan 09 §3; Phase 4 piece
 * E): the hold and the hideout's storage side by side, each stack with its flags, and the
 * purse beside the strongbox.
 */

export interface StashRow {
  /** The stack's place in its list: what a move names. */
  index: number;
  good: string;
  name: string;
  qty: number;
  hot: boolean;
  contract: boolean;
  /** A hot lot in the shed: how many CU the cooperage could re-crate now (0: none). */
  recrate: number;
  /** A hot lot already in plain crates, its marks gone. */
  recrated: boolean;
}

/** One input of a recipe: what it takes per batch and what's on hand. */
export interface InputRow {
  name: string;
  need: number;
  have: number;
  /** CU (a good) or a count (a thing). */
  unit: 'CU' | '';
}

export interface RecipeRow {
  id: string;
  name: string;
  blurb: string;
  /** "1 h", "40 m", "a week". */
  timeText: string;
  inputs: InputRow[];
  water: boolean;
  /** What a batch makes, in words: "4 Patch kit", "1 CU Powder & shot". */
  outputText: string;
  /** Batches that could be made now. */
  max: number;
  /** Why one batch can't be made, or undefined. */
  refusal: string | undefined;
  recrate: boolean;
}

export interface StationRow {
  id: string;
  name: string;
  blurb: string;
  passive: boolean;
  recipes: RecipeRow[];
  /** A still's batches: what and when it runs off. */
  queue: { name: string; readyText: string }[];
  queueMax: number;
}

export interface ThingRow {
  id: string;
  name: string;
  qty: number;
  /** Ship's stores, which go aboard into the lockers. */
  store: boolean;
  aboard: number;
}

/** The workshop: the stations built here, their recipes, and what's been made (piece E). */
export interface WorkshopSnapshot {
  stations: StationRow[];
  things: ThingRow[];
  /** Ship's stores aboard that could be left here. */
  lockers: ThingRow[];
  water: boolean;
}

export interface StashSnapshot {
  hideout: string;
  siteName: string;
  blurb: string;
  dateText: string;
  purseCents: number;
  cashCents: number;
  strongbox: boolean;
  hold: StashRow[];
  holdUsed: number;
  holdCapacity: number;
  stash: StashRow[];
  stashUsed: number;
  stashCapacity: number;
  /** Why lying at anchor is refused here, or undefined when it's allowed. */
  lieRefusal: string | undefined;
  workshop: WorkshopSnapshot;
}

function rows(
  defs: EconomyDefs,
  stacks: readonly CargoStack[],
  recrate: (index: number) => number = () => 0,
): StashRow[] {
  return stacks.map((s, index) => ({
    index,
    good: s.good,
    name: defs.goods.get(s.good)?.name ?? s.good,
    qty: s.qty,
    hot: !!s.hot,
    contract: !!s.contract,
    recrate: s.hot && !s.contract ? recrate(index) : 0,
    recrated: isRecrated(s),
  }));
}

/** "1 h", "1 h 30 m", "40 m", "a week", "3 weeks" (a game day is a week). */
export function spanText(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m >= 24 * 60) {
    const w = Math.round(m / (24 * 60));
    return w === 1 ? 'a week' : `${w} weeks`;
  }
  if (m >= 60) return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} m` : ''}`;
  return `${m} m`;
}

function workshop(opts: {
  defs: EconomyDefs;
  hideout: HideoutState;
  sources: readonly Hold[];
  stores: ShipStores;
  crewTier: number;
  gameSeconds: number;
}): WorkshopSnapshot {
  const { defs, hideout: h } = opts;
  const built = builtStations(h);
  const onHand = materialsOnHand(opts.sources);
  const things = h.storage.things ?? {};
  const goodName = (g: string): string => defs.goods.get(g)?.name ?? g;
  const stations: StationRow[] = STATIONS.filter((st) => built.has(st.id)).map((st) => ({
    id: st.id,
    name: st.name,
    blurb: st.blurb,
    passive: !!st.passive,
    queueMax: st.passive?.queueMax ?? 0,
    queue: (h.stations?.[st.id]?.queue ?? []).map((b) => ({
      name: recipesAt(st.id).find((r) => r.id === b.recipe)?.name ?? b.recipe,
      readyText:
        b.readyAt <= opts.gameSeconds
          ? 'ready: no room in the shed'
          : `ready in ${spanText(b.readyAt - opts.gameSeconds)}`,
    })),
    recipes: recipesAt(st.id).map((r) => {
      const inputs: InputRow[] = [
        ...Object.entries(r.inputs.goods ?? {}).map(([g, n]) => ({
          name: goodName(g),
          need: n,
          have: onHand[g] ?? 0,
          unit: 'CU' as const,
        })),
        ...Object.entries(r.inputs.things ?? {}).map(([t, n]) => ({
          name: thingName(t),
          need: n,
          have: things[t] ?? 0,
          unit: '' as const,
        })),
      ];
      const out = [
        ...Object.entries(r.output.goods ?? {}).map(([g, n]) => `${n} CU ${goodName(g)}`),
        ...Object.entries(r.output.things ?? {}).map(([t, n]) => `${n} × ${thingName(t)}`),
      ];
      // Re-crating is done from a hot lot in the shed; the row says how.
      const why = r.recrate ? undefined : craftRefusal(h, r.id, 1, opts.sources);
      return {
        id: r.id,
        name: r.name,
        blurb: r.blurb,
        timeText: st.passive
          ? spanText(r.hours * 3600)
          : spanText(craftSeconds(r, 1, opts.crewTier)),
        inputs,
        water: !!r.inputs.water,
        outputText: r.recrate ? 'The same goods, unmarked' : out.join(', '),
        max: r.recrate ? 0 : maxBatches(h, r.id, opts.sources),
        refusal: why && CRAFT_REFUSALS[why],
        recrate: !!r.recrate,
      };
    }),
  }));
  const isStore = (id: string): boolean => id.startsWith('store.');
  const thingRows: ThingRow[] = Object.entries(things)
    .filter(([, n]) => n > 0)
    .map(([id, qty]) => ({
      id,
      name: thingName(id),
      qty,
      store: isStore(id),
      aboard: opts.stores[id] ?? 0,
    }));
  const lockers: ThingRow[] = Object.entries(opts.stores)
    .filter(([id, n]) => n > 0 && isStore(id))
    .map(([id, qty]) => ({ id, name: thingName(id), qty, store: true, aboard: qty }));
  return { stations, things: thingRows, lockers, water: hasWater(h) };
}

export function stashSnapshot(opts: {
  defs: EconomyDefs;
  hideoutId: string;
  hideout: HideoutState;
  player: { purse: number; cargo: readonly CargoStack[] };
  holdCapacity: number;
  gameSeconds: number;
  lieRefusal: string | undefined;
  /** Where materials come from: the storage, then the hold when she's moored here. */
  sources?: readonly Hold[];
  stores?: ShipStores;
  crewTier?: number;
}): StashSnapshot {
  const { defs, hideout: h, player } = opts;
  const sources = opts.sources ?? [h.storage.goods];
  const crafting = builtStations(h).has('station.cooperage');
  const site = siteDef(h.siteId);
  return {
    hideout: opts.hideoutId,
    siteName: 'Stockton Stash',
    blurb: site?.blurb ?? '',
    dateText: weekLabel(opts.gameSeconds),
    purseCents: player.purse,
    cashCents: h.storage.cash,
    strongbox: hasStrongbox(h),
    hold: rows(defs, player.cargo),
    holdUsed: holdUsed(player.cargo),
    holdCapacity: opts.holdCapacity,
    stash: rows(defs, h.storage.goods, (index) =>
      crafting ? maxBatches(h, 'recipe.recrate', sources, { stackIndex: index }) : 0,
    ),
    stashUsed: holdUsed(h.storage.goods),
    stashCapacity: storageCapacity(h),
    lieRefusal: opts.lieRefusal,
    workshop: workshop({
      defs,
      hideout: h,
      sources,
      stores: opts.stores ?? {},
      crewTier: opts.crewTier ?? 1,
      gameSeconds: opts.gameSeconds,
    }),
  };
}
