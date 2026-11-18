import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * bench.hideout in the game (plan 09 §16.3 criteria 3 and 12; Phase 8 piece J): Stockton
 * at Medium, B in the hideout, the site filled to about 1,500 pieces through build mode's
 * own drags (foundations, pilings, walls, floors, storage and roofs on both levels), and
 * Build pressed. Then the build camera orbits and zooms over it, and the captain stands
 * in the yard looking at it. Reports the whole frame's draw calls and triangles with the
 * starter shack and with the full hideout (the difference is the hideout's own), and
 * frame times taken from requestAnimationFrame in the page. Headless Chromium draws on
 * the CPU (SwiftShader), so the frame times only mean something on the laptop: run
 * `npm run bench:hideout` there with `HEADED=1` for a real GPU.
 */

interface BuildHooks {
  open(): string | undefined;
  state(): { built: number; planned: number; level: number; message?: string } | undefined;
  drag(from: [number, number], to: [number, number]): void;
  key(code: string, mods?: { ctrl?: boolean; shift?: boolean }): void;
  select(id: string, variant?: number): void;
  give(goods: Record<string, number>): boolean;
  build(): void;
  click(x: number, z: number): void;
  tool(t: 'place' | 'remove'): void;
  toZone(hideout: string, x: number, z: number): { x: number; z: number } | undefined;
  sites(): { hideout: string; cols: number; rows: number; built: number }[];
  drawn(): Record<string, { built: number; ghosts: number }> | undefined;
}

interface FootHooks {
  teleport(x: number, z: number, y?: number): void;
  face(deg: number, pitch?: number): void;
  hour(h: number): void;
  renderStats(): { drawCalls: number; triangles: number; scale: number } | undefined;
}

type W = Window & {
  __glpBuild: BuildHooks;
  __glpFoot: FootHooks;
  __benchFrames?: number[];
};

const HIDEOUT = 'hideout.stockton';

/** Starts collecting frame gaps from requestAnimationFrame, from now. */
async function startFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as W;
    const frames: number[] = [];
    w.__benchFrames = frames;
    let last = performance.now();
    const tick = (now: number): void => {
      if (w.__benchFrames !== frames) return;
      frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface Sample {
  frames: number;
  frameMedianMs: number;
  frameP95Ms: number;
  drawCallsMax: number;
  drawCallsMedian: number;
  trianglesMax: number;
}

/** Ends the frame collection and summarizes it with the draw-call samples taken meanwhile. */
async function stopFrames(
  page: Page,
  stats: { drawCalls: number; triangles: number }[],
): Promise<Sample> {
  const frames = await page.evaluate(() => {
    const w = window as unknown as W;
    const f = w.__benchFrames ?? [];
    delete w.__benchFrames;
    // The first gap includes the bench's own setup.
    return f.slice(1);
  });
  const f = [...frames].sort((a, b) => a - b);
  const q = (p: number): number => f[Math.min(f.length - 1, Math.floor(p * f.length))] ?? 0;
  const calls = stats.map((s) => s.drawCalls).sort((a, b) => a - b);
  const round = (n: number): number => Math.round(n * 10) / 10;
  return {
    frames: f.length,
    frameMedianMs: round(q(0.5)),
    frameP95Ms: round(q(0.95)),
    drawCallsMax: calls.at(-1) ?? 0,
    drawCallsMedian: calls[Math.floor(calls.length / 2)] ?? 0,
    trianglesMax: Math.max(0, ...stats.map((s) => s.triangles)),
  };
}

const renderStats = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__glpFoot.renderStats());

/**
 * The build camera for `seconds`: a right-drag orbit all the way round the site, then
 * zoomed out and round again, sampling the frame's draw calls four times a second.
 */
async function orbitBuildCamera(page: Page, seconds: number): Promise<Sample> {
  const stats: { drawCalls: number; triangles: number }[] = [];
  await startFrames(page);
  const steps = seconds * 4;
  await page.mouse.move(640, 360);
  await page.mouse.down({ button: 'right' });
  for (let k = 0; k < steps; k++) {
    if (k === Math.floor(steps / 2)) {
      await page.mouse.up({ button: 'right' });
      await page.mouse.wheel(0, 600);
      await page.mouse.move(640, 360);
      await page.mouse.down({ button: 'right' });
    }
    // About 2π of yaw per half (0.006 rad a pixel).
    await page.mouse.move(640 + ((k % (steps / 2)) + 1) * (1050 / (steps / 2)) - 525, 360);
    await page.waitForTimeout(250);
    const s = await renderStats(page);
    if (s) stats.push(s);
  }
  await page.mouse.up({ button: 'right' });
  await page.mouse.wheel(0, -600);
  return stopFrames(page, stats);
}

/** On foot in the site's front yard, turning slowly to look over the compound. */
async function lookOnFoot(page: Page, seconds: number): Promise<Sample> {
  const stats: { drawCalls: number; triangles: number }[] = [];
  await startFrames(page);
  for (let k = 0; k < seconds * 4; k++) {
    if (k % 4 === 0) {
      await page.evaluate(
        (deg) => (window as unknown as W).__glpFoot.face(deg, 0.15),
        (k * 9) % 360,
      );
    }
    await page.waitForTimeout(250);
    const s = await renderStats(page);
    if (s) stats.push(s);
  }
  return stopFrames(page, stats);
}

/**
 * Fills the whole site through build mode's drags, as a player dragging rectangles and
 * lines would: whatever the validity refuses (water, slope, the shack) is left out.
 */
function fillSite(): { planned: number } {
  const w = window as unknown as W;
  const b = w.__glpBuild;
  const site = b.sites()[0];
  if (!site) return { planned: 0 };
  const xMax = site.cols * 2 - 1;
  const zMax = site.rows * 2 - 1;
  const area = (id: string, variant = 0): void => {
    b.select(id, variant);
    b.drag([1, 1], [xMax, zMax]);
  };
  // Walls on every other grid line both ways: 4 × 4 m rooms.
  const walls = (): void => {
    b.select('build.wall', 1);
    for (let r = 0; r <= site.rows; r += 2) b.drag([1, r * 2 + 0.1], [xMax, r * 2 + 0.1]);
    for (let c = 0; c <= site.cols; c += 2) b.drag([c * 2 + 0.1, 1], [c * 2 + 0.1, zMax]);
  };
  b.give({
    'good.lumber': 20_000,
    'good.hardware': 5_000,
    'good.brownstone': 5_000,
    'good.rope_canvas': 2_000,
  });
  area('build.foundation');
  area('build.piling');
  walls();
  area('build.crate_stack');
  b.key('PageUp');
  area('build.floor');
  walls();
  area('build.shelving');
  area('build.roof_flat');
  return { planned: b.state()?.planned ?? 0 };
}

test('the build camera over a full hideout at Stockton', async ({ page }) => {
  test.setTimeout(900_000);
  const seconds = Number(process.env.SECONDS ?? 15);
  await page.goto('/?debug&play&quality=medium&newrun=deckhand&ashore=stockton');
  await page.waitForFunction(() => document.body.dataset['ashore'] === 'foot', null, {
    timeout: 300_000,
  });
  if (await page.getByTestId('port-screen').count()) await page.keyboard.press('Escape');
  await page.evaluate(() => (window as unknown as W).__glpFoot.hour(15));

  // In the front yard, then B.
  const stand = async (): Promise<void> => {
    await page.evaluate((h) => {
      const w = window as unknown as W;
      const p = w.__glpBuild.toZone(h, 21, 13);
      if (p) w.__glpFoot.teleport(p.x, p.z);
    }, HIDEOUT);
  };
  await stand();
  await page.keyboard.press('KeyB');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'build');

  const starter = await orbitBuildCamera(page, seconds);

  const { planned } = await page.evaluate(fillSite);
  expect(planned).toBeGreaterThan(1_200);
  // The Build button's own action (the dev GUI's panel sits over the button headless).
  await expect(page.getByTestId('build-go')).toBeEnabled();
  const buildMs = await page.evaluate(() => {
    const t = performance.now();
    (window as unknown as W).__glpBuild.build();
    return Math.round(performance.now() - t);
  });
  const after = await page.evaluate(() => (window as unknown as W).__glpBuild.state());
  expect(after?.planned).toBe(0);
  const pieces = after?.built ?? 0;
  expect(pieces).toBeGreaterThanOrEqual(1_400);
  // The proxy and the batches settle after the last edit.
  await page.waitForTimeout(1_000);

  // Editing a full site: a lantern placed in the yard and taken down again, a few times,
  // each timed to the second frame after it (the edit, the overlay and the redraw).
  const editMs = await page.evaluate(async () => {
    const b = (window as unknown as W).__glpBuild;
    const frames = (): Promise<void> =>
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    const out: number[] = [];
    b.select('build.lantern', 0);
    for (let k = 0; k < 6; k++) {
      const t = performance.now();
      b.tool('place');
      b.click(1 + k * 0.5, 0.5);
      await frames();
      out.push(performance.now() - t);
    }
    return out.map((ms) => Math.round(ms));
  });

  const full = await orbitBuildCamera(page, seconds);
  await page.keyboard.press('PageDown');
  const fullGround = await orbitBuildCamera(page, Math.max(4, Math.round(seconds / 2)));

  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'onFoot');
  await stand();
  const onFoot = await lookOnFoot(page, seconds);
  const drawn = await page.evaluate(() => (window as unknown as W).__glpBuild.drawn());

  const report = {
    pieces,
    buildSessionMs: buildMs,
    editToSecondFrameMs: editMs,
    drawnBuilt: drawn?.[HIDEOUT]?.built ?? 0,
    buildCamera: {
      starterShack: starter,
      fullTopLevel: full,
      fullGroundLevel: fullGround,
      hideoutCallsMax: full.drawCallsMax - starter.drawCallsMax,
    },
    onFoot,
    note: 'Whole-frame draw calls and frame times at Medium. Headless Chromium renders on the CPU (SwiftShader): frame times only mean something on the laptop.',
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  writeFileSync(join(import.meta.dirname, 'last-run-build-camera.json'), text + '\n');
  // The hideout's own calls (plan 09 §10: ≤ 80 up close), with the starter shack's few
  // already counted in the baseline.
  expect(report.buildCamera.hideoutCallsMax).toBeLessThanOrEqual(80);
});
