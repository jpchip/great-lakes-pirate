import { expect, test, type Page } from '@playwright/test';

/**
 * Piece H (plan 08 §20.4): the marshal posse on Stockton. Notorious (tier 4) puts a marshal
 * on the island's beats; a region with no heat puts none there.
 */

interface Hooks {
  __glpFoot: {
    land(): Promise<string | undefined>;
    anchor(): void;
    place(x: number, z: number, deg?: number): void;
    island(): { pieces: { kind: string; x: number; z: number }[] };
    posse(): { count: number; captured: boolean; guards: { type: string }[] } | undefined;
  };
  __glpLaw: { setHeat(region: string, heat: number): void };
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function landOnStockton(page: Page, heat: number): Promise<void> {
  await page.goto('/?renderer=null&debug&play');
  await page.waitForFunction(() => '__glpFoot' in window);
  await page.evaluate((h) => {
    (window as unknown as Hooks).__glpLaw.setHeat('region.apostles', h);
  }, heat);
  const derrick = await page.evaluate(() =>
    (window as unknown as Hooks).__glpFoot.island().pieces.find((p) => p.kind === 'derrick'),
  );
  if (!derrick) throw new Error('no quarry on the island');
  await page.evaluate(
    ([x, z]) => {
      const f = (window as unknown as Hooks).__glpFoot;
      f.place(x, z, 0);
      f.anchor();
    },
    [derrick.x + 60, derrick.z] as const,
  );
  expect(await page.evaluate(() => (window as unknown as Hooks).__glpFoot.land())).toBeUndefined();
}

test('Notorious on Stockton: a marshal walks the island', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await landOnStockton(page, 320);
  const posse = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.posse());
  expect(posse?.count).toBe(1);
  expect(posse?.guards.map((g) => g.type)).toEqual(['npc.marshal']);
  expect(errors).toEqual([]);
});

test('Clean on Stockton: no posse on the island', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = collectErrors(page);
  await landOnStockton(page, 0);
  const posse = await page.evaluate(() => (window as unknown as Hooks).__glpFoot.posse());
  expect(posse).toBeUndefined();
  expect(errors).toEqual([]);
});
