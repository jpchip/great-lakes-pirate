import { strToU8, zlibSync } from 'fflate';
import { crc32Hex } from '../../src/core/save/checksum';
import { deleteRun, openSaveDb, writeCurrent } from '../../src/core/save/db';
import { decodeSave } from '../../src/core/save/decode';
import { createWorkerEncoder } from '../../src/core/save/encoder';
import { encodeSave, type SaveHeader } from '../../src/core/save/envelope';
import { SECONDS_PER_GAME_DAY, createClockState, fastForward } from '../../src/core/time';
import { buildWorstCaseState, type PieceEncoding } from './worst-case';
import { createWorldTick } from './world-tick';

/**
 * Spike S6 measurements, run in a real browser (bench/s6/index.html). Timings use
 * performance.now(); every figure is reported as median, p95 and max over the runs.
 */

const WARMUP = 3;
const RUNS = 20;

export interface Stats {
  median: number;
  p95: number;
  max: number;
}

function stats(samples: number[]): Stats {
  const s = [...samples].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] as number;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { median: r(at(0.5)), p95: r(at(0.95)), max: r(s[s.length - 1] as number) };
}

async function sample(fn: () => unknown): Promise<Stats> {
  const out: number[] = [];
  for (let i = 0; i < WARMUP + RUNS; i++) {
    const t0 = performance.now();
    await fn();
    const dt = performance.now() - t0;
    if (i >= WARMUP) out.push(dt);
  }
  return stats(out);
}

const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));

/** Records every frame gap and every long task while `work` runs. */
async function watchFrames(work: () => Promise<void>) {
  const gaps: number[] = [];
  const longTasks: number[] = [];
  const observer =
    'PerformanceObserver' in globalThis &&
    PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver((list) => {
          for (const e of list.getEntries()) longTasks.push(Math.round(e.duration));
        })
      : undefined;
  observer?.observe({ type: 'longtask' });
  let running = true;
  let last = await nextFrame();
  const frames = (async () => {
    while (running) {
      const now = await nextFrame();
      gaps.push(now - last);
      last = now;
    }
  })();
  await work();
  running = false;
  await frames;
  observer?.disconnect();
  return { frames: gaps.length, frameGapMs: stats(gaps), longTasksMs: longTasks };
}

const header: SaveHeader = {
  gameVersion: 'bench',
  runId: 'bench-s6',
  seed: 's6-worst-case',
  createdAt: '1900-05-07T00:00:00.000Z',
  savedAt: '1900-05-07T00:00:00.000Z',
  playTimeMs: 0,
  kind: 'current',
};

async function measureEncoding(encoding: PieceEncoding) {
  const state = buildWorstCaseState(undefined, encoding);
  const json = JSON.stringify(state);
  const raw = strToU8(json);
  const envelope = encodeSave(state, header);
  const hideoutsJson = JSON.stringify(state.hideouts);

  // Inline encode, split into its steps (plan 16 §6.2 does these in the worker).
  const clone = await sample(() => structuredClone(state));
  const stringify = await sample(() => JSON.stringify(state));
  const compress = await sample(() => zlibSync(raw, { level: 6 }));
  const checksum = await sample(() => crc32Hex(envelope.payload));
  const encodeInlineMs = await sample(() => encodeSave(state, header));
  const decode = await sample(() => decodeSave(envelope));

  // The real save path: worker encode, then the atomic IDB write (plan 16 §6.1).
  const db = await openSaveDb();
  const encode = createWorkerEncoder();
  const postMessage: number[] = [];
  const workerRoundTrip: number[] = [];
  const idbWrite: number[] = [];
  const total: number[] = [];
  const saveOnce = async (record: boolean) => {
    const t0 = performance.now();
    const pending = encode(state, header);
    const t1 = performance.now();
    const env = await pending;
    const t2 = performance.now();
    await writeCurrent(db, env);
    const t3 = performance.now();
    if (record) {
      postMessage.push(t1 - t0);
      workerRoundTrip.push(t2 - t0);
      idbWrite.push(t3 - t2);
      total.push(t3 - t0);
    }
  };
  for (let i = 0; i < WARMUP; i++) await saveOnce(false);

  const idle = await watchFrames(async () => {
    for (let i = 0; i < 60; i++) await nextFrame();
  });
  // One save every few frames, the way an autosave lands mid-play.
  const saving = await watchFrames(async () => {
    for (let i = 0; i < RUNS; i++) {
      await saveOnce(true);
      for (let f = 0; f < 3; f++) await nextFrame();
    }
  });
  await deleteRun(db);
  db.close();

  return {
    encoding,
    sizes: {
      rawBytes: raw.length,
      compressedBytes: envelope.payload.length,
      hideoutsRawBytes: strToU8(hideoutsJson).length,
      hideoutsCompressedBytes: zlibSync(strToU8(hideoutsJson), { level: 6 }).length,
      bytesPerPieceRaw: Math.round((strToU8(hideoutsJson).length / (7 * 1500)) * 10) / 10,
    },
    sliceBytes: Object.fromEntries(
      Object.entries(state).map(([key, slice]) => {
        const bytes = strToU8(JSON.stringify(slice));
        return [key, { raw: bytes.length, compressed: zlibSync(bytes, { level: 6 }).length }];
      }),
    ),
    compressionLevels: Object.fromEntries(
      ([1, 3, 6, 9] as const).map((level) => {
        let bytes = 0;
        const t0 = performance.now();
        for (let i = 0; i < 5; i++) bytes = zlibSync(raw, { level }).length;
        return [
          `level${level}`,
          { bytes, ms: Math.round(((performance.now() - t0) / 5) * 10) / 10 },
        ];
      }),
    ),
    inlineMs: { clone, stringify, compress, checksum, encodeTotal: encodeInlineMs, decode },
    workerPathMs: {
      mainThreadPostMessage: stats(postMessage),
      workerRoundTrip: stats(workerRoundTrip),
      idbWrite: stats(idbWrite),
      total: stats(total),
    },
    frames: { idle, saving },
  };
}

function measureFastForward(iceEveryTicks: number) {
  const samples: number[] = [];
  let ticks = 0;
  for (let i = 0; i < 1 + 5; i++) {
    const state = buildWorstCaseState();
    const tick = createWorldTick(state, iceEveryTicks);
    const clock = createClockState();
    const t0 = performance.now();
    ticks = fastForward(clock, 12 * SECONDS_PER_GAME_DAY, tick);
    if (i > 0) samples.push(performance.now() - t0);
  }
  return { gameDays: 12, ticks, iceEveryTicks, ms: stats(samples) };
}

export async function runS6() {
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    packed: await measureEncoding('packed'),
    objects: await measureEncoding('objects'),
    fastForward: {
      iceEveryTick: measureFastForward(1),
      iceDaily: measureFastForward(144),
    },
  };
}
