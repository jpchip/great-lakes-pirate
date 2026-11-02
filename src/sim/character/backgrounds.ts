import backgroundsJson from '../../../data/backgrounds.json';
import portraitsJson from '../../../data/portraits.json';
import {
  backgroundsFileSchema,
  portraitsFileSchema,
  type BackgroundDef,
  type PerkDef,
  type PortraitDef,
} from '../../../data/schemas/backgrounds';
import type { Captain } from '../world-state';
import { BACKGROUNDS } from '../world-state';

/**
 * The backgrounds and portrait presets of character creation (plan 12 §2, Phase 4 piece
 * C), from `data/backgrounds.json` and `data/portraits.json`. A captain stores the short
 * key (`deckhand`); the data's ids carry the `background.` prefix.
 */

export type BackgroundKey = (typeof BACKGROUNDS)[number];

let backgrounds: ReadonlyMap<BackgroundKey, BackgroundDef> | undefined;
let portraits: readonly PortraitDef[] | undefined;

const keyOf = (id: string): string => id.slice('background.'.length);

function isKey(key: string): key is BackgroundKey {
  return (BACKGROUNDS as readonly string[]).includes(key);
}

/** Every background in the order of plan 12 §2.2. */
export function allBackgrounds(): readonly (BackgroundDef & { key: BackgroundKey })[] {
  if (!backgrounds) {
    const list = backgroundsFileSchema.parse(backgroundsJson);
    const map = new Map<BackgroundKey, BackgroundDef>();
    for (const def of list) {
      const key = keyOf(def.id);
      if (!isKey(key)) throw new Error(`${def.id} is not one of plan 12's backgrounds`);
      map.set(key, def);
    }
    for (const key of BACKGROUNDS) {
      if (!map.has(key)) throw new Error(`data/backgrounds.json lacks background.${key}`);
    }
    backgrounds = map;
  }
  return BACKGROUNDS.map((key) => ({ ...(backgrounds?.get(key) as BackgroundDef), key }));
}

export function backgroundDef(key: BackgroundKey): BackgroundDef {
  const def = allBackgrounds().find((b) => b.key === key);
  if (!def) throw new Error(`Unknown background ${key}`);
  return def;
}

export function allPortraits(): readonly PortraitDef[] {
  portraits ??= portraitsFileSchema.parse(portraitsJson);
  return portraits;
}

/** A portrait by id; the first preset when it's missing or unknown (a migrated captain). */
export function portraitDef(id: string | undefined): PortraitDef {
  const list = allPortraits();
  return list.find((p) => p.id === id) ?? (list[0] as PortraitDef);
}

/** The captain's two perks, wired or not. */
export function perksOf(captain: Pick<Captain, 'background'>): readonly PerkDef[] {
  return backgroundDef(captain.background).perks;
}

/** True when the captain's background has this perk (`perk.quick_hands`). */
export function hasPerk(captain: Pick<Captain, 'background'>, perkId: string): boolean {
  return perksOf(captain).some((p) => p.id === perkId);
}
