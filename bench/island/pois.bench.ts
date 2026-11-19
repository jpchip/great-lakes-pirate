import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import tiers from '../../data/island_tiers.json' with { type: 'json' };

/**
 * bench.island per tier, the POI kits' share (plan 11 §13, §18.3 criterion 12; Phase 9
 * piece P): each tier's set of prefabs on /pois.html, drawn by the game's POI view, with
 * its own draw calls and triangles against `island_tiers.json`. The whole frame on foot
 * is `island.bench.ts`'s (Stockton, hero); pieces Q and R add their islands to it as they
 * become walkable. Headless Chromium renders on the CPU: frame times mean nothing here.
 */

type Tier = 'hero' | 'standard' | 'minor';

for (const tier of ['hero', 'standard', 'minor'] as Tier[]) {
  test(`the ${tier} set of POI kits`, async ({ page }) => {
    await page.goto(`/pois.html?tier=${tier}`);
    await expect(page.locator('body')).toHaveAttribute('data-ready', '1', { timeout: 60_000 });
    const m: Record<string, number> = await page.evaluate(() =>
      (window as unknown as { pois: { measure(): Record<string, number> } }).pois.measure(),
    );
    const budget = tiers.tiers[tier];
    const report = {
      tier,
      ...m,
      budget: { poiTriangles: budget.poiTriangles, maxPois: budget.maxPois },
    };
    const text = JSON.stringify(report, null, 2);
    console.log(text);
    writeFileSync(join(import.meta.dirname, `last-run-pois-${tier}.json`), text + '\n');
    // The kits are one merged mesh: a single draw call for every prefab on the island.
    expect(m['poiCalls']).toBeLessThanOrEqual(1);
    expect(m['viewTriangles']).toBeLessThanOrEqual(budget.poiTriangles);
    expect(m['prefabs']).toBeLessThanOrEqual(budget.maxPois);
  });
}
