import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 7 piece H (plan 08 §20.4, exit criterion 9): row to Stockton's old quarry, climb
 * its wharf ladder, search the cairns for the run's cache, walk to the stash's strongbox
 * and open it on foot. Through the dev hooks.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface Spot {
  name: string;
  x: number;
  y: number;
  z: number;
}

interface Hooks {
  __glpFoot: {
    land(): Promise<string | undefined>;
    anchor(): void;
    place(x: number, z: number, deg?: number): void;
    teleport(x: number, z: number, y?: number): void;
    interact(): void;
    state(): {
      active: boolean;
      inBoat: boolean;
      ladder: number | undefined;
      prompt: string | undefined;
      at: { x: number; y: number; z: number };
      ladders: { x: number; z: number; topY: number }[];
      surface: string;
    };
    island(): {
      island: string | undefined;
      colliders: number;
      pieces: { kind: string; x: number; z: number; top: number }[];
      cache: { spots: Spot[]; holds: number; cents: number; searched: number[]; looted: boolean };
      strongbox: { x: number; y: number; z: number; hideout: string } | undefined;
    };
  };
}

const hooks = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as Hooks).__glpFoot;
    return { state: f.state(), island: f.island() };
  });

test('Stockton on foot: the quarry wharf, the cache in its cairn, the stash at its strongbox', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&newrun=deckhand');
  await page.waitForFunction(() => '__glpFoot' in window);

  // Anchored off the quarry, a cable east of its wharf.
  const before = await hooks(page);
  const wharf = before.island.pieces.find((p) => p.kind === 'derrick');
  expect(wharf).toBeDefined();
  if (!wharf) return;
  await page.evaluate(
    ([x, z]) => {
      const f = (window as unknown as Hooks).__glpFoot;
      f.place(x, z, 0);
      f.anchor();
    },
    [wharf.x + 60, wharf.z] as const,
  );
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'boat');
  let h = await hooks(page);
  expect(h.island.island).toBe('island.stockton');
  // The island is built whole: thousands of trunks besides the quarry's pieces.
  expect(h.island.colliders).toBeGreaterThan(1000);

  // Row up under the wharf's ladder and climb it.
  const ladder = h.state.ladders.find((l) => Math.hypot(l.x - wharf.x, l.z - wharf.z) < 20);
  expect(ladder).toBeDefined();
  if (!ladder) return;
  await page.evaluate(([x, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z), [
    ladder.x + 1.6,
    ladder.z,
  ] as const);
  await expect.poll(async () => (await hooks(page)).state.prompt).toBe('Climb the ladder');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect.poll(async () => (await hooks(page)).state.ladder).toBeDefined();
  await page.keyboard.down('KeyW');
  await expect
    .poll(async () => (await hooks(page)).state.ladder, { timeout: 15_000 })
    .toBeUndefined();
  await page.keyboard.up('KeyW');
  h = await hooks(page);
  expect(h.state.inBoat).toBe(false);
  expect(h.state.at.y).toBeGreaterThan(ladder.topY - 0.3);
  expect(h.state.surface).toBe('stone');

  // The cairns: searched in turn until the cache turns up, then the cash is yours.
  const cache = h.island.cache;
  const order = [...cache.spots.keys()].sort(
    (a, b) => Number(a === cache.holds) - Number(b === cache.holds),
  );
  for (const k of order) {
    const spot = cache.spots[k] as Spot;
    await page.evaluate(([x, y, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z, y), [
      spot.x + 1.3,
      spot.y + 0.2,
      spot.z,
    ] as const);
    await expect.poll(async () => (await hooks(page)).state.prompt).toBe(`Search ${spot.name}`);
    await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
    await expect.poll(async () => (await hooks(page)).island.cache.searched).toContain(k);
  }
  h = await hooks(page);
  expect(h.island.cache.looted).toBe(true);

  // Across the island to Presque Isle bay: F at the strongbox opens the stash.
  const box = h.island.strongbox;
  expect(box?.hideout).toBe('hideout.stockton');
  if (!box) return;
  await page.evaluate(([x, y, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z, y), [
    box.x + 1.3,
    box.y + 0.2,
    box.z,
  ] as const);
  await expect.poll(async () => (await hooks(page)).state.prompt).toBe('Open the stash');
  await page.evaluate(() => (window as unknown as Hooks).__glpFoot.interact());
  await expect(page.locator('body')).toHaveAttribute('data-stash', 'hideout.stockton');
  expect(errors).toEqual([]);
});
