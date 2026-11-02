import { allBackgrounds, backgroundDef, type BackgroundKey } from '../../sim/character/backgrounds';
import { startingPort } from '../../sim/character/new-run';
import { gameEconomy } from '../../sim/economy/defs';
import { formatCents } from '../../sim/economy/knowledge';
import { findZoneDef } from '../../sim/terrain/zones';
import type { WorldState } from '../../sim/world-state';
import { clockLabel, weekLabel } from '../hud/model';

/**
 * What the main menu and character creation show (plan 13 §5, Phase 4 piece C), from
 * the saved run and `data/backgrounds.json`.
 */

/** The run Continue would resume. */
export interface SavedRunSummary {
  captain: string;
  shipName: string;
  background: string;
  portrait: string | undefined;
  /** "Wk of May 7, 1900, 05:12". */
  when: string;
  /** The zone's name ("Apostle Islands"), or "On the chart". */
  where: string;
  purse: string;
}

export function savedRunSummary(state: WorldState): SavedRunSummary {
  const c = state.player.captain;
  const at = state.player.location;
  const zoneName = at.mode === 'zone' ? findZoneDef(at.zoneId)?.name : undefined;
  const t = state.environment.clock.gameSeconds;
  return {
    captain: c.name,
    shipName: c.shipName,
    background: backgroundDef(c.background).name,
    portrait: c.portrait,
    when: `${weekLabel(t)}, ${clockLabel(t)}`,
    where: at.mode === 'chart' ? 'On the chart' : (zoneName ?? 'Under way'),
    purse: formatCents(state.player.purse, true),
  };
}

/** A background card on the picker (plan 13 §5: perks, hideout and port, harder start). */
export interface BackgroundCard {
  key: BackgroundKey;
  name: string;
  blurb: string;
  purse: string;
  cargo: string;
  port: string;
  hideout: string;
  harderStart: boolean;
  perks: { name: string; text: string; later: string | undefined }[];
}

export function backgroundCards(): BackgroundCard[] {
  const goods = gameEconomy().goods;
  return allBackgrounds().map((b) => ({
    key: b.key,
    name: b.name,
    blurb: b.blurb,
    purse: formatCents(b.purseCents, true),
    cargo: b.cargo
      .map((c) => `${c.qty} CU ${(goods.get(c.good)?.name ?? c.good).toLowerCase()}`)
      .join(', '),
    port: startingPort(b.key).portName,
    hideout: b.hideout === 'hideout.stockton' ? 'Stockton Island' : b.hideout,
    harderStart: b.harderStart,
    perks: b.perks.map((p) => ({
      name: p.name,
      text: p.text,
      later: p.phase > 4 ? `from phase ${p.phase}` : undefined,
    })),
  }));
}

/** A short run seed to show and share: eight letters and digits (plan 12 §2.1 step 5). */
export function randomSeed(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += alphabet[Math.floor(random() * alphabet.length)];
  return s;
}
