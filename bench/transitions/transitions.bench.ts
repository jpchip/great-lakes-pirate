import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 3 exit criteria 3 and 9 (plan 03 §20.3, §29): how long the chart takes to load a
 * zone, cold and on a warm cache, to drop into an arena and to come back out of one; and
 * whether a round trip to another zone and back gives the heap back. Each time runs from
 * the action to the body attribute that says it has landed, timed in the page.
 */

interface Hooks {
  __glpZones: { enter(id: string, entry?: string, fresh?: boolean): Promise<void> };
  __glpChart: { plot(points: [number, number][]): string; meet(kind: string): string | undefined };
  __glpArena: { place(x: number, z: number): void };
  gc?: () => void;
}

/**
 * Runs `act` in the page and resolves with the ms until `done` holds on the body, after
 * `started` has held (when given), so a state left over from the last action doesn't count.
 */
async function timed(page: Page, act: string, done: string, started = 'true'): Promise<number> {
  return page.evaluate(
    ([actSrc, doneSrc, startedSrc]) =>
      new Promise<number>((resolve) => {
        const check = new Function('b', `return ${doneSrc};`) as (b: DOMStringMap) => boolean;
        const begun = new Function('b', `return ${startedSrc};`) as (b: DOMStringMap) => boolean;
        const t0 = performance.now();
        let seen = begun(document.body.dataset);
        const obs = new MutationObserver(() => {
          seen ||= begun(document.body.dataset);
          if (seen && check(document.body.dataset)) {
            obs.disconnect();
            // The frame that shows it.
            requestAnimationFrame(() => resolve(performance.now() - t0));
          }
        });
        obs.observe(document.body, { attributes: true });
        void (new Function(actSrc) as () => unknown)();
      }),
    [act, done, started] as const,
  );
}

async function heapMb(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const w = window as unknown as Hooks;
    for (let i = 0; i < 3; i++) {
      w.gc?.();
      await new Promise((r) => setTimeout(r, 200));
    }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return mem ? mem.usedJSHeapSize / 2 ** 20 : NaN;
  });
}

const ms = (n: number): number => Math.round(n);

test('chart, zone and arena transitions', async ({ page }) => {
  const quality = process.env.QUALITY ?? 'medium';
  const body = page.locator('body');
  const results: Record<string, unknown> = { quality };
  await page.goto(`/?debug&quality=${quality}&zone=zone.apostles&spawn=-3350,-2450,270`);
  await expect(body).toHaveAttribute('data-mode', 'sailing', { timeout: 120_000 });
  await expect(body).toHaveAttribute('data-terrain', 'loaded', { timeout: 120_000 });
  await page.waitForTimeout(3000);
  const heapStart = await heapMb(page);

  // Chart to zone: the arrival load (fade included), uncached, then from the browser cache.
  const enter = (id: string, entry: string, fresh: boolean): string =>
    `window.__glpZones.enter('${id}', '${entry}', ${fresh})`;
  const loaded = `b.zoneLoad === 'done'`;
  const loading = `b.zoneLoad === 'loading'`;
  const timeZone = (id: string, entry: string, fresh: boolean): Promise<number> =>
    timed(page, enter(id, entry, fresh), loaded, loading);
  const zoneLoads: Record<string, number> = {};
  zoneLoads['twin_ports first'] = await timeZone('zone.twin_ports', 'east', true);
  await page.waitForTimeout(1500);
  zoneLoads['two_harbors first'] = await timeZone('zone.two_harbors', 'east', true);
  await page.waitForTimeout(1500);
  zoneLoads['apostles warm'] = await timeZone('zone.apostles', 'west', true);
  await page.waitForTimeout(1500);
  zoneLoads['twin_ports warm'] = await timeZone('zone.twin_ports', 'east', true);
  await page.waitForTimeout(1500);
  zoneLoads['two_harbors warm'] = await timeZone('zone.two_harbors', 'east', true);
  await page.waitForTimeout(1500);
  // Turning back: the zone just left is kept for a minute.
  zoneLoads['twin_ports from the 60 s cache'] = await timeZone('zone.twin_ports', 'east', false);
  await page.waitForTimeout(1500);
  await timeZone('zone.apostles', 'west', true);
  results['zoneLoadMs'] = Object.fromEntries(Object.entries(zoneLoads).map(([k, v]) => [k, ms(v)]));

  // Heap: back in the Apostles after the round trip, once the cache has let go.
  await page.waitForTimeout(62_000);
  const heapEnd = await heapMb(page);
  results['heapMb'] = { start: +heapStart.toFixed(1), afterRoundTrip: +heapEnd.toFixed(1) };

  // Chart to arena and back, twice: the first compiles the NPC ships' shaders.
  await page.goto(`/?debug&quality=${quality}&zone=zone.apostles&spawn=-3350,-2450,270`);
  await expect(body).toHaveAttribute('data-mode', 'sailing', { timeout: 120_000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('KeyM');
  await expect(body).toHaveAttribute('data-mode', 'chart');
  await page.evaluate(() =>
    (window as unknown as Hooks).__glpChart.plot([
      [46.97, -91.6],
      [46.85, -91.95],
    ]),
  );
  await page.keyboard.press('Enter');
  const arena: { toArenaMs: number; toChartMs: number }[] = [];
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (window as unknown as Hooks).__glpChart.meet('freighter'));
    await expect(page.getByTestId('encounter-engage')).toBeVisible();
    const toArenaMs = await timed(
      page,
      `document.querySelector('[data-testid="encounter-engage"]').click()`,
      `b.arena === 'ship' && b.mode === 'sailing'`,
    );
    await page.waitForTimeout(2000);
    const toChartMs = await timed(
      page,
      `window.__glpArena.place(0, -1600)`,
      `b.mode === 'chart' && b.arenaResult === 'left'`,
    );
    arena.push({ toArenaMs: ms(toArenaMs), toChartMs: ms(toChartMs) });
    await page.waitForTimeout(1500);
  }
  results['arena'] = arena;
  results['renderer'] = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER);
  });

  const text = JSON.stringify(results, null, 2);
  console.log(text);
  const file = join(import.meta.dirname, `last-run-${quality}.json`);
  writeFileSync(file, text + '\n');
  console.log(`Saved to ${file}`);
});
