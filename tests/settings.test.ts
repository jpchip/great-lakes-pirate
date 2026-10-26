import { describe, expect, it } from 'vitest';
import { bindingOverrides, codeLabel, DEFAULT_BINDINGS, rebind } from '../src/core/input';
import {
  applyBindingOverrides,
  defaultSettings,
  LEGACY_QUALITY_KEY,
  parseSettings,
  SETTINGS_FALLBACK_KEY,
  SettingsStore,
  storageBackend,
  withFallback,
  type Settings,
  type SettingsBackend,
} from '../src/core/settings';

function memoryStorage(seed: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

function memoryBackend(initial?: unknown): SettingsBackend & { stored: unknown } {
  const backend = {
    stored: initial,
    read: () => Promise.resolve(backend.stored),
    write: (value: Settings) => {
      backend.stored = structuredClone(value);
      return Promise.resolve();
    },
  };
  return backend;
}

describe('settings', () => {
  it('defaults to Medium, auto resolution, the minimal HUD and no camera roll', () => {
    const s = defaultSettings();
    expect(s.graphics).toEqual({ quality: 'medium', resolution: 'auto' });
    expect(s.ui.hudDensity).toBe('minimal');
    expect(s.camera.rollWithShip).toBe(false);
    expect(s.camera.autoRecenter).toBe(true);
    expect(s.sailing.manualTrim).toBe(false);
    expect(s.bindings).toEqual({});
  });

  it('keeps every valid field and defaults only the bad ones', () => {
    const s = parseSettings({
      graphics: { quality: 'ultra', resolution: 0.75 },
      camera: { rollWithShip: true, sensitivity: 99 },
      ui: 'nonsense',
      bindings: { sailing: { RaiseSail: ['KeyI'] } },
    });
    expect(s.graphics).toEqual({ quality: 'medium', resolution: 0.75 });
    expect(s.camera.rollWithShip).toBe(true);
    expect(s.camera.sensitivity).toBe(1);
    expect(s.ui.hudDensity).toBe('minimal');
    expect(s.bindings).toEqual({ sailing: { RaiseSail: ['KeyI'] } });
    expect(parseSettings(undefined)).toEqual(defaultSettings());
    expect(parseSettings(42)).toEqual(defaultSettings());
  });

  it('carries the Phase 0 quality pick over from localStorage', async () => {
    const local = storageBackend(memoryStorage({ [LEGACY_QUALITY_KEY]: 'low' }));
    const store = await SettingsStore.load(withFallback(memoryBackend(), local));
    expect(store.value.graphics.quality).toBe('low');
  });

  it('notifies listeners at once and persists in the background', async () => {
    const backend = memoryBackend();
    const store = await SettingsStore.load(backend);
    const seen: [string, string][] = [];
    store.subscribe((now, before) => seen.push([before.graphics.quality, now.graphics.quality]));
    store.update((s) => (s.graphics.quality = 'high'));
    expect(seen).toEqual([['medium', 'high']]);
    expect(store.value.graphics.quality).toBe('high');
    await store.flush();
    const reloaded = await SettingsStore.load(backend);
    expect(reloaded.value.graphics.quality).toBe('high');
  });

  it('round-trips through the localStorage fallback and survives a broken store', async () => {
    const storage = memoryStorage();
    const store = await SettingsStore.load(storageBackend(storage));
    store.update((s) => (s.ui.hudDensity = 'off'));
    await store.flush();
    expect(JSON.parse(storage.getItem(SETTINGS_FALLBACK_KEY) ?? '{}').ui.hudDensity).toBe('off');

    const broken: SettingsBackend = {
      read: () => Promise.reject(new Error('denied')),
      write: () => Promise.reject(new Error('denied')),
    };
    const fallback = await SettingsStore.load(broken);
    expect(fallback.value).toEqual(defaultSettings());
    fallback.update((s) => (s.camera.rollWithShip = true));
    await fallback.flush();
    expect(fallback.value.camera.rollWithShip).toBe(true);
  });
});

describe('key rebinding', () => {
  it('replaces the primary key and keeps the arrow-key alternative', () => {
    const b = rebind(DEFAULT_BINDINGS, 'sailing', 'RaiseSail', 'KeyI');
    expect(b.sailing.RaiseSail).toEqual(['KeyI', 'ArrowUp']);
    // Other contexts and the defaults are untouched.
    expect(b.onFoot).toBe(DEFAULT_BINDINGS.onFoot);
    expect(DEFAULT_BINDINGS.sailing.RaiseSail).toEqual(['KeyW', 'ArrowUp']);
  });

  it('takes the key away from any other action in the same context', () => {
    const b = rebind(DEFAULT_BINDINGS, 'sailing', 'Anchor', 'KeyQ');
    expect(b.sailing.Anchor).toEqual(['KeyQ']);
    expect(b.sailing.TrimIn).toEqual([]);
  });

  it('never binds Escape', () => {
    expect(rebind(DEFAULT_BINDINGS, 'sailing', 'Anchor', 'Escape')).toBe(DEFAULT_BINDINGS);
  });

  it('stores only the differences and rebuilds the same bindings from them', () => {
    expect(bindingOverrides(DEFAULT_BINDINGS)).toEqual({});
    const b = rebind(DEFAULT_BINDINGS, 'sailing', 'Spyglass', 'KeyZ');
    const overrides = bindingOverrides(b);
    expect(overrides).toEqual({ sailing: { Spyglass: ['KeyZ'] } });
    expect(applyBindingOverrides(DEFAULT_BINDINGS, overrides)).toEqual(b);
    // A settings round trip keeps them.
    const s = parseSettings({ bindings: overrides });
    expect(applyBindingOverrides(DEFAULT_BINDINGS, s.bindings).sailing.Spyglass).toEqual(['KeyZ']);
  });

  it('names keys and mouse buttons for the settings screen', () => {
    expect(codeLabel('KeyW')).toBe('W');
    expect(codeLabel('Digit3')).toBe('3');
    expect(codeLabel('ArrowLeft')).toBe('Left arrow');
    expect(codeLabel('Mouse2')).toBe('Right mouse');
    expect(codeLabel('ShiftLeft')).toBe('Shift (Left)');
    expect(codeLabel('Space')).toBe('Space');
  });
});
