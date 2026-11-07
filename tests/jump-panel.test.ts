import { describe, expect, it } from 'vitest';
import { harborJump, jumpUrl, lightJump, zoneJump } from '../src/debug/jump-panel';
import { findHarbor } from '../src/sim/harbors';
import { LIGHTHOUSES } from '../src/sim/lighthouses';

describe('jumpUrl', () => {
  it('drops the old place switches and keeps the rest', () => {
    const current = new URLSearchParams(
      'debug&timewarp=60&zone=zone.apostles&entry=west&npcs=stop',
    );
    const url = new URLSearchParams(jumpUrl(current, { encounter: 'tug' }));
    expect(url.has('debug')).toBe(true);
    expect(url.get('timewarp')).toBe('60');
    expect(url.get('encounter')).toBe('tug');
    expect(url.has('zone')).toBe(false);
    expect(url.has('entry')).toBe(false);
    expect(url.has('npcs')).toBe(false);
  });

  it('keeps the place when only the ship changes', () => {
    const url = new URLSearchParams(
      jumpUrl(new URLSearchParams('zone=zone.twin_ports&ship=t1'), { ship: 't2' }),
    );
    expect(url.get('zone')).toBe('zone.twin_ports');
    expect(url.get('ship')).toBe('t2');
  });

  it('writes commas as they are', () => {
    expect(jumpUrl(new URLSearchParams(), harborJump('harbor.duluth', 1))).toBe(
      '?harbor=harbor.duluth,1',
    );
  });
});

describe('jump links', () => {
  it('a light link names the light and its zone, with a distance when not 500', () => {
    const light = LIGHTHOUSES.find((l) => l.zone !== 'zone.apostles');
    expect(light).toBeDefined();
    if (!light) return;
    expect(lightJump(light, 500)).toEqual({ zone: light.zone, light: light.id });
    expect(lightJump(light, 1500)).toEqual({ zone: light.zone, light: `${light.id},1500` });
  });

  it('every light and harbor link resolves to what main.ts looks up', () => {
    for (const light of LIGHTHOUSES) {
      const set = lightJump(light, 500);
      expect(light.id.includes(set['light'] ?? '')).toBe(true);
    }
    for (const id of ['harbor.bayfield', 'harbor.duluth', 'harbor.superior']) {
      const key = harborJump(id, 0)['harbor']?.split(',')[0] ?? '';
      expect(findHarbor(key)?.id).toBe(id);
    }
  });

  it('a harbor link carries the pier index', () => {
    expect(harborJump('harbor.bayfield', 2)).toEqual({ harbor: 'harbor.bayfield,2' });
  });

  it('an entry link uses the short entry name', () => {
    expect(zoneJump('zone.apostles', 'entry.apostles_west')).toEqual({
      zone: 'zone.apostles',
      entry: 'west',
    });
    expect(zoneJump('zone.apostles')).toEqual({ zone: 'zone.apostles' });
  });
});
