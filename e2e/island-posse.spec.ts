import { expect, test, type Page } from '@playwright/test';

/**
 * The marshal posse on Stockton (plan 08 §20.4 piece H; Phase 9 piece F, plan 11 §18).
 * Notorious (tier 4) sends a marshal, who lands by your boat and sweeps out from it; a
 * region with no heat sends none. Seen and chased, you run for the hideout: inside its
 * bounds the chase is over, and the marshal who watched you go in has spotted the place.
 */

interface P3 {
  x: number;
  y: number;
  z: number;
}

interface Posse {
  count: number;
  phase: string;
  landing: { x: number; z: number } | undefined;
  pursued: boolean;
  captured: boolean;
  guards: (P3 & { type: string; state: string; heading: number })[];
}

interface Hooks {
  __glpFoot: {
    teleport(x: number, z: number, y?: number): void;
    state(): { at: P3; boat: { x: number; z: number } | undefined };
    posse(): Posse | undefined;
    posseLand(): boolean;
  };
  __glpLaw: { setHeat(region: string, heat: number): void };
  __glpLife: {
    bunk(): (P3 & { hideout: string }) | undefined;
    spotted(id?: string): { by: string } | undefined;
  };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

const posse = (page: Page) => page.evaluate(() => (window as unknown as Hooks).__glpFoot.posse());

async function onStockton(page: Page, heat: number): Promise<void> {
  await page.goto('/?renderer=null&debug&play&newrun=deckhand&ashore=stockton');
  await expect(page.locator('body')).toHaveAttribute('data-ashore', 'foot', { timeout: 90_000 });
  if (await page.getByTestId('port-screen').count()) await page.keyboard.press('Escape');
  await page.evaluate((h) => {
    (window as unknown as Hooks).__glpLaw.setHeat('region.apostles', h);
  }, heat);
}

test('Notorious on Stockton: a marshal lands by your boat and searches', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await onStockton(page, 320);
  const before = await posse(page);
  expect(before?.count).toBe(1);
  expect(before?.phase).toBe('coming');
  expect(before?.guards).toEqual([]);

  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.posseLand())).toBe(true);
  const landed = await posse(page);
  expect(landed?.phase).toBe('searching');
  expect(landed?.guards.map((g) => g.type)).toEqual(['npc.marshal']);
  const boat = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.state().boat);
  expect(boat).toBeDefined();
  if (!boat || !landed?.landing) return;
  expect(Math.hypot(landed.landing.x - boat.x, landed.landing.z - boat.z)).toBeLessThan(80);

  // A few seconds on, he's walking his sweep out from the landing.
  await expect
    .poll(
      async () => {
        const p = await posse(page);
        const g = p?.guards[0];
        return g && p.landing ? Math.hypot(g.x - p.landing.x, g.z - p.landing.z) : 0;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(8);
  expect(errors).toEqual([]);
});

test('Clean on Stockton: no marshal comes', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await onStockton(page, 0);
  expect((await posse(page))?.count).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.posseLand())).toBe(false);
  expect((await posse(page))?.guards).toEqual([]);
  expect(errors).toEqual([]);
});

test('Chased on Stockton: the marshal breaks off at the hideout and has seen it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errors = collectErrors(page);
  await onStockton(page, 320);
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.posseLand())).toBe(true);

  // Step out in front of him until he's after you.
  await expect
    .poll(
      async () => {
        await page.evaluate(() => {
          const f = (window as unknown as Hooks).__glpFoot;
          const g = f.posse()?.guards[0];
          if (!g || f.posse()?.pursued) return;
          f.teleport(g.x + Math.sin(g.heading) * 5, g.z - Math.cos(g.heading) * 5);
        });
        return (await posse(page))?.pursued;
      },
      { timeout: 60_000, intervals: [1000] },
    )
    .toBe(true);

  // Into the hideout's bounds, by the bunk.
  const bunk = await page.evaluate(() => (window as unknown as Hooks).__glpLife.bunk());
  expect(bunk?.hideout).toBe('hideout.stockton');
  if (!bunk) return;
  await page.evaluate(([x, z]) => (window as unknown as Hooks).__glpFoot.teleport(x, z), [
    bunk.x + 1.2,
    bunk.z,
  ] as const);
  await expect.poll(async () => (await posse(page))?.pursued, { timeout: 10_000 }).toBe(false);
  const spotted = await page.evaluate(() => (window as unknown as Hooks).__glpLife.spotted());
  expect(spotted?.by).toBe('the marshals');
  // And he doesn't come in after you.
  await page.waitForTimeout(3000);
  const after = await posse(page);
  expect(after?.captured).toBe(false);
  expect(after?.pursued).toBe(false);
  expect(errors).toEqual([]);
});
