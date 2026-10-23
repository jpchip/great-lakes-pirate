import { encodeSave, type SaveEnvelope, type SaveHeader } from './envelope';
import type { SavePayload } from './migrations';
import type { EncodeRequest, EncodeResponse } from './save-worker';

export type SaveEncoder = (state: SavePayload, header: SaveHeader) => Promise<SaveEnvelope>;

/** Encode on the main thread. Used in tests and where workers are unavailable. */
export const encodeInline: SaveEncoder = (state, header) =>
  Promise.resolve(encodeSave(state, header));

/** Encode in the save worker; falls back to inline if the worker can't start. */
export function createWorkerEncoder(): SaveEncoder {
  let worker: Worker;
  try {
    worker = new Worker(new URL('./save-worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return encodeInline;
  }

  let nextId = 0;
  const pending = new Map<
    number,
    { resolve: (e: SaveEnvelope) => void; reject: (err: Error) => void }
  >();
  worker.onmessage = (e: MessageEvent<EncodeResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.envelope);
    else p.reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message));
    pending.clear();
  };

  return (state, header) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      // postMessage makes the structured clone of WorldState (plan 16 §6.2).
      worker.postMessage({ id, state, header } satisfies EncodeRequest);
    });
}
