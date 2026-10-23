import { z } from 'zod';

/**
 * Asset manifest and a ref-counted loader (plan 01 §4.9). This half knows nothing about
 * three.js: render/assets.ts supplies the decoders (GLB, textures) and the dispose step.
 * Zones and modes acquire a bundle on entry and release it on exit; anything whose count
 * drops to zero is disposed.
 */

export const assetTypeSchema = z.enum(['gltf', 'texture', 'json', 'audio']);
export type AssetType = z.infer<typeof assetTypeSchema>;

export const assetEntrySchema = z.object({
  type: assetTypeSchema,
  /** Relative to the manifest. */
  url: z.string().min(1),
  /** Download size, for loading-screen progress. */
  bytes: z.number().int().nonnegative().optional(),
});
export type AssetEntry = z.infer<typeof assetEntrySchema>;

export const assetManifestSchema = z.object({
  version: z.literal(1),
  assets: z.record(z.string(), assetEntrySchema),
  /** Named groups, e.g. one per zone or mode. */
  bundles: z.record(z.string(), z.array(z.string())).default({}),
});
export type AssetManifest = z.infer<typeof assetManifestSchema>;

export const EMPTY_MANIFEST: AssetManifest = { version: 1, assets: {}, bundles: {} };

export type AssetDecoder = (url: string, entry: AssetEntry) => Promise<unknown>;

export interface AssetLoaderOptions {
  manifest: AssetManifest;
  /** Where the manifest lives; entry URLs resolve against it. */
  baseUrl: string;
  decoders: Partial<Record<AssetType, AssetDecoder>>;
  dispose?: (value: unknown, entry: AssetEntry) => void;
}

interface Slot {
  refs: number;
  promise: Promise<unknown>;
  value?: unknown;
  loaded: boolean;
}

export class AssetLoader {
  private readonly slots = new Map<string, Slot>();

  constructor(private readonly options: AssetLoaderOptions) {}

  has(id: string): boolean {
    return id in this.options.manifest.assets;
  }

  refCount(id: string): number {
    return this.slots.get(id)?.refs ?? 0;
  }

  /** Load (or share) an asset and take a reference to it. */
  acquire<T>(id: string): Promise<T> {
    const existing = this.slots.get(id);
    if (existing) {
      existing.refs++;
      return existing.promise as Promise<T>;
    }
    const entry = this.entry(id);
    const decode = this.options.decoders[entry.type];
    if (!decode) return Promise.reject(new Error(`No decoder for ${entry.type} (${id})`));

    const url = new URL(entry.url, this.options.baseUrl).href;
    const slot: Slot = { refs: 1, loaded: false, promise: Promise.resolve() };
    slot.promise = decode(url, entry).then(
      (value) => {
        slot.value = value;
        slot.loaded = true;
        // Everyone let go while it was loading.
        if (slot.refs === 0) this.drop(id, slot);
        return value;
      },
      (err: unknown) => {
        this.slots.delete(id);
        throw err;
      },
    );
    this.slots.set(id, slot);
    return slot.promise as Promise<T>;
  }

  /** Give back one reference; the asset is disposed when none are left. */
  release(id: string): void {
    const slot = this.slots.get(id);
    if (!slot || slot.refs === 0) return;
    slot.refs--;
    if (slot.refs === 0 && slot.loaded) this.drop(id, slot);
  }

  /** Acquire every asset in a bundle, reporting progress by bytes (or count). */
  async acquireBundle(
    name: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const ids = this.bundle(name);
    const weight = (id: string): number => this.entry(id).bytes ?? 1;
    const total = ids.reduce((sum, id) => sum + weight(id), 0);
    let loaded = 0;
    onProgress?.(0, total);
    await Promise.all(
      ids.map(async (id) => {
        await this.acquire(id);
        loaded += weight(id);
        onProgress?.(loaded, total);
      }),
    );
  }

  releaseBundle(name: string): void {
    for (const id of this.bundle(name)) this.release(id);
  }

  private entry(id: string): AssetEntry {
    const entry = this.options.manifest.assets[id];
    if (!entry) throw new Error(`Unknown asset: ${id}`);
    return entry;
  }

  private bundle(name: string): string[] {
    const ids = this.options.manifest.bundles[name];
    if (!ids) throw new Error(`Unknown asset bundle: ${name}`);
    return ids;
  }

  private drop(id: string, slot: Slot): void {
    this.slots.delete(id);
    this.options.dispose?.(slot.value, this.entry(id));
  }
}

/** Fetch and validate a manifest. A missing manifest (404) is an empty one. */
export async function fetchManifest(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<AssetManifest> {
  const response = await fetchFn(url);
  if (response.status === 404) return EMPTY_MANIFEST;
  if (!response.ok) throw new Error(`Asset manifest ${url}: HTTP ${response.status}`);
  return assetManifestSchema.parse(await response.json());
}
