import type { DistrictBuildingDef, DistrictMark, ShopTab } from '../../../data/schemas/districts';
import type { ToolsFile } from '../../../data/schemas/tools';
import type { PortTab } from '../../ui/port/model';
import { withinHours } from './conduct';

/**
 * The counters you trade at on foot (plan 08 §2.3, §20.6 decision 3; Phase 7 piece F): a
 * district's `shop` marks. By day a shop's counter opens the tab its door names, under the
 * shop's own name; the saloon's bar is its saloon tab, where the keeper also sells a bottle;
 * and the table in the saloon's back room is the fence and the shady shipwright, after dark
 * only, on the same data the port screen's tab used. Pure: `ashore.ts` asks for the prompt,
 * the port control opens the screen.
 */

/** What a mark's `opens` shows on the port screen. */
export const SHOP_TABS: Record<ShopTab, PortTab> = {
  market: 'market',
  chandlery: 'chandlery',
  ledger: 'ledger',
  contracts: 'freight',
  backRoom: 'backRoom',
  saloon: 'saloon',
};

/** From where you stand to the keeper, across the counter. */
const BEHIND_COUNTER_M = 2.7;
/** The fence sits at the far side of his table from the mark at its middle. */
const FENCE_SEAT_M = 1.3;

export interface ShopNow {
  /** The hour of the day, 0–24. */
  hour: number;
  /** The port's back room is open to you now (dark, and Fame enough). */
  backRoomOpen: boolean;
  /** The fence's name, for the prompt. */
  fenceName?: string | undefined;
}

export interface ShopPrompt {
  text: string;
  tab: PortTab;
  /** The name over the door, heading the screen. */
  title: string;
}

/** The building a mark stands in. */
function buildingOf(
  buildings: readonly DistrictBuildingDef[],
  mark: DistrictMark,
): DistrictBuildingDef | undefined {
  return buildings.find((b) => b.id === mark.ref);
}

/**
 * What F does at a shop mark now, or undefined when the shop is shut (outside the hours of
 * the tab its door opens, `tools.json`) or, in the back room, when nobody's there to deal.
 */
export function shopPrompt(
  buildings: readonly DistrictBuildingDef[],
  mark: DistrictMark,
  rules: ToolsFile,
  now: ShopNow,
): ShopPrompt | undefined {
  if (mark.kind !== 'shop' || !mark.opens) return undefined;
  const building = buildingOf(buildings, mark);
  const title = building?.name ?? 'The shop';
  const tab = SHOP_TABS[mark.opens];
  // The building keeps the hours of the tab its door opens; a mark in none keeps its own.
  const hours = rules.conduct.hours[building?.opens ?? mark.opens];
  if (hours && !withinHours(now.hour, hours)) return undefined;
  switch (mark.opens) {
    case 'backRoom':
      if (!now.backRoomOpen) return undefined;
      return {
        text: now.fenceName ? `Deal with ${now.fenceName}` : 'Deal in the back room',
        tab,
        title: `${title}: the back room`,
      };
    case 'saloon':
      return { text: 'Stand at the bar', tab, title };
    case 'market':
      return { text: `Trade at ${title}`, tab, title };
    case 'chandlery':
      return { text: `Buy at ${title}`, tab, title };
    case 'contracts':
      return { text: 'See the freight agent', tab, title };
    case 'ledger':
      return { text: 'Read the ledger', tab, title };
  }
}

/** Who stands at a counter, for the figure drawn there. */
export function keeperType(mark: DistrictMark): string {
  return mark.opens === 'backRoom' ? 'npc.fence' : 'npc.shopkeeper';
}

/**
 * Where the man you deal with stands, local meters: across the counter from the mark, the
 * way its heading points, facing back at you. The fence sits close, at his own table.
 */
export function keeperSpot(mark: DistrictMark): { x: number; z: number; heading: number } {
  const a = (mark.headingDeg * Math.PI) / 180;
  const d = mark.opens === 'backRoom' ? FENCE_SEAT_M : BEHIND_COUNTER_M;
  return { x: mark.x + Math.sin(a) * d, z: mark.z - Math.cos(a) * d, heading: a + Math.PI };
}
