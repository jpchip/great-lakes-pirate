import type { LoadedZone } from './load';

/**
 * Zones by id (plan 03 §7, Phase 3 piece A). One zone is resident at a time: about
 * 50 MB decoded for the Apostles, against a 300 MB heap budget (plan 01 §5). Leaving a
 * zone keeps its data cached for `keepMs` in case the player turns straight back, then
 * frees it; entering any other zone frees the cached one first, so two are never held
 * at once. The renderer's meshes for a zone are built and disposed by the scene, not here.
 */

export interface ZoneManagerOptions {
  /** Fetches and decodes a zone's baked files by id. */
  load(id: string): Promise<LoadedZone>;
  /** How long a zone just left stays cached, real milliseconds. */
  keepMs?: number;
  /** Real milliseconds, for the cache's expiry. */
  now?: () => number;
  /** A zone's data was let go: the cache expired or another zone was entered. */
  onFree?: (id: string) => void;
}

export interface ResidentZone {
  readonly id: string;
  readonly zone: LoadedZone;
}

export interface ZoneManagerStats {
  current: string | undefined;
  cached: string | undefined;
  /** Real seconds until the cached zone is freed. */
  cachedForS: number;
  loads: number;
  cacheHits: number;
}

/** A minute: long enough to look at the chart and turn back. */
export const ZONE_KEEP_MS = 60_000;

export class ZoneManager {
  private active: ResidentZone | undefined;
  private cached: (ResidentZone & { until: number }) | undefined;
  private pending: { id: string; promise: Promise<LoadedZone> } | undefined;
  private loads = 0;
  private cacheHits = 0;
  private readonly keepMs: number;
  private readonly now: () => number;

  constructor(private readonly options: ZoneManagerOptions) {
    this.keepMs = options.keepMs ?? ZONE_KEEP_MS;
    this.now = options.now ?? (() => performance.now());
  }

  /** The zone the player is in. */
  get current(): ResidentZone | undefined {
    return this.active;
  }

  /** True when entering `id` now would come from the cache, with no loading. */
  isWarm(id: string): boolean {
    return this.active?.id === id || this.cached?.id === id;
  }

  /**
   * Makes `id` the current zone, from the cache when it's there. The previous zone is
   * left first. Rejects when the zone's files can't be loaded; there's no current zone
   * then.
   */
  async enter(id: string): Promise<LoadedZone> {
    if (this.active?.id === id) return this.active.zone;
    this.leave();
    if (this.cached?.id === id) {
      const { zone } = this.cached;
      this.cached = undefined;
      this.active = { id, zone };
      this.cacheHits++;
      return zone;
    }
    // Free the cached zone before decoding another, so only one is ever resident.
    this.free();
    if (this.pending?.id !== id) {
      this.loads++;
      const promise = this.options.load(id);
      this.pending = { id, promise };
    }
    const pending = this.pending;
    try {
      const zone = await pending.promise;
      // A later enter() for another zone wins, and this one is dropped.
      if (this.pending === pending) {
        this.pending = undefined;
        this.active = { id, zone };
      }
      return zone;
    } catch (err) {
      if (this.pending === pending) this.pending = undefined;
      throw err;
    }
  }

  /** Leaves the current zone; its data stays cached for `keepMs`. */
  leave(): void {
    if (!this.active) return;
    this.free();
    this.cached = { ...this.active, until: this.now() + this.keepMs };
    this.active = undefined;
  }

  /** Frees the cached zone once its time is up. Call now and then, e.g. each second. */
  sweep(): void {
    if (this.cached && this.now() >= this.cached.until) this.free();
  }

  /** Lets go of the cached zone now. */
  free(): void {
    if (!this.cached) return;
    const { id } = this.cached;
    this.cached = undefined;
    this.options.onFree?.(id);
  }

  get stats(): ZoneManagerStats {
    return {
      current: this.active?.id,
      cached: this.cached?.id,
      cachedForS: this.cached ? Math.max(0, (this.cached.until - this.now()) / 1000) : 0,
      loads: this.loads,
      cacheHits: this.cacheHits,
    };
  }
}
