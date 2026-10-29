import { AssetLoader, EMPTY_MANIFEST } from '../../src/core/assets';
import { createGameWorld } from '../../src/gameplay/ecs';
import { isQualityId } from '../../src/render/quality';
import { GameRenderer } from '../../src/render/renderer';
import { createTestScene } from '../../src/render/test-scene';
import { httpBytes, loadZoneTerrain } from '../../src/sim/terrain/load';
import { APOSTLES_ID, zoneDef } from '../../src/sim/terrain/zones';
import { createLocalWeather } from '../../src/sim/weather/local-weather';
import { createSea } from '../../src/sim/weather/waves';
import { createWorldState } from '../../src/sim/world-state';

/**
 * Zone streaming bench (Phase 2 piece B; plan 03 §8.3). Loads the whole Apostles zone
 * into the game's scene and flies the player's schooner along the exit-criteria route,
 * Bayfield to Ashland and out to Outer Island, timing every frame and the terrain
 * streaming inside it. `npm run dev`, then `/bench/stream/`. `?quality=low|medium|high`
 * picks the preset (Medium by default) and `?speed=8` the multiple of Full sail (8 by
 * default, about 94 m/s, so the whole route takes about three minutes and tiles turn
 * over eight times faster than sailing). `npm run bench:stream` runs it in Chromium.
 */

/** Full sail on screen at C = 8 and R = 24 (plan 03 §15), m/s. */
const FULL_SAIL_MS = 11.8;
/** Frames slower than this are hitches (the Phase 2 exit criteria). */
const HITCH_MS = 33;

/** Bayfield → down the west channel to Ashland → out across the bay to Outer Island. */
const ROUTE: readonly [number, number][] = [
  [-640, 150],
  [-800, 330],
  [-700, 900],
  [-900, 1600],
  [-1300, 2400],
  [-1500, 3150],
  [-700, 2700],
  [0, 1700],
  [900, 800],
  [1800, -200],
  [2300, -1500],
  [2600, -2300],
];

const params = new URLSearchParams(location.search);
const quality = params.get('quality');
const speed = Number(params.get('speed') ?? 8) * FULL_SAIL_MS;
const out = document.getElementById('out') as HTMLPreElement;

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

async function run(): Promise<unknown> {
  const def = zoneDef(APOSTLES_ID);
  const loadStart = performance.now();
  const zone = await loadZoneTerrain(httpBytes(new URL(`../../${def.world}`, location.href)));
  const loadMs = performance.now() - loadStart;

  const state = createWorldState('bench');
  state.environment.clock.gameSeconds = 12 * 3600;
  const world = createGameWorld();
  const [x0, z0] = ROUTE[0] as [number, number];
  const transform = { position: { x: x0, y: 0, z: z0 }, heading: 0 };
  const ship = world.add({
    id: 'ship.player',
    transform,
    previousTransform: { position: { ...transform.position }, heading: 0 },
    model: 'schooner',
    playerControlled: true,
  });
  const renderer = new GameRenderer(
    document.getElementById('app') as HTMLElement,
    isQualityId(quality) ? quality : 'medium',
  );
  const sceneStart = performance.now();
  const scene = await createTestScene(
    renderer,
    world,
    createSea(),
    new AssetLoader({ manifest: EMPTY_MANIFEST, baseUrl: document.baseURI, decoders: {} }),
    createLocalWeather(undefined, zone.terrain),
    state.environment.clock,
    zone,
    [],
    def.edge,
  );
  const sceneMs = performance.now() - sceneStart;
  const terrain = scene.terrain;
  if (!terrain) throw new Error('no terrain view');
  terrain.resetStats();

  // Settle for a second before timing.
  const frames: number[] = [];
  const streamMs: number[] = [];
  const hitches: { at: [number, number]; frameMs: number; streamMs: number; builds: number }[] = [];
  let leg = 0;
  let along = 0;
  let last = performance.now();
  let settle = 60;
  let maxDrawCalls = 0;
  let maxPending = 0;

  return new Promise((resolve) => {
    const frame = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      const frameMs = now - last;
      last = now;
      const a = ROUTE[leg] as [number, number];
      const b = ROUTE[leg + 1];
      if (!b) {
        const sorted = [...frames].sort((p, q) => p - q);
        const stream = [...streamMs].sort((p, q) => p - q);
        resolve({
          quality: renderer.preset.id,
          speedMs: speed,
          loadMs: Math.round(loadMs),
          sceneMs: Math.round(sceneMs),
          frames: frames.length,
          frameMs: {
            p50: +percentile(sorted, 0.5).toFixed(1),
            p95: +percentile(sorted, 0.95).toFixed(1),
            max: +(sorted.at(-1) ?? 0).toFixed(1),
          },
          streamMs: {
            p50: +percentile(stream, 0.5).toFixed(2),
            p95: +percentile(stream, 0.95).toFixed(2),
            p99: +percentile(stream, 0.99).toFixed(2),
            max: +(stream.at(-1) ?? 0).toFixed(2),
          },
          builds: terrain.stats.builds,
          maxBuildMs: +terrain.stats.maxBuildMs.toFixed(2),
          maxDrawCalls,
          maxPending,
          hitchesOver33ms: hitches.length,
          worstHitches: hitches.sort((p, q) => q.frameMs - p.frameMs).slice(0, 8),
          renderer: renderer.renderer.getContext().getParameter(0x1f01) as string,
        });
        return;
      }
      ship.previousTransform = { position: { ...transform.position }, heading: transform.heading };
      if (settle > 0) {
        settle--;
      } else {
        const legM = Math.hypot(b[0] - a[0], b[1] - a[1]);
        along += speed * dt;
        if (along >= legM) {
          along -= legM;
          leg++;
        }
        const t = Math.min(1, along / legM);
        transform.position.x = a[0] + (b[0] - a[0]) * t;
        transform.position.z = a[1] + (b[1] - a[1]) * t;
        transform.heading = Math.atan2(b[0] - a[0], -(b[1] - a[1]));
      }
      const before = terrain.stats.builds;
      scene.render(1, now / 1000, dt);
      if (settle === 0) {
        frames.push(frameMs);
        streamMs.push(terrain.stats.lastUpdateMs);
        maxDrawCalls = Math.max(maxDrawCalls, terrain.stats.drawCalls);
        maxPending = Math.max(maxPending, terrain.stats.pending);
        if (frameMs > HITCH_MS) {
          hitches.push({
            at: [Math.round(transform.position.x), Math.round(transform.position.z)],
            frameMs: +frameMs.toFixed(1),
            streamMs: +terrain.stats.lastUpdateMs.toFixed(2),
            builds: terrain.stats.builds - before,
          });
        }
      }
      out.textContent =
        `leg ${leg + 1}/${ROUTE.length - 1}  ${frameMs.toFixed(1)} ms  ` +
        `stream ${terrain.stats.lastUpdateMs.toFixed(2)} ms  tiles ${terrain.stats.tiles}  ` +
        `pending ${terrain.stats.pending}  builds ${terrain.stats.builds}`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

run().then(
  (result) => {
    out.textContent = JSON.stringify(result, null, 2);
    document.body.dataset['stream'] = 'done';
  },
  (err: unknown) => {
    out.textContent = String(err);
    document.body.dataset['stream'] = 'failed';
  },
);
