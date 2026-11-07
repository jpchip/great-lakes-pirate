/**
 * The single-tab lock (plan 16 §4.4): two tabs must never run the one run, or each would
 * save over the other. The first tab holds a Web Lock for as long as it's open; a second
 * gets none and says so. A reload hands the lock over as the old page unloads, so a
 * second try waits a moment before giving up. Without the Web Locks API (old browsers),
 * every tab plays.
 */

export const TAB_LOCK_NAME = 'glp-run';

/** How long a tab waits for the lock before deciding another tab has it. */
const HANDOVER_MS = 1500;

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
}

export async function acquireTabLock(
  locks: LockManagerLike | undefined = (navigator as { locks?: LockManagerLike }).locks,
  name = TAB_LOCK_NAME,
  waitMs = HANDOVER_MS,
): Promise<boolean> {
  if (!locks) return true;
  /** Held until the page goes: a promise that never settles. */
  const hold = (): Promise<never> => new Promise<never>(() => undefined);
  const now = await new Promise<boolean>((resolve) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        resolve(!!lock);
        return lock ? hold() : undefined;
      })
      .catch(() => resolve(false));
  });
  if (now) return true;
  // A reload's old page may still be letting go: wait a moment for it.
  return new Promise<boolean>((resolve) => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      abort.abort();
      resolve(false);
    }, waitMs);
    locks
      .request(name, { signal: abort.signal }, () => {
        clearTimeout(timer);
        resolve(true);
        return hold();
      })
      .catch(() => resolve(false));
  });
}
