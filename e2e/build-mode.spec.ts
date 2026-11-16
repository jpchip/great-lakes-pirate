import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece C (plan 09 §16.3 criteria 1, 2 and 8): land at Stockton, press B in the
 * hideout, and build a roofed storehouse beside the pre-built shack through the build
 * mode's own paths (the dev hooks aim the cursor at site meters and press the mouse, as a
 * click on the canvas would; CI has no GPU to raycast through). Then undo and redo, take a
 * wall down for its refund, go back on foot and open the stash at the strongbox.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface BuildState {
  hideout: string;
  level: number;
  tool: 'place' | 'remove';
  ghosts: { ok: boolean; reason?: string }[];
  built: number;
  planned: number;
  canUndo: boolean;
  canRedo: boolean;
  message?: string;
  storage: { good: string; qty: number }[];
  gameSeconds: number;
}

interface Hooks {
  __glpFoot: {
    teleport(x: number, z: number, y?: number): void;
    interact(): void;
    state(): { prompt: string | undefined; at: { x: number; y: number; z: number } };
    island(): { strongbox: { x: number; y: number; z: number; hideout: string } | undefined };
  };
  __glpBuild: {
    open(): string | undefined;
    state(): BuildState | undefined;
    aim(x: number, z: number): void;
    click(x: number, z: number): void;
    drag(from: [number, number], to: [number, number]): void;
    key(code: string, mods?: { ctrl?: boolean; shift?: boolean }): void;
    select(id: string, variant?: number): void;
    tool(t: 'place' | 'remove'): void;
    build(): void;
    give(goods: Record<string, number>): boolean;
    toZone(hideout: string, x: number, z: number): { x: number; z: number } | undefined;
    sites(): { hideout: string; built: number; planned: number }[];
    colliders(): number;
  };
}

type W = Window & Hooks;
const build = (page: Page) => page.evaluate(() => (window as unknown as W).__glpBuild.state());
const qty = (s: BuildState | undefined, good: string): number =>
  (s?.storage ?? []).filter((g) => g.good === good).reduce((n, g) => n + g.qty, 0);

test('Stockton: B in the hideout, plan a storehouse, Build, undo and take a wall down', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&ashore=stockton');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
  // The port screen a new run opens on: put it away.
  if (await page.getByTestId('port-screen').count()) await page.keyboard.press('Escape');

  // The pre-built shack and pier stand there, solid.
  const sites = await page.evaluate(() => (window as unknown as W).__glpBuild.sites());
  expect(sites.map((s) => s.hideout)).toEqual(['hideout.stockton']);
  expect(sites[0]?.built).toBeGreaterThan(50);
  expect(
    await page.evaluate(() => (window as unknown as W).__glpBuild.colliders()),
  ).toBeGreaterThan(20);

  // Out of the bounds, B says why not; in front of the shack, it opens build mode.
  const outside = await page.evaluate(() => {
    const w = window as unknown as W;
    const p = w.__glpBuild.toZone('hideout.stockton', -40, 20);
    if (p) w.__glpFoot.teleport(p.x, p.z);
    return w.__glpBuild.open();
  });
  expect(outside).toMatch(/Nothing to build here/);
  await page.evaluate(() => {
    const w = window as unknown as W;
    const p = w.__glpBuild.toZone('hideout.stockton', 21, 13);
    if (p) w.__glpFoot.teleport(p.x, p.z);
  });
  await page.keyboard.press('KeyB');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'build');
  await expect(page.locator('body')).toHaveAttribute('data-build', 'hideout.stockton');
  await expect(page.getByTestId('build-panel')).toBeVisible();

  // An invalid ghost says why: a wall on bare ground needs a floor.
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.select('build.wall', 1);
    b.aim(31, 36.1);
  });
  let s = await build(page);
  expect(s?.ghosts[0]).toMatchObject({ ok: false, reason: 'Needs a floor under it' });

  // A 3 × 3 storehouse on timber foundations, plank walls with a door, a flat roof, and
  // two crate stacks: placed as ghosts, which cost nothing yet.
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.give({ 'good.lumber': 120, 'good.hardware': 20 });
    b.select('build.foundation', 0);
    b.drag([31, 37], [35, 41]);
    b.select('build.wall', 1);
    b.drag([33, 36.1], [35, 36.1]);
    b.drag([31, 41.9], [35, 41.9]);
    b.drag([30.1, 37], [30.1, 41]);
    b.drag([35.9, 37], [35.9, 41]);
    b.select('build.wall_door', 1);
    b.click(31, 36.1);
    b.select('build.crate_stack', 0);
    b.click(31, 41);
    b.click(35, 41);
    b.select('build.roof_flat', 0);
    b.drag([31, 37], [35, 41]);
  });
  s = await build(page);
  expect(s?.planned).toBe(9 + 12 + 2 + 9);
  const lumber = qty(s, 'good.lumber');
  const before = s?.gameSeconds ?? 0;
  const builtBefore = s?.built ?? 0;

  // Undo the roof and redo it.
  await page.evaluate(() => (window as unknown as W).__glpBuild.key('KeyZ', { ctrl: true }));
  expect((await build(page))?.planned).toBe(9 + 12 + 2);
  await page.evaluate(() => (window as unknown as W).__glpBuild.key('KeyY', { ctrl: true }));
  expect((await build(page))?.planned).toBe(32);

  // Build: everything goes up, materials are used, and the clock runs on by the work.
  await page.getByTestId('build-go').click();
  s = await build(page);
  expect(s?.planned).toBe(0);
  expect(s?.built).toBe(builtBefore + 32);
  expect(qty(s, 'good.lumber')).toBeLessThan(lumber);
  expect((s?.gameSeconds ?? 0) - before).toBeGreaterThan(24 * 3600);
  expect(s?.canUndo).toBe(false);

  // Take the back wall's middle down: 75% of 2 lumber comes back.
  const lumberAfter = qty(s, 'good.lumber');
  await page.evaluate(() => {
    const b = (window as unknown as W).__glpBuild;
    b.key('KeyX');
    b.click(33, 41.95);
  });
  s = await build(page);
  expect(s?.tool).toBe('remove');
  expect(s?.built).toBe(builtBefore + 31);
  expect(qty(s, 'good.lumber')).toBe(lumberAfter + 1);

  // Back on foot, and the stash opens at the shack's strongbox.
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'onFoot');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot');
  const box = await page.evaluate(() => (window as unknown as W).__glpFoot.island().strongbox);
  expect(box?.hideout).toBe('hideout.stockton');
  if (!box) return;
  await page.evaluate(([x, y, z]) => (window as unknown as W).__glpFoot.teleport(x, z, y), [
    box.x + 1,
    box.y + 0.2,
    box.z,
  ] as const);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__glpFoot.state().prompt))
    .toBe('Open the stash');
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect(page.locator('body')).toHaveAttribute('data-stash', 'hideout.stockton');
  expect(errors).toEqual([]);
});
