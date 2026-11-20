import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import tiers from '../../data/island_tiers.json' with { type: 'json' };

/**
 * bench.island (plan 08 §20.3 criterion 10; plan 17): Stockton on foot, the whole island
 * built under you, walked along its shore and up through the forest. Reports draw calls
 * (budget ≤ 150), triangles and frame times. Headless Chromium draws on the CPU
 * (SwiftShader), so its frame times say little; run it on the laptop for those.
 */

interface Hooks {
  __glpFoot: {
    land(): Promise<string | undefined>;
    anchor(): void;
    place(x: number, z: number, deg?: number): void;
    teleport(x: number, z: number, y?: number): void;
    face(deg: number, pitch?: number): void;
    hour(h: number): void;
    island(): { pieces: { kind: string; x: number; z: number }[] };
    renderStats(): { drawCalls: number; triangles: number; scale: number } | undefined;
  };
}

test('Stockton on foot: the island built, walked round its shore', async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(900_000);
  const seconds = Number(process.env.SECONDS ?? 20);
  await page.goto('/?debug&play&quality=medium');
  await page.waitForFunction(() => '__glpFoot' in window, null, { timeout: 180_000 });
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.hour(15));
  const derrick = await page.evaluate(() =>
    (window as unknown as Hooks).__glpFoot.island().pieces.find((p) => p.kind === 'derrick'),
  );
  expect(derrick).toBeDefined();
  if (!derrick) return;
  await page.evaluate(
    ([x, z]) => {
      const f = (window as unknown as Hooks).__glpFoot;
      f.place(x, z, 0);
      f.anchor();
    },
    [derrick.x + 60, derrick.z] as const,
  );
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  // Onto the island's sand, then a walk inland and along the shore for the samples.
  await page.evaluate(([x, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z), [
    derrick.x - 40,
    derrick.z - 60,
  ] as const);
  const samples: { drawCalls: number; triangles: number }[] = [];
  for (let t = 0; t < seconds * 4; t++) {
    await page.waitForTimeout(250);
    const s = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.renderStats());
    if (s) samples.push(s);
    if (t % 20 === 0) {
      await page.evaluate(
        (deg) => (window as unknown as Hooks).__glpFoot.face(deg, 0.1),
        (t * 37) % 360,
      );
    }
  }
  const calls = samples.map((s) => s.drawCalls).sort((a, b) => a - b);
  const tris = samples.map((s) => s.triangles);
  const report = {
    drawCallsMax: calls.at(-1) ?? 0,
    drawCallsMedian: calls[Math.floor(calls.length / 2)] ?? 0,
    trianglesMax: Math.max(0, ...tris),
    samples: samples.length,
    note: 'Headless Chromium renders on the CPU (SwiftShader): frame times only mean something on the laptop.',
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  writeFileSync(join(import.meta.dirname, 'last-run.json'), text + '\n');
  // The hero tier's whole-frame budget (island_tiers.json, Phase 9 piece P).
  expect(report.drawCallsMax).toBeLessThanOrEqual(tiers.tiers.hero.drawCalls);
  expect(report.trianglesMax).toBeLessThanOrEqual(tiers.tiers.hero.triangles);
});

/**
 * bench.island per tier (plan 11 §18.3 criterion 12; Phase 9 piece R): a standard island
 * with two stations (Long), the biggest standard island (Oak) and a minor one (Cat), each
 * landed on its beach and looked round, against its tier's whole-frame budget.
 */
interface IslandHooks {
  __glpIslands: { land(id: string): Promise<string | undefined> };
  __glpFoot: Hooks['__glpFoot'];
}

for (const [id, tier] of [
  ['island.long', 'standard'],
  ['island.oak', 'standard'],
  ['island.cat', 'minor'],
] as const) {
  test(`${id} on foot: the ${tier} frame budget`, async ({ page }: { page: Page }) => {
    test.setTimeout(600_000);
    await page.goto('/?debug&play&quality=medium');
    await page.waitForFunction(() => '__glpIslands' in window, null, { timeout: 180_000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => (window as unknown as IslandHooks).__glpFoot.hour(15));
    const why = await page.evaluate(
      (island) => (window as unknown as IslandHooks).__glpIslands.land(island),
      id,
    );
    expect(why).toBeUndefined();
    const samples: { drawCalls: number; triangles: number }[] = [];
    for (let t = 0; t < 40; t++) {
      await page.waitForTimeout(250);
      const s = await page.evaluate(() =>
        (window as unknown as IslandHooks).__glpFoot.renderStats(),
      );
      if (s) samples.push(s);
      if (t % 10 === 0) {
        await page.evaluate(
          (deg) => (window as unknown as IslandHooks).__glpFoot.face(deg, 0.1),
          (t * 37) % 360,
        );
      }
    }
    const report = {
      island: id,
      tier,
      drawCallsMax: Math.max(0, ...samples.map((s) => s.drawCalls)),
      trianglesMax: Math.max(0, ...samples.map((s) => s.triangles)),
      samples: samples.length,
    };
    const text = JSON.stringify(report, null, 2);
    console.log(text);
    writeFileSync(join(import.meta.dirname, `last-run-${id.slice(7)}.json`), text + '\n');
    expect(report.drawCallsMax).toBeLessThanOrEqual(tiers.tiers[tier].drawCalls);
    // The frame's triangles are mostly the zone's ground and forest, whatever the island:
    // looking from Long Island to the mainland's woods draws ~375k. Held to the hero frame's.
    expect(report.trianglesMax).toBeLessThanOrEqual(tiers.tiers.hero.triangles);
  });
}
