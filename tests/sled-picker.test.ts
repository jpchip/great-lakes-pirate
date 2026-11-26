import { describe, expect, it } from 'vitest';
import { attachSledPicker, type SledView } from '../src/gameplay/sled-picker';
import { COLD } from '../src/sim/cold/footing';
import { moveLot, type Sled } from '../src/sim/cold/sled';
import type { CargoStack } from '../src/sim/economy/hold';

/** The hand sled's picker (piece M): choose what goes on her from the hold, and back. */

const setup = (hold: CargoStack[]) => {
  let sled: Sled | undefined = { x: 0, z: 0, heading: 0, load: [] };
  const shown: (SledView | undefined)[] = [];
  const acts: string[] = [];
  const opens: boolean[] = [];
  const picker = attachSledPicker({
    sled: () => sled,
    hold: () => hold,
    holdChanged: () => undefined,
    goodName: (g) => g.replace('good.', ''),
    valueOf: (g) => (g === 'good.furs' ? 7000 : 1000),
    show: (v) => shown.push(v),
    onOpen: (o) => opens.push(o),
    handled: (a) => {
      acts.push(a);
      if (a === 'stowed') sled = undefined;
    },
  });
  return { picker, hold, sled: () => sled, last: () => shown.at(-1), acts, opens };
};

describe('moving a lot between the hold and the sled', () => {
  it('splits the price paid and merges into a like lot', () => {
    const from: CargoStack[] = [{ good: 'good.flour', qty: 4, paidCents: 400 }];
    const to: CargoStack[] = [{ good: 'good.flour', qty: 1, paidCents: 90 }];
    expect(moveLot(from, to, 0, 3, 2)).toBe(2);
    expect(from).toEqual([{ good: 'good.flour', qty: 2, paidCents: 200 }]);
    expect(to).toEqual([{ good: 'good.flour', qty: 3, paidCents: 290 }]);
    expect(moveLot(from, to, 0, 5)).toBe(2);
    expect(from).toEqual([]);
  });

  it('leaves contract freight aboard', () => {
    const from: CargoStack[] = [{ good: 'good.flour', qty: 4, contract: 'c1' }];
    expect(moveLot(from, [], 0, 1)).toBe(0);
  });
});

describe("the sled's picker", () => {
  it('loads what you pick, one CU or a lot, up to her capacity, and back off', () => {
    const g = setup([
      { good: 'good.flour', qty: 5 },
      { good: 'good.furs', qty: 2 },
      { good: 'good.salt', qty: 3, contract: 'c1' },
    ]);
    g.picker.open();
    expect(g.opens).toEqual([true]);
    expect(g.last()?.capacity).toBe(COLD.sled.capacityCu);
    g.picker.actions.load(0, 1);
    expect(g.sled()?.load).toEqual([{ good: 'good.flour', qty: 1 }]);
    g.picker.actions.load(0);
    expect(g.last()?.used).toBe(COLD.sled.capacityCu);
    expect(g.hold[0]).toEqual({ good: 'good.flour', qty: 2 });
    g.picker.actions.load(1);
    expect(g.last()?.message).toBe('The sled is full.');
    g.picker.actions.load(2);
    expect(g.last()?.message).toMatch(/Contract/);
    g.picker.actions.unload(0, 1);
    expect(g.last()?.used).toBe(COLD.sled.capacityCu - 1);
    g.picker.actions.empty();
    expect(g.sled()?.load).toEqual([]);
    g.picker.actions.fill();
    expect(g.sled()?.load[0]?.good).toBe('good.furs');
    g.picker.actions.stow();
    expect(g.last()?.message).toBe('Unload her first.');
    g.picker.actions.empty();
    g.picker.actions.stow();
    expect(g.sled()).toBeUndefined();
    expect(g.opens).toEqual([true, false]);
    expect(g.acts).toContain('stowed');
  });
});
