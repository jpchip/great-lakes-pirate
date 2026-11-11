import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

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
  expect(report.drawCallsMax).toBeLessThanOrEqual(150);
});
