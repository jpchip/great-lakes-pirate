import { describe, expect, it } from 'vitest';
import {
  DEFAULT_QUALITY,
  QUALITY_IDS,
  QUALITY_PRESETS,
  initialQuality,
  storeQuality,
} from '../src/render/quality';
import { GAMEPLAY_WAVES, MAX_WAVES } from '../src/sim/weather/waves';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('quality presets', () => {
  it('match the plan 01 §5 and plan 04 §6.2 budgets', () => {
    expect(QUALITY_PRESETS.low.waveCount).toBe(4);
    expect(QUALITY_PRESETS.medium.waveCount).toBe(6);
    expect(QUALITY_PRESETS.high.waveCount).toBe(8);
    expect(QUALITY_PRESETS.low.resolutionScale).toEqual({ min: 0.6, max: 0.75 });
    expect(QUALITY_PRESETS.medium.resolutionScale).toEqual({ min: 0.85, max: 1 });
    expect(QUALITY_PRESETS.medium.crestFoam).toBe(true);
    for (const id of QUALITY_IDS) {
      const p = QUALITY_PRESETS[id];
      expect(p.waveCount).toBeGreaterThanOrEqual(GAMEPLAY_WAVES);
      expect(p.waveCount).toBeLessThanOrEqual(MAX_WAVES);
      expect(p.resolutionScale.min).toBeLessThanOrEqual(p.resolutionScale.max);
      expect(p.sprayParticles).toBeGreaterThan(0);
    }
    expect(QUALITY_PRESETS.low.sprayParticles).toBeLessThan(QUALITY_PRESETS.high.sprayParticles);
  });

  it('picks the URL, then the stored choice, then the default', () => {
    const storage = memoryStorage();
    expect(initialQuality('', storage)).toBe(DEFAULT_QUALITY);
    storeQuality('low', storage);
    expect(initialQuality('', storage)).toBe('low');
    expect(initialQuality('?quality=high', storage)).toBe('high');
    expect(initialQuality('?quality=ultra', storage)).toBe('low');
    expect(initialQuality('', undefined)).toBe(DEFAULT_QUALITY);
  });

  it('survives storage that throws', () => {
    const broken = {
      getItem: (): string => {
        throw new Error('denied');
      },
      setItem: (): void => {
        throw new Error('denied');
      },
    };
    expect(initialQuality('', broken)).toBe(DEFAULT_QUALITY);
    expect(() => storeQuality('high', broken)).not.toThrow();
  });
});
