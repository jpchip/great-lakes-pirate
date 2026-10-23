import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../src/core/events';

interface Events {
  ShipSunk: { shipId: string };
  DayChanged: { day: number };
}

describe('EventBus', () => {
  it('delivers typed payloads synchronously and unsubscribes', () => {
    const bus = new EventBus<Events>();
    const seen: string[] = [];
    const off = bus.on('ShipSunk', (e) => seen.push(e.shipId));
    bus.emit('ShipSunk', { shipId: 'ship.morrill' });
    off();
    bus.emit('ShipSunk', { shipId: 'ship.other' });
    expect(seen).toEqual(['ship.morrill']);
  });

  it('fires once() handlers a single time', () => {
    const bus = new EventBus<Events>();
    const fn = vi.fn();
    bus.once('DayChanged', fn);
    bus.emit('DayChanged', { day: 1 });
    bus.emit('DayChanged', { day: 2 });
    expect(fn).toHaveBeenCalledExactlyOnceWith({ day: 1 });
  });

  it('lets a handler unsubscribe another during dispatch without skipping it', () => {
    const bus = new EventBus<Events>();
    const calls: string[] = [];
    const offB = bus.on('DayChanged', () => calls.push('b'));
    bus.on('DayChanged', () => {
      calls.push('a');
      offB();
    });
    bus.emit('DayChanged', { day: 1 });
    bus.emit('DayChanged', { day: 2 });
    expect(calls).toEqual(['b', 'a', 'a']);
  });

  it('taps see every event', () => {
    const bus = new EventBus<Events>();
    const log: unknown[] = [];
    bus.tap((type, payload) => log.push([type, payload]));
    bus.emit('DayChanged', { day: 3 });
    expect(log).toEqual([['DayChanged', { day: 3 }]]);
  });
});
