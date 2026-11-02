import { z } from 'zod';
import type { Action, Bindings, InputContext } from './input';
import type { GlpDatabase } from './save/db';

/**
 * Player settings (plan 13 §11, plan 16 §2): graphics, camera, sailing, HUD and key
 * bindings. They live outside the run save, in the `settings` store under `v1`, so they
 * survive permadeath. localStorage is the fallback where IndexedDB is unavailable.
 *
 * Every field parses on its own with a default, so one bad or missing value (an older
 * build, a hand-edited store) never throws away the rest.
 */

export const SETTINGS_KEY = 'v1';
/** The localStorage fallback key, and the Phase 0 quality key it replaces. */
export const SETTINGS_FALLBACK_KEY = 'glp.settings.v1';
export const LEGACY_QUALITY_KEY = 'glp.quality';

/** Fixed render scales offered besides Auto (dynamic resolution). */
export const RESOLUTION_SCALES = [1, 0.85, 0.75, 0.6, 0.5] as const;

export const HUD_DENSITIES = ['minimal', 'full', 'off'] as const;
export type HudDensity = (typeof HUD_DENSITIES)[number];

/** Key overrides per context: an action listed here replaces its default codes. */
const bindingOverridesSchema = z
  .record(z.string(), z.record(z.string(), z.array(z.string()).max(4)))
  .catch({});

const graphicsSchema = z.object({
  quality: z.enum(['low', 'medium', 'high']).catch('medium'),
  /** 'auto' runs dynamic resolution inside the preset's range; a number pins the scale. */
  resolution: z.union([z.literal('auto'), z.number().min(0.25).max(1)]).catch('auto' as const),
});

const cameraSchema = z.object({
  /** Ease back behind the ship after a few seconds without input (plan 02 §8). */
  autoRecenter: z.boolean().catch(true),
  /** Off by default to reduce motion sickness (plan 02 §8, plan 13 §9). */
  rollWithShip: z.boolean().catch(false),
  /** Spyglass on hold (default) or toggle (plan 13 §9). */
  spyglassToggle: z.boolean().catch(false),
  /** Orbit speed multiplier. */
  sensitivity: z.number().min(0.25).max(3).catch(1),
});

const sailingSchema = z.object({
  /** Manual sheet trim with Q/E; auto-trim is the default (plan 02 §3.4). */
  manualTrim: z.boolean().catch(false),
});

export const LOOKOUT_PREFS = ['all', 'threatsAndPrizes', 'threats'] as const;

const chartSchema = z.object({
  /** What the lookouts interrupt a voyage for (plan 03 §6.2, plan 13 §4.3). */
  lookout: z.enum(LOOKOUT_PREFS).catch('threatsAndPrizes'),
});

const uiSchema = z.object({
  hudDensity: z.enum(HUD_DENSITIES).catch('minimal'),
  /** Captions for directional sounds: fog signals and whistles (plan 13 §9, plan 15 §5). */
  captions: z.boolean().catch(true),
});

export const settingsSchema = z.object({
  graphics: graphicsSchema.catch(() => graphicsSchema.parse({})),
  camera: cameraSchema.catch(() => cameraSchema.parse({})),
  sailing: sailingSchema.catch(() => sailingSchema.parse({})),
  chart: chartSchema.catch(() => chartSchema.parse({})),
  ui: uiSchema.catch(() => uiSchema.parse({})),
  bindings: bindingOverridesSchema,
});

export type Settings = z.infer<typeof settingsSchema>;
export type BindingOverrides = Partial<Record<InputContext, Partial<Record<Action, string[]>>>>;

export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/** Parse anything into settings, keeping every valid field and defaulting the rest. */
export function parseSettings(value: unknown): Settings {
  const parsed = settingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : defaultSettings();
}

/** The defaults with the player's overrides laid over them. */
export function applyBindingOverrides(defaults: Bindings, overrides: BindingOverrides): Bindings {
  const out = {} as Record<InputContext, Partial<Record<Action, readonly string[]>>>;
  for (const context of Object.keys(defaults) as InputContext[]) {
    out[context] = { ...defaults[context], ...overrides[context] };
  }
  return out;
}

/** Where settings are read from and written to. */
export interface SettingsBackend {
  read(): Promise<unknown>;
  write(value: Settings): Promise<void>;
}

/** The fallback backend, or a memory one in tests. */
export function storageBackend(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
): SettingsBackend {
  return {
    read() {
      try {
        const raw = storage?.getItem(SETTINGS_FALLBACK_KEY);
        if (raw) return Promise.resolve(JSON.parse(raw) as unknown);
        // Carry the Phase 0 quality pick over (render/quality.ts kept it here).
        const quality = storage?.getItem(LEGACY_QUALITY_KEY);
        return Promise.resolve(quality ? { graphics: { quality } } : undefined);
      } catch {
        return Promise.resolve(undefined);
      }
    },
    write(value) {
      try {
        storage?.setItem(SETTINGS_FALLBACK_KEY, JSON.stringify(value));
      } catch {
        // Private windows can refuse storage; the settings just won't stick.
      }
      return Promise.resolve();
    },
  };
}

type Listener = (settings: Settings, previous: Settings) => void;

/**
 * The live settings: read once at boot, changed through `update`, which notifies
 * listeners at once and writes to the backend in the background.
 */
export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<Listener>();
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly backend: SettingsBackend,
    initial: Settings,
  ) {
    this.current = initial;
  }

  static async load(backend: SettingsBackend): Promise<SettingsStore> {
    let raw: unknown;
    try {
      raw = await backend.read();
    } catch (err) {
      console.warn('Settings unreadable; using defaults', err);
    }
    return new SettingsStore(backend, parseSettings(raw));
  }

  get value(): Settings {
    return this.current;
  }

  /** Apply a change to a copy of the settings, then notify and persist. */
  update(change: (draft: Settings) => void): void {
    const previous = this.current;
    const next = structuredClone(previous);
    change(next);
    this.current = parseSettings(next);
    for (const listener of this.listeners) listener(this.current, previous);
    const snapshot = this.current;
    this.writing = this.writing
      .then(() => this.backend.write(snapshot))
      .catch((err: unknown) => console.warn('Settings not saved', err));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves once every queued write has finished (tests, page hide). */
  flush(): Promise<void> {
    return this.writing;
  }
}

/** The `settings` store in the `glp` database (plan 16 §2). */
export function databaseBackend(db: GlpDatabase): SettingsBackend {
  return {
    read: () => db.get('settings', SETTINGS_KEY),
    write: async (value) => {
      await db.put('settings', value, SETTINGS_KEY);
    },
  };
}

/** Read `primary`, falling back to `legacy` until the first write lands in `primary`. */
export function withFallback(primary: SettingsBackend, legacy: SettingsBackend): SettingsBackend {
  return {
    async read() {
      return (await primary.read()) ?? (await legacy.read());
    },
    write: (value) => primary.write(value),
  };
}
