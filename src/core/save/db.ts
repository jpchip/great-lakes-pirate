import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SaveEnvelope } from './envelope';

/**
 * IndexedDB database `glp` (plan 16 §2). Only the `run` store is used in Phase 0;
 * the others are created now so later phases don't need a schema upgrade for them.
 */

export const DB_NAME = 'glp';
export const DB_VERSION = 1;

export type RunKey = 'current' | 'backup' | 'danger';

interface GlpSchema extends DBSchema {
  run: { key: RunKey; value: SaveEnvelope };
  lastRun: { key: 'summary'; value: unknown };
  settings: { key: string; value: unknown };
  hall: { key: number; value: unknown };
  meta: { key: string; value: unknown };
}

export type GlpDatabase = IDBPDatabase<GlpSchema>;

export function openSaveDb(): Promise<GlpDatabase> {
  return openDB<GlpSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('run');
      db.createObjectStore('lastRun');
      db.createObjectStore('settings');
      db.createObjectStore('hall', { autoIncrement: true });
      db.createObjectStore('meta');
    },
  });
}

/**
 * Atomic autosave (plan 16 §6.1): one transaction moves the old `current` to `backup`
 * and writes the new `current`. A crash mid-write leaves the previous pair intact.
 */
export async function writeCurrent(db: GlpDatabase, envelope: SaveEnvelope): Promise<void> {
  const tx = db.transaction('run', 'readwrite');
  const previous = await tx.store.get('current');
  if (previous) await tx.store.put({ ...previous, kind: 'backup' }, 'backup');
  await tx.store.put({ ...envelope, kind: 'current' }, 'current');
  await tx.done;
}

/** The danger snapshot gets its own transaction (plan 16 §4.3). */
export async function writeDanger(db: GlpDatabase, envelope: SaveEnvelope): Promise<void> {
  await db.put('run', { ...envelope, kind: 'danger' }, 'danger');
}

export async function clearDanger(db: GlpDatabase): Promise<void> {
  await db.delete('run', 'danger');
}

/** Read a slot without validating it; load.ts checks it. */
export function readRunSlot(db: GlpDatabase, key: RunKey): Promise<unknown> {
  return db.get('run', key);
}

export async function hasRun(db: GlpDatabase): Promise<boolean> {
  return (await db.count('run', 'current')) > 0 || (await db.count('run', 'danger')) > 0;
}

/** Run end: delete every run slot before anything is shown (plan 16 §3). */
export async function deleteRun(db: GlpDatabase): Promise<void> {
  const tx = db.transaction('run', 'readwrite');
  await Promise.all([
    tx.store.delete('current'),
    tx.store.delete('backup'),
    tx.store.delete('danger'),
  ]);
  await tx.done;
}
