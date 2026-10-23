import { writeCurrent, writeDanger, type GlpDatabase } from './db';
import type { SaveEncoder } from './encoder';
import type { SaveEnvelope, SaveHeader } from './envelope';
import type { SavePayload } from './migrations';

/** Identity of the run being played; carried into every envelope (plan 16 §5.1). */
export interface RunInfo {
  runId: string;
  seed: string;
  createdAt: string;
  gameVersion: string;
}

/**
 * Writes the active run. Saves are serialized: a save requested while one is in flight
 * waits for it, so `current` and `backup` are always written in order.
 */
export class RunSaver {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly startedAtMs: number;

  constructor(
    private readonly db: GlpDatabase,
    private readonly encode: SaveEncoder,
    readonly run: RunInfo,
    /** Play time from earlier sessions of this run. */
    private readonly priorPlayTimeMs = 0,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.startedAtMs = now();
  }

  get playTimeMs(): number {
    return this.priorPlayTimeMs + (this.now() - this.startedAtMs);
  }

  save(state: SavePayload, kind: 'current' | 'danger' = 'current'): Promise<SaveEnvelope> {
    const header: SaveHeader = {
      ...this.run,
      savedAt: new Date(this.now()).toISOString(),
      playTimeMs: this.playTimeMs,
      kind,
    };
    const job = this.queue.then(async () => {
      const envelope = await this.encode(state, header);
      await (kind === 'danger' ? writeDanger : writeCurrent)(this.db, envelope);
      return envelope;
    });
    // Keep the queue alive after a failed save; the caller still sees the rejection.
    this.queue = job.catch(() => undefined);
    return job;
  }
}
