/**
 * Typed, synchronous publish/subscribe (plan 01 §3.5). Systems talk through events
 * instead of calling each other. Each layer declares its own event map; the bus is
 * generic so core/ never imports the payload types.
 */

export type Handler<P> = (payload: P) => void;

/** `E` maps event names to payload types, e.g. `{ ShipSunk: { shipId: string } }`. */
export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, Set<Handler<never>>>();
  private readonly taps = new Set<(type: keyof E, payload: unknown) => void>();

  /** Subscribe; returns an unsubscribe function. */
  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const tap of this.taps) tap(type, payload);
    const set = this.handlers.get(type);
    if (!set) return;
    // Copy so handlers may unsubscribe (or subscribe) while being dispatched.
    for (const handler of [...set]) (handler as Handler<E[K]>)(payload);
  }

  /** See every event (the dev event log, the newspaper). Returns an unsubscribe function. */
  tap(listener: (type: keyof E, payload: unknown) => void): () => void {
    this.taps.add(listener);
    return () => this.taps.delete(listener);
  }

  clear(): void {
    this.handlers.clear();
    this.taps.clear();
  }
}
