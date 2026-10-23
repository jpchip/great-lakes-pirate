import { encodeSave, type SaveHeader } from './envelope';
import type { SavePayload } from './migrations';

/**
 * Save worker (plan 16 §6.2): the main thread posts a structured clone of WorldState;
 * the worker stringifies, compresses and checksums it off the main thread. The main
 * thread then writes the envelope to IndexedDB (IDB writes are already async).
 */

export interface EncodeRequest {
  id: number;
  state: SavePayload;
  header: SaveHeader;
}

export type EncodeResponse =
  | { id: number; ok: true; envelope: ReturnType<typeof encodeSave> }
  | { id: number; ok: false; error: string };

// The DOM and WebWorker libs can't share one tsconfig, so type just what's used.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<EncodeRequest>) => void) | null;
  postMessage(message: EncodeResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, state, header } = e.data;
  try {
    const envelope = encodeSave(state, header);
    scope.postMessage({ id, ok: true, envelope } satisfies EncodeResponse, [
      envelope.payload.buffer,
    ]);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: String(err) } satisfies EncodeResponse);
  }
};
