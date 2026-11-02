import { SECONDS_PER_GAME_DAY } from '../../core/time';
import { gameEconomy, portInfo } from '../economy/defs';
import { HARBORS, harborZoneId, pierPort } from '../harbors';
import { sunAt } from '../weather/celestial';
import { createWorldState, type WorldState } from '../world-state';
import { allPortraits, backgroundDef, type BackgroundKey } from './backgrounds';
import { createFirstWeek, type FirstWeekContext } from './first-week';
import { recordFishPrices } from './perks';

/**
 * A new run from character creation (plan 12 §2–3, Phase 4 piece C): the captain, the
 * schooner's name, the background's money and cargo, May 7, 1900 at dawn, docked at the
 * background's starting port, with the First Week checklist in the journal.
 */

export interface NewRunSetup {
  name: string;
  shipName: string;
  background: BackgroundKey;
  portrait: string;
  /** The run seed (plan 12 §2.1 step 5): random by default, editable to share a world. */
  seed: string;
}

export const NAME_MAX = 32;

export type SetupProblem = 'name' | 'shipName' | 'seed' | 'portrait';

/** Trims the names; the problems to show beside the fields, empty when it can start. */
export function checkSetup(setup: NewRunSetup): { setup: NewRunSetup; problems: SetupProblem[] } {
  const clean: NewRunSetup = {
    ...setup,
    name: setup.name.trim().replace(/\s+/g, ' '),
    shipName: setup.shipName.trim().replace(/\s+/g, ' '),
    seed: setup.seed.trim(),
  };
  const problems: SetupProblem[] = [];
  if (!clean.name || clean.name.length > NAME_MAX) problems.push('name');
  if (!clean.shipName || clean.shipName.length > NAME_MAX) problems.push('shipName');
  if (!clean.seed || clean.seed.length > 64) problems.push('seed');
  if (!allPortraits().some((p) => p.id === clean.portrait)) problems.push('portrait');
  return { setup: clean, problems };
}

/**
 * Sunrise on the first game day (May 7, 1900 at 46.8° N): the first minute the sun's
 * center clears the horizon, about 4:40 local solar time.
 */
export function dawnSeconds(day = 0): number {
  const start = day * SECONDS_PER_GAME_DAY;
  for (let m = 3 * 60; m < 9 * 60; m++) {
    const t = start + m * 60;
    if (sunAt(t).elevationRad >= 0) return t;
  }
  return start + 5 * 3600;
}

/** The background's starting port, its zone and the pier the run opens docked at. */
export interface StartingPort {
  port: string;
  portName: string;
  zoneId: string;
  pier: string;
}

export function startingPort(key: BackgroundKey): StartingPort {
  const def = backgroundDef(key);
  const harbor = HARBORS.find((h) => h.piers.some((p) => p.id === def.startPier));
  const port = pierPort(def.startPier);
  if (!harbor || !port) throw new Error(`${def.id}: start pier ${def.startPier} has no port`);
  return {
    port,
    portName: portInfo(port)?.name ?? port,
    zoneId: harborZoneId(harbor),
    pier: def.startPier,
  };
}

/** What the First Week checklist names for this background. */
export function firstWeekContext(key: BackgroundKey): FirstWeekContext {
  const def = backgroundDef(key);
  const cargoGood = def.cargo[0]?.good ?? 'good.rope_canvas';
  return {
    portName: startingPort(key).portName,
    cargoGood,
    cargoName: gameEconomy().goods.get(cargoGood)?.name ?? 'cargo',
    hideoutName: def.hideout === 'hideout.stockton' ? 'Stockton Island' : 'your hideout',
  };
}

/**
 * The new run's world: everything `createWorldState` makes, then the captain, the
 * background's purse and hold, the clock at dawn on May 7 and the ship in the starting
 * port's zone. Where she lies at the pier is the game's to place (it needs the zone's
 * terrain for the berths), so the location has no pose.
 */
export function createNewRun(input: NewRunSetup): WorldState {
  const { setup, problems } = checkSetup(input);
  if (problems.length) throw new Error(`Bad new run: ${problems.join(', ')}`);
  const def = backgroundDef(setup.background);
  const state = createWorldState(setup.seed, dawnSeconds());
  state.player.captain = {
    name: setup.name,
    shipName: setup.shipName,
    background: setup.background,
    portrait: setup.portrait,
  };
  state.player.purse = def.purseCents;
  state.player.cargo = def.cargo.map((c) => ({ good: c.good, qty: c.qty }));
  state.player.location = { mode: 'zone', zoneId: startingPort(setup.background).zoneId };
  state.firstWeek = createFirstWeek();
  recordFishPrices(state, gameEconomy());
  return state;
}
