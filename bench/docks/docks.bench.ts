import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * bench.docks (plan 08 §14, §20.3 criterion 10; Phase 7 piece C): Bayfield at night with
 * 12 guards walking navmesh paths, the camera on a scripted walk along the waterfront.
 * Reports draw calls (budget ≤ 200), triangles, frame times and the path query cost.
 * Perception's ≤ 1 ms a tick is piece D's to add once guards perceive.
 */
test('Bayfield at night with 12 guards', async ({ page }) => {
  const seconds = Number(process.env.SECONDS ?? 20);
  await page.goto('/district.html?bench=1&hour=23&guards=12');
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  const samples: number[] = [];
  const triangles: number[] = [];
  for (let t = 0; t < seconds * 4; t++) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => {
      const d = (
        window as unknown as {
          district: {
            scene: { renderer: { info: { render: { calls: number; triangles: number } } } };
          };
        }
      ).district;
      return d.scene.renderer.info.render;
    });
    samples.push(s.calls);
    triangles.push(s.triangles);
  }
  const result = await page.evaluate(() => {
    const d = (
      window as unknown as {
        district: {
          frameTimes: number[];
          pathStats: { pathMs: number; pathCount: number };
          model: { colliders: { size: number } };
        };
      }
    ).district;
    const f = [...d.frameTimes].sort((a, b) => a - b);
    const q = (p: number): number => f[Math.min(f.length - 1, Math.floor(p * f.length))] ?? 0;
    return {
      frameMedianMs: q(0.5),
      frameP95Ms: q(0.95),
      paths: d.pathStats.pathCount,
      pathMsAvg: d.pathStats.pathCount ? d.pathStats.pathMs / d.pathStats.pathCount : 0,
      colliders: d.model.colliders.size,
    };
  });
  const report = {
    drawCallsMax: Math.max(...samples),
    drawCallsMedian: samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)],
    trianglesMax: Math.max(...triangles),
    ...result,
    note: 'Headless Chromium renders on the CPU (SwiftShader): frame times only mean something on the laptop.',
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  writeFileSync(join(import.meta.dirname, 'last-run.json'), text + '\n');
  expect(report.drawCallsMax).toBeLessThanOrEqual(200);
});
