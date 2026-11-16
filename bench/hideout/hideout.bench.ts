import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * bench.hideout (plan 09 §10, §16.3 criteria 3 and 12; Phase 8 piece B): a walled compound
 * of 1,500 kit pieces at dusk, the camera orbiting it. Reports the hideout's own draw calls
 * up close (budget ≤ 80) and from the ship 600 m off (1–3, the merged proxy), triangles,
 * placing and removing a piece (≤ one frame), the proxy rebuild, and frame times (which only
 * mean something on the laptop).
 */
test('a hideout of 1,500 pieces', async ({ page }) => {
  const seconds = Number(process.env.SECONDS ?? 15);
  const pieces = Number(process.env.PIECES ?? 1500);
  await page.goto(`/hideout.html?bench=1&hour=20&pieces=${pieces}`);
  await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
  await page.waitForTimeout(seconds * 1000);
  const result: Record<string, number> = await page.evaluate(() => {
    const h = (
      window as unknown as {
        hideout: { frameTimes: number[]; measure(): Record<string, number> };
      }
    ).hideout;
    const f = [...h.frameTimes].sort((a, b) => a - b);
    const q = (p: number): number => f[Math.min(f.length - 1, Math.floor(p * f.length))] ?? 0;
    return { ...h.measure(), frameMedianMs: q(0.5), frameP95Ms: q(0.95) };
  });
  const report: Record<string, number | string> = {
    ...result,
    note: 'Headless Chromium renders on the CPU (SwiftShader): frame times only mean something on the laptop.',
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  writeFileSync(join(import.meta.dirname, 'last-run.json'), text + '\n');
  expect(result['pieces']).toBe(pieces);
  expect(result['nearCalls']).toBeLessThanOrEqual(80);
  expect(result['farCalls']).toBeLessThanOrEqual(3);
  expect(result['placeMsMax']).toBeLessThan(16.7);
});
