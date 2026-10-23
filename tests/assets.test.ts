import { describe, expect, it, vi } from 'vitest';
import { AssetLoader, EMPTY_MANIFEST, fetchManifest, type AssetManifest } from '../src/core/assets';

const manifest: AssetManifest = {
  version: 1,
  assets: {
    hull: { type: 'gltf', url: 'ships/hull.glb', bytes: 300 },
    sail: { type: 'texture', url: 'ships/sail.ktx2', bytes: 100 },
    data: { type: 'json', url: 'data.json' },
  },
  bundles: { ships: ['hull', 'sail'] },
};

function setup() {
  const decoded: string[] = [];
  const disposed: unknown[] = [];
  const loader = new AssetLoader({
    manifest,
    baseUrl: 'https://example.test/assets/manifest.json',
    decoders: {
      gltf: (url) => {
        decoded.push(url);
        return Promise.resolve({ url });
      },
      texture: (url) => {
        decoded.push(url);
        return Promise.resolve({ url });
      },
    },
    dispose: (value) => disposed.push(value),
  });
  return { loader, decoded, disposed };
}

describe('AssetLoader', () => {
  it('resolves URLs against the manifest and loads each asset once', async () => {
    const { loader, decoded } = setup();
    const [a, b] = await Promise.all([loader.acquire('hull'), loader.acquire('hull')]);
    expect(a).toBe(b);
    expect(decoded).toEqual(['https://example.test/assets/ships/hull.glb']);
    expect(loader.refCount('hull')).toBe(2);
  });

  it('disposes when the last reference is released, and reloads after', async () => {
    const { loader, decoded, disposed } = setup();
    await loader.acquire('hull');
    await loader.acquire('hull');
    loader.release('hull');
    expect(disposed).toHaveLength(0);
    loader.release('hull');
    expect(disposed).toHaveLength(1);
    loader.release('hull'); // extra releases are harmless
    await loader.acquire('hull');
    expect(decoded).toHaveLength(2);
  });

  it('disposes an asset released while it was still loading', async () => {
    const { loader, disposed } = setup();
    const pending = loader.acquire('hull');
    loader.release('hull');
    await pending;
    expect(disposed).toHaveLength(1);
    expect(loader.refCount('hull')).toBe(0);
  });

  it('reports bundle progress by bytes', async () => {
    const { loader } = setup();
    const progress = vi.fn();
    await loader.acquireBundle('ships', progress);
    expect(progress).toHaveBeenNthCalledWith(1, 0, 400);
    expect(progress).toHaveBeenLastCalledWith(400, 400);
    loader.releaseBundle('ships');
    expect(loader.refCount('sail')).toBe(0);
  });

  it('rejects unknown assets, bundles and types', async () => {
    const { loader } = setup();
    expect(loader.has('hull')).toBe(true);
    expect(loader.has('nope')).toBe(false);
    expect(() => loader.acquire('nope')).toThrow(/Unknown asset/);
    await expect(loader.acquireBundle('nope')).rejects.toThrow(/Unknown asset bundle/);
    await expect(loader.acquire('data')).rejects.toThrow(/No decoder/);
  });

  it('forgets a failed load so it can be retried', async () => {
    let fail = true;
    const loader = new AssetLoader({
      manifest,
      baseUrl: 'https://example.test/',
      decoders: {
        gltf: () => (fail ? Promise.reject(new Error('net')) : Promise.resolve('ok')),
      },
    });
    await expect(loader.acquire('hull')).rejects.toThrow('net');
    fail = false;
    await expect(loader.acquire('hull')).resolves.toBe('ok');
  });
});

describe('fetchManifest', () => {
  const respond = (status: number, body?: unknown) =>
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body ?? {}), { status })));

  it('validates the manifest', async () => {
    const parsed = await fetchManifest('m.json', respond(200, { version: 1, assets: {} }));
    expect(parsed.bundles).toEqual({});
    await expect(fetchManifest('m.json', respond(200, { version: 2 }))).rejects.toThrow();
  });

  it('treats a missing manifest as empty and other errors as errors', async () => {
    expect(await fetchManifest('m.json', respond(404))).toEqual(EMPTY_MANIFEST);
    await expect(fetchManifest('m.json', respond(500))).rejects.toThrow(/HTTP 500/);
  });

  it('accepts the checked-in manifest', async () => {
    const { default: file } = await import('../public/assets/manifest.json');
    await expect(fetchManifest('m.json', respond(200, file))).resolves.toBeTruthy();
  });
});
