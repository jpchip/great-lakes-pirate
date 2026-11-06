import type { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { DEV_ENCOUNTERS } from '../sim/arena/encounter';
import { HARBORS } from '../sim/harbors';
import { LIGHTHOUSES } from '../sim/lighthouses';
import { PLAYER_SHIP_IDS } from '../sim/sailing/ships';
import { ZONE_DEFS } from '../sim/terrain/zones';
import type { SaveControls } from './overlay';

/**
 * The jump list of the dev overlay: every place the URL start switches accept (zones and
 * their entry points, harbor piers, lights, arena encounters) plus the NPC parade and the
 * player's ship class, each one a button. A button saves the run and reloads on the matching
 * URL, or, with "Copy link instead" on, copies that URL. The folder is also the reference
 * for what `?zone=`, `?entry=`, `?harbor=`, `?light=`, `?encounter=`, `?npcs` and `?ship=`
 * take (see `START_SWITCHES` in main.ts).
 */

/**
 * The switches that say where the game starts. A jump replaces all of them, so one jump
 * never stacks on the last one; everything else on the URL (`debug`, `timewarp`, `quality`,
 * the weather and the clock) carries over.
 */
export const PLACE_SWITCHES = [
  'play',
  'newrun',
  'zone',
  'entry',
  'harbor',
  'spawn',
  'light',
  'fogbank',
  'fogkind',
  'encounter',
  'at',
  'heading',
  'cutter',
  'npcs',
] as const;

/**
 * The query string (with its `?`) for a jump: the current switches without the place
 * ones, plus `set`. A `ship` jump keeps the place switches, since it only swaps the ship.
 */
export function jumpUrl(current: URLSearchParams, set: Readonly<Record<string, string>>): string {
  const next = new URLSearchParams();
  const keepPlace = Object.keys(set).length === 1 && 'ship' in set;
  for (const [key, value] of current) {
    if (key in set) continue;
    if (!keepPlace && (PLACE_SWITCHES as readonly string[]).includes(key)) continue;
    next.append(key, value);
  }
  for (const [key, value] of Object.entries(set)) next.set(key, value);
  const text = next.toString().replace(/%2C/gi, ',');
  return text ? `?${text}` : '?';
}

/** `?zone=` and, for an entry point, `?entry=` by its short name (`west`). */
export function zoneJump(zoneId: string, entryId?: string): Record<string, string> {
  return entryId
    ? { zone: zoneId, entry: entryId.slice(entryId.lastIndexOf('_') + 1) }
    : { zone: zoneId };
}

/** `?harbor=<id>,<pier>`: the ship starts off that pier by its order in data/harbors.json. */
export function harborJump(harborId: string, pier: number): Record<string, string> {
  return { harbor: `${harborId},${pier}` };
}

/**
 * `?light=<id>[,<meters>]`. The light is looked up only in the zone the game starts in,
 * so the link names that zone too.
 */
export function lightJump(
  light: { id: string; zone: string },
  distanceM: number,
): Record<string, string> {
  const distance = Number.isFinite(distanceM) && distanceM > 0 ? Math.round(distanceM) : 500;
  return {
    zone: light.zone,
    light: distance === 500 ? light.id : `${light.id},${distance}`,
  };
}

export interface JumpPanelOptions {
  gui: GUI;
  save: Pick<SaveControls, 'saveNow'>;
}

export function createJumpPanel(options: JumpPanelOptions): void {
  const { save } = options;
  const root = options.gui.addFolder('Jump to').close();
  const mode = { copy: false, light: 500, last: '' };

  root.add(mode, 'copy').name('Copy link instead');
  root.add(mode, 'last').name('Last link').disable().listen();

  const go = (set: Record<string, string>): void => {
    const query = jumpUrl(new URLSearchParams(window.location.search), set);
    const url = `${window.location.origin}${window.location.pathname}${query}`;
    mode.last = query;
    if (mode.copy) {
      console.info(`Jump link: ${url}`);
      void navigator.clipboard?.writeText(url);
      return;
    }
    void save
      .saveNow()
      .catch((err: unknown) => console.warn('Save before jump failed', err))
      .finally(() => window.location.assign(`${window.location.pathname}${query}`));
  };
  /** `set` may be a function, for a link that reads a control when the button is pressed. */
  const button = (
    folder: GUI,
    label: string,
    set: Record<string, string> | (() => Record<string, string>),
  ): void => {
    folder.add({ go: () => go(typeof set === 'function' ? set() : set) }, 'go').name(label);
  };

  const zones = root.addFolder('Zones').close();
  for (const def of ZONE_DEFS) {
    const folder = zones.addFolder(def.name).close();
    button(folder, `${def.name} (spawn)`, zoneJump(def.id));
    for (const entry of def.entries) {
      const short = entry.id.slice(entry.id.lastIndexOf('_') + 1);
      button(folder, `Entry: ${short}`, zoneJump(def.id, entry.id));
    }
  }

  const harbors = root.addFolder('Harbors').close();
  for (const harbor of HARBORS) {
    const folder = harbors.addFolder(harbor.name).close();
    harbor.piers.forEach((pier, i) => {
      button(folder, `${pier.name} (pier ${i})`, harborJump(harbor.id, i));
    });
  }

  const lights = root.addFolder('Lights').close();
  lights.add(mode, 'light', 100, 6000, 50).name('Distance (m)');
  for (const light of LIGHTHOUSES) {
    button(lights, light.name, () => lightJump(light, mode.light));
  }

  const encounters = root.addFolder('Encounters').close();
  for (const id of DEV_ENCOUNTERS) button(encounters, id, { encounter: id });

  const other = root.addFolder('Ships and traffic').close();
  button(other, 'NPC parade ahead', { npcs: '' });
  button(other, 'NPC parade lying to', { npcs: 'stop' });
  button(other, 'NPC parade meeting you', { npcs: 'meet' });
  for (const key of Object.keys(PLAYER_SHIP_IDS)) {
    button(other, `Your ship: ${key}`, { ship: key });
  }
}
