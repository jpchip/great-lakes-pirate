import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 8 piece F (plan 09 §3, §6.2, §8; plan 09 §16.3 criterion 10): at Stockton on foot,
 * sleep in the shack's bunk with the law after you in the Apostles and wake to it cooled,
 * carry a load of dressed brownstone from the quarry into the stores, and see the place
 * marked as seen in the build palette once a passing ship has spotted it.
 */

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

interface P3 {
  x: number;
  y: number;
  z: number;
}

interface Hooks {
  __glpFoot: {
    teleport(x: number, z: number, y?: number): void;
    interact(): void;
    state(): {
      prompt: string | undefined;
      at: P3;
      boat: { x: number; z: number } | undefined;
    };
  };
  __glpLaw: { setHeat(region: string, heat: number): unknown };
  __glpLife: {
    bunk(): (P3 & { hideout: string }) | undefined;
    piles(): (P3 & { kind: string; widthM: number; depthM: number; bearing: number })[];
    heat(region: string): number;
    load(): { good: string; qty: number } | undefined;
    sleepOpen(): boolean;
    spot(id?: string, by?: string): void;
    spotted(id?: string): { by: string } | undefined;
    concealment(id?: string): { value: number; word: string } | undefined;
  };
  __glpStash: {
    hideouts(): Record<string, { storage: { goods: { good: string; qty: number }[] } }>;
  };
  __glpBuild: { open(): string | undefined; close(): void };
}

type W = Window & Hooks & { __glpLife: { hold(): { good: string; qty: number }[] } };

/** Brownstone in the hold, CU. */
function brownstone(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as W).__glpLife
      .hold()
      .filter((g) => g.good === 'good.brownstone')
      .reduce((n, g) => n + g.qty, 0),
  );
}

test('Stockton: lie low in the bunk, carry brownstone from the quarry, be seen', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&ashore=stockton');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
  if (await page.getByTestId('port-screen').count()) await page.keyboard.press('Escape');

  // Wanted in the Apostles, then to the bunk in the shack.
  await page.evaluate(() => (window as unknown as W).__glpLaw.setHeat('region.apostles', 100));
  const bunk = await page.evaluate(() => (window as unknown as W).__glpLife.bunk());
  expect(bunk?.hideout).toBe('hideout.stockton');
  if (!bunk) return;
  // Beside the bunk, on whichever side the stores aren't nearer.
  let bySide = false;
  for (const [ox, oz] of [
    [0.6, 0],
    [-0.6, 0],
    [0, 0.6],
    [0, -0.6],
    [0.9, 0.9],
    [-0.9, 0.9],
    [0.9, -0.9],
    [-0.9, -0.9],
  ] as const) {
    await page.evaluate(([x, z]) => (window as unknown as W).__glpFoot.teleport(x, z), [
      bunk.x + ox,
      bunk.z + oz,
    ] as const);
    await page.waitForTimeout(300);
    const at = await page.evaluate(() => (window as unknown as W).__glpFoot.state().prompt);
    if (at === 'Sleep in the bunk') {
      bySide = true;
      break;
    }
  }
  expect(bySide).toBe(true);
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect(page.getByTestId('sleep-dialog')).toBeVisible();
  await expect(page.getByTestId('sleep-dialog')).toContainText('Apostle Islands');
  await page.getByTestId('sleep-eight').click();
  await expect(page.getByTestId('sleep-dialog')).toHaveCount(0);
  const heat = await page.evaluate(() =>
    (window as unknown as W).__glpLife.heat('region.apostles'),
  );
  // Eight hours away from the region at tier 2 would take off 3.2; asleep there, three times that.
  expect(heat).toBeLessThan(100 - 3.2 * 2);

  // A load of dressed brownstone from the quarry, put in the boat for the hold.
  const piles = await page.evaluate(() => (window as unknown as W).__glpLife.piles());
  expect(piles.length).toBeGreaterThan(0);
  const prompt = () => page.evaluate(() => (window as unknown as W).__glpFoot.state().prompt);
  // Beside the first block, on the quarry floor it lies on.
  const atPile = async (): Promise<void> => {
    const pile = piles[0];
    if (!pile) return;
    const d = pile.depthM / 2 + 1;
    const at = {
      x: pile.x + Math.sin(pile.bearing) * d,
      z: pile.z - Math.cos(pile.bearing) * d,
      y: pile.y + 0.05,
    };
    await page.evaluate((p) => (window as unknown as W).__glpFoot.teleport(p.x, p.z, p.y), at);
  };
  await atPile();
  await expect.poll(prompt).toMatch(/^Take a load of dressed brownstone/);
  expect(await prompt()).toMatch(/\(20 CU left this season\)$/);
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__glpLife.load()))
    .toEqual({
      good: 'good.brownstone',
      qty: 4,
      hideout: 'hideout.stockton',
    });
  const boat = await page.evaluate(() => (window as unknown as W).__glpFoot.state().boat);
  expect(boat).toBeTruthy();
  if (!boat) return;
  const holdBefore = await brownstone(page);
  await page.evaluate((b) => (window as unknown as W).__glpFoot.teleport(b.x - 1.8, b.z), boat);
  await expect.poll(prompt).toBe('Put the dressed brownstone in the boat');
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect.poll(() => brownstone(page)).toBe(holdBefore + 4);

  // Another, carried into the shack's stores.
  await atPile();
  await expect.poll(prompt).toMatch(/\(16 CU left this season\)$/);
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__glpLife.load()))
    .toBeTruthy();
  await page.evaluate((b) => (window as unknown as W).__glpFoot.teleport(b.x + 0.6, b.z), bunk);
  await expect.poll(prompt).toBe('Stack the dressed brownstone in the stores');
  await page.evaluate(() => (window as unknown as W).__glpFoot.interact());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as W).__glpStash
          .hideouts()
          ['hideout.stockton']?.storage.goods.filter((g) => g.good === 'good.brownstone')
          .reduce((n, g) => n + g.qty, 0),
      ),
    )
    .toBe(4);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as W).__glpLife.load()))
    .toBeUndefined();

  // A passing ship sees the place: the build palette says so, with the concealment.
  await page.evaluate(() => (window as unknown as W).__glpLife.spot());
  expect(await page.evaluate(() => (window as unknown as W).__glpLife.spotted())).toMatchObject({
    by: 'the tug Sophia',
  });
  expect(await page.evaluate(() => (window as unknown as W).__glpBuild.open())).toBeUndefined();
  await expect(page.getByTestId('build-concealment')).toContainText('Concealment');
  await expect(page.getByTestId('build-spotted')).toContainText('the tug Sophia');
  await page.evaluate(() => (window as unknown as W).__glpBuild.close());

  expect(errors).toEqual([]);
});
